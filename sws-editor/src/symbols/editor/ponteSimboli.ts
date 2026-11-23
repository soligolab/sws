// The bridge between the IDE and the symbol editor in a window of its own
// (plan docs/plans/2026-11-22-rc29-collaudo-utente-editor-simboli.md, block E;
// the maintainer: «deve diventare un pop-up perché è utile poter lavorare al
// progetto ed avere l'editor dei simboli aperto»).
//
// As with the detached chat (`ai/ponte.ts`): a `BroadcastChannel`, every
// message says who sends it and to whom, and only `structuredClone`-able data
// crosses. The IDE stays the owner of the project: the window gets the
// project and the pages from it, saves the symbols itself (same session, same
// lock tab, the project's version asked to the IDE just before), and tells
// the IDE what it wrote; the changes to the objects of the page (a renamed
// port, «Save as») are applied by the IDE.

import i18n from "i18next";
import { impostaVersioneProgetto, setLockTab, versioneProgetto } from "@/api/client";
import { idEditore, nuovoId } from "@/ai/ponte";
import { apriFinestra } from "@/apriFinestra";
import { percorsoFinestra, progettoDalPercorso } from "@/api/prefisso";
import { dimenticaImmagine } from "@/canvas/ImmagineSvg";
import { TAB_ID } from "@/projectLock/projectLock";
import { useAppStore } from "@/store";
import { rebaselineProjectWatcher } from "@/ws/projectWatcher";
import type { DescrizioneSimbolo, ProjectInfo, SynopticObject, SynopticPage } from "@/types";
import type { SymbolEditorTarget, writeHooks as WriteHooks } from "./open";

export const CANALE_SIMBOLI = "sws.simboli.ponte.v1";

// `ref` names the project the IDE had open when it answered `hello` (see
// `projectRef`): every message that writes carries it back, and the IDE drops
// the ones for a project it no longer has open (test of the rc.29, 23-11-2026).
export type MessaggioSimboli =
  | { type: "hello"; da: string; a: string; t: string }
  | { type: "state"; da: string; a: string; target: SymbolEditorTarget; project: ProjectInfo; pages: SynopticPage[];
      currentPageId: string | null; versione: string | null; lockTab: string; ref: string }
  | { type: "ask-version"; da: string; a: string; ref: string | null }
  | { type: "version"; da: string; a: string; versione: string | null; simboli: DescrizioneSimbolo[]; refused?: boolean }
  | { type: "saved"; da: string; a: string; ref: string | null; simboli: DescrizioneSimbolo[]; versione: string | null }
  | { type: "wrote"; da: string; a: string; ref: string | null; path: string }
  | { type: "object"; da: string; a: string; ref: string | null; pageId: string | null; id: string; patch: Partial<SynopticObject> }
  | { type: "bring-back"; da: string; a: string; target: SymbolEditorTarget };

/** The window's writes the IDE takes as its own (`wrote`): the project's
 *  images (upload, replace, delete — not `/rename`, which rewrites pages) and
 *  «Genera foto». Not the symbols (`saved` carries them), not the pages: a
 *  write the IDE hasn't taken into its state must still show the «project
 *  changed» bar. A closed list on purpose: a path left out gives one bar too
 *  many, never a warning lost. */
export function forwardedWrite(path: string): boolean {
  return /^\/api\/project\/images\/[^/?]+(\?.*)?$/.test(path) || /^\/api\/symbols\/ai\/photo$/.test(path);
}

/** Symbols compared by content, whatever the order of their keys. */
function sameSymbol(a: DescrizioneSimbolo | undefined, b: DescrizioneSimbolo | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0)))
    : x));
  return stable(a) === stable(b);
}

export type RebaseResult = { ok: true; symbols: DescrizioneSimbolo[] } | { ok: false; slugs: string[] };

/** The window's write applied on the IDE's list (test of the rc.29,
 *  23-11-2026). The window's list is the one it got when it opened: written as
 *  it was, it erased what the IDE got meanwhile — another window's save, an
 *  update from the library, symbols proposed by the AI. Only the slugs the
 *  window added, changed or removed (`base` → `next`) move; the others stay as
 *  `current` has them. A slug the window touched that `current` has changed
 *  too — or a «Save as» on a slug that appeared meanwhile — is a conflict, and
 *  nothing is written. */
export function rebaseSymbols(
  base: DescrizioneSimbolo[], next: DescrizioneSimbolo[], current: DescrizioneSimbolo[],
): RebaseResult {
  const bySlug = (l: DescrizioneSimbolo[]) => new Map(l.map((s) => [s.slug, s]));
  const b = bySlug(base), n = bySlug(next), c = bySlug(current);
  const touched = [...new Set([...b.keys(), ...n.keys()])].filter((s) => !sameSymbol(b.get(s), n.get(s)));
  // The same change on both sides is no conflict (both removed it, say).
  const conflicts = touched.filter((s) => !sameSymbol(c.get(s), b.get(s)) && !sameSymbol(c.get(s), n.get(s)));
  if (conflicts.length) return { ok: false, slugs: conflicts };
  const t = new Set(touched);
  const symbols = current
    .filter((s) => !t.has(s.slug) || n.has(s.slug))
    .map((s) => (t.has(s.slug) ? n.get(s.slug)! : s));
  for (const s of next) if (t.has(s.slug) && !c.has(s.slug)) symbols.push(s);
  return { ok: true, symbols };
}

const PREFERENZA = "sws.simboli.staccato";

/** Whether the editor opens in a window of its own: yes, until the user
 *  brings it back into the IDE (remembered). */
export function staccatoPreferito(): boolean {
  // No windows under the tests (jsdom can't open one): inside, as before.
  if (typeof BroadcastChannel === "undefined" || /jsdom/i.test(navigator.userAgent)) return false;
  try { return localStorage.getItem(PREFERENZA) !== "0"; } catch { return true; }
}
export function ricordaStaccato(si: boolean): void {
  try { localStorage.setItem(PREFERENZA, si ? "1" : "0"); } catch { /* not remembered */ }
}

/** This page is the editor's own window: it never detaches again. */
export let inFinestraSimboli = false;
export function segnaFinestraSimboli(): void { inFinestraSimboli = true; }

// ── the IDE's side ─────────────────────────────────────────────────────────

const inAttesa = new Map<string, SymbolEditorTarget>();
let canaleIde: BroadcastChannel | null = null;

// The project the IDE has open, as the bridge names it (test of the rc.29,
// 23-11-2026): a window opened on one project must never write into another —
// its PUT replaces the whole list of symbols. In the cloud the page's address
// gives the company and the project; elsewhere the name, plus `epoch`, which
// changes whenever the IDE's project goes away or changes name, so a project
// closed and another opened (even one with the same name, of another company)
// is a change. An epoch this page never issued comes from before a reload of
// the IDE: there the address and the name decide.
let epoch = nuovoId();
const pastEpochs = new Set<string>();

function projectRef(): string | null {
  const p = useAppStore.getState().project;
  if (!p) return null;
  const cloud = progettoDalPercorso();
  return `${cloud ? `${cloud.azienda}/${cloud.progetto}` : "-"}|${p.meta?.name ?? ""}#${epoch}`;
}

function sameProject(ref: string | null | undefined): boolean {
  const now = projectRef();
  if (!now || !ref) return false;
  if (ref === now) return true;
  const split = (r: string) => { const i = r.lastIndexOf("#"); return [r.slice(0, i), r.slice(i + 1)]; };
  const [where, when] = split(ref);
  return where === split(now)[0] && !pastEpochs.has(when);
}

/** Started once by the IDE (`App.tsx`). */
export function avviaPonteSimboliIde(): () => void {
  if (typeof BroadcastChannel === "undefined" || canaleIde) return () => {};
  const io = idEditore();
  const c = new BroadcastChannel(CANALE_SIMBOLI);
  canaleIde = c;
  const nameOf = (p: ProjectInfo | null | undefined) => (p ? p.meta?.name ?? "" : null);
  let name = nameOf(useAppStore.getState().project);
  const unsubscribe = useAppStore.subscribe((s) => {
    const now = nameOf(s.project);
    if (now === name) return;
    name = now;
    pastEpochs.add(epoch);
    epoch = nuovoId();
  });
  c.onmessage = (ev: MessageEvent<MessaggioSimboli>) => {
    const m = ev.data;
    if (!m || m.a !== io) return;
    const st = useAppStore.getState();
    switch (m.type) {
      case "hello": {
        const target = inAttesa.get(m.t);
        const ref = projectRef();
        if (!target || !st.project || !ref) return;
        c.postMessage({
          type: "state", da: io, a: m.da, target, project: st.project, pages: st.pages,
          currentPageId: st.currentPageId, versione: versioneProgetto(), lockTab: TAB_ID, ref,
        } satisfies MessaggioSimboli);
        return;
      }
      case "ask-version":
        // Another project open here: the window must not write at all.
        if (!sameProject(m.ref)) {
          c.postMessage({ type: "version", da: io, a: m.da, versione: null, simboli: [], refused: true } satisfies MessaggioSimboli);
          return;
        }
        // The symbols too: the window applies its change on these (`rebaseSymbols`).
        c.postMessage({
          type: "version", da: io, a: m.da, versione: versioneProgetto(), simboli: st.project?.simboli ?? [],
        } satisfies MessaggioSimboli);
        return;
      case "saved":
        if (!sameProject(m.ref)) return;
        st.updateProjectSimboli(m.simboli);
        if (m.versione) impostaVersioneProgetto(m.versione);
        // Written from another page, so this client's own signal never fired:
        // without this the «project changed» bar followed every save of the
        // window (test of the rc.29, 23-11-2026). What it wrote is in this
        // store now, so the change is ours.
        rebaselineProjectWatcher("symbol-window");
        return;
      case "wrote": {
        if (!sameProject(m.ref) || !forwardedWrite(m.path)) return;
        // An image replaced or deleted: the canvas here must not keep drawing
        // the copy it has, or the bar's silence would hide an old picture.
        const image = /^\/api\/project\/images\/([^/?]+)/.exec(m.path);
        if (image) {
          let file = image[1];
          try { file = decodeURIComponent(file); } catch { /* as it is */ }
          dimenticaImmagine(`/api/project/images/${file}`);
        }
        rebaselineProjectWatcher("symbol-window");
        return;
      }
      case "object":
        if (!sameProject(m.ref)) return;
        // Only on the page it was meant for: the IDE may have moved on.
        if (m.pageId === st.currentPageId) st.updateObject(m.id, m.patch);
        return;
      case "bring-back":
        ricordaStaccato(false);
        st.openSymbolEditor({ ...m.target, inline: true });
        return;
    }
  };
  return () => { c.close(); canaleIde = null; unsubscribe(); };
}

/** Keeps `target` for the window that will ask for it: the key it asks with. */
export function preparaFinestra(target: SymbolEditorTarget): string {
  const t = nuovoId();
  inAttesa.set(t, target);
  return t;
}

/** Opens the editor on `target` in its own window. `false` when the browser
 *  blocked it: the caller opens it inside the IDE. */
export function apriInFinestra(target: SymbolEditorTarget): boolean {
  const t = preparaFinestra(target);
  const url = percorsoFinestra(`/index-symbols.html#e=${encodeURIComponent(idEditore())}&t=${encodeURIComponent(t)}`);
  const esito = apriFinestra(url, `sws-simboli-${t.slice(0, 8)}`, { larghezza: 1400, altezza: 900 });
  if (esito.bloccata) inAttesa.delete(t);
  return !esito.bloccata;
}

// ── the window's side ──────────────────────────────────────────────────────

let canaleFinestra: BroadcastChannel | null = null;
let ide = "";
/** The project the IDE named in `state`: sent back with every write. */
let ref: string | null = null;
const mio = nuovoId();
let hooks: typeof WriteHooks | null = null;
let onOwnWrite: ((ev: Event) => void) | null = null;
let ownUpdateObject: ((id: string, patch: Partial<SynopticObject>) => void) | null = null;

function chiedi<T extends MessaggioSimboli["type"]>(
  question: MessaggioSimboli, answer: T, ms = 1500,
): Promise<Extract<MessaggioSimboli, { type: T }> | null> {
  return new Promise((resolve) => {
    const c = canaleFinestra;
    if (!c) { resolve(null); return; }
    const timer = window.setTimeout(() => { c.removeEventListener("message", on); resolve(null); }, ms);
    const on = (ev: MessageEvent<MessaggioSimboli>) => {
      if (ev.data?.a === mio && ev.data.type === answer) {
        window.clearTimeout(timer);
        c.removeEventListener("message", on);
        resolve(ev.data as Extract<MessaggioSimboli, { type: T }>);
      }
    };
    c.addEventListener("message", on);
    c.postMessage(question);
  });
}

/** The window asks the IDE for the symbol to edit and the project, and sets
 *  its own store with them. `false`: the IDE didn't answer (closed). */
export async function collegaFinestra(hash: string): Promise<boolean> {
  disconnectSymbolWindow();
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  ide = q.get("e") ?? "";
  const t = q.get("t") ?? "";
  if (!ide || !t || typeof BroadcastChannel === "undefined") return false;
  canaleFinestra = new BroadcastChannel(CANALE_SIMBOLI);
  const stato = await chiedi({ type: "hello", da: mio, a: ide, t }, "state", 4000);
  if (!stato) { disconnectSymbolWindow(); return false; }
  ref = stato.ref;
  setLockTab(stato.lockTab);
  impostaVersioneProgetto(stato.versione);
  const st = useAppStore.getState();
  st.setProject(stato.project);
  st.setPages(stato.pages, stato.currentPageId ?? undefined);
  // Before a write, the project's version and symbols as the IDE has them
  // now, and the window's change applied on those; after, what was written,
  // so the IDE's symbols and version follow.
  const { writeHooks } = await import("./open");
  hooks = writeHooks;
  writeHooks.before = async (base, next) => {
    const v = await chiedi({ type: "ask-version", da: mio, a: ide, ref }, "version");
    // No IDE (closed): the window's own list and version, as before — the
    // version still makes the runtime refuse a write over newer changes.
    if (!v) return next;
    if (v.refused) throw new Error(i18n.t("symbolEditor.window.otherProject"));
    const r = rebaseSymbols(base, next, v.simboli);
    if (!r.ok) throw new Error(i18n.t("symbolEditor.window.conflict", { slugs: r.slugs.join(", ") }));
    if (v.versione) impostaVersioneProgetto(v.versione);
    return r.symbols;
  };
  writeHooks.after = (simboli) => {
    canaleFinestra?.postMessage({ type: "saved", da: mio, a: ide, ref, simboli, versione: versioneProgetto() } satisfies MessaggioSimboli);
  };
  // The images and «Genera foto» written from here: the IDE takes them as its
  // own (`forwardedWrite`). The event carries the path since rc.30.
  onOwnWrite = (ev: Event) => {
    const path = (ev as CustomEvent<{ path?: string } | null>).detail?.path;
    if (path && forwardedWrite(path)) {
      canaleFinestra?.postMessage({ type: "wrote", da: mio, a: ide, ref, path } satisfies MessaggioSimboli);
    }
  };
  window.addEventListener("sws:project-switched", onOwnWrite);
  window.addEventListener("pagehide", disconnectSymbolWindow);
  // The objects of the page change in the IDE, which owns them.
  const update = st.updateObject;
  ownUpdateObject = update;
  const pageId = stato.currentPageId;
  useAppStore.setState({
    updateObject: (id, patch) => {
      update(id, patch);
      canaleFinestra?.postMessage({ type: "object", da: mio, a: ide, ref, pageId, id, patch } satisfies MessaggioSimboli);
    },
  });
  st.openSymbolEditor({ ...stato.target, inline: true });
  return true;
}

/** Unhooks the window from the IDE: the channel, its listeners, the write
 *  hooks and the store's own `updateObject`. On `pagehide`, and between tests,
 *  where every window shares one page and the listeners would pile up. */
export function disconnectSymbolWindow(): void {
  canaleFinestra?.close();
  canaleFinestra = null;
  if (onOwnWrite) window.removeEventListener("sws:project-switched", onOwnWrite);
  onOwnWrite = null;
  window.removeEventListener("pagehide", disconnectSymbolWindow);
  if (ownUpdateObject) useAppStore.setState({ updateObject: ownUpdateObject });
  ownUpdateObject = null;
  if (hooks) { hooks.before = null; hooks.after = null; }
  hooks = null;
  ide = "";
  ref = null;
}

/** «Bring back into the IDE»: the draft as it is now goes back. */
export function riportaNellIde(target: SymbolEditorTarget): void {
  canaleFinestra?.postMessage({ type: "bring-back", da: mio, a: ide, target } satisfies MessaggioSimboli);
}
