// The symbol editor's model: pure functions on a project symbol description
// (`DescrizioneSimbolo`, compiled by `sws-core/src/simboli_prj.rs`).
//
// Plan: docs/plans/2026-11-18-editor-dei-simboli.md, phase 1. A description is
// a list of operations; a layer starts at `statico`, `corpo` or `parte` and the
// shapes after it belong to it. The editor never writes SVG: it changes the
// operations and asks the runtime to compile them, so the drawing is the same
// bytes on the web and on the LVGL panel.

import type { DescrizioneSimbolo } from "@/types";

export type Op = Record<string, unknown> & { op: string };
type Pairs = [string, number | string][];

/** The behaviours a symbol can have today, one per input (phase 1: the live
 *  parts the two engines already draw). */
export type InputKind = "state" | "level" | "rotor" | "needle" | "lever" | "lamp"
  // The animated pieces (plan docs/archive/2026-11-19-animazioni-dei-simboli.md).
  | "slide" | "vibrate" | "pulse" | "signal"
  // The effects (plan docs/plans/2026-11-21-simboli-fase-8-effetti.md).
  | "glow" | "bubbles" | "smoke" | "flame";
export const INPUT_KINDS: InputKind[] = ["state", "level", "rotor", "needle", "lever", "lamp", "slide", "vibrate", "pulse", "signal", "glow", "bubbles", "smoke", "flame"];

/** What «Anima…» offers, by family (the lamp is a signal now: not offered,
 *  but the symbols that have one keep it). */
export const ANIMATE_FAMILIES: { family: string; kinds: InputKind[] }[] = [
  { family: "rotation", kinds: ["rotor", "needle", "lever"] },
  { family: "colour", kinds: ["signal"] },
  { family: "movement", kinds: ["slide", "level"] },
  { family: "vibration", kinds: ["vibrate", "pulse"] },
  { family: "effects", kinds: ["glow", "bubbles", "smoke", "flame"] },
];

export interface Layer {
  /** `layer-N`, `body` or the part id. */
  id: string;
  kind: "static" | "body" | InputKind;
  /** Index of the operation that opens the layer; -1 for the first static one. */
  start: number;
  /** Indexes of the operations that draw in it. */
  ops: number[];
}

/** An input of the symbol: what an object on a page binds a tag to. */
export interface SymbolInput {
  /** `state` for the body, otherwise the part id. */
  id: string;
  kind: InputKind;
  /** The operation that declares it (`corpo` or `parte`). */
  op: number;
}

const DRAWS = new Set(["forma", "luce", "riflesso", "tratto", "flangia_v", "flangia_o", "tubo_o", "tubo_v", "image"]);

export function draws(op: Op): boolean {
  return DRAWS.has(op.op);
}

/** The layers of a description, as the compiler builds them. */
export function layers(d: DescrizioneSimbolo): Layer[] {
  const out: Layer[] = [{ id: "layer-0", kind: "static", start: -1, ops: [] }];
  let statics = 1;
  (d.ops as Op[]).forEach((op, i) => {
    if (op.op === "statico") out.push({ id: `layer-${statics++}`, kind: "static", start: i, ops: [] });
    else if (op.op === "corpo") out.push({ id: "body", kind: "body", start: i, ops: [] });
    else if (op.op === "parte") out.push({ id: String(op.id), kind: op.kind as InputKind, start: i, ops: [] });
    else if (draws(op)) out[out.length - 1].ops.push(i);
  });
  return out;
}

/** The inputs: the body (its colour follows the state) and every live part. */
export function inputs(d: DescrizioneSimbolo): SymbolInput[] {
  const out: SymbolInput[] = [];
  (d.ops as Op[]).forEach((op, i) => {
    if (op.op === "corpo") out.push({ id: "state", kind: "state", op: i });
    else if (op.op === "parte") out.push({ id: String(op.id), kind: op.kind as InputKind, op: i });
  });
  return out;
}

// ── numbers and paths ──────────────────────────────────────────────────────

/** Two decimals, like the compiler writes them. */
export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface Affine { sx: number; sy: number; tx: number; ty: number }
export const IDENTITY: Affine = { sx: 1, sy: 1, tx: 0, ty: 0 };

const px = (a: Affine, x: number) => r2(x * a.sx + a.tx);
const py = (a: Affine, y: number) => r2(y * a.sy + a.ty);

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** A path `d` with every coordinate moved by `a`. Absolute commands are scaled
 *  and moved; relative ones only scaled; arcs scale their radii and keep their
 *  flags. The result uses the same grammar the compiler accepts. */
export function transformPath(d: string, a: Affine): string {
  const out: string[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  for (const m of d.matchAll(re)) {
    const cmd = m[1];
    const up = cmd.toUpperCase();
    const abs = cmd === up;
    const nums = (m[2].match(NUM) ?? []).map(Number);
    const n = ARGS[up];
    if (n === 0) { out.push(cmd); continue; }
    const res: number[] = [];
    for (let k = 0; k + n <= nums.length; k += n) {
      const g = nums.slice(k, k + n);
      const X = (x: number) => (abs ? px(a, x) : r2(x * a.sx));
      const Y = (y: number) => (abs ? py(a, y) : r2(y * a.sy));
      switch (up) {
        case "H": res.push(X(g[0])); break;
        case "V": res.push(Y(g[0])); break;
        case "A":
          res.push(r2(Math.abs(g[0] * a.sx)), r2(Math.abs(g[1] * a.sy)), g[2], g[3], g[4], X(g[5]), Y(g[6]));
          break;
        default:
          for (let j = 0; j < n; j += 2) res.push(X(g[j]), Y(g[j + 1]));
      }
    }
    out.push(cmd + res.join(" "));
  }
  return out.join(" ");
}

function getPair(p: Pairs, k: string): number | undefined {
  const v = p.find(([n]) => n === k)?.[1];
  return typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
}

function mapPairs(p: Pairs, f: (k: string, v: number) => number | undefined): Pairs {
  return p.map(([k, v]) => {
    const n = typeof v === "number" ? v : undefined;
    if (k === "d" && typeof v === "string") return [k, v];
    const r = n === undefined ? undefined : f(k, n);
    return [k, r === undefined ? v : r];
  });
}

function transformGeo(tag: string, geo: Pairs, a: Affine): Pairs {
  const s = Math.sqrt(Math.abs(a.sx * a.sy));
  const out = mapPairs(geo, (k, v) => {
    switch (k) {
      case "x": case "cx": case "x1": case "x2": return px(a, v);
      case "y": case "cy": case "y1": case "y2": return py(a, v);
      case "width": return r2(v * Math.abs(a.sx));
      case "height": return r2(v * Math.abs(a.sy));
      case "r": return r2(v * s);
      case "rx": return r2(v * (tag === "ellipse" ? Math.abs(a.sx) : Math.min(Math.abs(a.sx), Math.abs(a.sy))));
      case "ry": return r2(v * (tag === "ellipse" ? Math.abs(a.sy) : Math.min(Math.abs(a.sx), Math.abs(a.sy))));
      default: return undefined;
    }
  });
  return out.map(([k, v]) => (k === "d" && typeof v === "string" ? [k, transformPath(v, a)] : [k, v]));
}

/** One operation moved and scaled by `a` (the shortcuts and part geometry too). */
export function transformOp(op: Op, a: Affine): Op {
  switch (op.op) {
    case "forma": case "luce": case "riflesso":
      return { ...op, geo: transformGeo(String(op.tag), op.geo as Pairs, a) };
    // A photo moves and resizes like a rectangle (plan 2026-11-21-simboli-fase-3-foto).
    case "image":
      return { ...op, geo: transformGeo("rect", op.geo as Pairs, a) };
    case "tratto":
      return { ...op, d: transformPath(String(op.d), a) };
    case "parte": {
      const geo = { ...(op.geo as Record<string, number>) };
      if (typeof geo.x === "number") geo.x = px(a, geo.x);
      if (typeof geo.y === "number") geo.y = py(a, geo.y);
      if (typeof geo.w === "number") geo.w = r2(geo.w * Math.abs(a.sx));
      if (typeof geo.h === "number") geo.h = r2(geo.h * Math.abs(a.sy));
      if (typeof geo.cx === "number") geo.cx = px(a, geo.cx);
      if (typeof geo.cy === "number") geo.cy = py(a, geo.cy);
      return { ...op, geo };
    }
    case "bocca": {
      // The diameter follows the drawing it attaches to.
      const s = Math.min(Math.abs(a.sx), Math.abs(a.sy));
      return { ...op, x: px(a, Number(op.x)), y: py(a, Number(op.y)), d: r2(Number(op.d) * s) };
    }
    case "flangia": case "tronchetto": {
      const [x, y, w, h] = op.rect as number[];
      return { ...op, rect: [px(a, x), py(a, y), r2(w * Math.abs(a.sx)), r2(h * Math.abs(a.sy))] };
    }
    case "flangia_v": case "flangia_o": case "tubo_o": case "tubo_v": {
      const o: Op = { ...op, x: px(a, Number(op.x)), y: py(a, Number(op.y)) };
      if (typeof op.w === "number") o.w = r2(op.w * Math.abs(a.sx));
      if (typeof op.h === "number") o.h = r2(op.h * Math.abs(a.sy));
      return o;
    }
    default:
      return op;
  }
}

/** A box in viewBox units. */
export interface Box { x: number; y: number; w: number; h: number }

/** The transform that takes box `from` onto box `to`. */
export function boxToBox(from: Box, to: Box): Affine {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  return { sx, sy, tx: to.x - from.x * sx, ty: to.y - from.y * sy };
}

/** Where `a` takes a box (positive scales, as a move or a resize has). */
export function mapBox(b: Box, a: Affine): Box {
  return { x: r2(b.x * a.sx + a.tx), y: r2(b.y * a.sy + a.ty), w: r2(b.w * a.sx), h: r2(b.h * a.sy) };
}

// ── edits: each returns a new description ──────────────────────────────────

function withOps(d: DescrizioneSimbolo, ops: Op[]): DescrizioneSimbolo {
  return { ...d, ops };
}

export function transformOps(d: DescrizioneSimbolo, which: number[], a: Affine): DescrizioneSimbolo {
  const set = new Set(which);
  return withOps(d, (d.ops as Op[]).map((op, i) => (set.has(i) ? transformOp(op, a) : op)));
}

export function deleteOps(d: DescrizioneSimbolo, which: number[]): DescrizioneSimbolo {
  const set = new Set(which);
  return withOps(d, (d.ops as Op[]).filter((_, i) => !set.has(i)));
}

/** Copies of `which`, right after the last of them, moved by `offset`. */
export function duplicateOps(d: DescrizioneSimbolo, which: number[], offset = 4): { d: DescrizioneSimbolo; added: number[] } {
  const ops = [...(d.ops as Op[])];
  const sorted = [...which].sort((a, b) => a - b);
  const at = sorted[sorted.length - 1] + 1;
  const copies = sorted.map((i) => transformOp(structuredClone(ops[i]), { sx: 1, sy: 1, tx: offset, ty: offset }));
  ops.splice(at, 0, ...copies);
  return { d: withOps(d, ops), added: copies.map((_, k) => at + k) };
}

/** Moves operation `i` one step up (later = drawn above) or down, inside its
 *  layer: it never crosses an operation that opens a layer. */
export function reorderOp(d: DescrizioneSimbolo, i: number, dir: 1 | -1): { d: DescrizioneSimbolo; at: number } {
  const ops = [...(d.ops as Op[])];
  const j = i + dir;
  if (j < 0 || j >= ops.length || !draws(ops[j])) return { d, at: i };
  [ops[i], ops[j]] = [ops[j], ops[i]];
  return { d: withOps(d, ops), at: j };
}

/** Inserts `op` at the end of the layer that contains operation `after` (or of
 *  layer `layerId`), and gives back its index. */
export function insertInLayer(d: DescrizioneSimbolo, layerId: string, op: Op): { d: DescrizioneSimbolo; at: number } {
  const ls = layers(d);
  const l = ls.find((x) => x.id === layerId) ?? ls[ls.length - 1];
  const next = ls[ls.indexOf(l) + 1];
  const at = next ? next.start : d.ops.length;
  const ops = [...(d.ops as Op[])];
  ops.splice(at, 0, op);
  return { d: withOps(d, ops), at };
}

/** The extensions a photo in a symbol may have: the ones both engines decode
 *  (`IMAGE_EXTENSIONS` in `simboli_prj.rs`). */
export const PHOTO_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

export function photoNameOk(name: string): boolean {
  return /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/.test(name) && !name.includes("..")
    && PHOTO_EXTENSIONS.includes(name.split(".").pop()!.toLowerCase());
}

/** A photo of `size` pixels, as large as it fits in the drawing `w × h` and
 *  centred, proportions kept (plan 2026-11-21-simboli-fase-3-foto). */
export function newImage(src: string, w: number, h: number, size?: { width: number; height: number }): Op {
  const ratio = size && size.width > 0 && size.height > 0 ? size.width / size.height : w / h;
  const bw = ratio >= w / h ? w : h * ratio;
  const bh = ratio >= w / h ? w / ratio : h;
  return { op: "image", src, geo: [["x", r2((w - bw) / 2)], ["y", r2((h - bh) / 2)], ["width", r2(bw)], ["height", r2(bh)]] };
}

/** The opacity of a photo, 0..1 (`undefined` = opaque). */
export function setImageOpacity(d: DescrizioneSimbolo, i: number, opacity: number | undefined): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = { ...ops[i] };
  if (opacity === undefined || opacity >= 1) delete op.opacity;
  else op.opacity = r2(Math.max(0, opacity));
  ops[i] = op;
  return withOps(d, ops);
}

export function newRect(b: Box, mat = "steel"): Op {
  return {
    op: "forma", tag: "rect",
    geo: [["x", r2(b.x)], ["y", r2(b.y)], ["width", r2(b.w)], ["height", r2(b.h)]],
    mat, velo: null, extra: [],
  };
}

export function newEllipse(b: Box, mat = "steel"): Op {
  return {
    op: "forma", tag: "ellipse",
    geo: [["cx", r2(b.x + b.w / 2)], ["cy", r2(b.y + b.h / 2)], ["rx", r2(b.w / 2)], ["ry", r2(b.h / 2)]],
    mat, velo: null, extra: [],
  };
}

export function newCircle(b: Box, mat = "steel"): Op {
  const r = r2(Math.min(b.w, b.h) / 2);
  return { op: "forma", tag: "circle", geo: [["cx", r2(b.x + b.w / 2)], ["cy", r2(b.y + b.h / 2)], ["r", r]], mat, velo: null, extra: [] };
}

/** A path through `points`: closed it is a filled shape, open a line. */
export function newPath(points: [number, number][], closed: boolean): Op {
  const d = points.map(([x, y], k) => `${k ? "L" : "M"}${r2(x)} ${r2(y)}`).join(" ") + (closed ? " Z" : "");
  return closed
    ? { op: "forma", tag: "path", geo: [["d", d]], mat: "steel", velo: null, extra: [] }
    : { op: "tratto", d, mat: "steel-dark", extra: [["stroke_width", 2]] };
}

/** A path `d` the compiler accepts (`path_ammesso`): commands and numbers only,
 *  on one line, at most 4000 characters. */
export function validPathD(d: string): boolean {
  return d.length > 0 && d.length <= 4000 && /^[MmLlHhVvCcSsQqTtAaZz0-9.,\-+eE ]+$/.test(d);
}

/** Sets the `d` of a path (a `tratto`, or a `forma` path). */
export function setPathD(d: DescrizioneSimbolo, i: number, path: string): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = ops[i];
  if (op.op === "tratto") ops[i] = { ...op, d: path };
  else if (op.op === "forma") ops[i] = { ...op, geo: (op.geo as Pairs).map(([k, v]) => [k, k === "d" ? path : v]) };
  return withOps(d, ops);
}

/** Sets (or, with `undefined`, removes) one extra attribute: `stroke`,
 *  `fill_opacity`, `stroke_dasharray`… */
export function setExtra(d: DescrizioneSimbolo, i: number, key: string, value: number | string | undefined): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = { ...ops[i] };
  const extra = ((op.extra as Pairs | undefined) ?? []).filter(([k]) => k !== key);
  op.extra = value === undefined ? extra : [...extra, [key, typeof value === "number" ? r2(value) : value]];
  ops[i] = op;
  return withOps(d, ops);
}

export function extraOf(op: Op, key: string): number | string | undefined {
  return (op.extra as Pairs | undefined)?.find(([k]) => k === key)?.[1];
}

/** A straight path from (x1, y1) to (x2, y2): a line with the outline. */
export function newLine(x1: number, y1: number, x2: number, y2: number): Op {
  return { op: "tratto", d: `M${r2(x1)} ${r2(y1)} L${r2(x2)} ${r2(y2)}`, mat: "steel-dark", extra: [["stroke_width", 2]] };
}

/** How an operation is coloured: a material, its own colour, or the body's. */
export type Fill = { mat: string } | { color: string } | { body: true } | { none: true };

export function fillOf(op: Op): Fill | undefined {
  if (op.op === "forma") {
    if (typeof op.mat === "string") return { mat: op.mat };
    const c = (op.extra as Pairs | undefined)?.find(([k]) => k === "fill")?.[1];
    if (typeof c === "string" && c.startsWith("#")) return { color: c };
    // `fill: none` (17 library shapes: rims, outlines) is no fill, not the
    // colour of the state: choosing it filled them (phase 1).
    if (c === "none") return { none: true };
    return { body: true };
  }
  if (op.op === "tratto") {
    if (typeof op.mat === "string") return { mat: op.mat };
    const c = (op.extra as Pairs | undefined)?.find(([k]) => k === "stroke")?.[1];
    if (typeof c === "string" && c.startsWith("#")) return { color: c };
  }
  return undefined;
}

/** Sets the colour of a shape or line: a material, or its own `#rrggbb`. A
 *  shape in the body with neither takes the colour of the state. */
export function setFill(d: DescrizioneSimbolo, i: number, f: Fill): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = { ...ops[i] };
  const key = op.op === "tratto" ? "stroke" : "fill";
  const extra = ((op.extra as Pairs | undefined) ?? []).filter(([k]) => k !== key);
  if ("mat" in f) { op.mat = f.mat; op.extra = extra; }
  else if ("color" in f) { op.mat = null; op.extra = [...extra, [key, f.color]]; }
  else if ("none" in f) { op.mat = null; op.extra = [...extra, [key, "none"]]; }
  else { op.mat = null; op.extra = extra; }
  ops[i] = op;
  return withOps(d, ops);
}

export function setVeil(d: DescrizioneSimbolo, i: number, veil: string | null): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  ops[i] = { ...ops[i], velo: veil };
  return withOps(d, ops);
}

/** Sets one numeric attribute of the geometry (`x`, `r`…) or of the extras
 *  (`stroke_width`). */
export function setGeo(d: DescrizioneSimbolo, i: number, key: string, value: number): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = { ...ops[i] };
  const geo = (op.geo as Pairs | undefined) ?? [];
  if (Array.isArray(op.geo) && geo.some(([k]) => k === key)) {
    op.geo = geo.map(([k, v]) => (k === key ? [k, r2(value)] : [k, v]));
  } else {
    const extra = ((op.extra as Pairs | undefined) ?? []).filter(([k]) => k !== key);
    op.extra = [...extra, [key, r2(value)]];
  }
  ops[i] = op;
  return withOps(d, ops);
}

// ── inputs (the live parts) ────────────────────────────────────────────────

/** A new input of `kind`, with the geometry its part needs and one shape to
 *  start from, at the end of the drawing (above everything). The `state`
 *  input is the body: there is at most one. */
export function addInput(d: DescrizioneSimbolo, kind: InputKind): { d: DescrizioneSimbolo; at: number } | null {
  const ops = [...(d.ops as Op[])];
  const { w, h } = d;
  const cx = r2(w / 2), cy = r2(h / 2), m = Math.min(w, h);
  if (kind === "state") {
    if (ops.some((o) => o.op === "corpo")) return null;
    const at = ops.length;
    ops.push({ op: "corpo" }, { ...newRect({ x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 }), mat: null, velo: "paint-h" });
    return { d: withOps(d, ops), at };
  }
  const id = freePartId(d, kind);
  const geo: Record<string, unknown> =
    kind === "rotor" ? { cx, cy, symmetry: 120 }
    : partDefaults(kind, { x: r2(w * 0.3), y: r2(h * 0.2), w: r2(w * 0.4), h: r2(h * 0.6) });
  const g = geo as Record<string, number>;
  const shape: Op =
    kind === "level" ? { ...newRect({ x: g.x, y: g.y, w: g.w, h: g.h }, "liquid") }
    : kind === "rotor" ? newEllipse({ x: cx - m * 0.2, y: cy - m * 0.05, w: m * 0.4, h: m * 0.1 }, "impeller-vane")
    : kind === "needle" ? newRect({ x: cx - 1, y: cy - m * 0.35, w: 2, h: m * 0.35 }, "signal-red")
    : kind === "lever" ? newRect({ x: cx - m * 0.3, y: cy - 2, w: m * 0.6, h: 4 }, "steel-dark")
    : kind === "slide" || kind === "vibrate" ? newRect({ x: w * 0.3, y: h * 0.4, w: w * 0.4, h: h * 0.2 }, "steel")
    : kind === "pulse" ? newEllipse({ x: cx - m * 0.1, y: cy - m * 0.1, w: m * 0.2, h: m * 0.2 }, "steel")
    // A signal's shapes take the colour of the layer: no material.
    : kind === "signal" ? { ...newEllipse({ x: cx - m * 0.1, y: cy - m * 0.1, w: m * 0.2, h: m * 0.2 }), mat: null }
    : newEllipse({ x: cx - m * 0.1, y: cy - m * 0.1, w: m * 0.2, h: m * 0.2 }, "lamp-green");
  const at = ops.length;
  ops.push({ op: "parte", id, kind, geo }, shape);
  return { d: withOps(d, ops), at };
}

/** Removes an input. Its shapes stay, drawn in the layer before it: removing
 *  the rotation of a fan does not remove the fan. */
export function removeInput(d: DescrizioneSimbolo, opIndex: number): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = ops[opIndex];
  if (op?.op !== "corpo" && op?.op !== "parte") return d;
  ops.splice(opIndex, 1, { op: "statico" });
  return withOps(d, ops);
}

/** Sets a number of a part's geometry (`cx`, `cy`, `symmetry`, `a0`…). */
export function setPartGeo(d: DescrizioneSimbolo, opIndex: number, key: string, value: number): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = ops[opIndex];
  if (op?.op !== "parte") return d;
  ops[opIndex] = { ...op, geo: { ...(op.geo as Record<string, number>), [key]: r2(value) } };
  return withOps(d, ops);
}

/** A part id not used yet: the kind, then `kind-2`, `kind-3`… */
export function freePartId(d: DescrizioneSimbolo, kind: string): string {
  const used = new Set((d.ops as Op[]).filter((o) => o.op === "parte").map((o) => String(o.id)));
  let id = kind;
  for (let n = 2; used.has(id); n++) id = `${kind}-${n}`;
  return id;
}

/** The parameters a new piece of `kind` starts with, from the box of its
 *  shapes: the pivot in the middle, the window on the box, a slide going up by
 *  half its height. The engines have the same defaults for what is left out. */
export function partDefaults(kind: InputKind, b: Box, colour?: string): Record<string, unknown> {
  const cx = r2(b.x + b.w / 2), cy = r2(b.y + b.h / 2);
  switch (kind) {
    case "rotor": return { cx, cy, symmetry: 360 };
    case "needle": return { cx, cy, a0: -120, a1: 120 };
    case "lever": return { cx, cy, open: 0, closed: 90 };
    case "level": return { x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h), dir: "up" };
    case "slide": return { dx: 0, dy: -r2(Math.max(1, b.h / 2)), transition_ms: 300 };
    case "vibrate": return { amplitude: 1, axis: "x", period_ms: 200 };
    case "pulse": return { depth: 0.6, period_ms: 1000 };
    case "glow": return { radius: 4 };
    case "bubbles": return { x: r2(b.x), y: r2(b.y), w: r2(Math.max(2, b.w)), h: r2(Math.max(2, b.h)), count: 6, period_ms: 2000 };
    case "smoke": return { x: r2(b.x), y: r2(b.y), w: r2(Math.max(2, b.w)), h: r2(Math.max(2, b.h)), period_ms: 2000 };
    case "flame": return { x: r2(b.x), y: r2(b.y), w: r2(Math.max(2, b.w)), h: r2(Math.max(2, b.h)), period_ms: 800 };
    case "signal": return {
      color: colour ?? "#64748b",
      entries: [{ value: 1, color: "#22c55e" }, { value: 2, color: "#ef4444", blink: true }],
    };
    default: return {};
  }
}

/** Sets (or, with `undefined`, removes) a parameter of a part: a number, a
 *  text, a yes/no, the entries of a signal. */
export function setPartParam(d: DescrizioneSimbolo, opIndex: number, key: string, value: unknown): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = ops[opIndex];
  if (op?.op !== "parte") return d;
  const geo = { ...(op.geo as Record<string, unknown>) };
  if (value === undefined) delete geo[key];
  else geo[key] = typeof value === "number" ? r2(value) : value;
  ops[opIndex] = { ...op, geo };
  return withOps(d, ops);
}

/** Another kind for a part: the same id and shapes, the parameters of the new
 *  kind from the box of its shapes. */
export function setPartKind(d: DescrizioneSimbolo, opIndex: number, kind: InputKind, box: Box, colour?: string): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = ops[opIndex];
  if (op?.op !== "parte" || kind === "state") return d;
  ops[opIndex] = { ...op, kind, geo: partDefaults(kind, box, colour) };
  let out = withOps(d, ops);
  if (kind === "signal") out = shapesTakeLayerColour(out, layers(out).find((l) => l.start === opIndex)?.ops ?? []);
  return out;
}

/** The shapes of a signal take the colour of the layer: their material goes. */
function shapesTakeLayerColour(d: DescrizioneSimbolo, which: number[]): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  for (const i of which) if (ops[i]?.op === "forma") ops[i] = { ...ops[i], mat: null };
  return withOps(d, ops);
}

/** «Anima…»: the shapes `which` become a piece of `kind` (plan
 *  2026-11-19-animazioni-dei-simboli, decision 1: a piece is a layer). The new
 *  layer goes at the end of the layer holding the topmost of them, so every
 *  other shape stays in its layer; a part layer left empty goes. When `which`
 *  is exactly the shapes of one part, that part changes kind instead. */
export function animateSelection(
  d: DescrizioneSimbolo, which: number[], kind: InputKind, boxes: Map<number, Box>, colour?: string,
): { d: DescrizioneSimbolo; part: number; shapes: number[] } | null {
  const shapes = [...new Set(which)].filter((i) => draws(d.ops[i] as Op)).sort((a, b) => a - b);
  if (!shapes.length || kind === "state") return null;
  const box = union(shapes.map((i) => boxes.get(i)).filter((b): b is Box => !!b)) ?? { x: 0, y: 0, w: d.w, h: d.h };
  const ls = layers(d);
  const whole = ls.find((l) => l.start >= 0 && (d.ops[l.start] as Op).op === "parte"
    && l.ops.length === shapes.length && l.ops.every((i) => shapes.includes(i)));
  if (whole) {
    const out = setPartKind(d, whole.start, kind, box, colour);
    return { d: out, part: whole.start, shapes: layers(out).find((l) => l.start === whole.start)?.ops ?? shapes };
  }
  const top = shapes[shapes.length - 1];
  const host = ls.find((l) => l.ops.includes(top)) ?? ls[ls.length - 1];
  const id = freePartId(d, kind);
  const r = insertInLayer(d, host.id, { op: "parte", id, kind, geo: partDefaults(kind, box, colour) });
  // The shapes are all before the new opener: their indexes stay.
  let out = moveToLayer(r.d, shapes, id).d;
  // A part layer left with no shape would not compile: it goes.
  const empty = layers(out).filter((l) => l.start >= 0 && (out.ops[l.start] as Op).op === "parte" && l.ops.length === 0 && l.id !== id);
  if (empty.length) out = withOps(out, (out.ops as Op[]).filter((_, i) => !empty.some((l) => l.start === i)));
  const mine = layers(out).find((l) => l.id === id)!;
  if (kind === "signal") out = shapesTakeLayerColour(out, mine.ops);
  return { d: out, part: mine.start, shapes: mine.ops };
}

/** Renames a part (its layer id). Objects bind tags by this id. */
export function renamePart(d: DescrizioneSimbolo, opIndex: number, id: string): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = ops[opIndex];
  if (op?.op !== "parte") return d;
  ops[opIndex] = { ...op, id };
  return withOps(d, ops);
}

// ── quarter turns and mirrors ──────────────────────────────────────────────
//
// The format has no `transform` (phase 2, 19-11-2026): a rotation by 90° or a
// mirror is written into the geometry. `Matrix` is [a, b, c, d, e, f]:
// x' = a·x + c·y + e, y' = b·x + d·y + f, with a…d in {-1, 0, 1}.

export type Matrix = [number, number, number, number, number, number];

/** The quarter turn (`dir` 1 = clockwise on screen) or mirror about (cx, cy). */
export function turnMatrix(kind: "cw" | "ccw" | "flipH" | "flipV", cx: number, cy: number): Matrix {
  const [a, b, c, d] =
    kind === "cw" ? [0, 1, -1, 0] : kind === "ccw" ? [0, -1, 1, 0] : kind === "flipH" ? [-1, 0, 0, 1] : [1, 0, 0, -1];
  return [a, b, c, d, cx - a * cx - c * cy, cy - b * cx - d * cy];
}

const apply = (m: Matrix, x: number, y: number): [number, number] => [r2(m[0] * x + m[2] * y + m[4]), r2(m[1] * x + m[3] * y + m[5])];
const swapsAxes = (m: Matrix) => m[0] === 0;

/** A path with only absolute commands, H and V written as L: what a quarter
 *  turn or a mirror needs, since a horizontal line may become a vertical one. */
export function absolutePath(d: string): string {
  const out: string[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  for (const m of d.matchAll(re)) {
    const cmd = m[1];
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    const nums = (m[2].match(NUM) ?? []).map(Number);
    if (up === "Z") { out.push("Z"); cx = sx; cy = sy; continue; }
    const n = ARGS[up];
    for (let k = 0; k + n <= nums.length; k += n) {
      const g = nums.slice(k, k + n);
      const X = (v: number) => (rel ? cx + v : v), Y = (v: number) => (rel ? cy + v : v);
      switch (up) {
        case "H": { const x = X(g[0]); out.push(`L${r2(x)} ${r2(cy)}`); cx = x; break; }
        case "V": { const y = Y(g[0]); out.push(`L${r2(cx)} ${r2(y)}`); cy = y; break; }
        case "A": {
          const x = X(g[5]), y = Y(g[6]);
          out.push(`A${g[0]} ${g[1]} ${g[2]} ${g[3]} ${g[4]} ${r2(x)} ${r2(y)}`);
          cx = x; cy = y; break;
        }
        default: {
          const pts: number[] = [];
          for (let j = 0; j < n; j += 2) pts.push(r2(X(g[j])), r2(Y(g[j + 1])));
          // `M` with more pairs: the next ones are lines.
          out.push(`${up === "M" && k > 0 ? "L" : up}${pts.join(" ")}`);
          cx = pts[n - 2]; cy = pts[n - 1];
          if (up === "M" && k === 0) { sx = cx; sy = cy; }
        }
      }
    }
  }
  return out.join(" ");
}

/** A path turned or mirrored by `m`: every point moved; an arc swaps its radii
 *  on a quarter turn, turns its axis, and flips its sweep on a mirror. */
export function matrixPath(d: string, m: Matrix): string {
  const mirror = m[0] * m[3] - m[1] * m[2] < 0;
  const out: string[] = [];
  const re = /([MLCSQTAZ])([^MLCSQTAZ]*)/g;
  for (const x of absolutePath(d).matchAll(re)) {
    const up = x[1];
    const g = (x[2].match(NUM) ?? []).map(Number);
    if (up === "Z") { out.push("Z"); continue; }
    if (up === "A") {
      const [rx, ry, rot, large, sweep, ex, ey] = g;
      const [nx, ny] = apply(m, ex, ey);
      const [nrx, nry] = swapsAxes(m) ? [ry, rx] : [rx, ry];
      out.push(`A${nrx} ${nry} ${r2(swapsAxes(m) ? rot + 90 : mirror ? -rot : rot)} ${large} ${mirror ? 1 - sweep : sweep} ${nx} ${ny}`);
      continue;
    }
    const pts: number[] = [];
    for (let j = 0; j + 1 < g.length; j += 2) pts.push(...apply(m, g[j], g[j + 1]));
    out.push(up + pts.join(" "));
  }
  return out.join(" ");
}

function matrixGeo(tag: string, geo: Pairs, m: Matrix): Pairs {
  const get = (k: string) => getPair(geo, k);
  const set = (vals: Record<string, number | string>): Pairs => geo.map(([k, v]) => [k, k in vals ? vals[k] : v]);
  switch (tag) {
    case "rect": {
      const x = get("x") ?? 0, y = get("y") ?? 0, w = get("width") ?? 0, h = get("height") ?? 0;
      const [x0, y0] = apply(m, x, y), [x1, y1] = apply(m, x + w, y + h);
      const vals: Record<string, number> = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: r2(Math.abs(x1 - x0)), height: r2(Math.abs(y1 - y0)) };
      if (swapsAxes(m) && get("rx") !== undefined && get("ry") !== undefined) { vals.rx = get("ry")!; vals.ry = get("rx")!; }
      return set(vals);
    }
    case "ellipse": {
      const [cx, cy] = apply(m, get("cx") ?? 0, get("cy") ?? 0);
      return set(swapsAxes(m) ? { cx, cy, rx: get("ry") ?? 0, ry: get("rx") ?? 0 } : { cx, cy });
    }
    case "circle": {
      const [cx, cy] = apply(m, get("cx") ?? 0, get("cy") ?? 0);
      return set({ cx, cy });
    }
    case "path":
      return set({ d: matrixPath(String(geo.find(([k]) => k === "d")?.[1] ?? ""), m) });
    default:
      return geo;
  }
}

const TURN_SIDE: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

/** One operation turned or mirrored (shapes, lines and ports; the rest as is). */
export function matrixOp(op: Op, m: Matrix): Op {
  switch (op.op) {
    case "forma": case "luce": case "riflesso":
      return { ...op, geo: matrixGeo(String(op.tag), op.geo as Pairs, m) };
    case "tratto":
      return { ...op, d: matrixPath(String(op.d), m) };
    case "bocca": {
      const [x, y] = apply(m, Number(op.x), Number(op.y));
      const v = TURN_SIDE[String(op.side)] ?? [-1, 0];
      const nv = [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
      const side = Object.entries(TURN_SIDE).find(([, s]) => s[0] === nv[0] && s[1] === nv[1])?.[0] ?? op.side;
      return { ...op, x, y, side };
    }
    default:
      return op;
  }
}

export function matrixOps(d: DescrizioneSimbolo, which: number[], m: Matrix): DescrizioneSimbolo {
  const set = new Set(which);
  return withOps(d, (d.ops as Op[]).map((op, i) => (set.has(i) ? matrixOp(op, m) : op)));
}

// ── align and distribute ───────────────────────────────────────────────────

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** Aligns the operations `which` (their boxes in `boxes`) on the selection box. */
export function align(d: DescrizioneSimbolo, which: number[], boxes: Map<number, Box>, mode: AlignMode): DescrizioneSimbolo {
  const bs = which.map((i) => [i, boxes.get(i)] as const).filter((x): x is readonly [number, Box] => !!x[1]);
  const u = union(bs.map(([, b]) => b));
  if (!u) return d;
  let out = d;
  for (const [i, b] of bs) {
    const dx = mode === "left" ? u.x - b.x : mode === "right" ? u.x + u.w - (b.x + b.w) : mode === "hcenter" ? u.x + u.w / 2 - (b.x + b.w / 2) : 0;
    const dy = mode === "top" ? u.y - b.y : mode === "bottom" ? u.y + u.h - (b.y + b.h) : mode === "vcenter" ? u.y + u.h / 2 - (b.y + b.h / 2) : 0;
    if (dx || dy) out = transformOps(out, [i], { sx: 1, sy: 1, tx: r2(dx), ty: r2(dy) });
  }
  return out;
}

/** Spreads the operations evenly: the same gap between one and the next,
 *  the first and the last where they are. */
export function distribute(d: DescrizioneSimbolo, which: number[], boxes: Map<number, Box>, axis: "h" | "v"): DescrizioneSimbolo {
  const bs = which.map((i) => [i, boxes.get(i)] as const).filter((x): x is readonly [number, Box] => !!x[1]);
  if (bs.length < 3) return d;
  const pos = (b: Box) => (axis === "h" ? b.x : b.y), size = (b: Box) => (axis === "h" ? b.w : b.h);
  const sorted = [...bs].sort((a, b) => pos(a[1]) - pos(b[1]));
  const first = sorted[0][1], last = sorted[sorted.length - 1][1];
  const free = pos(last) + size(last) - pos(first) - sorted.reduce((s, [, b]) => s + size(b), 0);
  const gap = free / (sorted.length - 1);
  let at = pos(first) + size(first) + gap;
  let out = d;
  for (const [i, b] of sorted.slice(1, -1)) {
    const delta = r2(at - pos(b));
    if (delta) out = transformOps(out, [i], axis === "h" ? { sx: 1, sy: 1, tx: delta, ty: 0 } : { sx: 1, sy: 1, tx: 0, ty: delta });
    at += size(b) + gap;
  }
  return out;
}

// ── exploded view ──────────────────────────────────────────────────────────

/** How far each operation moves in the exploded view: away from the centre of
 *  the symbol, along the line from it to the centre of its box, by `k` times
 *  that distance (at least a third of the symbol, so a small offset still
 *  shows). Shapes around the centre — a pump's body, its ring, its impeller —
 *  have no direction of their own: they open as a fan, one direction each, in
 *  the order they are drawn. Operations in one of `groups` (a grouped layer)
 *  move as one: one offset, from the box around all of them. Only for the
 *  view: the geometry does not change. */
export function explodedOffsets(
  boxes: Map<number, Box>, centre: [number, number], k: number, size = 100, groups: number[][] = [],
): Map<number, [number, number]> {
  const near = 0.15 * size, min = 0.35 * size;
  // What moves: a group, or a shape on its own; in the order they are drawn.
  const grouped = groups.map((g) => g.filter((i) => boxes.has(i)).sort((a, b) => a - b)).filter((g) => g.length);
  const inGroup = new Set(grouped.flat());
  const units = [...[...boxes.keys()].filter((i) => !inGroup.has(i)).map((i) => [i]), ...grouped].sort((a, b) => a[0] - b[0]);
  const vec = (u: number[]): [number, number] => {
    const b = union(u.map((i) => boxes.get(i)!))!;
    return [b.x + b.w / 2 - centre[0], b.y + b.h / 2 - centre[1]];
  };
  const central = units.filter((u) => Math.hypot(...vec(u)) < near);
  const out = new Map<number, [number, number]>();
  for (const u of units) {
    let [vx, vy] = vec(u);
    let len = Math.hypot(vx, vy);
    let mag = k * Math.max(len, min);
    if (len < near) {
      const a = -Math.PI / 2 + (2 * Math.PI * central.indexOf(u)) / central.length;
      [vx, vy, len, mag] = [Math.cos(a), Math.sin(a), 1, k * min];
    }
    for (const i of u) out.set(i, [r2((vx / len) * mag), r2((vy / len) * mag)]);
  }
  return out;
}

// ── layers ─────────────────────────────────────────────────────────────────

/** Moves the operations `which` to the end of layer `layerId`, in their order;
 *  gives back their new indexes. */
export function moveToLayer(d: DescrizioneSimbolo, which: number[], layerId: string): { d: DescrizioneSimbolo; at: number[] } {
  const set = new Set(which);
  const moving = (d.ops as Op[]).filter((_, i) => set.has(i));
  let out = withOps(d, (d.ops as Op[]).filter((_, i) => !set.has(i)));
  const at: number[] = [];
  for (const op of moving) {
    const r = insertInLayer(out, layerId, op);
    out = r.d;
    at.push(r.at);
  }
  return { d: out, at };
}

/** A whole layer one place back (`-1`, up in the list) or forward (`1`), with
 *  its shapes and its behaviour: the order of the layers is the order they
 *  are drawn in (collaudo of 20-11-2026). The first layer has no operation of
 *  its own: when it moves it gets a `statico`. `renamed` = the ids that
 *  change (static layers are named by their place); `at` = the moved shapes. */
export function moveLayer(d: DescrizioneSimbolo, layerId: string, dir: 1 | -1):
  { d: DescrizioneSimbolo; at: number[]; renamed: Map<string, string> } {
  const ops = d.ops as Op[];
  const ls = layers(d);
  const k = ls.findIndex((l) => l.id === layerId);
  const none = { d, at: [] as number[], renamed: new Map<string, string>() };
  const j = k + dir;
  if (k < 0 || j < 0 || j >= ls.length) return none;
  const begin = (i: number) => (i === 0 ? 0 : ls[i].start);
  const end = (i: number) => (i + 1 < ls.length ? ls[i + 1].start : ops.length);
  const [a, b] = k < j ? [k, j] : [j, k];
  const blockA = ops.slice(begin(a), end(a)), blockB = ops.slice(begin(b), end(b));
  // An empty first layer: there is nothing to go behind of.
  if (a === 0 && !blockA.some(draws)) return none;
  const behind = a === 0 ? [{ op: "statico" }, ...blockA] : blockA;
  const out = [...ops.slice(0, begin(a)), ...blockB, ...behind, ...ops.slice(end(b))];
  const nd = withOps(d, out);
  const nls = layers(nd);
  const renamed = new Map<string, string>();
  let at: number[] = [];
  for (const l of ls) {
    // A layer is the operation that opens it, or (the first) its first shape.
    const ref = l.start >= 0 ? ops[l.start] : ops[l.ops[0]];
    if (!ref) continue;
    const idx = out.indexOf(ref);
    const nl = nls.find((x) => x.start === idx || (l.start < 0 && x.ops.includes(idx)));
    if (!nl) continue;
    if (nl.id !== l.id) renamed.set(l.id, nl.id);
    if (l.id === layerId) at = nl.ops;
  }
  return { d: nd, at, renamed };
}

/** The layer id that means «a new static layer on top» in «Move to layer». */
export const NEW_LAYER = "__new__";

/** The shapes moved into a new static layer on top of the others (collaudo of
 *  20-11-2026: an imported drawing could not be split into layers of its own). */
export function moveToNewLayer(d: DescrizioneSimbolo, which: number[]): { d: DescrizioneSimbolo; at: number[] } {
  const set = new Set(which);
  const moving = (d.ops as Op[]).filter((_, i) => set.has(i));
  const rest = (d.ops as Op[]).filter((_, i) => !set.has(i));
  const start = rest.length + 1;
  return { d: withOps(d, [...rest, { op: "statico" }, ...moving]), at: moving.map((_, k) => start + k) };
}

// ── pipe ports (`bocca`) ───────────────────────────────────────────────────
//
// Symbol editor phase 2 (19-11-2026): the ports are `bocca` operations with an
// id, made explicit when the editor opens a symbol (`/api/symbols/explicit-ports`),
// so they move and change one by one and the pipes attached keep their id.

export type Side = "left" | "top" | "right" | "bottom";
export const SIDES: Side[] = ["left", "top", "right", "bottom"];

export interface Port { op: number; id: string; x: number; y: number; side: Side; d: number }

export function ports(d: DescrizioneSimbolo): Port[] {
  return (d.ops as Op[]).flatMap((op, i) => op.op === "bocca"
    ? [{ op: i, id: String(op.id ?? ""), x: Number(op.x), y: Number(op.y), side: (SIDES.includes(op.side as Side) ? op.side : "left") as Side, d: Number(op.d) }]
    : []);
}

/** Operations the compiler turns into ports by itself (a flange on the border,
 *  a declared port without an id): the editor makes them explicit first. */
export function needsExplicitPorts(d: DescrizioneSimbolo): boolean {
  return (d.ops as Op[]).some((op) => ["flangia", "tronchetto", "flangia_v", "flangia_o", "tubo_o", "tubo_v"].includes(op.op)
    || (op.op === "bocca" && !op.id));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The side of the border nearest to (x, y), and the point on it. */
export function nearestEdge(w: number, h: number, x: number, y: number): { side: Side; x: number; y: number } {
  const c: { side: Side; dist: number; x: number; y: number }[] = [
    { side: "left", dist: Math.abs(x), x: 0, y: clamp(y, 0, h) },
    { side: "top", dist: Math.abs(y), x: clamp(x, 0, w), y: 0 },
    { side: "right", dist: Math.abs(w - x), x: w, y: clamp(y, 0, h) },
    { side: "bottom", dist: Math.abs(h - y), x: clamp(x, 0, w), y: h },
  ];
  const best = c.reduce((a, b) => (b.dist < a.dist ? b : a));
  return { side: best.side, x: r2(best.x), y: r2(best.y) };
}

/** A port id not used yet: `p1`, `p2`… */
export function freePortId(d: DescrizioneSimbolo): string {
  const used = new Set(ports(d).map((p) => p.id));
  let n = 1;
  while (used.has(`p${n}`)) n++;
  return `p${n}`;
}

/** A new port on the border nearest to (x, y), with the diameter of the last
 *  one (or 10), at the end of the operations. */
export function addPort(d: DescrizioneSimbolo, x: number, y: number): { d: DescrizioneSimbolo; at: number } {
  const e = nearestEdge(d.w, d.h, x, y);
  const last = ports(d).at(-1);
  const ops = [...(d.ops as Op[]), { op: "bocca", x: e.x, y: e.y, side: e.side, d: last?.d ?? 10, id: freePortId(d) }];
  return { d: withOps(d, ops), at: ops.length - 1 };
}

function onBorder(p: { x: number; y: number; side: Side }, w: number, h: number): boolean {
  return (p.side === "left" && p.x === 0) || (p.side === "right" && p.x === w)
    || (p.side === "top" && p.y === 0) || (p.side === "bottom" && p.y === h);
}

/** Port `i` moved to (x, y): one on the border slides along its side, one
 *  inside the drawing moves freely (within it). */
export function movePort(d: DescrizioneSimbolo, i: number, x: number, y: number): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = ops[i];
  if (op?.op !== "bocca") return d;
  const p = { x: Number(op.x), y: Number(op.y), side: op.side as Side };
  let nx = clamp(x, 0, d.w), ny = clamp(y, 0, d.h);
  if (onBorder(p, d.w, d.h)) {
    if (p.side === "left" || p.side === "right") nx = p.x; else ny = p.y;
  }
  ops[i] = { ...op, x: r2(nx), y: r2(ny) };
  return withOps(d, ops);
}

/** Changes a port. A new side puts it on that side of the border. */
export function setPort(d: DescrizioneSimbolo, i: number, patch: Partial<{ id: string; x: number; y: number; side: Side; d: number }>): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = ops[i];
  if (op?.op !== "bocca") return d;
  const next: Op = { ...op, ...patch };
  if (patch.side && patch.side !== op.side) {
    if (patch.side === "left") next.x = 0;
    if (patch.side === "right") next.x = d.w;
    if (patch.side === "top") next.y = 0;
    if (patch.side === "bottom") next.y = d.h;
  }
  for (const k of ["x", "y", "d"] as const) if (typeof next[k] === "number") next[k] = r2(next[k] as number);
  ops[i] = next;
  return withOps(d, ops);
}

/** A port id the compiler accepts: 2–30 characters a-z, 0-9, «-». */
export function validPortId(id: string): boolean {
  return /^[a-z0-9-]{2,30}$/.test(id);
}

/** The symbol at a new size: with `scale` every shape, part and port goes with
 *  it; without, only the size changes (as before). */
export function resizeSymbol(d: DescrizioneSimbolo, w: number, h: number, scale: boolean): DescrizioneSimbolo {
  if (!scale || (w === d.w && h === d.h)) return { ...d, w, h };
  const a: Affine = { sx: w / d.w, sy: h / d.h, tx: 0, ty: 0 };
  return { ...d, w, h, ops: (d.ops as Op[]).map((op) => transformOp(op, a)) };
}

// ── whole symbols ──────────────────────────────────────────────────────────

/** A slug from a label: lowercase, a-z 0-9 and «-», 3 to 40 characters,
 *  different from every slug in `taken`. */
export function slugFrom(label: string, taken: readonly string[]): string {
  let base = label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34);
  if (base.length < 3) base = `symbol-${base}`.replace(/-+$/, "");
  let slug = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/** An empty symbol to draw from scratch: the body layer is open, with nothing
 *  in it — the first shape drawn goes there. Until 21-11-2026 it started with a
 *  blue box, which the maintainer found ugly and always had to delete. */
export function emptySymbol(
  label: { it: string; en: string }, taken: readonly string[], size: { w: number; h: number } = { w: 100, h: 100 },
): DescrizioneSimbolo {
  return {
    slug: slugFrom(label.en || label.it, taken), w: size.w, h: size.h, tipo: "project", body: "body-pump",
    it: label.it, en: label.en, ops: [{ op: "corpo" }],
  };
}

/** Nothing drawn yet: the editor invites to draw instead of listing the
 *  compiler's complaint about the empty body. */
export function nothingDrawn(d: DescrizioneSimbolo): boolean {
  return !(d.ops as Op[]).some(draws);
}

/** «Save as»: the same drawing as a new symbol of its own, no longer a
 *  variant of anything. */
export function saveAsCopy(d: DescrizioneSimbolo, label: { it: string; en: string }, taken: readonly string[]): DescrizioneSimbolo {
  const { overrides: _overrides, ...rest } = d;
  void _overrides;
  return { ...structuredClone(rest), slug: slugFrom(label.en || label.it, taken), it: label.it, en: label.en };
}

/** The bounding box of a set of boxes. */
export function union(bs: Box[]): Box | null {
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Sizes are multiples of 10, at most 512 (the compiler's rule). */
export function validSize(n: number): number {
  return Math.min(510, Math.max(10, Math.round(n / 10) * 10));
}

export { getPair };
