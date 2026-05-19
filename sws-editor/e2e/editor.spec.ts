import { test, expect, type Page } from "@playwright/test";

/**
 * Golden-path editor flow:
 *   1. Login as admin (dev.sh seeds the credentials).
 *   2. Skip the WelcomeScreen (open the existing dev project) — when dev.sh
 *      runs with --project it auto-opens, so this usually no-ops.
 *   3. Add a rectangle via the palette.
 *   4. Save the project ("Salva tutto" in the hamburger menu).
 *   5. Reload the page.
 *   6. Verify the rectangle survived the round-trip.
 *
 * Selectors prefer roles + text so they survive cosmetic changes. The
 * canvas itself is a single <svg>; we count `<rect>` children with the
 * fill colour the rect-default uses (`#3b82f6`) to spot test artefacts
 * vs the page-boundary indicator (which is stroke-only).
 */

async function login(page: Page, username = "admin", password = "admin") {
  await page.goto("/");
  // The login form's password input has autofocus + placeholder labels via
  // <label>. We address it by autocomplete attribute (already in source).
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  await expect(passwordInput).toBeVisible();
  const userInput = page.locator('input[autocomplete="username"]');
  await userInput.fill(username);
  await passwordInput.fill(password);
  await page.getByRole("button", { name: /Accedi/i }).click();
  // After login the header shows the user pill. Wait for the editor shell.
  await expect(page.locator('button:has-text("☰ Menu")')).toBeVisible({ timeout: 15_000 });
}

async function openProjectFromWelcomeIfNeeded(page: Page) {
  // WelcomeScreen only renders when no project is active. dev.sh auto-opens
  // .run/projects/dev — but a fresh clone can land here. Try the first
  // "Apri" button if visible; otherwise no-op.
  const openBtn = page.getByRole("button", { name: /^Apri$/i }).first();
  if (await openBtn.isVisible().catch(() => false)) {
    await openBtn.click();
    await expect(page.locator('button:has-text("☰ Menu")')).toBeVisible({ timeout: 15_000 });
  }
}

async function ensureEditMode(page: Page) {
  // The app boots in edit mode; if a previous test left it in runtime mode
  // the header shows "Modifica" → click to flip back.
  const editBtn = page.getByRole("button", { name: /^Modifica$/i });
  if (await editBtn.isVisible().catch(() => false)) {
    await editBtn.click();
  }
}

async function addRect(page: Page) {
  // The "Forme" palette group is open by default and contains a "Rettangolo"
  // button. Click it once to spawn a default rect on the current page.
  await page.getByRole("button", { name: /Rettangolo/i }).first().click();
}

function blueRectsLocator(page: Page) {
  // The rect default fill is `#3b82f6` (palette blue). Page-boundary
  // indicator is stroke-only, so it has fill="none" and won't match.
  return page.locator('svg rect[fill="#3b82f6"]');
}

async function saveAll(page: Page) {
  await page.locator('button:has-text("☰ Menu")').click();
  await page.getByRole("button", { name: /^Salva tutto$/i }).click();
  // The button label flips to "✓ Salvato" briefly. Don't assert on it —
  // just wait for the dropdown to close (avoids race with the next action).
  await expect(page.locator('button:has-text("☰ Menu")')).toBeVisible();
}

test.describe("editor golden path", () => {
  test("login → add rect → save → reload preserves the rect", async ({ page }) => {
    await login(page);
    await openProjectFromWelcomeIfNeeded(page);
    await ensureEditMode(page);

    const before = await blueRectsLocator(page).count();
    await addRect(page);
    await expect.poll(() => blueRectsLocator(page).count()).toBe(before + 1);

    await saveAll(page);

    // Wait a beat for the save POST to complete server-side before reload.
    // We can detect this via the saveStatus → "ok" header chip; we approximate
    // with a 1s wait, which is more than enough on a local box.
    await page.waitForTimeout(1500);

    await page.reload();
    // Editor remounts — wait for the menu button again.
    await expect(page.locator('button:has-text("☰ Menu")')).toBeVisible({ timeout: 15_000 });
    await ensureEditMode(page);

    // The rect we added should still be on the page.
    await expect.poll(() => blueRectsLocator(page).count()).toBeGreaterThanOrEqual(before + 1);
  });

  test("login form shows error on wrong password", async ({ page }) => {
    await page.goto("/");
    const passwordInput = page.locator('input[autocomplete="current-password"]');
    await expect(passwordInput).toBeVisible();
    await page.locator('input[autocomplete="username"]').fill("admin");
    await passwordInput.fill("definitely-wrong-password");
    await page.getByRole("button", { name: /Accedi/i }).click();
    await expect(page.getByText(/Credenziali non valide/)).toBeVisible({ timeout: 10_000 });
  });
});
