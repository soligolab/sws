// La libreria di simboli nel browser: caricamento, cache, preparazione a strati.
//
// Il manifesto si scarica una volta. Gli SVG si scaricano alla prima richiesta
// con `?v=<versione del manifesto>`: `/symbols` è servito senza Cache-Control, e
// senza la versione un browser potrebbe tenersi il disegno di prima di un
// aggiornamento. Piano: docs/archive/2026-10-14-motore-simboli-lib.md (Fase 2).

import { useSyncExternalStore } from "react";
import { applicaStile, type StileSimbolo } from "./applicaStile";
import type { ManifestLib, PortaLib, SimboloLib } from "./manifest";
import type { CustomSymbol, ParteLegata } from "@/types";
import { veroSimbolo } from "@/symbols/statoSimbolo";
import { percorsoPubblico } from "@/api/prefisso";

// `percorsoPubblico`: sullo schermo di un pannello aperto dal cloud la
// libreria è quella del pannello (29-10-2026).
export const BASE_LIB = percorsoPubblico("/symbols/lib/");
/** I simboli disegnati nel progetto (`prj:<slug>`): stessa forma della
 *  libreria, compilati dal runtime a partire dalle descrizioni del progetto
 *  (piano 2026-11-03-assistente-genera-simboli-e-sinottici, F2). */
export const BASE_PRJ = percorsoPubblico("/api/project/simboli/");
export const CONTORNO_PREDEFINITO = "#1c2329";

let manifesto: ManifestLib | null = null;
let richiesto = false;
// Lo strato del progetto, sopra la libreria. Lo riempie il server (viewer) o
// l'editor con i simboli che ha in memoria (`impostaSimboliProgetto`): una
// proposta applicata e non salvata deve già disegnarsi.
let progetto: { version: string; symbols: SimboloLib[] } = { version: "", symbols: [] };
let progettoRichiesto = false;
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

function caricaManifestoProgetto() {
  if (progettoRichiesto || typeof fetch === "undefined") return;
  progettoRichiesto = true;
  fetch(`${BASE_PRJ}manifest.json`, { cache: "no-cache", credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((m: { version: string; symbols: SimboloLib[] } | null) => {
      if (m?.symbols) impostaProgetto(m.version, m.symbols, {});
    })
    .catch(() => { /* senza manifesto del progetto i `prj:` restano segnaposto */ });
}

function impostaProgetto(version: string, symbols: SimboloLib[], file: Record<string, string>) {
  for (const id of [...svgs.keys()]) if (id.startsWith("prj:")) svgs.delete(id);
  progetto = { version, symbols };
  for (const s of symbols) if (file[s.id]) svgs.set(s.id, file[s.id]);
  avvisa();
}

/** I simboli del progetto già compilati (dall'editor): voce e SVG insieme, così
 *  si disegnano senza un giro dal server. */
export function impostaSimboliProgetto(compilati: readonly { voce: SimboloLib; svg: string }[]) {
  progettoRichiesto = true;
  const file: Record<string, string> = {};
  for (const c of compilati) file[c.voce.id] = c.svg;
  impostaProgetto(compilati.map((c) => c.voce.id + c.svg.length).join(","), compilati.map((c) => c.voce), file);
}

/** Simboli del progetto **sovrapposti** a quelli di adesso, per il tempo di una
 *  foto (10-11-2026): le bozze dell'assistente, che la foto di un progetto web
 *  deve disegnare e il progetto non ha ancora. Non avvisa nessuno, di proposito:
 *  il canvas dell'editor non deve ridisegnarsi con delle bozze, la foto monta il
 *  suo canvas dopo averle messe. Il valore restituito le toglie. */
const sovrapposti = new Map<string, { voce: SimboloLib; svg: string }>();
export function sovrapponiSimboli(compilati: readonly { voce: SimboloLib; svg: string }[]): () => void {
  const messi = compilati.map((c) => c.voce.id);
  for (const c of compilati) sovrapposti.set(c.voce.id, c);
  return () => { for (const id of messi) sovrapposti.delete(id); };
}

// ── the ports of the custom symbols ────────────────────────────────────────
//
// A custom symbol (`custom:<id>`) is an SVG the project carries, drawn as it
// is. One drawn as free SVG with ports (plan 2026-11-10-assistente-secondo-giro,
// G3) also says where pipes attach: `view_box` and `ports`. The pipes read
// them here, next to the ports of the library, and are told when they change
// the same way (`avvisa`). The store keeps this in step with its
// `customSymbols` (`store/index.ts`).

/** The size of a drawing and its ports, as `bocchePer` gives them. */
export interface SymbolPorts { viewBox: [number, number]; porte: PortaLib[] }

let customPorts = new Map<string, SymbolPorts>();
const overlaidCustomPorts = new Map<string, SymbolPorts>();

function portsOf(symbols: readonly CustomSymbol[]): Map<string, SymbolPorts> {
  const out = new Map<string, SymbolPorts>();
  for (const s of symbols) {
    const [w, h] = s.view_box ?? [0, 0];
    // Ports without the size of the drawing cannot be placed: ignored, as on
    // the panel (`CustomSymbol::ports_with_view_box`).
    if (s.ports?.length && w > 0 && h > 0) out.set(`custom:${s.id}`, { viewBox: [w, h], porte: s.ports });
  }
  return out;
}

/** The custom symbols of the project changed: their ports with them. */
export function setCustomSymbolPorts(symbols: readonly CustomSymbol[]) {
  const next = portsOf(symbols);
  // Most projects have no custom symbol with ports: nothing to tell then.
  const nothing = next.size === 0 && customPorts.size === 0;
  customPorts = next;
  if (!nothing) avvisa();
}

/** Ports **over** the ones of now, for the time of a photo: the free-SVG
 *  drafts of the assistant, which the project does not have yet. Like
 *  `sovrapponiSimboli`, it tells nobody. The returned function removes them. */
export function overlayCustomSymbolPorts(symbols: readonly CustomSymbol[]): () => void {
  const added = portsOf(symbols);
  for (const [id, p] of added) overlaidCustomPorts.set(id, p);
  return () => { for (const id of added.keys()) overlaidCustomPorts.delete(id); };
}

/** The ports of the custom symbol `symbolId` (`custom:<id>`), if it declares any. */
export function customSymbolPorts(symbolId: string): SymbolPorts | undefined {
  return overlaidCustomPorts.get(symbolId) ?? customPorts.get(symbolId);
}

/** Rilegge dal server i simboli del progetto (un altro progetto aperto, un
 *  salvataggio arrivato da fuori). */
export function ricaricaSimboliProgetto() {
  progettoRichiesto = false;
  caricaManifestoProgetto();
}

/** I simboli del progetto, per la palette. */
export function useSimboliProgetto(): readonly SimboloLib[] {
  caricaManifestoProgetto();
  useSyncExternalStore(iscrivi, () => giro, () => giro);
  return progetto.symbols;
}

/** Un simbolo del progetto non ha una chiave i18n: le etichette viaggiano con
 *  lui. Per la libreria `label` è la chiave da tradurre. */
export function etichettaSimbolo(s: SimboloLib, t: (k: string) => string, lingua: string): string {
  if (s.labels) return (lingua.startsWith("it") ? s.labels.it : s.labels.en) || s.labels.it || s.label;
  return t(s.label);
}

let manifestoInArrivo: Promise<void> = Promise.resolve();

function caricaManifesto() {
  caricaManifestoProgetto();
  if (richiesto || typeof fetch === "undefined") return;
  richiesto = true;
  manifestoInArrivo = fetch(`${BASE_LIB}manifest.json`, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((m: ManifestLib | null) => { if (m?.symbols) { manifesto = m; avvisa(); } })
    .catch(() => { /* senza manifesto i `lib:` restano segnaposto */ });
}

const svgInArrivo = new Map<string, Promise<void>>();

function caricaSvg(s: SimboloLib): Promise<void> {
  if (svgs.has(s.id) || !manifesto || typeof fetch === "undefined") return Promise.resolve();
  const gia = svgInArrivo.get(s.id);
  if (gia || inCorso.has(s.id)) return gia ?? Promise.resolve();
  inCorso.add(s.id);
  const url = s.file.startsWith("prj/")
    ? `${BASE_PRJ}${s.file.slice(4)}?v=${encodeURIComponent(progetto.version)}`
    : `${BASE_LIB}${s.file}?v=${manifesto.version}`;
  const p = fetch(url, { credentials: "same-origin" })
    .then((r) => (r.ok ? r.text() : ""))
    .then((t) => { if (t.startsWith("<svg")) { svgs.set(s.id, t); avvisa(); } })
    .catch(() => { /* resta il segnaposto */ })
    .finally(() => { inCorso.delete(s.id); svgInArrivo.delete(s.id); });
  svgInArrivo.set(s.id, p);
  return p;
}

/** Il manifesto e i disegni di questi simboli **prima** di montare un canvas
 *  che deve uscire completo al primo colpo (la foto dell'assistente,
 *  10-11-2026): montati a freddo, i simboli si disegnano solo quando i loro SVG
 *  arrivano, e una foto scattata prima li perderebbe. */
export async function precaricaSimboli(ids: readonly string[]): Promise<void> {
  caricaManifesto();
  await manifestoInArrivo;
  if (!manifesto) return;
  const m = manifesto;
  await Promise.all(ids
    .filter((id) => !sovrapposti.has(id))
    .map((id) => cercaSimbolo(m, id))
    .filter((s): s is SimboloLib => !!s)
    .map((s) => caricaSvg(s)));
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
  const sopra = id ? sovrapposti.get(id) : undefined;
  if (sopra) return { sim: sopra.voce, svg: sopra.svg, manifesto: m };
  const sim = id && m ? cercaSimbolo(m, id) : undefined;
  if (sim) void caricaSvg(sim);
  return { sim, svg: sim ? svgs.get(sim.id) : undefined, manifesto: m };
}

/** Per i test: un manifesto e i suoi SVG già in memoria, senza rete. */
export function impostaLibreriaPerTest(m: ManifestLib | null, file: Record<string, string> = {}) {
  manifesto = m;
  richiesto = true;
  progettoRichiesto = true;
  progetto = { version: "", symbols: [] };
  svgs.clear();
  if (m) for (const s of m.symbols) if (file[s.file]) svgs.set(s.id, file[s.file]);
  avvisa();
}

/** Un simbolo disegnato a strati: della libreria o del progetto. */
export function isLib(symbolId: string | undefined): boolean {
  return !!symbolId && (symbolId.startsWith("lib:") || symbolId.startsWith("prj:"));
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
  if (id.startsWith("prj:")) return sovrapposti.get(id)?.voce ?? progetto.symbols.find((s) => s.id === id);
  const lib = simboloOriginale(m, id);
  if (!lib) return undefined;
  // A project variant of this library symbol is drawn in its place (plan
  // 2026-11-18-editor-dei-simboli). Twin of `ManifestLib::simbolo_o_alias`.
  return progetto.symbols.find((s) => s.overrides === lib.id) ?? lib;
}

/** The library symbol itself, ignoring project variants. */
export function simboloOriginale(m: ManifestLib, id: string): SimboloLib | undefined {
  return m.symbols.find((s) => s.id === id) ?? m.symbols.find((s) => s.replaces === id);
}

/** The project variant of a library symbol, if the project has one. */
export function varianteDi(libId: string): SimboloLib | undefined {
  return progetto.symbols.find((s) => s.overrides === libId);
}

/** The kind (`pumps`, `valves`…, the manifest's sub-group) a symbol id belongs to, for the gallery of the
 *  properties panel (plan 2026-11-19-galleria-simboli-stesso-tipo): a library id or an old alias its
 *  symbol's; a project variant its library symbol's; a copy («Salva come…») or a new project symbol its
 *  own `kind`; an imported SVG `"custom"`. `null` when it is not known. */
export function symbolKind(m: ManifestLib, id: string, prj: readonly SimboloLib[] = progetto.symbols): string | null {
  if (id.startsWith("custom:")) return "custom";
  if (id.startsWith("prj:")) {
    const s = sovrapposti.get(id)?.voce ?? prj.find((x) => x.id === id);
    if (!s) return null;
    if (s.overrides) return simboloOriginale(m, s.overrides)?.kind ?? (s.kind || null);
    return s.kind || null;
  }
  return simboloOriginale(m, id)?.kind ?? null;
}

/** Il simbolo dal manifesto già caricato, fuori da React (creazione di un oggetto). */
export function trovaSimboloLib(id: string): SimboloLib | undefined {
  return manifesto ? cercaSimbolo(manifesto, id) : undefined;
}

/** The library symbol for `id` (a `lib:` id or a builtin alias), ignoring
 *  project variants, outside React. */
export function trovaSimboloOriginale(id: string): SimboloLib | undefined {
  return manifesto ? simboloOriginale(manifesto, id) : undefined;
}

/** Il builtin `id` ha un sostituto nella libreria? (Picker: non si offre due volte.) */
export function haSostituto(id: string): boolean {
  return !!manifesto?.symbols.some((s) => s.replaces === id);
}

/** Lo SVG già caricato (anteprime): `undefined` se non è ancora arrivato. */
export function svgLibCaricato(s: SimboloLib): string | undefined {
  void caricaSvg(s);
  return svgs.get(s.id);
}

// ── parti vive: lancetta, leva, spie ───────────────────────────────────────

/** Il valore di una parte: `null` = come nel disegno (nessun legame, o nessun
 *  valore leggibile). Stessa regola del pannello: i casi sono in
 *  `tests/fixtures/parti-simbolo.json`. */
export type ValoreParte =
  | { frazione: number | null }
  | { aperta: boolean | null }
  /** L'indice nella lista degli angoli, per una leva a più di due posizioni
   *  (21-10-2026). Le leve booleane continuano a dare `aperta`: cambiare anche
   *  loro vorrebbe dire cambiare che cosa significa un tag numerico su una
   *  valvola già installata — oggi `1` la apre, con l'indice la chiuderebbe. */
  | { posizione: number | null }
  | { accesa: boolean | null };

/** Gli angoli di una leva, col ripiego sulla coppia `open`/`closed` quando il
 *  manifesto non li dichiara. Gemella di `ParteLib::angoli_leva` in
 *  `sws-core/src/simboli_lib.rs`. */
export function angoliLeva(p: { open: number; closed: number; angoli?: number[] }): number[] {
  return p.angoli && p.angoli.length >= 3 ? p.angoli : [p.open, p.closed];
}

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
      // Due posizioni: la regola booleana di sempre, intatta. Più di due: il
      // valore **è** l'indice della posizione (un selettore a tre si lega a un
      // tag 0/1/2), arrotondato e tenuto dentro l'elenco.
      const angoli = angoliLeva(p);
      if (angoli.length >= 3) {
        const n = numeroParte(v);
        out[p.id] = {
          posizione: v === undefined || n === null ? null : Math.min(angoli.length - 1, Math.max(0, Math.round(n))),
        };
      } else {
        out[p.id] = { aperta: v === undefined ? null : veroSimbolo(v) };
      }
    } else if (p.kind === "lamp") {
      out[p.id] = { accesa: v === undefined ? null : veroSimbolo(v) };
    }
  }
  return out;
}
