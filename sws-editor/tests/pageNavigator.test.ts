import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { geometriaNavigatore, vociNavigatore, type ConfigGeometria, type RettangoloBottone, type VoceNavigatore } from "../src/pageNavigator";
import type { LanguageTable, PageTreeNode } from "../src/types";
import type { ConfigNavigatore } from "../src/pageNavigator";

// I casi condivisi con `sws-core/src/page_tree.rs` (`voci_navigatore`) stanno in
// `tests/fixtures/navigatore-pagine.json`.

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/navigatore-pagine.json"), "utf8")) as {
  pagine: { id: string; name: string }[];
  albero: PageTreeNode[];
  tabella: LanguageTable;
  casi: { nome: string; corrente: string; lang: string; cfg: ConfigNavigatore & { source: string; node?: string; breadcrumb?: boolean; items?: ConfigNavigatore["nav_items"] }; atteso: VoceNavigatore[] }[];
};

describe("navigatore di pagine — casi condivisi con il Rust", () => {
  it.each(fixture.casi)("$nome", (c) => {
    const cfg: ConfigNavigatore = {
      nav_source: c.cfg.source as ConfigNavigatore["nav_source"],
      nav_node: c.cfg.node,
      nav_breadcrumb: c.cfg.breadcrumb,
      nav_items: c.cfg.items,
    };
    expect(vociNavigatore(fixture.pagine, fixture.albero, c.corrente, cfg, c.lang, fixture.tabella)).toEqual(c.atteso);
  });
});

describe("navigatore di pagine — il resto", () => {
  it("senza albero né configurazione mostra tutte le pagine nell'ordine in cui arrivano", () => {
    const v = vociNavigatore([{ id: "b", name: "B" }, { id: "a", name: "A" }], undefined, "a", {}, "it", null);
    expect(v.map((x) => x.id)).toEqual(["b", "a"]);
    expect(v.find((x) => x.attiva)?.id).toBe("a");
  });
});

const geometria = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/geometria-navigatore.json"), "utf8")) as {
  casi: { nome: string; w: number; h: number; n: number; cfg: ConfigGeometria; atteso: RettangoloBottone[] }[];
};

describe("geometria del navigatore — casi condivisi con il Rust", () => {
  it.each(geometria.casi)("$nome", (c) => {
    expect(geometriaNavigatore(c.w, c.h, c.n, c.cfg)).toEqual(c.atteso);
  });
});
