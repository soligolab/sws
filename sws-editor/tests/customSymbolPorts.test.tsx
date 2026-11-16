/** A custom symbol drawn as free SVG says where pipes attach (`view_box` and
 *  `ports`, plan docs/archive/2026-11-10-assistente-secondo-giro.md, G3): the
 *  ports reach `bocchePer` from the custom symbols of the store, and from
 *  there the anchor of a pipe end, the routed path, the magnet of the editor
 *  and the list of the properties panel. */
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n/index";
import { SvgObject } from "../src/canvas/SvgCanvas";
import { aggancioSu, bersagli, bocchePer, diametriCapi, percorsoTubo } from "../src/canvas/tubazioni";
import { useAppStore } from "../src/store";
import { impostaLibreriaPerTest, overlayCustomSymbolPorts } from "../src/symbols/lib/libreria";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import type { CustomSymbol, SynopticObject } from "../src/types";

const LIB = resolve(__dirname, "../public/symbols/lib");
const manifest = JSON.parse(readFileSync(resolve(LIB, "manifest.json"), "utf8")) as ManifestLib;

const attribution = { author: "SWS assistant", source: "bozza_simbolo", license: "" };
const cyclone: CustomSymbol = {
  id: "cyclone", label: "Ciclone", url: "", attribution,
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 120">\n  <path d="M12 10 H68 V60 L46 110 H34 L12 60 Z"/>\n</svg>\n',
  view_box: [80, 120],
  ports: [
    { id: "n-left", x: 0, y: 20, side: "left", d: 10 },
    { id: "n-bottom", x: 40, y: 120, side: "bottom", d: 10 },
  ],
};
const plain: CustomSymbol = { id: "plain", label: "Plain", url: "", attribution, svg: "<svg viewBox='0 0 10 10'/>" };

// The object is 120×180: the drawing of 80×120 at scale 1,5.
const onPage = (extra: Partial<SynopticObject> = {}) =>
  ({ id: "c", type: "symbol", x: 400, y: 240, width: 120, height: 180, symbol_id: "custom:cyclone", ...extra }) as SynopticObject;
const pump = { id: "p", type: "symbol", x: 200, y: 420, width: 80, height: 80, symbol_id: "lib:process/centrifugal-pump" } as SynopticObject;

beforeEach(() => {
  act(() => {
    impostaLibreriaPerTest(manifest, {});
    useAppStore.setState({ customSymbols: [cyclone, plain] });
  });
});

describe("the ports of a custom symbol", () => {
  it("reach bocchePer from the custom symbols of the store", () => {
    expect(bocchePer(onPage())).toEqual({ viewBox: [80, 120], porte: cyclone.ports });
    // No ports, no size, or a symbol the project does not have: only the box.
    expect(bocchePer(onPage({ symbol_id: "custom:plain" }))).toBeUndefined();
    expect(bocchePer(onPage({ symbol_id: "custom:ghost" }))).toBeUndefined();
    act(() => useAppStore.setState({ customSymbols: [{ ...cyclone, view_box: undefined }] }));
    expect(bocchePer(onPage())).toBeUndefined();
  });

  it("follow the store: a symbol removed takes its ports away", () => {
    act(() => useAppStore.getState().updateProjectCustomSymbols([plain]));
    expect(bocchePer(onPage())).toBeUndefined();
    act(() => useAppStore.getState().updateProjectCustomSymbols([plain, cyclone]));
    expect(bocchePer(onPage())?.porte.map((p) => p.id)).toEqual(["n-left", "n-bottom"]);
  });

  it("put the pipe end where the drawing has the port", () => {
    expect(aggancioSu(onPage(), "n-left")).toEqual({ x: 400, y: 270, dx: -1, dy: 0 });
    expect(aggancioSu(onPage(), "n-bottom")).toEqual({ x: 460, y: 420, dx: 0, dy: 1 });
    // A box wider than the drawing: the drawing is centred, the port with it.
    expect(aggancioSu(onPage({ x: 0, y: 0, width: 200, height: 120 }), "n-left").x).toBe(60);
    // The five anchors of the box are still there, and an unknown name is the centre.
    expect(aggancioSu(onPage(), "right")).toMatchObject({ x: 520, y: 330 });
    expect(aggancioSu(onPage(), "n-top")).toMatchObject({ x: 460, y: 330 });
  });

  it("route a pipe from a library port to a custom one, as on the panel", () => {
    const pipe = {
      id: "t", type: "pipe", x: 0, y: 0, routing: "orthogonal",
      from_obj_id: "p", from_port: "n-top", to_obj_id: "c", to_port: "n-left",
    } as SynopticObject;
    const objects = [pump, onPage(), pipe];
    // The same three points the LVGL test expects
    // (`a_pipe_attaches_to_the_ports_of_a_free_svg_symbol`).
    expect(percorsoTubo(pipe, objects)).toEqual([{ x: 250, y: 420 }, { x: 250, y: 270 }, { x: 400, y: 270 }]);
    expect(diametriCapi(pipe, objects)).toEqual([10, 15]);
  });

  it("are targets of the magnet in the editor", () => {
    const targets = bersagli([onPage()], "");
    expect(targets.filter((b) => b.bocca).map((b) => [b.porta, b.x, b.y])).toEqual([
      ["n-left", 400, 270], ["n-bottom", 460, 420],
    ]);
    expect(targets.filter((b) => !b.bocca)).toHaveLength(5);
  });

  it("can be laid over the project for a photo, and taken away", () => {
    act(() => useAppStore.setState({ customSymbols: [] }));
    expect(bocchePer(onPage())).toBeUndefined();
    const remove = overlayCustomSymbolPorts([cyclone]);
    expect(bocchePer(onPage())?.porte).toHaveLength(2);
    remove();
    expect(bocchePer(onPage())).toBeUndefined();
  });
});

describe("the drawing of a custom symbol with ports", () => {
  // The WYSIWYG rule of the editor: the edit branch draws what the runtime draws.
  it("is the same in the editor and at runtime", () => {
    const o = onPage();
    const draw = (isEditMode: boolean) => {
      const { container } = render(
        <svg><SvgObject obj={o} objects={[o]} tagValues={{}} selected={false} isEditMode={isEditMode}
          customSymbols={[cyclone]} faceplates={[]} /></svg>,
      );
      const inner = container.querySelector('svg[viewBox="0 0 80 120"]');
      expect(inner).not.toBeNull();
      expect(inner!.getAttribute("width")).toBe("120");
      expect(inner!.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
      return inner!.innerHTML;
    };
    const runtime = draw(false);
    expect(runtime).toContain("M12 10 H68");
    expect(draw(true)).toBe(runtime);
  });
});
