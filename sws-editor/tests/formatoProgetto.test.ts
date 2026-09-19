// La regola «la prima pagina modificata definisce lo stile delle altre» (T-72 F3).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { updatePageLayout: vi.fn(async () => {}) },
  ProjectChangedError: class extends Error {},
  setAuthToken: vi.fn(),
  getAuthToken: () => null,
}));

import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { patchDaPredefinito, primaImpostazione, seguePredefinito, valoriDiNascita } from "@/formatoProgetto";
import { aggiornaPagina, applicaPredefinito } from "@/formatoProgettoAzioni";
import type { PageLayoutConfig, ProjectInfo, SynopticPage } from "@/types";

const sin = (id: string, extra: Partial<SynopticPage> = {}): SynopticPage => ({ id, name: id, objects: [], ...extra });
const boot = (id: string): SynopticPage => ({ id, name: id, objects: [], kind: "boot", width: 1280, height: 800, background: "#0f172a" });
const fisso: PageLayoutConfig = { size_mode: "fixed" };

describe("con che formato nasce una pagina", () => {
  it("senza predefinito una sinottica nasce senza misure, e una pagina di boot a 1280×800", () => {
    expect(valoriDiNascita(fisso, "sinottica")).toEqual({});
    expect(valoriDiNascita(fisso, "boot")).toMatchObject({ width: 1280, height: 800 });
  });

  it("col predefinito, entrambe lo prendono", () => {
    const l: PageLayoutConfig = { ...fisso, default_width: 1024, default_height: 600, default_background: "#112233" };
    expect(valoriDiNascita(l, "sinottica")).toEqual({ width: 1024, height: 600, background: "#112233" });
    expect(valoriDiNascita(l, "boot")).toMatchObject({ width: 1024, height: 600, background: "#112233" });
  });

  it("in «rapporto» e «fluido» le misure non si copiano (le decide Q38 o non esistono), lo sfondo sì", () => {
    const l = { default_width: 1024, default_height: 600, default_background: "#112233" };
    for (const size_mode of ["ratio", "fluid"] as const) {
      expect(valoriDiNascita({ size_mode, ...l }, "sinottica")).toEqual({ background: "#112233" });
    }
  });

  it("una pagina di boot ha sempre misure esplicite, qualunque sia la modalità", () => {
    expect(valoriDiNascita({ size_mode: "fluid" }, "boot")).toMatchObject({ width: 1280, height: 800 });
  });
});

describe("la prima impostazione riempie il predefinito", () => {
  it("misure e sfondo impostati la prima volta diventano il predefinito", () => {
    const n = primaImpostazione(fisso, { width: 1024, height: 600, background: "#112233" });
    expect(n).toMatchObject({ default_width: 1024, default_height: 600, default_background: "#112233" });
  });

  it("dalla seconda volta non lo cambia: il predefinito, una volta nato, si cambia a mano", () => {
    const l: PageLayoutConfig = { ...fisso, default_width: 1024, default_height: 600 };
    expect(primaImpostazione(l, { width: 800, height: 480 })).toBeNull();
  });

  it("riempie solo ciò che manca", () => {
    const l: PageLayoutConfig = { ...fisso, default_width: 1024, default_height: 600 };
    expect(primaImpostazione(l, { width: 800, background: "#fff" })).toMatchObject({ default_width: 1024, default_background: "#fff" });
  });

  it("le misure non contano in «rapporto» (sono comuni per costruzione)", () => {
    expect(primaImpostazione({ size_mode: "ratio" }, { width: 800, height: 480 })).toBeNull();
  });

  it("un valore vuoto non è un'impostazione", () => {
    expect(primaImpostazione(fisso, { background: "  " })).toBeNull();
  });
});

describe("a chi si scrive il predefinito", () => {
  const l: PageLayoutConfig = { ...fisso, default_width: 1024, default_height: 600, default_background: "#112233" };

  it("solo alle pagine che non hanno un valore proprio", () => {
    const r = patchDaPredefinito([sin("a"), sin("b", { width: 800, height: 480, background: "#fff" })], l);
    expect(r).toEqual([{ id: "a", patch: { width: 1024, height: 600, background: "#112233" } }]);
  });

  it("una pagina di boot ancora ai valori di nascita conta come senza formato proprio; una modificata no", () => {
    const intonsa = boot("z");
    const sua: SynopticPage = { ...boot("y"), width: 800, height: 480, background: "#fff" };
    expect(patchDaPredefinito([intonsa, sua], l)).toEqual([
      { id: "z", patch: { width: 1024, height: 600, background: "#112233" } },
    ]);
  });

  it("una pagina con la sola larghezza prende l'altezza mancante, non tocca la larghezza", () => {
    const r = patchDaPredefinito([sin("a", { width: 800, background: "#fff" })], l);
    expect(r).toEqual([{ id: "a", patch: { height: 600 } }]);
  });

  it("senza predefinito non c'è niente da scrivere", () => {
    expect(patchDaPredefinito([sin("a")], fisso)).toEqual([]);
    expect(patchDaPredefinito([sin("a")], undefined)).toEqual([]);
  });

  it("una pagina segue il predefinito finché le misure coincidono", () => {
    expect(seguePredefinito({ width: 1024, height: 600 }, l)).toBe(true);
    expect(seguePredefinito({ width: 1024, height: 601 }, l)).toBe(false);
    expect(seguePredefinito({ width: 1024, height: 600 }, fisso)).toBe(false);
  });
});

describe("nello store", () => {
  const stato = () => useAppStore.getState();
  function reset(layout: PageLayoutConfig | undefined, pages: SynopticPage[]) {
    useAppStore.setState({
      project: { meta: { name: "p", version: "1" }, tags: [], sources: [], alarms: [], page_layout: layout } as unknown as ProjectInfo,
      pages, currentPageId: pages[0].id, past: [], future: [], pagesRev: 0, savedPagesRev: 0,
    });
    vi.clearAllMocks();
  }

  beforeEach(() => reset(undefined, [sin("a"), sin("b"), boot("z")]));

  it("impostare le misure sulla prima pagina le porta sull'altra, in un solo passo di cronologia, e salva il predefinito", () => {
    aggiornaPagina("a", { width: 1024, height: 600 });
    expect(stato().pages.find((p) => p.id === "a")).toMatchObject({ width: 1024, height: 600 });
    expect(stato().pages.find((p) => p.id === "b")).toMatchObject({ width: 1024, height: 600 });
    // La pagina di boot, ancora ai valori di nascita, eredita: è «la prima modificata
    // definisce lo stile dell'altra» fra le due pagine con cui nasce un progetto.
    expect(stato().pages.find((p) => p.id === "z")).toMatchObject({ width: 1024, height: 600 });
    expect(stato().past).toHaveLength(1);
    expect(api.updatePageLayout).toHaveBeenCalledWith(expect.objectContaining({ default_width: 1024, default_height: 600 }));
    expect(stato().project?.page_layout?.default_width).toBe(1024);
  });

  it("il contrario: impostare la pagina di boot per prima porta il formato sulle sinottiche", () => {
    aggiornaPagina("z", { width: 1024, height: 600 });
    expect(stato().pages.find((p) => p.id === "a")).toMatchObject({ width: 1024, height: 600 });
    expect(stato().pages.find((p) => p.id === "b")).toMatchObject({ width: 1024, height: 600 });
  });

  it("dalla seconda impostazione l'altra pagina non si tocca", () => {
    aggiornaPagina("a", { width: 1024, height: 600 });
    aggiornaPagina("a", { width: 800, height: 480 });
    expect(stato().pages.find((p) => p.id === "b")).toMatchObject({ width: 1024, height: 600 });
  });

  it("cambiare solo il nome non fa nascere un predefinito", () => {
    aggiornaPagina("a", { name: "Nuova" });
    expect(api.updatePageLayout).not.toHaveBeenCalled();
    expect(stato().pages.find((p) => p.id === "b")?.width).toBeUndefined();
  });

  it("una pagina nuova nasce col predefinito, sinottica o di boot", () => {
    reset({ size_mode: "fixed", default_width: 1024, default_height: 600, default_background: "#112233" }, [sin("a")]);
    stato().addPage();
    stato().addBootPage();
    const nuova = stato().pages.find((p) => p.name === "Page 2")!;
    expect(nuova).toMatchObject({ width: 1024, height: 600, background: "#112233" });
    expect(stato().pages.find((p) => p.kind === "boot")).toMatchObject({ width: 1024, height: 600, background: "#112233" });
  });

  it("«Applica» scrive il predefinito sulle pagine senza formato proprio e dice quante", () => {
    reset({ size_mode: "fixed", default_width: 1024, default_height: 600 }, [sin("a"), sin("b", { width: 800, height: 480 })]);
    expect(applicaPredefinito(stato().project!.page_layout!)).toBe(1);
    expect(stato().pages[0]).toMatchObject({ width: 1024, height: 600 });
    expect(stato().pages[1]).toMatchObject({ width: 800, height: 480 });
  });
});
