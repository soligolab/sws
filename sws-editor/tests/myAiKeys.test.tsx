/** The user's own AI keys (15-11-2026): the window of the user menu, and the
 *  line in «Providers and keys» that says which key the project uses. */
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/i18n";
import { api } from "../src/api/client";
import { sulGateway } from "../src/api/client";
import { MyAiKeys } from "../src/components/MyAiKeys";
import type { MyAiKey } from "../src/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the user's AI keys", () => {
  it("their calls go to the gateway, not to the project's container", () => {
    expect(sulGateway("/api/identity/ai-keys")).toBe(true);
    expect(sulGateway("/api/identity/ai-keys/kimi")).toBe(true);
    // The project's own keys stay with the project.
    expect(sulGateway("/api/ai/chiavi")).toBe(false);
  });

  it("lists, saves, and removes with a second tap; the value is never shown again", async () => {
    let keys: MyAiKey[] = [{ provider: "anthropic", last4: "1234", readable: true }];
    vi.spyOn(api, "getMyAiKeys").mockImplementation(async () => keys);
    const put = vi.spyOn(api, "putMyAiKey").mockImplementation(async (p, k) => {
      keys = [...keys.filter((x) => x.provider !== p), { provider: p, last4: k.slice(-4), readable: true }];
    });
    const del = vi.spyOn(api, "deleteMyAiKey").mockImplementation(async (p) => {
      keys = keys.filter((x) => x.provider !== p);
    });
    render(<MyAiKeys onClose={() => {}} />);
    // The one saved shows its last four letters, the other has nothing yet.
    expect((await screen.findByTestId("my-ai-key-anthropic-state")).textContent).toContain("1234");
    expect(screen.queryByTestId("my-ai-key-kimi-state")).toBeNull();

    // Nothing to save until something is typed.
    const save = screen.getByTestId("my-ai-key-kimi-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("my-ai-key-kimi-input"), { target: { value: "  sk-kimi-segretissima-7777  " } });
    await act(async () => { fireEvent.click(save); });
    expect(put).toHaveBeenCalledWith("kimi", "sk-kimi-segretissima-7777");
    expect((await screen.findByTestId("my-ai-key-kimi-state")).textContent).toContain("7777");
    // The key typed is gone from the field, and the value is nowhere on the page.
    expect((screen.getByTestId("my-ai-key-kimi-input") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain("segretissima");

    // Removing asks for a second tap on the same button.
    await act(async () => { fireEvent.click(screen.getByTestId("my-ai-key-anthropic-remove")); });
    expect(del).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByTestId("my-ai-key-anthropic-confirm")); });
    expect(del).toHaveBeenCalledWith("anthropic");
    expect(screen.queryByTestId("my-ai-key-anthropic-state")).toBeNull();
  });

  it("has every provider, tests the key and offers its models in alphabetical order", async () => {
    let keys: MyAiKey[] = [{ provider: "kimi", last4: "1234", readable: true, model: null }];
    vi.spyOn(api, "getMyAiKeys").mockImplementation(async () => keys);
    vi.spyOn(api, "testMyAiKey").mockResolvedValue({ ok: true, models: ["kimi-latest", "kimi-k2", "moonshot-v1"] });
    const put = vi.spyOn(api, "putMyAiModel").mockImplementation(async (p, m) => {
      keys = keys.map((k) => (k.provider === p ? { ...k, model: m } : k));
    });
    render(<MyAiKeys onClose={() => {}} />);
    for (const p of ["anthropic", "kimi", "mistral", "openai"]) expect(await screen.findByTestId(`my-ai-key-${p}`)).toBeTruthy();
    // Mistral (16-11-2026) has a name of its own, not the bare key of the language file.
    expect(screen.getByTestId("my-ai-key-mistral").textContent).toContain("Mistral AI");
    // Only a provider with a key can be tested.
    expect(screen.queryByTestId("my-ai-key-openai-test")).toBeNull();
    const select = await screen.findByTestId("my-ai-key-kimi-model") as HTMLSelectElement;
    await vi.waitFor(() => expect(select.options.length).toBe(4));
    expect([...select.options].map((o) => o.value)).toEqual(["", "kimi-k2", "kimi-latest", "moonshot-v1"]);
    await act(async () => { fireEvent.change(select, { target: { value: "kimi-k2" } }); });
    expect(put).toHaveBeenCalledWith("kimi", "kimi-k2");
    await act(async () => { fireEvent.click(screen.getByTestId("my-ai-key-kimi-test")); });
    expect((await screen.findByTestId("my-ai-key-kimi-test-result")).textContent).toMatch(/3/);
  });

  it("a key that no longer reads (after a restore) says it has to be written again", async () => {
    vi.spyOn(api, "getMyAiKeys").mockResolvedValue([{ provider: "kimi", last4: "0001", readable: false }]);
    render(<MyAiKeys onClose={() => {}} />);
    expect((await screen.findByTestId("my-ai-key-kimi-state")).textContent).toMatch(/riscrivila|write it again/);
  });

  it("an error of the gateway is shown, not swallowed", async () => {
    vi.spyOn(api, "getMyAiKeys").mockResolvedValue([]);
    vi.spyOn(api, "putMyAiKey").mockRejectedValue(new Error("the key is empty, too long or has spaces in it"));
    render(<MyAiKeys onClose={() => {}} />);
    await screen.findByTestId("my-ai-key-kimi-input");
    fireEvent.change(screen.getByTestId("my-ai-key-kimi-input"), { target: { value: "due parole" } });
    await act(async () => { fireEvent.click(screen.getByTestId("my-ai-key-kimi-save")); });
    expect((await screen.findByRole("alert")).textContent).toMatch(/spaces/);
  });
});
