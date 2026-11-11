// Il riquadro di selezione (piano 2026-11-11-selezione-e-gruppi): dentro per
// intero, bloccati esclusi, gruppi interi.

import { describe, expect, it } from "vitest";

import { idsNelRiquadro } from "@/canvas/selezioneRiquadro";
import { objectBBox } from "@/pageLayout";
import type { SynopticObject } from "@/types";

const o = (id: string, x: number, extra: Partial<SynopticObject> = {}) =>
  ({ id, type: "rect", x, y: 100, width: 50, height: 20, ...extra }) as SynopticObject;

const sfondo = o("sfondo", 0, { y: 0, width: 1920, height: 964 });
const r = { x1: 90, y1: 90, x2: 400, y2: 200 };

describe("idsNelRiquadro", () => {
  it("lo sfondo a tutta area non entra in un riquadro piccolo, anche se non è bloccato", () => {
    const ids = idsNelRiquadro([sfondo, o("a", 100), o("b", 200)], r, objectBBox, null);
    expect(ids).toEqual(["a", "b"]);
  });

  it("un oggetto toccato ma non contenuto resta fuori", () => {
    expect(idsNelRiquadro([o("a", 380)], r, objectBBox, null)).toEqual([]);
  });

  it("un oggetto bloccato resta fuori anche se è dentro", () => {
    expect(idsNelRiquadro([o("a", 100, { locked: true }), o("b", 200)], r, objectBBox, null)).toEqual(["b"]);
  });

  it("un gruppo entra solo intero, e il gruppo aperto si comporta come oggetti sciolti", () => {
    const ogg = [o("a", 100, { group_id: "g" }), o("b", 200, { group_id: "g" }), o("c", 500, { group_id: "g" })];
    expect(idsNelRiquadro(ogg, r, objectBBox, null)).toEqual([]);
    expect(idsNelRiquadro(ogg, { ...r, x2: 600 }, objectBBox, null)).toEqual(["a", "b", "c"]);
    expect(idsNelRiquadro(ogg, r, objectBBox, "g")).toEqual(["a", "b"]);
  });
});
