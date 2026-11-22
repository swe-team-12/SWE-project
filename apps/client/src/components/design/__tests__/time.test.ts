import {
  durationParts,
  monthShort,
  shortDate,
  shortTime,
  upcomingDays,
  weekdayShort,
} from "../time";

describe("design time helpers", () => {
  it("formats a 24-hour time in the event time zone", () => {
    expect(shortTime("2026-12-06T13:05:00Z", "Asia/Almaty")).toBe("18:05");
    expect(shortTime(null, "Asia/Almaty")).toBe("");
    expect(shortTime("not a date", "Asia/Almaty")).toBe("");
  });

  it("splits a duration into days, hours and minutes", () => {
    expect(
      durationParts("2026-12-06T13:00:00Z", "2026-12-07T15:30:00Z"),
    ).toEqual({ days: 1, hours: 2, minutes: 30 });
    expect(
      durationParts("2026-12-06T13:00:00Z", "2026-12-06T13:45:00Z"),
    ).toEqual({ days: 0, hours: 0, minutes: 45 });
    expect(durationParts("2026-12-06T13:00:00Z", "2026-12-06T12:00:00Z")).toBe(
      null,
    );
    expect(durationParts(undefined, "2026-12-06T12:00:00Z")).toBe(null);
  });

  it("lists upcoming local days across a month boundary", () => {
    const days = upcomingDays(3, new Date(2026, 10, 29, 22, 0));
    expect(days.map((day) => day.iso)).toEqual([
      "2026-11-29",
      "2026-11-30",
      "2026-12-01",
    ]);
    expect(days[2]).toMatchObject({ day: 1, month: 11 });
    expect(days[0].weekday).toBe(0);
  });

  it("uses Kazakh abbreviations without relying on Intl data", () => {
    expect(monthShort(0, "kk")).toBe("қаң");
    expect(monthShort(11, "kk-KZ")).toBe("жел");
    expect(weekdayShort(0, "kk")).toBe("жс");
    expect(shortDate("2026-12-06T13:00:00Z", "Asia/Almaty", "kk")).toBe(
      "6 жел",
    );
  });

  it("uses Intl abbreviations for English", () => {
    expect(monthShort(11, "en")).toBe("Dec");
  });
});
