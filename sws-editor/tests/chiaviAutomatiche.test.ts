import { describe, it, expect } from "vitest";
import {
  conTesto, contaUsi, decidiChiave, prossimaChiave, testoSorgente,
} from "../src/i18n/chiaviAutomatiche";
import type { LanguageTable } from "../src/types";

/** Quando il testo digitato diventa una voce della tabella lingue.
 *
 *  La decisione del maintainer (15-09-2026): **chiave come id opaco**, testo
 *  nella colonna della lingua principale. Il motivo è un difetto che si vede
 *  nei template di oggi — con le chiavi ricavate dal testo, `casa-locale` ha
 *  davvero una chiave `aggiornare_shelly_id_in_project_yaml_con` — e uno
 *  peggiore: appena cambi il testo, una chiave-che-descrive-il-testo mente, e
 *  nessuno la rinomina perché rinominarla vuol dire cercarla in tutti i
 *  sinottici.
 */

const tabella = (): LanguageTable => ({
  default: "it",
  langs: ["it", "de"],
  entries: [
    { key: "t0001", values: { it: "Avvio pompa", de: "Pumpe Start" } },
    { key: "t0002", values: { it: "Arresto", de: "Stopp" } },
  ],
});

describe("cosa NON finisce nella tabella", () => {
  it("il vuoto", () => {
    expect(decidiChiave("", tabella()).azione).toBe("lascia");
    expect(decidiChiave("   ", tabella()).azione).toBe("lascia");
  });

  it("un testo che è già un riferimento alla tabella", () => {
    // Il campo viene riscritto a ogni battuta di tasto: senza questo si
    // creerebbe {{t0003}} con dentro {{t0001}}, e poi {{t0004}} con dentro
    // quello. L'idempotenza qui non è un vezzo.
    expect(decidiChiave("{{t0001}}", tabella()).azione).toBe("lascia");
    expect(decidiChiave("  {{ t0001 }}  ", tabella()).azione).toBe("lascia");
  });

  it("un numero nudo", () => {
    expect(decidiChiave("42", tabella()).azione).toBe("lascia");
    expect(decidiChiave("-3,5", tabella()).azione).toBe("lascia");
  });

  it("un campo che è solo un segnaposto di formato", () => {
    // `{value:.1f}` non ha parole: non c'è niente da tradurre, e toccarlo
    // romperebbe il formato (Q43, punto 3).
    expect(decidiChiave("{value}", tabella()).azione).toBe("lascia");
    expect(decidiChiave("{value:.1f}", tabella()).azione).toBe("lascia");
  });

  it("ma un segnaposto CON del testo attorno sì, e tutto insieme", () => {
    // È il caso che conta per la qualità della traduzione: in tedesco l'unità
    // e il numero possono cambiare posto, quindi la frase va tradotta intera.
    // Spezzarla in «testo» + «segnaposto» impedirebbe di riordinarli.
    const d = decidiChiave("Pressione {value:.1f} bar", tabella());
    expect(d.azione).toBe("crea");
  });
});

describe("il riuso si propone, non si impone", () => {
  it("testo identico nella lingua principale → proposta, con quante volte è già usata", () => {
    const d = decidiChiave("Avvio pompa", tabella(), (k) => (k === "t0001" ? 3 : 0));
    expect(d).toEqual({ azione: "proponi-riuso", key: "t0001", usiEsistenti: 3 });
  });

  it("il confronto ignora gli spazi ai bordi, che nessuno digita apposta", () => {
    expect(decidiChiave("  Avvio pompa ", tabella()).azione).toBe("proponi-riuso");
  });

  it("il confronto guarda SOLO la lingua principale", () => {
    // «Stopp» esiste, ma in tedesco: è una traduzione, non qualcosa che
    // l'autore ha scritto. Proporne il riuso confonderebbe le due cose.
    expect(decidiChiave("Stopp", tabella()).azione).toBe("crea");
  });

  it("testo nuovo → chiave nuova", () => {
    expect(decidiChiave("Marcia avanti", tabella())).toEqual({ azione: "crea", key: "t0003" });
  });
});

describe("prossimaChiave non riusa le chiavi cancellate", () => {
  it("prende il primo buco solo se è davvero libero", () => {
    expect(prossimaChiave(tabella())).toBe("t0003");
  });

  it("una tabella con un buco in mezzo NON lo riempie", () => {
    // Riempirlo darebbe la chiave di una riga cancellata a un testo nuovo, e
    // ogni sinottico che citava ancora {{t0001}} comincerebbe a mostrare una
    // frase che non è la sua — un difetto che si vede mesi dopo.
    const t: LanguageTable = { default: "it", langs: ["it"], entries: [
      { key: "t0001", values: { it: "a" } },
      { key: "t0003", values: { it: "c" } },
    ] };
    expect(prossimaChiave(t)).toBe("t0002");
  });

  it("su una tabella vuota parte da t0001", () => {
    expect(prossimaChiave(null)).toBe("t0001");
  });
});

describe("il pannello proprietà mostra il testo, non la chiave", () => {
  it("un token noto si mostra come il suo testo nella lingua principale", () => {
    expect(testoSorgente("{{t0001}}", tabella())).toBe("Avvio pompa");
  });

  it("un token sconosciuto resta visibile com'è", () => {
    // Nasconderlo dietro una stringa vuota farebbe sparire il problema dagli
    // occhi di chi potrebbe risolverlo.
    expect(testoSorgente("{{ignota}}", tabella())).toBe("{{ignota}}");
  });

  it("il testo libero passa invariato", () => {
    expect(testoSorgente("Ciao", tabella())).toBe("Ciao");
    expect(testoSorgente(undefined, tabella())).toBe("");
  });
});

describe("conTesto scrive nella colonna principale e non tocca le altre", () => {
  it("aggiorna una voce esistente lasciando la traduzione al suo posto", () => {
    const t = conTesto(tabella(), "t0001", "Avvio della pompa");
    const v = t.entries.find((e) => e.key === "t0001")!.values;
    expect(v.it).toBe("Avvio della pompa");
    // Correggere un refuso nell'originale non deve buttare via il lavoro di
    // traduzione già fatto.
    expect(v.de).toBe("Pumpe Start");
  });

  it("aggiunge una voce nuova", () => {
    const t = conTesto(tabella(), "t0003", "Marcia");
    expect(t.entries).toHaveLength(3);
    expect(t.entries[2]).toEqual({ key: "t0003", values: { it: "Marcia" } });
  });

  it("su un progetto senza tabella se ne crea una sensata", () => {
    const t = conTesto(null, "t0001", "Ciao");
    expect(t.default).toBe("it");
    expect(t.langs).toContain("it");
    expect(t.entries[0].values.it).toBe("Ciao");
  });
});

describe("contaUsi", () => {
  it("conta le occorrenze del token", () => {
    expect(contaUsi("t0001", "a {{t0001}} b {{t0001}} c {{t0002}}")).toBe(2);
    expect(contaUsi("t0009", "niente")).toBe(0);
  });
});
