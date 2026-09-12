import io
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import qrcode
from icalendar import Calendar
from icalendar import Event as CalendarEvent
from reportlab.lib.colors import HexColor, black
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph

from app.config import settings
from app.models import Event, OrderItem, Ticket, TicketType
from app.security import create_admission_token


def admission_token(ticket: Ticket) -> str:
    return create_admission_token(
        ticket_id=ticket.id,
        event_id=ticket.event_id,
        nonce=ticket.qr_nonce,
        ticket_code=ticket.ticket_code,
    )


def qr_png(payload: str, *, campaign: bool = False) -> bytes:
    image = qrcode.make(payload, box_size=12, border=4).convert("RGB")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def ticket_pdf(ticket: Ticket, event: Event, item: OrderItem, ticket_type: TicketType) -> bytes:
    output = io.BytesIO()
    canvas = Canvas(output, pagesize=A4, pageCompression=1)
    width, height = A4
    navy = HexColor("#102A43")
    teal = HexColor("#00A7A5")
    pale = HexColor("#E9F7F7")

    canvas.setFillColor(navy)
    canvas.rect(0, height - 125, width, 125, fill=1, stroke=0)
    canvas.setFillColor(teal)
    canvas.rect(0, height - 132, width, 7, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#FFFFFF"))
    canvas.setFont("Helvetica-Bold", 26)
    canvas.drawString(44, height - 62, "BiletFlow")
    canvas.setFont("Helvetica", 11)
    canvas.drawString(44, height - 88, "DEMONSTRATION TICKET - ONE ADMISSION")

    styles = getSampleStyleSheet()
    title_style = styles["Title"]
    title_style.textColor = navy
    title_style.fontName = "Helvetica-Bold"
    title_style.fontSize = 22
    title_style.leading = 26
    paragraph = Paragraph(event.title, title_style)
    paragraph.wrapOn(canvas, width - 88, 80)
    paragraph.drawOn(canvas, 44, height - 210)

    event_zone = ZoneInfo(event.timezone)
    rows = [
        ("Date and time", event.starts_at.astimezone(event_zone).strftime("%d %B %Y, %H:%M")),
        ("Time zone", event.timezone),
        ("Venue", f"{event.venue_name}, {event.venue_address}"),
        ("Ticket type", ticket_type.name),
        ("Attendee", item.attendee_name),
        ("Ticket ID", ticket.ticket_code),
    ]
    if item.seat_number:
        rows.insert(
            4, ("Assigned seat", f"Section {item.section}, Row {item.row}, Seat {item.seat_number}")
        )
    y = height - 260
    for label, value in rows:
        canvas.setFillColor(HexColor("#627D98"))
        canvas.setFont("Helvetica-Bold", 9)
        canvas.drawString(44, y, label.upper())
        canvas.setFillColor(black)
        canvas.setFont("Helvetica", 12)
        canvas.drawString(44, y - 18, value[:82])
        y -= 55

    token = admission_token(ticket)
    qr = ImageReader(io.BytesIO(qr_png(token)))
    qr_size = 190
    qr_x = width - qr_size - 48
    qr_y = 82
    canvas.setFillColor(pale)
    canvas.roundRect(qr_x - 14, qr_y - 36, qr_size + 28, qr_size + 70, 12, fill=1, stroke=0)
    canvas.drawImage(qr, qr_x, qr_y, qr_size, qr_size, preserveAspectRatio=True, mask="auto")
    canvas.setFillColor(navy)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawCentredString(qr_x + qr_size / 2, qr_y - 18, "ADMISSION QR")

    canvas.setFillColor(HexColor("#486581"))
    canvas.setFont("Helvetica", 9)
    canvas.drawString(
        44, 44, "Printed and digital copies share the same admission. Keep this QR private."
    )
    canvas.showPage()
    canvas.save()
    return output.getvalue()


def event_ics(event: Event) -> bytes:
    calendar = Calendar()
    calendar.add("prodid", "-//BiletFlow//Event Calendar//EN")
    calendar.add("version", "2.0")
    calendar.add("method", "CANCEL" if event.status.value == "cancelled" else "PUBLISH")
    component = CalendarEvent()
    component.add("uid", f"{event.id}@biletflow.local")
    component.add("sequence", event.calendar_sequence)
    component.add("summary", event.title)
    component.add("description", event.description)
    component.add("location", f"{event.venue_name}, {event.venue_address}")
    event_zone = ZoneInfo(event.timezone)
    component.add("dtstart", event.starts_at.astimezone(event_zone))
    component.add("dtend", event.ends_at.astimezone(event_zone))
    component.add("dtstamp", datetime.now(UTC))
    component.add("url", f"{settings.public_web_base_url}/events/{event.id}")
    if event.status.value == "cancelled":
        component.add("status", "CANCELLED")
    calendar.add_component(component)
    return calendar.to_ical()
