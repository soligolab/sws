import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PREDEFINITI, coloreEffettivo, estraiHex, normalizzaColore, normalizzaColoriPagine, predefinito, regola,
} from "../src/coloriPredefiniti";
import { oggettoNuovo } from "../src/editor/oggettiNuovi";
import { PALETTE_GROUPS } from "../src/editor/LeftPanel";
import type { SynopticObject, SynopticPage } from "../src/types";

/** Il colore che un oggetto ha quando il progetto non ne dichiara uno.
 *
 *  **I casi non stanno qui**: stanno in `tests/fixtures/colori-predefiniti.json`,
 *  alla radice del repo, e li legge anche il test Rust di lvgl_render.rs. Stessa
 *  scelta di `testiSistema.test.ts`: due motori disegnano gli stessi progetti e
 *  due tabelle separate divergono in silenzio — il 21-09-2026 un Testo nasceva
 *  bianco sul canvas e nero nel pannello, e un rettangolo aveva tre grigi diversi.
 */
type Regola = { auto: string } | { hex: string };
type Fixture = {
  auto: Record<string, { scuro: string; chiaro: string }>;
  predefiniti: Record<string, Record<string, Regola>>;
  lvgl: [string, string][];
  casi_normalizzazione: { ingresso: string; atteso: string | null }[];
};
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../tests/fixtures/colori-predefiniti.json"), "utf8"),
) as Fixture;

const TIPI = PALETTE_GROUPS.flatMap((g) => g.items.map((i) => i.type as SynopticObject["type"]));
const SCURO = "#1a1a2e";
const CHIARO = "#ffffff";

describe("coloriPredefiniti — la tabella condivisa col pannello LVGL", () => {
  it("il modulo e la fixture dicono la stessa cosa, voce per voce", () => {
    expect(PREDEFINITI).toEqual(fixture.predefiniti);
  });

  it("ogni coppia che LVGL disegna con un letterale è un hex fisso in tabella", () => {
    for (const [tipo, campo] of fixture.lvgl) {
      expect(predefinito(tipo, campo), `${tipo}.${campo}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("i toni automatici seguono lo sfondo", () => {
    const t: SynopticObject = { id: "t", type: "text", x: 0, y: 0 } as SynopticObject;
    expect(coloreEffettivo(t, "color", SCURO)).toBe(fixture.auto.testo.scuro);
    expect(coloreEffettivo(t, "color", CHIARO)).toBe(fixture.auto.testo.chiaro);
    const p: SynopticObject = { id: "p", type: "pipe", x: 0, y: 0 } as SynopticObject;
    expect(coloreEffettivo(p, "stroke", SCURO)).toBe(fixture.auto.sottile.scuro);
    expect(coloreEffettivo(p, "stroke", CHIARO)).toBe(fixture.auto.sottile.chiaro);
    // Senza sfondo: il token CSS, che solo l'SVG sa risolvere.
    expect(coloreEffettivo(t, "color")).toMatch(/^var\(--synoptic-text/);
    expect(coloreEffettivo(p, "stroke")).toMatch(/^var\(--synoptic-subtle/);
  });

  it("un colore esplicito vince, anche se scritto come var() vecchio", () => {
    const b: SynopticObject = { id: "b", type: "button", x: 0, y: 0, fill: "#123456" } as SynopticObject;
    expect(coloreEffettivo(b, "fill", SCURO)).toBe("#123456");
    expect(coloreEffettivo({ ...b, fill: "var(--brand-danger, #ef4444)" }, "fill", SCURO)).toBe("#ef4444");
    expect(coloreEffettivo({ ...b, fill: undefined }, "fill", SCURO)).toBe("#3b82f6");
    expect(coloreEffettivo(b, "color", SCURO)).toBe("#ffffff");
  });

  it("un campo senza regola per il tipo ripiega su «*», poi sul testo automatico", () => {
    expect(regola("trend", "bg_color")).toEqual({ hex: "#0f172a" });
    expect(regola("trend", "campo_inventato")).toBeUndefined();
    const tr: SynopticObject = { id: "x", type: "trend", x: 0, y: 0 } as SynopticObject;
    expect(coloreEffettivo(tr, "campo_inventato", SCURO)).toBe(fixture.auto.testo.scuro);
  });

  it("normalizzaColore: i casi della fixture", () => {
    for (const c of fixture.casi_normalizzazione) {
      expect(normalizzaColore(c.ingresso), JSON.stringify(c.ingresso)).toBe(c.atteso ?? undefined);
    }
    expect(normalizzaColore(undefined)).toBeUndefined();
  });

  it("estraiHex trova sempre sei cifre, o niente", () => {
    expect(estraiHex("var(--brand-text, #e2e8f0)")).toBe("#e2e8f0");
    expect(estraiHex("var(--synoptic-text, var(--brand-text, #E2E8F0))")).toBe("#e2e8f0");
    expect(estraiHex("#abc")).toBe("#aabbcc");
    expect(estraiHex("red")).toBeUndefined();
    expect(estraiHex(undefined)).toBeUndefined();
  });
});

describe("oggettoNuovo — nessun oggetto nasce con un var() dentro", () => {
  it("per ogni tipo della palette", () => {
    expect(TIPI.length).toBeGreaterThan(30);
    for (const tipo of TIPI) {
      const o = oggettoNuovo(tipo, 10, 20);
      if (o === null) { expect(["image", "symbol"]).toContain(tipo); continue; }
      const json = JSON.stringify(o);
      expect(json, `${tipo}: ${json}`).not.toContain("var(");
      expect(o.type).toBe(tipo);
    }
  });

  it("testo, linea e tubo nascono senza colore: seguono la pagina", () => {
    expect(oggettoNuovo("text", 0, 0)).not.toHaveProperty("color");
    expect(oggettoNuovo("line", 0, 0)).not.toHaveProperty("stroke");
    expect(oggettoNuovo("pipe", 0, 0)).not.toHaveProperty("stroke");
  });

  it("il bottone nasce con il colore fisso della tabella", () => {
    expect(oggettoNuovo("button", 0, 0)?.fill).toBe(predefinito("button", "fill"));
    expect(oggettoNuovo("rect", 0, 0)?.fill).toBe(predefinito("rect", "fill"));
    expect(oggettoNuovo("led", 0, 0)?.off_color).toBe(predefinito("led", "off_color"));
  });
});

describe("normalizzaColoriPagine — i progetti vecchi si ripuliscono all'apertura", () => {
  const pagina = (objects: Partial<SynopticObject>[]): SynopticPage =>
    ({ id: "p1", name: "P", objects: objects as SynopticObject[] }) as SynopticPage;

  it("var() del testo → assente, altri var() → hex, anche nelle entries annidate", () => {
    const [p] = normalizzaColoriPagine([pagina([
      { id: "a", type: "text", x: 0, y: 0, color: "var(--brand-text, #e2e8f0)" },
      { id: "b", type: "button", x: 0, y: 0, fill: "var(--brand-primary, #3b82f6)" },
      { id: "c", type: "text_list", x: 0, y: 0, text_list_entries: [{ value: 1, label: "L", color: "var(--brand-success, #22c55e)" }] as never,
        text_list_default_color: "var(--brand-danger, #ef4444)" },
      { id: "d", type: "bar_chart", x: 0, y: 0, bar_series: [{ tag: "", label: "S", color: "var(--brand-warning, #f59e0b)" }] as never },
      { id: "e", type: "grid", x: 0, y: 0, grid_border_color: "var(--brand-text-subtle, #64748b)" },
    ])]);
    const o = Object.fromEntries(p.objects.map((x) => [x.id, x]));
    expect(o.a).not.toHaveProperty("color");
    expect(o.b.fill).toBe("#3b82f6");
    expect((o.c.text_list_entries as { color: string }[])[0].color).toBe("#22c55e");
    expect(o.c.text_list_default_color).toBe("#ef4444");
    expect((o.d.bar_series as { color: string }[])[0].color).toBe("#f59e0b");
    expect(o.e.grid_border_color).toBe("#64748b");
    expect(JSON.stringify(p)).not.toContain("var(");
  });

  it("se non c'è niente da cambiare ritorna lo stesso riferimento", () => {
    const pages = [pagina([{ id: "a", type: "rect", x: 0, y: 0, fill: "#4a90d9" }, { id: "b", type: "text", x: 0, y: 0 }])];
    expect(normalizzaColoriPagine(pages)).toBe(pages);
  });

  it("gli hex esistenti e i nomi restano com'erano (solo il var() si tocca)", () => {
    const [p] = normalizzaColoriPagine([pagina([{ id: "a", type: "rect", x: 0, y: 0, fill: "#ABCDEF", stroke: "red" }])]);
    expect(p.objects[0].fill).toBe("#ABCDEF");
    expect(p.objects[0].stroke).toBe("red");
  });
});
