import i18n from "@/i18n";

import { ApiError } from "../api";
import { apiErrorText } from "../apiErrorText";

describe("API error localization", () => {
  it.each([
    ["promo_exhausted", "ru", "Лимит использований промокода исчерпан."],
    ["promo_code_exists", "kk", "Мұндай промокод бар. Басқасын таңдаңыз."],
    ["inventory_exhausted", "kk", "Билеттер жеткіліксіз."],
    ["inventory_exhausted", "en", "Not enough tickets remain."],
  ])("translates %s in %s", (code, locale, expected) => {
    expect(apiErrorText({ code, detail: "server text" }, locale)).toBe(
      expected,
    );
  });

  it("falls back to the server detail for unknown codes", () => {
    expect(
      apiErrorText({ code: "something_else", detail: "Server says no." }, "ru"),
    ).toBe("Server says no.");
  });

  it("localizes ApiError messages in the active language", async () => {
    await i18n.changeLanguage("ru");
    const error = new ApiError({
      title: "Sold out",
      status: 409,
      code: "inventory_exhausted",
      detail: "Not enough tickets remain.",
    });
    expect(error.message).toBe("Недостаточно оставшихся билетов.");
  });
});
