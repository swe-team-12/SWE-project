import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db import Base
from app.enums import EventStatus, EventVisibility
from app.models import Event
from app.routers import events as events_router
from app.routers.events import list_public_events


@pytest.fixture
async def db(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[AsyncSession]:
    # SQLite drops timezone info, so skip lifecycle serialization and inspect rows directly.
    monkeypatch.setattr(events_router, "serialize_event", lambda event: event)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


def make_event(title: str, venue_name: str, starts_in_days: int) -> Event:
    starts_at = datetime.now(UTC) + timedelta(days=starts_in_days)
    return Event(
        owner_id=uuid.uuid4(),
        slug=f"event-{uuid.uuid4().hex}",
        title=title,
        description="Public BiletFlow event.",
        category="Music",
        venue_name=venue_name,
        venue_address="Abay Avenue 44, Almaty",
        city="Almaty",
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=3),
        capacity=100,
        status=EventStatus.PUBLISHED,
        visibility=EventVisibility.PUBLIC,
    )


async def test_exact_title_match_is_ranked_ahead_of_other_field_matches(db: AsyncSession) -> None:
    db.add_all(
        [make_event(f"Concert {index}", "Almaty Hall", index + 1) for index in range(30)]
        + [make_event("Almaty Hall", "Republic Palace", 60)]
    )
    await db.commit()

    results = await list_public_events(db, q="almaty hall", limit=30)

    assert results[0].title == "Almaty Hall"


async def test_search_treats_like_wildcards_literally(db: AsyncSession) -> None:
    db.add_all(
        [
            make_event("1000 Voices", "Almaty Hall", 1),
            make_event("100% Jazz", "Almaty Hall", 2),
        ]
    )
    await db.commit()

    results = await list_public_events(db, q="100%", limit=30)

    assert [event.title for event in results] == ["100% Jazz"]


async def test_date_range_is_inclusive_in_almaty_time(db: AsyncSession) -> None:
    almaty = ZoneInfo("Asia/Almaty")
    starts = {
        "Before": datetime(2030, 11, 9, 23, 30, tzinfo=almaty),
        "First day": datetime(2030, 11, 10, 0, 0, tzinfo=almaty),
        "Middle": datetime(2030, 11, 12, 19, 0, tzinfo=almaty),
        "Last day late": datetime(2030, 11, 15, 23, 30, tzinfo=almaty),
        "After": datetime(2030, 11, 16, 0, 0, tzinfo=almaty),
    }
    for title, starts_at in starts.items():
        event = make_event(title, "Almaty Hall", 1)
        event.starts_at = starts_at.astimezone(UTC)
        event.ends_at = event.starts_at + timedelta(hours=3)
        db.add(event)
    await db.commit()

    results = await list_public_events(
        db, date_from=date(2030, 11, 10), date_to=date(2030, 11, 15), limit=30
    )

    assert [event.title for event in results] == ["First day", "Middle", "Last day late"]
