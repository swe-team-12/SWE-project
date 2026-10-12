import { notificationHref } from "../notificationHref";

describe("notification click-through targets", () => {
  it("opens order history for order confirmations and refunds", () => {
    expect(
      notificationHref({
        data: { order_id: "order-id", order_number: "BF-1" } as never,
      }),
    ).toBe("/orders");
    expect(notificationHref({ data: { order_id: "order-id" } })).toBe(
      "/orders",
    );
  });

  it("prefers the order over the event when an event cancellation voids an order", () => {
    expect(
      notificationHref({
        data: { event_id: "event-id", order_id: "order-id" },
      }),
    ).toBe("/orders");
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

  it("has no target when the notification carries no related entity", () => {
    expect(notificationHref({ data: {} })).toBeUndefined();
    expect(notificationHref({ data: null })).toBeUndefined();
  });
});
