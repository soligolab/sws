import { describe, expect, it } from "vitest";
import { normalizeXyObject, xySeriesOf } from "./xyModel";
import type { SynopticObject } from "@/types";

const legacy: SynopticObject = {
  id: "xy1", type: "xy_plot", x: 0, y: 0,
  tag: "cart.pos_x",
  y_tag: "cart.pos_y",
  line_color: "#3b82f6",
};

describe("normalizeXyObject", () => {
  it("migra legacy → xy_series e rimuove i campi vecchi", () => {
    const m = normalizeXyObject(legacy);
    expect(m.xy_series).toEqual([
      { tag: "cart.pos_x", y_tag: "cart.pos_y", color: "#3b82f6" },
    ]);
    expect(m.tag).toBeUndefined();
    expect(m.y_tag).toBeUndefined();
    expect(m.line_color).toBeUndefined();
  });

  it("idempotente: un oggetto già migrato torna per reference", () => {
    const m = normalizeXyObject(legacy);
    expect(normalizeXyObject(m)).toBe(m);
  });

  it("non tocca i tipi diversi da xy_plot", () => {
    const rect: SynopticObject = { id: "r", type: "rect", x: 0, y: 0, tag: "x" };
    expect(normalizeXyObject(rect)).toBe(rect);
  });

  it("nessuna coppia configurata → xy_series vuoto, non una coppia fantasma", () => {
    const vuoto: SynopticObject = { id: "xy2", type: "xy_plot", x: 0, y: 0 };
    const m = normalizeXyObject(vuoto);
    expect(m.xy_series).toEqual([]);
  });

  it("xySeriesOf legge il legacy al volo senza mutare", () => {
    expect(xySeriesOf(legacy)).toEqual([
      { tag: "cart.pos_x", y_tag: "cart.pos_y", color: "#3b82f6" },
    ]);
    expect(legacy.xy_series).toBeUndefined();
  });

  it("xySeriesOf legge il formato nuovo se già presente (multi-coppia)", () => {
    const nuovo: SynopticObject = {
      id: "xy3", type: "xy_plot", x: 0, y: 0,
      xy_series: [
        { tag: "misura.x", y_tag: "misura.y", color: "#22c55e" },
        { tag: "target.x", y_tag: "target.y", dash: "dashed" },
      ],
    };
    expect(xySeriesOf(nuovo)).toBe(nuovo.xy_series);
  });
});
