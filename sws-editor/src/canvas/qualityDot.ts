// Where the quality dot of a page object goes, type by type (maintainer,
// 28-11-2026: «pallino rosso ovunque»). The page wrapper draws it out of the
// grey group of a Bad value, so a Bad dot stays red, as on the LVGL panel.
// Twin of `centro_pallino` and `tag_del_pallino` in
// `sws-lvgl-viewer/src/effects.rs`: change both together. The numbers are the
// ones each type used when it drew its own dot.
import type { SynopticObject } from "@/types";

/** The tag whose quality the dot shows: the fill level tag on a pipe. */
export function qualityDotTag(obj: SynopticObject): string | undefined {
  return obj.type === "pipe" ? obj.fill_level_tag : obj.tag;
}

/** The estimated width of a text without wrap (`riquadroTestoSemplice`). */
function textWidth(obj: SynopticObject, content: string): number {
  const size = obj.font_size ?? 14;
  return Math.max(40, content.length * size * 0.6);
}

/** The centre of the dot. `pipePoints` is the route of a pipe (`percorsoTubo`). */
export function qualityDotCentre(
  obj: SynopticObject,
  content: string,
  pipePoints?: { x: number; y: number }[],
): { x: number; y: number } {
  const x = obj.x ?? 0;
  const y = obj.y ?? 0;
  switch (obj.type) {
    case "rect":
    case "ellipse":
      return { x: x + (obj.width ?? 100) - 8, y: y + 8 };
    case "progress_bar":
      return { x: x + (obj.width ?? 200) - 8, y: y + 8 };
    case "gauge":
      return { x: x + (obj.width ?? 160) - 10, y: y + 10 };
    case "kpi_tile":
      return { x: x + (obj.width ?? 180) - 8, y: y + (obj.height ?? 100) - 8 };
    case "text_list":
      return { x: x + 2, y: y + 2 };
    case "state_lamp":
      return { x, y };
    case "pipe": {
      const p = pipePoints?.[Math.floor(((pipePoints?.length ?? 1) - 1) / 2)];
      return p ? { x: p.x + 7, y: p.y - 7 } : { x, y };
    }
    case "text": {
      const anchor = obj.text_anchor ?? "start";
      if (obj.text_wrap) {
        return { x: anchor === "end" ? x + 8 : x + (obj.width ?? 160) - 8, y: y + 8 };
      }
      const w = textWidth(obj, content);
      const px = anchor === "end" ? x + 8 : anchor === "middle" ? x + w / 2 + 8 : x - 10;
      return { x: px, y: y - (obj.font_size ?? 14) / 2 };
    }
    default:
      // The other types: the top right corner of the box.
      return { x: x + (obj.width ?? 100) - 8, y: y + 8 };
  }
}
