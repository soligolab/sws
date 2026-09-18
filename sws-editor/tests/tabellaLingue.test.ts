import { describe, it, expect } from "vitest";
import { contaAutomatiche, eAutomatica, marcaComeUmana } from "../src/i18n/tabellaLingue";
import type { LangEntry, LanguageTable } from "../src/types";

/** Il marchio «tradotta dalla macchina», e la promessa che protegge.
 *
 *  «Una traduzione umana non si sovrascrive mai» era vera solo lato Rust: sul
 *  web `setVal` scriveva il testo e lasciava il marchio, quindi una cella
 *  corretta a mano restava «automatica» e «ritraduci tutto» poteva riscriverla.
 *  Misurato il 18-09-2026, F4 del piano multilingua-chiusura.
 */
const voce: LangEntry = {
  key: "t0043",
  values: { it: "TAPPARELLE", en: "ROLLER SHUTTERS", es: "PERSIANAS" },
  auto: ["en", "es"],
};

describe("marcaComeUmana — una modifica a mano toglie il marchio", () => {
  it("la lingua toccata esce da `auto`, le altre restano", () => {
    const dopo = marcaComeUmana(voce, "en");
    expect(eAutomatica(dopo, "en")).toBe(false);
    expect(eAutomatica(dopo, "es")).toBe(true);
    expect(dopo.values).toEqual(voce.values);
  });

  it("l'ultima lingua tolta fa sparire `auto` del tutto, non lascia `auto: []`", () => {
    const dopo = marcaComeUmana(marcaComeUmana(voce, "en"), "es");
    expect(dopo.auto).toBeUndefined();
  });

  it("una cella che non era automatica non cambia niente, nemmeno l'identità", () => {
    expect(marcaComeUmana(voce, "it")).toBe(voce);
    const senza: LangEntry = { key: "x", values: { it: "a" } };
    expect(marcaComeUmana(senza, "en")).toBe(senza);
  });

  it("non tocca la voce originale", () => {
    marcaComeUmana(voce, "en");
    expect(voce.auto).toEqual(["en", "es"]);
  });
});

describe("contaAutomatiche — quante celle sono ancora da rileggere", () => {
  const tabella: LanguageTable = {
    default: "it",
    langs: ["it", "en", "es"],
    entries: [
      voce,
      { key: "t0044", values: { it: "Altro", en: "Other" }, auto: ["en"] },
      { key: "t0045", values: { it: "Solo mano" } },
    ],
  };

  it("conta ogni cella automatica, su tutte le voci", () => {
    expect(contaAutomatiche(tabella)).toBe(3);
  });

  it("un marchio su una lingua che il progetto non ha più non conta", () => {
    // Nessuno vedrà mai quella cella: contarla direbbe che c'è del lavoro da
    // fare dove non c'è niente.
    const orfana: LanguageTable = { ...tabella, entries: [{ key: "k", values: {}, auto: ["de"] }] };
    expect(contaAutomatiche(orfana)).toBe(0);
  });

  it("dopo una correzione a mano il conto scende", () => {
    const dopo: LanguageTable = { ...tabella, entries: tabella.entries.map((e) => marcaComeUmana(e, "en")) };
    expect(contaAutomatiche(dopo)).toBe(1);
  });
});
