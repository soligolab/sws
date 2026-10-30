// Portare pagine e cornici da una risoluzione a un'altra (15-10-2026, piano
// docs/archive/2026-10-15-scalare-tra-risoluzioni.md).
//
// Scala **uniforme**: un fattore solo, il minore fra i due assi, così niente si
// deforma; il disegno si centra e lascia una fascia libera. Testi e spessori
// seguono la scala ma non scendono sotto un minimo leggibile. È una conversione
// dei file: runtime e LVGL leggono le pagine convertite come tutte le altre.

import type { GridCell, SubCellEntry, SubGrid, SynopticObject, SynopticPage } from "@/types";

export interface Misura { width: number; height: number }

export interface Trasformazione {
  /** Fattore uniforme. */
  f: number;
  /** Spostamento dopo la scala, per centrare. */
  dx: number;
  dy: number;
}

/** Il fattore uniforme da `da` ad `a`, con la centratura. */
export function fattore(da: Misura, a: Misura): Trasformazione {
  const f = Math.min(a.width / da.width, a.height / da.height);
  return { f, dx: (a.width - da.width * f) / 2, dy: (a.height - da.height * f) / 2 };
}

/** Testo almeno 9 px, spessori almeno 1 px: un testo minuscolo non si legge. */
export const MINIMO_TESTO = 9;
export const MINIMO_SPESSORE = 1;

/** I campi numerici di `SynopticObject` che sono **pixel** e seguono la scala,
 *  con il loro minimo. Le posizioni (`x`, `y`, `x2`, `y2`, `points`,
 *  `motion_path`) non sono qui: si trasformano come punti, con lo spostamento. */
export const CAMPI_SCALATI: Record<string, number> = {
  width: 0, height: 0,
  font_size: MINIMO_TESTO, label_font_size: MINIMO_TESTO, button_font_size: MINIMO_TESTO, unit_font_size: MINIMO_TESTO, table_font_size: MINIMO_TESTO,
  stroke_width: MINIMO_SPESSORE, spark_stroke_width: MINIMO_SPESSORE, symbol_outline_width: MINIMO_SPESSORE,
  corner_radius: 0, grid_gap: 0, grid_padding: 0, nav_gap: 0, nav_btn_size: 0,
  pie_explode_px: 0, pipe_label_offset: 0, slider_track_thickness: MINIMO_SPESSORE,
};

/** I campi di posizione: punti nella pagina, si scalano e si spostano. */
export const CAMPI_POSIZIONE = ["x", "y", "x2", "y2", "points", "motion_path", "col_widths", "row_heights"] as const;

/** I campi numerici che **non** sono pixel: valori, tempi, angoli, rapporti,
 *  conteggi. Restano come sono. Il test-guardia pretende che ogni campo numerico
 *  di `SynopticObject` stia in una delle tre tabelle. */
export const CAMPI_FISSI = [
  "alarm_bell_sound_repeat_s", "alarm_high", "alarm_low", "bg_image_opacity", "slider_track_opacity", "slider_tick_major", "slider_tick_minor", "slider_origin", "alarm_shelve_minutes", "alarm_viewer_max_rows",
  "bar_gap", "bar_ticks", "blink_fade_depth", "blink_rate_ms", "brightness", "datalog_page_size", "decimals",
  "fill_level", "gauge_end_angle", "gauge_start_angle", "gauge_ticks", "grid_cols", "grid_rows", "line_height",
  "marker_size", "max", "min", "motion_max", "motion_min", "opacity", "pan_step_s", "pie_group_below_pct",
  "pie_inner_ratio", "rotation", "sides", "spark_fill_opacity", "spark_window_s", "stale_after_s", "star_inner",
  "step", "symbol_blink_ms", "symbol_level_transition_ms", "symbol_spin_s", "symbol_volume",
  "transition_duration_ms", "warn_high", "warn_low", "window_s", "write_deadband", "xy_sample_ms", "xy_trail_s",
  "xy_x_max", "xy_x_min", "xy_y_max", "xy_y_min", "y_max", "y_min", "z_index",
] as const;

const arrotonda = (v: number) => Math.round(v * 100) / 100;

/** Solo le grandezze in pixel (non le posizioni): per i figli delle celle,
 *  che hanno coordinate relative alla cella. */
function scalaMisure<T extends object>(o: T, f: number): T {
  const out = { ...o } as Record<string, unknown>;
  for (const [campo, minimo] of Object.entries(CAMPI_SCALATI)) {
    const v = out[campo];
    if (typeof v === "number" && Number.isFinite(v)) {
      const s = arrotonda(v * f);
      out[campo] = v > 0 ? Math.max(minimo, s) : s;
    }
  }
  for (const campo of ["col_widths", "row_heights"]) {
    const v = out[campo];
    if (Array.isArray(v)) out[campo] = v.map((n) => (typeof n === "number" ? arrotonda(n * f) : n));
  }
  if (Array.isArray(out.grid_cells)) out.grid_cells = (out.grid_cells as GridCell[]).map((c) => scalaCella(c, f));
  return out as T;
}

function scalaSub(s: SubGrid, f: number): SubGrid {
  return {
    ...s,
    ...(s.a ? { a: scalaVoce(s.a, f) } : {}),
    ...(s.b ? { b: scalaVoce(s.b, f) } : {}),
  };
}

function scalaVoce(v: SubCellEntry, f: number): SubCellEntry {
  return {
    ...v,
    ...(v.child ? { child: scalaMisure(v.child, f) } : {}),
    ...(v.sub ? { sub: scalaSub(v.sub, f) } : {}),
  };
}

function scalaCella(c: GridCell, f: number): GridCell {
  return {
    ...c,
    ...(c.child ? { child: scalaMisure(c.child, f) } : {}),
    ...(c.sub ? { sub: scalaSub(c.sub, f) } : {}),
  };
}

/** Un oggetto della pagina: i punti vanno in `p·f + spostamento`, le misure in
 *  `misura·f` (col minimo). `punto` decide lo spostamento verticale, che per le
 *  cornici dipende dalla fascia. */
export function scalaOggetto(
  obj: SynopticObject,
  f: number,
  punto: (x: number, y: number) => { x: number; y: number },
): SynopticObject {
  const out = scalaMisure(obj, f);
  const p = punto(obj.x ?? 0, obj.y ?? 0);
  out.x = arrotonda(p.x);
  out.y = arrotonda(p.y);
  if (typeof obj.x2 === "number" || typeof obj.y2 === "number") {
    const q = punto(obj.x2 ?? obj.x ?? 0, obj.y2 ?? obj.y ?? 0);
    if (typeof obj.x2 === "number") out.x2 = arrotonda(q.x);
    if (typeof obj.y2 === "number") out.y2 = arrotonda(q.y);
  }
  const punti = (ps: { x: number; y: number }[]) => ps.map((pt) => {
    const r = punto(pt.x, pt.y);
    return { ...pt, x: arrotonda(r.x), y: arrotonda(r.y) };
  });
  if (Array.isArray(obj.points)) out.points = punti(obj.points);
  if (Array.isArray(obj.motion_path)) out.motion_path = punti(obj.motion_path);
  return out;
}

/** Una pagina sinottica (o di boot) portata ad `a`: scala uniforme e centrata. */
export function scalaPagina(page: SynopticPage, a: Misura): SynopticPage {
  const da = { width: page.width ?? a.width, height: page.height ?? a.height };
  const { f, dx, dy } = fattore(da, a);
  const punto = (x: number, y: number) => ({ x: x * f + dx, y: y * f + dy });
  return {
    ...page,
    width: a.width,
    height: a.height,
    objects: page.objects.map((o) => scalaOggetto(o, f, punto)),
  };
}

/** Una cornice aperta come pagina (`kind: "cornice"`) portata ad `a`. Le fasce
 *  restano attaccate ai bordi: testata in alto, piede in basso, la loro altezza
 *  per `f`. In orizzontale si centra come le pagine. */
export function scalaCornice(page: SynopticPage, a: Misura): SynopticPage {
  const da = { width: page.width ?? a.width, height: page.height ?? a.height };
  const { f, dx } = fattore(da, a);
  const inizioPiede = da.height - (page.cornice_piede?.altezza ?? 0);
  const haPiede = (page.cornice_piede?.altezza ?? 0) > 0;
  // Un oggetto sta nel piede se ci comincia: tutti i suoi punti seguono il
  // piede, così una barra non si spezza fra due ancoraggi.
  const scalaUno = (o: SynopticObject) => {
    const nelPiede = haPiede && (o.y ?? 0) >= inizioPiede;
    const punto = nelPiede
      ? (x: number, y: number) => ({ x: x * f + dx, y: a.height - (da.height - y) * f })
      : (x: number, y: number) => ({ x: x * f + dx, y: y * f });
    return scalaOggetto(o, f, punto);
  };
  const fascia = (fa: SynopticPage["cornice_testata"]) =>
    fa ? { ...fa, altezza: arrotonda(fa.altezza * f) } : fa;
  return {
    ...page,
    width: a.width,
    height: a.height,
    cornice_testata: fascia(page.cornice_testata),
    cornice_piede: fascia(page.cornice_piede),
    objects: page.objects.map(scalaUno),
  };
}

/** Il «Da» proposto dal dialogo: la misura dello **schermo** del progetto, non
 *  quella più frequente. Le finestre aperte sopra la pagina (popup, modali)
 *  sono più piccole dello schermo, e se sono tante vincono il conteggio: il
 *  dialogo spuntava loro e lasciava fuori pagine principali, cornici e boot.
 *  Lo schermo lo dicono, nell'ordine: cornici e immagini di boot (occupano lo
 *  schermo per costruzione), il predefinito del progetto se qualche pagina lo
 *  ha ancora, e solo alla fine la misura più frequente. */
export function misuraDaProporre(
  pages: readonly SynopticPage[],
  predefinita?: { default_width?: number; default_height?: number } | null,
): Misura | null {
  const schermo = misuraPiuFrequente(pages.filter((p) => p.kind === "cornice" || p.kind === "boot"));
  if (schermo) return schermo;
  const w = predefinita?.default_width, h = predefinita?.default_height;
  if (w && h && pages.some((p) => p.width === w && p.height === h)) return { width: w, height: h };
  return misuraPiuFrequente(pages);
}

/** La misura più frequente fra le pagine date. */
export function misuraPiuFrequente(pages: readonly SynopticPage[]): Misura | null {
  const conta = new Map<string, { m: Misura; n: number }>();
  for (const p of pages) {
    if (!p.width || !p.height) continue;
    const k = `${p.width}x${p.height}`;
    const e = conta.get(k) ?? { m: { width: p.width, height: p.height }, n: 0 };
    e.n += 1;
    conta.set(k, e);
  }
  let migliore: { m: Misura; n: number } | null = null;
  for (const e of conta.values()) if (!migliore || e.n > migliore.n) migliore = e;
  return migliore?.m ?? null;
}
