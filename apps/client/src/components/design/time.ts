import { zonedWallClock } from "@/lib/eventTime";

// Compact date/time pieces for the redesigned cards (timeline ends, date
// chips). Long-form dates still go through formatEventDateTime.

const KK_MONTHS_SHORT = [
  "қаң",
  "ақп",
  "нау",
  "сәу",
  "мам",
  "мау",
  "шіл",
  "там",
  "қыр",
  "қаз",
  "қар",
  "жел",
];

const KK_WEEKDAYS_SHORT = ["жс", "дс", "сс", "ср", "бс", "жм", "сб"];

const pad = (value: number) => String(value).padStart(2, "0");

function language(locale: string): string {
  return (locale || "en").toLowerCase().split(/[-_]/)[0];
}

/** "HH:MM" in the event's own time zone (24-hour clock). */
export function shortTime(
  value: string | null | undefined,
  timeZone: string | null | undefined,
): string {
  if (!value) return "";
  const date = zonedWallClock(value, timeZone);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Abbreviated month name for a 0-based month index. */
export function monthShort(monthIndex: number, locale: string): string {
  if (language(locale) === "kk") return KK_MONTHS_SHORT[monthIndex] ?? "";
  try {
    return new Intl.DateTimeFormat(locale, { month: "short" })
      .format(new Date(2026, monthIndex, 1))
      .replace(/\.$/, "");
  } catch {
    return String(monthIndex + 1);
  }
}

/** Abbreviated weekday for a 0-based (Sunday first) weekday index. */
export function weekdayShort(weekday: number, locale: string): string {
  if (language(locale) === "kk") return KK_WEEKDAYS_SHORT[weekday] ?? "";
  try {
    // 2026-11-01 is a Sunday.
    return new Intl.DateTimeFormat(locale, { weekday: "short" })
      .format(new Date(2026, 10, 1 + weekday))
      .replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** "6 Dec" in the event's time zone. */
export function shortDate(
  value: string | null | undefined,
  timeZone: string | null | undefined,
  locale: string,
): string {
  if (!value) return "";
  const date = zonedWallClock(value, timeZone);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()} ${monthShort(date.getMonth(), locale)}`;
}

/** Whole hours/minutes/days between two instants (never negative). */
export function durationParts(
  start: string | null | undefined,
  end: string | null | undefined,
): { days: number; hours: number; minutes: number } | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMinutes = Math.round(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  return { days, hours, minutes: totalMinutes % 60 };
}

export interface DayChip {
  /** Local calendar date as YYYY-MM-DD (what the date filter expects). */
  iso: string;
  day: number;
  month: number;
  weekday: number;
}

/** The next `count` local calendar days starting today. */
export function upcomingDays(count: number, now = new Date()): DayChip[] {
  const days: DayChip[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
    );
    days.push({
      iso: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      day: date.getDate(),
      month: date.getMonth(),
      weekday: date.getDay(),
    });
  }
  return days;
}
