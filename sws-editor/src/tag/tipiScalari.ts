// I tipi scalari delle variabili (D5 del piano tag, 22-09-2026), lato editor.
//
// **La fonte è `tests/fixtures/tipi-scalari.json`**: questa tabella la ricopia
// (Vite non serve file fuori da `src/`) e `tests/tipiScalari.test.ts` la
// confronta con la fixture; il gemello Rust è `sws_core::tipo`. Gli alias
// storici `int` e `float` restano validi nel file: qui si normalizzano solo
// per mostrarli, non si riscrivono finché l'utente non cambia il tipo.

import type { TagDataType } from "@/types";

export type CategoriaTipo = "bool" | "intero" | "reale" | "testo" | "tempo";

export interface TipoScalare {
  nome: string;
  categoria: CategoriaTipo;
  bit?: number;
  /** Gruppo della `<select>`: interi con segno, senza segno, reali, testo, tempo. */
  gruppo: "bool" | "signed" | "unsigned" | "reali" | "testo" | "tempo";
  alias?: string[];
}

export const TIPI_SCALARI: readonly TipoScalare[] = [
  { nome: "bool", categoria: "bool", bit: 1, gruppo: "bool" },
  { nome: "i8", categoria: "intero", bit: 8, gruppo: "signed" },
  { nome: "i16", categoria: "intero", bit: 16, gruppo: "signed" },
  { nome: "i32", categoria: "intero", bit: 32, gruppo: "signed" },
  { nome: "i64", categoria: "intero", bit: 64, gruppo: "signed", alias: ["int"] },
  { nome: "u8", categoria: "intero", bit: 8, gruppo: "unsigned" },
  { nome: "u16", categoria: "intero", bit: 16, gruppo: "unsigned" },
  { nome: "u32", categoria: "intero", bit: 32, gruppo: "unsigned" },
  { nome: "u64", categoria: "intero", bit: 64, gruppo: "unsigned" },
  { nome: "f32", categoria: "reale", bit: 32, gruppo: "reali" },
  { nome: "f64", categoria: "reale", bit: 64, gruppo: "reali", alias: ["float"] },
  { nome: "string", categoria: "testo", gruppo: "testo" },
  { nome: "datetime", categoria: "tempo", bit: 64, gruppo: "tempo" },
];

export const NOMI_TIPI = TIPI_SCALARI.map((t) => t.nome);

/** Il nome canonico per un nome scritto (alias, maiuscole, `string(N)`);
 *  `undefined` se non è un tipo. */
export function normalizzaTipo(nome: string | undefined): string | undefined {
  const n = (nome ?? "float").trim().toLowerCase();
  for (const t of TIPI_SCALARI) {
    if (t.nome === n || t.alias?.includes(n)) return t.nome;
  }
  if (/^string\(\d+\)$/.test(n)) return "string";
  return undefined;
}

export function tipoDi(nome: string | undefined): TipoScalare | undefined {
  const c = normalizzaTipo(nome);
  return c ? TIPI_SCALARI.find((t) => t.nome === c) : undefined;
}

export function categoriaDi(nome: string | undefined): CategoriaTipo | undefined {
  return tipoDi(nome)?.categoria;
}

/** Il nome canonico come `TagDataType`, per chi deve scriverlo in un TagDef. */
export function comeTipo(nome: string): TagDataType {
  return (normalizzaTipo(nome) ?? "f64") as TagDataType;
}
