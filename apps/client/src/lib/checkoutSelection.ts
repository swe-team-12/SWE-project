import type { EventItem, Seat, TicketTypeWithSales } from "@/types";

/** The API accepts at most 50 checkout lines (one line per ticket). */
export const MAX_TICKETS_PER_ORDER = 50;

export type TicketSalesState =
  | "on_sale"
  | "not_started"
  | "ended"
  | "paid_suspended"
  | "paid_not_activated";

type PaidSalesFlags = Pick<
  EventItem,
  "paid_sales_active" | "paid_sales_suspended"
>;

export function ticketSalesState(
  type: TicketTypeWithSales,
  event: PaidSalesFlags,
  now: number,
): TicketSalesState {
  if (type.sales_start_at && Date.parse(type.sales_start_at) > now)
    return "not_started";
  if (type.sales_end_at && Date.parse(type.sales_end_at) < now) return "ended";
  if (type.price_tiyin > 0 && event.paid_sales_suspended)
    return "paid_suspended";
  if (type.price_tiyin > 0 && !event.paid_sales_active)
    return "paid_not_activated";
  return "on_sale";
}

export type EventSalesState =
  | "open"
  | "cancelled"
  | "suspended"
  | "not_published"
  | "registration_not_open"
  | "registration_closed";

export function eventSalesState(
  event: Pick<
    EventItem,
    "status" | "registration_opens_at" | "registration_closes_at"
  >,
  now: number,
): EventSalesState {
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "suspended") return "suspended";
  if (event.status !== "published") return "not_published";
  if (
    event.registration_opens_at &&
    Date.parse(event.registration_opens_at) > now
  )
    return "registration_not_open";
  if (
    event.registration_closes_at &&
    Date.parse(event.registration_closes_at) < now
  )
    return "registration_closed";
  return "open";
}

/** Largest quantity of one ticket type a single order may contain. */
export function maxSelectable(type: TicketTypeWithSales): number {
  return Math.max(
    0,
    Math.min(
      type.max_per_order,
      typeof type.available === "number" ? type.available : type.quantity,
      MAX_TICKETS_PER_ORDER,
    ),
  );
}

export type Quantities = Record<string, number>;

export function totalQuantity(quantities: Quantities): number {
  return Object.values(quantities).reduce((sum, value) => sum + value, 0);
}

/** Returns the quantities after setting one type, clamped to every limit. */
export function setQuantity(
  quantities: Quantities,
  type: TicketTypeWithSales,
  value: number,
): Quantities {
  const others = totalQuantity(quantities) - (quantities[type.id] ?? 0);
  const limit = Math.min(maxSelectable(type), MAX_TICKETS_PER_ORDER - others);
  const next = Math.max(0, Math.min(Math.floor(value) || 0, limit));
  const result = { ...quantities };
  if (next > 0) result[type.id] = next;
  else delete result[type.id];
  return result;
}

/**
 * Ticket types a seat can be sold as: a type bound to the seat's price
 * category first, then types without a category (valid for any seat).
 */
export function ticketTypesForSeat<T extends TicketTypeWithSales>(
  seat: Pick<Seat, "price_category">,
  types: T[],
): T[] {
  const visible = types.filter((type) => !type.is_hidden);
  return [
    ...visible.filter((type) => type.price_category === seat.price_category),
    ...visible.filter((type) => !type.price_category),
  ];
}

export interface SeatPick {
  seatId: string;
  ticketTypeId: string;
}

export type SeatToggleError =
  | { reason: "no_ticket_type" }
  | { reason: "not_on_sale"; typeName: string }
  | { reason: "type_limit"; typeName: string; limit: number }
  | { reason: "order_limit"; limit: number };

export type SeatToggleResult =
  | { picks: SeatPick[]; error?: undefined }
  | { picks?: undefined; error: SeatToggleError };

/**
 * Adds or removes a seat from the selection. A new seat is mapped to the
 * first matching ticket type that is on sale and still under its per-order
 * limit; otherwise the reason is returned so the UI can explain it.
 */
export function toggleSeat(
  picks: SeatPick[],
  seat: Pick<Seat, "id" | "price_category">,
  types: TicketTypeWithSales[],
  event: PaidSalesFlags,
  now: number,
): SeatToggleResult {
  if (picks.some((pick) => pick.seatId === seat.id))
    return { picks: picks.filter((pick) => pick.seatId !== seat.id) };
  const candidates = ticketTypesForSeat(seat, types);
  if (!candidates.length) return { error: { reason: "no_ticket_type" } };
  const onSale = candidates.filter(
    (type) => ticketSalesState(type, event, now) === "on_sale",
  );
  if (!onSale.length)
    return { error: { reason: "not_on_sale", typeName: candidates[0].name } };
  if (picks.length >= MAX_TICKETS_PER_ORDER)
    return { error: { reason: "order_limit", limit: MAX_TICKETS_PER_ORDER } };
  const free = onSale.find(
    (type) =>
      picks.filter((pick) => pick.ticketTypeId === type.id).length <
      maxSelectable(type),
  );
  if (!free)
    return {
      error: {
        reason: "type_limit",
        typeName: onSale[0].name,
        limit: maxSelectable(onSale[0]),
      },
    };
  return { picks: [...picks, { seatId: seat.id, ticketTypeId: free.id }] };
}

/** One entry per ticket that will be issued, in a stable order. */
export interface TicketSlot {
  key: string;
  ticketTypeId: string;
  seatId?: string;
}

export function ticketSlots(
  assigned: boolean,
  types: TicketTypeWithSales[],
  quantities: Quantities,
  picks: SeatPick[],
): TicketSlot[] {
  if (assigned)
    return picks.map((pick) => ({
      key: pick.seatId,
      ticketTypeId: pick.ticketTypeId,
      seatId: pick.seatId,
    }));
  return types.flatMap((type) =>
    Array.from({ length: quantities[type.id] ?? 0 }, (_, index) => ({
      key: `${type.id}:${index}`,
      ticketTypeId: type.id,
    })),
  );
}

export interface Attendee {
  name: string;
  email: string;
}

export interface CheckoutLinePayload {
  ticket_type_id: string;
  quantity: 1;
  seat_id: string | null;
  attendee_name: string;
  attendee_email: string;
}

/** A ticket without its own attendee details is issued to the buyer. */
export function attendeeFor(
  slot: TicketSlot,
  attendees: Record<string, Attendee>,
  buyer: Attendee,
  sameForAll: boolean,
): Attendee {
  const own = sameForAll ? undefined : attendees[slot.key];
  return {
    name: (own?.name ?? buyer.name).trim(),
    email: (own?.email ?? buyer.email).trim().toLowerCase(),
  };
}

export function buildLines(
  slots: TicketSlot[],
  attendees: Record<string, Attendee>,
  buyer: Attendee,
  sameForAll: boolean,
): CheckoutLinePayload[] {
  return slots.map((slot) => {
    const attendee = attendeeFor(slot, attendees, buyer, sameForAll);
    return {
      ticket_type_id: slot.ticketTypeId,
      quantity: 1,
      seat_id: slot.seatId ?? null,
      attendee_name: attendee.name,
      attendee_email: attendee.email,
    };
  });
}

export function estimatedSubtotal(
  slots: TicketSlot[],
  types: TicketTypeWithSales[],
): number {
  return slots.reduce(
    (sum, slot) =>
      sum +
      (types.find((type) => type.id === slot.ticketTypeId)?.price_tiyin ?? 0),
    0,
  );
}

/** Seats still selectable per price category (assigned seating only). */
export function availableSeatsByCategory(
  seats: Pick<Seat, "price_category" | "status">[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const seat of seats) {
    result[seat.price_category] ??= 0;
    if (seat.status === "available") result[seat.price_category] += 1;
  }
  return result;
}

export function secondsRemaining(expiresAt: string, now: number): number {
  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires)) return 0;
  return Math.max(0, Math.ceil((expires - now) / 1000));
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
