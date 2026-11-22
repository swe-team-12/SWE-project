import uuid
from collections import Counter, defaultdict
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, or_, select

from app.access import get_event_or_404, require_event_permission
from app.deps import CurrentUser, DbSession
from app.documents import event_zone
from app.enums import CheckoutStatus, OrderStatus, StaffRole, TicketStatus
from app.errors import AppError
from app.models import (
    AnalyticsEvent,
    AuditLog,
    Campaign,
    CheckoutLine,
    CheckoutSession,
    Event,
    Order,
    OrderItem,
    Payout,
    PromoRedemption,
    Refund,
    Ticket,
    TicketType,
    User,
)
from app.schemas import AnalyticsCapture
from app.services import enqueue_ga4_event

router = APIRouter(tags=["analytics and history"])

# Only these non-personal keys are ever stored or forwarded to GA4.
SAFE_ANALYTICS_PROPERTIES = frozenset({"source", "medium", "device_category", "locale", "route"})
PAYOUT_DELAY = timedelta(days=2)


def safe_analytics_properties(properties: dict) -> dict[str, str | int | float | bool]:
    """Drop everything that is not an allow-listed, scalar, non-personal property."""
    safe: dict[str, str | int | float | bool] = {}
    for key, value in properties.items():
        if key not in SAFE_ANALYTICS_PROPERTIES or not isinstance(value, (str, int, float, bool)):
            continue
        if isinstance(value, str):
            if "@" in value:
                continue
            value = value[:100]
        safe[key] = value
    return safe


@router.post("/analytics/capture", status_code=202)
async def capture_analytics(payload: AnalyticsCapture, db: DbSession) -> dict:
    safe_properties = safe_analytics_properties(payload.properties)
    # Unknown ids are dropped instead of failing on the foreign key.
    event_id = payload.event_id
    if event_id and await db.scalar(select(Event.id).where(Event.id == event_id)) is None:
        event_id = None
    campaign_id = payload.campaign_id
    if campaign_id:
        campaign_event_id = await db.scalar(
            select(Campaign.event_id).where(Campaign.id == campaign_id)
        )
        if campaign_event_id is None:
            campaign_id = None
        elif event_id is None:
            event_id = campaign_event_id
    if event_id:
        safe_properties["event_id"] = str(event_id)
    if campaign_id:
        safe_properties["campaign_id"] = str(campaign_id)
    db.add(
        AnalyticsEvent(
            event_id=event_id,
            campaign_id=campaign_id,
            anonymous_id=payload.anonymous_id,
            name=payload.name,
            properties=safe_properties,
        )
    )
    await db.commit()
    enqueue_ga4_event(payload.anonymous_id, payload.name, safe_properties)
    return {"accepted": True}


def percentage(part: int | float, whole: int | float) -> float:
    return round((part / whole * 100) if whole else 0, 1)


def order_share(order: Order, filtered_items: Sequence[OrderItem], filtered: bool) -> float:
    """Portion of an order's money that belongs to the selected ticket type."""
    if not filtered:
        return 1.0
    if not order.subtotal_tiyin:
        return 0.0
    return min(1.0, sum(item.unit_price_tiyin for item in filtered_items) / order.subtotal_tiyin)


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
    if start and end and end < start:
        raise AppError(422, "invalid_date_range", "Invalid range", "end must not precede start.")
    # Without an explicit range the whole life of the event is covered.
    lower = datetime.combine(start, time.min, tzinfo=UTC) if start else None
    upper = datetime.combine(end + timedelta(days=1), time.min, tzinfo=UTC) if end else None
    now = datetime.now(UTC)
    ticket_types = (
        await db.scalars(
            select(TicketType).where(TicketType.event_id == event.id).order_by(TicketType.created_at)
        )
    ).all()
    if ticket_type_id and ticket_type_id not in {item.id for item in ticket_types}:
        raise AppError(
            404,
            "ticket_type_not_found",
            "Ticket type not found",
            "The ticket type does not belong to this event.",
        )
    filtered = ticket_type_id is not None
    visible_types = [
        item for item in ticket_types if ticket_type_id is None or item.id == ticket_type_id
    ]
    type_by_id = {item.id: item for item in visible_types}
    capacity = event.capacity if not filtered else sum(item.quantity for item in visible_types)
    order_statement = select(Order).where(Order.event_id == event.id)
    if lower:
        order_statement = order_statement.where(Order.created_at >= lower)
    if upper:
        order_statement = order_statement.where(Order.created_at < upper)
    orders = (await db.scalars(order_statement)).all()
    order_ids = [order.id for order in orders]
    items: Sequence[OrderItem] = []
    if order_ids:
        item_statement = select(OrderItem).where(OrderItem.order_id.in_(order_ids))
        if ticket_type_id:
            item_statement = item_statement.where(OrderItem.ticket_type_id == ticket_type_id)
        items = (await db.scalars(item_statement)).all()
    items_by_order: dict[uuid.UUID, list[OrderItem]] = defaultdict(list)
    for item in items:
        items_by_order[item.order_id].append(item)
    completed_orders = [
        order
        for order in orders
        if order.status
        in {OrderStatus.PAID, OrderStatus.FREE, OrderStatus.REFUNDED, OrderStatus.CANCELLED}
        and (not filtered or items_by_order.get(order.id))
    ]
    share = {
        order.id: order_share(order, items_by_order.get(order.id, []), filtered)
        for order in completed_orders
    }
    historical_paid_orders = [order for order in completed_orders if order.total_tiyin > 0]
    refunds: Sequence[Refund] = []
    if order_ids:
        refunds = (await db.scalars(select(Refund).where(Refund.order_id.in_(order_ids)))).all()
    refunds = [refund for refund in refunds if refund.order_id in share]
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
                CheckoutSession.expires_at > now,
            )
        )
    ).all()
    reserved_by_type: Counter[uuid.UUID] = Counter()
    for reserved_type_id, quantity in reserved_rows:
        if reserved_type_id in type_by_id:
            reserved_by_type[reserved_type_id] += quantity
    reserved = sum(reserved_by_type.values())

    def money(value: int, order: Order) -> int:
        return round(value * share[order.id])

    order_by_id = {order.id: order for order in completed_orders}
    gross = sum(money(order.subtotal_tiyin, order) for order in historical_paid_orders)
    discounts = sum(money(order.discount_tiyin, order) for order in historical_paid_orders)
    processor_fees = sum(
        money(order.processing_fee_tiyin, order) for order in historical_paid_orders
    )
    refunded = sum(money(item.amount_tiyin, order_by_id[item.order_id]) for item in refunds)
    net = (
        sum(money(order.organizer_net_tiyin, order) for order in historical_paid_orders)
        - refunded
    )
    # What the organizer keeps today: only orders that are still paid count.
    organizer_net = sum(
        money(order.organizer_net_tiyin, order)
        for order in completed_orders
        if order.status == OrderStatus.PAID
    )
    payouts = (
        await db.scalars(select(Payout).where(Payout.event_id == event.id))
    ).all()
    paid_out = sum(item.amount_tiyin for item in payouts if item.status == "paid")

    zone = event_zone(event)
    sales_by_day: dict[str, dict[str, int]] = defaultdict(
        lambda: {"orders": 0, "tickets": 0, "revenue_tiyin": 0}
    )
    for order in completed_orders:
        key = order.created_at.astimezone(zone).date().isoformat()
        sales_by_day[key]["orders"] += 1
        sales_by_day[key]["revenue_tiyin"] += money(order.total_tiyin, order)
    for item in items:
        item_order = order_by_id.get(item.order_id)
        if item_order:
            sales_by_day[item_order.created_at.astimezone(zone).date().isoformat()]["tickets"] += 1
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
        type_checked_in = sum(
            ticket.status == TicketStatus.CHECKED_IN for ticket in type_tickets
        )
        by_type[str(ticket_type.id)] = {
            "id": str(ticket_type.id),
            "ticket_type_id": str(ticket_type.id),
            "name": ticket_type.name,
            "price_tiyin": ticket_type.price_tiyin,
            "quantity": ticket_type.quantity,
            "capacity": ticket_type.quantity,
            "available": max(0, ticket_type.quantity - active - type_reserved),
            "reserved": type_reserved,
            "held": type_reserved,
            "sold": active,
            "refunded": sum(
                ticket.status == TicketStatus.REFUNDED for ticket in type_tickets
            ),
            "cancelled": sum(
                ticket.status == TicketStatus.CANCELLED for ticket in type_tickets
            ),
            "checked_in": type_checked_in,
            "percent_sold": percentage(active, ticket_type.quantity),
            "revenue_tiyin": type_revenue,
            "gross_revenue_tiyin": type_revenue,
            "is_hidden": ticket_type.is_hidden,
        }

    traffic_statement = select(AnalyticsEvent).where(AnalyticsEvent.event_id == event.id)
    if lower:
        traffic_statement = traffic_statement.where(AnalyticsEvent.occurred_at >= lower)
    if upper:
        traffic_statement = traffic_statement.where(AnalyticsEvent.occurred_at < upper)
    traffic = (await db.scalars(traffic_statement)).all()
    funnel_counts: Counter[str] = Counter()
    campaign_views: Counter[uuid.UUID] = Counter()
    for traffic_item in traffic:
        try:
            count = max(0, int(traffic_item.properties.get("event_count", 1)))
        except (TypeError, ValueError):
            count = 1
        funnel_counts[traffic_item.name] += count
        if traffic_item.name == "campaign_view" and traffic_item.campaign_id:
            campaign_views[traffic_item.campaign_id] += count
    traffic_source = (
        "ga4_data_api"
        if any(traffic_item.properties.get("source") == "ga4_data_api" for traffic_item in traffic)
        else "local_privacy_safe_events"
    )

    campaigns = (
        await db.scalars(
            select(Campaign).where(Campaign.event_id == event.id).order_by(Campaign.created_at)
        )
    ).all()
    campaign_ids = [campaign.id for campaign in campaigns]
    redemptions_by_campaign: dict[uuid.UUID, list[PromoRedemption]] = defaultdict(list)
    checkouts_by_campaign: Counter[uuid.UUID] = Counter()
    if campaign_ids:
        if order_ids:
            for redemption in (
                await db.scalars(
                    select(PromoRedemption).where(
                        PromoRedemption.campaign_id.in_(campaign_ids),
                        PromoRedemption.order_id.in_(order_ids),
                    )
                )
            ).all():
                redemptions_by_campaign[redemption.campaign_id].append(redemption)
        checkout_statement = (
            select(CheckoutSession.campaign_id, func.count())
            .where(
                CheckoutSession.event_id == event.id,
                CheckoutSession.campaign_id.in_(campaign_ids),
            )
            .group_by(CheckoutSession.campaign_id)
        )
        if lower:
            checkout_statement = checkout_statement.where(CheckoutSession.created_at >= lower)
        if upper:
            checkout_statement = checkout_statement.where(CheckoutSession.created_at < upper)
        for campaign_id, count in (await db.execute(checkout_statement)).all():
            checkouts_by_campaign[campaign_id] = count
    campaign_rows = []
    for campaign in campaigns:
        redemptions = [
            item for item in redemptions_by_campaign[campaign.id] if item.order_id in share
        ]
        campaign_order_ids = {item.order_id for item in redemptions}
        attributed_orders = [
            order for order in completed_orders if order.id in campaign_order_ids
        ]
        attributed_refunds = [
            refund for refund in refunds if refund.order_id in campaign_order_ids
        ]
        views = campaign_views[campaign.id]
        checkouts = max(checkouts_by_campaign[campaign.id], len(attributed_orders))
        purchases = len(attributed_orders)
        refund_total = sum(
            money(item.amount_tiyin, order_by_id[item.order_id]) for item in attributed_refunds
        )
        campaign_rows.append(
            {
                "id": str(campaign.id),
                "campaign_id": str(campaign.id),
                "name": campaign.name,
                "code": campaign.code,
                "is_enabled": campaign.is_enabled,
                "views": views,
                "checkouts": checkouts,
                "purchases": purchases,
                "redemptions": len(redemptions),
                "orders": purchases,
                "tickets": sum(item.order_id in campaign_order_ids for item in items),
                "gross_tiyin": sum(
                    money(order.subtotal_tiyin, order) for order in attributed_orders
                ),
                "discount_tiyin": sum(
                    money(item.discount_tiyin, order_by_id[item.order_id]) for item in redemptions
                ),
                "refund_tiyin": refund_total,
                "net_tiyin": sum(
                    money(order.organizer_net_tiyin, order) for order in attributed_orders
                )
                - refund_total,
                # Purchases per campaign view; falls back to purchases per checkout
                # when no views were recorded for the campaign.
                "conversion_rate": percentage(purchases, views)
                if views
                else percentage(purchases, checkouts),
                "checkout_conversion_rate": percentage(purchases, checkouts),
            }
        )

    first_activity = min(
        [event.created_at, *(order.created_at for order in orders)],
        default=event.created_at,
    )
    range_start = start or first_activity.astimezone(UTC).date()
    range_end = end or now.date()
    remaining = max(0, capacity - sold - reserved)
    return {
        "range": {"start": range_start, "end": range_end, "all_time": start is None},
        "kpis": {
            "capacity": capacity,
            "tickets_sold": sold,
            "tickets_reserved": reserved,
            "tickets_refunded": refunded_tickets,
            "tickets_cancelled": cancelled_tickets,
            "tickets_remaining": remaining,
            "percentage_sold": percentage(sold, capacity),
            "orders": len(completed_orders),
            "gross_sales_tiyin": gross,
            "discounts_tiyin": discounts,
            "processing_fees_tiyin": processor_fees,
            "refunds_tiyin": refunded,
            "net_demo_revenue_tiyin": net,
            "organizer_net_tiyin": organizer_net,
            "estimated_payout_tiyin": max(0, organizer_net - paid_out),
            "paid_out_tiyin": paid_out,
            "checked_in": checked_in,
            "absent": max(0, sold - checked_in),
            "check_in_percentage": percentage(checked_in, sold),
            "check_in_rate": percentage(checked_in, sold),
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
    response: Response,
    start: datetime | None = None,
    end: datetime | None = None,
    activity_type: str | None = None,
    action_prefix: str | None = None,
    actor_user_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[dict]:
    event = await get_event_or_404(db, event_id)
    # History exposes financial and personal activity: platform admins and the event
    # owner always pass; of the staff roles only manager and finance may read it.
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    conditions = [AuditLog.event_id == event.id]
    if start:
        conditions.append(AuditLog.occurred_at >= start)
    if end:
        conditions.append(AuditLog.occurred_at <= end)
    if activity_type:
        # Exact action (`order.refunded`) or a whole family (`order`).
        conditions.append(
            or_(AuditLog.action == activity_type, AuditLog.action.like(f"{activity_type}.%"))
        )
    if action_prefix:
        conditions.append(AuditLog.action.like(f"{action_prefix}%"))
    if actor_user_id:
        conditions.append(AuditLog.actor_user_id == actor_user_id)
    if entity_type:
        conditions.append(AuditLog.entity_type == entity_type)
    total = (
        await db.scalar(select(func.count()).select_from(AuditLog).where(*conditions))
    ) or 0
    entries = (
        await db.scalars(
            select(AuditLog)
            .where(*conditions)
            .order_by(AuditLog.occurred_at.desc(), AuditLog.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    actor_ids = {entry.actor_user_id for entry in entries if entry.actor_user_id}
    actors: dict[uuid.UUID, User] = {}
    if actor_ids:
        actors = {
            item.id: item
            for item in (await db.scalars(select(User).where(User.id.in_(actor_ids)))).all()
        }
    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    result = []
    for entry in entries:
        actor = actors.get(entry.actor_user_id) if entry.actor_user_id else None
        result.append(
            {
                "id": str(entry.id),
                "timestamp": entry.occurred_at,
                "actor_user_id": str(entry.actor_user_id) if entry.actor_user_id else None,
                "actor_name": actor.display_name if actor else None,
                "actor_display_name": actor.display_name if actor else "System",
                "action": entry.action,
                "entity_type": entry.entity_type,
                "entity_id": str(entry.entity_id) if entry.entity_id else None,
                "description": entry.description,
                "data": entry.data or {},
            }
        )
    return result


@router.get("/events/{event_id}/payouts")
async def event_payouts(event_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    payouts = (
        await db.scalars(
            select(Payout).where(Payout.event_id == event.id).order_by(Payout.created_at.desc())
        )
    ).all()
    organizer_net = (
        await db.scalar(
            select(func.coalesce(func.sum(Order.organizer_net_tiyin), 0)).where(
                Order.event_id == event.id, Order.status == OrderStatus.PAID
            )
        )
    ) or 0
    recorded = sum(item.amount_tiyin for item in payouts)
    paid = sum(item.amount_tiyin for item in payouts if item.status == "paid")
    return {
        "event_id": str(event.id),
        "currency": "KZT",
        "organizer_net_tiyin": int(organizer_net),
        # Net sales not yet covered by a payout record.
        "estimated_payout_tiyin": max(0, int(organizer_net) - recorded),
        "scheduled_tiyin": recorded - paid,
        "paid_tiyin": paid,
        "eligible_at": event.ends_at + PAYOUT_DELAY,
        "items": [
            {
                "id": str(item.id),
                "event_id": str(item.event_id),
                "amount_tiyin": item.amount_tiyin,
                "status": item.status,
                "eligible_at": item.eligible_at,
                "paid_at": item.paid_at,
                "created_at": item.created_at,
            }
            for item in payouts
        ],
        "mode": "DEMONSTRATION_ONLY",
    }
