import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke test for the primary journey.
 * Run against a locally built app: `npm run build && npm start`, or pass
 * BASE_URL to point it at a deployment.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3000",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});