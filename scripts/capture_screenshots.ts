/**
 * SWS — Screenshot capture script per la documentazione.
 *
 * Cattura le schermate principali dell'interfaccia e le salva in
 * docs/manual/screenshots/.
 *
 * Prerequisiti:
 *   - dev.sh in esecuzione (runtime 8443/8444 + Vite 5173)
 *   - SWS_ADMIN_PASSWORD=admin (default dev)
 *
 * Esecuzione:
 *   cd sws-editor
 *   npx ts-node ../scripts/capture_screenshots.ts
 *   # oppure con playwright direttamente:
 *   npx playwright test --config=../scripts/screenshots.config.ts
 */

import { chromium, type Browser, type Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const BASE_URL = "http://localhost:5173";
const SCREENSHOTS_DIR = path.join(
  __dirname,
  "..",
  "docs",
  "manual",
  "screenshots"
);
const ADMIN_PASSWORD = process.env.SWS_ADMIN_PASSWORD ?? "admin";

async function login(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator('input[autocomplete="username"]').fill("admin");
  await page.locator('input[autocomplete="current-password"]').fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Accedi/i }).click();
  await page.waitForSelector('button:has-text("☰ Menu")', { timeout: 20_000 });
}

async function openDevProject(page: Page): Promise<void> {
  const openBtn = page.getByRole("button", { name: /^Apri$/i }).first();
  if (await openBtn.isVisible().catch(() => false)) {
    await openBtn.click();
    await page.waitForSelector('button:has-text("☰ Menu")', { timeout: 15_000 });
  }
}

async function ensureEditMode(page: Page): Promise<void> {
  const editBtn = page.getByRole("button", { name: /^Modifica$/i });
  if (await editBtn.isVisible().catch(() => false)) {
    await editBtn.click();
    await page.waitForTimeout(500);
  }
}

function screenshotPath(name: string): string {
  return path.join(SCREENSHOTS_DIR, name);
}

async function main(): Promise<void> {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const browser: Browser = await chromium.launch({
    headless: true,
    args: ["--ignore-certificate-errors", "--disable-web-security"],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  try {
    // ── 1. Login screen ──────────────────────────────────────────────────────
    console.log("01 — Login screen");
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: screenshotPath("01_login.png"),
      fullPage: false,
    });

    // ── 2. Editor main (post-login) ───────────────────────────────────────────
    console.log("02 — Editor main");
    await login(page);
    await openDevProject(page);
    await ensureEditMode(page);
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: screenshotPath("02_editor_main.png"),
      fullPage: false,
    });

    // ── 3. LeftPanel widget palette ───────────────────────────────────────────
    console.log("03 — LeftPanel widget palette");
    // Expand the Display group if not already expanded
    const displayGroup = page.getByRole("button", { name: /Display/i }).first();
    if (await displayGroup.isVisible().catch(() => false)) {
      await displayGroup.click();
      await page.waitForTimeout(300);
    }
    await page.screenshot({
      path: screenshotPath("03_left_panel.png"),
      fullPage: false,
    });

    // ── 4. Runtime viewer (switch to runtime mode) ────────────────────────────
    console.log("04 — Runtime mode (editor side)");
    const runtimeBtn = page.getByRole("button", { name: /^Runtime$/i });
    if (await runtimeBtn.isVisible().catch(() => false)) {
      await runtimeBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({
        path: screenshotPath("04_runtime_mode.png"),
        fullPage: false,
      });
      // Switch back to edit mode
      await ensureEditMode(page);
    }

    // ── 5. Configurazione tab ─────────────────────────────────────────────────
    console.log("05 — Configurazione tab");
    const configBtn = page.getByRole("button", { name: /Configurazione/i }).first();
    if (await configBtn.isVisible().catch(() => false)) {
      await configBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: screenshotPath("05_config_view.png"),
        fullPage: false,
      });
    }

    // ── 6. Add a bar chart widget ─────────────────────────────────────────────
    console.log("06 — Bar chart widget");
    // Navigate back to editor
    const editorBtn = page.getByRole("button", { name: /^Editor$/i }).first();
    if (await editorBtn.isVisible().catch(() => false)) {
      await editorBtn.click();
      await page.waitForTimeout(500);
    }
    await ensureEditMode(page);

    // Add bar chart
    const barChartBtn = page.getByRole("button", { name: /Bar Chart|Istogramma/i }).first();
    if (await barChartBtn.isVisible().catch(() => false)) {
      await barChartBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: screenshotPath("06_widget_bar_chart.png"),
        fullPage: false,
      });
    }

    // ── 7. Operator viewer (port 8443) ────────────────────────────────────────
    console.log("07 — Operator viewer (8443)");
    const viewerPage = await context.newPage();
    await viewerPage.goto("https://localhost:8443", {
      waitUntil: "networkidle",
      timeout: 15_000,
    }).catch(() => {});
    await viewerPage.waitForTimeout(2000);
    await viewerPage.screenshot({
      path: screenshotPath("07_viewer_8443.png"),
      fullPage: false,
    });
    await viewerPage.close();

    // ── 8. Device dashboard tab ───────────────────────────────────────────────
    console.log("08 — Device dashboard tab");
    const deviceTab = page.getByRole("button", { name: /Device|Dispositivi/i }).first();
    if (await deviceTab.isVisible().catch(() => false)) {
      await deviceTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: screenshotPath("08_device_tab.png"),
        fullPage: false,
      });
    }

    console.log("\n✅ Screenshot completati in:", SCREENSHOTS_DIR);
    console.log("File generati:");
    fs.readdirSync(SCREENSHOTS_DIR).forEach((f) => console.log(" -", f));
  } catch (err) {
    console.error("Errore durante la cattura:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
