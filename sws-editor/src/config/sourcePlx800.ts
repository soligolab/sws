// The `plx800_io` source: which points the PLX800-IO module has, their type
// and unit, and which ones can be commanded. Mirror of `Plx800Point` in
// `sws-core/src/project.rs` and of `points.rs` in `sws-plugin-plx800`, from the
// public reference of the interface (`/home/ut1/Git/openplc/docs/interface/`).

import type { Plx800IoSource, Plx800Point, Plx800PointMapping, TagDataType, TagDef } from "@/types";
import { genId } from "@/id";

export type Plx800Group = "inputs" | "outputs" | "leds" | "pwm" | "power" | "diag" | "segment";

export interface Plx800PointDef {
  point: Plx800Point;
  group: Plx800Group;
  type: TagDataType;
  unit?: string;
  writable?: boolean;
}

const range = <T extends string>(prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}` as T);

export const PLX800_POINTS: Plx800PointDef[] = [
  ...range<Plx800Point>("in", 0, 7).map((point) => ({ point, group: "inputs" as const, type: "bool" as const })),
  ...range<Plx800Point>("dip", 1, 6).map((point) => ({ point, group: "inputs" as const, type: "bool" as const })),
  ...range<Plx800Point>("out", 0, 7).map((point) => ({ point, group: "outputs" as const, type: "bool" as const, writable: true })),
  ...(["led_run_red", "led_run_green", "led_error", "led_a1_red", "led_a1_green", "led_a2_red", "led_a2_green"] as Plx800Point[])
    .map((point) => ({ point, group: "leds" as const, type: "bool" as const, writable: true })),
  { point: "led_redundant_supply", group: "leds", type: "bool" },
  { point: "led_operative_state", group: "leds", type: "bool" },
  { point: "run_led_mode", group: "leds", type: "u16", writable: true },
  { point: "pwm_mask", group: "pwm", type: "u16", writable: true },
  { point: "pwm_freq_g0", group: "pwm", type: "u16", unit: "Hz", writable: true },
  { point: "pwm_freq_g1", group: "pwm", type: "u16", unit: "Hz", writable: true },
  ...range<Plx800Point>("pwm_duty_out", 0, 7).map((point) => ({ point, group: "pwm" as const, type: "u16" as const, unit: "‰", writable: true })),
  { point: "poe_en", group: "power", type: "bool", writable: true },
  { point: "vcap_mv", group: "power", type: "u16", unit: "mV" },
  { point: "vcap_switch_mv", group: "power", type: "u16", unit: "mV" },
  { point: "supply_cpu_mv", group: "power", type: "u16", unit: "mV" },
  { point: "supply_main_mv", group: "power", type: "u16", unit: "mV" },
  { point: "supply_sec_mv", group: "power", type: "u16", unit: "mV" },
  { point: "board_temp_c", group: "power", type: "f64", unit: "°C" },
  ...(["diag_rx_total", "diag_rx_ok", "diag_rx_err", "diag_tx_total", "diag_tx_ok", "diag_tx_err"] as Plx800Point[])
    .map((point) => ({ point, group: "diag" as const, type: "u32" as const })),
  { point: "fresh", group: "segment", type: "bool" },
  { point: "update_count", group: "segment", type: "u64" },
  { point: "fail_count", group: "segment", type: "u64" },
  { point: "writer_active", group: "segment", type: "bool" },
  { point: "foreign_writer", group: "segment", type: "bool" },
];

export const PLX800_GROUPS: Plx800Group[] = ["inputs", "outputs", "leds", "pwm", "power", "diag", "segment"];

export function plx800Point(p: Plx800Point): Plx800PointDef | undefined {
  return PLX800_POINTS.find((d) => d.point === p);
}

export function emptyPlx800Io(): Plx800IoSource {
  return { kind: "plx800_io", id: `io-${genId()}`, poll_interval_ms: 100, points: [] };
}

/** The tag a point gets by default: `<source>.<point>`. */
export function defaultTag(sourceId: string, p: Plx800Point): string {
  return `${sourceId}.${p}`;
}

/** The declaration of the tag of a point, with its type and unit. */
export function tagDefFor(tag: string, p: Plx800Point, description = ""): TagDef {
  const d = plx800Point(p);
  return { id: tag, description, data_type: d?.type ?? "f64", ...(d?.unit ? { unit: d.unit } : {}), history: false };
}

/** The mappings «Add all points» appends: the points not mapped yet, each on
 *  its default tag. */
export function missingPoints(source: Plx800IoSource): Plx800PointMapping[] {
  const have = new Set(source.points.map((m) => m.point));
  return PLX800_POINTS.filter((d) => !have.has(d.point)).map((d) => ({ tag: defaultTag(source.id, d.point), point: d.point }));
}

/** Mapped points that are writable while the source is read only: they will
 *  never be commanded. The card says so. */
export function writableWithoutWrites(source: Plx800IoSource): number {
  if (source.writes) return 0;
  return source.points.filter((m) => plx800Point(m.point)?.writable).length;
}

/** What `/api/plx800/status` and `/api/remote/plx800/status` answer. */
export interface Plx800Status {
  present: boolean;
  valid: boolean;
  error?: string;
  cycle_us: number;
  fresh: boolean;
  last_ok: boolean;
  update_count: number;
  fail_count: number;
  writer_lock_busy: boolean;
}
