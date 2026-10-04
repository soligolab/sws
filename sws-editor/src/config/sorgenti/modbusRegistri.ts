/** Quanti registri legge una mappatura Modbus (Fase 3 del piano tag, 04-10-2026).
 *
 *  Gemello di `sws-plugin-modbus/src/codec.rs` (`tipo_effettivo`, `layout`):
 *  dal tipo dichiarato del tag, o dalle foglie di un'istanza lette come blocco.
 *  Un nome di tipo storico (`float`, `int`, `bool`, `string`, nessuno) legge un
 *  registro `u16` come prima della Fase 3. */
import type { ProjectInfo } from "@/types";
import { foglieDelProgetto, foglieDiTolleranti } from "@/tag/forma";
import { tipoDi } from "@/tag/tipiScalari";

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
): RegistriMappatura {
  const aBit = area === "coil" || area === "discrete";
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
    return { n: 1, dettaglio: "u16", storico: true };
  }
  return { n: aBit ? 1 : registriDiTipo(tipo), dettaglio: tipo ?? "?", storico: false };
}
