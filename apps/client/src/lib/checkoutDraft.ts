import type { Seat } from "@/types";

/**
 * In-memory checkout selection that survives the checkout screen unmounting
 * (for example when the user navigates back to the event page and returns),
 * so the seat map stays consistent with any hold the API already created.
 */
export interface CheckoutDraft<
  Session extends { expires_at: string } = { expires_at: string },
> {
  ticketTypeId?: string;
  seatId?: string;
  session?: Session;
}

const drafts = new Map<string, CheckoutDraft>();

function draftKey(userId: string, eventId: string): string {
  return `${userId}:${eventId}`;
}

export function loadCheckoutDraft<Session extends { expires_at: string }>(
  userId: string | undefined,
  eventId: string | undefined,
  now: number = Date.now(),
): CheckoutDraft<Session> {
  if (!userId || !eventId) return {};
  const draft = drafts.get(draftKey(userId, eventId)) as
    CheckoutDraft<Session> | undefined;
  if (!draft) return {};
  if (draft.session && new Date(draft.session.expires_at).getTime() <= now) {
    // The hold has lapsed; keep the selection but let the seat be re-checked.
    return { ticketTypeId: draft.ticketTypeId, seatId: draft.seatId };
  }
  return draft;
}

export function saveCheckoutDraft(
  userId: string | undefined,
  eventId: string | undefined,
  draft: CheckoutDraft,
): void {
  if (!userId || !eventId) return;
  if (!draft.ticketTypeId && !draft.seatId && !draft.session) {
    drafts.delete(draftKey(userId, eventId));
    return;
  }
  drafts.set(draftKey(userId, eventId), draft);
}

export function clearCheckoutDraft(
  userId: string | undefined,
  eventId: string | undefined,
): void {
  if (!userId || !eventId) return;
  drafts.delete(draftKey(userId, eventId));
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
