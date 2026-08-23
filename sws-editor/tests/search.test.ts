import { describe, expect, it } from "vitest";
import { findObjects } from "../src/search/findObjects";
import { buildTagUsage } from "../src/search/tagUsage";
import type { AlarmDef, SynopticObject, SynopticPage, TagDef } from "../src/types";

// F8.3 — la ricerca deve trovare un oggetto anche per TAG e per TESTO, non solo
// per nome/tipo/id (il filtro di prima), e coprire tutte le pagine. La mappa
// "dove è usato" deve dire la pagina, l'allarme, l'espressione o lo script.

const obj = (o: Partial<SynopticObject> & { id: string }): SynopticObject =>
  ({ type: "rect", x: 0, y: 0, ...o } as SynopticObject);

const pages: SynopticPage[] = [
  { id: "p1", name: "Impianto", objects: [
    obj({ id: "r1", name: "Pompa principale", tag: "pump1.speed" }),
    obj({ id: "btn_start", type: "button", label: "Avvio linea" }),
  ] },
  { id: "p2", name: "Servizi", objects: [
    obj({ id: "t2", type: "text", text: "Portata acqua", tag: "water.flow" }),
  ] },
];

describe("findObjects (F8.3)", () => {
  it("trova per nome su tutte le pagine", () => {
    const hits = findObjects(pages, [], "pompa");
    expect(hits.map((h) => h.obj.id)).toEqual(["r1"]);
    expect(hits[0].pageName).toBe("Impianto");
    expect(hits[0].reason).toBe("name");
  });

  it("trova per tag, anche su una pagina non aperta", () => {
    const hits = findObjects(pages, [], "water.");
    expect(hits).toHaveLength(1);
    expect(hits[0].pageId).toBe("p2");
    expect(hits[0].reason).toBe("tag");
    expect(hits[0].detail).toBe("water.flow");
  });

  it("trova per testo/etichetta (quello che l'utente legge sul pulsante)", () => {
    const hits = findObjects(pages, [], "avvio");
    expect(hits.map((h) => h.obj.id)).toEqual(["btn_start"]);
    expect(hits[0].reason).toBe("text");
  });

  it("il tipo è l'ultima risorsa e non nasconde i match migliori", () => {
    const hits = findObjects(pages, [], "text");
    // "text" combacia col tipo di t2, ma non deve pescare gli altri.
    expect(hits.map((h) => h.obj.id)).toEqual(["t2"]);
    expect(hits[0].reason).toBe("type");
  });

  it("query vuota non restituisce nulla", () => {
    expect(findObjects(pages, [], "   ")).toEqual([]);
  });
});

describe("buildTagUsage (F8.3)", () => {
  const alarms: AlarmDef[] = [
    { id: "AL1", tag: "pump1.speed", condition: "high", limit: 100 } as AlarmDef,
  ];
  const tags: TagDef[] = [
    { id: "calc.sum", expression: 'tags["water.flow"] * 2' } as TagDef,
  ];

  it("elenca pagina, allarme ed espressione", () => {
    const u = buildTagUsage({ pages, alarms, tags });
    expect(u.get("pump1.speed")?.map((x) => x.where)).toEqual([
      'pagina "Impianto"', 'allarme "AL1"',
    ]);
    expect(u.get("water.flow")?.map((x) => x.where)).toEqual([
      'pagina "Servizi"', 'espressione di "calc.sum"',
    ]);
  });

  it("porta l'id pagina per poterci navigare", () => {
    const u = buildTagUsage({ pages, alarms, tags });
    expect(u.get("pump1.speed")?.[0].pageId).toBe("p1");
    // I riferimenti non-pagina non hanno pageId: niente navigazione finta.
    expect(u.get("pump1.speed")?.[1].pageId).toBeUndefined();
  });

  it("un tag non riferito da nessuno non compare", () => {
    const u = buildTagUsage({ pages, alarms, tags });
    expect(u.has("mai.usato")).toBe(false);
  });
});
