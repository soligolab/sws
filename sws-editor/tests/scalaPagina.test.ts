/** Portare un progetto da una risoluzione a un'altra (15-10-2026, piano
 *  docs/plans/2026-10-15-scalare-tra-risoluzioni.md). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CAMPI_FISSI, CAMPI_POSIZIONE, CAMPI_SCALATI, fattore, misuraPiuFrequente, scalaCornice, scalaPagina,
} from "../src/scala/scalaPagina";
import type { SynopticObject, SynopticPage } from "../src/types";

const pagina = (objects: SynopticObject[], w = 1920, h = 1080): SynopticPage => ({ id: "p", name: "P", width: w, height: h, objects });
const A = { width: 1280, height: 800 };

describe("scala fra risoluzioni", () => {
  it("fattore uniforme e centratura: 1920×1080 → 1280×800", () => {
    const t = fattore({ width: 1920, height: 1080 }, A);
    expect(t.f).toBeCloseTo(2 / 3, 6);
    expect(t.dx).toBeCloseTo(0, 6);
    expect(t.dy).toBeCloseTo(40, 6);
  });

  it("la barra di CasaDomotica torna dentro la pagina", () => {
    const p = scalaPagina(pagina([{ id: "nav", type: "page_navigator", x: 10, y: 1030, width: 1900, height: 44 }]), A);
    expect(p.width).toBe(1280);
    expect(p.height).toBe(800);
    const o = p.objects[0];
    expect(o.x).toBeCloseTo(6.67, 2);
    expect(o.y).toBeCloseTo(1030 * 2 / 3 + 40, 1);
    expect(o.width).toBeCloseTo(1266.67, 1);
    expect((o.y ?? 0) + (o.height ?? 0)).toBeLessThanOrEqual(800);
  });

  it("linea, tubo e percorso di movimento si trasformano come punti", () => {
    const p = scalaPagina(pagina([
      { id: "l", type: "line", x: 0, y: 0, x2: 300, y2: 300 },
      { id: "t", type: "pipe", x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 900, y: 600 }] },
      { id: "m", type: "rect", x: 0, y: 0, motion_path: [{ x: 300, y: 0 }] },
    ]), A);
    expect([p.objects[0].x2, p.objects[0].y2]).toEqual([200, 240]);
    expect(p.objects[1].points).toEqual([{ x: 0, y: 40 }, { x: 600, y: 440 }]);
    expect(p.objects[2].motion_path).toEqual([{ x: 200, y: 40 }]);
  });

  it("testi e spessori seguono la scala con un minimo; i valori no", () => {
    const p = scalaPagina(pagina([
      { id: "a", type: "text", x: 0, y: 0, font_size: 12, stroke_width: 1 },
      { id: "b", type: "text", x: 0, y: 0, font_size: 30, rotation: 45, min: 0, max: 100 },
    ]), A);
    expect(p.objects[0].font_size).toBe(9);
    expect(p.objects[0].stroke_width).toBe(1);
    expect(p.objects[1].font_size).toBe(20);
    expect([p.objects[1].rotation, p.objects[1].min, p.objects[1].max]).toEqual([45, 0, 100]);
  });

  it("griglia: colonne, righe e figli delle celle (solo le misure)", () => {
    const p = scalaPagina(pagina([{
      id: "g", type: "grid", x: 0, y: 0, width: 600, height: 300, col_widths: [300, 300], row_heights: [150],
      grid_cells: [{ row: 0, col: 0, child: { id: "c", type: "text", x: 5, y: 7, font_size: 30, width: 90 } }],
    } as SynopticObject]), A);
    const g = p.objects[0];
    expect(g.col_widths).toEqual([200, 200]);
    expect(g.row_heights).toEqual([100]);
    const figlio = g.grid_cells?.[0].child;
    expect([figlio?.x, figlio?.y, figlio?.font_size, figlio?.width]).toEqual([5, 7, 20, 60]);
  });

  it("cornice: testata in alto, piede in basso, fasce scalate", () => {
    const c = scalaCornice({
      id: "cornice:base", name: "Base", kind: "cornice", width: 1920, height: 1080,
      cornice_testata: { altezza: 60 }, cornice_piede: { altezza: 90, sfondo: "#000000" },
      objects: [
        { id: "titolo", type: "text", x: 30, y: 45, font_size: 30 },
        { id: "nav", type: "page_navigator", x: 15, y: 1005, width: 1890, height: 60 },
      ],
    }, A);
    expect(c.cornice_testata?.altezza).toBe(40);
    expect(c.cornice_piede).toEqual({ altezza: 60, sfondo: "#000000" });
    expect([c.objects[0].x, c.objects[0].y]).toEqual([20, 30]);
    expect([c.objects[1].x, c.objects[1].y]).toEqual([10, 750]);
    expect((c.objects[1].y ?? 0) + (c.objects[1].height ?? 0)).toBe(790);
  });

  it("il «Da» proposto è la misura più frequente", () => {
    expect(misuraPiuFrequente([pagina([]), pagina([]), pagina([], 1280, 800)])).toEqual({ width: 1920, height: 1080 });
  });

  it("guardia: ogni campo numerico di SynopticObject è classificato", () => {
    const src = readFileSync(resolve(__dirname, "../src/types/index.ts"), "utf8");
    const inizio = src.indexOf("export interface SynopticObject {");
    const corpo = src.slice(inizio, src.indexOf("\n}", inizio));
    const numerici = [...corpo.matchAll(/^\s+([a-z_0-9]+)\??: (?:number|number\[\]|PipePoint\[\])\s*;/gm)].map((m) => m[1]);
    const noti = new Set<string>([...Object.keys(CAMPI_SCALATI), ...CAMPI_POSIZIONE, ...CAMPI_FISSI]);
    const mancanti = numerici.filter((c) => !noti.has(c));
    expect(mancanti, "campi numerici nuovi: classificali in src/scala/scalaPagina.ts").toEqual([]);
    expect(numerici.length).toBeGreaterThan(60);
  });
});
