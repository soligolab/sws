// Chi può scrivere un tag dal viewer (25-10-2026, piano
// docs/plans/2026-10-25-scrittura-senza-login.md).
//
// Valgono **tutti e due** i vincoli, e vince il più severo (decisione del
// maintainer): il tag dice chi può scriverlo — ed è l'unico che il server fa
// rispettare — e l'oggetto può solo restringere, nell'interfaccia
// (`isRoleAllowed` in `SvgCanvas`). Qui c'è la metà del tag, la stessa regola
// di `tag_write_allowed` in `sws-web/src/router.rs`: una soglia assente vuol
// dire Operator, «Viewer» vuol dire chiunque, anonimo compreso — perché per il
// server l'anonimo è Viewer.
import type { TagDef } from "@/types";

const RANGO: Record<string, number> = { Viewer: 0, Operator: 1, Supervisor: 2, Admin: 3 };

/** La soglia di scrittura del tag `id`: la sua, o quella della radice
 *  dell'istanza (`motore1.marcia` → `motore1`), come `write_role_of` del
 *  server. Assente = `Operator`. */
export function sogliaScritturaTag(tags: TagDef[] | undefined, id: string): string {
  const esatto = tags?.find((t) => t.id === id);
  if (esatto?.write_min_role) return esatto.write_min_role;
  const punto = id.indexOf(".");
  if (punto > 0) {
    const radice = tags?.find((t) => t.id === id.slice(0, punto));
    if (radice?.write_min_role) return radice.write_min_role;
  }
  return "Operator";
}

/** Il ruolo `ruolo` (dallo store; `null` = non ancora saputo = anonimo) basta
 *  per la soglia? L'anonimo conta come Viewer, come sul server. */
export function puoScrivere(soglia: string, ruolo: string | null | undefined): boolean {
  const ho = RANGO[ruolo ?? "Viewer"] ?? 0;
  return ho >= (RANGO[soglia] ?? RANGO.Operator);
}

/** I tipi che scrivono il proprio `tag` quando li si usa (le chiamate a
 *  `guardedWrite` in `SvgCanvas`). Il simbolo scrive `command_tag`. */
const SCRIVONO_IL_TAG = new Set(["button", "checkbox", "radio", "setpoint", "slider"]);

/** I tag che l'oggetto scrive: le assegnazioni se ci sono (come fa il clic),
 *  altrimenti il `command_tag` del simbolo o il `tag` dei tipi che scrivono.
 *  Vuoto per un oggetto che mostra soltanto. */
export function tagScrittiDa(obj: {
  type: string; tag?: string; command_tag?: string; assegnazioni?: { tag: string }[];
}): string[] {
  if (obj.assegnazioni?.length) return [...new Set(obj.assegnazioni.map((a) => a.tag).filter(Boolean))];
  if (obj.type === "symbol") return obj.command_tag ? [obj.command_tag] : [];
  return SCRIVONO_IL_TAG.has(obj.type) && obj.tag ? [obj.tag] : [];
}
