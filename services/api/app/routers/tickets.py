import io
import urllib.parse
import uuid
from datetime import UTC

import qrcode
from fastapi import APIRouter
from fastapi.responses import Response
from sqlalchemy import select

from app.access import get_event_or_404, require_event_permission, require_event_view_access
from app.config import settings
from app.deps import CurrentUser, DbSession, OptionalUser
from app.documents import admission_token, event_ics, qr_png, ticket_pdf
from app.enums import StaffRole
from app.errors import AppError
from app.models import Campaign, Order, OrderItem, Ticket, TicketType
from app.schemas import TicketOut
from app.services import put_private_object

router = APIRouter(tags=["tickets and calendar"])


async def authorized_ticket(db: DbSession, ticket_id: uuid.UUID, user: CurrentUser) -> Ticket:
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None:
        raise AppError(404, "ticket_not_found", "Ticket not found", "The ticket does not exist.")
    if ticket.owner_user_id != user.id:
        event = await get_event_or_404(db, ticket.event_id)
        await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.CHECK_IN})
    return ticket


@router.get("/tickets", response_model=list[TicketOut])
async def my_tickets(user: CurrentUser, db: DbSession) -> list[TicketOut]:
    tickets = (
        await db.scalars(
            select(Ticket).where(Ticket.owner_user_id == user.id).order_by(Ticket.created_at.desc())
        )
    ).all()
    return [
        TicketOut.model_validate(ticket).model_copy(update={"qr_token": admission_token(ticket)})
        for ticket in tickets
    ]


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
async def ticket_detail(ticket_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TicketOut:
    ticket = await authorized_ticket(db, ticket_id, user)
    return TicketOut.model_validate(ticket).model_copy(update={"qr_token": admission_token(ticket)})


@router.get("/tickets/{ticket_id}/qr.png")
async def ticket_qr(ticket_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    ticket = await authorized_ticket(db, ticket_id, user)
    return Response(qr_png(admission_token(ticket)), media_type="image/png")


@router.get("/tickets/{ticket_id}/pdf")
async def download_ticket_pdf(ticket_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    ticket = await authorized_ticket(db, ticket_id, user)
    item = await db.get(OrderItem, ticket.order_item_id)
    assert item is not None
    order = await db.get(Order, item.order_id)
    event = await get_event_or_404(db, ticket.event_id)
    ticket_type = await db.get(TicketType, item.ticket_type_id)
    assert order is not None and ticket_type is not None
    content = ticket_pdf(ticket, event, item, ticket_type)
    key = f"tickets/{event.id}/{ticket.id}.pdf"
    try:
        put_private_object(key, content, "application/pdf")
        ticket.pdf_object_key = key
        await db.commit()
    except Exception:
        await db.rollback()
    return Response(
        content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{ticket.ticket_code}.pdf"'},
    )


@router.get("/events/{event_id}/calendar.ics")
async def calendar_file(event_id: uuid.UUID, db: DbSession, user: OptionalUser) -> Response:
    event = await get_event_or_404(db, event_id)
    await require_event_view_access(db, event, user)
    return Response(
        event_ics(event),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{event.slug}.ics"'},
    )


@router.get("/events/{event_id}/calendar-links")
async def calendar_links(event_id: uuid.UUID, db: DbSession, user: OptionalUser) -> dict:
    event = await get_event_or_404(db, event_id)
    await require_event_view_access(db, event, user)
    start = event.starts_at.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    end = event.ends_at.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    location = f"{event.venue_name}, {event.venue_address}"
    query = urllib.parse.urlencode(
        {
            "action": "TEMPLATE",
            "text": event.title,
            "dates": f"{start}/{end}",
            "details": event.description,
            "location": location,
        }
    )
    outlook_query = urllib.parse.urlencode(
        {
            "path": "/calendar/action/compose",
            "rru": "addevent",
            "subject": event.title,
            "startdt": event.starts_at.isoformat(),
            "enddt": event.ends_at.isoformat(),
            "body": event.description,
            "location": location,
        }
    )
    yahoo_query = urllib.parse.urlencode(
        {
            "v": "60",
            "view": "d",
            "type": "20",
            "title": event.title,
            "st": start,
            "et": end,
            "desc": event.description,
            "in_loc": location,
        }
    )
    return {
        "ics": f"{settings.api_public_url}/api/v1/events/{event.id}/calendar.ics",
        "google": f"https://calendar.google.com/calendar/render?{query}",
        "outlook": f"https://outlook.live.com/calendar/0/deeplink/compose?{outlook_query}",
        "yahoo": f"https://calendar.yahoo.com/?{yahoo_query}",
        "uid": f"{event.id}@biletflow.local",
        "sequence": event.calendar_sequence,
    }


@router.get("/campaigns/{campaign_id}/qr.png")
async def campaign_qr(campaign_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    campaign = await db.get(Campaign, campaign_id)
    if campaign is None:
        raise AppError(
            404, "campaign_not_found", "Campaign not found", "The campaign does not exist."
        )
    event = await get_event_or_404(db, campaign.event_id)
    await require_event_permission(db, event, user, {StaffRole.MANAGER, StaffRole.FINANCE})
    url = f"{settings.public_web_base_url}/c/{campaign.opaque_token}"
    image = qrcode.make(url, box_size=12, border=5).convert("RGB")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return Response(
        output.getvalue(),
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="campaign-{campaign.code}.png"'},
    )
