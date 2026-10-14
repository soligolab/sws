import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicaStile, numeroStile, type StileSimbolo } from "../src/symbols/lib/applicaStile";
import type { ManifestLib } from "../src/symbols/lib/manifest";

/** «Applica stile» dei simboli di libreria.
 *
 *  **I casi non stanno qui**: stanno in `tests/fixtures/stile-simboli.json`, alla
 *  radice del repo, e li verifica anche `sws-core/src/stile_simboli.rs`. Il web e il
 *  pannello LVGL devono scrivere nello stesso SVG lo stesso stile, o lo stesso
 *  progetto avrebbe due aspetti.
 */
type Caso = { nome: string; svg: string; stile: StileSimbolo; atteso: string };
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../tests/fixtures/stile-simboli.json"), "utf8"),
) as { casi: Caso[] };

const LIB = resolve(__dirname, "../public/symbols/lib");
const manifest = JSON.parse(readFileSync(resolve(LIB, "manifest.json"), "utf8")) as ManifestLib;

describe("applicaStile — i casi condivisi col pannello", () => {
  for (const caso of fixture.casi) {
    it(caso.nome, () => {
      expect(applicaStile(caso.svg, caso.stile)).toBe(caso.atteso);
    });
  }
});

describe("applicaStile — sui disegni veri della libreria", () => {
  const neutro: StileSimbolo = { materials: manifest.materials, volume: 100, outline: { color: "#1c2329", width: 1 } };
  for (const s of manifest.symbols) {
    it(`${s.id}: lo stile del disegno lascia il file identico`, () => {
      const svg = readFileSync(resolve(LIB, s.file), "utf8");
      expect(applicaStile(svg, neutro)).toBe(svg);
    });
  }

  it("ritingere un materiale cambia solo le forme di quel materiale", () => {
    const s = manifest.symbols.find((x) => x.id === "lib:process/centrifugal-pump")!;
    const svg = readFileSync(resolve(LIB, s.file), "utf8");
    const out = applicaStile(svg, { materials: { steel: "#ff00ff" }, volume: 100, outline: { color: "#1c2329", width: 1 } });
    const righeCambiate = svg.split("\n").filter((r, i) => r !== out.split("\n")[i]);
    expect(righeCambiate.length).toBeGreaterThan(0);
    for (const r of righeCambiate) expect(r).toContain('data-mat="steel"');
  });
});

describe("numeroStile — lo stesso testo che scrive Rust", () => {
  it.each([
    [1, "1"], [1.5, "1.5"], [0.7 * 1.5, "1.05"], [0.7 * 0.6667, "0.467"], [2 / 3, "0.667"],
    [0, "0"], [0.0004, "0"], [0.0005, "0.001"], [12.3456, "12.346"], [-0.25, "-0.25"],
  ])("%d → %s", (x, atteso) => {
    expect(numeroStile(x)).toBe(atteso);
  });
});
