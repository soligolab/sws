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

  /** Le foglie del tipo di una variabile: `gruppo.membro`, attraverso i sotto-tipi. */
  const foglie = (r: { tipo: { members: { name: string; type_ref?: string }[] }; tipi: { id: string; members: { name: string; data_type?: string; unit?: string; decimals?: number; description?: string }[] }[] }) =>
    r.tipo.members.flatMap((g) => (r.tipi.find((t) => t.id === g.type_ref)?.members ?? []).map((m) => ({ ...m, path: `${g.name}.${m.name}` })));

  it("tipi annidati: un sotto-tipo per gruppo, il tipo della variabile coi soli gruppi scelti (nome che lo dice)", () => {
    const r = daCatalogo(atr, bus, { unit: 3, nome: "atr244_3", gruppi: new Set(["processo"]), lingua: "it" }, []);
    expect(r.tipo.id).toBe("pixsys_atr244_processo");
    expect(r.tipo.members).toEqual([{ name: "processo", type_ref: "pixsys_atr244__processo" }]);
    expect(r.tipiNuovi.map((t) => t.id)).toEqual(["pixsys_atr244__processo", "pixsys_atr244_processo"]);
    expect(r.riusaTipo).toBe(false);
    const m = (p: string) => foglie(r).find((x) => x.path === p)!;
    expect(m("processo.pv1")).toMatchObject({ data_type: "f32", unit: "°C", decimals: 1 });
    expect(m("processo.allarme1")).toMatchObject({ data_type: "bool" });
    expect(m("processo.manuale").description).toContain("manuale");
    expect(foglie(r).some((x) => x.path.endsWith("indirizzo_slave") || x.path.endsWith("sp1"))).toBe(false);
    expect(r.foglie).toBe(foglie(r).length);
    expect(r.tag).toMatchObject({ id: "atr244_3", type_ref: "pixsys_atr244_processo" });
    // Con tutti i gruppi, il nome del modello e basta.
    expect(daCatalogo(atr, bus, { unit: 3, nome: "x", gruppi: tutti(atr), lingua: "it" }, []).tipo.id).toBe("pixsys_atr244");
  });

  it("il dispositivo legge solo i gruppi scelti, coi percorsi annidati, formato, scala, bit e sola lettura", () => {
    const r = daCatalogo(atr, bus, { unit: 3, nome: "atr244_3", gruppi: new Set(["processo", "comandi"]), lingua: "it" }, []);
    const d = r.dispositivo;
    expect(d).toMatchObject({ unit_id: 3, nome: "atr244_3", modello: "pixsys/atr244@1", ordine: "cdab", timeout_ms: 1000 });
    const reg = (tag: string) => d.registers.find((x) => x.tag === tag)!;
    expect(reg("atr244_3.processo.pv1")).toMatchObject({ address: 1000, formato: "i16", scale: 0.1, sola_lettura: true });
    expect(reg("atr244_3.comandi.sp1")).toMatchObject({ address: 2000, formato: "i16", scale: 0.1 });
    expect(reg("atr244_3.comandi.sp1").sola_lettura).toBeUndefined();
    expect(reg("atr244_3.processo.manuale")).toMatchObject({ address: 1004, bit: 9, sola_lettura: true });
    expect(d.registers.some((x) => x.tag.includes("indirizzo_slave") || x.tag.includes("firmware"))).toBe(false);
    // Ogni mappatura è una foglia del tipo.
    const percorsi = new Set(foglie(r).map((f) => `atr244_3.${f.path}`));
    expect(d.registers.every((x) => percorsi.has(x.tag))).toBe(true);
    // La colonna «Registri» conta dal formato e dal bit.
    expect(registriMappatura("atr244_3.processo.pv1", undefined, null, reg("atr244_3.processo.pv1")).n).toBe(1);
    expect(registriMappatura("x", undefined, null, { bit: 9 }).dettaglio).toBe("bit 9");
  });

  it("un secondo ATR244 riusa i tipi; un sotto-tipo diverso con lo stesso nome ne fa nascere un altro", () => {
    const primo = daCatalogo(atr, bus, { unit: 3, nome: "a", gruppi: tutti(atr), lingua: "it" }, []);
    const secondo = daCatalogo(atr, bus, { unit: 4, nome: "b", gruppi: tutti(atr), lingua: "it" }, primo.tipi);
    expect(secondo.riusaTipo).toBe(true);
    expect(secondo.tipiNuovi).toEqual([]);
    expect(secondo.tipo.id).toBe("pixsys_atr244");
    // Un altro ATR244 coi soli comandi riusa il sotto-tipo dei comandi.
    const soloComandi = daCatalogo(atr, bus, { unit: 5, nome: "c", gruppi: new Set(["comandi"]), lingua: "it" }, primo.tipi);
    expect(soloComandi.tipiNuovi.map((t) => t.id)).toEqual(["pixsys_atr244_comandi"]);
    const cambiato = primo.tipi.map((t) => (t.id === "pixsys_atr244__processo" ? { ...t, members: t.members.slice(1) } : t));
    const terzo = daCatalogo(atr, bus, { unit: 5, nome: "c", gruppi: tutti(atr), lingua: "it" }, cambiato);
    expect(terzo.tipo.members.find((m) => m.name === "processo")!.type_ref).toBe("pixsys_atr244__processo_v1");
    expect(terzo.tipo.id).toBe("pixsys_atr244_v1"); // il tipo della variabile ora nomina un sotto-tipo diverso
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
    // Dal manuale MCM260X (2300.10.265 RevG §9.2.c): DI in 1000, DO in 1100, bit 0 = I/O 1.
    expect(d.registers.find((x) => x.tag === "io.uscite.do3")).toMatchObject({ address: 1100, bit: 2 });
    expect(d.registers.find((x) => x.tag === "io.uscite.do3")!.sola_lettura).toBeUndefined();
    expect(d.registers.find((x) => x.tag === "io.ingressi.di3")).toMatchObject({ address: 1000, bit: 2, sola_lettura: true });
    expect(d.registers.find((x) => x.tag === "io.ingressi.ai1")).toMatchObject({ address: 1001, formato: "i16", scale: 0.1 });
    expect(d.registers.find((x) => x.tag === "io.encoder.enc1_conteggi")).toMatchObject({ address: 1005, formato: "i32" });
    expect(d.registers.find((x) => x.tag === "io.diagnostica.errore_fram")).toMatchObject({ address: 6, bit: 8 });
    expect(d.ordine ?? "abcd").toBe("abcd"); // word alta prima, come dice il manuale
  });

  it("le varianti MCM260X hanno ciascuna i suoi I/O", () => {
    const io = (id: string) => {
      const v = voce(id);
      const r = daCatalogo(v, bus, { unit: 1, nome: "io", gruppi: tutti(v), lingua: "it" }, []);
      return foglie(r).map((f) => f.name).filter((n) => /^(di|do|ai|ao)\d+$/.test(n));
    };
    expect(io("pixsys/mcm260x-1ad")).toEqual(Array.from({ length: 16 }, (_, i) => `do${i + 1}`));
    expect(io("pixsys/mcm260x-2ad")).toEqual(Array.from({ length: 16 }, (_, i) => `di${i + 1}`));
    expect(io("pixsys/mcm260x-3ad")).toEqual([...Array.from({ length: 8 }, (_, i) => `di${i + 1}`), ...Array.from({ length: 8 }, (_, i) => `do${i + 1}`)]);
    expect(io("pixsys/mcm260x-5ad").sort()).toEqual(["ai1", "ai2", "ai3", "ai4", "ao1", "ao2"]);
    expect(io("pixsys/mcm260x-9ad")).toHaveLength(16 + 16 + 6);
    expect(voce("pixsys/mcm260x-4ad").registri.find((r) => r.nome === "uscite_digitali")!.bit![0].descrizione!.it).toContain("relè");
    // Il 5AD: AI in 1000-1003 in decimi di grado, il registro 4 (che non esiste) non si legge.
    const ad5 = voce("pixsys/mcm260x-5ad");
    expect(ad5.registri.find((r) => r.nome === "ai1")).toMatchObject({ indirizzo: 1000, formato: "i16", scala: 0.1 });
    expect(ad5.registri.some((r) => r.indirizzo === 4)).toBe(false);
    expect(ad5.registri.find((r) => r.nome === "tipo_sensore_ai1")).toMatchObject({ indirizzo: 2021, accesso: "rw" });
  });

  it("«Riprendi» con gruppi in più passa la variabile al tipo più largo, coi percorsi di prima", () => {
    const atr = voce("pixsys/atr244");
    const bus = { ...emptyModbusRtu(), id: "linea", baud_rate: 19200 };
    const primo = daCatalogo(atr, bus, { unit: 3, nome: "forno", gruppi: new Set(["processo"]), lingua: "it" }, []);
    // Stessi gruppi: riprende senza toccare niente.
    const stesso = daCatalogo(atr, bus, { unit: 4, nome: "forno", gruppi: new Set(["processo"]), lingua: "it", esistente: { tag: primo.tag, tipo: primo.tipo } }, primo.tipi);
    expect(stesso.riusaVariabile).toBe(true);
    expect(stesso.tipiNuovi).toEqual([]);
    // Più «comandi»: tipo processo+comandi, la variabile cambia type_ref.
    const largo = daCatalogo(atr, bus, { unit: 4, nome: "forno", gruppi: new Set(["comandi"]), lingua: "it", esistente: { tag: primo.tag, tipo: primo.tipo } }, primo.tipi);
    expect(largo.tipo.id).toBe("pixsys_atr244_processo_comandi");
    expect(largo.sostituisciVariabile).toBe(true);
    expect(largo.tag).toMatchObject({ id: "forno", type_ref: "pixsys_atr244_processo_comandi" });
    expect(largo.tipo.members.map((m) => m.name)).toEqual(["processo", "comandi"]); // processo resta: forno.processo.pv1 non cambia
    expect(largo.tipiNuovi.map((t) => t.id)).toEqual(["pixsys_atr244__comandi", "pixsys_atr244_processo_comandi"]);
    expect(largo.dispositivo.registers.map((r) => r.tag)).toContain("forno.comandi.sp1");
  });

  it("«Riprendi» su un tipo piatto di prima: piatto se ha tutto, annidato (con avviso) se va allargato", () => {
    const atr = voce("pixsys/atr244");
    const bus = { ...emptyModbusRtu(), id: "linea", baud_rate: 19200 };
    const piatto = { id: "pixsys_atr244", members: [{ name: "pv1", data_type: "f32" }, { name: "pv2", data_type: "f32" }] } as never;
    const vecchia = { id: "forno", type_ref: "pixsys_atr244" } as never;
    const solo = { ...atr, registri: atr.registri.filter((r) => r.nome === "pv1" || r.nome === "pv2") };
    const ok = daCatalogo(solo, bus, { unit: 4, nome: "forno", gruppi: new Set(["processo"]), lingua: "it", esistente: { tag: vecchia, tipo: piatto } }, [piatto]);
    expect(ok.riusaVariabile).toBe(true);
    expect(ok.dispositivo.registers.map((r) => r.tag)).toEqual(["forno.pv1", "forno.pv2"]);
    const allargato = daCatalogo(atr, bus, { unit: 4, nome: "forno", gruppi: new Set(["processo"]), lingua: "it", esistente: { tag: vecchia, tipo: piatto } }, [piatto]);
    expect(allargato.sostituisciVariabile).toBe(true);
    expect(allargato.avvisi.map((a) => a.chiave)).toContain("catalogo.avvisoPercorsiCambiano");
    expect(allargato.dispositivo.registers[0].tag.startsWith("forno.processo.")).toBe(true);
  });
});
