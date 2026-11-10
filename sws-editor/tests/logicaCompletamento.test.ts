/** I suggerimenti e gli avvisi dell'editor della logica (piano
 *  `docs/archive/2026-11-04-logica-unificata.md`, sessione L2, 10-11-2026). */
import { beforeAll, describe, expect, it } from "vitest";
import { CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { EditorState, Text } from "@codemirror/state";
import i18n from "../src/i18n";
import {
  dentroStringaOCommento, sorgenteNomi, sorgenteParametriRun, sorgenteStringhe, tagNonScrivibili, vociTag,
  type ContestoLogica,
} from "../src/logica/completamento";
import { avvisiSandbox, avvisiTag } from "../src/logica/avvisi";
import type { ProjectInfo } from "../src/types";

beforeAll(async () => { await i18n.changeLanguage("it"); });

const PROGETTO = {
  meta: { name: "Casa", version: "1" },
  tags: [
    { id: "luce", data_type: "bool", description: "Luce del salotto" },
    { id: "temperatura", data_type: "float", unit: "°C" },
    { id: "potenza", data_type: "float", expression: "tags['v'] * tags['i']" },
  ],
  sources: [{ id: "plc", kind: "modbus_tcp", registers: [{ tag: "pressione", area: "input" }, { tag: "setpoint", area: "holding" }] }],
  languages: { default: "it", langs: ["it"], entries: [{ key: "t0001", values: { it: "Pompa in marcia" } }] },
} as unknown as ProjectInfo;

function contesto(tipo: "funzione" | "script" = "script"): ContestoLogica {
  return {
    tipo,
    parametri: tipo === "funzione" ? [{ name: "passo", default: 1 }] : [],
    forniti: [{ nome: "tags", uso: "tags.read(id) · tags.write(id, valore)" }, { nome: "print", uso: "print(...)" },
      { nome: "functions", uso: "functions.run(nome, **parametri)" }],
    builtin: ["min", "max"],
    tag: vociTag(PROGETTO, { temperatura: { value: 21.456 } as never }),
    funzioni: [{ name: "regola", params: [{ name: "passo", default: 1 }, { name: "limite" }] }],
    chiavi: [{ key: "t0001", testo: "Pompa in marcia" }],
  };
}

/** Il risultato della sorgente col cursore dove sta `|`. */
function completa(sorgente: (c: () => ContestoLogica) => CompletionSource, testo: string, tipo?: "funzione" | "script", esplicito = false) {
  const pos = testo.indexOf("|");
  const state = EditorState.create({ doc: testo.replace("|", "") });
  const c = contesto(tipo);
  return sorgente(() => c)(new CompletionContext(state, pos, esplicito)) as CompletionResult | null;
}
const etichette = (r: CompletionResult | null) => (r?.options ?? []).map((o) => o.label);

describe("dentro le virgolette", () => {
  it("tags.read propone tutto il catalogo, coi dettagli e il valore live", () => {
    const r = completa(sorgenteStringhe, 'x = tags.read("te|');
    expect(etichette(r)).toEqual(expect.arrayContaining(["luce", "temperatura", "potenza", "pressione", "setpoint"]));
    expect(r!.from).toBe('x = tags.read("'.length);
    const temp = r!.options.find((o) => o.label === "temperatura")!;
    expect(temp.detail).toBe("float °C");
    expect(temp.info).toContain("21.456");
    expect(r!.options.find((o) => o.label === "luce")!.info).toBe("Luce del salotto");
  });

  it("tags.write toglie i tag calcolati e quelli che la sorgente legge soltanto", () => {
    const l = etichette(completa(sorgenteStringhe, "tags.write('|"));
    expect(l).toContain("luce");
    expect(l).toContain("setpoint");
    expect(l).not.toContain("potenza");
    expect(l).not.toContain("pressione");
  });

  it("functions.run propone le funzioni solo in uno script", () => {
    expect(etichette(completa(sorgenteStringhe, 'functions.run("|', "script"))).toEqual(["regola"]);
    expect(completa(sorgenteStringhe, 'functions.run("|', "funzione")).toBeNull();
  });

  it("tr propone le chiavi lingua, ma non dentro str(", () => {
    expect(etichette(completa(sorgenteStringhe, 'tags.write("luce", tr("|'))).toEqual(["t0001"]);
    expect(completa(sorgenteStringhe, 'x = str("|')).toBeNull();
  });
});

describe("i parametri di functions.run", () => {
  it("dopo il nome propone i parametri come nome=, senza quelli già passati", () => {
    const r = completa(sorgenteParametriRun, 'functions.run("regola", passo=2, |');
    expect(etichette(r)).toEqual(["limite"]);
    expect(r!.options[0].apply).toBe("limite=");
    expect(etichette(completa(sorgenteParametriRun, "functions.run('regola', |"))).toEqual(["passo", "limite"]);
  });
});

describe("i nomi del corpo", () => {
  it("propone i nomi forniti, i builtin, i parametri e le parole utili, non import né class", () => {
    const l = etichette(completa(sorgenteNomi, "x = p|", "funzione"));
    expect(l).toEqual(expect.arrayContaining(["tags", "print", "min", "passo", "if", "True"]));
    expect(l).not.toContain("import");
    expect(l).not.toContain("class");
    // `functions.run` da una funzione solleva: non si propone.
    expect(l).not.toContain("functions");
  });

  it("dopo tags. propone read e write", () => {
    expect(etichette(completa(sorgenteNomi, "tags.w|"))).toEqual(["read", "write"]);
  });

  it("tace dentro una stringa, in un commento e senza niente da completare", () => {
    expect(completa(sorgenteNomi, 'print("ta|')).toBeNull();
    expect(completa(sorgenteNomi, "# ta|")).toBeNull();
    expect(completa(sorgenteNomi, "x = |")).toBeNull();
    expect(dentroStringaOCommento("x = 'a#b' + ")).toBe(false);
  });
});

describe("gli avvisi", () => {
  it("un tag che il progetto non ha, e la scrittura di uno calcolato", () => {
    const codice = 'a = tags.read("luce")\nb = tags.read("luc")\ntags.write("potenza", 1)\nx = tags.read("{{tag}}")\n';
    const conosciuti = new Set(vociTag(PROGETTO, {}).map((v) => v.id));
    const d = avvisiTag(codice, (id) => conosciuti.has(id), tagNonScrivibili(PROGETTO));
    expect(d.map((x) => codice.slice(x.from, x.to))).toEqual(["luc", "potenza"]);
    expect(d[0].message).toContain("non è un tag del progetto");
    expect(d[1].message).toContain("sola lettura");
  });

  it("i rilievi della sandbox diventano errori sulla loro riga; un esito ok non porta niente", () => {
    const doc = Text.of(["x = 1", "import os"]);
    const d = avvisiSandbox(doc, { ok: false, sandbox_verificata: true, rilievi: [{ riga: 2, messaggio: "Line 2: import", vietato: true }] });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ from: doc.line(2).from, to: doc.line(2).to, severity: "error", source: "sandbox" });
    expect(avvisiSandbox(doc, { ok: true, sandbox_verificata: true, rilievi: [{ messaggio: "vuoto", vietato: false }] })).toEqual([]);
  });
});
