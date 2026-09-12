import { render, userEvent } from "@testing-library/react-native";

import i18n from "@/i18n";
import { SeatMap } from "../SeatMap";

const seat = {
  id: "seat-a-b-7",
  section: "A",
  row: "B",
  number: "7",
  price_category: "premium",
  is_accessible: true,
  x: 100,
  y: 100,
  status: "available" as const,
};

describe("SeatMap", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("offers a keyboard and screen-reader friendly list alternative", async () => {
    const onSelect = jest.fn();
    const screen = await render(
      <SeatMap seats={[seat]} selected={[]} onSelect={onSelect} />,
    );
    const user = userEvent.setup();

    await user.press(screen.getByText("Accessible list"));
    const choice = screen.getByLabelText(
      "Section A, row B, seat 7, premium, accessible seat, Available",
    );
    expect(choice.props.accessibilityState).toEqual({
      checked: false,
      disabled: false,
    });
    await user.press(choice);
    expect(onSelect).toHaveBeenCalledWith(seat);
  });

  it("exposes selected state without relying on color", async () => {
    const screen = await render(
      <SeatMap seats={[seat]} selected={[seat.id]} onSelect={jest.fn()} />,
    );
    const user = userEvent.setup();
    await user.press(screen.getByText("Accessible list"));
    expect(
      screen.getByLabelText(
        "Section A, row B, seat 7, premium, accessible seat, Selected",
      ).props.accessibilityState,
    ).toEqual({ checked: true, disabled: false });
  });
});
