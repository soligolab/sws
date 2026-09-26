import { describe, expect, it } from "vitest";
import { chiaveRilievi, contaRilievi, destinazioneRilievo } from "./rilievoDestinazione";

const pagine = [{ id: "p1", name: "Home" }, { id: "p2", name: "Finestre e porte" }];

describe("destinazioneRilievo", () => {
  it("una riga di una sorgente apre quella sorgente in Protocolli", () => {
    expect(destinazioneRilievo("project.sources[mqtt-casa].topics[0].tag", pagine))
      .toEqual({ kind: "config", tab: "protocols", focus: "mqtt-casa" });
  });

  it("un tag con il punto nell'id resta intero", () => {
    expect(destinazioneRilievo("project.tags[sandokan.power].data_type", pagine))
      .toEqual({ kind: "config", tab: "tags", focus: "sandokan.power" });
  });

  it("gli allarmi e i tipi aprono la scheda, senza elemento", () => {
    expect(destinazioneRilievo("project.alarms[alm-rack].levels", pagine))
      .toEqual({ kind: "config", tab: "alarms", focus: null });
    expect(destinazioneRilievo("project.types[Motore].members[0].name", pagine))
      .toEqual({ kind: "config", tab: "types", focus: null });
  });

  it("parentesi vuote: la scheda, senza elemento", () => {
    expect(destinazioneRilievo("project.tags[]", pagine))
      .toEqual({ kind: "config", tab: "tags", focus: null });
  });

  it("un oggetto di un sinottico apre la pagina (per nome) e lo seleziona", () => {
    expect(destinazioneRilievo("pages[Finestre e porte].objects[obj_7].tag", pagine))
      .toEqual({ kind: "page", pageId: "p2", objectId: "obj_7" });
    expect(destinazioneRilievo("pages[Home]", pagine))
      .toEqual({ kind: "page", pageId: "p1", objectId: null });
  });

  it("quello che non si riconosce non è cliccabile", () => {
    expect(destinazioneRilievo("pages[Sparita].objects[x]", pagine)).toBeNull();
    expect(destinazioneRilievo("project.functions[f].code", pagine)).toBeNull();
    expect(destinazioneRilievo("qualcos'altro", pagine)).toBeNull();
  });
});

describe("contaRilievi", () => {
  it("conta per scheda e per elemento, e tiene a parte gli errori", () => {
    const c = contaRilievi([
      { severity: "error", path: "project.alarms[alm-rack].condition" },
      { severity: "error", path: "project.alarms[sandokan_power_on].tag" },
      { severity: "warning", path: "project.sources[mqtt-casa].topics[0].tag" },
      { severity: "warning", path: "project.sources[mqtt-casa].topics[1].tag" },
      { severity: "warning", path: "pages[Home].objects[x]" },
    ], pagine);
    expect(c.get(chiaveRilievi("alarms"))).toEqual({ n: 2, errori: 2 });
    expect(c.get(chiaveRilievi("protocols"))).toEqual({ n: 2, errori: 0 });
    expect(c.get(chiaveRilievi("protocols", "mqtt-casa"))).toEqual({ n: 2, errori: 0 });
    expect(c.get(chiaveRilievi("tags"))).toBeUndefined();
  });
});
