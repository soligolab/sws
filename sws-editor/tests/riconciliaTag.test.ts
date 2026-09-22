import { describe, it, expect } from "vitest";
import "../src/i18n";
import { deduciTipo, ePercorsoDiUnaRadice, pianoCreazione, riferimentiDelProgetto, tipoDaEnIp, tipoDaS7 } from "../src/tag/riconciliaTag";
import { buildTagUsage, usiDiUnTag } from "../src/search/tagUsage";
import type { ProjectInfo, SynopticObject, SynopticPage, TagDef, TypeDef } from "../src/types";

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

describe("ePercorsoDiUnaRadice", () => {
  it("si riconosce dal prefisso, seguito da punto o parentesi", () => {
    const r = ["motore1", "valvole"];
    expect(ePercorsoDiUnaRadice("motore1.velocita", r)).toBe(true);
    expect(ePercorsoDiUnaRadice("valvole[2].stato", r)).toBe(true);
    expect(ePercorsoDiUnaRadice("motore1", r)).toBe(false);
    expect(ePercorsoDiUnaRadice("motore1bis.x", r)).toBe(false);
    expect(ePercorsoDiUnaRadice("altro.tag", r)).toBe(false);
    expect(ePercorsoDiUnaRadice("motore1.velocita", [])).toBe(false);
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

  /** Fase 1b/1d: `motore1.velocita` è una FOGLIA dell'istanza `motore1`, non
   *  un id sconosciuto. Creandola come tag piatto nascerebbe una collisione
   *  che il validatore rifiuta, e una delle due non si raggiungerebbe più. */
  it("un percorso dentro un'istanza non si crea come tag piatto", () => {
    const p = progetto({
      tags: [
        { id: "motore1", description: "", data_type: "f64", type_ref: "Motore" },
        { id: "valvole", description: "", data_type: "u16", array: [4] },
      ],
    });
    const pagina2 = pagina([
      { id: "a", type: "text", x: 0, y: 0, tag: "motore1.velocita" },
      { id: "b", type: "text", x: 0, y: 0, tag: "valvole[2]" },
      { id: "c", type: "text", x: 0, y: 0, tag: "motore1bis.x" },
    ]);
    const piano = pianoCreazione({ project: p, pages: [pagina2], tagInAttesa: [] });
    // solo l'id che NON è un percorso di una radice
    expect(piano.map((t) => t.id)).toEqual(["motore1bis.x"]);
  });

  it("niente da creare = piano vuoto", () => {
    const p = progetto({ tags: [
      { id: "pompa.on", description: "", data_type: "bool" },
      { id: "pompa.velocita", description: "", data_type: "float" },
    ] });
    expect(pianoCreazione({ project: p, pages: [pg], tagInAttesa: [] })).toEqual([]);
  });
});

/** Il difetto che il maintainer ha trovato il 22-09-2026: la scheda Variabili
 *  lasciava **cancellare** un'istanza che una pagina stava usando, perché
 *  l'oggetto si lega a `motore1.velocita` e non a `motore1`, e chiedere gli
 *  usi della sola radice rispondeva «nessuno». La pagina restava legata a un
 *  percorso che non esiste più, senza un avviso. */
describe("usiDiUnTag — gli usi di una foglia sono usi della radice", () => {
  const types: TypeDef[] = [
    { id: "Motore", members: [
      { name: "velocita", data_type: "f32" },
      { name: "marcia", data_type: "bool" },
    ]},
  ];
  const istanza: TagDef = { id: "motore1", description: "", data_type: "f64", type_ref: "Motore" };
  const piatto: TagDef = { id: "pv1.potenza", description: "", data_type: "f64" };
  const usi = buildTagUsage({
    pages: [{ id: "p", name: "Impianto", objects: [
      { id: "t", type: "text", x: 0, y: 0, tag: "motore1.velocita" },
    ] as SynopticObject[] }] as SynopticPage[],
  });

  it("un'istanza usata da una pagina risulta usata", () => {
    expect(usiDiUnTag(istanza, usi, types)).toHaveLength(1);
    expect(usiDiUnTag(istanza, usi, types)[0].where).toContain("Impianto");
  });

  it("un'istanza che nessuno usa resta libera", () => {
    const altra: TagDef = { ...istanza, id: "motore2" };
    expect(usiDiUnTag(altra, usi, types)).toEqual([]);
  });

  it("per un tag piatto è la risposta di sempre, senza costi", () => {
    expect(usiDiUnTag(piatto, usi, types)).toEqual([]);
    expect(usiDiUnTag(piatto, usi, [])).toEqual([]);
  });

  it("gli usi doppi non si contano due volte", () => {
    const usi2 = buildTagUsage({
      pages: [{ id: "p", name: "Impianto", objects: [
        { id: "a", type: "text", x: 0, y: 0, tag: "motore1.velocita" },
        { id: "b", type: "led", x: 0, y: 0, tag: "motore1.marcia" },
      ] as SynopticObject[] }] as SynopticPage[],
    });
    // due foglie, la stessa pagina: un solo punto d'uso
    expect(usiDiUnTag(istanza, usi2, types)).toHaveLength(1);
  });
});
