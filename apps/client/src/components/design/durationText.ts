import type { TFunction } from "i18next";

import { durationParts } from "./time";

/** Localised compact duration ("3h 10m", "2d 4h") or undefined. */
export function durationText(
  start: string | null | undefined,
  end: string | null | undefined,
  t: TFunction,
): string | undefined {
  const parts = durationParts(start, end);
  if (!parts) return undefined;
  if (parts.days)
    return parts.hours
      ? t("attendee.ux.durationDaysHours", parts)
      : t("attendee.ux.durationDays", parts);
  if (parts.hours)
    return parts.minutes
      ? t("attendee.ux.durationHoursMinutes", parts)
      : t("attendee.ux.durationHours", parts);
  return t("attendee.ux.durationMinutes", parts);
}
