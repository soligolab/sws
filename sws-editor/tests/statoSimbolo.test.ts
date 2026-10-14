import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { statoSimbolo } from "../src/symbols/statoSimbolo";
import type { TextListEntry } from "../src/types";

/** Stato di un simbolo dai suoi tag. **I casi non stanno qui**: stanno in
 *  `tests/fixtures/stato-simbolo.json` e li verifica anche il pannello
 *  (`lvgl_render.rs`), perché lo stesso tag non accenda una pompa nel browser e
 *  la lasci spenta sul pannello. */
type Caso = {
  nome: string;
  tag: { allarme?: unknown; stato?: unknown };
  stati: TextListEntry[];
  atteso: { stato: string; voce: number | null };
};
const { casi } = JSON.parse(
  readFileSync(resolve(__dirname, "../../tests/fixtures/stato-simbolo.json"), "utf8"),
) as { casi: Caso[] };

describe("statoSimbolo — i casi condivisi col pannello", () => {
  for (const c of casi) {
    it(c.nome, () => {
      expect(statoSimbolo(c.tag.allarme, c.tag.stato, c.stati)).toEqual(c.atteso);
    });
  }
});
