import { defineConfig, devices } from "@playwright/test";

/**
 * Golden-path e2e config — placeholder for the e2e milestone.
 * Browsers are intentionally NOT installed yet (`npx playwright install`).
 * `npm run check` does not run this suite.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
