/** The company's symbol library in the IDE (plan
 *  docs/plans/2026-11-21-simboli-fase-7-libreria-aziendale.md): which copies are
 *  out of date, and where a copy goes. */
import { describe, it, expect } from "vitest";
import { outdated, placeCopy } from "../src/symbols/library/companyLibrary";
import type { LibraryEntry } from "../src/api/client";
import type { DescrizioneSimbolo } from "../src/types";

const sym = (slug: string, extra: Partial<DescrizioneSimbolo> = {}): DescrizioneSimbolo =>
  ({ slug, w: 40, h: 40, body: "body-pump", it: slug, en: slug, ops: [], ...extra });
const entry = (slug: string, version: string, extra: Partial<DescrizioneSimbolo> = {}): LibraryEntry =>
  ({ slug, version, updated_by: "m", updated_ms: 0, images: [], symbol: sym(slug, extra) });

describe("the copies of the library in a project", () => {
  it("are out of date when the library has another version", () => {
    const project = [
      sym("pompa", { library: { slug: "pompa", version: "v1" } }),
      sym("valvola", { library: { slug: "valvola", version: "v2" } }),
      sym("mia"),
      sym("persa", { library: { slug: "tolta", version: "v1" } }),
    ];
    const lib = [entry("pompa", "v2"), entry("valvola", "v2")];
    expect(outdated(project, lib).map((x) => x.symbol.slug)).toEqual(["pompa"]);
  });

  it("go over the earlier copy, or take a slug of their own", () => {
    const e = entry("pompa", "v2");
    const earlier = sym("pompa-2", { library: { slug: "pompa", version: "v1" } });
    expect(placeCopy(e, [sym("pompa"), earlier])).toEqual({ slug: "pompa-2", replaces: earlier, otherVariant: undefined });
    expect(placeCopy(e, [sym("pompa")]).slug).toBe("pompa-2");
    expect(placeCopy(e, []).slug).toBe("pompa");
  });

  it("say which variant of the same SWS symbol they would replace", () => {
    const e = entry("pompa-aziendale", "v1", { overrides: "lib:process/centrifugal-pump" });
    const mine = sym("la-mia-pompa", { overrides: "lib:process/centrifugal-pump" });
    expect(placeCopy(e, [mine]).otherVariant).toBe(mine);
    expect(placeCopy(e, [sym("altro", { overrides: "lib:process/valve" })]).otherVariant).toBeUndefined();
  });
});
