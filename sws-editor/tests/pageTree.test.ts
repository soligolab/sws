import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appiattisci, aggiungi, discendentiDi, spostaRispettoA, ordinaPagine, posizioneDi, righe, riconcilia, rimuovi, sposta } from "../src/pageTree";
import type { PageTreeNode } from "../src/types";

// I casi condivisi con `sws-core/src/page_tree.rs` stanno in
// `tests/fixtures/albero-pagine.json`: due implementazioni della stessa tabella
// divergerebbero in silenzio (menù diverso fra editor e pannello).

type Alb = PageTreeNode[] | null;
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/albero-pagine.json"), "utf8")) as {
  riconcilia: { nome: string; albero: Alb; pagine: string[]; atteso: PageTreeNode[] }[];
  appiattisci: { albero: PageTreeNode[]; atteso: string[] }[];
  sposta: { nome: string; albero: PageTreeNode[]; id: string; genitore: string | null; indice: number; atteso: PageTreeNode[] | null }[];
  rimuovi: { nome: string; albero: PageTreeNode[]; id: string; atteso: PageTreeNode[] }[];
};

describe("albero delle pagine — casi condivisi con il Rust", () => {
  it.each(fixture.riconcilia)("riconcilia: $nome", (c) => {
    expect(riconcilia(c.albero, c.pagine)).toEqual(c.atteso);
  });
  it.each(fixture.appiattisci.map((c, i) => ({ ...c, i })))("appiattisci #$i", (c) => {
    expect(appiattisci(c.albero)).toEqual(c.atteso);
  });
  it.each(fixture.sposta)("sposta: $nome", (c) => {
    expect(sposta(c.albero, c.id, c.genitore, c.indice)).toEqual(c.atteso);
  });
  it.each(fixture.rimuovi)("rimuovi: $nome", (c) => {
    expect(rimuovi(c.albero, c.id)).toEqual(c.atteso);
  });
});

describe("albero delle pagine — il resto", () => {
  const albero: PageTreeNode[] = [
    { id: "home", children: [{ id: "a", children: [{ id: "a1" }] }, { id: "b" }] },
    { id: "z" },
  ];

  it("aggiungi: in coda al genitore, o in radice se non esiste", () => {
    expect(aggiungi(albero, "n", "b")).toEqual([
      { id: "home", children: [{ id: "a", children: [{ id: "a1" }] }, { id: "b", children: [{ id: "n" }] }] },
      { id: "z" },
    ]);
    expect(aggiungi(albero, "n", null).at(-1)).toEqual({ id: "n" });
    expect(aggiungi(albero, "n", "inesistente").at(-1)).toEqual({ id: "n" });
  });

  it("posizioneDi: genitore e indice", () => {
    expect(posizioneDi(albero, "a1")).toEqual({ genitore: "a", indice: 0 });
    expect(posizioneDi(albero, "z")).toEqual({ genitore: null, indice: 1 });
    expect(posizioneDi(albero, "q")).toBeNull();
  });

  it("righe: profondità, e i figli dei nodi chiusi non compaiono", () => {
    expect(righe(albero, new Set()).map((r) => `${r.livello}${r.id}`)).toEqual(["0home", "1a", "2a1", "1b", "0z"]);
    const chiusa = righe(albero, new Set(["a"]));
    expect(chiusa.map((r) => r.id)).toEqual(["home", "a", "b", "z"]);
    expect(chiusa[1]).toMatchObject({ haFigli: true, aperto: false });
  });

  it("ordinaPagine: segue l'albero, e le pagine non nominate vanno in coda", () => {
    const pagine = [{ id: "z" }, { id: "b" }, { id: "nuova" }, { id: "a" }, { id: "a1" }, { id: "home" }];
    expect(ordinaPagine(pagine, albero).map((p) => p.id)).toEqual(["home", "a", "a1", "b", "z", "nuova"]);
    // Senza albero l'ordine resta quello in cui arrivano.
    expect(ordinaPagine(pagine, undefined).map((p) => p.id)).toEqual(["z", "b", "nuova", "a", "a1", "home"]);
  });

  it("discendentiDi: figli e nipoti, non il nodo", () => {
    expect(discendentiDi(albero, "home")).toEqual(["a", "a1", "b"]);
    expect(discendentiDi(albero, "z")).toEqual([]);
  });

  describe("spostaRispettoA", () => {
    const piatto: PageTreeNode[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    it("dopo un fratello più in basso non sbaglia di uno", () => {
      expect(spostaRispettoA(piatto, "a", "c", "dopo")!.map((n) => n.id)).toEqual(["b", "c", "a", "d"]);
      expect(spostaRispettoA(piatto, "a", "c", "prima")!.map((n) => n.id)).toEqual(["b", "a", "c", "d"]);
    });
    it("verso l'alto", () => {
      expect(spostaRispettoA(piatto, "d", "b", "prima")!.map((n) => n.id)).toEqual(["a", "d", "b", "c"]);
    });
    it("dentro: in coda ai figli del bersaglio", () => {
      expect(spostaRispettoA(albero, "z", "a", "dentro")).toEqual([
        { id: "home", children: [{ id: "a", children: [{ id: "a1" }, { id: "z" }] }, { id: "b" }] },
      ]);
    });
    it("prima/dopo un nodo annidato prende il suo genitore", () => {
      expect(spostaRispettoA(albero, "z", "a1", "prima")).toEqual([
        { id: "home", children: [{ id: "a", children: [{ id: "z" }, { id: "a1" }] }, { id: "b" }] },
      ]);
    });
    it("un nodo sopra un suo discendente o su se stesso: rifiutato", () => {
      expect(spostaRispettoA(albero, "home", "a1", "dentro")).toBeNull();
      expect(spostaRispettoA(albero, "home", "a", "prima")).toBeNull();
      expect(spostaRispettoA(albero, "a", "a", "dopo")).toBeNull();
    });
    it("id sconosciuti: rifiutato", () => {
      expect(spostaRispettoA(albero, "q", "a", "dopo")).toBeNull();
      expect(spostaRispettoA(albero, "a", "q", "dopo")).toBeNull();
    });
  });
});
