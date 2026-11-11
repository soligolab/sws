// I gruppi sul canvas (piano 2026-11-11-selezione-e-gruppi).
//
// Un gruppo è `group_id` sugli oggetti più la voce in `page.groups`: esisteva
// già, ma solo nell'elenco Oggetti. Sul canvas un clic prendeva il singolo
// oggetto e il gruppo non si vedeva. Qui le regole, pure: un clic su un membro
// prende tutto il gruppo, tranne nel gruppo «aperto» col doppio clic, dove si
// lavora sul singolo.

import type { ObjectGroup, SynopticObject } from "@/types";
import { objectBBox, type BBox } from "@/pageLayout";

/** Gli id, con ogni membro di un gruppo che porta con sé tutto il gruppo.
 *  Il gruppo aperto non si espande. L'ordine è quello di `objects`. */
export function espandiAlGruppo(ids: readonly string[], objects: readonly SynopticObject[],
                                gruppoAperto: string | null): string[] {
  const scelti = new Set(ids);
  const gruppi = new Set<string>();
  for (const o of objects) {
    if (scelti.has(o.id) && o.group_id && o.group_id !== gruppoAperto) gruppi.add(o.group_id);
  }
  if (gruppi.size === 0) return [...ids];
  return objects
    .filter((o) => scelti.has(o.id) || (o.group_id != null && gruppi.has(o.group_id)))
    .map((o) => o.id);
}

/** Il gruppo di cui `ids` sono esattamente tutti i membri, o `null`. */
export function gruppoIntero(ids: readonly string[], objects: readonly SynopticObject[]): string | null {
  if (ids.length < 2) return null;
  const scelti = new Set(ids);
  const primo = objects.find((o) => o.id === ids[0])?.group_id;
  if (!primo) return null;
  const membri = objects.filter((o) => o.group_id === primo);
  return membri.length === scelti.size && membri.every((o) => scelti.has(o.id)) ? primo : null;
}

/** Il riquadro che contiene tutti i membri del gruppo. */
export function bboxDelGruppo(gruppo: string, objects: readonly SynopticObject[]): BBox | null {
  let bb: BBox | null = null;
  for (const o of objects) {
    if (o.group_id !== gruppo) continue;
    const b = objectBBox(o);
    bb = bb ? { x1: Math.min(bb.x1, b.x1), y1: Math.min(bb.y1, b.y1),
                x2: Math.max(bb.x2, b.x2), y2: Math.max(bb.y2, b.y2) } : b;
  }
  return bb;
}

/** Le copie (duplica, incolla) prendono gruppi **nuovi**: con lo stesso
 *  `group_id` sarebbero entrate nel gruppo dell'originale, e un clic avrebbe
 *  preso originale e copia insieme. Un gruppo copiato solo in parte (un membro
 *  preso dal gruppo aperto) non diventa un gruppo: la copia resta sola. */
export function gruppiPerLeCopie(
  copie: SynopticObject[],
  origine: readonly SynopticObject[],
  gruppiOrigine: readonly ObjectGroup[],
  nuovoId: () => string,
  suffisso: string,
): { copie: SynopticObject[]; gruppi: ObjectGroup[] } {
  const quanti = new Map<string, number>();
  for (const o of origine) if (o.group_id) quanti.set(o.group_id, (quanti.get(o.group_id) ?? 0) + 1);
  const copiati = new Map<string, number>();
  for (const c of copie) if (c.group_id) copiati.set(c.group_id, (copiati.get(c.group_id) ?? 0) + 1);

  const nuovi = new Map<string, ObjectGroup>();
  const out = copie.map((c) => {
    const g = c.group_id;
    if (!g) return c;
    if (copiati.get(g) !== quanti.get(g) || (copiati.get(g) ?? 0) < 2) {
      const { group_id: _via, ...resto } = c;
      return resto as SynopticObject;
    }
    let ng = nuovi.get(g);
    if (!ng) {
      const nome = gruppiOrigine.find((x) => x.id === g)?.name ?? g;
      ng = { id: nuovoId(), name: `${nome} ${suffisso}` };
      nuovi.set(g, ng);
    }
    return { ...c, group_id: ng.id };
  });
  return { copie: out, gruppi: [...nuovi.values()] };
}
