import { expect } from "@playwright/test";
import { test, ensureLoggedIn, authHeaders, modelloDellaChat } from "./fixtures";
import { ADMIN } from "./_env";

/**
 * Il banco fisso dei tubi d'acciaio (piano 2026-11-10-assistente-secondo-giro,
 * G1): dalla richiesta in chat alla pagina «Linea» su disco, con i cinque
 * simboli disegnati, il tipo e i tubi dell'acqua.
 *
 * # Come si lancia
 *
 * Non a mano: `./scripts/banco_tubi.sh` copia il progetto di prova
 * (`tests/fixtures/ai-bench/tubi-acciaio/`) in `sws/tmp/banco-tubi/`, avvia un
 * IDE usa e getta e lo spegne alla fine. Due modi:
 *
 *   - `--finto` (predefinito): l'agente finto rigioca `sinottico-tubi.json`.
 *     Il test controlla il diff, Applica e Salva — è la prova deterministica;
 *   - `--vero`: il modello vero, a pagamento. Il test fa la persona: manda la
 *     richiesta, dopo le bozze risponde «procedi», applica e salva quando
 *     arriva la proposta, e lascia in `SWS_BANCO_DIR` la foto della pagina. Il
 *     resoconto (giri, token, costo, minuti) lo scrive il runtime
 *     (`SWS_AI_MISURE`). Il giudizio da 1 a 5 resta del maintainer.
 */

const PROGETTO = "banco-tubi";
const VERO = process.env.SWS_AI_VERO === "1";
const RICHIESTA =
  "Disegna nella pagina Linea il sinottico di una linea per tubi d'acciaio saldati, da sinistra a destra: " +
  "aspo svolgitore, raddrizzatrice, gabbia di formatura, saldatrice HF, rulliera, forno di ricottura, sega volante. " +
  "Sopra la linea il carroponte, in basso a destra il quadro elettrico. La saldatrice è raffreddata ad acqua: " +
  "serbatoio e pompa col tubo fino alla saldatrice. Ogni macchina ha marcia, allarme e velocità in m/min.";
const PROCEDI = "Le bozze vanno bene, procedi con la proposta della pagina intera.";

test("il banco dei tubi: dalla chat alla pagina Linea su disco", async ({ page, request }) => {
  test.setTimeout(VERO ? 45 * 60_000 : 120_000);
  if (!VERO && !(process.env.SWS_AI_FAKE ?? "").includes("sinottico-tubi")) {
    test.skip(true, "serve il runtime di scripts/banco_tubi.sh (SWS_AI_FAKE anche qui)");
  }

  let headers = await authHeaders(request);
  await request.post(`${ADMIN}/api/projects/${PROGETTO}/open`, { headers });
  headers = await authHeaders(request);
  await page.addInitScript(() => {
    try { localStorage.setItem("sws.chatPanel.open", "1"); } catch { /* storage negato */ }
  });
  await page.goto(`${ADMIN}/`, { waitUntil: "networkidle" });
  await ensureLoggedIn(page);
  await page.waitForTimeout(1500);
  const scheda = page.getByRole("button", { name: new RegExp(PROGETTO) }).first();
  if (await scheda.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await scheda.click();
    await page.waitForTimeout(2000);
  }

  const composizione = page.getByPlaceholder(/Scrivi qui/);
  await expect(composizione).toBeVisible();
  const chat = page.locator("aside").filter({ has: composizione }).last();
  const modello = await modelloDellaChat(chat);
  if (VERO) expect(modello).not.toMatch(/finto|nessuna chiave/i);
  else expect(modello).toMatch(/finto/i);

  await composizione.fill(RICHIESTA);
  await composizione.press("Enter");

  const applica = chat.getByRole("button", { name: "Applica", exact: true });
  if (VERO) {
    // La persona: quando il turno finisce senza proposta (dopo le bozze il
    // giro si ferma apposta) risponde «procedi», al più tre volte.
    let risposte = 0;
    const fine = Date.now() + 40 * 60_000;
    while (!(await applica.isVisible())) {
      expect(Date.now(), "nessuna proposta in 40 minuti").toBeLessThan(fine);
      await page.waitForTimeout(10_000);
      // Il turno è finito quando «Manda» torna «Manda»: le righe degli
      // strumenti restano in chat e non dicono niente su adesso.
      const lavora = await chat.getByRole("button", { name: /Sto lavorando/ }).count();
      if (lavora === 0 && !(await applica.isVisible())) {
        expect(risposte, "tre «procedi» senza una proposta").toBeLessThan(3);
        await composizione.fill(PROCEDI);
        await composizione.press("Enter");
        risposte++;
        await page.waitForTimeout(5_000);
      }
    }
  } else {
    await applica.waitFor({ state: "visible", timeout: 60_000 });
    const carta = await chat.innerText();
    for (const nome of ["Aspo svolgitore", "Raddrizzatrice", "Gabbia di formatura", "Saldatrice HF", "Sega volante"]) {
      expect(carta).toContain(nome);
    }
    expect(carta).toContain("macchina_linea");
  }

  await applica.click();
  await expect(chat).toContainText("Applicata", { timeout: 10_000 });
  await page.getByRole("button", { name: /non salvato/ }).click();
  await page.waitForTimeout(3000);

  const pr = await (await request.get(`${ADMIN}/api/project`, { headers })).json();
  const pg = await (await request.get(`${ADMIN}/api/synoptics/linea`, { headers })).json();
  const oggetti: Array<{ type: string; symbol_id?: string }> = pg.objects ?? [];
  const prj = oggetti.filter((o) => o.symbol_id?.startsWith("prj:")).length;
  const lib = oggetti.filter((o) => o.symbol_id?.startsWith("lib:")).length;
  const tubi = oggetti.filter((o) => o.type === "pipe").length;

  const dir = process.env.SWS_BANCO_DIR;
  if (dir) {
    // La pagina intera nella foto, non lo spicchio che il canvas mostra.
    await page.getByRole("button", { name: /Adatta pagina/ }).click().catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/pagina.png`, fullPage: true });
  }
  if (VERO) {
    if (dir) {
      const fs = await import("node:fs");
      fs.writeFileSync(`${dir}/conteggi.json`, JSON.stringify({
        simboli_nuovi: (pr.simboli ?? []).length, oggetti: oggetti.length, prj, lib, tubi,
        tipi: (pr.types ?? []).map((t: { id: string }) => t.id),
      }, null, 2));
    }
    expect(prj + lib, "la pagina ha delle macchine").toBeGreaterThan(5);
  } else {
    expect((pr.simboli ?? []).length).toBe(5);
    expect((pr.types ?? []).some((t: { id: string }) => t.id === "macchina_linea")).toBe(true);
    expect({ prj, lib, tubi }).toEqual({ prj: 5, lib: 6, tubi: 2 });
  }
});
