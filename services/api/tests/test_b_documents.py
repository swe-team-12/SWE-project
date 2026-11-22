"""Ticket PDF, QR, calendar and ticket payload rules."""

import io
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from icalendar import Calendar
from PIL import Image
from pypdf import PdfReader

from app.documents import (
    campaign_qr_caption,
    event_calendar_links,
    event_ics,
    qr_png,
    seat_label,
    ticket_pdf,
    unicode_font_files,
)
from app.enums import EventStatus, EventVisibility, OrderStatus, SeatingMode, TicketStatus
from app.errors import AppError
from app.models import Event, Order, OrderItem, Ticket, TicketType
from app.routers import tickets as tickets_router
from app.routers.commerce import order_calendar


def models(
    title: str = "Almaty Test Forum",
) -> tuple[Event, TicketType, OrderItem, Ticket, Order]:
    event_id = uuid.uuid4()
    starts_at = datetime(2027, 5, 12, 12, 0, tzinfo=UTC)
    event = Event(
        id=event_id,
        owner_id=uuid.uuid4(),
        slug="almaty-test-event",
        title=title,
        description="A test event used to verify generated documents.",
        category="Technology",
        venue_name="Almaty Hall",
        venue_address="44 Abay Avenue, Almaty",
        city="Almaty",
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=3),
        timezone="Asia/Almaty",
        capacity=168,
        status=EventStatus.PUBLISHED,
        visibility=EventVisibility.PUBLIC,
        seating_mode=SeatingMode.ASSIGNED,
        calendar_sequence=3,
    )
    ticket_type = TicketType(
        id=uuid.uuid4(), event_id=event_id, name="Premium", price_tiyin=2_500_000, quantity=36
    )
    order = Order(
        id=uuid.uuid4(),
        order_number="BF-TEST-0001",
        event_id=event_id,
        user_id=uuid.uuid4(),
        status=OrderStatus.PAID,
    )
    item = OrderItem(
        id=uuid.uuid4(),
        order_id=order.id,
        ticket_type_id=ticket_type.id,
        unit_price_tiyin=2_500_000,
        attendee_name="Aruzhan Demo",
        attendee_email="attendee@example.com",
        section="A",
        row="B",
        seat_number="7",
    )
    ticket = Ticket(
        id=uuid.uuid4(),
        ticket_code="TKT-PRINT-001",
        order_item_id=item.id,
        event_id=event_id,
        owner_user_id=order.user_id,
        status=TicketStatus.VALID,
        qr_nonce="print-test-nonce",
    )
    return event, ticket_type, item, ticket, order


def pdf_text(content: bytes) -> str:
    reader = PdfReader(io.BytesIO(content))
    assert len(reader.pages) == 1
    return " ".join(reader.pages[0].extract_text().split())


def test_ticket_pdf_renders_kazakh_and_russian_text() -> None:
    event, ticket_type, item, ticket, order = models("Қазақстан әуендері: Мәдениет кеші")
    event.venue_name = "Жастар сарайы"
    item.attendee_name = "Әсел Нұрғалиқызы"

    text = pdf_text(ticket_pdf(ticket, event, item, ticket_type, order.order_number))

    assert "BF-TEST-0001" in text
    assert "TKT-PRINT-001" in text
    if unicode_font_files() is not None:
        # With a Unicode font the Cyrillic and Kazakh letters survive extraction.
        for expected in ("Қазақстан әуендері", "Жастар сарайы", "Әсел Нұрғалиқызы"):
            assert expected in text


def test_ticket_pdf_wraps_long_titles_and_escapes_markup() -> None:
    title = "Annual <Summit> & Expo of Very Long Conference Names " + "Almaty Edition " * 12
    event, ticket_type, item, ticket, order = models(title.strip())
    event.venue_address = "Building 4 & 5, " + "Long Avenue Name " * 10

    content = ticket_pdf(ticket, event, item, ticket_type, order.order_number)

    text = pdf_text(content)
    assert "<Summit> & Expo" in text
    assert text.count("Almaty Edition") == 12
    assert "Section A, Row B, Seat 7" in text
    assert item.attendee_email not in text


def test_ticket_pdf_without_seat_or_order_number_still_renders() -> None:
    event, ticket_type, item, ticket, _ = models()
    item.section = item.row = item.seat_number = None

    assert seat_label(item) is None
    assert "TKT-PRINT-001" in pdf_text(ticket_pdf(ticket, event, item, ticket_type))


def test_campaign_qr_is_visually_distinct_from_admission_qr() -> None:
    admission = Image.open(io.BytesIO(qr_png("bft:v1:payload"))).convert("RGB")
    promo = Image.open(
        io.BytesIO(
            qr_png("https://example.test/c/abc", campaign=True, caption=campaign_qr_caption("SPRING"))
        )
    ).convert("RGB")

    admission_colours = {colour for _, colour in admission.getcolors(maxcolors=1 << 20)}
    promo_colours = {colour for _, colour in promo.getcolors(maxcolors=1 << 20)}
    assert admission_colours == {(0, 0, 0), (255, 255, 255)}
    assert (0, 0, 0) not in promo_colours
    assert (180, 35, 90) in promo_colours
    # The caption band makes the promotional image taller than it is wide.
    assert promo.height > promo.width
    assert admission.height == admission.width
    assert campaign_qr_caption("SPRING") == "PROMO · SPRING"


def test_calendar_file_is_valid_and_carries_timezone_and_event_link() -> None:
    event, *_ = models()
    raw = event_ics(event)
    calendar = Calendar.from_ical(raw)
    component = next(item for item in calendar.walk() if item.name == "VEVENT")

    assert str(calendar["version"]) == "2.0"
    assert str(calendar["method"]) == "PUBLISH"
    assert any(item.name == "VTIMEZONE" for item in calendar.walk())
    assert b"TZID=Asia/Almaty" in raw
    assert str(component["status"]) == "CONFIRMED"
    assert "dtstamp" in component
    assert str(component["url"]).endswith(f"/events/{event.id}")
    assert str(component["url"]) in str(component["description"])
    assert raw.endswith(b"END:VCALENDAR\r\n")


def test_cancelled_event_produces_a_cancellation_file_and_no_add_links() -> None:
    event, *_ = models()
    confirmed = event_calendar_links(event)
    assert confirmed["available"] is True
    for provider in ("google", "outlook", "office365", "yahoo"):
        assert confirmed[provider].startswith("https://")

    event.status = EventStatus.CANCELLED
    event.calendar_sequence = 4
    calendar = Calendar.from_ical(event_ics(event))
    component = next(item for item in calendar.walk() if item.name == "VEVENT")
    assert str(calendar["method"]) == "CANCEL"
    assert str(component["status"]) == "CANCELLED"
    assert int(component["sequence"]) == 4
    assert str(component["uid"]) == confirmed["uid"]

    links = event_calendar_links(event)
    assert links["available"] is False
    assert links["reason"] == "event_cancelled"
    assert [links[provider] for provider in ("google", "outlook", "office365", "yahoo")] == [
        None
    ] * 4


def test_valid_ticket_payload_carries_qr_event_seat_and_order_context() -> None:
    event, ticket_type, item, ticket, order = models()

    result = tickets_router.ticket_out(ticket, event, item, ticket_type, order)

    assert result.qr_available is True
    assert result.qr_token and result.qr_token.startswith("bft:v1:")
    assert result.event_title == event.title
    assert result.ticket_type_name == "Premium"
    assert result.seat_label == "Section A, Row B, Seat 7"
    assert result.order_number == "BF-TEST-0001"
    assert result.calendar and result.calendar["available"] is True
    assert result.calendar["ics_path"] == f"/tickets/{ticket.id}/calendar.ics"


def test_refunded_and_cancelled_tickets_expose_no_admission_qr() -> None:
    for status in (TicketStatus.REFUNDED, TicketStatus.CANCELLED):
        event, ticket_type, item, ticket, order = models()
        ticket.status = status

        result = tickets_router.ticket_out(ticket, event, item, ticket_type, order)

        assert result.qr_token is None
        assert result.qr_available is False
        assert result.calendar and result.calendar["available"] is False
        assert result.calendar["reason"] == "ticket_not_valid"
        assert tickets_router.ticket_is_admissible(ticket) is False
        with pytest.raises(AppError) as error:
            tickets_router.require_admissible(ticket)
        assert (error.value.status, error.value.code) == (409, "ticket_not_valid")


def test_order_calendar_is_withdrawn_for_refunded_orders() -> None:
    event, _, _, _, order = models()
    assert order_calendar(order, event)["available"] is True
    assert order_calendar(order, event)["ics_path"] == f"/orders/{order.id}/calendar.ics"

    order.status = OrderStatus.REFUNDED
    closed = order_calendar(order, event)
    assert closed["available"] is False
    assert closed["reason"] == "order_closed"
