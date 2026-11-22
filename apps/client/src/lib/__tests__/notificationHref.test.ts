import { notificationHref, notificationTarget } from "../notificationHref";

describe("notification click-through targets", () => {
  it("opens the order detail for order confirmations and refunds", () => {
    expect(
      notificationHref({
        data: { order_id: "order-id", order_number: "BF-1" } as never,
      }),
    ).toBe("/orders/order-id");
    expect(notificationHref({ data: { order_id: "order-id" } })).toBe(
      "/orders/order-id",
    );
  });

  it("prefers the order over the event when an event cancellation voids an order", () => {
    expect(
      notificationHref({
        data: { event_id: "event-id", order_id: "order-id" },
      }),
    ).toBe("/orders/order-id");
  });

  it("opens support cases and events", () => {
    expect(notificationHref({ data: { case_id: "case-id" } })).toEqual({
      pathname: "/support/[id]",
      params: { id: "case-id" },
    });
    expect(notificationHref({ data: { event_id: "event-id" } })).toEqual({
      pathname: "/events/[id]",
      params: { id: "event-id" },
    });
  });

  it("opens the wallet for delivered tickets and the admin console for reports", () => {
    expect(
      notificationHref({ type: "ticket_delivered", data: { order_id: "o" } }),
    ).toBe("/tickets");
    expect(
      notificationHref({
        type: "event_report",
        data: { change: "event_reported", event_id: "e" },
      }),
    ).toBe("/admin");
  });

  it("sends organizer-facing event notifications to the management page", () => {
    const manage = {
      pathname: "/organizer/events/[id]",
      params: { id: "e" },
    };
    expect(
      notificationHref({ type: "payout_status", data: { event_id: "e" } }),
    ).toEqual(manage);
    expect(
      notificationHref({
        type: "event_updated",
        data: { event_id: "e", change: "paid_sales_suspended" },
      }),
    ).toEqual(manage);
    expect(
      notificationHref({
        type: "event_updated",
        data: {
          event_id: "e",
          change: "suspended",
          paid_sales_suspended: false,
        },
      }),
    ).toEqual(manage);
    expect(
      notificationTarget({
        type: "event_updated",
        data: { event_id: "e", change: "suspended" },
      })?.kind,
    ).toBe("tickets");
  });

  it("has no target when the notification carries no related entity", () => {
    expect(notificationHref({ data: {} })).toBeUndefined();
    expect(notificationHref({ data: null })).toBeUndefined();
  });
});
