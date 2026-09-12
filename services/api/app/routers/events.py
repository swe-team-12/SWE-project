import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, File, Query, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.access import get_event_or_404, require_event_permission, require_event_view_access
from app.config import settings
from app.deps import CurrentUser, DbSession, OptionalUser
from app.enums import (
    EventStatus,
    EventVisibility,
    NotificationType,
    OrderStatus,
    PaymentStatus,
    SeatingMode,
    StaffRole,
    UserRole,
)
from app.errors import AppError
from app.models import (
    Event,
    EventInvitation,
    Order,
    OrderItem,
    OrganizerProfile,
    Payment,
    SeatHold,
    StaffAssignment,
    SystemSetting,
    TicketType,
    User,
    VenueSeat,
)
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
    limit: int = Query(default=30, ge=1, le=100),
) -> list[EventOut]:
    statement = (
        select(Event)
        .options(selectinload(Event.ticket_types))
        .where(
            Event.status == EventStatus.PUBLISHED,
            Event.visibility == EventVisibility.PUBLIC,
            Event.ends_at >= datetime.now(UTC),
        )
        .order_by(Event.starts_at, Event.id)
        .limit(limit)
    )
    if q:
        pattern = f"%{q.strip()}%"
        statement = statement.where(
            or_(
                Event.title.ilike(pattern),
                Event.description.ilike(pattern),
                Event.venue_name.ilike(pattern),
            )
        )
    if city:
        statement = statement.where(Event.city == city)
    if category:
        statement = statement.where(Event.category == category)
    if starts_after:
        statement = statement.where(Event.starts_at > starts_after)
    events = (await db.scalars(statement)).unique().all()
    return [serialize_event(event) for event in events]


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
    return serialize_event(event)


@router.get("/events/{event_id}", response_model=EventOut)
async def event_detail(event_id: uuid.UUID, db: DbSession, user: OptionalUser) -> EventOut:
    event = await load_event(db, event_id)
    await require_event_view_access(db, event, user)
    return serialize_event(event)


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
                data={"event_id": str(event.id)},
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
    await db.commit()
    return serialize_event(event)


@router.post("/events/{event_id}/activation/simulate")
async def activate_paid_sales(
    event_id: uuid.UUID,
    payload: ActivationSimulation,
    user: CurrentUser,
    db: DbSession,
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    profile = await db.scalar(
        select(OrganizerProfile).where(OrganizerProfile.user_id == event.owner_id)
    )
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
            "activation_fee_tiyin": existing.amount_tiyin,
            "payment_status": existing.status,
            "mode": "DEMONSTRATION_ONLY",
        }
    paid_type = await db.scalar(
        select(TicketType.id).where(TicketType.event_id == event.id, TicketType.price_tiyin > 0)
    )
    if not paid_type:
        raise AppError(
            409, "paid_ticket_required", "Paid ticket required", "Create a paid ticket type."
        )
    if profile is None:
        raise AppError(
            409, "organizer_profile_required", "Profile required", "Complete the profile."
        )
    owner = await db.get(User, event.owner_id)
    if owner is None or not owner.is_email_verified:
        raise AppError(409, "email_not_verified", "Verify email", "Email verification is required.")
    if not profile.payout_account_label:
        raise AppError(
            409,
            "payout_account_required",
            "Payout account required",
            "Add the demonstrative payout account to the organizer profile.",
        )
    if not payload.terms_accepted or not payload.organizer_verification_confirmed:
        raise AppError(
            422,
            "activation_confirmations_required",
            "Confirm activation requirements",
            "Accept the terms and complete simulated organizer verification.",
        )
    configured_fee = await db.scalar(
        select(SystemSetting).where(SystemSetting.key == "activation_fee_tiyin")
    )
    activation_fee = (
        int(configured_fee.value["amount_tiyin"])
        if configured_fee and "amount_tiyin" in configured_fee.value
        else settings.activation_fee_tiyin
    )
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
    if payload.outcome != "success":
        await db.commit()
        raise AppError(
            402,
            "demo_activation_payment_failed",
            "Activation payment failed",
            "Paid sales remain inactive. Try the demonstration payment again.",
        )
    profile.identity_verified = True
    if not profile.payout_account_label:
        profile.payout_account_label = "Demo payout account"
    profile.payout_verified = True
    event.terms_accepted = True
    event.activation_paid = True
    event.paid_sales_active = True
    event.paid_sales_suspended = False
    await record_audit(
        db,
        action="paid_sales.activated",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Completed simulated paid-sales activation ({activation_fee} tiyin).",
    )
    await db.commit()
    return {
        "paid_sales_active": True,
        "activation_fee_tiyin": activation_fee,
        "payment_status": payment.status,
        "mode": "DEMONSTRATION_ONLY",
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
        return {"id": str(existing.id), "role": existing.role, "user_id": str(staff_user.id)}
    assignment = StaffAssignment(
        event_id=event.id,
        user_id=staff_user.id,
        role=payload.role,
        assigned_by_id=user.id,
    )
    db.add(assignment)
    await db.commit()
    return {"id": str(assignment.id), "role": assignment.role, "user_id": str(staff_user.id)}


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
    return [
        {
            "id": str(assignment.id),
            "user_id": str(staff_user.id),
            "email": staff_user.email,
            "display_name": staff_user.display_name,
            "role": assignment.role,
        }
        for assignment, staff_user in rows
    ]


@router.post("/events/{event_id}/invitations", status_code=201)
async def invite_attendee(
    event_id: uuid.UUID, email: str, user: CurrentUser, db: DbSession
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    raw = opaque_token()
    invitation = EventInvitation(
        event_id=event.id,
        email=email.lower(),
        token_hash=token_hash(raw),
        expires_at=event.ends_at + timedelta(days=1),
    )
    db.add(invitation)
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
    }


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
