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
import { newRect, type Op } from "../src/symbols/editor/model";
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

  it("opens a library symbol with its ports made explicit, adds one with the «Port» tool and renames it", async () => {
    vi.spyOn(api, "librarySymbolDescription").mockResolvedValue({
      slug: "centrifugal-pump", w: 100, h: 100, body: "body-pump", it: "x", en: "x",
      overrides: "lib:process/centrifugal-pump", ops: [{ op: "corpo" }, { op: "flangia_v", x: 0, y: 40 }],
    });
    const explicit = vi.spyOn(api, "symbolExplicitPorts").mockImplementation(async (d) => ({
      ...d, ops: [{ op: "corpo" }, { op: "bocca", x: 0, y: 48, side: "left", d: 10, id: "n-left" }],
    }));
    act(() => useAppStore.getState().setPages([{ id: "p1", name: "P", objects: [] }] as never, "p1"));
    await act(async () => { await openSymbolEditorFor("pump"); });
    expect(explicit).toHaveBeenCalledTimes(1);
    render(<SymbolEditorHost />);
    expect(screen.getByTestId("symbol-port-n-left")).toBeTruthy();
    // jsdom has no screen matrix: the click lands on (0, 0), the nearest border is the left one.
    // Nor PointerEvent: a MouseEvent carries `button` like the real one.
    const w = window as unknown as Record<string, unknown>;
    if (!w.PointerEvent) w.PointerEvent = w.MouseEvent;
    fireEvent.click(screen.getByTestId("symbol-tool-port"));
    fireEvent.pointerDown(screen.getByTestId("symbol-editor-canvas"), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    expect(screen.getByTestId("symbol-port-p1")).toBeTruthy();
    const id = screen.getByTestId("symbol-port-id") as HTMLInputElement;
    fireEvent.change(id, { target: { value: "Inlet" } });
    fireEvent.blur(id);
    expect(screen.getByTestId("symbol-port-inlet")).toBeTruthy();
    fireEvent.click(screen.getByTestId("symbol-tab-structure"));
    expect(screen.getByTestId("symbol-port-row-n-left")).toBeTruthy();
    expect(screen.getByTestId("symbol-port-row-inlet")).toBeTruthy();
  });

  it("the view zooms and fits; the «Try» tab shows the inputs", async () => {
    act(() => openNewSymbol());
    render(<SymbolEditorHost />);
    expect(screen.getByTestId("symbol-zoom").textContent).toBe("100%");
    fireEvent.click(screen.getByTitle(/Ingrandisci|Zoom in/));
    expect(screen.getByTestId("symbol-zoom").textContent).toBe("125%");
    fireEvent.click(screen.getByText(/^(Adatta|Fit)$/));
    expect(screen.getByTestId("symbol-zoom").textContent).toBe("100%");
    fireEvent.click(screen.getByTestId("symbol-tab-try"));
    // A new symbol has a body: its state can be tried.
    const state = screen.getByTestId("symbol-try-state") as HTMLSelectElement;
    fireEvent.change(state, { target: { value: "alarm" } });
    expect(state.value).toBe("alarm");
  });

  it("a grouped layer is one object: a click on one of its shapes picks them all", async () => {
    const two = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <defs>
  </defs>
  <g id="body" data-layer="part" data-mat="body-pump" fill="#2f6fa8">
    <rect x="0" y="0" width="10" height="10" data-op="1"/>
    <rect x="50" y="50" width="10" height="10" data-op="2"/>
  </g>
</svg>
`;
    vi.spyOn(api, "compilaSimboli").mockImplementation(async (ds) => ds.map((d) => ({ ...(compiled(d) as object), svg: two }) as never));
    // jsdom draws nothing: the box of an element is its own x/y/width/height.
    const proto = window.SVGElement.prototype as unknown as { getBBox?: () => unknown };
    const real = proto.getBBox;
    proto.getBBox = function (this: SVGElement) {
      const a = (n: string) => Number(this.getAttribute(n) ?? 0);
      return { x: a("x"), y: a("y"), width: a("width"), height: a("height") };
    };
    const w = window as unknown as Record<string, unknown>;
    if (!w.PointerEvent) w.PointerEvent = w.MouseEvent;
    try {
      act(() => useAppStore.getState().openSymbolEditor({
        draft: { slug: "gruppo", w: 100, h: 100, body: "body-pump", it: "G", en: "G",
          ops: [{ op: "corpo" }, newRect({ x: 0, y: 0, w: 10, h: 10 }), newRect({ x: 50, y: 50, w: 10, h: 10 })] },
        isNew: true,
      }));
      render(<SymbolEditorHost />);
      await waitFor(() => expect(document.querySelector('[data-op="2"]')).toBeTruthy());
      const canvas = screen.getByTestId("symbol-editor-canvas");
      const picked = () => [1, 2].filter((i) => screen.getByTestId(`symbol-op-row-${i}`).getAttribute("aria-selected") === "true");
      // jsdom has no screen matrix: the click lands on (0, 0), on the first rectangle.
      fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
      fireEvent.pointerUp(canvas, { pointerId: 1 });
      expect(picked()).toEqual([1]);
      fireEvent.click(screen.getByTestId("symbol-layer-group-body"));
      fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
      fireEvent.pointerUp(canvas, { pointerId: 1 });
      expect(picked()).toEqual([1, 2]);
      // The list still picks one.
      fireEvent.click(screen.getByTestId("symbol-op-row-2"));
      expect(picked()).toEqual([2]);
    } finally {
      proto.getBBox = real;
    }
  });

  it("a dropped shape stays where it was dropped until the new drawing arrives; the snap puts its corner on the grid", async () => {
    // The drawing follows the description: one <rect> per rectangle.
    const draw = (d: DescrizioneSimbolo) => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <defs>
  </defs>
  <g id="body" data-layer="part" data-mat="body-pump" fill="#2f6fa8">
${(d.ops as Op[]).map((op, i) => (op.op === "forma"
    ? `    <rect ${(op.geo as [string, number][]).map(([k, v]) => `${k}="${v}"`).join(" ")} data-op="${i}"/>\n` : "")).join("")}  </g>
</svg>
`;
    let slow = false;
    let pending: (() => void) | null = null;
    vi.spyOn(api, "compilaSimboli").mockImplementation((ds) => {
      const out = ds.map((d) => ({ ...(compiled(d) as object), svg: draw(d) }) as never);
      return slow ? new Promise((r) => { pending = () => r(out); }) : Promise.resolve(out);
    });
    // jsdom draws nothing and has no screen: boxes from the attributes, a client point is a unit.
    const proto = window.SVGElement.prototype as unknown as { getBBox?: () => unknown; getScreenCTM?: () => unknown };
    const real = { getBBox: proto.getBBox, getScreenCTM: proto.getScreenCTM };
    proto.getBBox = function (this: SVGElement) {
      const a = (n: string) => Number(this.getAttribute(n) ?? 0);
      return { x: a("x"), y: a("y"), width: a("width"), height: a("height") };
    };
    proto.getScreenCTM = () => ({ a: 1, inverse: () => ({}) });
    vi.stubGlobal("DOMPoint", class { constructor(readonly x = 0, readonly y = 0) {} matrixTransform() { return { x: this.x, y: this.y }; } });
    const w = window as unknown as Record<string, unknown>;
    if (!w.PointerEvent) w.PointerEvent = w.MouseEvent;
    try {
      act(() => useAppStore.getState().openSymbolEditor({
        draft: { slug: "lascia", w: 100, h: 100, body: "body-pump", it: "L", en: "L",
          ops: [{ op: "corpo" }, newRect({ x: 3, y: 3, w: 10, h: 10 }), newRect({ x: 50, y: 50, w: 10, h: 10 })] },
        isNew: true,
      }));
      render(<SymbolEditorHost />);
      await waitFor(() => expect(document.querySelector('[data-op="2"]')).toBeTruthy());
      const canvas = screen.getByTestId("symbol-editor-canvas");
      const shape = () => document.querySelector('[data-op="1"]')!;
      const dragBy = (from: [number, number], dx: number) => {
        fireEvent.pointerDown(canvas, { button: 0, clientX: from[0], clientY: from[1], pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: from[0] + dx, clientY: from[1], pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });
      };

      slow = true;
      dragBy([5, 5], 14);
      expect(shape().getAttribute("transform")).toBe("translate(14 0)");
      // The compile is on its way: the shape does not go back to where it started.
      await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
      expect(pending).not.toBeNull();
      expect(shape().getAttribute("transform")).toBe("translate(14 0)");
      await act(async () => { pending!(); });
      await waitFor(() => expect(shape().getAttribute("x")).toBe("17"));
      expect(shape().getAttribute("transform")).toBeNull();

      // With the snap, the top-left corner lands on the grid: 17 + 14 = 31 → 30, and 3 → 0.
      slow = false;
      fireEvent.click(screen.getByTestId("symbol-grid-snap"));
      dragBy([20, 5], 14);
      await waitFor(() => expect(shape().getAttribute("x")).toBe("30"));
      expect(shape().getAttribute("y")).toBe("0");
    } finally {
      proto.getBBox = real.getBBox;
      proto.getScreenCTM = real.getScreenCTM;
      vi.unstubAllGlobals();
    }
  });
});
