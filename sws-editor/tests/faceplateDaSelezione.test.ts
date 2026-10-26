import { describe, expect, it } from "vitest";
import { faceplateDallaSelezione } from "../src/editor/faceplateDaSelezione";
import type { SynopticObject } from "../src/types";

/** P2 (25-10-2026): un faceplate dagli oggetti già disegnati. */
const o = (x: Partial<SynopticObject>) => ({ type: "rect", x: 0, y: 0, width: 10, height: 10, ...x }) as SynopticObject;

describe("crea faceplate dalla selezione", () => {
  it("coordinate relative, radice comune come parametro istanza, istanza al posto giusto", () => {
    const { def, istanza } = faceplateDallaSelezione([
      o({ id: "a", x: 100, y: 50, tag: "motore1.velocita" }),
      o({ id: "b", type: "text", x: 130, y: 70, visible_tag: "motore1.marcia" }),
    ], "fp_motore", "Motore", "i1");
    expect(def.objects.map((x) => [x.x, x.y])).toEqual([[0, 0], [30, 20]]);
    expect(def.params).toEqual([{ name: "p", type: "istanza" }]);
    expect(def.objects[0].tag).toBe("{p}.velocita");
    expect(def.objects[1].visible_tag).toBe("{p}.marcia");
    expect(istanza).toMatchObject({ type: "faceplate", x: 100, y: 50, faceplate_id: "fp_motore", faceplate_params: { p: "motore1" } });
  });

  it("tag senza radice comune: un parametro per tag col predefinito", () => {
    const { def, istanza } = faceplateDallaSelezione([
      o({ id: "a", tag: "pompa.on" }), o({ id: "b", x: 20, tag: "valvola" }),
    ], "fp", "X", "i");
    expect(def.params.map((p) => typeof p === "string" ? p : [p.name, p.default])).toEqual([["tag1", "pompa.on"], ["tag2", "valvola"]]);
    expect(def.objects.map((x) => x.tag)).toEqual(["{tag1}", "{tag2}"]);
    expect(istanza.faceplate_params).toEqual({ tag1: "pompa.on", tag2: "valvola" });
  });

  it("i punti dei tubi si spostano, e un aggancio fuori dalla selezione si toglie", () => {
    const { def } = faceplateDallaSelezione([
      o({ id: "a", x: 50, y: 50 }),
      o({ id: "t", type: "pipe", x: 0, y: 0, points: [{ x: 60, y: 60 }, { x: 90, y: 60 }], from_obj_id: "a", to_obj_id: "fuori", to_port: "left" }),
    ], "fp", "X", "i");
    const tubo = def.objects[1];
    expect(tubo.points).toEqual([{ x: 10, y: 10 }, { x: 40, y: 10 }]);
    expect(tubo.from_obj_id).toBe("a");
    expect(tubo.to_obj_id).toBeUndefined();
    expect(tubo.to_port).toBeUndefined();
  });
});

import { useAppStore } from "../src/store";

describe("la selezione sostituita dall'istanza", () => {
  it("prende il posto del primo oggetto, e un annulla rimette tutto", () => {
    useAppStore.setState({
      currentPageId: "p",
      pages: [{ id: "p", name: "p", objects: [o({ id: "sotto" }), o({ id: "a" }), o({ id: "b" }), o({ id: "sopra" })] }] as never,
      selectedObjectIds: ["a", "b"], selectedObjectId: null,
    });
    useAppStore.getState().sostituisciSelezione(o({ id: "i", type: "faceplate" }));
    const ids = () => useAppStore.getState().pages[0].objects.map((x) => x.id);
    expect(ids()).toEqual(["sotto", "i", "sopra"]);
    expect(useAppStore.getState().selectedObjectIds).toEqual(["i"]);
    useAppStore.getState().undo();
    expect(ids()).toEqual(["sotto", "a", "b", "sopra"]);
  });
});
