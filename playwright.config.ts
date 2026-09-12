import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BILETFLOW_WEB_URL ?? "http://127.0.0.1:8081";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm --workspace @biletflow/client run web -- --port 8081",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
