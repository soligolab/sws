/** Le misure derivate dal corpo del testo: gli stessi casi che legge il
 *  gemello Rust (`sws-core/src/geometria_testo.rs`). Se le due
 *  implementazioni divergono, i due motori disegnano lo stesso oggetto con
 *  altezze diverse — ed è il guasto che la tabella dei predefiniti esiste per
 *  impedire sui colori. */
import { describe, expect, it } from "vitest";
import fixture from "../../tests/fixtures/geometria-testo.json";
import { altezzaEtichetta, altezzaMinimaSetpoint, altezzaValore, corpoAnnotazione, corpoSecondario, passoRiga } from "@/canvas/geometriaTesto";

const FUNZIONI: Record<string, (c: number) => number> = {
  passo_riga: passoRiga,
  altezza_etichetta: altezzaEtichetta,
  altezza_valore: altezzaValore,
  corpo_secondario: corpoSecondario,
  corpo_annotazione: corpoAnnotazione,
};

describe("le misure derivate dal corpo", () => {
  for (const [nome, f] of Object.entries(FUNZIONI)) {
    it(`${nome}: i casi della fixture condivisa`, () => {
      const casi = (fixture as unknown as Record<string, { corpo: number; atteso: number }[]>)[nome];
      expect(casi.length).toBeGreaterThan(2);
      for (const c of casi) {
        expect(f(c.corpo), `${nome}(${c.corpo})`).toBe(c.atteso);
      }
    });
  }

  it("col corpo di oggi niente si muove", () => {
    expect(passoRiga(13)).toBe(28);
    expect(altezzaEtichetta(11)).toBe(20);
    expect(altezzaValore(12)).toBe(18);
    expect(corpoSecondario(10)).toBe(9);
    expect(corpoAnnotazione(12)).toBe(10);
    // Il setpoint predefinito chiede 61 px contro i 56 di oggi: e'
    // l'allargamento scelto dal maintainer, e i sette setpoint misurati nel
    // repo e nei progetti veri stanno tutti a 48, quindi crescono tutti di 13.
    expect(altezzaMinimaSetpoint(11, 12, 12, true)).toBe(61);
    expect(altezzaMinimaSetpoint(11, 12, 12, false)).toBe(45);
  });
});
