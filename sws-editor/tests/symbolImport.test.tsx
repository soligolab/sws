/** Importing into the symbol editor (plan
 *  docs/archive/2026-11-20-importa-svg-e-file-del-simbolo.md): an SVG from a file
 *  or from the clipboard, the symbol's own file out and back in. */
import { render, act, fireEvent, waitFor, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n/index";
import { api } from "../src/api/client";
import { useAppStore } from "../src/store";
import { rispondi } from "../src/finestraAvviso/finestraAvviso";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import { SymbolEditorHost } from "../src/symbols/editor/SymbolEditor";
import { openSymbolFile } from "../src/symbols/editor/open";
import { openBlankSymbol } from "./openBlankSymbol";
import { readSymbolFile, symbolFileText } from "../src/symbols/editor/symbolFile";
import type { Op } from "../src/symbols/editor/model";
import type { DescrizioneSimbolo } from "../src/types";

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "../public/symbols/lib/manifest.json"), "utf8"),
) as ManifestLib;

const COMPILED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="body"><rect x="20" y="20" width="60" height="60" data-op="1"/></g></svg>`;

function compiled(d: DescrizioneSimbolo) {
  return {
    slug: d.slug, ok: true, errori: [], svg: COMPILED,
    voce: {
      id: `prj:${d.slug}`, file: `prj/${d.slug}.svg`, family: "project", kind: "project", label: d.it,
      viewBox: [d.w, d.h], body: d.body, materials: [], parts: [], labels: { it: d.it, en: d.en },
    },
  } as never;
}

const DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect x="0" y="0" width="200" height="100" fill="#336699"/><circle cx="100" cy="50" r="40" fill="gold"/><text>x</text></svg>`;

// jsdom's Blob has no text(); browsers do.
if (!Blob.prototype.text) {
  Blob.prototype.text = function (this: Blob) {
    return new Promise<string>((done) => { const r = new FileReader(); r.onload = () => done(String(r.result)); r.readAsText(this); });
  };
}

const svgFile = (text: string, name = "valve.svg") => new File([text], name, { type: "image/svg+xml" });
const ops = () => useAppStore.getState().symbolEditor?.draft.ops as Op[] | undefined;

describe("symbol import", () => {
  beforeEach(() => {
    impostaLibreriaPerTest(manifest, {});
    vi.spyOn(api, "compilaSimboli").mockImplementation(async (ds) => ds.map(compiled));
    vi.spyOn(api, "symbolCatalog").mockResolvedValue({ materials: [{ name: "steel", color: "#9aa5af" }], veils: [] });
    act(() => {
      useAppStore.getState().setProject({ name: "p", tags: [], simboli: [] } as never);
      useAppStore.getState().closeSymbolEditor();
    });
  });
  afterEach(() => { vi.restoreAllMocks(); act(() => useAppStore.getState().closeSymbolEditor()); });

  it("«Import SVG…» puts the drawing in a new symbol's body, in its proportions, and says what it left out", async () => {
    await openBlankSymbol();
    const auto = rispondi(undefined);
    render(<SymbolEditorHost />);
    await act(async () => {
      fireEvent.change(screen.getByTestId("symbol-import-svg-file"), { target: { files: [svgFile(DRAWING)] } });
    });
    // The drawing is in, instead of the box; the text left out is said.
    await waitFor(() => expect(screen.getByText("100 × 50")).toBeTruthy());
    expect(auto.chiamate.map((c) => "testo" in c ? c.testo : "").join()).toMatch(/1 texts left out/);
    auto.ferma();
    expect(screen.getByTestId("symbol-op-row-1").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("symbol-op-row-2").getAttribute("aria-selected")).toBe("true");
    // Undo takes it all back.
    act(() => { fireEvent.keyDown(window, { key: "z", ctrlKey: true }); });
    expect(screen.getByText("100 × 100")).toBeTruthy();
  });

  it("Ctrl+V of SVG code imports it; of anything else pastes the copied shapes", async () => {
    await openBlankSymbol();
    render(<SymbolEditorHost />);
    const paste = (text: string) => {
      const e = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "clipboardData", { value: { files: [], getData: () => text } });
      fireEvent.keyDown(window, { key: "v", ctrlKey: true });
      window.dispatchEvent(e);
    };
    await act(async () => { paste('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(screen.getAllByTestId(/^symbol-op-row-/)).toHaveLength(1);
    expect(screen.getByTestId("symbol-op-row-1").getAttribute("aria-selected")).toBe("true");
    // Copy it, then paste plain text: the editor's own clipboard.
    act(() => { fireEvent.keyDown(window, { key: "c", ctrlKey: true }); });
    await act(async () => { paste("hello"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(screen.getAllByTestId(/^symbol-op-row-/)).toHaveLength(2);
  });

  it("«Export» downloads the symbol as it is, and it comes back as a new symbol", async () => {
    await openBlankSymbol();
    render(<SymbolEditorHost />);
    let blob: Blob | null = null;
    const create = vi.fn((b: Blob) => { blob = b; return "blob:x"; });
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await waitFor(() => expect((screen.getByTestId("symbol-editor-export") as HTMLButtonElement).disabled).toBe(false));
    act(() => { fireEvent.click(screen.getByTestId("symbol-editor-export")); });
    expect(create).toHaveBeenCalled();
    const text = await blob!.text();
    expect(JSON.parse(text)).toMatchObject({ format: "sws-symbol", version: 1, symbol: { slug: "new-symbol" } });
    // In a project that has a symbol with that slug, and as a variant: an independent copy.
    act(() => useAppStore.getState().closeSymbolEditor());
    const variant = { ...JSON.parse(text).symbol, overrides: "lib:process/centrifugal-pump" };
    act(() => useAppStore.getState().setProject({ name: "q", tags: [], simboli: [{ ...variant }] } as never));
    await act(async () => {
      await openSymbolFile(new File([symbolFileText(variant)], "new-symbol.swsym", { type: "application/json" }));
    });
    const opened = useAppStore.getState().symbolEditor!;
    expect(opened.isNew).toBe(true);
    expect(opened.draft.slug).toBe("new-symbol-2");
    expect(opened.draft.overrides).toBeUndefined();
  });

  it("«Import a symbol…» with an SVG opens a new symbol named after the file", async () => {
    const auto = rispondi(undefined);
    await act(async () => { await openSymbolFile(svgFile(DRAWING, "Valvola a sfera.svg")); });
    auto.ferma();
    expect(auto.chiamate).toHaveLength(1);
    const opened = useAppStore.getState().symbolEditor!;
    expect(opened.draft).toMatchObject({ slug: "valvola-a-sfera", it: "Valvola a sfera", w: 100, h: 50 });
    expect(ops()?.map((o) => o.op)).toEqual(["corpo", "forma", "forma"]);
  });

  it("refuses a file that is not a symbol, or from a newer IDE", () => {
    expect(readSymbolFile("{}", [])).toEqual({ ok: false, error: "notSymbol" });
    expect(readSymbolFile("PK\u0003\u0004…", [])).toEqual({ ok: false, error: "newer" });
    expect(readSymbolFile(JSON.stringify({ format: "sws-symbol", version: 2, symbol: {} }), [])).toEqual({ ok: false, error: "newer" });
    const bad = { format: "sws-symbol", version: 1, symbol: { slug: "x", w: 100, h: 100, body: "b", it: "x", en: "x", ops: [{ no: 1 }] } };
    expect(readSymbolFile(JSON.stringify(bad), [])).toEqual({ ok: false, error: "notSymbol" });
    // A slug the compiler would refuse becomes one from the label.
    const odd = { ...bad, symbol: { ...bad.symbol, slug: "X Y", it: "Pompa", en: "Pump", ops: [] } };
    expect(readSymbolFile(JSON.stringify(odd), ["pump"])).toMatchObject({ ok: true, d: { slug: "pump-2" } });
  });
});
