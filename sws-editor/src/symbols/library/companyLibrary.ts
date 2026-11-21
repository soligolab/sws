// The company's symbol library in the IDE (plan
// docs/plans/2026-11-21-simboli-fase-7-libreria-aziendale.md).
//
// The library is the company's: the gateway serves it in the cloud, the IDE
// itself locally (`symbol_library.rs`). A symbol taken from it is **copied**
// into the project — photos included, under names of their own — and keeps
// `library: {slug, version}`, so the IDE can say when the library has a newer
// one. «Salva in libreria» goes the other way.

import { useSyncExternalStore } from "react";
import i18n from "i18next";
import { api, type LibraryEntry } from "@/api/client";
import { progettoDalPercorso } from "@/api/prefisso";
import { conferma } from "@/finestraAvviso/finestraAvviso";
import { renameSymbolPhoto, symbolPhotos } from "@/images/usage";
import { useAppStore } from "@/store";
import type { DescrizioneSimbolo } from "@/types";
import { slugFrom } from "@/symbols/editor/model";
import { contentName } from "@/symbols/editor/photoUpload";
import { writeSymbols } from "@/symbols/editor/open";

/** The company of the project open: its folder in the cloud, `-` (the
 *  implicit one, the installation's) everywhere else. */
export function currentCompany(): string {
  return progettoDalPercorso()?.azienda ?? "-";
}

// ── the list, shared by whoever shows it ───────────────────────────────────

/** `null` = not loaded, or no library on this instance (a panel, an IDE
 *  without accounts): nothing is shown then. */
let entries: LibraryEntry[] | null = null;
/** Asked once: an instance without a library answers 404, and asking at
 *  every render would never stop. */
let asked = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function reloadLibrary(): Promise<void> {
  asked = true;
  try {
    entries = await api.libraryList(currentCompany());
  } catch {
    entries = null;
  } finally {
    notify();
  }
}

/** The entries of the library, loaded the first time they are asked for. */
export function useCompanyLibrary(): LibraryEntry[] | null {
  const v = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => entries,
  );
  if (v === null && !asked) void reloadLibrary();
  return v;
}

/** For the tests. */
export function setLibraryForTests(e: LibraryEntry[] | null): void {
  entries = e;
  asked = true;
  notify();
}

// ── pure parts ─────────────────────────────────────────────────────────────

/** The project symbols that are copies of an entry with another version now. */
export function outdated(symbols: readonly DescrizioneSimbolo[], lib: readonly LibraryEntry[]): { symbol: DescrizioneSimbolo; entry: LibraryEntry }[] {
  const out: { symbol: DescrizioneSimbolo; entry: LibraryEntry }[] = [];
  for (const d of symbols) {
    const e = d.library && lib.find((x) => x.slug === d.library!.slug);
    if (e && e.version !== d.library!.version) out.push({ symbol: d, entry: e });
  }
  return out;
}

/** Where a copy of `entry` goes in the project: over the earlier copy of the
 *  same entry (same slug, so the objects stay bound), otherwise a slug of its
 *  own. And the variant of the same SWS symbol it would replace, if any. */
export function placeCopy(entry: LibraryEntry, symbols: readonly DescrizioneSimbolo[]): {
  slug: string; replaces?: DescrizioneSimbolo; otherVariant?: DescrizioneSimbolo;
} {
  const earlier = symbols.find((d) => d.library?.slug === entry.slug);
  const otherVariant = entry.symbol.overrides
    ? symbols.find((d) => d !== earlier && d.overrides === entry.symbol.overrides)
    : undefined;
  if (earlier) return { slug: earlier.slug, replaces: earlier, otherVariant };
  const taken = symbols.map((d) => d.slug);
  const slug = taken.includes(entry.slug) ? slugFrom(entry.slug, taken) : entry.slug;
  return { slug, otherVariant };
}

// ── into the project ───────────────────────────────────────────────────────

function projectSymbols(): DescrizioneSimbolo[] {
  return useAppStore.getState().project?.simboli ?? [];
}

/** Copies `entry` into the project (or updates the copy already there), its
 *  photos into the project's images. The `prj:` id, or `null` if the person
 *  said no or something failed (said already). */
export async function copyFromLibrary(entry: LibraryEntry): Promise<string | null> {
  const t = i18n.t.bind(i18n);
  const symbols = projectSymbols();
  const where = placeCopy(entry, symbols);
  if (where.otherVariant) {
    const ok = await conferma({
      testo: t("symbolLibrary.replaceVariant", { mine: where.otherVariant.it, theirs: entry.symbol.it }),
    });
    if (!ok) return null;
  }
  let d: DescrizioneSimbolo = { ...entry.symbol, slug: where.slug, library: { slug: entry.slug, version: entry.version } };
  for (const name of symbolPhotos(entry.symbol)) {
    const bytes = await api.libraryImageBytes(currentCompany(), entry.slug, name);
    const ext = name.split(".").pop()!.toLowerCase().replace("jpeg", "jpg");
    const own = contentName(bytes, ext, "lib");
    await api.uploadProjectImage(own, new Blob([bytes as BlobPart]), { replace: true });
    d = renameSymbolPhoto(d, name, own);
  }
  const rest = symbols.filter((s) => s !== where.replaces && s !== where.otherVariant);
  const err = await writeSymbols([...rest, d]);
  if (err) {
    const { avviso } = await import("@/finestraAvviso/finestraAvviso");
    await avviso({ livello: "errore", testo: err });
    return null;
  }
  return `prj:${d.slug}`;
}

/** Every copy that the library has a newer version of, updated. */
export async function updateFromLibrary(list: { entry: LibraryEntry }[]): Promise<number> {
  let n = 0;
  for (const { entry } of list) if (await copyFromLibrary(entry)) n++;
  return n;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** «Salva in libreria»: `d` (with its photos) becomes the entry it came from,
 *  or a new one with its slug. Asks before replacing an entry it didn't come
 *  from. The symbol with its new `library` record, or `null`. */
export async function saveToLibrary(d: DescrizioneSimbolo): Promise<DescrizioneSimbolo | null> {
  const t = i18n.t.bind(i18n);
  const company = currentCompany();
  const slug = d.library?.slug ?? d.slug;
  const lib = entries ?? (await api.libraryList(company).catch(() => []));
  const there = lib.find((e) => e.slug === slug);
  if (there && d.library?.slug !== slug) {
    const ok = await conferma({ testo: t("symbolLibrary.overwrite", { name: there.symbol.it }), pericolo: true });
    if (!ok) return null;
  }
  const images: Record<string, string> = {};
  for (const name of symbolPhotos(d)) images[name] = base64(await api.projectImageBytes(name));
  const { library: _mine, ...plain } = d;
  void _mine;
  const e = await api.libraryPut(company, slug, plain as DescrizioneSimbolo, images);
  await reloadLibrary();
  return { ...d, library: { slug: e.slug, version: e.version } };
}

export async function deleteFromLibrary(entry: LibraryEntry): Promise<void> {
  const ok = await conferma({
    testo: i18n.t("symbolLibrary.deleteConfirm", { name: entry.symbol.it }), pericolo: true,
  });
  if (!ok) return;
  await api.libraryDelete(currentCompany(), entry.slug);
  await reloadLibrary();
}
