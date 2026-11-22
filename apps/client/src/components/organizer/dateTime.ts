// Date-time helpers for organizer forms. Organizers enter wall-clock times in
// the event's IANA time zone; the API receives and returns ISO 8601 instants.

export const DEFAULT_TIME_ZONE = "Asia/Almaty";

export const COMMON_TIME_ZONES = [
  "Asia/Almaty",
  "Asia/Qyzylorda",
  "Asia/Aqtobe",
  "Asia/Atyrau",
  "Asia/Aqtau",
  "Asia/Oral",
  "UTC",
];

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

function wallClockIn(date: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Some engines report midnight as 24 with hourCycle h23.
    hour: read("hour") % 24,
    minute: read("minute"),
  };
}

function safeZone(timeZone: string): string {
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

/** ISO instant -> "YYYY-MM-DDTHH:mm" as shown on a clock in `timeZone`. */
export function toZonedInput(
  iso: string | null | undefined,
  timeZone: string,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const clock = wallClockIn(date, safeZone(timeZone));
  return `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}T${pad(clock.hour)}:${pad(clock.minute)}`;
}

/**
 * Parses what a date-time control produces ("2026-12-01T18:30") and what a
 * person types on devices without one ("2026-12-01 18:30", "01.12.2026 18:30").
 */
export function parseLocalInput(value: string): WallClock | null {
  const text = value.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(
    text,
  );
  let clock: WallClock | null = null;
  if (match) {
    clock = {
      year: +match[1],
      month: +match[2],
      day: +match[3],
      hour: +match[4],
      minute: +match[5],
    };
  } else {
    match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})[,\s]+(\d{1,2}):(\d{2})$/.exec(text);
    if (match) {
      clock = {
        year: +match[3],
        month: +match[2],
        day: +match[1],
        hour: +match[4],
        minute: +match[5],
      };
    }
  }
  if (!clock) return null;
  if (clock.year < 1000 || clock.hour > 23 || clock.minute > 59) return null;
  const check = new Date(Date.UTC(clock.year, clock.month - 1, clock.day));
  if (
    check.getUTCFullYear() !== clock.year ||
    check.getUTCMonth() !== clock.month - 1 ||
    check.getUTCDate() !== clock.day
  ) {
    return null;
  }
  return clock;
}

/** Wall-clock input in `timeZone` -> ISO instant (UTC), or null if invalid. */
export function fromZonedInput(value: string, timeZone: string): string | null {
  const clock = parseLocalInput(value);
  if (!clock) return null;
  const zone = safeZone(timeZone);
  const asUtc = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
  );
  // Offset of the zone at a given instant, in milliseconds east of UTC.
  const offsetAt = (instant: number) => {
    const shown = wallClockIn(new Date(instant), zone);
    return (
      Date.UTC(
        shown.year,
        shown.month - 1,
        shown.day,
        shown.hour,
        shown.minute,
      ) - instant
    );
  };
  let instant = asUtc - offsetAt(asUtc);
  // A second pass settles times near a daylight-saving change.
  instant = asUtc - offsetAt(instant);
  return new Date(instant).toISOString();
}

/** "YYYY-MM-DD" (or a typed local date) -> normalized "YYYY-MM-DD" or null. */
export function parseDateInput(value: string): string | null {
  const text = value.trim();
  let year: number;
  let month: number;
  let day: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) {
    [year, month, day] = [+match[1], +match[2], +match[3]];
  } else {
    match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
    if (!match) return null;
    [year, month, day] = [+match[3], +match[2], +match[1]];
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1000 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Default wall-clock value `days` from now at `hour`:00 in `timeZone`. */
export function defaultZonedInput(
  days: number,
  hour: number,
  timeZone: string,
  now: Date = new Date(),
): string {
  const clock = wallClockIn(
    new Date(now.getTime() + days * 86_400_000),
    safeZone(timeZone),
  );
  return `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}T${pad(hour)}:00`;
}
