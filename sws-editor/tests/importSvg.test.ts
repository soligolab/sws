/** Importing an SVG into a project symbol (plan
 *  docs/archive/2026-11-20-importa-svg-e-file-del-simbolo.md): every shape becomes
 *  an operation the compiler accepts, with its colours, in the symbol's units. */
import { describe, it, expect } from "vitest";
import {
  importSvg, isBlank, looksLikeSvg, parsePath, placeImport, roomFor, writePath, MAX_OPS, type SvgImport,
} from "../src/symbols/editor/importSvg";
import { emptySymbol, layers, newRect, validPathD, type Op } from "../src/symbols/editor/model";
import type { DescrizioneSimbolo } from "../src/types";

const svg = (body: string, attrs = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`;

function ok(text: string, target = { w: 100, h: 100, room: MAX_OPS }): SvgImport {
  const r = importSvg(text, target);
  if (!r.ok) throw new Error(`import failed: ${r.error}`);
  return r;
}

const pairs = (op: Op, k: "geo" | "extra") => Object.fromEntries(op[k] as [string, number | string][]);

/** The compiler's rules for an operation from outside (`simboli_prj.rs`). */
const EXTRA = new Set(["stroke_width", "stroke_opacity", "fill_opacity", "stroke_linecap", "stroke_linejoin", "stroke_dasharray", "stroke", "fill"]);
function compilerAccepts(op: Op, w = 100, h = 100): string | null {
  const colour = (v: unknown) => v === "none" || (typeof v === "string" && /^#[0-9a-f]{6}$/.test(v));
  for (const [k, v] of (op.extra as [string, unknown][]) ?? []) {
    if (!EXTRA.has(k)) return `extra ${k}`;
    if ((k === "stroke" || k === "fill") && !colour(v)) return `colour ${String(v)}`;
    if (k === "stroke_width" && !(typeof v === "number" && v >= 0 && v <= 20)) return `width ${String(v)}`;
    if (k.endsWith("_opacity") && !(typeof v === "number" && v >= 0 && v <= 1)) return `opacity ${String(v)}`;
  }
  const keys = [...((op.geo as [string, unknown][]) ?? []).map(([k]) => k), ...((op.extra as [string, unknown][]) ?? []).map(([k]) => k)];
  if (new Set(keys).size !== keys.length) return "repeated attribute";
  if (op.op === "tratto") return validPathD(String(op.d)) ? null : "tratto d";
  if (op.op !== "forma") return `op ${op.op}`;
  if (!["rect", "circle", "ellipse", "path"].includes(String(op.tag))) return `tag ${String(op.tag)}`;
  const g = pairs(op, "geo");
  if (op.tag === "path") return validPathD(String(g.d)) ? null : "path d";
  const box = op.tag === "rect" ? [g.x, g.y, g.width, g.height]
    : op.tag === "circle" ? [+g.cx - +g.r, +g.cy - +g.r, 2 * +g.r, 2 * +g.r]
    : [+g.cx - +g.rx, +g.cy - +g.ry, 2 * +g.rx, 2 * +g.ry];
  const [x, y, bw, bh] = box.map(Number);
  return x < -1 || y < -1 || x + bw > w + 1 || y + bh > h + 1 ? "outside" : null;
}

describe("importSvg", () => {
  it("keeps a rect a rect, with its colour and no outline", () => {
    const r = ok(svg('<rect x="10" y="20" width="30" height="40" fill="#f00"/>'));
    expect(r.ops).toEqual([{
      op: "forma", tag: "rect", geo: [["x", 10], ["y", 20], ["width", 30], ["height", 40]], mat: null, velo: null,
      extra: [["fill", "#ff0000"], ["stroke", "none"]],
    }]);
    expect(r.warnings).toEqual({});
  });

  it("fits the viewBox into the symbol, centred, with the proportions", () => {
    const r = ok(svg('<rect x="0" y="0" width="50" height="25" fill="blue"/>', 'viewBox="0 0 50 25"'));
    expect(pairs(r.ops[0], "geo")).toEqual({ x: 0, y: 25, width: 100, height: 50 });
    // A symbol with nothing drawn takes the proportions instead.
    const a = ok(svg('<rect x="0" y="0" width="50" height="25" fill="blue"/>', 'viewBox="0 0 50 25"'), { w: 100, h: 100, room: 10, adapt: true } as never);
    expect(a.size).toEqual({ w: 100, h: 50 });
    expect(pairs(a.ops[0], "geo")).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it("uses width and height without a viewBox, and the drawing without either", () => {
    expect(pairs(ok(svg('<circle cx="10" cy="10" r="10"/>', 'width="20mm" height="20mm"')).ops[0], "geo").r).toBeCloseTo(13.23, 1);
    const r = ok(svg('<rect x="200" y="300" width="20" height="10"/>', ""));
    expect(pairs(r.ops[0], "geo")).toEqual({ x: 0, y: 25, width: 100, height: 50 });
  });

  it("flattens groups and transforms; a rotation makes a path, a stretch an ellipse", () => {
    const r = ok(svg(`
      <g transform="translate(50 50)"><g transform="rotate(45)"><rect x="-10" y="-10" width="20" height="20"/></g></g>
      <circle cx="10" cy="10" r="5" transform="scale(2 1)"/>`));
    expect(r.ops[0].tag).toBe("path");
    const d = String(pairs(r.ops[0], "geo").d);
    expect(d.startsWith("M50 35.86")).toBe(true);
    expect(r.ops[1].tag).toBe("ellipse");
    expect(pairs(r.ops[1], "geo")).toEqual({ cx: 20, cy: 10, rx: 10, ry: 5 });
  });

  it("reads arc flags written without separators, as browsers do", () => {
    const segs = parsePath("M10 10a5 5 0 0110 0l5-5h1v2zm1 1");
    expect(segs[1]).toMatchObject({ c: "A", rx: 5, ry: 5, large: 0, sweep: 1, p: [20, 10] });
    expect(segs.map((s) => s.c).join("")).toBe("MALLLZM");
    expect(writePath(parsePath("M0 0 S10 10 20 0 T 40 0"))).toBe("M0 0C0 0 10 10 20 0Q20 0 40 0");
  });

  it("keeps arcs under a scale and turns them into curves under a rotation", () => {
    const flat = ok(svg('<path d="M10 50 A40 40 0 0 1 90 50Z" fill="#0f0"/>', 'viewBox="0 0 50 50"'));
    expect(pairs(flat.ops[0], "geo").d).toBe("M20 100A80 80 0 0 1 180 100Z");
    const turned = ok(svg('<path transform="rotate(30 50 50)" d="M10 50 A40 40 0 0 1 90 50Z"/>'));
    expect(String(pairs(turned.ops[0], "geo").d)).not.toContain("A");
    expect(String(pairs(turned.ops[0], "geo").d)).toContain("C");
  });

  it("reads colours from attributes, style, classes, groups and currentColor", () => {
    const r = ok(svg(`
      <style>/* Illustrator */ .a{fill:rgb(255,128,0)} .b { fill: steelblue; stroke: #123; stroke-width: 2 }
        @media print { .a { fill: black } } svg rect { fill: red }</style>
      <rect class="a" x="0" y="0" width="10" height="10"/>
      <g fill="hsl(120, 100%, 25%)"><rect x="10" y="0" width="10" height="10"/></g>
      <rect class="b" x="20" y="0" width="10" height="10" fill="#000"/>
      <g color="#abcdef"><rect x="30" y="0" width="10" height="10" fill="currentColor"/></g>
      <rect x="40" y="0" width="10" height="10" style="fill:#ff000080"/>`));
    const fills = r.ops.map((o) => pairs(o, "extra").fill);
    expect(fills).toEqual(["#ff8000", "#008000", "#4682b4", "#abcdef", "#ff0000"]);
    expect(pairs(r.ops[2], "extra")).toMatchObject({ stroke: "#112233", stroke_width: 2, stroke_linejoin: "miter" });
    expect(pairs(r.ops[4], "extra").fill_opacity).toBe(0.5);
    // `svg rect` is a selector this importer does not read: counted.
    expect(r.warnings.css).toBe(1);
  });

  it("multiplies the opacity of the groups into the shape", () => {
    const r = ok(svg('<g opacity="0.5"><rect x="0" y="0" width="10" height="10" fill-opacity="0.5" stroke="red" fill="red"/></g>'));
    expect(pairs(r.ops[0], "extra")).toMatchObject({ fill_opacity: 0.25, stroke_opacity: 0.5 });
  });

  it("makes a gradient its mean colour with the veil from the same side", () => {
    const r = ok(svg(`
      <defs>
        <linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" style="stop-color:#000000"/></linearGradient>
        <linearGradient id="h" xlink:href="#v" x2="1" y2="0"/>
        <radialGradient id="r"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient>
      </defs>
      <rect x="0" y="0" width="10" height="10" fill="url(#v)"/>
      <rect x="10" y="0" width="10" height="10" fill="url(#h)"/>
      <rect x="20" y="0" width="10" height="10" fill="url(#r)" stroke="url(#r)"/>
      <rect x="30" y="0" width="10" height="10" fill="url(#missing) #00ff00"/>`));
    expect(r.ops.map((o) => o.velo)).toEqual(["paint-v", "paint-h", "paint-r", null]);
    expect(r.ops.map((o) => pairs(o, "extra").fill)).toEqual(["#808080", "#808080", "#800080", "#00ff00"]);
    expect(pairs(r.ops[2], "extra").stroke).toBe("#800080");
    expect(r.warnings.gradient).toBe(4);
  });

  it("draws what a <use> points at, where the <use> says", () => {
    const r = ok(svg(`
      <defs><rect id="tile" width="10" height="10" fill="red"/><symbol id="s" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></symbol></defs>
      <use href="#tile" x="20" y="30"/>
      <use xlink:href="#s" x="50" y="50" width="20" height="20" fill="blue"/>
      <use href="#nothing"/>`));
    expect(pairs(r.ops[0], "geo")).toEqual({ x: 20, y: 30, width: 10, height: 10 });
    expect(r.ops[1].tag).toBe("circle");
    expect(pairs(r.ops[1], "geo")).toEqual({ cx: 60, cy: 60, r: 10 });
    // A shape without a fill of its own inherits it from the <use>.
    expect(pairs(r.ops[1], "extra").fill).toBe("#0000ff");
    expect(r.warnings.use).toBe(1);
  });

  it("turns outlines into lines, a line never filled, and scales the stroke", () => {
    const r = ok(svg(`
      <line x1="0" y1="0" x2="50" y2="0" stroke="black" stroke-width="2" stroke-linecap="round"/>
      <polyline points="0,10 10,20 20,10" fill="none" stroke="#333" stroke-dasharray="4,2"/>
      <rect x="0" y="30" width="10" height="10" fill="none" stroke="red" stroke-linejoin="round"/>`, 'viewBox="0 0 50 50"'));
    expect(r.ops[0]).toMatchObject({ op: "tratto", d: "M0 0L100 0" });
    expect(pairs(r.ops[0], "extra")).toEqual({ stroke: "#000000", stroke_width: 4, stroke_linecap: "round", stroke_linejoin: "miter" });
    expect(r.ops[1].op).toBe("tratto");
    expect(pairs(r.ops[1], "extra").stroke_dasharray).toBe("8 4");
    // A rect stays a shape of the editor, empty inside.
    expect(r.ops[2]).toMatchObject({ op: "forma", tag: "rect" });
    expect(pairs(r.ops[2], "extra")).toEqual({ fill: "none", stroke: "#ff0000", stroke_width: 2 });
  });

  it("leaves out what a description cannot draw, and says so", () => {
    const r = ok(svg(`
      <text x="0" y="10">Pump</text><image href="pump.png" width="10" height="10"/>
      <path fill-rule="evenodd" d="M0 0H50V50H0Z M10 10H40V40H10Z"/>
      <rect clip-path="url(#c)" mask="url(#m)" filter="url(#f)" x="0" y="0" width="10" height="10"/>
      <rect x="0" y="0" width="10" height="10" display="none"/>
      <rect x="0" y="0" width="10" height="10" fill="none"/>`));
    expect(r.ops).toHaveLength(2);
    expect(r.warnings).toEqual({ text: 1, image: 1, evenodd: 1, clip: 1, mask: 1, filter: 1 });
  });

  // Plan 2026-11-21-simboli-fase-3-foto: a photo inside the SVG comes along,
  // in its box, upright; one linked from elsewhere can't.
  it("keeps the photos inside the SVG, in their box", () => {
    const r = ok(svg(`
      <rect x="0" y="0" width="100" height="100" fill="#123456"/>
      <g transform="translate(10 20)"><image href="data:image/png;base64,iVBORw0KGgo=" x="0" y="0" width="40" height="30" opacity="0.5"/></g>
      <image xlink:href="data:image/jpeg;base64,/9j/4AAQ" x="50" y="50" width="20" height="20"/>
      <image href="https://example.com/x.png" width="10" height="10"/>`));
    expect(r.ops).toHaveLength(3);
    expect(r.ops[1]).toEqual({ op: "image", src: "data:image/png;base64,iVBORw0KGgo=",
      geo: [["x", 10], ["y", 20], ["width", 40], ["height", 30]], opacity: 0.5 });
    expect(r.ops[2]).toMatchObject({ op: "image", src: "data:image/jpeg;base64,/9j/4AAQ" });
    expect(r.warnings).toEqual({ image: 1 });
  });

  it("recognises circles, ellipses and rectangles written as paths (SVG Repo)", () => {
    const r = ok(svg(`
      <path d="M443.102 610.442a68.898 68.816 0 1 0 137.796 0 68.898 68.816 0 1 0-137.796 0Z" fill="#433F43"/>
      <path d="M100 500a80 40 0 1 0 160 0a80 40 0 1 0-160 0z" fill="#abc"/>
      <path d="M100 100H300V200H100Z" fill="#123"/>
      <polygon points="400,100 500,100 500,150 400,150" fill="#456"/>
      <path d="M600 100H700V200H600" fill="none" stroke="#000"/>
      <path d="M600 300a50 50 0 0 1 100 0" fill="#789"/>
      <path transform="rotate(30 700 700)" d="M650 650H750V750H650Z" fill="#000"/>`, 'viewBox="0 0 1000 1000"'));
    expect(r.ops.map((o) => o.tag ?? o.op)).toEqual(["circle", "ellipse", "rect", "rect", "tratto", "path", "path"]);
    // Within one per cent of round: a circle, the radius their mean.
    expect(pairs(r.ops[0], "geo")).toEqual({ cx: 51.2, cy: 61.04, r: 6.89 });
    expect(pairs(r.ops[1], "geo")).toEqual({ cx: 18, cy: 50, rx: 8, ry: 4 });
    expect(pairs(r.ops[2], "geo")).toEqual({ x: 10, y: 10, width: 20, height: 10 });
    for (const o of r.ops) expect(compilerAccepts(o)).toBeNull();
  });

  it("writes a shape that goes beyond the drawing as a path, which may", () => {
    const r = ok(svg('<rect x="-20" y="0" width="50" height="10"/><circle cx="100" cy="50" r="10"/>'));
    expect(r.ops.map((o) => o.tag)).toEqual(["path", "path"]);
  });

  it("refuses what is not an SVG, an SVG with nothing to draw, a full symbol", () => {
    expect(importSvg("hello", { w: 100, h: 100, room: 10 })).toEqual({ ok: false, error: "notSvg" });
    expect(importSvg(svg("<text>x</text>"), { w: 100, h: 100, room: 10 })).toEqual({ ok: false, error: "empty" });
    expect(importSvg(svg('<rect width="1" height="1"/>'), { w: 100, h: 100, room: 0 })).toEqual({ ok: false, error: "full" });
    expect(importSvg(" ".repeat(2_000_001), { w: 100, h: 100, room: 10 })).toEqual({ ok: false, error: "tooBig" });
    // Not XML (an HTML entity), still an SVG.
    expect(importSvg(svg('<rect width="10" height="10"/><desc>&nbsp;</desc>'), { w: 100, h: 100, room: 10 }).ok).toBe(true);
  });

  it("stops at the room the symbol has, and counts the rest", () => {
    const r = ok(svg('<rect width="1" height="1"/><rect width="2" height="2"/><rect width="3" height="3"/>'), { w: 100, h: 100, room: 2 });
    expect(r.ops).toHaveLength(2);
    expect(r.warnings.tooMany).toBe(1);
  });

  it("splits a path too long for the compiler into its subpaths", () => {
    const sub = Array.from({ length: 400 }, (_, k) => `M${k % 90}.123 ${(k * 7) % 90}.456h3.333v3.333h-3.333z`).join("");
    const r = ok(svg(`<path d="${sub}"/>`));
    expect(r.ops.length).toBeGreaterThan(1);
    for (const o of r.ops) expect(String(pairs(o, "geo").d).length).toBeLessThanOrEqual(4000);
    expect(r.warnings.split).toBe(1);
  });

  it("writes only what the compiler accepts", () => {
    const r = ok(svg(`
      <style>.x{fill:#ABC;stroke:rgba(0,0,0,.5);stroke-width:40}</style>
      <g transform="matrix(0.8 0.3 -0.2 0.9 5 5) skewX(10)">
        <rect class="x" x="5" y="5" width="30" height="20" rx="4"/>
        <ellipse cx="50" cy="40" rx="20" ry="10" fill="tomato"/>
        <polygon points="10,80 30,60 50,80" fill="#0a0" stroke="#000" stroke-linejoin="arcs"/>
        <path d="M60 60q10-20 20 0t20 0c0 10-10 20-20 20s-20-10-20-20z" fill="orange"/>
      </g>`));
    expect(r.ops.length).toBe(4);
    for (const o of r.ops) expect(compilerAccepts(o)).toBeNull();
    expect(r.warnings.strokeWide).toBe(1);
  });
});

describe("placeImport", () => {
  const imported = (n: number): SvgImport => ({ ok: true, ops: Array.from({ length: n }, (_, k) => newRect({ x: k, y: k, w: 5, h: 5 })), warnings: {} });

  it("puts a drawing into the body of a new symbol, instead of its box, with the proportions of the SVG", () => {
    const d = emptySymbol({ it: "x", en: "x" }, []);
    expect(isBlank(d)).toBe(true);
    const r = placeImport(d, { ...imported(2), size: { w: 100, h: 50 } });
    expect(r.d.h).toBe(50);
    expect((r.d.ops as Op[]).map((o) => o.op)).toEqual(["corpo", "forma", "forma"]);
    expect(layers(r.d).find((l) => l.kind === "body")?.ops).toEqual(r.at);
    expect(r.at).toEqual([1, 2]);
  });

  it("adds a static layer on top when the last one is not static", () => {
    const base = emptySymbol({ it: "x", en: "x" }, []);
    const d: DescrizioneSimbolo = { ...base, ops: [...base.ops, newRect({ x: 0, y: 0, w: 10, h: 10 })] };
    expect(isBlank(d)).toBe(false);
    // Two operations, and the new layer.
    expect(roomFor(d)).toBe(MAX_OPS - 3);
    const r = placeImport(d, imported(2));
    expect((r.d.ops as Op[]).map((o) => o.op)).toEqual(["corpo", "forma", "statico", "forma", "forma"]);
    expect(r.at).toEqual([3, 4]);
    // The next import goes into that same layer.
    const again = placeImport(r.d, imported(1));
    expect(again.d.ops).toHaveLength(6);
    expect(again.at).toEqual([5]);
  });
});

describe("looksLikeSvg", () => {
  it("recognises SVG code and nothing else", () => {
    expect(looksLikeSvg('<?xml version="1.0"?>\n<!-- Inkscape -->\n<!DOCTYPE svg>\n<svg xmlns="…">')).toBe(true);
    expect(looksLikeSvg("  <svg>")).toBe(true);
    expect(looksLikeSvg("<svgx>")).toBe(false);
    expect(looksLikeSvg("a pump <svg>")).toBe(false);
  });
});
