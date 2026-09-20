import { describe, it, expect } from "vitest";
import { migraTestiProgetto } from "../src/i18n/migraTesti";
import type { AlarmDef, FaceplateDef, SynopticObject, SynopticPage } from "../src/types";

const obj = (id: string, extra: Record<string, unknown>) =>
  ({ id, type: "text", x: 0, y: 0, width: 10, height: 10, ...extra }) as unknown as SynopticObject;
const pagina = (id: string, objects: SynopticObject[]) => ({ id, name: id, objects }) as unknown as SynopticPage;

describe("migraTestiProgetto", () => {
  it("trasforma i testi letterali in token e riempie la tabella", () => {
    const r = migraTestiProgetto({
      pages: [pagina("p1", [obj("a", { text: "Avvio pompa" }), obj("b", { label: "Potenza (W)", tag: "x.y" })])],
      faceplates: [], alarms: [], tabella: null,
    });
    const o = r.pages[0].objects;
    expect(o[0].text).toBe("{{t0001}}");
    expect(o[1].label).toBe("{{t0002}}");
    expect(o[1].tag).toBe("x.y");
    expect(r.tabella.entries.map((e) => e.values.it)).toEqual(["Avvio pompa", "Potenza (W)"]);
    expect(r.riepilogo).toMatchObject({ campi: 2, vociNuove: 2, riusi: 0, pagineToccate: ["p1"] });
  });

  it("testi uguali condividono la voce, anche fra pagine, faceplate e allarmi", () => {
    const fp = { id: "f", label: "f", params: [], objects: [obj("c", { text: "Avvio" })] } as FaceplateDef;
    const al = [{ id: "a1", tag: "t", condition: {}, message: "Avvio" }] as unknown as AlarmDef[];
    const r = migraTestiProgetto({
      pages: [pagina("p1", [obj("a", { text: "Avvio" })]), pagina("p2", [obj("b", { text: "Avvio" })])],
      faceplates: [fp], alarms: al, tabella: null,
    });
    expect(r.tabella.entries).toHaveLength(1);
    expect(r.pages[1].objects[0].text).toBe("{{t0001}}");
    expect(r.faceplates[0].objects[0].text).toBe("{{t0001}}");
    expect(r.alarms[0].message).toBe("{{t0001}}");
    expect(r.riepilogo).toMatchObject({ campi: 4, vociNuove: 1, riusi: 3, allarmi: 1, faceplateToccati: ["f"] });
  });

  it("riusa una voce già in tabella e non ne tocca le traduzioni", () => {
    const r = migraTestiProgetto({
      pages: [pagina("p1", [obj("a", { text: "SWS" })])], faceplates: [], alarms: [],
      tabella: { default: "it", langs: ["it", "en"], entries: [{ key: "t0001", values: { it: "SWS", en: "SWS!" } }] },
    });
    expect(r.pages[0].objects[0].text).toBe("{{t0001}}");
    expect(r.tabella.entries).toHaveLength(1);
    expect(r.tabella.entries[0].values.en).toBe("SWS!");
  });

  it("lascia stare token, numeri, segnaposto nudi e campi vuoti; è idempotente", () => {
    const p = [pagina("p1", [obj("a", { text: "{{t0009}}", label: "12.5", format: "{value:.1f}", unit: "" })])];
    const r = migraTestiProgetto({ pages: p, faceplates: [], alarms: [], tabella: null });
    expect(r.pages[0]).toBe(p[0]);
    expect(r.riepilogo.campi).toBe(0);
    const uno = migraTestiProgetto({ pages: [pagina("q", [obj("a", { text: "Ciao" })])], faceplates: [], alarms: [], tabella: null });
    const due = migraTestiProgetto({ pages: uno.pages, faceplates: [], alarms: [], tabella: uno.tabella });
    expect(due.riepilogo.campi).toBe(0);
  });
});
