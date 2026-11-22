import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.access import event_change_data
from app.enums import EventStatus, NotificationType
from app.errors import AppError
from app.models import Event, OrganizerProfile, TicketType, User
from app.routers import events as events_router
from app.routers.events import (
    ACTIVATION_REQUIREMENTS,
    activation_checklist,
    first_missing_requirement,
    lifecycle_group,
    require_not_moderated,
    without_hidden_ticket_types,
)
from app.schemas import ActivationSimulation, EventOut, TicketTypeOut


def make_event(**overrides: Any) -> Event:
    now = datetime.now(UTC)
    values: dict[str, Any] = {
        "id": uuid.uuid4(),
        "owner_id": uuid.uuid4(),
        "slug": "sample",
        "title": "Sample",
        "description": "Sample description",
        "category": "Tech",
        "venue_name": "Hall",
        "venue_address": "Street 1",
        "city": "Almaty",
        "starts_at": now + timedelta(days=1),
        "ends_at": now + timedelta(days=1, hours=2),
        "timezone": "Asia/Almaty",
        "capacity": 10,
        "status": EventStatus.PUBLISHED,
        "visibility": "public",
        "seating_mode": "general_admission",
        "refund_policy": "Full refunds.",
        "terms_accepted": False,
        "activation_paid": False,
        "paid_sales_active": False,
        "paid_sales_suspended": False,
    }
    values.update(overrides)
    return Event(**values)


def verified_profile(**overrides: Any) -> OrganizerProfile:
    values: dict[str, Any] = {
        "organization_name": "Org",
        "contact_email": "org@example.com",
        "identity_verified": True,
        "payout_account_label": "Demo payout account",
        "payout_verified": True,
    }
    values.update(overrides)
    return OrganizerProfile(**values)


def checklist(**overrides: Any) -> list[dict]:
    arguments: dict[str, Any] = {
        "event": make_event(),
        "owner": User(is_email_verified=True),
        "profile": verified_profile(),
        "has_paid_ticket_type": True,
        "terms_accepted": True,
    }
    arguments.update(overrides)
    return activation_checklist(**arguments)


def missing_code(**overrides: Any) -> str | None:
    error = first_missing_requirement(checklist(**overrides))
    return error.code if error else None


def test_complete_prerequisites_have_no_missing_requirement() -> None:
    assert missing_code() is None


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"has_paid_ticket_type": False}, "paid_ticket_required"),
        ({"profile": None}, "organizer_profile_required"),
        ({"owner": User(is_email_verified=False)}, "email_not_verified"),
        ({"owner": None}, "email_not_verified"),
        (
            {"profile": verified_profile(identity_verified=False)},
            "identity_verification_required",
        ),
        ({"profile": verified_profile(payout_account_label=None)}, "payout_account_required"),
        ({"profile": verified_profile(payout_account_label="   ")}, "payout_account_required"),
        ({"profile": verified_profile(payout_verified=False)}, "payout_verification_required"),
        ({"terms_accepted": False}, "terms_acceptance_required"),
    ],
)
def test_each_activation_requirement_is_enforced_with_a_stable_code(
    overrides: dict[str, Any], code: str
) -> None:
    assert missing_code(**overrides) == code


def test_checklist_reports_every_item_and_uses_stored_terms_by_default() -> None:
    event = make_event(terms_accepted=True, activation_paid=True)
    items = activation_checklist(
        event=event,
        owner=User(is_email_verified=True),
        profile=verified_profile(),
        has_paid_ticket_type=True,
    )
    assert [item["key"] for item in items] == [
        *(key for key, *_ in ACTIVATION_REQUIREMENTS),
        "activation_fee_paid",
    ]
    assert all(item["done"] for item in items)
    assert all(item["error_code"] for item in items)

    pending = activation_checklist(
        event=make_event(), owner=None, profile=None, has_paid_ticket_type=False
    )
    assert not any(item["done"] for item in pending)


def test_legacy_confirmation_flag_is_optional_and_cannot_stand_in_for_verification() -> None:
    payload = ActivationSimulation(idempotency_key="activation-key", terms_accepted=True)
    assert payload.organizer_verification_confirmed is False
    assert (
        missing_code(profile=verified_profile(identity_verified=False, payout_verified=False))
        == "identity_verification_required"
    )


@pytest.mark.parametrize(
    ("status", "code"),
    [(EventStatus.SUSPENDED, "event_suspended"), (EventStatus.CANCELLED, "event_cancelled")],
)
def test_organizer_cannot_change_publication_of_moderated_events(
    status: EventStatus, code: str
) -> None:
    with pytest.raises(AppError) as error:
        require_not_moderated(make_event(status=status))
    assert error.value.code == code
    assert error.value.status == 409


@pytest.mark.parametrize(
    "status", [EventStatus.DRAFT, EventStatus.PUBLISHED, EventStatus.UNPUBLISHED]
)
def test_unmoderated_events_may_change_publication(status: EventStatus) -> None:
    require_not_moderated(make_event(status=status))


class OwnerDb:
    """Minimal session double: every lookup resolves to the prepared event."""

    def __init__(self, event: Event) -> None:
        self.event = event
        self.commits = 0

    async def scalar(self, statement: Any) -> Event:
        return self.event

    async def commit(self) -> None:
        self.commits += 1


@pytest.mark.parametrize("endpoint", ["publish_event", "unpublish_event"])
async def test_publish_and_unpublish_reject_admin_suspended_event(endpoint: str) -> None:
    owner = User(id=uuid.uuid4(), roles=["attendee", "organizer"], is_email_verified=True)
    event = make_event(owner_id=owner.id, status=EventStatus.SUSPENDED)
    event.ticket_types = [TicketType(id=uuid.uuid4(), name="General", quantity=5)]
    db = OwnerDb(event)

    with pytest.raises(AppError) as error:
        await getattr(events_router, endpoint)(event.id, owner, db)  # type: ignore[arg-type]

    assert error.value.code == "event_suspended"
    assert event.status == EventStatus.SUSPENDED
    assert db.commits == 0


@pytest.mark.parametrize(
    "status", [EventStatus.DRAFT, EventStatus.UNPUBLISHED, EventStatus.SUSPENDED]
)
def test_non_public_states_keep_a_dashboard_lifecycle_group(status: EventStatus) -> None:
    now = datetime.now(UTC)
    upcoming = make_event(status=status)
    finished = make_event(
        status=status, starts_at=now - timedelta(days=2), ends_at=now - timedelta(days=1)
    )
    assert lifecycle_group(upcoming) == "upcoming"
    assert lifecycle_group(finished) == "completed"


def ticket_type_out(name: str, *, hidden: bool) -> TicketTypeOut:
    return TicketTypeOut(
        id=uuid.uuid4(),
        name=name,
        description="",
        price_tiyin=0,
        quantity=5,
        max_per_order=2,
        is_hidden=hidden,
        price_category=None,
    )


def test_hidden_ticket_types_are_removed_from_attendee_payloads() -> None:
    payload = EventOut.model_validate(make_event())
    payload.ticket_types = [
        ticket_type_out("Public", hidden=False),
        ticket_type_out("Backstage", hidden=True),
    ]
    assert [item.name for item in without_hidden_ticket_types(payload).ticket_types] == ["Public"]


def test_ticket_type_output_exposes_the_sales_window() -> None:
    opens = datetime.now(UTC)
    closes = opens + timedelta(days=3)
    ticket_type = TicketType(
        id=uuid.uuid4(),
        name="Early",
        description="",
        price_tiyin=100,
        quantity=5,
        max_per_order=2,
        is_hidden=False,
        sales_start_at=opens,
        sales_end_at=closes,
    )
    output = TicketTypeOut.model_validate(ticket_type)
    assert output.sales_start_at == opens
    assert output.sales_end_at == closes


def test_event_change_payload_is_machine_readable() -> None:
    event = make_event(status=EventStatus.SUSPENDED)
    data = event_change_data(event, "suspended", "policy violation", attendees=3)
    assert data == {
        "event_id": str(event.id),
        "event_title": "Sample",
        "event_status": "suspended",
        "change": "suspended",
        "reason": "policy violation",
        "attendees": 3,
    }
    assert event_change_data(event, "unpublished")["reason"] is None


def test_notification_type_values_fit_the_existing_column() -> None:
    # notifications.type was created as varchar(20) by the initial schema.
    assert max(len(item.value) for item in NotificationType) <= 20
