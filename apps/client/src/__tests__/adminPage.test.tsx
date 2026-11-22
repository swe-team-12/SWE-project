import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, userEvent } from "@testing-library/react-native";

import { overviewCounts } from "@/components/admin/AdminOverview";
import { parseFeeKzt } from "@/components/admin/AdminSettings";
import i18n from "@/i18n";
import { apiFetch } from "@/lib/api";
import AdminPage from "../../app/admin";

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  usePathname: () => "/admin",
  useLocalSearchParams: () => ({}),
}));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/files", () => ({ downloadAuthenticatedFile: jest.fn() }));
jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "admin", roles: ["platform_admin"] } }),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

function settings(fee: number) {
  return {
    activation_fee_tiyin: fee,
    activation_fee_source: "configured",
    default_activation_fee_tiyin: 500000,
    processor_fee_bps: 250,
    checkout_hold_minutes: 10,
    currency: "KZT",
    mode: "demo",
    updated_at: null,
    updated_by: null,
  };
}

describe("parseFeeKzt", () => {
  it("accepts whole and decimal KZT amounts", () => {
    expect(parseFeeKzt("5000")).toBe(500000);
    expect(parseFeeKzt(" 5 000,50 ")).toBe(500050);
    expect(parseFeeKzt("0")).toBe(0);
  });

  it("rejects text, negatives and too many decimals", () => {
    expect(parseFeeKzt("")).toBeNull();
    expect(parseFeeKzt("abc")).toBeNull();
    expect(parseFeeKzt("-1")).toBeNull();
    expect(parseFeeKzt("1.234")).toBeNull();
  });
});

describe("AdminPage activation fee", () => {
  let fee = 500000;

  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    fee = 500000;
    mockedApiFetch.mockReset();
    mockedApiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/admin/settings/activation-fee")) {
        fee = Number(
          new URL(path, "http://x").searchParams.get("amount_tiyin"),
        );
        return settings(fee);
      }
      if (path === "/admin/settings") return settings(fee);
      return [];
    });
  });

  it("loads the fee, confirms the change and clears the saved message on edit", async () => {
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

    expect(
      await screen.findByText(/Current activation fee: .*5[\s ,.]?000/),
    ).toBeTruthy();
    const input = screen.getByLabelText("Activation fee (KZT)");
    await user.clear(input);
    await user.type(input, "6000");
    await user.press(screen.getByText("Save for future activations"));
    expect(screen.getByText("Change the activation fee?")).toBeTruthy();
    expect(mockedApiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/admin/settings/activation-fee"),
      expect.anything(),
    );

    await user.press(screen.getByText("Change fee"));
    expect(await screen.findByText(/Setting saved\./)).toBeTruthy();
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/admin/settings/activation-fee?amount_tiyin=600000",
      { method: "PUT" },
    );

    await user.type(screen.getByLabelText("Activation fee (KZT)"), "1");
    expect(screen.queryByText(/Setting saved\./)).toBeNull();

    await screen.unmount();
    client.clear();
  });

  it("shows a validation message for an invalid amount", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const screen = await render(
      <QueryClientProvider client={client}>
        <AdminPage />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const input = await screen.findByLabelText("Activation fee (KZT)");
    await user.clear(input);
    await user.type(input, "abc");
    expect(
      screen.getByText("Enter an amount in KZT, for example 5000 or 5000.50."),
    ).toBeTruthy();

    await screen.unmount();
    client.clear();
  });
});

describe("admin overview tiles", () => {
  it("counts open cases and unpaid payouts only", () => {
    expect(
      overviewCounts({
        cases: [
          { status: "open" },
          { status: "resolved" },
          { status: "in_progress" },
        ],
        payments: [{}, {}],
        reports: [],
        payouts: [{ status: "paid_demo" }, { status: "scheduled" }],
      }),
    ).toEqual({ cases: 2, payments: 2, reports: 0, payouts: 1 });
    expect(overviewCounts({}).cases).toBeUndefined();
  });

  it("opens the matching section from a tile", async () => {
    await i18n.changeLanguage("en");
    mockedApiFetch.mockReset();
    mockedApiFetch.mockImplementation(async (path: string) => {
      if (path === "/admin/settings") return settings(500000);
      if (path.startsWith("/admin/support-cases"))
        return [{ status: "open" }, { status: "resolved" }];
      return [];
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const screen = await render(
      <QueryClientProvider client={client}>
        <AdminPage />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const tile = await screen.findByLabelText(
      "Open platform cases: 1. Open the section",
    );
    await user.press(tile);
    expect(
      await screen.findByText(i18n.t("adminX.cases.help")),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Support cases" }).props
        .accessibilityState,
    ).toEqual({ selected: true });

    await screen.unmount();
    client.clear();
  });
});
