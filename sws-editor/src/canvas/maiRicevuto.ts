// Un valore «mai ricevuto» (12-11-2026, decisione del maintainer): il runtime
// semina ogni tag dichiarato incerto e con `timestamp_ms` a 0 (`TagDb::semina`),
// finché una sorgente non lo scrive. Per chi disegna vale come nessun valore:
// una finestra non collegata dice «non collegata», non «chiusa». I comandi
// restano possibili: una variabile di memoria è mai ricevuta finché qualcuno
// non la scrive, e bloccarla la renderebbe inutile. Gemello di LVGL
// (`mai_ricevuto` in `lvgl_render.rs`).
import type { TagState } from "@/types";

export function maiRicevuto(tv: TagState | null | undefined): boolean {
  return !!tv && tv.timestamp_ms === 0 && tv.quality === "Uncertain";
}
