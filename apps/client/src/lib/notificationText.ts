import i18n from "@/i18n";

interface NotificationText {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

const legacyOrderBody = /^Order (.+) contains (\d+) ticket\(s\)\.$/;

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
  return { title: notification.title, body: notification.body };
}
