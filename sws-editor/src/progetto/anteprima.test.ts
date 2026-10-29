// La miniatura della pagina iniziale (29-10-2026): quale pagina, con quale
// cornice, e che il salvataggio la rifà solo quando cambia.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: {
    saveSynoptic: vi.fn(async () => {}),
    deleteSynoptic: vi.fn(async () => {}),
    saveCornice: vi.fn(async () => {}),
    updateFunctions: vi.fn(async () => {}),
    updateCustomSymbols: vi.fn(async () => {}),
    putAnteprima: vi.fn(async () => {}),
    getProjectFindings: vi.fn(async () => []),
  },
  ProjectChangedError: class extends Error {},
  setAuthToken: vi.fn(),
  getAuthToken: () => null,
}));
// Il canvas vero non gira in jsdom: qui si prova quando si disegna, non come.
vi.mock("@/boot/rasterizza", () => ({
  rasterizzaPagina: vi.fn(async () => ({ png: new Blob([new Uint8Array(2048)], { type: "image/png" }), avvisi: [] as string[] })),
}));

import { api } from "@/api/client";
import { rasterizzaPagina } from "@/boot/rasterizza";
import { useAppStore } from "@/store";
import { corniceDellAnteprima, firmaAnteprima, paginaDellAnteprima } from "./anteprima";
import { corniceAPagina } from "@/cornici/modello";
import type { SynopticPage } from "@/types";

const sin = (id: string, extra: Partial<SynopticPage> = {}): SynopticPage => ({ id, name: id, objects: [], ...extra });
const cornice = corniceAPagina({ id: "testata", nome: "Testata", larghezza: 1280, altezza: 800, testata: { altezza: 56 }, piede: { altezza: 0 }, oggetti: [] });

describe("quale pagina", () => {
  it("la pagina iniziale, se c'è", () => {
    expect(paginaDellAnteprima([sin("a"), sin("b")], "b")?.id).toBe("b");
  });

  it("altrimenti la prima dell'albero che non sia una finestra, mai una pagina speciale", () => {
    const pages = [sin("pop", { finestra: { modale: true } }), sin("a"), sin("boot", { kind: "boot" })];
    expect(paginaDellAnteprima(pages, undefined)?.id).toBe("a");
    expect(paginaDellAnteprima([sin("boot", { kind: "boot" })], undefined)).toBeUndefined();
  });

  it("con la cornice che la pagina mostra, e la firma cambia con lei", () => {
    const p = sin("a");
    expect(corniceDellAnteprima(p, [p, cornice], "testata")?.id).toBe("testata");
    expect(corniceDellAnteprima(sin("b", { cornice: null }), [cornice], "testata")).toBeUndefined();
    expect(firmaAnteprima(p, undefined)).not.toBe(firmaAnteprima(p, corniceDellAnteprima(p, [p, cornice], "testata")));
  });
});

describe("al salvataggio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      project: { meta: { name: "p", version: "1" }, tags: [], sources: [], alarms: [], functions: [], page_layout: { size_mode: "fixed", home_page_id: "home" } } as never,
      past: [], future: [], pagesRev: 0, savedPagesRev: 0, persistedPageNames: [], pendingSections: {}, authRole: "Admin",
      bootPng: {}, bootPngFirme: {}, faceplates: [],
    });
    useAppStore.getState().setPages([sin("home"), sin("altra")]);
  });

  const salva = async () => {
    await useAppStore.getState().saveAll();
    await vi.waitFor(() => expect(useAppStore.getState().saveStatus).toBe("ok"));
    await new Promise((r) => setTimeout(r, 0));
  };

  it("la disegna a 400 px e la manda; non la rifà se la pagina iniziale non cambia", async () => {
    await salva();
    await vi.waitFor(() => expect(api.putAnteprima).toHaveBeenCalledTimes(1));
    expect(vi.mocked(rasterizzaPagina).mock.calls[0][0].id).toBe("home");
    expect(vi.mocked(rasterizzaPagina).mock.calls[0][2]).toMatchObject({ larghezza: 400 });
    await salva();
    expect(api.putAnteprima).toHaveBeenCalledTimes(1);
    // Una modifica a un'altra pagina non la tocca; una alla pagina iniziale sì.
    useAppStore.getState().setCurrentPage("altra");
    useAppStore.getState().addObject({ type: "rect", x: 0, y: 0, width: 10, height: 10 });
    await salva();
    expect(api.putAnteprima).toHaveBeenCalledTimes(1);
    useAppStore.getState().setCurrentPage("home");
    useAppStore.getState().addObject({ type: "rect", x: 0, y: 0, width: 10, height: 10 });
    await salva();
    await vi.waitFor(() => expect(api.putAnteprima).toHaveBeenCalledTimes(2));
  });
});
