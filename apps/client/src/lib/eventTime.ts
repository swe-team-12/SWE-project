import { placeText } from "@/lib/placeText";
import { type DateDisplayStyle, formatDateTime } from "@/utils/date";

/**
 * Returns a Date whose local wall-clock fields equal the wall clock of
 * `value` in `timeZone`, so the shared formatter (which prints local time)
 * shows the event's own time. Falls back to the original instant when the
 * runtime does not know the zone.
 */
export function zonedWallClock(
  value: string | number | Date,
  timeZone: string | null | undefined,
): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!timeZone || Number.isNaN(date.getTime())) return date;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).formatToParts(date);
    const part = (type: string) =>
      Number(parts.find((item) => item.type === type)?.value);
    const shifted = new Date(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour") % 24,
      part("minute"),
      part("second"),
    );
    return Number.isNaN(shifted.getTime()) ? date : shifted;
  } catch {
    return date;
  }
}

/** Formats an instant in the event's time zone and names that zone. */
export function formatEventDateTime(
  value: string | null | undefined,
  timeZone: string | null | undefined,
  locale: string,
  style: DateDisplayStyle = "medium",
): string {
  if (!value) return "";
  const text = formatDateTime(zonedWallClock(value, timeZone), locale, style);
  if (!text) return "";
  return timeZone ? `${text} (${placeText(timeZone, locale)})` : text;
}
