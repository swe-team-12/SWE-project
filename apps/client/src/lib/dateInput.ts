// Normalizes a typed calendar date into ISO 8601 (YYYY-MM-DD) so API query
// parameters never depend on the UI language or regional date conventions.

// Zero code points of common non-ASCII decimal digit sets (Arabic-Indic,
// Extended Arabic-Indic, Devanagari). Full-width digits are folded by NFKC.
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966];

function toAsciiDigits(value: string): string {
  return value.replace(/\p{Nd}/gu, (char) => {
    const code = char.codePointAt(0)!;
    for (const zero of DIGIT_ZEROS) {
      if (code >= zero && code <= zero + 9) return String(code - zero);
    }
    return char;
  });
}

function buildIso(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return null;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Accepts ISO input (2026-11-14) as well as locale-style input such as
 * 14.11.2026 or 14.11.2026 г. (ru/kk day-first dotted dates) and
 * slash dates (11/14/2026 for en, 14/11/2026 otherwise). Returns null when
 * the value is not a real calendar date.
 */
export function toIsoDate(value: string, locale = "en"): string | null {
  const normalized = toAsciiDigits(value.normalize("NFKC"))
    .replace(/[‐-―−]/g, "-")
    .replace(/\s*(г|ж)\.?$/iu, "")
    .replace(/\s+/g, "")
    .replace(/\.$/, "");
  if (!normalized) return null;

  const yearFirst = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(normalized);
  if (yearFirst) {
    return buildIso(+yearFirst[1], +yearFirst[2], +yearFirst[3]);
  }

  const yearLast = /^(\d{1,2})([-./])(\d{1,2})\2(\d{4})$/.exec(normalized);
  if (yearLast) {
    const [, a, separator, b, year] = yearLast;
    const monthFirst =
      separator === "/" && locale.toLowerCase().startsWith("en");
    return monthFirst ? buildIso(+year, +a, +b) : buildIso(+year, +b, +a);
  }
  return null;
}
