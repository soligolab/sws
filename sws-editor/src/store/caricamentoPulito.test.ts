/** «Invia ora» spediva la versione vecchia (ramo 1b del piano
 *  docs/plans/2026-10-14-revisione-ide-collaudo-wp630.md, 17-10-2026): `setPages`
 *  normalizzava le pagine e le dichiarava comunque pulite. */
import { describe, expect, it, vi } from "vitest";
vi.mock("@/api/client", () => ({
  api: { saveSynoptic: vi.fn(async () => {}) },
  ProjectChangedError: class extends Error {},
  setAuthToken: vi.fn(),
  getAuthToken: () => null,
}));

import { selectIsDirty, useAppStore } from "@/store";
import type { SynopticObject, SynopticPage } from "@/types";
import { PALETTE_GROUPS } from "@/editor/LeftPanel";
import { oggettoNuovo } from "@/editor/oggettiNuovi";

/** I tipi della palette, appiattiti. */
const tipi = (g: typeof PALETTE_GROUPS) => g.flatMap((x) => x.items.map((i) => i.type));

/** Una pagina con un oggetto di ogni tipo della palette, come lo crea l'editor. */
function paginaConTutto(): SynopticPage {
  const objects = tipi(PALETTE_GROUPS).flatMap((type, i) => {
    const o = oggettoNuovo(type, 20 + (i % 8) * 140, 20 + Math.floor(i / 8) * 120);
    return o ? [{ ...o, id: `o${i}` } as SynopticObject] : [];
  });
  return { id: "p", name: "Tutto", width: 1280, height: 800, objects };
}

const carica = (pages: SynopticPage[]) => {
  useAppStore.setState({ project: null, pendingSections: {} });
  useAppStore.getState().setPages(pages);
  return useAppStore.getState();
};

describe("caricare le pagine non le dichiara pulite se le ha cambiate", () => {
  it("una pagina già salvata nella forma nuova, ricaricata, resta pulita (idempotenza)", () => {
    // primo caricamento: la normalizzazione scrive ciò che il file non dice
    const prima = carica([paginaConTutto()]);
    // ciò che il salvataggio scriverebbe, come andata e ritorno dal disco
    const suDisco = JSON.parse(JSON.stringify(prima.pages)) as SynopticPage[];
    const dopo = carica(suDisco);
    expect(selectIsDirty(dopo), "ricaricare una pagina già normalizzata non deve sporcarla").toBe(false);
  });

  it("un trend nella forma vecchia (tag + extra_tags) rende il progetto da salvare", () => {
    const pagina: SynopticPage = {
      id: "si", name: "SystemInfo", objects: [
        { id: "tr", type: "trend", x: 0, y: 0, width: 300, height: 200, tag: "core.cpu0", extra_tags: ["core.cpu1"] },
      ],
    };
    useAppStore.setState({ project: null, pendingSections: {} });
    useAppStore.getState().setPages([pagina]);
    expect(selectIsDirty(useAppStore.getState())).toBe(true);
  });
});
