// Spostata da SvgCanvas.tsx il 14-10-2026: la usa anche `symbols/statoSimbolo.ts`,
// che il test della fixture condivisa col pannello carica senza il canvas.

import type { TextListEntry } from "@/types";

/** Find the `text_list_entries` entry matching a live value — shared by
 *  `text_list` and `state_lamp`. An entry with either `value_min`/`value_max`
 *  set matches by range (half-open: `min <= v < max`, so adjacent buckets
 *  like [10,20) and [20,30) don't overlap); otherwise falls back to the
 *  original exact-value match, so existing saved entries keep working
 *  unchanged. First matching entry in array order wins. */
export function matchTextListEntry(
  entries: TextListEntry[] | undefined,
  liveVal: unknown,
): TextListEntry | undefined {
  const v = typeof liveVal === "number" ? liveVal : Number(liveVal);
  return (entries ?? []).find((e) => {
    if (e.value_min !== undefined || e.value_max !== undefined) {
      if (!Number.isFinite(v)) return false;
      if (e.value_min !== undefined && v < e.value_min) return false;
      if (e.value_max !== undefined && v >= e.value_max) return false;
      return true;
    }
    return String(e.value) === String(liveVal);
  });
}
