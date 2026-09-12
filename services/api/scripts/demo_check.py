"""Exercise the complete local BiletFlow demonstration without printing credentials or tokens."""

from __future__ import annotations

import base64
import json
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import quote, urlparse

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from websockets.sync.client import connect as websocket_connect

from app.config import settings

API_ROOT = os.getenv("BILETFLOW_DEMO_API", "http://127.0.0.1:8010").rstrip("/")
API = f"{API_ROOT}/api/v1"


def b64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class Demo:
    def __init__(self) -> None:
        self.client = httpx.Client(timeout=20, follow_redirects=True)
        self.completed: list[str] = []

    def check(self, condition: bool, label: str) -> None:
        if not condition:
            raise AssertionError(label)
        self.completed.append(label)
        print(f"PASS  {label}")

    def request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        expected: int | tuple[int, ...] = 200,
        **kwargs,
    ) -> httpx.Response:
        headers = dict(kwargs.pop("headers", {}))
        if token:
            headers["Authorization"] = f"Bearer {token}"
        response = self.client.request(method, f"{API}{path}", headers=headers, **kwargs)
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

    def login(self, email: str) -> dict:
        response = self.request(
            "POST",
            "/auth/login",
            json={"email": email, "password": settings.demo_password, "device_name": "demo-check"},
        )
        return response.json()

    def run(self) -> None:
        live = self.client.get(f"{API_ROOT}/health/live")
        ready = self.client.get(f"{API_ROOT}/health/ready")
        self.check(live.status_code == 200 and ready.json()["status"] == "ok", "health and dependencies")
        openapi = self.client.get(f"{API_ROOT}/openapi.json")
        self.check(openapi.status_code == 200 and len(openapi.json()["paths"]) >= 45, "versioned OpenAPI surface")

        events = self.request("GET", "/events").json()
        event = next(item for item in events if item["slug"] == "almaty-tech-forum-2026")
        event_id = event["id"]
        self.check(event["status"] == "published" and event["seating_mode"] == "assigned", "public assigned-seating discovery")
        seats = self.request("GET", f"/events/{event_id}/seats").json()
        self.check(len(seats) == 168 and any(item["is_accessible"] for item in seats), "Almaty Hall SVG/list seat data")
        calendar = self.request("GET", f"/events/{event_id}/calendar.ics")
        calendar_text = calendar.text
        self.check(
            "BEGIN:VCALENDAR" in calendar_text
            and f"UID:{event_id}@biletflow.local" in calendar_text
            and "TZID=Asia/Almaty" in calendar_text,
            "stable timezone-aware iCalendar",
        )

        organizer = self.login("organizer@example.com")
        organizer_token = organizer["access_token"]
        attendee = self.login("attendee@example.com")
        attendee_token = attendee["access_token"]
        refreshed = self.request(
            "POST", "/auth/refresh", json={"refresh_token": attendee["refresh_token"]}
        ).json()
        self.check(
            refreshed["refresh_token"] != attendee["refresh_token"],
            "rotating refresh session",
        )
        attendee_token = refreshed["access_token"]
        self.check(
            self.request("GET", "/auth/me", token=attendee_token).json()["is_email_verified"],
            "verified shared account",
        )

        analytics = self.request(
            "GET", f"/events/{event_id}/analytics", token=organizer_token
        ).json()
        history = self.request(
            "GET", f"/events/{event_id}/history", token=organizer_token
        ).json()
        campaigns = self.request(
            "GET", f"/events/{event_id}/campaigns", token=organizer_token
        ).json()
        self.check(
            analytics["kpis"]["capacity"] == 168 and history and campaigns,
            "organizer analytics, campaigns, and append-only history",
        )
        campaign = campaigns[0]
        campaign_png = self.request(
            "GET", f"/campaigns/{campaign['id']}/qr.png", token=organizer_token
        )
        self.check(campaign_png.content.startswith(b"\x89PNG"), "namespaced campaign QR")

        unique = uuid.uuid4().hex[:12]
        outsider_email = f"demo-{unique}@example.com"
        registration = self.request(
            "POST",
            "/auth/register",
            expected=201,
            json={
                "email": outsider_email,
                "password": settings.demo_password,
                "display_name": "Demo Journey Attendee",
                "locale": "kk",
            },
        ).json()
        verification_token = registration.get("development_verification_token")
        self.check(bool(verification_token), "registration and one-use verification issuance")
        self.request(
            "POST", "/auth/verify-email", json={"token": verification_token}
        )
        outsider = self.login(outsider_email)
        outsider_token = outsider["access_token"]

        available_seat = next(
            item
            for item in seats
            if item["status"] == "available" and item["price_category"] == "standard"
        )
        standard_type = next(
            item for item in event["ticket_types"] if item["price_category"] == "standard"
        )
        checkout_key = f"demo-checkout-{uuid.uuid4()}"
        checkout = self.request(
            "POST",
            "/checkout/sessions",
            token=outsider_token,
            expected=201,
            json={
                "event_id": event_id,
                "promo_code": campaign["code"],
                "idempotency_key": checkout_key,
                "lines": [
                    {
                        "ticket_type_id": standard_type["id"],
                        "seat_id": available_seat["id"],
                        "quantity": 1,
                        "attendee_name": "Demo Journey Attendee",
                        "attendee_email": outsider_email,
                    }
                ],
            },
        ).json()
        expected_discount = standard_type["price_tiyin"] * campaign["discount_value"] // 100
        self.check(
            checkout["discount_tiyin"] == expected_discount
            and checkout["processing_fee_tiyin"]
            == round(checkout["total_tiyin"] * 0.03),
            "server pricing, promo reservation, and 3 percent fee",
        )
        payment_key = f"demo-payment-{uuid.uuid4()}"
        order = self.request(
            "POST",
            f"/checkout/sessions/{checkout['id']}/confirm",
            token=outsider_token,
            json={"outcome": "success", "idempotency_key": payment_key},
        ).json()
        repeated = self.request(
            "POST",
            f"/checkout/sessions/{checkout['id']}/confirm",
            token=outsider_token,
            json={"outcome": "success", "idempotency_key": payment_key},
        ).json()
        self.check(order["order_id"] == repeated["order_id"], "idempotent simulated payment confirmation")

        ticket = self.request("GET", "/tickets", token=outsider_token).json()[0]
        pdf = self.request("GET", f"/tickets/{ticket['id']}/pdf", token=outsider_token)
        qr = self.request("GET", f"/tickets/{ticket['id']}/qr.png", token=outsider_token)
        self.check(
            pdf.content.startswith(b"%PDF")
            and len(pdf.content) > 5_000
            and qr.content.startswith(b"\x89PNG"),
            "canonical PDF ticket and signed QR download",
        )

        trust = self.request("GET", "/scanner/public-key").json()
        scanner = self.login("scanner@example.com")
        scanner_token = scanner["access_token"]
        bundle = self.request(
            "GET", f"/scanner/events/{event_id}/bundle", token=scanner_token
        ).json()
        public_key = Ed25519PublicKey.from_public_bytes(b64url(trust["public_key"]))
        public_key.verify(b64url(bundle["signature"]), bundle["encoded"].encode())
        self.check(
            json.loads(b64url(bundle["encoded"])) == bundle["payload"],
            "signed minimal offline validation bundle",
        )
        campaign_scan = self.request(
            "POST",
            "/scanner/scan",
            token=scanner_token,
            json={
                "qr_token": campaign["campaign_url"],
                "event_id": event_id,
                "operation_id": f"campaign-reject-{uuid.uuid4()}",
                "captured_at": datetime.now(UTC).isoformat(),
            },
        ).json()
        self.check(campaign_scan["outcome"] == "invalid", "campaign QR rejected by admission scanner")

        scan = self.request(
            "POST",
            "/scanner/scan",
            token=scanner_token,
            json={
                "qr_token": ticket["qr_token"],
                "event_id": event_id,
                "operation_id": f"online-{uuid.uuid4()}",
                "captured_at": datetime.now(UTC).isoformat(),
            },
        ).json()
        second_scan = self.request(
            "POST",
            "/scanner/scan",
            token=scanner_token,
            json={
                "qr_token": ticket["qr_token"],
                "event_id": event_id,
                "operation_id": f"online-{uuid.uuid4()}",
                "captured_at": datetime.now(UTC).isoformat(),
            },
        ).json()
        self.check(
            scan["outcome"] == "valid" and second_scan["outcome"] == "already_used",
            "transactional online check-in uniqueness",
        )
        self.request(
            "POST",
            f"/scanner/tickets/{ticket['id']}/reverse?operation_id=reverse-{uuid.uuid4()}",
            token=scanner_token,
        )

        captured = datetime.now(UTC)
        offline = self.request(
            "POST",
            "/scanner/sync",
            token=scanner_token,
            json={
                "operations": [
                    {
                        "qr_token": ticket["qr_token"],
                        "event_id": event_id,
                        "operation_id": f"offline-a-{uuid.uuid4()}",
                        "captured_at": captured.isoformat(),
                        "was_offline": True,
                    },
                    {
                        "qr_token": ticket["qr_token"],
                        "event_id": event_id,
                        "operation_id": f"offline-b-{uuid.uuid4()}",
                        "captured_at": (captured + timedelta(milliseconds=1)).isoformat(),
                        "was_offline": True,
                    },
                ]
            },
        ).json()
        self.check(
            offline["accepted"] == 1 and offline["conflicts"] == 1,
            "deterministic offline earliest-scan conflict resolution "
            f"(accepted={offline['accepted']}, conflicts={offline['conflicts']})",
        )
        self.request(
            "POST",
            f"/scanner/tickets/{ticket['id']}/reverse?operation_id=reverse-{uuid.uuid4()}",
            token=scanner_token,
        )

        support_case = self.request(
            "POST",
            "/support/cases",
            token=outsider_token,
            expected=201,
            json={
                "kind": "attendee_to_organizer",
                "category": "refund",
                "subject": "Demo journey refund question",
                "message": "Please confirm the full refund policy.",
                "event_id": event_id,
                "order_id": order["order_id"],
                "ticket_id": ticket["id"],
            },
        ).json()
        case_detail = self.request(
            "GET", f"/support/cases/{support_case['id']}", token=outsider_token
        ).json()
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        )
        attachment = self.request(
            "POST",
            f"/support/messages/{case_detail['messages'][0]['id']}/attachments",
            token=outsider_token,
            expected=201,
            files={"file": ("proof.png", png, "image/png")},
        ).json()
        download = self.request(
            "GET",
            f"/support/attachments/{attachment['id']}/download",
            token=outsider_token,
        ).json()
        stored = self.client.get(download["url"])
        denied = self.request(
            "GET",
            f"/support/attachments/{attachment['id']}/download",
            token=attendee_token,
            expected=403,
        )
        self.check(stored.status_code == 200 and denied.status_code == 403, "private authorized support attachment")

        ws_url = API.replace("http://", "ws://").replace("https://", "wss://")
        with websocket_connect(
            f"{ws_url}/support/cases/{support_case['id']}/ws?token={quote(outsider_token)}",
            open_timeout=10,
        ) as socket:
            socket.send("ping")
            realtime_message = json.loads(socket.recv(timeout=10))
        self.check(realtime_message["type"] == "pong", "authorized real-time support WebSocket")

        refund = self.request(
            "POST",
            (
                f"/orders/{order['order_id']}/refund"
                f"?reason={quote('Demo verified refund')}&idempotency_key=refund-{uuid.uuid4()}"
            ),
            token=organizer_token,
        ).json()
        refunded_scan = self.request(
            "POST",
            "/scanner/scan",
            token=scanner_token,
            json={
                "qr_token": ticket["qr_token"],
                "event_id": event_id,
                "operation_id": f"refunded-{uuid.uuid4()}",
                "captured_at": datetime.now(UTC).isoformat(),
            },
        ).json()
        self.check(refund["status"] == "succeeded" and refunded_scan["outcome"] == "refunded", "full organizer refund and scanner invalidation")
        refund_analytics = self.request(
            "GET", f"/events/{event_id}/analytics", token=organizer_token
        ).json()
        standard_metrics = next(
            item
            for item in refund_analytics["ticket_types"]
            if item["ticket_type_id"] == standard_type["id"]
        )
        self.check(
            refund_analytics["kpis"]["gross_sales_tiyin"]
            >= refund_analytics["kpis"]["refunds_tiyin"]
            and standard_metrics["refunded"] >= 1
            and "reserved" in standard_metrics
            and "available" in standard_metrics,
            "authoritative gross, refund, and inventory analytics",
        )

        failure_seat = next(
            item
            for item in seats
            if item["status"] == "available"
            and item["price_category"] == "standard"
            and item["id"] != available_seat["id"]
        )
        failed_checkout = self.request(
            "POST",
            "/checkout/sessions",
            token=outsider_token,
            expected=201,
            json={
                "event_id": event_id,
                "idempotency_key": f"failed-checkout-{uuid.uuid4()}",
                "lines": [
                    {
                        "ticket_type_id": standard_type["id"],
                        "seat_id": failure_seat["id"],
                        "quantity": 1,
                        "attendee_name": "Demo Journey Attendee",
                        "attendee_email": outsider_email,
                    }
                ],
            },
        ).json()
        failed_payment_key = f"failed-payment-{uuid.uuid4()}"
        first_failure = self.request(
            "POST",
            f"/checkout/sessions/{failed_checkout['id']}/confirm",
            token=outsider_token,
            expected=402,
            json={"outcome": "failure", "idempotency_key": failed_payment_key},
        )
        repeated_failure = self.request(
            "POST",
            f"/checkout/sessions/{failed_checkout['id']}/confirm",
            token=outsider_token,
            expected=402,
            json={"outcome": "failure", "idempotency_key": failed_payment_key},
        )
        self.check(
            first_failure.json()["code"] == repeated_failure.json()["code"],
            "idempotent failed payment without ticket issuance",
        )

        start = datetime.now(UTC) + timedelta(days=45)
        private_event = self.request(
            "POST",
            "/events",
            token=organizer_token,
            expected=201,
            json={
                "title": f"Private Demo {unique}",
                "description": "Invitation-only BiletFlow demonstration event.",
                "category": "Private",
                "venue_name": "Almaty Hall Studio",
                "venue_address": "Abay Avenue 44, Almaty",
                "city": "Almaty",
                "starts_at": start.isoformat(),
                "ends_at": (start + timedelta(hours=2)).isoformat(),
                "timezone": "Asia/Almaty",
                "registration_opens_at": datetime.now(UTC).isoformat(),
                "registration_closes_at": start.isoformat(),
                "capacity": 3,
                "visibility": "private",
                "seating_mode": "general_admission",
            },
        ).json()
        private_id = private_event["id"]
        free_type = self.request(
            "POST",
            f"/events/{private_id}/ticket-types",
            token=organizer_token,
            expected=201,
            json={"name": "Invitation", "price_tiyin": 0, "quantity": 3, "max_per_order": 1},
        ).json()
        self.request("POST", f"/events/{private_id}/publish", token=organizer_token)
        private_detail = self.request(
            "GET", f"/events/{private_id}", token=outsider_token, expected=403
        )
        private_seats = self.request(
            "GET", f"/events/{private_id}/seats", token=outsider_token, expected=403
        )
        private_calendar = self.request(
            "GET", f"/events/{private_id}/calendar.ics", token=outsider_token, expected=403
        )
        self.check(
            {private_detail.json()["code"], private_seats.json()["code"], private_calendar.json()["code"]}
            == {"invitation_required"},
            "private event detail, inventory, and calendar isolation",
        )
        invitation = self.request(
            "POST",
            f"/events/{private_id}/invitations?email={quote(outsider_email)}",
            token=organizer_token,
            expected=201,
        ).json()
        invitation_token = urlparse(invitation["url"]).path.rsplit("/", 1)[-1]
        self.request(
            "POST", f"/invitations/{invitation_token}/accept", token=outsider_token
        )
        visible_private = self.request(
            "GET", f"/events/{private_id}", token=outsider_token
        ).json()
        self.check(visible_private["visibility"] == "private", "authenticated private-event invitation isolation")
        free_checkout = self.request(
            "POST",
            "/checkout/sessions",
            token=outsider_token,
            expected=201,
            json={
                "event_id": private_id,
                "idempotency_key": f"private-{uuid.uuid4()}",
                "lines": [
                    {
                        "ticket_type_id": free_type["id"],
                        "quantity": 1,
                        "attendee_name": "Demo Journey Attendee",
                        "attendee_email": outsider_email,
                    }
                ],
            },
        ).json()
        free_order = self.request(
            "POST",
            f"/checkout/sessions/{free_checkout['id']}/confirm",
            token=outsider_token,
            json={"outcome": "success", "idempotency_key": f"free-{uuid.uuid4()}"},
        ).json()
        cancelled = self.request(
            "POST",
            f"/events/{private_id}/cancel?reason={quote('Demonstration cancellation')}",
            token=organizer_token,
        ).json()
        cancelled_ics = self.request(
            "GET", f"/events/{private_id}/calendar.ics", token=outsider_token
        ).text
        self.check(
            free_order["status"] == "free"
            and cancelled["refunded_orders"] == 1
            and "STATUS:CANCELLED" in cancelled_ics,
            "free registration and event-wide cancellation",
        )

        clone = self.request(
            "POST", f"/events/{event_id}/duplicate", token=organizer_token, expected=201
        ).json()
        activation_key = f"activation-{uuid.uuid4()}"
        activation_payload = {
            "outcome": "success",
            "idempotency_key": activation_key,
            "terms_accepted": True,
            "organizer_verification_confirmed": True,
        }
        activation = self.request(
            "POST",
            f"/events/{clone['id']}/activation/simulate",
            token=organizer_token,
            json=activation_payload,
        ).json()
        activation_repeat = self.request(
            "POST",
            f"/events/{clone['id']}/activation/simulate",
            token=organizer_token,
            json=activation_payload,
        ).json()
        self.check(
            clone["status"] == "draft"
            and len(clone["ticket_types"]) == len(event["ticket_types"])
            and activation["payment_status"] == "succeeded"
            and activation_repeat["paid_sales_active"],
            "safe event duplication and idempotent paid activation",
        )

        image_upload = self.request(
            "POST",
            f"/events/{clone['id']}/image",
            token=organizer_token,
            expected=201,
            files={"file": ("cover.png", png, "image/png")},
        ).json()
        self.check(image_upload["image_url"].startswith("http"), "private MinIO event media")

        self.request(
            "POST",
            "/analytics/capture",
            expected=202,
            json={
                "anonymous_id": f"demo-check-{unique}",
                "name": "event_view",
                "event_id": event_id,
                "properties": {"source": "scripted_demo", "email": outsider_email},
            },
        )
        admin = self.login("admin@example.com")
        admin_token = admin["access_token"]
        search = self.request(
            "GET", f"/admin/search?q={quote(unique)}", token=admin_token
        ).json()
        activations = self.request(
            "GET", "/admin/activation-payments", token=admin_token
        ).json()
        report = self.request(
            "GET", "/admin/reports/operations.csv", token=admin_token
        )
        notifications = self.request(
            "GET", "/notifications", token=outsider_token
        ).json()
        self.request(
            "POST",
            "/auth/logout",
            expected=204,
            json={"refresh_token": refreshed["refresh_token"]},
        )
        revoked_refresh = self.request(
            "POST",
            "/auth/refresh",
            expected=401,
            json={"refresh_token": refreshed["refresh_token"]},
        )
        self.check(
            search["users"]
            and any(item["event_id"] == clone["id"] for item in activations)
            and report.text.startswith("order_number,")
            and notifications,
            "platform administration, privacy-safe analytics path, CSV, and notifications",
        )
        self.check(revoked_refresh.json()["code"] == "invalid_refresh_token", "logout revokes rotating session")

        print(f"\nBiletFlow demonstration complete: {len(self.completed)} checks passed.")


if __name__ == "__main__":
    try:
        Demo().run()
    except Exception as exc:
        print(f"FAIL  {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
