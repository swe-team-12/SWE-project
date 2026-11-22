import i18n from "@/i18n";

// The client tsconfig has no Node types; only what this test needs.
declare const __dirname: string;
const fs = jest.requireActual("fs") as {
  readFileSync(file: string, encoding: "utf8"): string;
};

// Screens whose every literal translation key must exist in all languages.
const FILES = [
  "app/admin.tsx",
  "app/notifications.tsx",
  "app/scanner.tsx",
  "app/support/index.tsx",
  "app/support/[id].tsx",
  "src/components/AppShell.tsx",
  "src/components/admin/AdminMonitoring.tsx",
  "src/components/admin/AdminReports.tsx",
  "src/components/admin/AdminSearch.tsx",
  "src/components/admin/AdminSettings.tsx",
  "src/components/admin/shared.tsx",
  "src/lib/notificationText.ts",
  "src/lib/offline.ts",
  "src/lib/scanResult.ts",
  "src/lib/supportCase.ts",
  "src/lib/files.ts",
  "src/lib/errorMessage.ts",
];

const root = `${__dirname}/../..`;

function literalKeys(source: string): string[] {
  const keys = new Set<string>();
  const pattern = /\bt\(\s*["']([A-Za-z][\w.]*)["']/g;
  for (const match of source.matchAll(pattern)) keys.add(match[1]);
  // Keys selected by a ternary inside t(...), e.g. t(cond ? "a.b" : "c.d").
  const ternary = /\?\s*"([a-zA-Z]+\.[\w.]+)"\s*:\s*"([a-zA-Z]+\.[\w.]+)"/g;
  for (const match of source.matchAll(ternary)) {
    keys.add(match[1]);
    keys.add(match[2]);
  }
  return [...keys];
}

const each = (prefix: string, values: string[], suffix = "") =>
  values.map((value) => `${prefix}.${value}${suffix}`);

// Keys built at run time from API values or local unions.
const DYNAMIC_KEYS = [
  ...each("adminX.sections", [
    "settings",
    "search",
    "reports",
    "payments",
    "refunds",
    "activations",
    "payouts",
    "campaigns",
    "cases",
  ]),
  ...each("adminX.cases.scope", [
    "platform",
    "escalated",
    "organizer_to_platform",
    "all",
  ]),
  ...each("adminX.failureReason", ["failure", "timeout"]),
  ...["action", "confirm", "effect", "done"].flatMap((group) =>
    each(`adminX.moderation.${group}`, [
      "user_suspend",
      "user_restore",
      "event_suspend",
      "event_restore",
      "paid_suspend",
      "paid_resume",
    ]),
  ),
  ...each("adminX.paymentKind", ["ticket_purchase", "event_activation"]),
  ...each("adminX.reportCategory", [
    "fraud",
    "misleading_information",
    "inappropriate_content",
    "safety",
    "spam",
    "other",
  ]),
  ...each("adminX.reports.confirm", ["resolved", "dismissed"]),
  ...each("adminX.reports.done", ["resolved", "dismissed"]),
  ...each("adminX.role", ["attendee", "organizer", "platform_admin"]),
  ...each("notify.open", [
    "case",
    "order",
    "tickets",
    "event",
    "manage",
    "scanner",
    "admin",
  ]),
  ...each("notify.staffRole", ["manager", "support", "finance", "check_in"]),
  ...each("scannerX.note", [
    "offlineQueued",
    "offlineSnapshot",
    "offlineDuplicate",
    "offlineUnknown",
    "offlineNoBundle",
    "offlineBundleExpired",
  ]),
  ...["title", "help"].flatMap((part) =>
    each(
      "scannerX.outcome",
      [
        "valid",
        "invalid",
        "cancelled",
        "refunded",
        "already_used",
        "wrong_event",
        "conflict",
        "reversed",
        "error",
      ],
      `.${part}`,
    ),
  ),
  ...each("scannerX.totals", [
    "registered",
    "checked_in",
    "remaining",
    "cancelled",
    "refunded",
  ]),
  ...each("supportX.assigneeRole", [
    "owner",
    "manager",
    "support",
    "platform_admin",
  ]),
  ...each("supportX.live", ["connecting", "live", "reconnecting", "off"]),
  ...each("supportX.kind", ["attendee_to_organizer", "organizer_to_platform"]),
  // Status values shown by these screens (payments, orders, payouts,
  // reports, support cases, tickets, campaigns).
  ...each("status", [
    "pending",
    "succeeded",
    "failed",
    "timed_out",
    "refunded",
    "paid",
    "free",
    "cancelled",
    "scheduled",
    "paid_demo",
    "open",
    "resolved",
    "dismissed",
    "in_progress",
    "waiting_for_customer",
    "valid",
    "checked_in",
    "active",
    "disabled",
    "draft",
    "published",
    "unpublished",
    "suspended",
    "ticket_delivery",
    "payment",
    "refund",
    "seating",
    "event_information",
    "check_in",
    "account",
    "technical",
    "activation",
  ]),
].map((key) => ["(dynamic)", key] as const);

describe("translation keys used by admin, support, scanner and notifications", () => {
  const keys = [
    ...FILES.flatMap((file) =>
      literalKeys(fs.readFileSync(`${root}/${file}`, "utf8")).map(
        (key) => [file, key] as const,
      ),
    ),
    ...DYNAMIC_KEYS,
  ];

  it.each(["en", "ru", "kk"])("exist in %s", (language) => {
    const missing = keys
      .filter(
        ([, key]) => !i18n.exists(key, { lng: language, fallbackLng: [] }),
      )
      .map(([file, key]) => `${file}: ${key}`);
    expect(missing).toEqual([]);
  });
});
