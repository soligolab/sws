/** I modelli di «Nuovo da modello» (piano della logica unificata, L3,
 *  10-11-2026). Che il codice giri nella sandbox lo prova il test Rust
 *  `i_modelli_dell_ide_girano` in `sws-pyscript`; qui si prova che ogni file
 *  si legge, che ogni segnaposto ha il suo testo nelle due lingue e che il
 *  codice nasce coi tag scelti. */
import { describe, expect, it } from "vitest";
import it_ from "../src/i18n/it.json";
import en from "../src/i18n/en.json";
import { FILE_MODELLI, MODELLI, ORDINE_MODELLI, istanzia, leggiModello } from "../src/logica/modelli";

const cataloghi = { it: it_ as Record<string, unknown>, en: en as Record<string, unknown> };
const valore = (cat: Record<string, unknown>, percorso: string) =>
  percorso.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), cat);

describe("i modelli", () => {
  it("sono dieci, e ogni file della cartella è nell'ordine", () => {
    expect(MODELLI).toHaveLength(10);
    expect(Object.keys(FILE_MODELLI).sort()).toEqual([...ORDINE_MODELLI].sort());
  });

  it("ogni segnaposto ha il suo testo in italiano e in inglese, e i tag sono dichiarati", () => {
    for (const m of MODELLI) {
      const testo = FILE_MODELLI[m.id];
      const dichiarati = new Set(m.tag.map((x) => x.nome));
      for (const [, k] of testo.matchAll(/\{\{tag:(\w+)\}\}/g)) expect(dichiarati, `${m.id}: {{tag:${k}}}`).toContain(k);
      const chiavi = [
        "titolo", "descrizione",
        ...m.tag.map((x) => `tag.${x.nome}`),
        ...m.pezzi.map((p) => `nomi.${p.chiaveNome}`),
        ...[...testo.matchAll(/\{\{(id|t|nome):(\w+)\}\}/g)].map(([, tipo, k]) => `${tipo === "nome" ? "nomi" : tipo}.${k}`),
      ];
      for (const [lingua, cat] of Object.entries(cataloghi)) {
        for (const k of chiavi) {
          const v = valore(cat, `logicaModelli.${m.id}.${k}`);
          expect(typeof v, `${lingua}: logicaModelli.${m.id}.${k}`).toBe("string");
          // Un testo finisce in un commento o fra virgolette: niente a capo né virgolette.
          expect(v as string, `${lingua}: logicaModelli.${m.id}.${k}`).not.toMatch(/["\\\n]/);
          // Un nome Python resta un nome Python.
          if (k.startsWith("id.") || k.startsWith("nomi.")) expect(v as string).toMatch(/^[A-Za-z_]\w*$/);
        }
      }
    }
  });

  it("il codice nasce coi tag scelti, senza segnaposto, e i nomi non si sovrascrivono", () => {
    const m = MODELLI.find((x) => x.id === "azzeramento_mezzanotte")!;
    const t = (k: string) => valore(cataloghi.it, `logicaModelli.${m.id}.${k}`) as string;
    let n = 0;
    const r = istanzia(m, { contatore: "pezzi_oggi" }, t, { funzioni: ["azzera_contatore"], script: [] }, () => `id${++n}`);
    expect(r.funzioni).toHaveLength(1);
    expect(r.script).toHaveLength(1);
    const [fn] = r.funzioni;
    const [sc] = r.script;
    expect(fn.name).toBe("azzera_contatore_2");
    expect(fn.code).toContain('tags.write("pezzi_oggi", 0)');
    // Lo script chiama la funzione col nome che ha davvero preso.
    expect(sc.code).toContain('functions.run("azzera_contatore_2")');
    expect(sc.trigger).toEqual({ kind: "cron", schedule: "0 0 * * *" });
    for (const codice of [fn.code, sc.code]) {
      expect(codice).not.toMatch(/\{\{|#@/);
    }
  });

  it("il trigger su un tag prende il tag scelto; i parametri hanno il nome nella lingua dell'IDE", () => {
    const tEn = (id: string) => (k: string) => valore(cataloghi.en, `logicaModelli.${id}.${k}`) as string;
    const pezzi = MODELLI.find((x) => x.id === "contapezzi")!;
    const s = istanzia(pezzi, { sensore: "fotocellula", pezzi: "conteggio" }, tEn("contapezzi"), { funzioni: [], script: [] }, () => "x").script[0];
    expect(s.trigger).toEqual({ kind: "tag_change", tag: "fotocellula", edge: "rising" });
    expect(s.id).toBe("piece_counter");
    const lim = MODELLI.find((x) => x.id === "valore_limitato")!;
    const f = istanzia(lim, { valore: "setpoint" }, tEn("valore_limitato"), { funzioni: [], script: [] }, () => "x").funzioni[0];
    expect(f.params).toEqual([{ name: "step", default: 1 }]);
    expect(f.code).toContain("+ step");
  });

  it("un file scritto male si ferma con un messaggio", () => {
    expect(() => leggiModello("rotto", "x = 1\n")).toThrow(/prima di/);
    expect(() => leggiModello("rotto", "#@ tag a forse\n")).toThrow(/lettura o scrittura/);
  });
});
