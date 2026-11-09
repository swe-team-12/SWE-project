const AUTH_PAGES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
];

/**
 * Accepts only same-app absolute paths so the post-login redirect cannot be
 * abused as an open redirect (e.g. `//evil.example` or `https://…`).
 */
export function safeRedirectPath(
  value: string | string[] | undefined | null,
): string | undefined {
  const path = Array.isArray(value) ? value[0] : value;
  if (!path || !path.startsWith("/") || path.startsWith("//")) return undefined;
  if (path.includes("\\") || /[\u0000-\u001f]/.test(path)) return undefined;
  const bare = path.split(/[?#]/)[0];
  if (AUTH_PAGES.includes(bare)) return undefined;
  return path;
}

export function loginHref(
  returnTo: string | undefined,
): "/login" | { pathname: "/login"; params: { redirect: string } } {
  const redirect = safeRedirectPath(returnTo);
  if (!redirect || redirect === "/") return "/login";
  return { pathname: "/login", params: { redirect } };
}
