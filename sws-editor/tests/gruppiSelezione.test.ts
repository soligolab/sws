// I gruppi sul canvas (piano 2026-11-11-selezione-e-gruppi).

import { describe, expect, it } from "vitest";

import { espandiAlGruppo, gruppiPerLeCopie, gruppoIntero, bboxDelGruppo } from "@/editor/gruppiSelezione";
import type { SynopticObject } from "@/types";

const o = (id: string, x: number, group_id?: string, extra: Partial<SynopticObject> = {}) =>
  ({ id, type: "rect", x, y: 0, width: 10, height: 10, group_id, ...extra }) as SynopticObject;

const oggetti = [o("sfondo", 0, undefined, { width: 1000, height: 1000 }),
                 o("a", 100, "g1"), o("b", 200, "g1"), o("c", 300, "g1"), o("d", 400)];

describe("espandiAlGruppo", () => {
  it("un membro porta con sé tutto il gruppo", () => {
    expect(espandiAlGruppo(["b"], oggetti, null)).toEqual(["a", "b", "c"]);
  });
  it("nel gruppo aperto si resta sul singolo", () => {
    expect(espandiAlGruppo(["b"], oggetti, "g1")).toEqual(["b"]);
  });
  it("un oggetto senza gruppo resta solo", () => {
    expect(espandiAlGruppo(["d"], oggetti, null)).toEqual(["d"]);
  });
});

describe("gruppoIntero e bboxDelGruppo", () => {
  it("riconosce un gruppo selezionato per intero, e solo quello", () => {
    expect(gruppoIntero(["a", "b", "c"], oggetti)).toBe("g1");
    expect(gruppoIntero(["a", "b"], oggetti)).toBeNull();
    expect(gruppoIntero(["a", "b", "c", "d"], oggetti)).toBeNull();
  });
  it("il riquadro abbraccia tutti i membri", () => {
    expect(bboxDelGruppo("g1", oggetti)).toEqual({ x1: 100, y1: 0, x2: 310, y2: 10 });
  });
});

describe("gruppiPerLeCopie", () => {
  let n = 0;
  const nuovoId = () => `n${++n}`;

  it("un gruppo copiato intero diventa un gruppo nuovo, col nome dell'originale", () => {
    const copie = [o("a2", 120, "g1"), o("b2", 220, "g1"), o("c2", 320, "g1")];
    const r = gruppiPerLeCopie(copie, oggetti, [{ id: "g1", name: "Bilancio" }], nuovoId, "(copia)");
    expect(r.gruppi).toHaveLength(1);
    expect(r.gruppi[0].name).toBe("Bilancio (copia)");
    expect(new Set(r.copie.map((c) => c.group_id))).toEqual(new Set([r.gruppi[0].id]));
  });

  it("un membro copiato da solo esce dal gruppo", () => {
    const r = gruppiPerLeCopie([o("b2", 220, "g1")], oggetti, [], nuovoId, "(copia)");
    expect(r.gruppi).toEqual([]);
    expect(r.copie[0].group_id).toBeUndefined();
  });
});
