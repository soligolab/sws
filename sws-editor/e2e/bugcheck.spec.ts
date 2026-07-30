import { test, expect, ensureLoggedIn } from "./fixtures";
import { ADMIN } from "./_env";
test.use({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });

test("bug1: click object does not blank the page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${ADMIN}/`, { waitUntil: "networkidle" });
  await ensureLoggedIn(page);
  await page.waitForTimeout(800);
  const apri = page.getByRole("button", { name: /^Apri/ }).first();
  if (await apri.isVisible({ timeout: 1500 }).catch(() => false)) { await apri.click(); await page.waitForTimeout(1000); }
  await page.getByRole("button", { name: /^Editor$/ }).first().click();
  await page.waitForTimeout(800);
  // click somewhere on the canvas objects area (an SVG <g> / rect)
  const rect = page.locator("svg rect").nth(3);
  await rect.click({ force: true }).catch(() => {});
  await page.waitForTimeout(800);
  // page must still show the editor shell (menu present), not a blank crash
  const menuVisible = await page.locator('button:has-text("☰")').first().isVisible().catch(() => false);
  console.log("MENU after click:", menuVisible, "| pageerrors:", errors.length, errors.slice(0,2));
  expect(menuVisible).toBe(true);
  expect(errors.join(" ")).not.toContain("Maximum update depth");
});

test("bug2: new empty project has empty canvas", async ({ page, request }) => {
  // create empty project via API and a fresh page load into it
  await request.post(`${ADMIN}/api/projects`, { data: { name: "empty-check" } });
  await request.post(`${ADMIN}/api/projects/empty-check/open`);
  await page.goto(`${ADMIN}/`, { waitUntil: "networkidle" });
  await ensureLoggedIn(page);
  await page.waitForTimeout(1000);
  const apri = page.getByRole("button", { name: /^Apri/ }).first();
  if (await apri.isVisible({ timeout: 1500 }).catch(() => false)) { await apri.click(); await page.waitForTimeout(1000); }
  await page.getByRole("button", { name: /^Editor$/ }).first().click();
  await page.waitForTimeout(800);
  // empty project → the "no objects" empty-state or zero object rows
  const pageObjects = await page.evaluate(() => {
    const svg = document.querySelector("svg");
    return svg ? svg.querySelectorAll("g[data-obj], rect").length : -1;
  });
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log("empty project svg shapes:", pageObjects, "| has HA content:", bodyText.includes("PANORAMICA") || bodyText.includes("FOTOVOLTAICO"));
  expect(bodyText).not.toContain("FOTOVOLTAICO");
});
