import i18n from "@/i18n";
import { notificationText } from "../notificationText";

const oldOrder = {
  type: "order_confirmed",
  title: "Your BiletFlow order is confirmed",
  body: "Order BF-123 contains 1 ticket(s).",
  data: { order_id: "order-id" },
};
const oldFailure = {
  type: "payment_failed",
  title: "Demonstration payment failed",
  body: "No ticket was issued. Start checkout again.",
  data: { event_id: "event-id" },
};

describe("payment notification translations", () => {
  it.each(["kk", "ru"])(
    "renders stored success and failure notifications in %s after a language switch",
    async (locale) => {
      await i18n.changeLanguage(locale);
      const success = notificationText(oldOrder, i18n.language);
      const failure = notificationText(oldFailure, i18n.language);
      expect(success.title).not.toBe(oldOrder.title);
      expect(success.body).toContain("BF-123");
      expect(success.body).toContain("1");
      expect(success.body).not.toBe(oldOrder.body);
      expect(failure.title).not.toBe(oldFailure.title);
      expect(failure.body).not.toBe(oldFailure.body);
    },
  );

  it("distinguishes timeout from failure using saved outcome", async () => {
    await i18n.changeLanguage("ru");
    const timeout = notificationText(
      { ...oldFailure, data: { outcome: "timeout" } },
      i18n.language,
    );
    const failure = notificationText(oldFailure, i18n.language);
    expect(timeout.title).not.toBe(failure.title);
    expect(timeout.body).toBe(failure.body);
  });

  it("uses structured details for new orders and leaves unrelated notifications alone", () => {
    const structured = notificationText(
      {
        ...oldOrder,
        body: "irrelevant historical copy",
        data: { order_number: "BF-456", ticket_count: 2 },
      },
      "kk",
    );
    expect(structured.body).toContain("BF-456");
    expect(structured.body).toContain("2");
    const other = {
      type: "payout_status",
      title: "Payout sent",
      body: "Open your case",
    };
    expect(notificationText(other, "kk")).toEqual({
      title: other.title,
      body: other.body,
    });
  });
});

describe("event update and support notification translations", () => {
  const oldEventUpdate = {
    type: "event_updated",
    title: "Almaty Tech Forum 2026 was updated",
    body: "Review the latest event date, time, and venue details.",
    data: { event_id: "event-id" },
  };
  const oldSupportMessage = {
    type: "support_message",
    title: "New message in SUP-DEMO-0001",
    body: "Please check the venue entrance.",
    data: { case_id: "case-id" },
  };
  const oldSupportStatus = {
    type: "support_status",
    title: "Support case SUP-DEMO-0001 updated",
    body: "Status changed from open to in_progress.",
    data: { case_id: "case-id" },
  };

  it.each(["kk", "ru"])(
    "renders stored event and support notifications in %s",
    (locale) => {
      const event = notificationText(oldEventUpdate, locale);
      expect(event.title).toContain("Almaty Tech Forum 2026");
      expect(event.title).not.toBe(oldEventUpdate.title);
      expect(event.body).not.toBe(oldEventUpdate.body);

      const message = notificationText(oldSupportMessage, locale);
      expect(message.title).toContain("SUP-DEMO-0001");
      expect(message.title).not.toBe(oldSupportMessage.title);
      expect(message.body).toBe(oldSupportMessage.body);

      const status = notificationText(oldSupportStatus, locale);
      const t = i18n.getFixedT(locale);
      expect(status.title).toContain("SUP-DEMO-0001");
      expect(status.title).not.toBe(oldSupportStatus.title);
      expect(status.body).toContain(t("status.open"));
      expect(status.body).toContain(t("status.in_progress"));
      expect(status.body).not.toContain("in_progress");
    },
  );

  it("prefers structured data for new notifications", () => {
    const event = notificationText(
      {
        ...oldEventUpdate,
        title: "irrelevant",
        data: { event_title: "Spring Gala" },
      },
      "ru",
    );
    expect(event.title).toContain("Spring Gala");
    const status = notificationText(
      {
        ...oldSupportStatus,
        title: "irrelevant",
        body: "irrelevant",
        data: {
          case_number: "SUP-2",
          old_status: "in_progress",
          new_status: "resolved",
        },
      },
      "ru",
    );
    expect(status.title).toContain("SUP-2");
    expect(status.body).toContain(i18n.getFixedT("ru")("status.resolved"));
  });
});
