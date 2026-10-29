// I faceplate come pagine dello store (29-10-2026, piano
// docs/plans/2026-10-27-faceplate-disegnato-sul-canvas.md): andata e ritorno
// della definizione, il salvataggio che scrive solo i cambiati, i predefiniti
// che non si eliminano, e niente faceplate dentro un faceplate.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: {
    saveSynoptic: vi.fn(async () => {}),
    deleteSynoptic: vi.fn(async () => {}),
    saveFaceplate: vi.fn(async () => {}),
    deleteFaceplate: vi.fn(async () => {}),
    getFaceplate: vi.fn(async (id: string) => ({ id, label: "Tank Level", params: ["tag_prefix"], objects: [] })),
    updateFunctions: vi.fn(async () => {}),
    updateCustomSymbols: vi.fn(async () => {}),
  },
  ProjectChangedError: class extends Error {},
  setAuthToken: vi.fn(),
  getAuthToken: () => null,
}));

import { api } from "@/api/client";
import { useAppStore } from "@/store";
import {
  anteprimaParametri, faceplateAPagina, idPaginaDiFaceplate, paginaAFaceplate, usiDelFaceplate,
} from "@/faceplate/modello";
import { substituteFaceplateParams } from "@/canvas/SvgCanvas";
import { paletteForTarget } from "@/editor/LeftPanel";
import { chiavePagina, paginePerNavigazione } from "@/boot/tipi";
import { corniceDellaPagina } from "@/cornici/modello";
import type { FaceplateDef, SynopticObject, SynopticPage } from "@/types";

const stato = () => useAppStore.getState();
const sin = (id: string, objects: SynopticObject[] = []): SynopticPage => ({ id, name: id, objects });

/** Un predefinito come lo scrive `assets/faceplates/*.yaml`: parametri a
 *  stringhe nude, nessuna misura. */
const serbatoio: FaceplateDef = {
  id: "tank_level", label: "Tank Level", params: ["tag_prefix", "label"],
  objects: [
    { id: "bg", type: "rect", x: 0, y: 0, width: 100, height: 120 },
    { id: "titolo", type: "text", x: 4, y: 14, text: "{label}", tag: "{tag_prefix}.level" },
  ],
};
const pompa: FaceplateDef = {
  id: "pompa", label: "Pompa", params: [{ name: "p", type: "istanza" }], objects: [], width: 200, height: 80,
};

function carica(pages: SynopticPage[]) {
  useAppStore.setState({
    project: null, past: [], future: [], pagesRev: 0, savedPagesRev: 0, persistedPageNames: [],
    pendingSections: {}, authRole: "Admin", bootPng: {}, bootPngFirme: {}, faceplates: [],
  });
  stato().setPages(pages);
}

beforeEach(() => vi.clearAllMocks());

describe("la definizione e la sua pagina", () => {
  it("andata e ritorno: parametri tipizzati, misura nata dal riquadro dei figli", () => {
    const p = faceplateAPagina(serbatoio, "intatto");
    expect(p.id).toBe("faceplate:tank_level");
    expect(p.kind).toBe("faceplate");
    // Il testo senza larghezza conta 100, come per lo scalare delle istanze.
    expect([p.width, p.height]).toEqual([104, 120]);
    expect(p.faceplate_parametri).toEqual([{ name: "tag_prefix" }, { name: "label" }]);
    const d = paginaAFaceplate(p);
    expect(d).toEqual({ ...serbatoio, params: [{ name: "tag_prefix" }, { name: "label" }], width: 104, height: 120 });
    // La misura dichiarata vince sul riquadro.
    expect([faceplateAPagina(pompa).width, faceplateAPagina(pompa).height]).toEqual([200, 80]);
  });

  it("sul canvas: il predefinito o il nome, e gli id restano quelli", () => {
    const a = anteprimaParametri([{ name: "label", default: "Serbatoio 1" }, { name: "tag_prefix" }]);
    const o = substituteFaceplateParams(serbatoio.objects[1], a);
    expect(o.text).toBe("Serbatoio 1");
    expect(o.tag).toBe("tag_prefix.level");
    expect(o.id).toBe("titolo");
  });

  it("la cornice predefinita non finisce sotto un faceplate", () => {
    expect(corniceDellaPagina(faceplateAPagina(serbatoio), "testata")).toBeNull();
    expect(corniceDellaPagina(sin("a"), "testata")).toBe("testata");
  });

  it("non è una pagina del pannello, e la sua chiave è sua", () => {
    const p = faceplateAPagina(serbatoio);
    expect(paginePerNavigazione([sin("a"), p])).toEqual([sin("a")]);
    expect(chiavePagina(p)).toBe("faceplate/tank_level");
  });

  it("gli usi contano istanze e popup, non il faceplate stesso", () => {
    const pages = [
      sin("a", [
        { id: "i1", type: "faceplate", x: 0, y: 0, faceplate_id: "pompa" },
        { id: "b1", type: "button", x: 0, y: 0, button_action: { type: "open_faceplate", faceplate_id: "pompa" } },
      ]),
      faceplateAPagina(pompa),
    ];
    expect(usiDelFaceplate(pages, "pompa")).toEqual({ istanze: 1, popup: 1, pagine: ["a"] });
  });
});

describe("nello store", () => {
  beforeEach(() => carica([sin("home"), faceplateAPagina(serbatoio, "intatto"), faceplateAPagina(pompa)]));

  it("i faceplate stanno in coda e lo store ne ricava le definizioni", () => {
    expect(stato().pages.map((p) => p.id)).toEqual(["home", "faceplate:tank_level", "faceplate:pompa"]);
    expect(stato().faceplates.map((f) => f.id)).toEqual(["tank_level", "pompa"]);
    expect(stato().currentPageId).toBe("home");
  });

  it("una modifica al faceplate arriva subito alle definizioni, prima del salvataggio", () => {
    stato().setCurrentPage(idPaginaDiFaceplate("pompa"));
    stato().addObject({ type: "rect", x: 1, y: 1, width: 10, height: 10 });
    expect(stato().faceplates.find((f) => f.id === "pompa")!.objects).toHaveLength(1);
  });

  it("il salvataggio scrive solo i faceplate cambiati: un predefinito intatto resta del runtime", async () => {
    await stato().saveAll();
    expect(api.saveFaceplate).not.toHaveBeenCalled();
    stato().setCurrentPage(idPaginaDiFaceplate("tank_level"));
    stato().addObject({ type: "rect", x: 1, y: 1, width: 10, height: 10 });
    await stato().saveAll();
    expect(api.saveFaceplate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.saveFaceplate).mock.calls[0][0].id).toBe("tank_level");
    // Scritto, è diventato personalizzato; un secondo Salva non lo riscrive.
    expect(stato().pages.find((p) => p.id === "faceplate:tank_level")!.faceplate_predefinito).toBe("personalizzato");
    await stato().saveAll();
    expect(api.saveFaceplate).toHaveBeenCalledTimes(1);
  });

  it("niente faceplate dentro un faceplate, né aggiunto né incollato", () => {
    stato().setCurrentPage(idPaginaDiFaceplate("pompa"));
    stato().addObject({ type: "faceplate", x: 0, y: 0, faceplate_id: "tank_level" });
    expect(stato().pages.find((p) => p.id === "faceplate:pompa")!.objects).toHaveLength(0);
    useAppStore.setState({ clipboard: [{ id: "x", type: "faceplate", x: 0, y: 0 }], clipboardSourcePageId: "home" });
    stato().pasteClipboard();
    expect(stato().pages.find((p) => p.id === "faceplate:pompa")!.objects).toHaveLength(0);
    // Il faceplate non è uno strumento da nessuna parte (29-10-2026): si
    // trascina dal suo ramo.
    for (const g of [paletteForTarget(false, false, true), paletteForTarget(false), paletteForTarget(true)]) {
      expect(g.flatMap((x) => x.items.map((i) => i.type))).not.toContain("faceplate");
    }
  });

  it("un predefinito non si elimina; uno del progetto sì, e il Salva lo cancella", async () => {
    stato().deletePage("faceplate:tank_level");
    expect(stato().pages.some((p) => p.id === "faceplate:tank_level")).toBe(true);
    stato().deletePage("faceplate:pompa");
    expect(stato().pages.some((p) => p.id === "faceplate:pompa")).toBe(false);
    await stato().saveAll();
    expect(api.deleteFaceplate).toHaveBeenCalledWith("pompa");
  });

  it("l'unica sinottica resta, ma un faceplate si elimina anche se le sinottiche sono una", () => {
    stato().deletePage("home");
    expect(stato().pages.some((p) => p.id === "home")).toBe(true);
  });

  it("il JSON riscrive la pagina in un passo, tiene l'id e rifiuta l'annidamento", () => {
    const prima = stato().past.length;
    stato().applicaDefinizioneFaceplate("faceplate:pompa", { ...pompa, id: "altro", label: "Pompa grande", width: 300 });
    const p = stato().pages.find((x) => x.id === "faceplate:pompa")!;
    expect([p.name, p.width]).toEqual(["Pompa grande", 300]);
    expect(stato().past.length).toBe(prima + 1);
    stato().applicaDefinizioneFaceplate("faceplate:pompa", { ...pompa, objects: [{ id: "n", type: "faceplate", x: 0, y: 0 }] });
    expect(stato().pages.find((x) => x.id === "faceplate:pompa")!.objects).toHaveLength(0);
  });

  it("il ripristino di un predefinito personalizzato cancella il file e rilegge la definizione", async () => {
    useAppStore.setState((s) => ({
      pages: s.pages.map((p) => (p.id === "faceplate:tank_level" ? { ...p, faceplate_predefinito: "personalizzato" as const } : p)),
    }));
    await stato().ripristinaFaceplate("faceplate:tank_level");
    expect(api.deleteFaceplate).toHaveBeenCalledWith("tank_level");
    const p = stato().pages.find((x) => x.id === "faceplate:tank_level")!;
    expect(p.faceplate_predefinito).toBe("intatto");
    await stato().saveAll();
    expect(api.saveFaceplate).not.toHaveBeenCalled();
  });

  it("dalla selezione: la definizione nasce come pagina, nello stesso passo dell'istanza", () => {
    carica([sin("home", [{ id: "r", type: "rect", x: 10, y: 10, width: 20, height: 20 }])]);
    stato().selectObject("r");
    const prima = stato().past.length;
    const def: FaceplateDef = { id: "nuovo", label: "Nuovo", params: [], objects: [{ id: "r", type: "rect", x: 0, y: 0, width: 20, height: 20 }] };
    stato().sostituisciSelezione({ id: "i", type: "faceplate", x: 10, y: 10, faceplate_id: "nuovo" }, faceplateAPagina(def));
    expect(stato().past.length).toBe(prima + 1);
    expect(stato().pages.some((p) => p.id === "faceplate:nuovo")).toBe(true);
    expect(stato().faceplates.map((f) => f.id)).toEqual(["nuovo"]);
    stato().undo();
    expect(stato().pages.some((p) => p.id === "faceplate:nuovo")).toBe(false);
  });
});
