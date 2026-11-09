import { render } from "@testing-library/react-native";
import { Text } from "react-native";

import { RequireAuth } from "@/components/RequireAuth";
import i18n from "@/i18n";

const mockAuth = { user: null as object | null, loading: false };

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  usePathname: () => "/orders",
}));
jest.mock("@/providers/AuthProvider", () => ({ useAuth: () => mockAuth }));

function renderGuard() {
  return render(
    <RequireAuth>
      <Text>Protected content</Text>
    </RequireAuth>,
  );
}

describe("RequireAuth", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("waits for session restore instead of showing the sign-in prompt", async () => {
    Object.assign(mockAuth, { user: null, loading: true });
    const screen = await renderGuard();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("Sign in required")).toBeNull();
    expect(screen.queryByText("Protected content")).toBeNull();
  });

  it("shows a sign-in prompt, not an error, when signed out", async () => {
    Object.assign(mockAuth, { user: null, loading: false });
    const screen = await renderGuard();
    expect(screen.getByText("Sign in required")).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.queryByText("Protected content")).toBeNull();
  });

  it("renders the page for a signed-in user", async () => {
    Object.assign(mockAuth, { user: { id: "u1" }, loading: false });
    const screen = await renderGuard();
    expect(screen.getByText("Protected content")).toBeTruthy();
  });
});
