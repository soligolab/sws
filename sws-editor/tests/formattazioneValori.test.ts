import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatValue } from "../src/canvas/SvgCanvas";

/** La formattazione del valore di un tag (`format: "{value:.1f} bar"`).
 *
 *  **I casi non stanno qui**: stanno in `tests/fixtures/formattazione-valori.json`,
 *  alla radice del repo, e li legge *anche* il test Rust del viewer LVGL
 *  (`lvgl_render.rs`, modulo `formattazione_valori_tests`). È la stessa scelta
 *  di `risoluzioneToken.test.ts`, e per la stessa ragione: due motori
 *  disegnano gli stessi progetti, e due copie della tabella di casi
 *  divergerebbero in silenzio.
 *
 *  Il file della fixture racconta i tre difetti che questa rete ha trovato il
 *  17-09-2026 — LVGL che buttava via il testo attorno al numero, il web che
 *  non riconosceva `{value:+.2f}`, e `{value}` nudo che perdeva la frase.
 */
type Caso = { nome: string; valore: number; format: string | null; atteso: string };
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../tests/fixtures/formattazione-valori.json"), "utf8"),
) as { casi: Caso[] };

describe("formatValue — la stessa tabella di casi del viewer LVGL", () => {
  for (const c of fixture.casi) {
    it(c.nome, () => {
      expect(formatValue(c.valore, c.format ?? undefined)).toBe(c.atteso);
    });
  }
});

/** I casi che la fixture condivisa non può portare: la legge un test Rust che
 *  dichiara `valore: f64`, quindi i valori non numerici stanno solo qui. */
describe("formatValue — valori non numerici e formati storti", () => {
  it("una stringa prende il posto del segnaposto, e il testo attorno resta", () => {
    expect(formatValue("n/d", "{value:hms}")).toBe("n/d");
    expect(formatValue("n/d", "{value:.2f} bar")).toBe("n/d bar");
    expect(formatValue(true, "{value:datetime}")).toBe("true");
  });

  it("un formato che non si capisce non butta via la frase", () => {
    expect(formatValue(12.3, "Livello {value:xyz}")).toBe("Livello {value:xyz}");
    expect(formatValue(12.3, "Livello {value}")).toBe("Livello 12.3");
  });

  it("un numero non finito si mostra com'è, senza inventare un orario", () => {
    expect(formatValue(Number.POSITIVE_INFINITY, "{value:hms}")).toBe("Infinity");
    expect(formatValue(Number.NaN, "{value:datetime}")).toBe("NaN");
  });
});
