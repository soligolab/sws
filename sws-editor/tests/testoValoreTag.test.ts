import { describe, expect, it } from "vitest";
import { testoValoreTag } from "../src/editor/RigaTagLive";

/** Il valore nell'albero dei tag (03-10-2026): un `f32` letto dal campo si
 *  vedeva come 22.97979736328125, e una foglia non portava né decimali né unità. */
describe("testoValoreTag", () => {
  it("usa i decimali dichiarati e l'unità", () => {
    expect(testoValoreTag(22.97979736328125, 1, "%")).toBe("23.0 %");
    expect(testoValoreTag(67.222, 1, "°C")).toBe("67.2 °C");
  });
  it("senza decimali dichiarati, al massimo tre", () => {
    expect(testoValoreTag(22.97979736328125)).toBe("22.98");
    expect(testoValoreTag(0.1 + 0.2)).toBe("0.3");
  });
  it("interi, testi e booleani come sono", () => {
    expect(testoValoreTag(249844, undefined, "s")).toBe("249844 s");
    expect(testoValoreTag("tc620-a-p3-c6-07aff9", 2, "x")).toBe("tc620-a-p3-c6-07aff9");
    expect(testoValoreTag(true)).toBe("true");
  });
  it("un valore composito si legge come JSON", () => {
    expect(testoValoreTag({ a: 1 })).toBe('{"a":1}');
  });
});
