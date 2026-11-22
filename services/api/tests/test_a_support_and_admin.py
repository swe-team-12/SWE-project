import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.enums import (
    EventReportCategory,
    SupportCategory,
    SupportKind,
    SupportStatus,
    UserRole,
)
from app.errors import AppError
from app.models import Event, Order, SupportCase, SupportMessage, Ticket, User
from app.routers.admin import (
    EventReportResolution,
    PaidSalesSuspensionRequest,
    like_pattern,
    require_reason,
)
from app.routers.events import EventReportCreate
from app.routers.support import (
    EscalationRequest,
    case_notification_data,
    involves_platform,
    message_sender_role,
    serialize_case,
    serialize_message,
)


def person(name: str, *roles: str) -> User:
    return User(
        id=uuid.uuid4(),
        email=f"{name.lower()}@example.com",
        display_name=name,
        roles=[UserRole.ATTENDEE.value, *roles],
    )


def make_case(requester: User, **overrides: object) -> SupportCase:
    now = datetime.now(UTC)
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "case_number": "SUP-TEST-0001",
        "kind": SupportKind.ATTENDEE_TO_ORGANIZER,
        "category": SupportCategory.REFUND,
        "status": SupportStatus.OPEN,
        "requester_id": requester.id,
        "subject": "Refund please",
        "escalated": False,
        "created_at": now,
        "updated_at": now,
    }
    values.update(overrides)
    return SupportCase(**values)


def test_case_output_carries_names_and_context_labels() -> None:
    requester = person("Dias")
    assignee = person("Aruzhan")
    event = Event(id=uuid.uuid4(), title="Almaty Tech Forum")
    order = Order(id=uuid.uuid4(), order_number="BF-1")
    ticket = Ticket(id=uuid.uuid4(), ticket_code="TKT-1")
    case = make_case(
        requester,
        assignee_id=assignee.id,
        event_id=event.id,
        order_id=order.id,
        ticket_id=ticket.id,
        escalated=True,
        escalated_at=datetime.now(UTC),
        escalated_by_id=requester.id,
    )

    result = serialize_case(
        case,
        {requester.id: requester, assignee.id: assignee},
        {event.id: event},
        {order.id: order},
        {ticket.id: ticket},
    )

    assert result["kind"] == "attendee_to_organizer"
    assert result["category"] == "refund"
    assert result["requester_name"] == "Dias"
    assert result["assignee_id"] == str(assignee.id)
    assert result["assignee_name"] == "Aruzhan"
    assert result["assignee"] == {
        "id": str(assignee.id),
        "display_name": "Aruzhan",
        "email": "aruzhan@example.com",
    }
    assert result["escalated"] is True
    assert result["escalated_by_id"] == str(requester.id)
    assert result["context"] == {
        "event": {"id": str(event.id), "title": "Almaty Tech Forum"},
        "order": {"id": str(order.id), "number": "BF-1"},
        "ticket": {"id": str(ticket.id), "code": "TKT-1"},
    }


def test_case_output_without_context_or_assignee_keeps_the_original_keys() -> None:
    requester = person("Dias")
    result = serialize_case(make_case(requester))
    assert result["assignee"] is None
    assert result["assignee_name"] is None
    assert result["context"] == {"event": None, "order": None, "ticket": None}
    for key in (
        "id",
        "case_number",
        "kind",
        "category",
        "status",
        "subject",
        "requester_id",
        "assignee_id",
        "event_id",
        "order_id",
        "ticket_id",
        "created_at",
        "updated_at",
    ):
        assert key in result


def test_message_output_identifies_sender_and_staff() -> None:
    requester = person("Dias")
    staff = person("Aruzhan", UserRole.ORGANIZER.value)
    admin = person("Admin", UserRole.PLATFORM_ADMIN.value)
    case = make_case(requester)

    def message(sender: User) -> SupportMessage:
        return SupportMessage(
            id=uuid.uuid4(),
            case_id=case.id,
            sender_id=sender.id,
            body="Hello",
            created_at=datetime.now(UTC),
        )

    from_requester = serialize_message(case, message(requester), requester)
    from_staff = serialize_message(case, message(staff), staff)
    from_admin = serialize_message(case, message(admin), admin)

    assert (from_requester["sender_name"], from_requester["sender_is_staff"]) == ("Dias", False)
    assert from_requester["sender_role"] == "requester"
    assert (from_staff["sender_role"], from_staff["sender_is_staff"]) == ("staff", True)
    assert (from_admin["sender_role"], from_admin["sender_is_staff"]) == ("platform_admin", True)
    assert from_staff["attachments"] == []


def test_admin_requester_is_still_the_requester_of_their_own_case() -> None:
    admin = person("Admin", UserRole.PLATFORM_ADMIN.value)
    assert message_sender_role(make_case(admin), admin, admin.id) == "requester"


def test_platform_is_involved_for_escalated_and_organizer_cases() -> None:
    requester = person("Dias")
    assert not involves_platform(make_case(requester))
    assert involves_platform(make_case(requester, escalated=True))
    assert involves_platform(make_case(requester, kind=SupportKind.ORGANIZER_TO_PLATFORM))


def test_case_notification_payload_has_stable_keys() -> None:
    requester = person("Dias")
    event_id = uuid.uuid4()
    case = make_case(requester, event_id=event_id, escalated=True)
    assert case_notification_data(case, change="escalated", reason="No reply") == {
        "case_id": str(case.id),
        "case_number": "SUP-TEST-0001",
        "kind": "attendee_to_organizer",
        "escalated": True,
        "event_id": str(event_id),
        "change": "escalated",
        "reason": "No reply",
    }


def test_escalation_reason_is_trimmed_and_blank_becomes_none() -> None:
    assert EscalationRequest(reason="  no reply  ").reason == "no reply"
    assert EscalationRequest(reason="   ").reason is None
    assert EscalationRequest().reason is None


def test_report_request_validates_category_and_trims_details() -> None:
    payload = EventReportCreate(category="fraud", details="  fake tickets  ")  # type: ignore[arg-type]
    assert payload.category == EventReportCategory.FRAUD
    assert payload.details == "fake tickets"
    with pytest.raises(ValidationError):
        EventReportCreate(category="nonsense")  # type: ignore[arg-type]


def test_report_resolution_only_accepts_closing_states() -> None:
    assert EventReportResolution(status="dismissed", note=" checked ").note == "checked"
    with pytest.raises(ValidationError):
        EventReportResolution(status="open")  # type: ignore[arg-type]


def test_moderation_reason_must_be_meaningful() -> None:
    assert require_reason("  chargeback review ") == "chargeback review"
    for blank in ("", "  ", "ab"):
        with pytest.raises(AppError) as error:
            require_reason(blank)
        assert error.value.code == "reason_required"
    assert PaidSalesSuspensionRequest(suspended=False).reason == ""


def test_search_pattern_escapes_like_wildcards() -> None:
    assert like_pattern(" 50%_off/ ") == "%50/%/_off//%"
