import csv
import io
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Query
from fastapi.responses import Response
from sqlalchemy import or_, select

from app.deps import CurrentUser, DbSession, require_role
from app.enums import EventStatus, NotificationType, UserRole
from app.errors import AppError
from app.models import Event, Notification, Order, Payment, Payout, SystemSetting, User
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


@router.get("/admin/search")
async def platform_search(
    user: CurrentUser,
    db: DbSession,
    q: str = Query(min_length=2, max_length=100),
) -> dict:
    admin(user)
    pattern = f"%{q}%"
    users = (
        await db.scalars(
            select(User)
            .where(or_(User.email.ilike(pattern), User.display_name.ilike(pattern)))
            .limit(30)
        )
    ).all()
    events = (
        await db.scalars(
            select(Event)
            .where(or_(Event.title.ilike(pattern), Event.slug.ilike(pattern)))
            .limit(30)
        )
    ).all()
    orders = (
        await db.scalars(select(Order).where(Order.order_number.ilike(pattern)).limit(30))
    ).all()
    payments = (
        await db.scalars(select(Payment).where(Payment.provider_reference.ilike(pattern)).limit(30))
    ).all()
    return {
        "users": [
            {
                "id": str(item.id),
                "email": item.email,
                "display_name": item.display_name,
                "suspended": item.is_suspended,
            }
            for item in users
        ],
        "events": [
            {"id": str(item.id), "title": item.title, "status": item.status} for item in events
        ],
        "orders": [
            {"id": str(item.id), "number": item.order_number, "status": item.status}
            for item in orders
        ],
        "payments": [
            {
                "id": str(item.id),
                "reference": item.provider_reference,
                "status": item.status,
                "amount_tiyin": item.amount_tiyin,
            }
            for item in payments
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
        data={"reason": reason},
    )
    await db.commit()
    return {"suspended": suspended}


@router.post("/admin/events/{event_id}/suspension")
async def suspend_event(
    event_id: uuid.UUID, suspended: bool, reason: str, user: CurrentUser, db: DbSession
) -> dict:
    admin(user)
    event = await db.get(Event, event_id)
    if event is None:
        raise AppError(404, "event_not_found", "Event not found", "The event does not exist.")
    event.status = EventStatus.SUSPENDED if suspended else EventStatus.UNPUBLISHED
    event.paid_sales_suspended = suspended
    await create_notification(
        db,
        user_id=event.owner_id,
        type=NotificationType.EVENT_UPDATED,
        title=f"Moderation update for {event.title}",
        body=f"Suspension set to {suspended}. Reason: {reason}",
        data={"event_id": str(event.id)},
    )
    await record_audit(
        db,
        action="admin.event_suspension_changed",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor_user_id=user.id,
        description=f"Set event suspension to {suspended}.",
        data={"reason": reason},
    )
    await db.commit()
    return {"status": event.status, "paid_sales_suspended": event.paid_sales_suspended}


@router.put("/admin/settings/activation-fee")
async def activation_fee(amount_tiyin: int, user: CurrentUser, db: DbSession) -> dict:
    admin(user)
    if amount_tiyin < 0:
        raise AppError(422, "invalid_amount", "Invalid amount", "Amount must be non-negative.")
    setting = await db.scalar(
        select(SystemSetting).where(SystemSetting.key == "activation_fee_tiyin")
    )
    if setting is None:
        setting = SystemSetting(
            key="activation_fee_tiyin", value={"amount_tiyin": amount_tiyin}, updated_by_id=user.id
        )
        db.add(setting)
    else:
        setting.value = {"amount_tiyin": amount_tiyin}
        setting.updated_by_id = user.id
    await db.commit()
    return setting.value


@router.post("/admin/payouts/{payout_id}/mark-paid")
async def mark_payout_paid(payout_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    admin(user)
    payout = await db.get(Payout, payout_id)
    if payout is None:
        raise AppError(404, "payout_not_found", "Payout not found", "The payout does not exist.")
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
            data={"payout_id": str(payout.id)},
        )
    await db.commit()
    return {"status": payout.status, "paid_at": payout.paid_at}


@router.get("/admin/payouts")
async def list_payouts(user: CurrentUser, db: DbSession) -> list[dict]:
    admin(user)
    payouts = (
        await db.scalars(select(Payout).order_by(Payout.eligible_at.desc()).limit(500))
    ).all()
    return [
        {
            "id": str(item.id),
            "event_id": str(item.event_id),
            "amount_tiyin": item.amount_tiyin,
            "eligible_at": item.eligible_at,
            "status": item.status,
            "paid_at": item.paid_at,
        }
        for item in payouts
    ]


@router.get("/admin/activation-payments")
async def activation_payments(user: CurrentUser, db: DbSession) -> list[dict]:
    admin(user)
    items = (
        await db.scalars(
            select(Payment)
            .where(Payment.kind == "event_activation")
            .order_by(Payment.created_at.desc())
            .limit(500)
        )
    ).all()
    return [
        {
            "id": str(item.id),
            "event_id": str(item.event_id),
            "amount_tiyin": item.amount_tiyin,
            "status": item.status,
            "created_at": item.created_at,
        }
        for item in items
    ]


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
