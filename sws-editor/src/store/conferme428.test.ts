import { afterEach, describe, expect, it } from "vitest";
import "@/i18n";
import { rispondi, type Richiesta } from "@/finestraAvviso/finestraAvviso";
import { confermaDopo428, NESSUNA_CONFERMA, testoSostituzioneUtenti } from "./conferme428";

describe("il deploy che sostituisce gli utenti (07-11-2026)", () => {
  let fine: (() => void) | null = null;
  afterEach(() => { fine?.(); fine = null; });

  it("nomina chi sostituisce chi, e chi dovrà cambiare la password solo se c'è", () => {
    const t = testoSostituzioneUtenti({ utenti_dispositivo: ["admin", "mauro"], utenti_progetto: ["admin"], utenti: [] });
    expect(t).toContain("(admin, mauro)");
    expect(t).toContain("(admin)");
    expect(t).not.toContain("mandatory password change");
    expect(testoSostituzioneUtenti({ utenti_dispositivo: ["admin"], utenti_progetto: ["admin"], utenti: ["admin"] }))
      .toContain("mandatory password change: admin");
  });

  it("chiede anche col nome della rc.3, e col sì riprova con la conferma", async () => {
    const r = rispondi((q: Richiesta) => q.tipo === "conferma");
    fine = r.ferma;
    for (const conferma of ["utenti-sostituiti", "utenti-da-cambiare"]) {
      const e = await confermaDopo428({ conferma, utenti_dispositivo: ["admin"], utenti_progetto: ["admin"] }, NESSUNA_CONFERMA);
      expect(e).toEqual({ tipo: "riprova", conferme: { ...NESSUNA_CONFERMA, confirmUsersChange: true } });
    }
    expect(r.chiamate).toHaveLength(2);
  });
});

describe("rc.30, collaudo on the PLX800", () => {
  let fine: (() => void) | null = null;
  afterEach(() => { fine?.(); fine = null; });

  it("a deploy that turns the screen says the device restarts, and «yes» retries with the confirmation", async () => {
    const r = rispondi((q: Richiesta) => q.tipo === "conferma");
    fine = r.ferma;
    const e = await confermaDopo428({ conferma: "rotate-screen", current: 0, wanted: 1, portrait: true }, NESSUNA_CONFERMA);
    expect(e).toEqual({ tipo: "riprova", conferme: { ...NESSUNA_CONFERMA, confirmRotation: true } });
    expect(JSON.stringify(r.chiamate[0])).toMatch(/riavvia il dispositivo|restarts the device/);
  });

  it("«no» to the rotation sends nothing", async () => {
    const r = rispondi(false);
    fine = r.ferma;
    const e = await confermaDopo428({ conferma: "rotate-screen", current: 1, wanted: 0, portrait: false }, NESSUNA_CONFERMA);
    expect(e).toEqual({ tipo: "annullato" });
  });

  it("a project user's session is not a confirmation: it is said, and nothing is sent", async () => {
    const r = rispondi(undefined);
    fine = r.ferma;
    const e = await confermaDopo428({ conferma: "project-session" }, NESSUNA_CONFERMA);
    expect(e).toEqual({ tipo: "annullato" });
    expect(r.chiamate[0].tipo).toBe("avviso");
    expect(JSON.stringify(r.chiamate[0])).toMatch(/Admin del dispositivo|device Admin/);
  });
});
