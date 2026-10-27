import { isValidEmail, normalizeEmail } from "../email";

describe("email helpers", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  attendee@example.com \n")).toBe(
      "attendee@example.com",
    );
  });

  it("accepts well-formed addresses, including with stray whitespace", () => {
    expect(isValidEmail("attendee@example.com")).toBe(true);
    expect(isValidEmail("attendee@example.com ")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    for (const value of [
      "",
      "   ",
      "test@",
      "@example.com",
      "test@example",
      "a b@example.com",
    ]) {
      expect(isValidEmail(value)).toBe(false);
    }
  });
});
