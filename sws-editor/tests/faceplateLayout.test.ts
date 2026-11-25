// How a faceplate's content follows its box (collaudo of 2.27.0-dev.3 on the
// PLX800, 25-11-2026; plan docs/plans/2026-11-25-correzioni-collaudo-dev3.md,
// part B). The web stretched the content with one SVG transform and the texts
// came out wide or narrow; the LVGL viewer kept the fonts by the smaller
// factor. These tests hold the web to the LVGL rule.
import { describe, expect, it } from "vitest";
import { faceplateFit, faceplateLayout, stretchChild } from "@/canvas/faceplateLayout";
import type { SynopticObject } from "@/types";

const text = { id: "t", type: "text", x: 10, y: 20, width: 90, height: 30, font_size: 12 } as SynopticObject;

describe("faceplateFit", () => {
  it("true of the older projects is «stretch»", () => {
    expect(faceplateFit({ faceplate_scale: true })).toBe("stretch");
    expect(faceplateFit({ faceplate_scale: "stretch" })).toBe("stretch");
    expect(faceplateFit({ faceplate_scale: "fit" })).toBe("fit");
    expect(faceplateFit({ faceplate_scale: false })).toBe("none");
    expect(faceplateFit({})).toBe("none");
  });
});

describe("stretching: per axis, the fonts by the smaller factor", () => {
  it("is the same as scala_figlio of the LVGL viewer", () => {
    // The same numbers as `faceplate_scale_moltiplica_posizioni_misure_e_corpi`
    // in lvgl_render.rs: a 100×50 definition in a 200×150 box.
    const c = stretchChild(text, 2, 3);
    expect([c.x, c.y, c.width, c.height]).toEqual([20, 60, 180, 90]);
    expect(c.font_size).toBe(24);
  });

  it("moves the ends of a line, the points and the motion path per axis too", () => {
    // Review of 25-11-2026: a horizontal line in a 100×50 definition became a
    // diagonal in a 200×150 box, because only x and y followed the axes.
    const line = { id: "l", type: "line", x: 0, y: 25, x2: 100, y2: 25 } as SynopticObject;
    const l = stretchChild(line, 2, 3);
    expect([l.x, l.y, l.x2, l.y2]).toEqual([0, 75, 200, 75]);
    const pipe = { id: "p", type: "pipe", x: 0, y: 0, points: [{ x: 10, y: 10 }, { x: 50, y: 10, dritto: true }],
      motion_path: [{ x: 0, y: 5 }] } as SynopticObject;
    const p = stretchChild(pipe, 2, 3);
    expect(p.points).toEqual([{ x: 20, y: 30 }, { x: 100, y: 30, dritto: true }]);
    expect(p.motion_path).toEqual([{ x: 0, y: 15 }]);
    // The older pair form, as LVGL reads it (review of 25-11-2026).
    const pairs = { id: "m", type: "rect", motion_path: [[0, 5], [10, 0]] } as unknown as SynopticObject;
    expect(stretchChild(pairs, 2, 3).motion_path).toEqual([{ x: 0, y: 15 }, { x: 20, y: 0 }]);
  });

  it("draws no SVG transform: a text cannot deform", () => {
    const l = faceplateLayout({ faceplate_scale: true }, 200, 150, { w: 100, h: 50 });
    expect(l.transform).toBe("");
    expect(l.background).toEqual({ x: 0, y: 0, w: 200, h: 150 });
    expect(l.child(text).font_size).toBe(24);
  });
});

describe("fit and zoom: one factor", () => {
  it("fit: the smaller factor, centred in the box", () => {
    const l = faceplateLayout({ faceplate_scale: "fit" }, 200, 150, { w: 100, h: 50 });
    // s = min(2, 3) = 2: the content is 200×100, 25 px free above and below.
    expect(l.transform).toBe(" translate(0, 25) scale(2)");
    expect(l.child(text)).toBe(text);
    // The background still covers the whole box.
    expect(l.background).toEqual({ x: 0, y: -12.5, w: 100, h: 75 });
  });

  it("zoom: the content at its own size times the factor", () => {
    const l = faceplateLayout({ faceplate_zoom: 1.35 }, 135, 48.6, { w: 144, h: 36 });
    expect(l.transform).toBe(" scale(1.35)");
    expect(l.background.w).toBeCloseTo(100);
    expect(l.background.h).toBeCloseTo(36);
  });

  it("no fit and no zoom: as before", () => {
    const l = faceplateLayout({}, 135, 48.6, { w: 144, h: 36 });
    expect(l.transform).toBe("");
    expect(l.background).toEqual({ x: 0, y: 0, w: 135, h: 48.6 });
  });
});
