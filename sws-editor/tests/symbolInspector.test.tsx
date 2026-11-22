/** The symbol editor's right column follows the selection, and effects are
 *  properties of shapes (plan docs/plans/2026-11-22-rc29-collaudo-utente-editor-simboli.md,
 *  blocks C and D). */
import { render, act, fireEvent, waitFor, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n/index";
import { api } from "../src/api/client";
import { useAppStore } from "../src/store";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import { SymbolEditorHost } from "../src/symbols/editor/SymbolEditor";
import { addEffect, clipPhoto, groupOps, membersOf, newRect, ungroupOps, unclipPhoto, type Op } from "../src/symbols/editor/model";
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

function compiled(d: DescrizioneSimbolo) {
  return {
    slug: d.slug, ok: true, errori: [], svg: SVG,
    voce: {
      id: `prj:${d.slug}`, file: `prj/${d.slug}.svg`, family: "project", kind: "project", label: d.it,
      viewBox: [d.w, d.h], body: d.body, materials: [], parts: [], labels: { it: d.it, en: d.en },
    },
  } as never;
}

const draft = (ops: Op[]): DescrizioneSimbolo => ({ slug: "stufa", w: 100, h: 100, body: "body-pump", it: "S", en: "S", ops } as DescrizioneSimbolo);

describe("the inspector of the symbol editor", () => {
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

  it("shows the symbol with nothing selected, the selection otherwise, and an effect is added to a shape", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "corpo" }, newRect({ x: 20, y: 20, w: 60, h: 60 })]), isNew: true,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    expect(screen.getByTestId("symbol-section-inputs")).toBeTruthy();
    expect(screen.getByTestId("symbol-section-ai-draw")).toBeTruthy();
    fireEvent.click(screen.getByTestId("symbol-op-row-1"));
    expect(screen.queryByTestId("symbol-section-inputs")).toBeNull();
    fireEvent.change(screen.getByTestId("symbol-fx-add"), { target: { value: "flame" } });
    // No input yet: one is made, «acceso», and the flame follows it.
    await waitFor(() => expect(screen.getByTestId("symbol-fx-flame")).toBeTruthy());
    expect((screen.getByTestId("symbol-fx-input-flame") as HTMLSelectElement).value).toBe("acceso");
    // «Symbol» clears the selection.
    fireEvent.click(screen.getByTestId("symbol-tab-structure"));
    expect(screen.getByTestId("symbol-section-inputs")).toBeTruthy();
  });

  it("takes the effect parts of before out, and says so", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "corpo" }, newRect({ x: 20, y: 20, w: 60, h: 60 }), { op: "parte", id: "neon", kind: "glow", geo: {} }]),
      isNew: true,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(screen.getByTestId("symbol-editor-old-fx")).toBeTruthy());
  });
});

describe("groups, effects and masks in the model", () => {
  const ops: Op[] = [{ op: "corpo" }, newRect({ x: 0, y: 0, w: 10, h: 10 }), newRect({ x: 20, y: 0, w: 10, h: 10 }),
    { op: "image", src: "a.png", geo: [["x", 0], ["y", 0], ["width", 50], ["height", 50]] },
    { op: "forma", tag: "circle", geo: [["cx", 25], ["cy", 25], ["r", 20]] }];
  it("groups and ungroups, and an effect leaves with its group", () => {
    const g = groupOps(draft(ops), [1, 2]);
    expect(membersOf(g.d, g.group)).toEqual([1, 2]);
    const fx = addEffect(g.d, [1, 2], "glow", "on").d;
    expect((fx.ops as Op[]).filter((o) => o.op === "effetto")).toHaveLength(1);
    const back = ungroupOps(fx, [1, 2]);
    expect((back.ops as Op[]).some((o) => o.op === "effetto")).toBe(false);
  });
  it("cuts a photo to a shape and gives the shape back", () => {
    const cut = clipPhoto(draft(ops), 3, 4);
    expect((cut.ops as Op[])[3].clip).toEqual({ tag: "circle", geo: [["cx", 25], ["cy", 25], ["r", 20]] });
    expect(cut.ops).toHaveLength(4);
    const back = unclipPhoto(cut, 3);
    expect((back.ops as Op[])[4].tag).toBe("circle");
    expect((back.ops as Op[])[3].clip).toBeUndefined();
  });
});
