import asyncio
import hashlib
import re
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from celery import Celery
from sqlalchemy import func, select

from app.config import settings
from app.db import SessionLocal, engine
from app.documents import ticket_pdf
from app.enums import NotificationType, OrderStatus
from app.models import AnalyticsEvent, Event, Order, OrderItem, Payout, Ticket, TicketType
from app.routers.commerce import expire_checkout_sessions
from app.services import create_notification, put_private_object, record_audit, send_email

celery_app = Celery("biletflow", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.beat_schedule = {
    "expire-checkout-holds": {"task": "biletflow.expire_checkouts", "schedule": 60.0},
    "create-demo-payouts": {"task": "biletflow.create_demo_payouts", "schedule": 3600.0},
    "import-ga4-analytics": {"task": "biletflow.import_ga4", "schedule": 86_400.0},
}
celery_app.conf.timezone = "UTC"

GA4_COLLECT_URL = "https://www.google-analytics.com/mp/collect"
# Event names and parameters that may leave the platform. Nothing else is forwarded.
GA4_EVENT_NAMES = frozenset({"event_view", "campaign_view", "checkout_start", "purchase_demo"})
GA4_PARAM_KEYS = frozenset(
    {"event_id", "campaign_id", "source", "medium", "device_category", "locale", "route"}
)
GA4_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,39}$")
GA4_CLIENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def run_async[T](factory: Callable[[], Awaitable[T]]) -> T:
    """Run one coroutine per task and drop pooled connections bound to its loop.

    Every Celery task gets a fresh event loop from ``asyncio.run``; connections left in
    the engine pool would belong to a closed loop and break the next task.
    """

    async def runner() -> T:
        try:
            return await factory()
        finally:
            await engine.dispose()

    return asyncio.run(runner())


def ga4_client_id(anonymous_id: str) -> str:
    """Opaque client id; anything that could be personal data is hashed first."""
    if GA4_CLIENT_ID_PATTERN.match(anonymous_id) and "@" not in anonymous_id:
        return anonymous_id
    return hashlib.sha256(anonymous_id.encode()).hexdigest()[:32]


def build_ga4_payload(
    anonymous_id: str, name: str, properties: dict[str, Any]
) -> dict[str, Any] | None:
    """Measurement Protocol body for one event, or None when it must not be sent."""
    if not anonymous_id or not GA4_NAME_PATTERN.match(name):
        return None
    params: dict[str, str | int | float | bool] = {}
    for key, value in properties.items():
        if key not in GA4_PARAM_KEYS or not isinstance(value, (str, int, float, bool)):
            continue
        if isinstance(value, str):
            if "@" in value:
                continue
            value = value[:100]
        params[key] = value
    # Required for the event to be counted as user engagement in GA4 reports.
    params["engagement_time_msec"] = 1
    return {
        "client_id": ga4_client_id(anonymous_id),
        "non_personalized_ads": True,
        "events": [{"name": name, "params": params}],
    }


@celery_app.task(
    name="biletflow.send_email", autoretry_for=(Exception,), retry_backoff=True, max_retries=5
)
def email_task(to: str, subject: str, body: str) -> None:
    send_email(to, subject, body)


async def _deliver_order_tickets(order_id: uuid.UUID) -> int:
    deliveries: list[tuple[str, str, bytes]] = []
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        if order is None:
            return 0
        event = await db.get(Event, order.event_id)
        if event is None:
            return 0
        rows = (
            await db.execute(
                select(Ticket, OrderItem, TicketType)
                .join(OrderItem, OrderItem.id == Ticket.order_item_id)
                .join(TicketType, TicketType.id == OrderItem.ticket_type_id)
                .where(OrderItem.order_id == order.id)
            )
        ).all()
        for ticket, item, ticket_type in rows:
            content = ticket_pdf(ticket, event, item, ticket_type, order.order_number)
            key = f"tickets/{event.id}/{ticket.id}.pdf"
            put_private_object(key, content, "application/pdf")
            ticket.pdf_object_key = key
            deliveries.append((item.attendee_email, ticket.ticket_code, content))
        await db.commit()
    for recipient, code, content in deliveries:
        send_email(
            recipient,
            f"Your BiletFlow ticket {code}",
            "Your demonstration ticket is attached. Keep its admission QR private.",
            attachments=[(f"{code}.pdf", content, "application/pdf")],
        )
    return len(deliveries)


@celery_app.task(
    name="biletflow.deliver_order_tickets",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=5,
)
def deliver_order_tickets_task(order_id: str) -> int:
    return run_async(lambda: _deliver_order_tickets(uuid.UUID(order_id)))


@celery_app.task(
    name="biletflow.forward_ga4_event",
    autoretry_for=(httpx.HTTPError,),
    retry_backoff=True,
    max_retries=5,
)
def ga4_event_task(
    anonymous_id: str, name: str, properties: dict[str, str | int | float | bool]
) -> bool:
    return forward_ga4_event(anonymous_id, name, properties)


def forward_ga4_event(anonymous_id: str, name: str, properties: dict[str, Any]) -> bool:
    """Send one privacy-safe event to GA4; a silent no-op without credentials."""
    if not settings.ga4_measurement_id or not settings.ga4_api_secret:
        return False
    payload = build_ga4_payload(anonymous_id, name, properties)
    if payload is None:
        return False
    response = httpx.post(
        GA4_COLLECT_URL,
        params={
            "measurement_id": settings.ga4_measurement_id,
            "api_secret": settings.ga4_api_secret,
        },
        json=payload,
        timeout=15,
    )
    response.raise_for_status()
    return True


async def _store_ga4_report(rows: list[dict]) -> int:
    imported = 0
    allowed = {"campaign_view", "event_view", "checkout_start", "purchase_demo"}
    async with SessionLocal() as db:
        for row in rows:
            dimensions = row.get("dimensionValues", [])
            metrics = row.get("metricValues", [])
            if len(dimensions) < 2 or not metrics:
                continue
            name = dimensions[0].get("value")
            raw_date = dimensions[1].get("value")
            if name not in allowed or not raw_date:
                continue
            try:
                occurred_at = datetime.strptime(raw_date, "%Y%m%d").replace(tzinfo=UTC)
                count = max(0, int(metrics[0].get("value", "0")))
            except (TypeError, ValueError):
                continue
            event_id = None
            if len(dimensions) > 2 and dimensions[2].get("value"):
                try:
                    event_id = uuid.UUID(dimensions[2]["value"])
                except ValueError:
                    pass
            import_key = f"ga4:{raw_date}:{name}:{event_id or 'global'}"
            item = await db.scalar(
                select(AnalyticsEvent).where(AnalyticsEvent.anonymous_id == import_key)
            )
            if item is None:
                item = AnalyticsEvent(
                    event_id=event_id,
                    anonymous_id=import_key,
                    name=name,
                    occurred_at=occurred_at,
                    properties={"source": "ga4_data_api", "event_count": count},
                )
                db.add(item)
            else:
                item.properties = {"source": "ga4_data_api", "event_count": count}
            imported += 1
        await db.commit()
    return imported


@celery_app.task(
    name="biletflow.import_ga4",
    autoretry_for=(httpx.HTTPError,),
    retry_backoff=True,
    max_retries=5,
)
def import_ga4_task() -> int:
    if not settings.ga4_property_id or not settings.ga4_access_token:
        return 0
    response = httpx.post(
        (
            "https://analyticsdata.googleapis.com/v1beta/properties/"
            f"{settings.ga4_property_id}:runReport"
        ),
        headers={"Authorization": f"Bearer {settings.ga4_access_token}"},
        json={
            "dateRanges": [{"startDate": "30daysAgo", "endDate": "today"}],
            "dimensions": [
                {"name": "eventName"},
                {"name": "date"},
                {"name": settings.ga4_event_dimension},
            ],
            "metrics": [{"name": "eventCount"}],
        },
        timeout=30,
    )
    response.raise_for_status()
    rows = response.json().get("rows", [])
    return run_async(lambda: _store_ga4_report(rows))


async def _expire() -> int:
    async with SessionLocal() as db:
        count = await expire_checkout_sessions(db)
        await db.commit()
        return count


@celery_app.task(name="biletflow.expire_checkouts")
def expire_checkouts_task() -> int:
    return run_async(_expire)


async def _create_payouts() -> int:
    async with SessionLocal() as db:
        now = datetime.now(UTC)
        events = (
            await db.scalars(select(Event).where(Event.ends_at < now - timedelta(days=2)))
        ).all()
        created = 0
        for event in events:
            exists = await db.scalar(select(Payout.id).where(Payout.event_id == event.id))
            if exists:
                continue
            amount = await db.scalar(
                select(func.coalesce(func.sum(Order.organizer_net_tiyin), 0)).where(
                    Order.event_id == event.id, Order.status == OrderStatus.PAID
                )
            )
            if amount and amount > 0:
                payout = Payout(
                    event_id=event.id,
                    amount_tiyin=amount,
                    eligible_at=event.ends_at + timedelta(days=2),
                    status="scheduled",
                )
                db.add(payout)
                await db.flush()
                await record_audit(
                    db,
                    action="payout.scheduled",
                    entity_type="payout",
                    entity_id=payout.id,
                    description="Demonstration payout scheduled",
                    event_id=event.id,
                    data={"amount_tiyin": int(amount), "status": payout.status},
                )
                await create_notification(
                    db,
                    user_id=event.owner_id,
                    type=NotificationType.PAYOUT_STATUS,
                    title="Payout scheduled",
                    body=f"A demonstration payout for {event.title} has been scheduled.",
                    data={
                        "event_id": str(event.id),
                        "event_title": event.title,
                        "payout_id": str(payout.id),
                        "amount_tiyin": int(amount),
                        "status": payout.status,
                        "eligible_at": payout.eligible_at.isoformat(),
                    },
                )
                created += 1
        await db.commit()
        return created


@celery_app.task(name="biletflow.create_demo_payouts")
def create_demo_payouts_task() -> int:
    return run_async(_create_payouts)
