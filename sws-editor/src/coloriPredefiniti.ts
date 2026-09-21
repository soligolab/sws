// Il colore che un oggetto ha quando il progetto **non** ne dichiara uno —
// in un posto solo, per la creazione, il canvas e il pannello proprietà.
//
// Fino al 21-09-2026 viveva in quattro posti che non si conoscevano:
// `handleAddObject` scriveva stringhe CSS `var(--brand-text, #e2e8f0)` nel
// progetto (che `<input type="color">` sanifica a #000000 e che il pannello
// LVGL scarta in silenzio), SvgCanvas aveva i suoi `?? "#…"`, il pannello i
// suoi, lvgl_render.rs i suoi `unwrap_or`. Un Testo nasceva bianco sul canvas e
// nero nel pannello.
//
// **La fonte è `tests/fixtures/colori-predefiniti.json`**: la tabella qui sotto
// è scritta nel modulo (Vite non serve file fuori da `src/`, e il bundle si
// porterebbe dentro un file di test) e il test `tests/coloriPredefiniti.test.ts`
// la confronta con la fixture voce per voce; il test Rust di lvgl_render.rs fa
// lo stesso con i letterali del pannello. Stesso schema di `testiSistema.ts`.
//
// Due regole possibili per un campo:
//   - `{ hex }`: un colore fisso, scritto nel file alla creazione;
//   - `{ auto }`: **nessun colore nel file**. L'oggetto segue lo sfondo della
//     pagina — tono «testo» (chiaro su scuro, scuro su chiaro) o «sottile» (il
//     grigio di una tubazione) — come già facevano il testo web via
//     `--synoptic-text` e LVGL via `default_text_rgb`. Il pannello mostra il
//     colore effettivo con la dicitura «auto»; toccarlo lo rende esplicito.

import type { SynopticObject, SynopticPage } from "@/types";
import { defaultObjectSubtleColor, defaultObjectTextColor } from "@/theme";

export type Tono = "testo" | "sottile";
export type RegolaColore = { auto: Tono } | { hex: string };

/** Il tono in hex per uno sfondo noto; per uno sfondo ignoto, il token CSS che
 *  il canvas SVG sa risolvere da solo (`--synoptic-*`, iniettato sull'`<svg>`). */
export const TOKEN_AUTO: Record<Tono, string> = {
  testo:   "var(--synoptic-text, var(--brand-text, #e2e8f0))",
  sottile: "var(--synoptic-subtle, var(--brand-text-subtle, #64748b))",
};

/** `predefiniti[tipo][campo]` della fixture. `*` vale per ogni tipo che non
 *  dichiara quel campo. */
export const PREDEFINITI: Record<string, Record<string, RegolaColore>> = {
  "*": {
    fill:   { hex: "#3b82f6" },
    stroke: { auto: "testo" },
    color:  { auto: "testo" },
    bg_color: { hex: "#0f172a" },
    gradient_light_color: { hex: "#ffffff" },
    gradient_dark_color:  { hex: "#000000" },
    quality_dot_good_color:      { hex: "#22c55e" },
    quality_dot_uncertain_color: { hex: "#eab308" },
    quality_dot_bad_color:       { hex: "#ef4444" },
  },
  text:    { color: { auto: "testo" } },
  line:    { stroke: { auto: "testo" } },
  rect:    { fill: { hex: "#4a90d9" }, stroke: { auto: "testo" } },
  ellipse: { fill: { hex: "#4a90d9" }, stroke: { auto: "testo" } },
  button:  { fill: { hex: "#3b82f6" }, color: { hex: "#ffffff" } },
  navbutton: { fill: { hex: "#0f172a" }, stroke: { hex: "#3b82f6" }, color: { auto: "testo" } },
  gauge:   { color: { auto: "testo" }, stroke: { hex: "#e2e8f0" }, fill: { hex: "#22c55e" }, gauge_sp_color: { hex: "#f59e0b" } },
  led:     { on_color: { hex: "#22c55e" }, off_color: { hex: "#374151" } },
  progress_bar: { fill: { hex: "#3b82f6" } },
  slider:   { fill: { hex: "#3b82f6" } },
  checkbox: { fill: { hex: "#3b82f6" } },
  radio:    { fill: { hex: "#3b82f6" } },
  setpoint: { fill: { hex: "#3b82f6" } },
  pipe:    { stroke: { auto: "sottile" }, fill_color: { hex: "#3b82f6" }, gradient_light_color: { hex: "#94a3b8" }, gradient_dark_color: { hex: "#334155" } },
  sparkline: { spark_color: { hex: "#3b82f6" } },
  text_list:  { color: { auto: "testo" }, text_list_default_color: { hex: "#94a3b8" } },
  state_lamp: { text_list_default_color: { hex: "#94a3b8" } },
  symbol:  { state_off_color: { hex: "#64748b" }, state_on_color: { hex: "#22c55e" }, state_alarm_color: { hex: "#ef4444" } },
  grid:    { grid_border_color: { hex: "#64748b" } },
  alarm_bell:   { fill: { hex: "#1e293b" } },
  alarm_viewer: { alarm_viewer_bg_color: { hex: "#0f172a" } },
  trend:     { axis_color: { hex: "#64748b" }, grid_color: { hex: "#1e293b" } },
  bar_chart: { axis_color: { hex: "#64748b" }, grid_color: { hex: "#1e293b" } },
  pie_chart: { pie_hole_color: { hex: "#0f172a" }, pie_group_color: { hex: "#64748b" } },
};

/** La regola per `campo` di un oggetto di `tipo`: quella del tipo, poi quella
 *  di `*`, poi niente (un campo che non è un colore, o un colore che nessuno
 *  ha ancora messo in tabella). */
export function regola(tipo: string, campo: string): RegolaColore | undefined {
  return PREDEFINITI[tipo]?.[campo] ?? PREDEFINITI["*"]?.[campo];
}

/** Solo i colori **fissi**: quello che la creazione scrive nel file. Per un
 *  campo automatico ritorna `undefined`, cioè «non scriverlo». */
export function predefinito(tipo: string, campo: string): string | undefined {
  const r = regola(tipo, campo);
  return r && "hex" in r ? r.hex : undefined;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const VAR_CON_RIPIEGO = /^var\(\s*--[\w-]+\s*,\s*(.+)\)$/s;
/** I token che vogliono dire «il colore del testo sulla pagina»: non un colore
 *  ma una delega. Esatti: `-muted` e `-subtle` sono toni voluti e restano. */
const TOKEN_TESTO = /^var\(\s*--(brand-text|synoptic-text)\s*[,)]/;

/** Un `#rgb`/`#rrggbb` a sei cifre minuscole, o `undefined`. */
function seiCifre(v: string): string | undefined {
  const t = v.trim();
  if (!HEX.test(t)) return undefined;
  const c = t.slice(1).toLowerCase();
  return "#" + (c.length === 3 ? c.split("").map((ch) => ch + ch).join("") : c);
}

/** L'hex dentro un valore qualunque: un hex com'è, il ripiego di un `var(…)`
 *  (anche annidato), altrimenti `undefined`. Serve allo swatch, che vuole
 *  sempre sei cifre e non sa cosa farsene di un token. */
export function estraiHex(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  const diretto = seiCifre(t);
  if (diretto) return diretto;
  const m = VAR_CON_RIPIEGO.exec(t);
  return m ? estraiHex(m[1]) : undefined;
}

/** Cosa scrivere nel progetto al posto di un valore letto (D2 del piano del
 *  21-09-2026): un token del testo → `undefined` (automatico); ogni altro
 *  `var(--x, #hex)` → `#hex`; un `var(…)` senza ripiego → `undefined`; un hex
 *  → sei cifre minuscole; qualunque altra cosa com'è (non è nostro compito). */
export function normalizzaColore(v: unknown): string | undefined {
  if (typeof v !== "string") return v === null ? undefined : (v as undefined);
  const t = v.trim();
  if (t === "") return undefined;
  if (TOKEN_TESTO.test(t)) return undefined;
  if (t.startsWith("var(")) return estraiHex(t);
  return seiCifre(t) ?? t;
}

/** Vero se questo valore è una stringa CSS `var(…)`: l'unica cosa che la
 *  normalizzazione tocca. Un hex, un nome, un gradiente passano com'erano. */
function daNormalizzare(v: unknown): v is string {
  return typeof v === "string" && v.trimStart().startsWith("var(");
}

/** Ricorsiva su ogni proprietà stringa e su ogni oggetto/array annidato
 *  (entries di text_list e state_lamp, serie, fette, celle di griglia con i
 *  loro figli): tocca **solo** le stringhe `var(…)`. Ritorna lo **stesso**
 *  riferimento se non c'è niente da cambiare — è così che il sorvegliante
 *  «progetto cambiato» non scatta a vuoto (idioma di `normalizeTrendObjects`). */
function normalizzaRicorsivo<T>(v: T): T {
  if (Array.isArray(v)) {
    let cambiato = false;
    const out = v.map((x) => { const y = normalizzaRicorsivo(x); if (y !== x) cambiato = true; return y; });
    return (cambiato ? out : v) as T;
  }
  if (v && typeof v === "object") {
    let cambiato = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      let y: unknown = x;
      if (daNormalizzare(x)) y = normalizzaColore(x);
      else if (x && typeof x === "object") y = normalizzaRicorsivo(x);
      if (y !== x) cambiato = true;
      if (y !== undefined) out[k] = y;
    }
    return (cambiato ? out : v) as T;
  }
  return v;
}

export function normalizzaColoriOggetto(o: SynopticObject): SynopticObject {
  return normalizzaRicorsivo(o);
}

export function normalizzaColoriOggetti(objs: SynopticObject[]): SynopticObject[] {
  return normalizzaRicorsivo(objs);
}

export function normalizzaColoriPagine(pages: SynopticPage[]): SynopticPage[] {
  let cambiato = false;
  const out = pages.map((p) => {
    const objs = normalizzaColoriOggetti(p.objects);
    if (objs === p.objects) return p;
    cambiato = true;
    return { ...p, objects: objs };
  });
  return cambiato ? out : pages;
}

/** Il tono automatico risolto: hex se lo sfondo è noto, altrimenti il token
 *  CSS (solo il canvas SVG può usarlo). */
export function coloreAuto(tono: Tono, sfondo: string | undefined): string {
  if (sfondo === undefined) return TOKEN_AUTO[tono];
  return tono === "testo" ? defaultObjectTextColor(sfondo) : defaultObjectSubtleColor(sfondo);
}

/** Il colore con cui `campo` di `obj` viene davvero disegnato.
 *
 *  Esplicito (normalizzato) → quello. Regola `hex` → l'hex. Regola `auto` →
 *  il tono per lo sfondo, se dato; senza sfondo il token CSS, che va bene
 *  **solo nell'SVG** (anche annidato in faceplate e celle, che è il motivo per
 *  cui il canvas non passa lo sfondo). Il pannello passa **sempre** lo sfondo
 *  e riceve hex — la guardia `check_colori.sh` controlla che nessun
 *  `<input type="color">` riceva altro. Un campo senza regola si comporta
 *  come testo automatico: è la scelta meno sorprendente su un disegno. */
export function coloreEffettivo(obj: SynopticObject, campo: string, sfondo?: string): string {
  const esplicito = normalizzaColore((obj as unknown as Record<string, unknown>)[campo]);
  if (esplicito) return esplicito;
  const r = regola(obj.type, campo) ?? { auto: "testo" as Tono };
  if ("hex" in r) return r.hex;
  return coloreAuto(r.auto, sfondo);
}
