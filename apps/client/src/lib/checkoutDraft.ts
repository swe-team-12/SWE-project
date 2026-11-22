import type { Seat } from "@/types";

/**
 * Checkout selection that survives the checkout screen unmounting (for
 * example when the user navigates back to the event page and returns), so
 * the seat map stays consistent with any hold the API already created. On
 * web it is also mirrored into sessionStorage so a page reload keeps the
 * order summary next to the restored reservation. Attendee names and emails
 * are deliberately not stored.
 */
export interface CheckoutDraft<
  Session extends { expires_at: string } = { expires_at: string },
> {
  ticketTypeId?: string;
  seatId?: string;
  /** General admission: quantity per ticket type id. */
  quantities?: Record<string, number>;
  /** Assigned seating: each chosen seat with the ticket type it is sold as. */
  picks?: { seatId: string; ticketTypeId: string }[];
  session?: Session;
}

const drafts = new Map<string, CheckoutDraft>();
const STORAGE_PREFIX = "biletflow_checkout_draft:";

function draftKey(userId: string, eventId: string): string {
  return `${userId}:${eventId}`;
}

function storage(): Storage | undefined {
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage;
  } catch {
    return undefined;
  }
}

function readStored(key: string): CheckoutDraft | undefined {
  try {
    const raw = storage()?.getItem(STORAGE_PREFIX + key);
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    return parsed && typeof parsed === "object"
      ? (parsed as CheckoutDraft)
      : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, draft: CheckoutDraft | undefined): void {
  try {
    if (draft) storage()?.setItem(STORAGE_PREFIX + key, JSON.stringify(draft));
    else storage()?.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Storage can be unavailable (private browsing); memory still works.
  }
}

function isEmpty(draft: CheckoutDraft): boolean {
  return (
    !draft.ticketTypeId &&
    !draft.seatId &&
    !draft.session &&
    !draft.picks?.length &&
    !Object.keys(draft.quantities ?? {}).length
  );
}

export function loadCheckoutDraft<Session extends { expires_at: string }>(
  userId: string | undefined,
  eventId: string | undefined,
  now: number = Date.now(),
): CheckoutDraft<Session> {
  if (!userId || !eventId) return {};
  const key = draftKey(userId, eventId);
  const draft = (drafts.get(key) ?? readStored(key)) as
    CheckoutDraft<Session> | undefined;
  if (!draft) return {};
  if (draft.session && new Date(draft.session.expires_at).getTime() <= now) {
    // The hold has lapsed; keep the selection but let the seats be re-checked.
    const { session: _expired, ...selection } = draft;
    return selection;
  }
  return draft;
}

export function saveCheckoutDraft(
  userId: string | undefined,
  eventId: string | undefined,
  draft: CheckoutDraft,
): void {
  if (!userId || !eventId) return;
  const key = draftKey(userId, eventId);
  if (isEmpty(draft)) {
    drafts.delete(key);
    writeStored(key, undefined);
    return;
  }
  drafts.set(key, draft);
  writeStored(key, draft);
}

export function clearCheckoutDraft(
  userId: string | undefined,
  eventId: string | undefined,
): void {
  if (!userId || !eventId) return;
  drafts.delete(draftKey(userId, eventId));
  writeStored(draftKey(userId, eventId), undefined);
}

/**
 * A restored seat without an active hold is only kept while it is still
 * selectable; otherwise someone else took it in the meantime.
 */
export function isRestorableSeat(
  seatId: string | undefined,
  seats: Seat[],
): boolean {
  if (!seatId) return true;
  return seats.some(
    (seat) => seat.id === seatId && seat.status === "available",
  );
}

/** Keeps only the remembered seats that can still be selected. */
export function restorablePicks<Pick extends { seatId: string }>(
  picks: Pick[],
  seats: Seat[],
): Pick[] {
  return picks.filter((pick) => isRestorableSeat(pick.seatId, seats));
}
