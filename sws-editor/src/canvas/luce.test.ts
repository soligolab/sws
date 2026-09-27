import { describe, expect, it } from "vitest";
import { fattoreFondoRespiro, luminositaValida, parametriLuminosita } from "./luce";

// Gli stessi numeri stanno nei test di `sws-lvgl-viewer/src/effects.rs`
// (`luminosita_come_il_web`): se cambiano qui, cambiano là.
describe("luminosità", () => {
  it("0 non fa niente", () => expect(parametriLuminosita(0)).toBeNull());
  it("negativa scurisce moltiplicando", () => expect(parametriLuminosita(-40)).toEqual({ slope: 0.6, intercept: 0 }));
  it("positiva schiarisce verso il bianco", () => expect(parametriLuminosita(25)).toEqual({ slope: 0.75, intercept: 0.25 }));
  it("fuori scala si ferma ai bordi, e un non-numero vale 0", () => {
    expect(luminositaValida(250)).toBe(100);
    expect(luminositaValida(-300)).toBe(-100);
    expect(luminositaValida("x")).toBe(0);
    expect(parametriLuminosita(-100)).toEqual({ slope: 0, intercept: 0 });
  });
});

describe("respiro del lampeggio sfumato", () => {
  it("default −60 %: fondo a 0,4", () => expect(fattoreFondoRespiro(undefined)).toBeCloseTo(0.4));
  it("profondità scelta", () => expect(fattoreFondoRespiro(-25)).toBeCloseTo(0.75));
  it("positiva non ammessa: nessun respiro", () => expect(fattoreFondoRespiro(30)).toBe(1));
});
