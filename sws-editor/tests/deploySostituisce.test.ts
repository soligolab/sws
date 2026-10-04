import { describe, expect, it } from "vitest";
import "../src/i18n";
import { testoSostituzione } from "../src/store";

/** La conferma prima di un deploy che cancella dal pannello progetti con un
 *  altro nome (03-10-2026: `rc14_lvgl` sparito dal TC620 senza una domanda). */
describe("testoSostituzione", () => {
  it("nomina il progetto in arrivo, quelli che spariscono e il peso dello storico", () => {
    const t = testoSostituzione("tc620-sistema", [{ nome: "rc14_lvgl", storico_byte: 51_000_000 }]);
    expect(t).toContain("tc620-sistema");
    expect(t).toContain("rc14_lvgl");
    expect(t).toContain("51.0");
  });
  it("senza peso (pannello più vecchio) nomina lo stesso il progetto", () => {
    const t = testoSostituzione("x", [{ nome: "vecchio", storico_byte: null }]);
    expect(t).toContain("vecchio");
    expect(t).not.toContain("MB");
  });
});
