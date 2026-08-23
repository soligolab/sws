import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../src/store";
import type { SynopticObject, SynopticPage } from "../src/types";

// F8.1/F8.2 — le due logiche che a occhio non si distinguono da quelle vecchie
// ma danno risultati diversi: "distribuisci" a GAP uguali (prima erano le
// POSIZIONI a essere equidistanti, che con larghezze diverse lascia spazi
// disuguali) e "copia stile", che deve trasportare l'aspetto e MAI il tag.

const obj = (o: Partial<SynopticObject> & { id: string }): SynopticObject =>
  ({ type: "rect", x: 0, y: 0, width: 20, height: 20, ...o } as SynopticObject);

const page = (objects: SynopticObject[]): SynopticPage =>
  ({ id: "p1", name: "Page 1", objects });

const load = (objects: SynopticObject[], selected: string[]) => {
  useAppStore.getState().setPages([page(objects)], "p1");
  useAppStore.setState({ selectedObjectIds: selected, selectedObjectId: selected[0] ?? null });
};
const objs = () => useAppStore.getState().pages[0].objects;
const byId = (id: string) => objs().find((o) => o.id === id)!;

describe("distribuisci a gap uguali (F8.1)", () => {
  beforeEach(() => {
    // Larghezze diverse: 10, 40, 10. Estremi a 0 e 100 (bordo destro 110).
    load([
      obj({ id: "a", x: 0,  width: 10 }),
      obj({ id: "b", x: 50, width: 40 }),
      obj({ id: "c", x: 100, width: 10 }),
    ], ["a", "b", "c"]);
  });

  it("lascia lo stesso spazio fra i bordi, non fra le origini", () => {
    useAppStore.getState().alignSelection("distribute-x");
    // Span 0..110 = 110; larghezze 10+40+10 = 60; spazio libero 50 in 2 gap = 25.
    expect(byId("a").x).toBe(0);                       // primo fermo
    expect(byId("b").x).toBe(35);                      // 0+10+25
    expect(byId("c").x).toBe(100);                     // ultimo fermo
    const gap1 = byId("b").x - (byId("a").x + 10);
    const gap2 = byId("c").x - (byId("b").x + 40);
    expect(gap1).toBe(gap2);
  });

  it("fa lo stesso sull'asse verticale", () => {
    load([
      obj({ id: "a", y: 0,  height: 10 }),
      obj({ id: "b", y: 50, height: 40 }),
      obj({ id: "c", y: 100, height: 10 }),
    ], ["a", "b", "c"]);
    useAppStore.getState().alignSelection("distribute-y");
    expect(byId("b").y).toBe(35);
  });
});

describe("uniforma dimensioni (F8.1)", () => {
  it("porta tutti alla larghezza del PRIMO selezionato", () => {
    load([
      obj({ id: "a", width: 30 }),
      obj({ id: "b", width: 80 }),
      obj({ id: "c", width: 55 }),
    ], ["b", "a", "c"]);   // il primo selezionato è "b"
    useAppStore.getState().alignSelection("match-width");
    expect(byId("a").width).toBe(80);
    expect(byId("b").width).toBe(80);
    expect(byId("c").width).toBe(80);
  });
});

describe("copia stile (F8.2)", () => {
  beforeEach(() => {
    load([
      obj({ id: "src", fill: "#ff0000", stroke: "#00ff00", corner_radius: 8, tag: "sorgente.a", width: 33 }),
      obj({ id: "dst", fill: "#000000", tag: "destinazione.b", width: 77 }),
    ], ["src"]);
  });

  it("copia l'aspetto e lascia intatti tag e geometria", () => {
    useAppStore.getState().copyStyle("src");
    useAppStore.setState({ selectedObjectIds: ["dst"], selectedObjectId: "dst" });
    useAppStore.getState().applyStyle();

    const d = byId("dst");
    expect(d.fill).toBe("#ff0000");
    expect(d.stroke).toBe("#00ff00");
    expect(d.corner_radius).toBe(8);
    // I due campi che NON devono viaggiare col pennello.
    expect(d.tag).toBe("destinazione.b");
    expect(d.width).toBe(77);
  });

  it("senza stile in memoria non cambia niente", () => {
    useAppStore.setState({ styleClipboard: null, selectedObjectIds: ["dst"] });
    useAppStore.getState().applyStyle();
    expect(byId("dst").fill).toBe("#000000");
  });
});
