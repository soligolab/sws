// ── Modello tracce del Trend (migrazione 2026-08-23, taglio netto) ──────────
//
// Formato nuovo: `trend_tags: TrendTrace[]` — tag + stile in un'unica lista,
// la traccia 1 non è più speciale. Formato legacy: `tag` (traccia 1) +
// `extra_tags[]` (2+) + `trend_series_styles[]` (stili per indice, 0 = tag) +
// `line_color` (colore traccia 1, battuto da styles[0].color se presente —
// era il bug B3: vinceva un campo invisibile in UI).
//
// `normalizeTrendObject` converte al load e RIMUOVE i campi legacy: il primo
// salvataggio scrive solo il formato nuovo. I runtime/LVGL più vecchi di
// questa migrazione mostrano trend vuoti finché non vengono aggiornati
// (decisione del maintainer, 2026-08-23).

import type { SynopticObject, TrendTrace } from "@/types";

/** True se l'oggetto trend usa ancora il formato legacy. */
export function isLegacyTrend(obj: SynopticObject): boolean {
  return obj.type === "trend" && obj.trend_tags === undefined;
}

/** Tracce effettive di un trend (dal formato nuovo; legacy convertito al volo
 *  come fallback di sicurezza per oggetti non passati dallo store). */
export function trendTraces(obj: SynopticObject): TrendTrace[] {
  if (obj.trend_tags) return obj.trend_tags;
  return legacyToTraces(obj);
}

function legacyToTraces(obj: SynopticObject): TrendTrace[] {
  const ids = [obj.tag ?? "", ...(obj.extra_tags ?? [])];
  const styles = obj.trend_series_styles ?? [];
  const traces: TrendTrace[] = [];
  ids.forEach((tag, i) => {
    const st = styles[i] ?? {};
    const trace: TrendTrace = { tag };
    // Traccia 1: styles[0].color vinceva su line_color (B3) — qui la
    // precedenza diventa esplicita e visibile.
    const color = st.color ?? (i === 0 ? obj.line_color : undefined);
    if (color !== undefined) trace.color = color;
    if (st.width !== undefined) trace.width = st.width;
    if (st.dash !== undefined) trace.dash = st.dash;
    if (st.fill !== undefined) trace.fill = st.fill;
    if (st.fill_opacity !== undefined) trace.fill_opacity = st.fill_opacity;
    if (st.smooth !== undefined) trace.smooth = st.smooth;
    if (st.own_scale !== undefined) trace.own_scale = st.own_scale;
    if (st.hidden !== undefined) trace.hidden = st.hidden;
    traces.push(trace);
  });
  // Le tracce con tag vuoto in coda sono spazzatura da "+ Aggiungi" mai
  // riempiti; una traccia vuota in mezzo va tenuta (l'utente la sta editando).
  while (traces.length > 0 && traces[traces.length - 1].tag === "") traces.pop();
  return traces;
}

/** Migra un oggetto trend legacy al formato nuovo, rimuovendo i campi vecchi.
 *  Idempotente: un oggetto già migrato torna identico (stessa reference). */
export function normalizeTrendObject(obj: SynopticObject): SynopticObject {
  if (obj.type !== "trend" || obj.trend_tags !== undefined) return obj;
  const migrated: SynopticObject = { ...obj, trend_tags: legacyToTraces(obj) };
  delete migrated.tag;
  delete migrated.extra_tags;
  delete migrated.trend_series_styles;
  delete migrated.line_color;
  return migrated;
}

/** Normalizza tutti i trend di una lista oggetti (identità se nulla cambia). */
export function normalizeTrendObjects(objects: SynopticObject[]): SynopticObject[] {
  let changed = false;
  const out = objects.map((o) => {
    const n = normalizeTrendObject(o);
    if (n !== o) changed = true;
    return n;
  });
  return changed ? out : objects;
}
