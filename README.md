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

## QA engineer setup

Use the Docker workflow below as the shared QA baseline. It runs the same seeded services and data on every tester's machine and does not require a locally installed Python or Node.js runtime.

### Start the complete stack

Prerequisites:

- Git.
- Docker Desktop with Docker Compose v2 running.
- GNU Make, or use the equivalent Docker Compose commands below.
- Ports `8010`, `8081`, `8025`, `9100`, `9101`, `19000`, `19001`, `5433`, `6379`, and `1025` available.

Clone the repository and run the stack from its root:

```bash
git clone https://github.com/Nurikexe/SWE-project.git
cd SWE-project
docker compose version
make demo
docker compose ps
curl --fail http://localhost:8010/health/ready
```

If `make` is unavailable, replace `make demo` with:

```bash
docker compose up --build -d
docker compose exec api uv run python -m app.seed
```

The readiness response should report both PostgreSQL and Redis as `ok`. Then open:

- Application: <http://localhost:8081>
- API documentation: <http://localhost:8010/docs>
- Test email inbox: <http://localhost:8025>
- Private object-storage console: <http://localhost:9101>

Docker Compose automatically uses `.env.example` for the local demonstration environment. Do not enter real customer, payment-card, bank, identity, or other real personal data.

### Seeded QA accounts

Use the value of `DEMO_PASSWORD` in `.env.example` for every account. Do not paste the password into screenshots, logs, or issues.

| Role           | Email                   | Suggested coverage                                                                    |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| Attendee       | `attendee@example.com`  | Discovery, checkout simulation, orders, tickets, calendar, and support                |
| Organizer      | `organizer@example.com` | Events, ticket types, seating, campaigns, staff, refunds, and analytics               |
| Check-in staff | `scanner@example.com`   | Camera/manual scanning, duplicate detection, offline sync, and reversal               |
| Platform Admin | `admin@example.com`     | Moderation, activation review, payouts, settings, support escalation, and CSV reports |

Each QA engineer should use a separate local installation. Tests that create registrations, orders, support cases, or check-ins intentionally change that installation's local data.

### Required smoke pass

Start with the automated API and concurrency journeys:

```bash
make verify
make concurrency
```

Then complete this short manual pass:

- [ ] The event list and Almaty Tech Forum detail page load in Kazakh, Russian, and English.
- [ ] The Attendee can choose an available seat through both the visual map and accessible list, reserve it, and complete each simulated payment outcome.
- [ ] A successful order produces an account ticket, admission QR, downloadable A4 PDF, and message in Mailpit.
- [ ] The Organizer can edit and preview an event, manage staff and campaigns, inspect analytics, and issue a simulated refund.
- [ ] Check-in Staff sees valid, already-used, wrong-event, refunded, and cancelled outcomes and can reverse a check-in.
- [ ] Offline scanning can download a validation bundle, queue an action, synchronize it, and display any conflict.
- [ ] Support messages update live, attachments remain private, and unauthorized downloads are rejected.
- [ ] Platform Admin search, moderation, settings, reporting, activation, and payout screens load without permission leakage.
- [ ] Browser and terminal consoles contain no unexpected errors.

The longer role-by-role walkthrough is in the [demo guide](./docs/DEMO.md).

### Optional browser, unit, and native checks

Install Node 24 using `.nvmrc` before running host-side client tests. If `nvm` is available, run:

```bash
nvm install
nvm use
npm ci
npx playwright install chromium
make test
npm run test:e2e
```

`make test` also requires Python 3.12+ and [uv](https://docs.astral.sh/uv/) on the host. The Playwright suite expects the Docker stack to remain running.

For an iOS Simulator or Android Emulator, stop only the containerized web client and start Expo locally:

```bash
docker compose stop client
npm run dev
```

Use Expo's `i` and `a` shortcuts for iOS and Android. An Android Emulator or physical device cannot use the default `localhost` API address: set `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WS_URL` to `10.0.2.2` for the standard Android Emulator or to the computer's LAN address for a physical device before starting Expo.

### Logs, stopping, and resetting

Inspect recent service output with:

```bash
docker compose logs --since=10m --no-color api worker client
make logs
```

Stop the project while retaining local test data:

```bash
make down
```

For a completely clean baseline, first save any evidence you need and then run:

```bash
docker compose down --volumes --remove-orphans
make demo
```

The reset command permanently removes only this Compose project's local PostgreSQL, Redis, and MinIO volumes, including all QA-created records and files.

### Reporting QA issues

Create one issue per defect using the repository's [QA bug report form](./.github/ISSUE_TEMPLATE/qa_bug_report.yml). Search for an existing issue first and use a title such as `[QA][Checkout] Seat remains reserved after timeout`.

Use this severity rubric consistently:

| Severity | Meaning                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| Blocker  | The stack cannot be tested, or there is data loss, a security/privacy exposure, or no usable path forward. |
| Critical | A required role or primary flow is unusable and has no reasonable workaround.                              |
| Major    | Required behavior is incorrect, but testing can continue with a workaround.                                |
| Minor    | A visual, copy, accessibility, or low-impact usability defect does not block the flow.                     |

Every report should include the commit under test (`git rev-parse --short HEAD`), platform/device, locale, test-data state, exact steps, expected and actual results, reproducibility, and supporting evidence. For API failures, include the method, path, HTTP status, and stable error `code`. Before attaching evidence, redact passwords, access/refresh tokens, cookies, QR payloads, attendee contact details, and other personal data.

<details>
<summary>Copyable issue template for Jira, Linear, email, or another tracker</summary>

```markdown
Title: [QA][Area] Concise description

Severity: Blocker | Critical | Major | Minor
Area: Authentication | Events | Checkout | Tickets | Organizer | Scanner | Offline sync | Support | Admin | Analytics | Localization/Accessibility | Infrastructure/API
Build/commit: output of `git rev-parse --short HEAD`
Environment: Web desktop | Web mobile | iOS | Android | API
OS/device and version:
Browser/app version:
Locale: kk | ru | en
Test data: Fresh seed | Modified seed | Newly registered account
Reproducibility: Always | Intermittent | Once

Preconditions:

Steps to reproduce:

1. [First action]
2. [Second action]
3. [Observed result]

Expected result:

Actual result:

API request/status/error code, if relevant:

Evidence and sanitized logs:

Workaround or additional context:

Privacy check: I removed passwords, tokens, cookies, QR payloads, and personal data.
```

</details>

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
.github/ISSUE_TEMPLATE/ structured QA issue form
.github/workflows/    continuous integration
docker-compose.yml    complete local service topology
```

## Deliberate boundaries

This is a polished academic prototype, not a production financial service. It intentionally excludes real payment and payout rails, production KYC/KYB, arbitrary venue editing/import, production-grade offline operations, resale/transfers, recurring events, tax automation, multi-party payouts, hardware integrations, app-store publication, and production compliance archival. Legal, privacy, payment, and refund requirements must be reviewed for Kazakhstan before any real launch.
