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
