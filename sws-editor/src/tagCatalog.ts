import { foglieDiTolleranti } from "./tag/forma";
import type { ProjectInfo } from "@/types";

/** Da dove viene un id di variabile: dichiarato in Configurazione → Variabili,
 *  o dedotto dalle mappature di una sorgente. */
export type TagOrigin = "declared" | "source" | "leaf";

export interface TagCatalogEntry {
  id: string;
  description?: string;
  origin: TagOrigin;
  /** Nome della sorgente che lo produce (solo per `origin === "source"`). */
  source?: string;
  /** Fase 2: la **radice** di cui questa voce è una foglia (`motore1` per
   *  `motore1.velocita`). Assente per i tag piatti e per le radici stesse. */
  radice?: string;
  /** Il tipo scritto della foglia (`u16`, `string(16)`) o del tag. */
  tipo?: string;
  /** Quanto è profonda nell'albero: 0 = radice o tag piatto. */
  livello?: number;
}

/** Di quale variabile dichiarata è figlio questo percorso.
 *
 *  Non si spezza sul primo punto: un id piatto può contenerne — in un
 *  progetto vero c'è `host.Temeprature1`, che è un tag intero e non
 *  un'istanza — e spezzando si otteneva un «host» che nessuna riga ha
 *  (difetto trovato dal maintainer il 25-09-2026, cliccando l'albero delle
 *  variabili). Si guardano invece gli id che esistono davvero, e si prende il
 *  più lungo che sia prefisso del percorso: con `motore1` e `motore1.pid`
 *  entrambi dichiarati, `motore1.pid.kp` appartiene al secondo.
 *
 *  Ritorna `null` se nessun id dichiarato lo contiene. */
export function radiceDi(percorso: string, ids: readonly string[]): string | null {
  if (ids.includes(percorso)) return percorso;
  const contenitori = ids.filter((id) => percorso.startsWith(id + ".") || percorso.startsWith(id + "["));
  return contenitori.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** Quanti livelli sotto la radice sta un percorso: `motore1.pid.kp` → 2. */
function profonditaDi(percorso: string, radice: string): number {
  const resto = percorso.slice(radice.length);
  return (resto.match(/[.[]/g) ?? []).length;
}

/** Ordina gli id tenendo insieme una radice e le sue foglie, e mettendo gli
 *  indici in ordine **numerico**: `valvole[2]` prima di `valvole[10]`, che
 *  l'ordine alfabetico sbaglierebbe. */
export function confrontaPercorsi(a: string, b: string): number {
  const pezzi = (s: string) => s.split(/(\d+)/);
  const pa = pezzi(a);
  const pb = pezzi(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (x === y) continue;
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny) && x !== "" && y !== "") return nx - ny;
    return x.localeCompare(y);
  }
  return 0;
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
    entries.set(t.id, {
      id: t.id,
      description: t.description,
      origin: "declared",
      tipo: t.type_ref ?? t.data_type,
      livello: 0,
    });
    // Fase 2: un'istanza porta con sé le sue **foglie**, che sono i veri
    // riferimenti scrivibili. Senza, il selettore offrirebbe `motore1` — che
    // non è un valore — e non `motore1.velocita`, che è quello che serve.
    for (const f of foglieDiTolleranti(t, project?.types ?? [])) {
      entries.set(f.percorso, {
        id: f.percorso,
        description: f.membro?.description || f.membro?.unit,
        origin: "leaf",
        radice: t.id,
        tipo: f.tipo,
        livello: profonditaDi(f.percorso, t.id),
      });
    }
  }
  for (const [id, source] of sourceTagIds(project)) {
    if (!entries.has(id)) entries.set(id, { id, origin: "source", source });
  }
  return [...entries.values()].sort((a, b) => confrontaPercorsi(a.id, b.id));
}
