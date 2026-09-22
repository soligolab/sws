import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { findObjects } from "../src/search/findObjects";
import { buildTagUsage } from "../src/search/tagUsage";
import { collectTagIds } from "../src/runtime-view/collectTagIds";
import type { AlarmDef, SynopticObject, SynopticPage, TagDef } from "../src/types";

// I messaggi che il codice sotto test restituisce passano dal catalogo: qui si legge quello italiano.
i18n.changeLanguage("it");

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

describe("collectTagIds — campi allineati a CAMPI_TAG di validate.rs (0a)", () => {
  // Regressione: motion_tag/pipe_flow_tag/symbol_spin_tag/gauge_sp_tag erano
  // già validati lato server (CAMPI_TAG in validate.rs) ma mancavano da
  // TAG_FIELDS qui: l'oggetto riceveva lo snapshot iniziale e poi si
  // congelava, senza nessun errore — il sintomo che il commento in testa al
  // file descrive per gli altri campi.
  it("sottoscrive motion_tag, pipe_flow_tag, symbol_spin_tag e gauge_sp_tag", () => {
    const obj = {
      id: "x", type: "symbol", x: 0, y: 0,
      motion_tag: "m.pos", pipe_flow_tag: "m.flow",
      symbol_spin_tag: "m.spin", gauge_sp_tag: "m.sp",
    } as unknown as SynopticObject;
    const ids = collectTagIds([obj]);
    expect(ids.sort()).toEqual(["m.flow", "m.pos", "m.sp", "m.spin"]);
  });
});

describe("buildTagUsage (F8.3)", () => {
  const alarms: AlarmDef[] = [
    { id: "AL1", tag: "pump1.speed", message: "Sovravelocità",
      condition: { kind: "above", threshold: 100 } } as AlarmDef,
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

  // Regressione: la regex catturava solo `tags["..."]` con apici doppi. Gli
  // script reali (demo-items-web/lvgl) scrivono `tags.write("id", v)` e
  // `tags.read("id")` — l'API vera esposta agli script (`TagApi` in
  // sws-pyscript, non un `__getitem__`) — e alcune espressioni dei template
  // (homeassistant-demo, enip-demo) usano apici singoli: `tags['id']`.
  it("trova i tag anche con apici singoli e con tags.read/tags.write", () => {
    const tagsConApiciSingoli: TagDef[] = [
      { id: "calc2", expression: "tags['water.flow'] * 2" } as TagDef,
    ];
    const scripts = [
      { id: "demo-sim", trigger: { kind: "interval", interval_s: 1 } as const,
        code: 't = tags.read("demo.sim.counter")\ntags.write("demo.sim.counter", t)' },
    ];
    const u = buildTagUsage({ pages, alarms, tags: tagsConApiciSingoli, globalScripts: scripts as never });
    expect(u.get("water.flow")?.some((x) => x.where.includes("calc2"))).toBe(true);
    expect(u.get("demo.sim.counter")?.some((x) => x.where.includes("demo-sim"))).toBe(true);
  });

  // Una variabile (non un letterale) non deve combaciare: cercarla per
  // sottostringa darebbe falsi positivi che nessuno può controllare.
  it("tags.read(variabile) non genera un riferimento fasullo", () => {
    const scripts = [
      { id: "dinamico", trigger: { kind: "interval", interval_s: 1 } as const,
        code: "for t in ['a', 'b']:\n    tags.read(t)" },
    ];
    const u = buildTagUsage({ pages, globalScripts: scripts as never });
    expect(u.has("t")).toBe(false);
  });
});
