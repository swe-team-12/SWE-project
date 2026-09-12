import { formatKzt, newIdempotencyKey } from "../format";

describe("KZT and mutation identifiers", () => {
  it("formats stored minor units as whole KZT", () => {
    const formatted = formatKzt(500_000, "en");
    expect(formatted).toContain("5,000");
    expect(formatted).toContain("KZT");
  });

  it("creates namespaced idempotency keys", () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    expect(newIdempotencyKey("payment")).toMatch(/^payment-1700000000000-/);
    jest.restoreAllMocks();
  });
});
