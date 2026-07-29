import { describe, expect, it } from "vitest";
import { sourceTagIds, tagCatalog } from "../src/tagCatalog";
import type { ProjectInfo } from "../src/types";

// Il catalogo esiste perché in molti progetti le variabili NON sono dichiarate:
// nascono dalle mappature delle sorgenti. Un selettore che guardasse solo
// `project.tags` risulterebbe vuoto proprio nei progetti realistici — è il caso
// che ha fatto sembrare "assente" il selettore nella tabella allarmi.
const project = (over: Partial<ProjectInfo>): ProjectInfo =>
  ({ meta: { name: "p", version: "1" }, tags: [], sources: [], ...over }) as ProjectInfo;

describe("sourceTagIds", () => {
  it("raccoglie i tag da tutti i protocolli, con il nome della sorgente", () => {
    const p = project({
      sources: [
        { name: "casa", entities: [{ tag: "sala.temp" }] },
        { name: "plc", registers: [{ tag: "m.run" }] },
        { name: "s7", tags: [{ tag: "db1.x" }] },
        { name: "opc", nodes: [{ tag: "ns2.y" }] },
        { name: "mqtt", topics: [{ tag: "t.z" }] },
        { name: "spb", metrics: [{ tag: "m.w" }] },
      ] as never,
    });
    const ids = sourceTagIds(p);
    expect([...ids.keys()].sort()).toEqual(["db1.x", "m.run", "m.w", "ns2.y", "sala.temp", "t.z"]);
    expect(ids.get("sala.temp")).toBe("casa");
    expect(ids.get("m.w")).toBe("spb");
  });

  it("ignora voci senza tag e progetti vuoti", () => {
    expect(sourceTagIds(null).size).toBe(0);
    expect(sourceTagIds(project({ sources: [{ name: "x", topics: [{}, { tag: "" }] }] as never })).size).toBe(0);
  });
});

describe("tagCatalog", () => {
  it("unisce dichiarati e dedotti, ordinati per id", () => {
    const p = project({
      tags: [{ id: "b.tag", description: "beta" }] as never,
      sources: [{ name: "mqtt", topics: [{ tag: "a.tag" }] }] as never,
    });
    expect(tagCatalog(p).map((t) => [t.id, t.origin])).toEqual([
      ["a.tag", "source"],
      ["b.tag", "declared"],
    ]);
  });

  it("una variabile dichiarata vince sulla stessa dedotta da una sorgente", () => {
    const p = project({
      tags: [{ id: "dup", description: "dichiarata" }] as never,
      sources: [{ name: "mqtt", topics: [{ tag: "dup" }] }] as never,
    });
    const cat = tagCatalog(p);
    expect(cat).toHaveLength(1);
    expect(cat[0].origin).toBe("declared");
    expect(cat[0].description).toBe("dichiarata");
  });

  it("progetto senza nulla → catalogo vuoto (la UI mostra l'avviso, non nasconde il selettore)", () => {
    expect(tagCatalog(project({}))).toEqual([]);
    expect(tagCatalog(null)).toEqual([]);
  });
});
