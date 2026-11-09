// I parametri dei faceplate: la sostituzione `{p}`, i valori effettivi e i
// figli di un'istanza come li disegna il canvas.
//
// Stavano in `SvgCanvas.tsx` fino al 09-11-2026 (piano «viewer leggero», passo
// 4). Li usa anche la raccolta dei tag (`runtime-view/collectTagIds.ts`), che
// importandoli da lì passava dal canvas e dallo store: un giro di import che
// `tag/rinominaTag.ts` doveva aggirare a mano. Qui non dipendono da niente.
// `SvgCanvas.tsx` li riesporta, per chi li importa da lì.

import type { FaceplateDef, SynopticObject } from "@/types";
import { normalizeFaceplateParams } from "@/faceplate/definizione";

/** Campi strutturali che la sostituzione NON deve toccare: identità e
 *  riferimenti che parametrizzare romperebbe (id oggetto, tipo, gruppo,
 *  riferimento alla definizione del faceplate stesso). */
const FACEPLATE_SUB_EXCLUDE = new Set(["id", "type", "group_id", "faceplate_id"]);

/** F6.1 — sostituzione parametri su TUTTI i campi stringa, ricorsiva.
 *  Prima toccava solo tag/label/name/text: un faceplate pompa reale con
 *  `state_tag: "{p}.running"`, binding `{p}.mode` o soglie nelle celle grid
 *  non funzionava. Il walker attraversa oggetti e array (bindings, grid_cells,
 *  table_rows, faceplate_params annidati → pass-through dei parametri ai
 *  faceplate figli); un valore senza `{` passa per identità (niente copie).
 *  La usa anche l'anteprima della configurazione dei faceplate, coi nomi dei
 *  parametri al posto dei valori. */
export function substituteFaceplateParams(
  child: SynopticObject,
  params: Record<string, string>,
): SynopticObject {
  if (Object.keys(params).length === 0) return child;
  const subStr = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.indexOf("{") >= 0 ? subStr(v) : v;
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => { const nx = walk(x); if (nx !== x) changed = true; return nx; });
      return changed ? out : v;
    }
    if (v && typeof v === "object") {
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        const nv = FACEPLATE_SUB_EXCLUDE.has(k) ? val : walk(val);
        out[k] = nv;
        if (nv !== val) changed = true;
      }
      return changed ? out : v;
    }
    return v;
  };
  return walk(child) as SynopticObject;
}

/** F6.2 — parametri effettivi di un'istanza: valori dell'istanza + default
 *  della definizione per i parametri non forniti. */
export function effectiveFaceplateParams(
  def: FaceplateDef,
  instance: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of normalizeFaceplateParams(def)) {
    const v = instance?.[p.name];
    if (v !== undefined && v !== "") out[p.name] = v;
    else if (p.default !== undefined) out[p.name] = p.default;
  }
  // Chiavi extra dell'istanza (parametri rimossi dalla def): passano comunque,
  // così un template rinominato non rompe in silenzio la sostituzione.
  for (const [k, v] of Object.entries(instance ?? {})) {
    if (!(k in out) && v !== "") out[k] = v;
  }
  return out;
}

/** I figli di un faceplate come li disegna il canvas: parametri effettivi
 *  (default compresi), poi gli override per figlio (F6.4, il «link spezzato»
 *  rispetto alla definizione). Una funzione sola per l'istanza sulla pagina, il
 *  popup di `open_faceplate` (che passa i parametri del bottone e non ha
 *  override) e la raccolta dei tag: se divergono, un figlio legge un tag che il
 *  filtro di pagina non ha chiesto e resta fermo. */
export function figliDelFaceplate(
  istanza: Pick<SynopticObject, "faceplate_params" | "faceplate_overrides">,
  def: FaceplateDef,
): SynopticObject[] {
  const params = effectiveFaceplateParams(def, istanza.faceplate_params);
  return def.objects.map((child) => {
    const sub = substituteFaceplateParams(child, params);
    const over = istanza.faceplate_overrides?.[child.id];
    return over ? { ...sub, ...over, id: sub.id, type: sub.type } : sub;
  });
}
