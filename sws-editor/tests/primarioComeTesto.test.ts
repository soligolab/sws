/** Il colore primario usato come testo, per ogni marchio (28-10-2026).
 *
 *  Nato dalla prima misura del contrasto sulla scelta del progetto: il
 *  collegamento «Installa il runtime su un dispositivo» era il primario del
 *  marchio usato come testo, e sul fondo chiaro dava 3,5:1. La guardia
 *  `check_contrasto.sh` ora misura col marchio del repo — per non dare risultati
 *  diversi a seconda della macchina — quindi **gli altri marchi li prova
 *  questa**, e il caso che ha fatto nascere tutto è proprio un altro marchio. */
import { describe, expect, it } from "vitest";
import { testoLeggibile } from "@/theme";

function lum(hex: string): number {
  const c = [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
const contrasto = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// Le superfici del tema chiaro e di quello scuro (`theme.ts`, LIGHT_/DARK_NEUTRALS).
const CHIARO = ["#f8fafc", "#ffffff", "#f1f5f9"];
const SCURO = ["#0f172a", "#1e293b", "#334155"];

const MARCHI: Record<string, string> = {
  "SWS (blu)": "#3b82f6",
  "Pixsys (arancione)": "#dd5d21",
  "un verde chiaro": "#4ade80",
  "un giallo": "#facc15",
};

describe("il primario come testo si legge, con qualunque marchio", () => {
  for (const [nome, primario] of Object.entries(MARCHI)) {
    it(`${nome}: almeno 4,5:1 su tutte le superfici, in tutti e due i temi`, () => {
      const chiaro = testoLeggibile(primario, CHIARO, "#0f172a");
      for (const sf of CHIARO) expect(contrasto(chiaro, sf), `${chiaro} su ${sf}`).toBeGreaterThanOrEqual(4.5);
      const scuro = testoLeggibile(primario, SCURO, "#f8fafc");
      for (const sf of SCURO) expect(contrasto(scuro, sf), `${scuro} su ${sf}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("i due marchi veri, prima del rimedio, NON passavano: la prova parte da un difetto vero", () => {
    expect(contrasto("#3b82f6", "#f8fafc")).toBeLessThan(4.5);
    expect(contrasto("#dd5d21", "#f8fafc")).toBeLessThan(4.5);
  });

  it("un colore già leggibile esce identico: si sposta solo quanto basta", () => {
    expect(testoLeggibile("#1e3a8a", CHIARO, "#0f172a")).toBe("#1e3a8a");
  });

  it("e resta del marchio: l'arancione scurito è ancora arancione, non grigio", () => {
    const c = testoLeggibile("#dd5d21", CHIARO, "#0f172a");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(1 + i, 3 + i), 16));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("un colore scritto in un'altra forma passa invariato invece di rompersi", () => {
    expect(testoLeggibile("var(--x)", CHIARO, "#0f172a")).toBe("var(--x)");
  });
});
