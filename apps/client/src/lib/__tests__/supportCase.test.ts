import {
  attachmentProblem,
  contextOptions,
  resolveInitialContext,
  type SupportContexts,
} from "../supportCase";

const contexts = {
  events: [
    { id: "e1", title: "Gala" },
    { id: "e2", title: "Forum" },
  ],
  orders: [
    { id: "o1", event_id: "e1", order_number: "BF-1", status: "paid" },
    { id: "o2", event_id: "e2", order_number: "BF-2", status: "paid" },
  ],
  tickets: [
    {
      id: "t1",
      event_id: "e1",
      order_id: "o1",
      ticket_code: "TKT-1",
      attendee_name: "Aru",
      status: "valid",
    },
  ],
  managed_events: [{ id: "m1", title: "My event" }],
} as unknown as SupportContexts;

describe("support case context", () => {
  it("derives the order and event from a linked ticket or order", () => {
    expect(resolveInitialContext(contexts, { ticketId: "t1" })).toEqual({
      eventId: "e1",
      orderId: "o1",
      ticketId: "t1",
    });
    expect(resolveInitialContext(contexts, { orderId: "o2" })).toEqual({
      eventId: "e2",
      orderId: "o2",
    });
  });

  it("drops linked orders and tickets that are not the user's", () => {
    expect(
      resolveInitialContext(contexts, {
        eventId: "e9",
        orderId: "other",
        ticketId: "other",
      }),
    ).toEqual({ eventId: "e9" });
  });

  it("offers orders and tickets of the selected event only", () => {
    const options = contextOptions(contexts, {
      kind: "attendee_to_organizer",
      eventId: "e1",
    });
    expect(options.orders.map((item) => item.id)).toEqual(["o1"]);
    expect(options.tickets.map((item) => item.id)).toEqual(["t1"]);
    expect(
      contextOptions(contexts, { kind: "organizer_to_platform" }).events,
    ).toEqual(contexts.managed_events);
  });

  it("adds a deep-linked event that is not in the user's contexts", () => {
    const options = contextOptions(contexts, {
      kind: "attendee_to_organizer",
      extraEvent: { id: "e9", title: "Public event" } as never,
    });
    expect(options.events[0].id).toBe("e9");
  });
});

describe("attachment validation", () => {
  it("accepts JPEG, PNG and PDF up to 10 MB", () => {
    expect(attachmentProblem({ name: "a.pdf", size: 1000 })).toBeNull();
    expect(
      attachmentProblem({ name: "photo", mimeType: "image/png", size: 10 }),
    ).toBeNull();
  });

  it("rejects other types and oversized files", () => {
    expect(attachmentProblem({ name: "a.exe" })).toBe(
      "attachment_type_invalid",
    );
    expect(attachmentProblem({ name: "a.jpg", size: 50 * 1024 * 1024 })).toBe(
      "attachment_too_large",
    );
  });
});
