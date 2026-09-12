# BiletFlow

BiletFlow is a Kazakhstan-focused, self-service event ticketing demonstration built from the supplied [Software Requirements Specification](./BiletFlow_SRS_Initial_Draft.pdf). One Expo application serves iOS, Android, and responsive web; a FastAPI modular monolith owns all business rules and persists authoritative data in PostgreSQL.

> **Demonstration only:** payment, paid-sales activation, organizer verification, refunds, and payouts are simulations. The application never asks for card or bank credentials and does not move real money.

## What is included

- Email registration, one-use verification and password reset, Argon2id passwords, short access tokens, and rotating hashed refresh sessions.
- Attendee, Organizer, event-scoped Manager/Support/Finance/Check-in, and global Platform Admin permissions.
- Public, unlisted, and invitation-only events; draft preview, editing, duplication, publication, unpublication, cancellation, images, registration windows, capacities, and ticket types.
- Atomic 10-minute inventory, seat, and campaign reservations with server-side KZT pricing.
- Free registration plus clearly labelled success, failure, and timeout payment simulations.
- A nonrefundable 5,000 KZT paid-sales activation demonstration and a deterministic 3% organizer processing deduction.
- Canonical signed admission QR codes, one ticket per order item, private A4 PDFs, account downloads, and Mailpit delivery.
- Percentage and fixed-minor-unit promos, opaque Campaign QR links, attribution, and campaign reporting.
- The 168-seat, three-section Almaty Hall template with accessible seats, price categories, SVG interaction, and a list alternative.
- Stable iCalendar files plus Google, Outlook, and Yahoo links; updates increment sequence and cancellations emit `STATUS:CANCELLED`.
- Mobile camera scanning, manual search, live totals, reversal history, encrypted SQLite bundles, Ed25519 offline verification, idempotent synchronization, and deterministic conflict resolution.
- Contextual support cases, assignment/status workflows, 15-second polling, Redis-backed WebSockets, unread notifications, and private JPEG/PNG/PDF attachments up to 10 MB.
- Organizer sales, capacity, refund, campaign, traffic-funnel, and attendance analytics with date/ticket filters and append-only event history.
- Platform search, user/event suspension, activation monitoring, payout ledger, settings, support escalation, and CSV reporting.
- Optional privacy-filtered GA4 Measurement Protocol emission and Data API import. Seeded funnel events are used when GA4 is disabled.
- Alembic migrations, PostgreSQL constraints and row locking, Redis/Celery jobs, MinIO objects, Mailpit email, Docker Compose, unit/UI/integration tests, and GitHub Actions.

## Architecture

```text
Expo / React Native / React Native Web
     | REST + WebSocket
     v
FastAPI modular monolith
     |-- PostgreSQL  authoritative state, locking, audit trail
     |-- Redis       cache, rate limits, WebSocket fan-out, Celery broker
     |-- Celery      hold expiry, ticket email, payout and GA4 jobs
     |-- MinIO       private covers, attachments, generated ticket PDFs
     `-- Mailpit     local verification and ticket email inbox
```

All identifiers are UUIDs. Monetary values use integer KZT minor units (`tiyin`), stored timestamps are UTC, and events retain an IANA time-zone identifier. The API is versioned under `/api/v1` and returns RFC 7807-style problems with stable `code` values. See [Architecture](./docs/ARCHITECTURE.md) for transaction and synchronization details.

## Quick start with Docker

Requirements: Docker Desktop with Compose v2.

```bash
make demo
make verify
make concurrency
```

Open:

- Universal web app: <http://localhost:8081>
- OpenAPI / Swagger UI: <http://localhost:8010/docs>
- API readiness: <http://localhost:8010/health/ready>
- Mailpit inbox: <http://localhost:8025>
- MinIO console: <http://localhost:9101>

The deterministic seed provides Platform Admin, Organizer, Attendee, and Check-in Staff accounts on the `example.com` domain, plus Almaty Tech Forum, Almaty Hall seating, a campaign, a paid order/ticket, support history, and analytics. The account addresses are in `services/api/app/seed.py`; use the `DEMO_PASSWORD` value from `.env.example` locally.

Useful commands:

```bash
make logs       # follow API, worker, and client logs
make seed       # safely rerun the idempotent seed
make migrate    # apply Alembic migrations
make test       # static checks and unit/UI tests
make down       # stop containers; named data volumes are retained
```

The complete demonstration script creates isolated journey data and verifies the primary and stretch flows. See [Demo guide](./docs/DEMO.md).

## Local development

Use Node 24 (the repository includes `.nvmrc`), Python 3.12+, uv, and Docker for dependencies.

```bash
docker compose up -d postgres redis minio mailpit
cd services/api
uv sync --locked
uv run alembic upgrade head
uv run python -m app.seed
uv run uvicorn app.main:app --reload --port 8010
```

In another terminal:

```bash
npm ci
npm run dev
```

Use Expo's terminal shortcuts to open web, iOS Simulator, or Android Emulator. A physical device must use your computer's LAN address in `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WS_URL`; `localhost` refers to the device itself.

## Tests and generated contract

```bash
make test

# With the local API running on 8010:
npm run generate:api

# Production-style exports for all Expo targets:
npm --workspace @biletflow/client run export
```

Coverage includes password/QR security, date and time-zone contracts, KZT rounding, lifecycle grouping, single-page A4 ticket contents, stable/cancelled iCalendar output, offline signature validation, and screen-reader seat selection. `services/api/scripts/demo_check.py` adds a live 29-check journey through PostgreSQL, Redis, MinIO, and WebSockets. A separate concurrency verifier races the last ticket, the same seat, the final promo redemption, payment confirmation, and admission check-in. Playwright covers desktop/mobile web journeys, while the checked-in Maestro flow provides a native scanner smoke test. CI repeats static checks, unit/UI tests, all-platform Expo export, Docker image construction, migrations, seeding, the live journeys, and responsive browser checks.

## Backup and recovery

```bash
make backup
make restore FILE=backups/biletflow.dump
```

`restore` replaces records in the configured BiletFlow database and should only be run against the intended demonstration environment. Backups and local environment files are git-ignored.

## Repository map

```text
apps/client/          Expo Router universal application
packages/api-client/  generated TypeScript OpenAPI declarations
services/api/         FastAPI app, workers, migrations, seed, tests
docs/                 architecture and demonstration guides
.github/workflows/    continuous integration
docker-compose.yml    complete local service topology
```

## Deliberate boundaries

This is a polished academic prototype, not a production financial service. It intentionally excludes real payment and payout rails, production KYC/KYB, arbitrary venue editing/import, production-grade offline operations, resale/transfers, recurring events, tax automation, multi-party payouts, hardware integrations, app-store publication, and production compliance archival. Legal, privacy, payment, and refund requirements must be reviewed for Kazakhstan before any real launch.
