// The Bad mark (plan docs/plans/2026-11-24-residui-rc30-e-bad-di-default.md,
// part C, decisions B2-B4 of 24-11-2026). A Bad value shows by default on every
// object with a tag: the object goes grey, and a "?" in full colour, out of the
// grey, sits on the top left corner of its box. An object gives it up with
// `bad_value_style: "none"`. Uncertain keeps only the yellow quality dot.
//
// Twin of `badge_qualita` in `sws-lvgl-viewer/src/effects.rs`: same rule, same
// place, same look. Change both together.
import type { SynopticObject, TagState } from "@/types";
import { objectBBox, riquadroTestoSemplice } from "@/pageLayout";

/** Radius of the mark, its fill, its border and the colour of the "?". */
export const BAD_MARK = {
  r: 7,
  fill: "#0f172a",
  stroke: "#f8fafc",
  text: "#f8fafc",
  fontSize: 11,
} as const;

/** Does the object show the Bad mark (grey and "?") for this value? */
export function badMarkShown(
  obj: Pick<SynopticObject, "bad_value_style">,
  tv: TagState | undefined,
): boolean {
  return obj.bad_value_style !== "none" && tv?.quality === "Bad";
}

/** The centre of the mark: the top left corner of the object's box. A text
 *  without wrap has its baseline in `y`: there the box is the one its letters
 *  take (`riquadroTestoSemplice`), as for the selection handles. Aligned to
 *  the start, its quality dot sits on the left of the letters (`xPallinoTesto`):
 *  there the mark goes to the top right corner, so the two do not overlap. */
export function badMarkCentre(obj: SynopticObject, content: string): { x: number; y: number } {
  if (obj.type === "text" && !obj.text_wrap) {
    const r = riquadroTestoSemplice(obj, content);
    const start = (obj.text_anchor ?? "start") === "start";
    return { x: start ? r.x + r.w : r.x, y: r.y };
  }
  const bb = objectBBox(obj);
  return { x: bb.x1, y: bb.y1 };
}
