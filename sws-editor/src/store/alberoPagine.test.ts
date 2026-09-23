// L'albero delle pagine nello store: l'ordine non si perde più, la gerarchia si
// scrive sul server, i cicli si rifiutano.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: {
    updatePageLayout: vi.fn(async () => {}),
    saveSynoptic: vi.fn(async () => {}),
    deleteSynoptic: vi.fn(async () => {}),
    saveBootPage: vi.fn(async () => {}),
    putBootPng: vi.fn(async () => {}),
    deleteBootPage: vi.fn(async () => {}),
    updateFunctions: vi.fn(async () => {}),
    updateCustomSymbols: vi.fn(async () => {}),
  },
  ProjectChangedError: class extends Error {},
  setAuthToken: vi.fn(),
  getAuthToken: () => null,
}));
vi.mock("@/boot/rasterizza", () => ({ rasterizzaPagina: vi.fn(), MAX_PNG_BYTES: 1 }));

import { api } from "@/api/client";
import { alberoCambiato, selectIsDirty, useAppStore } from "@/store";
import type { PageTreeNode, SynopticPage } from "@/types";

const sin = (id: string): SynopticPage => ({ id, name: id, objects: [] });
const stato = () => useAppStore.getState();
const ordine = () => stato().pages.map((p) => p.id);
const albero = () => stato().project?.page_layout?.page_tree;

function reset(pages: SynopticPage[], tree?: PageTreeNode[]) {
  useAppStore.setState({
    project: { meta: { name: "p", version: "1" }, page_layout: tree ? { size_mode: "fixed", page_tree: tree } : undefined } as never,
    pages, currentPageId: pages[0].id, past: [], future: [], pagesRev: 0, savedPagesRev: 0,
    persistedPageNames: [], pendingSections: {}, authRole: "Admin", bootPng: {}, bootPngFirme: {},
  });
}

describe("albero delle pagine nello store", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(api.updatePageLayout).mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it("caricando, le pagine seguono l'albero del progetto e non l'ordine alfabetico", () => {
    useAppStore.setState({ project: { meta: { name: "p", version: "1" }, page_layout: { size_mode: "fixed", page_tree: [{ id: "z" }, { id: "a" }] } } as never });
    stato().setPages([sin("a"), sin("m"), sin("z")]);
    expect(ordine()).toEqual(["z", "a", "m"]); // «m» non è nominata: in coda
  });

  it("senza albero l'ordine resta quello in cui arrivano", () => {
    useAppStore.setState({ project: { meta: { name: "p", version: "1" } } as never });
    stato().setPages([sin("b"), sin("a")]);
    expect(ordine()).toEqual(["b", "a"]);
  });

  // Passo 4 (23-09-2026): l'albero non si scrive più da solo dopo 300 ms.
  // Entra nella cronologia come le pagine e parte col Salva del progetto.
  it("spostare una pagina cambia albero e ordine, e NON scrive da sola", () => {
    reset([sin("a"), sin("b"), sin("c")]);
    stato().spostaPagina("a", "c", 0);
    stato().spostaPagina("b", "c", 1);
    expect(albero()).toEqual([{ id: "c", children: [{ id: "a" }, { id: "b" }] }]);
    expect(ordine()).toEqual(["c", "a", "b"]);
    vi.advanceTimersByTime(2000);
    expect(api.updatePageLayout).not.toHaveBeenCalled();
  });

  it("un ciclo si rifiuta", () => {
    reset([sin("a"), sin("b")], [{ id: "a", children: [{ id: "b" }] }]);
    stato().spostaPagina("a", "b", 0);
    expect(albero()).toEqual([{ id: "a", children: [{ id: "b" }] }]);
    vi.advanceTimersByTime(2000);
    expect(api.updatePageLayout).not.toHaveBeenCalled();
  });

  it("una pagina nuova nasce come figlia del nodo scelto", () => {
    reset([sin("a"), sin("b")]);
    stato().addPage("b");
    const nuova = ordine().find((id) => id !== "a" && id !== "b")!;
    expect(albero()).toEqual([{ id: "a" }, { id: "b", children: [{ id: nuova }] }]);
    expect(ordine()).toEqual(["a", "b", nuova]);
  });

  it("eliminare un nodo fa salire i suoi figli al suo posto", () => {
    reset([sin("a"), sin("b"), sin("c")], [{ id: "a" }, { id: "b", children: [{ id: "c" }] }]);
    stato().deletePage("b");
    expect(albero()).toEqual([{ id: "a" }, { id: "c" }]);
    expect(ordine()).toEqual(["a", "c"]);
  });

  it("la copia sta subito dopo l'originale, fra i suoi fratelli", () => {
    reset([sin("a"), sin("b"), sin("c")], [{ id: "a" }, { id: "b", children: [{ id: "c" }] }]);
    stato().duplicatePage("c");
    const copia = ordine().find((id) => !["a", "b", "c"].includes(id))!;
    expect(albero()).toEqual([{ id: "a" }, { id: "b", children: [{ id: "c" }, { id: copia }] }]);
  });

  it("su/giù si muovono fra i fratelli, non nell'elenco piatto", () => {
    reset([sin("a"), sin("b"), sin("c")], [{ id: "a", children: [{ id: "b" }, { id: "c" }] }]);
    stato().reorderPage("c", "up");
    expect(albero()).toEqual([{ id: "a", children: [{ id: "c" }, { id: "b" }] }]);
    stato().reorderPage("c", "up"); // già primo: resta
    expect(albero()).toEqual([{ id: "a", children: [{ id: "c" }, { id: "b" }] }]);
  });

  // ── Passo 4: annulla, «non salvato» e Salva unico ──────────────────────

  it("Ctrl+Z rimette l'ordine di prima, e il redo lo ritoglie", () => {
    reset([sin("a"), sin("b"), sin("c")]);
    stato().spostaPagina("a", "c", 0);
    expect(albero()).toEqual([{ id: "b" }, { id: "c", children: [{ id: "a" }] }]);
    expect(ordine()).toEqual(["b", "c", "a"]);

    stato().undo();
    // Prima l'albero non c'era: annullando torna l'elenco piatto di partenza.
    expect(albero()).toEqual([]);
    expect(ordine()).toEqual(["a", "b", "c"]);

    stato().redo();
    expect(albero()).toEqual([{ id: "b" }, { id: "c", children: [{ id: "a" }] }]);
    expect(ordine()).toEqual(["b", "c", "a"]);
  });

  it("un albero spostato conta come «non salvato», e l'annulla lo ripulisce", () => {
    reset([sin("a"), sin("b")]);
    useAppStore.setState({ savedPageTree: [] });
    expect(selectIsDirty(stato())).toBe(false);

    stato().spostaPagina("a", "b", 0);
    expect(selectIsDirty(stato())).toBe(true);

    // Annullare rimette esattamente l'albero salvato: non c'è più niente da
    // salvare. Con un contatore di revisione questo caso direbbe «sporco».
    stato().undo();
    expect(alberoCambiato(stato())).toBe(false);
  });

  it("il Salva scrive l'albero una volta, e non lo riscrive se non è cambiato", async () => {
    vi.useRealTimers();
    reset([sin("a"), sin("b")]);
    useAppStore.setState({ savedPageTree: [] });
    stato().spostaPagina("a", "b", 0);

    await stato().saveAll();
    expect(api.updatePageLayout).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.updatePageLayout).mock.calls[0][0]).toMatchObject({
      page_tree: [{ id: "b", children: [{ id: "a" }] }],
    });

    // Secondo salvataggio senza toccare niente: l'albero non riparte.
    await stato().saveAll();
    expect(api.updatePageLayout).toHaveBeenCalledTimes(1);
  });

  it("le pagine di boot non entrano mai nell'albero", () => {
    reset([sin("a"), { ...sin("b"), kind: "boot" }]);
    stato().spostaPagina("b", null, 0);
    expect(albero()).toBeUndefined();
    expect(ordine()).toEqual(["a", "b"]);
  });
});
