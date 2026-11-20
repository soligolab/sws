// The file of a symbol, `.swsym` (plan
// docs/archive/2026-11-20-importa-svg-e-file-del-simbolo.md): the description as
// JSON, to take a symbol from one project to another. The photos of phase 3
// will make it a zip; the reader tells one from the other by the first bytes,
// so the JSON files written today stay readable.

import type { DescrizioneSimbolo } from "@/types";
import { slugFrom, type Op } from "./model";

export const SYMBOL_FILE_FORMAT = "sws-symbol";
export const SYMBOL_FILE_VERSION = 1;
export const MAX_SYMBOL_FILE_BYTES = 1_000_000;

export type SymbolFileError = "notSymbol" | "newer" | "tooBig";

export function symbolFileName(d: DescrizioneSimbolo): string {
  return `${d.slug}.swsym`;
}

export function symbolFileText(d: DescrizioneSimbolo): string {
  return `${JSON.stringify({ format: SYMBOL_FILE_FORMAT, version: SYMBOL_FILE_VERSION, symbol: d }, null, 2)}\n`;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const label = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) : "");

/** A symbol file read as a new symbol of this project: a slug of its own
 *  (`taken` are the project's), and never a variant — the library symbol it
 *  replaced in the project it came from is not this project's business. */
export function readSymbolFile(text: string, taken: readonly string[]):
  { ok: true; d: DescrizioneSimbolo } | { ok: false; error: SymbolFileError } {
  if (text.length > MAX_SYMBOL_FILE_BYTES) return { ok: false, error: "tooBig" };
  // A zip (with pictures) is a file of a newer IDE.
  if (text.startsWith("PK")) return { ok: false, error: "newer" };
  let file: unknown;
  try { file = JSON.parse(text); } catch { return { ok: false, error: "notSymbol" }; }
  if (!file || typeof file !== "object") return { ok: false, error: "notSymbol" };
  const f = file as { format?: unknown; version?: unknown; symbol?: unknown };
  if (f.format !== SYMBOL_FILE_FORMAT) return { ok: false, error: "notSymbol" };
  if (typeof f.version !== "number" || f.version > SYMBOL_FILE_VERSION) return { ok: false, error: "newer" };
  const s = f.symbol as Partial<Record<keyof DescrizioneSimbolo, unknown>> | undefined;
  if (!s || typeof s !== "object" || typeof s.w !== "number" || typeof s.h !== "number" || typeof s.body !== "string"
    || !Array.isArray(s.ops) || !s.ops.every((o) => !!o && typeof o === "object" && typeof (o as Op).op === "string")) {
    return { ok: false, error: "notSymbol" };
  }
  const it = label(s.it) || label(s.en), en = label(s.en) || it;
  if (!it) return { ok: false, error: "notSymbol" };
  let slug = typeof s.slug === "string" && SLUG.test(s.slug) ? s.slug : slugFrom(en, taken);
  for (let n = 2, base = slug.slice(0, 36); taken.includes(slug); n++) slug = `${base}-${n}`;
  const d: DescrizioneSimbolo = { slug, w: s.w, h: s.h, body: s.body, it, en, ops: s.ops as Op[] };
  if (typeof s.tipo === "string") d.tipo = s.tipo;
  return { ok: true, d };
}
