// The file of a symbol, `.swsym` (plan
// docs/archive/2026-11-20-importa-svg-e-file-del-simbolo.md): the description as
// JSON, to take a symbol from one project to another. With photos (plan
// docs/plans/2026-11-21-simboli-fase-3-foto.md) it is a zip: `symbol.json`, the
// same JSON, and `images/<name>` for each photo. The reader tells one from the
// other by the first bytes, so the JSON files written before stay readable.

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { DescrizioneSimbolo } from "@/types";
import { symbolPhotos } from "@/images/usage";
import { normalizeOps, slugFrom, type Op } from "./model";

export const SYMBOL_FILE_FORMAT = "sws-symbol";
export const SYMBOL_FILE_VERSION = 1;
export const MAX_SYMBOL_FILE_BYTES = 1_000_000;
/** A symbol file with its photos: eight photos of the size the IDE uploads. */
export const MAX_SYMBOL_ZIP_BYTES = 12_000_000;
/** One photo inside it, as the upload route takes them (`MAX_IMAGE_BYTES`). */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

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
  // A file may write attributes as objects, as the compiler allows (or as the
  // rc.29 exported a shape given back by «Togli ritaglio»).
  return { ok: true, d: normalizeOps(d) };
}

/** A zip, by its first bytes. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** The file of a symbol with its photos: a zip, the photos stored as they are
 *  (already compressed). */
export function symbolZip(d: DescrizioneSimbolo, photos: Record<string, Uint8Array>): Uint8Array {
  const files: Zippable = { "symbol.json": strToU8(symbolFileText(d)) };
  for (const [name, bytes] of Object.entries(photos)) files[`images/${name}`] = [bytes, { level: 0 }];
  return zipSync(files);
}

/** A zipped symbol file: the symbol as [`readSymbolFile`] reads it, and the
 *  photos it names that the file carries, by name. */
export function readSymbolZip(bytes: Uint8Array, taken: readonly string[]):
  { ok: true; d: DescrizioneSimbolo; photos: Record<string, Uint8Array> } | { ok: false; error: SymbolFileError } {
  if (bytes.length > MAX_SYMBOL_ZIP_BYTES) return { ok: false, error: "tooBig" };
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => (f.name === "symbol.json" && f.originalSize <= MAX_SYMBOL_FILE_BYTES)
        || (f.name.startsWith("images/") && f.originalSize <= MAX_PHOTO_BYTES),
    });
  } catch {
    return { ok: false, error: "notSymbol" };
  }
  const json = files["symbol.json"];
  if (!json) return { ok: false, error: "notSymbol" };
  const r = readSymbolFile(strFromU8(json), taken);
  if (!r.ok) return r;
  const photos: Record<string, Uint8Array> = {};
  for (const name of symbolPhotos(r.d)) {
    const b = files[`images/${name}`];
    if (b) photos[name] = b;
  }
  return { ok: true, d: r.d, photos };
}
