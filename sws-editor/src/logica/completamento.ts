// I suggerimenti mentre si scrive una funzione o uno script (10-11-2026, piano
// `docs/archive/2026-11-04-logica-unificata.md`, sessione L2). Prima l'editor
// aveva solo il completamento generico di `lang-python`, che propone `import` e
// `class` — due cose che la sandbox rifiuta — e non sapeva niente dei tag del
// progetto: ogni id si scriveva a memoria, e un errore di battitura si scopriva
// sul pannello come un `None`.
//
// Quattro sorgenti, in quest'ordine di utilità:
//   - dentro `tags.read("` / `tags.write("` i tag del catalogo (foglie
//     comprese), con tipo, unità, descrizione e il valore live se c'è; per
//     `write` niente tag calcolati né di sola lettura;
//   - i nomi forniti dal runtime (`GET /api/script/nomi`, l'elenco unico di
//     L0), i builtin che la sandbox aggiunge e i parametri della funzione
//     aperta, al posto del completamento generico;
//   - dentro `functions.run("` i nomi delle funzioni e poi i loro parametri,
//     solo negli script (da una funzione `functions.run` solleva un errore);
//   - dentro `tr("` le chiavi della tabella lingue.
//
// Le sorgenti leggono il contesto da una funzione e non da un valore: l'editor
// si costruisce una volta sola, e i tag, i valori live e i parametri cambiano
// mentre è aperto.

import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import i18n from "i18next";
import type { FunctionParam, ProjectInfo, TagState } from "@/types";
import { tagCatalog } from "@/tagCatalog";

export interface VoceTag {
  id: string;
  tipo?: string;
  unita?: string;
  descrizione?: string;
  /** Il valore live, quando l'IDE lo riceve. */
  valore?: unknown;
  /** `false` per i tag calcolati (espressione, generatore) e per quelli che la
   *  sorgente legge soltanto: `tags.write` li rifiuterebbe. */
  scrivibile: boolean;
}

export interface ContestoLogica {
  tipo: "funzione" | "script";
  /** I parametri della funzione aperta: nel corpo sono variabili globali. */
  parametri: FunctionParam[];
  forniti: { nome: string; uso: string }[];
  builtin: string[];
  tag: VoceTag[];
  funzioni: { name: string; params: FunctionParam[]; description?: string }[];
  chiavi: { key: string; testo?: string }[];
}

/** I membri dei nomi forniti che sono oggetti: dopo il punto si propongono
 *  questi, non tutto. Sono la forma di `NOMI_FORNITI.uso` nel runtime. */
const MEMBRI: Record<string, { label: string; detail: string }[]> = {
  tags: [{ label: "read", detail: "(id)" }, { label: "write", detail: "logica.firmaWrite" }],
  state: [{ label: "get", detail: "logica.firmaGet" }, { label: "set", detail: "logica.firmaSet" }],
  functions: [{ label: "run", detail: "logica.firmaRun" }],
};

/** Le parole di Python che servono davvero in un corpo di funzione o di
 *  script. Non `import`, non `class`, non `with`, `global`, `try`: la sandbox
 *  rifiuta i primi e gli altri non servono a scrivere logica d'impianto. */
const PAROLE = [
  "if", "elif", "else", "for", "in", "while", "not", "and", "or", "is",
  "True", "False", "None", "return", "break", "continue", "pass", "def", "lambda",
];

/** I tag che uno script non può scrivere: calcolati da un'espressione o da un
 *  generatore attivo, o letti da una sorgente che non scrive (un registro
 *  Modbus di ingresso, un tag S7/EtherNet-IP/Sparkplug senza `writable`). */
export function tagNonScrivibili(project: ProjectInfo | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of project?.tags ?? []) {
    if (t.expression || t.generator?.enabled) out.add(t.id);
  }
  for (const src of project?.sources ?? []) {
    // `as any` come in `sourceTagIds`: le sorgenti sono un'unione di forme, qui
    // interessa solo dove c'è un `tag` e se si scrive.
    const s = src as any;
    const registri = [...(s.registers ?? []), ...(s.devices ?? []).flatMap((d: any) => d?.registers ?? [])];
    for (const r of registri) if (r?.tag && (r.area === "input" || r.area === "discrete")) out.add(r.tag);
    for (const x of [...(s.tags ?? []), ...(s.metrics ?? [])]) if (x?.tag && x.writable === false) out.add(x.tag);
  }
  return out;
}

/** Il catalogo dei tag come lo vede il completamento. */
export function vociTag(project: ProjectInfo | null | undefined, valori: Record<string, TagState | undefined>): VoceTag[] {
  const nonScrivibili = tagNonScrivibili(project);
  const unita = new Map((project?.tags ?? []).filter((t) => t.unit).map((t) => [t.id, t.unit as string]));
  return tagCatalog(project).map((e) => ({
    id: e.id,
    tipo: e.tipo,
    unita: unita.get(e.id),
    descrizione: e.description,
    valore: valori[e.id]?.value,
    scrivibile: !nonScrivibili.has(e.id),
  }));
}

/** Il testo della riga prima del cursore sta dentro una stringa o un commento?
 *  Un controllo per riga basta: i corpi delle funzioni non usano le stringhe
 *  su più righe, e sbagliare qui vuol dire solo un suggerimento in più o in meno. */
export function dentroStringaOCommento(primaDelCursore: string): boolean {
  let apice: string | null = null;
  for (let i = 0; i < primaDelCursore.length; i++) {
    const c = primaDelCursore[i];
    if (apice) {
      if (c === "\\") i++;
      else if (c === apice) apice = null;
    } else if (c === "'" || c === '"') apice = c;
    else if (c === "#") return true;
  }
  return apice !== null;
}

const testoValore = (v: unknown) => (typeof v === "number" ? String(Math.round(v * 1000) / 1000) : JSON.stringify(v));

function opzioneTag(v: VoceTag): Completion {
  const info = [v.descrizione, v.valore !== undefined ? i18n.t("logica.suggValore", { v: testoValore(v.valore) }) : null]
    .filter(Boolean).join("\n");
  return {
    label: v.id,
    type: "variable",
    detail: [v.tipo, v.unita].filter(Boolean).join(" ") || undefined,
    info: info || undefined,
  };
}

/** Dentro le virgolette di `tags.read(`, `tags.write(`, `functions.run(`, `tr(`. */
export function sorgenteStringhe(contesto: () => ContestoLogica): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/(tags\.read|tags\.write|functions\.run|tr)\(\s*['"][^'"\n]*$/);
    if (!m) return null;
    const chiamata = /^(tags\.read|tags\.write|functions\.run|tr)/.exec(m.text)![1];
    // `tr(` non deve combaciare dentro `str(`, né `tags.read` dentro `xtags.read`.
    const prima = ctx.state.sliceDoc(Math.max(0, m.from - 1), m.from);
    if (/[\w.]/.test(prima)) return null;
    const c = contesto();
    const from = m.from + m.text.search(/['"]/) + 1;
    let options: Completion[];
    if (chiamata === "tags.read") options = c.tag.map(opzioneTag);
    else if (chiamata === "tags.write") options = c.tag.filter((v) => v.scrivibile).map(opzioneTag);
    else if (chiamata === "functions.run") {
      if (c.tipo !== "script") return null;
      options = c.funzioni.map((f) => ({
        label: f.name, type: "function", detail: `(${f.params.map((p) => p.name).join(", ")})`,
        info: f.description || i18n.t("logica.suggFunzione"),
      }));
    } else {
      options = c.chiavi.map((k) => ({ label: k.key, type: "constant", detail: i18n.t("logica.suggChiave"), info: k.testo || undefined }));
    }
    return { from, options, validFor: /^[^'"\n]*$/ };
  };
}

/** Dopo `functions.run("nome", `: i parametri di quella funzione, come `nome=`. */
export function sorgenteParametriRun(contesto: () => ContestoLogica): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/functions\.run\(\s*(['"])([^'"\n]+)\1((?:\s*,\s*\w+\s*=\s*[^,()\n]*)*)\s*,\s*\w*$/);
    if (!m) return null;
    const c = contesto();
    if (c.tipo !== "script") return null;
    const [, , nome, passati] = /functions\.run\(\s*(['"])([^'"\n]+)\1((?:\s*,\s*\w+\s*=\s*[^,()\n]*)*)/.exec(m.text)!;
    const fn = c.funzioni.find((f) => f.name === nome);
    if (!fn) return null;
    const gia = new Set([...passati.matchAll(/(\w+)\s*=/g)].map((x) => x[1]));
    const parola = /\w*$/.exec(m.text)![0];
    return {
      from: ctx.pos - parola.length,
      options: fn.params.filter((p) => !gia.has(p.name)).map((p) => ({
        label: p.name, apply: `${p.name}=`, type: "property",
        detail: p.default !== undefined ? i18n.t("logica.suggParametroDefault", { v: JSON.stringify(p.default) }) : i18n.t("logica.suggParametro"),
      })),
      validFor: /^\w*$/,
    };
  };
}

/** I nomi del corpo: forniti, builtin aggiunti, parametri, parole di Python;
 *  e dopo `tags.`, `state.`, `functions.` i loro metodi. */
export function sorgenteNomi(contesto: () => ContestoLogica): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const riga = ctx.state.doc.lineAt(ctx.pos);
    const primaDelCursore = riga.text.slice(0, ctx.pos - riga.from);
    if (dentroStringaOCommento(primaDelCursore)) return null;
    const c = contesto();

    const membro = /\b(tags|state|functions)\.(\w*)$/.exec(primaDelCursore);
    if (membro) {
      const oggetto = membro[1];
      if (oggetto === "functions" && c.tipo !== "script") return null;
      return {
        from: ctx.pos - membro[2].length,
        options: MEMBRI[oggetto].map((x) => ({ label: x.label, detail: x.detail.startsWith("(") ? x.detail : i18n.t(x.detail), type: "method" })),
        validFor: /^\w*$/,
      };
    }

    const parola = ctx.matchBefore(/\w+$/);
    if (!parola && !ctx.explicit) return null;
    const from = parola?.from ?? ctx.pos;
    // Dopo un punto è un attributo di qualcos'altro: niente nomi globali.
    if (ctx.state.sliceDoc(from - 1, from) === ".") return null;
    const options: Completion[] = [
      ...c.forniti
        .filter((n) => n.nome !== "functions" || c.tipo === "script")
        .map((n) => ({ label: n.nome, detail: n.uso, type: MEMBRI[n.nome] ? "namespace" : "function", boost: 2 })),
      ...c.parametri.map((p) => ({
        label: p.name, type: "variable", boost: 3,
        detail: p.default !== undefined ? i18n.t("logica.suggParametroDefault", { v: JSON.stringify(p.default) }) : i18n.t("logica.suggParametro"),
      })),
      ...c.builtin.map((b) => ({ label: b, type: "function", detail: i18n.t("logica.suggBuiltin") })),
      ...PAROLE.map((k) => ({ label: k, type: "keyword", detail: i18n.t("logica.suggParola"), boost: -1 })),
    ];
    return { from, options, validFor: /^\w*$/ };
  };
}

/** Le sorgenti per `autocompletion({ override })`: con `override` quelle di
 *  `lang-python` non partono più (l'editor aggiunge `localCompletionSource`,
 *  le variabili scritte nel corpo, che sono utili). */
export function sorgentiLogica(contesto: () => ContestoLogica): CompletionSource[] {
  return [sorgenteStringhe(contesto), sorgenteParametriRun(contesto), sorgenteNomi(contesto)];
}
