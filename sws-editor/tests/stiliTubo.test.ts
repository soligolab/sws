/** Gli stili 2.5D del tubo (15-10-2026, piano docs/plans/2026-10-15-tubazioni-bocche-e-stili.md,
 *  ramo B): la stessa stringa SVG del pannello (`sws-core/src/stili_tubo.rs`). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STILI_TUBO, estremitaEffettiva, num, stileTubo, svgTubo } from "../src/canvas/stiliTubo";

const fx = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/stili-tubo.json"), "utf8")) as {
  stili: unknown[];
  casi: { nome: string; punti: [number, number][]; stile: string; d: number; colore_stato?: string; stroke?: string;
    materiali?: Record<string, string>; volume: number; contorno: [string, number];
    estremita: [string | null, string | null]; bocche: [number | null, number | null]; atteso: string }[];
};

describe("stili del tubo — gli stessi del pannello", () => {
  it("la tabella è quella della fixture", () => {
    expect(STILI_TUBO).toEqual(fx.stili);
  });
  for (const c of fx.casi) {
    it(c.nome, () => {
      expect(svgTubo({
        id: "t", punti: c.punti.map(([x, y]) => ({ x, y })), stile: stileTubo(c.stile)!, d: c.d,
        coloreStato: c.colore_stato, stroke: c.stroke, materiali: c.materiali ?? {}, volume: c.volume,
        contorno: c.contorno, estremita: [c.estremita[0] ?? undefined, c.estremita[1] ?? undefined],
        bocche: [c.bocche[0] ?? undefined, c.bocche[1] ?? undefined],
      })).toBe(c.atteso);
    });
  }
  it("auto e i numeri come in Rust", () => {
    const m = stileTubo("metallo")!;
    expect(estremitaEffettiva(m, undefined, 10, 10)).toBe("flange");
    expect(estremitaEffettiva(m, "auto", 6, 10)).toBe("reducer");
    expect(estremitaEffettiva(m, undefined, undefined, 10)).toBe("none");
    expect(estremitaEffettiva(stileTubo("canale")!, undefined, 4, 16)).toBe("collar");
    expect([num(2), num(1.15), num(-0.001), num(0.1 + 0.2)]).toEqual(["2", "1.15", "0", "0.3"]);
  });
});
