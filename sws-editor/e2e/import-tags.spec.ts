import { expect } from "@playwright/test";
import { test, authHeaders, ensureLoggedIn } from "./fixtures";
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
import { ADMIN } from "./_env";
const BASE = `${ADMIN}/`;

test("import progetto via menu fa comparire i tag (issue #2)", async ({ page, request }) => {
  // 1. Prepara un progetto sorgente con un tag e ne esporta lo ZIP.
  //    Creazione e apertura sono pre-auth; il token si chiede DOPO l'apertura,
  //    perché aprire un progetto invalida le sessioni.
  await request.post(`${BASE}api/projects`, { data: { name: "e2e-src" } });
  await request.post(`${BASE}api/projects/e2e-src/open`);
  const headers = await authHeaders(request);
  await request.put(`${BASE}api/project/tags`, {
    data: [{ id: "pippo", description: "test1", data_type: "float", history: true }],
    headers,
  });
  const zipResp = await request.get(`${BASE}api/project/export`, { headers });
  expect(zipResp.ok()).toBeTruthy();
  const zipDir = mkdtempSync(join(tmpdir(), "sws-e2e-"));
  const zipPath = join(zipDir, "export.zip");
  writeFileSync(zipPath, await zipResp.body());

  // 2. Crea un progetto vuoto e aprilo (stato di partenza del reporter).
  await request.post(`${BASE}api/projects`, { data: { name: "e2e-dst" } });
  await request.post(`${BASE}api/projects/e2e-dst/open`);

  page.on("dialog", (d) => d.accept());

  await page.goto(BASE, { waitUntil: "networkidle" });
  await ensureLoggedIn(page);
  await page.waitForTimeout(1000);

  // 3. Importa via menu: ☰ Menu → "Sostituisci da copia sul PC…" → scegli ZIP.
  await page.getByRole("button", { name: /Menu/ }).first().click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    // Filtro esatto: da quando esiste anche "💾 Salva copia sul PC…" un filtro
    // su /copia sul PC/ ne trovava due e Playwright rifiutava l'ambiguità.
    page.getByRole("button", { name: /Sostituisci da copia sul PC/ }).click(),
  ]);
  await chooser.setFiles(zipPath);
  await page.waitForTimeout(2500);

  // 4. Il progetto attivo ora è "test" con il tag "pippo".
  // Si legge dal contesto API autenticato e NON con un `fetch` dentro la pagina:
  // quel fetch non porta il token che la SPA aggiunge da sé in `api/client.ts`,
  // quindi rispondeva 401 e la lista dei tag risultava vuota — il test falliva
  // per come guardava, non per ciò che guardava. Il token si richiede ora perché
  // l'import ha riaperto un progetto, invalidando quello di prima.
  const after = await request.get(`${BASE}api/project`, { headers: await authHeaders(request) });
  expect(after.ok()).toBeTruthy();
  const tagIds = ((await after.json()).tags ?? []).map((t: any) => t.id);
  expect(tagIds).toContain("pippo");

  // 5. Configurazione → Variabili mostra il tag nel DOM (navigazione via UI).
  await page.getByRole("button", { name: /^Configurazione$/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Variabili$/ }).click();
  await page.waitForTimeout(800);
  await expect(page.locator('input[value="pippo"]').first()).toBeVisible();

  rmSync(zipDir, { recursive: true, force: true });
});
