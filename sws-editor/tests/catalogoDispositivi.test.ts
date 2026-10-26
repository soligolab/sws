import { describe, expect, it } from "vitest";
import { raggiungibile } from "../src/config/sorgenti/CatalogoDispositiviModal";

/** «Dal catalogo» offre solo i modelli che il bus sa raggiungere (25-10-2026):
 *  prima un MCM280X (solo TCP) si metteva su un bus RTU e nasceva muto. */
describe("il trasporto nel catalogo", () => {
  const tcp = { kind: "modbus_tcp" };
  const rtu = { kind: "modbus_rtu" };
  it("un modello solo TCP non si offre su un bus RTU, e viceversa", () => {
    expect(raggiungibile({ trasporto: "tcp" }, tcp)).toBe(true);
    expect(raggiungibile({ trasporto: "tcp" }, rtu)).toBe(false);
    expect(raggiungibile({ trasporto: "rtu" }, tcp)).toBe(false);
    expect(raggiungibile({ trasporto: "rtu" }, rtu)).toBe(true);
  });
  it("«entrambi», o un file utente senza trasporto, si offre ovunque", () => {
    expect(raggiungibile({ trasporto: "entrambi" }, rtu)).toBe(true);
    expect(raggiungibile({}, tcp)).toBe(true);
  });
});
