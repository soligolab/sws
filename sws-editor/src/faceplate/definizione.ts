// Le funzioni pure su una definizione di faceplate, senza dipendenze: le usano
// il canvas, lo store e il modello delle pagine-faceplate. Stavano in
// `SvgCanvas.tsx` fino al 29-10-2026, e importarle da lì nello store faceva un
// giro di import store → canvas → store.

import type { FaceplateDef, FaceplateParamDef } from "@/types";

/** F6.2 — normalizza i parametri di una definizione (stringa nuda → oggetto). */
export function normalizeFaceplateParams(def: FaceplateDef): FaceplateParamDef[] {
  return (def.params ?? []).map((p) => (typeof p === "string" ? { name: p } : p));
}

/** F6.4 — bbox della definizione (per lo scaling al box dell'istanza). La
 *  misura dichiarata, quando c'è (29-10-2026): è il foglio su cui il faceplate
 *  è stato disegnato. Nasce uguale al riquadro dei figli, quindi le istanze
 *  che scalano non si spostano di un pixel il giorno in cui compare. */
export function faceplateDefBBox(def: FaceplateDef): { w: number; h: number } {
  if (def.width && def.height && def.width > 0 && def.height > 0) return { w: def.width, h: def.height };
  let w = 0, h = 0;
  for (const c of def.objects) {
    w = Math.max(w, (c.x ?? 0) + (c.width ?? 100));
    h = Math.max(h, (c.y ?? 0) + (c.height ?? 50));
  }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}
