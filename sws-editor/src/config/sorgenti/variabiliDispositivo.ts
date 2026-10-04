/** Le variabili di un dispositivo Modbus (04-10-2026): cosa si elimina insieme
 *  al dispositivo, e quali variabili esistenti un dispositivo nuovo può
 *  riprendere.
 *
 *  Richiesta del maintainer, dopo il collaudo: «quando elimino il dispositivo
 *  servirebbe la richiesta se voglio eliminare le variabili associate, e se dico
 *  no devo avere il modo di aggiungerne uno nuovo e riassociarlo alla struttura
 *  esistente». Puro: niente rete, niente store. */
import type { ProjectInfo, SourceDef, TagDef, TypeDef } from "@/types";
import { type BusModbus, dispositiviDi, eBusModbus } from "@/config/sorgenti/modbusDispositivi";
import type { DispositivoModbus } from "@/types";

/** `atr244_3.pv1` → `atr244_3`, `valvole[2].stato` → `valvole`. */
export function radiceDi(tag: string): string {
  return tag.split(/[.[]/)[0];
}

/** Le radici delle variabili che un dispositivo mappa. */
export function radiciDelDispositivo(d: DispositivoModbus): string[] {
  return [...new Set(d.registers.map((r) => radiceDi(r.tag)).filter((x) => x !== ""))];
}

/** Le radici mappate da tutte le sorgenti, tolto un dispositivo. */
function radiciMappateAltrove(sources: readonly SourceDef[], busId: string, unit: number): Set<string> {
  const out = new Set<string>();
  for (const s of sources) {
    if (eBusModbus(s)) {
      for (const d of dispositiviDi(s)) {
        if (s.id === busId && d.unit_id === unit) continue;
        for (const r of d.registers) out.add(radiceDi(r.tag));
      }
      continue;
    }
    // Gli altri protocolli: ogni lista di mappature con `tag`.
    for (const v of Object.values(s as unknown as Record<string, unknown>)) {
      if (Array.isArray(v)) for (const m of v) if (m && typeof m === "object" && typeof (m as { tag?: unknown }).tag === "string") out.add(radiceDi((m as { tag: string }).tag));
    }
  }
  return out;
}

export interface PianoEliminazione {
  /** Le variabili (radici) che se ne vanno. */
  variabili: string[];
  /** I tipi che non usa più nessuno. */
  tipi: string[];
  tags: TagDef[];
  types: TypeDef[];
}

/** Cosa si elimina insieme al dispositivo `unit` del bus `busId`: le sue
 *  variabili (solo quelle che nessun altro dispositivo o protocollo mappa) e i
 *  tipi rimasti senza istanze né membri che li usano. */
export function pianoEliminazione(project: Pick<ProjectInfo, "tags" | "types" | "sources">, bus: BusModbus, unit: number): PianoEliminazione {
  const d = dispositiviDi(bus).find((x) => x.unit_id === unit);
  const tags = project.tags ?? [];
  const types = project.types ?? [];
  if (!d) return { variabili: [], tipi: [], tags: [...tags], types: [...types] };
  const altrove = radiciMappateAltrove(project.sources ?? [], bus.id, unit);
  const via = new Set(radiciDelDispositivo(d).filter((r) => !altrove.has(r) && tags.some((t) => t.id === r)));
  const tagsRestanti = tags.filter((t) => !via.has(t.id));
  // Un tipo resta se lo usa ancora una variabile o un membro di un tipo che
  // resta. A cascata (tipi annidati, 04-10-2026): tolto il tipo della
  // variabile, i sotto-tipi dei suoi gruppi possono restare senza nessuno.
  const candidati = new Set<string>();
  const visita = (id: string) => {
    if (candidati.has(id)) return;
    candidati.add(id);
    for (const m of types.find((x) => x.id === id)?.members ?? []) if (m.type_ref) visita(m.type_ref);
  };
  for (const t of tags) if (via.has(t.id) && t.type_ref) visita(t.type_ref);
  const tipiVia = new Set<string>(candidati);
  for (let cambiato = true; cambiato; ) {
    cambiato = false;
    const usati = new Set<string>();
    for (const t of tagsRestanti) if (t.type_ref) usati.add(t.type_ref);
    for (const ty of types) if (!tipiVia.has(ty.id)) for (const m of ty.members) if (m.type_ref) usati.add(m.type_ref);
    for (const id of [...tipiVia]) if (usati.has(id)) { tipiVia.delete(id); cambiato = true; }
  }
  return {
    variabili: [...via],
    tipi: [...tipiVia],
    tags: tagsRestanti,
    types: types.filter((ty) => !tipiVia.has(ty.id)),
  };
}

/** Le variabili esistenti che un dispositivo nuovo del modello `tipoBase`
 *  (es. `pixsys_mcm260x_5ad`) può riprendere: istanze di quel tipo (o di una
 *  sua versione affiancata, `_v2`…) che nessun dispositivo mappa. */
export function variabiliRiassociabili(project: Pick<ProjectInfo, "tags" | "types" | "sources">, tipoBase: string): { tag: TagDef; tipo: TypeDef }[] {
  const mappate = radiciMappateAltrove(project.sources ?? [], "", -1);
  const out: { tag: TagDef; tipo: TypeDef }[] = [];
  for (const t of project.tags ?? []) {
    if (!t.type_ref || mappate.has(t.id)) continue;
    // Il tipo del modello con tutti i gruppi, o con una scelta (`_ingressi`),
    // o affiancato (`_v2`): tutti cominciano col nome del modello e un `_`.
    if (t.type_ref !== tipoBase && !t.type_ref.startsWith(`${tipoBase}_`)) continue;
    const tipo = (project.types ?? []).find((x) => x.id === t.type_ref);
    if (tipo) out.push({ tag: t, tipo });
  }
  return out;
}
