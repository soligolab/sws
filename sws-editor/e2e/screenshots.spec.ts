/**
 * Screenshot capture spec for the SWS manual (docs/manual/screenshots/).
 *
 * Targets a RUNNING runtime that serves the built SPA on https://localhost:8444
 * (start it with ./scripts/start_runtime.sh). The runtime is mono-project and
 * no-auth by default, so there is no login step and the IDE opens straight into
 * the active project.
 *
 * Run:
 *   cd sws-editor
 *   npx playwright test e2e/screenshots.spec.ts --project=chromium
 */

import { test, type Page } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SHOTS = path.join(__dirname, "..", "..", "docs", "manual", "screenshots");

const ADMIN_URL = "https://localhost:8444/";
const VIEWER_URL = "https://localhost:8443/";

test.use({
  baseURL: ADMIN_URL,
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});

/** Open the IDE; dismiss the WelcomeScreen if a project isn't already active. */
async function openIde(page: Page) {
  await page.goto(ADMIN_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // No-auth: if a top-level login form ever shows, fill the dev creds.
  const userInput = page.locator('input[autocomplete="username"]');
  if (await userInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await userInput.fill("admin");
    await page.locator('input[autocomplete="current-password"]').fill("admin");
    await page.getByRole("button", { name: /Accedi/i }).click();
    await page.waitForTimeout(800);
  }

  // WelcomeScreen (no active project): open the first listed project.
  const apri = page.getByRole("button", { name: /^Apri/ }).first();
  if (await apri.isVisible({ timeout: 2000 }).catch(() => false)) {
    await apri.click();
    await page.waitForTimeout(1200);
  }

  await page.waitForSelector('button:has-text("☰ Menu")', { timeout: 20_000 });
  await page.waitForTimeout(500);
}

async function toMode(page: Page, name: "Editor" | "Configurazione") {
  const btn = page.getByRole("button", { name: new RegExp(`^${name}$`) }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(800);
  }
}

async function configTab(page: Page, label: RegExp) {
  const tab = page.getByRole("button", { name: label }).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(700);
  }
}

test("01 — IDE first view", async ({ page }) => {
  await openIde(page);
  await toMode(page, "Editor");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, "01_login.png") });
});

test("02 — editor main", async ({ page }) => {
  await openIde(page);
  await toMode(page, "Editor");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOTS, "02_editor_main.png") });
});

test("03 — left panel widget palette", async ({ page }) => {
  await openIde(page);
  await toMode(page, "Editor");
  const display = page.locator("button", { hasText: /^Display$/ }).first();
  if (await display.isVisible().catch(() => false)) {
    const expanded = await display.getAttribute("aria-expanded");
    if (expanded === "false") await display.click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(SHOTS, "03_left_panel.png") });
});

test("04 — variabili (tag) tab", async ({ page }) => {
  await openIde(page);
  await toMode(page, "Configurazione");
  await configTab(page, /^Variabili$/);
  await page.screenshot({ path: path.join(SHOTS, "04_runtime_mode.png") });
});

test("05 — protocolli tab", async ({ page }) => {
  await openIde(page);
  await toMode(page, "Configurazione");
  await configTab(page, /^Protocolli$/);
  await page.screenshot({ path: path.join(SHOTS, "05_config_view.png") });
});

test("06 — allarmi tab", async ({ page }) => {
  await openIde(page);
  await toMode(page, "Configurazione");
  await configTab(page, /^Allarmi$/);
  await page.screenshot({ path: path.join(SHOTS, "06_alarms_tab.png") });
});

test("07 — operator viewer (port 8443)", async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const vp = await ctx.newPage();
  await vp.goto(VIEWER_URL, { waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
  await vp.waitForTimeout(1500);
  await vp.screenshot({ path: path.join(SHOTS, "07_viewer_8443.png") });
  await ctx.close();
});

test("08 — device dashboard tab", async ({ page }) => {
  await openIde(page);
  await toMode(page, "Configurazione");
  await configTab(page, /^Device$/);
  await page.screenshot({ path: path.join(SHOTS, "08_device_tab.png") });
});

test("09 — bar chart widget on canvas", async ({ page }) => {
  await openIde(page);
  await toMode(page, "Editor");
  const display = page.locator("button", { hasText: /^Display$/ }).first();
  if (await display.isVisible().catch(() => false)) {
    const expanded = await display.getAttribute("aria-expanded");
    if (expanded === "false") await display.click();
    await page.waitForTimeout(300);
  }
  const bar = page.getByRole("button", { name: /Istogramma|Bar Chart/i }).first();
  if (await bar.isVisible().catch(() => false)) {
    await bar.click();
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: path.join(SHOTS, "09_widget_bar_chart.png") });
});

test("10 — runtime / package builder tab", async ({ page }) => {
  await openIde(page);
  await toMode(page, "Configurazione");
  await configTab(page, /^Runtime$/);
  await page.screenshot({ path: path.join(SHOTS, "10_package_builder.png") });
});
