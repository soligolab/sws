/** La geometria pura delle planimetrie (29-10-2026): dove sta un'apertura sul
 *  suo muro, e come il muro si spezza per lasciare il vano — senza CSG. */
import { describe, expect, it } from "vitest";
import {
  idNuovo, ingombro, lunghezza, normalizza, nuovaPlanimetria, proiezione, puntoA, senzaOrfani, spigoliBlocco,
  trattiDelMuro, type Apertura, type Muro,
} from "../src/planimetrie/modello";

const muro: Muro = { id: "m1", punti: [[0, 0], [10, 0], [10, 8]], spessore: 0.2, altezza: 2.7 };
const porta = (t: number, larghezza = 1): Apertura => ({ id: "p", muro: "m1", t, larghezza, altezza: 2.1, tipo: "porta" });

describe("lungo il muro", () => {
  it("lunghezza e punto a frazione, attraverso un angolo", () => {
    expect(lunghezza(muro.punti)).toBe(18);
    expect(puntoA(muro.punti, 0.5)).toMatchObject({ x: 9, y: 0 });
    const dopo = puntoA(muro.punti, 14 / 18);
    expect(dopo.x).toBeCloseTo(10);
    expect(dopo.y).toBeCloseTo(4);
    expect(dopo.angolo).toBeCloseTo(Math.PI / 2);
  });

  it("la proiezione dice dove e quanto lontano si è cliccato", () => {
    const p = proiezione(muro.punti, [5, 0.3]);
    expect(p.t).toBeCloseTo(5 / 18);
    expect(p.distanza).toBeCloseTo(0.3);
  });
});

describe("il muro spezzato alle aperture", () => {
  it("senza aperture è un tratto pieno", () => {
    expect(trattiDelMuro(muro, [])).toEqual([{ da: 0, a: 18, pieni: [[0, 2.7]] }]);
  });

  it("una porta lascia l'architrave, una finestra anche il davanzale", () => {
    const t = trattiDelMuro(muro, [porta(5 / 18)]);
    expect(t.map((x) => [x.da, x.a])).toEqual([[0, 4.5], [4.5, 5.5], [5.5, 18]]);
    expect(t[1].pieni[0][0]).toBeCloseTo(2.1);
    const finestra: Apertura = { id: "f", muro: "m1", t: 0.5, larghezza: 1.2, altezza: 1.2, tipo: "finestra", da_terra: 0.9 };
    const vano = trattiDelMuro(muro, [finestra])[1];
    expect(vano.pieni).toHaveLength(2);
    expect(vano.pieni[0]).toEqual([0, 0.9]);
    expect(vano.pieni[1][0]).toBeCloseTo(2.1);
  });

  it("due aperture sullo stesso tratto restano due vani; sovrapposte si fondono", () => {
    expect(trattiDelMuro(muro, [porta(2 / 18), porta(6 / 18)])).toHaveLength(5);
    const fusi = trattiDelMuro(muro, [porta(5 / 18, 2), porta(5.5 / 18, 2)]);
    expect(fusi).toHaveLength(3);
    expect(fusi[1].da).toBeCloseTo(4);
    expect(fusi[1].a).toBeCloseTo(6.5);
  });

  it("un'apertura su un capo si taglia al muro; una di un altro muro non conta", () => {
    expect(trattiDelMuro(muro, [porta(0)])[0]).toMatchObject({ da: 0, a: 0.5 });
    expect(trattiDelMuro(muro, [{ ...porta(0.5), muro: "altro" }])).toHaveLength(1);
  });
});

describe("il resto", () => {
  it("id nuovi brevi e unici", () => {
    expect(idNuovo("m", ["m1", "m2", "b1"])).toBe("m3");
  });

  it("un blocco ruotato di 90° scambia larghezza e profondità", () => {
    const s = spigoliBlocco({ id: "b", x: 0, y: 0, larghezza: 2, profondita: 1, altezza: 1, rotazione: 90, colore: "#000" });
    const xs = s.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1);
  });

  it("ingombro con margine, e una pianta vuota ha una misura sua", () => {
    expect(ingombro(nuovaPlanimetria("x", "X"))).toEqual({ x: -1, y: -1, w: 12, h: 10 });
    expect(ingombro({ ...nuovaPlanimetria("x", "X"), muri: [muro] })).toEqual({ x: -1, y: -1, w: 12, h: 10 });
  });

  it("le aperture di un muro tolto se ne vanno con lui", () => {
    const p = { ...nuovaPlanimetria("x", "X"), aperture: [porta(0.5)] };
    expect(senzaOrfani(p).aperture).toEqual([]);
  });

  it("un file a metà si completa, senza perdere quello che porta", () => {
    const p = normalizza({ id: "casa", nome: "Casa", muri: [muro] } as never);
    expect(p.aree).toEqual([]);
    expect(p.muri).toHaveLength(1);
    expect(p.unita_px_m).toBe(50);
  });
});
