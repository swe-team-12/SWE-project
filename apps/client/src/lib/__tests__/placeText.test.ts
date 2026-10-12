import { placeText } from "../placeText";

describe("seeded place translations", () => {
  it.each([
    ["ru", "проспект Абая, 44, Алматы", "Азия/Алматы", "Алматы"],
    ["kk", "Абай даңғылы, 44, Алматы", "Азия/Алматы", "Алматы"],
    ["en", "Abay Avenue 44, Almaty", "Asia/Almaty", "Almaty"],
  ])(
    "localizes the seeded venue address, time zone, and city in %s",
    (locale, address, timezone, city) => {
      expect(placeText("Abay Avenue 44, Almaty", locale)).toBe(address);
      expect(placeText("Asia/Almaty", locale)).toBe(timezone);
      expect(placeText("Almaty", locale)).toBe(city);
    },
  );

  it("leaves organizer-entered free text unchanged", () => {
    expect(placeText("Dostyk Avenue 5, Astana", "ru")).toBe(
      "Dostyk Avenue 5, Astana",
    );
    expect(placeText("Asia/Aqtobe", "kk")).toBe("Asia/Aqtobe");
  });
});
