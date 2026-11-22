import i18n from "@/i18n";

interface ProblemText {
  code?: string;
  detail: string;
}

// A problem `code` with a translation under `apiErrors.<code>` is shown in the
// selected language. Unknown codes fall back to the server-provided detail.
export function apiErrorText(problem: ProblemText, locale?: string): string {
  if (!problem.code) return problem.detail;
  const key = `apiErrors.${problem.code}`;
  if (!i18n.exists(key, locale ? { lng: locale } : undefined)) return problem.detail;
  const t = locale ? i18n.getFixedT(locale) : i18n.t.bind(i18n);
  return t(key, { defaultValue: problem.detail });
}
