import { expect } from "@playwright/test";
import { test, authHeaders, ensureLoggedIn } from "./fixtures";
import { ADMIN } from "./_env";

/**
 * Il bersaglio di T-50, dall'inizio alla fine: si chiede un bottone MQTT in
 * chat, si applica la proposta, si annulla, si salva.
 *
 * # Perché esiste
 *
 * Ogni pezzo ha i suoi test — il validatore, la ricostruzione dei blocchi SSE,
 * la transazione dello store. Nessuno di quei test avrebbe preso i tre difetti
 * veri trovati la notte del 2026-08-31, perché nascono tutti **fra** i pezzi:
 *
 *   * il diff dichiarava modificati 46 oggetti su 47, perché l'API serve la
 *     pagina nell'ordine di chiavi dello YAML e la proposta in quello della
 *     struct Rust;
 *   * Salva scriveva la sorgente e perdeva il tag, perché due PUT concorrenti
 *     su `project.yaml` si cancellano a vicenda;
 *   * dopo l'applicazione il diff spariva, perché si ricalcolava contro lo
 *     stato nuovo.
 *
 * # Come si lancia
 *
 * Serve un runtime avviato con l'**agente finto**, altrimenti il test
 * chiamerebbe il modello vero: risposta diversa a ogni giro, e un test che
 * dipende da un modello non è un test.
 *
 *     SWS_AI_FAKE=$PWD/sws-runtime/crates/sws-web/tests/ai/luce-mqtt.json \
 *       ./scripts/start_editor.sh --instance 3
 *     cd sws-editor && SWS_E2E_ADMIN=http://localhost:8464 \
 *       npx playwright test e2e/chat-ai.spec.ts
 *
 * Senza `SWS_AI_FAKE` il test si salta da solo invece di fallire: un rosso che
 * dipende da come è avviato il runtime insegna solo a ignorare i rossi.
 */

const BASE = `${ADMIN}/`;
const PROGETTO = "e2e-chat-ai";

test("dalla chat al bottone MQTT sul disco", async ({ page, request }) => {
  // Progetto pulito da un template che ha la pagina «Indicatori».
  await request.post(`${BASE}api/projects`, {
    data: { name: PROGETTO, template: "demo-items-web" },
  });
  await request.post(`${BASE}api/projects/${PROGETTO}/open`);
  const headers = await authHeaders(request);

  await page.goto(BASE, { waitUntil: "networkidle" });
  await ensureLoggedIn(page);
  await page.waitForTimeout(1000);

  // ── La chat è accesa? ──────────────────────────────────────────────────
  await page.getByRole("button", { name: "☰" }).click();
  await page.getByRole("button", { name: /Assistente IA/ }).click();
  const composizione = page.getByPlaceholder(/Scrivi qui/);
  await expect(composizione).toBeVisible();

  const intestazione = page.locator("aside").last();
  if (!(await intestazione.innerText()).includes("finto")) {
    test.skip(true, "runtime avviato senza SWS_AI_FAKE: il copione non c'è");
  }

  // ── Chiedi ─────────────────────────────────────────────────────────────
  await composizione.fill(
    "aggiungi alla pagina Indicatori un bottone che accende e spegne la luce " +
    "del salotto — è su MQTT, broker 192.168.1.50");
  await composizione.press("Enter");

  const applica = page.getByRole("button", { name: "Applica", exact: true });
  await applica.waitFor({ state: "visible", timeout: 30_000 });

  // ── Il diff dice le tre cose, e SOLO quelle ────────────────────────────
  const carta = await intestazione.innerText();
  expect(carta).toContain("tag `luce.salotto`");
  expect(carta).toContain("sorgente `broker-casa`");
  expect(carta).toContain("button `btn_luce_salotto` in «Indicatori»");
  // Il difetto del diff rumoroso: 46 righe `~` su una proposta che aggiunge un
  // bottone. Qui non deve comparirne nessuna.
  expect(carta.split("\n").filter((r) => r.trim().startsWith("~"))).toHaveLength(0);

  // ── Applica: nell'editor, non su disco ─────────────────────────────────
  await applica.click();
  await expect(intestazione).toContainText("Applicata", { timeout: 5_000 });
  await expect(page.locator("text=Luce salotto").first()).toBeVisible();

  const suDisco = async () => {
    const pr = await (await request.get(`${BASE}api/project`, { headers })).json();
    const pg = await (await request.get(`${BASE}api/synoptics/Indicatori`, { headers })).json();
    return {
      tag: (pr.tags ?? []).some((t: { id: string }) => t.id === "luce.salotto"),
      sorgente: (pr.sources ?? []).some((x: { id: string }) => x.id === "broker-casa"),
      bottone: (pg.objects ?? []).some((o: { id: string }) => o.id === "btn_luce_salotto"),
    };
  };
  expect(await suDisco()).toEqual({ tag: false, sorgente: false, bottone: false });

  // ── Salva: tutte e tre le cose, non due su tre ─────────────────────────
  await page.getByRole("button", { name: /non salvato/ }).click();
  await page.waitForTimeout(2500);
  expect(await suDisco()).toEqual({ tag: true, sorgente: true, bottone: true });

  // ── Un solo annullamento riporta indietro tutto ────────────────────────
  await page.getByRole("button", { name: /Annulla/ }).first().click();
  await page.waitForTimeout(500);
  await expect(page.locator("text=Luce salotto")).toHaveCount(0);
});
