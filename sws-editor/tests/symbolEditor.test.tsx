/** The symbol editor mounted (plan docs/plans/2026-11-18-editor-dei-simboli.md,
 *  phase 1): it compiles with the trace, saves into the project, and «save as»
 *  makes an independent symbol and moves the object it was opened from. */
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
import { openNewSymbol, openSymbolEditorFor } from "../src/symbols/editor/open";
import type { DescrizioneSimbolo, SynopticObject } from "../src/types";

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "../public/symbols/lib/manifest.json"), "utf8"),
) as ManifestLib;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <defs>
  </defs>
  <g id="body" data-layer="part" data-mat="body-pump" fill="#2f6fa8" stroke="#1c2329" stroke-width="1" stroke-linejoin="round">
    <rect x="20" y="20" width="60" height="60" data-op="1"/>
  </g>
</svg>
`;

function compiled(d: DescrizioneSimbolo) {
  return {
    slug: d.slug, ok: true, errori: [], svg: SVG,
    voce: {
      id: `prj:${d.slug}`, file: `prj/${d.slug}.svg`, family: "project", kind: "project", label: d.it,
      viewBox: [d.w, d.h], body: d.body, materials: [], parts: [], labels: { it: d.it, en: d.en },
    },
  } as never;
}

describe("symbol editor", () => {
  let saved: DescrizioneSimbolo[][] = [];
  beforeEach(() => {
    saved = [];
    impostaLibreriaPerTest(manifest, {});
    vi.spyOn(api, "compilaSimboli").mockImplementation(async (ds) => ds.map(compiled));
    vi.spyOn(api, "symbolCatalog").mockResolvedValue({ materials: [{ name: "steel", color: "#9aa5af" }], veils: [] });
    vi.spyOn(api, "updateSimboli").mockImplementation(async (s) => { saved.push(s); });
    act(() => {
      useAppStore.getState().setProject({ name: "p", tags: [], simboli: [] } as never);
      useAppStore.getState().closeSymbolEditor();
    });
  });
  afterEach(() => { vi.restoreAllMocks(); act(() => useAppStore.getState().closeSymbolEditor()); });

  it("compiles with the trace and saves a new symbol into the project", async () => {
    act(() => openNewSymbol());
    render(<SymbolEditorHost />);
    expect(screen.getByTestId("symbol-editor")).toBeTruthy();
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    expect(vi.mocked(api.compilaSimboli).mock.calls[0][1]).toEqual({ trace: true });
    await act(async () => { fireEvent.click(screen.getByTestId("symbol-editor-save")); });
    expect(saved).toHaveLength(1);
    expect(saved[0][0].slug).toBe("new-symbol");
    expect(useAppStore.getState().project?.simboli?.map((s) => s.slug)).toEqual(["new-symbol"]);
  });

  it("opens a library symbol as a variant, and «save as» moves the object to the copy", async () => {
    vi.spyOn(api, "librarySymbolDescription").mockResolvedValue({
      slug: "centrifugal-pump", w: 100, h: 100, body: "body-pump", it: "x", en: "x",
      overrides: "lib:process/centrifugal-pump", ops: [{ op: "corpo" }],
    });
    const obj = { id: "o1", type: "symbol", x: 0, y: 0, width: 80, height: 80, symbol_id: "pump" } as SynopticObject;
    act(() => useAppStore.getState().setPages([{ id: "p1", name: "P", objects: [obj] }] as never, "p1"));
    await act(async () => { expect(await openSymbolEditorFor("pump", "o1")).toBeNull(); });
    const target = useAppStore.getState().symbolEditor!;
    expect(target.isNew).toBe(true);
    expect(target.draft.overrides).toBe("lib:process/centrifugal-pump");
    render(<SymbolEditorHost />);
    // The variant is drawn by one object of the project.
    expect(screen.getByTestId("symbol-editor").textContent).toMatch(/1/);
    const auto = rispondi("Pompa dosatrice");
    try {
      await act(async () => { fireEvent.click(screen.getByText(/Salva come|Save as/)); });
    } finally { auto.ferma(); }
    expect(saved).toHaveLength(1);
    const copy = saved[0][0];
    expect(copy.overrides).toBeUndefined();
    expect(copy.slug).toBe("pompa-dosatrice");
    const o = useAppStore.getState().pages[0].objects[0];
    expect(o.symbol_id).toBe("prj:pompa-dosatrice");
  });
});
