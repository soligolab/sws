import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for SWS editor end-to-end tests.
 *
 * The runtime + Vite dev server must be running before invoking the tests:
 *
 *   # Terminal A
 *   ./scripts/dev.sh both
 *
 *   # Terminal B
 *   cd sws-editor && pnpm test:e2e
 *
 * We deliberately don't use Playwright's `webServer` config because the
 * runtime spawn flow expects a writable `.run/` directory + a self-signed
 * cert + an `SWS_ADMIN_PASSWORD` env var. The dev.sh script encapsulates
 * all of that — letting Playwright drive the runtime would mean
 * duplicating the bootstrap.
 *
 * The self-signed cert is accepted via `ignoreHTTPSErrors: true`. Tests
 * never type any value but `admin` / `admin` (the dev.sh seed credentials)
 * so they only work against a locally-spawned dev runtime.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "https://localhost:5173",
    ignoreHTTPSErrors: true,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
