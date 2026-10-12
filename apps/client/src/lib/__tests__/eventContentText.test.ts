import i18n from "@/i18n";
import { eventContentText } from "../eventContentText";

const refundPolicy = "Full refunds are available until the event starts.";
const ticketDescriptions = [
  "Center-section seating with priority entry.",
  "General assigned seating.",
  "Accessible seating allocation.",
];

describe("event content translations", () => {
  it.each(["ru", "kk"])(
    "renders the default refund policy and demo ticket descriptions in %s",
    (locale) => {
      const t = i18n.getFixedT(locale);
      expect(eventContentText(refundPolicy, locale)).toBe(
        t("eventContent.defaultRefundPolicy"),
      );
      expect(eventContentText(refundPolicy, locale)).not.toBe(refundPolicy);
      for (const description of ticketDescriptions) {
        const translated = eventContentText(description, locale);
        expect(translated).not.toBe(description);
        expect(translated).not.toMatch(/^eventContent\./);
      }
    },
  );

  it("matches stored copy without the trailing period", () => {
    expect(
      eventContentText("Center-section seating with priority entry", "ru"),
    ).toBe(i18n.getFixedT("ru")("eventContent.premiumTicket"));
  });

  it("keeps English copy in English and leaves organizer text unchanged", () => {
    expect(eventContentText(refundPolicy, "en")).toBe(refundPolicy);
    expect(eventContentText("No refunds after 1 May.", "ru")).toBe(
      "No refunds after 1 May.",
    );
    expect(eventContentText("", "kk")).toBe("");
  });
});
