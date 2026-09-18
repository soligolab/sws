import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { testoSistema, TESTI_SISTEMA, LINGUE_SISTEMA, type VoceSistema } from "../src/i18n/testiSistema";

/** Il testo di sistema del viewer — «Ora», «sì», «N/D» — nella lingua dei contenuti.
 *
 *  **I casi non stanno qui**: stanno in `tests/fixtures/testi-sistema.json`, alla
 *  radice del repo, e li legge *anche* il test Rust di `sws-core::testi_sistema`.
 *  È la stessa scelta di `risoluzioneToken.test.ts` e `formattazioneValori.test.ts`:
 *  due motori disegnano gli stessi progetti, e due tabelle separate divergono in
 *  silenzio — fino al 18-09-2026 il web aveva queste parole in due lingue e il
 *  pannello in cinque, e un operatore tedesco leggeva «Zeit» sul vetro e «Time»
 *  nel browser.
 */
type Fixture = { ripiego: string; voci: Record<string, Record<string, string>> };
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../tests/fixtures/testi-sistema.json"), "utf8"),
) as Fixture;

describe("testoSistema — la stessa tabella del pannello LVGL", () => {
  for (const [voce, lingue] of Object.entries(fixture.voci)) {
    for (const [lingua, atteso] of Object.entries(lingue)) {
      it(`${voce} in ${lingua}`, () => {
        expect(testoSistema(voce as VoceSistema, lingua)).toBe(atteso);
      });
    }
    it(`${voce}: una lingua sconosciuta ripiega su «${fixture.ripiego}»`, () => {
      expect(testoSistema(voce as VoceSistema, "sv")).toBe(lingue[fixture.ripiego]);
    });
  }

  it("nessuna voce del modulo manca nella fixture, e viceversa", () => {
    expect(Object.keys(TESTI_SISTEMA).sort()).toEqual(Object.keys(fixture.voci).sort());
  });

  it("nessuna parola è vuota, in nessuna lingua", () => {
    for (const voce of Object.keys(TESTI_SISTEMA) as VoceSistema[]) {
      for (const l of [...LINGUE_SISTEMA, "sv", ""]) {
        expect(testoSistema(voce, l)).not.toBe("");
      }
    }
  });
});
