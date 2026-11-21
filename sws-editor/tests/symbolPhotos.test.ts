/** Photos in project symbols (plan docs/plans/2026-11-21-simboli-fase-3-foto.md):
 *  the model of the editor, the drawing on the web, where a photo is used, and
 *  the names of the photos that arrive inside a file. */
import { describe, it, expect } from "vitest";
import { newImage, photoNameOk, setImageOpacity, transformOps, draws, layers, type Op } from "../src/symbols/editor/model";
import { withPhoto, withPhotos } from "../src/symbols/lib/SimboloLib";
import { imageUses, renameSymbolPhoto, symbolPhotos } from "../src/images/usage";
import { contentName, dataUriBytes } from "../src/symbols/editor/photoUpload";
import boiler from "../../tests/fixtures/simboli-prj/photo-boiler.json";
import type { DescrizioneSimbolo } from "../src/types";

// As the runtime sends it: the attributes of a shape or a photo as pairs.
const ORDER = ["x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "d"];
const d = {
  ...boiler,
  ops: (boiler.ops as Record<string, unknown>[]).map((op) => (op.op === "parte" || !op.geo ? op : {
    ...op, geo: Object.entries(op.geo as Record<string, number>).sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0])),
  })),
} as unknown as DescrizioneSimbolo;

describe("the photo in the editor's model", () => {
  it("fits the drawing, proportions kept, centred", () => {
    expect(newImage("a.png", 100, 120, { width: 200, height: 100 }))
      .toEqual({ op: "image", src: "a.png", geo: [["x", 0], ["y", 35], ["width", 100], ["height", 50]] });
    expect(newImage("a.png", 100, 120, { width: 50, height: 300 }).geo)
      .toEqual([["x", 40], ["y", 0], ["width", 20], ["height", 120]]);
    // Without a size it fills the drawing.
    expect(newImage("a.png", 100, 120).geo).toEqual([["x", 0], ["y", 0], ["width", 100], ["height", 120]]);
  });

  it("draws in its layer, and moves and resizes like a rectangle", () => {
    const ops = d.ops as Op[];
    expect(draws(ops[0])).toBe(true);
    expect(layers(d).find((l) => l.id === "fan")?.ops).toEqual([4]);
    const moved = transformOps(d, [0], { sx: 0.5, sy: 0.5, tx: 10, ty: 5 }).ops[0] as Op;
    expect(moved.geo).toEqual([["x", 10], ["y", 5], ["width", 50], ["height", 60]]);
    expect(setImageOpacity(d, 0, 0.4).ops[0]).toMatchObject({ opacity: 0.4 });
    expect("opacity" in (setImageOpacity(d, 4, 1).ops[4] as Op)).toBe(false);
  });

  it("takes only a file name the compiler accepts", () => {
    for (const ok of ["a.png", "Boiler_2.WEBP", "x-y.jpeg"]) expect(photoNameOk(ok)).toBe(true);
    for (const bad of ["a.svg", "../a.png", ".a.png", "a/b.png", "a b.png", "a.gif"]) expect(photoNameOk(bad)).toBe(false);
  });
});

describe("the photo on the web", () => {
  const layer = [
    '  <g id="fan" data-layer="part" stroke="#1c2329">',
    '    <image data-src="fan.png" x="1" y="2" width="3" height="4"/>',
    '    <image data-src="missing.png" x="1" y="2" width="3" height="4"/>',
    "  </g>",
  ].join("\n");

  it("points each image at its photo, and leaves out the one not loaded", () => {
    const out = withPhotos(layer, { "fan.png": "blob:abc" });
    expect(out).toContain('<image href="blob:abc" data-src="fan.png" x="1"');
    expect(out).toContain('<image data-src="missing.png"');
    expect(withPhotos("<g/>", { "fan.png": "x" })).toBe("<g/>");
  });

  it("swaps every photo of a layer for a signal entry's", () => {
    const out = withPhoto(withPhotos(layer, { "fan.png": "blob:abc" }), "blob:on");
    expect(out.match(/href="blob:on"/g)).toHaveLength(2);
    expect(out).not.toContain("blob:abc");
  });
});

describe("where a photo is used", () => {
  it("lists the photos of a symbol, the ones of its signal entries too", () => {
    expect(symbolPhotos(d)).toEqual(["boiler.jpg", "fan-cutout.png", "flame-off.png", "flame-low.png", "flame-high.png"]);
    const uses = imageUses([], [], [d]);
    expect(uses.get("flame-high.png")).toEqual([{ pageId: "photo-boiler", pageName: "Caldaia fotografata", symbol: true }]);
  });

  it("follows a rename, and leaves alone a symbol that doesn't use it", () => {
    const r = renameSymbolPhoto(d, "flame-low.png", "flame-2.png");
    expect(symbolPhotos(r)).toContain("flame-2.png");
    expect(symbolPhotos(r)).not.toContain("flame-low.png");
    expect(renameSymbolPhoto(d, "other.png", "x.png")).toBe(d);
  });
});

describe("a photo that arrives inside a file", () => {
  it("is decoded, and named by its content", () => {
    const a = dataUriBytes("data:image/png;base64,iVBORw0KGgo=");
    expect(a?.type).toBe("image/png");
    expect(Array.from(a!.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(dataUriBytes("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    const n = contentName(a!.bytes, "png", "svg");
    expect(n).toMatch(/^svg-[0-9a-f]{16}\.png$/);
    expect(photoNameOk(n)).toBe(true);
    expect(contentName(a!.bytes, "png", "svg")).toBe(n);
    expect(contentName(new Uint8Array([1, 2, 3]), "png", "svg")).not.toBe(n);
  });
});

describe("the symbol file with its photos", () => {
  it("is a zip that reads back the symbol and the photos it names", async () => {
    const { symbolZip, readSymbolZip, isZip, readSymbolFile } = await import("../src/symbols/editor/symbolFile");
    const photos = { "boiler.jpg": new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), "unused.png": new Uint8Array([1]) };
    const zip = symbolZip(d, photos);
    expect(isZip(zip)).toBe(true);
    const r = readSymbolZip(zip, ["photo-boiler"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.d.slug).not.toBe("photo-boiler");
    expect(Object.keys(r.photos)).toEqual(["boiler.jpg"]);
    expect(Array.from(r.photos["boiler.jpg"])).toEqual([0xff, 0xd8, 0xff, 1, 2, 3]);
    // Not a symbol, or the JSON reader handed a zip: refused, not crashed.
    expect(readSymbolZip(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), []).ok).toBe(false);
    expect(readSymbolFile("PK\u0003\u0004", [])).toEqual({ ok: false, error: "newer" });
  });
});
