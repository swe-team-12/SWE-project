// Shared shapes and pure helpers for the support screens.

export const SUPPORT_CATEGORIES = [
  "ticket_delivery",
  "payment",
  "refund",
  "seating",
  "event_information",
  "check_in",
  "account",
  "technical",
  "activation",
] as const;

export const SUPPORT_STATUSES = [
  "open",
  "in_progress",
  "waiting_for_customer",
  "resolved",
] as const;

export type SupportKind = "attendee_to_organizer" | "organizer_to_platform";

export interface SupportCase {
  id: string;
  case_number: string;
  kind: SupportKind | string;
  category: string;
  status: string;
  subject: string;
  requester_id: string;
  requester_name?: string;
  requester_email?: string;
  assignee_id?: string | null;
  assignee_name?: string | null;
  escalated?: boolean;
  escalated_at?: string | null;
  event_id?: string | null;
  order_id?: string | null;
  ticket_id?: string | null;
  context?: {
    event?: { id: string; title: string } | null;
    order?: { id: string; number: string } | null;
    ticket?: { id: string; code: string } | null;
  } | null;
  created_at?: string;
  updated_at: string;
}

export interface SupportAttachment {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
}

export interface SupportMessage {
  id: string;
  sender_id: string;
  sender_name?: string;
  sender_role?: "requester" | "staff" | "platform_admin" | string;
  sender_is_staff?: boolean;
  body: string;
  created_at: string;
  attachments?: SupportAttachment[];
}

export interface SupportCaseDetail extends SupportCase {
  viewer?: {
    is_requester: boolean;
    is_staff: boolean;
    can_update: boolean;
    can_escalate: boolean;
  };
  messages: SupportMessage[];
}

export interface ContextEvent {
  id: string;
  title: string;
  status?: string;
}

export interface ContextOrder {
  id: string;
  order_number: string;
  status: string;
  event_id: string;
  event_title: string;
}

export interface ContextTicket {
  id: string;
  ticket_code: string;
  status: string;
  attendee_name: string;
  order_id: string;
  event_id: string;
  event_title: string;
}

export interface SupportContexts {
  events: ContextEvent[];
  orders: ContextOrder[];
  tickets: ContextTicket[];
  managed_events: ContextEvent[];
}

interface LinkedContext {
  eventId?: string;
  orderId?: string;
  ticketId?: string;
}

/**
 * Turns the ids from a deep link (`/support?event_id=…&order_id=…&ticket_id=…`)
 * into a consistent selection: a ticket implies its order and event, an order
 * implies its event. Orders and tickets that are not the caller's are dropped
 * because the server would reject them.
 */
export function resolveInitialContext(
  contexts: SupportContexts,
  linked: LinkedContext,
): LinkedContext {
  const ticket = linked.ticketId
    ? contexts.tickets.find((item) => item.id === linked.ticketId)
    : undefined;
  if (ticket)
    return {
      eventId: ticket.event_id,
      orderId: ticket.order_id,
      ticketId: ticket.id,
    };
  const order = linked.orderId
    ? contexts.orders.find((item) => item.id === linked.orderId)
    : undefined;
  if (order) return { eventId: order.event_id, orderId: order.id };
  return { eventId: linked.eventId };
}

/** The events, orders and tickets offered for the current selection. */
export function contextOptions(
  contexts: SupportContexts | undefined,
  selection: {
    kind: SupportKind;
    eventId?: string;
    orderId?: string;
    extraEvent?: ContextEvent;
  },
): { events: ContextEvent[]; orders: ContextOrder[]; tickets: ContextTicket[] } {
  if (selection.kind === "organizer_to_platform")
    return { events: contexts?.managed_events ?? [], orders: [], tickets: [] };
  const events = [...(contexts?.events ?? [])];
  if (
    selection.extraEvent &&
    !events.some((item) => item.id === selection.extraEvent?.id)
  )
    events.unshift(selection.extraEvent);
  if (!contexts || !selection.eventId) return { events, orders: [], tickets: [] };
  return {
    events,
    orders: contexts.orders.filter(
      (item) => item.event_id === selection.eventId,
    ),
    tickets: contexts.tickets.filter(
      (item) =>
        item.event_id === selection.eventId &&
        (!selection.orderId || item.order_id === selection.orderId),
    ),
  };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Event: X · Order BF-1 · Ticket TKT-1" for a case, or "" without context. */
export function caseContextLine(item: SupportCase, t: Translate): string {
  const parts: string[] = [];
  if (item.context?.event)
    parts.push(t("supportX.context.event", { title: item.context.event.title }));
  if (item.context?.order)
    parts.push(
      t("supportX.context.order", { number: item.context.order.number }),
    );
  if (item.context?.ticket)
    parts.push(t("supportX.context.ticket", { code: item.context.ticket.code }));
  return parts.join(" · ");
}

// Mirrors the server rules for POST /support/messages/{id}/attachments.
export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "application/pdf"];
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
};

/**
 * Checks a picked file before upload. Returns the `apiErrors` code the server
 * would answer with, so the same translated text is shown either way.
 */
export function attachmentProblem(file: {
  name: string;
  mimeType?: string | null;
  size?: number | null;
}): "attachment_type_invalid" | "attachment_too_large" | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = file.mimeType || EXTENSION_TYPES[extension];
  if (!type || !ATTACHMENT_TYPES.includes(type))
    return "attachment_type_invalid";
  if (typeof file.size === "number" && file.size > MAX_ATTACHMENT_BYTES)
    return "attachment_too_large";
  return null;
}

export function formatFileSize(bytes: number, locale: string): string {
  const format = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(
      value,
    );
  if (bytes >= 1024 * 1024) return `${format(bytes / (1024 * 1024), 1)} MB`;
  if (bytes >= 1024) return `${format(bytes / 1024, 0)} KB`;
  return `${format(bytes, 0)} B`;
}
