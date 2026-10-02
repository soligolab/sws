// Il valore che un campo NON-colore ha quando il progetto non lo dichiara, e il
// passo che scrive nel file i predefiniti fissi mancanti (colori compresi).
//
// Nasce il 30-09-2026: un `data_log` era scuro nell'editor e bianco sul pannello
// LVGL, e il campo mostrava solo il segnaposto `#0f172a`. Fuori dai colori non
// esisteva una tabella: ogni ripiego era un letterale in SvgCanvas e un altro in
// lvgl_render.rs, e il pannello ne mostrava un terzo. Scrivere il valore **nel
// file** chiude la divergenza alla radice: i due motori leggono lo stesso numero.
//
// **La fonte è `tests/fixtures/predefiniti-campi.json`** (stesso schema di
// `coloriPredefiniti.ts`: la tabella è scritta qui perché Vite non serve file
// fuori da `src/`, e `tests/predefinitiCampi.test.ts` la confronta voce per voce).
//
// Due regole:
//   - `{ valore }`: un predefinito fisso — scritto alla creazione e all'apertura;
//   - `{ vuoto }`: nessun valore nel file **per scelta** (la scala si adatta ai
//     dati, l'etichetta è il nome del tag…): il pannello lo dichiara.

import type { SynopticObject, GridCell, SubCellEntry } from "@/types";
import { PREDEFINITI } from "@/coloriPredefiniti";

export type MotivoVuoto =
  | "adatta" | "nome_tag" | "nessuna" | "codice_lingua" | "tacche_predefinite" | "dal_passo";
export type RegolaCampo = { valore: number | string | boolean } | { vuoto: MotivoVuoto };

export const MOTIVI: MotivoVuoto[] = ["adatta", "nome_tag", "nessuna", "codice_lingua", "tacche_predefinite", "dal_passo"];

export const CAMPI: Record<string, Record<string, RegolaCampo>> = {
  text:       { font_size: { valore: 14 } },
  text_list:  { font_size: { valore: 16 } },
  state_lamp: { font_size: { valore: 13 } },
  pipe:       { font_size: { valore: 12 } },
  button:     { label: { valore: "Button" } },
  navbutton:  { label: { valore: "Go to page" } },
  lang_button: { label: { vuoto: "codice_lingua" } },
  checkbox:   { label: { vuoto: "nessuna" } },
  radio:      { label: { vuoto: "nessuna" } },
  led:        { label: { vuoto: "nessuna" } },
  gauge: {
    label: { vuoto: "nessuna" },
    min: { valore: 0 }, max: { valore: 100 }, decimals: { valore: 1 },
    gauge_start_angle: { valore: -135 }, gauge_end_angle: { valore: 135 },
    gauge_ticks: { vuoto: "tacche_predefinite" },
  },
  progress_bar: {
    label: { vuoto: "nessuna" },
    min: { valore: 0 }, max: { valore: 100 }, decimals: { valore: 1 },
  },
  slider: {
    label: { vuoto: "nessuna" },
    min: { valore: 0 }, max: { valore: 100 }, step: { valore: 1 },
    decimals: { vuoto: "dal_passo" },
  },
  setpoint: {
    label: { vuoto: "nessuna" },
    decimals: { valore: 1 }, step: { valore: 1 },
  },
  kpi_tile: {
    label: { vuoto: "nome_tag" },
    spark_window_s: { valore: 3600 }, decimals: { valore: 1 },
  },
  data_log: {
    label: { vuoto: "nessuna" },
    window_s: { valore: 3600 }, datalog_page_size: { valore: 25 }, decimals: { valore: 1 },
  },
  trend: {
    window_s: { valore: 60 },
    y_min: { vuoto: "adatta" }, y_max: { vuoto: "adatta" },
  },
  sparkline: {
    spark_window_s: { valore: 60 },
    y_min: { vuoto: "adatta" }, y_max: { vuoto: "adatta" },
  },
  xy_plot: {
    xy_trail_s: { valore: 30 }, xy_sample_ms: { valore: 200 },
    xy_x_min: { vuoto: "adatta" }, xy_x_max: { vuoto: "adatta" },
    xy_y_min: { vuoto: "adatta" }, xy_y_max: { vuoto: "adatta" },
  },
  bar_chart: {
    bar_gap: { valore: 0.2 }, decimals: { valore: 1 },
    min: { vuoto: "adatta" }, max: { vuoto: "adatta" },
  },
  pie_chart:    { pie_inner_ratio: { valore: 0.5 }, decimals: { valore: 1 } },
  alarm_viewer: { alarm_viewer_max_rows: { valore: 5 } },
  symbol:       { symbol_spin_s: { valore: 2 } },
};

/** La regola di `campo` per un oggetto di `tipo`, o `undefined`. */
export function regolaCampo(tipo: string, campo: string): RegolaCampo | undefined {
  return CAMPI[tipo]?.[campo];
}

/** Il predefinito fisso di `campo`, o `undefined` (nessuna regola, o un vuoto voluto). */
export function valorePredefinito(tipo: string, campo: string): number | string | boolean | undefined {
  const r = regolaCampo(tipo, campo);
  return r && "valore" in r ? r.valore : undefined;
}

/** Ciò che `riempiPredefiniti` scrive per un tipo: i valori fissi di questa
 *  tabella e i colori `hex` **dichiarati per quel tipo** in `coloriPredefiniti`.
 *  Le voci `*` dei colori no: valgono per tipi che quel campo magari non lo
 *  usano affatto, e un file pieno di colori inerti non dice niente di vero. */
export function fissiDelTipo(tipo: string): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [campo, r] of Object.entries(PREDEFINITI[tipo] ?? {})) {
    if ("hex" in r) out[campo] = r.hex;
  }
  for (const [campo, r] of Object.entries(CAMPI[tipo] ?? {})) {
    if ("valore" in r) out[campo] = r.valore;
  }
  return out;
}

/** Scrive nell'oggetto i predefiniti fissi che mancano. Stesso riferimento se
 *  non manca niente — è così che il sorvegliante «progetto cambiato» non scatta
 *  a vuoto (idioma di `normalizeTrendObjects`). */
export function riempiPredefiniti(obj: SynopticObject): SynopticObject {
  const fissi = fissiDelTipo(obj.type);
  const rec = obj as unknown as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const [campo, v] of Object.entries(fissi)) {
    // Rettangoli e bottoni vecchi col colore in `bg_color`: il web disegna
    // `fill ?? bg_color`, e riempire `fill` cambierebbe il loro colore.
    if (campo === "fill" && rec.bg_color !== undefined && rec.bg_color !== null) continue;
    if (rec[campo] === undefined || rec[campo] === null) {
      out ??= { ...rec };
      out[campo] = v;
    }
  }
  return (out ?? obj) as SynopticObject;
}

/** Un oggetto e **tutto ciò che contiene**: i figli delle celle di una griglia,
 *  e quelli delle sotto-celle, che annidano a loro volta.
 *
 *  Scoperto il 02-10-2026 su un progetto di collaudo con tutti i tipi: 234
 *  campi su 240 erano stati scritti, e i sei mancanti stavano tutti **dentro
 *  una griglia** (`g_led`, `g_rect`, `g_text`, `g_lamp`). Il riempimento
 *  guardava solo gli oggetti di primo livello della pagina, quindi un led in
 *  una cella restava senza `on_color`: e un valore che il file non dice è
 *  esattamente ciò che i due motori indovinano ciascuno a modo suo — il
 *  difetto che questa tabella esiste per chiudere.
 *
 *  Stesso percorso di `collectTagIds`, che le celle le visita già tutte: se un
 *  contenitore nuovo comparisse, va aggiunto in tutti e due. */
function riempiRicorsivo(obj: SynopticObject): SynopticObject {
  const dopo = riempiPredefiniti(obj);
  const celle = dopo.grid_cells;
  if (!celle?.length) return dopo;
  let cambiato = false;
  const nuove = celle.map((cella) => {
    const c = riempiCella(cella);
    if (c !== cella) cambiato = true;
    return c;
  });
  if (!cambiato) return dopo;
  return { ...dopo, grid_cells: nuove };
}

function riempiCella(cella: GridCell): GridCell {
  let out = cella;
  if (cella.child) {
    const n = riempiRicorsivo(cella.child);
    if (n !== cella.child) out = { ...out, child: n };
  }
  if (cella.sub) {
    const a = cella.sub.a ? riempiSottoCella(cella.sub.a) : cella.sub.a;
    const b = cella.sub.b ? riempiSottoCella(cella.sub.b) : cella.sub.b;
    if (a !== cella.sub.a || b !== cella.sub.b) out = { ...out, sub: { ...cella.sub, a, b } };
  }
  return out;
}

function riempiSottoCella(entry: SubCellEntry): SubCellEntry {
  let out = entry;
  if (entry.child) {
    const n = riempiRicorsivo(entry.child);
    if (n !== entry.child) out = { ...out, child: n };
  }
  if (entry.sub) {
    const a = entry.sub.a ? riempiSottoCella(entry.sub.a) : entry.sub.a;
    const b = entry.sub.b ? riempiSottoCella(entry.sub.b) : entry.sub.b;
    if (a !== entry.sub.a || b !== entry.sub.b) out = { ...out, sub: { ...entry.sub, a, b } };
  }
  return out;
}

export function riempiPredefinitiOggetti(objs: SynopticObject[]): SynopticObject[] {
  let cambiato = false;
  const out = objs.map((o) => {
    const n = riempiRicorsivo(o);
    if (n !== o) cambiato = true;
    return n;
  });
  return cambiato ? out : objs;
}
