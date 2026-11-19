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
export type InputKind = "state" | "level" | "rotor" | "needle" | "lever" | "lamp";
export const INPUT_KINDS: InputKind[] = ["state", "level", "rotor", "needle", "lever", "lamp"];

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

const DRAWS = new Set(["forma", "luce", "riflesso", "tratto", "flangia_v", "flangia_o", "tubo_o", "tubo_v"]);

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
    case "bocca":
      return { ...op, x: px(a, Number(op.x)), y: py(a, Number(op.y)) };
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

/** A straight path from (x1, y1) to (x2, y2): a line with the outline. */
export function newLine(x1: number, y1: number, x2: number, y2: number): Op {
  return { op: "tratto", d: `M${r2(x1)} ${r2(y1)} L${r2(x2)} ${r2(y2)}`, mat: "steel-dark", extra: [["stroke_width", 2]] };
}

/** How an operation is coloured: a material, its own colour, or the body's. */
export type Fill = { mat: string } | { color: string } | { body: true };

export function fillOf(op: Op): Fill | undefined {
  if (op.op === "forma") {
    if (typeof op.mat === "string") return { mat: op.mat };
    const c = (op.extra as Pairs | undefined)?.find(([k]) => k === "fill")?.[1];
    if (typeof c === "string" && c.startsWith("#")) return { color: c };
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
  const used = new Set(ops.filter((o) => o.op === "parte").map((o) => String(o.id)));
  let id: string = kind;
  for (let n = 2; used.has(id); n++) id = `${kind}-${n}`;
  const geo: Record<string, number> =
    kind === "level" ? { x: r2(w * 0.3), y: r2(h * 0.2), w: r2(w * 0.4), h: r2(h * 0.6) }
    : kind === "rotor" ? { cx, cy, symmetry: 120 }
    : kind === "needle" ? { cx, cy, a0: -120, a1: 120 }
    : kind === "lever" ? { cx, cy, open: 0, closed: 90 }
    : {};
  const shape: Op =
    kind === "level" ? { ...newRect({ x: geo.x, y: geo.y, w: geo.w, h: geo.h }, "liquid") }
    : kind === "rotor" ? newEllipse({ x: cx - m * 0.2, y: cy - m * 0.05, w: m * 0.4, h: m * 0.1 }, "impeller-vane")
    : kind === "needle" ? newRect({ x: cx - 1, y: cy - m * 0.35, w: 2, h: m * 0.35 }, "signal-red")
    : kind === "lever" ? newRect({ x: cx - m * 0.3, y: cy - 2, w: m * 0.6, h: 4 }, "steel-dark")
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

/** Renames a part (its layer id). Objects bind tags by this id. */
export function renamePart(d: DescrizioneSimbolo, opIndex: number, id: string): DescrizioneSimbolo {
  const ops = [...(d.ops as Op[])];
  const op = ops[opIndex];
  if (op?.op !== "parte") return d;
  ops[opIndex] = { ...op, id };
  return withOps(d, ops);
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

/** An empty symbol to draw from scratch: a body with one shape, so the state
 *  colour has something to colour. */
export function emptySymbol(label: { it: string; en: string }, taken: readonly string[]): DescrizioneSimbolo {
  const d: DescrizioneSimbolo = {
    slug: slugFrom(label.en || label.it, taken), w: 100, h: 100, tipo: "project", body: "body-pump",
    it: label.it, en: label.en, ops: [],
  };
  return addInput(d, "state")!.d;
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
