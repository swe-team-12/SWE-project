"""Checkout abandonment, suspended paid sales, seat release and campaign state."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy.dialects import postgresql

from app.enums import CheckoutStatus, EventStatus, EventVisibility, SeatingMode
from app.errors import AppError
from app.models import (
    AuditLog,
    Campaign,
    CheckoutSession,
    Event,
    SeatHold,
    TicketType,
    User,
    VenueSeat,
)
from app.routers import commerce
from app.schemas import CheckoutCreate

NOW = datetime(2027, 3, 1, 12, 0, tzinfo=UTC)


def campaign(**overrides: Any) -> Campaign:
    values: dict[str, Any] = {
        "id": uuid.uuid4(),
        "event_id": uuid.uuid4(),
        "name": "Spring",
        "code": "SPRING",
        "is_enabled": True,
        "starts_at": None,
        "ends_at": None,
        "max_redemptions": None,
    }
    values.update(overrides)
    return Campaign(**values)


@pytest.mark.parametrize(
    ("overrides", "redeemed", "expected"),
    [
        ({}, 0, "active"),
        ({"is_enabled": False}, 0, "disabled"),
        ({"starts_at": NOW + timedelta(days=1)}, 0, "not_started"),
        ({"ends_at": NOW - timedelta(seconds=1)}, 0, "expired"),
        ({"max_redemptions": 2}, 2, "exhausted"),
        ({"max_redemptions": 2}, 1, "active"),
        # A disabled campaign reports disabled even if it is also expired.
        ({"is_enabled": False, "ends_at": NOW - timedelta(days=1)}, 0, "disabled"),
    ],
)
def test_campaign_state_is_stable(overrides: dict, redeemed: int, expected: str) -> None:
    assert commerce.campaign_state(campaign(**overrides), NOW, redeemed) == expected


def test_every_inactive_campaign_state_has_a_stable_error_code() -> None:
    assert commerce.CAMPAIGN_STATE_CODES == {
        "active": None,
        "disabled": "promo_disabled",
        "not_started": "promo_not_started",
        "expired": "promo_expired",
        "exhausted": "promo_exhausted",
    }


class AbandonDb:
    def __init__(self, session: CheckoutSession | None) -> None:
        self.session = session
        self.executed: list[Any] = []
        self.added: list[Any] = []
        self.commits = 0
        self.scalars_seen = 0

    async def scalar(self, statement: Any) -> Any:
        self.scalars_seen += 1
        if self.session is None:
            return None
        entity = statement.column_descriptions[0]["entity"]
        if entity is CheckoutSession and statement.column_descriptions[0]["name"] != "event_id":
            return self.session
        return self.session.event_id

    async def execute(self, statement: Any) -> None:
        self.executed.append(statement)

    def add(self, instance: Any) -> None:
        self.added.append(instance)

    async def commit(self) -> None:
        self.commits += 1


def open_session(status: CheckoutStatus = CheckoutStatus.OPEN) -> CheckoutSession:
    return CheckoutSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        event_id=uuid.uuid4(),
        status=status,
        expires_at=datetime.now(UTC) + timedelta(minutes=10),
    )


async def test_abandon_closes_the_session_and_releases_seat_holds() -> None:
    session = open_session()
    db = AbandonDb(session)

    result = await commerce.abandon_checkout(session.id, User(id=session.user_id), db)  # type: ignore[arg-type]

    assert result.status == CheckoutStatus.EXPIRED
    assert result.expires_at <= datetime.now(UTC)
    assert [statement.table.name for statement in db.executed] == [SeatHold.__tablename__]
    assert db.executed[0].is_delete
    audits = [item for item in db.added if isinstance(item, AuditLog)]
    assert [item.action for item in audits] == ["checkout.abandoned"]
    assert db.commits == 1


@pytest.mark.parametrize("status", [CheckoutStatus.EXPIRED, CheckoutStatus.FAILED])
async def test_abandon_is_idempotent_for_closed_sessions(status: CheckoutStatus) -> None:
    session = open_session(status)
    db = AbandonDb(session)

    result = await commerce.abandon_checkout(session.id, User(id=session.user_id), db)  # type: ignore[arg-type]

    assert result.status == status
    assert db.executed == []
    assert db.commits == 0


async def test_abandon_rejects_a_completed_checkout() -> None:
    session = open_session(CheckoutStatus.COMPLETED)
    db = AbandonDb(session)

    with pytest.raises(AppError) as error:
        await commerce.abandon_checkout(session.id, User(id=session.user_id), db)  # type: ignore[arg-type]

    assert (error.value.status, error.value.code) == (409, "checkout_completed")
    assert db.commits == 0


async def test_abandon_unknown_checkout_is_not_found() -> None:
    db = AbandonDb(None)

    with pytest.raises(AppError) as error:
        await commerce.abandon_checkout(uuid.uuid4(), User(id=uuid.uuid4()), db)  # type: ignore[arg-type]

    assert (error.value.status, error.value.code) == (404, "checkout_not_found")


class CheckoutDb:
    def __init__(self, ticket_types: dict[uuid.UUID, TicketType], *results: Any) -> None:
        self.ticket_types = ticket_types
        self.results = list(results)
        self.added: list[Any] = []
        self.commits = 0

    async def scalar(self, _statement: Any) -> Any:
        return self.results.pop(0)

    async def get(self, _model: Any, key: Any) -> Any:
        return self.ticket_types[key]

    def add(self, instance: Any) -> None:
        self.added.append(instance)

    async def flush(self) -> None:
        pass

    async def commit(self) -> None:
        self.commits += 1


def suspended_event(monkeypatch, seating: SeatingMode = SeatingMode.ASSIGNED) -> Event:
    async def fake_expire(_db: Any, event_id: uuid.UUID | None = None) -> int:
        return 0

    async def available(*_args: Any, **_kwargs: Any) -> bool:
        return True

    monkeypatch.setattr(commerce, "expire_checkout_sessions", fake_expire)
    monkeypatch.setattr(commerce, "_inventory_available", available)
    return Event(
        id=uuid.uuid4(),
        status=EventStatus.PUBLISHED,
        visibility=EventVisibility.PUBLIC,
        seating_mode=seating,
        paid_sales_suspended=True,
        paid_sales_active=True,
    )


def line(ticket_type: TicketType, seat: VenueSeat | None = None) -> dict:
    return {
        "ticket_type_id": ticket_type.id,
        "seat_id": seat.id if seat else None,
        "attendee_name": "Aru",
        "attendee_email": "a@x.kz",
    }


def verified_user() -> User:
    return User(id=uuid.uuid4(), is_email_verified=True)


async def test_free_checkout_still_works_while_paid_sales_are_suspended(monkeypatch) -> None:
    event = suspended_event(monkeypatch)
    free = TicketType(
        id=uuid.uuid4(), event_id=event.id, max_per_order=4, is_hidden=False, price_tiyin=0
    )
    seat = VenueSeat(
        id=uuid.uuid4(), event_id=event.id, price_category="standard", is_unavailable=False
    )
    payload = CheckoutCreate(event_id=event.id, idempotency_key="free-seat-key", lines=[line(free, seat)])
    # existing session, event, ticket type, seat, sold-seat lookup, held-seat lookup
    db = CheckoutDb({free.id: free}, None, event, free, seat, None, None)

    session = await commerce.create_checkout(payload, verified_user(), db)  # type: ignore[arg-type]

    assert session.total_tiyin == 0
    assert [hold.seat_id for hold in db.added if isinstance(hold, SeatHold)] == [seat.id]
    assert db.commits == 1


async def test_paid_lines_are_rejected_while_paid_sales_are_suspended(monkeypatch) -> None:
    event = suspended_event(monkeypatch)
    paid = TicketType(
        id=uuid.uuid4(), event_id=event.id, max_per_order=4, is_hidden=False, price_tiyin=500_000
    )
    seat = VenueSeat(
        id=uuid.uuid4(), event_id=event.id, price_category="standard", is_unavailable=False
    )
    payload = CheckoutCreate(event_id=event.id, idempotency_key="paid-seat-key", lines=[line(paid, seat)])
    db = CheckoutDb({paid.id: paid}, None, event, paid)

    with pytest.raises(AppError) as error:
        await commerce.create_checkout(payload, verified_user(), db)  # type: ignore[arg-type]

    assert (error.value.status, error.value.code) == (409, "paid_sales_suspended")
    assert not any(isinstance(item, SeatHold) for item in db.added)
    assert db.commits == 0


async def test_checkout_rejects_the_same_seat_twice_in_one_request(monkeypatch) -> None:
    event = suspended_event(monkeypatch)
    event.paid_sales_suspended = False
    free = TicketType(
        id=uuid.uuid4(), event_id=event.id, max_per_order=4, is_hidden=False, price_tiyin=0
    )
    seat = VenueSeat(
        id=uuid.uuid4(), event_id=event.id, price_category="standard", is_unavailable=False
    )
    payload = CheckoutCreate(
        event_id=event.id,
        idempotency_key="dup-seat-key",
        lines=[line(free, seat), line(free, seat)],
    )
    db = CheckoutDb({free.id: free}, None, event)

    with pytest.raises(AppError) as error:
        await commerce.create_checkout(payload, verified_user(), db)  # type: ignore[arg-type]

    assert (error.value.status, error.value.code) == (422, "duplicate_seat")
    assert db.commits == 0


async def test_multi_seat_checkout_holds_every_selected_seat(monkeypatch) -> None:
    event = suspended_event(monkeypatch)
    event.paid_sales_suspended = False
    paid = TicketType(
        id=uuid.uuid4(), event_id=event.id, max_per_order=4, is_hidden=False, price_tiyin=500_000
    )
    seats = [
        VenueSeat(id=uuid.uuid4(), event_id=event.id, price_category="standard", is_unavailable=False)
        for _ in range(3)
    ]
    payload = CheckoutCreate(
        event_id=event.id,
        idempotency_key="multi-seat-key",
        lines=[line(paid, seat) for seat in seats],
    )
    results: list[Any] = [None, event, paid]
    for seat in seats:
        results.extend([seat, None, None])
    db = CheckoutDb({paid.id: paid}, *results)

    session = await commerce.create_checkout(payload, verified_user(), db)  # type: ignore[arg-type]

    assert session.subtotal_tiyin == 1_500_000
    assert {hold.seat_id for hold in db.added if isinstance(hold, SeatHold)} == {
        seat.id for seat in seats
    }
    assert db.commits == 1


class ExecuteDb:
    def __init__(self) -> None:
        self.statements: list[Any] = []

    async def execute(self, statement: Any) -> None:
        self.statements.append(statement)


def sql(statement: Any) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


async def test_refunded_order_seats_return_to_sale() -> None:
    db = ExecuteDb()

    await commerce.release_order_seats(db, uuid.uuid4())  # type: ignore[arg-type]

    text = sql(db.statements[0])
    assert text.startswith("UPDATE order_items SET seat_id=")
    assert "order_items.order_id =" in text
    assert db.statements[0].compile().params["seat_id"] is None


async def test_legacy_closed_orders_release_their_seats() -> None:
    db = ExecuteDb()
    event_id = uuid.uuid4()

    await commerce.release_closed_order_seats(db, event_id)  # type: ignore[arg-type]

    text = sql(db.statements[0])
    assert "UPDATE order_items SET seat_id=" in text
    assert "orders.status IN" in text
    assert "orders.event_id =" in text
    assert set(commerce.CLOSED_ORDER_STATUSES).isdisjoint(commerce.ACTIVE_ORDER_STATUSES)
