import type { Seat } from "@/types";

import {
  clearCheckoutDraft,
  isRestorableSeat,
  loadCheckoutDraft,
  saveCheckoutDraft,
} from "../checkoutDraft";

function seat(id: string, status: Seat["status"]): Seat {
  return {
    id,
    section: "A",
    row: "1",
    number: "1",
    price_category: "standard",
    is_accessible: false,
    x: 0,
    y: 0,
    status,
  };
}

describe("checkout draft", () => {
  afterEach(() => {
    clearCheckoutDraft("user-1", "event-1");
    clearCheckoutDraft("user-2", "event-1");
  });

  it("restores the selected seat after the checkout screen remounts", () => {
    saveCheckoutDraft("user-1", "event-1", {
      ticketTypeId: "type-1",
      seatId: "seat-1",
    });

    expect(loadCheckoutDraft("user-1", "event-1")).toEqual({
      ticketTypeId: "type-1",
      seatId: "seat-1",
    });
    expect(loadCheckoutDraft("user-1", "event-2")).toEqual({});
    expect(loadCheckoutDraft("user-2", "event-1")).toEqual({});
  });

  it("keeps an active hold and drops it once it expires", () => {
    const session = { id: "s-1", expires_at: "2026-01-01T10:10:00Z" };
    saveCheckoutDraft("user-1", "event-1", {
      ticketTypeId: "type-1",
      seatId: "seat-1",
      session,
    });

    expect(
      loadCheckoutDraft("user-1", "event-1", Date.parse("2026-01-01T10:05:00Z"))
        .session,
    ).toEqual(session);
    expect(
      loadCheckoutDraft(
        "user-1",
        "event-1",
        Date.parse("2026-01-01T10:10:00Z"),
      ),
    ).toEqual({ ticketTypeId: "type-1", seatId: "seat-1" });
  });

  it("forgets the draft once it is cleared or emptied", () => {
    saveCheckoutDraft("user-1", "event-1", { seatId: "seat-1" });
    clearCheckoutDraft("user-1", "event-1");
    expect(loadCheckoutDraft("user-1", "event-1")).toEqual({});

    saveCheckoutDraft("user-1", "event-1", { seatId: "seat-1" });
    saveCheckoutDraft("user-1", "event-1", {});
    expect(loadCheckoutDraft("user-1", "event-1")).toEqual({});
  });

  it("only restores a seat that is still available", () => {
    const seats = [seat("seat-1", "available"), seat("seat-2", "held")];
    expect(isRestorableSeat(undefined, seats)).toBe(true);
    expect(isRestorableSeat("seat-1", seats)).toBe(true);
    expect(isRestorableSeat("seat-2", seats)).toBe(false);
    expect(isRestorableSeat("missing", seats)).toBe(false);
  });
});
