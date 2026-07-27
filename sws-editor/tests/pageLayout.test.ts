import { describe, expect, it } from "vitest";
import { editorFitSize } from "../src/pageLayout";

// Which size the editor's "fit page" targets. The interesting cases are the
// ones where the page itself declares nothing.
describe("editorFitSize", () => {
  const page = { width: 1024, height: 600 };

  it("uses the page dimensions when they exist", () => {
    expect(editorFitSize(page, { size_mode: "fixed" })).toEqual(page);
    expect(editorFitSize(page, undefined)).toEqual(page); // legacy = fixed
  });

  it("returns null in fluid mode — there is no page to fit", () => {
    expect(editorFitSize(page, { size_mode: "fluid" })).toBeNull();
  });

  it("falls back to the reference resolution in ratio mode", () => {
    expect(editorFitSize({}, { size_mode: "ratio", aspect_ratio: "4:3" }))
      .toEqual({ width: 1024, height: 768 });
    // unknown/missing ratio → 16:9 reference
    expect(editorFitSize({}, { size_mode: "ratio" }))
      .toEqual({ width: 1920, height: 1080 });
  });

  it("returns null for a fixed page with no declared size", () => {
    expect(editorFitSize({}, { size_mode: "fixed" })).toBeNull();
    expect(editorFitSize(undefined, undefined)).toBeNull();
  });
});
