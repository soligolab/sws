/** The animated pieces drawn on the web (plan docs/plans/2026-11-19-animazioni-dei-simboli.md,
 *  session 2b): what follows a value is always shown, what moves in time only with `animate`. */
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { SimboloLibSvg, type ValoriParti } from "../src/symbols/lib/SimboloLib";
import type { ManifestLib, SimboloLib } from "../src/symbols/lib/manifest";
import { pulseStops } from "../src/symbols/lib/keyframes";

afterEach(cleanup);

const layer = (id: string, attrs: string, body: string) =>
  `  <g id="${id}" data-layer="part"${attrs} stroke="#1c2329" stroke-width="1" stroke-linejoin="round">\n    ${body}\n  </g>`;
const SVG = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" viewBox="0 0 120 100">`,
  `  <defs>`,
  `  </defs>`,
  layer("body", ` data-mat="body-pump" fill="#2f6fa8"`, `<rect x="4" y="60" width="112" height="36"/>`),
  layer("fan", "", `<path d="M24 10 L28 24 L24 38 L20 24 Z"/>`),
  layer("tank", "", `<rect x="44" y="8" width="32" height="12"/>`),
  layer("gate", "", `<rect x="84" y="30" width="28" height="26"/>`),
  layer("motor", "", `<rect x="10" y="66" width="30" height="24"/>`),
  layer("glow", "", `<circle cx="60" cy="78" r="10"/>`),
  layer("beacon", ` fill="#64748b"`, `<circle cx="98" cy="78" r="10"/>`),
  `</svg>`,
  "",
].join("\n");

const sim: SimboloLib = {
  id: "prj:animated-pieces", file: "prj/animated-pieces.svg", family: "project", kind: "project", label: "x",
  viewBox: [120, 100], body: "body-pump", materials: [],
  parts: [
    { id: "fan", kind: "rotor", cx: 24, cy: 24, symmetry: 90, ccw: true },
    { id: "tank", kind: "level", x: 44, y: 8, w: 32, h: 12, dir: "right" },
    { id: "gate", kind: "slide", dx: 0, dy: -16, transition_ms: 400 },
    { id: "motor", kind: "vibrate", amplitude: 2, axis: "x", period_ms: 200 },
    { id: "glow", kind: "pulse", depth: 0.6, period_ms: 1000 },
    { id: "beacon", kind: "signal", color: "#64748b", entries: [
      { value: 1, color: "#22c55e" }, { value_min: 2, value_max: 9, color: "#ef4444", blink: true }, { value: 0, hidden: true }] },
  ],
};
const manifesto: ManifestLib = { version: "t", materials: { "body-pump": "#2f6fa8" }, symbols: [sim] };

function draw(valori: Partial<ValoriParti>) {
  const { container } = render(
    <svg><SimboloLibSvg sim={sim} svg={SVG} manifesto={manifesto} prefisso="t" x={0} y={0} w={120} h={100}
      valori={{ corpo: null, gira: false, periodoS: 2, ...valori }} /></svg>,
  );
  const g = (id: string) => container.querySelector(`[data-strato="${id}"]`) as SVGGElement;
  return { container, g };
}

describe("the pieces that follow a value are always shown", () => {
  it("a slide moves by its fraction, with its transition", () => {
    const { g } = draw({ parti: { gate: { frazione: 1 } } });
    expect(g("gate").style.transform).toBe("translate(0px, -16px)");
    expect(g("gate").style.transition).toContain("400ms");
    expect(draw({ parti: { gate: { frazione: null } } }).g("gate").style.transform).toBe("translate(0px, 0px)");
  });

  it("a level bound per part fills from its side", () => {
    const { container } = draw({ parti: { tank: { frazione: 0.25 } } });
    const r = container.querySelector('[id="t-clip-tank"] rect')!;
    expect([r.getAttribute("x"), r.getAttribute("width"), r.getAttribute("height")]).toEqual(["44", "8", "12"]);
  });

  it("a signal takes the colour of its entry, or hides; with no entry it is as drawn", () => {
    const fill = (g: SVGGElement) => g.querySelector("g")!.getAttribute("fill");
    expect(fill(draw({ parti: { beacon: { entry: 0 } } }).g("beacon"))).toBe("#22c55e");
    expect(fill(draw({ parti: { beacon: { entry: null } } }).g("beacon"))).toBe("#64748b");
    expect(draw({ parti: { beacon: { entry: 2 } } }).g("beacon").getAttribute("visibility")).toBe("hidden");
  });
});

describe("the timed pieces move only with `animate`", () => {
  it("vibrate: four steps, step-end", () => {
    expect(draw({ parti: { motor: { active: true } } }).g("motor").style.animation).toBe("");
    const g = draw({ parti: { motor: { active: true } }, animate: true }).g("motor");
    expect(g.style.animation).toContain("sws-vib-x-2 200ms step-end infinite");
    expect(g.getAttribute("data-anim")).toBe("1");
    expect(document.getElementById("sws-piece-keyframes")!.textContent).toContain("25%{transform:translate(2px, 0)}");
  });

  it("pulse: the stops of the shared curve", () => {
    const g = draw({ parti: { glow: { active: true } }, animate: true }).g("glow");
    expect(g.style.animation).toContain("sws-pulse-60 1000ms linear infinite");
    const stops = pulseStops(0.6);
    expect(stops[0]).toEqual([0, 1]);
    expect(stops[5]).toEqual([50, 0.4]);
    expect(stops[10]).toEqual([100, 1]);
    expect(draw({ parti: { glow: { active: false } }, animate: true }).g("glow").style.animation).toBe("");
  });

  it("a signal entry that blinks, with the symbol's period", () => {
    const g = draw({ parti: { beacon: { entry: 1 } }, animate: true, blinkMs: 600 }).g("beacon");
    expect(g.style.animation).toContain("sws-piece-blink 600ms step-start infinite");
    expect(g.querySelector("g")!.getAttribute("fill")).toBe("#ef4444");
  });

  it("a rotor bound per part turns with its input, counter-clockwise; unbound, with the symbol", () => {
    expect(draw({ parti: { fan: { active: true } }, animate: true }).g("fan").style.animation)
      .toContain("sws-piece-spin 2s linear infinite reverse");
    // Bound and false: still, even if the symbol's Rotazione says turn.
    expect(draw({ parti: { fan: { active: false } }, animate: true, gira: true }).g("fan").style.animation).toBe("");
    expect(draw({ gira: true }).g("fan").style.animation).toContain("sws-piece-spin");
  });
});
