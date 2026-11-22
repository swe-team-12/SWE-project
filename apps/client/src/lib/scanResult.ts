import type { OfflineBundle, OfflineScanOutcome } from "./offline";

/** What the result card shows: a server outcome, an undone check-in or a failure. */
export type ScanKind = OfflineScanOutcome | "reversed" | "error";

export type ScanNote =
  | "offlineQueued"
  | "offlineSnapshot"
  | "offlineDuplicate"
  | "offlineUnknown"
  | "offlineNoBundle"
  | "offlineBundleExpired";

export interface ScanView {
  kind: ScanKind;
  note?: ScanNote;
  /** Already translated explanation of a failure. */
  detail?: string;
  ticket_id?: string | null;
  ticket_code?: string | null;
  attendee_name?: string | null;
  ticket_type_name?: string | null;
  seat_label?: string | null;
  checked_in_at?: string | null;
}

/**
 * Each outcome has its own symbol and colour, and the screen always prints the
 * outcome in words next to them, so the result never depends on colour alone.
 */
export const SCAN_STYLES: Record<ScanKind, { icon: string; card: string }> = {
  valid: { icon: "✓", card: "border-emerald-400 bg-emerald-50" },
  reversed: { icon: "↺", card: "border-sky-300 bg-sky-50" },
  already_used: { icon: "↻", card: "border-amber-400 bg-amber-50" },
  conflict: { icon: "⚠", card: "border-orange-400 bg-orange-50" },
  wrong_event: { icon: "⇄", card: "border-purple-300 bg-purple-50" },
  cancelled: { icon: "⊘", card: "border-slate-400 bg-slate-100" },
  refunded: { icon: "↩", card: "border-slate-400 bg-slate-100" },
  invalid: { icon: "✕", card: "border-red-400 bg-red-50" },
  error: { icon: "!", card: "border-red-400 bg-red-50" },
};

export function scanStyle(kind: string): { icon: string; card: string } {
  return SCAN_STYLES[kind as ScanKind] ?? SCAN_STYLES.invalid;
}

type BundleTicket = OfflineBundle["payload"]["tickets"][number];

export function bundleSeatLabel(seat: BundleTicket["seat"]): string {
  return [seat?.section, seat?.row, seat?.number].filter(Boolean).join(" ");
}

export function isBundleExpired(bundle: OfflineBundle, now: Date): boolean {
  const expires = new Date(bundle.payload.expires_at).getTime();
  return Number.isNaN(expires) || expires < now.getTime();
}

/**
 * Decides what an offline scan means from the downloaded snapshot alone.
 * `queue` is true only for a ticket that may be admitted and therefore has to
 * be queued for synchronization.
 */
export function offlineScanView(
  bundle: OfflineBundle | null,
  entry: BundleTicket | null,
  now: Date,
): { view: ScanView; queue: boolean } {
  if (!bundle)
    return { view: { kind: "error", note: "offlineNoBundle" }, queue: false };
  if (isBundleExpired(bundle, now))
    return {
      view: { kind: "error", note: "offlineBundleExpired" },
      queue: false,
    };
  if (!entry)
    return { view: { kind: "invalid", note: "offlineUnknown" }, queue: false };
  const ticket = {
    ticket_id: entry.id,
    ticket_code: entry.code,
    attendee_name: entry.attendee_name,
    seat_label: bundleSeatLabel(entry.seat) || null,
  };
  if (entry.status === "cancelled" || entry.status === "refunded")
    return {
      view: { kind: entry.status, note: "offlineSnapshot", ...ticket },
      queue: false,
    };
  if (entry.status === "checked_in")
    return {
      view: { kind: "already_used", note: "offlineSnapshot", ...ticket },
      queue: false,
    };
  if (entry.status !== "valid")
    return {
      view: { kind: "invalid", note: "offlineSnapshot", ...ticket },
      queue: false,
    };
  return {
    view: { kind: "valid", note: "offlineQueued", ...ticket },
    queue: true,
  };
}

/** A scan that was already waiting in the queue is a duplicate, not an entry. */
export function duplicateOfflineView(view: ScanView): ScanView {
  return { ...view, kind: "already_used", note: "offlineDuplicate" };
}
