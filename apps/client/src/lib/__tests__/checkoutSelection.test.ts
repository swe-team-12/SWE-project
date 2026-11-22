import type { Seat, TicketTypeWithSales } from "@/types";

import {
  MAX_TICKETS_PER_ORDER,
  availableSeatsByCategory,
  buildLines,
  estimatedSubtotal,
  eventSalesState,
  formatCountdown,
  maxSelectable,
  secondsRemaining,
  setQuantity,
  ticketSalesState,
  ticketSlots,
  ticketTypesForSeat,
  toggleSeat,
} from "../checkoutSelection";

const NOW = Date.parse("2026-11-01T10:00:00Z");
const open = { paid_sales_active: true, paid_sales_suspended: false };

function type(
  id: string,
  overrides: Partial<TicketTypeWithSales> = {},
): TicketTypeWithSales {
  return {
    id,
    name: id,
    description: "",
    price_tiyin: 500_000,
    quantity: 100,
    max_per_order: 4,
    is_hidden: false,
    ...overrides,
  };
}

function seat(id: string, price_category: string): Pick<Seat, "id" | "price_category"> {
  return { id, price_category };
}

describe("ticket sales state", () => {
  it("follows the sales window", () => {
    expect(ticketSalesState(type("a"), open, NOW)).toBe("on_sale");
    expect(
      ticketSalesState(
        type("a", { sales_start_at: "2026-11-02T00:00:00Z" }),
        open,
        NOW,
      ),
    ).toBe("not_started");
    expect(
      ticketSalesState(
        type("a", { sales_end_at: "2026-10-31T00:00:00Z" }),
        open,
        NOW,
      ),
    ).toBe("ended");
  });

  it("blocks paid tickets only when paid sales are suspended or inactive", () => {
    const suspended = { paid_sales_active: true, paid_sales_suspended: true };
    const inactive = { paid_sales_active: false, paid_sales_suspended: false };
    expect(ticketSalesState(type("a"), suspended, NOW)).toBe("paid_suspended");
    expect(ticketSalesState(type("a"), inactive, NOW)).toBe(
      "paid_not_activated",
    );
    expect(ticketSalesState(type("a", { price_tiyin: 0 }), suspended, NOW)).toBe(
      "on_sale",
    );
  });
});

describe("event sales state", () => {
  const base = { status: "published" as const };
  it("reports lifecycle and registration window states", () => {
    expect(eventSalesState(base, NOW)).toBe("open");
    expect(eventSalesState({ status: "cancelled" }, NOW)).toBe("cancelled");
    expect(eventSalesState({ status: "suspended" }, NOW)).toBe("suspended");
    expect(eventSalesState({ status: "draft" }, NOW)).toBe("not_published");
    expect(
      eventSalesState(
        { ...base, registration_opens_at: "2026-11-05T00:00:00Z" },
        NOW,
      ),
    ).toBe("registration_not_open");
    expect(
      eventSalesState(
        { ...base, registration_closes_at: "2026-10-05T00:00:00Z" },
        NOW,
      ),
    ).toBe("registration_closed");
  });
});

describe("general admission quantities", () => {
  it("clamps to the per-order limit and remaining inventory", () => {
    expect(maxSelectable(type("a", { max_per_order: 6, quantity: 2 }))).toBe(2);
    expect(setQuantity({}, type("a"), 9)).toEqual({ a: 4 });
    expect(setQuantity({ a: 2 }, type("a"), 0)).toEqual({});
    expect(setQuantity({ a: 2 }, type("a"), -3)).toEqual({});
  });

  it("never lets an order exceed the line limit of the API", () => {
    const big = type("big", { max_per_order: 100, quantity: 500 });
    const filled = setQuantity({}, big, 80);
    expect(filled).toEqual({ big: MAX_TICKETS_PER_ORDER });
    expect(setQuantity(filled, type("a"), 3)).toEqual(filled);
  });
});

describe("seat selection", () => {
  const premium = type("premium", { price_category: "premium" });
  const standard = type("standard", {
    price_category: "standard",
    max_per_order: 2,
  });
  const any = type("any", { price_category: undefined, max_per_order: 1 });

  it("maps a seat to the type of its price category before generic types", () => {
    expect(
      ticketTypesForSeat(seat("s", "standard"), [premium, any, standard]).map(
        (item) => item.id,
      ),
    ).toEqual(["standard", "any"]);
    expect(
      ticketTypesForSeat(seat("s", "standard"), [
        premium,
        { ...standard, is_hidden: true },
      ]),
    ).toEqual([]);
  });

  it("adds, removes and enforces the per-type limit", () => {
    const types = [premium, standard];
    let result = toggleSeat([], seat("s1", "standard"), types, open, NOW);
    expect(result.picks).toEqual([{ seatId: "s1", ticketTypeId: "standard" }]);
    result = toggleSeat(result.picks!, seat("s2", "standard"), types, open, NOW);
    expect(result.picks).toHaveLength(2);
    const third = toggleSeat(
      result.picks!,
      seat("s3", "standard"),
      types,
      open,
      NOW,
    );
    expect(third.error).toEqual({
      reason: "type_limit",
      typeName: "standard",
      limit: 2,
    });
    expect(
      toggleSeat(result.picks!, seat("s1", "standard"), types, open, NOW).picks,
    ).toEqual([{ seatId: "s2", ticketTypeId: "standard" }]);
  });

  it("falls back to a generic type once the category type is full", () => {
    const types = [standard, any];
    const picks = [
      { seatId: "s1", ticketTypeId: "standard" },
      { seatId: "s2", ticketTypeId: "standard" },
    ];
    expect(
      toggleSeat(picks, seat("s3", "standard"), types, open, NOW).picks?.[2],
    ).toEqual({ seatId: "s3", ticketTypeId: "any" });
  });

  it("explains seats that cannot be sold", () => {
    expect(
      toggleSeat([], seat("s1", "vip"), [premium], open, NOW).error,
    ).toEqual({ reason: "no_ticket_type" });
    expect(
      toggleSeat(
        [],
        seat("s1", "premium"),
        [premium],
        { paid_sales_active: true, paid_sales_suspended: true },
        NOW,
      ).error,
    ).toEqual({ reason: "not_on_sale", typeName: "premium" });
  });
});

describe("checkout lines", () => {
  const types = [type("a", { price_tiyin: 1000 }), type("b", { price_tiyin: 0 })];
  const buyer = { name: " Aigerim ", email: " Buyer@Example.com " };

  it("creates one slot per general admission ticket", () => {
    const slots = ticketSlots(false, types, { a: 2, b: 1 }, []);
    expect(slots.map((slot) => slot.key)).toEqual(["a:0", "a:1", "b:0"]);
    expect(estimatedSubtotal(slots, types)).toBe(2000);
  });

  it("sends one line per ticket with the buyer as the default attendee", () => {
    const slots = ticketSlots(
      true,
      types,
      {},
      [
        { seatId: "s1", ticketTypeId: "a" },
        { seatId: "s2", ticketTypeId: "a" },
      ],
    );
    const attendees = { s2: { name: "Dana", email: "DANA@example.com" } };
    expect(buildLines(slots, attendees, buyer, false)).toEqual([
      {
        ticket_type_id: "a",
        quantity: 1,
        seat_id: "s1",
        attendee_name: "Aigerim",
        attendee_email: "buyer@example.com",
      },
      {
        ticket_type_id: "a",
        quantity: 1,
        seat_id: "s2",
        attendee_name: "Dana",
        attendee_email: "dana@example.com",
      },
    ]);
    expect(
      buildLines(slots, attendees, buyer, true).map(
        (line) => line.attendee_name,
      ),
    ).toEqual(["Aigerim", "Aigerim"]);
  });
});

describe("availability and hold countdown", () => {
  it("counts available seats per price category", () => {
    expect(
      availableSeatsByCategory([
        { price_category: "premium", status: "available" },
        { price_category: "premium", status: "sold" },
        { price_category: "standard", status: "held" },
      ]),
    ).toEqual({ premium: 1, standard: 0 });
  });

  it("counts down to zero and never below", () => {
    expect(secondsRemaining("2026-11-01T10:01:30Z", NOW)).toBe(90);
    expect(secondsRemaining("2026-11-01T09:00:00Z", NOW)).toBe(0);
    expect(secondsRemaining("not a date", NOW)).toBe(0);
    expect(formatCountdown(90)).toBe("1:30");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(-4)).toBe("0:00");
  });
});
