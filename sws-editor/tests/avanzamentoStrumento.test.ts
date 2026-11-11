// La chat dice che l'assistente sta scrivendo (11-11-2026): una proposta su sei
// pagine sono minuti di input, e la riga ferma su «… valida» sembrava morta.

import { describe, expect, it } from "vitest";

import { aggiornaStrumento, avanzamento } from "@/components/ChatPanel";

describe("avanzamento di uno strumento", () => {
  it("kB arrotondati, mai zero, e minuti:secondi", () => {
    expect(avanzamento(38_900, 134)).toEqual({ kb: "38", tempo: "2:14" });
    expect(avanzamento(200, 5)).toEqual({ kb: "1", tempo: "0:05" });
  });

  it("«scrivo» aggiorna la riga dello strumento invece di aggiungerne una", () => {
    let righe = aggiornaStrumento([], "valida", "inizio");
    righe = aggiornaStrumento(righe, "valida", "scrivo", undefined, 4096, 3);
    righe = aggiornaStrumento(righe, "valida", "scrivo", undefined, 9000, 4);
    expect(righe).toEqual([
      { tipo: "strumento", nome: "valida", stato: "scrivo", messaggio: undefined, byte: 9000, secondi: 4 },
    ]);
  });
});
