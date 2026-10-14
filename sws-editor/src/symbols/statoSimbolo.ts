// Lo stato di un simbolo dai suoi tag: spento, acceso o allarme, più la voce di
// `symbol_states` che corrisponde. Uno per tutti i simboli (builtin, custom,
// libreria) e uguale a quello del pannello LVGL: i casi stanno in
// `tests/fixtures/stato-simbolo.json` e li verifica anche `lvgl_render.rs`.
//
// Fino al 14-10-2026 il pannello leggeva un tag di testo con `parse::<f64>()`:
// «on» valeva 0 e il simbolo restava spento, mentre il browser lo accendeva; e
// una voce degli stati che corrispondeva non bastava ad accenderlo (M10 del
// piano docs/archive/2026-10-14-motore-simboli-lib.md).

import { matchTextListEntry } from "@/canvas/textList";
import type { TextListEntry } from "@/types";

export type StatoSimbolo = "off" | "on" | "alarm";

/** Vero/falso di un valore di tag: numeri diversi da zero, testi non vuoti. Un
 *  array o una struttura non hanno un valore di verità: «c'è» non vuol dire acceso. */
export function veroSimbolo(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.trim().length > 0;
  return false;
}

/** `allarme`/`stato`: i valori dei due tag, `undefined` se il tag non c'è o non ha valore. */
export function statoSimbolo(
  allarme: unknown,
  stato: unknown,
  stati: TextListEntry[] | undefined,
): { stato: StatoSimbolo; voce: number | null } {
  const voce = stati?.length && stato !== undefined
    ? (() => { const e = matchTextListEntry(stati, stato); return e ? stati.indexOf(e) : -1; })()
    : -1;
  const s: StatoSimbolo =
    allarme !== undefined && veroSimbolo(allarme) ? "alarm" :
    voce >= 0 ? "on" :
    stato !== undefined && veroSimbolo(stato) ? "on" : "off";
  return { stato: s, voce: voce >= 0 ? voce : null };
}
