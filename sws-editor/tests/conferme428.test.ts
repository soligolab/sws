/** F2: la catena di conferme dopo un 428 del deploy, una sola per i tre
 *  percorsi (testata, Connessione, Dispositivi). */
import { describe, it, expect, afterEach } from "vitest";
import "../src/i18n/index";
import { confermaDopo428, NESSUNA_CONFERMA } from "../src/store/conferme428";
import { rispondi } from "../src/finestraAvviso/finestraAvviso";

let r: ReturnType<typeof rispondi> | null = null;
afterEach(() => { r?.ferma(); r = null; });

describe("confermaDopo428", () => {
  it("ogni conferma data aggiunge il suo flag, e solo quello", async () => {
    r = rispondi(true);
    expect(await confermaDopo428({ conferma: "simboli-mancanti", simboli: ["lib:a/b"] }, NESSUNA_CONFERMA))
      .toEqual({ tipo: "riprova", conferme: { ...NESSUNA_CONFERMA, confirmMissingSymbols: true } });
    expect(await confermaDopo428({ conferma: "sostituisce-progetti", progetto: "x", progetti: [{ nome: "y" }] }, NESSUNA_CONFERMA))
      .toEqual({ tipo: "riprova", conferme: { ...NESSUNA_CONFERMA, confirmReplace: true } });
    expect(await confermaDopo428({ conferma: "utenti-vuoti", utenti_dispositivo: ["admin"] }, NESSUNA_CONFERMA))
      .toEqual({ tipo: "riprova", conferme: { ...NESSUNA_CONFERMA, confirmNoUsers: true } });
  });

  it("le domande che cancellano qualcosa sono pericolose, col titolo dove c'era il maiuscolo", async () => {
    r = rispondi(true);
    await confermaDopo428({ conferma: "sostituisce-progetti", progetti: [] }, NESSUNA_CONFERMA);
    await confermaDopo428({ conferma: "utenti-vuoti", utenti_dispositivo: ["admin"] }, NESSUNA_CONFERMA);
    const [sost, utenti] = r.chiamate as { pericolo?: boolean; titolo?: string; testo?: string }[];
    expect(sost.pericolo).toBe(true);
    expect(utenti.pericolo).toBe(true);
    expect(utenti.titolo).toBeTruthy();
    expect(utenti.testo).toContain("admin");
  });

  it("un no annulla senza toccare niente", async () => {
    r = rispondi(false);
    expect(await confermaDopo428({ conferma: "utenti-vuoti" }, NESSUNA_CONFERMA)).toEqual({ tipo: "annullato" });
  });

  it("serve-admin non si conferma: si dice, e il deploy si ferma", async () => {
    r = rispondi(false);
    expect(await confermaDopo428({ conferma: "serve-admin" }, NESSUNA_CONFERMA)).toEqual({ tipo: "serve-admin" });
    expect(r.chiamate).toHaveLength(1);
  });

  it("una conferma già data non si richiede: il 428 diventa un errore", async () => {
    r = rispondi(true);
    const gia = { ...NESSUNA_CONFERMA, confirmNoUsers: true };
    expect(await confermaDopo428({ conferma: "utenti-vuoti" }, gia)).toEqual({ tipo: "nessuna" });
    expect(r.chiamate).toHaveLength(0);
  });
});
