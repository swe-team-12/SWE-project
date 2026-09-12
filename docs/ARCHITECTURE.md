# BiletFlow architecture

## System shape

BiletFlow is a modular monolith. FastAPI routers separate authentication, events, commerce, tickets/calendar, scanner, support, analytics/history, and administration, while one SQLAlchemy model graph and one PostgreSQL transaction boundary preserve consistency. This avoids distributed transaction complexity in the academic scope while keeping modules separable later.

The Expo Router client uses TypeScript, React Native Web, NativeWind, TanStack Query, React Hook Form, i18next, Expo Camera, Expo SecureStore, Expo SQLite, and React Native SVG. It does not calculate trusted prices or determine admission validity.

## Critical transaction boundaries

### Checkout

1. Lock the event, requested ticket types, campaign row, and selected seat rows.
2. Lazily expire stale sessions and release their seat holds.
3. Count completed inventory and active reservations inside the transaction.
4. Validate ticket windows, paid-sales activation, campaign eligibility, and seat category.
5. Calculate subtotal, discount, total, and the 3% organizer processing deduction on the server.
6. Insert a 10-minute checkout session, lines, and unique seat holds.
7. On confirmation, lock the session/event again and issue exactly one order item and canonical ticket per unit only after a successful or zero-value simulation.

Unique constraints on checkout/payment keys, seats, order-to-session, ticket-to-item, campaign redemption, and ticket codes remain the final conflict defense.

### Admission

Admission QRs use the `bft:v1:` namespace and an Ed25519 signature over opaque ticket/event identifiers, a nonce, and ticket code. They contain no attendee name or contact information. Campaign QRs are HTTPS links and are rejected before ticket lookup.

Online scans lock the ticket row and append a check-in action. Reversals append a separate record. Offline operations are sorted by captured timestamp and operation UUID; each action is flushed before evaluating the next. The earliest eligible scan wins and later operations become append-only conflicts.

### Audit history

Security and event operations append to `audit_logs`. No application endpoint updates or deletes entries. PostgreSQL also installs an `audit_logs_append_only` trigger that raises on update or delete.

## Private data

- Private events require an authenticated, accepted invitation for detail, inventory, campaign resolution, and calendar resources.
- Covers, support files, and ticket PDFs live in private MinIO objects. Authorized endpoints return short-lived signed URLs or stream canonical output.
- Support context is resolved server-side: event, order, and ticket IDs must belong together, and private order/ticket context must belong to the requester.
- Refresh tokens are random, stored hashed on the server, rotated on use, and held in SecureStore on native clients or an HTTP-only cookie on web.
- Offline bundles contain only event-scoped ticket status, a display name, assigned seat, and signed admission payload. Native storage is AES-GCM encrypted with a SecureStore key.
- Analytics accepts only a small allowlist of non-PII properties. GA4 integration is disabled unless explicitly configured.

## Background work

Celery uses Redis for ticket PDF/email delivery, expired checkout release, payout creation, privacy-safe GA4 forwarding, and optional GA4 Data API imports. Analytics and imports never run inside checkout or issuance transactions.

## Production transition checklist

Before production, replace every example secret, enforce HTTPS origins, move secrets into a manager, add managed PostgreSQL backups and restore drills, choose regulated payment/KYC providers, complete legal and threat-model reviews, add malware scanning for attachments, define retention policy, add observability/alerting, run load and penetration tests, and complete native store release engineering.

