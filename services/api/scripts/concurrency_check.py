"""Prove the row-lock and idempotency invariants against a running BiletFlow API."""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.config import settings

API_ROOT = os.getenv("BILETFLOW_DEMO_API", "http://127.0.0.1:8010").rstrip("/")
API = f"{API_ROOT}/api/v1"


class ConcurrencyCheck:
    def __init__(self) -> None:
        self.client = httpx.AsyncClient(timeout=30)
        self.organizer_token = ""
        self.attendees: list[dict[str, str]] = []

    async def close(self) -> None:
        await self.client.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        expected: int | tuple[int, ...] = 200,
        **kwargs: Any,
    ) -> httpx.Response:
        headers = dict(kwargs.pop("headers", {}))
        if token:
            headers["Authorization"] = f"Bearer {token}"
        response = await self.client.request(method, f"{API}{path}", headers=headers, **kwargs)
        expected_codes = (expected,) if isinstance(expected, int) else expected
        if response.status_code not in expected_codes:
            try:
                detail = response.json().get("code") or response.json().get("detail")
            except Exception:
                detail = response.text[:200]
            raise AssertionError(
                f"{method} {path}: expected {expected_codes}, got {response.status_code} ({detail})"
            )
        return response

    async def login(self, email: str) -> str:
        response = await self.request(
            "POST",
            "/auth/login",
            json={"email": email, "password": settings.demo_password, "device_name": "race-check"},
        )
        return str(response.json()["access_token"])

    async def setup(self) -> None:
        self.organizer_token = await self.login("organizer@example.com")
        marker = uuid.uuid4().hex[:12]
        for number in range(2):
            email = f"race-{marker}-{number}@example.com"
            registration = await self.request(
                "POST",
                "/auth/register",
                expected=201,
                json={
                    "email": email,
                    "password": settings.demo_password,
                    "display_name": f"Race Attendee {number + 1}",
                    "locale": "en",
                },
            )
            verification_token = registration.json().get("development_verification_token")
            if not verification_token:
                raise AssertionError("Development verification token was not returned.")
            await self.request(
                "POST", "/auth/verify-email", json={"token": verification_token}
            )
            self.attendees.append(
                {
                    "email": email,
                    "name": f"Race Attendee {number + 1}",
                    "token": await self.login(email),
                }
            )

    async def create_event(
        self, label: str, *, seating_mode: str = "general_admission"
    ) -> dict[str, Any]:
        now = datetime.now(UTC)
        response = await self.request(
            "POST",
            "/events",
            token=self.organizer_token,
            expected=201,
            json={
                "title": f"Concurrency {label} {uuid.uuid4().hex[:8]}",
                "description": "A deterministic event used to verify concurrent database invariants.",
                "category": "Testing",
                "venue_name": "BiletFlow Test Hall",
                "venue_address": "1 Verification Avenue",
                "city": "Almaty",
                "starts_at": (now + timedelta(days=14)).isoformat(),
                "ends_at": (now + timedelta(days=14, hours=3)).isoformat(),
                "timezone": "Asia/Almaty",
                "registration_opens_at": (now - timedelta(days=1)).isoformat(),
                "registration_closes_at": (now + timedelta(days=13)).isoformat(),
                "capacity": 168 if seating_mode == "assigned" else 10,
                "visibility": "public",
                "seating_mode": seating_mode,
                "refund_policy": "Full refunds are available until the event starts.",
            },
        )
        return dict(response.json())

    async def add_ticket_type(
        self,
        event_id: str,
        *,
        quantity: int,
        price_tiyin: int = 0,
        price_category: str | None = None,
    ) -> dict[str, Any]:
        response = await self.request(
            "POST",
            f"/events/{event_id}/ticket-types",
            token=self.organizer_token,
            expected=201,
            json={
                "name": f"Race ticket {uuid.uuid4().hex[:6]}",
                "description": "Concurrency verification admission",
                "price_tiyin": price_tiyin,
                "quantity": quantity,
                "max_per_order": 4,
                "price_category": price_category,
            },
        )
        return dict(response.json())

    async def publish(self, event_id: str) -> None:
        await self.request(
            "POST", f"/events/{event_id}/publish", token=self.organizer_token
        )

    async def checkout(
        self,
        attendee: dict[str, str],
        event_id: str,
        ticket_type_id: str,
        *,
        seat_id: str | None = None,
        promo_code: str | None = None,
    ) -> httpx.Response:
        return await self.client.post(
            f"{API}/checkout/sessions",
            headers={"Authorization": f"Bearer {attendee['token']}"},
            json={
                "event_id": event_id,
                "promo_code": promo_code,
                "idempotency_key": f"race-checkout-{uuid.uuid4()}",
                "lines": [
                    {
                        "ticket_type_id": ticket_type_id,
                        "seat_id": seat_id,
                        "quantity": 1,
                        "attendee_name": attendee["name"],
                        "attendee_email": attendee["email"],
                    }
                ],
            },
        )

    @staticmethod
    def assert_single_winner(
        responses: list[httpx.Response], loser_statuses: set[int], label: str
    ) -> httpx.Response:
        winners = [response for response in responses if response.status_code == 201]
        losers = [response for response in responses if response.status_code in loser_statuses]
        if len(winners) != 1 or len(losers) != 1:
            raise AssertionError(
                f"{label}: expected one winner and one loser, got {[item.status_code for item in responses]}"
            )
        print(f"PASS  {label}")
        return winners[0]

    async def inventory_race(self) -> None:
        event = await self.create_event("final inventory")
        ticket_type = await self.add_ticket_type(event["id"], quantity=1)
        await self.publish(event["id"])
        responses = list(
            await asyncio.gather(
                *(self.checkout(attendee, event["id"], ticket_type["id"]) for attendee in self.attendees)
            )
        )
        self.assert_single_winner(responses, {409}, "last general-admission ticket has one winner")

    async def seat_race(self) -> None:
        event = await self.create_event("same seat", seating_mode="assigned")
        ticket_type = await self.add_ticket_type(
            event["id"], quantity=168, price_category="standard"
        )
        await self.publish(event["id"])
        seats = (
            await self.request("GET", f"/events/{event['id']}/seats")
        ).json()
        seat = next(item for item in seats if item["price_category"] == "standard")
        responses = list(
            await asyncio.gather(
                *(
                    self.checkout(
                        attendee,
                        event["id"],
                        ticket_type["id"],
                        seat_id=seat["id"],
                    )
                    for attendee in self.attendees
                )
            )
        )
        self.assert_single_winner(responses, {409}, "same assigned seat has one winner")

    async def promo_race(self) -> None:
        event = await self.create_event("final promotion")
        ticket_type = await self.add_ticket_type(event["id"], quantity=2)
        code = f"RACE{uuid.uuid4().hex[:8]}".upper()
        await self.request(
            "POST",
            f"/events/{event['id']}/campaigns",
            token=self.organizer_token,
            expected=201,
            json={
                "name": "One-redemption race",
                "code": code,
                "discount_type": "percentage",
                "discount_value": 10,
                "max_redemptions": 1,
                "applicable_ticket_type_ids": [],
            },
        )
        await self.publish(event["id"])
        responses = list(
            await asyncio.gather(
                *(
                    self.checkout(
                        attendee,
                        event["id"],
                        ticket_type["id"],
                        promo_code=code,
                    )
                    for attendee in self.attendees
                )
            )
        )
        self.assert_single_winner(responses, {422}, "final promo redemption has one winner")

    async def payment_and_checkin_races(self) -> None:
        event = await self.create_event("payment and admission")
        ticket_type = await self.add_ticket_type(
            event["id"], quantity=2, price_tiyin=250_000
        )
        await self.request(
            "POST",
            f"/events/{event['id']}/activation/simulate",
            token=self.organizer_token,
            json={
                "outcome": "success",
                "idempotency_key": f"race-activation-{uuid.uuid4()}",
                "terms_accepted": True,
                "organizer_verification_confirmed": True,
            },
        )
        await self.publish(event["id"])
        checkout = await self.checkout(
            self.attendees[0], event["id"], ticket_type["id"]
        )
        if checkout.status_code != 201:
            raise AssertionError(f"Could not reserve payment race ticket: {checkout.status_code}")
        session_id = checkout.json()["id"]
        payment_key = f"race-payment-{uuid.uuid4()}"

        async def confirm() -> httpx.Response:
            return await self.client.post(
                f"{API}/checkout/sessions/{session_id}/confirm",
                headers={"Authorization": f"Bearer {self.attendees[0]['token']}"},
                json={"outcome": "success", "idempotency_key": payment_key},
            )

        confirmations = list(await asyncio.gather(confirm(), confirm()))
        if [item.status_code for item in confirmations] != [200, 200]:
            raise AssertionError(
                f"Concurrent payment replay was not idempotent: {[item.status_code for item in confirmations]}"
            )
        order_ids = {item.json()["order_id"] for item in confirmations}
        if len(order_ids) != 1:
            raise AssertionError("Concurrent payment replay issued multiple orders.")
        print("PASS  concurrent payment confirmation returns one canonical order")

        tickets = (
            await self.request(
                "GET", "/tickets", token=self.attendees[0]["token"]
            )
        ).json()
        ticket = next(item for item in tickets if item["event_id"] == event["id"])
        captured = datetime.now(UTC).isoformat()

        async def scan() -> httpx.Response:
            return await self.client.post(
                f"{API}/scanner/scan",
                headers={"Authorization": f"Bearer {self.organizer_token}"},
                json={
                    "qr_token": ticket["qr_token"],
                    "event_id": event["id"],
                    "operation_id": f"race-scan-{uuid.uuid4()}",
                    "captured_at": captured,
                    "was_offline": False,
                },
            )

        scans = list(await asyncio.gather(scan(), scan()))
        outcomes = sorted(item.json()["outcome"] for item in scans)
        if outcomes != ["already_used", "valid"]:
            raise AssertionError(f"Concurrent check-in outcomes were {outcomes}.")
        print("PASS  concurrent admission scan creates one active check-in")
        await self.request(
            "POST",
            f"/scanner/tickets/{ticket['id']}/reverse",
            token=self.organizer_token,
            params={"operation_id": f"race-reverse-{uuid.uuid4()}"},
        )

    async def run(self) -> None:
        await self.setup()
        await self.inventory_race()
        await self.seat_race()
        await self.promo_race()
        await self.payment_and_checkin_races()
        print("\nBiletFlow concurrency verification complete: 5 invariants passed.")


async def main() -> int:
    check = ConcurrencyCheck()
    try:
        await check.run()
    except Exception as error:
        print(f"FAIL  {type(error).__name__}: {error}")
        return 1
    finally:
        await check.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
