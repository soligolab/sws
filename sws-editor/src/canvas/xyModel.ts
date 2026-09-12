// ── Modello serie del XY plot (migrazione 2026-09-12, F5.3x/T-70) ───────────
//
// Formato nuovo: `xy_series: XySeries[]` — coppia tag/y_tag + stile in
// un'unica lista, sul modello di `trendModel.ts` (2026-08-23). Formato
// legacy: `tag` (X) + `y_tag` (Y), una coppia sola, colore in `line_color`.
//
// `normalizeXyObject` converte al load e RIMUOVE i campi legacy, stesso
// taglio netto del trend: il primo salvataggio scrive solo il formato
// nuovo, i runtime/LVGL più vecchi di questa migrazione mostrano xy_plot
// vuoti finché non vengono aggiornati.

import type { SynopticObject, XySeries } from "@/types";

/** Serie effettive di un xy_plot (dal formato nuovo; legacy convertito al
 *  volo come fallback di sicurezza per oggetti non passati dallo store). */
export function xySeriesOf(obj: SynopticObject): XySeries[] {
  if (obj.xy_series) return obj.xy_series;
  return legacyToSeries(obj);
}

function legacyToSeries(obj: SynopticObject): XySeries[] {
  // Nessuna coppia configurata: nessuna serie, non una serie vuota "()".
  if (!obj.tag && !obj.y_tag) return [];
  const series: XySeries = { tag: obj.tag ?? "", y_tag: obj.y_tag ?? "" };
  if (obj.line_color !== undefined) series.color = obj.line_color;
  return [series];
}

/** Migra un oggetto xy_plot legacy al formato nuovo, rimuovendo i campi
 *  vecchi. Idempotente: un oggetto già migrato torna identico (stessa
 *  reference). */
export function normalizeXyObject(obj: SynopticObject): SynopticObject {
  if (obj.type !== "xy_plot" || obj.xy_series !== undefined) return obj;
  const migrated: SynopticObject = { ...obj, xy_series: legacyToSeries(obj) };
  delete migrated.tag;
  delete migrated.y_tag;
  delete migrated.line_color;
  return migrated;
}

/** Normalizza tutti gli xy_plot di una lista oggetti (identità se nulla cambia). */
export function normalizeXyObjects(objects: SynopticObject[]): SynopticObject[] {
  let changed = false;
  const out = objects.map((o) => {
    const n = normalizeXyObject(o);
    if (n !== o) changed = true;
    return n;
  });
  return changed ? out : objects;
}
