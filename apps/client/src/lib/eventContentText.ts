import i18n from "@/i18n";

// Platform-provided event copy (the default refund policy and the demo ticket
// type descriptions) is stored in English. Map those known strings to
// translation keys so they follow the selected language; organizer-written
// text is returned unchanged.
const knownEventContent: Record<string, string> = {
  "full refunds are available until the event starts":
    "eventContent.defaultRefundPolicy",
  "center-section seating with priority entry": "eventContent.premiumTicket",
  "general assigned seating": "eventContent.standardTicket",
  "accessible seating allocation": "eventContent.accessibleTicket",
};

function normalize(text: string): string {
  return text.trim().replace(/\.$/, "").toLowerCase();
}

export function eventContentText(
  text: string | null | undefined,
  locale: string,
): string {
  if (!text) return "";
  const key = knownEventContent[normalize(text)];
  return key ? i18n.getFixedT(locale)(key) : text;
}
