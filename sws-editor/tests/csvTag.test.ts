import { describe, it, expect } from "vitest";
import { COLONNE_CSV, csvVariabiliETipi } from "../src/tag/csvTag";
import type { TagDef, TypeDef } from "../src/types";

/** Fase 2: un CSV solo per variabili e tipi. Esportare le prime senza i
 *  secondi dava un'istanza di un tipo inesistente — un file che non si può
 *  reimportare. Segnalato dal maintainer il 22-09-2026. */

const types: TypeDef[] = [{
  id: "Motore",
  description: "Motore asincrono",
  members: [
    { name: "velocita", data_type: "f32", unit: "rpm", eng_max: 3000 },
    { name: "marcia", data_type: "bool", history: false },
  ],
}] as TypeDef[];

const tags: TagDef[] = [
  { id: "motore1", data_type: "bool", type_ref: "Motore", description: "Il primo", history: true },
  { id: "zone", data_type: "f32", array: [2, 3], unit: "°C", history: true },
] as TagDef[];

const righe = (csv: string) => csv.split("\n");

/** Il lettore che ha il server, in piccolo: serve a provare che ciò che
 *  l'esportazione scrive si rilegge nelle stesse colonne. */
function leggiRiga(r: string): string[] {
  const out: string[] = [];
  let campo = "";
  let fraVirgolette = false;
  for (let i = 0; i < r.length; i++) {
    const c = r[i];
    if (fraVirgolette) {
      if (c === '"' && r[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') fraVirgolette = false;
      else campo += c;
    } else if (c === '"' && campo === "") fraVirgolette = true;
    else if (c === ",") { out.push(campo); campo = ""; }
    else campo += c;
  }
  out.push(campo);
  return out;
}
const campo = (r: string, nome: string) => {
  const i = COLONNE_CSV.indexOf(nome as (typeof COLONNE_CSV)[number]);
  return r.split(",")[i];
};

describe("csvVariabiliETipi", () => {
  it("porta tipi, membri e variabili in un file solo, i tipi per primi", () => {
    const r = righe(csvVariabiliETipi(tags, types));
    expect(r[0]).toBe(COLONNE_CSV.join(","));
    expect(r.slice(1).map((x) => campo(x, "kind"))).toEqual(["type", "member", "member", "tag", "tag"]);
    // L'import applica i tipi per primi: un'istanza senza il suo tipo è una
    // forma che non sta in piedi.
    expect(r.slice(1).map((x) => campo(x, "id")))
      .toEqual(["Motore", "velocita", "marcia", "motore1", "zone"]);
  });

  it("il membro porta il suo tipo in «owner» e il suo nome in «id»", () => {
    const r = righe(csvVariabiliETipi([], types));
    expect(campo(r[2], "owner")).toBe("Motore");
    expect(campo(r[2], "id")).toBe("velocita");
    expect(campo(r[2], "unit")).toBe("rpm");
    expect(campo(r[2], "eng_max")).toBe("3000");
    expect(campo(r[3], "history")).toBe("false");
  });

  it("l'istanza tiene il suo tipo e l'array le sue dimensioni", () => {
    const r = righe(csvVariabiliETipi(tags, []));
    expect(campo(r[1], "type_ref")).toBe("Motore");
    // Le dimensioni con la «x»: una virgola costringerebbe alle virgolette
    // ogni riga di un array.
    expect(campo(r[2], "array")).toBe("2x3");
    expect(campo(r[2], "unit")).toBe("°C");
  });

  it("virgole, virgolette e a capo passano fra virgolette e non spostano le colonne", () => {
    const csv = csvVariabiliETipi(
      [{ id: "t1", data_type: "f32", description: 'pompa 1, mandata "grande"\nseconda riga', history: true, unit: "bar" }] as TagDef[],
      [],
    );
    const r = righe(csv)[1] + "\n" + righe(csv)[2]; // l'a capo è dentro le virgolette
    expect(r).toContain('"pompa 1, mandata ""grande""');
    // La descrizione non ha spostato di un posto le colonne dopo di sé: chi
    // legge davvero il file (il server) le ritrova dove devono stare.
    const letto = leggiRiga(r);
    expect(letto[COLONNE_CSV.indexOf("description")]).toBe('pompa 1, mandata "grande"\nseconda riga');
    expect(letto[COLONNE_CSV.indexOf("unit")]).toBe("bar");
    expect(letto[COLONNE_CSV.indexOf("history")]).toBe("true");
  });

  it("un progetto senza tipi esporta solo le variabili, senza righe vuote", () => {
    const r = righe(csvVariabiliETipi(tags, []));
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.trim() !== "")).toBe(true);
  });
});
