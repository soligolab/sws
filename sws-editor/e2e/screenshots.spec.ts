/**
 * Screenshot capture spec for SWS manual documentation.
 * Saves PNG files to docs/manual/screenshots/.
 *
 * Run:
 *   cd sws-editor
 *   npx playwright test e2e/screenshots.spec.ts --config playwright.config.ts
 */

import { test, type Page } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SHOTS = path.join(__dirname, "..", "..", "docs", "manual", "screenshots");

const ADMIN_URL = "http://localhost:5173/index-admin.html";

async function loginAndOpenProject(page: Page) {
  await page.goto(ADMIN_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // Step 1: if we see a top-level login form (rare), fill and submit it
  const userInput = page.locator('input[autocomplete="username"]');
  if (await userInput.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await userInput.fill("admin");
    await page.locator('input[autocomplete="current-password"]').fill("admin");
    await page.getByRole("button", { name: /Accedi/i }).click();
    await page.waitForTimeout(800);
  }

  // Step 2: WelcomeScreen — click "Apri →" on the first project
  const apriBtn = page.locator("text=Apri").first();
  if (await apriBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await apriBtn.click();
    await page.waitForTimeout(1000);
  }

  // Step 3: after Apri, a per-project login form may appear (modal auth)
  const pwInput = page.locator('input[autocomplete="current-password"]');
  if (await pwInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
    // Username may already be pre-filled; just fill the password
    const userField = page.locator('input[autocomplete="username"]');
    if (await userField.isVisible({ timeout: 500 }).catch(() => false)) {
      const existing = await userField.inputValue().catch(() => "");
      if (!existing) await userField.fill("admin");
    }
    await pwInput.fill("admin");
    await page.getByRole("button", { name: /Accedi/i }).click();
    await page.waitForTimeout(800);
  }

  // Wait for the main editor shell to appear
  await page.waitForSelector('button:has-text("☰ Menu")', { timeout: 20_000 });
}

async function toEditMode(page: Page) {
  const btn = page.getByRole("button", { name: /^Modifica$/i });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(500);
  }
}

test.use({
  baseURL: "http://localhost:5173",
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});

test("01 — login screen", async ({ page }) => {
  await page.goto("http://localhost:5173/index-admin.html");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, "01_login.png") });
});

test("02 — editor main", async ({ page }) => {
  await loginAndOpenProject(page);
  await toEditMode(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, "02_editor_main.png") });
});

test("03 — left panel widget palette", async ({ page }) => {
  await loginAndOpenProject(page);
  await toEditMode(page);
  // Ensure left panel is visible; expand Display group if collapsed
  const displayBtn = page.locator("button", { hasText: /^Display$/ }).first();
  if (await displayBtn.isVisible().catch(() => false)) {
    const isExpanded = await displayBtn.getAttribute("aria-expanded");
    if (isExpanded === "false") await displayBtn.click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(SHOTS, "03_left_panel.png") });
});

test("04 — runtime mode (live tags)", async ({ page }) => {
  await loginAndOpenProject(page);
  // Switch to runtime mode
  const runtimeBtn = page.getByRole("button", { name: /^Runtime$/ });
  if (await runtimeBtn.isVisible().catch(() => false)) {
    await runtimeBtn.click();
    await page.waitForTimeout(1800);
  }
  await page.screenshot({ path: path.join(SHOTS, "04_runtime_mode.png") });
});

test("05 — configurazione tab", async ({ page }) => {
  await loginAndOpenProject(page);
  const cfgBtn = page.getByRole("button", { name: /Configurazione/i }).first();
  if (await cfgBtn.isVisible().catch(() => false)) {
    await cfgBtn.click();
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: path.join(SHOTS, "05_config_view.png") });
});

test("06 — alarms tab in config", async ({ page }) => {
  await loginAndOpenProject(page);
  const cfgBtn = page.getByRole("button", { name: /Configurazione/i }).first();
  if (await cfgBtn.isVisible().catch(() => false)) {
    await cfgBtn.click();
    await page.waitForTimeout(800);
  }
  const alarmsTab = page.getByRole("button", { name: /Allar/i }).first();
  if (await alarmsTab.isVisible().catch(() => false)) {
    await alarmsTab.click();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: path.join(SHOTS, "06_alarms_tab.png") });
});

test("07 — operator viewer (port 8443)", async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const vp = await ctx.newPage();
  await vp.goto("https://localhost:8443/", { waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
  await vp.waitForTimeout(1500);
  await vp.screenshot({ path: path.join(SHOTS, "07_viewer_8443.png") });
  await ctx.close();
});

test("08 — device dashboard tab", async ({ page }) => {
  await loginAndOpenProject(page);
  const cfgBtn = page.getByRole("button", { name: /Configurazione/i }).first();
  if (await cfgBtn.isVisible().catch(() => false)) {
    await cfgBtn.click();
    await page.waitForTimeout(800);
  }
  const devTab = page.getByRole("button", { name: /^Device$/ }).first();
  if (await devTab.isVisible().catch(() => false)) {
    await devTab.click();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: path.join(SHOTS, "08_device_tab.png") });
});

test("09 — bar chart widget on canvas", async ({ page }) => {
  await loginAndOpenProject(page);
  await toEditMode(page);
  // Add a bar chart via the palette
  const btn = page.getByRole("button", { name: /Istogramma|Bar Chart/i }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: path.join(SHOTS, "09_widget_bar_chart.png") });
});

test("10 — package builder in runtime tab", async ({ page }) => {
  await loginAndOpenProject(page);
  const cfgBtn = page.getByRole("button", { name: /Configurazione/i }).first();
  if (await cfgBtn.isVisible().catch(() => false)) {
    await cfgBtn.click();
    await page.waitForTimeout(800);
  }
  // Click Runtime tab
  const rtTab = page.getByRole("button", { name: /^Runtime$/ }).first();
  if (await rtTab.isVisible().catch(() => false)) {
    await rtTab.click();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: path.join(SHOTS, "10_package_builder.png") });
});
