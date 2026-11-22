"""Scanner admission rules, analytics helpers and the GA4 forwarder."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from app import worker
from app.enums import CheckInAction, TicketStatus
from app.models import AuditLog, CheckInRecord, Order, OrderItem, Ticket, User
from app.routers import analytics, scanner


class Rows:
    def __init__(self, rows: list[Any]) -> None:
        self.rows = rows

    def all(self) -> list[Any]:
        return self.rows

    def first(self) -> Any:
        return self.rows[0] if self.rows else None


class ScanDb:
    def __init__(self, *scalars: Any, rows: list[Any] | None = None) -> None:
        self.scalars = list(scalars)
        self.rows = rows or []
        self.added: list[Any] = []

    async def scalar(self, _statement: Any) -> Any:
        return self.scalars.pop(0)

    async def execute(self, _statement: Any) -> Rows:
        return Rows(self.rows)

    def add(self, instance: Any) -> None:
        self.added.append(instance)


def ticket(status: TicketStatus = TicketStatus.VALID) -> Ticket:
    return Ticket(
        id=uuid.uuid4(),
        ticket_code="TKT-SCAN-001",
        order_item_id=uuid.uuid4(),
        event_id=uuid.uuid4(),
        owner_user_id=uuid.uuid4(),
        status=status,
        qr_nonce="nonce",
    )


def attendee_row(seat: bool = True) -> list[tuple[OrderItem, str]]:
    item = OrderItem(
        id=uuid.uuid4(),
        attendee_name="Aruzhan Demo",
        section="A" if seat else None,
        row="B" if seat else None,
        seat_number="7" if seat else None,
    )
    return [(item, "Premium")]


async def test_totals_count_only_valid_and_checked_in_tickets_as_registered() -> None:
    event_id, other_id = uuid.uuid4(), uuid.uuid4()
    db = ScanDb(
        rows=[
            (event_id, TicketStatus.VALID, 5),
            (event_id, TicketStatus.CHECKED_IN, 3),
            (event_id, TicketStatus.REFUNDED, 2),
            (event_id, TicketStatus.CANCELLED, 1),
        ]
    )

    totals = await scanner.event_totals(db, [event_id, other_id])  # type: ignore[arg-type]

    assert totals[event_id] == {
        "registered": 8,
        "checked_in": 3,
        "remaining": 5,
        "cancelled": 1,
        "refunded": 2,
    }
    assert totals[other_id]["registered"] == 0


async def test_manual_check_in_admits_a_valid_ticket_and_audits_it() -> None:
    item = ticket()
    db = ScanDb(None, None, rows=attendee_row())
    captured_at = datetime.now(UTC)

    result = await scanner.check_in_ticket(
        db,  # type: ignore[arg-type]
        item,
        User(id=uuid.uuid4()),
        operation_id="manual-op-1",
        captured_at=captured_at,
        method="manual",
    )

    assert result.outcome == "valid"
    assert item.status == TicketStatus.CHECKED_IN
    assert result.ticket_status == TicketStatus.CHECKED_IN
    assert result.checked_in_at == captured_at
    assert result.attendee_name == "Aruzhan Demo"
    assert result.ticket_type_name == "Premium"
    assert result.seat_label == "Section A, Row B, Seat 7"
    records = [entry for entry in db.added if isinstance(entry, CheckInRecord)]
    assert [(entry.action, entry.details) for entry in records] == [
        (CheckInAction.CHECK_IN, {"method": "manual"})
    ]
    audits = [entry for entry in db.added if isinstance(entry, AuditLog)]
    assert [entry.action for entry in audits] == ["ticket.checked_in"]


@pytest.mark.parametrize(
    ("status", "outcome"),
    [(TicketStatus.REFUNDED, "refunded"), (TicketStatus.CANCELLED, "cancelled")],
)
async def test_refunded_and_cancelled_tickets_are_never_admitted(status, outcome) -> None:
    item = ticket(status)
    db = ScanDb(rows=attendee_row(seat=False))

    result = await scanner.check_in_ticket(
        db,  # type: ignore[arg-type]
        item,
        User(id=uuid.uuid4()),
        operation_id="op-refunded",
        captured_at=datetime.now(UTC),
    )

    assert result.outcome == outcome
    assert item.status == status
    assert db.added == []


async def test_second_scan_of_an_admitted_ticket_is_rejected() -> None:
    item = ticket(TicketStatus.CHECKED_IN)
    accepted = CheckInRecord(
        ticket_id=item.id,
        event_id=item.event_id,
        action=CheckInAction.CHECK_IN,
        operation_id="first-op",
        captured_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    db = ScanDb(None, accepted, rows=attendee_row())

    result = await scanner.check_in_ticket(
        db,  # type: ignore[arg-type]
        item,
        User(id=uuid.uuid4()),
        operation_id="second-op",
        captured_at=datetime.now(UTC),
    )

    assert result.outcome == "already_used"
    assert result.checked_in_at == accepted.captured_at
    records = [entry for entry in db.added if isinstance(entry, CheckInRecord)]
    assert [entry.action for entry in records] == [CheckInAction.CONFLICT]


async def test_offline_scan_that_predates_a_reversal_does_not_readmit() -> None:
    item = ticket()
    reversal_at = datetime.now(UTC) - timedelta(minutes=1)
    db = ScanDb(reversal_at, None, rows=attendee_row())

    result = await scanner.check_in_ticket(
        db,  # type: ignore[arg-type]
        item,
        User(id=uuid.uuid4()),
        operation_id="stale-offline-op",
        captured_at=reversal_at - timedelta(minutes=10),
        offline_sync=True,
    )

    assert result.outcome == "conflict"
    assert item.status == TicketStatus.VALID


def test_conflict_operation_ids_are_deterministic_and_fit_the_column() -> None:
    first = scanner.conflict_operation_id("a" * 100, "b" * 100)
    assert first == scanner.conflict_operation_id("a" * 100, "b" * 100)
    assert first != scanner.conflict_operation_id("b" * 100, "a" * 100)
    assert len(first) <= 100


def test_analytics_properties_keep_only_safe_scalar_keys() -> None:
    assert analytics.safe_analytics_properties(
        {
            "source": "instagram",
            "medium": "social",
            "email": "person@example.com",
            "route": "someone@example.com",
            "locale": {"nested": True},
            "device_category": "mobile",
        }
    ) == {"source": "instagram", "medium": "social", "device_category": "mobile"}


def test_percentage_and_order_share_never_divide_by_zero() -> None:
    assert analytics.percentage(1, 0) == 0
    assert analytics.percentage(1, 3) == 33.3
    order = Order(id=uuid.uuid4(), subtotal_tiyin=0)
    assert analytics.order_share(order, [], False) == 1.0
    assert analytics.order_share(order, [], True) == 0.0
    order.subtotal_tiyin = 400
    items = [OrderItem(unit_price_tiyin=100)]
    assert analytics.order_share(order, items, True) == 0.25


def test_ga4_payload_contains_no_personal_data() -> None:
    payload = worker.build_ga4_payload(
        "person@example.com",
        "checkout_start",
        {
            "event_id": "0b1f3c9e-7a55-4f0f-8f39-5a6d1b1f0a11",
            "source": "newsletter",
            "email": "person@example.com",
            "attendee_name": "Aruzhan Demo",
            "route": "/u/person@example.com",
            "locale": ["kk"],
        },
    )

    assert payload is not None
    assert "@" not in str(payload)
    assert "Aruzhan" not in str(payload)
    assert payload["client_id"] != "person@example.com"
    assert payload["events"] == [
        {
            "name": "checkout_start",
            "params": {
                "event_id": "0b1f3c9e-7a55-4f0f-8f39-5a6d1b1f0a11",
                "source": "newsletter",
                "engagement_time_msec": 1,
            },
        }
    ]


def test_ga4_payload_keeps_opaque_client_ids_and_rejects_bad_event_names() -> None:
    payload = worker.build_ga4_payload("anon-12345.67890", "event_view", {})
    assert payload is not None
    assert payload["client_id"] == "anon-12345.67890"
    assert worker.build_ga4_payload("anon-1", "bad name!", {}) is None
    assert worker.build_ga4_payload("", "event_view", {}) is None


def test_ga4_forwarder_is_a_silent_no_op_without_credentials(monkeypatch) -> None:
    def unexpected(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("no request may be sent without GA4 credentials")

    monkeypatch.setattr(worker.settings, "ga4_measurement_id", None)
    monkeypatch.setattr(worker.settings, "ga4_api_secret", None)
    monkeypatch.setattr(worker.httpx, "post", unexpected)

    assert worker.forward_ga4_event("anon-1", "event_view", {"source": "direct"}) is False


def test_ga4_forwarder_posts_the_measurement_protocol_payload(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    def fake_post(url: str, **kwargs: Any) -> httpx.Response:
        calls.append({"url": url, **kwargs})
        return httpx.Response(204, request=httpx.Request("POST", url))

    monkeypatch.setattr(worker.settings, "ga4_measurement_id", "G-TEST")
    monkeypatch.setattr(worker.settings, "ga4_api_secret", "test-secret")
    monkeypatch.setattr(worker.httpx, "post", fake_post)

    assert worker.forward_ga4_event(
        "anon-1", "purchase_demo", {"campaign_id": "c-1", "buyer_email": "x@example.com"}
    )

    assert len(calls) == 1
    call = calls[0]
    assert call["url"] == "https://www.google-analytics.com/mp/collect"
    assert call["params"] == {"measurement_id": "G-TEST", "api_secret": "test-secret"}
    assert call["json"]["client_id"] == "anon-1"
    assert call["json"]["events"][0]["name"] == "purchase_demo"
    assert call["json"]["events"][0]["params"] == {
        "campaign_id": "c-1",
        "engagement_time_msec": 1,
    }
    assert "@" not in str(call["json"])


def test_ga4_forwarder_raises_on_http_errors_so_the_task_retries(monkeypatch) -> None:
    def failing_post(url: str, **_kwargs: Any) -> httpx.Response:
        return httpx.Response(500, request=httpx.Request("POST", url))

    monkeypatch.setattr(worker.settings, "ga4_measurement_id", "G-TEST")
    monkeypatch.setattr(worker.settings, "ga4_api_secret", "test-secret")
    monkeypatch.setattr(worker.httpx, "post", failing_post)

    with pytest.raises(httpx.HTTPStatusError):
        worker.forward_ga4_event("anon-1", "event_view", {})
