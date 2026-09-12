import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from celery import Celery
from sqlalchemy import func, select

from app.config import settings
from app.db import SessionLocal
from app.documents import ticket_pdf
from app.enums import OrderStatus
from app.models import AnalyticsEvent, Event, Order, OrderItem, Payout, Ticket, TicketType
from app.routers.commerce import expire_checkout_sessions
from app.services import put_private_object, send_email

celery_app = Celery("biletflow", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.beat_schedule = {
    "expire-checkout-holds": {"task": "biletflow.expire_checkouts", "schedule": 60.0},
    "create-demo-payouts": {"task": "biletflow.create_demo_payouts", "schedule": 3600.0},
    "import-ga4-analytics": {"task": "biletflow.import_ga4", "schedule": 86_400.0},
}
celery_app.conf.timezone = "UTC"


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
            content = ticket_pdf(ticket, event, item, ticket_type)
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
    return asyncio.run(_deliver_order_tickets(uuid.UUID(order_id)))


@celery_app.task(
    name="biletflow.forward_ga4_event",
    autoretry_for=(httpx.HTTPError,),
    retry_backoff=True,
    max_retries=5,
)
def ga4_event_task(
    anonymous_id: str, name: str, properties: dict[str, str | int | float | bool]
) -> bool:
    if not settings.ga4_measurement_id or not settings.ga4_api_secret:
        return False
    response = httpx.post(
        "https://www.google-analytics.com/mp/collect",
        params={
            "measurement_id": settings.ga4_measurement_id,
            "api_secret": settings.ga4_api_secret,
        },
        json={"client_id": anonymous_id, "events": [{"name": name, "params": properties}]},
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
    return asyncio.run(_store_ga4_report(response.json().get("rows", [])))


async def _expire() -> int:
    async with SessionLocal() as db:
        count = await expire_checkout_sessions(db)
        await db.commit()
        return count


@celery_app.task(name="biletflow.expire_checkouts")
def expire_checkouts_task() -> int:
    return asyncio.run(_expire())


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
                db.add(
                    Payout(
                        event_id=event.id,
                        amount_tiyin=amount,
                        eligible_at=event.ends_at + timedelta(days=2),
                    )
                )
                created += 1
        await db.commit()
        return created


@celery_app.task(name="biletflow.create_demo_payouts")
def create_demo_payouts_task() -> int:
    return asyncio.run(_create_payouts())
