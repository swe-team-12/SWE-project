import type { TFunction } from "i18next";

import { analyticsQuery, percentText } from "../AnalyticsSection";
import { campaignPayload, campaignState, EMPTY_CAMPAIGN, validateCampaignForm } from "../CampaignsSection";
import {
  defaultZonedInput,
  fromZonedInput,
  isValidTimeZone,
  parseDateInput,
  parseLocalInput,
  toZonedInput,
} from "../dateTime";
import { changedEventFields, eventPayload, eventToValues, newEventValues, validateEventForm } from "../EventForm";
import { visibleTabs } from "../EventWorkspace";
import { historyActionText, historyQuery } from "../HistorySection";
import { invitationState } from "../TeamSection";
import {
  DEFAULT_PER_ORDER_LIMIT,
  inventoryFor,
  ticketPayload,
  ticketToValues,
  validateTicketForm,
} from "../TicketTypesSection";
import type { Campaign, EventAccess, OrgEvent } from "../types";

// Hoisted by jest above the imports; EventWorkspace imports expo-router.
jest.mock("expo-router", () => ({
  Link: () => null,
  router: { push: jest.fn(), replace: jest.fn() },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

const ZONE = "Asia/Almaty"; // UTC+5 all year
const NOW = new Date("2026-11-22T06:00:00Z");

describe("zoned date helpers", () => {
  it("convert wall-clock input to UTC and back", () => {
    expect(fromZonedInput("2026-12-01T18:30", ZONE)).toBe("2026-12-01T13:30:00.000Z");
    expect(fromZonedInput("01.12.2026 18:30", ZONE)).toBe("2026-12-01T13:30:00.000Z");
    expect(toZonedInput("2026-12-01T13:30:00Z", ZONE)).toBe("2026-12-01T18:30");
    expect(toZonedInput(null, ZONE)).toBe("");
  });

  it("reject impossible dates and zones", () => {
    expect(parseLocalInput("2026-02-30T10:00")).toBeNull();
    expect(parseLocalInput("2026-12-01T24:00")).toBeNull();
    expect(fromZonedInput("tomorrow", ZONE)).toBeNull();
    expect(parseDateInput("31.12.2026")).toBe("2026-12-31");
    expect(parseDateInput("2026-13-01")).toBeNull();
    expect(isValidTimeZone("Asia/Almaty")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });

  it("build defaults on the event clock", () => {
    expect(defaultZonedInput(14, 18, ZONE, NOW)).toBe("2026-12-06T18:00");
  });
});

function event(overrides: Partial<OrgEvent> = {}): OrgEvent {
  return {
    id: "e1",
    title: "Jazz night",
    description: "An evening of live jazz.",
    category: "Music",
    city: "Almaty",
    venue_name: "Hall",
    venue_address: "Abay 1",
    timezone: ZONE,
    starts_at: "2026-12-06T13:00:00Z",
    ends_at: "2026-12-06T16:00:00Z",
    registration_opens_at: null,
    registration_closes_at: null,
    capacity: 100,
    visibility: "public",
    seating_mode: "general_admission",
    refund_policy: "Full refunds until the event starts.",
    status: "draft",
    ...overrides,
  } as unknown as OrgEvent;
}

describe("event form", () => {
  it("requires the basic fields on a new event", () => {
    const errors = validateEventForm(newEventValues(NOW));
    expect(errors).toMatchObject({
      title: "titleShort",
      description: "descriptionShort",
      category: "categoryShort",
      venueName: "venueShort",
      venueAddress: "addressShort",
    });
    expect(errors.startsAt).toBeUndefined();
  });

  it("checks time zone, date order, registration window and capacity", () => {
    const values = {
      ...eventToValues(event()),
      timezone: "Nowhere/City",
      endsAt: "2026-12-06T10:00",
      registrationOpensAt: "2026-12-05T10:00",
      registrationClosesAt: "2026-12-04T10:00",
      capacity: "0",
    };
    expect(validateEventForm(values)).toEqual({
      timezone: "timezoneInvalid",
      endsAt: "endBeforeStart",
      registrationClosesAt: "registrationCloseBeforeOpen",
      capacity: "capacityInvalid",
    });
  });

  it("sends instants in UTC and only changed fields on edit", () => {
    const values = eventToValues(event());
    expect(validateEventForm(values)).toEqual({});
    expect(eventPayload(values)).toMatchObject({
      starts_at: "2026-12-06T13:00:00.000Z",
      registration_opens_at: null,
      capacity: 100,
    });
    expect(changedEventFields(values, event())).toEqual({});
    expect(changedEventFields({ ...values, title: "Jazz night II", capacity: "120" }, event())).toEqual({
      title: "Jazz night II",
      capacity: 120,
    });
  });
});

describe("ticket type form", () => {
  it("defaults to the API per-order limit", () => {
    expect(ticketToValues(null, ZONE).maxPerOrder).toBe(String(DEFAULT_PER_ORDER_LIMIT));
  });

  it("validates price, quantity, per-order limit and sales window", () => {
    const values = {
      ...ticketToValues(null, ZONE),
      name: " ",
      price: "-1",
      quantity: "1.5",
      maxPerOrder: "51",
      salesStart: "2026-12-02T10:00",
      salesEnd: "2026-12-01T10:00",
    };
    expect(validateTicketForm(values, ZONE)).toEqual({
      name: "nameRequired",
      price: "priceInvalid",
      quantity: "quantityInvalid",
      maxPerOrder: "perOrderInvalid",
      salesEnd: "endBeforeStart",
    });
  });

  it("stores prices in tiyin and price category only for seated events", () => {
    const values = { ...ticketToValues(null, ZONE), name: "VIP", price: "12500.5", category: "premium" };
    expect(validateTicketForm(values, ZONE)).toEqual({});
    expect(ticketPayload(values, ZONE, false)).toMatchObject({
      price_tiyin: 1_250_050,
      price_category: null,
      sales_start_at: null,
    });
    expect(ticketPayload(values, ZONE, true).price_category).toBe("premium");
  });

  it("matches inventory rows by ticket type id", () => {
    const rows = [{ ticket_type_id: "a", sold: 3 }, { id: "b", sold: 1 }] as never;
    expect(inventoryFor(rows, "b")).toEqual({ id: "b", sold: 1 });
    expect(inventoryFor(undefined, "a")).toBeUndefined();
  });
});

describe("campaigns", () => {
  it("validates code, discount, window and redemptions", () => {
    expect(
      validateCampaignForm(
        {
          ...EMPTY_CAMPAIGN,
          name: "A",
          code: "no spaces",
          discountValue: "150",
          startsAt: "2026-12-02T10:00",
          endsAt: "2026-12-01T10:00",
          maxRedemptions: "0",
        },
        ZONE,
      ),
    ).toEqual({
      name: "nameRequired",
      code: "codeInvalid",
      discountValue: "percentInvalid",
      endsAt: "endBeforeStart",
      maxRedemptions: "redemptionsInvalid",
    });
    expect(
      validateCampaignForm({ ...EMPTY_CAMPAIGN, name: "Fixed", discountType: "fixed_kzt", discountValue: "0" }, ZONE),
    ).toEqual({ discountValue: "amountInvalid" });
  });

  it("sends fixed discounts in tiyin and upper-case codes", () => {
    expect(
      campaignPayload(
        { ...EMPTY_CAMPAIGN, name: "Early", code: "early-26", discountType: "fixed_kzt", discountValue: "1500" },
        ZONE,
      ),
    ).toMatchObject({ code: "EARLY-26", discount_value: 150_000, starts_at: null, max_redemptions: null });
  });

  it("derives a state when the API sends none", () => {
    const base = { is_enabled: true, starts_at: null, ends_at: null, redemptions_remaining: null } as unknown as Campaign;
    expect(campaignState({ ...base, state: "active" } as Campaign, NOW)).toBe("active");
    expect(campaignState({ ...base, is_enabled: false }, NOW)).toBe("disabled");
    expect(campaignState({ ...base, starts_at: "2026-12-01T00:00:00Z" }, NOW)).toBe("not_started");
    expect(campaignState({ ...base, ends_at: "2026-11-01T00:00:00Z" }, NOW)).toBe("expired");
    expect(campaignState({ ...base, redemptions_remaining: 0 }, NOW)).toBe("exhausted");
    expect(campaignState(base, NOW)).toBe("active");
  });
});

describe("history", () => {
  it("includes the whole end day on the event clock", () => {
    const query = new URLSearchParams(
      historyQuery({ family: "order", start: "2026-11-20", end: "2026-11-22" }, 25, ZONE).slice(1),
    );
    expect(query.get("activity_type")).toBe("order");
    expect(query.get("offset")).toBe("25");
    expect(query.get("start")).toBe("2026-11-19T19:00:00.000Z");
    expect(query.get("end")).toBe("2026-11-22T18:59:59.999Z");
  });

  it("omits empty filters", () => {
    const query = new URLSearchParams(historyQuery({ family: "all", start: "", end: "" }, 0).slice(1));
    expect(query.has("activity_type")).toBe(false);
    expect(query.has("start")).toBe(false);
    expect(query.has("end")).toBe(false);
  });

  it("translates known actions and falls back to the description", () => {
    const t = ((key: string) => (key === "organizer.history.actions.event_published" ? "Published" : "")) as unknown as TFunction;
    expect(historyActionText({ action: "event.published", description: "x" }, t)).toBe("Published");
    expect(historyActionText({ action: "custom.thing", description: "Server text" }, t)).toBe("Server text");
  });
});

describe("analytics, invitations and tabs", () => {
  it("builds the analytics query", () => {
    expect(analyticsQuery({ start: "", end: "", ticketTypeId: "all" })).toBe("");
    expect(analyticsQuery({ start: "2026-11-01", end: "2026-11-30", ticketTypeId: "t1" })).toBe(
      "?start=2026-11-01&end=2026-11-30&ticket_type_id=t1",
    );
    expect(percentText(33.333)).toBe("33.3%");
    expect(percentText(undefined)).toBe("0%");
  });

  it("labels invitations", () => {
    expect(invitationState({ accepted: true, expires_at: "2026-01-01T00:00:00Z" }, NOW)).toBe("accepted");
    expect(invitationState({ accepted: false, expires_at: "2026-01-01T00:00:00Z" }, NOW)).toBe("expired");
    expect(invitationState({ accepted: false, expires_at: "2026-12-31T00:00:00Z" }, NOW)).toBe("pending");
  });

  it("shows tabs by role", () => {
    const none: EventAccess = {
      loading: false, isOwner: false, isAdmin: false, manage: false,
      finance: false, attendees: false, support: false, any: true,
    };
    expect(visibleTabs({ ...none, attendees: true })).toEqual(["overview", "attendees"]);
    expect(visibleTabs({ ...none, attendees: true, support: true })).toEqual(["overview", "attendees", "support"]);
    expect(visibleTabs({ ...none, finance: true })).toEqual([
      "overview", "tickets", "activation", "sales", "orders", "analytics", "campaigns", "history",
    ]);
    expect(visibleTabs({ ...none, manage: true, finance: true, attendees: true, support: true })).toHaveLength(11);
  });
});
