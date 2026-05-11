export type TagQuality = "Good" | "Bad" | "Uncertain";

export interface TagState {
  value: number | string | boolean;
  quality: TagQuality;
  timestamp_ms: number;
}

export type SynopticObjectType =
  | "rect"
  | "text"
  | "image"
  | "button"
  | "line"
  | "ellipse"
  | "navbutton";

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
