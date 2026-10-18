/** L'elenco dei font (18-10-2026): la tabella del browser è la copia della fixture che
 *  legge anche il pannello LVGL (`lvgl_font.rs`), e i nomi scritti a mano si riconducono
 *  all'elenco senza toccare gli oggetti che sono già a posto. */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ALIAS_FONT, FAMIGLIE, FONT_PREDEFINITA, cssFamiglia, famigliaDi, normalizzaFontOggetti } from "../src/font/famiglie";
import type { SynopticObject } from "../src/types";

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/font.json"), "utf8"));

describe("elenco dei font", () => {
  it("la tabella del browser è la fixture", () => {
    expect(FAMIGLIE).toEqual(fixture.famiglie);
    expect(ALIAS_FONT).toEqual(fixture.alias);
    expect(FONT_PREDEFINITA).toBe(fixture.predefinita);
  });

  it("ogni file del browser c'è, in woff2", () => {
    for (const f of FAMIGLIE) {
      for (const nome of [f.file.regolare, f.file.grassetto].filter(Boolean)) {
        expect(existsSync(resolve(__dirname, `../public/fonts/${nome}.woff2`)), nome as string).toBe(true);
      }
    }
  });

  it("i nomi scritti a mano si riconducono all'elenco", () => {
    expect(famigliaDi("segmenti7")).toBe("segmenti7");
    expect(famigliaDi("monospace")).toBe("mono");
    expect(famigliaDi("system-ui, sans-serif, 'SWS Emoji'")).toBe("sans");
    expect(famigliaDi("Comic Sans MS")).toBeUndefined();
    expect(cssFamiglia("segmenti7")).toBe(`"SWS Segmenti 7", "SWS Sans", "SWS Emoji"`);
    expect(cssFamiglia("Comic Sans MS")).toBe("Comic Sans MS");
    expect(cssFamiglia(undefined)).toBeUndefined();
  });

  it("la normalizzazione cambia solo ciò che va cambiato", () => {
    const a = { id: "a", type: "text", x: 0, y: 0, font_family: "monospace" } as SynopticObject;
    const b = { id: "b", type: "text", x: 0, y: 0, font_family: "mono" } as SynopticObject;
    const c = { id: "c", type: "text", x: 0, y: 0, font_family: "Comic Sans MS" } as SynopticObject;
    const pulite = [b, c];
    expect(normalizzaFontOggetti(pulite)).toBe(pulite);
    const out = normalizzaFontOggetti([a, b, c]);
    expect(out.map((o) => o.font_family)).toEqual(["mono", "mono", "Comic Sans MS"]);
    expect(out[1]).toBe(b);
  });
});
