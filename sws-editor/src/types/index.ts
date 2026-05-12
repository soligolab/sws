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
  | "trend";

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
  // ── Layer / visibility (cross-cutting) ────────────────────────────────
  /** Render order. Higher draws on top. Default 0; ties broken by array order. */
  z_index?: number;
  /** Static visibility flag (default true). Overridden by `visible_tag` when set. */
  visible?: boolean;
  /** Tag id whose truthy value controls visibility. Non-zero / non-empty / true → visible. */
  visible_tag?: string;
  // ── Event handlers (Python via POST /api/script/exec) ─────────────────
  /** Python code executed on mousedown in runtime mode. */
  on_press?: string;
  /** Python code executed on mouseup in runtime mode. */
  on_release?: string;
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
}

export interface Project {
  name: string;
  version: string;
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
}

export interface MqttSource {
  kind: "mqtt";
  id: string;
  host: string;
  port: number;
  client_id: string;
  topics: TopicMapping[];
}

export type SourceDef = ModbusTcpSource | MqttSource;

export interface ProjectInfo {
  meta: { name: string; version: string };
  tags: TagDef[];
  sources: SourceDef[];
  alarms?: AlarmDef[];
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
}

export interface AlarmState {
  def: AlarmDef;
  active: boolean;
  acknowledged: boolean;
  activated_at_ms: number | null;
  ack_at_ms: number | null;
  last_value: number | string | boolean | null;
}
