import { describe, it, expect } from "vitest";
import "../src/i18n";
import { motivoIdNonValido, rinomina, sostituisciNelCodice } from "../src/tag/rinominaTag";
import type { FaceplateDef, GlobalScriptDef, RecipeDef, SynopticObject, SynopticPage, TagDef } from "../src/types";

/** Fase 0c: un walker solo rinomina il tag ovunque e dice dove; ciò che non
 *  può cambiare (parametri di faceplate composti) lo segnala. */

const pagina = (id: string, name: string, objects: Partial<SynopticObject>[]): SynopticPage =>
  ({ id, name, objects: objects as SynopticObject[] }) as SynopticPage;

const base = {
  faceplates: [] as FaceplateDef[], tags: [] as TagDef[], sources: [], alarms: [], globalScripts: [] as GlobalScriptDef[], recipes: [] as RecipeDef[],
};

describe("sostituisciNelCodice", () => {
  it("cambia solo i letterali fra apici, in tutte e tre le forme", () => {
    const r = sostituisciNelCodice(`v = tags["a.b"] + tags['a.b']\ntags.write("a.b", 1); tags.read('a.b'); x = "a.b"; tags["a.bc"]`, "a.b", "c.d");
    expect(r.n).toBe(4);
    expect(r.testo).toBe(`v = tags["c.d"] + tags['c.d']\ntags.write("c.d", 1); tags.read('c.d'); x = "a.b"; tags["a.bc"]`);
  });
});

describe("rinomina", () => {
  it("pagine: campi tag, binding (stringa, {tag}, {expr}), collezioni e celle di griglia", () => {
    const pg = pagina("p1", "Impianto", [
      { id: "o1", type: "text", x: 0, y: 0, tag: "pompa.v", visible_tag: "altro" },
      { id: "o2", type: "rect", x: 0, y: 0, bindings: { fill: "pompa.v", width: { tag: "pompa.v", in_min: 0 }, opacity: { expr: "{ pompa.v } > 1 && {altro}" } } },
      { id: "o3", type: "trend", x: 0, y: 0, trend_tags: [{ tag: "pompa.v", label: "v" }, { tag: "altro" }] } as never,
      { id: "o4", type: "grid", x: 0, y: 0, grid_cells: [{ row: 0, col: 0, visible_tag: "pompa.v", child: { id: "c", type: "led", x: 0, y: 0, tag: "pompa.v" } }] } as never,
      { id: "o5", type: "xy_plot", x: 0, y: 0, xy_series: [{ tag: "x", y_tag: "pompa.v" }] } as never,
    ]);
    const e = rinomina("pompa.v", "pompa.velocita", { ...base, pages: [pg] });
    const s = JSON.stringify(e.pages);
    expect(s).not.toContain("pompa.v\"");
    expect(s).not.toContain("{ pompa.v }");
    expect(s).toContain("\"altro\"");
    expect(e.pages[0].objects[1].bindings).toEqual({
      fill: "pompa.velocita", width: { tag: "pompa.velocita", in_min: 0 }, opacity: { expr: "{pompa.velocita} > 1 && {altro}" },
    });
    expect(e.pagineCambiate.has("p1")).toBe(true);
    expect(e.punti).toEqual([{ tipo: "pagina", dove: expect.stringContaining("Impianto"), n: 8, pageId: "p1" }]);
    expect(e.nonRinominabili).toEqual([]);
  });

  it("una pagina senza il tag resta lo stesso riferimento", () => {
    const pg = pagina("p2", "Vuota", [{ id: "o", type: "text", x: 0, y: 0, tag: "altro" }]);
    const e = rinomina("pompa.v", "x", { ...base, pages: [pg] });
    expect(e.pages[0]).toBe(pg);
    expect(e.punti).toEqual([]);
  });

  it("faceplate: definizione riscritta; l'id composto da un parametro è segnalato, non taciuto", () => {
    const fp: FaceplateDef = {
      id: "fp", label: "Pompa", params: ["p"],
      objects: [
        { id: "a", type: "led", x: 0, y: 0, tag: "{p}.on" } as SynopticObject,
        { id: "b", type: "text", x: 0, y: 0, tag: "comune.allarme" } as SynopticObject,
      ],
    };
    const pg = pagina("p3", "Zona", [
      { id: "i", type: "faceplate", x: 0, y: 0, faceplate_id: "fp", faceplate_params: { p: "zona1" } } as never,
    ]);
    const e1 = rinomina("comune.allarme", "comune.alarm", { ...base, pages: [pg], faceplates: [fp] });
    expect(e1.faceplateCambiati.has("fp")).toBe(true);
    expect((e1.faceplates[0].objects[1] as SynopticObject).tag).toBe("comune.alarm");
    expect(e1.nonRinominabili).toEqual([]);

    const e2 = rinomina("zona1.on", "zona1.marcia", { ...base, pages: [pg], faceplates: [fp] });
    expect(e2.punti).toEqual([]);
    expect(e2.nonRinominabili).toEqual([{ tipo: "pagina", dove: expect.stringContaining("Zona"), n: 1, pageId: "p3" }]);
    // il valore del parametro non si tocca
    expect((e2.pages[0].objects[0] as never as { faceplate_params: Record<string, string> }).faceplate_params).toEqual({ p: "zona1" });
  });

  it("sorgenti, allarmi, tag calcolati, script (trigger e codice), ricette", () => {
    const e = rinomina("t.old", "t.new", {
      pages: [], faceplates: [],
      tags: [
        { id: "t.old", description: "", data_type: "float" },
        { id: "calc", description: "", data_type: "float", expression: 'tags["t.old"] * 2' },
      ],
      sources: [
        { kind: "modbus_tcp", id: "plc", registers: [{ tag: "t.old", address: 1 }, { tag: "x", address: 2 }] },
        { kind: "mqtt", id: "brk", topics: [{ tag: "t.old", topic: "a/b" }] },
      ] as never,
      alarms: [{ id: "al", tag: "t.old", inhibit_tag: "t.old", condition: { kind: "above", threshold: 1 } }] as never,
      globalScripts: [{ id: "s", enabled: true, trigger: { kind: "tag_change", tag: "t.old", edge: "any" }, code: "v = tags.read('t.old')" }],
      recipes: [{ id: "r", name: "Ricetta A", setpoints: [{ tag: "t.old", value: 1 }, { tag: "x", value: 2 }] }],
    });
    expect(e.tags.map((t) => t.id)).toEqual(["t.new", "calc"]);
    expect(e.tags[1].expression).toBe('tags["t.new"] * 2');
    expect(JSON.stringify(e.sources)).not.toContain("t.old");
    expect(e.alarms[0]).toMatchObject({ tag: "t.new", inhibit_tag: "t.new" });
    expect(e.globalScripts[0]).toMatchObject({ trigger: { tag: "t.new" }, code: "v = tags.read('t.new')" });
    expect(e.recipes[0].setpoints[0].tag).toBe("t.new");
    expect(e.ricetteCambiate.has("r")).toBe(true);
    expect(e.tagsCambiati && e.sourcesCambiate && e.alarmsCambiati && e.scriptCambiati).toBe(true);
    expect(e.punti.map((p) => p.tipo).sort()).toEqual(["allarme", "espressione", "ricetta", "script", "sorgente", "sorgente"]);
    expect(e.punti.find((p) => p.tipo === "allarme")?.n).toBe(2);
  });

  it("il nuovo id: vuoto, segnaposto, uguale o già preso non vanno", () => {
    const esistenti = new Set(["a", "b"]);
    expect(motivoIdNonValido("", esistenti, "a")).not.toBeNull();
    expect(motivoIdNonValido("{p}.x", esistenti, "a")).not.toBeNull();
    expect(motivoIdNonValido("a", esistenti, "a")).not.toBeNull();
    expect(motivoIdNonValido("b", esistenti, "a")).not.toBeNull();
    expect(motivoIdNonValido("c", esistenti, "a")).toBeNull();
  });
});
