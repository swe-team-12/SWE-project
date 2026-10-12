import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";

import i18n from "@/i18n";
import { apiFetch } from "@/lib/api";
import CheckoutPage from "../../app/checkout/[eventId]";

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  router: { replace: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({ eventId: "event-1", session: "session-1" }),
}));
jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { display_name: "Aruzhan", email: "aruzhan@example.com" },
  }),
}));
jest.mock("@/lib/analytics", () => ({ captureAnalytics: jest.fn() }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));

const event = {
  id: "event-1",
  title: "Almaty Jazz Night",
  seating_mode: "general",
  ticket_types: [],
};

function mockCheckoutSession(status: string) {
  jest.mocked(apiFetch).mockImplementation(async (path: string) => {
    if (path === "/events/event-1") return event;
    if (path === "/checkout/sessions/session-1")
      return {
        id: "session-1",
        status,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        subtotal_tiyin: 500_000,
        discount_tiyin: 0,
        processing_fee_tiyin: 15_000,
        total_tiyin: 500_000,
      };
    throw new Error(`Unexpected request ${path}`);
  });
}

function renderCheckout() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CheckoutPage />
    </QueryClientProvider>,
  );
}

describe("CheckoutPage after a reload", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("restores the payment step for a reservation that is still held", async () => {
    mockCheckoutSession("open");
    const screen = await renderCheckout();

    expect(await screen.findByText("Inventory reserved")).toBeTruthy();
    expect(screen.getByText("Simulate successful payment")).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith("/checkout/sessions/session-1");
  });

  it("explains that an expired reservation was released", async () => {
    mockCheckoutSession("expired");
    const screen = await renderCheckout();

    expect(
      await screen.findByText(
        "This reservation expired and the tickets were released. Start a new checkout.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Inventory reserved")).toBeNull();
  });
});
