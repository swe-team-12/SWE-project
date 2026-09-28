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
      type: "support_message",
      title: "Staff replied",
      body: "Open your case",
    };
    expect(notificationText(other, "kk")).toEqual({
      title: other.title,
      body: other.body,
    });
  });
});
