import { formatDateTime } from "../date";

describe("formatDateTime", () => {
  // Local-time constructor so the expectations do not depend on the TZ.
  const monday = new Date(2026, 9, 12, 15, 51, 7);

  it("formats Kazakh dates with Kazakh month and weekday names", () => {
    expect(formatDateTime(monday, "kk", "full")).toBe(
      "2026 ж. 12 қазан, дүйсенбі, 15:51",
    );
    expect(formatDateTime(monday, "kk", "medium")).toBe(
      "2026 ж. 12 қаз., 15:51",
    );
    expect(formatDateTime(monday, "kk-KZ")).toBe("12.10.2026, 15:51:07");
    expect(formatDateTime(monday, "kk", "time")).toBe("15:51:07");
  });

  it("never emits the root-locale fallback tokens for Kazakh", () => {
    const formatted = formatDateTime(monday.toISOString(), "kk", "full");
    expect(formatted).not.toMatch(/M\d|Mon/);
  });

  it("delegates other locales to Intl", () => {
    expect(formatDateTime(monday, "en", "full")).toContain("Monday");
    expect(formatDateTime(monday, "ru", "full")).toContain("октября");
  });

  it("returns an empty string for invalid input", () => {
    expect(formatDateTime("not-a-date", "kk", "full")).toBe("");
  });
});
