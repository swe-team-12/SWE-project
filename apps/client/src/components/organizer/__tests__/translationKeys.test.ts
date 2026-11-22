import i18n from "@/i18n";

// The client tsconfig has no Node types; only what this test needs.
declare const __dirname: string;
const fs = jest.requireActual("fs") as {
  readFileSync(file: string, encoding: "utf8"): string;
  readdirSync(dir: string): string[];
};
const path = jest.requireActual("path") as {
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
};

const root = path.resolve(__dirname, "../../../..");

const FILES = [
  "app/organizer/index.tsx",
  "app/organizer/new.tsx",
  "app/organizer/events/[id].tsx",
  ...fs
    .readdirSync(path.join(root, "src/components/organizer"))
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => `src/components/organizer/${name}`),
  "src/components/Charts.tsx",
];

function literalKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const match of source.matchAll(/\bt\(\s*["']([A-Za-z][\w.]*)["']/g)) keys.add(match[1]);
  // Keys stored in variables or props, e.g. error: "organizer.validation.titleShort".
  for (const match of source.matchAll(/["'](organizer\.[\w.]*\w)["']/g)) keys.add(match[1]);
  return [...keys];
}

const each = (prefix: string, values: string[]) => values.map((value) => `${prefix}.${value}`);
const LIFECYCLE = ["draft", "published", "unpublished", "suspended", "cancelled"];
const FAMILIES = [
  "event", "ticket_type", "campaign", "checkout", "order", "payment",
  "paid_sales", "payout", "staff", "support", "ticket", "admin",
];

const DYNAMIC_KEYS = [
  ...each("organizer.dashboard.statusHelp", LIFECYCLE),
  ...each("organizer.lifecycle.statusHelp", LIFECYCLE),
  ...each("organizer.form.visibilityHelp", ["public", "unlisted", "private"]),
  ...each("organizer.tabs", [
    "overview", "tickets", "activation", "sales", "orders", "attendees",
    "analytics", "campaigns", "team", "support", "history",
  ]),
  ...each("organizer.activation.items", [
    "paid_ticket_type", "organizer_profile", "email_verified", "identity_verified",
    "payout_account", "payout_verified", "terms_accepted", "activation_fee_paid",
  ]),
  ...each("organizer.activation.outcomes", ["success", "failure", "timeout"]),
  ...each("organizer.activation.states", ["active", "inactive", "suspended"]),
  ...each("organizer.activation.stateHelp", ["active", "inactive", "suspended"]),
  ...each("organizer.sales.kinds", ["ticket_purchase", "event_activation"]),
  ...each("organizer.sales.failureReasons", ["failure", "timeout"]),
  ...each("organizer.team.roles", ["manager", "support", "finance", "check_in"]),
  ...each("organizer.team.roleHelp", ["manager", "support", "finance", "check_in"]),
  ...each("organizer.tickets.categories", ["premium", "standard", "accessible"]),
  ...each("organizer.history.families", FAMILIES),
  ...each("organizer.history.entities", [
    "campaign", "checkout_session", "event", "event_invitation", "event_report", "order",
    "organizer_profile", "payment", "payout", "staff_assignment", "support_case",
    "ticket", "ticket_type", "user",
  ]),
  ...each("organizer.history.actions", [
    "event_created", "event_updated", "event_published", "event_unpublished",
    "event_cancelled", "order_refunded", "payment_succeeded", "paid_sales_activated",
    "staff_assigned", "ticket_checked_in", "admin_event_suspension_changed",
  ]),
];

describe("organizer translation keys", () => {
  const keys = [
    ...new Set([
      ...FILES.flatMap((file) => literalKeys(fs.readFileSync(path.join(root, file), "utf8"))),
      ...DYNAMIC_KEYS,
    ]),
  ].filter((key) => !key.endsWith("."));

  it.each(["en", "ru", "kk"])("exist in %s", (lng) => {
    const missing = keys.filter((key) => !i18n.exists(key, { lng, fallbackLng: false }));
    expect(missing).toEqual([]);
  });
});
