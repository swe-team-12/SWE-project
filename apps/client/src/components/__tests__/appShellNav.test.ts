import { hidesTabBar, isLinkActive, visibleLinkKeys } from "../AppShell";

jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({}) }));
jest.mock("expo-router", () => ({
  Link: () => null,
  router: { replace: jest.fn() },
  usePathname: () => "/",
}));

const none = { canScan: false, hasOrganizerEvents: false };

describe("navigation by role", () => {
  it("shows only discovery when signed out", () => {
    expect(visibleLinkKeys(undefined, none)).toEqual(["discover"]);
  });

  it("hides scanner, organizer and admin from a plain attendee", () => {
    const keys = visibleLinkKeys(["attendee"], none);
    expect(keys).not.toContain("scanner");
    expect(keys).not.toContain("organizer");
    expect(keys).not.toContain("admin");
    expect(keys).toContain("tickets");
  });

  it("shows the scanner and organizer area to assigned event staff", () => {
    const keys = visibleLinkKeys(["attendee"], {
      canScan: true,
      hasOrganizerEvents: true,
    });
    expect(keys).toContain("scanner");
    expect(keys).toContain("organizer");
    expect(keys).not.toContain("admin");
  });

  it("shows admin only to platform admins", () => {
    expect(visibleLinkKeys(["attendee", "organizer"], none)).toEqual(
      expect.arrayContaining(["organizer", "scanner"]),
    );
    expect(visibleLinkKeys(["attendee", "organizer"], none)).not.toContain(
      "admin",
    );
    expect(visibleLinkKeys(["platform_admin"], none)).toContain("admin");
  });
});

describe("mobile tab bar", () => {
  it("is hidden on checkout, whose sticky pay bar sits at the bottom", () => {
    expect(hidesTabBar("/checkout/abc")).toBe(true);
    expect(hidesTabBar("/checkout")).toBe(true);
    expect(hidesTabBar("/events/abc")).toBe(false);
    expect(hidesTabBar("/")).toBe(false);
    expect(hidesTabBar("/support/abc")).toBe(false);
  });

  it("marks only the matching entry as active", () => {
    expect(isLinkActive("/", "/")).toBe(true);
    expect(isLinkActive("/", "/tickets")).toBe(false);
    expect(isLinkActive("/support", "/support/123")).toBe(true);
    expect(isLinkActive("/admin", "/support")).toBe(false);
  });
});
