/** Le variabili di un dispositivo (04-10-2026): cosa se ne va eliminandolo, e
 *  cosa un dispositivo nuovo può riprendere. */
import { describe, expect, it } from "vitest";
import { pianoEliminazione, radiceDi, variabiliRiassociabili } from "../src/config/sorgenti/variabiliDispositivo";
import type { ModbusRtuSource } from "../src/types";

const bus = (devices: ModbusRtuSource["devices"]): ModbusRtuSource => ({
  kind: "modbus_rtu", id: "linea", device: "/dev/ttyCOM2", baud_rate: 57600, parity: "N", data_bits: 8, stop_bits: 1, poll_interval_ms: 1000, devices,
});
const reg = (tag: string) => ({ tag, address: 0, scale: 1 });

describe("pianoEliminazione", () => {
  const b = bus([
    { unit_id: 1, registers: [reg("a.pv"), reg("a.sp"), reg("condivisa.x")] },
    { unit_id: 2, registers: [reg("b.pv"), reg("condivisa.y")] },
  ]);
  const project = {
    sources: [b],
    tags: [
      { id: "a", type_ref: "T" }, { id: "b", type_ref: "T" }, { id: "condivisa", type_ref: "U" }, { id: "altro", data_type: "u16" },
    ],
    types: [{ id: "T", members: [] }, { id: "U", members: [] }],
  } as never;

  it("toglie le variabili del dispositivo, non quelle che altri mappano, e tiene un tipo ancora usato", () => {
    const p = pianoEliminazione(project, b, 1);
    expect(p.variabili).toEqual(["a"]);
    expect(p.tipi).toEqual([]); // T lo usa ancora «b»
    expect(p.tags.map((t) => t.id)).toEqual(["b", "condivisa", "altro"]);
  });

  it("l'ultimo dispositivo di un tipo se lo porta via", () => {
    const solo = bus([{ unit_id: 2, registers: [reg("b.pv")] }]);
    const p = pianoEliminazione({ ...project, sources: [solo], tags: [{ id: "b", type_ref: "T" }] } as never, solo, 2);
    expect(p.tipi).toEqual(["T"]);
    expect(p.types.map((t) => t.id)).toEqual(["U"]);
  });

  it("un tipo usato come membro di un altro tipo resta", () => {
    const solo = bus([{ unit_id: 2, registers: [reg("b.pv")] }]);
    const p = pianoEliminazione({ sources: [solo], tags: [{ id: "b", type_ref: "T" }], types: [{ id: "T", members: [] }, { id: "V", members: [{ name: "x", type_ref: "T" }] }] } as never, solo, 2);
    expect(p.tipi).toEqual([]);
  });

  it("tipi annidati: i sotto-tipi dei gruppi se ne vanno con il tipo, se non li usa nessun altro", () => {
    const solo = bus([{ unit_id: 2, registers: [reg("b.ingressi.di1")] }]);
    const types = [
      { id: "M_ingressi", members: [{ name: "ingressi", type_ref: "M__ingressi" }] },
      { id: "M", members: [{ name: "ingressi", type_ref: "M__ingressi" }, { name: "uscite", type_ref: "M__uscite" }] },
      { id: "M__ingressi", members: [{ name: "di1", data_type: "bool" }] },
      { id: "M__uscite", members: [{ name: "do1", data_type: "bool" }] },
    ];
    // «b» ha il tipo coi soli ingressi; «c» il tipo completo, che usa anche M__ingressi.
    const p = pianoEliminazione({ sources: [solo], tags: [{ id: "b", type_ref: "M_ingressi" }, { id: "c", type_ref: "M" }], types } as never, solo, 2);
    expect(p.tipi).toEqual(["M_ingressi"]); // M__ingressi lo usa ancora M
    const p2 = pianoEliminazione({ sources: [solo], tags: [{ id: "b", type_ref: "M_ingressi" }], types } as never, solo, 2);
    expect(p2.tipi.sort()).toEqual(["M_ingressi"]); // M resta (non è di «b»), e M usa M__ingressi
    const p3 = pianoEliminazione({ sources: [solo], tags: [{ id: "b", type_ref: "M_ingressi" }], types: types.filter((t) => t.id !== "M") } as never, solo, 2);
    expect(p3.tipi.sort()).toEqual(["M__ingressi", "M_ingressi"]);
  });

  it("radici", () => {
    expect(radiceDi("atr_3.pv1")).toBe("atr_3");
    expect(radiceDi("valvole[2].stato")).toBe("valvole");
  });
});

describe("variabiliRiassociabili", () => {
  it("le istanze del modello (anche _v2) che nessun dispositivo mappa", () => {
    const project = {
      sources: [bus([{ unit_id: 1, registers: [reg("usata.pv")] }])],
      tags: [
        { id: "usata", type_ref: "pixsys_mcm260x_5ad" },
        { id: "libera", type_ref: "pixsys_mcm260x_5ad_v2" },
        { id: "altro_modello", type_ref: "pixsys_mcm260x_9ad" },
      ],
      types: [{ id: "pixsys_mcm260x_5ad", members: [] }, { id: "pixsys_mcm260x_5ad_v2", members: [] }, { id: "pixsys_mcm260x_9ad", members: [] }],
    } as never;
    expect(variabiliRiassociabili(project, "pixsys_mcm260x_5ad").map((x) => x.tag.id)).toEqual(["libera"]);
  });
});
