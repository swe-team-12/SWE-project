import i18n from "@/i18n";

// Seeded demo locations are stored in English; organizer-entered values are
// free text and are shown exactly as typed.
const seededPlaceKeys: Record<string, string> = {
  Almaty: "places.almaty",
  "Abay Avenue 44, Almaty": "places.abayAvenue44Almaty",
  "Asia/Almaty": "places.asiaAlmaty",
};

export function placeText(value: string, locale: string): string {
  const key = seededPlaceKeys[value.trim()];
  return key ? i18n.getFixedT(locale)(key) : value;
}
