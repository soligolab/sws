/** La tendina fuori dal flusso (17-10-2026): dove si mette, rispetto al campo e
 *  alla finestra. jsdom non fa layout, quindi si prova la funzione pura. */
import { describe, it, expect } from "vitest";
import { posizionaTendina } from "../src/components/TendinaFluttuante";

const campo = (left: number, top: number, width = 140, h = 24) => ({ left, top, right: left + width, bottom: top + h, width });

describe("posizione della tendina", () => {
  it("sotto il campo, allineata a sinistra, larga almeno quanto il campo", () => {
    const p = posizionaTendina(campo(100, 100), 1280, 800, 300, 150, 260, 520);
    expect(p).toMatchObject({ left: 100, top: 126, minWidth: 140 });
    expect(p.bottom).toBeUndefined();
  });
  it("vicino al bordo destro si sposta a sinistra per restare dentro", () => {
    // il caso del pannello proprietà, sul bordo destro della finestra
    const p = posizionaTendina(campo(1180, 100, 90), 1280, 800, 420, 150, 260, 520);
    expect(p.left).toBe(1280 - 420 - 6);
  });
  it("in fondo alla finestra si ribalta sopra il campo", () => {
    const p = posizionaTendina(campo(100, 740), 1280, 800, 300, 200, 260, 520);
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(800 - 740 + 2);
    expect(p.maxHeight).toBeLessThanOrEqual(260);
  });
  it("non è mai più larga della finestra", () => {
    const p = posizionaTendina(campo(10, 100), 400, 800, 900, 100, 260, 520);
    expect(p.maxWidth).toBe(400 - 12);
    expect(p.left).toBe(6);
  });
});
