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
  | "table";

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

export interface TagDef {
  id: string;
  description: string;
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

export type SourceDef = ModbusTcpSource;

export interface ProjectInfo {
  meta: { name: string; version: string };
  tags: TagDef[];
  sources: SourceDef[];
}
