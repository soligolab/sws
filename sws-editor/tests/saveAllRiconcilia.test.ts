// Il Salva unico crea le variabili referenziate e non dichiarate (Fase 0b).
//
// Prima la creazione stava nel pulsante Salva della scheda Sorgenti, in una
// lista locale che Ctrl+S non vedeva. Qui si prova dal lato dello store: dopo
// il flush delle bozze, `saveAll` calcola i riferimenti finali, fa UN solo
// PUT dei tag con i nuovi in coda, svuota le attese e lascia il riepilogo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: {
    getProjectFingerprint: vi.fn(async () => ({ sha256: "IMPRONTA", computed_at_ms: 0 })),
    updateTags: vi.fn(async () => {}),
    updateSources: vi.fn(async () => {}),
    updateAlarms: vi.fn(async () => {}),
    saveSynoptic: vi.fn(async () => {}),
    saveBootPage: vi.fn(async () => {}),
    updateFunctions: vi.fn(async () => {}),
    saveGlobalScripts: vi.fn(async () => {}),
    updateCustomSymbols: vi.fn(async () => {}),
    deleteSynoptic: vi.fn(async () => {}),
    deleteBootPage: vi.fn(async () => {}),
  },
  setAuthToken: vi.fn(),
  getAuthToken: () => null,
  ProjectChangedError: class ProjectChangedError extends Error {},
}));

import "../src/i18n";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { ProjectInfo, SynopticObject, SynopticPage } from "@/types";

const PAGINA: SynopticPage = {
  id: "p1", name: "Impianto",
  objects: [
    { id: "l", type: "led", x: 0, y: 0, tag: "pompa.on" } as SynopticObject,
    { id: "g", type: "gauge", x: 0, y: 0, tag: "pompa.velocita" } as SynopticObject,
  ],
} as SynopticPage;

const PROGETTO = {
  meta: { name: "p", version: "1" },
  tags: [{ id: "pompa.velocita", description: "", data_type: "float" }],
  sources: [],
} as unknown as ProjectInfo;

describe("saveAll riconcilia i tag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ pendingSections: {}, tagInAttesa: [], ultimiTagCreati: [], saveStatus: "idle", authRole: null });
    useAppStore.getState().setProject(structuredClone(PROGETTO));
    useAppStore.getState().setPages([structuredClone(PAGINA)], "p1");
  });
  afterEach(() => vi.useRealTimers());

  it("crea il tag referenziato e non dichiarato con il tipo dedotto, in un solo PUT", async () => {
    await useAppStore.getState().saveAll();
    expect(api.updateTags).toHaveBeenCalledTimes(1);
    const inviati = (api.updateTags as ReturnType<typeof vi.fn>).mock.calls[0][0] as { id: string; data_type: string }[];
    expect(inviati.map((t) => t.id)).toEqual(["pompa.velocita", "pompa.on"]);
    expect(inviati[1]).toMatchObject({ data_type: "bool", history: false });
    expect(useAppStore.getState().project?.tags.map((t) => t.id)).toEqual(["pompa.velocita", "pompa.on"]);
    expect(useAppStore.getState().ultimiTagCreati).toEqual(["pompa.on"]);
    expect(useAppStore.getState().saveStatus).toBe("ok");
  });

  it("una definizione in attesa vince, e le attese non referenziate si scartano senza PUT in più", async () => {
    useAppStore.getState().aggiungiTagInAttesa({ id: "pompa.on", description: "Marcia", data_type: "bool", history: true });
    useAppStore.getState().aggiungiTagInAttesa({ id: "refuso.abbandonato", description: "", data_type: "float" });
    await useAppStore.getState().saveAll();
    expect(api.updateTags).toHaveBeenCalledTimes(1);
    const inviati = (api.updateTags as ReturnType<typeof vi.fn>).mock.calls[0][0] as { id: string }[];
    expect(inviati.map((t) => t.id)).toEqual(["pompa.velocita", "pompa.on"]);
    expect(inviati[1]).toMatchObject({ description: "Marcia", history: true });
    expect(useAppStore.getState().tagInAttesa).toEqual([]);
  });

  it("niente da creare: nessun PUT dei tag e riepilogo vuoto", async () => {
    useAppStore.getState().setProject({
      ...structuredClone(PROGETTO),
      tags: [...PROGETTO.tags, { id: "pompa.on", description: "", data_type: "bool" }],
    } as ProjectInfo);
    await useAppStore.getState().saveAll();
    expect(api.updateTags).not.toHaveBeenCalled();
    expect(useAppStore.getState().ultimiTagCreati).toEqual([]);
  });

  it("aggiungere due volte lo stesso id in attesa non lo duplica", () => {
    useAppStore.getState().aggiungiTagInAttesa({ id: "x", description: "", data_type: "float" });
    useAppStore.getState().aggiungiTagInAttesa({ id: "x", description: "altro", data_type: "int" });
    expect(useAppStore.getState().tagInAttesa).toHaveLength(1);
    expect(useAppStore.getState().tagInAttesa[0].data_type).toBe("int");
  });
});
