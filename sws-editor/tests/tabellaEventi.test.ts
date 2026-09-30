import { describe, expect, it } from "vitest";
import { TABELLA_PREDEFINITA } from "../src/types";
import fixture from "../../tests/fixtures/tabella-eventi-predefinita.json";

/** La tabella eventi × canali predefinita è la stessa in Rust e qui (29-09-2026). */
describe("tabella eventi × canali", () => {
  it("i default dell'editor sono quelli della fixture condivisa col runtime", () => {
    expect(TABELLA_PREDEFINITA).toEqual(fixture.tabella);
  });
});
