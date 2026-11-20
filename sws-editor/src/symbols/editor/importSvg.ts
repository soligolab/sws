// Importing an SVG drawing into a project symbol (plan
// docs/plans/2026-11-20-importa-svg-e-file-del-simbolo.md).
//
// The drawing is exploded into operations of the description: one per shape,
// with groups, transforms and inherited styles flattened, and colours written
// as `#rrggbb`. No foreign SVG reaches the runtime or the panel: the compiler
// checks these operations like any other.
//
// What a description cannot say is approximated or left out, and counted in
// the warnings: a gradient becomes its mean colour with the veil that looks
// like it; text, pictures, clipping, masks and filters are not drawn.

import type { DescrizioneSimbolo } from "@/types";
import { addInput, draws, insertInLayer, layers, r2, resizeSymbol, validSize, type Matrix, type Op } from "./model";

/** The compiler's limits (`sws-core/src/simboli_prj.rs`). */
export const MAX_OPS = 300;
const MAX_PATH = 4000;
const MAX_STROKE = 20;
/** The importer's own limits: what a tab of the IDE reads without freezing. */
export const MAX_SVG_BYTES = 2_000_000;
const MAX_ELEMENTS = 5000;
const MAX_SHAPES = 2000;
const MAX_USE_DEPTH = 8;

export type SvgError = "notSvg" | "tooBig" | "tooManyElements" | "empty" | "full";
export type SvgWarning =
  | "text" | "image" | "evenodd" | "clip" | "mask" | "filter" | "pattern" | "gradient" | "marker"
  | "colour" | "strokeWide" | "split" | "tooLong" | "tooMany" | "css" | "use";
export const SVG_WARNINGS: SvgWarning[] = [
  "text", "image", "evenodd", "clip", "mask", "filter", "pattern", "gradient", "marker",
  "colour", "strokeWide", "split", "tooLong", "tooMany", "css", "use",
];

export interface SvgImport {
  ok: true;
  ops: Op[];
  /** With `adapt`: the size the symbol takes, with the proportions of the drawing. */
  size?: { w: number; h: number };
  /** What was approximated or left out, and how many times. */
  warnings: Partial<Record<SvgWarning, number>>;
}
export type SvgImportResult = SvgImport | { ok: false; error: SvgError };

export interface SvgTarget {
  /** The symbol the drawing goes into: it is fitted inside, centred. */
  w: number;
  h: number;
  /** The symbol has nothing drawn yet: it takes the proportions of the SVG. */
  adapt?: boolean;
  /** How many operations the symbol still has room for. */
  room: number;
}

// ── matrices ───────────────────────────────────────────────────────────────

const ID: Matrix = [1, 0, 0, 1, 0, 0];

/** p·q: q first, then p. */
function mul(p: Matrix, q: Matrix): Matrix {
  return [
    p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
  ];
}

const at = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const axisAligned = (m: Matrix) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
const det = (m: Matrix) => m[0] * m[3] - m[1] * m[2];

const NUMS = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const numbers = (s: string) => (s.match(NUMS) ?? []).map(Number);

/** The `transform` attribute, functions composed left to right. */
export function parseTransform(s: string | null): Matrix {
  let m = ID;
  if (!s) return m;
  for (const [, fn, args] of s.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const v = numbers(args);
    let t = ID;
    const rad = (v[0] ?? 0) * Math.PI / 180;
    switch (fn) {
      case "matrix": if (v.length === 6) t = v as Matrix; break;
      case "translate": t = translate(v[0] ?? 0, v[1] ?? 0); break;
      case "scale": t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]; break;
      case "rotate": {
        const r: Matrix = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
        t = v.length >= 3 ? mul(mul(translate(v[1], v[2]), r), translate(-v[1], -v[2])) : r;
        break;
      }
      case "skewX": t = [1, 0, Math.tan(rad), 1, 0, 0]; break;
      case "skewY": t = [1, Math.tan(rad), 0, 1, 0, 0]; break;
    }
    m = mul(m, t);
  }
  return m;
}

// ── paths ──────────────────────────────────────────────────────────────────

/** A path segment in absolute coordinates: S and T are already C and Q, H and V
 *  are L. An arc keeps its parameters and where it starts. */
export type Seg =
  | { c: "M" | "L" | "C" | "Q"; p: number[] }
  | { c: "A"; rx: number; ry: number; rot: number; large: number; sweep: number; from: [number, number]; p: number[] }
  | { c: "Z" };

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };

/** A path `d`, read the way a browser reads it: arc flags may be written
 *  without separators (`a1 1 0 0110 10`), and a malformed tail is dropped. */
export function parsePath(d: string): Seg[] {
  const out: Seg[] = [];
  const NUM = /[\s,]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/y;
  const FLAG = /[\s,]*([01])/y;
  const CMD = /[\s,]*([MmLlHhVvCcSsQqTtAaZz])/y;
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0;
  let c2: [number, number] | null = null, q1: [number, number] | null = null;
  const read = (re: RegExp): number | null => {
    re.lastIndex = i;
    const m = re.exec(d);
    if (!m) return null;
    i = re.lastIndex;
    return Number(m[1]);
  };
  for (;;) {
    CMD.lastIndex = i;
    const m = CMD.exec(d);
    if (!m) break;
    i = CMD.lastIndex;
    const cmd = m[1], up = cmd.toUpperCase(), rel = cmd !== up;
    if (up === "Z") { out.push({ c: "Z" }); cx = sx; cy = sy; c2 = q1 = null; continue; }
    let groups = 0;
    for (;;) {
      const save = i;
      const g: number[] = [];
      for (let k = 0; k < ARITY[up]; k++) {
        const v = read(up === "A" && (k === 3 || k === 4) ? FLAG : NUM);
        if (v === null) break;
        g.push(v);
      }
      if (g.length < ARITY[up]) { i = save; break; }
      groups++;
      const X = (v: number) => (rel ? cx + v : v), Y = (v: number) => (rel ? cy + v : v);
      let nc2: [number, number] | null = null, nq1: [number, number] | null = null;
      switch (up) {
        case "M": {
          const x = X(g[0]), y = Y(g[1]);
          out.push({ c: groups === 1 ? "M" : "L", p: [x, y] });
          if (groups === 1) { sx = x; sy = y; }
          cx = x; cy = y;
          break;
        }
        case "L": { const x = X(g[0]), y = Y(g[1]); out.push({ c: "L", p: [x, y] }); cx = x; cy = y; break; }
        case "H": { const x = rel ? cx + g[0] : g[0]; out.push({ c: "L", p: [x, cy] }); cx = x; break; }
        case "V": { const y = rel ? cy + g[0] : g[0]; out.push({ c: "L", p: [cx, y] }); cy = y; break; }
        case "C": case "S": {
          const prev: [number, number] | null = c2;
          const [x1, y1]: number[] = up === "C" ? [X(g[0]), Y(g[1])] : prev ? [2 * cx - prev[0], 2 * cy - prev[1]] : [cx, cy];
          const k = up === "C" ? 2 : 0;
          const x2 = X(g[k]), y2 = Y(g[k + 1]), x = X(g[k + 2]), y = Y(g[k + 3]);
          out.push({ c: "C", p: [x1, y1, x2, y2, x, y] });
          nc2 = [x2, y2]; cx = x; cy = y;
          break;
        }
        case "Q": case "T": {
          const prev: [number, number] | null = q1;
          const ctl: [number, number] = up === "Q" ? [X(g[0]), Y(g[1])] : prev ? [2 * cx - prev[0], 2 * cy - prev[1]] : [cx, cy];
          const x = X(g[up === "Q" ? 2 : 0]), y = Y(g[up === "Q" ? 3 : 1]);
          out.push({ c: "Q", p: [ctl[0], ctl[1], x, y] });
          nq1 = ctl; cx = x; cy = y;
          break;
        }
        case "A": {
          const x = X(g[5]), y = Y(g[6]);
          if (x === cx && y === cy) break;
          if (g[0] === 0 || g[1] === 0) out.push({ c: "L", p: [x, y] });
          else out.push({ c: "A", rx: Math.abs(g[0]), ry: Math.abs(g[1]), rot: g[2], large: g[3], sweep: g[4], from: [cx, cy], p: [x, y] });
          cx = x; cy = y;
          break;
        }
      }
      c2 = nc2; q1 = nq1;
    }
    if (!groups) break;
  }
  return out;
}

/** An arc as cubic Béziers, a quarter turn at most each (SVG 1.1, F.6.5). */
function arcToCubics(x1: number, y1: number, a: Extract<Seg, { c: "A" }>): number[][] {
  const [x2, y2] = a.p;
  const phi = a.rot * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  let rx = a.rx, ry = a.ry;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  let co = den ? Math.sqrt(Math.max(0, num / den)) : 0;
  if (a.large === a.sweep) co = -co;
  const cxp = (co * rx * yp) / ry, cyp = (-co * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!a.sweep && dt > 0) dt -= 2 * Math.PI;
  else if (a.sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n, k = (4 / 3) * Math.tan(step / 4);
  const on = (ux: number, uy: number) => [cx + cos * rx * ux - sin * ry * uy, cy + sin * rx * ux + cos * ry * uy];
  const out: number[][] = [];
  for (let s = 0, t = t1; s < n; s++, t += step) {
    const ca = Math.cos(t), sa = Math.sin(t), cb = Math.cos(t + step), sb = Math.sin(t + step);
    out.push([...on(ca - k * sa, sa + k * ca), ...on(cb + k * sb, sb - k * cb), ...on(cb, sb)]);
  }
  out[n - 1][4] = x2;
  out[n - 1][5] = y2;
  return out;
}

/** The segments moved by `m`. An arc stays an arc when `m` keeps its axes
 *  (a scale, a mirror); with a rotation or a skew it becomes curves. */
export function transformSegs(segs: Seg[], m: Matrix): Seg[] {
  const out: Seg[] = [];
  const keepsArcs = axisAligned(m);
  const flip = det(m) < 0;
  const sx = Math.abs(m[0]), sy = Math.abs(m[3]);
  const uniform = Math.abs(sx - sy) <= 1e-9 * Math.max(sx, sy, 1);
  const move = (p: number[]) => {
    const q: number[] = [];
    for (let j = 0; j + 1 < p.length; j += 2) q.push(...at(m, p[j], p[j + 1]));
    return q;
  };
  for (const s of segs) {
    if (s.c === "Z") { out.push(s); continue; }
    if (s.c !== "A") { out.push({ c: s.c, p: move(s.p) }); continue; }
    const quarter = (((s.rot % 180) + 180) % 180);
    if (keepsArcs && (uniform || quarter < 1e-9 || Math.abs(quarter - 90) < 1e-9)) {
      const turned = !uniform && Math.abs(quarter - 90) < 1e-9;
      out.push({
        c: "A", rx: s.rx * (turned ? sy : sx), ry: s.ry * (turned ? sx : sy), rot: flip ? -s.rot : s.rot,
        large: s.large, sweep: flip ? 1 - s.sweep : s.sweep, from: at(m, ...s.from), p: move(s.p),
      });
    } else {
      for (const c of arcToCubics(s.from[0], s.from[1], s)) out.push({ c: "C", p: move(c) });
    }
  }
  return out;
}

const fmt = (v: number, dec: number) => {
  const p = 10 ** dec;
  const r = Math.round(v * p) / p;
  return String(r === 0 ? 0 : r);
};

/** The `d` of the segments: the compiler's grammar (commands and numbers). */
export function writePath(segs: Seg[], dec = 2): string {
  return segs.map((s) => {
    if (s.c === "Z") return "Z";
    if (s.c === "A") return `A${fmt(s.rx, dec)} ${fmt(s.ry, dec)} ${fmt(s.rot, dec)} ${s.large} ${s.sweep} ${fmt(s.p[0], dec)} ${fmt(s.p[1], dec)}`;
    return s.c + s.p.map((v) => fmt(v, dec)).join(" ");
  }).join("");
}

function subpaths(segs: Seg[]): Seg[][] {
  const out: Seg[][] = [];
  for (const s of segs) {
    if (s.c === "M" || !out.length) out.push([]);
    out[out.length - 1].push(s);
  }
  return out;
}

const drawsSomething = (segs: Seg[]) => segs.some((s) => s.c !== "M" && s.c !== "Z");

function pointsOf(segs: Seg[]): number[] {
  return segs.flatMap((s) => (s.c === "Z" ? [] : s.p));
}

// ── shapes in their own coordinates ────────────────────────────────────────

type Prim =
  | { tag: "rect"; x: number; y: number; w: number; h: number; rx: number; ry: number }
  | { tag: "ellipse"; cx: number; cy: number; rx: number; ry: number; circle: boolean };

interface Geometry {
  segs: Seg[];
  prim?: Prim;
  /** A `<line>`: it has no inside to fill. */
  line?: boolean;
}

const K = 0.5522847498;

function ellipseSegs(cx: number, cy: number, rx: number, ry: number): Seg[] {
  return [
    { c: "M", p: [cx + rx, cy] },
    { c: "C", p: [cx + rx, cy + K * ry, cx + K * rx, cy + ry, cx, cy + ry] },
    { c: "C", p: [cx - K * rx, cy + ry, cx - rx, cy + K * ry, cx - rx, cy] },
    { c: "C", p: [cx - rx, cy - K * ry, cx - K * rx, cy - ry, cx, cy - ry] },
    { c: "C", p: [cx + K * rx, cy - ry, cx + rx, cy - K * ry, cx + rx, cy] },
    { c: "Z" },
  ];
}

function rectSegs(x: number, y: number, w: number, h: number, rx: number, ry: number): Seg[] {
  if (!rx || !ry) return parsePath(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
  return parsePath(
    `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}`
    + `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`,
  );
}

const UNITS: Record<string, number> = { "": 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

/** A length in user units; a percentage or an unknown unit is not one. */
function length(v: string | null, otherwise = 0): number {
  if (v === null) return otherwise;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(v);
  if (!m || !(m[2].toLowerCase() in UNITS)) return otherwise;
  return Number(m[1]) * UNITS[m[2].toLowerCase()];
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** A circle, an ellipse or a straight rectangle drawn as a path: what icon
 *  sites write (two half arcs for a circle, SVG Repo) becomes the shape it is,
 *  with its fields in the editor (collaudo of 20-11-2026: «sono tutti Path»). */
export function primOfPath(segs: Seg[]): Prim | undefined {
  const s = segs[segs.length - 1]?.c === "Z" ? segs.slice(0, -1) : segs;
  if (s[0]?.c !== "M") return undefined;
  const [x0, y0] = s[0].p;
  const rest = s.slice(1);
  // Two half arcs, back to the start.
  if (rest.length === 2 && rest.every((x) => x.c === "A")) {
    const [a, b] = rest as Extract<Seg, { c: "A" }>[];
    const tol = Math.max(a.rx, a.ry) * 0.005;
    if (!near(a.rx, b.rx, tol) || !near(a.ry, b.ry, tol) || !near(b.p[0], x0, tol) || !near(b.p[1], y0, tol)) return undefined;
    const quarter = ((a.rot % 180) + 180) % 180;
    const round = near(a.rx, a.ry, tol);
    if (!round && !near(quarter, 0, 1e-6) && !near(quarter, 90, 1e-6)) return undefined;
    const [rx, ry] = !round && near(quarter, 90, 1e-6) ? [a.ry, a.rx] : [a.rx, a.ry];
    const [x1, y1] = a.p;
    const half = Math.hypot(x1 - x0, y1 - y0) / 2;
    // The two ends are opposite on an axis, at the distance of that radius.
    const horizontal = near(y1, y0, tol) && near(half, rx, Math.max(rx, ry) * 0.01);
    const vertical = near(x1, x0, tol) && near(half, ry, Math.max(rx, ry) * 0.01);
    if (!horizontal && !vertical && !(round && near(half, rx, rx * 0.01))) return undefined;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    // Within one per cent, a circle: what the drawing meant.
    if (near(rx, ry, Math.max(rx, ry) * 0.01)) {
      const r = (rx + ry) / 2;
      return { tag: "ellipse", cx, cy, rx: r, ry: r, circle: true };
    }
    return { tag: "ellipse", cx, cy, rx, ry, circle: false };
  }
  // Four straight sides along the axes (the last one may be the Z).
  const lines = rest.filter((x): x is { c: "L"; p: number[] } => x.c === "L");
  if (lines.length !== rest.length || lines.length < 3 || lines.length > 4) return undefined;
  const pts: [number, number][] = [[x0, y0], ...lines.map((x) => [x.p[0], x.p[1]] as [number, number])];
  // Three sides are a rectangle only if the path closes: an open one is a line.
  if (pts.length === 4 && segs[segs.length - 1]?.c !== "Z") return undefined;
  if (pts.length === 5) {
    if (!near(pts[4][0], x0, 1e-6) || !near(pts[4][1], y0, 1e-6)) return undefined;
    pts.pop();
  }
  for (let k = 0; k < 4; k++) {
    const [p, q] = [pts[k], pts[(k + 1) % 4]];
    if (!near(p[0], q[0], 1e-6) && !near(p[1], q[1], 1e-6)) return undefined;
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  if (!(w > 0 && h > 0) || new Set(xs.map(String)).size !== 2 || new Set(ys.map(String)).size !== 2) return undefined;
  return { tag: "rect", x, y, w, h, rx: 0, ry: 0 };
}

function geometryOf(el: Element): Geometry | null {
  const n = (k: string, otherwise = 0) => length(el.getAttribute(k), otherwise);
  switch (el.localName) {
    case "rect": {
      const x = n("x"), y = n("y"), w = n("width"), h = n("height");
      if (!(w > 0 && h > 0)) return null;
      const ra = el.getAttribute("rx"), rb = el.getAttribute("ry");
      let rx = ra !== null ? n("rx") : rb !== null ? n("ry") : 0;
      let ry = rb !== null ? n("ry") : rx;
      rx = Math.min(Math.max(rx, 0), w / 2);
      ry = Math.min(Math.max(ry, 0), h / 2);
      return { segs: rectSegs(x, y, w, h, rx, ry), prim: { tag: "rect", x, y, w, h, rx, ry } };
    }
    case "circle": {
      const cx = n("cx"), cy = n("cy"), r = n("r");
      if (!(r > 0)) return null;
      return { segs: ellipseSegs(cx, cy, r, r), prim: { tag: "ellipse", cx, cy, rx: r, ry: r, circle: true } };
    }
    case "ellipse": {
      const cx = n("cx"), cy = n("cy"), rx = n("rx"), ry = n("ry");
      if (!(rx > 0 && ry > 0)) return null;
      return { segs: ellipseSegs(cx, cy, rx, ry), prim: { tag: "ellipse", cx, cy, rx, ry, circle: false } };
    }
    case "line":
      return { segs: [{ c: "M", p: [n("x1"), n("y1")] }, { c: "L", p: [n("x2"), n("y2")] }], line: true };
    case "polyline": case "polygon": {
      const v = numbers(el.getAttribute("points") ?? "");
      if (v.length < 4) return null;
      const segs: Seg[] = [];
      for (let k = 0; k + 1 < v.length; k += 2) segs.push({ c: k ? "L" : "M", p: [v[k], v[k + 1]] });
      if (el.localName === "polygon") segs.push({ c: "Z" });
      return { segs, prim: el.localName === "polygon" ? primOfPath(segs) : undefined };
    }
    case "path": {
      const segs = parsePath(el.getAttribute("d") ?? "");
      return drawsSomething(segs) ? { segs, prim: primOfPath(segs) } : null;
    }
    default:
      return null;
  }
}

// ── styles ─────────────────────────────────────────────────────────────────

const INHERITED = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "color", "visibility",
];
const OWN = ["opacity", "display", "clip-path", "mask", "filter", "marker-start", "marker-mid", "marker-end", "marker"];
const PROPS = new Set([...INHERITED, ...OWN]);
type Props = Record<string, string>;

interface Rule { sel: { tag?: string; ids: string[]; classes: string[] }; spec: number; order: number; decl: Props }

function declarations(text: string): Props {
  const out: Props = {};
  for (const part of text.split(";")) {
    const k = part.indexOf(":");
    if (k < 0) continue;
    const name = part.slice(0, k).trim().toLowerCase();
    if (PROPS.has(name)) out[name] = part.slice(k + 1).replace(/!important/i, "").trim();
  }
  return out;
}

/** The rules of the `<style>` elements with simple selectors (`.a`, `#b`,
 *  `path`, `path.a`, comma lists): what drawing programs write. The others
 *  are counted. */
function styleSheet(doc: Document, warn: (w: SvgWarning) => void): Rule[] {
  const rules: Rule[] = [];
  let order = 0;
  for (const st of Array.from(doc.getElementsByTagName("style"))) {
    let css = (st.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    // At-rules: their statements and their blocks go.
    css = css.replace(/@[^{;]*;/g, "");
    for (let k = css.indexOf("@"); k >= 0; k = css.indexOf("@")) {
      let depth = 0, j = css.indexOf("{", k);
      if (j < 0) { css = css.slice(0, k); break; }
      for (; j < css.length; j++) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}" && --depth === 0) break;
      }
      css = css.slice(0, k) + css.slice(j + 1);
    }
    for (const [, sels, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decl = declarations(body);
      for (const raw of sels.split(",")) {
        const s = raw.trim();
        const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(s);
        if (!s) continue;
        if (!m || (!m[1] && !m[2])) { warn("css"); continue; }
        const ids = [...m[2].matchAll(/#([\w-]+)/g)].map((x) => x[1]);
        const classes = [...m[2].matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
        rules.push({ sel: { tag: m[1], ids, classes }, spec: ids.length * 100 + classes.length * 10 + (m[1] ? 1 : 0), order: order++, decl });
      }
    }
  }
  return rules.sort((a, b) => a.spec - b.spec || a.order - b.order);
}

function matches(el: Element, r: Rule): boolean {
  const { tag, ids, classes } = r.sel;
  if (tag && tag !== el.localName) return false;
  if (ids.length && !ids.every((id) => el.getAttribute("id") === id)) return false;
  const own = (el.getAttribute("class") ?? "").split(/\s+/);
  return classes.every((c) => own.includes(c));
}

/** Presentation attributes, then the style sheet, then `style=""`. */
function declared(el: Element, sheet: Rule[]): Props {
  const out: Props = {};
  for (const k of PROPS) {
    const v = el.getAttribute(k);
    if (v !== null) out[k] = v.trim();
  }
  for (const r of sheet) if (matches(el, r)) Object.assign(out, r.decl);
  const st = el.getAttribute("style");
  if (st) Object.assign(out, declarations(st));
  return out;
}

function inherit(parent: Props, own: Props): Props {
  const out: Props = {};
  for (const k of INHERITED) {
    const v = own[k];
    const x = v === undefined || v === "inherit" ? parent[k] : v;
    if (x !== undefined) out[k] = x;
  }
  for (const k of OWN) if (own[k] !== undefined && own[k] !== "inherit") out[k] = own[k];
  return out;
}

/** An opacity: a number or a percentage, 0 to 1. */
function alpha(v: string | undefined, otherwise = 1): number {
  if (v === undefined) return otherwise;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return otherwise;
  return Math.min(1, Math.max(0, v.trim().endsWith("%") ? n / 100 : n));
}

// ── colours ────────────────────────────────────────────────────────────────

/** The CSS names drawing programs and hand-written SVGs use most. */
const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  orange: "#ffa500", gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000", purple: "#800080",
  fuchsia: "#ff00ff", magenta: "#ff00ff", lime: "#00ff00", olive: "#808000", navy: "#000080", teal: "#008080",
  aqua: "#00ffff", cyan: "#00ffff", brown: "#a52a2a", pink: "#ffc0cb", gold: "#ffd700", beige: "#f5f5dc",
  lightgray: "#d3d3d3", lightgrey: "#d3d3d3", darkgray: "#a9a9a9", darkgrey: "#a9a9a9", dimgray: "#696969",
  dimgrey: "#696969", gainsboro: "#dcdcdc", whitesmoke: "#f5f5f5", slategray: "#708090", slategrey: "#708090",
  steelblue: "#4682b4", lightblue: "#add8e6", skyblue: "#87ceeb", darkblue: "#00008b", royalblue: "#4169e1",
  dodgerblue: "#1e90ff", darkgreen: "#006400", lightgreen: "#90ee90", forestgreen: "#228b22", limegreen: "#32cd32",
  darkred: "#8b0000", crimson: "#dc143c", tomato: "#ff6347", coral: "#ff7f50", darkorange: "#ff8c00",
  orangered: "#ff4500", khaki: "#f0e68c", tan: "#d2b48c", chocolate: "#d2691e", sienna: "#a0522d",
  indigo: "#4b0082", violet: "#ee82ee", turquoise: "#40e0d0", ivory: "#fffff0", linen: "#faf0e6",
};

const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");

/** A CSS colour as `#rrggbb` and an opacity; `null` if it is not one. */
export function parseColour(s: string): { hex: string; alpha: number } | null {
  const v = s.trim().toLowerCase();
  if (v === "transparent") return { hex: "#000000", alpha: 0 };
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (m) {
    const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return { hex: `#${h.slice(0, 6)}`, alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v);
  if (m) {
    const p = m[2].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const a = p[3] === undefined ? 1 : alpha(p[3], NaN);
    let rgb: number[];
    if (m[1].startsWith("rgb")) {
      rgb = p.slice(0, 3).map((x) => (x.endsWith("%") ? parseFloat(x) * 2.55 : parseFloat(x)));
    } else {
      const h = (((parseFloat(p[0]) % 360) + 360) % 360) / 360, sat = parseFloat(p[1]) / 100, l = parseFloat(p[2]) / 100;
      const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, b = 2 * l - q;
      const ch = (t: number) => {
        const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
        return 255 * (x < 1 / 6 ? b + (q - b) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? b + (q - b) * (2 / 3 - x) * 6 : b);
      };
      rgb = [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)];
    }
    if (rgb.some((x) => !Number.isFinite(x)) || !Number.isFinite(a)) return null;
    return { hex: `#${rgb.map(hex2).join("")}`, alpha: a };
  }
  const named = NAMED[v];
  return named ? { hex: named, alpha: 1 } : null;
}

type Colour = { kind: "colour"; hex: string; alpha: number; veil?: string };
type Paint = { kind: "none" } | Colour;

/** The stops of a gradient, following `href` to the one that has them. */
function stopsOf(g: Element, ids: Map<string, Element>): Element[] {
  let cur: Element | undefined = g;
  for (let n = 0; cur && n < 8; n++) {
    const stops = Array.from(cur.children).filter((c) => c.localName === "stop");
    if (stops.length) return stops;
    const ref = (cur.getAttribute("href") ?? cur.getAttribute("xlink:href") ?? "").trim();
    cur = ref.startsWith("#") ? ids.get(ref.slice(1)) : undefined;
  }
  return [];
}

/** A gradient as its mean colour, and the veil of the library that looks like
 *  it (light from the same side): the closest a description gets. */
function gradientPaint(g: Element, ids: Map<string, Element>, m: Matrix): Colour | null {
  const stops = stopsOf(g, ids).map((s) => {
    const c = parseColour(declarationOf(s, "stop-color") ?? s.getAttribute("stop-color") ?? "black") ?? { hex: "#000000", alpha: 1 };
    return { hex: c.hex, alpha: c.alpha * alpha(declarationOf(s, "stop-opacity") ?? s.getAttribute("stop-opacity") ?? undefined) };
  });
  if (!stops.length) return null;
  const rgb = [1, 3, 5].map((k) => stops.reduce((t, s) => t + parseInt(s.hex.slice(k, k + 2), 16), 0) / stops.length);
  const a = stops.reduce((t, s) => t + s.alpha, 0) / stops.length;
  const plain = stops.every((s) => s.hex === stops[0].hex);
  let veil: string | undefined;
  if (!plain) {
    if (g.localName === "radialGradient") veil = "paint-r";
    else {
      const f = (k: string, d: number) => {
        const v = g.getAttribute(k);
        if (v === null) return d;
        return v.trim().endsWith("%") ? parseFloat(v) / 100 : parseFloat(v) || 0;
      };
      const gt = parseTransform(g.getAttribute("gradientTransform"));
      const lin = mul([m[0], m[1], m[2], m[3], 0, 0], [gt[0], gt[1], gt[2], gt[3], 0, 0]);
      const [vx, vy] = at(lin, f("x2", 1) - f("x1", 0), f("y2", 0) - f("y1", 0));
      veil = Math.abs(vx) >= 2 * Math.abs(vy) ? "paint-h" : Math.abs(vy) >= 2 * Math.abs(vx) ? "paint-v" : "paint-d";
    }
  }
  return { kind: "colour", hex: `#${rgb.map(hex2).join("")}`, alpha: a, veil };
}

/** One property of an element's `style=""` (for the stops of a gradient). */
function declarationOf(el: Element, k: string): string | undefined {
  const st = el.getAttribute("style");
  if (!st) return undefined;
  for (const part of st.split(";")) {
    const i = part.indexOf(":");
    if (i > 0 && part.slice(0, i).trim().toLowerCase() === k) return part.slice(i + 1).trim();
  }
  return undefined;
}

// ── the walk ───────────────────────────────────────────────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";

interface Style {
  fill: Paint; fillAlpha: number; stroke: Paint; strokeAlpha: number;
  strokeWidth: number; cap: string; join: string; dash: number[] | null; evenodd: boolean;
}

interface Shape { geo: Geometry; m: Matrix; style: Style }

interface Walk {
  ids: Map<string, Element>;
  sheet: Rule[];
  shapes: Shape[];
  warnings: Partial<Record<SvgWarning, number>>;
  /** Shapes beyond MAX_SHAPES: not even read. */
  over: number;
}

function warnOf(w: Walk) {
  return (k: SvgWarning, n = 1) => { w.warnings[k] = (w.warnings[k] ?? 0) + n; };
}

function paintOf(v: string | undefined, otherwise: string, props: Props, m: Matrix, w: Walk, fill: boolean): Paint {
  const warn = warnOf(w);
  const s = (v ?? otherwise).trim();
  if (s === "none") return { kind: "none" };
  const url = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/.exec(s);
  if (url) {
    const ref = w.ids.get(url[1]);
    if (ref && (ref.localName === "linearGradient" || ref.localName === "radialGradient")) {
      const g = gradientPaint(ref, w.ids, m);
      if (g) {
        warn("gradient");
        return fill ? g : { ...g, veil: undefined };
      }
    }
    if (ref?.localName === "pattern") warn("pattern");
    return url[2] && url[2] !== "none" ? paintOf(url[2], "none", props, m, w, fill) : ref?.localName === "pattern" ? { kind: "colour", hex: "#808080", alpha: 1 } : { kind: "none" };
  }
  if (s.toLowerCase() === "currentcolor") return paintOf(props.color ?? "black", "black", {}, m, w, fill);
  const c = parseColour(s);
  if (!c) { warn("colour"); return { kind: "colour", hex: "#000000", alpha: 1 }; }
  return { kind: "colour", ...c };
}

function styleOf(props: Props, opacity: number, m: Matrix, w: Walk): Style {
  const dash = (props["stroke-dasharray"] ?? "none").trim();
  const dv = dash === "none" ? [] : numbers(dash);
  const cap = props["stroke-linecap"] ?? "butt", join = props["stroke-linejoin"] ?? "miter";
  return {
    fill: paintOf(props.fill, "black", props, m, w, true),
    fillAlpha: alpha(props["fill-opacity"]) * opacity,
    stroke: paintOf(props.stroke, "none", props, m, w, false),
    strokeAlpha: alpha(props["stroke-opacity"]) * opacity,
    strokeWidth: length(props["stroke-width"] ?? null, 1),
    cap: ["butt", "round", "square"].includes(cap) ? cap : "butt",
    join: ["round", "miter", "bevel"].includes(join) ? join : "miter",
    dash: dv.length && dv.every((x) => x >= 0) && dv.some((x) => x > 0) ? dv : null,
    evenodd: (props["fill-rule"] ?? "").trim() === "evenodd",
  };
}

/** Where a viewBox goes in a `width`×`height` box: scaled to fit, centred. */
function viewBoxInto(vb: number[] | null, width: number, height: number): Matrix {
  if (!vb || !(width > 0 && height > 0)) return ID;
  const s = Math.min(width / vb[2], height / vb[3]);
  return [s, 0, 0, s, (width - vb[2] * s) / 2 - vb[0] * s, (height - vb[3] * s) / 2 - vb[1] * s];
}

function viewBoxOf(el: Element): number[] | null {
  const v = numbers(el.getAttribute("viewBox") ?? "");
  return v.length === 4 && v[2] > 0 && v[3] > 0 ? v : null;
}

const NOT_DRAWN = new Set([
  "defs", "style", "script", "title", "desc", "metadata", "clipPath", "mask", "pattern", "marker",
  "linearGradient", "radialGradient", "filter", "symbol", "foreignObject", "font", "font-face", "cursor", "view",
]);

function walk(el: Element, parent: Props, opacity: number, m: Matrix, w: Walk, depth: number, root = false): void {
  if (el.namespaceURI !== SVG_NS && el.namespaceURI !== null) return;
  const tag = el.localName;
  const warn = warnOf(w);
  if (NOT_DRAWN.has(tag) && !(tag === "symbol" && depth > 0 && root)) return;
  if (tag === "text") { warn("text"); return; }
  if (tag === "image") { warn("image"); return; }
  const own = declared(el, w.sheet);
  if (own.display === "none") return;
  const props = inherit(parent, own);
  const op = opacity * alpha(own.opacity);
  let cm = mul(m, parseTransform(el.getAttribute("transform")));
  for (const [k, code] of [["clip-path", "clip"], ["mask", "mask"], ["filter", "filter"]] as const) {
    if (own[k] && own[k] !== "none") warn(code);
  }
  const children = () => { for (const c of Array.from(el.children)) walk(c, props, op, cm, w, depth); };
  switch (tag) {
    case "svg":
      if (!root) {
        cm = mul(mul(cm, translate(length(el.getAttribute("x")), length(el.getAttribute("y")))),
          viewBoxInto(viewBoxOf(el), length(el.getAttribute("width"), NaN), length(el.getAttribute("height"), NaN)));
      }
      children();
      return;
    case "symbol":
      // Only through a <use> (below), which passes `root` to say so.
      children();
      return;
    case "g": case "a": case "switch":
      children();
      return;
    case "use": {
      const ref = (el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "").trim();
      const target = ref.startsWith("#") ? w.ids.get(ref.slice(1)) : undefined;
      if (!target || depth >= MAX_USE_DEPTH || target === el || target.contains(el)) { warn("use"); return; }
      let um = mul(cm, translate(length(el.getAttribute("x")), length(el.getAttribute("y"))));
      if (target.localName === "symbol" || target.localName === "svg") {
        um = mul(um, viewBoxInto(viewBoxOf(target), length(el.getAttribute("width"), NaN), length(el.getAttribute("height"), NaN)));
        // The <symbol> is drawn here, as a group: `root` lets it past NOT_DRAWN.
        walk(target, props, op, um, w, depth + 1, true);
      } else {
        walk(target, props, op, um, w, depth + 1);
      }
      return;
    }
  }
  const geo = geometryOf(el);
  if (!geo) return;
  if (props.visibility === "hidden" || props.visibility === "collapse") return;
  if (w.shapes.length >= MAX_SHAPES) { w.over++; return; }
  const style = styleOf(props, op, cm, w);
  if (["marker-start", "marker-mid", "marker-end", "marker"].some((k) => own[k] && own[k] !== "none")) warn("marker");
  w.shapes.push({ geo, m: cm, style });
}

// ── operations ─────────────────────────────────────────────────────────────

type Pairs = [string, number | string][];

/** The path strings of some segments: two decimals, then fewer, then one
 *  string per group of subpaths; a subpath too long even so is dropped. */
function pathStrings(segs: Seg[], warn: (k: SvgWarning, n?: number) => void): string[] {
  for (const dec of [2, 1, 0]) {
    const s = writePath(segs, dec);
    if (s.length <= MAX_PATH) return [s];
  }
  const out: string[] = [];
  let cur = "";
  for (const sp of subpaths(segs)) {
    const s = [2, 1, 0].map((dec) => writePath(sp, dec)).find((x) => x.length <= MAX_PATH);
    if (!s) { warn("tooLong"); continue; }
    if (cur && cur.length + s.length > MAX_PATH) { out.push(cur); cur = ""; }
    cur += s;
  }
  if (cur) out.push(cur);
  if (out.length > 1) warn("split");
  return out;
}

function opsOf(sh: Shape, f: Matrix, bounds: { w: number; h: number }, warn: (k: SvgWarning, n?: number) => void): Op[] {
  const m = mul(f, sh.m);
  const st = sh.style;
  const scale = Math.sqrt(Math.abs(det(m)));
  const fill = !sh.geo.line && st.fill.kind === "colour" && st.fill.alpha * st.fillAlpha > 0.004 ? st.fill : null;
  const sw = st.strokeWidth * scale;
  const stroke = st.stroke.kind === "colour" && st.stroke.alpha * st.strokeAlpha > 0.004 && sw > 0.004 ? st.stroke : null;
  if (!fill && !stroke) return [];
  const strokeExtra: Pairs = [];
  if (stroke) {
    if (sw > MAX_STROKE) warn("strokeWide");
    strokeExtra.push(["stroke", stroke.hex], ["stroke_width", r2(Math.min(sw, MAX_STROKE))]);
    const a = stroke.alpha * st.strokeAlpha;
    if (a < 0.995) strokeExtra.push(["stroke_opacity", r2(a)]);
    if (st.cap !== "butt") strokeExtra.push(["stroke_linecap", st.cap]);
    // The layers of a compiled symbol join round; SVG joins with a mitre.
    if (st.join !== "round") strokeExtra.push(["stroke_linejoin", st.join]);
    if (st.dash) strokeExtra.push(["stroke_dasharray", st.dash.map((v) => r2(v * scale)).join(" ")]);
  } else {
    strokeExtra.push(["stroke", "none"]);
  }
  const segs = transformSegs(sh.geo.segs, m);
  if (!fill) {
    // An outline only: a line of the editor, whatever its shape.
    if (!sh.geo.prim) return pathStrings(segs, warn).map((d) => ({ op: "tratto", d, mat: null, extra: strokeExtra }));
  } else if (st.evenodd && subpaths(sh.geo.segs).length > 1) {
    warn("evenodd");
  }
  const fillExtra: Pairs = fill ? [["fill", fill.hex]] : [["fill", "none"]];
  const fa = fill ? fill.alpha * st.fillAlpha : 1;
  if (fill && fa < 0.995) fillExtra.push(["fill_opacity", r2(fa)]);
  const extra = [...fillExtra, ...strokeExtra];
  const velo = fill?.veil ?? null;
  const inside = (x: number, y: number, w: number, h: number) => x >= -1 && y >= -1 && x + w <= bounds.w + 1 && y + h <= bounds.h + 1;
  const p = sh.geo.prim;
  if (p && axisAligned(m)) {
    const sx = Math.abs(m[0]), sy = Math.abs(m[3]);
    if (p.tag === "rect") {
      const [x0, y0] = at(m, p.x, p.y), [x1, y1] = at(m, p.x + p.w, p.y + p.h);
      const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (inside(x, y, w, h)) {
        const geo: Pairs = [["x", r2(x)], ["y", r2(y)], ["width", r2(w)], ["height", r2(h)]];
        const rx = r2(p.rx * sx), ry = r2(p.ry * sy);
        if (rx > 0 && ry > 0) {
          geo.push(["rx", rx]);
          if (ry !== rx) geo.push(["ry", ry]);
        }
        return [{ op: "forma", tag: "rect", geo, mat: null, velo, extra }];
      }
    } else {
      const [cx, cy] = at(m, p.cx, p.cy);
      const rx = p.rx * sx, ry = p.ry * sy;
      if (inside(cx - rx, cy - ry, 2 * rx, 2 * ry)) {
        const geo: Pairs = p.circle && Math.abs(rx - ry) < 0.005
          ? [["cx", r2(cx)], ["cy", r2(cy)], ["r", r2(rx)]]
          : [["cx", r2(cx)], ["cy", r2(cy)], ["rx", r2(rx)], ["ry", r2(ry)]];
        return [{ op: "forma", tag: geo.length === 3 ? "circle" : "ellipse", geo, mat: null, velo, extra }];
      }
    }
  }
  return pathStrings(segs, warn).map((d) => ({ op: "forma", tag: "path", geo: [["d", d]], mat: null, velo, extra }));
}

// ── the import ─────────────────────────────────────────────────────────────

function parse(text: string): Element | null {
  const xml = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = xml.documentElement;
  if (root && root.localName === "svg" && !xml.getElementsByTagName("parsererror").length) return root;
  // Not well-formed XML (an HTML entity, a stray `&`): the HTML parser is kinder.
  const html = new DOMParser().parseFromString(text, "text/html");
  return html.querySelector("svg");
}

/** The SVG `text` as operations of a symbol `target.w`×`target.h`. */
export function importSvg(text: string, target: SvgTarget): SvgImportResult {
  if (text.length > MAX_SVG_BYTES) return { ok: false, error: "tooBig" };
  if (target.room <= 0) return { ok: false, error: "full" };
  const root = parse(text);
  if (!root) return { ok: false, error: "notSvg" };
  const doc = root.ownerDocument;
  const all = Array.from(root.getElementsByTagName("*"));
  if (all.length > MAX_ELEMENTS) return { ok: false, error: "tooManyElements" };
  const w: Walk = { ids: new Map(), sheet: [], shapes: [], warnings: {}, over: 0 };
  for (const el of all) {
    const id = el.getAttribute("id");
    if (id && !w.ids.has(id)) w.ids.set(id, el);
  }
  w.sheet = styleSheet(doc, warnOf(w));
  walk(root, {}, 1, ID, w, 0, true);
  if (!w.shapes.length) return { ok: false, error: "empty" };

  // The area of the drawing: the viewBox, or the size, or what is drawn.
  let vb = viewBoxOf(root);
  if (!vb) {
    const width = length(root.getAttribute("width"), NaN), height = length(root.getAttribute("height"), NaN);
    if (width > 0 && height > 0) vb = [0, 0, width, height];
  }
  if (!vb) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of w.shapes) {
      const p = pointsOf(transformSegs(s.geo.segs, s.m));
      for (let k = 0; k + 1 < p.length; k += 2) {
        x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]);
        y0 = Math.min(y0, p[k + 1]); y1 = Math.max(y1, p[k + 1]);
      }
    }
    vb = [x0, y0, Math.max(x1 - x0, 1e-6), Math.max(y1 - y0, 1e-6)];
  }
  let size: { w: number; h: number } | undefined;
  let { w: tw, h: th } = target;
  if (target.adapt) {
    const long = Math.max(tw, th);
    if (vb[2] >= vb[3]) { tw = validSize(long); th = validSize((long * vb[3]) / vb[2]); }
    else { th = validSize(long); tw = validSize((long * vb[2]) / vb[3]); }
    size = { w: tw, h: th };
  }
  const fit = viewBoxInto(vb, tw, th);
  const warn = warnOf(w);
  let ops: Op[] = [];
  for (const sh of w.shapes) ops.push(...opsOf(sh, fit, { w: tw, h: th }, warn));
  if (w.over) warn("tooMany", w.over);
  if (!ops.length) return { ok: false, error: "empty" };
  if (ops.length > target.room) {
    warn("tooMany", ops.length - target.room);
    ops = ops.slice(0, target.room);
  }
  return { ok: true, ops, size, warnings: w.warnings };
}

// ── into the symbol ────────────────────────────────────────────────────────

/** Nothing drawn yet: no shape, or only the box a new symbol starts with. */
export function isBlank(d: DescrizioneSimbolo): boolean {
  const drawn = (d.ops as Op[]).filter(draws);
  if (!drawn.length) return true;
  const fresh = addInput({ ...d, ops: [] }, "state")?.d.ops[1];
  return drawn.length === 1 && JSON.stringify(drawn[0]) === JSON.stringify(fresh);
}

/** A blank symbol takes the imported drawing in its body (the compiler wants
 *  one shape there), instead of the box it started with; otherwise it goes in
 *  a static layer on top: the last one, or a new one. */
function needsNewLayer(d: DescrizioneSimbolo): boolean {
  if (isBlank(d)) return false;
  const ls = layers(d);
  return ls[ls.length - 1].kind !== "static";
}

/** How many operations an import still has room for in `d`. */
export function roomFor(d: DescrizioneSimbolo): number {
  return MAX_OPS - d.ops.length - (needsNewLayer(d) ? 1 : 0);
}

/** The imported operations put in the symbol; `at` are their indexes. */
export function placeImport(d: DescrizioneSimbolo, r: SvgImport): { d: DescrizioneSimbolo; at: number[] } {
  const blank = isBlank(d);
  let out = blank ? { ...d, ops: (d.ops as Op[]).filter((o) => !draws(o)) } : d;
  if (r.size) out = resizeSymbol(out, r.size.w, r.size.h, true);
  const indexes: number[] = [];
  if (!blank && needsNewLayer(out)) {
    const start = out.ops.length + 1;
    out = { ...out, ops: [...out.ops, { op: "statico" }, ...r.ops] };
    return { d: out, at: r.ops.map((_, k) => start + k) };
  }
  const ls = layers(out);
  const layer = blank ? ls.find((l) => l.kind === "body") ?? ls[0] : ls[ls.length - 1];
  for (const op of r.ops) {
    const x = insertInLayer(out, layer.id, op);
    out = x.d;
    indexes.push(x.at);
  }
  return { d: out, at: indexes };
}

/** Does this text look like an SVG (for Ctrl+V)? */
export function looksLikeSvg(text: string): boolean {
  const head = text.trimStart().slice(0, 2000);
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head);
}
