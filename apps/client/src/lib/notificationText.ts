import i18n from "@/i18n";

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

export function notificationText(
  notification: NotificationText,
  locale: string,
): { title: string; body: string } {
  const t = i18n.getFixedT(locale);
  if (notification.type === "order_confirmed") {
    const legacy = legacyOrderBody.exec(notification.body);
    const orderNumber =
      typeof notification.data?.order_number === "string"
        ? notification.data.order_number
        : legacy?.[1];
    const count =
      typeof notification.data?.ticket_count === "number"
        ? notification.data.ticket_count
        : legacy
          ? Number(legacy[2])
          : undefined;
    return {
      title: t("ui.orderConfirmedTitle"),
      body:
        orderNumber && count !== undefined
          ? t("ui.orderConfirmedBody", { orderNumber, count })
          : t("ui.orderConfirmedBodyLegacy"),
    };
  }
  if (notification.type === "payment_failed") {
    const timedOut = notification.data?.outcome === "timeout";
    return {
      title: t(
        timedOut ? "ui.demoPaymentTimedOutTitle" : "ui.demoPaymentFailedTitle",
      ),
      body: t(
        timedOut ? "ui.demoPaymentTimedOutBody" : "ui.demoPaymentFailedBody",
      ),
    };
  }
  if (notification.type === "event_updated") {
    const eventTitle =
      stringField(notification.data, "event_title") ??
      legacyEventUpdatedTitle.exec(notification.title)?.[1];
    return {
      title: eventTitle
        ? t("ui.eventUpdatedTitle", { eventTitle })
        : t("ui.eventUpdatedTitleLegacy"),
      body: t("ui.eventUpdatedBody"),
    };
  }
  if (notification.type === "support_message") {
    const caseNumber =
      stringField(notification.data, "case_number") ??
      legacySupportMessageTitle.exec(notification.title)?.[1];
    // The body is the participant's own message and stays as written.
    return {
      title: caseNumber
        ? t("ui.supportMessageTitle", { caseNumber })
        : notification.title,
      body: notification.body,
    };
  }
  if (notification.type === "support_status") {
    const caseNumber =
      stringField(notification.data, "case_number") ??
      legacySupportStatusTitle.exec(notification.title)?.[1];
    const legacy = legacySupportStatusBody.exec(notification.body);
    const oldStatus =
      stringField(notification.data, "old_status") ?? legacy?.[1];
    const newStatus =
      stringField(notification.data, "new_status") ?? legacy?.[2];
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
  return { title: notification.title, body: notification.body };
}
