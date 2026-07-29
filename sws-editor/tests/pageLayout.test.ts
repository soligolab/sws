import { describe, expect, it } from "vitest";
import { editorFitSize, viewerFitScale } from "../src/pageLayout";

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

// Quanto rimpicciolire la pagina nel viewer in modalità "fisso". Il cap a 1 è
// la regola che conta: si riduce, non si ingrandisce.
describe("viewerFitScale", () => {
  it("resta 1:1 quando la pagina entra esattamente", () => {
    expect(viewerFitScale(1280, 800, 1280, 800)).toBe(1);
  });

  it("non ingrandisce mai, anche su uno schermo più grande", () => {
    expect(viewerFitScale(1920, 1080, 1280, 800)).toBe(1);
  });

  it("riduce sul lato più stretto, mantenendo le proporzioni", () => {
    // 1280×800 in 640×800 → vincola la larghezza
    expect(viewerFitScale(640, 800, 1280, 800)).toBe(0.5);
    // 1280×800 in 1280×400 → vincola l'altezza
    expect(viewerFitScale(1280, 400, 1280, 800)).toBe(0.5);
    // entrambi stretti → vince il più restrittivo
    expect(viewerFitScale(640, 200, 1280, 800)).toBe(0.25);
  });

  it("non riduce quando le dimensioni non sono note", () => {
    expect(viewerFitScale(undefined, 800, 1280, 800)).toBe(1);
    expect(viewerFitScale(1280, 800, undefined, 800)).toBe(1);
    expect(viewerFitScale(0, 0, 1280, 800)).toBe(1);
  });
});
