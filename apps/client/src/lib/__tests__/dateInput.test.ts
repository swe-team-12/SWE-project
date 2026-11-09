import { toIsoDate } from "../dateInput";

describe("toIsoDate", () => {
  it.each(["en", "ru", "kk"])("keeps ISO input unchanged in %s", (locale) => {
    expect(toIsoDate("2026-11-14", locale)).toBe("2026-11-14");
    expect(toIsoDate(" 2026-11-14 ", locale)).toBe("2026-11-14");
  });

  it.each(["en", "ru", "kk"])(
    "normalizes day-first dotted dates in %s",
    (locale) => {
      expect(toIsoDate("14.11.2026", locale)).toBe("2026-11-14");
      expect(toIsoDate("1.2.2026", locale)).toBe("2026-02-01");
    },
  );

  it("strips Russian and Kazakh year suffixes", () => {
    expect(toIsoDate("14.11.2026 г.", "ru")).toBe("2026-11-14");
    expect(toIsoDate("14.11.2026 ж.", "kk")).toBe("2026-11-14");
  });

  it("reads slash dates using the locale's field order", () => {
    expect(toIsoDate("11/14/2026", "en")).toBe("2026-11-14");
    expect(toIsoDate("14/11/2026", "ru")).toBe("2026-11-14");
    expect(toIsoDate("14/11/2026", "kk")).toBe("2026-11-14");
  });

  it("folds non-ASCII digits and dash variants", () => {
    expect(toIsoDate("２０２６－１１－１４", "kk")).toBe("2026-11-14");
    expect(toIsoDate("2026–11–14", "ru")).toBe("2026-11-14");
    expect(toIsoDate("٢٠٢٦-١١-١٤", "en")).toBe("2026-11-14");
  });

  it.each([
    "",
    "2026-02-30",
    "31.04.2026",
    "13/13/2026",
    "next friday",
    "2026-11",
  ])("rejects %p", (value) => {
    expect(toIsoDate(value, "kk")).toBeNull();
  });
});
