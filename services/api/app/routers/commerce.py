import secrets
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Query
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.access import get_event_or_404, require_event_permission, require_event_view_access
from app.config import settings
from app.deps import CurrentUser, DbSession, OptionalUser
from app.enums import (
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


async def expire_checkout_sessions(db: DbSession, event_id: uuid.UUID | None = None) -> int:
    now = datetime.now(UTC)
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
    result.campaign_url = f"{settings.public_web_base_url}/c/{campaign.opaque_token}"
    return result


@router.get("/campaigns/resolve/{opaque_token}")
async def resolve_campaign(opaque_token: str, db: DbSession, user: OptionalUser) -> dict:
    campaign = await db.scalar(select(Campaign).where(Campaign.opaque_token == opaque_token))
    if campaign is None or not campaign.is_enabled:
        raise AppError(404, "campaign_not_found", "Campaign not found", "This link is unavailable.")
    event = await get_event_or_404(db, campaign.event_id)
    await require_event_view_access(db, event, user)
    return {
        "event_id": str(event.id),
        "event_slug": event.slug,
        "promo_code": campaign.code,
        "campaign_id": str(campaign.id),
    }


@router.get("/events/{event_id}/campaigns", response_model=list[CampaignOut])
async def list_campaigns(
    event_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[CampaignOut]:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    items = (await db.scalars(select(Campaign).where(Campaign.event_id == event.id))).all()
    result: list[CampaignOut] = []
    for item in items:
        output = CampaignOut.model_validate(item)
        output.campaign_url = f"{settings.public_web_base_url}/c/{item.opaque_token}"
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
    if event.status != EventStatus.PUBLISHED or event.paid_sales_suspended:
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
    for requested in payload.lines:
        requested_by_type[requested.ticket_type_id] += requested.quantity

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
        if ticket_type.price_tiyin > 0 and not event.paid_sales_active:
            raise AppError(
                409,
                "paid_sales_not_activated",
                "Paid sales unavailable",
                "The organizer must activate paid sales.",
            )
        sold = await db.scalar(
            select(func.count())
            .select_from(OrderItem)
            .join(Order)
            .where(
                OrderItem.ticket_type_id == ticket_type.id,
                Order.status.in_([OrderStatus.PAID, OrderStatus.FREE]),
            )
        )
        reserved = await db.scalar(
            select(func.coalesce(func.sum(CheckoutLine.quantity), 0))
            .select_from(CheckoutLine)
            .join(CheckoutSession)
            .where(
                CheckoutLine.ticket_type_id == ticket_type.id,
                CheckoutSession.status == CheckoutStatus.OPEN,
                CheckoutSession.expires_at > now,
            )
        )
        if (sold or 0) + (reserved or 0) + count > ticket_type.quantity:
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


@router.post("/checkout/sessions/{session_id}/confirm")
async def confirm_checkout(
    session_id: uuid.UUID, payload: CheckoutConfirm, user: CurrentUser, db: DbSession
) -> dict:
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
    event = await db.scalar(select(Event).where(Event.id == session.event_id).with_for_update())
    assert event is not None
    if event.status != EventStatus.PUBLISHED or event.paid_sales_suspended:
        raise AppError(
            409, "sales_unavailable", "Sales unavailable", "The event cannot accept orders."
        )
    if payload.outcome != "success":
        status = PaymentStatus.FAILED if payload.outcome == "failure" else PaymentStatus.TIMED_OUT
        db.add(
            Payment(
                event_id=event.id,
                user_id=user.id,
                status=status,
                amount_tiyin=session.total_tiyin,
                provider_reference=f"demo-{secrets.token_hex(8)}",
                idempotency_key=payload.idempotency_key,
                failure_reason=payload.outcome,
            )
        )
        session.status = CheckoutStatus.FAILED
        await db.execute(delete(SeatHold).where(SeatHold.session_id == session.id))
        await create_notification(
            db,
            user_id=user.id,
            type=NotificationType.PAYMENT_FAILED,
            title="Demonstration payment failed",
            body="No ticket was issued. Start checkout again.",
            data={"event_id": str(event.id)},
        )
        await db.commit()
        enqueue_email(
            user.email,
            "BiletFlow demonstration payment failed",
            "No ticket was issued. Start a new checkout when you are ready to try again.",
        )
        raise AppError(402, "demo_payment_failed", "Payment failed", "No ticket was issued.")

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
        db.add(
            Payment(
                order_id=order.id,
                event_id=event.id,
                user_id=user.id,
                status=PaymentStatus.SUCCEEDED,
                amount_tiyin=session.total_tiyin,
                provider_reference=f"demo-{secrets.token_hex(8)}",
                idempotency_key=payload.idempotency_key,
            )
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
        data={"order_id": str(order.id)},
    )
    await record_audit(
        db,
        action="order.completed",
        entity_type="order",
        entity_id=order.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Completed demonstration order {order.order_number}.",
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


@router.get("/orders")
async def my_orders(user: CurrentUser, db: DbSession) -> list[dict]:
    orders = (
        await db.scalars(
            select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc())
        )
    ).all()
    return [
        {
            "id": str(order.id),
            "order_number": order.order_number,
            "event_id": str(order.event_id),
            "status": order.status,
            "total_tiyin": order.total_tiyin,
            "created_at": order.created_at,
        }
        for order in orders
    ]


@router.get("/events/{event_id}/orders")
async def event_orders(
    event_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    cursor: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
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
    orders = (await db.scalars(statement)).all()
    has_more = len(orders) > limit
    page = orders[:limit]
    return {
        "items": [
            {
                "id": str(order.id),
                "order_number": order.order_number,
                "status": order.status,
                "total_tiyin": order.total_tiyin,
                "discount_tiyin": order.discount_tiyin,
                "organizer_net_tiyin": order.organizer_net_tiyin,
                "created_at": order.created_at,
            }
            for order in page
        ],
        "next_cursor": page[-1].created_at.isoformat() if has_more and page else None,
    }


@router.get("/orders/{order_id}")
async def order_detail(order_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    order = await db.scalar(
        select(Order).options(selectinload(Order.items)).where(Order.id == order_id)
    )
    if order is None:
        raise AppError(404, "order_not_found", "Order not found", "The order does not exist.")
    event = await get_event_or_404(db, order.event_id)
    if order.user_id != user.id:
        await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    return {
        "id": str(order.id),
        "order_number": order.order_number,
        "status": order.status,
        "subtotal_tiyin": order.subtotal_tiyin,
        "discount_tiyin": order.discount_tiyin,
        "processing_fee_tiyin": order.processing_fee_tiyin,
        "total_tiyin": order.total_tiyin,
        "items": [
            {
                "id": str(item.id),
                "ticket_type_id": str(item.ticket_type_id),
                "attendee_name": item.attendee_name,
                "attendee_email": item.attendee_email,
                "section": item.section,
                "row": item.row,
                "seat_number": item.seat_number,
            }
            for item in order.items
        ],
    }


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
        return {"refund_id": str(existing.id), "status": existing.status}
    if order.status not in {OrderStatus.PAID, OrderStatus.FREE}:
        raise AppError(409, "order_not_refundable", "Refund unavailable", "This order is closed.")
    if datetime.now(UTC) >= event.starts_at and event.status != EventStatus.CANCELLED:
        raise AppError(409, "refund_window_closed", "Refund unavailable", "The event has started.")
    refund = Refund(
        order_id=order.id,
        initiated_by_id=user.id,
        amount_tiyin=order.total_tiyin,
        reason=reason,
        idempotency_key=idempotency_key,
    )
    db.add(refund)
    order.status = OrderStatus.REFUNDED if order.total_tiyin else OrderStatus.CANCELLED
    tickets = (
        await db.scalars(
            select(Ticket).where(
                Ticket.order_item_id.in_(select(OrderItem.id).where(OrderItem.order_id == order.id))
            )
        )
    ).all()
    for ticket in tickets:
        ticket.status = TicketStatus.REFUNDED if order.total_tiyin else TicketStatus.CANCELLED
    payment = await db.scalar(select(Payment).where(Payment.order_id == order.id))
    if payment:
        payment.status = PaymentStatus.REFUNDED
    await create_notification(
        db,
        user_id=order.user_id,
        type=NotificationType.REFUND_COMPLETED,
        title="Refund completed",
        body=f"Order {order.order_number} was refunded in demonstration mode.",
        data={"order_id": str(order.id)},
    )
    await record_audit(
        db,
        action="order.refunded",
        entity_type="order",
        entity_id=order.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Fully refunded order {order.order_number}.",
        data={"reason": reason},
    )
    await db.commit()
    purchaser = await db.get(User, order.user_id)
    if purchaser:
        enqueue_email(
            purchaser.email,
            f"Refund completed for {order.order_number}",
            "Your full BiletFlow demonstration refund is complete and its tickets are invalid.",
        )
    return {"refund_id": str(refund.id), "status": refund.status, "mode": "DEMONSTRATION_ONLY"}


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
    orders = (
        await db.scalars(
            select(Order)
            .where(
                Order.event_id == event.id, Order.status.in_([OrderStatus.PAID, OrderStatus.FREE])
            )
            .with_for_update()
        )
    ).all()
    cancellation_emails: list[str] = []
    for order in orders:
        order.status = OrderStatus.REFUNDED if order.total_tiyin else OrderStatus.CANCELLED
        db.add(
            Refund(
                order_id=order.id,
                initiated_by_id=user.id,
                amount_tiyin=order.total_tiyin,
                reason=f"Event cancelled: {reason}",
                idempotency_key=f"event-cancel-{event.id}-{order.id}",
            )
        )
        tickets = (
            await db.scalars(
                select(Ticket).where(
                    Ticket.order_item_id.in_(
                        select(OrderItem.id).where(OrderItem.order_id == order.id)
                    )
                )
            )
        ).all()
        for ticket in tickets:
            ticket.status = TicketStatus.REFUNDED if order.total_tiyin else TicketStatus.CANCELLED
        payment = await db.scalar(select(Payment).where(Payment.order_id == order.id))
        if payment:
            payment.status = PaymentStatus.REFUNDED
        await create_notification(
            db,
            user_id=order.user_id,
            type=NotificationType.EVENT_CANCELLED,
            title=f"{event.title} was cancelled",
            body="Your order was cancelled and any demonstration payment was refunded.",
            data={"event_id": str(event.id), "order_id": str(order.id)},
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
        data={"reason": reason},
    )
    await db.commit()
    for attendee_email in set(cancellation_emails):
        enqueue_email(
            attendee_email,
            f"{event.title} was cancelled",
            "Your registration was cancelled and any successful demonstration payment was fully refunded.",
        )
    return {"status": event.status, "refunded_orders": len(orders)}
