import { describe, it, expect } from "vitest";
import { statoTag, suggerimentiPer } from "../src/components/TagInput";

/** Fase 2: il campo Tag completa il percorso mentre si digita. Prima, per
 *  legare un oggetto a `motore1.velocita` bisognava ricordarsi a memoria come
 *  si chiamavano i membri del tipo. */

const catalogo = [
  { id: "motore1" }, { id: "motore1.velocita" }, { id: "motore1.marcia" },
  { id: "motore1bis" }, { id: "livello" },
];

describe("suggerimentiPer", () => {
  it("completa per prefisso e non ripropone l'id già scritto per intero", () => {
    expect(suggerimentiPer("motore1", catalogo).map((x) => x.id))
      .toEqual(["motore1.velocita", "motore1.marcia", "motore1bis"]);
    expect(suggerimentiPer("motore1.", catalogo).map((x) => x.id))
      .toEqual(["motore1.velocita", "motore1.marcia"]);
    expect(suggerimentiPer("livello", catalogo)).toEqual([]);
  });

  it("ignora maiuscole e minuscole, e non suggerisce sulle sottostringhe", () => {
    expect(suggerimentiPer("MOT", catalogo).map((x) => x.id)).toHaveLength(4);
    expect(suggerimentiPer("velocita", catalogo)).toEqual([]);
  });

  it("niente suggerimenti su un campo vuoto o su un segnaposto di faceplate", () => {
    expect(suggerimentiPer("", catalogo)).toEqual([]);
    expect(suggerimentiPer("   ", catalogo)).toEqual([]);
    expect(suggerimentiPer("{p}.vel", [{ id: "{p}.velocita" }])).toEqual([]);
  });

  it("l'elenco è corto: sta sotto un campo del pannello, non in una pagina", () => {
    const molti = Array.from({ length: 40 }, (_, i) => ({ id: `zona${i}` }));
    expect(suggerimentiPer("zona", molti)).toHaveLength(10);
    expect(suggerimentiPer("zona", molti, 3)).toHaveLength(3);
  });
});

describe("statoTag", () => {
  it("un percorso dentro una radice composita è dichiarato quanto la radice", () => {
    const dich = new Set(["motore1"]);
    expect(statoTag("motore1.velocita", dich, new Set(), ["motore1"])).toBe("dichiarato");
    expect(statoTag("motore1.velocita", dich, new Set(), [])).toBe("nuovo");
    expect(statoTag("{p}.on", dich, new Set(), [])).toBeNull();
  });
});
