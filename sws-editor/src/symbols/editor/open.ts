// Opening, saving and counting for the symbol editor (plan
// docs/plans/2026-11-18-editor-dei-simboli.md, phase 1).
//
// Three ways in: a project symbol (`prj:`) is edited as it is; a library
// symbol (`lib:`, or a builtin alias like `pump`) is edited as a **variant**
// that replaces it in the whole project — or the variant the project already
// has; a new symbol starts from an empty drawing.

import i18n from "i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { DescrizioneSimbolo, SynopticObject } from "@/types";
import { trovaSimboloOriginale } from "@/symbols/lib/libreria";
import { avviso } from "@/finestraAvviso/finestraAvviso";
import { emptySymbol, needsExplicitPorts } from "./model";
import { importSvg, placeImport, roomFor, MAX_SVG_BYTES, SVG_WARNINGS, type SvgWarning } from "./importSvg";
import { isZip, readSymbolFile, readSymbolZip, MAX_SYMBOL_FILE_BYTES, MAX_SYMBOL_ZIP_BYTES } from "./symbolFile";
import { contentName } from "./photoUpload";
import { renameSymbolPhoto } from "@/images/usage";
import { uploadEmbeddedPhotos } from "./photoUpload";

export interface SymbolEditorTarget {
  draft: DescrizioneSimbolo;
  /** The draft is not in the project yet (a new symbol, a first variant). */
  isNew: boolean;
  /** The object the editor was opened from: «save as» moves it to the copy. */
  fromObjectId?: string;
}

function projectSymbols(): DescrizioneSimbolo[] {
  return useAppStore.getState().project?.simboli ?? [];
}

/** The slugs already used by the project. */
export function takenSlugs(except?: string): string[] {
  return projectSymbols().map((s) => s.slug).filter((s) => s !== except);
}

/** The description with its ports explicit (phase 2): the ports the compiler
 *  infers from flanges become `bocca` operations with the same id, so the pipes
 *  attached stay attached and each port can be moved on its own. Unchanged if
 *  there is nothing to make explicit, or if the runtime can't be asked. */
export async function withExplicitPorts(d: DescrizioneSimbolo): Promise<DescrizioneSimbolo> {
  if (!needsExplicitPorts(d)) return d;
  try {
    return await api.symbolExplicitPorts(d);
  } catch {
    return d;
  }
}

/** Opens the editor on the symbol `symbolId` draws. Returns why not, if it
 *  cannot be edited (an imported SVG, a builtin without a library drawing). */
export async function openSymbolEditorFor(symbolId: string, fromObjectId?: string): Promise<string | null> {
  const open = useAppStore.getState().openSymbolEditor;
  if (symbolId.startsWith("prj:")) {
    const d = projectSymbols().find((s) => `prj:${s.slug}` === symbolId);
    if (!d) return i18n.t("symbolEditor.notFound");
    open({ draft: await withExplicitPorts(structuredClone(d)), isNew: false, fromObjectId });
    return null;
  }
  const lib = trovaSimboloOriginale(symbolId);
  if (!lib) return i18n.t("symbolEditor.notEditable");
  const variant = projectSymbols().find((s) => s.overrides === lib.id);
  if (variant) {
    open({ draft: await withExplicitPorts(structuredClone(variant)), isNew: false, fromObjectId });
    return null;
  }
  const [family, slug] = lib.id.slice(4).split("/");
  const d = await withExplicitPorts(await api.librarySymbolDescription(family, slug));
  // The library slug may already be a project symbol of the customer's.
  const taken = takenSlugs();
  let s = d.slug;
  for (let n = 2; taken.includes(s); n++) s = `${d.slug}-${n}`;
  // A variant carries the translated label of the original.
  const label = i18n.t(lib.label);
  open({
    draft: { ...d, slug: s, it: i18n.getFixedT("it")(lib.label) || label, en: i18n.getFixedT("en")(lib.label) || label },
    isNew: true,
    fromObjectId,
  });
  return null;
}

/** Opens the editor on a new, empty symbol. */
export function openNewSymbol(): void {
  const t = i18n.t.bind(i18n);
  useAppStore.getState().openSymbolEditor({
    draft: emptySymbol({ it: t("symbolEditor.newName", { lng: "it" }), en: t("symbolEditor.newName", { lng: "en" }) }, takenSlugs()),
    isNew: true,
  });
}

/** What an SVG import approximated or left out, one line each. */
export function svgWarningLines(w: Partial<Record<SvgWarning, number>>): string {
  return SVG_WARNINGS.filter((k) => w[k]).map((k) => `• ${i18n.t(`symbolEditor.svg.warn.${k}`, { n: w[k] })}`).join("\n");
}

/** «Import a symbol…» (plan docs/archive/2026-11-20-importa-svg-e-file-del-simbolo.md):
 *  a `.swsym` opens the editor on the symbol it carries, an `.svg` on a new
 *  symbol named after the file with the drawing in it. Both are new symbols of
 *  the project until «Save». */
export async function openSymbolFile(file: File): Promise<void> {
  const t = i18n.t.bind(i18n);
  const svg = /\.svg$/i.test(file.name) || file.type === "image/svg+xml";
  const failed = (testo: string) => avviso({ livello: "errore", titolo: t("symbolEditor.file.failed", { name: file.name }), testo });
  const open = useAppStore.getState().openSymbolEditor;
  // A symbol with its photos (plan 2026-11-21-simboli-fase-3-foto): the photos
  // go to the project's images under names of their own, so they never
  // replace a different image with the same name.
  if (!svg && file.size <= MAX_SYMBOL_ZIP_BYTES && (await file.slice(0, 4).text()) === "PK\u0003\u0004") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isZip(bytes)) {
      const r = readSymbolZip(bytes, takenSlugs());
      if (!r.ok) { await failed(t(`symbolEditor.file.err.${r.error}`)); return; }
      let d = r.d;
      try {
        for (const [name, b] of Object.entries(r.photos)) {
          const ext = name.split(".").pop()!.toLowerCase().replace("jpeg", "jpg");
          const own = contentName(b, ext, "sym");
          await api.uploadProjectImage(own, new Blob([b as BlobPart]), { replace: true });
          d = renameSymbolPhoto(d, name, own);
        }
      } catch (e) {
        await failed(e instanceof Error ? e.message : String(e));
        return;
      }
      open({ draft: d, isNew: true });
      return;
    }
  }
  if (file.size > (svg ? MAX_SVG_BYTES : MAX_SYMBOL_FILE_BYTES)) {
    await failed(t(svg ? "symbolEditor.svg.err.tooBig" : "symbolEditor.file.err.tooBig"));
    return;
  }
  const text = await file.text();
  if (!svg) {
    const r = readSymbolFile(text, takenSlugs());
    if (!r.ok) { await failed(t(`symbolEditor.file.err.${r.error}`)); return; }
    open({ draft: r.d, isNew: true });
    return;
  }
  const name = file.name.replace(/\.svg$/i, "").replace(/[<>"&]/g, "").trim().slice(0, 60) || t("symbolEditor.newName");
  const blank = emptySymbol({ it: name, en: name }, takenSlugs());
  const r = importSvg(text, { w: blank.w, h: blank.h, adapt: true, room: roomFor(blank) });
  if (!r.ok) { await failed(t(`symbolEditor.svg.err.${r.error}`)); return; }
  const up = await uploadEmbeddedPhotos(r.ops, "svg");
  if (up.lost) r.warnings.image = (r.warnings.image ?? 0) + up.lost;
  r.ops = up.ops;
  open({ draft: placeImport(blank, r).d, isNew: true });
  const notes = svgWarningLines(r.warnings);
  if (notes) await avviso({ titolo: t("symbolEditor.svg.done", { n: r.ops.length }), testo: notes });
}

/** Writes the project symbols, in memory and on the runtime. The errors of the
 *  compiler come back as the message. */
export async function writeSymbols(simboli: DescrizioneSimbolo[]): Promise<string | null> {
  const before = useAppStore.getState().project?.simboli;
  useAppStore.getState().updateProjectSimboli(simboli);
  try {
    await api.updateSimboli(simboli);
    return null;
  } catch (e) {
    useAppStore.getState().updateProjectSimboli(before ?? []);
    return e instanceof Error ? e.message : String(e);
  }
}

/** The project symbols with `d` in place of the one with the same slug (or
 *  added). */
export function withSymbol(d: DescrizioneSimbolo, replacingSlug = d.slug): DescrizioneSimbolo[] {
  const all = projectSymbols();
  const i = all.findIndex((s) => s.slug === replacingSlug);
  return i >= 0 ? all.map((s, k) => (k === i ? d : s)) : [...all, d];
}

export function withoutSymbol(slug: string): DescrizioneSimbolo[] {
  return projectSymbols().filter((s) => s.slug !== slug);
}

/** The ids an object may write to draw `d`: `prj:<slug>`, and for a variant
 *  the library id and its builtin alias. */
export function idsDrawing(d: DescrizioneSimbolo): string[] {
  const ids = [`prj:${d.slug}`];
  if (d.overrides) {
    ids.push(d.overrides);
    const lib = trovaSimboloOriginale(d.overrides);
    if (lib?.replaces) ids.push(lib.replaces);
  }
  return ids;
}

/** How many objects draw `d`, on how many pages. */
export function usage(d: DescrizioneSimbolo): { objects: number; pages: number; onPage: SynopticObject[] } {
  const ids = new Set(idsDrawing(d));
  const st = useAppStore.getState();
  let objects = 0, pages = 0;
  for (const p of st.pages) {
    const n = p.objects.filter((o) => o.type === "symbol" && o.symbol_id && ids.has(o.symbol_id)).length;
    objects += n;
    if (n) pages += 1;
  }
  const current = st.pages.find((p) => p.id === st.currentPageId);
  const onPage = current?.objects.filter((o) => o.type === "symbol" && o.symbol_id && ids.has(o.symbol_id)) ?? [];
  return { objects, pages, onPage };
}

/** The pipes attached to the ports of `d`, on every page: for each port id, how
 *  many, and those on the current page (the ones a rename can follow). */
export function pipesOnPorts(d: DescrizioneSimbolo): Map<string, { total: number; here: { pipeId: string; end: "from_port" | "to_port" }[] }> {
  const ids = new Set(idsDrawing(d));
  const st = useAppStore.getState();
  const out = new Map<string, { total: number; here: { pipeId: string; end: "from_port" | "to_port" }[] }>();
  for (const p of st.pages) {
    const symbols = new Set(p.objects.filter((o) => o.type === "symbol" && o.symbol_id && ids.has(o.symbol_id)).map((o) => o.id));
    if (!symbols.size) continue;
    for (const o of p.objects) {
      if (o.type !== "pipe") continue;
      for (const [objKey, end] of [["from_obj_id", "from_port"], ["to_obj_id", "to_port"]] as const) {
        const port = o[end];
        if (!port || !o[objKey] || !symbols.has(o[objKey] as string)) continue;
        const e = out.get(port) ?? { total: 0, here: [] };
        e.total += 1;
        if (p.id === st.currentPageId) e.here.push({ pipeId: o.id, end });
        out.set(port, e);
      }
    }
  }
  return out;
}

/** The objects that bind the parts of `d` (`symbol_parts`), on every page: for
 *  each part id, how many, and those on the current page (the ones a rename can
 *  follow). Plan docs/archive/2026-11-19-animazioni-dei-simboli.md, session 2d. */
export function bindingsOnParts(d: DescrizioneSimbolo): Map<string, { total: number; here: string[] }> {
  const ids = new Set(idsDrawing(d));
  const st = useAppStore.getState();
  const out = new Map<string, { total: number; here: string[] }>();
  for (const p of st.pages) {
    for (const o of p.objects) {
      if (o.type !== "symbol" || !o.symbol_id || !ids.has(o.symbol_id)) continue;
      for (const [part, l] of Object.entries(o.symbol_parts ?? {})) {
        if (!l || (!l.tag && l.value === undefined)) continue;
        const e = out.get(part) ?? { total: 0, here: [] };
        e.total += 1;
        if (p.id === st.currentPageId) e.here.push(o.id);
        out.set(part, e);
      }
    }
  }
  return out;
}
