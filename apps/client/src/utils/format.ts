export function formatKzt(tiyin: number, locale = "kk"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 0,
  }).format(tiyin / 100);
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
