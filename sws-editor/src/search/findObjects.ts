// ── Ricerca oggetti su tutte le pagine (F8.3) ───────────────────────────────
//
// Il filtro del pannello sinistro cerca per nome/tipo/id ma solo nella pagina
// aperta: su un progetto con dieci pagine "dov'è finito quel pulsante?" resta
// una caccia manuale. Qui la ricerca copre tutte le pagine e anche i TAG usati
// dagli oggetti, che è il modo in cui un progettista cerca davvero ("chi tocca
// pump1.speed?").

import { collectTagIds } from "@/runtime-view/collectTagIds";
import type { FaceplateDef, SynopticObject, SynopticPage } from "@/types";

/** Perché un oggetto è finito nei risultati: guida l'etichetta mostrata. */
export type MatchReason = "name" | "type" | "id" | "tag" | "text";

export interface ObjectHit {
  pageId: string;
  pageName: string;
  obj: SynopticObject;
  reason: MatchReason;
  /** Valore che ha fatto scattare la corrispondenza (tag id, testo, …). */
  detail?: string;
}

/** Tag riferiti da un singolo oggetto (faceplate inclusi). */
export function objectTags(obj: SynopticObject, faceplates: FaceplateDef[]): string[] {
  return collectTagIds([obj], faceplates);
}

/**
 * Cerca `query` su tutte le pagine. Confronto case-insensitive per
 * sottostringa; l'ordine dei criteri è quello di utilità decrescente (un match
 * sul nome è più significativo di uno sul tipo), e ogni oggetto compare una
 * volta sola col motivo migliore.
 */
export function findObjects(
  pages: SynopticPage[],
  faceplates: FaceplateDef[],
  query: string,
): ObjectHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: ObjectHit[] = [];

  for (const pg of pages) {
    for (const obj of pg.objects ?? []) {
      const push = (reason: MatchReason, detail?: string) => {
        out.push({ pageId: pg.id, pageName: pg.name, obj, reason, detail });
      };
      const name = (obj.name ?? "").toLowerCase();
      if (name.includes(q))            { push("name", obj.name); continue; }
      if (obj.id.toLowerCase().includes(q)) { push("id", obj.id); continue; }
      const tagHit = objectTags(obj, faceplates).find((t) => t.toLowerCase().includes(q));
      if (tagHit)                      { push("tag", tagHit); continue; }
      if (obj.type.toLowerCase().includes(q)) { push("type", obj.type); continue; }
      // Testo ed etichetta: chi cerca "Avvio" pensa a quello che c'è scritto
      // sul pulsante, non all'id che l'editor ha generato da solo.
      const text = `${obj.text ?? ""} ${obj.label ?? ""}`.toLowerCase();
      if (text.trim() && text.includes(q)) { push("text", obj.text ?? obj.label); continue; }
    }
  }
  return out;
}
