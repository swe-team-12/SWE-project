import csv
import io
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import aliased

from app.access import (
    ACTIVATION_FEE_KEY,
    activation_fee_setting,
    event_change_data,
    ticket_holder_ids,
)
from app.config import settings
from app.deps import CurrentUser, DbSession, require_role
from app.enums import (
    EventReportStatus,
    EventStatus,
    NotificationType,
    PaymentStatus,
    SupportKind,
    SupportStatus,
    UserRole,
)
from app.errors import AppError
from app.models import (
    Campaign,
    Event,
    EventReport,
    Notification,
    Order,
    OrganizerProfile,
    Payment,
    Payout,
    PromoRedemption,
    Refund,
    SupportCase,
    SystemSetting,
    User,
)
from app.routers.support import serialize_cases
from app.services import create_notification, record_audit

router = APIRouter(tags=["administration and notifications"])


def admin(user: CurrentUser) -> None:
    require_role(user, UserRole.PLATFORM_ADMIN)


@router.get("/notifications")
async def notifications(user: CurrentUser, db: DbSession, unread_only: bool = False) -> list[dict]:
    statement = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        statement = statement.where(Notification.read_at.is_(None))
    items = (await db.scalars(statement.order_by(Notification.created_at.desc()).limit(100))).all()
    return [
        {
            "id": str(item.id),
            "type": item.type,
            "title": item.title,
            "body": item.body,
            "data": item.data,
            "read_at": item.read_at,
            "created_at": item.created_at,
        }
        for item in items
    ]


@router.post("/notifications/{notification_id}/read")
async def read_notification(notification_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    item = await db.get(Notification, notification_id)
    if item is None or item.user_id != user.id:
        raise AppError(
            404, "notification_not_found", "Notification not found", "The item is unavailable."
        )
    item.read_at = datetime.now(UTC)
    await db.commit()
    return {"read_at": item.read_at}


def like_pattern(value: str) -> str:
    escaped = value.strip().replace("/", "//").replace("%", "/%").replace("_", "/_")
    return f"%{escaped}%"


def person(user: User | None) -> dict | None:
    if user is None:
        return None
    return {"id": str(user.id), "display_name": user.display_name, "email": user.email}


def require_reason(reason: str) -> str:
    cleaned = reason.strip()
    if len(cleaned) < 3:
        raise AppError(
            422, "reason_required", "Reason required", "Give a reason of at least 3 characters."
        )
    return cleaned[:2_000]


@router.get("/admin/search")
async def platform_search(
    user: CurrentUser,
    db: DbSession,
    q: str = Query(min_length=2, max_length=100),
) -> dict:
    admin(user)
    pattern = like_pattern(q)
    users = (
        await db.scalars(
            select(User)
            .where(
                or_(
                    User.email.ilike(pattern, escape="/"),
                    User.display_name.ilike(pattern, escape="/"),
                )
            )
            .order_by(User.email)
            .limit(30)
        )
    ).all()
    owner = aliased(User)
    events = (
        await db.execute(
            select(Event, owner)
            .join(owner, owner.id == Event.owner_id)
            .where(
                or_(
                    Event.title.ilike(pattern, escape="/"),
                    Event.slug.ilike(pattern, escape="/"),
                    owner.email.ilike(pattern, escape="/"),
                )
            )
            .order_by(Event.starts_at.desc())
            .limit(30)
        )
    ).all()
    buyer = aliased(User)
    orders = (
        await db.execute(
            select(Order, buyer, Event)
            .join(buyer, buyer.id == Order.user_id)
            .join(Event, Event.id == Order.event_id)
            .where(
                or_(
                    Order.order_number.ilike(pattern, escape="/"),
                    buyer.email.ilike(pattern, escape="/"),
                    Event.title.ilike(pattern, escape="/"),
                )
            )
            .order_by(Order.created_at.desc())
            .limit(30)
        )
    ).all()
    payer = aliased(User)
    payments = (
        await db.execute(
            select(Payment, payer, Event, Order)
            .join(payer, payer.id == Payment.user_id)
            .join(Event, Event.id == Payment.event_id)
            .outerjoin(Order, Order.id == Payment.order_id)
            .where(
                or_(
                    Payment.provider_reference.ilike(pattern, escape="/"),
                    Order.order_number.ilike(pattern, escape="/"),
                    payer.email.ilike(pattern, escape="/"),
                )
            )
            .order_by(Payment.created_at.desc())
            .limit(30)
        )
    ).all()
    return {
        "users": [
            {
                "id": str(item.id),
                "email": item.email,
                "display_name": item.display_name,
                "suspended": item.is_suspended,
                "roles": item.roles,
                "is_email_verified": item.is_email_verified,
            }
            for item in users
        ],
        "events": [
            {
                "id": str(item.id),
                "title": item.title,
                "status": item.status,
                "slug": item.slug,
                "starts_at": item.starts_at,
                "owner_id": str(item.owner_id),
                "owner_name": event_owner.display_name,
                "owner_email": event_owner.email,
                "paid_sales_active": item.paid_sales_active,
                "paid_sales_suspended": item.paid_sales_suspended,
                "paid_sales_suspension_reason": item.paid_sales_suspension_reason,
                "suspension_reason": item.suspension_reason,
            }
            for item, event_owner in events
        ],
        "orders": [
            {
                "id": str(item.id),
                "number": item.order_number,
                "status": item.status,
                "total_tiyin": item.total_tiyin,
                "created_at": item.created_at,
                "event_id": str(item.event_id),
                "event_title": event.title,
                "buyer_id": str(order_buyer.id),
                "buyer_email": order_buyer.email,
                "buyer_name": order_buyer.display_name,
            }
            for item, order_buyer, event in orders
        ],
        "payments": [
            {
                "id": str(item.id),
                "reference": item.provider_reference,
                "status": item.status,
                "kind": item.kind,
                "amount_tiyin": item.amount_tiyin,
                "failure_reason": item.failure_reason,
                "created_at": item.created_at,
                "event_id": str(item.event_id),
                "event_title": event.title,
                "order_id": str(item.order_id) if item.order_id else None,
                "order_number": order.order_number if order else None,
                "payer_id": str(payment_payer.id),
                "payer_email": payment_payer.email,
            }
            for item, payment_payer, event, order in payments
        ],
    }


@router.post("/admin/users/{user_id}/suspension")
async def suspend_user(
    user_id: uuid.UUID, suspended: bool, reason: str, user: CurrentUser, db: DbSession
) -> dict:
    admin(user)
    target = await db.get(User, user_id)
    if target is None:
        raise AppError(404, "user_not_found", "User not found", "The account does not exist.")
    if target.id == user.id and suspended:
        raise AppError(
            409, "cannot_suspend_self", "Action rejected", "You cannot suspend yourself."
        )
    target.is_suspended = suspended
    await record_audit(
        db,
        action="admin.user_suspension_changed",
        entity_type="user",
        entity_id=target.id,
        actor_user_id=user.id,
        description=f"Set user suspension to {suspended}.",
        data={"reason": reason, "suspended": suspended},
    )
    await db.commit()
    return {"suspended": suspended}


@router.post("/admin/events/{event_id}/suspension")
async def suspend_event(
    event_id: uuid.UUID,
    suspended: bool,
    reason: str,
    user: CurrentUser,
    db: DbSession,
    republish: bool = False,
) -> dict:
    """Suspend the whole event, or lift that suspension.

    Lifting returns the event to ``unpublished`` (the organizer republishes) unless
    ``republish=true`` is passed. A separate paid-sales suspension is never touched here.
    """
    admin(user)
    event = await db.get(Event, event_id)
    if event is None:
        raise AppError(404, "event_not_found", "Event not found", "The event does not exist.")
    holders: set[uuid.UUID] = set()
    previous_status: EventStatus = event.status
    if suspended:
        cleaned = require_reason(reason)
        if event.status == EventStatus.CANCELLED:
            raise AppError(
                409, "event_cancelled", "Event cancelled", "A cancelled event cannot be suspended."
            )
        if event.status == EventStatus.SUSPENDED:
            raise AppError(
                409, "event_already_suspended", "Already suspended", "The event is suspended."
            )
        event.status = EventStatus.SUSPENDED
        event.suspension_reason = cleaned
        change = "suspended"
        owner_title = f"{event.title} was suspended"
        owner_body = f"A platform administrator suspended this event. Reason: {cleaned}"
        if previous_status == EventStatus.PUBLISHED:
            holders = await ticket_holder_ids(db, event.id)
    else:
        cleaned = reason.strip()[:2_000]
        if event.status != EventStatus.SUSPENDED:
            raise AppError(
                409, "event_not_suspended", "Not suspended", "The event is not suspended."
            )
        event.status = EventStatus.PUBLISHED if republish else EventStatus.UNPUBLISHED
        event.suspension_reason = None
        if event.paid_sales_suspended and not event.paid_sales_suspension_reason:
            # Flag left behind by the earlier combined suspension, not by an explicit
            # paid-sales suspension: clear it together with the event suspension.
            event.paid_sales_suspended = False
        change = "unsuspended"
        owner_title = f"Suspension lifted for {event.title}"
        owner_body = (
            "The event is published again."
            if republish
            else "The event is now unpublished. Publish it again when you are ready."
        )
        if republish:
            holders = await ticket_holder_ids(db, event.id)
    data = event_change_data(event, change, cleaned or None)
    await create_notification(
        db,
        user_id=event.owner_id,
        type=NotificationType.EVENT_UPDATED,
        title=owner_title,
        body=owner_body,
        data={**data, "paid_sales_suspended": event.paid_sales_suspended},
    )
    holders.discard(event.owner_id)
    for holder_id in holders:
        await create_notification(
            db,
            user_id=holder_id,
            type=NotificationType.EVENT_UPDATED,
            title=(
                f"{event.title} is suspended" if suspended else f"{event.title} is available again"
            ),
            body=(
                "This event is temporarily unavailable. Your tickets remain in your account."
                if suspended
                else "The event is published again. Your tickets remain valid."
            ),
            # The moderation reason is shared with the organizer only.
            data=event_change_data(event, change),
        )
    await record_audit(
        db,
        action="admin.event_suspension_changed",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Set event suspension to {suspended}.",
        data={
            "reason": cleaned,
            "suspended": suspended,
            "previous_status": previous_status.value,
            "new_status": event.status.value,
            "attendees_notified": len(holders),
        },
    )
    await db.commit()
    return {
        "status": event.status,
        "suspension_reason": event.suspension_reason,
        "paid_sales_suspended": event.paid_sales_suspended,
        "paid_sales_suspension_reason": event.paid_sales_suspension_reason,
        "attendees_notified": len(holders),
    }


class PaidSalesSuspensionRequest(BaseModel):
    suspended: bool
    reason: str = Field(default="", max_length=2_000)

    @field_validator("reason", mode="before")
    @classmethod
    def strip_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


@router.post("/admin/events/{event_id}/paid-sales-suspension")
async def suspend_paid_sales(
    event_id: uuid.UUID, payload: PaidSalesSuspensionRequest, user: CurrentUser, db: DbSession
) -> dict:
    """Stop or resume paid sales only; publication and free registration are unaffected."""
    admin(user)
    event = await db.get(Event, event_id)
    if event is None:
        raise AppError(404, "event_not_found", "Event not found", "The event does not exist.")
    if payload.suspended:
        reason = require_reason(payload.reason)
        if event.paid_sales_suspended:
            raise AppError(
                409,
                "paid_sales_already_suspended",
                "Already suspended",
                "Paid sales are already suspended for this event.",
            )
        event.paid_sales_suspended = True
        event.paid_sales_suspension_reason = reason
        change = "paid_sales_suspended"
        title = f"Paid sales suspended for {event.title}"
        body = (
            "A platform administrator suspended paid ticket sales. The event stays published "
            f"and free registration keeps working. Reason: {reason}"
        )
    else:
        reason = payload.reason
        if not event.paid_sales_suspended:
            raise AppError(
                409,
                "paid_sales_not_suspended",
                "Not suspended",
                "Paid sales are not suspended for this event.",
            )
        event.paid_sales_suspended = False
        event.paid_sales_suspension_reason = None
        change = "paid_sales_unsuspended"
        title = f"Paid sales restored for {event.title}"
        body = "A platform administrator lifted the paid-sales suspension."
    await create_notification(
        db,
        user_id=event.owner_id,
        type=NotificationType.EVENT_UPDATED,
        title=title,
        body=body,
        data=event_change_data(
            event,
            change,
            reason or None,
            paid_sales_active=event.paid_sales_active,
            paid_sales_suspended=event.paid_sales_suspended,
        ),
    )
    await record_audit(
        db,
        action="admin.paid_sales_suspension_changed",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Set paid-sales suspension to {payload.suspended}.",
        data={"reason": reason, "suspended": payload.suspended},
    )
    await db.commit()
    return {
        "status": event.status,
        "paid_sales_active": event.paid_sales_active,
        "paid_sales_suspended": event.paid_sales_suspended,
        "paid_sales_suspension_reason": event.paid_sales_suspension_reason,
    }


async def settings_payload(db: DbSession) -> dict:
    fee, setting = await activation_fee_setting(db)
    updated_by = await db.get(User, setting.updated_by_id) if setting and setting.updated_by_id else None
    return {
        "activation_fee_tiyin": fee,
        "activation_fee_source": "configured" if setting else "default",
        "default_activation_fee_tiyin": settings.activation_fee_tiyin,
        "processor_fee_bps": settings.processor_fee_bps,
        "checkout_hold_minutes": settings.checkout_hold_minutes,
        "currency": "KZT",
        "mode": "DEMONSTRATION_ONLY",
        "updated_at": setting.updated_at if setting else None,
        "updated_by": person(updated_by),
    }


@router.get("/admin/settings")
async def platform_settings(user: CurrentUser, db: DbSession) -> dict:
    admin(user)
    return await settings_payload(db)


@router.put("/admin/settings/activation-fee")
async def activation_fee(amount_tiyin: int, user: CurrentUser, db: DbSession) -> dict:
    admin(user)
    if amount_tiyin < 0 or amount_tiyin > 100_000_000_00:
        raise AppError(
            422, "invalid_amount", "Invalid amount", "Amount must be non-negative and realistic."
        )
    previous, setting = await activation_fee_setting(db)
    if setting is None:
        setting = await db.scalar(
            select(SystemSetting).where(SystemSetting.key == ACTIVATION_FEE_KEY)
        )
    if setting is None:
        setting = SystemSetting(
            key=ACTIVATION_FEE_KEY, value={"amount_tiyin": amount_tiyin}, updated_by_id=user.id
        )
        db.add(setting)
        await db.flush()
    else:
        setting.value = {"amount_tiyin": amount_tiyin}
        setting.updated_by_id = user.id
    await record_audit(
        db,
        action="admin.settings_changed",
        entity_type="system_setting",
        entity_id=setting.id,
        actor_user_id=user.id,
        description=f"Changed the activation fee from {previous} to {amount_tiyin} tiyin.",
        data={
            "key": ACTIVATION_FEE_KEY,
            "previous_amount_tiyin": previous,
            "amount_tiyin": amount_tiyin,
        },
    )
    await db.commit()
    return {"amount_tiyin": amount_tiyin, **await settings_payload(db)}


@router.post("/admin/payouts/{payout_id}/mark-paid")
async def mark_payout_paid(payout_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    admin(user)
    payout = await db.scalar(select(Payout).where(Payout.id == payout_id).with_for_update())
    if payout is None:
        raise AppError(404, "payout_not_found", "Payout not found", "The payout does not exist.")
    if payout.paid_at is not None:
        raise AppError(
            409, "payout_already_paid", "Already paid", "This payout was already marked paid."
        )
    payout.status = "paid_demo"
    payout.paid_at = datetime.now(UTC)
    payout.marked_paid_by_id = user.id
    event = await db.get(Event, payout.event_id)
    if event:
        await create_notification(
            db,
            user_id=event.owner_id,
            type=NotificationType.PAYOUT_STATUS,
            title="Demonstration payout marked paid",
            body=f"Payout for {event.title} is marked paid.",
            data={
                "payout_id": str(payout.id),
                "event_id": str(event.id),
                "event_title": event.title,
                "amount_tiyin": payout.amount_tiyin,
                "status": payout.status,
                "change": "payout_paid",
            },
        )
    await record_audit(
        db,
        action="admin.payout_marked_paid",
        entity_type="payout",
        entity_id=payout.id,
        event_id=payout.event_id,
        actor_user_id=user.id,
        description=f"Marked demonstration payout of {payout.amount_tiyin} tiyin as paid.",
        data={"amount_tiyin": payout.amount_tiyin},
    )
    await db.commit()
    return {"status": payout.status, "paid_at": payout.paid_at}


@router.get("/admin/payouts")
async def list_payouts(user: CurrentUser, db: DbSession) -> list[dict]:
    admin(user)
    owner = aliased(User)
    marker = aliased(User)
    rows = (
        await db.execute(
            select(Payout, Event, owner, OrganizerProfile, marker)
            .join(Event, Event.id == Payout.event_id)
            .join(owner, owner.id == Event.owner_id)
            .outerjoin(OrganizerProfile, OrganizerProfile.user_id == Event.owner_id)
            .outerjoin(marker, marker.id == Payout.marked_paid_by_id)
            .order_by(Payout.eligible_at.desc())
            .limit(500)
        )
    ).all()
    return [
        {
            "id": str(item.id),
            "event_id": str(item.event_id),
            "event_title": event.title,
            "organizer_id": str(event_owner.id),
            "organizer_name": event_owner.display_name,
            "organizer_email": event_owner.email,
            "organization_name": profile.organization_name if profile else None,
            "payout_account_label": profile.payout_account_label if profile else None,
            "amount_tiyin": item.amount_tiyin,
            "eligible_at": item.eligible_at,
            "status": item.status,
            "paid_at": item.paid_at,
            "marked_paid_by": person(paid_by),
            "created_at": item.created_at,
        }
        for item, event, event_owner, profile, paid_by in rows
    ]


@router.get("/admin/activation-payments")
async def activation_payments(user: CurrentUser, db: DbSession) -> list[dict]:
    admin(user)
    owner = aliased(User)
    payer = aliased(User)
    rows = (
        await db.execute(
            select(Payment, Event, owner, payer)
            .join(Event, Event.id == Payment.event_id)
            .join(owner, owner.id == Event.owner_id)
            .join(payer, payer.id == Payment.user_id)
            .where(Payment.kind == "event_activation")
            .order_by(Payment.created_at.desc())
            .limit(500)
        )
    ).all()
    return [
        {
            "id": str(item.id),
            "event_id": str(item.event_id),
            "event_title": event.title,
            "organizer_id": str(event_owner.id),
            "organizer_name": event_owner.display_name,
            "organizer_email": event_owner.email,
            "payer_id": str(paid_by.id),
            "payer_name": paid_by.display_name,
            "payer_email": paid_by.email,
            "amount_tiyin": item.amount_tiyin,
            "status": item.status,
            "reference": item.provider_reference,
            "failure_reason": item.failure_reason,
            "paid_sales_active": event.paid_sales_active,
            "paid_sales_suspended": event.paid_sales_suspended,
            "created_at": item.created_at,
        }
        for item, event, event_owner, paid_by in rows
    ]


@router.get("/admin/payments")
async def list_payments(
    user: CurrentUser,
    db: DbSession,
    status: PaymentStatus | None = None,
    kind: Literal["ticket_purchase", "event_activation"] | None = None,
    q: str | None = Query(default=None, max_length=100),
    problems_only: bool = False,
    limit: int = Query(default=200, ge=1, le=500),
) -> list[dict]:
    """Payment monitor. ``problems_only`` narrows to failed and timed-out payments."""
    admin(user)
    payer = aliased(User)
    statement = (
        select(Payment, Event, payer, Order)
        .join(Event, Event.id == Payment.event_id)
        .join(payer, payer.id == Payment.user_id)
        .outerjoin(Order, Order.id == Payment.order_id)
    )
    if status is not None:
        statement = statement.where(Payment.status == status)
    if problems_only:
        statement = statement.where(
            Payment.status.in_([PaymentStatus.FAILED, PaymentStatus.TIMED_OUT])
        )
    if kind is not None:
        statement = statement.where(Payment.kind == kind)
    if q and q.strip():
        pattern = like_pattern(q)
        statement = statement.where(
            or_(
                Payment.provider_reference.ilike(pattern, escape="/"),
                Order.order_number.ilike(pattern, escape="/"),
                payer.email.ilike(pattern, escape="/"),
                Event.title.ilike(pattern, escape="/"),
            )
        )
    rows = (await db.execute(statement.order_by(Payment.created_at.desc()).limit(limit))).all()
    return [
        {
            "id": str(item.id),
            "kind": item.kind,
            "status": item.status,
            "amount_tiyin": item.amount_tiyin,
            "provider": item.provider,
            "reference": item.provider_reference,
            "failure_reason": item.failure_reason,
            "created_at": item.created_at,
            "event_id": str(item.event_id),
            "event_title": event.title,
            "order_id": str(item.order_id) if item.order_id else None,
            "order_number": order.order_number if order else None,
            "payer_id": str(paid_by.id),
            "payer_name": paid_by.display_name,
            "payer_email": paid_by.email,
        }
        for item, event, paid_by, order in rows
    ]


@router.get("/admin/refunds")
async def list_refunds(
    user: CurrentUser,
    db: DbSession,
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[dict]:
    admin(user)
    initiator = aliased(User)
    buyer = aliased(User)
    statement = (
        select(Refund, Order, Event, initiator, buyer)
        .join(Order, Order.id == Refund.order_id)
        .join(Event, Event.id == Order.event_id)
        .join(initiator, initiator.id == Refund.initiated_by_id)
        .join(buyer, buyer.id == Order.user_id)
    )
    if q and q.strip():
        pattern = like_pattern(q)
        statement = statement.where(
            or_(
                Order.order_number.ilike(pattern, escape="/"),
                Event.title.ilike(pattern, escape="/"),
                buyer.email.ilike(pattern, escape="/"),
            )
        )
    rows = (await db.execute(statement.order_by(Refund.created_at.desc()).limit(limit))).all()
    return [
        {
            "id": str(item.id),
            "status": item.status,
            "amount_tiyin": item.amount_tiyin,
            "reason": item.reason,
            "created_at": item.created_at,
            "order_id": str(order.id),
            "order_number": order.order_number,
            "order_status": order.status,
            "event_id": str(event.id),
            "event_title": event.title,
            "buyer_id": str(order_buyer.id),
            "buyer_name": order_buyer.display_name,
            "buyer_email": order_buyer.email,
            "initiated_by": person(started_by),
        }
        for item, order, event, started_by, order_buyer in rows
    ]


@router.get("/admin/campaigns")
async def list_campaign_activity(
    user: CurrentUser,
    db: DbSession,
    q: str | None = Query(default=None, max_length=100),
    enabled: bool | None = None,
    event_id: uuid.UUID | None = None,
    limit: int = Query(default=200, ge=1, le=500),
) -> list[dict]:
    """Promotion activity across all events (disable one via PATCH /campaigns/{id}/disable)."""
    admin(user)
    usage = (
        select(
            PromoRedemption.campaign_id.label("campaign_id"),
            func.count(PromoRedemption.id).label("redemptions"),
            func.coalesce(func.sum(PromoRedemption.discount_tiyin), 0).label("discount_total"),
            func.max(PromoRedemption.created_at).label("last_redeemed_at"),
        )
        .group_by(PromoRedemption.campaign_id)
        .subquery()
    )
    owner = aliased(User)
    statement = (
        select(
            Campaign,
            Event,
            owner,
            usage.c.redemptions,
            usage.c.discount_total,
            usage.c.last_redeemed_at,
        )
        .join(Event, Event.id == Campaign.event_id)
        .join(owner, owner.id == Event.owner_id)
        .outerjoin(usage, usage.c.campaign_id == Campaign.id)
    )
    if q and q.strip():
        pattern = like_pattern(q)
        statement = statement.where(
            or_(
                Campaign.code.ilike(pattern, escape="/"),
                Campaign.name.ilike(pattern, escape="/"),
                Event.title.ilike(pattern, escape="/"),
            )
        )
    if enabled is not None:
        statement = statement.where(Campaign.is_enabled.is_(enabled))
    if event_id is not None:
        statement = statement.where(Campaign.event_id == event_id)
    rows = (await db.execute(statement.order_by(Campaign.created_at.desc()).limit(limit))).all()
    return [
        {
            "id": str(campaign.id),
            "name": campaign.name,
            "code": campaign.code,
            "discount_type": campaign.discount_type,
            "discount_value": campaign.discount_value,
            "starts_at": campaign.starts_at,
            "ends_at": campaign.ends_at,
            "max_redemptions": campaign.max_redemptions,
            "is_enabled": campaign.is_enabled,
            "redemptions": int(redemptions or 0),
            "total_discount_tiyin": int(discount_total or 0),
            "last_redeemed_at": last_redeemed_at,
            "event_id": str(event.id),
            "event_title": event.title,
            "event_status": event.status,
            "organizer_name": event_owner.display_name,
            "organizer_email": event_owner.email,
            "created_at": campaign.created_at,
        }
        for campaign, event, event_owner, redemptions, discount_total, last_redeemed_at in rows
    ]


@router.get("/admin/support-cases")
async def platform_support_cases(
    user: CurrentUser,
    db: DbSession,
    scope: Literal["platform", "escalated", "organizer_to_platform", "all"] = "platform",
    status: SupportStatus | None = None,
    limit: int = Query(default=200, ge=1, le=500),
) -> list[dict]:
    """Cases needing platform attention: escalated ones and organizer-to-platform ones."""
    admin(user)
    statement = select(SupportCase)
    if scope == "platform":
        statement = statement.where(
            or_(
                SupportCase.escalated.is_(True),
                SupportCase.kind == SupportKind.ORGANIZER_TO_PLATFORM,
            )
        )
    elif scope == "escalated":
        statement = statement.where(SupportCase.escalated.is_(True))
    elif scope == "organizer_to_platform":
        statement = statement.where(SupportCase.kind == SupportKind.ORGANIZER_TO_PLATFORM)
    if status is not None:
        statement = statement.where(SupportCase.status == status)
    cases = (
        await db.scalars(statement.order_by(SupportCase.updated_at.desc()).limit(limit))
    ).all()
    return await serialize_cases(db, list(cases))


@router.get("/admin/reports/events")
async def list_event_reports(
    user: CurrentUser,
    db: DbSession,
    status: EventReportStatus | None = None,
    event_id: uuid.UUID | None = None,
    limit: int = Query(default=200, ge=1, le=500),
) -> list[dict]:
    admin(user)
    reporter = aliased(User)
    resolver = aliased(User)
    statement = (
        select(EventReport, Event, reporter, resolver)
        .join(Event, Event.id == EventReport.event_id)
        .join(reporter, reporter.id == EventReport.reporter_id)
        .outerjoin(resolver, resolver.id == EventReport.resolved_by_id)
    )
    if status is not None:
        statement = statement.where(EventReport.status == status)
    if event_id is not None:
        statement = statement.where(EventReport.event_id == event_id)
    rows = (
        await db.execute(statement.order_by(EventReport.created_at.desc()).limit(limit))
    ).all()
    open_counts: dict[uuid.UUID, int] = {}
    event_ids = {event.id for _report, event, _reporter, _resolver in rows}
    if event_ids:
        counted = await db.execute(
            select(EventReport.event_id, func.count(EventReport.id))
            .where(
                EventReport.event_id.in_(event_ids),
                EventReport.status == EventReportStatus.OPEN,
            )
            .group_by(EventReport.event_id)
        )
        open_counts = {counted_event_id: int(total) for counted_event_id, total in counted.all()}
    return [
        serialize_admin_report(report, event, reported_by, resolved_by, open_counts)
        for report, event, reported_by, resolved_by in rows
    ]


def serialize_admin_report(
    report: EventReport,
    event: Event,
    reported_by: User | None,
    resolved_by: User | None,
    open_counts: dict[uuid.UUID, int] | None = None,
) -> dict:
    return {
        "id": str(report.id),
        "category": report.category,
        "details": report.details,
        "status": report.status,
        "created_at": report.created_at,
        "event_id": str(event.id),
        "event_title": event.title,
        "event_status": event.status,
        "event_open_reports": (open_counts or {}).get(event.id, 0),
        "reporter": person(reported_by),
        "reporter_name": reported_by.display_name if reported_by else None,
        "reporter_email": reported_by.email if reported_by else None,
        "resolution_note": report.resolution_note,
        "resolved_by": person(resolved_by),
        "resolved_at": report.resolved_at,
    }


class EventReportResolution(BaseModel):
    status: Literal["resolved", "dismissed"]
    note: str = Field(default="", max_length=2_000)

    @field_validator("note", mode="before")
    @classmethod
    def strip_note(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


@router.post("/admin/reports/events/{report_id}/resolve")
async def resolve_event_report(
    report_id: uuid.UUID, payload: EventReportResolution, user: CurrentUser, db: DbSession
) -> dict:
    admin(user)
    report = await db.scalar(
        select(EventReport).where(EventReport.id == report_id).with_for_update()
    )
    if report is None:
        raise AppError(404, "report_not_found", "Report not found", "The report does not exist.")
    if report.status != EventReportStatus.OPEN:
        raise AppError(
            409, "report_already_closed", "Already closed", "This report was already handled."
        )
    event = await db.get(Event, report.event_id)
    if event is None:
        raise AppError(404, "event_not_found", "Event not found", "The event does not exist.")
    report.status = EventReportStatus(payload.status)
    report.resolution_note = payload.note or None
    report.resolved_by_id = user.id
    report.resolved_at = datetime.now(UTC)
    await record_audit(
        db,
        action="admin.event_report_resolved",
        entity_type="event_report",
        entity_id=report.id,
        event_id=report.event_id,
        actor_user_id=user.id,
        description=f"Closed event report as {payload.status}.",
        data={"status": payload.status, "note": payload.note},
    )
    await create_notification(
        db,
        user_id=report.reporter_id,
        type=NotificationType.EVENT_REPORT,
        title=f"Your report about {event.title} was reviewed",
        body=(
            "Thank you. The platform team reviewed your report and took action."
            if payload.status == "resolved"
            else "Thank you. The platform team reviewed your report and found no violation."
        ),
        data=event_change_data(
            event,
            f"report_{payload.status}",
            report_id=str(report.id),
            report_status=payload.status,
        ),
    )
    await db.commit()
    reporter = await db.get(User, report.reporter_id)
    return serialize_admin_report(report, event, reporter, user)


@router.get("/admin/reports/operations.csv")
async def operations_report(user: CurrentUser, db: DbSession) -> Response:
    admin(user)
    orders = (await db.scalars(select(Order).order_by(Order.created_at.desc()).limit(10_000))).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["order_number", "event_id", "status", "total_tiyin", "discount_tiyin", "created_at"]
    )
    for order in orders:
        writer.writerow(
            [
                order.order_number,
                order.event_id,
                order.status.value,
                order.total_tiyin,
                order.discount_tiyin,
                order.created_at.isoformat(),
            ]
        )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="biletflow-operations.csv"'},
    )
