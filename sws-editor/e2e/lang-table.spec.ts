/**
 * T-40 round-trip: language table + {{token}} resolution in the viewer.
 * Requires a running runtime (with the /api/project/languages route) on 8444/8443.
 *   npx playwright test e2e/lang-table.spec.ts --project=chromium
 */
import { test, expect, request as pwRequest } from "@playwright/test";

const ADMIN = "https://localhost:8444";
const VIEWER = "https://localhost:8443";

test.use({ ignoreHTTPSErrors: true, viewport: { width: 1200, height: 800 } });

test("PUT languages persists + viewer resolves {{token}} on lang switch", async ({ page }) => {
  const api = await pwRequest.newContext({ ignoreHTTPSErrors: true });

  // 1. Fresh project with a text object using a {{token}}.
  await api.post(`${ADMIN}/api/projects`, { data: { name: "lang-e2e" } });
  await api.post(`${ADMIN}/api/projects/lang-e2e/open`);
  // language table: it/en, token "greet"
  const table = {
    default: "it",
    langs: ["it", "en"],
    entries: [{ key: "greet", values: { it: "Ciao mondo", en: "Hello world" } }],
  };
  const put = await api.put(`${ADMIN}/api/project/languages`, { data: table });
  expect(put.status()).toBe(204);

  // Verify it persisted.
  const proj = await (await api.get(`${ADMIN}/api/project`)).json();
  expect(proj.languages?.entries?.[0]?.key).toBe("greet");

  // Create a page with a text object referencing the token.
  await api.put(`${ADMIN}/api/synoptics/Home`, {
    data: {
      id: "Home", name: "Home", width: 800, height: 480, background: "#0f172a",
      objects: [{ id: "t1", type: "text", x: 40, y: 60, text: "{{greet}}", font_size: 28, color: "#e2e8f0" }],
    },
  }).catch(() => {});

  // 2. Viewer with projectLang=it → shows "Ciao mondo".
  await page.addInitScript(() => { try { localStorage.setItem("sws.projectLang", "it"); } catch {} });
  await page.goto(`${VIEWER}/`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1500);
  const bodyIt = await page.evaluate(() => document.body.innerText);
  console.log("VIEWER it:", bodyIt.includes("Ciao mondo"), "| raw token:", bodyIt.includes("{{greet}}"));
  expect(bodyIt).toContain("Ciao mondo");

  // 3. Fresh page with projectLang=en → shows "Hello world".
  const page2 = await (await page.context().browser()!.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1200, height: 800 } })).newPage();
  await page2.addInitScript(() => { try { localStorage.setItem("sws.projectLang", "en"); } catch {} });
  await page2.goto(`${VIEWER}/`, { waitUntil: "networkidle" }).catch(() => {});
  await page2.waitForTimeout(1500);
  const bodyEn = await page2.evaluate(() => document.body.innerText);
  console.log("VIEWER en:", bodyEn.includes("Hello world"));
  expect(bodyEn).toContain("Hello world");

  await api.dispose();
});
