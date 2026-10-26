import { describe, expect, it } from "vitest";
import { conParametro, indirizzoScrittura, parametriSetup } from "../src/config/sorgenti/setupModulo";
import type { VoceCatalogo } from "../src/types";

/** Il configuratore dei moduli (25-10-2026) dal lato dell'IDE: quali parametri
 *  si offrono, dove si scrivono, e il setup che ne esce. */
const voce = {
  id: "pixsys/mcm260x-5ad", marca: "Pixsys", modello: "MCM260X-5AD", origine: "prodotto",
  modbus: { setup_ritardato: { da: 2001, a: 2100, scostamento: 2000 } },
  registri: [
    { nome: "indirizzo_slave", indirizzo: 2, accesso: "rw", gruppo: "configurazione", setup: false },
    { nome: "compatibilita_mcm260", indirizzo: 3, accesso: "rw", gruppo: "configurazione" },
    { nome: "tipo_sensore_ai1", indirizzo: 2021, accesso: "rw", gruppo: "configurazione", valori: { "0": { it: "disabilitato", en: "disabled" }, "12": { it: "PTC1K", en: "PTC1K" } } },
    { nome: "ai1", indirizzo: 0, accesso: "r", gruppo: "ingressi" },
  ],
} as unknown as VoceCatalogo;

describe("il setup del modulo", () => {
  it("offre solo i parametri di configurazione scrivibili, non indirizzo e baud", () => {
    expect(parametriSetup(voce).map((r) => r.nome)).toEqual(["compatibilita_mcm260", "tipo_sensore_ai1"]);
  });
  it("sugli MCM260X l'area 2001-2100 si scrive 2000 più in là", () => {
    expect(indirizzoScrittura(voce, 2021)).toBe(4021);
    expect(indirizzoScrittura(voce, 3)).toBeUndefined();
  });
  it("fissa, cambia e toglie un parametro, nell'ordine del catalogo", () => {
    const [compat, ai1] = parametriSetup(voce);
    let s = conParametro(undefined, voce, ai1, 12);
    s = conParametro(s, voce, compat, 1);
    expect(s).toEqual([
      { nome: "compatibilita_mcm260", indirizzo: 3, valore: 1 },
      { nome: "tipo_sensore_ai1", indirizzo: 2021, valore: 12, indirizzo_scrittura: 4021 },
    ]);
    expect(conParametro(s, voce, ai1, undefined).map((p) => p.nome)).toEqual(["compatibilita_mcm260"]);
  });
});
