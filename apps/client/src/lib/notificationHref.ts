interface NotificationTarget {
  data?: {
    case_id?: string;
    event_id?: string;
    order_id?: string;
  } | null;
}

export type NotificationHref =
  | { pathname: "/support/[id]"; params: { id: string } }
  | { pathname: "/events/[id]"; params: { id: string } }
  | "/orders";

// Order notifications (confirmation, refund, cancellation) open order history,
// which is where the attendee can see the order's current status.
export function notificationHref(
  notification: NotificationTarget,
): NotificationHref | undefined {
  const data = notification.data ?? {};
  if (data.case_id)
    return { pathname: "/support/[id]", params: { id: data.case_id } };
  if (data.order_id) return "/orders";
  if (data.event_id)
    return { pathname: "/events/[id]", params: { id: data.event_id } };
  return undefined;
}
