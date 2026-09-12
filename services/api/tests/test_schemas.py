from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.schemas import CampaignCreate, EventCreate, ScanRequest, TicketTypeCreate


def event_payload() -> dict:
    start = datetime.now(UTC) + timedelta(days=2)
    return {
        "title": "Schema Test Event",
        "description": "A complete event description for schema validation.",
        "category": "Technology",
        "venue_name": "Almaty Hall",
        "venue_address": "44 Abay Avenue",
        "starts_at": start,
        "ends_at": start + timedelta(hours=2),
        "capacity": 100,
    }


def test_event_requires_iana_timezone_and_ordered_aware_dates() -> None:
    assert EventCreate(**event_payload()).timezone == "Asia/Almaty"

    with pytest.raises(ValidationError, match="IANA"):
        EventCreate(**{**event_payload(), "timezone": "Almaty-ish"})

    payload = event_payload()
    payload["starts_at"] = payload["starts_at"].replace(tzinfo=None)
    with pytest.raises(ValidationError, match="UTC offset"):
        EventCreate(**payload)

    payload = event_payload()
    payload["ends_at"] = payload["starts_at"]
    with pytest.raises(ValidationError, match="ends_at"):
        EventCreate(**payload)


def test_ticket_and_campaign_windows_must_be_ordered() -> None:
    now = datetime.now(UTC)
    with pytest.raises(ValidationError, match="sales_end_at"):
        TicketTypeCreate(
            name="Standard",
            price_tiyin=100_000,
            quantity=10,
            sales_start_at=now,
            sales_end_at=now - timedelta(seconds=1),
        )
    with pytest.raises(ValidationError, match="ends_at"):
        CampaignCreate(
            name="Launch",
            discount_type="percentage",
            discount_value=10,
            starts_at=now,
            ends_at=now - timedelta(seconds=1),
        )


def test_scan_capture_time_requires_timezone() -> None:
    with pytest.raises(ValidationError, match="UTC offset"):
        ScanRequest(
            qr_token="bft:v1:placeholder.signature",
            event_id="2ee643e8-9f0b-4c4f-a11e-6a66f6448d6b",
            operation_id="operation-123",
            captured_at=datetime.now(),
        )
