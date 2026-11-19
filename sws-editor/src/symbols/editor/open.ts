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
import { emptySymbol, needsExplicitPorts } from "./model";

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
