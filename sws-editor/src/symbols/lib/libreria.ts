// La libreria di simboli nel browser: caricamento, cache, preparazione a strati.
//
// Il manifesto si scarica una volta. Gli SVG si scaricano alla prima richiesta
// con `?v=<versione del manifesto>`: `/symbols` è servito senza Cache-Control, e
// senza la versione un browser potrebbe tenersi il disegno di prima di un
// aggiornamento. Piano: docs/plans/2026-10-14-motore-simboli-lib.md (Fase 2).

import { useSyncExternalStore } from "react";
import { applicaStile, type StileSimbolo } from "./applicaStile";
import type { ManifestLib, SimboloLib } from "./manifest";
import type { ParteLegata } from "@/types";
import { veroSimbolo } from "@/symbols/statoSimbolo";

export const BASE_LIB = "/symbols/lib/";
export const CONTORNO_PREDEFINITO = "#1c2329";

let manifesto: ManifestLib | null = null;
let richiesto = false;
const svgs = new Map<string, string>();
const inCorso = new Set<string>();
const ascoltatori = new Set<() => void>();
let giro = 0;

function avvisa() {
  giro += 1;
  for (const a of ascoltatori) a();
}

function iscrivi(a: () => void) {
  ascoltatori.add(a);
  return () => { ascoltatori.delete(a); };
}

function caricaManifesto() {
  if (richiesto || typeof fetch === "undefined") return;
  richiesto = true;
  fetch(`${BASE_LIB}manifest.json`, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((m: ManifestLib | null) => { if (m?.symbols) { manifesto = m; avvisa(); } })
    .catch(() => { /* senza manifesto i `lib:` restano segnaposto */ });
}

function caricaSvg(s: SimboloLib) {
  if (svgs.has(s.id) || inCorso.has(s.id) || !manifesto || typeof fetch === "undefined") return;
  inCorso.add(s.id);
  fetch(`${BASE_LIB}${s.file}?v=${manifesto.version}`)
    .then((r) => (r.ok ? r.text() : ""))
    .then((t) => { if (t.startsWith("<svg")) { svgs.set(s.id, t); avvisa(); } })
    .catch(() => { /* resta il segnaposto */ })
    .finally(() => inCorso.delete(s.id));
}

/** Il manifesto, o `null` finché non è arrivato. */
export function useManifestoLib(): ManifestLib | null {
  caricaManifesto();
  useSyncExternalStore(iscrivi, () => giro, () => giro);
  return manifesto;
}

/** Il simbolo e il suo SVG; `svg` è `undefined` finché non è arrivato. */
export function useSimboloLib(id: string | undefined): { sim?: SimboloLib; svg?: string; manifesto: ManifestLib | null } {
  const m = useManifestoLib();
  const sim = id && m ? cercaSimbolo(m, id) : undefined;
  if (sim) caricaSvg(sim);
  return { sim, svg: sim ? svgs.get(sim.id) : undefined, manifesto: m };
}

/** Per i test: un manifesto e i suoi SVG già in memoria, senza rete. */
export function impostaLibreriaPerTest(m: ManifestLib | null, file: Record<string, string> = {}) {
  manifesto = m;
  richiesto = true;
  svgs.clear();
  if (m) for (const s of m.symbols) if (file[s.file]) svgs.set(s.id, file[s.file]);
  avvisa();
}

export function isLib(symbolId: string | undefined): boolean {
  return !!symbolId && symbolId.startsWith("lib:");
}

// ── preparazione ───────────────────────────────────────────────────────────

export interface StratoLib {
  /** Id dello strato senza prefisso: `layer-0`, `body`, `rotor`, `level`… */
  id: string;
  parte: boolean;
  markup: string;
}

export interface SimboloPreparato {
  viewBox: string;
  defs: string;
  strati: StratoLib[];
}

/** Rende unici gli id per istanza: due pompe nella stessa pagina hanno gradienti
 *  e strati con lo stesso nome, e `url(#…)` prenderebbe il primo. */
export function prefissaId(markup: string, prefisso: string): string {
  return markup
    .replace(/ id="/g, ` id="${prefisso}-`)
    .replace(/href="#/g, `href="#${prefisso}-`)
    .replace(/url\(#/g, `url(#${prefisso}-`);
}

const STRATO = /^ {2}<g id="([^"]+)" data-layer="(static|part)"[^\n]*\n[\s\S]*?^ {2}<\/g>$/gm;

/** Applica lo stile e divide l'SVG nei suoi strati, nel formato del generatore. */
export function preparaSimbolo(svg: string, prefisso: string, stile: StileSimbolo): SimboloPreparato {
  const conStile = applicaStile(svg, stile);
  const viewBox = /viewBox="([^"]+)"/.exec(conStile)?.[1] ?? "0 0 100 100";
  const defs = /<defs>([\s\S]*?)<\/defs>/.exec(conStile)?.[1] ?? "";
  const strati: StratoLib[] = [];
  for (const m of conStile.matchAll(STRATO)) {
    strati.push({ id: m[1], parte: m[2] === "part", markup: prefissaId(m[0], prefisso) });
  }
  return { viewBox, defs: prefissaId(defs, prefisso), strati };
}

/** Lo stile che vale finché non c'è lo stile del progetto (Fase 4): quello del disegno. */
export function stileDelDisegno(m: ManifestLib, corpo: string | null): StileSimbolo {
  return { materials: m.materials, volume: 100, outline: { color: CONTORNO_PREDEFINITO, width: 1 }, body: corpo };
}

export function prefissoIstanza(objId: string): string {
  return `sl-${objId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/** Il simbolo per id `lib:…`, oppure per **alias**: un id builtin (`pump`) che
 *  un disegno della libreria sostituisce (`replaces`, M3 del piano). Così i
 *  progetti esistenti non cambiano e prendono il disegno nuovo. */
export function cercaSimbolo(m: ManifestLib, id: string): SimboloLib | undefined {
  return m.symbols.find((s) => s.id === id) ?? m.symbols.find((s) => s.replaces === id);
}

/** Il simbolo dal manifesto già caricato, fuori da React (creazione di un oggetto). */
export function trovaSimboloLib(id: string): SimboloLib | undefined {
  return manifesto ? cercaSimbolo(manifesto, id) : undefined;
}

/** Il builtin `id` ha un sostituto nella libreria? (Picker: non si offre due volte.) */
export function haSostituto(id: string): boolean {
  return !!manifesto?.symbols.some((s) => s.replaces === id);
}

/** Lo SVG già caricato (anteprime): `undefined` se non è ancora arrivato. */
export function svgLibCaricato(s: SimboloLib): string | undefined {
  caricaSvg(s);
  return svgs.get(s.id);
}

// ── parti vive: lancetta, leva, spie ───────────────────────────────────────

/** Il valore di una parte: `null` = come nel disegno (nessun legame, o nessun
 *  valore leggibile). Stessa regola del pannello: i casi sono in
 *  `tests/fixtures/parti-simbolo.json`. */
export type ValoreParte = { frazione: number | null } | { aperta: boolean | null } | { accesa: boolean | null };

function numeroParte(v: unknown): number | null {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function valoriParti(
  parti: SimboloLib["parts"],
  legami: Record<string, ParteLegata> | undefined,
  valore: (tag: string) => unknown,
): Record<string, ValoreParte> {
  const out: Record<string, ValoreParte> = {};
  for (const p of parti) {
    const l = legami?.[p.id];
    const v = l?.tag ? valore(l.tag) : undefined;
    if (p.kind === "needle") {
      const n = numeroParte(v);
      const min = l?.min ?? 0;
      const max = l?.max ?? 100;
      out[p.id] = { frazione: n === null || max === min ? null : Math.min(1, Math.max(0, (n - min) / (max - min))) };
    } else if (p.kind === "lever") {
      out[p.id] = { aperta: v === undefined ? null : veroSimbolo(v) };
    } else if (p.kind === "lamp") {
      out[p.id] = { accesa: v === undefined ? null : veroSimbolo(v) };
    }
  }
  return out;
}
