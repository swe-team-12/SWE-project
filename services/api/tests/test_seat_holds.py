"""Regression tests for #51: an assigned seat can only be held or sold once.

Concurrency safety comes from three layers, all exercised here:
1. create_checkout locks the event row first, so reservations for one event serialize;
2. the seat row itself is read with SELECT ... FOR UPDATE before the hold/sale check;
3. seat_holds.seat_id and order_items.seat_id are UNIQUE, so the database rejects a
   duplicate even if application checks were ever bypassed.
"""

import uuid
from typing import Any

import pytest

from app.enums import EventStatus, EventVisibility, SeatingMode
from app.errors import AppError
from app.models import Event, OrderItem, SeatHold, TicketType, User, VenueSeat
from app.routers import commerce
from app.schemas import CheckoutCreate


class RecordingDb:
    def __init__(self, ticket_type: TicketType, *results: Any) -> None:
        self.ticket_type = ticket_type
        self.results = list(results)
        self.statements: list[Any] = []
        self.added: list[Any] = []
        self.commits = 0

    async def scalar(self, statement: Any) -> Any:
        self.statements.append(statement)
        return self.results.pop(0)

    async def get(self, _model: Any, _id: Any) -> Any:
        return self.ticket_type

    def add(self, instance: Any) -> None:
        self.added.append(instance)

    async def flush(self) -> None:
        pass

    async def commit(self) -> None:
        self.commits += 1


def _setup(monkeypatch) -> tuple[Event, TicketType, VenueSeat, CheckoutCreate]:
    async def fake_expire(_db: Any, event_id: uuid.UUID | None = None) -> int:
        return 0

    async def available(*_args: Any, **_kwargs: Any) -> bool:
        return True

    monkeypatch.setattr(commerce, "expire_checkout_sessions", fake_expire)
    monkeypatch.setattr(commerce, "_inventory_available", available)
    event = Event(
        id=uuid.uuid4(),
        status=EventStatus.PUBLISHED,
        visibility=EventVisibility.PUBLIC,
        seating_mode=SeatingMode.ASSIGNED,
        paid_sales_suspended=False,
        paid_sales_active=True,
    )
    ticket_type = TicketType(
        id=uuid.uuid4(), event_id=event.id, max_per_order=4, is_hidden=False, price_tiyin=0
    )
    seat = VenueSeat(
        id=uuid.uuid4(), event_id=event.id, price_category="standard", is_unavailable=False
    )
    payload = CheckoutCreate(
        event_id=event.id,
        idempotency_key="seat-race-key",
        lines=[
            {
                "ticket_type_id": ticket_type.id,
                "seat_id": seat.id,
                "attendee_name": "Aru",
                "attendee_email": "a@x.kz",
            }
        ],
    )
    return event, ticket_type, seat, payload


def _user() -> User:
    return User(id=uuid.uuid4(), is_email_verified=True)


@pytest.mark.parametrize(
    ("sold", "held"), [(uuid.uuid4(), None), (None, uuid.uuid4())], ids=["sold", "held"]
)
async def test_checkout_rejects_seat_already_sold_or_held(monkeypatch, sold, held) -> None:
    event, ticket_type, seat, payload = _setup(monkeypatch)
    # existing session, event, ticket type, seat, sold-seat lookup, held-seat lookup
    db = RecordingDb(ticket_type, None, event, ticket_type, seat, sold, held)

    with pytest.raises(AppError) as error:
        await commerce.create_checkout(payload, _user(), db)  # type: ignore[arg-type]

    assert error.value.status == 409
    assert error.value.code == "seat_unavailable"
    assert not any(isinstance(item, SeatHold) for item in db.added)
    assert db.commits == 0


async def test_checkout_locks_event_then_seat_before_holding(monkeypatch) -> None:
    event, ticket_type, seat, payload = _setup(monkeypatch)
    db = RecordingDb(ticket_type, None, event, ticket_type, seat, None, None)

    await commerce.create_checkout(payload, _user(), db)  # type: ignore[arg-type]

    locked = [
        statement.column_descriptions[0]["entity"]
        for statement in db.statements
        if statement._for_update_arg is not None
    ]
    assert locked == [Event, TicketType, VenueSeat]
    holds = [item for item in db.added if isinstance(item, SeatHold)]
    assert [hold.seat_id for hold in holds] == [seat.id]
    assert db.commits == 1


def test_database_allows_one_hold_and_one_sale_per_seat() -> None:
    assert SeatHold.__table__.c.seat_id.unique
    assert OrderItem.__table__.c.seat_id.unique
