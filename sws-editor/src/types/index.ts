export type TagQuality = "Good" | "Bad" | "Uncertain";

export interface TagState {
  value: number | string | boolean;
  quality: TagQuality;
  timestamp_ms: number;
}

export type SynopticObjectType = "rect" | "text" | "image" | "button";

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
}

export interface SynopticPage {
  id: string;
  name: string;
  objects: SynopticObject[];
}

export interface Project {
  name: string;
  version: string;
}
