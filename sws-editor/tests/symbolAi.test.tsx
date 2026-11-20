/** The «IA» tab of the symbol editor (plan docs/plans/2026-11-19-assistente-ia-simboli.md):
 *  what it sends, the proposal next to the symbol, «Accetta» as a step Ctrl+Z
 *  takes back, «Scarta», the retouch that starts from the proposal, the errors. */
import { render, act, fireEvent, waitFor, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n/index";
import { api, type SymbolAiRequest, type SymbolAiResult } from "../src/api/client";
import { useAppStore } from "../src/store";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import { SymbolEditorHost } from "../src/symbols/editor/SymbolEditor";
import { openNewSymbol } from "../src/symbols/editor/open";
import type { DescrizioneSimbolo } from "../src/types";

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "../public/symbols/lib/manifest.json"), "utf8"),
) as ManifestLib;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <defs>
  </defs>
  <g id="body" data-layer="part" data-mat="body-pump" fill="#2f6fa8">
    <rect x="20" y="20" width="60" height="60" data-op="1"/>
  </g>
</svg>
`;

function voce(d: DescrizioneSimbolo) {
  return {
    id: `prj:${d.slug}`, file: `prj/${d.slug}.svg`, family: "project", kind: "project", label: d.it,
    viewBox: [d.w, d.h], body: d.body, materials: [], parts: [], labels: { it: d.it, en: d.en },
  } as never;
}

/** A proposal of the model: the drawing with `n` rectangles, under another name. */
function proposal(n: number, extra: Partial<SymbolAiResult> = {}): SymbolAiResult {
  const description: DescrizioneSimbolo = {
    slug: "renamed", w: 120, h: 80, body: "body-pump", it: "Altro", en: "Other",
    ops: [{ op: "corpo" }, ...Array.from({ length: n }, (_, i) => ({ op: "forma", tag: "rect", geo: { x: i, y: 0, width: 10, height: 10 } }))],
  } as DescrizioneSimbolo;
  return { ok: true, description, svg: SVG, voce: voce(description), attempts: 2, cost_usd: 0, model: "qwen3.5:9b", ...extra } as SymbolAiResult;
}

/** The description the editor compiled last: what it has now. */
function editorNow(): DescrizioneSimbolo {
  const calls = vi.mocked(api.compilaSimboli).mock.calls;
  return calls[calls.length - 1][0][0];
}

describe("the AI tab of the symbol editor", () => {
  let asked: SymbolAiRequest[] = [];
  beforeEach(() => {
    asked = [];
    impostaLibreriaPerTest(manifest, {});
    vi.spyOn(api, "compilaSimboli").mockImplementation(async (ds) => ds.map((d) => ({ slug: d.slug, ok: true, errori: [], svg: SVG, voce: voce(d) })));
    vi.spyOn(api, "symbolCatalog").mockResolvedValue({ materials: [], veils: [] });
    act(() => {
      useAppStore.getState().setProject({ name: "p", tags: [], simboli: [] } as never);
      useAppStore.getState().closeSymbolEditor();
    });
  });
  afterEach(() => { vi.restoreAllMocks(); act(() => useAppStore.getState().closeSymbolEditor()); });

  async function openTab(answers: SymbolAiResult[]) {
    vi.spyOn(api, "symbolAi").mockImplementation(async (req) => { asked.push(req); return answers.shift()!; });
    act(() => openNewSymbol());
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("symbol-tab-ai"));
  }

  it("draws a new symbol, shows it next to the open one, and «Accetta» is a step Ctrl+Z takes back", async () => {
    await openTab([proposal(3)]);
    const before = editorNow();
    fireEvent.change(screen.getByTestId("symbol-ai-instruction"), { target: { value: "un serbatoio" } });
    await act(async () => { fireEvent.click(screen.getByTestId("symbol-ai-new")); });
    expect(asked[0]).toMatchObject({ mode: "new", instruction: "un serbatoio", description: { slug: "new-symbol" } });
    expect(asked[0].photo).toBeUndefined();
    expect(screen.getByTestId("symbol-ai-now")).toBeTruthy();
    expect(screen.getByTestId("symbol-ai-proposal-drawing").querySelector("svg")).toBeTruthy();
    expect(screen.getByTestId("symbol-ai-figures").textContent).toMatch(/qwen3\.5:9b.*2/);

    await act(async () => { fireEvent.click(screen.getByTestId("symbol-ai-accept")); });
    await waitFor(() => expect(editorNow().ops).toHaveLength(4));
    // The editor names the symbol: the model's names don't come in.
    expect(editorNow()).toMatchObject({ slug: "new-symbol", w: 120, h: 80, it: before.it, en: before.en });
    expect(screen.queryByTestId("symbol-ai-proposal")).toBeNull();

    act(() => { fireEvent.keyDown(window, { key: "z", ctrlKey: true }); });
    await waitFor(() => expect(editorNow().ops).toEqual(before.ops));
  });

  it("the next request retouches the proposal; «Scarta» drops it and the editor stays as it was", async () => {
    await openTab([proposal(2), proposal(5)]);
    const before = editorNow();
    fireEvent.change(screen.getByTestId("symbol-ai-instruction"), { target: { value: "una pompa" } });
    await act(async () => { fireEvent.click(screen.getByTestId("symbol-ai-new")); });
    fireEvent.change(screen.getByTestId("symbol-ai-instruction"), { target: { value: "più larga" } });
    // Ctrl+Enter asks what the highlighted button asks: with a proposal open, a retouch.
    await act(async () => { fireEvent.keyDown(screen.getByTestId("symbol-ai-instruction"), { key: "Enter", ctrlKey: true }); });
    expect(asked[1].mode).toBe("edit");
    // From the proposal, under the editor's name.
    expect(asked[1].description.ops).toHaveLength(3);
    expect(asked[1].description.slug).toBe("new-symbol");

    fireEvent.click(screen.getByTestId("symbol-ai-discard"));
    expect(screen.queryByTestId("symbol-ai-proposal")).toBeNull();
    expect(editorNow().ops).toEqual(before.ops);
  });

  it("says why not: no model, a drawing still invalid with its errors", async () => {
    await openTab([
      { ok: false, code: "no_model", message: "x", attempts: 0, cost_usd: 0 },
      { ok: false, code: "invalid", errors: ["ops[2]: rect senza width"], attempts: 3, cost_usd: 0, model: "m" },
    ]);
    fireEvent.change(screen.getByTestId("symbol-ai-instruction"), { target: { value: "x" } });
    await act(async () => { fireEvent.click(screen.getByTestId("symbol-ai-new")); });
    const e1 = screen.getByTestId("symbol-ai-error");
    expect(e1.getAttribute("data-code")).toBe("no_model");
    expect(e1.textContent).toMatch(/Un modello per scopo|A model per purpose/);

    await act(async () => { fireEvent.click(screen.getByTestId("symbol-ai-new")); });
    const e2 = screen.getByTestId("symbol-ai-error");
    expect(e2.getAttribute("data-code")).toBe("invalid");
    expect(e2.textContent).toMatch(/3/);
    expect(e2.textContent).toMatch(/rect senza width/);
    expect(screen.queryByTestId("symbol-ai-proposal")).toBeNull();
  });

  it("nothing to ask, nothing sent", async () => {
    await openTab([proposal(1)]);
    expect((screen.getByTestId("symbol-ai-new") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("symbol-ai-edit") as HTMLButtonElement).disabled).toBe(true);
    expect(asked).toHaveLength(0);
  });
});
