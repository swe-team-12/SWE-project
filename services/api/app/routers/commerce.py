import secrets
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Query
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.access import get_event_or_404, require_event_permission, require_event_view_access
from app.config import settings
from app.deps import CurrentUser, DbSession, OptionalUser
from app.documents import event_calendar_links, seat_label
from app.enums import (
    CheckInAction,
    CheckoutStatus,
    DiscountType,
    EventStatus,
    NotificationType,
    OrderStatus,
    PaymentStatus,
    SeatingMode,
    StaffRole,
    TicketStatus,
)
from app.errors import AppError
from app.models import (
    Campaign,
    CheckInRecord,
    CheckoutLine,
    CheckoutSession,
    Event,
    EventInvitation,
    Order,
    OrderItem,
    Payment,
    PromoRedemption,
    Refund,
    SeatHold,
    Ticket,
    TicketType,
    User,
    VenueSeat,
)
from app.schemas import (
    CampaignCreate,
    CampaignOut,
    CheckoutConfirm,
    CheckoutCreate,
    CheckoutOut,
)
from app.security import opaque_token
from app.services import create_notification, enqueue_email, enqueue_ticket_delivery, record_audit

router = APIRouter(tags=["commerce"])


def order_number() -> str:
    return f"BF-{datetime.now(UTC):%y%m%d}-{secrets.token_hex(3).upper()}"


def ticket_code() -> str:
    return f"TKT-{secrets.token_hex(5).upper()}"


def processing_fee(amount_tiyin: int) -> int:
    value = Decimal(amount_tiyin) * Decimal(settings.processor_fee_bps) / Decimal(10_000)
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


ACTIVE_ORDER_STATUSES = (OrderStatus.PAID, OrderStatus.FREE)
CLOSED_ORDER_STATUSES = (OrderStatus.REFUNDED, OrderStatus.CANCELLED)


async def release_order_seats(db: DbSession, order_id: uuid.UUID) -> None:
    """Return the seats of a refunded/cancelled order to sale.

    `order_items.seat_id` is a unique foreign key, so a closed order would block its
    seat forever. The section/row/seat_number text columns keep the history.
    """
    await db.execute(
        update(OrderItem)
        .where(OrderItem.order_id == order_id, OrderItem.seat_id.is_not(None))
        .values(seat_id=None)
        .execution_options(synchronize_session=False)
    )


async def release_closed_order_seats(db: DbSession, event_id: uuid.UUID | None = None) -> None:
    """Self-heal seats still attached to orders that were closed before seats were released."""
    closed_orders = select(Order.id).where(Order.status.in_(CLOSED_ORDER_STATUSES))
    if event_id:
        closed_orders = closed_orders.where(Order.event_id == event_id)
    await db.execute(
        update(OrderItem)
        .where(OrderItem.seat_id.is_not(None), OrderItem.order_id.in_(closed_orders))
        .values(seat_id=None)
        .execution_options(synchronize_session=False)
    )


async def expire_checkout_sessions(db: DbSession, event_id: uuid.UUID | None = None) -> int:
    now = datetime.now(UTC)
    await release_closed_order_seats(db, event_id)
    statement = select(CheckoutSession).where(
        CheckoutSession.status == CheckoutStatus.OPEN,
        CheckoutSession.expires_at <= now,
    )
    if event_id:
        statement = statement.where(CheckoutSession.event_id == event_id)
    sessions = (await db.scalars(statement.with_for_update())).all()
    if not sessions:
        return 0
    ids = [session.id for session in sessions]
    for session in sessions:
        session.status = CheckoutStatus.EXPIRED
    await db.execute(delete(SeatHold).where(SeatHold.session_id.in_(ids)))
    return len(sessions)


def campaign_state(campaign: Campaign, now: datetime, redeemed: int) -> str:
    """Stable campaign state: active, disabled, not_started, expired or exhausted."""
    if not campaign.is_enabled:
        return "disabled"
    if campaign.starts_at and campaign.starts_at > now:
        return "not_started"
    if campaign.ends_at and campaign.ends_at < now:
        return "expired"
    if campaign.max_redemptions is not None and redeemed >= campaign.max_redemptions:
        return "exhausted"
    return "active"


CAMPAIGN_STATE_CODES = {
    "active": None,
    "disabled": "promo_disabled",
    "not_started": "promo_not_started",
    "expired": "promo_expired",
    "exhausted": "promo_exhausted",
}


def campaign_public_url(campaign: Campaign) -> str:
    return f"{settings.public_web_base_url.rstrip('/')}/c/{campaign.opaque_token}"


async def _campaign_redemptions(db: DbSession, campaign_id: uuid.UUID) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(PromoRedemption)
            .where(PromoRedemption.campaign_id == campaign_id)
        )
    ) or 0


async def _campaign_for_code(
    db: DbSession, event_id: uuid.UUID, code: str | None, now: datetime
) -> Campaign | None:
    if not code:
        return None
    campaign = await db.scalar(
        select(Campaign)
        .where(func.upper(Campaign.code) == code.strip().upper(), Campaign.event_id == event_id)
        .with_for_update()
    )
    if campaign is None:
        raise AppError(422, "promo_invalid", "Invalid promo code", "This code is not valid.")
    if not campaign.is_enabled:
        raise AppError(422, "promo_disabled", "Promo disabled", "This promotion is disabled.")
    if campaign.starts_at and campaign.starts_at > now:
        raise AppError(
            422, "promo_not_started", "Promo unavailable", "This promotion has not started."
        )
    if campaign.ends_at and campaign.ends_at < now:
        raise AppError(422, "promo_expired", "Promo expired", "This promotion has expired.")
    if campaign.max_redemptions is not None:
        redeemed = await db.scalar(
            select(func.count())
            .select_from(PromoRedemption)
            .where(PromoRedemption.campaign_id == campaign.id)
        )
        reserved = await db.scalar(
            select(func.count())
            .select_from(CheckoutSession)
            .where(
                CheckoutSession.campaign_id == campaign.id,
                CheckoutSession.status == CheckoutStatus.OPEN,
                CheckoutSession.expires_at > now,
            )
        )
        if (redeemed or 0) + (reserved or 0) >= campaign.max_redemptions:
            raise AppError(422, "promo_exhausted", "Promo exhausted", "No redemptions remain.")
    return campaign


@router.post("/events/{event_id}/campaigns", response_model=CampaignOut, status_code=201)
async def create_campaign(
    event_id: uuid.UUID, payload: CampaignCreate, user: CurrentUser, db: DbSession
) -> CampaignOut:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    code = (payload.code or f"BF{secrets.token_hex(3)}").upper()
    existing = await db.scalar(select(Campaign.id).where(func.upper(Campaign.code) == code))
    if existing:
        raise AppError(409, "promo_code_exists", "Code already used", "Choose another promo code.")
    if payload.discount_type == DiscountType.PERCENTAGE and payload.discount_value > 100:
        raise AppError(422, "invalid_discount", "Invalid discount", "Percentage cannot exceed 100.")
    applicable_ids = set(payload.applicable_ticket_type_ids)
    if applicable_ids:
        valid_ids = set(
            (
                await db.scalars(
                    select(TicketType.id).where(
                        TicketType.event_id == event.id,
                        TicketType.id.in_(applicable_ids),
                    )
                )
            ).all()
        )
        if valid_ids != applicable_ids:
            raise AppError(
                422,
                "campaign_ticket_type_invalid",
                "Invalid ticket selection",
                "Every applicable ticket type must belong to this event.",
            )
    campaign = Campaign(
        event_id=event.id,
        created_by_id=user.id,
        opaque_token=opaque_token(24),
        applicable_ticket_type_ids=[str(item) for item in payload.applicable_ticket_type_ids],
        **payload.model_dump(exclude={"applicable_ticket_type_ids", "code"}),
        code=code,
    )
    db.add(campaign)
    await db.flush()
    await record_audit(
        db,
        action="campaign.created",
        entity_type="campaign",
        entity_id=campaign.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Created campaign {campaign.name}.",
    )
    await db.commit()
    result = CampaignOut.model_validate(campaign)
    result.campaign_url = campaign_public_url(campaign)
    result.state = campaign_state(campaign, datetime.now(UTC), 0)
    return result


@router.get("/campaigns/resolve/{opaque_token}")
async def resolve_campaign(opaque_token: str, db: DbSession, user: OptionalUser) -> dict:
    campaign = await db.scalar(select(Campaign).where(Campaign.opaque_token == opaque_token))
    if campaign is None:
        raise AppError(404, "campaign_not_found", "Campaign not found", "This link is unavailable.")
    event = await get_event_or_404(db, campaign.event_id)
    await require_event_view_access(db, event, user)
    redeemed = await _campaign_redemptions(db, campaign.id)
    state = campaign_state(campaign, datetime.now(UTC), redeemed)
    active = state == "active"
    return {
        "event_id": str(event.id),
        "event_slug": event.slug,
        "event_title": event.title,
        "campaign_id": str(campaign.id),
        "name": campaign.name,
        "state": state,
        "is_active": active,
        # `code` is the stable reason the discount cannot be used (null when active).
        "code": CAMPAIGN_STATE_CODES[state],
        # The promo code is only handed out while the campaign can really be redeemed.
        "promo_code": campaign.code if active else None,
        "discount_type": campaign.discount_type if active else None,
        "discount_value": campaign.discount_value if active else None,
        "starts_at": campaign.starts_at,
        "ends_at": campaign.ends_at,
        "max_redemptions": campaign.max_redemptions,
        "redemptions": redeemed,
        "redemptions_remaining": (
            max(0, campaign.max_redemptions - redeemed)
            if campaign.max_redemptions is not None
            else None
        ),
        "applicable_ticket_type_ids": list(campaign.applicable_ticket_type_ids or []),
    }


@router.get("/events/{event_id}/campaigns", response_model=list[CampaignOut])
async def list_campaigns(
    event_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[CampaignOut]:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    items = (
        await db.scalars(
            select(Campaign).where(Campaign.event_id == event.id).order_by(Campaign.created_at)
        )
    ).all()
    now = datetime.now(UTC)
    result: list[CampaignOut] = []
    for item in items:
        rows = (
            await db.execute(
                select(Order, PromoRedemption.discount_tiyin)
                .join(PromoRedemption, PromoRedemption.order_id == Order.id)
                .where(PromoRedemption.campaign_id == item.id)
            )
        ).all()
        active_order_ids = [
            order.id for order, _ in rows if order.status in ACTIVE_ORDER_STATUSES
        ]
        tickets_sold = 0
        if active_order_ids:
            tickets_sold = (
                await db.scalar(
                    select(func.count())
                    .select_from(OrderItem)
                    .where(OrderItem.order_id.in_(active_order_ids))
                )
            ) or 0
        output = CampaignOut.model_validate(item)
        output.campaign_url = campaign_public_url(item)
        output.state = campaign_state(item, now, len(rows))
        output.redemptions = len(rows)
        output.redemptions_remaining = (
            max(0, item.max_redemptions - len(rows)) if item.max_redemptions is not None else None
        )
        output.orders = len(active_order_ids)
        output.tickets_sold = tickets_sold
        output.gross_tiyin = sum(
            order.subtotal_tiyin for order, _ in rows if order.status in ACTIVE_ORDER_STATUSES
        )
        output.discount_tiyin = sum(
            discount for order, discount in rows if order.status in ACTIVE_ORDER_STATUSES
        )
        output.refunded_orders = sum(order.status in CLOSED_ORDER_STATUSES for order, _ in rows)
        result.append(output)
    return result


@router.patch("/campaigns/{campaign_id}/disable")
async def disable_campaign(campaign_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    campaign = await db.get(Campaign, campaign_id)
    if campaign is None:
        raise AppError(
            404, "campaign_not_found", "Campaign not found", "The campaign does not exist."
        )
    event = await get_event_or_404(db, campaign.event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    campaign.is_enabled = False
    await record_audit(
        db,
        action="campaign.disabled",
        entity_type="campaign",
        entity_id=campaign.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Disabled campaign {campaign.name}.",
    )
    await db.commit()
    return {"is_enabled": False}


async def _inventory_available(
    db: DbSession,
    ticket_type: TicketType,
    count: int,
    now: datetime,
    exclude_session_id: uuid.UUID | None = None,
) -> bool:
    """Whether `count` more tickets fit; callers must hold the event/ticket-type locks."""
    sold = await db.scalar(
        select(func.count())
        .select_from(OrderItem)
        .join(Order)
        .where(
            OrderItem.ticket_type_id == ticket_type.id,
            Order.status.in_([OrderStatus.PAID, OrderStatus.FREE]),
        )
    )
    reserved_query = (
        select(func.coalesce(func.sum(CheckoutLine.quantity), 0))
        .select_from(CheckoutLine)
        .join(CheckoutSession)
        .where(
            CheckoutLine.ticket_type_id == ticket_type.id,
            CheckoutSession.status == CheckoutStatus.OPEN,
            CheckoutSession.expires_at > now,
        )
    )
    if exclude_session_id is not None:
        reserved_query = reserved_query.where(CheckoutSession.id != exclude_session_id)
    reserved = await db.scalar(reserved_query)
    return (sold or 0) + (reserved or 0) + count <= ticket_type.quantity


@router.post("/checkout/sessions", response_model=CheckoutOut, status_code=201)
async def create_checkout(
    payload: CheckoutCreate, user: CurrentUser, db: DbSession
) -> CheckoutSession:
    if not user.is_email_verified:
        raise AppError(
            403, "email_not_verified", "Verify email", "Verify your account before checkout."
        )
    existing = await db.scalar(
        select(CheckoutSession).where(
            CheckoutSession.user_id == user.id,
            CheckoutSession.idempotency_key == payload.idempotency_key,
        )
    )
    if existing:
        if existing.event_id != payload.event_id:
            raise AppError(
                409,
                "idempotency_key_reused",
                "Request key already used",
                "Generate a new idempotency key for this checkout.",
            )
        return existing
    event = await db.scalar(select(Event).where(Event.id == payload.event_id).with_for_update())
    if event is None:
        raise AppError(404, "event_not_found", "Event not found", "The event does not exist.")
    now = datetime.now(UTC)
    if event.status != EventStatus.PUBLISHED:
        raise AppError(
            409, "sales_unavailable", "Sales unavailable", "This event is not selling tickets."
        )
    if event.visibility.value == "private":
        invited = await db.scalar(
            select(EventInvitation.id).where(
                EventInvitation.event_id == event.id,
                EventInvitation.email == user.email,
                EventInvitation.accepted_by_user_id == user.id,
            )
        )
        if event.owner_id != user.id and not invited:
            raise AppError(
                403,
                "invitation_required",
                "Invitation required",
                "Accept the event invitation first.",
            )
    if event.registration_opens_at and event.registration_opens_at > now:
        raise AppError(
            409, "registration_not_open", "Registration closed", "Registration has not opened."
        )
    if event.registration_closes_at and event.registration_closes_at < now:
        raise AppError(
            409, "registration_closed", "Registration closed", "Registration has closed."
        )
    await expire_checkout_sessions(db, event.id)
    campaign = await _campaign_for_code(db, event.id, payload.promo_code, now)
    session = CheckoutSession(
        user_id=user.id,
        event_id=event.id,
        campaign_id=campaign.id if campaign else None,
        expires_at=now + timedelta(minutes=settings.checkout_hold_minutes),
        idempotency_key=payload.idempotency_key,
    )
    db.add(session)
    await db.flush()

    requested_by_type: dict[uuid.UUID, int] = defaultdict(int)
    requested_seats: set[uuid.UUID] = set()
    for requested in payload.lines:
        requested_by_type[requested.ticket_type_id] += requested.quantity
        if requested.seat_id is not None:
            if requested.seat_id in requested_seats:
                raise AppError(
                    422, "duplicate_seat", "Seat selected twice", "Choose each seat only once."
                )
            requested_seats.add(requested.seat_id)

    subtotal = 0
    applicable_subtotal = 0
    for ticket_type_id, count in requested_by_type.items():
        ticket_type = await db.scalar(
            select(TicketType)
            .where(TicketType.id == ticket_type_id, TicketType.event_id == event.id)
            .with_for_update()
        )
        if ticket_type is None or ticket_type.is_hidden:
            raise AppError(
                422, "ticket_type_unavailable", "Ticket unavailable", "Choose another ticket."
            )
        if count > ticket_type.max_per_order:
            raise AppError(
                422, "order_limit_exceeded", "Order limit exceeded", "Reduce the quantity."
            )
        if ticket_type.sales_start_at and ticket_type.sales_start_at > now:
            raise AppError(
                409, "ticket_sales_not_started", "Ticket unavailable", "Sales have not started."
            )
        if ticket_type.sales_end_at and ticket_type.sales_end_at < now:
            raise AppError(409, "ticket_sales_ended", "Ticket unavailable", "Sales have ended.")
        if ticket_type.price_tiyin > 0 and event.paid_sales_suspended:
            # Only paid lines are blocked: free registration keeps working.
            raise AppError(
                409,
                "paid_sales_suspended",
                "Paid sales suspended",
                "Paid tickets are temporarily unavailable for this event.",
            )
        if ticket_type.price_tiyin > 0 and not event.paid_sales_active:
            raise AppError(
                409,
                "paid_sales_not_activated",
                "Paid sales unavailable",
                "The organizer must activate paid sales.",
            )
        if not await _inventory_available(db, ticket_type, count, now):
            raise AppError(409, "inventory_exhausted", "Sold out", "Not enough tickets remain.")

    for requested in payload.lines:
        ticket_type = await db.get(TicketType, requested.ticket_type_id)
        assert ticket_type is not None
        if event.seating_mode == SeatingMode.ASSIGNED:
            if requested.quantity != 1 or requested.seat_id is None:
                raise AppError(422, "seat_required", "Seat required", "Choose one seat per ticket.")
            seat = await db.scalar(
                select(VenueSeat)
                .where(VenueSeat.id == requested.seat_id, VenueSeat.event_id == event.id)
                .with_for_update()
            )
            if seat is None or seat.is_unavailable:
                raise AppError(409, "seat_unavailable", "Seat unavailable", "Choose another seat.")
            if ticket_type.price_category and ticket_type.price_category != seat.price_category:
                raise AppError(
                    422, "seat_price_mismatch", "Wrong ticket category", "Choose a matching ticket."
                )
            sold_seat = await db.scalar(select(OrderItem.id).where(OrderItem.seat_id == seat.id))
            held_seat = await db.scalar(select(SeatHold.id).where(SeatHold.seat_id == seat.id))
            if sold_seat or held_seat:
                raise AppError(
                    409, "seat_unavailable", "Seat unavailable", "Another attendee selected it."
                )
            db.add(SeatHold(session_id=session.id, seat_id=seat.id, expires_at=session.expires_at))
        elif requested.seat_id is not None:
            raise AppError(
                422, "seat_not_allowed", "Seat not applicable", "This event is general admission."
            )
        line_subtotal = ticket_type.price_tiyin * requested.quantity
        subtotal += line_subtotal
        if (
            not campaign
            or not campaign.applicable_ticket_type_ids
            or str(ticket_type.id) in campaign.applicable_ticket_type_ids
        ):
            applicable_subtotal += line_subtotal
        db.add(
            CheckoutLine(
                session_id=session.id,
                ticket_type_id=ticket_type.id,
                seat_id=requested.seat_id,
                quantity=requested.quantity,
                unit_price_tiyin=ticket_type.price_tiyin,
                attendee_name=requested.attendee_name.strip(),
                attendee_email=requested.attendee_email.lower(),
            )
        )

    discount = 0
    if campaign:
        if campaign.applicable_ticket_type_ids and applicable_subtotal == 0:
            raise AppError(
                422, "promo_inapplicable", "Promo not applicable", "Choose an eligible ticket."
            )
        if campaign.discount_type == DiscountType.PERCENTAGE:
            discount = int(
                (
                    Decimal(applicable_subtotal) * Decimal(campaign.discount_value) / Decimal(100)
                ).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
            )
        else:
            # Fixed discounts use KZT minor units, like every other stored money value.
            discount = min(campaign.discount_value, applicable_subtotal)
    total = max(0, subtotal - discount)
    session.subtotal_tiyin = subtotal
    session.discount_tiyin = discount
    session.total_tiyin = total
    session.processing_fee_tiyin = processing_fee(total)
    await record_audit(
        db,
        action="checkout.started",
        entity_type="checkout_session",
        entity_id=session.id,
        event_id=event.id,
        actor_user_id=user.id,
        description="Reserved inventory for checkout.",
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise AppError(409, "reservation_conflict", "Reservation conflict", "Try again.") from exc
    return session


@router.get("/checkout/sessions/{session_id}", response_model=CheckoutOut)
async def get_checkout(session_id: uuid.UUID, user: CurrentUser, db: DbSession) -> CheckoutSession:
    session = await db.scalar(
        select(CheckoutSession).where(
            CheckoutSession.id == session_id, CheckoutSession.user_id == user.id
        )
    )
    if session is None:
        raise AppError(404, "checkout_not_found", "Checkout not found", "Start checkout again.")
    if session.status == CheckoutStatus.OPEN and session.expires_at <= datetime.now(UTC):
        await expire_checkout_sessions(db, session.event_id)
        await db.commit()
        session.status = CheckoutStatus.EXPIRED
    return session


@router.post("/checkout/sessions/{session_id}/abandon", response_model=CheckoutOut)
async def abandon_checkout(
    session_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> CheckoutSession:
    """Release the seat holds and reserved inventory of an unpaid checkout right away.

    Idempotent: abandoning an already closed (expired/failed/abandoned) session
    returns it unchanged. A completed checkout cannot be abandoned.
    """
    session_event_id = await db.scalar(
        select(CheckoutSession.event_id).where(
            CheckoutSession.id == session_id, CheckoutSession.user_id == user.id
        )
    )
    if session_event_id is None:
        raise AppError(404, "checkout_not_found", "Checkout not found", "Start checkout again.")
    # Same lock order as create/confirm: event first, then the session.
    await db.scalar(select(Event.id).where(Event.id == session_event_id).with_for_update())
    session = await db.scalar(
        select(CheckoutSession)
        .where(CheckoutSession.id == session_id, CheckoutSession.user_id == user.id)
        .with_for_update()
    )
    if session is None:
        raise AppError(404, "checkout_not_found", "Checkout not found", "Start checkout again.")
    if session.status == CheckoutStatus.COMPLETED:
        raise AppError(
            409,
            "checkout_completed",
            "Checkout already completed",
            "This checkout already produced an order.",
        )
    if session.status != CheckoutStatus.OPEN:
        return session
    now = datetime.now(UTC)
    # A closed session no longer counts as reserved inventory or as a promo reservation.
    session.status = CheckoutStatus.EXPIRED
    if session.expires_at > now:
        session.expires_at = now
    await db.execute(delete(SeatHold).where(SeatHold.session_id == session.id))
    await record_audit(
        db,
        action="checkout.abandoned",
        entity_type="checkout_session",
        entity_id=session.id,
        event_id=session.event_id,
        actor_user_id=user.id,
        description="Abandoned checkout; released held seats and inventory.",
    )
    await db.commit()
    return session


@router.post("/checkout/sessions/{session_id}/confirm")
async def confirm_checkout(
    session_id: uuid.UUID, payload: CheckoutConfirm, user: CurrentUser, db: DbSession
) -> dict:
    session_event_id = await db.scalar(
        select(CheckoutSession.event_id).where(
            CheckoutSession.id == session_id, CheckoutSession.user_id == user.id
        )
    )
    if session_event_id is None:
        raise AppError(404, "checkout_not_found", "Checkout not found", "Start checkout again.")
    # Lock the event before the session (same order as create_checkout) so concurrent
    # reservations and confirmations for one event serialize instead of deadlocking.
    event = await db.scalar(select(Event).where(Event.id == session_event_id).with_for_update())
    assert event is not None
    session = await db.scalar(
        select(CheckoutSession)
        .options(selectinload(CheckoutSession.lines))
        .where(CheckoutSession.id == session_id, CheckoutSession.user_id == user.id)
        .with_for_update()
    )
    if session is None:
        raise AppError(404, "checkout_not_found", "Checkout not found", "Start checkout again.")
    existing_order = await db.scalar(
        select(Order).where(Order.checkout_session_id == session.id)
    )
    if existing_order is not None:
        return {
            "order_id": str(existing_order.id),
            "order_number": existing_order.order_number,
            "status": existing_order.status,
        }
    existing_payment = await db.scalar(
        select(Payment).where(Payment.idempotency_key == payload.idempotency_key)
    )
    if existing_payment:
        if existing_payment.user_id != user.id or existing_payment.event_id != session.event_id:
            raise AppError(
                409,
                "idempotency_key_reused",
                "Request key already used",
                "Generate a new idempotency key for this payment.",
            )
        if existing_payment.order_id:
            order = await db.get(Order, existing_payment.order_id)
            if order is None:
                raise AppError(409, "payment_order_missing", "Order unavailable", "Contact support.")
            return {
                "order_id": str(order.id),
                "order_number": order.order_number,
                "status": order.status,
            }
        if existing_payment.status in {PaymentStatus.FAILED, PaymentStatus.TIMED_OUT}:
            raise AppError(
                402,
                "demo_payment_failed",
                "Payment failed",
                "No ticket was issued.",
            )
        raise AppError(
            409,
            "payment_incomplete",
            "Payment incomplete",
            "Start checkout again or contact support.",
        )
    now = datetime.now(UTC)
    if session.status != CheckoutStatus.OPEN or session.expires_at <= now:
        await expire_checkout_sessions(db, session.event_id)
        await db.commit()
        raise AppError(409, "checkout_expired", "Checkout expired", "Start checkout again.")
    if event.status != EventStatus.PUBLISHED:
        raise AppError(
            409, "sales_unavailable", "Sales unavailable", "The event cannot accept orders."
        )
    if event.paid_sales_suspended and any(
        (line.unit_price_tiyin or 0) > 0 for line in session.lines
    ):
        raise AppError(
            409,
            "paid_sales_suspended",
            "Paid sales suspended",
            "Paid tickets are temporarily unavailable for this event.",
        )
    if payload.outcome != "success":
        status = PaymentStatus.FAILED if payload.outcome == "failure" else PaymentStatus.TIMED_OUT
        failed_payment = Payment(
            event_id=event.id,
            user_id=user.id,
            status=status,
            amount_tiyin=session.total_tiyin,
            provider_reference=f"demo-{secrets.token_hex(8)}",
            idempotency_key=payload.idempotency_key,
            failure_reason=payload.outcome,
        )
        db.add(failed_payment)
        await db.flush()
        session.status = CheckoutStatus.FAILED
        await db.execute(delete(SeatHold).where(SeatHold.session_id == session.id))
        timed_out = status == PaymentStatus.TIMED_OUT
        await create_notification(
            db,
            user_id=user.id,
            type=NotificationType.PAYMENT_FAILED,
            title=(
                "Demonstration payment timed out" if timed_out else "Demonstration payment failed"
            ),
            body="No ticket was issued. Start checkout again.",
            data={
                "event_id": str(event.id),
                "event_title": event.title,
                "checkout_session_id": str(session.id),
                "payment_id": str(failed_payment.id),
                "payment_status": status.value,
                "amount_tiyin": session.total_tiyin,
                "outcome": payload.outcome,
            },
        )
        await record_audit(
            db,
            action="payment.timed_out" if timed_out else "payment.failed",
            entity_type="payment",
            entity_id=failed_payment.id,
            event_id=event.id,
            actor_user_id=user.id,
            description=(
                f"Demonstration payment {'timed out' if timed_out else 'failed'}; "
                "no ticket was issued."
            ),
            data={
                "checkout_session_id": str(session.id),
                "amount_tiyin": session.total_tiyin,
                "outcome": payload.outcome,
            },
        )
        await db.commit()
        enqueue_email(
            user.email,
            "BiletFlow demonstration payment failed",
            "No ticket was issued. Start a new checkout when you are ready to try again.",
        )
        raise AppError(402, "demo_payment_failed", "Payment failed", "No ticket was issued.")

    # Revalidate the held inventory under lock: never issue more tickets than remain,
    # even if the hold was outcounted (e.g. capacity reduced) since checkout started.
    quantity_by_type: dict[uuid.UUID, int] = defaultdict(int)
    for line in session.lines:
        quantity_by_type[line.ticket_type_id] += line.quantity
    for ticket_type_id, count in quantity_by_type.items():
        ticket_type = await db.scalar(
            select(TicketType).where(TicketType.id == ticket_type_id).with_for_update()
        )
        if ticket_type is None or not await _inventory_available(
            db, ticket_type, count, now, exclude_session_id=session.id
        ):
            session.status = CheckoutStatus.FAILED
            await db.execute(delete(SeatHold).where(SeatHold.session_id == session.id))
            await db.commit()
            raise AppError(409, "inventory_exhausted", "Sold out", "Not enough tickets remain.")

    order = Order(
        order_number=order_number(),
        user_id=user.id,
        event_id=event.id,
        checkout_session_id=session.id,
        status=OrderStatus.FREE if session.total_tiyin == 0 else OrderStatus.PAID,
        subtotal_tiyin=session.subtotal_tiyin,
        discount_tiyin=session.discount_tiyin,
        processing_fee_tiyin=session.processing_fee_tiyin,
        total_tiyin=session.total_tiyin,
        organizer_net_tiyin=session.total_tiyin - session.processing_fee_tiyin,
        campaign_id=session.campaign_id,
    )
    db.add(order)
    await db.flush()
    issued: list[Ticket] = []
    for line in session.lines:
        ticket_type = await db.scalar(
            select(TicketType).where(TicketType.id == line.ticket_type_id).with_for_update()
        )
        assert ticket_type is not None
        seat = await db.get(VenueSeat, line.seat_id) if line.seat_id else None
        for _ in range(line.quantity):
            item = OrderItem(
                order_id=order.id,
                ticket_type_id=line.ticket_type_id,
                seat_id=line.seat_id,
                unit_price_tiyin=line.unit_price_tiyin,
                attendee_name=line.attendee_name,
                attendee_email=line.attendee_email,
                section=seat.section if seat else None,
                row=seat.row if seat else None,
                seat_number=seat.number if seat else None,
            )
            db.add(item)
            await db.flush()
            ticket = Ticket(
                ticket_code=ticket_code(),
                order_item_id=item.id,
                event_id=event.id,
                owner_user_id=user.id,
                qr_nonce=opaque_token(18),
            )
            db.add(ticket)
            issued.append(ticket)
    if session.total_tiyin > 0:
        payment = Payment(
            order_id=order.id,
            event_id=event.id,
            user_id=user.id,
            status=PaymentStatus.SUCCEEDED,
            amount_tiyin=session.total_tiyin,
            provider_reference=f"demo-{secrets.token_hex(8)}",
            idempotency_key=payload.idempotency_key,
        )
        db.add(payment)
        await db.flush()
        await record_audit(
            db,
            action="payment.succeeded",
            entity_type="payment",
            entity_id=payment.id,
            event_id=event.id,
            actor_user_id=user.id,
            description=f"Demonstration payment succeeded for order {order.order_number}.",
            data={"order_id": str(order.id), "amount_tiyin": session.total_tiyin},
        )
    if session.campaign_id:
        db.add(
            PromoRedemption(
                campaign_id=session.campaign_id,
                order_id=order.id,
                user_id=user.id,
                discount_tiyin=session.discount_tiyin,
            )
        )
    session.status = CheckoutStatus.COMPLETED
    await db.execute(delete(SeatHold).where(SeatHold.session_id == session.id))
    await create_notification(
        db,
        user_id=user.id,
        type=NotificationType.ORDER_CONFIRMED,
        title="Your BiletFlow order is confirmed",
        body=f"Order {order.order_number} contains {len(issued)} ticket(s).",
        data={
            "order_id": str(order.id),
            "order_number": order.order_number,
            "event_id": str(event.id),
            "event_title": event.title,
            "ticket_count": len(issued),
        },
    )
    await db.flush()
    # Tickets are usable in the wallet as soon as the order commits; the e-mail copy
    # with PDF attachments follows from the worker.
    await create_notification(
        db,
        user_id=user.id,
        type=NotificationType.TICKET_DELIVERED,
        title="Your tickets are ready",
        body=f"{len(issued)} ticket(s) for {event.title} are available in My tickets.",
        data={
            "order_id": str(order.id),
            "order_number": order.order_number,
            "event_id": str(event.id),
            "event_title": event.title,
            "ticket_ids": [str(item.id) for item in issued],
            "ticket_count": len(issued),
        },
    )
    await record_audit(
        db,
        action="order.completed",
        entity_type="order",
        entity_id=order.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Completed demonstration order {order.order_number}.",
        data={"ticket_count": len(issued), "total_tiyin": order.total_tiyin},
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise AppError(
            409, "checkout_conflict", "Checkout conflict", "Inventory changed; try again."
        ) from exc
    enqueue_ticket_delivery(order.id)
    return {
        "order_id": str(order.id),
        "order_number": order.order_number,
        "status": order.status,
        "ticket_ids": [str(item.id) for item in issued],
        "mode": "DEMONSTRATION_ONLY",
    }


def order_item_payload(
    item: OrderItem, ticket_type: TicketType | None, ticket: Ticket | None
) -> dict:
    return {
        "id": str(item.id),
        "ticket_type_id": str(item.ticket_type_id),
        "ticket_type_name": ticket_type.name if ticket_type else None,
        "unit_price_tiyin": item.unit_price_tiyin,
        "attendee_name": item.attendee_name,
        "attendee_email": item.attendee_email,
        "section": item.section,
        "row": item.row,
        "seat_number": item.seat_number,
        "seat_label": seat_label(item),
        "ticket_id": str(ticket.id) if ticket else None,
        "ticket_code": ticket.ticket_code if ticket else None,
        "ticket_status": ticket.status if ticket else None,
    }


def order_payload(
    order: Order,
    event: Event | None,
    items: list[dict],
    buyer: User | None = None,
    *,
    include_buyer: bool = False,
) -> dict:
    payload: dict = {
        "id": str(order.id),
        "order_number": order.order_number,
        "event_id": str(order.event_id),
        "status": order.status,
        "subtotal_tiyin": order.subtotal_tiyin,
        "discount_tiyin": order.discount_tiyin,
        "processing_fee_tiyin": order.processing_fee_tiyin,
        "total_tiyin": order.total_tiyin,
        "organizer_net_tiyin": order.organizer_net_tiyin,
        "created_at": order.created_at,
        "event_title": event.title if event else None,
        "event_slug": event.slug if event else None,
        "event_status": event.status if event else None,
        "event_starts_at": event.starts_at if event else None,
        "event_ends_at": event.ends_at if event else None,
        "event_timezone": event.timezone if event else None,
        "venue_name": event.venue_name if event else None,
        "venue_address": event.venue_address if event else None,
        "city": event.city if event else None,
        "ticket_count": len(items),
        "items": items,
    }
    if include_buyer:
        payload["buyer_id"] = str(order.user_id)
        payload["buyer_name"] = buyer.display_name if buyer else None
        payload["buyer_email"] = buyer.email if buyer else None
    return payload


async def load_order_items(db: DbSession, order_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
    """Line items (with ticket type and ticket) for many orders in one round trip."""
    result: dict[uuid.UUID, list[dict]] = {order_id: [] for order_id in order_ids}
    if not order_ids:
        return result
    rows = (
        await db.execute(
            select(OrderItem, TicketType, Ticket)
            .join(TicketType, TicketType.id == OrderItem.ticket_type_id, isouter=True)
            .join(Ticket, Ticket.order_item_id == OrderItem.id, isouter=True)
            .where(OrderItem.order_id.in_(order_ids))
            .order_by(OrderItem.section, OrderItem.row, OrderItem.seat_number, OrderItem.id)
        )
    ).all()
    for item, ticket_type, ticket in rows:
        result[item.order_id].append(order_item_payload(item, ticket_type, ticket))
    return result


async def load_users(db: DbSession, user_ids: set[uuid.UUID]) -> dict[uuid.UUID, User]:
    if not user_ids:
        return {}
    users = (await db.scalars(select(User).where(User.id.in_(user_ids)))).all()
    return {item.id: item for item in users}


def payment_payload(payment: Payment) -> dict:
    return {
        "id": str(payment.id),
        "order_id": str(payment.order_id) if payment.order_id else None,
        "kind": payment.kind,
        "status": payment.status,
        "amount_tiyin": payment.amount_tiyin,
        "provider": payment.provider,
        "provider_reference": payment.provider_reference,
        "failure_reason": payment.failure_reason,
        "created_at": payment.created_at,
        "updated_at": payment.updated_at,
    }


def refund_payload(refund: Refund) -> dict:
    return {
        "id": str(refund.id),
        "order_id": str(refund.order_id),
        "amount_tiyin": refund.amount_tiyin,
        "status": refund.status,
        "reason": refund.reason,
        "initiated_by_id": str(refund.initiated_by_id),
        "created_at": refund.created_at,
    }


@router.get("/orders")
async def my_orders(user: CurrentUser, db: DbSession) -> list[dict]:
    orders = (
        await db.scalars(
            select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc())
        )
    ).all()
    event_ids = {order.event_id for order in orders}
    events: dict[uuid.UUID, Event] = {}
    if event_ids:
        events = {
            item.id: item
            for item in (await db.scalars(select(Event).where(Event.id.in_(event_ids)))).all()
        }
    items = await load_order_items(db, [order.id for order in orders])
    return [
        order_payload(order, events.get(order.event_id), items[order.id]) for order in orders
    ]


@router.get("/events/{event_id}/orders")
async def event_orders(
    event_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    cursor: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    status: OrderStatus | None = None,
    q: str = "",
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    statement = (
        select(Order)
        .where(Order.event_id == event.id)
        .order_by(Order.created_at.desc(), Order.id.desc())
        .limit(limit + 1)
    )
    if cursor:
        statement = statement.where(Order.created_at < cursor)
    if status:
        statement = statement.where(Order.status == status)
    if q.strip():
        pattern = f"%{q.strip()}%"
        statement = statement.join(User, User.id == Order.user_id).where(
            or_(
                Order.order_number.ilike(pattern),
                User.email.ilike(pattern),
                User.display_name.ilike(pattern),
            )
        )
    orders = (await db.scalars(statement)).all()
    has_more = len(orders) > limit
    page = orders[:limit]
    buyers = await load_users(db, {order.user_id for order in page})
    items = await load_order_items(db, [order.id for order in page])
    return {
        "items": [
            order_payload(
                order, event, items[order.id], buyers.get(order.user_id), include_buyer=True
            )
            for order in page
        ],
        "next_cursor": page[-1].created_at.isoformat() if has_more and page else None,
    }


async def _order_for_reader(db: DbSession, order_id: uuid.UUID, user: User) -> tuple[Order, Event]:
    order = await db.get(Order, order_id)
    if order is None:
        raise AppError(404, "order_not_found", "Order not found", "The order does not exist.")
    event = await get_event_or_404(db, order.event_id)
    if order.user_id != user.id:
        await require_event_permission(
            db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE, StaffRole.SUPPORT}
        )
    return order, event


def order_calendar(order: Order, event: Event) -> dict:
    links = event_calendar_links(event)
    # `ics` is the public event file; `ics_path` is the authenticated, order-scoped
    # API path (works for private events too).
    links["ics_path"] = f"/orders/{order.id}/calendar.ics"
    if order.status in CLOSED_ORDER_STATUSES and links["available"]:
        # A refunded/cancelled order no longer grants admission: do not invite the
        # buyer to add the event to a calendar.
        links.update(
            {
                "available": False,
                "reason": "order_closed",
                "google": None,
                "outlook": None,
                "office365": None,
                "yahoo": None,
            }
        )
    return links


@router.get("/orders/{order_id}")
async def order_detail(order_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    order, event = await _order_for_reader(db, order_id, user)
    items = (await load_order_items(db, [order.id]))[order.id]
    payments = (
        await db.scalars(
            select(Payment).where(Payment.order_id == order.id).order_by(Payment.created_at)
        )
    ).all()
    refunds = (
        await db.scalars(
            select(Refund).where(Refund.order_id == order.id).order_by(Refund.created_at)
        )
    ).all()
    buyer = await db.get(User, order.user_id)
    campaign = await db.get(Campaign, order.campaign_id) if order.campaign_id else None
    payload = order_payload(order, event, items, buyer, include_buyer=True)
    payload.update(
        {
            "refund_policy": event.refund_policy,
            "campaign": (
                {"id": str(campaign.id), "name": campaign.name, "code": campaign.code}
                if campaign
                else None
            ),
            "payments": [payment_payload(item) for item in payments],
            "refunds": [refund_payload(item) for item in refunds],
            "refunded_tiyin": sum(item.amount_tiyin for item in refunds),
            "calendar": order_calendar(order, event),
            "mode": "DEMONSTRATION_ONLY",
        }
    )
    return payload


@router.get("/orders/{order_id}/calendar-links")
async def order_calendar_links(order_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    order, event = await _order_for_reader(db, order_id, user)
    return order_calendar(order, event)


@router.get("/events/{event_id}/attendees")
async def event_attendees(
    event_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    q: str = "",
    status: TicketStatus | None = None,
    ticket_type_id: uuid.UUID | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(
        db, event, user, {StaffRole.MANAGER, StaffRole.SUPPORT, StaffRole.CHECK_IN}
    )
    conditions = [Ticket.event_id == event.id]
    if status:
        conditions.append(Ticket.status == status)
    if ticket_type_id:
        conditions.append(OrderItem.ticket_type_id == ticket_type_id)
    if q.strip():
        pattern = f"%{q.strip()}%"
        conditions.append(
            or_(
                OrderItem.attendee_name.ilike(pattern),
                OrderItem.attendee_email.ilike(pattern),
                Ticket.ticket_code.ilike(pattern),
                Order.order_number.ilike(pattern),
            )
        )
    base = (
        select(Ticket, OrderItem, Order, TicketType)
        .join(OrderItem, OrderItem.id == Ticket.order_item_id)
        .join(Order, Order.id == OrderItem.order_id)
        .join(TicketType, TicketType.id == OrderItem.ticket_type_id)
        .where(*conditions)
    )
    total = (
        await db.scalar(
            select(func.count())
            .select_from(Ticket)
            .join(OrderItem, OrderItem.id == Ticket.order_item_id)
            .join(Order, Order.id == OrderItem.order_id)
            .where(*conditions)
        )
    ) or 0
    rows = (
        await db.execute(
            base.order_by(OrderItem.attendee_name, Ticket.ticket_code).limit(limit).offset(offset)
        )
    ).all()
    checked_ids = [
        ticket.id for ticket, _, _, _ in rows if ticket.status == TicketStatus.CHECKED_IN
    ]
    checked_at: dict[uuid.UUID, datetime] = {}
    if checked_ids:
        checked_rows = (
            await db.execute(
                select(CheckInRecord.ticket_id, func.max(CheckInRecord.captured_at))
                .where(
                    CheckInRecord.ticket_id.in_(checked_ids),
                    CheckInRecord.action == CheckInAction.CHECK_IN,
                )
                .group_by(CheckInRecord.ticket_id)
            )
        ).all()
        checked_at = {ticket_id: moment for ticket_id, moment in checked_rows}
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "ticket_id": str(ticket.id),
                "ticket_code": ticket.ticket_code,
                "ticket_status": ticket.status,
                "attendee_name": item.attendee_name,
                "attendee_email": item.attendee_email,
                "ticket_type_id": str(ticket_type.id),
                "ticket_type_name": ticket_type.name,
                "section": item.section,
                "row": item.row,
                "seat_number": item.seat_number,
                "seat_label": seat_label(item),
                "checked_in": ticket.status == TicketStatus.CHECKED_IN,
                "checked_in_at": checked_at.get(ticket.id),
                "order_id": str(order.id),
                "order_number": order.order_number,
                "order_status": order.status,
            }
            for ticket, item, order, ticket_type in rows
        ],
    }


@router.get("/events/{event_id}/refunds")
async def event_refunds(
    event_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    base = select(Refund, Order).join(Order, Order.id == Refund.order_id).where(
        Order.event_id == event.id
    )
    total, total_amount = (
        await db.execute(
            select(func.count(), func.coalesce(func.sum(Refund.amount_tiyin), 0))
            .select_from(Refund)
            .join(Order, Order.id == Refund.order_id)
            .where(Order.event_id == event.id)
        )
    ).one()
    rows = (
        await db.execute(
            base.order_by(Refund.created_at.desc(), Refund.id).limit(limit).offset(offset)
        )
    ).all()
    people = await load_users(
        db,
        {order.user_id for _, order in rows} | {refund.initiated_by_id for refund, _ in rows},
    )
    items = []
    for refund, order in rows:
        buyer = people.get(order.user_id)
        initiator = people.get(refund.initiated_by_id)
        items.append(
            {
                **refund_payload(refund),
                "order_number": order.order_number,
                "order_status": order.status,
                "buyer_name": buyer.display_name if buyer else None,
                "buyer_email": buyer.email if buyer else None,
                "initiated_by_name": initiator.display_name if initiator else None,
            }
        )
    return {
        "total": total or 0,
        "total_amount_tiyin": int(total_amount or 0),
        "limit": limit,
        "offset": offset,
        "items": items,
    }


@router.get("/events/{event_id}/payments")
async def event_payments(
    event_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    status: PaymentStatus | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    conditions = [Payment.event_id == event.id]
    if status:
        conditions.append(Payment.status == status)
    total = (
        await db.scalar(select(func.count()).select_from(Payment).where(*conditions))
    ) or 0
    payments = (
        await db.scalars(
            select(Payment)
            .where(*conditions)
            .order_by(Payment.created_at.desc(), Payment.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    order_ids = {item.order_id for item in payments if item.order_id}
    order_numbers: dict[uuid.UUID, str] = {}
    if order_ids:
        order_numbers = {
            order_id: number
            for order_id, number in (
                await db.execute(
                    select(Order.id, Order.order_number).where(Order.id.in_(order_ids))
                )
            ).all()
        }
    payers = await load_users(db, {item.user_id for item in payments})
    items = []
    for payment in payments:
        payer = payers.get(payment.user_id)
        items.append(
            {
                **payment_payload(payment),
                "order_number": order_numbers.get(payment.order_id) if payment.order_id else None,
                "payer_id": str(payment.user_id),
                "payer_name": payer.display_name if payer else None,
                "payer_email": payer.email if payer else None,
            }
        )
    return {"total": total, "limit": limit, "offset": offset, "items": items}


async def _close_order(db: DbSession, order: Order) -> list[Ticket]:
    """Mark an order refunded/cancelled, invalidate its tickets and free its seats."""
    paid = order.total_tiyin > 0
    order.status = OrderStatus.REFUNDED if paid else OrderStatus.CANCELLED
    tickets = (
        await db.scalars(
            select(Ticket).where(
                Ticket.order_item_id.in_(select(OrderItem.id).where(OrderItem.order_id == order.id))
            )
        )
    ).all()
    for ticket in tickets:
        ticket.status = TicketStatus.REFUNDED if paid else TicketStatus.CANCELLED
    payment = await db.scalar(
        select(Payment).where(
            Payment.order_id == order.id, Payment.status == PaymentStatus.SUCCEEDED
        )
    )
    if payment:
        payment.status = PaymentStatus.REFUNDED
    await release_order_seats(db, order.id)
    return list(tickets)


@router.post("/orders/{order_id}/refund")
async def refund_order(
    order_id: uuid.UUID,
    reason: str,
    idempotency_key: str,
    user: CurrentUser,
    db: DbSession,
) -> dict:
    order = await db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None:
        raise AppError(404, "order_not_found", "Order not found", "The order does not exist.")
    event = await get_event_or_404(db, order.event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    existing = await db.scalar(select(Refund).where(Refund.idempotency_key == idempotency_key))
    if existing:
        if existing.order_id != order.id:
            raise AppError(
                409,
                "idempotency_key_reused",
                "Request key already used",
                "Generate a new idempotency key for this refund.",
            )
        return {
            "refund_id": str(existing.id),
            "status": existing.status,
            "amount_tiyin": existing.amount_tiyin,
            "order_status": order.status,
            "mode": "DEMONSTRATION_ONLY",
        }
    if order.status not in ACTIVE_ORDER_STATUSES:
        raise AppError(409, "order_not_refundable", "Refund unavailable", "This order is closed.")
    if datetime.now(UTC) >= event.starts_at and event.status != EventStatus.CANCELLED:
        raise AppError(409, "refund_window_closed", "Refund unavailable", "The event has started.")
    reason = reason.strip()[:2000] or "Refund"
    refund = Refund(
        order_id=order.id,
        initiated_by_id=user.id,
        amount_tiyin=order.total_tiyin,
        reason=reason,
        idempotency_key=idempotency_key,
    )
    db.add(refund)
    await db.flush()
    tickets = await _close_order(db, order)
    await create_notification(
        db,
        user_id=order.user_id,
        type=NotificationType.REFUND_COMPLETED,
        title="Refund completed",
        body=f"Order {order.order_number} was refunded in demonstration mode.",
        data={
            "order_id": str(order.id),
            "order_number": order.order_number,
            "event_id": str(event.id),
            "event_title": event.title,
            "refund_id": str(refund.id),
            "amount_tiyin": refund.amount_tiyin,
        },
    )
    await record_audit(
        db,
        action="order.refunded",
        entity_type="order",
        entity_id=order.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Fully refunded order {order.order_number}.",
        data={
            "reason": reason,
            "refund_id": str(refund.id),
            "amount_tiyin": refund.amount_tiyin,
            "tickets_invalidated": len(tickets),
            "scope": "full",
        },
    )
    await db.commit()
    purchaser = await db.get(User, order.user_id)
    if purchaser:
        enqueue_email(
            purchaser.email,
            f"Refund completed for {order.order_number}",
            "Your full BiletFlow demonstration refund is complete and its tickets are invalid.",
        )
    return {
        "refund_id": str(refund.id),
        "status": refund.status,
        "amount_tiyin": refund.amount_tiyin,
        "order_status": order.status,
        "mode": "DEMONSTRATION_ONLY",
    }


@router.post("/events/{event_id}/cancel")
async def cancel_event(event_id: uuid.UUID, reason: str, user: CurrentUser, db: DbSession) -> dict:
    event = await db.scalar(select(Event).where(Event.id == event_id).with_for_update())
    if event is None:
        raise AppError(404, "event_not_found", "Event not found", "The event does not exist.")
    await require_event_permission(db, event, user, {StaffRole.MANAGER})
    if event.status == EventStatus.CANCELLED:
        return {"status": event.status, "refunded_orders": 0}
    event.status = EventStatus.CANCELLED
    event.cancellation_reason = reason
    event.calendar_sequence += 1
    # Nothing can be bought any more: close open checkouts and release their holds.
    open_session_ids = (
        await db.scalars(
            select(CheckoutSession.id)
            .where(
                CheckoutSession.event_id == event.id, CheckoutSession.status == CheckoutStatus.OPEN
            )
            .with_for_update()
        )
    ).all()
    if open_session_ids:
        await db.execute(
            update(CheckoutSession)
            .where(CheckoutSession.id.in_(open_session_ids))
            .values(status=CheckoutStatus.EXPIRED)
            .execution_options(synchronize_session=False)
        )
        await db.execute(delete(SeatHold).where(SeatHold.session_id.in_(open_session_ids)))
    orders = (
        await db.scalars(
            select(Order)
            .where(Order.event_id == event.id, Order.status.in_(ACTIVE_ORDER_STATUSES))
            .with_for_update()
        )
    ).all()
    cancellation_emails: list[str] = []
    refunded_total = 0
    for order in orders:
        refund = Refund(
            order_id=order.id,
            initiated_by_id=user.id,
            amount_tiyin=order.total_tiyin,
            reason=f"Event cancelled: {reason}",
            idempotency_key=f"event-cancel-{event.id}-{order.id}",
        )
        db.add(refund)
        await db.flush()
        tickets = await _close_order(db, order)
        refunded_total += order.total_tiyin
        await create_notification(
            db,
            user_id=order.user_id,
            type=NotificationType.EVENT_CANCELLED,
            title=f"{event.title} was cancelled",
            body="Your order was cancelled and any demonstration payment was refunded.",
            data={
                "event_id": str(event.id),
                "event_title": event.title,
                "order_id": str(order.id),
                "order_number": order.order_number,
                "refund_id": str(refund.id),
                "amount_tiyin": refund.amount_tiyin,
            },
        )
        # Every refund is its own audit entry, not only the event-level cancellation.
        await record_audit(
            db,
            action="order.refunded",
            entity_type="order",
            entity_id=order.id,
            event_id=event.id,
            actor_user_id=user.id,
            description=(
                f"Refunded order {order.order_number} because the event was cancelled."
            ),
            data={
                "reason": f"Event cancelled: {reason}",
                "refund_id": str(refund.id),
                "amount_tiyin": refund.amount_tiyin,
                "tickets_invalidated": len(tickets),
                "scope": "full",
                "cause": "event_cancelled",
            },
        )
        attendee = await db.get(User, order.user_id)
        if attendee:
            cancellation_emails.append(attendee.email)
    await record_audit(
        db,
        action="event.cancelled",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Cancelled event and closed {len(orders)} order(s).",
        data={
            "reason": reason,
            "refunded_orders": len(orders),
            "refunded_tiyin": refunded_total,
        },
    )
    await db.commit()
    for attendee_email in set(cancellation_emails):
        enqueue_email(
            attendee_email,
            f"{event.title} was cancelled",
            "Your registration was cancelled and any successful demonstration payment was fully refunded.",
        )
    return {
        "status": event.status,
        "refunded_orders": len(orders),
        "refunded_tiyin": refunded_total,
    }
