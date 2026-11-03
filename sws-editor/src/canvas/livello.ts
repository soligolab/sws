// La frazione di riempimento (0..1, non ancora tagliata) di un valore di
// livello, per i simboli con una parte «livello» e per il riempimento dei tubi.
//
// Fino al 03-11-2026 la scala era solo «0–100» (il default) o «0–1», e un tag in
// grandezze vere — `livello` 0–1000 mm nel tutorial — riempiva tutto il serbatoio
// già a 100. Decisione del maintainer: l'intervallo del tag. L'ordine:
//   1. `fill_level_min`/`fill_level_max` sull'oggetto (il server li scrive dal
//      tag per il pannello LVGL, `applica_predefiniti_tag`; si possono anche
//      scrivere a mano);
//   2. una scala scelta esplicitamente, «0–100» o «0–1»;
//   3. senza scala, l'intervallo del tag (`range_lo`/`range_hi`) se c'è;
//   4. altrimenti 0–100, come prima.

export interface ScalaLivello {
  fill_level_scale?: "0-1" | "0-100";
  fill_level_min?: number;
  fill_level_max?: number;
}

export interface IntervalloTag {
  range_lo?: number;
  range_hi?: number;
}

const intervallo = (lo: number | undefined, hi: number | undefined): [number, number] | null =>
  lo !== undefined && hi !== undefined && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? [lo, hi] : null;

export function frazioneLivello(v: number, obj: ScalaLivello, tag?: IntervalloTag): number {
  const sull = intervallo(obj.fill_level_min, obj.fill_level_max);
  if (sull) return (v - sull[0]) / (sull[1] - sull[0]);
  if (obj.fill_level_scale === "0-1") return v;
  if (obj.fill_level_scale === "0-100") return v / 100;
  const dalTag = intervallo(tag?.range_lo, tag?.range_hi);
  if (dalTag) return (v - dalTag[0]) / (dalTag[1] - dalTag[0]);
  return v / 100;
}
