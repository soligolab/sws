import { describe, expect, it } from "vitest";
import { registriDiTipo, registriMappatura, tipoSuggeritoModbus } from "../src/config/sorgenti/modbusRegistri";

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

describe("un nome storico su un'area a bit", () => {
  it("si legge un bit, ed è un bool: niente «u16 (come prima)»", () => {
    const p = { types: [], tags: [{ id: "allarme", description: "", data_type: "bool" as const }] };
    expect(registriMappatura("allarme", "coil", p)).toEqual({ n: 1, dettaglio: "bool", storico: false });
    expect(registriMappatura("allarme", "holding", p).storico).toBe(true);
  });
});

describe("tipoSuggeritoModbus — il tipo del «＋» segue l'area", () => {
  it("bit e aree a bit → bool", () => {
    expect(tipoSuggeritoModbus("coil")).toBe("bool");
    expect(tipoSuggeritoModbus("discrete")).toBe("bool");
    expect(tipoSuggeritoModbus("holding", { bit: 3 })).toBe("bool");
  });
  it("registri senza formato → i16, mai f64", () => {
    expect(tipoSuggeritoModbus("holding")).toBe("i16");
    expect(tipoSuggeritoModbus("input")).toBe("i16");
    expect(tipoSuggeritoModbus(undefined)).toBe("i16");
    expect(registriDiTipo(tipoSuggeritoModbus("holding"))).toBe(1);
  });
  it("il formato sul filo decide, la scala lo fa decimale", () => {
    expect(tipoSuggeritoModbus("holding", { formato: "u32", scale: 1 })).toBe("u32");
    expect(tipoSuggeritoModbus("input", { formato: "i16", scale: 0.1 })).toBe("f64");
    expect(tipoSuggeritoModbus("holding", { formato: "F32" })).toBe("f32");
    expect(tipoSuggeritoModbus("holding", { formato: "sconosciuto" })).toBe("i16");
  });
});
