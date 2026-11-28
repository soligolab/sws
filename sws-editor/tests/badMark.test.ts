// The Bad mark (part C of docs/plans/2026-11-24-residui-rc30-e-bad-di-default.md):
// same rules as `effects.rs` on the panel (tests `il_segno_bad_*`).
import { describe, expect, it } from "vitest";
import { badMarkCentre, badMarkShown } from "@/canvas/badMark";
import type { SynopticObject, TagState } from "@/types";

const bad: TagState = { value: 1, quality: "Bad", timestamp_ms: 1000 } as TagState;
const good: TagState = { value: 1, quality: "Good", timestamp_ms: 1000 } as TagState;

describe("badMark", () => {
  it("is on by default, and «none» gives it up", () => {
    expect(badMarkShown({}, bad)).toBe(true);
    expect(badMarkShown({ bad_value_style: "gray" }, bad)).toBe(true);
    expect(badMarkShown({ bad_value_style: "none" }, bad)).toBe(false);
    expect(badMarkShown({}, good)).toBe(false);
    expect(badMarkShown({}, undefined)).toBe(false);
  });

  it("sits on the top left corner of the box, of the letters for a text", () => {
    const rect = { id: "r", type: "rect", x: 10, y: 20, width: 50, height: 30 } as SynopticObject;
    expect(badMarkCentre(rect, "")).toEqual({ x: 10, y: 20 });
    const text = { id: "t", type: "text", x: 100, y: 50, font_size: 14 } as SynopticObject;
    // The same numbers as the Rust test `il_segno_sta_nell_angolo_in_alto_a_sinistra`:
    // aligned to the start, the top right corner (the dot is on the left).
    expect(badMarkCentre(text, "abc")).toEqual({ x: 142, y: 38 });
    expect(badMarkCentre({ ...text, text_anchor: "end" }, "abc")).toEqual({ x: 58, y: 38 });
  });
});
