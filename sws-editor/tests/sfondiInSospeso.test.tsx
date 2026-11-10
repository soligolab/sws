/** Gli sfondi di una proposta dell'assistente, dopo «Applica» (10-11-2026).
 *
 *  Due difetti dello stesso collaudo: la pagina restava **senza sfondo** fino
 *  al Salva (le foto si caricano in `images/` solo lì), e dopo il Salva, nel
 *  cloud, lo sfondo **continuava a mancare** perché l'`<image>` aveva già preso
 *  un 404 e nessuno richiedeva più lo stesso URL. */
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", async (orig) => {
  const vero = await orig<typeof import("@/api/client")>();
  return {
    ...vero,
    api: {
      ...vero.api,
      getProjectFingerprint: vi.fn(async () => ({ sha256: "IMPRONTA", computed_at_ms: 0 })),
      saveSynoptic: vi.fn(async () => {}),
      updateFunctions: vi.fn(async () => {}),
      uploadProjectImage: vi.fn(async (name: string) => ({ name, url: `/api/project/images/${name}` })),
      compilaSimboli: vi.fn(async () => []),
    },
  };
});

import i18n from "@/i18n";
import { api, setAuthToken } from "@/api/client";
import { useAppStore, type AiProposta } from "@/store";
import { ImmagineSvg } from "@/canvas/ImmagineSvg";
import { azzeraImmaginiInSospeso, immagineInSospeso } from "@/canvas/immaginiInSospeso";
import { riassumi } from "@/ai/riassunto";
import type { ProjectInfo, SynopticPage } from "@/types";

void i18n.changeLanguage("it");

const HREF = "/api/project/images/ai-sfondo-1.jpg";
const JPG = btoa("finto jpeg");
const PAGINA: SynopticPage = { id: "pg1", name: "Lago", objects: [] };
const PROGETTO = { meta: { name: "prova", version: "1" }, tags: [], sources: [], alarms: [] } as unknown as ProjectInfo;

function proposta(): AiProposta {
  return {
    id: "p-sfondi", motivo: "lago con lo sfondo", impronta: "IMPRONTA", project: null,
    pages: [{ ...PAGINA, objects: [{ id: "fondo", type: "image", x: 0, y: 0, width: 100, height: 60, src: HREF }] }],
    sfondi: [{ file: "ai-sfondo-1.jpg", jpg: JPG }],
  };
}

/** L'href che l'oggetto image della pagina disegna adesso. */
function disegnato(): string | null {
  const { container, unmount } = render(<svg><ImmagineSvg href={HREF} /></svg>);
  const h = container.querySelector("image")?.getAttribute("href") ?? null;
  unmount();
  return h;
}

const chiamate: string[] = [];
let sulServer = false;

beforeEach(() => {
  azzeraImmaginiInSospeso();
  vi.clearAllMocks();
  chiamate.length = 0;
  sulServer = false;
  useAppStore.setState({
    project: structuredClone(PROGETTO), pages: [structuredClone(PAGINA)], currentPageId: "pg1",
    past: [], future: [], pagesRev: 0, savedPagesRev: 0, persistedPageNames: ["Lago"],
    pendingSections: {}, authRole: "Admin",
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    chiamate.push(String(url));
    return sulServer
      ? new Response(new Blob(["x"], { type: "image/jpeg" }), { status: 200 })
      : new Response("no", { status: 404 });
  }));
  let n = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:foto-${++n}`, revokeObjectURL: () => {} }));
});

afterEach(() => {
  setAuthToken(null);
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("gli sfondi di una proposta si vedono subito", () => {
  it("dopo Applica l'oggetto image disegna la foto in memoria, senza chiedere il server", async () => {
    await useAppStore.getState().applyAiProposal(proposta());
    expect(disegnato()).toBe(`data:image/jpeg;base64,${JPG}`);
    expect(chiamate).toEqual([]);
  });

  it("Ctrl+Z la toglie, e Ctrl+Y la rifà tornare", async () => {
    await useAppStore.getState().applyAiProposal(proposta());
    act(() => useAppStore.getState().undo());
    expect(immagineInSospeso(HREF)).toBeUndefined();
    act(() => useAppStore.getState().redo());
    expect(immagineInSospeso(HREF)).toBe(`data:image/jpeg;base64,${JPG}`);
  });

  it("dopo il Salva si usa il file del server, con un URL nuovo", async () => {
    await useAppStore.getState().applyAiProposal(proposta());
    sulServer = true;
    await useAppStore.getState().saveAll();
    expect(api.uploadProjectImage).toHaveBeenCalledWith("ai-sfondo-1.jpg", expect.any(Blob));
    expect(immagineInSospeso(HREF)).toBeUndefined();
    expect(disegnato()).toMatch(/^\/api\/project\/images\/ai-sfondo-1\.jpg\?v=\d+$/);
  });

  it("nel cloud, un'immagine che aveva preso 404 si richiede dopo il Salva", async () => {
    window.history.replaceState({}, "", "/p/-/CasaDomotica/");
    setAuthToken("tok");
    // L'oggetto image è già sul canvas e chiede il file prima che ci sia.
    const { container } = render(<svg><ImmagineSvg href={HREF} /></svg>);
    await waitFor(() => expect(chiamate).toHaveLength(1));
    expect(container.querySelector("image")).toBeNull();

    await act(async () => { await useAppStore.getState().applyAiProposal(proposta()); });
    await waitFor(() => expect(container.querySelector("image")?.getAttribute("href"))
      .toBe(`data:image/jpeg;base64,${JPG}`));

    sulServer = true;
    await act(async () => { await useAppStore.getState().saveAll(); });
    await waitFor(() => expect(container.querySelector("image")?.getAttribute("href")).toMatch(/^blob:foto-/));
    expect(chiamate.filter((u) => u.includes("ai-sfondo-1")).at(-1)).toMatch(/^\/p\/-\/CasaDomotica\/api\/project\/images\/ai-sfondo-1\.jpg\?v=\d+$/);
  });

  it("il diff ha una voce per ogni foto", () => {
    const p = proposta();
    const diff = riassumi(null, p.pages ?? null, PROGETTO, [PAGINA], null, p.sfondi);
    expect(diff.map((v) => `${v.verso} ${v.testo}`)).toContain("+ immagine images/ai-sfondo-1.jpg");
  });
});
