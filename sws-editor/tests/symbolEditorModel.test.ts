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
  absolutePath, align, distribute, explodedOffsets, mapBox, matrixOp, matrixPath, moveLayer, moveToLayer, moveToNewLayer, newCircle, newPath,
  setExtra, turnMatrix, validPathD, type Box,
  animateSelection, partDefaults, setPartKind, setPartParam, freePartId, nothingDrawn,
  addEffect, addIngresso, animateCreatesPart, copyOps, effectPlan, effectsFollowing, freeInputId, groupOps, groupPlan,
  idProblem, inputIds, normalizeId, partOfAGroup, regroupCopies, renameInput, type IdNamespace,
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
    const d = boxed({ it: "Prova", en: "Test" });
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
    const d = boxed({ it: "P", en: "P" });
    const i = layers(d).find((l) => l.id === "body")!.ops[0];
    expect(fillOf(d.ops[i] as Op)).toEqual({ body: true });
    const own = setFill(d, i, { color: "#12ab3c" });
    expect(fillOf(own.ops[i] as Op)).toEqual({ color: "#12ab3c" });
    const mat = setFill(own, i, { mat: "copper" });
    expect(fillOf(mat.ops[i] as Op)).toEqual({ mat: "copper" });
    expect((mat.ops[i] as Op).extra).toEqual([]);
  });
});

/** A new symbol as it started until 21-11-2026: the body with one box in it. */
function boxed(label: { it: string; en: string }) {
  return addInput({ ...emptySymbol(label, []), ops: [] }, "state")!.d;
}

describe("a new symbol", () => {
  it("starts empty, at the size asked, with the body layer open for the first shape", () => {
    const d = emptySymbol({ it: "Caldaia", en: "Boiler" }, ["boiler"], { w: 160, h: 80 });
    expect(d).toMatchObject({ slug: "boiler-2", w: 160, h: 80, it: "Caldaia", en: "Boiler", ops: [{ op: "corpo" }] });
    expect(nothingDrawn(d)).toBe(true);
    expect(inputs(d).map((i) => i.kind)).toEqual(["state"]);
    const r = insertInLayer(d, "body", newRect({ x: 0, y: 0, w: 10, h: 10 }));
    expect(nothingDrawn(r.d)).toBe(false);
    expect(layers(r.d).find((l) => l.id === "body")!.ops).toEqual([r.at]);
  });
});

describe("inputs", () => {
  it("adds one input per behaviour, with a shape and unique ids", () => {
    let d = boxed({ it: "P", en: "P" });
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

  it("a whole layer moves back or forward, with its shapes; static layers follow their new place", () => {
    const x = (o: Record<string, unknown>) => (o.op === "forma" ? (o.geo as [string, number][])[0][1] : String(o.op));
    const d = sym([rect(0, 0, 1, 1), { op: "corpo" }, rect(1, 1, 1, 1), { op: "statico" }, rect(2, 2, 1, 1), rect(3, 3, 1, 1)]);
    // The body forward, past layer-1.
    const fwd = moveLayer(d, "body", 1);
    expect(fwd.d.ops.map(x)).toEqual([0, "statico", 2, 3, "corpo", 1]);
    expect(fwd.at).toEqual([5]);
    expect([...fwd.renamed]).toEqual([]);
    // The first layer, which has no operation of its own, gets one when it moves.
    const first = moveLayer(d, "layer-0", 1);
    expect(first.d.ops.map(x)).toEqual(["corpo", 1, "statico", 0, "statico", 2, 3]);
    expect(first.at).toEqual([3]);
    expect([...first.renamed]).toEqual([["layer-0", "layer-1"], ["layer-1", "layer-2"]]);
    expect(layers(first.d).map((l) => l.id)).toEqual(["layer-0", "body", "layer-1", "layer-2"]);
    // Nothing to do at the ends, nor behind an empty first layer.
    expect(moveLayer(d, "layer-1", 1).at).toEqual([]);
    expect(moveLayer(d, "layer-0", -1).at).toEqual([]);
    const empty = sym([{ op: "corpo" }, rect(0, 0, 1, 1)]);
    expect(moveLayer(empty, "body", -1).d).toBe(empty);
  });

  it("«new static layer» puts the shapes in a layer of their own on top, in their order", () => {
    const d = sym([{ op: "corpo" }, rect(0, 0, 1, 1), rect(1, 1, 1, 1), rect(2, 2, 1, 1)]);
    const r = moveToNewLayer(d, [1, 3]);
    expect(r.d.ops.map((o) => o.op === "forma" ? (o.geo as [string, number][])[0][1] : o.op)).toEqual(["corpo", 1, "statico", 0, 2]);
    expect(r.at).toEqual([3, 4]);
    expect(layers(r.d).map((l) => l.id)).toEqual(["layer-0", "body", "layer-1"]);
  });
});

/** «Anima…» (plan docs/archive/2026-11-19-animazioni-dei-simboli.md, session 2d):
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

/** Names, inputs and effects (test of the rc.29, 23-11-2026, anomaly D of
 *  docs/plans/2026-11-23-correzioni-collaudo-rc30.md): what is made and then
 *  called by name has the name asked; inputs keep the order they were made in;
 *  a renamed or removed input takes its effects along. */
describe("names, inputs and effects (rc.30)", () => {
  const sym = (ops: Op[]): DescrizioneSimbolo => ({ slug: "s", w: 100, h: 100, body: "body-pump", it: "S", en: "S", ops });
  const rect = (x: number, group?: string): Op =>
    ({ op: "forma", tag: "rect", geo: [["x", x], ["y", 0], ["width", 10], ["height", 10]], mat: "steel", extra: [], ...(group ? { group } : {}) });
  const fx = (kind: string, group: string, input: string): Op => ({ op: "effetto", kind, group, input });
  const effects = (d: DescrizioneSimbolo) => (d.ops as Op[]).filter((o) => o.op === "effetto");
  const shared = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/symbol-ids.json"), "utf8")) as Record<IdNamespace, {
    accepted: string[]; rejected: Record<string, string>; editorOnly: Record<string, string>;
  }>;

  it("one rule for the names, the compiler's (cases shared with cargo test)", () => {
    for (const ns of ["input", "port"] as const) {
      for (const id of shared[ns].accepted) expect(idProblem(id, ns), `${ns} ${id}`).toBeNull();
      for (const [id, why] of Object.entries({ ...shared[ns].rejected, ...shared[ns].editorOnly })) {
        expect(idProblem(id, ns), `${ns} ${id}`).toBe(why);
      }
    }
    // `state` is the body's input in the editor; a port may be called so.
    expect(idProblem("state", "input")).toBe("reserved");
    expect(idProblem("state", "port")).toBeNull();
    // What is typed is trimmed and lowercased first.
    expect(normalizeId(" Acceso ")).toBe("acceso");
    expect(idProblem(normalizeId(" Acceso "), "input")).toBeNull();
    expect(idProblem("acceso", "input", ["acceso"])).toBe("taken");
    expect(validPortId("-in")).toBe(false);
  });

  it("a new input goes after the inputs that open the description, in the order they were made", () => {
    const d = sym([{ op: "ingresso", id: "aa" }, { op: "corpo" }, rect(0)]);
    const r = addIngresso(d, "bb")!;
    expect(r.at).toBe(1);
    expect((r.d.ops as Op[]).map((o) => o.op)).toEqual(["ingresso", "ingresso", "corpo", "forma"]);
    // Three in a row stay in that order: the newest is not the first any more.
    const three = addIngresso(addIngresso(r.d, "cc")!.d, "dd")!.d;
    expect(inputIds(three)).toEqual(["aa", "bb", "cc", "dd"]);
    // An input the AI put at the end: the new one goes first, not after it.
    const late = addIngresso(sym([{ op: "corpo" }, rect(0), { op: "ingresso", id: "zz" }]), "yy")!;
    expect(late.at).toBe(0);
    expect((late.d.ops as Op[])[1].op).toBe("corpo");
    // A name that can't be makes nothing.
    expect(addIngresso(d, "aa")).toBeNull();
    expect(addIngresso(d, "body")).toBeNull();
  });

  it("the names offered don't clash with parts nor inputs", () => {
    const d = sym([{ op: "ingresso", id: "slide" }, { op: "ingresso", id: "acceso" }, { op: "corpo" }, rect(0)]);
    expect(freePartId(d, "slide")).toBe("slide-2");
    expect(freeInputId(d, "acceso")).toBe("acceso-2");
    expect(freeInputId(d, "On")).toBe("on");
    expect(freeInputId(d, "?")).toBe("input");
  });

  it("«Add → Input» makes an `ingresso`, the name given; a part takes its name too", () => {
    const d = sym([{ op: "corpo" }, rect(0)]);
    const r = addInput(d, "input", "fiamma")!;
    expect((r.d.ops as Op[])[r.at]).toEqual({ op: "ingresso", id: "fiamma" });
    expect((r.d.ops as Op[]).some((o) => o.op === "parte")).toBe(false);
    expect(addInput(r.d, "input", "fiamma")).toBeNull();
    const p = addInput(r.d, "rotor", "fan")!;
    expect((p.d.ops as Op[])[p.at]).toMatchObject({ op: "parte", id: "fan", kind: "rotor" });
    expect(addInput(r.d, "rotor", "fiamma")).toBeNull();
    expect(addPort(d, 0, 50, "mandata").d.ops.at(-1)).toMatchObject({ op: "bocca", id: "mandata" });
  });

  it("a renamed input or part takes its effects along, and only its own", () => {
    const d = sym([{ op: "ingresso", id: "acceso" }, { op: "ingresso", id: "fumo" }, { op: "corpo" }, rect(0, "a"), rect(20, "b"),
      { op: "parte", id: "fan", kind: "rotor", geo: { cx: 5, cy: 5 } }, rect(40, "c"),
      fx("flame", "a", "acceso"), fx("smoke", "b", "fumo"), fx("glow", "c", "fan")]);
    const a = renameInput(d, 0, "fuoco");
    expect((a.ops as Op[])[0].id).toBe("fuoco");
    expect(effects(a).map((o) => o.input)).toEqual(["fuoco", "fumo", "fan"]);
    const b = renameInput(d, 5, "ventola");
    expect(effects(b).map((o) => o.input)).toEqual(["acceso", "fumo", "ventola"]);
    // A name that can't be, or one already taken: nothing changes.
    expect(renameInput(d, 0, "fumo")).toBe(d);
    expect(renameInput(d, 0, "-x")).toBe(d);
  });

  it("a removed input takes its effects with it, in one step; the body still becomes still", () => {
    const d = sym([{ op: "ingresso", id: "acceso" }, { op: "corpo" }, rect(0, "a"),
      { op: "parte", id: "fan", kind: "rotor", geo: { cx: 5, cy: 5 } }, rect(40, "c"),
      fx("flame", "a", "acceso"), fx("glow", "c", "fan"), fx("smoke", "a", "fan")]);
    expect(effectsFollowing(d, ["fan"]).map((e) => e.at)).toEqual([6, 7]);
    const a = removeInput(d, 0);
    expect((a.ops as Op[]).map((o) => o.op)).toEqual(["corpo", "forma", "parte", "forma", "effetto", "effetto"]);
    expect(effects(a).map((o) => o.input)).toEqual(["fan", "fan"]);
    const b = removeInput(d, 3);
    expect((b.ops as Op[])[3]).toEqual({ op: "statico" });
    expect(effects(b).map((o) => o.input)).toEqual(["acceso"]);
    expect((removeInput(d, 1).ops as Op[])[1]).toEqual({ op: "statico" });
  });

  it("«Anima…» asks a name only when a part is made, and an empty part left behind takes its effects", () => {
    const boxes = new Map([[2, { x: 0, y: 0, w: 10, h: 10 }], [4, { x: 40, y: 0, w: 10, h: 10 }]]);
    const d = sym([{ op: "corpo" }, { op: "statico" }, rect(0, "a"),
      { op: "parte", id: "fan", kind: "rotor", geo: { cx: 45, cy: 5 } }, rect(40, "c"), fx("glow", "c", "fan")]);
    expect(animateCreatesPart(d, [4])).toBe(false); // the shapes of `fan`: only its kind changes
    expect(animateCreatesPart(d, [2])).toBe(true);
    expect(animateCreatesPart(d, [2, 4])).toBe(true);
    const r = animateSelection(d, [2], "slide", boxes, undefined, "cassetto")!;
    expect(inputIds(r.d)).toEqual(["cassetto", "fan"]);
    expect(r.lost).toEqual([]);
    expect(animateSelection(d, [2], "slide", boxes, undefined, "fan")).toBeNull();
    // Both shapes into a new part: `fan` is left empty and goes, with its glow.
    const both = animateSelection(d, [2, 4], "pulse", boxes, undefined, "battito")!;
    expect(inputIds(both.d)).toEqual(["battito"]);
    expect(both.lost.map((f) => f.kind)).toEqual(["glow"]);
    expect(effects(both.d)).toEqual([]);
  });

  it("grouping says the glows and flames it would drop; an effect group is named after the effect", () => {
    const d = sym([{ op: "corpo" }, rect(0, "a"), rect(20, "b"), rect(40), fx("glow", "a", "x"), fx("flame", "b", "x")]);
    expect(groupPlan(d, [1, 2])).toMatchObject({ createsGroup: false, lost: [{ kind: "flame", group: "b" }] });
    expect(groupPlan(d, [3])).toMatchObject({ createsGroup: true, lost: [] });
    // An existing group keeps its name; the one asked is for a new group only.
    expect(groupOps(d, [1, 3], "nuovo").group).toBe("a");
    expect(groupOps(d, [3], "nuovo").group).toBe("nuovo");
    // A flame on a group with a glow replaces it: said first.
    expect(effectPlan(d, [1], "flame").lost.map((f) => f.kind)).toEqual(["glow"]);
    expect(effectPlan(d, [1], "smoke").lost).toEqual([]);
    const one = addEffect(d, [3], "flame", "x", "Fiamma");
    expect(one.group).toBe("fiamma");
    const loose = sym([...(one.d.ops as Op[]), rect(60)]);
    expect(addEffect(loose, [loose.ops.length - 1], "flame", "x", "fiamma").group).toBe("fiamma-2");
    // Some shapes of a group, not all: the effect would go on the whole group.
    const g = sym([{ op: "corpo" }, rect(0, "a"), rect(20, "a")]);
    expect(partOfAGroup(g, [1])).toBe(true);
    expect(partOfAGroup(g, [1, 2])).toBe(false);
  });

  it("a whole group copied is a new group without effects; a shape of a group copied leaves it", () => {
    const d = sym([{ op: "corpo" }, rect(0, "fiamma"), rect(20, "fiamma"), rect(40, "neon"), rect(60, "neon"), fx("flame", "fiamma", "x")]);
    const whole = duplicateOps(d, [1, 2]);
    const copies = whole.added.map((i) => (whole.d.ops as Op[])[i]);
    expect(copies.map((o) => o.group)).toEqual(["fiamma-2", "fiamma-2"]);
    expect(effects(whole.d)).toHaveLength(1);
    const part = duplicateOps(d, [3]);
    expect((part.d.ops as Op[])[part.added[0]].group).toBeUndefined();
    // Pasted into another symbol that has a group of the same name: a new group there too.
    const clip = copyOps(d, [1, 2, 3]);
    expect(clip.map((o) => o.group)).toEqual(["fiamma", "fiamma", undefined]);
    const other = sym([{ op: "corpo" }, rect(0, "fiamma"), fx("glow", "fiamma", "y")]);
    expect(regroupCopies(other, clip).map((o) => o.group)).toEqual(["fiamma-2", "fiamma-2", undefined]);
    expect(regroupCopies(sym([]), clip).map((o) => o.group)).toEqual(["fiamma", "fiamma", undefined]);
  });
});
