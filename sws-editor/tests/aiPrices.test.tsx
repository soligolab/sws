/** Console → AI prices (plan 2026-11-17-ia-a-scelta-del-cliente, F2): the
 *  prices in effect read-only, the manual rows as JSON saved by a button. */
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import i18n from "../src/i18n";
import { api, RuntimeUnavailableError } from "../src/api/client";
import { AiPrices } from "../src/console/AiPrices";
import { Console } from "../src/console/Console";
import { useAppStore } from "../src/store";
import type { AiPriceList } from "../src/types";

const LIST: AiPriceList = {
  version: 1,
  at_ms: Date.UTC(2026, 10, 17, 6, 0),
  source: "https://models.dev/api.json",
  last_error: null,
  models: {
    anthropic: {
      "claude-haiku-5-5": {
        input: 1, output: 5, cache_read: 0.1, cache_write: 1.25, origin: "models.dev",
        tiers: [
          { above_tokens: 100000, input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
          { above_tokens: 1000000, input: 4, output: 20, cache_read: 0.4, cache_write: 5 },
        ],
      },
    },
    mistral: { "mistral-large-latest": { input: 0.5, output: 1.5, cache_read: 0.05, cache_write: 0.625, origin: "manual" } },
    kimi: { "kimi-k3": { input: 0.6, output: 2.5, cache_read: 0.15, cache_write: 0.6, origin: "builtin" } },
  },
  images: { openai: { low: 0.011, medium: 0.042, high: 0.167 }, bfl: { "flux-2-pro": { first: 0.03, next: 0.015, input: 0.015 } } },
};
const MANUAL = { models: { mistral: { "mistral-large-latest": { input: 0.5, output: 1.5 } } } };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(async () => { await i18n.changeLanguage("it"); });

describe("the AI prices tab of the console", () => {
  it("lists the prices in effect with their origin, the tiers and the images, read-only", async () => {
    vi.spyOn(api, "getAiPrices").mockResolvedValue({ resolved: structuredClone(LIST), manual: MANUAL });
    render(<AiPrices />);
    const haiku = await screen.findByTestId("ai-price-anthropic-claude-haiku-5-5");
    expect(haiku.textContent).toContain("Anthropic (Claude)");
    expect(haiku.textContent).toContain("1,25");
    expect(haiku.textContent).toContain("models.dev");
    expect(screen.getByTestId("ai-price-anthropic-claude-haiku-5-5-tier-100000").textContent).toMatch(/oltre 100\.000 token/);
    // Every tier, not only the first.
    expect(screen.getByTestId("ai-price-anthropic-claude-haiku-5-5-tier-1000000").textContent).toMatch(/oltre 1\.000\.000 token/);
    expect(screen.getByTestId("ai-price-mistral-mistral-large-latest").textContent).toContain("a mano");
    expect(screen.getByTestId("ai-price-kimi-kimi-k3").textContent).toContain("interno");
    expect(screen.getByTestId("ai-price-image-openai-high").textContent).toContain("0,167 $ a immagine");
    expect(screen.getByTestId("ai-price-image-bfl-flux-2-pro").textContent).toContain("0,03 $ il primo megapixel");
    expect(screen.getByTestId("ai-prices-updated").textContent).toContain("2026");
    // The only field is the text of the manual rows, holding them as written.
    expect(document.querySelectorAll("input, select").length).toBe(0);
    expect(JSON.parse((screen.getByTestId("ai-prices-manual") as HTMLTextAreaElement).value)).toEqual(MANUAL);
  });

  it("saves the JSON only with the button, and shows the prices the server resolved", async () => {
    vi.spyOn(api, "getAiPrices").mockResolvedValue({ resolved: structuredClone(LIST), manual: {} });
    const after = structuredClone(LIST);
    after.models.kimi["kimi-k3"] = { input: 0.7, output: 2.8, cache_read: 0.7, cache_write: 0.7, origin: "manual" };
    const put = vi.spyOn(api, "putAiPrices").mockResolvedValue(after);
    render(<AiPrices />);
    const text = await screen.findByTestId("ai-prices-manual") as HTMLTextAreaElement;
    expect(text.value).toBe("");
    const rows = { models: { kimi: { "kimi-k3": { input: 0.7, output: 2.8 } } } };
    fireEvent.change(text, { target: { value: JSON.stringify(rows) } });
    expect(put).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByTestId("ai-prices-save")); });
    expect(put).toHaveBeenCalledWith(rows);
    expect(screen.getByTestId("ai-prices-saved")).toBeTruthy();
    expect(screen.getByTestId("ai-price-kimi-kimi-k3").textContent).toContain("a mano");
  });

  it("text that is not JSON is not sent; a price the server refuses shows its reason", async () => {
    vi.spyOn(api, "getAiPrices").mockResolvedValue({ resolved: structuredClone(LIST), manual: {} });
    const put = vi.spyOn(api, "putAiPrices").mockRejectedValue(new Error(
      'API /api/amministrazione/ai-prices: 400 Bad Request — {"error":"ai_prices_invalid","detail":"mistral/mistral-large-latest.input: 0 is not a price above zero"}'));
    render(<AiPrices />);
    const text = await screen.findByTestId("ai-prices-manual");
    fireEvent.change(text, { target: { value: "{ models: " } });
    await act(async () => { fireEvent.click(screen.getByTestId("ai-prices-save")); });
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByTestId("ai-prices-save-error").textContent).toMatch(/non è JSON valido/);

    fireEvent.change(text, { target: { value: '{"models":{"mistral":{"mistral-large-latest":{"input":0,"output":1}}}}' } });
    await act(async () => { fireEvent.click(screen.getByTestId("ai-prices-save")); });
    expect(screen.getByTestId("ai-prices-save-error").textContent)
      .toBe("mistral/mistral-large-latest.input: 0 is not a price above zero");
    expect(screen.queryByTestId("ai-prices-saved")).toBeNull();
  });

  it("«Update now» downloads again; a failed download shows the reason the server wrote", async () => {
    const get = vi.spyOn(api, "getAiPrices").mockResolvedValue({ resolved: { ...structuredClone(LIST), at_ms: null }, manual: {} });
    const refresh = vi.spyOn(api, "refreshAiPrices").mockResolvedValue(structuredClone(LIST));
    render(<AiPrices />);
    expect((await screen.findByTestId("ai-prices-updated")).textContent).toMatch(/Mai scaricati/);
    await act(async () => { fireEvent.click(screen.getByTestId("ai-prices-refresh")); });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("ai-prices-updated").textContent).toMatch(/Aggiornati da models.dev/);

    // The server answers 502 to a failed download: the client reads it as
    // «unreachable», and the tab reads the file again for the reason.
    refresh.mockRejectedValue(new RuntimeUnavailableError());
    get.mockResolvedValue({ resolved: { ...structuredClone(LIST), last_error: "https://models.dev/api.json answered 503" }, manual: {} });
    await act(async () => { fireEvent.click(screen.getByTestId("ai-prices-refresh")); });
    await waitFor(() => expect(screen.getByTestId("ai-prices-last-error").textContent).toContain("answered 503"));
    expect(document.body.textContent).toContain("i prezzi sono rimasti quelli di prima");
  });
});

/** The tab is the platform's, and only in the cloud: a panel or a local IDE
 *  keeps its list up to date by itself and nobody edits it. */
describe("the AI prices tab in the console", () => {
  async function renderConsole(platform: boolean, gateway: boolean) {
    vi.spyOn(api, "amministrazioneAziende").mockResolvedValue([] as never);
    vi.spyOn(api, "amministrazioneRisorse").mockResolvedValue({ aziende: [] } as never);
    vi.spyOn(api, "whoami").mockResolvedValue({ amministratore_piattaforma: platform } as never);
    vi.spyOn(api, "identitaStato").mockResolvedValue({ gateway } as never);
    vi.spyOn(api, "getAiPrices").mockResolvedValue({ resolved: structuredClone(LIST), manual: {} });
    useAppStore.setState({ authToken: "tok" });
    render(<Console />);
    await screen.findByText("Risorse", { selector: "nav button" });
    // whoami and the gateway answer after the first paint.
    await act(async () => {});
  }

  it("shows to a platform admin in the cloud, and opens the prices", async () => {
    await renderConsole(true, true);
    fireEvent.click(await screen.findByText("Prezzi IA", { selector: "nav button" }));
    expect(await screen.findByTestId("ai-prices-models")).toBeTruthy();
  });

  it("is not there on a local IDE, nor for a company admin", async () => {
    await renderConsole(true, false);
    // The platform's tabs are there: the answer has arrived.
    await screen.findByText("Posta", { selector: "nav button" });
    expect(screen.queryByText("Prezzi IA", { selector: "nav button" })).toBeNull();
    cleanup(); vi.restoreAllMocks();
    await renderConsole(false, true);
    await waitFor(() => expect(api.whoami).toHaveBeenCalled());
    expect(screen.queryByText("Prezzi IA", { selector: "nav button" })).toBeNull();
  });
});
