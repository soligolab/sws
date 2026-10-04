/** Bus e dispositivi Modbus nell'IDE (04-10-2026): la stessa regola del
 *  runtime per il formato di prima, il focus composito dell'albero, e le
 *  mappature dentro i dispositivi viste dal catalogo dei tag e dalla rinomina. */
import { describe, expect, it } from "vitest";
import "../src/i18n";
import {
  conDispositivi, dispositiviDi, etichettaDispositivo, idElementiProtocolli, leggiFocus, nuovoDispositivo,
  prossimoUnitId,
} from "../src/config/sorgenti/modbusDispositivi";
import { emptyModbusRtu } from "../src/config/sorgenti/vuote";
import { sourceTagIds } from "../src/tagCatalog";
import { rinomina } from "../src/tag/rinominaTag";
import type { ModbusRtuSource, ModbusTcpSource, ProjectInfo, SourceDef } from "../src/types";

const vecchio: ModbusTcpSource = {
  kind: "modbus_tcp", id: "plc", host: "h", port: 502, unit_id: 4, poll_interval_ms: 1000, ordine: "cdab",
  registers: [{ tag: "a", address: 1, scale: 1 }],
};

const linea: ModbusRtuSource = {
  ...emptyModbusRtu(), id: "linea",
  devices: [{ unit_id: 1, registers: [{ tag: "t1", address: 0, scale: 1 }] }, { unit_id: 3, nome: "inverter", registers: [] }],
};

describe("dispositiviDi / conDispositivi", () => {
  it("il formato di prima è un bus con un dispositivo, con il suo unit id e il suo ordine", () => {
    expect(dispositiviDi(vecchio)).toEqual([{ unit_id: 4, ordine: "cdab", registers: vecchio.registers }]);
  });

  it("con devices i campi di prima sono ignorati, e un bus senza registri non ha dispositivi", () => {
    expect(dispositiviDi({ ...linea, registers: [{ tag: "x", address: 9, scale: 1 }] }).map((d) => d.unit_id)).toEqual([1, 3]);
    expect(dispositiviDi({ ...vecchio, registers: [] })).toEqual([]);
  });

  it("conDispositivi passa al formato nuovo e toglie i campi di prima", () => {
    const b = conDispositivi(vecchio, dispositiviDi(vecchio));
    expect(b.registers).toBeUndefined();
    expect(b.ordine).toBeUndefined();
    expect(b.devices?.[0]).toMatchObject({ unit_id: 4, ordine: "cdab" });
  });

  it("un bus nuovo nasce col formato nuovo e un dispositivo", () => {
    const b = emptyModbusRtu();
    expect(b.registers).toBeUndefined();
    expect(b.devices).toEqual([{ unit_id: 1, registers: [] }]);
  });
});

describe("nuovoDispositivo", () => {
  it("prende il primo unit id libero", () => {
    expect(prossimoUnitId(linea)).toBe(2);
    expect(nuovoDispositivo(linea)).toEqual({ unit_id: 2, registers: [] });
  });

  it("da una voce di catalogo copia tutto tranne l'unit id, registri compresi e non condivisi", () => {
    const voce = { modello: "pixsys/atr244@1", ordine: "cdab" as const, timeout_ms: 800, registers: [{ tag: "", address: 5, scale: 1 }] };
    const d = nuovoDispositivo(linea, voce);
    expect(d).toMatchObject({ unit_id: 2, modello: "pixsys/atr244@1", ordine: "cdab", timeout_ms: 800 });
    expect(d.registers).toEqual(voce.registers);
    expect(d.registers[0]).not.toBe(voce.registers[0]);
  });

  it("etichetta: il nome con l'unit id, o solo l'unit id", () => {
    expect(etichettaDispositivo({ unit_id: 3, nome: "inverter", registers: [] })).toBe("inverter · 3");
    expect(etichettaDispositivo({ unit_id: 1, registers: [] })).toBe("unit 1");
  });
});

describe("il focus dell'albero", () => {
  const sources: SourceDef[] = [linea, { ...vecchio, id: "linea/3" }];

  it("bus, dispositivo, o niente", () => {
    expect(leggiFocus("linea", sources)).toEqual({ bus: "linea", unit: null });
    expect(leggiFocus("linea/3", sources)).toEqual({ bus: "linea/3", unit: null }); // una sorgente con quel nome vince
    expect(leggiFocus("linea/1", sources)).toEqual({ bus: "linea", unit: 1 });
    expect(leggiFocus("linea/9", sources)).toBeNull();
    expect(leggiFocus(null, sources)).toBeNull();
  });

  it("gli id sceglibili sono le sorgenti e i dispositivi dei bus", () => {
    expect(idElementiProtocolli(sources)).toEqual(["linea", "linea/1", "linea/3", "linea/3", "linea/3/4"]);
  });
});

describe("le mappature dentro i dispositivi", () => {
  it("il catalogo dei tag le vede", () => {
    const p = { meta: { name: "p", version: "1" }, tags: [], sources: [linea, vecchio] } as unknown as ProjectInfo;
    expect([...sourceTagIds(p).keys()].sort()).toEqual(["a", "t1"]);
  });

  it("la rinomina di un tag le raggiunge", () => {
    const e = rinomina("t1", "t2", {
      pages: [], faceplates: [], tags: [{ id: "t1", description: "", data_type: "u16" }],
      sources: [linea] as never, alarms: [], globalScripts: [], recipes: [],
    });
    expect(JSON.stringify(e.sources)).toContain('"tag":"t2"');
    expect(e.sourcesCambiate).toBe(true);
  });
});
