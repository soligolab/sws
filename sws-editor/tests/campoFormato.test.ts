import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FORMATI, applicaFormato } from "../src/components/CampoFormato";

/** L'elenco dei formati pronti del pannello proprietà. Prima il campo era
 *  libero: i formati per le durate e per le date non li avrebbe trovati
 *  nessuno. Qui si prova che l'elenco resta allineato alla specifica vera
 *  (la fixture condivisa coi due motori) e che scegliere una voce non butta
 *  via l'unità di misura scritta a mano. */
type Fixture = { casi: { format: string | null }[] };
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../tests/fixtures/formattazione-valori.json"), "utf8"),
) as Fixture;

describe("CampoFormato — l'elenco dei formati pronti", () => {
  it("ogni formato offerto è un formato che i due motori sanno davvero fare", () => {
    const provati = new Set(
      fixture.casi
        .map((c) => c.format)
        .filter((f): f is string => !!f)
        // dalla frase completa al solo segnaposto: «{value:.1f} bar» → «{value:.1f}»
        .map((f) => f.match(/\{value[^}]*\}/)?.[0] ?? f),
    );
    const scoperti = FORMATI.map((v) => v.spec).filter((s) => !provati.has(s));
    expect(scoperti, "formati offerti ma non provati dalla fixture condivisa").toEqual([]);
  });

  it("le tre famiglie ci sono tutte", () => {
    for (const g of ["numeri", "durate", "istanti"]) {
      expect(FORMATI.some((v) => v.gruppo === g), g).toBe(true);
    }
  });
});

describe("applicaFormato — il testo attorno resta", () => {
  it("sostituisce solo il segnaposto", () => {
    expect(applicaFormato("{value:.1f} bar", "{value:dhms}")).toBe("{value:dhms} bar");
    expect(applicaFormato("Pressione: {value} bar", "{value:.2f}")).toBe("Pressione: {value:.2f} bar");
    expect(applicaFormato("{value}", "{value:time}")).toBe("{value:time}");
  });

  it("su un campo vuoto mette il solo segnaposto", () => {
    expect(applicaFormato("", "{value:hms}")).toBe("{value:hms}");
  });

  it("su un testo senza segnaposto lo aggiunge in coda, con uno spazio solo", () => {
    expect(applicaFormato("Acceso da", "{value:dhms}")).toBe("Acceso da {value:dhms}");
    expect(applicaFormato("Acceso da ", "{value:dhms}")).toBe("Acceso da {value:dhms}");
  });
});
