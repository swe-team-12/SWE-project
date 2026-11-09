import { loginHref, safeRedirectPath } from "../loginRedirect";

describe("safeRedirectPath", () => {
  it("keeps in-app paths", () => {
    expect(safeRedirectPath("/orders")).toBe("/orders");
    expect(safeRedirectPath("/support/abc")).toBe("/support/abc");
    expect(safeRedirectPath(["/scanner"])).toBe("/scanner");
  });

  it("rejects external, malformed, and auth-page targets", () => {
    for (const value of [
      undefined,
      "",
      "orders",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "/login",
      "/register?x=1",
    ])
      expect(safeRedirectPath(value)).toBeUndefined();
  });
});

describe("loginHref", () => {
  it("adds the return path as a redirect param", () => {
    expect(loginHref("/notifications")).toEqual({
      pathname: "/login",
      params: { redirect: "/notifications" },
    });
  });

  it("falls back to plain /login without a useful return path", () => {
    expect(loginHref(undefined)).toBe("/login");
    expect(loginHref("/")).toBe("/login");
    expect(loginHref("//evil.example")).toBe("/login");
  });
});
