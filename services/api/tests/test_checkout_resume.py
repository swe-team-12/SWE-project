import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.enums import CheckoutStatus
from app.errors import AppError
from app.models import CheckoutSession, User
from app.routers import commerce


class FakeDb:
    def __init__(self, session: CheckoutSession | None) -> None:
        self.session = session
        self.commits = 0

    async def scalar(self, statement: Any) -> CheckoutSession | None:
        return self.session

    async def commit(self) -> None:
        self.commits += 1


def checkout(expires_in: timedelta) -> CheckoutSession:
    return CheckoutSession(
        id=uuid.uuid4(),
        event_id=uuid.uuid4(),
        status=CheckoutStatus.OPEN,
        expires_at=datetime.now(UTC) + expires_in,
    )


async def test_held_checkout_can_be_reloaded_for_payment() -> None:
    session = checkout(timedelta(minutes=5))
    db = FakeDb(session)

    result = await commerce.get_checkout(session.id, User(id=uuid.uuid4()), db)  # type: ignore[arg-type]

    assert result is session
    assert result.status == CheckoutStatus.OPEN
    assert db.commits == 0


async def test_reloading_an_elapsed_checkout_expires_it_and_releases_holds(monkeypatch) -> None:
    session = checkout(timedelta(seconds=-1))
    db = FakeDb(session)
    released: list[uuid.UUID | None] = []

    async def fake_expire(_db: Any, event_id: uuid.UUID | None = None) -> int:
        released.append(event_id)
        return 1

    monkeypatch.setattr(commerce, "expire_checkout_sessions", fake_expire)

    result = await commerce.get_checkout(session.id, User(id=uuid.uuid4()), db)  # type: ignore[arg-type]

    assert result.status == CheckoutStatus.EXPIRED
    assert released == [session.event_id]
    assert db.commits == 1


async def test_reloading_another_users_checkout_is_not_found() -> None:
    with pytest.raises(AppError) as error:
        await commerce.get_checkout(uuid.uuid4(), User(id=uuid.uuid4()), FakeDb(None))  # type: ignore[arg-type]
    assert error.value.status == 404


class SequenceDb:
    def __init__(self, *results: Any) -> None:
        self.results = list(results)
        self.commits = 0

    async def scalar(self, statement: Any) -> Any:
        return self.results.pop(0)

    async def execute(self, statement: Any) -> None:
        return None

    async def commit(self) -> None:
        self.commits += 1


async def test_confirm_rejects_hold_when_inventory_no_longer_available(monkeypatch) -> None:
    from app.enums import EventStatus
    from app.models import CheckoutLine, Event, TicketType
    from app.schemas import CheckoutConfirm

    session = checkout(timedelta(minutes=5))
    ticket_type = TicketType(id=uuid.uuid4(), quantity=5)
    session.lines = [CheckoutLine(ticket_type_id=ticket_type.id, quantity=3)]
    event = Event(id=session.event_id, status=EventStatus.PUBLISHED, paid_sales_suspended=False)
    db = SequenceDb(session.event_id, event, session, None, None, ticket_type)
    checked: list[tuple[int, uuid.UUID | None]] = []

    async def sold_out(_db: Any, _tt: Any, count: int, _now: Any, exclude_session_id=None) -> bool:
        checked.append((count, exclude_session_id))
        return False

    monkeypatch.setattr(commerce, "_inventory_available", sold_out)
    payload = CheckoutConfirm(outcome="success", idempotency_key="confirm-key-123456")

    with pytest.raises(AppError) as error:
        await commerce.confirm_checkout(session.id, payload, User(id=uuid.uuid4()), db)  # type: ignore[arg-type]

    assert error.value.status == 409
    assert error.value.code == "inventory_exhausted"
    assert checked == [(3, session.id)]
    assert session.status == CheckoutStatus.FAILED
    assert db.commits == 1
