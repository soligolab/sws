import type { ProjectInfo } from "@/types";

/** Da dove viene un id di variabile: dichiarato in Configurazione → Variabili,
 *  o dedotto dalle mappature di una sorgente. */
export type TagOrigin = "declared" | "source";

export interface TagCatalogEntry {
  id: string;
  description?: string;
  origin: TagOrigin;
  /** Nome della sorgente che lo produce (solo per `origin === "source"`). */
  source?: string;
}

/**
 * Id di variabile che compaiono nelle mappature delle sorgenti.
 *
 * Serve perché in molti progetti le variabili non vengono dichiarate a mano:
 * nascono dal protocollo (topic MQTT, registri Modbus, nodi OPC-UA…). Un
 * selettore che guardasse solo `project.tags` risulterebbe vuoto proprio nei
 * progetti più realistici.
 *
 * I campi cambiano nome per protocollo, quindi si guardano tutti quelli noti;
 * `as any` è deliberato — i tipi delle sorgenti sono union discriminate e qui
 * interessa solo pescare `tag` dove c'è.
 */
export function sourceTagIds(project: ProjectInfo | null | undefined): Map<string, string> {
  const out = new Map<string, string>();   // id → nome sorgente
  if (!project) return out;
  for (const src of project.sources ?? []) {
    const s = src as any;
    const name: string = s.name ?? s.id ?? "sorgente";
    const push = (t: unknown) => {
      if (typeof t === "string" && t !== "" && !out.has(t)) out.set(t, name);
    };
    for (const e of s.entities  ?? []) push(e?.tag);   // HomeAssistant
    for (const r of s.registers ?? []) push(r?.tag);   // Modbus TCP/RTU
    for (const t of s.tags      ?? []) push(t?.tag);   // S7, EtherNet/IP
    for (const n of s.nodes     ?? []) push(n?.tag);   // OPC-UA
    for (const t of s.topics    ?? []) push(t?.tag);   // MQTT
    for (const m of s.metrics   ?? []) push(m?.tag);   // Sparkplug B
  }
  return out;
}

/**
 * Catalogo completo delle variabili selezionabili: quelle dichiarate più
 * quelle dedotte dalle sorgenti, deduplicate (vince la dichiarazione) e
 * ordinate per id.
 */
export function tagCatalog(project: ProjectInfo | null | undefined): TagCatalogEntry[] {
  const entries = new Map<string, TagCatalogEntry>();
  for (const t of project?.tags ?? []) {
    entries.set(t.id, { id: t.id, description: t.description, origin: "declared" });
  }
  for (const [id, source] of sourceTagIds(project)) {
    if (!entries.has(id)) entries.set(id, { id, origin: "source", source });
  }
  return [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
}
