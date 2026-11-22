import { countSyncOutcomes, unresolvedSyncItems } from "../offline";
import {
  duplicateOfflineView,
  offlineScanView,
  SCAN_STYLES,
  scanStyle,
} from "../scanResult";

jest.mock("../api", () => ({ apiFetch: jest.fn() }));

const now = new Date("2026-05-01T10:00:00Z");
const bundle = {
  payload: {
    event_id: "e1",
    generated_at: "2026-05-01T08:00:00Z",
    expires_at: "2026-05-02T08:00:00Z",
    tickets: [],
  },
} as never;
const ticket = (status: string) =>
  ({
    id: "t1",
    code: "TKT-1",
    attendee_name: "Aru",
    status,
    seat: { section: "A", row: "1", number: "5" },
  }) as never;

describe("scan result views", () => {
  it("gives every outcome its own symbol", () => {
    const icons = Object.values(SCAN_STYLES).map((style) => style.icon);
    expect(new Set(icons).size).toBe(icons.length);
    expect(scanStyle("unknown")).toBe(SCAN_STYLES.invalid);
  });

  it("queues only tickets that may be admitted offline", () => {
    const valid = offlineScanView(bundle, ticket("valid"), now);
    expect(valid.queue).toBe(true);
    expect(valid.view).toMatchObject({
      kind: "valid",
      note: "offlineQueued",
      seat_label: "A 1 5",
    });
    expect(offlineScanView(bundle, ticket("checked_in"), now).view.kind).toBe(
      "already_used",
    );
    expect(offlineScanView(bundle, ticket("refunded"), now)).toMatchObject({
      queue: false,
      view: { kind: "refunded" },
    });
    expect(offlineScanView(bundle, null, now).view.note).toBe("offlineUnknown");
  });

  it("refuses to validate without a usable bundle", () => {
    expect(offlineScanView(null, null, now).view.note).toBe("offlineNoBundle");
    expect(
      offlineScanView(bundle, ticket("valid"), new Date("2026-06-01")).view
        .note,
    ).toBe("offlineBundleExpired");
  });

  it("marks a repeated offline scan as a duplicate", () => {
    const view = offlineScanView(bundle, ticket("valid"), now).view;
    expect(duplicateOfflineView(view)).toMatchObject({
      kind: "already_used",
      note: "offlineDuplicate",
    });
  });
});

describe("sync results", () => {
  const results = [
    { operation_id: "1", outcome: "valid" },
    { operation_id: "2", outcome: "conflict" },
    { operation_id: "3", outcome: "already_used" },
    { operation_id: "4", outcome: "invalid", code: "ticket_not_found" },
  ] as never[];

  it("counts accepted, conflicting and rejected operations", () => {
    expect(countSyncOutcomes(results)).toEqual({
      accepted: 1,
      conflicts: 2,
      rejected: 1,
    });
  });

  it("lists everything that was not admitted", () => {
    expect(
      unresolvedSyncItems(results).map((item) => item.operation_id),
    ).toEqual(["2", "3", "4"]);
  });
});
