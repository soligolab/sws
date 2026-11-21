/** The effects of the symbols on the web (plan docs/plans/2026-11-21-simboli-fase-8-effetti.md). */
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { SimboloLibSvg, type ValoriParti } from "../src/symbols/lib/SimboloLib";
import { valoriParti } from "../src/symbols/lib/libreria";
import type { ManifestLib, SimboloLib } from "../src/symbols/lib/manifest";

afterEach(cleanup);

const layer = (id: string, attrs: string, body: string) =>
  `  <g id="${id}" data-layer="part"${attrs} stroke="#1c2329" stroke-width="1" stroke-linejoin="round">\n    ${body}\n  </g>`;
const SVG = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" viewBox="0 0 120 100">`,
  `  <defs>`,
  `  </defs>`,
  layer("body", ` data-mat="body-pump" fill="#2f6fa8"`, `<rect x="4" y="60" width="112" height="36"/>`),
  layer("neon", "", `<rect x="20" y="20" width="40" height="8" fill="#a5f3fc"/>`),
  `</svg>`,
  "",
].join("\n");

const sim: SimboloLib = {
  id: "prj:effects", file: "prj/effects.svg", family: "project", kind: "project", label: "x",
  viewBox: [120, 100], body: "body-pump", materials: [],
  parts: [{ id: "neon", kind: "glow", color: "#22d3ee", radius: 5 }],
};
const manifesto: ManifestLib = { version: "t", materials: { "body-pump": "#2f6fa8" }, symbols: [sim] };

function draw(valori: Partial<ValoriParti>) {
  const { container } = render(
    <svg><SimboloLibSvg sim={sim} svg={SVG} manifesto={manifesto} prefisso="t" x={0} y={0} w={120} h={100}
      valori={{ corpo: null, gira: false, periodoS: 2, ...valori }} /></svg>,
  );
  return container;
}

describe("the glow", () => {
  it("follows its input: a halo of its colour while it is true", () => {
    const c = draw({ parti: { neon: { active: true } } });
    expect(c.querySelector('[data-strato="neon"]')?.getAttribute("filter")).toBe("url(#t-glow-neon)");
    const f = c.querySelector("#t-glow-neon")!;
    expect(f.querySelector("feGaussianBlur")?.getAttribute("stdDeviation")).toBe("5");
    expect(f.querySelector("feFlood")?.getAttribute("flood-color")).toBe("#22d3ee");
    expect(draw({ parti: { neon: { active: false } } }).querySelector('[data-strato="neon"]')?.getAttribute("filter")).toBeNull();
  });

  it("is on with a true input, like a pulse", () => {
    expect(valoriParti(sim.parts, { neon: { tag: "t" } }, () => 1)).toEqual({ neon: { active: true } });
    expect(valoriParti(sim.parts, { neon: { tag: "t" } }, () => 0)).toEqual({ neon: { active: false } });
  });
});
