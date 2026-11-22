import io
import logging
import os
import threading
import urllib.parse
from datetime import UTC, datetime
from typing import Any
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import qrcode
from icalendar import Calendar
from icalendar import Event as CalendarEvent
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.colors import HexColor, black
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph

from app.config import settings
from app.models import Event, OrderItem, Ticket, TicketType
from app.security import create_admission_token

logger = logging.getLogger(__name__)

# Unicode fonts are looked up in this order. The API image installs DejaVu
# (`fonts-dejavu-core`); the remaining paths keep local development on other
# systems working. When nothing is found the built-in Helvetica is used, which
# cannot draw Cyrillic or Kazakh letters.
FONT_CANDIDATES: tuple[tuple[str, str], ...] = (
    (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ),
    ("/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/TTF/DejaVuSans.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"),
    (
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ),
    ("/Library/Fonts/DejaVuSans.ttf", "/Library/Fonts/DejaVuSans-Bold.ttf"),
    (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ),
    ("/Library/Fonts/Arial.ttf", "/Library/Fonts/Arial Bold.ttf"),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
)
PDF_FONT_REGULAR = "BiletFlowSans"
PDF_FONT_BOLD = "BiletFlowSans-Bold"
_pdf_fonts: tuple[str, str] | None = None
_pdf_fonts_lock = threading.Lock()

ADMISSION_QR_DARK = "#000000"
CAMPAIGN_QR_DARK = "#B4235A"
CAMPAIGN_BAND = "#B4235A"


def font_file_candidates() -> list[tuple[str, str]]:
    candidates: list[tuple[str, str]] = []
    if settings.pdf_font_path:
        candidates.append(
            (settings.pdf_font_path, settings.pdf_font_bold_path or settings.pdf_font_path)
        )
    candidates.extend(FONT_CANDIDATES)
    return candidates


def unicode_font_files() -> tuple[str, str] | None:
    for regular, bold in font_file_candidates():
        if os.path.isfile(regular):
            return regular, bold if os.path.isfile(bold) else regular
    return None


def pdf_fonts() -> tuple[str, str]:
    """Return (regular, bold) font names, registering a Unicode TTF once per process."""
    global _pdf_fonts
    if _pdf_fonts is not None:
        return _pdf_fonts
    with _pdf_fonts_lock:
        if _pdf_fonts is not None:
            return _pdf_fonts
        files = unicode_font_files()
        if files is not None:
            try:
                pdfmetrics.registerFont(TTFont(PDF_FONT_REGULAR, files[0]))
                pdfmetrics.registerFont(TTFont(PDF_FONT_BOLD, files[1]))
                _pdf_fonts = (PDF_FONT_REGULAR, PDF_FONT_BOLD)
                return _pdf_fonts
            except Exception:
                logger.exception("Unable to register the Unicode PDF font; using Helvetica")
        else:
            logger.warning("No Unicode TTF font found; PDF tickets fall back to Helvetica")
        _pdf_fonts = ("Helvetica", "Helvetica-Bold")
        return _pdf_fonts


def admission_token(ticket: Ticket) -> str:
    return create_admission_token(
        ticket_id=ticket.id,
        event_id=ticket.event_id,
        nonce=ticket.qr_nonce,
        ticket_code=ticket.ticket_code,
    )


def _caption_font(size: int) -> Any:
    files = unicode_font_files()
    if files is not None:
        try:
            return ImageFont.truetype(files[1], size)
        except Exception:
            pass
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def qr_png(payload: str, *, campaign: bool = False, caption: str | None = None) -> bytes:
    """Render a QR code.

    Admission QR codes stay plain black on white. Campaign (promotional) QR codes
    use a distinct colour, a coloured frame and a caption band so that they can
    never be mistaken for an admission ticket.
    """
    code = qrcode.QRCode(
        box_size=12,
        border=5 if campaign else 4,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
    )
    code.add_data(payload)
    code.make(fit=True)
    image = code.make_image(
        fill_color=CAMPAIGN_QR_DARK if campaign else ADMISSION_QR_DARK, back_color="#FFFFFF"
    ).convert("RGB")
    if campaign:
        band_height = 84
        frame = 10
        width, height = image.size
        framed = Image.new(
            "RGB", (width + frame * 2, height + frame * 2 + band_height), CAMPAIGN_BAND
        )
        framed.paste(image, (frame, frame))
        draw = ImageDraw.Draw(framed)
        text = (caption or "PROMO").strip()[:48]
        size = 40
        font = _caption_font(size)
        while size > 14 and draw.textlength(text, font=font) > width - 16:
            size -= 2
            font = _caption_font(size)
        text_width = draw.textlength(text, font=font)
        draw.text(
            ((framed.size[0] - text_width) / 2, height + frame + (band_height - size) / 2 - 2),
            text,
            fill="#FFFFFF",
            font=font,
        )
        image = framed
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def campaign_qr_caption(code: str) -> str:
    return f"PROMO · {code}"


def event_zone(event: Event) -> ZoneInfo:
    try:
        return ZoneInfo(event.timezone)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return ZoneInfo("UTC")


def utc_offset_label(moment: datetime) -> str:
    offset = moment.utcoffset()
    if offset is None:
        return "UTC"
    minutes = int(offset.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    hours, remainder = divmod(abs(minutes), 60)
    return f"UTC{sign}{hours:02d}:{remainder:02d}"


def event_time_label(event: Event) -> str:
    """Event start/end in the event's own time zone, e.g. `12 May 2027, 17:00 - 20:00`."""
    zone = event_zone(event)
    start = event.starts_at.astimezone(zone)
    end = event.ends_at.astimezone(zone) if event.ends_at else None
    label = start.strftime("%d %B %Y, %H:%M")
    if end is not None:
        if end.date() == start.date():
            label += f" - {end.strftime('%H:%M')}"
        else:
            label += f" - {end.strftime('%d %B %Y, %H:%M')}"
    return label


def seat_label(item: OrderItem) -> str | None:
    if not item.seat_number:
        return None
    return f"Section {item.section}, Row {item.row}, Seat {item.seat_number}"


def _paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    # Paragraph parses inline XML markup: escape user-provided text so characters
    # such as `<` or `&` in a title can never break PDF generation.
    return Paragraph(escape(text or "-").replace("\n", "<br/>"), style)


def ticket_pdf(
    ticket: Ticket,
    event: Event,
    item: OrderItem,
    ticket_type: TicketType,
    order_number: str | None = None,
) -> bytes:
    output = io.BytesIO()
    canvas = Canvas(output, pagesize=A4, pageCompression=1)
    width, height = A4
    navy = HexColor("#102A43")
    teal = HexColor("#00A7A5")
    pale = HexColor("#E9F7F7")
    regular, bold = pdf_fonts()

    canvas.setTitle(f"BiletFlow ticket {ticket.ticket_code}")
    canvas.setFillColor(navy)
    canvas.rect(0, height - 125, width, 125, fill=1, stroke=0)
    canvas.setFillColor(teal)
    canvas.rect(0, height - 132, width, 7, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#FFFFFF"))
    canvas.setFont(bold, 26)
    canvas.drawString(44, height - 62, "BiletFlow")
    canvas.setFont(regular, 11)
    canvas.drawString(44, height - 88, "DEMONSTRATION TICKET - ONE ADMISSION")

    title_style = ParagraphStyle(
        "TicketTitle", fontName=bold, fontSize=22, leading=26, textColor=navy
    )
    title = _paragraph(event.title, title_style)
    _, title_height = title.wrap(width - 88, 200)
    if title_height > 110:
        title_style = ParagraphStyle(
            "TicketTitleSmall", fontName=bold, fontSize=15, leading=18, textColor=navy
        )
        title = _paragraph(event.title, title_style)
        _, title_height = title.wrap(width - 88, 200)
    title_top = height - 156
    title.drawOn(canvas, 44, title_top - title_height)

    zone = event_zone(event)
    start_local = event.starts_at.astimezone(zone)
    rows: list[tuple[str, str]] = [
        ("Date and time", event_time_label(event)),
        ("Time zone", f"{event.timezone} ({utc_offset_label(start_local)})"),
        ("Venue", f"{event.venue_name}, {event.venue_address}"),
        ("Ticket type", ticket_type.name),
    ]
    seat = seat_label(item)
    if seat:
        rows.append(("Assigned seat", seat))
    rows.append(("Attendee", item.attendee_name))
    if order_number:
        rows.append(("Order number", order_number))
    rows.append(("Ticket ID", ticket.ticket_code))

    qr_size = 190
    qr_x = width - qr_size - 48
    qr_y = 82
    text_width = qr_x - 14 - 44 - 18
    top = title_top - title_height - 26
    bottom_limit = 72
    available = top - bottom_limit
    chosen: list[tuple[str, Paragraph, float]] = []
    chosen_size = 12.0
    chosen_gap = 16.0
    for value_size, gap in ((12, 16), (11, 13), (10, 11), (9, 9), (8, 7), (7, 5)):
        value_style = ParagraphStyle(
            f"TicketValue{value_size}",
            fontName=regular,
            fontSize=value_size,
            leading=value_size + 3,
            textColor=black,
        )
        laid_out: list[tuple[str, Paragraph, float]] = []
        total = 0.0
        for label, value in rows:
            paragraph = _paragraph(value, value_style)
            _, value_height = paragraph.wrap(text_width, 400)
            laid_out.append((label, paragraph, value_height))
            total += 13 + value_height + gap
        chosen, chosen_size, chosen_gap = laid_out, float(value_size), float(gap)
        if total <= available:
            break
    y = top
    for label, paragraph, value_height in chosen:
        canvas.setFillColor(HexColor("#627D98"))
        canvas.setFont(bold, 9 if chosen_size >= 10 else 8)
        canvas.drawString(44, y, label.upper())
        paragraph.drawOn(canvas, 44, y - 6 - value_height)
        y -= 13 + value_height + chosen_gap

    token = admission_token(ticket)
    qr = ImageReader(io.BytesIO(qr_png(token)))
    canvas.setFillColor(pale)
    canvas.roundRect(qr_x - 14, qr_y - 36, qr_size + 28, qr_size + 70, 12, fill=1, stroke=0)
    canvas.drawImage(qr, qr_x, qr_y, qr_size, qr_size, preserveAspectRatio=True, mask="auto")
    canvas.setFillColor(navy)
    canvas.setFont(bold, 10)
    canvas.drawCentredString(qr_x + qr_size / 2, qr_y - 18, "ADMISSION QR")
    canvas.setFont(regular, 9)
    canvas.drawCentredString(qr_x + qr_size / 2, qr_y + qr_size + 12, ticket.ticket_code)

    canvas.setFillColor(HexColor("#486581"))
    canvas.setFont(regular, 9)
    canvas.drawString(
        44, 44, "Printed and digital copies share the same admission. Keep this QR private."
    )
    canvas.showPage()
    canvas.save()
    return output.getvalue()


def event_public_url(event: Event) -> str:
    return f"{settings.public_web_base_url.rstrip('/')}/events/{event.id}"


def calendar_uid(event: Event) -> str:
    return f"{event.id}@biletflow.local"


def calendar_description(event: Event) -> str:
    description = (event.description or "").strip()
    url = event_public_url(event)
    return f"{description}\n\n{url}" if description else url


def event_ics(event: Event) -> bytes:
    """Build the event's iCalendar file.

    The UID never changes and SEQUENCE follows `calendar_sequence`, so a re-download
    after an update replaces the entry. Times carry a TZID backed by a VTIMEZONE
    component. A cancelled event yields METHOD:CANCEL with STATUS:CANCELLED.
    """
    cancelled = event.status.value == "cancelled"
    calendar = Calendar()
    calendar.add("prodid", "-//BiletFlow//Event Calendar//EN")
    calendar.add("version", "2.0")
    calendar.add("calscale", "GREGORIAN")
    calendar.add("method", "CANCEL" if cancelled else "PUBLISH")
    component = CalendarEvent()
    component.add("uid", calendar_uid(event))
    component.add("sequence", event.calendar_sequence or 0)
    component.add("summary", event.title)
    component.add("description", calendar_description(event))
    component.add("location", f"{event.venue_name}, {event.venue_address}")
    zone = event_zone(event)
    component.add("dtstart", event.starts_at.astimezone(zone))
    component.add("dtend", event.ends_at.astimezone(zone))
    component.add("dtstamp", datetime.now(UTC))
    updated_at = getattr(event, "updated_at", None)
    if updated_at is not None:
        component.add("last-modified", updated_at.astimezone(UTC))
    component.add("url", event_public_url(event))
    component.add("status", "CANCELLED" if cancelled else "CONFIRMED")
    component.add("transp", "TRANSPARENT" if cancelled else "OPAQUE")
    calendar.add_component(component)
    try:
        calendar.add_missing_timezones()
    except Exception:
        # Without a VTIMEZONE a TZID reference would be invalid: fall back to UTC.
        logger.exception("Unable to add VTIMEZONE; emitting UTC times")
        component.pop("dtstart", None)
        component.pop("dtend", None)
        component.add("dtstart", event.starts_at.astimezone(UTC))
        component.add("dtend", event.ends_at.astimezone(UTC))
    return calendar.to_ical()


def event_calendar_links(event: Event, *, ics_url: str | None = None) -> dict[str, Any]:
    """Add-to-calendar data for an event.

    For a cancelled event no add-to-calendar link is offered (`available` is false and
    the provider links are null); `ics` then downloads the cancellation file.
    """
    start_utc = event.starts_at.astimezone(UTC)
    end_utc = event.ends_at.astimezone(UTC)
    start = start_utc.strftime("%Y%m%dT%H%M%SZ")
    end = end_utc.strftime("%Y%m%dT%H%M%SZ")
    location = f"{event.venue_name}, {event.venue_address}"
    url = event_public_url(event)
    details = calendar_description(event)
    cancelled = event.status.value == "cancelled"
    result: dict[str, Any] = {
        "available": not cancelled,
        "reason": "event_cancelled" if cancelled else None,
        "status": event.status.value,
        "event_id": str(event.id),
        "event_url": url,
        "title": event.title,
        "location": location,
        "starts_at": event.starts_at,
        "ends_at": event.ends_at,
        "timezone": event.timezone,
        "ics": ics_url
        or f"{settings.api_public_url.rstrip('/')}/api/v1/events/{event.id}/calendar.ics",
        "google": None,
        "outlook": None,
        "office365": None,
        "yahoo": None,
        "uid": calendar_uid(event),
        "sequence": event.calendar_sequence or 0,
    }
    if cancelled:
        return result
    google_query = urllib.parse.urlencode(
        {
            "action": "TEMPLATE",
            "text": event.title,
            "dates": f"{start}/{end}",
            "ctz": event.timezone,
            "details": details,
            "location": location,
            "sprop": f"website:{url}",
        }
    )
    outlook_query = urllib.parse.urlencode(
        {
            "path": "/calendar/action/compose",
            "rru": "addevent",
            "subject": event.title,
            "startdt": start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "enddt": end_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "body": details,
            "location": location,
        }
    )
    yahoo_query = urllib.parse.urlencode(
        {
            "v": "60",
            "title": event.title,
            "st": start,
            "et": end,
            "desc": details,
            "in_loc": location,
            "url": url,
        }
    )
    result["google"] = f"https://calendar.google.com/calendar/render?{google_query}"
    result["outlook"] = f"https://outlook.live.com/calendar/0/deeplink/compose?{outlook_query}"
    result["office365"] = f"https://outlook.office.com/calendar/0/deeplink/compose?{outlook_query}"
    result["yahoo"] = f"https://calendar.yahoo.com/?{yahoo_query}"
    return result
