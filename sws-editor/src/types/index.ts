export type TagQuality = "good" | "bad" | "uncertain";

export interface TagValue {
  value: number | string | boolean;
  quality: TagQuality;
  timestampMs: number;
}

export type SynopticObjectType = "rect" | "text" | "image";

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
}

export interface Synoptic {
  name: string;
  objects: SynopticObject[];
}

export interface Project {
  name: string;
  version: string;
  synoptics: string[];
}
