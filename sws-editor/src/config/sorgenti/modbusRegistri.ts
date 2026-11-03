/** Quanti registri legge una mappatura Modbus (Fase 3 del piano tag, 04-10-2026).
 *
 *  Gemello di `sws-plugin-modbus/src/codec.rs` (`tipo_effettivo`, `layout`):
 *  dal tipo dichiarato del tag, o dalle foglie di un'istanza lette come blocco.
 *  Un nome di tipo storico (`float`, `int`, `bool`, `string`, nessuno) legge un
 *  registro `u16` come prima della Fase 3. */
import type { ProjectInfo, TagDataType } from "@/types";
import { foglieDelProgetto, foglieDiTolleranti } from "@/tag/forma";
import { normalizzaTipo, tipoDi } from "@/tag/tipiScalari";

export type AreaModbus = "holding" | "input" | "coil" | "discrete";

const STORICI = ["float", "int", "bool", "string", ""];

/** Registri a 16 bit di un tipo: come `TipoScalare::registri()` in Rust. */
export function registriDiTipo(nome: string | undefined): number {
  const n = (nome ?? "").trim().toLowerCase();
  const s = /^string\((\d+)\)$/.exec(n);
  if (s) return Math.max(1, Math.ceil(Number(s[1]) / 2));
  const bit = tipoDi(n)?.bit;
  return bit ? Math.max(1, Math.ceil(bit / 16)) : 1;
}

export interface RegistriMappatura {
  /** Registri (o bit, per coil e discrete input) letti. */
  n: number;
  /** Il tipo o le parti, per la colonna. */
  dettaglio: string;
  /** Nome di tipo storico: un `u16` × scala, come prima. */
  storico: boolean;
}

export function registriMappatura(
  tagId: string,
  area: AreaModbus | undefined,
  project: Pick<ProjectInfo, "tags" | "types"> | null | undefined,
  filo?: { formato?: string; bit?: number },
): RegistriMappatura {
  const aBit = area === "coil" || area === "discrete";
  // Catalogo (04-10-2026): un bit di un registro, o un formato sul filo, dicono
  // da soli cosa si legge, qualunque sia il tipo del tag.
  if (filo?.bit !== undefined) return { n: 1, dettaglio: `bit ${filo.bit}`, storico: false };
  if (filo?.formato) return { n: registriDiTipo(filo.formato), dettaglio: filo.formato, storico: false };
  const tags = project?.tags ?? [];
  const types = project?.types ?? [];
  const id = tagId.trim();
  const radice = tags.find((t) => t.id === id);
  if (radice && (radice.type_ref || radice.array)) {
    const foglie = foglieDiTolleranti(radice, types);
    const n = aBit ? foglie.length : foglie.reduce((a, f) => a + registriDiTipo(f.tipo), 0);
    return { n, dettaglio: `${radice.type_ref ?? radice.data_type} · ${foglie.length}`, storico: false };
  }
  const foglia = radice ? undefined : foglieDelProgetto(tags, types).find((f) => f.percorso === id);
  const tipo = foglia?.tipo ?? radice?.data_type;
  if (!foglia && STORICI.includes((tipo ?? "").trim().toLowerCase())) {
    // Su coil e discrete input si legge comunque un bit, e il valore è un
    // booleano: «u16 (come prima)» lì non era vero (tutorial T04, 03-11-2026).
    if (aBit) return { n: 1, dettaglio: "bool", storico: false };
    return { n: 1, dettaglio: "u16", storico: true };
  }
  return { n: aBit ? 1 : registriDiTipo(tipo), dettaglio: tipo ?? "?", storico: false };
}

/** Il tipo da proporre al «＋» di una riga (Appunti, 30-10-2026): prima era
 *  sempre `f64`, che su un holding legge 4 registri e dà un valore sbagliato.
 *  Un bit, una coil o un discrete input → `bool`; un formato sul filo → quel
 *  tipo, o `f64` se la scala lo rende decimale; altrimenti un registro `i16`. */
export function tipoSuggeritoModbus(
  area: AreaModbus | undefined,
  filo?: { formato?: string; bit?: number; scale?: number },
): TagDataType {
  if (filo?.bit !== undefined || area === "coil" || area === "discrete") return "bool";
  if (filo?.formato) {
    const scala = filo.scale ?? 1;
    if (scala !== 1) return "f64";
    return (normalizzaTipo(filo.formato) as TagDataType | undefined) ?? "i16";
  }
  return "i16";
}
