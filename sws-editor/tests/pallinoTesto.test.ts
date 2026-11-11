// Il pallino di qualità di un testo senza riquadro segue l'ancoraggio
// (collaudo della rc.12, 11-11-2026): con `text_anchor: end` cadeva sopra le
// ultime lettere del valore.

import { describe, expect, it } from "vitest";

import { xPallinoTesto } from "@/canvas/SvgCanvas";

describe("xPallinoTesto", () => {
  it("start: davanti al testo, come sempre", () => {
    expect(xPallinoTesto(100, "start", 60)).toBe(90);
  });
  it("end: dopo la fine del testo, che sta a x", () => {
    expect(xPallinoTesto(100, "end", 60)).toBeGreaterThan(100);
  });
  it("middle: dopo la fine stimata", () => {
    expect(xPallinoTesto(100, "middle", 60)).toBeGreaterThan(130);
  });
});
