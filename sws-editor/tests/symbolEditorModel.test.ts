/** The symbol editor's model (plan docs/plans/2026-11-18-editor-dei-simboli.md,
 *  phase 1): pure edits on a project symbol description. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DescrizioneSimbolo } from "../src/types";
import {
  addInput, boxToBox, deleteOps, duplicateOps, emptySymbol, fillOf, inputs, insertInLayer, layers, newRect,
  removeInput, reorderOp, saveAsCopy, setFill, setPartGeo, slugFrom, transformOp, transformPath, type Op,
  addPort, movePort, needsExplicitPorts, ports, resizeSymbol, setPort, validPortId,
  absolutePath, align, distribute, explodedOffsets, mapBox, matrixOp, matrixPath, moveToLayer, newCircle, newPath,
  setExtra, turnMatrix, validPathD, type Box,
  animateSelection, partDefaults, setPartKind, setPartParam, freePartId,
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

describe("pipe ports (phase 2)", () => {
  const base = (): DescrizioneSimbolo => ({ slug: "s", w: 100, h: 60, body: "body-pump", it: "S", en: "S", ops: [] });

  it("a new port goes on the nearest border, with a free id and the last diameter", () => {
    let r = addPort(base(), 3, 30);
    expect(ports(r.d)).toEqual([{ op: 0, id: "p1", x: 0, y: 30, side: "left", d: 10 }]);
    r = addPort(setPort(r.d, 0, { d: 14 }), 70, 58);
    expect(ports(r.d)[1]).toMatchObject({ id: "p2", x: 70, y: 60, side: "bottom", d: 14 });
  });

  it("a port on the border slides along its side; one inside moves freely", () => {
    let d = addPort(base(), 99, 10).d;
    d = movePort(d, 0, 40, 50);
    expect(ports(d)[0]).toMatchObject({ x: 100, y: 50, side: "right" });
    d = setPort(d, 0, { x: 50 });
    d = movePort(d, 0, 20, 70);
    expect(ports(d)[0]).toMatchObject({ x: 20, y: 60 });
  });

  it("a new side puts the port on that side", () => {
    const d = setPort(addPort(base(), 0, 30).d, 0, { side: "top" });
    expect(ports(d)[0]).toMatchObject({ side: "top", y: 0, x: 0 });
  });

  it("registrations and ports without an id need making explicit", () => {
    expect(needsExplicitPorts(base())).toBe(false);
    expect(needsExplicitPorts({ ...base(), ops: [{ op: "flangia_v", x: 0, y: 10 }] })).toBe(true);
    expect(needsExplicitPorts({ ...base(), ops: [{ op: "bocca", x: 0, y: 10, side: "left", d: 10 }] })).toBe(true);
    expect(needsExplicitPorts(addPort(base(), 0, 10).d)).toBe(false);
  });

  it("port ids", () => {
    expect(validPortId("inlet")).toBe(true);
    expect(validPortId("n-left-2")).toBe(true);
    expect(validPortId("A")).toBe(false);
    expect(validPortId("con spazio")).toBe(false);
  });

  it("a new size scales shapes, parts and ports, or only the size", () => {
    let d = addPort(base(), 100, 30).d;
    d = { ...d, ops: [...d.ops, { op: "forma", tag: "rect", geo: [["x", 10], ["y", 10], ["width", 80], ["height", 40]], mat: "steel", extra: [] }] };
    const big = resizeSymbol(d, 200, 120, true);
    expect(ports(big)[0]).toMatchObject({ x: 200, y: 60, d: 20 });
    expect((big.ops[1] as { geo: [string, number][] }).geo).toEqual([["x", 20], ["y", 20], ["width", 160], ["height", 80]]);
    const same = resizeSymbol(d, 200, 120, false);
    expect(same.ops).toEqual(d.ops);
    expect([same.w, same.h]).toEqual([200, 120]);
  });
});

describe("drawing tools (phase 2)", () => {
  const rect = (x: number, y: number, w: number, h: number): Op =>
    ({ op: "forma", tag: "rect", geo: [["x", x], ["y", y], ["width", w], ["height", h]], mat: "steel", extra: [] });
  const sym = (ops: Op[]): DescrizioneSimbolo => ({ slug: "s", w: 100, h: 100, body: "body-pump", it: "S", en: "S", ops });

  it("a quarter turn about the centre turns a rect, an ellipse, a port", () => {
    const m = turnMatrix("cw", 50, 50);
    expect((matrixOp(rect(10, 20, 30, 10), m).geo as [string, number][])).toEqual([["x", 70], ["y", 10], ["width", 10], ["height", 30]]);
    const e: Op = { op: "forma", tag: "ellipse", geo: [["cx", 20], ["cy", 50], ["rx", 10], ["ry", 4]], mat: "steel", extra: [] };
    expect(matrixOp(e, m).geo).toEqual([["cx", 50], ["cy", 20], ["rx", 4], ["ry", 10]]);
    const port: Op = { op: "bocca", x: 0, y: 50, side: "left", d: 10, id: "a" };
    expect(matrixOp(port, m)).toMatchObject({ x: 50, y: 0, side: "top" });
  });

  it("a mirror flips a port's side and an arc's sweep", () => {
    const m = turnMatrix("flipH", 50, 50);
    expect(matrixOp({ op: "bocca", x: 0, y: 30, side: "left", d: 8, id: "a" }, m)).toMatchObject({ x: 100, y: 30, side: "right" });
    expect(matrixPath("M10 10 A5 5 0 0 1 20 10", m)).toBe("M90 10 A5 5 0 0 0 80 10");
  });

  it("H and V become L before a turn, relative commands absolute", () => {
    expect(absolutePath("M10 10 h20 v5 H0 z")).toBe("M10 10 L30 10 L30 15 L0 15 Z");
    expect(matrixPath("M0 0 H10", turnMatrix("cw", 0, 0))).toBe("M0 0 L0 10");
  });

  it("align and distribute use the boxes", () => {
    const d = sym([rect(10, 10, 10, 10), rect(40, 30, 20, 10), rect(80, 60, 10, 10)]);
    const boxes = new Map<number, Box>([[0, { x: 10, y: 10, w: 10, h: 10 }], [1, { x: 40, y: 30, w: 20, h: 10 }], [2, { x: 80, y: 60, w: 10, h: 10 }]]);
    const left = align(d, [0, 1, 2], boxes, "left");
    expect(left.ops.map((o) => (o.geo as [string, number][])[0][1])).toEqual([10, 10, 10]);
    const spread = distribute(d, [0, 1, 2], boxes, "h");
    // gap = (90 - 10 - 40) / 2 = 20: the middle one starts at 20 + 20 = 40.
    expect((spread.ops[1].geo as [string, number][])[0][1]).toBe(40);
  });

  it("the exploded view moves each box away from the centre, and fans out the ones on it", () => {
    const off = explodedOffsets(new Map([
      [0, { x: 0, y: 0, w: 20, h: 20 }],
      [1, { x: 40, y: 40, w: 20, h: 20 }],
      [2, { x: 30, y: 30, w: 40, h: 40 }],
    ]), [50, 50], 1, 100);
    expect(off.get(0)).toEqual([-40, -40]);
    // Two shapes on the centre: two directions, both moved by a third of the symbol and more.
    const [a, b] = [off.get(1)!, off.get(2)!];
    expect(Math.hypot(...a)).toBeCloseTo(35, 0);
    expect(Math.hypot(...b)).toBeCloseTo(35, 0);
    expect(a).not.toEqual(b);
  });

  it("a box moved and resized", () => {
    expect(mapBox({ x: 10, y: 10, w: 20, h: 10 }, { sx: 1, sy: 1, tx: 5, ty: -2 })).toEqual({ x: 15, y: 8, w: 20, h: 10 });
    const a = boxToBox({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 20, h: 30 });
    expect(mapBox({ x: 0, y: 0, w: 10, h: 10 }, a)).toEqual({ x: 5, y: 5, w: 20, h: 30 });
  });

  it("in the exploded view a group moves as one, from the box around it", () => {
    const boxes = new Map([
      [0, { x: 0, y: 0, w: 20, h: 20 }],
      [1, { x: 80, y: 0, w: 20, h: 20 }],
      [2, { x: 40, y: 80, w: 20, h: 20 }],
    ]);
    const off = explodedOffsets(boxes, [50, 50], 1, 100, [[0, 1]]);
    // The group's box is 0..100 × 0..20: its centre is above the symbol's.
    expect(off.get(0)).toEqual([0, -40]);
    expect(off.get(1)).toEqual([0, -40]);
    expect(off.get(2)).toEqual([0, 40]);
    // A group member without a box is left out, and a group of none is no group.
    expect(explodedOffsets(boxes, [50, 50], 1, 100, [[0, 1, 9], []]).get(9)).toBeUndefined();
  });

  it("new circle and polyline; path d check; extras", () => {
    expect(newCircle({ x: 0, y: 0, w: 20, h: 10 }).geo).toEqual([["cx", 10], ["cy", 5], ["r", 5]]);
    expect(newPath([[0, 0], [10, 0], [10, 10]], true)).toMatchObject({ op: "forma", tag: "path", geo: [["d", "M0 0 L10 0 L10 10 Z"]] });
    expect(newPath([[0, 0], [10, 0]], false)).toMatchObject({ op: "tratto", d: "M0 0 L10 0" });
    expect(validPathD("M0 0 L10 10 Z")).toBe(true);
    expect(validPathD("M0 0\nL1 1")).toBe(false);
    const d = setExtra(sym([rect(0, 0, 10, 10)]), 0, "stroke", "#ff0000");
    expect(d.ops[0].extra).toEqual([["stroke", "#ff0000"]]);
    expect(setExtra(d, 0, "stroke", undefined).ops[0].extra).toEqual([]);
  });

  it("no fill reads as no fill, not as the state's colour", () => {
    const op: Op = { op: "forma", tag: "circle", geo: [["cx", 5], ["cy", 5], ["r", 5]], mat: null, extra: [["fill", "none"]] };
    expect(fillOf(op)).toEqual({ none: true });
    expect(setFill(sym([op]), 0, { body: true }).ops[0].extra).toEqual([]);
    expect(setFill(sym([rect(0, 0, 1, 1)]), 0, { none: true }).ops[0]).toMatchObject({ mat: null, extra: [["fill", "none"]] });
  });

  it("moving shapes to another layer keeps their order", () => {
    const d = sym([rect(0, 0, 1, 1), rect(1, 1, 1, 1), { op: "statico" }, rect(2, 2, 1, 1)]);
    const r = moveToLayer(d, [0, 1], "layer-1");
    expect(r.d.ops.map((o) => o.op === "forma" ? (o.geo as [string, number][])[0][1] : o.op)).toEqual(["statico", 2, 0, 1]);
    expect(r.at).toEqual([2, 3]);
  });
});

/** «Anima…» (plan docs/plans/2026-11-19-animazioni-dei-simboli.md, session 2d):
 *  the chosen shapes become a part layer, every other shape stays in its layer. */
describe("animating a selection", () => {
  const sym = (ops: Op[]): DescrizioneSimbolo => ({ slug: "s", w: 100, h: 100, body: "body-pump", it: "S", en: "S", ops });
  const rect = (x: number, y: number, w: number, h: number, mat: string | null = "steel"): Op =>
    ({ op: "forma", tag: "rect", geo: [["x", x], ["y", y], ["width", w], ["height", h]], mat, extra: [] });
  const boxes = (d: DescrizioneSimbolo) => new Map((d.ops as Op[]).flatMap((op, i) => {
    if (op.op !== "forma") return [];
    const g = Object.fromEntries(op.geo as [string, number][]);
    return [[i, { x: g.x, y: g.y, w: g.width, h: g.height }] as [number, Box]];
  }));
  const kinds = (d: DescrizioneSimbolo) => (d.ops as Op[]).map((o) => (o.op === "parte" ? `parte:${o.kind}:${o.id}` : o.op));

  it("a shape of the body becomes a slide; the shapes around stay where they were", () => {
    const d = sym([{ op: "corpo" }, rect(0, 0, 10, 10), rect(20, 20, 10, 40), { op: "statico" }, rect(50, 50, 10, 10)]);
    const r = animateSelection(d, [2], "slide", boxes(d))!;
    expect(kinds(r.d)).toEqual(["corpo", "forma", "parte:slide:slide", "forma", "statico", "forma"]);
    expect(r.part).toBe(2);
    expect(r.shapes).toEqual([3]);
    expect(r.d.ops[2].geo).toEqual({ dx: 0, dy: -20, transition_ms: 300 });
  });

  it("shapes of two layers go together, at the end of the layer of the topmost", () => {
    const d = sym([{ op: "corpo" }, rect(0, 0, 10, 10), rect(20, 20, 10, 10), { op: "statico" }, rect(50, 50, 10, 10)]);
    const r = animateSelection(d, [1, 4], "pulse", boxes(d))!;
    expect(kinds(r.d)).toEqual(["corpo", "forma", "statico", "parte:pulse:pulse", "forma", "forma"]);
    expect(r.shapes).toEqual([4, 5]);
  });

  it("all the shapes of a part: the part changes kind, same id; a signal's shapes lose their material", () => {
    const d = sym([{ op: "corpo" }, rect(0, 0, 10, 10), { op: "parte", id: "fan", kind: "rotor", geo: { cx: 5, cy: 5, symmetry: 60 } },
      rect(40, 40, 20, 20), rect(45, 45, 10, 10)]);
    const r = animateSelection(d, [3, 4], "signal", boxes(d), "#ff0000")!;
    expect(kinds(r.d)).toEqual(["corpo", "forma", "parte:signal:fan", "forma", "forma"]);
    expect(r.d.ops[2].geo).toMatchObject({ color: "#ff0000" });
    expect(r.d.ops[3].mat).toBeNull();
    expect(r.d.ops[4].mat).toBeNull();
  });

  it("a part left without shapes goes, or the symbol would not compile", () => {
    const d = sym([{ op: "corpo" }, rect(0, 0, 10, 10), { op: "parte", id: "fan", kind: "rotor", geo: { cx: 5, cy: 5, symmetry: 60 } },
      rect(40, 40, 20, 20)]);
    const r = animateSelection(d, [1, 3], "vibrate", boxes(d))!;
    expect(kinds(r.d)).toEqual(["corpo", "parte:vibrate:vibrate", "forma", "forma"]);
  });

  it("defaults from the box; ids that don't clash; parameters set and removed", () => {
    expect(partDefaults("needle", { x: 10, y: 10, w: 20, h: 40 })).toEqual({ cx: 20, cy: 30, a0: -120, a1: 120 });
    expect(partDefaults("level", { x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4, dir: "up" });
    const d = sym([{ op: "parte", id: "slide", kind: "slide", geo: { dx: 0, dy: -5 } }, rect(0, 0, 10, 10)]);
    expect(freePartId(d, "slide")).toBe("slide-2");
    const e = setPartParam(d, 0, "transition_ms", 500);
    expect(e.ops[0].geo).toEqual({ dx: 0, dy: -5, transition_ms: 500 });
    expect(setPartParam(e, 0, "transition_ms", undefined).ops[0].geo).toEqual({ dx: 0, dy: -5 });
    expect(setPartKind(d, 0, "pulse", { x: 0, y: 0, w: 10, h: 10 }).ops[0]).toMatchObject({ id: "slide", kind: "pulse", geo: { depth: 0.6 } });
  });
});
