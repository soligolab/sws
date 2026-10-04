/** Un dispositivo completo dal catalogo (04-10-2026): la voce ATR244 vera del
 *  repo, con gli include risolti come fa il runtime, diventa tipo, variabile e
 *  dispositivo del bus. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baseIstanza, daCatalogo, gruppiDi, idTipoDaVoce, urlImmagine } from "../src/config/sorgenti/daCatalogo";
import { registriMappatura } from "../src/config/sorgenti/modbusRegistri";
import { emptyModbus, emptyModbusRtu } from "../src/config/sorgenti/vuote";
import type { RegistroCatalogo, VoceCatalogo } from "../src/types";

const CAT = join(__dirname, "../../catalogo/dispositivi");
const leggi = (id: string) => JSON.parse(readFileSync(join(CAT, `${id}.json`), "utf-8"));

/** Gli include risolti come `catalogo.rs`: prima gli inclusi, un nome ripetuto sostituisce. */
function voce(id: string): VoceCatalogo {
  const m = leggi(id);
  let regs: RegistroCatalogo[] = [];
  const unisci = (r: RegistroCatalogo) => { regs = [...regs.filter((x) => x.nome !== r.nome), r]; };
  for (const inc of m.includi ?? []) for (const r of leggi(inc).registri) unisci(r);
  for (const r of m.registri ?? []) unisci(r);
  return { ...m, registri: regs, origine: "prodotto" };
}

const tutti = (v: VoceCatalogo) => new Set(gruppiDi(v).map((g) => g.nome));

describe("daCatalogo — Pixsys ATR244", () => {
  const atr = voce("pixsys/atr244");
  const bus = { ...emptyModbusRtu(), id: "linea", baud_rate: 19200 };

  it("i gruppi: configurazione non spuntata di default", () => {
    const g = gruppiDi(atr);
    expect(g.map((x) => x.nome)).toEqual(["identificazione", "configurazione", "processo", "comandi"]);
    expect(g.find((x) => x.nome === "configurazione")!.predefinito).toBe(false);
    expect(g.find((x) => x.nome === "processo")!.predefinito).toBe(true);
  });

  it("tipo con tutti i registri, bit come bool, scala → f32 con decimali e unità", () => {
    const r = daCatalogo(atr, bus, { unit: 3, nome: "atr244_3", gruppi: new Set(["processo"]), lingua: "it" }, []);
    expect(r.tipo.id).toBe("pixsys_atr244");
    expect(r.riusaTipo).toBe(false);
    const m = (n: string) => r.tipo.members.find((x) => x.name === n)!;
    expect(m("pv1")).toMatchObject({ data_type: "f32", unit: "°C", decimals: 1 });
    expect(m("allarme1")).toMatchObject({ data_type: "bool" });
    expect(m("manuale").description).toContain("manuale");
    expect(m("indirizzo_slave")).toBeTruthy(); // nel tipo anche se il gruppo non è scelto
    expect(r.tag).toMatchObject({ id: "atr244_3", type_ref: "pixsys_atr244" });
  });

  it("il dispositivo legge solo i gruppi scelti, con formato, scala, bit e sola lettura", () => {
    const r = daCatalogo(atr, bus, { unit: 3, nome: "atr244_3", gruppi: new Set(["processo", "comandi"]), lingua: "it" }, []);
    const d = r.dispositivo;
    expect(d).toMatchObject({ unit_id: 3, nome: "atr244_3", modello: "pixsys/atr244@1", ordine: "cdab", timeout_ms: 1000 });
    const reg = (tag: string) => d.registers.find((x) => x.tag === tag)!;
    expect(reg("atr244_3.pv1")).toMatchObject({ address: 1000, formato: "i16", scale: 0.1, sola_lettura: true });
    expect(reg("atr244_3.sp1")).toMatchObject({ address: 2000, formato: "i16", scale: 0.1 });
    expect(reg("atr244_3.sp1").sola_lettura).toBeUndefined();
    expect(reg("atr244_3.manuale")).toMatchObject({ address: 1004, bit: 9, sola_lettura: true });
    expect(d.registers.some((x) => x.tag === "atr244_3.indirizzo_slave")).toBe(false);
    expect(d.registers.some((x) => x.tag === "atr244_3.firmware")).toBe(false);
    // La colonna «Registri» conta dal formato e dal bit.
    expect(registriMappatura("atr244_3.pv1", undefined, null, reg("atr244_3.pv1")).n).toBe(1);
    expect(registriMappatura("x", undefined, null, { bit: 9 }).dettaglio).toBe("bit 9");
  });

  it("un secondo ATR244 riusa il tipo; un tipo diverso con lo stesso nome ne fa nascere un altro", () => {
    const primo = daCatalogo(atr, bus, { unit: 3, nome: "a", gruppi: tutti(atr), lingua: "it" }, []);
    const secondo = daCatalogo(atr, bus, { unit: 4, nome: "b", gruppi: tutti(atr), lingua: "it" }, [primo.tipo]);
    expect(secondo.riusaTipo).toBe(true);
    expect(secondo.tipo.id).toBe("pixsys_atr244");
    const cambiato = { ...primo.tipo, members: primo.tipo.members.slice(1) };
    const terzo = daCatalogo(atr, bus, { unit: 5, nome: "c", gruppi: tutti(atr), lingua: "it" }, [cambiato]);
    expect(terzo.tipo.id).toBe("pixsys_atr244_v1");
    expect(terzo.avvisi.map((a) => a.chiave)).toContain("catalogo.avvisoTipoNuovo");
  });

  it("avvisa se la linea seriale non coincide, o se il modello non è seriale", () => {
    const lenta = { ...bus, baud_rate: 9600 };
    expect(daCatalogo(atr, lenta, { unit: 1, nome: "a", gruppi: tutti(atr), lingua: "it" }, []).avvisi.map((a) => a.chiave))
      .toContain("catalogo.avvisoSeriale");
    const mcm280 = voce("pixsys/mcm280x");
    expect(daCatalogo(mcm280, bus, { unit: 1, nome: "m", gruppi: tutti(mcm280), lingua: "it" }, []).avvisi.map((a) => a.chiave))
      .toContain("catalogo.avvisoNonSeriale");
    expect(daCatalogo(mcm280, emptyModbus(), { unit: 1, nome: "m", gruppi: tutti(mcm280), lingua: "it" }, []).avvisi).toEqual([]);
  });

  it("nomi e icona", () => {
    expect(idTipoDaVoce("pixsys/atr244")).toBe("pixsys_atr244");
    expect(baseIstanza("pixsys/mcm260x")).toBe("mcm260x");
    expect(baseIstanza("pixsys/mcm260x-9ad")).toBe("mcm260x_9ad");
    expect(idTipoDaVoce("pixsys/mcm260x-9ad")).toBe("pixsys_mcm260x_9ad");
    expect(urlImmagine({ id: "pixsys/atr244", immagine: "atr244.jpg" })).toMatch(/\/api\/catalogo\/dispositivi\/pixsys\/atr244\.jpg$/);
    expect(urlImmagine({ id: "pixsys/x" })).toBeNull();
  });

  it("le uscite digitali MCM sono bit scrivibili, gli ingressi no", () => {
    const mcm = voce("pixsys/mcm260x-9ad");
    const d = daCatalogo(mcm, bus, { unit: 2, nome: "io", gruppi: tutti(mcm), lingua: "en" }, []).dispositivo;
    expect(d.registers.find((x) => x.tag === "io.do3")).toMatchObject({ address: 20, bit: 3 });
    expect(d.registers.find((x) => x.tag === "io.do3")!.sola_lettura).toBeUndefined();
    expect(d.registers.find((x) => x.tag === "io.di3")).toMatchObject({ address: 10, bit: 3, sola_lettura: true });
  });

  it("le varianti MCM260X hanno ciascuna i suoi I/O", () => {
    const membri = (id: string) => {
      const v = voce(id);
      return daCatalogo(v, bus, { unit: 1, nome: "io", gruppi: tutti(v), lingua: "it" }, []).tipo.members.map((m) => m.name);
    };
    const io = (id: string) => membri(id).filter((n) => /^(di|do|ai|ao)\d+$/.test(n));
    expect(io("pixsys/mcm260x-1ad")).toEqual(Array.from({ length: 16 }, (_, i) => `do${i}`));
    expect(io("pixsys/mcm260x-2ad")).toEqual(Array.from({ length: 16 }, (_, i) => `di${i}`));
    expect(io("pixsys/mcm260x-3ad")).toEqual([...Array.from({ length: 8 }, (_, i) => `di${i}`), ...Array.from({ length: 8 }, (_, i) => `do${i}`)]);
    expect(io("pixsys/mcm260x-5ad")).toEqual(["ai1", "ai2", "ai3", "ai4", "ao1", "ao2"]);
    expect(io("pixsys/mcm260x-9ad")).toHaveLength(16 + 16 + 6);
    expect(voce("pixsys/mcm260x-4ad").registri.find((r) => r.nome === "uscite_digitali")!.bit![0].descrizione!.it).toContain("relè");
  });
});
