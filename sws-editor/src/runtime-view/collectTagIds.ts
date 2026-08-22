// ── Raccolta dei tag referenziati da una pagina (F0.1, piano SCADA-widgets) ──
//
// Il filtro di sottoscrizione del canale /ws/tags è ESATTO: il server invia i
// delta solo per gli id sottoscritti (router.rs, `sub.contains(id)`). La
// vecchia raccolta in RuntimeView guardava solo `o.tag` più campi legacy
// inesistenti (`value_tag`, `min_tag`, `max_tag`, `pens`): tutti i tag usati
// SOLO da binding, visibilità, stati, serie dei grafici, celle grid e figli
// faceplate ricevevano lo snapshot iniziale e poi si CONGELAVANO.
//
// Questa è la fonte di verità unica su "quali tag usa un oggetto". Quando un
// campo tag-bearing nuovo entra nello schema, va aggiunto QUI (oltre che nel
// rendering) — altrimenti il sintomo è subdolo: valore fermo, nessun errore.
// La F2 (binding a espressioni) registrerà qui le dipendenze estratte dal parse.

import type { FaceplateDef, GridCell, SubCellEntry, SynopticObject } from "@/types";
import { substituteFaceplateParams } from "@/canvas/SvgCanvas";
import { extractDeps } from "@/expr/engine";

/** Campi scalari il cui valore è direttamente un tag id. */
const TAG_FIELDS = [
  "tag",
  "visible_tag",
  "state_tag",
  "alarm_tag",
  "fill_level_tag",
  "pipe_label_tag",
  "y_tag",
  "pie_center_tag",
  "blink_tag",
] as const;

function addIf(ids: Set<string>, v: unknown): void {
  if (typeof v === "string" && v.trim() !== "") ids.add(v);
}

function visitSubCell(ids: Set<string>, entry: SubCellEntry | undefined, visit: (o: SynopticObject) => void): void {
  if (!entry) return;
  addIf(ids, entry.visible_tag);
  if (entry.child) visit(entry.child);
  if (entry.sub) {
    visitSubCell(ids, entry.sub.a, visit);
    visitSubCell(ids, entry.sub.b, visit);
  }
}

function visitCell(ids: Set<string>, cell: GridCell, visit: (o: SynopticObject) => void): void {
  addIf(ids, cell.visible_tag);
  if (cell.child) visit(cell.child);
  if (cell.sub) {
    visitSubCell(ids, cell.sub.a, visit);
    visitSubCell(ids, cell.sub.b, visit);
  }
}

/**
 * Tutti i tag id referenziati dagli oggetti dati, figli inclusi (celle grid
 * ricorsive, figli faceplate DOPO la sostituzione dei parametri — un
 * faceplate con `tag: "{p}.temp"` e param `p=zona1` sottoscrive `zona1.temp`).
 */
export function collectTagIds(
  objects: readonly SynopticObject[],
  faceplates: readonly FaceplateDef[] = [],
): string[] {
  const ids = new Set<string>();
  // Guardia anti-cicli: un faceplate che (direttamente o via annidamento)
  // referenzia sé stesso non deve mandare in loop la raccolta.
  const faceplateStack: string[] = [];

  const visit = (obj: SynopticObject): void => {
    for (const f of TAG_FIELDS) addIf(ids, obj[f]);
    // F2: il binding può essere una stringa (tag id), {tag,+scaling} o {expr}
    // — dall'espressione si estraggono le dipendenze via parser.
    if (obj.bindings) {
      for (const v of Object.values(obj.bindings)) {
        if (typeof v === "string") addIf(ids, v);
        else if (v.expr) for (const dep of extractDeps(v.expr)) ids.add(dep);
        else addIf(ids, v.tag);
      }
    }
    for (const t of obj.extra_tags ?? []) addIf(ids, t);
    for (const r of obj.table_rows ?? []) addIf(ids, r.tag);
    for (const s of obj.bar_series ?? []) addIf(ids, s.tag);
    for (const s of obj.pie_slices ?? []) addIf(ids, s.tag);
    for (const c of obj.grid_cells ?? []) visitCell(ids, c, visit);

    if (obj.type === "faceplate" && obj.faceplate_id && !faceplateStack.includes(obj.faceplate_id)) {
      const def = faceplates.find((f) => f.id === obj.faceplate_id);
      if (def) {
        faceplateStack.push(obj.faceplate_id);
        const params = obj.faceplate_params ?? {};
        for (const child of def.objects) visit(substituteFaceplateParams(child, params));
        faceplateStack.pop();
      }
    }
  };

  for (const obj of objects) visit(obj);
  return [...ids];
}
