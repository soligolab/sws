import { describe, expect, it } from "vitest";
import { verticiPoligono } from "./forme";

// Gli stessi numeri di `vertici_poligono_come_il_web` in `sws-core/src/geometry.rs`.
const box = { x: 0, y: 0, width: 100, height: 100 };
describe("verticiPoligono", () => {
  it("esagono: il primo vertice in alto al centro", () => {
    const v = verticiPoligono({ ...box, sides: 6 });
    expect(v).toHaveLength(6);
    expect(v[0].x).toBeCloseTo(50); expect(v[0].y).toBeCloseTo(0);
    expect(v[1].x).toBeCloseTo(93.30127, 4); expect(v[1].y).toBeCloseTo(25);
  });
  it("stella a 5 punte: dieci vertici, il secondo interno a raggio 25", () => {
    const s = verticiPoligono({ ...box, sides: 5, star: true });
    expect(s).toHaveLength(10);
    expect(s[1].x).toBeCloseTo(64.69463, 4); expect(s[1].y).toBeCloseTo(29.77457, 4);
  });
  it("la rotazione sta nei vertici", () => {
    const r = verticiPoligono({ ...box, sides: 4, rotation: 90 });
    expect(r[0].x).toBeCloseTo(100); expect(r[0].y).toBeCloseTo(50);
  });
  it("i lati restano fra 3 e 24", () => {
    expect(verticiPoligono({ x: 0, y: 0, width: 10, height: 10, sides: 99 })).toHaveLength(24);
    expect(verticiPoligono({ x: 0, y: 0, width: 10, height: 10, sides: 1 })).toHaveLength(3);
  });
});
