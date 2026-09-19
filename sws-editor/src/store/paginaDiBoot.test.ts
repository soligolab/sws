// Le pagine di boot nello store (T-72): come si creano, si eliminano, si
// salvano — e cosa non devono mai toccare delle pagine del pannello.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: {
    saveSynoptic: vi.fn(async () => {}),
    deleteSynoptic: vi.fn(async () => {}),
    saveBootPage: vi.fn(async () => {}),
    deleteBootPage: vi.fn(async () => {}),
    updateFunctions: vi.fn(async () => {}),
    updateCustomSymbols: vi.fn(async () => {}),
  },
  ProjectChangedError: class extends Error {},
  setAuthToken: vi.fn(),
  getAuthToken: () => null,
}));

import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { SynopticPage } from "@/types";

const sin = (id: string, name = id): SynopticPage => ({ id, name, objects: [] });
const boot = (id: string, name = id): SynopticPage => ({ id, name, objects: [], kind: "boot" });
const stato = () => useAppStore.getState();

function reset(pages: SynopticPage[], current: string) {
  useAppStore.setState({
    project: null, pages, currentPageId: current, past: [], future: [],
    pagesRev: 0, savedPagesRev: 0, persistedPageNames: [], pendingSections: {}, authRole: "Admin",
  });
}

describe("caricare le pagine", () => {
  it("i sinottici stanno prima e la pagina corrente iniziale non è mai una pagina di boot", () => {
    stato().setPages([boot("b"), sin("a"), sin("c")]);
    expect(stato().pages.map((p) => p.id)).toEqual(["a", "c", "b"]);
    expect(stato().currentPageId).toBe("a");
  });

  it("ricorda le pagine già su disco con la chiave di boot, così una omonima non si confonde", () => {
    stato().setPages([sin("a", "Home"), boot("b", "Home")]);
    expect(stato().persistedPageNames).toEqual(["Home", "boot/Home"]);
  });
});

describe("creare ed eliminare", () => {
  beforeEach(() => reset([sin("a", "Page 1")], "a"));

  it("una nuova immagine di boot nasce con la risoluzione di default, in coda, e diventa la corrente", () => {
    stato().addBootPage();
    const b = stato().pages[1];
    expect(b.kind).toBe("boot");
    expect(b.width).toBe(1280);
    expect(b.height).toBe(800);
    expect(stato().currentPageId).toBe(b.id);
  });

  it("una nuova pagina sinottica si mette prima delle pagine di boot e il contatore del nome le ignora", () => {
    stato().addBootPage();
    stato().addPage();
    expect(stato().pages.map((p) => p.kind ?? "sinottica")).toEqual(["sinottica", "sinottica", "boot"]);
    expect(stato().pages[1].name).toBe("Page 2");
  });

  it("l'ultima pagina sinottica non si elimina, nemmeno se c'è una pagina di boot", () => {
    stato().addBootPage();
    stato().deletePage("a");
    expect(stato().pages.some((p) => p.id === "a")).toBe(true);
  });

  it("una pagina di boot si elimina sempre, anche l'ultima", () => {
    stato().addBootPage();
    const id = stato().pages[1].id;
    stato().deletePage(id);
    expect(stato().pages.map((p) => p.id)).toEqual(["a"]);
    expect(stato().currentPageId).toBe("a");
  });

  it("le pagine di boot non si riordinano e non si spostano fra le sinottiche", () => {
    stato().addBootPage();
    stato().addPage();
    const id = stato().pages.find((p) => p.kind === "boot")!.id;
    stato().reorderPage(id, "up");
    stato().movePage(id, 0);
    expect(stato().pages.map((p) => p.kind ?? "sinottica")).toEqual(["sinottica", "sinottica", "boot"]);
  });

  it("una sinottica spostata in fondo non supera le pagine di boot", () => {
    stato().addPage();
    stato().addBootPage();
    stato().movePage("a", 99);
    expect(stato().pages.map((p) => p.kind ?? "sinottica")).toEqual(["sinottica", "sinottica", "boot"]);
  });
});

describe("gli oggetti su una pagina di boot", () => {
  beforeEach(() => { reset([sin("a")], "a"); stato().addBootPage(); });

  it("gli oggetti statici entrano, gli altri no e non lasciano traccia nella cronologia", () => {
    const passi = stato().past.length;
    stato().addObject({ type: "trend", x: 0, y: 0 } as never);
    expect(stato().pages[1].objects).toHaveLength(0);
    expect(stato().past.length).toBe(passi);
    stato().addObject({ type: "rect", x: 0, y: 0 } as never);
    expect(stato().pages[1].objects).toHaveLength(1);
  });

  it("incollare un oggetto non statico su una pagina di boot non fa niente", () => {
    useAppStore.setState({ clipboard: [{ id: "x", type: "gauge", x: 0, y: 0 }], clipboardSourcePageId: "a" } as never);
    stato().pasteClipboard();
    expect(stato().pages[1].objects).toHaveLength(0);
  });
});

describe("salvare", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("ogni pagina va al suo endpoint: le pagine di boot a /api/boot-pages, le altre a /api/synoptics", async () => {
    reset([sin("a", "Home"), boot("b", "Splash")], "a");
    await stato().saveAll();
    expect(api.saveSynoptic).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.saveSynoptic).mock.calls[0][0].name).toBe("Home");
    expect(api.saveBootPage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.saveBootPage).mock.calls[0][0].name).toBe("Splash");
  });

  it("una pagina di boot eliminata si cancella da boot/, una sinottica da synoptics/", async () => {
    reset([sin("a", "Home")], "a");
    useAppStore.setState({ persistedPageNames: ["Home", "Vecchia", "boot/Splash"] });
    await stato().saveAll();
    expect(api.deleteBootPage).toHaveBeenCalledWith("Splash");
    expect(api.deleteSynoptic).toHaveBeenCalledWith("Vecchia");
    expect(api.deleteSynoptic).not.toHaveBeenCalledWith("Home");
  });
});
