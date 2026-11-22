import i18n from "@/i18n";
import { formatDateTime } from "@/utils/date";
import { formatKzt } from "@/utils/format";

interface NotificationText {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

const legacyOrderBody = /^Order (.+) contains (\d+) ticket\(s\)\.$/;
const legacyEventUpdatedTitle = /^(.+) was updated$/;
const legacySupportMessageTitle = /^New message in (.+)$/;
const legacySupportStatusTitle = /^Support case (.+) updated$/;
const legacySupportStatusBody = /^Status changed from (\w+) to (\w+)\.$/;

function stringField(
  data: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const value = data?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function numberField(
  data: Record<string, unknown> | null | undefined,
  key: string,
): number | undefined {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Adds the reason an admin or organizer typed, when the recipient may see it. */
function withReason(t: Translate, body: string, reason?: string): string {
  return reason ? `${body} ${t("notify.reason", { reason })}` : body;
}

/**
 * Notifications are stored in English; the client rebuilds the text in the
 * current language from `type`, `data.change` and the structured fields, so a
 * language switch also re-translates history. User-written text (a support
 * message, a moderation reason) is shown as written.
 */
export function notificationText(
  notification: NotificationText,
  locale: string,
): { title: string; body: string } {
  const t = i18n.getFixedT(locale) as unknown as Translate;
  const data = notification.data;
  const change = stringField(data, "change");
  const reason = stringField(data, "reason");
  const eventTitle = stringField(data, "event_title") ?? t("notify.anEvent");
  const amount = numberField(data, "amount_tiyin");
  const money = amount !== undefined ? formatKzt(amount, locale) : undefined;
  if (notification.type === "order_confirmed") {
    const legacy = legacyOrderBody.exec(notification.body);
    const orderNumber = stringField(data, "order_number") ?? legacy?.[1];
    const count =
      numberField(data, "ticket_count") ??
      (legacy ? Number(legacy[2]) : undefined);
    return {
      title: t("ui.orderConfirmedTitle"),
      body:
        orderNumber && count !== undefined
          ? t("ui.orderConfirmedBody", { orderNumber, count })
          : t("ui.orderConfirmedBodyLegacy"),
    };
  }
  if (notification.type === "ticket_delivered") {
    const count = numberField(data, "ticket_count");
    return {
      title: t("notify.ticketDelivered.title"),
      body:
        count !== undefined && stringField(data, "event_title")
          ? t("notify.ticketDelivered.body", { count, eventTitle })
          : t("notify.ticketDelivered.bodyGeneric"),
    };
  }
  if (notification.type === "payment_failed") {
    const timedOut = data?.outcome === "timeout";
    return {
      title: t(
        timedOut ? "ui.demoPaymentTimedOutTitle" : "ui.demoPaymentFailedTitle",
      ),
      body: t(
        timedOut ? "ui.demoPaymentTimedOutBody" : "ui.demoPaymentFailedBody",
      ),
    };
  }
  if (notification.type === "refund_completed") {
    const orderNumber = stringField(data, "order_number");
    return {
      title: t("notify.refund.title"),
      body:
        orderNumber && money
          ? t("notify.refund.body", { orderNumber, amount: money })
          : t("notify.refund.bodyGeneric"),
    };
  }
  if (notification.type === "event_cancelled") {
    const orderNumber = stringField(data, "order_number");
    return {
      title: t("notify.eventCancelled.title", { eventTitle }),
      body:
        orderNumber && amount
          ? t("notify.eventCancelled.bodyRefund", {
              orderNumber,
              amount: money,
            })
          : orderNumber
            ? t("notify.eventCancelled.bodyOrder", { orderNumber })
            : t("notify.eventCancelled.bodyGeneric"),
    };
  }
  if (notification.type === "payout_status") {
    const status = stringField(data, "status") ?? "";
    const paid = change === "payout_paid" || status.startsWith("paid");
    const eligibleAt = stringField(data, "eligible_at");
    if (!stringField(data, "event_title") || !money)
      return {
        title: t(paid ? "notify.payout.paidTitle" : "notify.payout.title"),
        body: t("notify.payout.bodyGeneric"),
      };
    return {
      title: t(paid ? "notify.payout.paidTitle" : "notify.payout.title"),
      body: paid
        ? t("notify.payout.paidBody", { eventTitle, amount: money })
        : eligibleAt
          ? t("notify.payout.scheduledBody", {
              eventTitle,
              amount: money,
              date: formatDateTime(eligibleAt, locale, "medium"),
            })
          : t("notify.payout.scheduledBodyNoDate", {
              eventTitle,
              amount: money,
            }),
    };
  }
  if (notification.type === "activation_status") {
    if (change === "activation_failed")
      return {
        title: t("notify.activation.failedTitle", { eventTitle }),
        body: t(
          reason === "timeout"
            ? "notify.activation.timeoutBody"
            : "notify.activation.failedBody",
        ),
      };
    return {
      title: t("notify.activation.succeededTitle", { eventTitle }),
      body: money
        ? t("notify.activation.succeededBody", { amount: money })
        : t("notify.activation.succeededBodyGeneric"),
    };
  }
  if (notification.type === "event_report") {
    if (change === "report_resolved" || change === "report_dismissed")
      return {
        title: t("notify.report.reviewedTitle", { eventTitle }),
        body: t(
          change === "report_resolved"
            ? "notify.report.resolvedBody"
            : "notify.report.dismissedBody",
        ),
      };
    const category = stringField(data, "category");
    return {
      title: t("notify.report.newTitle", { eventTitle }),
      body: category
        ? t("notify.report.newBody", {
            category: t(`adminX.reportCategory.${category}`, {
              defaultValue: category,
            }),
          })
        : t("notify.report.newBodyGeneric"),
    };
  }
  if (notification.type === "event_updated") {
    if (change === "suspended")
      return {
        title: t("notify.event.suspendedTitle", { eventTitle }),
        body: withReason(t, t("notify.event.suspendedBody"), reason),
      };
    if (change === "unsuspended")
      return {
        title: t("notify.event.unsuspendedTitle", { eventTitle }),
        body: withReason(
          t,
          t(
            data?.event_status === "published"
              ? "notify.event.unsuspendedPublishedBody"
              : "notify.event.unsuspendedBody",
          ),
          reason,
        ),
      };
    if (change === "paid_sales_suspended")
      return {
        title: t("notify.event.paidSalesSuspendedTitle", { eventTitle }),
        body: withReason(t, t("notify.event.paidSalesSuspendedBody"), reason),
      };
    if (change === "paid_sales_unsuspended")
      return {
        title: t("notify.event.paidSalesResumedTitle", { eventTitle }),
        body: withReason(t, t("notify.event.paidSalesResumedBody"), reason),
      };
    if (change === "unpublished")
      return {
        title: t("notify.event.unpublishedTitle", { eventTitle }),
        body: withReason(t, t("notify.event.unpublishedBody"), reason),
      };
    if (change === "staff_assigned" || change === "staff_removed") {
      const role = stringField(data, "role");
      const roleName = role
        ? t(`notify.staffRole.${role}`, { defaultValue: role })
        : t("notify.staffRole.unknown");
      return change === "staff_assigned"
        ? {
            title: t("notify.event.staffAssignedTitle", { eventTitle }),
            body: t("notify.event.staffAssignedBody", { role: roleName }),
          }
        : {
            title: t("notify.event.staffRemovedTitle", { eventTitle }),
            body: t("notify.event.staffRemovedBody", { role: roleName }),
          };
    }
    const updatedTitle =
      stringField(data, "event_title") ??
      legacyEventUpdatedTitle.exec(notification.title)?.[1];
    return {
      title: updatedTitle
        ? t("ui.eventUpdatedTitle", { eventTitle: updatedTitle })
        : t("ui.eventUpdatedTitleLegacy"),
      body: t("ui.eventUpdatedBody"),
    };
  }
  if (notification.type === "support_message") {
    const caseNumber =
      stringField(data, "case_number") ??
      legacySupportMessageTitle.exec(notification.title)?.[1];
    // The body is the participant's own message and stays as written.
    return {
      title: caseNumber
        ? t(
            change === "case_created"
              ? "notify.support.caseCreatedTitle"
              : "ui.supportMessageTitle",
            { caseNumber },
          )
        : notification.title,
      body: notification.body,
    };
  }
  if (notification.type === "support_status") {
    const caseNumber =
      stringField(data, "case_number") ??
      legacySupportStatusTitle.exec(notification.title)?.[1];
    if (change === "escalated")
      return {
        title: caseNumber
          ? t("notify.support.escalatedTitle", { caseNumber })
          : t("notify.support.escalatedTitleGeneric"),
        body: withReason(t, t("notify.support.escalatedBody"), reason),
      };
    const legacy = legacySupportStatusBody.exec(notification.body);
    const oldStatus = stringField(data, "old_status") ?? legacy?.[1];
    const newStatus = stringField(data, "new_status") ?? legacy?.[2];
    return {
      title: caseNumber
        ? t("ui.supportStatusTitle", { caseNumber })
        : notification.title,
      body:
        oldStatus && newStatus
          ? t("ui.supportStatusBody", {
              oldStatus: t(`status.${oldStatus}`, { defaultValue: oldStatus }),
              newStatus: t(`status.${newStatus}`, { defaultValue: newStatus }),
            })
          : notification.body,
    };
  }
  if (notification.type === "support_assigned") {
    const caseNumber = stringField(data, "case_number");
    const name = stringField(data, "assigned_by_name");
    const subject = stringField(data, "subject");
    return {
      title: caseNumber
        ? t("notify.support.assignedTitle", { caseNumber })
        : t("notify.support.assignedTitleGeneric"),
      body: [
        name
          ? t("notify.support.assignedBody", { name })
          : t("notify.support.assignedBodyGeneric"),
        subject,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  if (notification.type === "account_verification")
    return {
      title: t("notify.verification.title"),
      body: t("notify.verification.body"),
    };
  return { title: notification.title, body: notification.body };
}
