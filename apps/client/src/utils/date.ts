/**
 * Shared date/time display formatting.
 *
 * Kazakh ("kk") is formatted manually: several runtimes (Chrome's bundled
 * ICU, Hermes) ship without full CLDR data for kk and silently fall back to
 * the root locale, producing strings like "2026 M10 12, Mon 15:51" (#55).
 * Some of them still report kk as supported, so feature detection alone is
 * not reliable. The manual output mirrors CLDR's kk patterns.
 */

export type DateDisplayStyle =
  /** Weekday, day, month name and year plus time (event details). */
  | "full"
  /** Day, abbreviated month and year plus time (cards, lists). */
  | "medium"
  /** Numeric date with time, like Date#toLocaleString(). */
  | "numeric"
  /** Time only, like Date#toLocaleTimeString(). */
  | "time";

const KK_MONTHS = [
  "қаңтар",
  "ақпан",
  "наурыз",
  "сәуір",
  "мамыр",
  "маусым",
  "шілде",
  "тамыз",
  "қыркүйек",
  "қазан",
  "қараша",
  "желтоқсан",
];

const KK_MONTHS_SHORT = [
  "қаң.",
  "ақп.",
  "нау.",
  "сәу.",
  "мам.",
  "мау.",
  "шіл.",
  "там.",
  "қыр.",
  "қаз.",
  "қар.",
  "жел.",
];

const KK_WEEKDAYS = [
  "жексенбі",
  "дүйсенбі",
  "сейсенбі",
  "сәрсенбі",
  "бейсенбі",
  "жұма",
  "сенбі",
];

const INTL_OPTIONS: Record<DateDisplayStyle, Intl.DateTimeFormatOptions> = {
  full: { dateStyle: "full", timeStyle: "short" },
  medium: { dateStyle: "medium", timeStyle: "short" },
  numeric: {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  },
  time: { hour: "numeric", minute: "2-digit", second: "2-digit" },
};

const pad = (value: number) => String(value).padStart(2, "0");

function isKazakh(locale: string | undefined): boolean {
  return (locale ?? "").toLowerCase().split(/[-_]/)[0] === "kk";
}

function formatKazakh(date: Date, style: DateDisplayStyle): string {
  const day = date.getDate();
  const month = date.getMonth();
  const year = date.getFullYear();
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const hms = `${hm}:${pad(date.getSeconds())}`;
  switch (style) {
    case "full":
      return `${year} ж. ${day} ${KK_MONTHS[month]}, ${KK_WEEKDAYS[date.getDay()]}, ${hm}`;
    case "medium":
      return `${year} ж. ${day} ${KK_MONTHS_SHORT[month]}, ${hm}`;
    case "numeric":
      return `${pad(day)}.${pad(month + 1)}.${year}, ${hms}`;
    case "time":
      return hms;
  }
}

export function formatDateTime(
  value: string | number | Date,
  locale: string | undefined,
  style: DateDisplayStyle = "numeric",
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (isKazakh(locale)) return formatKazakh(date, style);
  return new Intl.DateTimeFormat(locale, INTL_OPTIONS[style]).format(date);
}
