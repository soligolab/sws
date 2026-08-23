import { describe, expect, it } from "vitest";
import { normalizeTrendObject, trendTraces } from "./trendModel";
import type { SynopticObject } from "@/types";

const legacy: SynopticObject = {
  id: "t1", type: "trend", x: 0, y: 0,
  tag: "a.power",
  extra_tags: ["b.volt", "c.level"],
  line_color: "#111111",
  trend_series_styles: [
    { width: 2 },                             // traccia 1 (a.power)
    { own_scale: true, color: "#f59e0b" },    // b.volt
    { dash: "dashed", hidden: true },         // c.level
  ],
};

describe("normalizeTrendObject", () => {
  it("migra legacy → trend_tags e rimuove i campi vecchi", () => {
    const m = normalizeTrendObject(legacy);
    expect(m.trend_tags).toEqual([
      { tag: "a.power", color: "#111111", width: 2 },
      { tag: "b.volt", color: "#f59e0b", own_scale: true },
      { tag: "c.level", dash: "dashed", hidden: true },
    ]);
    expect(m.tag).toBeUndefined();
    expect(m.extra_tags).toBeUndefined();
    expect(m.trend_series_styles).toBeUndefined();
    expect(m.line_color).toBeUndefined();
  });

  it("styles[0].color vince su line_color (B3, ora esplicito)", () => {
    const m = normalizeTrendObject({ ...legacy, trend_series_styles: [{ color: "#abc123" }] });
    expect(m.trend_tags?.[0].color).toBe("#abc123");
  });

  it("idempotente: un oggetto già migrato torna per reference", () => {
    const m = normalizeTrendObject(legacy);
    expect(normalizeTrendObject(m)).toBe(m);
  });

  it("non tocca i tipi diversi da trend", () => {
    const rect: SynopticObject = { id: "r", type: "rect", x: 0, y: 0, tag: "x" };
    expect(normalizeTrendObject(rect)).toBe(rect);
  });

  it("scarta le tracce vuote in coda ma non in mezzo", () => {
    const m = normalizeTrendObject({
      id: "t", type: "trend", x: 0, y: 0,
      tag: "", extra_tags: ["b", ""],
    });
    expect(m.trend_tags).toEqual([{ tag: "" }, { tag: "b" }]);
  });

  it("trendTraces legge il legacy al volo senza mutare", () => {
    expect(trendTraces(legacy).map((t) => t.tag)).toEqual(["a.power", "b.volt", "c.level"]);
    expect(legacy.trend_tags).toBeUndefined();
  });
});
