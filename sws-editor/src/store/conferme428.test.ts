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
