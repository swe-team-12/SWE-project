import uuid
from collections import Counter, defaultdict
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.access import get_event_or_404, require_event_permission
from app.deps import CurrentUser, DbSession
from app.enums import CheckoutStatus, OrderStatus, StaffRole, TicketStatus
from app.errors import AppError
from app.models import (
    AnalyticsEvent,
    AuditLog,
    Campaign,
    CheckoutLine,
    CheckoutSession,
    Order,
    OrderItem,
    PromoRedemption,
    Refund,
    Ticket,
    TicketType,
)
from app.schemas import AnalyticsCapture
from app.services import enqueue_ga4_event

router = APIRouter(tags=["analytics and history"])


@router.post("/analytics/capture", status_code=202)
async def capture_analytics(payload: AnalyticsCapture, db: DbSession) -> dict:
    safe_properties = {
        key: value
        for key, value in payload.properties.items()
        if key in {"source", "medium", "device_category", "locale", "route"}
        and isinstance(value, (str, int, float, bool))
    }
    if payload.event_id:
        safe_properties["event_id"] = str(payload.event_id)
    if payload.campaign_id:
        safe_properties["campaign_id"] = str(payload.campaign_id)
    db.add(
        AnalyticsEvent(
            event_id=payload.event_id,
            campaign_id=payload.campaign_id,
            anonymous_id=payload.anonymous_id,
            name=payload.name,
            properties=safe_properties,
        )
    )
    await db.commit()
    enqueue_ga4_event(payload.anonymous_id, payload.name, safe_properties)
    return {"accepted": True}


@router.get("/events/{event_id}/analytics")
async def event_analytics(
    event_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    start: date | None = None,
    end: date | None = None,
    ticket_type_id: uuid.UUID | None = None,
) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    start_date = start or (datetime.now(UTC).date() - timedelta(days=30))
    end_date = end or datetime.now(UTC).date()
    ticket_types = (
        await db.scalars(select(TicketType).where(TicketType.event_id == event.id))
    ).all()
    if ticket_type_id and ticket_type_id not in {item.id for item in ticket_types}:
        raise AppError(
            404,
            "ticket_type_not_found",
            "Ticket type not found",
            "The ticket type does not belong to this event.",
        )
    visible_types = [
        item for item in ticket_types if ticket_type_id is None or item.id == ticket_type_id
    ]
    type_by_id = {item.id: item for item in visible_types}
    capacity = event.capacity if ticket_type_id is None else sum(
        item.quantity for item in visible_types
    )
    order_statement = select(Order).where(
        Order.event_id == event.id,
        Order.created_at >= datetime.combine(start_date, datetime.min.time(), tzinfo=UTC),
        Order.created_at
        < datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=UTC),
    )
    orders = (await db.scalars(order_statement)).all()
    order_ids = [order.id for order in orders]
    items: Sequence[OrderItem] = []
    if order_ids:
        item_statement = select(OrderItem).where(OrderItem.order_id.in_(order_ids))
        if ticket_type_id:
            item_statement = item_statement.where(OrderItem.ticket_type_id == ticket_type_id)
        items = (await db.scalars(item_statement)).all()
    completed_orders = [
        order
        for order in orders
        if order.status
        in {OrderStatus.PAID, OrderStatus.FREE, OrderStatus.REFUNDED, OrderStatus.CANCELLED}
    ]
    historical_paid_orders = [order for order in completed_orders if order.total_tiyin > 0]
    refunds: Sequence[Refund] = []
    if order_ids:
        refunds = (await db.scalars(select(Refund).where(Refund.order_id.in_(order_ids)))).all()
    item_ids = [item.id for item in items]
    tickets: Sequence[Ticket] = []
    if item_ids:
        tickets = (
            await db.scalars(select(Ticket).where(Ticket.order_item_id.in_(item_ids)))
        ).all()
    ticket_by_item_id = {ticket.order_item_id: ticket for ticket in tickets}
    sold = sum(ticket.status in {TicketStatus.VALID, TicketStatus.CHECKED_IN} for ticket in tickets)
    checked_in = sum(ticket.status == TicketStatus.CHECKED_IN for ticket in tickets)
    refunded_tickets = sum(ticket.status == TicketStatus.REFUNDED for ticket in tickets)
    cancelled_tickets = sum(ticket.status == TicketStatus.CANCELLED for ticket in tickets)
    reserved_rows = (
        await db.execute(
            select(CheckoutLine.ticket_type_id, CheckoutLine.quantity)
            .join(CheckoutSession, CheckoutSession.id == CheckoutLine.session_id)
            .where(
                CheckoutSession.event_id == event.id,
                CheckoutSession.status == CheckoutStatus.OPEN,
                CheckoutSession.expires_at > datetime.now(UTC),
            )
        )
    ).all()
    reserved_by_type: Counter[uuid.UUID] = Counter()
    for reserved_type_id, quantity in reserved_rows:
        if reserved_type_id in type_by_id:
            reserved_by_type[reserved_type_id] += quantity
    reserved = sum(reserved_by_type.values())
    gross = sum(order.subtotal_tiyin for order in historical_paid_orders)
    discounts = sum(order.discount_tiyin for order in historical_paid_orders)
    processor_fees = sum(order.processing_fee_tiyin for order in historical_paid_orders)
    refunded = sum(item.amount_tiyin for item in refunds)
    net = sum(order.organizer_net_tiyin for order in historical_paid_orders) - refunded

    sales_by_day: dict[str, dict[str, int]] = defaultdict(
        lambda: {"orders": 0, "tickets": 0, "revenue_tiyin": 0}
    )
    for order in completed_orders:
        key = order.created_at.date().isoformat()
        sales_by_day[key]["orders"] += 1
        sales_by_day[key]["revenue_tiyin"] += order.total_tiyin
    order_by_id = {order.id: order for order in completed_orders}
    for item in items:
        item_order = order_by_id.get(item.order_id)
        if item_order:
            sales_by_day[item_order.created_at.date().isoformat()]["tickets"] += 1
    by_type: dict[str, dict] = {}
    for ticket_type in visible_types:
        type_items = [item for item in items if item.ticket_type_id == ticket_type.id]
        type_tickets = [
            ticket_by_item_id[item.id]
            for item in type_items
            if item.id in ticket_by_item_id
        ]
        active = sum(
            ticket.status in {TicketStatus.VALID, TicketStatus.CHECKED_IN}
            for ticket in type_tickets
        )
        type_reserved = reserved_by_type[ticket_type.id]
        type_revenue = 0
        for type_item in type_items:
            type_order = order_by_id.get(type_item.order_id)
            if type_order and type_order.total_tiyin > 0:
                type_revenue += type_item.unit_price_tiyin
        by_type[str(ticket_type.id)] = {
            "ticket_type_id": str(ticket_type.id),
            "name": ticket_type.name,
            "capacity": ticket_type.quantity,
            "available": max(0, ticket_type.quantity - active - type_reserved),
            "reserved": type_reserved,
            "sold": active,
            "refunded": sum(
                ticket.status == TicketStatus.REFUNDED for ticket in type_tickets
            ),
            "cancelled": sum(
                ticket.status == TicketStatus.CANCELLED for ticket in type_tickets
            ),
            "checked_in": sum(
                ticket.status == TicketStatus.CHECKED_IN for ticket in type_tickets
            ),
            "revenue_tiyin": type_revenue,
        }
    campaigns = (await db.scalars(select(Campaign).where(Campaign.event_id == event.id))).all()
    campaign_rows = []
    for campaign in campaigns:
        redemptions: Sequence[PromoRedemption] = []
        if order_ids:
            redemptions = (
                await db.scalars(
                    select(PromoRedemption).where(
                        PromoRedemption.campaign_id == campaign.id,
                        PromoRedemption.order_id.in_(order_ids),
                    )
                )
            ).all()
        campaign_order_ids = [item.order_id for item in redemptions]
        attributed_orders = [
            order for order in completed_orders if order.id in campaign_order_ids
        ]
        attributed_refunds = [
            refund for refund in refunds if refund.order_id in campaign_order_ids
        ]
        campaign_rows.append(
            {
                "campaign_id": str(campaign.id),
                "name": campaign.name,
                "redemptions": len(redemptions),
                "orders": len(attributed_orders),
                "tickets": sum(item.order_id in campaign_order_ids for item in items),
                "gross_tiyin": sum(order.subtotal_tiyin for order in attributed_orders),
                "discount_tiyin": sum(item.discount_tiyin for item in redemptions),
                "refund_tiyin": sum(item.amount_tiyin for item in attributed_refunds),
                "net_tiyin": sum(order.organizer_net_tiyin for order in attributed_orders)
                - sum(item.amount_tiyin for item in attributed_refunds),
            }
        )
    traffic = (
        await db.scalars(
            select(AnalyticsEvent).where(
                AnalyticsEvent.event_id == event.id,
                AnalyticsEvent.occurred_at
                >= datetime.combine(start_date, datetime.min.time(), tzinfo=UTC),
            )
        )
    ).all()
    funnel_counts: Counter[str] = Counter()
    for traffic_item in traffic:
        funnel_counts[traffic_item.name] += int(traffic_item.properties.get("event_count", 1))
    traffic_source = (
        "ga4_data_api"
        if any(traffic_item.properties.get("source") == "ga4_data_api" for traffic_item in traffic)
        else "local_privacy_safe_events"
    )
    return {
        "range": {"start": start_date, "end": end_date},
        "kpis": {
            "capacity": capacity,
            "tickets_sold": sold,
            "tickets_reserved": reserved,
            "tickets_refunded": refunded_tickets,
            "tickets_cancelled": cancelled_tickets,
            "tickets_remaining": max(0, capacity - sold - reserved),
            "percentage_sold": round((sold / capacity * 100) if capacity else 0, 1),
            "gross_sales_tiyin": gross,
            "discounts_tiyin": discounts,
            "processing_fees_tiyin": processor_fees,
            "refunds_tiyin": refunded,
            "net_demo_revenue_tiyin": net,
            "checked_in": checked_in,
            "absent": max(0, sold - checked_in),
            "check_in_percentage": round((checked_in / sold * 100) if sold else 0, 1),
        },
        "sales_over_time": [{"date": key, **value} for key, value in sorted(sales_by_day.items())],
        "ticket_types": list(by_type.values()),
        "campaigns": campaign_rows,
        "traffic_funnel": {
            "source": traffic_source,
            "event_views": funnel_counts["event_view"],
            "campaign_views": funnel_counts["campaign_view"],
            "checkout_starts": funnel_counts["checkout_start"],
            "demo_purchases": funnel_counts["purchase_demo"],
        },
    }


@router.get("/events/{event_id}/history")
async def event_history(
    event_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    start: datetime | None = None,
    end: datetime | None = None,
    activity_type: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict]:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user)
    statement = select(AuditLog).where(AuditLog.event_id == event.id)
    if start:
        statement = statement.where(AuditLog.occurred_at >= start)
    if end:
        statement = statement.where(AuditLog.occurred_at <= end)
    if activity_type:
        statement = statement.where(AuditLog.action == activity_type)
    entries = (await db.scalars(statement.order_by(AuditLog.occurred_at.desc()).limit(limit))).all()
    return [
        {
            "id": str(entry.id),
            "timestamp": entry.occurred_at,
            "actor_user_id": str(entry.actor_user_id) if entry.actor_user_id else None,
            "action": entry.action,
            "entity_type": entry.entity_type,
            "entity_id": str(entry.entity_id) if entry.entity_id else None,
            "description": entry.description,
            "data": entry.data,
        }
        for entry in entries
    ]
