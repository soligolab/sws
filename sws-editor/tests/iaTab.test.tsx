import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import "../src/i18n";

const { getAiConfig, getAiSpending, putAiScopi, updateProjectAi, provaAiChiave, putAiLocal } = vi.hoisted(() => ({
  getAiConfig: vi.fn(),
  getAiSpending: vi.fn(),
  putAiScopi: vi.fn(async (_scopi: unknown) => ({ ok: true, riconnetti: true })),
  updateProjectAi: vi.fn(async (_regole: unknown) => {}),
  provaAiChiave: vi.fn(async (_fornitore: string, _local?: unknown): Promise<{ ok: boolean; modelli?: string[]; errore?: string }> =>
    ({ ok: false, errore: "no" })),
  putAiLocal: vi.fn(async (_local: unknown) => ({ ok: true, riconnetti: true })),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, getAiConfig, getAiSpending, putAiScopi, updateProjectAi, provaAiChiave, putAiLocal } };
});

import { IaAssistenteTab, IaFornitoriTab, IaRegoleTab, IaScopiTab, IaSpendingTab, formatUsd } from "../src/config/schede/IaTab";
import { registraComandiChat } from "../src/ai/comandiChat";
import { useAppStore } from "../src/store";
import type { AiConfig, AiSpending, ProjectInfo } from "../src/types";
import i18n from "../src/i18n";
import { AI_PROVIDERS } from "../src/ai/providers";
import { SCHEDE } from "../src/config/schede";

const vuoto = { salvato: null, attivo: true, eredita: false,
                effettivo: { fornitore: "anthropic", modello: "claude-opus-5-5", tetto_usd: 10 } };
const CFG: AiConfig = {
  fornitori: [
    { id: "anthropic", nome: "Anthropic (Claude)", scopi: ["assistente", "simboli", "traduzione", "fields"], chiave: true, modello_default: "claude-opus-5-5" },
    { id: "kimi", nome: "Moonshot (Kimi)", scopi: ["assistente", "simboli", "traduzione", "fields"], chiave: false, modello_default: "kimi-k3" },
    { id: "mistral", nome: "Mistral AI", scopi: ["assistente", "simboli", "traduzione", "fields"], chiave: false, modello_default: "mistral-large-latest" },
    { id: "local", nome: "Local model (OpenAI-compatible)", scopi: ["assistente", "simboli", "traduzione", "fields"], chiave: false, modello_default: "" },
    { id: "openai", nome: "OpenAI (immagini)", scopi: ["sfondi"], chiave: false, modello_default: "gpt-image-2" },
    { id: "bfl", nome: "Black Forest Labs (FLUX)", scopi: ["sfondi"], chiave: false, modello_default: "flux-2-pro" },
  ],
  scopi: {
    assistente: vuoto,
    simboli: { ...vuoto, eredita: true },
    traduzione: { ...vuoto, eredita: true },
    fields: { ...vuoto, eredita: true },
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

  it("gli sfondi offrono solo i fornitori di immagini, l'assistente solo i modelli di testo", async () => {
    await i18n.changeLanguage("it");
    render(<IaScopiTab />);
    const sfondi = await screen.findByTestId("ia-scopo-sfondi-fornitore") as HTMLSelectElement;
    expect([...sfondi.options].map((o) => o.value)).toEqual(["openai", "bfl"]);
    const ass = screen.getByTestId("ia-scopo-assistente-fornitore") as HTMLSelectElement;
    expect([...ass.options].map((o) => o.value)).toEqual(["anthropic", "kimi", "mistral", "local"]);
    // The local model's name comes from the language files, not from the runtime's English.
    expect(ass.options[3].textContent).toContain("Modello in casa");
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

  it("backgrounds can be made with FLUX: the provider is saved, and the quality is OpenAI's alone", async () => {
    render(<IaScopiTab />);
    const sel = await screen.findByTestId("ia-scopo-sfondi-fornitore") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "openai" } });
    expect(screen.getByTestId("ia-scopo-sfondi-qualita")).toBeTruthy();
    fireEvent.change(sel, { target: { value: "bfl" } });
    expect(screen.queryByTestId("ia-scopo-sfondi-qualita")).toBeNull();
    fireEvent.click(screen.getByTestId("ia-scopi-salva"));
    await waitFor(() => expect(putAiScopi).toHaveBeenCalled());
    const scopi = putAiScopi.mock.calls[0][0] as Record<string, { fornitore?: string; modello?: string } | null>;
    expect(scopi.sfondi?.fornitore).toBe("bfl");
    // Changing provider drops the model of the old one.
    expect(scopi.sfondi?.modello).toBeUndefined();
  });

  it("every provider of the menu has a name in both languages, FLUX too", () => {
    expect(AI_PROVIDERS).toContain("bfl");
    for (const lang of ["it", "en"]) {
      for (const id of AI_PROVIDERS) {
        expect(i18n.exists(`aiProviders.${id}`, { lng: lang }), `${lang} ${id}`).toBe(true);
      }
    }
  });
});

/** The local model and the account's preference (plan 2026-11-17-ia-a-scelta-del-cliente, F5). */
describe("the local model and the account's preference", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    getAiConfig.mockResolvedValue(structuredClone(CFG));
    useAppStore.setState({ authRole: "Admin" });
    await i18n.changeLanguage("it");
  });

  it("the local card tests the typed address, offers its models, and saves address, model and images", async () => {
    render(<IaFornitoriTab />);
    const url = await screen.findByTestId("ia-url-local") as HTMLInputElement;
    expect(url.placeholder).toBe("http://localhost:11434/v1");
    // Nothing to save or test without an address; no model, nothing to save.
    expect((screen.getByTestId("ia-prova-local") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(url, { target: { value: " http://gpu-box:11434/v1 " } });
    expect((screen.getByTestId("ia-salva-local") as HTMLButtonElement).disabled).toBe(true);
    // The optional key is a password field like every other key.
    expect((screen.getByTestId("ia-chiave-local") as HTMLInputElement).type).toBe("password");
    fireEvent.change(screen.getByTestId("ia-chiave-local"), { target: { value: "vllm-secret" } });

    provaAiChiave.mockResolvedValueOnce({ ok: true, modelli: ["qwen3:8b", "llama3.3:70b"] });
    fireEvent.click(screen.getByTestId("ia-prova-local"));
    await waitFor(() => expect(provaAiChiave).toHaveBeenCalledWith("local", { url: "http://gpu-box:11434/v1", chiave: "vllm-secret" }));
    const model = screen.getByTestId("ia-modello-local") as HTMLSelectElement;
    await waitFor(() => expect([...model.options].map((o) => o.value)).toEqual(["", "llama3.3:70b", "qwen3:8b"]));
    expect(document.body.textContent).toContain("2 modelli");
    fireEvent.change(model, { target: { value: "qwen3:8b" } });

    // The images box is off by default.
    const images = screen.getByTestId("ia-immagini-local") as HTMLInputElement;
    expect(images.checked).toBe(false);
    fireEvent.click(images);
    fireEvent.click(screen.getByTestId("ia-salva-local"));
    await waitFor(() => expect(putAiLocal).toHaveBeenCalledWith({
      url: "http://gpu-box:11434/v1", model: "qwen3:8b", key: "vllm-secret", sees_images: true,
    }));
    // The menu is read again, and the key typed is gone from the field.
    await waitFor(() => expect(getAiConfig).toHaveBeenCalledTimes(2));
    expect((screen.getByTestId("ia-chiave-local") as HTMLInputElement).value).toBe("");
  });

  it("a saved local model shows what was saved, keeps its key unless a new one is typed, and is removed with a second tap", async () => {
    const c = structuredClone(CFG);
    c.fornitori = c.fornitori.map((f) => (f.id === "local" ? { ...f, chiave: true, source: "project" as const } : f));
    c.local = { url: "http://10.0.0.5:8000/v1", model: "qwen3-coder", sees_images: false, has_key: true };
    getAiConfig.mockResolvedValue(c);
    render(<IaFornitoriTab />);
    expect((await screen.findByTestId("ia-url-local") as HTMLInputElement).value).toBe("http://10.0.0.5:8000/v1");
    expect((screen.getByTestId("ia-modello-local") as HTMLSelectElement).value).toBe("qwen3-coder");
    expect((screen.getByTestId("ia-chiave-local") as HTMLInputElement).placeholder).toMatch(/vuoto/i);
    fireEvent.click(screen.getByTestId("ia-salva-local"));
    await waitFor(() => expect(putAiLocal).toHaveBeenCalledWith({
      url: "http://10.0.0.5:8000/v1", model: "qwen3-coder", key: undefined, sees_images: false,
    }));
    putAiLocal.mockClear();
    fireEvent.click(screen.getByTestId("ia-togli-local"));
    expect(putAiLocal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("ia-conferma-togli-local"));
    await waitFor(() => expect(putAiLocal).toHaveBeenCalledWith({ url: "", model: "", sees_images: false }));
  });

  it("a server that does not answer says why", async () => {
    render(<IaFornitoriTab />);
    fireEvent.change(await screen.findByTestId("ia-url-local"), { target: { value: "http://nowhere:1/v1" } });
    provaAiChiave.mockResolvedValueOnce({ ok: false, errore: "connection refused" });
    fireEvent.click(screen.getByTestId("ia-prova-local"));
    await waitFor(() => expect(document.body.textContent).toContain("connection refused"));
  });

  it("where the project chose none, the rows say the account's preference counts, or that it has no key", async () => {
    const c = structuredClone(CFG);
    c.preferito_account = { testo: "anthropic", immagini: "bfl" };
    c.scopi.sfondi = { salvato: null, attivo: true, eredita: false,
                       effettivo: { fornitore: "openai", modello: "gpt-image-2", tetto_usd: 1 } };
    getAiConfig.mockResolvedValue(c);
    render(<IaScopiTab />);
    expect((await screen.findByTestId("ia-scopo-assistente-preferenza")).textContent)
      .toBe("Il progetto non ha scelto: vale la preferenza del tuo account (Anthropic (Claude)).");
    expect(screen.getByTestId("ia-scopo-sfondi-preferenza").textContent).toMatch(/Black Forest Labs.*non ha una chiave: si usa OpenAI/);
    // Symbols and translation follow the assistant: no note of their own.
    expect(screen.queryByTestId("ia-scopo-simboli-preferenza")).toBeNull();
  });

  it("a choice of the project wins over the preference, and without a preference there is no note", async () => {
    const c = structuredClone(CFG);
    c.preferito_account = { testo: "mistral", immagini: null };
    c.scopi.assistente = { ...c.scopi.assistente, salvato: { fornitore: "anthropic" } };
    getAiConfig.mockResolvedValue(c);
    render(<IaScopiTab />);
    await screen.findByTestId("ia-scopo-assistente-fornitore");
    expect(screen.queryByTestId("ia-scopo-assistente-preferenza")).toBeNull();
    expect(screen.queryByTestId("ia-scopo-sfondi-preferenza")).toBeNull();
  });

  // Review of 17-11-2026: with a preference, `effettivo` is the provider of
  // whoever opens the menu; changing only the cap wrote it into the project.
  it("where the account decides, the row follows it and changing the cap writes no provider", async () => {
    const c = structuredClone(CFG);
    c.preferito_account = { testo: "mistral", immagini: null };
    c.fornitori = c.fornitori.map((f) => (f.id === "mistral" ? { ...f, chiave: true, source: "user" as const } : f));
    c.scopi.assistente.effettivo = { fornitore: "mistral", modello: "mistral-large-latest", tetto_usd: 10 };
    getAiConfig.mockResolvedValue(c);
    await i18n.changeLanguage("it");
    render(<IaScopiTab />);
    const sel = await screen.findByTestId("ia-scopo-assistente-fornitore") as HTMLSelectElement;
    expect(sel.value).toBe("");
    expect(sel.options[0].textContent).toBe("come preferisce l'account di chi lo usa");
    // Cap and model wait for a provider chosen on purpose.
    expect((screen.getByTestId("ia-scopo-assistente-tetto") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("ia-scopi-salva"));
    await waitFor(() => expect(putAiScopi).toHaveBeenCalled());
    expect((putAiScopi.mock.calls[0][0] as Record<string, unknown>).assistente).toBeNull();
    // Chosen on purpose, it is the project's.
    fireEvent.change(sel, { target: { value: "anthropic" } });
    fireEvent.change(screen.getByTestId("ia-scopo-assistente-tetto"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("ia-scopi-salva"));
    await waitFor(() => expect(putAiScopi).toHaveBeenCalledTimes(2));
    expect((putAiScopi.mock.calls[1][0] as Record<string, unknown>).assistente)
      .toEqual({ fornitore: "anthropic", modello: undefined, tetto_usd: 5 });
  });

  it("with the provider set by the environment, the account's preference is not what counts", async () => {
    const c = structuredClone(CFG);
    c.preferito_account = { testo: "mistral", immagini: null };
    c.da_ambiente = ["SWS_AI_FORNITORE"];
    getAiConfig.mockResolvedValue(c);
    render(<IaScopiTab />);
    await screen.findByTestId("ia-scopo-assistente-fornitore");
    expect(screen.queryByTestId("ia-scopo-assistente-preferenza")).toBeNull();
  });

  it("an address the cloud refuses is said in the IDE's language", async () => {
    await i18n.changeLanguage("it");
    render(<IaFornitoriTab />);
    fireEvent.change(await screen.findByTestId("ia-url-local"), { target: { value: "http://10.0.0.5/v1" } });
    // Saving: the code comes in the body of the 400.
    provaAiChiave.mockResolvedValueOnce({ ok: true, modelli: ["m"] });
    fireEvent.click(screen.getByTestId("ia-prova-local"));
    await waitFor(() => expect((screen.getByTestId("ia-modello-local") as HTMLSelectElement).value).toBe("m"));
    putAiLocal.mockRejectedValueOnce(new Error(
      'API /api/ai/local: 400 Bad Request — {"errore":"the address carries a user or a password","codice":{"id":"local_address_has_credentials"}}'));
    fireEvent.click(screen.getByTestId("ia-salva-local"));
    await waitFor(() => expect(document.body.textContent)
      .toContain("L'indirizzo contiene un utente o una password"));
    // Testing: the code comes with `ok: false`.
    provaAiChiave.mockResolvedValueOnce({ ok: false, errore: "address 10.0.0.5 is not public",
      codice: { id: "local_address_not_public", host: "10.0.0.5" } } as never);
    fireEvent.click(screen.getByTestId("ia-prova-local"));
    await waitFor(() => expect(document.body.textContent)
      .toContain("L'indirizzo 10.0.0.5 non è pubblico"));
  });

  it("the codes of the AI errors have a text in both languages", () => {
    for (const lang of ["it", "en"]) {
      for (const id of ["local_context_too_small", "local_address_not_public", "local_address_has_credentials"]) {
        expect(i18n.exists(`aiErrors.${id}`, { lng: lang }), `${lang} ${id}`).toBe(true);
      }
    }
  });

  it("provider names follow the IDE's language, and a free local model has no cap", async () => {
    await i18n.changeLanguage("en");
    const c = structuredClone(CFG);
    c.scopi.assistente.effettivo = { fornitore: "local", modello: "qwen3.5:9b", tetto_usd: 10 };
    c.scopi.simboli = { ...c.scopi.simboli, effettivo: { fornitore: "local", modello: "qwen3.5:9b", tetto_usd: 10 } };
    getAiConfig.mockResolvedValue(c);
    render(<IaScopiTab />);
    const sfondi = await screen.findByTestId("ia-scopo-sfondi-fornitore") as HTMLSelectElement;
    const names = Array.from(sfondi.options).map((o) => o.textContent ?? "");
    expect(names.some((n) => n.startsWith("OpenAI (images)"))).toBe(true);
    expect(names.some((n) => n.includes("immagini"))).toBe(false);
    // The green line says the name, not the id.
    expect(document.body.textContent).toContain("Will use Local model (OpenAI-compatible) · qwen3.5:9b");
    // Off the cloud the local model costs nothing: no cap, for it and for
    // the symbols that follow it; the backgrounds keep theirs.
    expect(screen.queryByTestId("ia-scopo-assistente-tetto")).toBeNull();
    expect(screen.getByTestId("ia-scopo-assistente-senza-tetto").textContent).toBe(i18n.t("ia.scopi.localFree"));
    expect(screen.queryByTestId("ia-scopo-simboli-tetto")).toBeNull();
    expect(screen.getByTestId("ia-scopo-sfondi-tetto")).toBeTruthy();
    await i18n.changeLanguage("it");
  });

  it("in the cloud a local model keeps its cap: it is counted as an estimate there", async () => {
    const c = structuredClone(CFG);
    c.in_cloud = true;
    c.scopi.assistente.effettivo = { fornitore: "local", modello: "qwen3.5:9b", tetto_usd: 10 };
    getAiConfig.mockResolvedValue(c);
    render(<IaScopiTab />);
    expect(await screen.findByTestId("ia-scopo-assistente-tetto")).toBeTruthy();
    expect(screen.queryByTestId("ia-scopo-assistente-senza-tetto")).toBeNull();
  });

  it("the local model has a name in both languages", () => {
    for (const lang of ["it", "en"]) expect(i18n.exists("aiProviders.local", { lng: lang }), lang).toBe(true);
  });
});

/** Configurazione → IA → Spesa (G5, 16-11-2026). */
describe("the Spesa tab", () => {
  const SPENDING: AiSpending = {
    current_month: "2026-11",
    months: [
      { month: "2026-11", usd: 1.84, calls: 5, rows: [
        { purpose: "sfondi", provider: "bfl", usd: 0.09, calls: 2 },
        { purpose: "assistente", provider: "anthropic", usd: 1.5, calls: 2 },
        { purpose: "traduzione", provider: "anthropic", usd: 0.25, calls: 1 },
      ] },
      { month: "2026-10", usd: 0, calls: 0, rows: [] },
      { month: "2026-09", usd: 2, calls: 5, rows: [{ purpose: "assistente", provider: "kimi", usd: 2, calls: 5 }] },
    ],
    total: { usd: 3.84, calls: 10 },
    kept_months: 36,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    getAiSpending.mockResolvedValue(structuredClone(SPENDING));
    useAppStore.setState({ authRole: "Admin" });
    await i18n.changeLanguage("it");
  });

  it("is a tab of the IA branch, next to providers and purposes", () => {
    const ids = SCHEDE.filter((s) => s.ramo === "ia").map((s) => s.id);
    expect(ids).toEqual(["ia_assistente", "ia_fornitori", "ia_scopi", "ia_spending", "ia_regole"]);
    for (const lang of ["it", "en"]) expect(i18n.exists("config.tabs.ia_spending", { lng: lang }), lang).toBe(true);
  });

  it("shows the current month and the previous ones, by purpose and provider, with the totals", async () => {
    render(<IaSpendingTab />);
    const current = await screen.findByTestId("ia-spending-month-2026-11");
    // The current month says so, with its name in the language of the IDE.
    expect(current.parentElement?.textContent).toMatch(/novembre 2026 \(in corso\)/);
    // Rows in the order of the menu: assistant, translation, backgrounds.
    const rows = [...current.querySelectorAll("tr[data-testid^='ia-spending-row-']")]
      .map((r) => r.getAttribute("data-testid"));
    expect(rows).toEqual([
      "ia-spending-row-2026-11-assistente-anthropic",
      "ia-spending-row-2026-11-traduzione-anthropic",
      "ia-spending-row-2026-11-sfondi-bfl",
    ]);
    const flux = screen.getByTestId("ia-spending-row-2026-11-sfondi-bfl").textContent ?? "";
    expect(flux).toContain("Sfondi");
    expect(flux).toContain("Black Forest Labs");
    expect(flux).toContain("0,09 $");
    // Two providers in the month: their sums, and the month's total.
    expect(screen.getByTestId("ia-spending-provider-2026-11-anthropic").textContent).toContain("1,75 $");
    expect(screen.getByTestId("ia-spending-provider-2026-11-bfl").textContent).toContain("0,09 $");
    expect(screen.getByTestId("ia-spending-month-total-2026-11").textContent).toBe("1,84 $");
    // A month with nothing spent says so; one with a single provider has no split.
    expect(screen.getByTestId("ia-spending-month-2026-10").textContent).toContain("Nessuna spesa");
    expect(screen.queryByTestId("ia-spending-provider-2026-09-kimi")).toBeNull();
    expect(screen.getByTestId("ia-spending-month-total-2026-09").textContent).toBe("2,00 $");
    expect(screen.getByTestId("ia-spending-total").textContent).toContain("3,84 $");
  });

  it("reads again on «Aggiorna», and is read-only", async () => {
    render(<IaSpendingTab />);
    await screen.findByTestId("ia-spending-month-2026-11");
    const next = structuredClone(SPENDING);
    next.months[0].rows[0] = { purpose: "sfondi", provider: "bfl", usd: 0.135, calls: 3 };
    getAiSpending.mockResolvedValue(next);
    fireEvent.click(screen.getByTestId("ia-spending-refresh"));
    await waitFor(() => expect(screen.getByTestId("ia-spending-row-2026-11-sfondi-bfl").textContent).toContain("0,135 $"));
    expect(getAiSpending).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll("input, select, textarea").length).toBe(0);
  });

  it("on a runtime that is not the IDE says so, and another error is shown as an error", async () => {
    getAiSpending.mockRejectedValue(new Error("API /api/ai/spending: 404 Not Found"));
    const { unmount } = render(<IaSpendingTab />);
    await waitFor(() => expect(document.body.textContent).toContain("si configura sull'IDE"));
    unmount();
    getAiSpending.mockRejectedValue(new Error("API /api/ai/spending: 500 Internal Server Error"));
    render(<IaSpendingTab />);
    await waitFor(() => expect(document.body.textContent).toContain("La spesa non si è potuta leggere"));
    expect(document.body.textContent).toContain("500");
  });

  it("is hidden from who is not an administrator", () => {
    useAppStore.setState({ authRole: "Operator" });
    const { container } = render(<IaSpendingTab />);
    expect(container.textContent).toBe("");
  });

  it("small amounts keep their digits", () => {
    expect(formatUsd(0, "it")).toBe("0,00 $");
    expect(formatUsd(0.0004, "it")).toBe("0,0004 $");
    expect(formatUsd(12.5, "en")).toBe("12.50 $");
  });
});
