from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta

from app.enums import EventStatus
from app.models import Event
from app.routers.commerce import processing_fee
from app.routers.events import almaty_hall_seat_specs, lifecycle_group


def test_processing_fee_uses_deterministic_half_up_minor_unit_rounding() -> None:
    assert processing_fee(100) == 3
    assert processing_fee(50) == 2
    assert processing_fee(1) == 0
    assert processing_fee(1_234_567) == 37_037


def test_event_lifecycle_groups_are_derived_from_state_and_time() -> None:
    now = datetime.now(UTC)
    event = Event(
        status=EventStatus.PUBLISHED,
        starts_at=now + timedelta(hours=1),
        ends_at=now + timedelta(hours=2),
    )
    assert lifecycle_group(event) == "upcoming"
    event.starts_at = now - timedelta(hours=1)
    assert lifecycle_group(event) == "active"
    event.ends_at = now - timedelta(seconds=1)
    assert lifecycle_group(event) == "completed"
    event.status = EventStatus.CANCELLED
    assert lifecycle_group(event) == "cancelled"


def test_almaty_hall_has_168_non_overlapping_categorized_seats() -> None:
    specs = almaty_hall_seat_specs()
    assert len(specs) == 168
    assert Counter(spec["price_category"] for spec in specs) == {
        "premium": 36,
        "standard": 126,
        "accessible": 6,
    }

    rows: dict[int, list[dict[str, str | bool | int]]] = defaultdict(list)
    for spec in specs:
        rows[int(spec["y"])].append(spec)
    for seats in rows.values():
        ordered = sorted(seats, key=lambda seat: int(seat["x"]))
        for left, right in zip(ordered, ordered[1:], strict=False):
            left_radius = 8 if left["is_accessible"] else 6
            right_radius = 8 if right["is_accessible"] else 6
            assert int(right["x"]) - int(left["x"]) >= left_radius + right_radius
