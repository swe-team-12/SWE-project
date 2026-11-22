import { fireEvent, render } from "@testing-library/react-native";

import i18n from "@/i18n";

import { Badge, Tabs } from "../common";
import { HeroStats, ProgressMeter } from "../design";

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
}));

describe("organizer design pieces", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("exposes progress as text and as an accessible value", async () => {
    const screen = await render(
      <ProgressMeter label="Sold" value={30} max={120} valueText="30 / 120" />,
    );
    expect(screen.getByText("30 / 120")).toBeTruthy();
    const meter = screen.getByLabelText("Sold: 30 / 120");
    expect(meter.props.accessibilityValue).toEqual({ min: 0, max: 120, now: 30 });
  });

  it("renders the headline numbers of the hero card", async () => {
    const screen = await render(
      <HeroStats
        kicker="Sales at a glance"
        items={[
          { label: "Sold", value: "12 / 100" },
          { label: "Gross", value: "5 000 ₸" },
        ]}
      />,
    );
    expect(screen.getByText("Sales at a glance")).toBeTruthy();
    expect(screen.getByText("12 / 100")).toBeTruthy();
    expect(screen.getByText("5 000 ₸")).toBeTruthy();
  });

  it("keeps tab roles, selection state and testIDs", async () => {
    const onChange = jest.fn();
    const screen = await render(
      <Tabs<string>
        label="Event sections"
        value="overview"
        onChange={onChange}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "sales", label: "Sales" },
        ]}
      />,
    );
    expect(screen.getByTestId("tab-overview").props.accessibilityState).toEqual({
      selected: true,
    });
    fireEvent.press(screen.getByTestId("tab-sales"));
    expect(onChange).toHaveBeenCalledWith("sales");
  });

  it("shows status as text, not colour alone", async () => {
    const screen = await render(<Badge status="published" />);
    expect(screen.getByText("Published")).toBeTruthy();
  });
});
