import io
import uuid
from datetime import UTC, datetime, timedelta

from icalendar import Calendar
from pypdf import PdfReader

from app.documents import event_ics, ticket_pdf
from app.enums import EventStatus, EventVisibility, SeatingMode, TicketStatus
from app.models import Event, OrderItem, Ticket, TicketType


def document_models() -> tuple[Event, TicketType, OrderItem, Ticket]:
    event_id = uuid.uuid4()
    ticket_type_id = uuid.uuid4()
    item_id = uuid.uuid4()
    starts_at = datetime(2027, 5, 12, 12, 0, tzinfo=UTC)
    event = Event(
        id=event_id,
        owner_id=uuid.uuid4(),
        slug="almaty-test-event",
        title="Almaty Test Forum",
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
        id=ticket_type_id,
        event_id=event_id,
        name="Premium",
        price_tiyin=2_500_000,
        quantity=36,
        max_per_order=4,
    )
    item = OrderItem(
        id=item_id,
        order_id=uuid.uuid4(),
        ticket_type_id=ticket_type_id,
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
        order_item_id=item_id,
        event_id=event_id,
        owner_user_id=uuid.uuid4(),
        status=TicketStatus.VALID,
        qr_nonce="print-test-nonce",
    )
    return event, ticket_type, item, ticket


def test_ticket_pdf_is_single_page_a4_and_contains_canonical_details() -> None:
    event, ticket_type, item, ticket = document_models()
    content = ticket_pdf(ticket, event, item, ticket_type)

    reader = PdfReader(io.BytesIO(content))
    assert len(reader.pages) == 1
    page = reader.pages[0]
    assert float(page.mediabox.width) == 595.2756
    assert float(page.mediabox.height) == 841.8898
    text = page.extract_text()
    for expected in (
        "BiletFlow",
        event.title,
        event.venue_name,
        ticket_type.name,
        item.attendee_name,
        ticket.ticket_code,
        "Section A, Row B, Seat 7",
    ):
        assert expected in text
    assert item.attendee_email not in text


def test_calendar_uid_is_stable_and_cancellation_increments_sequence() -> None:
    event, _, _, _ = document_models()
    first = Calendar.from_ical(event_ics(event))
    first_event = next(component for component in first.walk() if component.name == "VEVENT")
    assert str(first_event["uid"]) == f"{event.id}@biletflow.local"
    assert int(first_event["sequence"]) == 3
    assert first_event["dtstart"].dt.tzinfo is not None
    assert str(first_event["url"]).endswith(f"/events/{event.id}")

    event.status = EventStatus.CANCELLED
    event.calendar_sequence = 4
    cancelled = Calendar.from_ical(event_ics(event))
    cancelled_event = next(
        component for component in cancelled.walk() if component.name == "VEVENT"
    )
    assert str(cancelled_event["uid"]) == str(first_event["uid"])
    assert int(cancelled_event["sequence"]) == 4
    assert str(cancelled_event["status"]) == "CANCELLED"
