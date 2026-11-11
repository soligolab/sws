// Il riquadro di selezione (piano 2026-11-11-selezione-e-gruppi).
//
// Fino all'11-11-2026 bastava che il riquadro toccasse un oggetto, e i
// bloccati non facevano eccezione: un'immagine a tutta area sotto gli oggetti
// entrava in ogni selezione, e «Bilancio di oggi» non si poteva spostare da
// solo (collaudo su Montagna). Ora conta l'oggetto **dentro per intero**, come
// in Inkscape e Illustrator, e i bloccati restano fuori.

import type { SynopticObject } from "@/types";
import type { BBox } from "@/pageLayout";

/** Gli id degli oggetti interamente dentro `r`. Un gruppo (non aperto) entra
 *  solo se ci sono dentro tutti i suoi membri, e allora entra intero. */
export function idsNelRiquadro(
  objects: readonly SynopticObject[],
  r: BBox,
  bbox: (o: SynopticObject) => BBox,
  gruppoAperto: string | null,
): string[] {
  const dentro = (o: SynopticObject) => {
    const b = bbox(o);
    return b.x1 >= r.x1 && b.x2 <= r.x2 && b.y1 >= r.y1 && b.y2 <= r.y2;
  };
  const gruppoDentro = new Map<string, boolean>();
  for (const o of objects) {
    const g = o.group_id;
    if (!g || g === gruppoAperto) continue;
    gruppoDentro.set(g, (gruppoDentro.get(g) ?? true) && !o.locked && dentro(o));
  }
  return objects
    .filter((o) => {
      if (o.locked) return false;
      const g = o.group_id;
      if (g && g !== gruppoAperto) return gruppoDentro.get(g) === true;
      return dentro(o);
    })
    .map((o) => o.id);
}
