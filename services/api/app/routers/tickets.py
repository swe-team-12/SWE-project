import logging
import re
import uuid
from collections.abc import Sequence
from datetime import datetime

from fastapi import APIRouter
from fastapi.responses import Response
from sqlalchemy import func, select
from starlette.concurrency import run_in_threadpool

from app.access import get_event_or_404, require_event_permission, require_event_view_access
from app.config import settings
from app.deps import CurrentUser, DbSession, OptionalUser
from app.documents import (
    admission_token,
    campaign_qr_caption,
    event_calendar_links,
    event_ics,
    qr_png,
    seat_label,
    ticket_pdf,
)
from app.enums import CheckInAction, OrderStatus, StaffRole, TicketStatus
from app.errors import AppError
from app.models import Campaign, CheckInRecord, Event, Order, OrderItem, Ticket, TicketType
from app.schemas import TicketOut
from app.services import put_private_object

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tickets and calendar"])

ADMISSIBLE_TICKET_STATUSES = (TicketStatus.VALID, TicketStatus.CHECKED_IN)


def ticket_is_admissible(ticket: Ticket) -> bool:
    """Refunded and cancelled tickets must never expose a usable admission QR."""
    return ticket.status in ADMISSIBLE_TICKET_STATUSES


def require_admissible(ticket: Ticket) -> None:
    if not ticket_is_admissible(ticket):
        raise AppError(
            409,
            "ticket_not_valid",
            "Ticket is not valid",
            f"This ticket was {ticket.status.value} and can no longer be used for admission.",
        )


async def authorized_ticket(
    db: DbSession,
    ticket_id: uuid.UUID,
    user: CurrentUser,
    staff_roles: set[StaffRole] | None = None,
) -> Ticket:
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None:
        raise AppError(404, "ticket_not_found", "Ticket not found", "The ticket does not exist.")
    if ticket.owner_user_id != user.id:
        event = await get_event_or_404(db, ticket.event_id)
        await require_event_permission(
            db, event, user, staff_roles or {StaffRole.MANAGER, StaffRole.CHECK_IN}
        )
    return ticket


def ticket_calendar(ticket: Ticket, event: Event) -> dict:
    links = event_calendar_links(event)
    links["ics_path"] = f"/tickets/{ticket.id}/calendar.ics"
    if links["available"] and not ticket_is_admissible(ticket):
        links.update(
            {
                "available": False,
                "reason": "ticket_not_valid",
                "google": None,
                "outlook": None,
                "office365": None,
                "yahoo": None,
            }
        )
    return links


def ticket_out(
    ticket: Ticket,
    event: Event | None,
    item: OrderItem | None,
    ticket_type: TicketType | None,
    order: Order | None,
    checked_in_at: datetime | None = None,
) -> TicketOut:
    admissible = ticket_is_admissible(ticket)
    update: dict = {
        "qr_token": admission_token(ticket) if admissible else None,
        "qr_available": admissible,
        "checked_in_at": checked_in_at if ticket.status == TicketStatus.CHECKED_IN else None,
    }
    if event is not None:
        update.update(
            {
                "event_title": event.title,
                "event_slug": event.slug,
                "event_status": event.status,
                "starts_at": event.starts_at,
                "ends_at": event.ends_at,
                "timezone": event.timezone,
                "venue_name": event.venue_name,
                "venue_address": event.venue_address,
                "city": event.city,
                "calendar": ticket_calendar(ticket, event),
            }
        )
    if item is not None:
        update.update(
            {
                "attendee_name": item.attendee_name,
                "section": item.section,
                "row": item.row,
                "seat_number": item.seat_number,
                "seat_label": seat_label(item),
                "ticket_type_id": item.ticket_type_id,
            }
        )
    if ticket_type is not None:
        update["ticket_type_name"] = ticket_type.name
    if order is not None:
        update.update({"order_id": order.id, "order_number": order.order_number})
    return TicketOut.model_validate(ticket).model_copy(update=update)


async def build_ticket_outputs(db: DbSession, tickets: Sequence[Ticket]) -> list[TicketOut]:
    if not tickets:
        return []
    rows = (
        await db.execute(
            select(OrderItem, TicketType, Order)
            .join(TicketType, TicketType.id == OrderItem.ticket_type_id, isouter=True)
            .join(Order, Order.id == OrderItem.order_id, isouter=True)
            .where(OrderItem.id.in_([ticket.order_item_id for ticket in tickets]))
        )
    ).all()
    context = {item.id: (item, ticket_type, order) for item, ticket_type, order in rows}
    events = {
        event.id: event
        for event in (
            await db.scalars(
                select(Event).where(Event.id.in_({ticket.event_id for ticket in tickets}))
            )
        ).all()
    }
    checked_ids = [ticket.id for ticket in tickets if ticket.status == TicketStatus.CHECKED_IN]
    checked_at: dict[uuid.UUID, datetime] = {}
    if checked_ids:
        checked_at = {
            ticket_id: moment
            for ticket_id, moment in (
                await db.execute(
                    select(CheckInRecord.ticket_id, func.max(CheckInRecord.captured_at))
                    .where(
                        CheckInRecord.ticket_id.in_(checked_ids),
                        CheckInRecord.action == CheckInAction.CHECK_IN,
                    )
                    .group_by(CheckInRecord.ticket_id)
                )
            ).all()
        }
    result = []
    for ticket in tickets:
        item, ticket_type, order = context.get(ticket.order_item_id, (None, None, None))
        result.append(
            ticket_out(
                ticket,
                events.get(ticket.event_id),
                item,
                ticket_type,
                order,
                checked_at.get(ticket.id),
            )
        )
    return result


@router.get("/tickets", response_model=list[TicketOut])
async def my_tickets(user: CurrentUser, db: DbSession) -> list[TicketOut]:
    tickets = (
        await db.scalars(
            select(Ticket).where(Ticket.owner_user_id == user.id).order_by(Ticket.created_at.desc())
        )
    ).all()
    return await build_ticket_outputs(db, tickets)


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
async def ticket_detail(ticket_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TicketOut:
    ticket = await authorized_ticket(
        db, ticket_id, user, {StaffRole.MANAGER, StaffRole.CHECK_IN, StaffRole.SUPPORT}
    )
    return (await build_ticket_outputs(db, [ticket]))[0]


@router.get("/tickets/{ticket_id}/qr.png")
async def ticket_qr(ticket_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    ticket = await authorized_ticket(db, ticket_id, user)
    require_admissible(ticket)
    return Response(
        qr_png(admission_token(ticket)),
        media_type="image/png",
        headers={"Cache-Control": "private, no-store"},
    )


def _store_ticket_pdf(key: str, content: bytes) -> None:
    put_private_object(key, content, "application/pdf")


@router.get("/tickets/{ticket_id}/pdf")
async def download_ticket_pdf(ticket_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    ticket = await authorized_ticket(db, ticket_id, user)
    require_admissible(ticket)
    item = await db.get(OrderItem, ticket.order_item_id)
    event = await get_event_or_404(db, ticket.event_id)
    if item is None:
        raise AppError(
            409, "ticket_unavailable", "Ticket unavailable", "The ticket details are incomplete."
        )
    order = await db.get(Order, item.order_id)
    ticket_type = await db.get(TicketType, item.ticket_type_id)
    if order is None or ticket_type is None:
        raise AppError(
            409, "ticket_unavailable", "Ticket unavailable", "The ticket details are incomplete."
        )
    # Read everything the response needs before any storage or commit/rollback work:
    # a rollback expires loaded attributes, and touching them afterwards would trigger
    # a lazy load outside the async context (the source of sporadic 500s).
    ticket_code = ticket.ticket_code
    stored_key = ticket.pdf_object_key
    key = f"tickets/{event.id}/{ticket.id}.pdf"
    try:
        content = await run_in_threadpool(
            ticket_pdf, ticket, event, item, ticket_type, order.order_number
        )
    except Exception as exc:
        logger.exception("Ticket PDF rendering failed", extra={"ticket_id": str(ticket_id)})
        raise AppError(
            503,
            "ticket_pdf_unavailable",
            "PDF temporarily unavailable",
            "The PDF could not be generated. Try again in a moment.",
        ) from exc
    # The stored copy is a best-effort cache for e-mail delivery; the download itself
    # never depends on object storage or on this bookkeeping write.
    try:
        await run_in_threadpool(_store_ticket_pdf, key, content)
        if stored_key != key:
            ticket.pdf_object_key = key
            await db.commit()
    except Exception:
        logger.warning("Ticket PDF was not stored", extra={"ticket_id": str(ticket_id)})
        try:
            await db.rollback()
        except Exception:
            logger.exception("Rollback after PDF storage failure failed")
    return Response(
        content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{ticket_code}.pdf"',
            "Cache-Control": "private, no-store",
        },
    )


def ics_response(event: Event) -> Response:
    return Response(
        event_ics(event),
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{re.sub(r"[^A-Za-z0-9_-]", "_", event.slug) or "event"}.ics"'
            )
        },
    )


@router.get("/events/{event_id}/calendar.ics")
async def calendar_file(event_id: uuid.UUID, db: DbSession, user: OptionalUser) -> Response:
    event = await get_event_or_404(db, event_id)
    await require_event_view_access(db, event, user)
    return ics_response(event)


@router.get("/events/{event_id}/calendar-links")
async def calendar_links(event_id: uuid.UUID, db: DbSession, user: OptionalUser) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_view_access(db, event, user)
    return event_calendar_links(event)


@router.get("/tickets/{ticket_id}/calendar.ics")
async def ticket_calendar_file(ticket_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    ticket = await authorized_ticket(db, ticket_id, user)
    return ics_response(await get_event_or_404(db, ticket.event_id))


@router.get("/tickets/{ticket_id}/calendar-links")
async def ticket_calendar_links(ticket_id: uuid.UUID, user: CurrentUser, db: DbSession) -> dict:
    ticket = await authorized_ticket(db, ticket_id, user)
    return ticket_calendar(ticket, await get_event_or_404(db, ticket.event_id))


@router.get("/orders/{order_id}/calendar.ics")
async def order_calendar_file(order_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    order = await db.get(Order, order_id)
    if order is None:
        raise AppError(404, "order_not_found", "Order not found", "The order does not exist.")
    event = await get_event_or_404(db, order.event_id)
    if order.user_id != user.id:
        await require_event_permission(
            db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE, StaffRole.SUPPORT}
        )
    if order.status == OrderStatus.PENDING:
        raise AppError(409, "order_not_confirmed", "Order not confirmed", "Complete the order.")
    return ics_response(event)


@router.get("/campaigns/{campaign_id}/qr.png")
async def campaign_qr(campaign_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    campaign = await db.get(Campaign, campaign_id)
    if campaign is None:
        raise AppError(
            404, "campaign_not_found", "Campaign not found", "The campaign does not exist."
        )
    event = await get_event_or_404(db, campaign.event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    url = f"{settings.public_web_base_url.rstrip('/')}/c/{campaign.opaque_token}"
    # Promotional QR: coloured, framed and captioned so it cannot pass for an admission QR.
    content = qr_png(url, campaign=True, caption=campaign_qr_caption(campaign.code))
    safe_code = re.sub(r"[^A-Za-z0-9_-]", "_", campaign.code) or "code"
    return Response(
        content,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="campaign-{safe_code}.png"'},
    )
