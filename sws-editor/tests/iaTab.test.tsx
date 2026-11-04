import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import "../src/i18n";

const { getAiConfig, putAiScopi, updateProjectAi } = vi.hoisted(() => ({
  getAiConfig: vi.fn(),
  putAiScopi: vi.fn(async (_scopi: unknown) => ({ ok: true, riconnetti: true })),
  updateProjectAi: vi.fn(async (_regole: unknown) => {}),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, getAiConfig, putAiScopi, updateProjectAi } };
});

import { IaAssistenteTab, IaRegoleTab, IaScopiTab } from "../src/config/schede/IaTab";
import { registraComandiChat } from "../src/ai/comandiChat";
import { useAppStore } from "../src/store";
import type { AiConfig, ProjectInfo } from "../src/types";

const vuoto = { salvato: null, attivo: true, eredita: false,
                effettivo: { fornitore: "anthropic", modello: "claude-opus-5-5", tetto_usd: 10 } };
const CFG: AiConfig = {
  fornitori: [
    { id: "anthropic", nome: "Anthropic (Claude)", scopi: ["assistente", "simboli", "traduzione"], chiave: true, modello_default: "claude-opus-5-5" },
    { id: "kimi", nome: "Moonshot (Kimi)", scopi: ["assistente", "simboli", "traduzione"], chiave: false, modello_default: "kimi-k3" },
    { id: "openai", nome: "OpenAI (immagini)", scopi: ["sfondi"], chiave: false, modello_default: "gpt-image-2" },
  ],
  scopi: {
    assistente: vuoto,
    simboli: { ...vuoto, eredita: true },
    traduzione: { ...vuoto, eredita: true },
    sfondi: { salvato: null, attivo: false, eredita: false, effettivo: { fornitore: null, modello: null, tetto_usd: null } },
  },
  da_ambiente: [],
  tetto_usd_default: 10,
  tetto_sfondi_default: 1,
};

/** Il menù IA del pannello laterale (04-11-2026, piano un-modello-per-ogni-scopo). */
describe("il menù IA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiConfig.mockResolvedValue(structuredClone(CFG));
    useAppStore.setState({ authRole: "Admin" });
  });

  it("la traduzione può prendere un modello suo, e il Salva manda solo gli scopi", async () => {
    render(<IaScopiTab />);
    const sel = await screen.findByTestId("ia-scopo-traduzione-fornitore") as HTMLSelectElement;
    // Il valore vuoto è «come l'assistente».
    expect(sel.value).toBe("");
    fireEvent.change(sel, { target: { value: "anthropic" } });
    fireEvent.click(screen.getByTestId("ia-scopi-salva"));
    await waitFor(() => expect(putAiScopi).toHaveBeenCalled());
    const scopi = putAiScopi.mock.calls[0][0] as Record<string, { fornitore?: string } | null>;
    expect(scopi.traduzione?.fornitore).toBe("anthropic");
    expect(scopi.simboli).toBeNull();
    // Nessuna chiave viaggia con gli scopi.
    expect(JSON.stringify(scopi)).not.toMatch(/chiave|key/i);
  });

  it("gli sfondi offrono solo OpenAI, l'assistente solo i modelli di testo", async () => {
    render(<IaScopiTab />);
    const sfondi = await screen.findByTestId("ia-scopo-sfondi-fornitore") as HTMLSelectElement;
    expect([...sfondi.options].map((o) => o.value)).toEqual(["openai"]);
    const ass = screen.getByTestId("ia-scopo-assistente-fornitore") as HTMLSelectElement;
    expect([...ass.options].map((o) => o.value)).toEqual(["anthropic", "kimi"]);
  });

  it("la chat si apre da qui, non più dal menu ☰", async () => {
    const apri = vi.fn(); const stacca = vi.fn();
    registraComandiChat({ apri, stacca, aperta: false, staccata: false });
    render(<IaAssistenteTab />);
    fireEvent.click(await screen.findByTestId("ia-apri-chat"));
    fireEvent.click(screen.getByTestId("ia-stacca-chat"));
    expect(apri).toHaveBeenCalledTimes(1);
    expect(stacca).toHaveBeenCalledTimes(1);
    registraComandiChat(null);
  });

  it("le regole del progetto si salvano con il Salva, senza i campi vuoti", async () => {
    useAppStore.setState({
      project: { meta: { name: "prova", version: "1" }, tags: [], sources: [], alarms: [] } as unknown as ProjectInfo,
      pendingSections: {},
    });
    render(<IaRegoleTab />);
    fireEvent.change(screen.getByTestId("ia-regole-impianto"), { target: { value: "Fotovoltaico in montagna" } });
    fireEvent.change(screen.getByTestId("ia-regole-traduzione"), { target: { value: "marcia = run" } });
    fireEvent.change(screen.getByTestId("ia-regole-simboli"), { target: { value: "   " } });
    await waitFor(() => expect("ai" in useAppStore.getState().pendingSections).toBe(true));
    await useAppStore.getState().saveAll();
    expect(updateProjectAi).toHaveBeenCalledWith({
      impianto: "Fotovoltaico in montagna",
      regole: { traduzione: "marcia = run" },
    });
    expect(useAppStore.getState().project?.ai?.impianto).toBe("Fotovoltaico in montagna");
  });

  it("il tetto accetta i decimali mentre si scrive", async () => {
    render(<IaScopiTab />);
    const campo = await screen.findByTestId("ia-scopo-sfondi-tetto") as HTMLInputElement;
    // Gli sfondi senza chiave OpenAI hanno il campo spento: lo si accende scegliendo il fornitore.
    fireEvent.change(screen.getByTestId("ia-scopo-sfondi-fornitore"), { target: { value: "openai" } });
    for (const v of ["0", "0.", "0.5"]) fireEvent.change(campo, { target: { value: v } });
    expect(campo.value).toBe("0.5");
    fireEvent.click(screen.getByTestId("ia-scopi-salva"));
    await waitFor(() => expect(putAiScopi).toHaveBeenCalled());
    const scopi = putAiScopi.mock.calls[0][0] as Record<string, { tetto_usd?: number } | null>;
    expect(scopi.sfondi?.tetto_usd).toBe(0.5);
  });

  it("senza una scelta salvata l'assistente mostra il fornitore che usa davvero", async () => {
    const c = structuredClone(CFG);
    c.scopi.assistente.effettivo = { fornitore: "kimi", modello: "kimi-k3", tetto_usd: 10 };
    getAiConfig.mockResolvedValue(c);
    render(<IaScopiTab />);
    const sel = await screen.findByTestId("ia-scopo-assistente-fornitore") as HTMLSelectElement;
    expect(sel.value).toBe("kimi");
    fireEvent.change(screen.getByTestId("ia-scopo-assistente-tetto"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("ia-scopi-salva"));
    await waitFor(() => expect(putAiScopi).toHaveBeenCalled());
    const scopi = putAiScopi.mock.calls[0][0] as Record<string, { fornitore?: string } | null>;
    expect(scopi.assistente?.fornitore).toBe("kimi");
  });
});
