import { describe, expect, it } from "vitest";
import { registriDiTipo, registriMappatura } from "../src/config/sorgenti/modbusRegistri";

const project = {
  types: [{ id: "motore", description: "", members: [
    { name: "marcia", data_type: "bool" }, { name: "velocita", data_type: "f32" }, { name: "ore", data_type: "u32" },
  ] }],
  tags: [
    { id: "m1", description: "", type_ref: "motore" },
    { id: "vecchio", description: "", data_type: "float" },
    { id: "t", description: "", data_type: "i16" },
    { id: "nome", description: "", data_type: "string(10)" },
  ],
} as never;

/** Gemello di codec.rs (Fase 3, 04-10-2026). */
describe("registri di una mappatura Modbus", () => {
  it("dal tipo", () => {
    expect([registriDiTipo("u16"), registriDiTipo("f32"), registriDiTipo("f64"), registriDiTipo("bool"), registriDiTipo("string(5)")])
      .toEqual([1, 2, 4, 1, 3]);
  });
  it("un nome storico legge un u16 come prima", () => {
    expect(registriMappatura("vecchio", "holding", project)).toEqual({ n: 1, dettaglio: "u16", storico: true });
  });
  it("un'istanza è un blocco: somma dei membri, o un bit per membro sulle aree a bit", () => {
    expect(registriMappatura("m1", "holding", project).n).toBe(5);
    expect(registriMappatura("m1", "coil", project).n).toBe(3);
  });
  it("una foglia ha il tipo del suo membro", () => {
    expect(registriMappatura("m1.velocita", "holding", project)).toMatchObject({ n: 2, dettaglio: "f32" });
  });
  it("tipi ricchi e testo", () => {
    expect(registriMappatura("t", undefined, project).n).toBe(1);
    expect(registriMappatura("nome", "holding", project).n).toBe(5);
  });
});
