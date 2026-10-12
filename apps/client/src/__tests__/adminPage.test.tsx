import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, userEvent } from "@testing-library/react-native";

import i18n from "@/i18n";
import { apiFetch } from "@/lib/api";
import AdminPage from "../../app/admin";

jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/files", () => ({ downloadAuthenticatedFile: jest.fn() }));
jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { roles: ["platform_admin"] } }),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe("AdminPage activation fee", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedApiFetch.mockImplementation(async (path: string) =>
      path.startsWith("/admin/settings/activation-fee") ? {} : [],
    );
  });

  it("clears the saved message when the fee is edited after saving", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });
    const screen = await render(
      <QueryClientProvider client={client}>
        <AdminPage />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await user.press(screen.getByText("Save for future activations"));
    expect(await screen.findByText("Setting saved.")).toBeTruthy();
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/admin/settings/activation-fee?amount_tiyin=500000",
      { method: "PUT" },
    );

    await user.type(screen.getByLabelText("Activation fee (KZT)"), "1");
    expect(screen.queryByText("Setting saved.")).toBeNull();

    await screen.unmount();
    client.clear();
  });
});
