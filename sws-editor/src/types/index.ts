export type TagQuality = "Good" | "Bad" | "Uncertain";

export interface TagState {
  value: number | string | boolean;
  quality: TagQuality;
  timestamp_ms: number;
}

export type SynopticObjectType =
  | "rect"
  | "ellipse"
  | "line"
  | "text"
  | "image"
  // Controls
  | "button"
  | "navbutton"
  | "checkbox"
  | "radio"
  | "slider"
  | "setpoint"
  // Displays
  | "gauge"
  | "led"
  | "state_lamp"
  | "progress_bar"
  | "table"
  | "trend"
  | "text_list"
  | "bar_chart"
  | "pie_chart"
  | "sparkline"
  // KPI tile (F5.5): valore grande + micro-trend + confronto vs periodo precedente
  | "kpi_tile"
  // Data log (F5.4): tabella storica paginata (ts/valore/qualità) con export
  | "data_log"
  | "alarm_viewer"
  | "alarm_bell"
  | "alarm_banner"
  // Recipe list + apply, promoted from the fixed RecipeModal (RuntimeView.tsx)
  | "recipe_panel"
  // SCADA symbols (pump/valve/motor/tank/fan from the built-in library)
  | "symbol"
  // Pipe / connector (multi-waypoint path with fill-level animation)
  | "pipe"
  // Live point + trailing trail against two tags (trajectory/position, not time)
  | "xy_plot"
  // Layout
  | "grid"
  // Faceplate instance (parametric reusable component)
  | "faceplate"
  // Language switch controls (T-40): change the project content language
  | "lang_selector"
  | "lang_button";

/** Identifier of a SCADA symbol — either a hand-rolled JSX builtin or a
 *  vendored SVG file. The library at `@/symbols/library` maps ids to metadata
 *  (label, render function for builtins, asset path for vendored ones). */
export type SymbolId = string;

/** Source category for a SymbolMeta entry. Builtin = JSX in library.tsx,
 *  vendored = SVG file under `public/symbols/`. */
export type SymbolKind = "builtin" | "vendored";

/** One cell in a grid layout object. */
export interface GridCell {
  row: number;
  col: number;
  rowspan?: number;
  colspan?: number;
  bg_color?: string;
  bg_image?: string;
  /** Static visibility flag (default true). */
  visible?: boolean;
  /** Tag id whose truthy value controls visibility. */
  visible_tag?: string;
  on_press_fn?: string;
  on_release_fn?: string;
  /** Inline child object rendered centered in this cell. */
  child?: SynopticObject;
  /** Local 1×2 / 2×1 subdivision of this cell. When set, `child` is ignored
   *  and rendering recurses into `sub.a` / `sub.b`. Recursion of `sub` inside
   *  a `SubCellEntry` is intentionally not allowed in this version. */
  sub?: SubGrid;
}

/** Local mini-grid that subdivides a single `GridCell` into two slots. */
export interface SubGrid {
  /** `rows` = top/bottom split (a above, b below); `cols` = left/right split. */
  orientation: "rows" | "cols";
  /** Fractional size of slot `a` (0.05 .. 0.95). Slot `b` is the remainder. */
  ratio: number;
  a?: SubCellEntry;
  b?: SubCellEntry;
}

/** Content of one slot inside a `SubGrid`. Mirrors the customisable bits of a
 *  `GridCell` but without row/col coordinates (the slot is positional).
 *  May itself be subdivided via `sub` (recursive — no depth limit). */
export interface SubCellEntry {
  bg_color?: string;
  bg_image?: string;
  visible?: boolean;
  visible_tag?: string;
  on_press_fn?: string;
  on_release_fn?: string;
  child?: SynopticObject;
  /** Recursive subdivision. When set, `child` is ignored and the slot
   *  renders as a mini-grid (its two slots may each split again, ad lib). */
  sub?: SubGrid;
}

/** Path of slot keys from a top-level `GridCell` down to a nested sub-cell.
 *  Empty → the cell itself; `["a"]` → first split's slot A; `["a", "b"]` →
 *  slot A's split's slot B; and so on. */
export type SubPath = ("a" | "b")[];

/** One waypoint in a pipe/connector path. */
export interface PipePoint {
  x: number;
  y: number;
}

/** One option in a radio-group. */
export interface RadioOption {
  label: string;
  value: string | number | boolean;
}

/** One row in a data table object. */
export interface TableRow {
  label: string;
  tag: string;
  format?: string;
}

/** Traccia unificata del trend (migrazione 2026-08-23, taglio netto):
 *  tag + stile in un'unica voce. Sostituisce il trio legacy
 *  tag/extra_tags/trend_series_styles (+line_color), che resta nel tipo solo
 *  per la migrazione automatica al load (normalizeTrendObject). */
export interface TrendTrace {
  tag: string;
  /** Nome mostrato in legenda/tooltip (fallback: l'id del tag). */
  label?: string;
  color?: string;
  /** Spessore in px. Default 1.5. */
  width?: number;
  dash?: "solid" | "dashed" | "dotted";
  fill?: boolean;
  fill_opacity?: number;
  smooth?: boolean;
  own_scale?: boolean;
  hidden?: boolean;
}

/** LEGACY (pre trend_tags) — per-trace style override (index 0 = the trend
 *  object's own `tag`, index i = `extra_tags[i-1]`). Migrato al load. */
export interface TrendSeriesStyle {
  color?: string;
  /** Stroke width in px. Default 1.5. */
  width?: number;
  dash?: "solid" | "dashed" | "dotted";
  /** Fill the area under the curve. */
  fill?: boolean;
  /** 0..1. Default 0.15. */
  fill_opacity?: number;
  /** Cosmetic corner-rounding (midpoint quadratic), not resampling. */
  smooth?: boolean;
  /** When true, this trace gets its own Y-axis (autofit on its own samples
   *  only), drawn as an extra labeled column on the left of the plot instead
   *  of sharing the single right-hand axis with the other traces. Default
   *  false — unaffected traces keep today's shared-scale behaviour. */
  own_scale?: boolean;
  /** Start hidden. This is the *persisted* initial visibility (saved with the
   *  synoptic); the operator can still toggle traces at runtime by clicking
   *  the legend, which is ephemeral state on top of this. */
  hidden?: boolean;
}

/**
 * Built-in runtime action for a pressable object.
 * - "login"    → opens the login modal overlay on the synoptic.
 * - "logout"   → logs out and returns to anonymous read-only.
 * - "navigate" → browser navigation to `url` (cross-page or cross-host).
 * When set, Python on_press_fn is NOT called for "login"/"logout" (the built-in
 * action takes precedence). For "navigate", on_press_fn fires first, then navigate.
 */
export type ButtonAction =
  | { type: "login" }
  | { type: "logout" }
  | { type: "navigate"; url: string }
  /** F6.3: apre un faceplate come popup, parametrizzato — il gesto SCADA
   *  "click sulla pompa → finestra della pompa". */
  | { type: "open_faceplate"; faceplate_id: string; params?: Record<string, string> };

export interface SynopticObject {
  id: string;
  /** Optional human-friendly name shown in the page object list. Defaults to type+suffix when omitted. */
  name?: string;
  type: SynopticObjectType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fill?: string;
  /** Universal background color, drawn behind the object's own content —
   *  same convention GridCell/SubCellEntry already used, promoted to every
   *  object. Distinct from `fill` (which is the object's own body color,
   *  e.g. a button face or a rect): this is the layer *behind* it. */
  bg_color?: string;
  /** Universal background image URL, drawn above bg_color, below content.
   *  A URL (external or a path served by the runtime), not an upload — same
   *  model as GridCell.bg_image and CustomSymbol.url. */
  bg_image?: string;
  /** Chart axes color (frame + tick labels). Trend today; meant to be shared
   *  by future chart widgets rather than one field per widget. */
  axis_color?: string;
  /** Chart grid-lines color. Trend today, same sharing intent as axis_color. */
  grid_color?: string;
  /** Trend (F5.2x): scala Y logaritmica sulla scala condivisa (dominio > 0). */
  trend_log_scale?: boolean;
  /** Data log (F5.4): righe per pagina della tabella storica (default 25). */
  datalog_page_size?: number;
  /** Simbolo N-stati (F6.6): mappa valore→stato sul valore di state_tag
   *  (valore esatto o range, come text_list_entries). L'entry attiva colora
   *  il simbolo (e il badge), può lampeggiare e mostrare una label sotto.
   *  alarm_tag vince comunque. Assente = 3 stati truthy storici. */
  symbol_states?: TextListEntry[];
  /** Rotazione continua del simbolo (F6.10): "on_state" = gira quando lo
   *  stato è on, "tag" = quando symbol_spin_tag è truthy, "always" = sempre. */
  symbol_spin?: "always" | "on_state" | "tag";
  symbol_spin_tag?: string;
  /** Periodo di rotazione in secondi (default 2). */
  symbol_spin_s?: number;
  /** Flusso animato nella pipe (F6.10): tratteggio in movimento quando
   *  pipe_flow_tag è truthy (o sempre, se non impostato); velocità/direzione
   *  dal segno del valore quando numerico. */
  pipe_flow?: boolean;
  pipe_flow_tag?: string;
  /** Movimento su percorso (F6.10): l'oggetto trasla lungo la polilinea in
   *  funzione del valore di motion_tag mappato da motion_min..motion_max a
   *  0..1 (carrelli, ascensori, navette). Punti in coordinate pagina. */
  motion_path?: PipePoint[];
  motion_tag?: string;
  motion_min?: number;
  motion_max?: number;
  /** Punto dell'oggetto agganciato al percorso (default: centro). */
  motion_anchor?: "center" | "top_left";
  tag?: string;
  format?: string;
  src?: string;
  label?: string;
  write_value?: string | number | boolean;
  // ── Text object ──────────────────────────────────────────────────────────
  /** Static text content. If `tag` is also set, `format` wins. */
  text?: string;
  font_size?: number;
  font_family?: string;
  /** "normal" | "bold" | number (100-900). */
  font_weight?: string | number;
  font_style?: "normal" | "italic";
  text_anchor?: "start" | "middle" | "end";
  /** Text fill colour (preferred over `fill` for the text object). */
  color?: string;
  /** When true and the text is tag-bound with a numeric value, `color` is
   *  overridden by warn_low/warn_high/alarm_low/alarm_high (same thresholdColor()
   *  used by gauge/progress_bar) whenever a threshold is crossed. */
  text_color_by_threshold?: boolean;
  // Line / stroke
  x2?: number;
  y2?: number;
  stroke?: string;
  stroke_width?: number;
  // Page navigation
  target_page?: string;
  /** Language switch controls (T-40): the language code this lang_button sets. */
  target_lang?: string;
  // Numeric range (gauge, slider, progress_bar)
  min?: number;
  max?: number;
  unit?: string;
  /** Cifre decimali del valore visualizzato (F1.3). Default: dal TagDef, poi 1. */
  decimals?: number;
  step?: number;
  // ── F3: pipeline di comando ────────────────────────────────────────────────
  /** Comportamento del button (F3.5). Default "write" (scrivi write_value).
   *  momentary: write_value alla pressione, release_value al rilascio;
   *  toggle: inverte il valore corrente; set/reset: scrive true/false;
   *  increment/decrement: corrente ± step, clampato a min/max. */
  button_mode?: "write" | "momentary" | "toggle" | "set" | "reset" | "increment" | "decrement";
  /** Valore scritto al rilascio in modalità momentary (default false). */
  release_value?: string | number | boolean;
  /** Chiedi conferma prima di ogni scrittura da questo oggetto (F3.2). */
  require_confirm?: boolean;
  /** Messaggio della conferma (localizzabile, {{token}} ok). */
  confirm_message?: string;
  /** Ruolo minimo per OPERARE l'oggetto (F3.1). Sotto soglia: vedi
   *  min_role_effect. Assente = nessun vincolo (retro-compatibile). */
  min_role?: "Viewer" | "Operator" | "Supervisor" | "Admin";
  /** Effetto sotto soglia: "disable" (visibile ma non operabile, attenuato,
   *  default) oppure "hide" (l'oggetto sparisce del tutto). */
  min_role_effect?: "hide" | "disable";
  /** Comando critico (F3.3): prima di scrivere richiede la password della
   *  sessione (re-auth) — saltato in no-auth mode, dove non esistono password. */
  critical?: boolean;
  /** Comando critico: motivo obbligatorio, registrato nell'audit log. */
  require_reason?: boolean;
  /** Slider (F3.6): scrivi solo al rilascio (default true — prima scriveva
   *  a ogni pixel di trascinamento). */
  write_on_release?: boolean;
  /** Slider: variazione minima rispetto all'ultimo valore scritto perché
   *  parta una nuova scrittura. */
  write_deadband?: number;
  // Alarm / warning thresholds
  warn_low?: number;
  warn_high?: number;
  alarm_low?: number;
  alarm_high?: number;
  // LED indicator
  on_value?: string | number | boolean;
  on_color?: string;
  off_color?: string;
  // Shared display flags
  show_value?: boolean;
  read_only?: boolean;
  orientation?: "horizontal" | "vertical";
  // Checkbox
  checked_value?: string | number | boolean;
  unchecked_value?: string | number | boolean;
  // Radio options
  options?: RadioOption[];
  // Data table rows
  table_rows?: TableRow[];
  // Trend chart
  /** Seconds of history to render in the window. */
  window_s?: number;
  /** Y-axis auto-fit when omitted; otherwise hard min/max. */
  y_min?: number;
  y_max?: number;
  line_color?: string;
  /** Additional tags to overlay on the same trend (multi-series). */
  /** Tracce del trend (formato nuovo, vedi TrendTrace). */
  trend_tags?: TrendTrace[];
  /** LEGACY: tracce 2+ del trend — migrato in trend_tags al load. */
  extra_tags?: string[];
  /** When true, backfills from the OPC-UA server's historian on mount. */
  opcua_backfill?: boolean;
  /** Per-trace style (width/dash/fill/smooth), parallel to [tag, ...extra_tags].
   *  `line_color` above remains the legacy fallback for index 0's color. */
  trend_series_styles?: TrendSeriesStyle[];
  /** Seconds moved per ◀/▶ pan click on the compact widget. Defaults to 25%
   *  of window_s when unset. Not used by the "Espandi" modal (its own pan). */
  pan_step_s?: number;
  // ── Trend date/time format (axis labels + hover tooltip) ──────────────────
  /** Field order for the date portion. "ymd" only shows a year when
   *  `trend_dt_show_year` is also true — otherwise it degrades to "mdy".
   *  Default "dmy". */
  trend_dt_date_order?: "dmy" | "mdy" | "ymd";
  /** Default "/". */
  trend_dt_separator?: "-" | "/" | ".";
  /** Default "24h". */
  trend_dt_time_format?: "24h" | "12h";
  /** Default false. Applies uniformly to axis ticks and the hover tooltip. */
  trend_dt_show_seconds?: boolean;
  /** Default false (matches the original compact day/month-only format). */
  trend_dt_show_year?: boolean;
  /** Stack date above time on two lines instead of one. Default true. */
  trend_dt_two_lines?: boolean;
  /** Force the date to always render, even when the visible span fits in a
   *  day. Default false = keep the existing ">24h" heuristic. */
  trend_dt_always_show_date?: boolean;
  /** Draw dashed horizontal lines at warn_low/warn_high (amber) and
   *  alarm_low/alarm_high (red) on the shared Y scale — same pattern as
   *  bar_show_thresholds on the bar chart. Thresholds refer to the shared
   *  axis, so nothing is drawn when every trace uses its own scale. */
  trend_show_thresholds?: boolean;
  /** Draw a vertical marker on the timeline at each alarm activation that
   *  falls inside the visible window (from the alarm-events journal). */
  trend_show_alarm_markers?: boolean;
  // ── XY plot (live point + trail, not a time series) ───────────────────────
  /** Y-axis tag. `tag` (generic) is the X-axis. Distinct role from `extra_tags`,
   *  which overlays series on the same axis rather than pairing a second axis. */
  y_tag?: string;
  /** How long a sample stays in the trail before expiring, in seconds. */
  xy_trail_s?: number;
  /** Axis range; autofit from observed samples when omitted (all four independent
   *  since X and Y need separate ranges, unlike the single y_min/y_max on trend). */
  xy_x_min?: number;
  xy_x_max?: number;
  xy_y_min?: number;
  xy_y_max?: number;
  // ── Layer / visibility (cross-cutting) ────────────────────────────────
  /** Render order. Higher draws on top. Default 0; ties broken by array order. */
  z_index?: number;
  /** Static visibility flag (default true). Overridden by `visible_tag` when set. */
  visible?: boolean;
  /** Tag id whose truthy value controls visibility. Non-zero / non-empty / true → visible. */
  visible_tag?: string;
  // ── Event handlers (Python functions via POST /api/script/run/:name) ──
  /** Name of a project-level FunctionDef to invoke on mousedown in runtime mode. */
  on_press_fn?: string;
  /** Name of a project-level FunctionDef to invoke on mouseup in runtime mode. */
  on_release_fn?: string;
  /** Per-binding overrides for the on_press function's parameter values. */
  on_press_args?: Record<string, string | number | boolean>;
  /** Per-binding overrides for the on_release function's parameter values. */
  on_release_args?: Record<string, string | number | boolean>;
  /** Built-in runtime action triggered on click (takes precedence over on_press_fn
   *  when `type` is "login" or "logout"; combined with on_press_fn for "navigate"). */
  button_action?: ButtonAction;
  // ── Built-in SCADA symbol (type === "symbol") ─────────────────────────
  /** Which symbol from the built-in library this object renders. */
  symbol_id?: SymbolId;
  /** Override the "off" / "idle" state colour. */
  state_off_color?: string;
  /** Override the "on" / "running" state colour. */
  state_on_color?: string;
  /** Override the alarm state colour. */
  state_alarm_color?: string;
  /** Tag id whose truthy value flips off→on. Falsy/missing → off. */
  state_tag?: string;
  /** Tag id whose truthy value forces the alarm style (overrides state_tag). */
  alarm_tag?: string;
  /** Rotation in degrees, applied around the bounding-box centre. */
  rotation?: number;
  /** Mirror along the vertical axis (left↔right). */
  flip_h?: boolean;
  /** Mirror along the horizontal axis (top↔bottom). */
  flip_v?: boolean;
  /** Opacity 0..1, default 1. Applies to all visual types. */
  opacity?: number;
  /** Optional CSS transition duration in ms for CSS-animatable bound props
   *  (fill, stroke, opacity, transform). 0 or undefined → no animation. */
  transition_duration_ms?: number;
  /** Generic prop-to-tag bindings. At render time the resolver overrides the
   *  static value with the live tag value. Keys are SynopticObject prop names.
   *  F2: il valore è la forma storica (stringa = tag id, copia 1:1) oppure un
   *  BindingSpec con scaling lineare o espressione. */
  bindings?: Record<string, string | BindingSpec>;
  // ── F4: allarmi e qualità per-oggetto (opt-in) ────────────────────────────
  /** Lampeggio (F4.1): "always" = fisso, "tag" = quando blink_tag è truthy,
   *  "alarm" = quando il tag dell'oggetto ha un allarme attivo non riconosciuto. */
  blink_mode?: "always" | "tag" | "alarm";
  blink_tag?: string;
  /** Periodo del lampeggio in ms (default 800). */
  blink_rate_ms?: number;
  /** Bordo colorato per severità quando il tag dell'oggetto ha un allarme
   *  attivo (F4.2); lampeggia finché non riconosciuto. Opt-in. */
  show_alarm_state?: boolean;
  /** Stile per valore Bad (F4.3): "gray" = oggetto attenuato in scala di
   *  grigi — Bad non viene più mostrato come se fosse un valore valido. */
  bad_value_style?: "gray";
  /** Dato stale (F4.3): se l'ultimo aggiornamento del tag è più vecchio di
   *  N secondi l'oggetto è attenuato e marcato ⌛. */
  stale_after_s?: number;
  // ── Quality dot ───────────────────────────────────────────────────────────
  /** Show the quality-state dot overlay on tagged objects (default true). */
  quality_dot?: boolean;
  /** Override dot colour for the Good quality state (default #22c55e). */
  quality_dot_good_color?: string;
  /** Override dot colour for the Bad quality state (default #ef4444). */
  quality_dot_bad_color?: string;
  /** Override dot colour for the Uncertain quality state (default #eab308). */
  quality_dot_uncertain_color?: string;
  // ── Grid layout object (type === "grid") ──────────────────────────────
  grid_rows?: number;
  grid_cols?: number;
  /** Per-column widths in px. If shorter than grid_cols, remaining columns share the leftover equally. */
  col_widths?: number[];
  /** Per-row heights in px. If shorter than grid_rows, remaining rows share the leftover equally. */
  row_heights?: number[];
  grid_cells?: GridCell[];
  /** Show cell borders (default true). False = invisible grid at runtime. */
  grid_show_borders?: boolean;
  grid_border_color?: string;
  /** When true the object cannot be selected or moved in the editor. */
  locked?: boolean;
  /** Optional group this object belongs to (id from SynopticPage.groups). */
  group_id?: string;
  // ── Pipe / connector (type === "pipe") ───────────────────────────────
  /** Ordered array of waypoints (min 2). First/last overridden by from/to anchors at render time. */
  points?: PipePoint[];
  /** How segments between waypoints are routed. Default "straight". */
  routing?: "straight" | "orthogonal" | "diagonal" | "bezier";
  /** Visual style. Default "flat". */
  pipe_style?: "flat" | "tube" | "wire";
  /** Enable 3D-gradient fill (auto-enabled for "tube" style). */
  pipe_gradient?: boolean;
  /** Highlight colour for the tube gradient (default: lightened stroke). */
  gradient_light_color?: string;
  /** Shadow colour for the tube gradient (default: darkened stroke). */
  gradient_dark_color?: string;
  /** Static fill level 0.0…1.0 (0=empty, 1=full). */
  fill_level?: number;
  /** Tag whose numeric value drives the fill level. Overrides fill_level. */
  fill_level_tag?: string;
  /** How to interpret the fill tag value. Default "0-100". */
  fill_level_scale?: "0-1" | "0-100";
  /** Colour of the fluid fill overlay. Default "#3b82f6". */
  fill_color?: string;
  /** Which end the fluid rises from. Default "start-to-end". */
  fill_direction?: "start-to-end" | "end-to-start";
  /** Marker shape at the first waypoint. Default "none". */
  start_marker?: "none" | "arrow" | "dot" | "flange";
  /** Marker shape at the last waypoint. Default "none". */
  end_marker?: "none" | "arrow" | "dot" | "flange";
  /** Marker size multiplier. Default 1.0. */
  marker_size?: number;
  /** Static label shown at the midpoint of the pipe. */
  pipe_label?: string;
  /** Tag whose value is displayed as the pipe label (overrides pipe_label). */
  pipe_label_tag?: string;
  /** Format string for the pipe label tag value. Default "{value}". */
  pipe_label_format?: string;
  /** Perpendicular offset of the label from the midpoint (px). Default 10. */
  pipe_label_offset?: number;
  /** SVG stroke-dasharray value applied to the pipe body (e.g. "6,3" for dashes). */
  stroke_dasharray?: string;
  /** ID of the object the pipe starts from (its first waypoint follows the object). */
  from_obj_id?: string;
  /** Port on the source object to anchor to. Default "center". */
  from_port?: "top" | "bottom" | "left" | "right" | "center";
  /** ID of the object the pipe ends at (its last waypoint follows the object). */
  to_obj_id?: string;
  /** Port on the destination object to anchor to. Default "center". */
  to_port?: "top" | "bottom" | "left" | "right" | "center";
  // ── Faceplate instance (type === "faceplate") ─────────────────────────
  /** ID of the FaceplateDef to instantiate. */
  faceplate_id?: string;
  /** Parameter values substituted into the faceplate template (e.g. {tag_prefix: "pump1"}). */
  faceplate_params?: Record<string, string>;
  /** F6.4: i figli scalano al box dell'istanza (viewBox virtuale dal bbox
   *  della definizione). Opt-in: default false = coordinate assolute storiche. */
  faceplate_scale?: boolean;
  /** F6.4: override per-istanza di proprietà dei figli, per id figlio
   *  (es. { "obj-3": { fill: "#f00" } }) — applicati DOPO la sostituzione
   *  parametri ("link spezzato" rispetto al template). */
  faceplate_overrides?: Record<string, Partial<SynopticObject>>;
  // ── Text List (type === "text_list") ──────────────────────────────────
  text_list_entries?: TextListEntry[];
  text_list_default?: string;
  text_list_default_color?: string;
  // ── Bar Chart (type === "bar_chart") ──────────────────────────────────
  bar_series?: BarChartSeries[];
  bar_orientation?: "vertical" | "horizontal";
  bar_show_values?: boolean;
  bar_show_labels?: boolean;
  bar_show_thresholds?: boolean;
  bar_gap?: number;
  bar_y_label?: string;
  // ── Pie / Donut Chart (type === "pie_chart") ──────────────────────────
  pie_slices?: PieSlice[];
  pie_mode?: "pie" | "donut";
  pie_inner_ratio?: number;
  pie_show_labels?: boolean;
  pie_center_text?: string;
  pie_center_tag?: string;
  pie_center_format?: string;
  pie_show_legend?: boolean;
  // ── Sparkline (type === "sparkline") ──────────────────────────────────
  spark_window_s?: number;
  spark_color?: string;
  spark_fill?: boolean;
  spark_fill_opacity?: number;
  spark_show_last?: boolean;
  spark_stroke_width?: number;
  // ── Alarm Viewer (type === "alarm_viewer") ────────────────────────────
  alarm_viewer_max_rows?: number;
  alarm_viewer_severities?: AlarmSeverity[];
  alarm_viewer_id_prefix?: string;
  alarm_viewer_show_ack?: boolean;
  alarm_viewer_show_ts?: boolean;
  alarm_viewer_show_empty?: boolean;
  alarm_viewer_mode?: "list" | "banner" | "table";
  alarm_viewer_bg_color?: string;
  // ── Alarm Bell (type === "alarm_bell") ────────────────────────────────
  alarm_bell_id_prefix?: string;
  alarm_bell_severities?: AlarmSeverity[];
  alarm_bell_show_history?: boolean;
  alarm_bell_show_shelve?: boolean;
  // ── Alarm Banner (type === "alarm_banner") ────────────────────────────
  alarm_banner_id_prefix?: string;
  alarm_banner_severities?: AlarmSeverity[];
  // ── Recipe Panel (type === "recipe_panel") ─────────────────────────────
  /** Only show recipes whose id starts with this prefix. Unset/empty = all. */
  recipe_panel_id_prefix?: string;
}

// ── Faceplate definitions ─────────────────────────────────────────────────────

/** A reusable parametric component. `objects` may contain `{param}` placeholders
 *  in tag/label/text fields which are replaced at render-time per instance. */
/** Parametro tipizzato di un faceplate (F6.2). La forma storica (stringa
 *  nuda = solo nome) resta valida. */
export interface FaceplateParamDef {
  name: string;
  /** Guida la UI dell'istanza: TagInput, colore, numero o testo libero. */
  type?: "tag" | "string" | "number" | "color";
  default?: string;
  required?: boolean;
}

export interface FaceplateDef {
  id: string;
  label: string;
  /** Names of parameters the faceplate accepts (e.g. ["tag_prefix", "label"]). */
  params: (string | FaceplateParamDef)[];
  /** Template objects. Position is relative to the faceplate origin (0,0). */
  objects: SynopticObject[];
}

// ── Historian sample (wire shape from GET /api/history/:tag) ──────────────

export interface Sample {
  ts_ms: number;
  value: number | string | boolean;
  quality: TagQuality;
}

/** Bucket aggregato dello storico (F5.1). `ts_ms` è l'inizio del bucket. */
export interface BucketSample {
  ts_ms: number;
  min: number;
  max: number;
  avg: number;
  first: number;
  last: number;
  count: number;
}

/** A logical grouping of objects in the editor panel (UI-only, no canvas effect). */
export interface ObjectGroup {
  id: string;
  name: string;
}

export interface SynopticPage {
  id: string;
  name: string;
  objects: SynopticObject[];
  background?: string;
  /** Background used when the active theme is dark. Falls back to `background`
   *  when unset, so pages saved before this field existed render unchanged. */
  background_dark?: string;
  /** Canvas design width in px. Undefined = fluid (fills the container). */
  width?: number;
  /** Canvas design height in px. Undefined = fluid (fills the container). */
  height?: number;
  /** Editor-panel groups (logical containers). No canvas rendering effect. */
  groups?: ObjectGroup[];
  /** When true, this page is skipped by the auto-rotate (kiosk) cycle. */
  auto_rotate_skip?: boolean;
  /** Zone restriction: if set, only users whose allowed_zones intersects this list can view the page. */
  zones?: string[];
  /** When true, the page is read-only in the editor (no object/property edits). */
  locked?: boolean;
}

export interface Project {
  name: string;
  version: string;
}

export interface CustomSymbolAttribution {
  author: string;
  source: string;
  license: string;
}

export interface CustomSymbol {
  /** F6.9 — simbolo multi-stato: markup SVG inline (in alternativa a `url`).
   *  Gli elementi i cui id sono in `colorable_ids` vengono ricolorati con il
   *  colore dello stato corrente (off/on/alarm o symbol_states). */
  svg?: string;
  colorable_ids?: string[];
  id: string;
  label: string;
  url: string;
  attribution: CustomSymbolAttribution;
}

// ── Project tree types (from GET /api/project) ────────────────────────────

export type TagDataType = "bool" | "int" | "float" | "string";

/** Binding avanzato di una proprietà (F2, piano SCADA-widgets).
 *  Due modalità mutuamente esclusive:
 *  - `tag` (+ scaling lineare opzionale in_min/in_max → out_min/out_max);
 *  - `expr` — espressione valutata client-side (vedi expr/engine.ts), con
 *    riferimenti `{tag.id}`, aritmetica, confronti, ternario, funzioni. */
export interface BindingSpec {
  tag?: string;
  in_min?: number;
  in_max?: number;
  out_min?: number;
  out_max?: number;
  /** Clampa il risultato dello scaling dentro out_min..out_max (default true). */
  clamp?: boolean;
  expr?: string;
}

export interface TagDef {
  id: string;
  description: string;
  /** Storage type. Optional in the wire format; defaults to "float" server-side. */
  data_type?: TagDataType;
  /** When true, samples are persisted to `datastore_id` (or the default datastore). */
  history?: boolean;
  /** Which datastore (by DatastoreConfig.id) stores this tag's history. */
  datastore_id?: string;
  /** Deadband: minimum change in value to trigger a new record. */
  history_deadband?: number;
  /** Minimum ms between two recorded samples. */
  history_min_interval_ms?: number;
  /** Python expression evaluated against a `tags` dict snapshot.
   * Example: `tags["motor.v"] * tags["motor.i"]`.
   * When set, the tag is computed/read-only — it cannot be written via the API. */
  expression?: string;

  // ── F1, piano SCADA-widgets: il tag è la fonte di verità ──────────────────
  // I widget ereditano questi valori come default (override per-oggetto).
  /** Unità di misura ingegneristica (es. "°C"). Solo display. */
  unit?: string;
  /** Cifre decimali di default per la visualizzazione. */
  decimals?: number;
  /** Scaling lineare raw→eng, applicato dal runtime all'ingestione (plugin)
   *  e invertito sulle scritture. Servono tutti e quattro i campi. */
  raw_min?: number;
  raw_max?: number;
  eng_min?: number;
  eng_max?: number;
  /** Range di visualizzazione di default per i widget (gauge, barre…). */
  range_lo?: number;
  range_hi?: number;
  /** Ruolo minimo per scrivere questo tag via API/WS (F3.1) — enforcement
   *  server. Assente = regola storica (Operator+). */
  write_min_role?: "Viewer" | "Operator" | "Supervisor" | "Admin";
  /** Limiti ingegneristici → default delle soglie visive dei widget. */
  limit_lo_lo?: number;
  limit_lo?: number;
  limit_hi?: number;
  limit_hi_hi?: number;
}

export interface RegisterMapping {
  tag: string;
  address: number;
  scale: number;
}

export interface ModbusTcpSource {
  kind: "modbus_tcp";
  id: string;
  host: string;
  port: number;
  unit_id: number;
  poll_interval_ms: number;
  registers: RegisterMapping[];
}

export interface ModbusRtuSource {
  kind: "modbus_rtu";
  id: string;
  /** Serial device path, e.g. /dev/ttyS0 or /dev/ttyUSB0. */
  device: string;
  /** Baud rate, e.g. 9600, 19200, 115200. Default 9600. */
  baud_rate: number;
  /** Parity: "N" (none), "E" (even), "O" (odd). Default "N". */
  parity: string;
  /** Data bits: 7 or 8. Default 8. */
  data_bits: number;
  /** Stop bits: 1 or 2. Default 1. */
  stop_bits: number;
  unit_id: number;
  poll_interval_ms: number;
  registers: RegisterMapping[];
}

export interface TopicMapping {
  tag: string;
  topic: string;
  /** Optional dot-separated JSON path to extract a field from the payload. */
  json_path?: string;
  /** When set, a PUT /api/tags/:tag publishes the value to this topic (raw string payload). */
  publish_topic?: string;
  /** Per-mapping QoS override (0 / 1 / 2). Falls back to MqttSource.qos. */
  qos?: number;
}

export interface MqttTlsConfig {
  enabled: boolean;
  ca_cert_path?: string;
  /** Skip hostname/chain validation. Not implemented yet — UI shows a warning. */
  insecure_skip_verify?: boolean;
}

export interface MqttLastWill {
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
}

export interface SparkplugMetricMapping {
  metric_name: string;
  tag: string;
  writable: boolean;
}

export interface SparkplugConfig {
  group_id: string;
  host_id: string;
  metrics: SparkplugMetricMapping[];
}

export interface MqttSource {
  kind: "mqtt";
  id: string;
  host: string;
  port: number;
  client_id: string;
  topics: TopicMapping[];
  // ── Authentication ─────────────────────────────────────────────────
  username?: string;
  /** Server echoes "********" when a stored password is non-empty. Sending
   *  that exact string back means "leave unchanged"; an empty string clears it. */
  password?: string;
  /** Name of the env var the runtime reads at startup to resolve the password. */
  password_env?: string;
  // ── Connection tuning ──────────────────────────────────────────────
  keep_alive_secs?: number;
  clean_session?: boolean;
  /** Watchdog: if none of this source's tags update within this many seconds,
   *  the SourceSupervisor restarts it even if the connection never errored —
   *  catches a session that's technically alive but the broker has gone
   *  silent. Disabled (no watchdog) when unset. */
  max_silence_secs?: number;
  /** 0 / 1 / 2 — falls back to 0. */
  qos?: number;
  tls?: MqttTlsConfig;
  last_will?: MqttLastWill;
  /** Sparkplug B mode: when set, topics[] is ignored and payloads are protobuf. */
  sparkplug?: SparkplugConfig;
  /** When enabled, the runtime glues a per-instance random id to `client_id`
   *  (used as a prefix/suffix label) instead of using it literally — avoids
   *  collisions when the same project is opened from the IDE and/or
   *  deployed to several devices against the same broker. */
  random_client_id?: {
    enabled: boolean;
    position: "prefix" | "suffix";
  };
}

// ── OPC-UA client source (BL-005) ─────────────────────────────────────────

export interface OpcUaNodeMapping {
  tag: string;
  node_id: string;
  description?: string;
}

export type OpcUaAuth =
  | { kind: "anonymous" }
  | { kind: "username_password"; username: string; password?: string; password_env?: string };

export interface OpcUaSource {
  kind: "opcua_client";
  id: string;
  endpoint_url: string;
  security_policy: string;
  auth: OpcUaAuth;
  subscription_interval_ms: number;
  nodes: OpcUaNodeMapping[];
  /** When false, only certs in the per-source trust store are accepted. Default true. */
  trust_all_certs?: boolean;
}

/** One SWS tag exposed as an OPC-UA Variable node. */
export interface OpcUaServerNodeMapping {
  tag: string;
  /** OPC-UA string node id within the server namespace. Defaults to tag id. */
  node_id?: string;
}

/** OPC-UA server source — exposes SWS tags to OPC-UA clients. */
export interface OpcUaServerSource {
  kind: "opcua_server";
  id: string;
  /** TCP port. Default 4840. */
  port: number;
  /** Namespace URI, e.g. urn:soligolab:sws. */
  namespace_uri: string;
  nodes: OpcUaServerNodeMapping[];
}

export interface OpcUaCertEntry {
  filename: string;
  /** "trusted" | "rejected" */
  status: "trusted" | "rejected";
  size_bytes: number;
}

export interface OpcUaHistoricalSample {
  ts_ms: number;
  value: number;
  quality: "Good" | "Bad" | "Uncertain";
}

export interface OpcUaHistoryRequest {
  endpoint_url: string;
  source_id?: string;
  auth?: OpcUaAuth;
  security_policy?: string;
  node_id: string;
  from_ms?: number;
  to_ms?: number;
  /** Max data points from the server (capped at 2000). Default 500. */
  max_values?: number;
}

export interface OpcUaBrowsedNode {
  node_id: string;
  browse_name: string;
  display_name: string;
  /** "Object" | "Variable" | "Method" | ... — only Variable can become a tag. */
  node_class: string;
}

export interface OpcUaBrowseRequest {
  endpoint_url: string;
  source_id?: string;
  auth?: OpcUaAuth;
  parent_node_id?: string;
  /** "forward" (default) | "inverse" | "both". */
  direction?: "forward" | "inverse" | "both";
  security_policy?: string;
}

export interface OpcUaBrowseResponse {
  nodes: OpcUaBrowsedNode[];
}

export interface OpcUaEuromapVariable {
  spec: string; // "77" or "83"
  canonical_name: string;
  suggested_tag_suffix: string;
  description: string;
  node_id: string;
  browse_name: string;
  display_name: string;
}

export interface OpcUaEuromapDetection {
  nodes_scanned: number;
  truncated: boolean;
  variables: OpcUaEuromapVariable[];
}

export interface OpcUaDetectEuromapRequest {
  endpoint_url: string;
  source_id?: string;
  auth?: OpcUaAuth;
  security_policy?: string;
}

export interface EntityMapping {
  tag: string;
  entity_id: string;
  attribute?: string;
  write_domain?: string;
  write_service?: string;
}

export interface HomeAssistantSource {
  kind: 'homeassistant';
  id: string;
  url: string;
  token?: string;
  token_env?: string;
  entities: EntityMapping[];
}

// ── Siemens S7 source ──────────────────────────────────────────────────────

export type S7DataType = 'bool' | 'byte' | 'int' | 'word' | 'dint' | 'real';

export interface S7TagMapping {
  tag: string;
  area: 'db' | 'm' | 'i' | 'q';
  db_num: number;
  byte_offset: number;
  bit_offset: number;
  data_type: S7DataType;
  writable: boolean;
}

export interface S7Source {
  kind: 's7';
  id: string;
  ip: string;
  rack: number;
  slot: number;
  poll_interval_ms: number;
  tags: S7TagMapping[];
}

export type EnIpDataType = 'bool' | 'sint' | 'int' | 'dint' | 'lint' | 'real';

export interface EnIpTagMapping {
  tag: string;
  plc_tag: string;
  data_type: EnIpDataType;
  writable: boolean;
}

export interface EnIpSource {
  kind: 'en_ip';
  id: string;
  ip: string;
  slot: number;
  poll_interval_ms: number;
  tags: EnIpTagMapping[];
}

export type SourceDef = ModbusTcpSource | ModbusRtuSource | MqttSource | OpcUaSource | OpcUaServerSource | HomeAssistantSource | S7Source | EnIpSource;

// ── HomeAssistant entity browser ───────────────────────────────────────────

export interface HaBrowsedEntity {
  entity_id: string;
  state: string;
  friendly_name?: string;
  attributes: string[];
}

// ── MQTT broker browse ─────────────────────────────────────────────────────

export interface MqttBrowseRequest {
  host: string;
  port: number;
  source_id?: string;
  client_id: string;
  username?: string;
  password?: string;
  tls_enabled?: boolean;
  ca_cert_path?: string;
  /** Seconds to listen (1-15, default 8). */
  duration_secs?: number;
}

export interface BrowsedTopic {
  topic: string;
  sample_payload: string;
}

export interface MqttBrowseResponse {
  topics: BrowsedTopic[];
}

// ── Datastore types ───────────────────────────────────────────────────────

export interface SqliteBackendConfig {
  kind: "sqlite";
  path: string;
}

export interface PostgresBackendConfig {
  kind: "postgres";
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  ssl_mode: string;
  schema: string;
}

export interface OdbcBackendConfig {
  kind: "odbc";
  dsn?: string;
  connection_string?: string;
  table: string;
  col_tag: string;
  col_value: string;
  col_ts: string;
}

export type DatastoreBackendConfig =
  | SqliteBackendConfig
  | PostgresBackendConfig
  | OdbcBackendConfig;

export interface DatastoreConfig {
  id: string;
  label: string;
  backend: DatastoreBackendConfig;
  retention_rows?: number;
  retention_days?: number;
}

export interface DatastoreStats {
  kind: string;
  tag_count: number;
  sample_count: number;
  oldest_ms: number | null;
  newest_ms: number | null;
  size_bytes: number | null;
  connected: boolean;
  error: string | null;
}

export interface DatastoreListItem {
  id: string;
  connected: boolean;
  error: string | null;
}

export interface SmtpConfig {
  host: string;
  port?: number;
  from: string;
  username?: string;
  password?: string;
  starttls?: boolean;
}

export interface TelegramConfig {
  /** Bot token from BotFather. Masked ("********") on GET responses. */
  bot_token: string;
  /** Destination chat IDs (numeric or @channelusername). Messages go to all. */
  chat_ids: string[];
}

export interface NotificationConfig {
  smtp?: SmtpConfig;
  telegram?: TelegramConfig;
}

/** How synoptic pages are sized/scaled at runtime — project-wide setting. */
export type PageSizeMode = "fixed" | "ratio" | "fluid";

export interface PageLayoutConfig {
  size_mode: PageSizeMode;
  /** Aspect ratio label ("16:9" | "4:3" | "21:9" | "1:1" | "custom"). Only meaningful when size_mode === "ratio". */
  aspect_ratio?: string;
  /** Id of the page the viewer opens by default and the kiosk rotation restarts from. */
  home_page_id?: string;
  /** Viewer a schermo pieno: nasconde la barra di navigazione superiore e la
   *  fascia allarmi, così sul pannello viene renderizzata solo l'area della
   *  pagina. Gli allarmi attivi compaiono sovrapposti, senza rubare spazio.
   *  Non riguarda l'header dell'IDE. Con la barra nascosta la navigazione tra
   *  pagine passa dagli oggetti `navbutton` o dalla rotazione automatica. */
  hide_viewer_chrome?: boolean;
}

/** Motore di rendering a cui è destinato il progetto — vedi
 *  docs/adr/0002-lvgl-rendering-engine.md. `undefined` = "web" (default
 *  legacy, ogni progetto creato prima di questo campo). */
export type ProjectTargetKind = "web" | "lvgl_framebuffer" | "lvgl_wayland";

export interface ProjectTarget {
  kind: ProjectTargetKind;
  /** Solo per kind === "lvgl_framebuffer" (es. "/dev/fb0"). */
  framebuffer_device?: string;
}

export interface ProjectInfo {
  meta: { name: string; version: string };
  tags: TagDef[];
  sources: SourceDef[];
  alarms?: AlarmDef[];
  functions?: FunctionDef[];
  custom_symbols?: CustomSymbol[];
  datastores?: DatastoreConfig[];
  global_scripts?: GlobalScriptDef[];
  notifications?: NotificationConfig;
  languages?: LanguageTable;
  page_layout?: PageLayoutConfig;
  target?: ProjectTarget;
  /** Override per-progetto dell'intervallo di auto-backup (minuti). `undefined`
   *  = eredita il default di processo (`--auto-backup-interval-minutes`). */
  auto_backup_interval_minutes?: number;
  /** Override per-progetto di quanti auto-backup tenere. `undefined` = eredita
   *  il default di processo (`--auto-backup-retention`). */
  auto_backup_retention?: number;
}

// ── Project language table (T-40) ──────────────────────────────────────────
// Traduzioni dei messaggi che l'autore scrive negli oggetti. Il viewer risolve
// i riferimenti `{{token}}` nei campi testo secondo la lingua corrente.

/** Una voce: un token/chiave e le sue traduzioni per codice lingua. */
export interface LangEntry {
  key: string;
  /** codice lingua → testo tradotto */
  values: Record<string, string>;
}

export interface LanguageTable {
  /** Codice della lingua sorgente/predefinita (es. "it"). */
  default: string;
  /** Codici lingua presenti, in ordine (es. ["it","en","de"]). */
  langs: string[];
  entries: LangEntry[];
}

// ── Reusable Python functions ──────────────────────────────────────────────

/** One parameter on a `FunctionDef`. The `default` is whatever JSON the
 *  user authored; the server-side validator enforces a Python-identifier
 *  name and rejects keywords. */
export interface FunctionParam {
  name: string;
  default?: string | number | boolean;
}

/** A reusable Python function authored at the project level. Objects
 *  reference it by `name` in their on_press_fn / on_release_fn fields. */
export interface FunctionDef {
  /** Stable client-generated id (survives renames of `name`). */
  id: string;
  /** Display name — also the lookup key used by the run endpoint. */
  name: string;
  description?: string;
  /** Python source — capped at 64 KB by the server. */
  code: string;
  params: FunctionParam[];
}

// ── Alarm types ───────────────────────────────────────────────────────────

export type AlarmSeverity = "Info" | "Warning" | "Critical";

export type AlarmCondition =
  | { kind: "above"; threshold: number }
  | { kind: "below"; threshold: number }
  | { kind: "bool_equals"; value: boolean }
  | { kind: "bool_true" }
  | { kind: "bool_false" }
  | { kind: "and"; conditions: AlarmCondition[] }
  | { kind: "or";  conditions: AlarmCondition[] }
  | { kind: "not"; condition: AlarmCondition };

export interface AlarmDef {
  id: string;
  tag: string;
  condition: AlarmCondition;
  message: string;
  severity?: AlarmSeverity;
  notify_url?: string;
  dead_band?: number;
  /** Seconds condition must be continuously true before alarm activates. */
  on_delay_s?: number;
  /** Seconds condition must be continuously false before alarm clears. */
  off_delay_s?: number;
  /** Tag that suppresses this alarm when its value matches inhibit_condition. */
  inhibit_tag?: string;
  /** Condition on inhibit_tag that means "alarm is inhibited" (default: bool_true). */
  inhibit_condition?: AlarmCondition;
  /** Email recipients for alarm activation notification. */
  notify_email?: string[];
  /** Seconds after which an unacknowledged alarm triggers escalation email. */
  escalate_after_s?: number;
  /** Email recipients for escalation. */
  escalate_to?: string[];
  /**
   * Where this alarm's Telegram message goes. **Absent = "global"**: projects
   * written before this field existed notified every configured chat, and
   * treating absence as "off" would silently mute alarms already in service.
   */
  telegram_mode?: AlarmTelegramMode;
  /** Chats for `telegram_mode: "chats"`. Ignored in the other two modes. */
  telegram_chat_ids?: string[];
}

/** Per-alarm Telegram routing: configured chats / only its own / none. */
export type AlarmTelegramMode = "global" | "chats" | "off";

export interface RecipeSetpoint {
  tag: string;
  value: boolean | number | string;
}

export interface RecipeDef {
  id: string;
  name: string;
  setpoints: RecipeSetpoint[];
}

export interface RecipeSummary {
  id: string;
  name: string;
  setpoints_count: number;
}

export interface RecipeApplyResult {
  recipe_id: string;
  applied: number;
  total: number;
  errors: string[];
  applied_by: string;
  ts_ms: number;
}

export interface RecipeApplyEvent {
  recipe_id: string;
  recipe_name: string;
  ts_ms: number;
  applied_by: string;
  setpoints_count: number;
}

/** Aggregate statistics for a tag's historian samples. */
export interface HistoryStats {
  tag: string;
  count: number;
  min: number;
  max: number;
  avg: number;
  stddev: number;
  first_ts: number | null;
  last_ts: number | null;
}

export type IsaState =
  | "normal"
  | "active_unacked"
  | "active_acked"
  | "normal_unacked";

export interface AlarmState {
  def: AlarmDef;
  /** ISA-18.2 four-state value. */
  isa_state: IsaState;
  /** Convenience booleans derived from isa_state (backward-compat). */
  active: boolean;
  acknowledged: boolean;
  activated_at_ms: number | null;
  ack_at_ms: number | null;
  normalized_at_ms: number | null;
  last_value: number | string | boolean | null;
}

export interface AlarmEvent {
  alarm_id: string;
  alarm_message: string;
  severity: AlarmSeverity;
  ts_activated_ms: number;
  ts_acked_ms: number | null;
  ts_normalized_ms: number | null;
  duration_s: number | null;
  acked_by: string | null;
}

/** One entry of the append-only, hash-chained audit log (OPEN_QUESTIONS Q8). */
export interface AuditEntry {
  seq: number;
  ts_ms: number;
  actor: string | null;
  action: string;
  detail: unknown;
  prev_hash: string;
  hash: string;
  sig?: string | null;
}

export interface AuditVerifyReport {
  ok: boolean;
  entries: number;
  broken_at?: number | null;
  reason?: string | null;
}

export interface ShelvedAlarm {
  alarm_id: string;
  reason: string;
  /** Epoch-ms when shelving expires; 0 = indefinite. */
  until_ms: number;
  shelved_by: string;
  shelved_at_ms: number;
}

// ── Multi-project management ──────────────────────────────────────────────

export interface ProjectListEntry {
  name: string;
  has_project_yaml: boolean;
  last_modified_ms: number | null;
  /** Absolute path on the runtime's filesystem — may live outside the
   *  editor's default projects_root (custom parent_path chosen at creation). */
  path: string;
  /** Last create/open timestamp (registry-tracked); null for a legacy
   *  project never touched by the recent-projects registry yet. */
  last_opened_ms: number | null;
  /** True when the project's folder is NOT a direct child of projects_root
   *  — drives softer "remove from list" vs. destructive "delete" UI. */
  external: boolean;
}

export interface BrowseDirEntry {
  name: string;
  path: string;
}

export interface BrowseDirsResponse {
  path: string;
  parent: string | null;
  dirs: BrowseDirEntry[];
}

export interface TemplateEntry {
  id: string;
  label: string;
  description?: string;
}

// ── Runtime log stream (from GET /api/logs + WS /ws/logs) ─────────────────

export type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogEvent {
  ts_ms: number;
  level: LogLevel;
  target: string;
  message: string;
  /** Free-form structured fields the runtime emitter attached. */
  fields?: Record<string, string | number | boolean>;
}

export interface LogFileEntry {
  date: string;       // "YYYY-MM-DD"
  size_bytes: number;
}

// ── Global scripts (T-09) ─────────────────────────────────────────────────────

export type ScriptTriggerKind =
  | { kind: "startup" }
  | { kind: "interval"; interval_s: number }
  | { kind: "cron"; schedule: string }
  | { kind: "tag_change"; tag: string; edge: "rising" | "falling" | "any" };

export interface GlobalScriptDef {
  id: string;
  trigger: ScriptTriggerKind;
  code: string;
  enabled: boolean;
}

// ── GitOps (T-20) ─────────────────────────────────────────────────────────────

export interface GitStatus {
  sha: string;
  author: string;
  message: string;
  commit_date: string;
  branch: string;
  remote_url: string | null;
  clean: boolean;
  last_deploy_ms: number | null;
  unpushed_commits: number;
}

export interface ProjectFingerprint {
  sha256: string;
  computed_at_ms: number;
}

export interface SavedDevice {
  label: string;
  url: string;
  user: string;
  pass: string;
}

export interface PackageFile {
  name: string;
  size_bytes: number;
  mtime_ms: number;
}

/** Un'immagine container pronta in `dist/`. Dal 2026-07-30 la SPA sta dentro
 *  l'immagine, quindi non c'è più un secondo archivio da abbinare. */
export interface ContainerPackage {
  image_tarball: string;
  arch: string;
  version: string;
  size_bytes: number;
  mtime_ms: number;
}

export interface TextListEntry {
  value: number | string | boolean;
  label: string;
  color?: string;
  /** F6.6: l'entry attiva fa lampeggiare l'oggetto (usato dai symbol_states). */
  blink?: boolean;
  /** Optional validity range — when either bound is set, this entry matches
   *  by range (`value_min <= v < value_max`, half-open) instead of by exact
   *  `value`. Lets entries express buckets like "10-20 → marcia lenta"
   *  without breaking existing entries, which keep matching by exact value. */
  value_min?: number;
  value_max?: number;
}

export interface BarChartSeries {
  tag: string;
  label: string;
  /** Falls back to the shared trend PALETTE by index when omitted — same
   *  automatic color assignment the trend uses, so multi-widget pages stay
   *  consistent without hand-picking every color. */
  color?: string;
  min?: number;
  max?: number;
}

export interface PieSlice {
  tag: string;
  label: string;
  /** Falls back to the shared trend PALETTE by index when omitted. */
  color?: string;
}
