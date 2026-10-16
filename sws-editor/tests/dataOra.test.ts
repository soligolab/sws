/** L'oggetto «Data e ora» (15-10-2026, piano docs/plans/2026-10-15-cornici-di-pagina.md, ramo 1):
 *  lo stesso testo del pannello (`sws-core/src/data_ora.rs`). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { testoOrologio } from "../src/canvas/dataOra";

const casi = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/data-ora.json"), "utf8")) as {
  nome: string; anno: number; componenti: number[]; formato?: string; secondi?: boolean; modello?: string;
  lingua: string; atteso: string }[];

describe("data e ora — lo stesso testo del pannello", () => {
  for (const k of casi) {
    it(k.nome, () => {
      const [mese, giorno, ore, minuti, secondi, giornoSettimana] = k.componenti;
      const c = { anno: k.anno, mese, giorno, ore, minuti, secondi, giornoSettimana };
      expect(testoOrologio(c, k.formato, k.secondi ?? false, k.modello, k.lingua)).toBe(k.atteso);
    });
  }
});
