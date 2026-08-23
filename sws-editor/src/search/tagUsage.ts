// ── Dove è usato un tag (F8.3) ──────────────────────────────────────────────
//
// Logica estratta dal tab Variabili (ConfigView), dove serviva solo a
// evidenziare le variabili non usate: la stessa risposta serve anche alla
// ricerca dell'editor ("dove è usato questo tag" cross-pagina), quindi vive in
// un posto unico invece di essere riscritta due volte.
//
// Copertura dichiarata: oggetti delle pagine (compresi i figli dei faceplate,
// via collectTagIds), tag e inhibit_tag degli allarmi, espressioni dei tag
// calcolati, script globali. NON coperti: ricette e funzioni Python — il
// riferimento lì è dinamico e cercarlo per sottostringa darebbe falsi positivi.

import { collectTagIds } from "@/runtime-view/collectTagIds";
import type { AlarmDef, FaceplateDef, GlobalScriptDef, SynopticPage, TagDef } from "@/types";

/** Riferimenti trovati per un tag: dove, e (per le pagine) l'id dell'oggetto. */
export interface TagUse {
  /** Testo pronto da mostrare, es. `pagina "Impianto"`. */
  where: string;
  /** Id pagina, quando il riferimento è su una pagina (per navigarci). */
  pageId?: string;
}

export interface TagUsageInput {
  pages: SynopticPage[];
  faceplates?: FaceplateDef[];
  alarms?: AlarmDef[];
  tags?: TagDef[];
  globalScripts?: GlobalScriptDef[];
}

/** Riferimenti a `tags["..."]` dentro espressioni e script. */
const EXPR_RE = /tags\["([^"]+)"\]/g;

/** Costruisce la mappa tagId → elenco dei punti che lo usano. */
export function buildTagUsage({
  pages, faceplates = [], alarms = [], tags = [], globalScripts = [],
}: TagUsageInput): Map<string, TagUse[]> {
  const m = new Map<string, TagUse[]>();
  const add = (id: string, use: TagUse) => {
    if (!id) return;
    const arr = m.get(id) ?? [];
    // Tetto per riga: l'elenco serve a capire DOVE cercare, non a essere esaustivo.
    if (arr.length < 12 && !arr.some((u) => u.where === use.where)) arr.push(use);
    m.set(id, arr);
  };

  for (const pg of pages) {
    for (const id of collectTagIds(pg.objects, faceplates)) {
      add(id, { where: `pagina "${pg.name}"`, pageId: pg.id });
    }
  }
  for (const a of alarms) {
    add(a.tag, { where: `allarme "${a.id}"` });
    if (a.inhibit_tag) add(a.inhibit_tag, { where: `allarme "${a.id}" (inhibit)` });
  }
  for (const td of tags) {
    if (!td.expression) continue;
    for (const mm of td.expression.matchAll(EXPR_RE)) {
      add(mm[1], { where: `espressione di "${td.id}"` });
    }
  }
  for (const gs of globalScripts) {
    for (const mm of gs.code.matchAll(EXPR_RE)) {
      add(mm[1], { where: `script "${gs.id}"` });
    }
  }
  return m;
}
