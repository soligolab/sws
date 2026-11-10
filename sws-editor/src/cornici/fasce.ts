// Le fasce della cornice in modifica (10-11-2026): testata e piede sono
// riservati alla cornice, e l'editor colora in arancio l'oggetto della pagina
// che ci sta anche solo in parte. Gemello della sola geometria di
// `oggetti_nelle_fasce` in `sws-web/src/cornici.rs`, che dà l'avviso del
// validatore: stessi riquadri, stessa tolleranza, tubi esclusi.

import type { Cornice, SynopticObject } from "@/types";

type Riquadro = readonly [number, number, number, number];

/** Il riquadro approssimato di un oggetto: gemello di `riquadro` in
 *  `cornici.rs`. Un testo senza riquadro ha `y` sulla linea di base; una
 *  linea va da `x,y` a `x2,y2`. */
export function riquadro(o: SynopticObject): Riquadro {
  const { x, y } = o;
  if (o.type === "line") {
    const x2 = o.x2 ?? x + 100;
    const y2 = o.y2 ?? y;
    return [Math.min(x, x2), Math.min(y, y2), Math.max(x, x2), Math.max(y, y2)];
  }
  if (o.width != null && o.height != null) return [x, y, x + o.width, y + o.height];
  if (o.type === "text") {
    const fs = o.font_size ?? 14;
    const n = o.text != null ? [...o.text].length : 4;
    const w = o.width ?? n * fs * 0.6;
    return [x, y - fs, x + w, y];
  }
  return [x, y, x + (o.width ?? 0), y + (o.height ?? 0)];
}

const siCoprono = (a: Riquadro, b: Riquadro) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

export interface Invasione {
  id: string;
  testata: boolean;
  piede: boolean;
  /** Copre un oggetto della cornice (il titolo, l'ora, il navigatore). */
  copre: boolean;
}

const TOLLERANZA = 0.5;

/** Gli oggetti della pagina che stanno anche solo in parte in testata o nel
 *  piede della cornice. Gemello di `oggetti_nelle_fasce`. */
export function oggettiNelleFasce(oggetti: readonly SynopticObject[], cornice: Cornice): Invasione[] {
  const t = Math.max(0, cornice.testata.altezza);
  const p = Math.max(0, cornice.piede.altezza);
  const inizioPiede = cornice.altezza - p;
  const suoi = cornice.oggetti.map(riquadro);
  const out: Invasione[] = [];
  for (const o of oggetti) {
    if (o.type === "pipe") continue;
    const r = riquadro(o);
    const testata = t > 0 && r[1] < t - TOLLERANZA;
    const piede = p > 0 && r[3] > inizioPiede + TOLLERANZA;
    if (!testata && !piede) continue;
    out.push({ id: o.id, testata, piede, copre: suoi.some((c) => siCoprono(r, c)) });
  }
  return out;
}
