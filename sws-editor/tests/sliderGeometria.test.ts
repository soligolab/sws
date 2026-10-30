/** La geometria pura dello slider (fase 2): gli stessi numeri del pannello LVGL. */
import { describe, it, expect } from "vitest";
import {
  agganciaAlPasso, centroCursore, frazioneDaPunto, geometriaSlider, valoreDaFrazione, valoreDaTasto,
} from "../src/canvas/slider/geometria";

describe("geometria dello slider", () => {
  it("orizzontale: gli stessi numeri del pannello", () => {
    // I casi di `lo_slider_orizzontale_resta_come_prima` in lvgl_render.rs.
    expect(geometriaSlider({ verticale: false, w: 200, h: 50, altoEtichetta: 18, altoValore: 18 }).traccia)
      .toEqual({ x: 0, y: 17, w: 200, h: 16 });
    expect(geometriaSlider({ verticale: false, w: 200, h: 50, altoEtichetta: 0, altoValore: 18 }).traccia.y).toBe(7);
    expect(geometriaSlider({ verticale: false, w: 200, h: 10, altoEtichetta: 0, altoValore: 0 }).traccia)
      .toEqual({ x: 0, y: 0, w: 200, h: 10 });
  });

  it("verticale: come il pannello", () => {
    const g = geometriaSlider({ verticale: true, w: 60, h: 240, altoEtichetta: 18, altoValore: 18 });
    expect(g.traccia).toEqual({ x: 22, y: 22, w: 16, h: 196 });
    expect(g.valore).toEqual({ cx: 30, cy: 231 });
  });

  it("il valore sopra, dentro, sul cursore", () => {
    const sopra = geometriaSlider({ verticale: false, w: 200, h: 60, altoEtichetta: 0, altoValore: 18, posizione: "sopra" });
    expect(sopra.valore!.cy).toBeLessThan(sopra.traccia.y);
    const dentro = geometriaSlider({ verticale: false, w: 200, h: 60, altoEtichetta: 0, altoValore: 18, posizione: "dentro", spessore: 28 });
    expect(dentro.valore!.cy).toBe(dentro.traccia.y + 14);
    expect(dentro.traccia.y).toBe(16);
    expect(geometriaSlider({ verticale: false, w: 200, h: 60, altoEtichetta: 0, altoValore: 18, posizione: "cursore" }).valore).toBeNull();
  });

  it("dal punto al valore, e al passo", () => {
    const g = geometriaSlider({ verticale: false, w: 200, h: 50, altoEtichetta: 0, altoValore: 0 });
    expect(frazioneDaPunto(g, 50, 0)).toBe(0.25);
    expect(frazioneDaPunto(g, -30, 0)).toBe(0);
    expect(valoreDaFrazione(0.33, 0, 1, 0.05)).toBe(0.35);
    expect(agganciaAlPasso(9.9, 0, 10, 4)).toBe(8);
    expect(centroCursore(g, 0.5)).toEqual({ cx: 100, cy: 25 });
    const v = geometriaSlider({ verticale: true, w: 40, h: 200, altoEtichetta: 0, altoValore: 0 });
    expect(frazioneDaPunto(v, 0, v.traccia.y)).toBe(1);
  });

  it("la tastiera", () => {
    expect(valoreDaTasto("ArrowRight", 0.35, 0, 1, 0.05)).toBe(0.4);
    expect(valoreDaTasto("PageDown", 50, 0, 100, 1)).toBe(40);
    expect(valoreDaTasto("End", 3, 0, 10, 4)).toBe(8);
    expect(valoreDaTasto("Home", 3, 0, 10)).toBe(0);
    expect(valoreDaTasto("a", 3, 0, 10)).toBeNull();
  });
});

describe("gli stili (fase 3)", () => {
  it("gli stessi numeri del pannello", () => {
    // Gli stessi casi di `gli_stili_dello_slider_come_sul_web` in lvgl_render.rs.
    const pillola = geometriaSlider({ verticale: false, w: 200, h: 60, altoEtichetta: 0, altoValore: 18, stile: "pillola" });
    expect([pillola.traccia.h, pillola.raggioCursore]).toEqual([28, 11]);
    const isa = geometriaSlider({ verticale: false, w: 200, h: 50, altoEtichetta: 0, altoValore: 18, stile: "isa" });
    expect([isa.traccia.h, isa.cursore, isa.raggioTraccia]).toEqual([6, { w: 10, h: 20 }, 1]);
    expect(geometriaSlider({ verticale: true, w: 50, h: 200, altoEtichetta: 0, altoValore: 18, stile: "isa" }).cursore)
      .toEqual({ w: 20, h: 10 });
    const piastra = geometriaSlider({ verticale: false, w: 240, h: 64, altoEtichetta: 18, altoValore: 18, stile: "piastra", conIcona: true });
    expect([piastra.traccia, piastra.cursore, piastra.raggioTraccia]).toEqual([{ x: 0, y: 0, w: 240, h: 64 }, { w: 0, h: 0 }, 12]);
    expect(piastra.icona).toEqual({ cx: 26, cy: 32, lato: 28 });
    expect(piastra.allinea).toBe("start");
    expect([piastra.etichetta, piastra.valore]).toEqual([{ cx: 50, cy: 23 }, { cx: 50, cy: 41 }]);
    const tapparella = geometriaSlider({ verticale: true, w: 80, h: 200, altoEtichetta: 18, altoValore: 18, stile: "piastra", conIcona: true });
    expect(tapparella.icona).toEqual({ cx: 40, cy: 26, lato: 28 });
    expect(tapparella.valore).toEqual({ cx: 40, cy: 179 });
  });
});
