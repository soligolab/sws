import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initialDraft, press, validateDraft } from "../src/components/numericKeypadLogic";

// The cases shared with `sws-lvgl-viewer/src/numeric_keypad.rs` are in
// `tests/fixtures/tastierino-numerico.json`.
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/tastierino-numerico.json"), "utf8")) as {
  tasti: { nome: string; iniziale: number | null; tasti: string[]; atteso: string }[];
  conferme: { nome: string; bozza: string; min: number | null; max: number | null; atteso: { valore?: number; errore?: string } }[];
};

describe("numeric keypad — keys, shared with the LVGL card", () => {
  it.each(fixture.tasti)("$nome", (c) => {
    const initial = c.iniziale ?? undefined;
    const draft = c.tasti.reduce((d, k) => press(d, k, initial), initialDraft(initial));
    expect(draft).toBe(c.atteso);
  });
});

describe("numeric keypad — confirmation, shared with the LVGL card", () => {
  it.each(fixture.conferme)("$nome", (c) => {
    const r = validateDraft(c.bozza, c.min ?? undefined, c.max ?? undefined);
    if (c.atteso.errore) expect("error" in r && r.error.kind).toBe(c.atteso.errore);
    else expect(r).toEqual({ value: c.atteso.valore });
  });
});
