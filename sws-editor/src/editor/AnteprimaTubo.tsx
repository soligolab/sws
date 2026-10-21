// L'anteprima dello stile del tubo nel pannello proprietà (15-10-2026, piano
// docs/archive/2026-10-15-tubazioni-bocche-e-stili.md): un tratto a L disegnato
// dalla stessa funzione del canvas, con le estremità come sarebbero su due
// bocche. Colore, estremità e stile di progetto quelli veri del tubo.

import { svgTubo, stileTubo } from "@/canvas/stiliTubo";
import { CONTORNO_DISEGNO, useStileProgetto } from "@/symbols/stileProgetto";
import type { SynopticObject } from "@/types";

export function AnteprimaTubo({ obj }: { obj: SynopticObject }) {
  const prog = useStileProgetto();
  const stile = stileTubo(obj.pipe_style);
  if (!stile) return null;
  const d = 10;
  const markup = svgTubo({
    id: `anteprima-${obj.id}`, punti: [{ x: 14, y: 14 }, { x: 150, y: 14 }, { x: 150, y: 50 }], stile, d,
    stroke: obj.stroke, materiali: prog?.materials ?? {},
    volume: Math.min(100, Math.max(0, prog?.volume ?? 100)) / 100,
    contorno: [prog?.outline_color ?? CONTORNO_DISEGNO, prog?.outline_width ?? 1],
    estremita: [obj.start_marker, obj.end_marker], bocche: [d, d],
  });
  return (
    <svg data-testid="anteprima-tubo" viewBox="0 0 170 64" width="100%" height={64} aria-hidden="true"
      style={{ display: "block", background: "var(--brand-bg, #0f172a)", borderRadius: 4, margin: "6px 0" }}
      dangerouslySetInnerHTML={{ __html: markup }} />
  );
}
