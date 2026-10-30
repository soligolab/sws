/** Le icone della piastra: la copia web è uguale alla tabella condivisa con LVGL. */
import { describe, it, expect } from "vitest";
import tabella from "../../tests/fixtures/icone-slider.json";
import { ICONE_SLIDER } from "../src/canvas/slider/icone";

describe("icone dello slider", () => {
  it("sono le stesse otto della tabella condivisa", () => {
    expect(ICONE_SLIDER).toEqual(tabella.icone);
    expect(Object.keys(ICONE_SLIDER)).toHaveLength(8);
  });
});
