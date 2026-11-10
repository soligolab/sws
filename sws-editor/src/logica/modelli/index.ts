// I modelli di logica, per «Nuovo da modello» (10-11-2026, piano
// `docs/archive/2026-11-04-logica-unificata.md`, sessione L3). Prendono il posto
// dei sei frammenti che l'editor delle funzioni inseriva al cursore: erano in
// inglese, coi tag inventati (`counter`, `light`), e nessuno faceva una logica
// d'impianto vera.
//
// Un file `.py` per modello, in questa cartella. Il file è Python che compila
// già così (i `#@` sono commenti), con quattro segnaposto:
//   {{tag:x}}   il tag che si sceglie col TagInput, dichiarato da `#@ tag x lettura|scrittura`;
//   {{nome:k}}  il nome di una funzione o di uno script, reso unico nel progetto;
//   {{id:k}}    un nome Python (variabile, costante, parametro) nella lingua dell'IDE;
//   {{t:k}}     un testo (i commenti, un messaggio) nella lingua dell'IDE.
// I testi stanno in `logicaModelli.<modello>.<nomi|id|t>.<k>` di it.json/en.json.
//
// Le righe `#@` dicono cosa nasce: `#@ funzione k` o `#@ script k` aprono un
// pezzo (un modello può farne più d'uno: l'azzeramento a mezzanotte è una
// funzione e lo script che la chiama); `#@ parametro nome predefinito` e
// `#@ trigger …` lo descrivono.
//
// Che il codice giri davvero lo prova un test Rust in `sws-pyscript`
// (`i_modelli_dell_ide_girano`): legge questi stessi file, li compila col
// controllo di `/api/script/check` e li esegue.

import type { FunctionDef, FunctionParam, GlobalScriptDef, ScriptTriggerKind } from "@/types";

/** L'ordine in cui il modulo li propone: prima i più comuni. Un file che non
 *  sta qui non compare (e il test lo segnala). */
export const ORDINE_MODELLI = [
  "contaore", "contapezzi", "isteresi", "filtro", "ritardo_inserzione",
  "comando_orario", "azzeramento_mezzanotte", "alternanza_pompe", "valore_limitato", "avviso_telegram",
] as const;

export interface SegnapostoTag {
  nome: string;
  /** Il codice lo scrive: il tag scelto non può essere calcolato. */
  scrittura: boolean;
}

export interface PezzoModello {
  tipo: "funzione" | "script";
  /** La chiave del nome in `logicaModelli.<id>.nomi`. */
  chiaveNome: string;
  /** Il testo grezzo delle righe `#@ parametro` (nome col segnaposto). */
  parametri: { nome: string; predefinito?: FunctionParam["default"] }[];
  /** Il testo dopo `#@ trigger` (solo script). */
  trigger?: string;
  codice: string;
}

export interface Modello {
  id: string;
  tag: SegnapostoTag[];
  pezzi: PezzoModello[];
}

/** Legge un file di modello. Lancia se è scritto male: è un errore di chi lo
 *  ha scritto, e il test lo prende prima di chiunque altro. */
export function leggiModello(id: string, testo: string): Modello {
  const tag: SegnapostoTag[] = [];
  const pezzi: PezzoModello[] = [];
  let corrente: (PezzoModello & { righe: string[] }) | null = null;
  const chiudi = () => {
    if (!corrente) return;
    const { righe, ...p } = corrente;
    while (righe.length && righe[righe.length - 1].trim() === "") righe.pop();
    pezzi.push({ ...p, codice: righe.join("\n") + "\n" });
    corrente = null;
  };
  for (const riga of testo.split("\n")) {
    const m = /^#@\s+(\S+)\s*(.*)$/.exec(riga);
    if (!m) {
      if (corrente) (corrente as { righe: string[] }).righe.push(riga);
      else if (riga.trim() !== "") throw new Error(`${id}: codice prima di «#@ funzione» o «#@ script»`);
      continue;
    }
    const [, chiave, resto] = m;
    if (chiave === "tag") {
      const [nome, verso] = resto.split(/\s+/);
      if (verso !== "lettura" && verso !== "scrittura") throw new Error(`${id}: «#@ tag ${resto}»: lettura o scrittura`);
      tag.push({ nome, scrittura: verso === "scrittura" });
    } else if (chiave === "funzione" || chiave === "script") {
      chiudi();
      corrente = { tipo: chiave, chiaveNome: resto.trim(), parametri: [], codice: "", righe: [] };
    } else if (chiave === "parametro" && corrente) {
      const [nome, ...valore] = resto.split(/\s+/);
      const grezzo = valore.join(" ");
      (corrente as PezzoModello).parametri.push({ nome, predefinito: grezzo === "" ? undefined : JSON.parse(grezzo) });
    } else if (chiave === "trigger" && corrente) {
      (corrente as PezzoModello).trigger = resto.trim();
    } else {
      throw new Error(`${id}: riga «${riga}» non riconosciuta`);
    }
  }
  chiudi();
  return { id, tag, pezzi };
}

const FILE = import.meta.glob("./*.py", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Tutti i file della cartella, per id (il nome del file). */
export const FILE_MODELLI: Record<string, string> = Object.fromEntries(
  Object.entries(FILE).map(([p, testo]) => [p.replace(/^\.\//, "").replace(/\.py$/, ""), testo]),
);

export const MODELLI: Modello[] = ORDINE_MODELLI
  .filter((id) => FILE_MODELLI[id] !== undefined)
  .map((id) => leggiModello(id, FILE_MODELLI[id]));

/** Il trigger di uno script, coi tag già sostituiti. */
export function leggiTrigger(testo: string): ScriptTriggerKind {
  const [tipo, ...resto] = testo.split(/\s+/);
  switch (tipo) {
    case "interval": return { kind: "interval", interval_s: Number(resto[0]) };
    case "interval_ms": return { kind: "interval", interval_s: 1, interval_ms: Number(resto[0]) };
    case "cron": return { kind: "cron", schedule: resto.join(" ") };
    case "tag": return { kind: "tag_change", tag: resto[0], edge: (resto[1] ?? "any") as "rising" | "falling" | "any" };
    case "avvio": return { kind: "startup" };
    default: throw new Error(`trigger «${testo}» non riconosciuto`);
  }
}

export interface Istanza {
  funzioni: FunctionDef[];
  script: GlobalScriptDef[];
}

/** Il modello coi tag scelti, nella lingua dell'IDE: le funzioni e gli script
 *  da aggiungere al progetto. `t` risolve una chiave relativa al modello
 *  (`nomi.x`, `id.x`, `t.x`); `nomiPresi` sono i nomi già usati, per non
 *  sovrascrivere niente (una funzione e uno script non si contendono il nome:
 *  `functions.run` cerca solo fra le funzioni). */
export function istanzia(
  m: Modello,
  tagScelti: Record<string, string>,
  t: (chiave: string) => string,
  nomiPresi: { funzioni: readonly string[]; script: readonly string[] },
  nuovoId: () => string,
): Istanza {
  const presi = { funzione: new Set(nomiPresi.funzioni), script: new Set(nomiPresi.script) };
  const nomi: Record<string, string> = {};
  for (const p of m.pezzi) {
    const base = t(`nomi.${p.chiaveNome}`);
    let nome = base;
    for (let n = 2; presi[p.tipo].has(nome); n++) nome = `${base}_${n}`;
    presi[p.tipo].add(nome);
    nomi[p.chiaveNome] = nome;
  }
  const sostituisci = (s: string) => s
    .replace(/\{\{tag:(\w+)\}\}/g, (_, k: string) => tagScelti[k] ?? "")
    .replace(/\{\{nome:(\w+)\}\}/g, (_, k: string) => nomi[k] ?? k)
    .replace(/\{\{id:(\w+)\}\}/g, (_, k: string) => t(`id.${k}`))
    .replace(/\{\{t:(\w+)\}\}/g, (_, k: string) => t(`t.${k}`));
  const out: Istanza = { funzioni: [], script: [] };
  const descrizione = t("titolo");
  for (const p of m.pezzi) {
    const codice = sostituisci(p.codice);
    if (p.tipo === "funzione") {
      out.funzioni.push({
        id: nuovoId(), name: nomi[p.chiaveNome], description: descrizione, code: codice,
        params: p.parametri.map((x) => (x.predefinito === undefined ? { name: sostituisci(x.nome) } : { name: sostituisci(x.nome), default: x.predefinito })),
      });
    } else {
      out.script.push({
        id: nomi[p.chiaveNome], description: descrizione, code: codice, enabled: true,
        trigger: leggiTrigger(sostituisci(p.trigger ?? "avvio")),
      });
    }
  }
  return out;
}
