// La rinomina dallo store (Fase 0c): a progetto salvato scrive in serie ciò
// che cambia e niente altro; a progetto sporco si rifiuta.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: {
    getProjectFingerprint: vi.fn(async () => ({ sha256: "IMPRONTA", computed_at_ms: 0 })),
    updateTags: vi.fn(async () => {}),
    updateSources: vi.fn(async () => {}),
    updateAlarms: vi.fn(async () => {}),
    saveGlobalScripts: vi.fn(async () => {}),
    saveSynoptic: vi.fn(async () => {}),
    saveBootPage: vi.fn(async () => {}),
    saveFaceplate: vi.fn(async () => {}),
    saveRecipe: vi.fn(async () => {}),
    addTagRename: vi.fn(async (from: string, to: string) => ({ rename: { id: "r1", from, to }, applied: 1 })),
  },
  setAuthToken: vi.fn(),
  getAuthToken: () => null,
  ProjectChangedError: class ProjectChangedError extends Error {},
}));

import "../src/i18n";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { ProjectInfo, SynopticObject, SynopticPage } from "@/types";

const PAGINE: SynopticPage[] = [
  { id: "p1", name: "Impianto", objects: [{ id: "l", type: "led", x: 0, y: 0, tag: "pompa.on" } as SynopticObject] } as SynopticPage,
  { id: "p2", name: "Altra", objects: [{ id: "t", type: "text", x: 0, y: 0, tag: "altro" } as SynopticObject] } as SynopticPage,
];
const PROGETTO = {
  meta: { name: "p", version: "1" },
  tags: [{ id: "pompa.on", description: "", data_type: "bool" }, { id: "altro", description: "", data_type: "float" }],
  sources: [{ kind: "modbus_tcp", id: "plc", registers: [{ tag: "pompa.on", address: 1 }] }],
  alarms: [],
} as unknown as ProjectInfo;

describe("rinominaTag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ pendingSections: {}, saveStatus: "idle", faceplates: [] });
    useAppStore.getState().setProject(structuredClone(PROGETTO));
    useAppStore.getState().setPages(structuredClone(PAGINE), "p1");
    useAppStore.getState().markPagesSaved();
  });

  it("scrive solo ciò che cambia, in serie, e aggiorna lo store", async () => {
    const e = await useAppStore.getState().rinominaTag("pompa.on", "pompa.marcia", []);
    expect(api.updateTags).toHaveBeenCalledTimes(1);
    expect(api.updateSources).toHaveBeenCalledTimes(1);
    expect(api.updateAlarms).not.toHaveBeenCalled();
    expect(api.saveGlobalScripts).not.toHaveBeenCalled();
    expect(api.saveSynoptic).toHaveBeenCalledTimes(1);
    expect((api.saveSynoptic as ReturnType<typeof vi.fn>).mock.calls[0][0].id).toBe("p1");
    expect(e.punti.map((p) => p.tipo).sort()).toEqual(["pagina", "sorgente"]);
    const st = useAppStore.getState();
    expect(st.project?.tags.map((t) => t.id)).toEqual(["pompa.marcia", "altro"]);
    expect((st.pages[0].objects[0] as SynopticObject).tag).toBe("pompa.marcia");
    expect(st.pagesRev).toBe(st.savedPagesRev);
    expect(st.saveStatus).toBe("ok");
  });

  it("the history follows: the route is called last, and the entry goes into the store", async () => {
    await useAppStore.getState().rinominaTag("pompa.on", "pompa.marcia", []);
    expect(api.addTagRename).toHaveBeenCalledWith("pompa.on", "pompa.marcia");
    const order = (f: unknown) => (f as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(order(api.addTagRename)).toBeGreaterThan(order(api.saveSynoptic));
    expect(useAppStore.getState().project?.tag_renames).toEqual([{ id: "r1", from: "pompa.on", to: "pompa.marcia" }]);
  });

  it("an older runtime (404) does not stop the rename: only a console warning", async () => {
    (api.addTagRename as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("API /api/project/tag-renames: 404 Not Found"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await useAppStore.getState().rinominaTag("pompa.on", "pompa.marcia", []);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const st = useAppStore.getState();
    expect(st.project?.tags.map((t) => t.id)).toEqual(["pompa.marcia", "altro"]);
    expect(st.project?.tag_renames ?? []).toEqual([]);
    expect(st.saveStatus).toBe("ok");
  });

  it("another error of the route is an error of the rename", async () => {
    (api.addTagRename as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("API /api/project/tag-renames: 500 Internal Server Error"));
    await expect(useAppStore.getState().rinominaTag("pompa.on", "pompa.marcia", [])).rejects.toThrow(/500/);
    expect(useAppStore.getState().saveStatus).toBe("error");
  });

  it("a progetto sporco si rifiuta senza scrivere niente", async () => {
    useAppStore.getState().registerPendingSection("sources", async () => {});
    await expect(useAppStore.getState().rinominaTag("pompa.on", "x", [])).rejects.toThrow();
    expect(api.updateTags).not.toHaveBeenCalled();
  });

  it("un id già preso si rifiuta", async () => {
    await expect(useAppStore.getState().rinominaTag("pompa.on", "altro", [])).rejects.toThrow();
    expect(api.updateTags).not.toHaveBeenCalled();
  });
});
