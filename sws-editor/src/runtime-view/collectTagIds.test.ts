import { describe, expect, it } from "vitest";
import { collectTagIds } from "./collectTagIds";
import type { SynopticObject } from "@/types";

// Copertura mirata sulla F5.3x/T-70 (xy_series multi-coppia): il resto della
// funzione (F0.1, celle grid, faceplate, bindings/espressioni) non ha un
// test dedicato preesistente — non allargato qui, fuori scope.

describe("collectTagIds — xy_series", () => {
  it("raccoglie tag e y_tag di ogni coppia, non solo la prima", () => {
    const obj: SynopticObject = {
      id: "xy", type: "xy_plot", x: 0, y: 0,
      xy_series: [
        { tag: "misura.x", y_tag: "misura.y" },
        { tag: "target.x", y_tag: "target.y", dash: "dashed" },
      ],
    };
    const ids = collectTagIds([obj]);
    expect(ids).toEqual(
      expect.arrayContaining(["misura.x", "misura.y", "target.x", "target.y"]),
    );
    expect(ids).toHaveLength(4);
  });

  it("il formato legacy (una coppia) resta coperto da y_tag in TAG_FIELDS", () => {
    const obj: SynopticObject = { id: "xy", type: "xy_plot", x: 0, y: 0, tag: "a.x", y_tag: "a.y" };
    const ids = collectTagIds([obj]);
    expect(ids).toEqual(expect.arrayContaining(["a.x", "a.y"]));
  });
});
