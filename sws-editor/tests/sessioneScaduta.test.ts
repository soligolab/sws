import { describe, it, expect } from "vitest";
import { azionePerSessioneRifiutata, ritardoRinnovo, RINNOVO_MASSIMO_MS } from "../src/auth/sessioneScaduta";

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

/** Il rinnovo della sessione (30-10-2026): con «ricordami» il timer superava
 *  il massimo di `setTimeout`, scattava subito, e il rinnovo — che allora
 *  prendeva 401 — faceva comparire «Sessione scaduta» appena entrati. */
describe("ritardoRinnovo", () => {
  const ora = 1_000_000_000_000;
  it("una sessione di 8 ore si rinnova cinque minuti prima", () => {
    expect(ritardoRinnovo(ora + 8 * 3600_000, ora)).toBe(8 * 3600_000 - 5 * 60_000);
  });
  it("una di 30 giorni non supera mai un giorno, ben sotto il limite di setTimeout", () => {
    const r = ritardoRinnovo(ora + 30 * 24 * 3600_000, ora);
    expect(r).toBe(RINNOVO_MASSIMO_MS);
    expect(r).toBeLessThan(2 ** 31 - 1);
  });
  it("una quasi scaduta aspetta almeno 30 secondi", () => {
    expect(ritardoRinnovo(ora + 1000, ora)).toBe(30_000);
  });
});
