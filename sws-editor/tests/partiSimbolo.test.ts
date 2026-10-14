import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { valoriParti } from "../src/symbols/lib/libreria";
import type { SimboloLib } from "../src/symbols/lib/manifest";
import type { ParteLegata } from "../src/types";

/** Lancetta, leva e spie dei simboli di libreria. **I casi non stanno qui**:
 *  stanno in `tests/fixtures/parti-simbolo.json` e li verifica anche il pannello
 *  (`simbolo_lib.rs`). */
type Caso = { nome: string; legami: Record<string, ParteLegata>; tag: Record<string, unknown>; atteso: Record<string, unknown> };
const fx = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/parti-simbolo.json"), "utf8")) as {
  parti: SimboloLib["parts"];
  casi: Caso[];
};

describe("valoriParti — i casi condivisi col pannello", () => {
  for (const c of fx.casi) {
    it(c.nome, () => {
      const v = valoriParti(fx.parti, c.legami, (t) => c.tag[t]);
      for (const [id, atteso] of Object.entries(c.atteso)) expect(v[id], id).toEqual(atteso);
    });
  }
});
