import { errorCode, localizedErrorMessage } from "../errorMessage";
import { formatEventDateTime, zonedWallClock } from "../eventTime";
import { summarizeOrderItems } from "../orderSummary";

function apiError(code: string, status: number, message: string): Error {
  return Object.assign(new Error(message), {
    problem: { code, status },
  });
}

describe("localizedErrorMessage", () => {
  it("prefers the wrapped API problem of a failed download", () => {
    const cause = apiError("ticket_not_valid", 409, "Ticket is not valid");
    const wrapped = new Error("Server detail", { cause });
    expect(localizedErrorMessage(wrapped, "fallback")).toBe(
      "Ticket is not valid",
    );
    expect(errorCode(wrapped)).toBe("ticket_not_valid");
  });

  it("keeps the wrapper text for an expired session or a network error", () => {
    const expired = new Error("Sign in again", {
      cause: apiError("authentication_required", 401, "Unauthorized"),
    });
    expect(localizedErrorMessage(expired, "fallback")).toBe("Sign in again");
    const offline = new Error("Download failed", {
      cause: apiError("network_error", 0, "Network"),
    });
    expect(localizedErrorMessage(offline, "fallback")).toBe("Download failed");
  });

  it("falls back for values that carry no message", () => {
    expect(localizedErrorMessage(undefined, "fallback")).toBe("fallback");
    expect(localizedErrorMessage(new Error(""), "fallback")).toBe("fallback");
    expect(errorCode(new Error("plain"))).toBeUndefined();
  });
});

describe("event time", () => {
  it("shows the wall clock of the event time zone", () => {
    const shifted = zonedWallClock("2026-12-06T15:30:00Z", "Asia/Almaty");
    expect(shifted.getHours()).toBe(20);
    expect(shifted.getMinutes()).toBe(30);
    expect(shifted.getDate()).toBe(6);
  });

  it("keeps the instant for an unknown zone and names a known one", () => {
    const original = new Date("2026-12-06T15:30:00Z");
    expect(zonedWallClock(original, "Nowhere/Invalid").getTime()).toBe(
      original.getTime(),
    );
    expect(formatEventDateTime(null, "Asia/Almaty", "en")).toBe("");
    expect(
      formatEventDateTime("2026-12-06T15:30:00Z", "Asia/Almaty", "en"),
    ).toMatch(/\(.+\)$/);
  });
});

describe("summarizeOrderItems", () => {
  it("groups tickets by type in first-seen order", () => {
    expect(
      summarizeOrderItems([
        { ticket_type_name: "Standard", unit_price_tiyin: 1000 },
        { ticket_type_name: "Premium", unit_price_tiyin: 3000 },
        { ticket_type_name: "Standard", unit_price_tiyin: 1000 },
      ]),
    ).toEqual([
      { name: "Standard", count: 2, total_tiyin: 2000 },
      { name: "Premium", count: 1, total_tiyin: 3000 },
    ]);
  });
});
