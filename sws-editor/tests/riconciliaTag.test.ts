import { describe, it, expect } from "vitest";
import "../src/i18n";
import { deduciTipo, pianoCreazione, riferimentiDelProgetto, tipoDaEnIp, tipoDaS7 } from "../src/tag/riconciliaTag";
import type { ProjectInfo, SynopticObject, SynopticPage } from "../src/types";

/** Fase 0b: al salvataggio ogni id referenziato e non dichiarato diventa una
 *  variabile. Prima c'erano cinque strade di creazione e una lista «in attesa»
 *  che si perdeva cambiando scheda; un id digitato in un TagInput e mai
 *  definito restava sconosciuto e il valore non arrivava, in silenzio. */

const progetto = (over: Partial<ProjectInfo> = {}): ProjectInfo =>
  ({ meta: { name: "p", version: "1" }, tags: [], sources: [], ...over }) as unknown as ProjectInfo;

const pagina = (objects: Partial<SynopticObject>[]): SynopticPage =>
  ({ id: "pg", name: "Impianto", objects: objects as SynopticObject[] }) as SynopticPage;

describe("riferimentiDelProgetto", () => {
  it("raccoglie pagine, sorgenti, allarmi e script; scarta vuoti e segnaposto", () => {
    const p = progetto({
      sources: [{ kind: "modbus_tcp", id: "m", registers: [{ tag: "pompa.velocita", address: 1 }] }] as never,
      alarms: [{ id: "a", tag: "serbatoio.livello", condition: { kind: "above", threshold: 1 } }] as never,
      global_scripts: [{ id: "s", name: "s", code: "tags.write('cnt', 1)", trigger: { kind: "interval", interval_ms: 1000 } }] as never,
    });
    const refs = riferimentiDelProgetto(p, [pagina([
      { id: "o1", type: "text", x: 0, y: 0, tag: "temp.ambiente" },
      { id: "o2", type: "led", x: 0, y: 0, tag: "" },
      { id: "o3", type: "gauge", x: 0, y: 0, tag: "{tag_prefix}.pv" },
    ])]);
    expect([...refs].sort()).toEqual(["cnt", "pompa.velocita", "serbatoio.livello", "temp.ambiente"]);
  });
});

describe("deduciTipo", () => {
  it("dalla mappatura che alimenta il tag: S7, EtherNet/IP, Host", () => {
    const p = progetto({
      sources: [
        { kind: "s7", id: "plc", tags: [{ tag: "plc.marcia", data_type: "bool", address: "DB1.DBX0.0" }, { tag: "plc.cnt", data_type: "dint", address: "DB1.DBD4" }] },
        { kind: "enip", id: "ab", tags: [{ tag: "ab.speed", plc_tag: "Speed", data_type: "real" }] },
        { kind: "host", id: "h", poll_interval_ms: 1000, metrics: [{ tag: "host.nome", metric: "hostname" }, { tag: "host.temp", metric: "temp", param: "soc-thermal" }] },
      ] as never,
    });
    // D5: il tipo esatto della riga, non più «int»/«float» a perdere.
    expect(deduciTipo("plc.marcia", p, [])).toBe("bool");
    expect(deduciTipo("plc.cnt", p, [])).toBe("i32");
    expect(deduciTipo("ab.speed", p, [])).toBe("f32");
    expect(deduciTipo("host.nome", p, [])).toBe("string");
    expect(deduciTipo("host.temp", p, [])).toBe("f64");
    expect(tipoDaS7("real")).toBe("f32");
    expect(tipoDaS7("word")).toBe("u16");
    expect(tipoDaEnIp("bool")).toBe("bool");
    expect(tipoDaEnIp("lint")).toBe("i64");
  });

  it("dall'oggetto che lo usa come tag primario, altrimenti float", () => {
    const pg = pagina([
      { id: "l", type: "led", x: 0, y: 0, tag: "pompa.on" },
      { id: "s", type: "state_lamp", x: 0, y: 0, tag: "valvola.stato" },
      { id: "t", type: "text", x: 0, y: 0, tag: "misura" },
    ]);
    expect(deduciTipo("pompa.on", progetto(), [pg])).toBe("bool");
    expect(deduciTipo("valvola.stato", progetto(), [pg])).toBe("i64");
    expect(deduciTipo("misura", progetto(), [pg])).toBe("f64");
    expect(deduciTipo("sconosciuto", progetto(), [pg])).toBe("f64");
  });
});

describe("pianoCreazione", () => {
  const pg = pagina([
    { id: "l", type: "led", x: 0, y: 0, tag: "pompa.on" },
    { id: "g", type: "gauge", x: 0, y: 0, tag: "pompa.velocita" },
  ]);

  it("crea solo ciò che è referenziato e non dichiarato, con storico spento", () => {
    const p = progetto({ tags: [{ id: "pompa.velocita", description: "", data_type: "float" }] });
    const piano = pianoCreazione({ project: p, pages: [pg], tagInAttesa: [] });
    expect(piano).toEqual([{ id: "pompa.on", description: "", data_type: "bool", history: false }]);
  });

  it("la definizione in attesa vince sulla deduzione, ma solo se ancora referenziata", () => {
    const piano = pianoCreazione({
      project: progetto(), pages: [pg],
      tagInAttesa: [
        { id: "pompa.on", description: "Pompa in marcia", data_type: "bool", unit: "", history: true },
        { id: "digitato.a.meta", description: "", data_type: "float" },
      ],
    });
    expect(piano.map((t) => t.id)).toEqual(["pompa.on", "pompa.velocita"]);
    expect(piano[0]).toMatchObject({ description: "Pompa in marcia", history: true });
    expect(piano[1]).toMatchObject({ data_type: "f64", history: false });
  });

  it("niente da creare = piano vuoto", () => {
    const p = progetto({ tags: [
      { id: "pompa.on", description: "", data_type: "bool" },
      { id: "pompa.velocita", description: "", data_type: "float" },
    ] });
    expect(pianoCreazione({ project: p, pages: [pg], tagInAttesa: [] })).toEqual([]);
  });
});
