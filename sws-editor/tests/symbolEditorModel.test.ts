/** The symbol editor's model (plan docs/plans/2026-11-18-editor-dei-simboli.md,
 *  phase 1): pure edits on a project symbol description. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DescrizioneSimbolo } from "../src/types";
import {
  addInput, boxToBox, deleteOps, duplicateOps, emptySymbol, fillOf, inputs, insertInLayer, layers, newRect,
  removeInput, reorderOp, saveAsCopy, setFill, setPartGeo, slugFrom, transformOp, transformPath, type Op,
} from "../src/symbols/editor/model";

const gabbia: DescrizioneSimbolo = JSON.parse(
  readFileSync(resolve(__dirname, "../../tests/fixtures/simboli-prj/gabbia-laminazione.json"), "utf8"),
);

describe("paths", () => {
  it("moves absolute coordinates and only scales relative ones", () => {
    const a = { sx: 2, sy: 2, tx: 10, ty: 5 };
    expect(transformPath("M1 2 L3 4 Z", a)).toBe("M12 9 L16 13 Z");
    expect(transformPath("m1 2 l3 4", a)).toBe("m2 4 l6 8");
    expect(transformPath("M0 0 H10 V20", a)).toBe("M10 5 H30 V45");
    // Arcs: radii scaled, flags kept, end point moved.
    expect(transformPath("M0 0 A5 5 0 0 1 10 0", a)).toBe("M10 5 A10 10 0 0 1 30 5");
    // Commas and repeated pairs, as some library paths write them.
    expect(transformPath("M0,0 10,0 10,10", { sx: 1, sy: 1, tx: 1, ty: 1 })).toBe("M1 1 11 1 11 11");
  });
});

describe("operations", () => {
  it("moves and scales shapes, part geometry and pipe ends", () => {
    const a = boxToBox({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 20, h: 10 });
    const r = transformOp(newRect({ x: 0, y: 0, w: 10, h: 10 }), a);
    expect(r.geo).toEqual([["x", 5], ["y", 5], ["width", 20], ["height", 10]]);
    const p = transformOp({ op: "parte", id: "rotor", kind: "rotor", geo: { cx: 5, cy: 5, symmetry: 60 } }, a);
    expect(p.geo).toEqual({ cx: 15, cy: 10, symmetry: 60 });
    const f = transformOp({ op: "flangia_v", x: 0, y: 0, w: 4, h: 16 }, { sx: 1, sy: 1, tx: 3, ty: 0 });
    expect(f).toMatchObject({ x: 3, y: 0, w: 4, h: 16 });
  });

  it("knows the layers and the inputs of a description", () => {
    const d = gabbia;
    const ls = layers(d);
    expect(ls[0].id).toBe("layer-0");
    expect(ls.some((l) => l.id === "body")).toBe(true);
    const ins = inputs(d);
    expect(ins.find((i) => i.kind === "state")).toBeTruthy();
    // Every drawing operation is in exactly one layer.
    const all = ls.flatMap((l) => l.ops).sort((a, b) => a - b);
    expect(new Set(all).size).toBe(all.length);
  });

  it("deletes, duplicates and reorders inside a layer", () => {
    const d = emptySymbol({ it: "Prova", en: "Test" }, []);
    const body = layers(d).find((l) => l.id === "body")!;
    const { d: d2, added } = duplicateOps(d, body.ops);
    expect(d2.ops.length).toBe(d.ops.length + 1);
    expect(layers(d2).find((l) => l.id === "body")!.ops).toContain(added[0]);
    const { d: d3, at } = reorderOp(d2, added[0], -1);
    expect(at).toBe(added[0] - 1);
    // It does not cross the operation that opens the layer.
    const { at: stays } = reorderOp(d3, at, -1);
    expect(stays).toBe(at);
    expect(deleteOps(d3, [at]).ops.length).toBe(d.ops.length);
  });

  it("inserts a shape at the end of the chosen layer", () => {
    const d = addInput(emptySymbol({ it: "P", en: "Pump" }, []), "rotor")!.d;
    const { d: d2, at } = insertInLayer(d, "body", newRect({ x: 1, y: 1, w: 2, h: 2 }));
    expect(layers(d2).find((l) => l.id === "body")!.ops).toContain(at);
    expect(layers(d2).find((l) => l.id === "rotor")!.ops).not.toContain(at);
  });
});

describe("colours", () => {
  it("switches between material, own colour and the body's", () => {
    const d = emptySymbol({ it: "P", en: "P" }, []);
    const i = layers(d).find((l) => l.id === "body")!.ops[0];
    expect(fillOf(d.ops[i] as Op)).toEqual({ body: true });
    const own = setFill(d, i, { color: "#12ab3c" });
    expect(fillOf(own.ops[i] as Op)).toEqual({ color: "#12ab3c" });
    const mat = setFill(own, i, { mat: "copper" });
    expect(fillOf(mat.ops[i] as Op)).toEqual({ mat: "copper" });
    expect((mat.ops[i] as Op).extra).toEqual([]);
  });
});

describe("inputs", () => {
  it("adds one input per behaviour, with a shape and unique ids", () => {
    let d = emptySymbol({ it: "P", en: "P" }, []);
    expect(addInput(d, "state")).toBeNull();
    for (const k of ["rotor", "rotor", "level", "needle", "lever", "lamp"] as const) d = addInput(d, k)!.d;
    expect(inputs(d).map((i) => i.id)).toEqual(["state", "rotor", "rotor-2", "level", "needle", "lever", "lamp"]);
    for (const l of layers(d)) if (l.kind !== "static") expect(l.ops.length).toBeGreaterThan(0);
    const rotor = inputs(d).find((i) => i.id === "rotor")!;
    d = setPartGeo(d, rotor.op, "cx", 12.345);
    expect(((d.ops[rotor.op] as Op).geo as Record<string, number>).cx).toBe(12.35);
    // Removing an input keeps its shapes.
    const n = d.ops.length;
    d = removeInput(d, rotor.op);
    expect(d.ops.length).toBe(n);
    expect(inputs(d).some((i) => i.id === "rotor")).toBe(false);
  });
});

describe("save as", () => {
  it("makes an independent symbol with a slug of its own", () => {
    const v = { ...gabbia, overrides: "lib:process/centrifugal-pump" };
    const c = saveAsCopy(v, { it: "Pompa dosatrice", en: "Dosing pump" }, ["dosing-pump"]);
    expect(c.overrides).toBeUndefined();
    expect(c.slug).toBe("dosing-pump-2");
    expect(c.it).toBe("Pompa dosatrice");
    expect(c.ops).toEqual(gabbia.ops);
    expect(c.ops).not.toBe(gabbia.ops);
  });

  it("builds slugs the compiler accepts", () => {
    expect(slugFrom("Pompa è già!", [])).toBe("pompa-e-gia");
    expect(slugFrom("P", [])).toMatch(/^[a-z0-9-]{3,40}$/);
    expect(slugFrom("x".repeat(80), [])).toHaveLength(34);
  });
});
