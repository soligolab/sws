import { test, expect } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regression test per GitHub issue #2 — "variable definition and database are
 * missing" dopo export → nuovo progetto vuoto → import ZIP.
 *
 * La causa radice NON era il backend (export/import preservano tutto) ma la UI:
 * l'<input type=file> dell'import progetto viveva dentro il dropdown del menu,
 * che si chiude (setOpen(false)) sullo stesso click che apre il file-dialog.
 * React smontava l'input prima che l'utente scegliesse il file → l'onChange non
 * scattava mai → l'import non partiva. Questo test guida la UI reale (apri menu,
 * clicca "Importa progetto", scegli il file) e verifica che i tag compaiano.
 *
 * Gira contro il runtime admin su :8444 (no-auth dev). Self-contained: crea un
 * progetto sorgente con un tag, ne esporta lo ZIP, poi importa in un progetto
 * vuoto attraverso il menu.
 */
const BASE = "https://localhost:8444/";

test("import progetto via menu fa comparire i tag (issue #2)", async ({ page, request }) => {
  // 1. Prepara un progetto sorgente con un tag e ne esporta lo ZIP.
  await request.post(`${BASE}api/projects`, { data: { name: "e2e-src" } });
  await request.post(`${BASE}api/projects/e2e-src/open`);
  await request.put(`${BASE}api/project/tags`, {
    data: [{ id: "pippo", description: "test1", data_type: "float", history: true }],
  });
  const zipResp = await request.get(`${BASE}api/project/export`);
  expect(zipResp.ok()).toBeTruthy();
  const zipDir = mkdtempSync(join(tmpdir(), "sws-e2e-"));
  const zipPath = join(zipDir, "export.zip");
  writeFileSync(zipPath, await zipResp.body());

  // 2. Crea un progetto vuoto e aprilo (stato di partenza del reporter).
  await request.post(`${BASE}api/projects`, { data: { name: "e2e-dst" } });
  await request.post(`${BASE}api/projects/e2e-dst/open`);

  page.on("dialog", (d) => d.accept());

  // Pin the UI language to Italian so the (Italian) selectors below match
  // regardless of the test browser's locale (i18n, T-39).
  await page.addInitScript(() => { try { localStorage.setItem("sws.uiLang", "it"); } catch {} });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // 3. Importa via menu: ☰ Menu → Importa progetto → scegli ZIP.
  await page.getByRole("button", { name: /Menu/ }).first().click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /Importa progetto/ }).click(),
  ]);
  await chooser.setFiles(zipPath);
  await page.waitForTimeout(2500);

  // 4. Il progetto attivo ora è "test" con il tag "pippo".
  const proj = await page.evaluate(async () => {
    const r = await fetch("/api/project");
    const j = await r.json();
    return { tags: (j.tags || []).map((t: any) => t.id) };
  });
  expect(proj.tags).toContain("pippo");

  // 5. Configurazione → Variabili mostra il tag nel DOM (navigazione via UI).
  await page.getByRole("button", { name: /^Configurazione$/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Variabili$/ }).click();
  await page.waitForTimeout(800);
  await expect(page.locator('input[value="pippo"]').first()).toBeVisible();

  rmSync(zipDir, { recursive: true, force: true });
});
