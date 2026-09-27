// I vertici del poligono regolare e della stella (26-09-2026, tipo `polygon`,
// piano `docs/archive/2026-09-26-pannello-luce-forme.md`, Fase C). Gemello di
// `vertici_poligono` in `sws-core/src/geometry.rs`, con gli stessi numeri nei
// test: il web e il pannello LVGL devono disegnare **la stessa** stella.
//
// La rotazione (e lo specchio) stanno nei vertici e non in una trasformata:
// LVGL non ruota i widget, e così la forma vale uguale sui due motori.
import type { PipePoint, SynopticObject } from "@/types";

export function verticiPoligono(
  o: Pick<SynopticObject, "x" | "y" | "width" | "height" | "sides" | "star" | "star_inner" | "rotation" | "flip_h" | "flip_v">,
): PipePoint[] {
  const w = o.width ?? 100;
  const h = o.height ?? 100;
  const lati = Number.isFinite(o.sides) ? (o.sides as number) : 6;
  const n = Math.min(24, Math.max(3, Math.round(lati)));
  const cx = o.x + w / 2;
  const cy = o.y + h / 2;
  const interno = Math.min(100, Math.max(1, Number.isFinite(o.star_inner) ? (o.star_inner as number) : 50)) / 100;
  const passi = o.star ? n * 2 : n;
  const rot = ((Number.isFinite(o.rotation) ? (o.rotation as number) : 0) * Math.PI) / 180;
  const [s, c] = [Math.sin(rot), Math.cos(rot)];
  const out: PipePoint[] = [];
  for (let i = 0; i < passi; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / passi;
    const k = o.star && i % 2 === 1 ? interno : 1;
    let dx = (w / 2) * k * Math.cos(ang);
    let dy = (h / 2) * k * Math.sin(ang);
    if (o.flip_h) dx = -dx;
    if (o.flip_v) dy = -dy;
    out.push({ x: cx + dx * c - dy * s, y: cy + dx * s + dy * c });
  }
  return out;
}

/** I punti come li vuole l'attributo SVG `points`. */
export const puntiSvg = (punti: readonly PipePoint[]) => punti.map((p) => `${p.x},${p.y}`).join(" ");
