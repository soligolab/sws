import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stileEffettivo, type StileSimboliProgetto, type SovrascrittureSimbolo } from "../src/symbols/stileProgetto";

/** Stile effettivo di un simbolo di libreria. **I casi non stanno qui**: stanno
 *  in `tests/fixtures/stile-effettivo.json` e li verifica anche
 *  `sws-core/src/stile_simboli.rs`, perché web e pannello combinino oggetto,
 *  progetto e disegno nello stesso modo. */
type Caso = { nome: string; progetto: StileSimboliProgetto | null; oggetto: SovrascrittureSimbolo; corpo_stato: string | null; atteso: unknown };
const fx = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/stile-effettivo.json"), "utf8")) as {
  materiali_disegno: Record<string, string>; materiale_corpo: string; casi: Caso[];
};

describe("stileEffettivo — i casi condivisi col pannello", () => {
  for (const c of fx.casi) {
    it(c.nome, () => {
      expect(stileEffettivo(fx.materiali_disegno, fx.materiale_corpo, c.progetto ?? undefined, c.oggetto, c.corpo_stato)).toEqual(c.atteso);
    });
  }
});
