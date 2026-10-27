import i18n from "@/i18n";

interface ProblemText {
  code?: string;
  detail: string;
}

// Problem `code` values whose detail has a client-side translation under
// `apiErrors.<code>`. Unknown codes fall back to the server-provided detail.
const localizedCodes = new Set([
  "promo_invalid",
  "promo_disabled",
  "promo_not_started",
  "promo_expired",
  "promo_exhausted",
  "promo_code_exists",
  "inventory_exhausted",
]);

export function apiErrorText(problem: ProblemText, locale?: string): string {
  if (!problem.code || !localizedCodes.has(problem.code)) return problem.detail;
  const t = locale ? i18n.getFixedT(locale) : i18n.t.bind(i18n);
  return t(`apiErrors.${problem.code}`, { defaultValue: problem.detail });
}
