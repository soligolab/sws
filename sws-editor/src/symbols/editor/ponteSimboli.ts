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

import { impostaVersioneProgetto, setLockTab, versioneProgetto } from "@/api/client";
import { idEditore, nuovoId } from "@/ai/ponte";
import { apriFinestra } from "@/apriFinestra";
import { percorsoFinestra } from "@/api/prefisso";
import { TAB_ID } from "@/projectLock/projectLock";
import { useAppStore } from "@/store";
import type { DescrizioneSimbolo, ProjectInfo, SynopticObject, SynopticPage } from "@/types";
import type { SymbolEditorTarget } from "./open";

export const CANALE_SIMBOLI = "sws.simboli.ponte.v1";

export type MessaggioSimboli =
  | { type: "hello"; da: string; a: string; t: string }
  | { type: "state"; da: string; a: string; target: SymbolEditorTarget; project: ProjectInfo; pages: SynopticPage[];
      currentPageId: string | null; versione: string | null; lockTab: string }
  | { type: "ask-version"; da: string; a: string }
  | { type: "version"; da: string; a: string; versione: string | null }
  | { type: "saved"; da: string; a: string; simboli: DescrizioneSimbolo[]; versione: string | null }
  | { type: "object"; da: string; a: string; pageId: string | null; id: string; patch: Partial<SynopticObject> }
  | { type: "bring-back"; da: string; a: string; target: SymbolEditorTarget };

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

/** Started once by the IDE (`App.tsx`). */
export function avviaPonteSimboliIde(): () => void {
  if (typeof BroadcastChannel === "undefined" || canaleIde) return () => {};
  const io = idEditore();
  const c = new BroadcastChannel(CANALE_SIMBOLI);
  canaleIde = c;
  c.onmessage = (ev: MessageEvent<MessaggioSimboli>) => {
    const m = ev.data;
    if (!m || m.a !== io) return;
    const st = useAppStore.getState();
    switch (m.type) {
      case "hello": {
        const target = inAttesa.get(m.t);
        if (!target || !st.project) return;
        c.postMessage({
          type: "state", da: io, a: m.da, target, project: st.project, pages: st.pages,
          currentPageId: st.currentPageId, versione: versioneProgetto(), lockTab: TAB_ID,
        } satisfies MessaggioSimboli);
        return;
      }
      case "ask-version":
        c.postMessage({ type: "version", da: io, a: m.da, versione: versioneProgetto() } satisfies MessaggioSimboli);
        return;
      case "saved":
        st.updateProjectSimboli(m.simboli);
        if (m.versione) impostaVersioneProgetto(m.versione);
        return;
      case "object":
        // Only on the page it was meant for: the IDE may have moved on.
        if (m.pageId === st.currentPageId) st.updateObject(m.id, m.patch);
        return;
      case "bring-back":
        ricordaStaccato(false);
        st.openSymbolEditor({ ...m.target, inline: true });
        return;
    }
  };
  return () => { c.close(); canaleIde = null; };
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
const mio = nuovoId();

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
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  ide = q.get("e") ?? "";
  const t = q.get("t") ?? "";
  if (!ide || !t || typeof BroadcastChannel === "undefined") return false;
  canaleFinestra = new BroadcastChannel(CANALE_SIMBOLI);
  const stato = await chiedi({ type: "hello", da: mio, a: ide, t }, "state", 4000);
  if (!stato) return false;
  setLockTab(stato.lockTab);
  impostaVersioneProgetto(stato.versione);
  const st = useAppStore.getState();
  st.setProject(stato.project);
  st.setPages(stato.pages, stato.currentPageId ?? undefined);
  // Before a write, the project's version as the IDE has it now; after, what
  // was written, so the IDE's pages and version follow.
  const { writeHooks } = await import("./open");
  writeHooks.before = async () => {
    const v = await chiedi({ type: "ask-version", da: mio, a: ide }, "version");
    if (v?.versione) impostaVersioneProgetto(v.versione);
  };
  writeHooks.after = (simboli) => {
    canaleFinestra?.postMessage({ type: "saved", da: mio, a: ide, simboli, versione: versioneProgetto() } satisfies MessaggioSimboli);
  };
  // The objects of the page change in the IDE, which owns them.
  const update = st.updateObject;
  const pageId = stato.currentPageId;
  useAppStore.setState({
    updateObject: (id, patch) => {
      update(id, patch);
      canaleFinestra?.postMessage({ type: "object", da: mio, a: ide, pageId, id, patch } satisfies MessaggioSimboli);
    },
  });
  st.openSymbolEditor({ ...stato.target, inline: true });
  return true;
}

/** «Bring back into the IDE»: the draft as it is now goes back. */
export function riportaNellIde(target: SymbolEditorTarget): void {
  canaleFinestra?.postMessage({ type: "bring-back", da: mio, a: ide, target } satisfies MessaggioSimboli);
}
