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

  // 27-11-2026, plan 2026-11-27-cambio-di-nome-del-progetto: the panel has a
  // project with another name, and the user picks what the deploy does to it.
  it("two identities known and different: two answers, and the one picked goes back", async () => {
    r = rispondi((q: { tipo: string }) => (q.tipo === "scegli" ? "keep_users" : true));
    const d = { conferma: "sostituisce-progetti", progetto: "Casa (verticale)", progetti: [{ nome: "Casa", storico_byte: 1_600_000_000 }],
                scelte: ["keep_users", "delete_all"], erede: "Casa", stesso_impianto: false };
    expect(await confermaDopo428(d, NESSUNA_CONFERMA))
      .toEqual({ tipo: "riprova", conferme: { ...NESSUNA_CONFERMA, confirmReplace: true, replaceMode: "keep_users" } });
    const [q] = r.chiamate as { tipo: string; scelte: { valore: string; pericolo?: boolean }[]; testo: string }[];
    expect(q.tipo).toBe("scegli");
    expect(q.scelte.map((x) => x.valore)).toEqual(["keep_users", "delete_all"]);
    expect(q.scelte.every((x) => x.pericolo)).toBe(true);
    expect(q.testo).toContain("Casa");
    expect(q.testo).toContain("1600.0");
  });

  it("an identity missing: three answers, the first is «the same plant»", async () => {
    r = rispondi((q: { tipo: string }) => (q.tipo === "scegli" ? "same_plant" : true));
    const d = { conferma: "sostituisce-progetti", progetto: "Casa (verticale)", progetti: [{ nome: "Casa" }],
                scelte: ["same_plant", "keep_users", "delete_all"], erede: "Casa", stesso_impianto: null };
    expect(await confermaDopo428(d, NESSUNA_CONFERMA))
      .toEqual({ tipo: "riprova", conferme: { ...NESSUNA_CONFERMA, confirmReplace: true, replaceMode: "same_plant" } });
    const [q] = r.chiamate as { scelte: { valore: string; pericolo?: boolean }[] }[];
    expect(q.scelte.map((x) => x.valore)).toEqual(["same_plant", "keep_users", "delete_all"]);
    // Keeping everything is not a danger.
    expect(q.scelte[0].pericolo).toBe(false);
  });

  it("cancel on the choice touches nothing; an answer already given is not asked again", async () => {
    r = rispondi(null);
    const d = { conferma: "sostituisce-progetti", progetti: [{ nome: "Casa" }], scelte: ["keep_users", "delete_all"], erede: "Casa" };
    expect(await confermaDopo428(d, NESSUNA_CONFERMA)).toEqual({ tipo: "annullato" });
    r.ferma();
    r = rispondi(true);
    const gia = { ...NESSUNA_CONFERMA, confirmReplace: true, replaceMode: "delete_all" as const };
    expect(await confermaDopo428(d, gia)).toEqual({ tipo: "nessuna" });
    expect(r.chiamate).toHaveLength(0);
  });

  it("a panel that cannot rename its project: said as an error, nothing is sent", async () => {
    r = rispondi(undefined);
    expect(await confermaDopo428({ conferma: "plant-identity-unsupported" }, NESSUNA_CONFERMA)).toEqual({ tipo: "annullato" });
    expect((r.chiamate[0] as { livello?: string }).livello).toBe("errore");
  });
});

describe("«same plant» with «Replace users too» on (collaudo of the dev.4, 27-11-2026)", () => {
  it("says that the users come from the project, so the users question after it does not contradict it", async () => {
    const { testoSceltaImpianto } = await import("../src/store/conferme428");
    const base = { conferma: "sostituisce-progetti", progetto: "Nuovo", progetti: [{ nome: "Casa" }],
      scelte: ["same_plant", "keep_users", "delete_all"], erede: "Casa", stesso_impianto: null } as never;
    const spenta = testoSceltaImpianto(base, ["same_plant"]);
    const accesa = testoSceltaImpianto({ ...(base as object), sostituisci_utenti: true } as never, ["same_plant"]);
    expect(spenta).toContain("History, users and backups stay");
    expect(accesa).not.toContain("History, users and backups stay");
    expect(accesa).toContain("The users come from the project");
  });
});
