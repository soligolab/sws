// How a faceplate's content follows its instance box (25-11-2026, plan
// docs/plans/2026-11-25-correzioni-collaudo-dev3.md, part B).
//
// Until the collaudo of 2.27.0-dev.3 the web stretched the content with one
// SVG transform, axis by axis: a text in a box wider than its definition came
// out wide. The LVGL viewer already did otherwise (positions and sizes per
// axis, fonts by the smaller factor), so the two engines differed. Now:
// - no fit: the content at its own size, times `faceplate_zoom` (written by
//   «Change resolution» with the page factor);
// - "stretch" (and `true` of the older projects): the children moved and
//   sized per axis, the fonts by the smaller factor — `scala_figlio` of
//   `lvgl_render.rs`, the same fields;
// - "fit": one factor, the smaller of the two, centred in the box.
//
// The uniform cases stay an SVG transform: one factor does not deform, and
// strokes and points follow too.

import type { PipePoint, SynopticObject } from "@/types";
import { puntiMovimento } from "@/canvas/percorsoMovimento";

export type FaceplateFit = "none" | "stretch" | "fit";

export function faceplateFit(obj: Pick<SynopticObject, "faceplate_scale">): FaceplateFit {
  const v = obj.faceplate_scale;
  if (v === true || v === "stretch") return "stretch";
  if (v === "fit") return "fit";
  return "none";
}

/** The fonts that follow the smaller factor: the same three of `scala_figlio`. */
const BODY_FIELDS = ["font_size", "label_font_size", "unit_font_size"] as const;

/** A child stretched per axis, its fonts by the smaller factor (twin of
 *  `scala_figlio` in `lvgl_render.rs`: who changes one changes the other).
 *  The ends of a line (`x2`, `y2`), the points of a polyline or pipe and the
 *  motion path follow the axes too: without them a horizontal line became a
 *  diagonal (review of 25-11-2026). */
export function stretchChild(c: SynopticObject, sx: number, sy: number): SynopticObject {
  const body = Math.min(sx, sy);
  const out: SynopticObject = { ...c };
  if (typeof c.x === "number") out.x = c.x * sx;
  if (typeof c.y === "number") out.y = c.y * sy;
  if (typeof c.width === "number") out.width = c.width * sx;
  if (typeof c.height === "number") out.height = c.height * sy;
  if (typeof c.x2 === "number") out.x2 = c.x2 * sx;
  if (typeof c.y2 === "number") out.y2 = c.y2 * sy;
  const stretchPoints = (ps: PipePoint[]) => ps.map((p) => ({ ...p, x: p.x * sx, y: p.y * sy }));
  if (Array.isArray(c.points)) out.points = stretchPoints(c.points);
  // `puntiMovimento` also reads the older `[x, y]` pairs, as LVGL does.
  if (Array.isArray(c.motion_path)) out.motion_path = stretchPoints(puntiMovimento(c.motion_path));
  for (const f of BODY_FIELDS) {
    const v = c[f];
    if (typeof v === "number") out[f] = v * body;
  }
  return out;
}

export interface FaceplateLayout {
  /** Added after `translate(x, y)` of the instance; "" = none. */
  transform: string;
  /** The background, in the units of the content group: it covers the box. */
  background: { x: number; y: number; w: number; h: number };
  /** What happens to each child before it is drawn. */
  child: (c: SynopticObject) => SynopticObject;
}

const same = (c: SynopticObject) => c;
const f4 = (n: number) => Number(n.toFixed(4));

/** The layout of an instance `w × h` over a definition `box`. */
export function faceplateLayout(
  obj: Pick<SynopticObject, "faceplate_scale" | "faceplate_zoom">,
  w: number,
  h: number,
  box: { w: number; h: number },
): FaceplateLayout {
  const dw = box.w > 0 ? box.w : w;
  const dh = box.h > 0 ? box.h : h;
  const fit = faceplateFit(obj);
  if (fit === "stretch") {
    const sx = w / dw;
    const sy = h / dh;
    return { transform: "", background: { x: 0, y: 0, w, h }, child: (c) => stretchChild(c, sx, sy) };
  }
  if (fit === "fit") {
    const s = Math.min(w / dw, h / dh);
    const dx = (w - dw * s) / 2;
    const dy = (h - dh * s) / 2;
    return {
      transform: ` translate(${f4(dx)}, ${f4(dy)}) scale(${f4(s)})`,
      // `+ 0`: no negative zero when the content fills that axis.
      background: { x: -dx / s + 0, y: -dy / s + 0, w: w / s, h: h / s },
      child: same,
    };
  }
  const z = typeof obj.faceplate_zoom === "number" && obj.faceplate_zoom > 0 ? obj.faceplate_zoom : 1;
  if (z === 1) return { transform: "", background: { x: 0, y: 0, w, h }, child: same };
  return { transform: ` scale(${f4(z)})`, background: { x: 0, y: 0, w: w / z, h: h / z }, child: same };
}
