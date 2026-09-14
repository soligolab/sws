import { describe, it, expect } from "vitest";
import { azionePerSessioneRifiutata } from "../src/auth/sessioneScaduta";

/** Dopo un 401, quale schermata ha senso.
 *
 *  Il guasto del 14-09-2026: il modale «Sessione scaduta» compariva anche
 *  quando la sessione non esisteva, chiedendo la password di un utente
 *  sintetico che in `users.yaml` non c'è. Nessuna password poteva funzionare.
 */
describe("azionePerSessioneRifiutata", () => {
  it("una sessione vera si rinnova col modale", () => {
    expect(azionePerSessioneRifiutata("aBcD1234")).toBe("riautentica");
  });

  it("il sentinella no-auth non è una sessione: si torna al login", () => {
    // È il caso del guasto. `"no-auth"` non è mai stato emesso dal server:
    // chiedere la password «per continuare come admin» è una porta dipinta.
    expect(azionePerSessioneRifiutata("no-auth")).toBe("accedi-da-capo");
  });

  it("senza token non c'è niente da fare: il login è già lì", () => {
    expect(azionePerSessioneRifiutata(null)).toBe("niente");
    expect(azionePerSessioneRifiutata("")).toBe("niente");
  });
});
