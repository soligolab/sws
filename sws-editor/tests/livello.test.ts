import { describe, it, expect } from "vitest";
import { frazioneLivello } from "../src/canvas/livello";

/** Il livello dall'intervallo del tag (03-11-2026, decisione del maintainer):
 *  `livello` 0–1000 mm riempiva tutto il serbatoio già a 100. */
describe("frazioneLivello", () => {
  const tag = { range_lo: 0, range_hi: 1000 };
  it("senza scala scelta prende l'intervallo del tag", () => {
    expect(frazioneLivello(250, {}, tag)).toBeCloseTo(0.25);
  });
  it("una scala scelta vince sul tag", () => {
    expect(frazioneLivello(25, { fill_level_scale: "0-100" }, tag)).toBeCloseTo(0.25);
    expect(frazioneLivello(0.4, { fill_level_scale: "0-1" }, tag)).toBeCloseTo(0.4);
  });
  it("l'intervallo scritto sull'oggetto vince su tutto", () => {
    expect(frazioneLivello(500, { fill_level_min: 100, fill_level_max: 900, fill_level_scale: "0-1" }, tag)).toBeCloseTo(0.5);
  });
  it("senza niente resta 0–100, come prima", () => {
    expect(frazioneLivello(40, {})).toBeCloseTo(0.4);
    expect(frazioneLivello(40, {}, { range_lo: 5, range_hi: 5 })).toBeCloseTo(0.4);
  });
});
