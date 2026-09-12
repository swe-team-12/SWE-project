import { expect, test } from "@playwright/test";

test("discovers an event and keeps the public journey responsive", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("BiletFlow", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Events worth showing up for." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View event" }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "View event" }).first().click();
  await expect(
    page.getByRole("link", { name: "Choose tickets" }),
  ).toBeVisible();
});

test("switches every application label to Russian without reloading", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ru" }).click();
  await expect(
    page.getByRole("heading", { name: "События, на которые хочется прийти." }),
  ).toBeVisible();
  await expect(page.getByText("Афиша", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Открыть событие" }).first(),
  ).toBeVisible();
});

test("exposes a keyboard-operable sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  await page.getByRole("textbox", { name: "Email" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
});

test("selects an assigned seat through both map and accessible list", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    const isExpectedAnonymousRefresh =
      text.includes("Failed to load resource") && text.includes("401");
    if (message.type() === "error" && !isExpectedAnonymousRefresh) {
      runtimeErrors.push(text);
    }
  });

  await page.goto("/login");
  await page
    .getByRole("textbox", { name: "Email" })
    .fill("attendee@example.com");
  await page
    .getByLabel("Password")
    .fill(process.env.BILETFLOW_DEMO_PASSWORD ?? "BiletFlowDemo123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Events worth showing up for." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "View event" }).first().click();
  await page.getByRole("link", { name: "Choose tickets" }).click();

  const map = page.getByLabel("Interactive Almaty Hall seat map");
  await expect(map).toBeVisible();
  const availableSeat = map.locator('circle[fill="#FFFFFF"]').first();
  await availableSeat.click();
  await expect(map.locator('circle[fill="#00A7A5"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Accessible list" }).click();
  const selectedSeat = page.getByRole("checkbox", { checked: true });
  await expect(selectedSeat).toBeVisible();
  await selectedSeat.click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);

  expect(runtimeErrors).toEqual([]);
});
