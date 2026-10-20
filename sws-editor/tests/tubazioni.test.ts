/** Le tubazioni (15-10-2026, piano docs/plans/2026-10-15-tubazioni-bocche-e-stili.md):
 *  aggancio alle bocche dei simboli e instradamento, con gli stessi casi del
 *  pannello (`sws-core/src/tubazioni.rs`). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aggancioBocca, aggancioRiquadro, diametroBocca, instrada, type Capo } from "../src/canvas/tubazioni";
import type { PortaLib } from "../src/symbols/lib/manifest";

type C = { x: number; y: number; dir?: [number, number]; dritto?: boolean };
/** Una tappa nella fixture: `[x, y]`, oppure `{x, y, dritto}` per i casi del
 *  tratto dritto. Le due forme convivono, così i casi scritti prima del
 *  20-10-2026 restano scritti com'erano. */
type TappaFix = [number, number] | { x: number; y: number; dritto?: boolean };
const tappa = (t: TappaFix) => (Array.isArray(t) ? { x: t[0], y: t[1] } : t);
const fx = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/tubazioni.json"), "utf8")) as {
  bocche: { nome: string; viewBox: [number, number]; porta: PortaLib; oggetto: never; atteso: number[]; diametro: number }[];
  riquadro: { nome: string; lato: string; oggetto: never; trasformato: boolean; atteso: number[] }[];
  percorsi: { nome: string; da: C; a: C; intermedi: TappaFix[]; diagonale: boolean; atteso: [number, number][] }[];
};
const capo = (c: C): Capo => ({ punto: { x: c.x, y: c.y }, dir: c.dir, dritto: c.dritto });

describe("tubazioni — casi condivisi col pannello", () => {
  for (const c of fx.bocche) {
    it(`bocca: ${c.nome}`, () => {
      const a = aggancioBocca(c.viewBox, c.porta, c.oggetto);
      expect([a.x, a.y, a.dx, a.dy]).toEqual(c.atteso);
      expect(diametroBocca(c.viewBox, c.porta, c.oggetto)).toBe(c.diametro);
    });
  }
  for (const c of fx.riquadro) {
    it(`riquadro: ${c.nome}`, () => {
      const a = aggancioRiquadro(c.lato, c.oggetto, c.trasformato);
      expect([a.x, a.y, a.dx, a.dy]).toEqual(c.atteso);
    });
  }
  for (const c of fx.percorsi) {
    it(`percorso: ${c.nome}`, () => {
      const p = instrada(capo(c.da), capo(c.a), c.intermedi.map(tappa), c.diagonale);
      expect(p.map((q) => [q.x, q.y])).toEqual(c.atteso);
    });
  }
});

import { act } from "@testing-library/react";
import { beforeAll } from "vitest";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import { bersagli, calamita, percorsoTubo } from "../src/canvas/tubazioni";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import type { SynopticObject } from "../src/types";

const manifesto = JSON.parse(readFileSync(resolve(__dirname, "../public/symbols/lib/manifest.json"), "utf8")) as ManifestLib;
const ogg = (o: Partial<SynopticObject>) => o as SynopticObject;
const pompa = ogg({ id: "p", type: "symbol", symbol_id: "lib:process/centrifugal-pump", x: 100, y: 200, width: 80, height: 80 });
const valvola = ogg({ id: "v", type: "symbol", symbol_id: "lib:process/ball-valve", x: 300, y: 100, width: 60, height: 70 });

describe("tubazioni col manifesto vero", () => {
  beforeAll(() => { act(() => impostaLibreriaPerTest(manifesto)); });

  it("ortogonale dalla mandata della pompa all'ingresso della valvola, come il pannello", () => {
    const t = ogg({ id: "t", type: "pipe", routing: "orthogonal", from_obj_id: "p", from_port: "n-top", to_obj_id: "v", to_port: "n-left", points: [] });
    expect(percorsoTubo(t, [pompa, valvola]).map((q) => [q.x, q.y])).toEqual([[150, 200], [150, 150], [300, 150]]);
  });

  it("un alias builtin ha le bocche del suo disegno", () => {
    const vecchia = ogg({ ...pompa, symbol_id: "pump" });
    const t = ogg({ id: "t", type: "pipe", from_obj_id: "p", from_port: "n-top", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
    expect(percorsoTubo(t, [vecchia])[0]).toEqual({ x: 150, y: 200 });
  });

  it("la calamita preferisce la bocca al lato del riquadro vicino", () => {
    // La mandata (150, 200) e il centro del lato alto (140, 200) distano 10:
    // a metà strada vince la bocca.
    const b = calamita(bersagli([pompa, valvola], "t"), { x: 145, y: 203 }, 12);
    expect(b).toMatchObject({ objId: "p", porta: "n-top", bocca: true });
    expect(calamita(bersagli([pompa], "t"), { x: 500, y: 500 }, 12)).toBeNull();
  });

  it("i tubi non sono bersagli, né il tubo che si sta trascinando", () => {
    const altro = ogg({ id: "t2", type: "pipe", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(bersagli([pompa, altro], "p").length).toBe(0);
  });
});
