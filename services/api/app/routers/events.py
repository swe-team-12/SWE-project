import re
import secrets
import uuid
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, File, Query, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import selectinload

from app.access import (
    activation_fee_setting,
    can_manage_event,
    event_change_data,
    get_event_or_404,
    platform_admin_ids,
    require_event_permission,
    require_event_view_access,
    ticket_holder_ids,
)
from app.config import settings
from app.deps import CurrentUser, DbSession, OptionalUser
from app.enums import (
    CheckoutStatus,
    EventReportCategory,
    EventReportStatus,
    EventStatus,
    EventVisibility,
    NotificationType,
    OrderStatus,
    PaymentStatus,
    SeatingMode,
    StaffRole,
    SupportStatus,
    UserRole,
)
from app.errors import AppError
from app.models import (
    CheckoutLine,
    CheckoutSession,
    Event,
    EventInvitation,
    EventReport,
    Order,
    OrderItem,
    OrganizerProfile,
    Payment,
    SeatHold,
    StaffAssignment,
    SupportCase,
    TicketType,
    User,
    VenueSeat,
)
from app.routers.support import serialize_cases
from app.schemas import (
    ActivationSimulation,
    EventCreate,
    EventOut,
    EventUpdate,
    StaffAssignmentRequest,
    TicketTypeCreate,
    TicketTypeOut,
    TicketTypeUpdate,
)
from app.security import opaque_token, token_hash
from app.services import (
    create_notification,
    enqueue_email,
    put_private_object,
    record_audit,
    signed_download_url,
)

router = APIRouter(tags=["events"])

ALMATY_HALL_SECTIONS = (
    ("B", 8, 24),
    ("A", 12, 151),
    ("C", 8, 338),
)


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return f"{slug[:140]}-{secrets.token_hex(3)}"


def lifecycle_group(event: Event) -> str:
    """Time-based dashboard bucket.

    Only ``cancelled`` is status driven. Draft, unpublished and suspended events are
    deliberately bucketed by their dates so they stay reachable in the organizer
    dashboard; clients must read ``status`` for the publication state.
    """
    now = datetime.now(UTC)
    if event.status == EventStatus.CANCELLED:
        return "cancelled"
    if event.ends_at < now:
        return "completed"
    if event.starts_at <= now <= event.ends_at:
        return "active"
    return "upcoming"


def serialize_event(event: Event) -> EventOut:
    payload = EventOut.model_validate(event)
    payload.lifecycle_group = lifecycle_group(event)
    payload.image_url = signed_download_url(event.image_key, 3600) if event.image_key else None
    return payload


async def with_availability(db: DbSession, payload: EventOut) -> EventOut:
    """Fill each ticket type's remaining count for a single-event read."""
    ids = [item.id for item in payload.ticket_types]
    if not ids:
        return payload
    now = datetime.now(UTC)
    sold: dict[uuid.UUID, int] = {
        key: int(value)
        for key, value in (
            await db.execute(
                select(OrderItem.ticket_type_id, func.count())
                .join(Order)
                .where(
                    OrderItem.ticket_type_id.in_(ids),
                    Order.status.in_([OrderStatus.PAID, OrderStatus.FREE]),
                )
                .group_by(OrderItem.ticket_type_id)
            )
        ).all()
    }
    reserved: dict[uuid.UUID, int] = {
        key: int(value)
        for key, value in (
            await db.execute(
                select(CheckoutLine.ticket_type_id, func.coalesce(func.sum(CheckoutLine.quantity), 0))
                .join(CheckoutSession)
                .where(
                    CheckoutLine.ticket_type_id.in_(ids),
                    CheckoutSession.status == CheckoutStatus.OPEN,
                    CheckoutSession.expires_at > now,
                )
                .group_by(CheckoutLine.ticket_type_id)
            )
        ).all()
    }
    for item in payload.ticket_types:
        taken = sold.get(item.id, 0) + reserved.get(item.id, 0)
        item.available = max(item.quantity - taken, 0)
    return payload


def without_hidden_ticket_types(payload: EventOut) -> EventOut:
    """Attendee-facing view: hidden ticket types are only visible to event managers."""
    if isinstance(payload, EventOut):
        payload.ticket_types = [item for item in payload.ticket_types if not item.is_hidden]
    return payload


async def load_event(db: DbSession, event_id: uuid.UUID) -> Event:
    event = await db.scalar(
        select(Event).options(selectinload(Event.ticket_types)).where(Event.id == event_id)
    )
    if event is None:
        raise AppError(404, "event_not_found", "Event not found", "The event does not exist.")
    return event


def almaty_hall_seat_specs() -> list[dict[str, str | bool | int]]:
    specs: list[dict[str, str | bool | int]] = []
    for section, seats_per_row, x_start in ALMATY_HALL_SECTIONS:
        for row_index, row in enumerate("ABCDEF"):
            for number in range(1, seats_per_row + 1):
                accessible = row == "A" and number in {1, seats_per_row}
                premium = section == "A" and (row_index < 3 or (row == "D" and number in {6, 7}))
                category = "premium" if premium else "standard"
                if accessible:
                    category = "accessible"
                specs.append(
                    {
                        "section": section,
                        "row": row,
                        "number": str(number),
                        "price_category": category,
                        "is_accessible": accessible,
                        "x": x_start + (number - 1) * 15,
                        "y": 92 + row_index * 27,
                    }
                )
    return specs


async def seed_almaty_hall(db: DbSession, event: Event) -> None:
    current = (await db.scalars(select(VenueSeat).where(VenueSeat.event_id == event.id))).all()
    existing = {(seat.section, seat.row, seat.number): seat for seat in current}
    for spec in almaty_hall_seat_specs():
        key = (str(spec["section"]), str(spec["row"]), str(spec["number"]))
        seat = existing.get(key)
        if seat is None:
            db.add(
                VenueSeat(
                    event_id=event.id,
                    **spec,
                )
            )
            continue
        seat.price_category = str(spec["price_category"])
        seat.is_accessible = bool(spec["is_accessible"])
        seat.x = int(spec["x"])
        seat.y = int(spec["y"])


@router.get("/events", response_model=list[EventOut])
async def list_public_events(
    db: DbSession,
    q: str | None = None,
    city: str | None = None,
    category: str | None = None,
    starts_after: datetime | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    tz: str = "Asia/Almaty",
    limit: int = Query(default=30, ge=1, le=100),
) -> list[EventOut]:
    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise AppError(
            422, "invalid_timezone", "Invalid timezone", "Use a valid IANA timezone."
        ) from exc
    if date_from and date_to and date_from > date_to:
        raise AppError(
            422,
            "invalid_date_range",
            "Invalid date range",
            "Start date must not be after end date.",
        )
    statement = (
        select(Event)
        .options(selectinload(Event.ticket_types))
        .where(
            Event.status == EventStatus.PUBLISHED,
            Event.visibility == EventVisibility.PUBLIC,
            Event.ends_at >= datetime.now(UTC),
        )
        .limit(limit)
    )
    if q:
        term = q.strip()
        escaped = term.replace("/", "//").replace("%", "/%").replace("_", "/_")
        pattern = f"%{escaped}%"
        statement = statement.where(
            or_(
                Event.title.ilike(pattern, escape="/"),
                Event.description.ilike(pattern, escape="/"),
                Event.venue_name.ilike(pattern, escape="/"),
            )
        ).order_by(
            case(
                (func.lower(Event.title) == func.lower(term), 0),
                (Event.title.ilike(f"{escaped}%", escape="/"), 1),
                (Event.title.ilike(pattern, escape="/"), 2),
                else_=3,
            )
        )
    if city:
        statement = statement.where(Event.city == city)
    if category:
        statement = statement.where(Event.category == category)
    if starts_after:
        statement = statement.where(Event.starts_at > starts_after)
    # Calendar dates are inclusive and resolved in the caller's timezone (default Asia/Almaty).
    if date_from:
        statement = statement.where(
            Event.starts_at >= datetime.combine(date_from, time.min, zone).astimezone(UTC)
        )
    if date_to:
        day_after = datetime.combine(date_to + timedelta(days=1), time.min, zone)
        statement = statement.where(Event.starts_at < day_after.astimezone(UTC))
    statement = statement.order_by(Event.starts_at, Event.id)
    events = (await db.scalars(statement)).unique().all()
    return [without_hidden_ticket_types(serialize_event(event)) for event in events]


@router.get("/events/slug/{slug}", response_model=EventOut)
async def event_by_slug(slug: str, db: DbSession) -> EventOut:
    event = await db.scalar(
        select(Event).options(selectinload(Event.ticket_types)).where(Event.slug == slug)
    )
    if event is None or event.status not in {EventStatus.PUBLISHED, EventStatus.CANCELLED}:
        raise AppError(404, "event_not_found", "Event not found", "The event is unavailable.")
    if event.visibility == EventVisibility.PRIVATE:
        raise AppError(
            403, "invitation_required", "Invitation required", "Open your invitation link."
        )
    return await with_availability(db, without_hidden_ticket_types(serialize_event(event)))


@router.get("/events/{event_id}", response_model=EventOut)
async def event_detail(event_id: uuid.UUID, db: DbSession, user: OptionalUser) -> EventOut:
    event = await load_event(db, event_id)
    await require_event_view_access(db, event, user)
    if await can_manage_event(db, event, user):
        return await with_availability(db, serialize_event(event))
    return await with_availability(db, without_hidden_ticket_types(serialize_event(event)))


@router.get("/organizer/events", response_model=list[EventOut])
async def organizer_events(user: CurrentUser, db: DbSession) -> list[EventOut]:
    owned = select(Event.id).where(Event.owner_id == user.id)
    assigned = select(StaffAssignment.event_id).where(StaffAssignment.user_id == user.id)
    events = (
        (
            await db.scalars(
                select(Event)
                .options(selectinload(Event.ticket_types))
                .where(or_(Event.id.in_(owned), Event.id.in_(assigned)))
                .order_by(Event.starts_at.desc())
            )
        )
        .unique()
        .all()
    )
    return [serialize_event(event) for event in events]


@router.post("/events", response_model=EventOut, status_code=201)
async def create_event(payload: EventCreate, user: CurrentUser, db: DbSession) -> EventOut:
    if UserRole.ORGANIZER.value not in user.roles:
        raise AppError(
            403,
            "organizer_profile_required",
            "Organizer profile required",
            "Create an organizer profile before creating an event.",
        )
    event_data = payload.model_dump()
    if payload.seating_mode == SeatingMode.ASSIGNED:
        event_data["capacity"] = 168
    event = Event(owner_id=user.id, slug=slugify(payload.title), **event_data)
    db.add(event)
    await db.flush()
    if event.seating_mode == SeatingMode.ASSIGNED:
        await seed_almaty_hall(db, event)
    await record_audit(
        db,
        action="event.created",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Created draft event {event.title}.",
    )
    await db.commit()
    return serialize_event(await load_event(db, event.id))


@router.patch("/events/{event_id}", response_model=EventOut)
async def update_event(
    event_id: uuid.UUID, payload: EventUpdate, user: CurrentUser, db: DbSession
) -> EventOut:
    event = await load_event(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    changes = payload.model_dump(exclude_unset=True)
    starts_at = changes.get("starts_at", event.starts_at)
    ends_at = changes.get("ends_at", event.ends_at)
    if ends_at <= starts_at:
        raise AppError(422, "invalid_event_dates", "Invalid dates", "End must follow start.")
    registration_opens_at = changes.get("registration_opens_at", event.registration_opens_at)
    registration_closes_at = changes.get("registration_closes_at", event.registration_closes_at)
    if (
        registration_opens_at
        and registration_closes_at
        and registration_closes_at <= registration_opens_at
    ):
        raise AppError(
            422,
            "invalid_registration_dates",
            "Invalid registration dates",
            "Registration closing time must follow its opening time.",
        )
    existing_orders = await db.scalar(
        select(func.count()).select_from(Order).where(Order.event_id == event.id)
    )
    if (
        "seating_mode" in changes
        and changes["seating_mode"] != event.seating_mode
        and existing_orders
    ):
        raise AppError(
            409,
            "seating_locked",
            "Seating cannot be changed",
            "The event already has orders.",
        )
    if changes.get("seating_mode") == SeatingMode.ASSIGNED:
        changes["capacity"] = 168
    if "capacity" in changes:
        configured_inventory = await db.scalar(
            select(func.coalesce(func.sum(TicketType.quantity), 0)).where(
                TicketType.event_id == event.id
            )
        )
        if changes["capacity"] < (configured_inventory or 0):
            raise AppError(
                409,
                "capacity_below_inventory",
                "Capacity too small",
                "Capacity cannot be below configured ticket inventory.",
            )
    for field, value in changes.items():
        setattr(event, field, value)
    event.calendar_sequence += 1
    if changes.get("seating_mode") == SeatingMode.ASSIGNED:
        await seed_almaty_hall(db, event)
    await record_audit(
        db,
        action="event.updated",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor_user_id=user.id,
        description="Updated event configuration.",
        data={"fields": sorted(changes)},
    )
    attendee_emails: list[str] = []
    if event.status == EventStatus.PUBLISHED and changes:
        attendees = (
            await db.execute(
                select(User.id, User.email)
                .join(Order, Order.user_id == User.id)
                .where(
                    Order.event_id == event.id,
                    Order.status.in_([OrderStatus.PAID, OrderStatus.FREE]),
                )
                .distinct()
            )
        ).all()
        for attendee_id, attendee_email in attendees:
            await create_notification(
                db,
                user_id=attendee_id,
                type=NotificationType.EVENT_UPDATED,
                title=f"{event.title} was updated",
                body="Review the latest event date, time, and venue details.",
                data={"event_id": str(event.id), "event_title": event.title},
            )
            attendee_emails.append(attendee_email)
    await db.commit()
    for attendee_email in attendee_emails:
        enqueue_email(
            attendee_email,
            f"Update for {event.title}",
            "Event details changed. Sign in to BiletFlow to review the latest information.",
        )
    return serialize_event(await load_event(db, event.id))


@router.post("/events/{event_id}/ticket-types", response_model=TicketTypeOut, status_code=201)
async def create_ticket_type(
    event_id: uuid.UUID, payload: TicketTypeCreate, user: CurrentUser, db: DbSession
) -> TicketType:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    configured_inventory = await db.scalar(
        select(func.coalesce(func.sum(TicketType.quantity), 0)).where(
            TicketType.event_id == event.id
        )
    )
    if (configured_inventory or 0) + payload.quantity > event.capacity:
        raise AppError(
            409,
            "capacity_exceeded",
            "Event capacity exceeded",
            "Reduce this ticket quantity or increase event capacity.",
        )
    ticket_type = TicketType(event_id=event.id, **payload.model_dump())
    db.add(ticket_type)
    await db.flush()
    await record_audit(
        db,
        action="ticket_type.created",
        entity_type="ticket_type",
        entity_id=ticket_type.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Created ticket type {ticket_type.name}.",
    )
    await db.commit()
    return ticket_type


@router.patch("/events/{event_id}/ticket-types/{ticket_type_id}", response_model=TicketTypeOut)
async def update_ticket_type(
    event_id: uuid.UUID,
    ticket_type_id: uuid.UUID,
    payload: TicketTypeUpdate,
    user: CurrentUser,
    db: DbSession,
) -> TicketType:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    ticket_type = await db.scalar(
        select(TicketType)
        .where(
            TicketType.id == ticket_type_id,
            TicketType.event_id == event.id,
        )
        .with_for_update()
    )
    if ticket_type is None:
        raise AppError(
            404, "ticket_type_not_found", "Ticket not found", "The ticket type is unavailable."
        )
    changes = payload.model_dump(exclude_unset=True)
    sales_start_at = changes.get("sales_start_at", ticket_type.sales_start_at)
    sales_end_at = changes.get("sales_end_at", ticket_type.sales_end_at)
    if sales_start_at and sales_end_at and sales_end_at <= sales_start_at:
        raise AppError(
            422,
            "invalid_ticket_sales_dates",
            "Invalid sales dates",
            "Ticket sales end must follow the sales start.",
        )
    if "quantity" in changes:
        sold = await db.scalar(
            select(func.count())
            .select_from(OrderItem)
            .join(Order)
            .where(
                OrderItem.ticket_type_id == ticket_type.id,
                Order.status.in_([OrderStatus.PAID, OrderStatus.FREE]),
            )
        )
        if changes["quantity"] < (sold or 0):
            raise AppError(
                409,
                "inventory_below_sales",
                "Quantity too small",
                "Quantity cannot be below tickets already sold.",
            )
        other_inventory = await db.scalar(
            select(func.coalesce(func.sum(TicketType.quantity), 0)).where(
                TicketType.event_id == event.id,
                TicketType.id != ticket_type.id,
            )
        )
        if (other_inventory or 0) + changes["quantity"] > event.capacity:
            raise AppError(
                409,
                "capacity_exceeded",
                "Event capacity exceeded",
                "Reduce ticket quantity or increase event capacity.",
            )
    for field, value in changes.items():
        setattr(ticket_type, field, value)
    await record_audit(
        db,
        action="ticket_type.updated",
        entity_type="ticket_type",
        entity_id=ticket_type.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Updated ticket type {ticket_type.name}.",
        data={"fields": sorted(changes)},
    )
    await db.commit()
    return ticket_type


@router.post("/events/{event_id}/image", status_code=201)
async def upload_event_image(
    event_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    media_type = file.content_type or "application/octet-stream"
    signatures = {
        "image/jpeg": (b"\xff\xd8\xff", "jpg"),
        "image/png": (b"\x89PNG\r\n\x1a\n", "png"),
    }
    expected = signatures.get(media_type)
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise AppError(413, "image_too_large", "Image too large", "The maximum size is 10 MB.")
    if not expected or not content.startswith(expected[0]):
        raise AppError(415, "image_type_invalid", "Unsupported image", "Upload JPEG or PNG.")
    key = f"events/{event.id}/{secrets.token_hex(16)}.{expected[1]}"
    put_private_object(key, content, media_type)
    event.image_key = key
    await record_audit(
        db,
        action="event.image_updated",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor_user_id=user.id,
        description="Updated the event cover image.",
    )
    await db.commit()
    return {"image_url": signed_download_url(key, 3600)}


def require_not_moderated(event: Event) -> None:
    """Organizers cannot change publication while an admin suspension or cancellation holds."""
    if event.status == EventStatus.SUSPENDED:
        raise AppError(
            409,
            "event_suspended",
            "Event suspended",
            "A platform administrator suspended this event. Contact platform support.",
        )
    if event.status == EventStatus.CANCELLED:
        raise AppError(
            409, "event_cancelled", "Event cancelled", "A cancelled event cannot be changed."
        )


@router.post("/events/{event_id}/publish", response_model=EventOut)
async def publish_event(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> EventOut:
    event = await load_event(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    if not user.is_email_verified:
        raise AppError(409, "email_not_verified", "Verify email", "Email verification is required.")
    if not event.ticket_types:
        raise AppError(
            409, "ticket_type_required", "Ticket required", "Create a ticket type first."
        )
    require_not_moderated(event)
    event.status = EventStatus.PUBLISHED
    await record_audit(
        db,
        action="event.published",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor_user_id=user.id,
        description="Published event.",
    )
    await db.commit()
    return serialize_event(event)


@router.post("/events/{event_id}/unpublish", response_model=EventOut)
async def unpublish_event(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> EventOut:
    event = await load_event(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    require_not_moderated(event)
    was_published = event.status == EventStatus.PUBLISHED
    event.status = EventStatus.UNPUBLISHED
    await record_audit(
        db,
        action="event.unpublished",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor_user_id=user.id,
        description="Unpublished event.",
    )
    if was_published:
        for holder_id in await ticket_holder_ids(db, event.id):
            await create_notification(
                db,
                user_id=holder_id,
                type=NotificationType.EVENT_UPDATED,
                title=f"{event.title} is temporarily unavailable",
                body="The organizer unpublished this event. Your tickets remain in your account.",
                data=event_change_data(event, "unpublished"),
            )
    await db.commit()
    return serialize_event(event)


ACTIVATION_REQUIREMENTS: tuple[tuple[str, str, int, str, str], ...] = (
    # key, error code, HTTP status, title, detail
    (
        "paid_ticket_type",
        "paid_ticket_required",
        409,
        "Paid ticket required",
        "Create a paid ticket type.",
    ),
    (
        "organizer_profile",
        "organizer_profile_required",
        409,
        "Profile required",
        "Complete the organizer profile.",
    ),
    (
        "email_verified",
        "email_not_verified",
        409,
        "Verify email",
        "The event owner must verify their email address.",
    ),
    (
        "identity_verified",
        "identity_verification_required",
        409,
        "Identity verification required",
        "Complete the simulated organizer identity verification.",
    ),
    (
        "payout_account",
        "payout_account_required",
        409,
        "Payout account required",
        "Add the demonstrative payout account to the organizer profile.",
    ),
    (
        "payout_verified",
        "payout_verification_required",
        409,
        "Payout verification required",
        "Complete the simulated payout account verification.",
    ),
    (
        "terms_accepted",
        "terms_acceptance_required",
        422,
        "Accept the terms",
        "Accept the paid-sales terms to continue.",
    ),
)


def activation_checklist(
    *,
    event: Event,
    owner: User | None,
    profile: OrganizerProfile | None,
    has_paid_ticket_type: bool,
    terms_accepted: bool | None = None,
) -> list[dict]:
    """Every paid-sales activation requirement with its current state.

    ``terms_accepted`` overrides the stored flag while a request that carries a fresh
    acceptance is being evaluated.
    """
    state = {
        "paid_ticket_type": has_paid_ticket_type,
        "organizer_profile": profile is not None,
        "email_verified": bool(owner and owner.is_email_verified),
        "identity_verified": bool(profile and profile.identity_verified),
        "payout_account": bool(profile and (profile.payout_account_label or "").strip()),
        "payout_verified": bool(
            profile and (profile.payout_account_label or "").strip() and profile.payout_verified
        ),
        "terms_accepted": bool(
            event.terms_accepted if terms_accepted is None else terms_accepted
        ),
    }
    items = [
        {"key": key, "done": state[key], "error_code": code}
        for key, code, _status, _title, _detail in ACTIVATION_REQUIREMENTS
    ]
    items.append(
        {
            "key": "activation_fee_paid",
            "done": bool(event.activation_paid),
            "error_code": "activation_fee_unpaid",
        }
    )
    return items


def first_missing_requirement(checklist: list[dict]) -> AppError | None:
    """The stable error for the first unmet prerequisite (the fee itself is not one)."""
    done = {item["key"]: item["done"] for item in checklist}
    for key, code, status, title, detail in ACTIVATION_REQUIREMENTS:
        if not done.get(key):
            return AppError(status, code, title, detail)
    return None


async def activation_context(
    db: DbSession, event: Event
) -> tuple[User | None, OrganizerProfile | None, bool]:
    owner = await db.get(User, event.owner_id)
    profile = await db.scalar(
        select(OrganizerProfile).where(OrganizerProfile.user_id == event.owner_id)
    )
    paid_type = await db.scalar(
        select(TicketType.id)
        .where(TicketType.event_id == event.id, TicketType.price_tiyin > 0)
        .limit(1)
    )
    return owner, profile, bool(paid_type)


@router.get("/events/{event_id}/activation")
async def activation_status(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    owner, profile, has_paid_type = await activation_context(db, event)
    checklist = activation_checklist(
        event=event, owner=owner, profile=profile, has_paid_ticket_type=has_paid_type
    )
    fee, _setting = await activation_fee_setting(db)
    rows = (
        await db.execute(
            select(Payment, User)
            .join(User, User.id == Payment.user_id)
            .where(Payment.event_id == event.id, Payment.kind == "event_activation")
            .order_by(Payment.created_at.desc())
            .limit(50)
        )
    ).all()
    prerequisites = [
        item for item in checklist if item["key"] not in {"terms_accepted", "activation_fee_paid"}
    ]
    return {
        "event_id": str(event.id),
        "event_status": event.status,
        "mode": "DEMONSTRATION_ONLY",
        "activation_fee_tiyin": fee,
        "activation_paid": event.activation_paid,
        "terms_accepted": event.terms_accepted,
        "paid_sales_active": event.paid_sales_active,
        "paid_sales_suspended": event.paid_sales_suspended,
        "paid_sales_suspension_reason": event.paid_sales_suspension_reason,
        "suspension_reason": (
            event.suspension_reason if event.status == EventStatus.SUSPENDED else None
        ),
        "can_sell_paid_tickets": bool(
            event.paid_sales_active
            and not event.paid_sales_suspended
            and event.status == EventStatus.PUBLISHED
        ),
        "ready_for_payment": all(item["done"] for item in prerequisites)
        and not event.activation_paid,
        "checklist": checklist,
        "organizer": {
            "user_id": str(event.owner_id),
            "display_name": owner.display_name if owner else None,
            "email_verified": bool(owner and owner.is_email_verified),
            "organization_name": profile.organization_name if profile else None,
            "identity_verified": bool(profile and profile.identity_verified),
            "payout_account_label": profile.payout_account_label if profile else None,
            "payout_verified": bool(profile and profile.payout_verified),
        },
        "payments": [
            {
                "id": str(payment.id),
                "status": payment.status,
                "amount_tiyin": payment.amount_tiyin,
                "reference": payment.provider_reference,
                "failure_reason": payment.failure_reason,
                "created_at": payment.created_at,
                "paid_by": {"id": str(payer.id), "display_name": payer.display_name},
            }
            for payment, payer in rows
        ],
    }


@router.post("/events/{event_id}/activation/simulate")
async def activate_paid_sales(
    event_id: uuid.UUID,
    payload: ActivationSimulation,
    user: CurrentUser,
    db: DbSession,
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    existing = await db.scalar(
        select(Payment).where(Payment.idempotency_key == payload.idempotency_key)
    )
    if existing:
        if (
            existing.event_id != event.id
            or existing.user_id != user.id
            or existing.kind != "event_activation"
        ):
            raise AppError(
                409,
                "idempotency_key_reused",
                "Request key already used",
                "Generate a new idempotency key for this activation.",
            )
        if existing.status in {PaymentStatus.FAILED, PaymentStatus.TIMED_OUT}:
            raise AppError(
                402,
                "demo_activation_payment_failed",
                "Activation payment failed",
                "Paid sales remain inactive.",
            )
        return {
            "paid_sales_active": existing.status == PaymentStatus.SUCCEEDED,
            "paid_sales_suspended": event.paid_sales_suspended,
            "activation_fee_tiyin": existing.amount_tiyin,
            "payment_status": existing.status,
            "payment_id": str(existing.id),
            "mode": "DEMONSTRATION_ONLY",
        }
    if event.status == EventStatus.CANCELLED:
        raise AppError(
            409, "event_cancelled", "Event cancelled", "A cancelled event cannot be activated."
        )
    if event.activation_paid:
        raise AppError(
            409,
            "activation_already_paid",
            "Already activated",
            "The activation fee for this event has already been paid.",
        )
    owner, profile, has_paid_type = await activation_context(db, event)
    missing = first_missing_requirement(
        activation_checklist(
            event=event,
            owner=owner,
            profile=profile,
            has_paid_ticket_type=has_paid_type,
            terms_accepted=payload.terms_accepted,
        )
    )
    if missing is not None:
        raise missing
    activation_fee, _setting = await activation_fee_setting(db)
    payment_status = {
        "success": PaymentStatus.SUCCEEDED,
        "failure": PaymentStatus.FAILED,
        "timeout": PaymentStatus.TIMED_OUT,
    }[payload.outcome]
    payment = Payment(
        event_id=event.id,
        user_id=user.id,
        kind="event_activation",
        status=payment_status,
        amount_tiyin=activation_fee,
        provider_reference=f"demo-activation-{secrets.token_hex(8)}",
        idempotency_key=payload.idempotency_key,
        failure_reason=None if payload.outcome == "success" else payload.outcome,
    )
    db.add(payment)
    await db.flush()
    # The terms were explicitly accepted with this request; keep that even if the
    # simulated payment fails so the checklist reflects it on the retry.
    event.terms_accepted = True
    recipients = {event.owner_id, user.id}
    if payload.outcome != "success":
        timed_out = payload.outcome == "timeout"
        await record_audit(
            db,
            action="paid_sales.activation_timed_out" if timed_out else "paid_sales.activation_failed",
            entity_type="payment",
            entity_id=payment.id,
            event_id=event.id,
            actor_user_id=user.id,
            description=(
                "Simulated activation payment timed out."
                if timed_out
                else "Simulated activation payment failed."
            ),
            data={"amount_tiyin": activation_fee, "outcome": payload.outcome},
        )
        for recipient_id in recipients:
            await create_notification(
                db,
                user_id=recipient_id,
                type=NotificationType.ACTIVATION_STATUS,
                title=f"Paid-sales activation failed for {event.title}",
                body="The demonstration activation payment did not complete. Paid sales remain inactive.",
                data=event_change_data(
                    event,
                    "activation_failed",
                    payload.outcome,
                    payment_id=str(payment.id),
                    payment_status=payment_status.value,
                    amount_tiyin=activation_fee,
                ),
            )
        await db.commit()
        raise AppError(
            402,
            "demo_activation_payment_failed",
            "Activation payment failed",
            "Paid sales remain inactive. Try the demonstration payment again.",
        )
    event.activation_paid = True
    event.paid_sales_active = True
    # An administrator's paid-sales suspension is deliberately left untouched.
    await record_audit(
        db,
        action="paid_sales.activated",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Completed simulated paid-sales activation ({activation_fee} tiyin).",
        data={"amount_tiyin": activation_fee, "payment_id": str(payment.id)},
    )
    for recipient_id in recipients:
        await create_notification(
            db,
            user_id=recipient_id,
            type=NotificationType.ACTIVATION_STATUS,
            title=f"Paid sales activated for {event.title}",
            body="The demonstration activation fee was received. Paid ticket sales are active.",
            data=event_change_data(
                event,
                "activation_succeeded",
                payment_id=str(payment.id),
                payment_status=payment_status.value,
                amount_tiyin=activation_fee,
            ),
        )
    await db.commit()
    return {
        "paid_sales_active": True,
        "paid_sales_suspended": event.paid_sales_suspended,
        "activation_fee_tiyin": activation_fee,
        "payment_status": payment.status,
        "payment_id": str(payment.id),
        "mode": "DEMONSTRATION_ONLY",
    }


def serialize_staff(assignment: StaffAssignment, staff_user: User, assigner: User | None) -> dict:
    return {
        "id": str(assignment.id),
        "user_id": str(staff_user.id),
        "email": staff_user.email,
        "display_name": staff_user.display_name,
        "role": assignment.role,
        "assigned_at": assignment.created_at,
        "assigned_by_id": str(assignment.assigned_by_id),
        "assigned_by_name": assigner.display_name if assigner else None,
    }


@router.post("/events/{event_id}/staff", status_code=201)
async def assign_staff(
    event_id: uuid.UUID, payload: StaffAssignmentRequest, user: CurrentUser, db: DbSession
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    staff_user = await db.scalar(select(User).where(User.email == payload.email.lower()))
    if staff_user is None:
        raise AppError(404, "user_not_found", "User not found", "Staff must register first.")
    existing = await db.scalar(
        select(StaffAssignment).where(
            StaffAssignment.event_id == event.id,
            StaffAssignment.user_id == staff_user.id,
            StaffAssignment.role == payload.role,
        )
    )
    if existing:
        assigner = await db.get(User, existing.assigned_by_id)
        return serialize_staff(existing, staff_user, assigner)
    assignment = StaffAssignment(
        event_id=event.id,
        user_id=staff_user.id,
        role=payload.role,
        assigned_by_id=user.id,
    )
    db.add(assignment)
    await db.flush()
    await record_audit(
        db,
        action="staff.assigned",
        entity_type="staff_assignment",
        entity_id=assignment.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Assigned {staff_user.email} as {payload.role.value}.",
        data={"user_id": str(staff_user.id), "role": payload.role.value},
    )
    if staff_user.id != user.id:
        await create_notification(
            db,
            user_id=staff_user.id,
            type=NotificationType.EVENT_UPDATED,
            title=f"You joined the team of {event.title}",
            body=f"You were assigned the {payload.role.value} role.",
            data=event_change_data(event, "staff_assigned", role=payload.role.value),
        )
    await db.commit()
    return serialize_staff(assignment, staff_user, user)


@router.get("/events/{event_id}/staff")
async def list_staff(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[dict]:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    rows = (
        await db.execute(
            select(StaffAssignment, User)
            .join(User, User.id == StaffAssignment.user_id)
            .where(StaffAssignment.event_id == event.id)
            .order_by(User.display_name, StaffAssignment.role)
        )
    ).all()
    assigner_ids = {assignment.assigned_by_id for assignment, _ in rows}
    assigners: dict[uuid.UUID, User] = {}
    if assigner_ids:
        assigners = {
            item.id: item
            for item in (await db.scalars(select(User).where(User.id.in_(assigner_ids)))).all()
        }
    return [
        serialize_staff(assignment, staff_user, assigners.get(assignment.assigned_by_id))
        for assignment, staff_user in rows
    ]


@router.delete("/events/{event_id}/staff/{assignment_id}")
async def remove_staff(
    event_id: uuid.UUID, assignment_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    assignment = await db.scalar(
        select(StaffAssignment).where(
            StaffAssignment.id == assignment_id, StaffAssignment.event_id == event.id
        )
    )
    if assignment is None:
        raise AppError(
            404,
            "staff_assignment_not_found",
            "Assignment not found",
            "The staff assignment does not exist.",
        )
    staff_user = await db.get(User, assignment.user_id)
    role = assignment.role
    # Cases assigned to someone who loses support access go back to the unassigned queue.
    remaining_support_roles = (
        await db.scalars(
            select(StaffAssignment.id).where(
                StaffAssignment.event_id == event.id,
                StaffAssignment.user_id == assignment.user_id,
                StaffAssignment.id != assignment.id,
                StaffAssignment.role.in_([StaffRole.SUPPORT, StaffRole.MANAGER]),
            )
        )
    ).all()
    if not remaining_support_roles and assignment.user_id != event.owner_id:
        open_cases = (
            await db.scalars(
                select(SupportCase).where(
                    SupportCase.event_id == event.id,
                    SupportCase.assignee_id == assignment.user_id,
                    SupportCase.status != SupportStatus.RESOLVED,
                )
            )
        ).all()
        for case in open_cases:
            case.assignee_id = None
    await db.delete(assignment)
    await record_audit(
        db,
        action="staff.removed",
        entity_type="staff_assignment",
        entity_id=assignment_id,
        event_id=event.id,
        actor_user_id=user.id,
        description=(
            f"Removed {staff_user.email if staff_user else 'a user'} from the {role.value} role."
        ),
        data={"user_id": str(assignment.user_id), "role": role.value},
    )
    if staff_user is not None and staff_user.id != user.id:
        await create_notification(
            db,
            user_id=staff_user.id,
            type=NotificationType.EVENT_UPDATED,
            title=f"Your role on {event.title} was removed",
            body=f"You no longer hold the {role.value} role.",
            data=event_change_data(event, "staff_removed", role=role.value),
        )
    await db.commit()
    return {"removed": True, "id": str(assignment_id)}


@router.post("/events/{event_id}/invitations", status_code=201)
async def invite_attendee(
    event_id: uuid.UUID, email: str, user: CurrentUser, db: DbSession
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    normalized = email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized) or len(normalized) > 320:
        raise AppError(422, "invalid_email", "Invalid email", "Enter a valid email address.")
    raw = opaque_token()
    invitation = await db.scalar(
        select(EventInvitation).where(
            EventInvitation.event_id == event.id, EventInvitation.email == normalized
        )
    )
    reissued = invitation is not None
    if invitation is None:
        invitation = EventInvitation(
            event_id=event.id,
            email=normalized,
            token_hash=token_hash(raw),
            expires_at=event.ends_at + timedelta(days=1),
        )
        db.add(invitation)
        await db.flush()
    else:
        # Re-inviting the same address issues a fresh link instead of failing.
        invitation.token_hash = token_hash(raw)
        invitation.expires_at = event.ends_at + timedelta(days=1)
    await record_audit(
        db,
        action="event.invitation_created",
        entity_type="event_invitation",
        entity_id=invitation.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=(
            "Re-issued a private-event invitation."
            if reissued
            else "Created a private-event invitation."
        ),
        data={"email": normalized, "reissued": reissued},
    )
    await db.commit()
    invitation_url = f"{settings.public_web_base_url}/invite/{raw}"
    enqueue_email(
        invitation.email,
        f"Invitation to {event.title}",
        f"You have been invited to {event.title}. Open this link to accept:\n\n{invitation_url}",
    )
    return {
        "invitation_id": str(invitation.id),
        "url": invitation_url,
        "email": invitation.email,
        "reissued": reissued,
    }


@router.get("/events/{event_id}/invitations")
async def list_invitations(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[dict]:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    items = (
        await db.scalars(
            select(EventInvitation)
            .where(EventInvitation.event_id == event.id)
            .order_by(EventInvitation.created_at.desc())
        )
    ).all()
    return [
        {
            "id": str(item.id),
            "email": item.email,
            "accepted": item.accepted_by_user_id is not None,
            "expires_at": item.expires_at,
            "created_at": item.created_at,
        }
        for item in items
    ]


@router.post("/invitations/{raw_token}/accept", response_model=EventOut)
async def accept_invitation(raw_token: str, user: CurrentUser, db: DbSession) -> EventOut:
    invitation = await db.scalar(
        select(EventInvitation)
        .where(EventInvitation.token_hash == token_hash(raw_token))
        .with_for_update()
    )
    if invitation is None or invitation.expires_at < datetime.now(UTC):
        raise AppError(
            404, "invitation_invalid", "Invitation unavailable", "Ask the organizer for a new link."
        )
    if invitation.email != user.email:
        raise AppError(
            403, "invitation_email_mismatch", "Wrong account", "Sign in with the invited email."
        )
    invitation.accepted_by_user_id = user.id
    event = await load_event(db, invitation.event_id)
    await record_audit(
        db,
        action="event.invitation_accepted",
        entity_type="event_invitation",
        entity_id=invitation.id,
        event_id=event.id,
        actor_user_id=user.id,
        description="Accepted private-event invitation.",
    )
    await db.commit()
    return serialize_event(event)


@router.get("/events/{event_id}/seats")
async def list_seats(event_id: uuid.UUID, db: DbSession, user: OptionalUser) -> list[dict]:
    event = await get_event_or_404(db, event_id)
    await require_event_view_access(db, event, user)
    if event.seating_mode != SeatingMode.ASSIGNED:
        return []
    now = datetime.now(UTC)
    held_ids = set(
        (await db.scalars(select(SeatHold.seat_id).where(SeatHold.expires_at > now))).all()
    )
    sold_ids = set(
        (
            await db.scalars(
                select(OrderItem.seat_id).join(Order).where(Order.event_id == event.id)
            )
        ).all()
    )
    seats = (
        await db.scalars(
            select(VenueSeat)
            .where(VenueSeat.event_id == event.id)
            .order_by(VenueSeat.section, VenueSeat.row, VenueSeat.number)
        )
    ).all()
    return [
        {
            "id": str(seat.id),
            "section": seat.section,
            "row": seat.row,
            "number": seat.number,
            "price_category": seat.price_category,
            "is_accessible": seat.is_accessible,
            "x": seat.x,
            "y": seat.y,
            "status": (
                "unavailable"
                if seat.is_unavailable
                else "sold"
                if seat.id in sold_ids
                else "held"
                if seat.id in held_ids
                else "available"
            ),
        }
        for seat in seats
    ]


@router.post("/events/{event_id}/duplicate", response_model=EventOut, status_code=201)
async def duplicate_event(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> EventOut:
    original = await load_event(db, event_id)
    await require_event_permission(db, original, user, {StaffRole.MANAGER})
    clone = Event(
        owner_id=user.id,
        slug=slugify(f"{original.title} copy"),
        title=f"{original.title} (Copy)",
        description=original.description,
        category=original.category,
        image_key=original.image_key,
        venue_name=original.venue_name,
        venue_address=original.venue_address,
        city=original.city,
        starts_at=original.starts_at + timedelta(days=30),
        ends_at=original.ends_at + timedelta(days=30),
        timezone=original.timezone,
        registration_opens_at=None,
        registration_closes_at=None,
        capacity=original.capacity,
        visibility=original.visibility,
        seating_mode=original.seating_mode,
        refund_policy=original.refund_policy,
        status=EventStatus.DRAFT,
    )
    db.add(clone)
    await db.flush()
    for item in original.ticket_types:
        db.add(
            TicketType(
                event_id=clone.id,
                name=item.name,
                description=item.description,
                price_tiyin=item.price_tiyin,
                quantity=item.quantity,
                max_per_order=item.max_per_order,
                is_hidden=item.is_hidden,
                price_category=item.price_category,
            )
        )
    if clone.seating_mode == SeatingMode.ASSIGNED:
        await seed_almaty_hall(db, clone)
    await record_audit(
        db,
        action="event.duplicated",
        entity_type="event",
        entity_id=clone.id,
        event_id=clone.id,
        actor_user_id=user.id,
        description=f"Duplicated configuration from {original.title}.",
        data={"source_event_id": str(original.id)},
    )
    await db.commit()
    return serialize_event(await load_event(db, clone.id))


class EventReportCreate(BaseModel):
    category: EventReportCategory
    details: str = Field(default="", max_length=4_000)

    @field_validator("details", mode="before")
    @classmethod
    def strip_details(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


def serialize_report(report: EventReport) -> dict:
    return {
        "id": str(report.id),
        "event_id": str(report.event_id),
        "category": report.category,
        "details": report.details,
        "status": report.status,
        "resolution_note": report.resolution_note,
        "resolved_at": report.resolved_at,
        "created_at": report.created_at,
    }


@router.post("/events/{event_id}/reports", status_code=201)
async def report_event(
    event_id: uuid.UUID, payload: EventReportCreate, user: CurrentUser, db: DbSession
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_view_access(db, event, user)
    if event.owner_id == user.id:
        raise AppError(
            409, "cannot_report_own_event", "Action rejected", "You cannot report your own event."
        )
    if payload.category == EventReportCategory.OTHER and len(payload.details) < 10:
        raise AppError(
            422,
            "report_details_required",
            "Details required",
            "Describe the problem in at least 10 characters.",
        )
    already_open = await db.scalar(
        select(EventReport.id).where(
            EventReport.event_id == event.id,
            EventReport.reporter_id == user.id,
            EventReport.status == EventReportStatus.OPEN,
        )
    )
    if already_open:
        raise AppError(
            409,
            "report_already_open",
            "Report already submitted",
            "Your earlier report for this event is still being reviewed.",
        )
    report = EventReport(
        event_id=event.id,
        reporter_id=user.id,
        category=payload.category,
        details=payload.details,
    )
    db.add(report)
    await db.flush()
    await record_audit(
        db,
        action="event.reported",
        entity_type="event_report",
        entity_id=report.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Reported event for {payload.category.value}.",
        data={"category": payload.category.value},
    )
    for admin_id in await platform_admin_ids(db):
        await create_notification(
            db,
            user_id=admin_id,
            type=NotificationType.EVENT_REPORT,
            title=f"New report for {event.title}",
            body=f"Category: {payload.category.value}.",
            data=event_change_data(
                event,
                "event_reported",
                report_id=str(report.id),
                category=payload.category.value,
            ),
        )
    await db.commit()
    return serialize_report(report)


@router.get("/events/{event_id}/reports/mine")
async def my_event_reports(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> list[dict]:
    reports = (
        await db.scalars(
            select(EventReport)
            .where(EventReport.event_id == event_id, EventReport.reporter_id == user.id)
            .order_by(EventReport.created_at.desc())
        )
    ).all()
    return [serialize_report(report) for report in reports]


@router.get("/events/{event_id}/support-cases")
async def event_support_cases(
    event_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    status: SupportStatus | None = None,
    escalated: bool | None = None,
) -> list[dict]:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.SUPPORT})
    statement = select(SupportCase).where(SupportCase.event_id == event.id)
    if status is not None:
        statement = statement.where(SupportCase.status == status)
    if escalated is not None:
        statement = statement.where(SupportCase.escalated.is_(escalated))
    cases = (await db.scalars(statement.order_by(SupportCase.updated_at.desc()).limit(200))).all()
    return await serialize_cases(db, list(cases))
