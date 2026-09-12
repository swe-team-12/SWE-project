# BiletFlow demonstration guide

## Automated acceptance journey

Start the full stack and run the deterministic acceptance suite:

```bash
make demo
make verify
```

The journey verifies service readiness and OpenAPI, event discovery, the Almaty Hall layout, calendar stability, rotating sessions, registration/verification, campaign QR isolation, server pricing, payment idempotency, canonical PDF/QR generation, signed offline bundles, online and offline check-in, support files/WebSockets, refunds, analytics, invitation isolation, free registration, cancellation, duplication, paid activation, private media, Platform Admin operations, CSV, notifications, and logout revocation.

## Suggested live walkthrough

1. Open the seeded Almaty Tech Forum on the web app and show its status, assigned seating, ticket types, refund policy, and calendar options.
2. Sign in as the seeded Attendee and open My tickets. Download the A4 PDF and show that the same admission QR appears in the account and printable ticket.
3. Open Scanner as the seeded Check-in Staff. Select the assigned event, scan the admission QR, and scan it again to demonstrate duplicate-entry prevention. Reverse the check-in.
4. Sign in as the Organizer. Show event groups, metrics, sales charts, per-type inventory, campaign performance, activity history, staff assignments, and the 20% Campus campaign QR.
5. Open the campaign link in a signed-in attendee session. Select a matching Standard seat, reserve it, review the server-calculated discount and organizer fee, and simulate payment.
6. Open a contextual support case, send a reply, attach a small PNG/PDF, and show the live update plus Mailpit messages.
7. Create an invitation-only event, invite a registered address, and demonstrate that detail, inventory, checkout, and calendar remain inaccessible before invitation acceptance.
8. Sign in as Platform Admin to search records, suspend/restore an event, change the future activation fee, review activation/payout records, and export CSV.

## Presentation safety

Keep the “academic demonstration - no real money” banner visible during finance flows. Do not enter real card, bank, identity, or attendee data. Campaign QRs are promotional links; only QRs labelled “ADMISSION QR” should be used at the scanner.

