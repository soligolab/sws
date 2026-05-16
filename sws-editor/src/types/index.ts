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
  // Displays
  | "gauge"
  | "led"
  | "progress_bar"
  | "table"
  | "trend"
  // SCADA symbols (pump/valve/motor/tank/fan from the built-in library)
  | "symbol"
  // Layout
  | "grid";

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
  // Line / stroke
  x2?: number;
  y2?: number;
  stroke?: string;
  stroke_width?: number;
  // Page navigation
  target_page?: string;
  // Numeric range (gauge, slider, progress_bar)
  min?: number;
  max?: number;
  unit?: string;
  step?: number;
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
  extra_tags?: string[];
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
   *  static value with the live tag value. Keys are SynopticObject prop names. */
  bindings?: Record<string, string>;
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
}

// ── Historian sample (wire shape from GET /api/history/:tag) ──────────────

export interface Sample {
  ts_ms: number;
  value: number | string | boolean;
  quality: TagQuality;
}

export interface SynopticPage {
  id: string;
  name: string;
  objects: SynopticObject[];
  background?: string;
  /** Canvas design width in px. Undefined = fluid (fills the container). */
  width?: number;
  /** Canvas design height in px. Undefined = fluid (fills the container). */
  height?: number;
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
  id: string;
  label: string;
  url: string;
  attribution: CustomSymbolAttribution;
}

// ── Project tree types (from GET /api/project) ────────────────────────────

export type TagDataType = "bool" | "int" | "float" | "string";

export interface TagDef {
  id: string;
  description: string;
  /** Storage type. Optional in the wire format; defaults to "float" server-side. */
  data_type?: TagDataType;
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
  /** 0 / 1 / 2 — falls back to 0. */
  qos?: number;
  tls?: MqttTlsConfig;
  last_will?: MqttLastWill;
}

export type SourceDef = ModbusTcpSource | MqttSource;

export interface ProjectInfo {
  meta: { name: string; version: string };
  tags: TagDef[];
  sources: SourceDef[];
  alarms?: AlarmDef[];
  functions?: FunctionDef[];
  custom_symbols?: CustomSymbol[];
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
  | { kind: "bool_equals"; value: boolean };

export interface AlarmDef {
  id: string;
  tag: string;
  condition: AlarmCondition;
  message: string;
  severity?: AlarmSeverity;
  /** Optional webhook URL. POSTed with AlarmWebhookPayload JSON when the alarm goes ACTIVE. */
  notify_url?: string;
}

export interface AlarmState {
  def: AlarmDef;
  active: boolean;
  acknowledged: boolean;
  activated_at_ms: number | null;
  ack_at_ms: number | null;
  last_value: number | string | boolean | null;
}

// ── Multi-project management ──────────────────────────────────────────────

export interface ProjectListEntry {
  name: string;
  has_project_yaml: boolean;
  last_modified_ms: number | null;
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
