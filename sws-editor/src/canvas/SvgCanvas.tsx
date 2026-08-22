import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PALETTE, TrendCanvas } from "@/canvas/TrendCanvas";
import { TrendExpandedModal } from "@/canvas/TrendExpanded";
import { XyPlotCanvas } from "@/canvas/XyPlotCanvas";
import { api, getAuthToken } from "@/api/client";
import { AlarmBellPanel } from "@/components/AlarmBellPanel";
import { NumericKeypad } from "@/components/NumericKeypad";
import { AlarmBanner } from "@/components/AlarmBanner";
import { RecipePanel } from "@/components/RecipePanel";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { SEV_COLOR } from "@/alarmSeverity";
import { genId } from "@/id";
import { useAppStore } from "@/store";
import { effectiveProjectLang, resolveMsg } from "@/i18n/projectI18n";
import { evalExpr } from "@/expr/engine";
import { SYMBOLS } from "@/symbols/library";
import { clampToPage } from "@/pageLayout";
import type { AlarmSeverity, AlarmState, CustomSymbol, FaceplateDef, FaceplateParamDef, GridCell, PageSizeMode, PipePoint, Sample, SynopticObject, TagDef, TagState, TextListEntry } from "@/types";

// ── Canvas props ──────────────────────────────────────────────────────────────

/**
 * Imperative handle for driving zoom/pan from outside the canvas (the editor
 * toolbar). Zoom/pan deliberately stay in local refs here rather than in the
 * store: pan writes at mousemove rate, and a store write per mousemove would
 * re-run every subscriber's selector across the whole app. The toolbar only
 * needs the zoom *factor*, which never changes during a pan.
 *
 * Rule of thumb for this component: discrete toggles → store; continuous view
 * transform → local ref + this handle.
 */
export interface CanvasViewApi {
  /** Zoom to an absolute factor, anchored at the centre of the viewport. */
  setZoom(z: number): void;
  /** Back to 100% at the pan origin. */
  resetView(): void;
  /** Fit the whole page into the viewport. Falls back to fitObjects() when
   *  the page has no declared size (fluid mode). */
  fitPage(): void;
  /** Fit the bounding box of the objects on the page. */
  fitObjects(): void;
}

interface SvgCanvasProps {
  objects: SynopticObject[];
  tagValues?: Record<string, TagState>;
  background?: string;
  selectedId?: string | null;
  /** Full multi-selection set. Falls back to `selectedId` when not provided. */
  selectedIds?: string[];
  gridSize?: number;
  snapEnabled?: boolean;
  /** Grid dot/line color. Editor-only setting (see the grid's visibility gate). */
  gridColor?: string;
  /** Custom symbols defined in the project (persisted in project.yaml). */
  customSymbols?: CustomSymbol[];
  /** Faceplate definitions for rendering faceplate instances. */
  faceplates?: FaceplateDef[];
  /** Page design width in px. Shows a dashed boundary rect in edit mode. */
  pageWidth?: number;
  /** Page design height in px. Shows a dashed boundary rect in edit mode. */
  pageHeight?: number;
  /** Project-wide page sizing mode — only affects viewer (!onMove) rendering:
   *  "fixed" = 1:1 no scaling; "ratio" = scale-to-fit preserving AR (letterbox,
   *  today's behavior); "fluid" = 100%/100%, no viewBox. Default "fixed". */
  sizeMode?: PageSizeMode;
  /** Current page id — keys persisted ruler guides in localStorage. */
  pageId?: string;
  /** Currently selected grid cell in edit mode. */
  selectedCell?: { objectId: string; row: number; col: number } | null;
  /** Currently selected child object within a grid cell. */
  selectedCellChild?: { objectId: string; row: number; col: number } | null;
  /** Currently selected rectangular range of grid cells (for merge). */
  selectedCellRange?: { objectId: string; r1: number; c1: number; r2: number; c2: number } | null;
  /** Currently selected slot inside a split (`cell.sub`) cell. */
  selectedSubCell?: { objectId: string; row: number; col: number; path: ("a" | "b")[] } | null;
  /** Single-select (replace) when shift is false; toggle into the set when true. */
  onSelect?: (id: string | null, shift?: boolean) => void;
  /** Called with the full set of ids enclosed by a drag-selection rectangle. */
  onSelectMany?: (ids: string[]) => void;
  onMove?: (id: string, patch: Partial<SynopticObject>) => void;
  onWriteTag?: (tagId: string, value: string | number | boolean) => void;
  /** View-mode dispatcher for on_press / on_release function bindings. */
  onScript?: (fn: string, args: Record<string, string | number | boolean>) => void;
  onNavigate?: (pageId: string) => void;
  /** View-mode dispatcher for built-in button_action (login / logout / navigate). */
  onButtonAction?: (action: import("@/types").ButtonAction) => void;
  onSelectCell?: (objectId: string, row: number, col: number) => void;
  onSelectCellChild?: (objectId: string, row: number, col: number) => void;
  /** Shift+click on a second cell of the same grid: form/extend a rect range. */
  onSelectCellRange?: (objectId: string, r1: number, c1: number, r2: number, c2: number) => void;
  /** Click on slot "a" or "b" inside a split cell. */
  onSelectSubCell?: (objectId: string, row: number, col: number, path: ("a" | "b")[]) => void;

  // ── Editor viewport control (edit mode only) ────────────────────────────
  /** Ref filled with the zoom/pan handle, for an external toolbar. */
  viewApi?: React.RefObject<CanvasViewApi | null>;
  /** Fired when the zoom factor changes — never during a pan. */
  onZoomChange?: (zoom: number) => void;
  /** Page size "Fit page" should target; null when undeterminable (fluid). */
  fitPageSize?: { width: number; height: number } | null;

  /** Viewer only, `sizeMode === "fixed"`: fattore di riduzione applicato alla
   *  pagina quando non entra nel contenitore. Lo calcola chi conosce lo spazio
   *  disponibile (RuntimeView), con cap a 1 — si rimpicciolisce, non si
   *  ingrandisce. Default 1 = comportamento 1:1 storico. */
  fitScale?: number;
}

interface DragState {
  objId: string;
  offsetX: number;
  offsetY: number;
  dx2?: number;
  dy2?: number;
  /** For pipe objects: initial waypoints captured at drag start so all points shift uniformly. */
  startPoints?: PipePoint[];
  /** Anchor object's own x/y at drag start — lets group-drag compute a
   *  stable delta (newX/newY minus these) instead of a cumulative one. */
  startX: number;
  startY: number;
  /** When the dragged object is part of a multi-selection: starting geometry
   *  of every OTHER selected object, so the same rigid delta applied to the
   *  anchor (after snapping/clamping) can be applied to the whole group. */
  groupStart?: { id: string; x: number; y: number; x2?: number; y2?: number; points?: PipePoint[] }[];
}

interface ResizeState {
  objId: string;
  /** Box handles: "tl"|"tc"|"tr"|"ml"|"mr"|"bl"|"bc"|"br"
   *  Line endpoint handles: "p1"|"p2" */
  handle: string;
  startX: number;
  startY: number;
  startObj: { x: number; y: number; width: number; height: number; x2?: number; y2?: number };
}

/** Active drag on an interior border of a `grid` object (between two
 *  columns or two rows). The user gets a single bracketed history entry
 *  per drag thanks to openInteraction/closeInteraction in startDrag. */
interface GridBorderResizeState {
  objId: string;
  axis: "col" | "row";
  /** Index of the border: between column `index-1` and `index` (col-axis)
   *  or between row `index-1` and `index` (row-axis). Valid 1..count-1. */
  index: number;
  /** Mouse clientX (col axis) or clientY (row axis) at startMouse. */
  startMouse: number;
  /** Pixel sizes of the two adjacent tracks at the start of the drag. */
  startA: number;
  startB: number;
  /** Snapshot of all column widths or row heights at start. */
  startSizes: number[];
}

/** Active drag on the internal border of a split (`cell.sub`) cell or
 *  any nested sub-cell. `path` addresses the SubGrid being resized: empty
 *  = the cell-level `sub`, `["a"]` = the SubGrid living inside slot a's
 *  `entry.sub`, and so on. */
interface SubBorderResizeState {
  objId: string;
  row: number;
  col: number;
  path: ("a" | "b")[];
  /** Orientation cached so handleMouseMove picks the right mouse axis
   *  without re-traversing the grid. */
  orientation: "rows" | "cols";
  startMouse: number;
  startRatio: number;
  /** Length (px) of the parent cell along the split axis at start. */
  cellPxSize: number;
}

/** Coordinates of an in-progress drag-selection rectangle (SVG space). */
interface SelRect {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

// ── SVG geometry helpers ──────────────────────────────────────────────────────

/** Convert polar angle (degrees from North/12-o'clock, clockwise) to Cartesian. */
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG arc path from startAngle to endAngle (clockwise, degrees from North). */
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  const sweep = ((endDeg - startDeg) + 360) % 360;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ── Pipe helpers ──────────────────────────────────────────────────────────────

function blendHex(hex: string, with2: string, t: number): string {
  try {
    const p = (h: string) => {
      const c = h.replace("#", "");
      return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
    };
    const [r1, g1, b1] = p(hex); const [r2, g2, b2] = p(with2);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  } catch { return hex; }
}
const lightenHex = (h: string) => blendHex(h, "#ffffff", 0.45);
const darkenHex  = (h: string) => blendHex(h, "#000000", 0.40);

function buildBezierPath(pts: PipePoint[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
    return `M ${pts[0].x} ${pts[0].y} Q ${mx} ${my} ${pts[1].x} ${pts[1].y}`;
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  const t = 0.35;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) * t;
    const cp1y = p1.y + (p2.y - p0.y) * t;
    const cp2x = p2.x - (p3.x - p1.x) * t;
    const cp2y = p2.y - (p3.y - p1.y) * t;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x} ${p2.y}`;
  }
  return d;
}

function buildPipeD(pts: PipePoint[], routing: string): string {
  if (pts.length < 2) return "";
  if (routing === "bezier") return buildBezierPath(pts);
  return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ");
}

function computeAnchor(obj: SynopticObject, port: string): PipePoint {
  const w = obj.type === "line" ? 0 : (obj.width ?? 80);
  const h = obj.type === "line" ? 0 : (obj.height ?? 80);
  switch (port) {
    case "top":    return { x: obj.x + w / 2, y: obj.y };
    case "bottom": return { x: obj.x + w / 2, y: obj.y + h };
    case "left":   return { x: obj.x,         y: obj.y + h / 2 };
    case "right":  return { x: obj.x + w,     y: obj.y + h / 2 };
    default:       return { x: obj.x + w / 2, y: obj.y + h / 2 };
  }
}

function resolveAnchoredPoints(pipe: SynopticObject, objects: SynopticObject[]): PipePoint[] {
  const pts = [...(pipe.points ?? [])];
  if (pipe.from_obj_id) {
    const src = objects.find((o) => o.id === pipe.from_obj_id);
    if (src) pts[0] = computeAnchor(src, pipe.from_port ?? "center");
  }
  if (pipe.to_obj_id && pts.length >= 2) {
    const dst = objects.find((o) => o.id === pipe.to_obj_id);
    if (dst) pts[pts.length - 1] = computeAnchor(dst, pipe.to_port ?? "center");
  }
  return pts;
}

// ── Quality helpers ───────────────────────────────────────────────────────────

/**
 * Stable sort by z_index (default 0). Objects with the same z keep their
 * original array order (later in the array → drawn on top within the tier).
 * SVG paints in document order, so the returned array matches "back-to-front".
 */
function sortByZ(objects: SynopticObject[]): SynopticObject[] {
  return objects
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      const za = a.o.z_index ?? 0;
      const zb = b.o.z_index ?? 0;
      if (za !== zb) return za - zb;
      return a.i - b.i;
    })
    .map((x) => x.o);
}

/**
 * Resolve runtime visibility for an object.
 * If `visible_tag` is bound and present in tagValues, its value drives the
 * decision (truthy → visible). Otherwise the static `visible` flag wins
 * (default true). Edit mode uses this only to dim hidden objects; runtime
 * mode skips them entirely.
 */
function isObjectVisible(obj: SynopticObject, tagValues: Record<string, TagState>): boolean {
  if (obj.visible_tag && tagValues[obj.visible_tag]) {
    const v = tagValues[obj.visible_tag].value;
    if (typeof v === "boolean") return v;
    if (typeof v === "number")  return v !== 0;
    if (typeof v === "string")  return v.trim().length > 0;
    return Boolean(v);
  }
  return obj.visible !== false;
}

function qualityColor(
  quality: TagState["quality"],
  goodColor?: string, badColor?: string, uncertainColor?: string,
): string {
  if (quality === "Good") return goodColor ?? "#22c55e";
  if (quality === "Bad")  return badColor  ?? "#ef4444";
  return uncertainColor ?? "#eab308";
}

/** Determine fill color based on value vs thresholds. Returns null to use default. */
function thresholdColor(
  value: number,
  alarmLow?: number, warnLow?: number, warnHigh?: number, alarmHigh?: number,
): string | null {
  if (alarmHigh !== undefined && value >= alarmHigh) return "#ef4444";
  if (alarmLow  !== undefined && value <= alarmLow)  return "#ef4444";
  if (warnHigh  !== undefined && value >= warnHigh)  return "#eab308";
  if (warnLow   !== undefined && value <= warnLow)   return "#eab308";
  return null;
}

/** Find the `text_list_entries` entry matching a live value — shared by
 *  `text_list` and `state_lamp`. An entry with either `value_min`/`value_max`
 *  set matches by range (half-open: `min <= v < max`, so adjacent buckets
 *  like [10,20) and [20,30) don't overlap); otherwise falls back to the
 *  original exact-value match, so existing saved entries keep working
 *  unchanged. First matching entry in array order wins. */
function matchTextListEntry(
  entries: TextListEntry[] | undefined,
  liveVal: unknown,
): TextListEntry | undefined {
  const v = typeof liveVal === "number" ? liveVal : Number(liveVal);
  return (entries ?? []).find((e) => {
    if (e.value_min !== undefined || e.value_max !== undefined) {
      if (!Number.isFinite(v)) return false;
      if (e.value_min !== undefined && v < e.value_min) return false;
      if (e.value_max !== undefined && v >= e.value_max) return false;
      return true;
    }
    return String(e.value) === String(liveVal);
  });
}

/** F1.3 — formattazione numerica strutturata. Specifiche supportate dentro
 *  `{value:…}` (sottoinsieme in stile Python, retro-compatibile):
 *    `{value:.2f}`  decimali fissi           → 1234.57
 *    `{value:,.1f}` migliaia (locale) + dec. → 1.234,6 / 1,234.6
 *    `{value:.2e}`  notazione esponenziale   → 1.23e+3
 *    `{value:.1%}`  percentuale (×100)       → 45.6%
 *  Qualsiasi testo attorno al segnaposto resta (es. "{value:.1f} °C"). */
function formatValue(value: number | string | boolean, format?: string): string {
  if (format && typeof value === "number") {
    const m = format.match(/\{value:(,)?\.(\d+)([fe%])\}/);
    if (m) {
      const [, thousands, dstr, kind] = m;
      const d = Number(dstr);
      const s =
        kind === "e" ? value.toExponential(d)
        : kind === "%" ? `${(value * 100).toFixed(d)}%`
        : thousands
          ? value.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
          : value.toFixed(d);
      return format.replace(/\{value:[^}]+\}/, s);
    }
  }
  return String(value);
}

// ── Binding resolver ─────────────────────────────────────────────────────────

/**
 * Returns a CSS `transition` style for the four CSS-animatable visual props
 * (fill / stroke / opacity / transform) when the object has a positive
 * `transition_duration_ms`. Returns undefined otherwise — the spread becomes
 * a no-op. Easing is fixed to `ease-out` (good for snap-to-target feel).
 */
function transitionStyle(obj: SynopticObject): React.CSSProperties | undefined {
  const ms = obj.transition_duration_ms;
  if (!ms || ms <= 0) return undefined;
  return {
    transition: `fill ${ms}ms ease-out, stroke ${ms}ms ease-out, opacity ${ms}ms ease-out, transform ${ms}ms ease-out`,
  };
}

/**
 * Applies `obj.bindings` overrides: for each entry whose tag has a live value,
 * replaces the corresponding top-level prop with the live value.
 * Boolean-typed props (visible, flip_h, flip_v) are coerced via truthy logic.
 * Returns the same object reference when there is nothing to resolve.
 */
/** F1.2: il tag è la fonte di verità — unità, range e limiti definiti sul
 *  TagDef diventano i default del widget; i campi impostati sull'oggetto
 *  restano override locali. Un solo punto d'innesto: tutti i branch di
 *  rendering continuano a leggere obj.unit/min/max/soglie come prima. */
function applyTagDefaults(obj: SynopticObject, def: TagDef | undefined): SynopticObject {
  if (!def) return obj;
  const merged = { ...obj };
  if (merged.unit === undefined && def.unit !== undefined) merged.unit = def.unit;
  if (merged.decimals === undefined && def.decimals !== undefined) merged.decimals = def.decimals;
  if (merged.min === undefined && def.range_lo !== undefined) merged.min = def.range_lo;
  if (merged.max === undefined && def.range_hi !== undefined) merged.max = def.range_hi;
  if (merged.warn_low === undefined && def.limit_lo !== undefined) merged.warn_low = def.limit_lo;
  if (merged.alarm_low === undefined && def.limit_lo_lo !== undefined) merged.alarm_low = def.limit_lo_lo;
  if (merged.warn_high === undefined && def.limit_hi !== undefined) merged.warn_high = def.limit_hi;
  if (merged.alarm_high === undefined && def.limit_hi_hi !== undefined) merged.alarm_high = def.limit_hi_hi;
  return merged;
}

/** F3.1 — ranking dei ruoli per il gating per-oggetto. Anonimo (null) sta
 *  sotto Viewer: in modalità no-auth whoami() restituisce un Admin sintetico,
 *  quindi null capita solo a un viewer anonimo con auth attiva. */
const ROLE_RANK: Record<string, number> = { Viewer: 0, Operator: 1, Supervisor: 2, Admin: 3 };
export function isRoleAllowed(minRole: string | undefined, role: string | null | undefined): boolean {
  if (!minRole) return true;
  const have = role ? (ROLE_RANK[role] ?? -1) : -1;
  return have >= (ROLE_RANK[minRole] ?? 0);
}

/** Tipi che disegnano già da soli il QDot dentro il proprio branch (default
 *  attivo per retro-compatibilità). Sugli ALTRI tipi il QDot è opt-in
 *  esplicito (quality_dot: true) e lo disegna il wrapper universale (F4.3). */
export const QDOT_BUILTIN_TYPES = new Set<string>([
  "rect", "ellipse", "pipe", "text", "state_lamp", "progress_bar", "gauge", "text_list", "kpi_tile",
]);

function resolveObject(obj: SynopticObject, tagValues: Record<string, TagState>): SynopticObject {
  if (!obj.bindings) return obj;
  const entries = Object.entries(obj.bindings);
  if (entries.length === 0) return obj;
  const BOOL_PROPS = new Set(["visible", "flip_h", "flip_v"]);
  const patch: Partial<SynopticObject> = {};
  for (const [prop, spec] of entries) {
    // F2: tre forme — stringa (tag 1:1, storica), {tag,+scaling}, {expr}.
    let v: unknown;
    if (typeof spec === "string") {
      const tv = tagValues[spec];
      if (!tv) continue;
      v = tv.value;
    } else if (spec.expr) {
      const r = evalExpr(spec.expr, tagValues);
      if (r === null) continue; // espressione rotta o tag mancanti: tieni lo statico
      v = r;
    } else if (spec.tag) {
      const tv = tagValues[spec.tag];
      if (!tv) continue;
      v = tv.value;
      if (typeof v === "number" &&
          spec.in_min !== undefined && spec.in_max !== undefined &&
          spec.out_min !== undefined && spec.out_max !== undefined &&
          spec.in_max !== spec.in_min) {
        let scaled = spec.out_min + (v - spec.in_min) * (spec.out_max - spec.out_min) / (spec.in_max - spec.in_min);
        if (spec.clamp !== false) {
          const lo = Math.min(spec.out_min, spec.out_max);
          const hi = Math.max(spec.out_min, spec.out_max);
          scaled = Math.min(Math.max(scaled, lo), hi);
        }
        v = scaled;
      }
    } else {
      continue;
    }
    if (BOOL_PROPS.has(prop)) {
      const b = typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : String(v).trim().length > 0;
      (patch as Record<string, unknown>)[prop] = b;
    } else {
      (patch as Record<string, unknown>)[prop] = v;
    }
  }
  return Object.keys(patch).length > 0 ? { ...obj, ...patch } : obj;
}

/**
 * Wraps `content` in a `<g>` with rotation/flip/opacity transforms when any
 * are significant. Returns `content` unwrapped when nothing to apply.
 * Center of rotation = bounding-box centre (obj.x + w/2, obj.y + h/2).
 */
function applyTransform(obj: SynopticObject, w: number, h: number, content: React.ReactNode): React.ReactNode {
  const rot     = obj.rotation ?? 0;
  const sx      = obj.flip_h   ? -1 : 1;
  const sy      = obj.flip_v   ? -1 : 1;
  const opacity = obj.opacity  ?? 1;
  const hasRotFlip = rot !== 0 || sx !== 1 || sy !== 1;
  const hasOpacity = opacity < 1;
  const txStyle    = transitionStyle(obj);
  // Wrap when there is geometry to apply OR when a transition is active —
  // the latter case ensures binding-driven rotation/opacity changes animate
  // smoothly even if the static values are defaults (rot=0, opacity=1).
  if (!hasRotFlip && !hasOpacity && !txStyle) return content;
  const cx = obj.x + w / 2;
  const cy = obj.y + h / 2;
  const transform = hasRotFlip
    ? `rotate(${rot} ${cx} ${cy}) translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`
    : undefined;
  return (
    <g transform={transform} opacity={hasOpacity ? opacity : undefined} style={txStyle}>
      {content}
    </g>
  );
}

// ── Quality dot overlay ───────────────────────────────────────────────────────

function QDot({ x, y, quality, goodColor, badColor, uncertainColor }: {
  x: number; y: number; quality: TagState["quality"];
  goodColor?: string; badColor?: string; uncertainColor?: string;
}) {
  return (
    <circle cx={x} cy={y} r={5}
      fill={qualityColor(quality, goodColor, badColor, uncertainColor)}
      style={{ pointerEvents: "none" }} />
  );
}

// ── SvgCanvas root ────────────────────────────────────────────────────────────

export function SvgCanvas({
  objects,
  tagValues = {},
  background = "#1a1a2e",
  selectedId,
  selectedIds,
  gridSize = 10,
  snapEnabled = true,
  gridColor = "#1e293b",
  customSymbols = [],
  faceplates = [],
  pageWidth,
  pageHeight,
  sizeMode = "fixed",
  pageId,
  selectedCell,
  selectedCellChild,
  selectedCellRange,
  selectedSubCell,
  onSelect,
  onSelectMany,
  onMove,
  onWriteTag,
  onScript,
  onNavigate,
  onButtonAction,
  onSelectCell,
  onSelectCellChild,
  onSelectCellRange,
  onSelectSubCell,
  viewApi,
  onZoomChange,
  fitPageSize = null,
  fitScale = 1,
}: SvgCanvasProps) {
  const { t } = useTranslation();
  // Resolved selection set: prefer the explicit array, fall back to the
  // legacy single-id prop, then to "nothing selected".
  const selIds = selectedIds ?? (selectedId ? [selectedId] : []);
  const selSet = new Set(selIds);

  // F3.1: ruolo dell'utente del viewer per il gating per-oggetto.
  const viewerRole = useAppStore((s) => s.authRole);
  // F4.2: indice tag→allarme attivo (severità, ack) dagli allarmi live.
  // Preferisce l'allarme non riconosciuto quando lo stesso tag ne ha più d'uno.
  const alarmsMapAll = useAppStore((s) => s.alarms);
  const alarmByTag = useMemo(() => {
    const m = new Map<string, { severity?: AlarmSeverity; acked: boolean }>();
    for (const a of Object.values(alarmsMapAll)) {
      if (!a.active || !a.def.tag) continue;
      const prev = m.get(a.def.tag);
      if (!prev || (prev.acked && !a.acknowledged)) {
        m.set(a.def.tag, { severity: a.def.severity, acked: a.acknowledged });
      }
    }
    return m;
  }, [alarmsMapAll]);
  // F4.3: orologio a 1 s SOLO se qualche oggetto dichiara stale_after_s —
  // un tag stale smette di aggiornarsi, quindi senza tick non ri-renderizza
  // mai e lo stale non verrebbe mai rilevato.
  const needsStaleTick = objects.some((o) => o.stale_after_s !== undefined);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!needsStaleTick) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [needsStaleTick]);
  // Bracketed-interaction helpers — coalesce drag/resize into a single
  // history entry per gesture rather than per pixel.
  const beginInteraction = useAppStore((s) => s.beginInteraction);
  const endInteraction = useAppStore((s) => s.endInteraction);
  const resizeSubBorderAction = useAppStore((s) => s.resizeSubBorder);
  // Tracks whether we actually opened an interaction this gesture, so
  // endDrag only closes one when one was opened.
  const interactionOpen = useRef(false);
  const openInteraction = (label: string) => {
    if (interactionOpen.current) return;
    beginInteraction(label);
    interactionOpen.current = true;
  };
  const closeInteraction = () => {
    if (!interactionOpen.current) return;
    endInteraction();
    interactionOpen.current = false;
  };

  // Object drag state
  const dragRef = useRef<DragState | null>(null);
  // Resize handle drag state
  const resizeRef = useRef<ResizeState | null>(null);
  // Grid interior-border resize state (drag between columns or between rows).
  const gridBorderRef = useRef<GridBorderResizeState | null>(null);
  // Sub-grid (split cell) interior border resize state.
  const subBorderRef = useRef<SubBorderResizeState | null>(null);

  // Selection-rectangle drag state. `selDragRef` tracks the active drag for
  // event handlers (always up-to-date); `selRect` drives the visual overlay.
  const selDragRef     = useRef<SelRect | null>(null);
  const [selRect, setSelRect] = useState<SelRect | null>(null);
  const [expandedTrendObj, setExpandedTrendObj] = useState<SynopticObject | null>(null);
  // Set to true when a rect-selection just completed so the SVG onClick
  // (which fires on every mouseup) does not deselect the result.
  const suppressClick  = useRef(false);

  // Zoom + pan (edit mode only). Use refs for event handler closures +
  // state for render. panDragRef: middle-click panning.
  const svgRef   = useRef<SVGSVGElement>(null);
  const zoomRef  = useRef(1);
  const panRef   = useRef({ x: 0, y: 0 });
  const [viewT, setViewT] = useState({ zoom: 1, panX: 0, panY: 0 });
  const panDragRef = useRef<{ startCX: number; startCY: number; startPX: number; startPY: number } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [snapLines, setSnapLines] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  // ── Rulers + guides ──
  // Guides are page-local px coordinates (SVG user space). Persisted in
  // localStorage keyed by pageId — not in project.yaml (deliberate: guides
  // are an editor convenience, not part of the published synoptic).
  // RULER_PX is the strip thickness (top + left). Stored as a constant so
  // hit-testing, render, and snap-delete zone all agree.
  const RULER_PX = 20;
  type Guide = { id: string; axis: "h" | "v"; pos: number };
  // In the store, not local state: the toolbar toggles the same flag as the
  // corner square below, and a discrete toggle is cheap to keep global.
  const showRulers   = useAppStore((s) => s.showRulers);
  const toggleRulers = useAppStore((s) => s.toggleRulers);
  const [guides, setGuides] = useState<Guide[]>([]);
  // Track which guide (if any) is being dragged. `pendingAxis` is set during
  // a brand-new drag from a ruler (no id yet); the guide is committed on
  // mouse-up.
  const guideDragRef = useRef<{ id: string | null; axis: "h" | "v"; startPos: number } | null>(null);
  const [draggingGuide, setDraggingGuide] = useState<{ axis: "h" | "v"; pos: number; deleting: boolean } | null>(null);

  // Load guides whenever the active page changes
  useEffect(() => {
    if (!pageId) { setGuides([]); return; }
    try {
      const raw = localStorage.getItem(`sws.canvas.guides.${pageId}`);
      setGuides(raw ? JSON.parse(raw) : []);
    } catch { setGuides([]); }
  }, [pageId]);

  // Persist on every change (debounce not needed — guides change at most
  // a few times per second during a drag, and localStorage writes are sync).
  const persistGuides = (next: Guide[]) => {
    setGuides(next);
    if (!pageId) return;
    try { localStorage.setItem(`sws.canvas.guides.${pageId}`, JSON.stringify(next)); }
    catch { /* quota — ignore */ }
  };

  // Single point where zoom/pan change. Reports the zoom factor upward only
  // when it actually changed, so a pan (which reuses the current z) never
  // re-renders the parent.
  const lastReportedZoom = useRef(1);
  const applyView = (z: number, px: number, py: number) => {
    zoomRef.current = z;
    panRef.current = { x: px, y: py };
    setViewT({ zoom: z, panX: px, panY: py });
    if (z !== lastReportedZoom.current) {
      lastReportedZoom.current = z;
      onZoomChange?.(z);
    }
  };

  /** Zoom to `newZ` keeping the point under (cx, cy) — element-relative screen
   *  px — fixed. Shared by the wheel gesture and the toolbar. */
  const zoomAt = (newZ: number, cx: number, cy: number) => {
    const oldZ = zoomRef.current;
    const z = Math.max(0.1, Math.min(8, newZ));
    const svgX = (cx - panRef.current.x) / oldZ;
    const svgY = (cy - panRef.current.y) / oldZ;
    applyView(z, cx - svgX * z, cy - svgY * z);
  };

  /** Toolbar/slider entry point: zoom about the centre of the drawing area. */
  const setZoomCentered = (z: number) => {
    const el = svgRef.current;
    if (!el) return;
    const rOff = showRulers ? RULER_PX : 0;
    zoomAt(z, (el.clientWidth + rOff) / 2, (el.clientHeight + rOff) / 2);
  };

  const fitObjects = () => {
    const el = svgRef.current;
    if (!el || objects.length === 0) { applyView(1, 0, 0); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of objects) {
      const bb = objBBox(o);
      minX = Math.min(minX, bb.x1); minY = Math.min(minY, bb.y1);
      maxX = Math.max(maxX, bb.x2); maxY = Math.max(maxY, bb.y2);
    }
    const W = maxX - minX; const H = maxY - minY;
    const cw = el.clientWidth; const ch = el.clientHeight;
    const z = Math.max(0.1, Math.min(4, Math.min(cw / (W + 80), ch / (H + 80))));
    applyView(z, (cw - W * z) / 2 - minX * z, (ch - H * z) / 2 - minY * z);
  };

  /** Fit the whole page — the "get me back to the whole drawing" affordance.
   *  Without a declared page size (fluid mode) there is nothing to fit, so
   *  fall back to the object bounding box. */
  const fitPage = () => {
    const el = svgRef.current;
    if (!el || !fitPageSize) { fitObjects(); return; }
    const { width: W, height: H } = fitPageSize;
    const rOff = showRulers ? RULER_PX : 0;
    const MARGIN = 24;                       // breathing room, screen px per side
    const cw = el.clientWidth, ch = el.clientHeight;
    const availW = Math.max(50, cw - rOff - 2 * MARGIN);
    const availH = Math.max(50, ch - rOff - 2 * MARGIN);
    const z = Math.max(0.1, Math.min(4, Math.min(availW / W, availH / H)));
    applyView(z, rOff + (cw - rOff - W * z) / 2, rOff + (ch - rOff - H * z) / 2);
  };

  // Ctrl+Shift+0 must fit the CURRENT page: the keydown handler below is
  // registered once, so it reaches fitPage through a ref instead of its
  // captured closure.
  const fitPageRef = useRef(fitPage);
  fitPageRef.current = fitPage;

  // No dependency array on purpose: fitPage must always see the current
  // `fitPageSize`, otherwise it keeps fitting the previous page after a
  // page switch.
  useImperativeHandle(viewApi, () => ({
    setZoom: setZoomCentered,
    resetView: () => applyView(1, 0, 0),
    fitPage,
    fitObjects,
  }));

  // Non-passive wheel listener for zoom + pan via scroll.
  // The handler closes over the first `zoomAt`/`fitPage`; that is fine (and
  // deliberate) because they only touch refs and the stable setViewT — don't
  // "fix" this by adding dependencies, it would re-register on every render.
  useEffect(() => {
    if (!onMove) return; // only in edit mode
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (e.ctrlKey) {
        // Zoom centred on cursor
        const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
        zoomAt(zoomRef.current * factor, cx, cy);
      } else {
        // Pan
        const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
        const dy = e.shiftKey ?  0        : -e.deltaY;
        applyView(zoomRef.current, panRef.current.x + dx, panRef.current.y + dy);
      }
    };
    const resetHandler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "0") { e.preventDefault(); fitPageRef.current(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "0") { e.preventDefault(); applyView(1, 0, 0); }
    };
    el.addEventListener("wheel", handler, { passive: false });
    window.addEventListener("keydown", resetHandler);
    return () => { el.removeEventListener("wheel", handler); window.removeEventListener("keydown", resetHandler); };
  }, [onMove]);

  /** Convert screen coordinates (relative to SVG element) to SVG user-space. */
  const toSvg = (screenX: number, screenY: number) => ({
    x: (screenX - panRef.current.x) / zoomRef.current,
    y: (screenY - panRef.current.y) / zoomRef.current,
  });

  const snap = (v: number) =>
    snapEnabled && gridSize > 0 ? Math.round(v / gridSize) * gridSize : v;

  /** Compute the bounding box of an object in SVG space.
   *  Lines use the min/max of their two endpoints; other types use x/y/w/h. */
  const objBBox = (obj: SynopticObject): { x1: number; y1: number; x2: number; y2: number } => {
    if (obj.type === "line") {
      const lx1 = Math.min(obj.x ?? 0, obj.x2 ?? obj.x ?? 0);
      const ly1 = Math.min(obj.y ?? 0, obj.y2 ?? obj.y ?? 0);
      const lx2 = Math.max(obj.x ?? 0, obj.x2 ?? obj.x ?? 0);
      const ly2 = Math.max(obj.y ?? 0, obj.y2 ?? obj.y ?? 0);
      return { x1: lx1, y1: ly1, x2: lx2, y2: ly2 };
    }
    if (obj.type === "pipe" && obj.points && obj.points.length >= 1) {
      const xs = obj.points.map((p) => p.x);
      const ys = obj.points.map((p) => p.y);
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    }
    const ox = obj.x ?? 0;
    const oy = obj.y ?? 0;
    return { x1: ox, y1: oy, x2: ox + (obj.width ?? 0), y2: oy + (obj.height ?? 0) };
  };

  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onMove) return;
    const svgRect = e.currentTarget.getBoundingClientRect();
    if (e.button === 1) {
      // Middle-click → start pan drag
      e.preventDefault();
      panDragRef.current = {
        startCX: e.clientX, startCY: e.clientY,
        startPX: panRef.current.x, startPY: panRef.current.y,
      };
      return;
    }
    if (e.button !== 0) return;
    // If an object drag is already active, ignore (startDrag sets dragRef first
    // because child handlers fire before parent handlers in React).
    if (dragRef.current) return;
    const pt = toSvg(e.clientX - svgRect.left, e.clientY - svgRect.top);
    selDragRef.current = { startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgRect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - svgRect.left;
    const screenY = e.clientY - svgRect.top;
    const pt = toSvg(screenX, screenY);

    if (panDragRef.current) {
      // Middle-click pan
      const pd = panDragRef.current;
      applyView(zoomRef.current,
        pd.startPX + (e.clientX - pd.startCX),
        pd.startPY + (e.clientY - pd.startCY));
      return;
    }

    // Guide drag — updates the visual immediately; commit on mouseup.
    // Dragging the cursor back over the originating ruler arms a delete:
    // the line turns red and is removed on release.
    if (guideDragRef.current && onMove) {
      const ref = guideDragRef.current;
      const pos = ref.axis === "v" ? pt.x : pt.y;
      const overRuler = ref.axis === "v" ? screenY < RULER_PX : screenX < RULER_PX;
      setDraggingGuide({ axis: ref.axis, pos, deleting: overRuler });
      return;
    }

    // Update mouse position display
    if (onMove) setMousePos(pt);

    const z = zoomRef.current;

    // Grid interior-border drag — adjust two adjacent track sizes while
    // keeping the sum constant. Snap to the other border positions in the
    // same grid so the user can easily re-align columns.
    if (gridBorderRef.current && onMove) {
      const ref = gridBorderRef.current;
      const grid = objects.find((o) => o.id === ref.objId);
      if (grid) {
        const deltaScreen = ref.axis === "col" ? (e.clientX - ref.startMouse) : (e.clientY - ref.startMouse);
        let delta = deltaScreen / z;
        let newA = ref.startA + delta;
        let newB = ref.startB - delta;
        const MIN = 8;
        if (newA < MIN) { delta = MIN - ref.startA; newA = MIN; newB = ref.startB - delta; }
        if (newB < MIN) { delta = ref.startB - MIN; newA = ref.startA + delta; newB = MIN; }

        // Snap candidates: cumulative positions of every other interior
        // border on the same axis. The moving border's reference position
        // is the sum of sizes[0..ref.index-1] (before this drag) plus the
        // new value of sizes[ref.index-1].
        const sizes = ref.startSizes.slice();
        let baseBefore = 0; // sum sizes[0..ref.index-1] before mutation
        for (let i = 0; i < ref.index - 1; i++) baseBefore += sizes[i];
        const draggedPos = baseBefore + newA;
        const otherBorders: number[] = [];
        let acc = 0;
        for (let i = 0; i < sizes.length - 1; i++) {
          acc += sizes[i];
          if (i + 1 !== ref.index) otherBorders.push(acc);
        }
        const threshold = 8 / z;
        let snapHit: number | null = null;
        for (const cand of otherBorders) {
          if (Math.abs(draggedPos - cand) < threshold) { snapHit = cand; break; }
        }
        if (snapHit !== null) {
          // Recompute newA so the dragged border lands exactly on the snap.
          const snappedA = snapHit - baseBefore;
          if (snappedA >= MIN && (ref.startA + ref.startB - snappedA) >= MIN) {
            newA = snappedA;
            newB = ref.startA + ref.startB - snappedA;
          }
        }

        sizes[ref.index - 1] = newA;
        sizes[ref.index] = newB;
        const patch: Partial<SynopticObject> = ref.axis === "col"
          ? { col_widths: sizes }
          : { row_heights: sizes };
        onMove(ref.objId, patch);

        // Snap line is in canvas coordinates: position relative to grid origin.
        if (snapHit !== null) {
          if (ref.axis === "col") setSnapLines({ x: (grid.x ?? 0) + snapHit, y: null });
          else                    setSnapLines({ x: null, y: (grid.y ?? 0) + snapHit });
        } else {
          setSnapLines({ x: null, y: null });
        }
      }
      return;
    }

    // Sub-grid (split cell) interior border drag — updates the ratio of
    // the SubGrid at `ref.path` inside the cell. Orientation was captured
    // at drag start, so we don't need to re-traverse here.
    if (subBorderRef.current) {
      const ref = subBorderRef.current;
      const screenDelta = ref.orientation === "rows"
        ? (e.clientY - ref.startMouse)
        : (e.clientX - ref.startMouse);
      const deltaFrac = (screenDelta / z) / ref.cellPxSize;
      const minFrac = 8 / ref.cellPxSize;
      const newRatio = clamp(ref.startRatio + deltaFrac, minFrac, 1 - minFrac);
      const pageId = useAppStore.getState().currentPageId;
      resizeSubBorderAction(pageId, ref.objId, ref.row, ref.col, ref.path, newRatio);
      return;
    }

    if (resizeRef.current && onMove) {
      // Resize / endpoint handle drag. dx/dy in screen pixels → divide by zoom.
      const { handle, startX, startY, startObj, objId } = resizeRef.current;
      const dx = (e.clientX - startX) / z;
      const dy = (e.clientY - startY) / z;
      if (handle === "p1") {
        onMove(objId, { x: snap(startObj.x + dx), y: snap(startObj.y + dy) });
      } else if (handle === "p2") {
        onMove(objId, { x2: snap((startObj.x2 ?? startObj.x + 100) + dx), y2: snap((startObj.y2 ?? startObj.y) + dy) });
      } else if (handle.startsWith("wp-")) {
        const wpIdx = parseInt(handle.slice(3));
        const pipeObj = objects.find((o) => o.id === objId);
        if (pipeObj?.points) {
          const newPoints = pipeObj.points.map((p, i) =>
            i === wpIdx ? { x: snap(startObj.x + dx), y: snap(startObj.y + dy) } : p
          );
          onMove(objId, { points: newPoints });
        }
      } else {
        let { x, y, width, height } = startObj;
        const isCorner = (handle === "tl" || handle === "tr" || handle === "bl" || handle === "br");
        // Shift + corner drag → preserve aspect ratio. We pick whichever axis
        // moved more (in width-equivalent units) as the driver and derive the
        // other axis from it. Mid-edge handles ignore Shift since only one
        // dimension is meaningful.
        if (e.shiftKey && isCorner && startObj.width > 0 && startObj.height > 0) {
          const aspect = startObj.width / startObj.height;
          const dxSigned = handle.includes("l") ? -dx : dx;   // outward = grow
          const dySigned = handle.includes("t") ? -dy : dy;
          // Convert dy to width-equivalent units so we can compare magnitudes.
          const dyAsW = dySigned * aspect;
          const dw = Math.abs(dxSigned) >= Math.abs(dyAsW) ? dxSigned : dyAsW;
          let newW = snap(startObj.width + dw);
          if (newW < 4) newW = 4;
          let newH = snap(newW / aspect);
          if (newH < 4) { newH = 4; newW = snap(newH * aspect); }
          width = newW;
          height = newH;
          // Anchor the opposite corner: "l" handles move x right by the width
          // delta; "t" handles move y down by the height delta.
          if (handle.includes("l")) x = startObj.x + (startObj.width - newW);
          if (handle.includes("t")) y = startObj.y + (startObj.height - newH);
        } else {
          if (handle.includes("l")) { x = snap(startObj.x + dx); width = snap(startObj.width - dx); }
          if (handle.includes("r")) { width = snap(startObj.width + dx); }
          if (handle.includes("t")) { y = snap(startObj.y + dy); height = snap(startObj.height - dy); }
          if (handle.includes("b")) { height = snap(startObj.height + dy); }
        }
        if (width >= 4 && height >= 4) {
          const clamped = clampToPage(x, y, width, height, pageWidth, pageHeight);
          onMove(objId, { x: clamped.x, y: clamped.y, width, height });
        }
      }
    } else if (dragRef.current && onMove) {
      // Object drag — coords in SVG space with edge snapping
      const rawX = pt.x - dragRef.current.offsetX;
      const rawY = pt.y - dragRef.current.offsetY;
      const draggedObj = objects.find((o) => o.id === dragRef.current!.objId);
      const dw = draggedObj?.width ?? 0;
      const dh = draggedObj?.height ?? 0;

      const threshold = 8 / z;
      let newX = rawX; let newY = rawY;
      let snapX: number | null = null; let snapY: number | null = null;

      // Helper: test a list of candidate edges against the three drag
      // anchor points (left/centre/right or top/middle/bottom).
      const trySnapX = (exs: number[]): { snap: number; out: number } | null => {
        for (const ex of exs) {
          if (Math.abs(rawX - ex) < threshold)           return { snap: ex, out: ex };
          if (Math.abs(rawX + dw / 2 - ex) < threshold) return { snap: ex, out: ex - dw / 2 };
          if (Math.abs(rawX + dw - ex) < threshold)     return { snap: ex, out: ex - dw };
        }
        return null;
      };
      const trySnapY = (eys: number[]): { snap: number; out: number } | null => {
        for (const ey of eys) {
          if (Math.abs(rawY - ey) < threshold)           return { snap: ey, out: ey };
          if (Math.abs(rawY + dh / 2 - ey) < threshold) return { snap: ey, out: ey - dh / 2 };
          if (Math.abs(rawY + dh - ey) < threshold)     return { snap: ey, out: ey - dh };
        }
        return null;
      };

      for (const other of objects) {
        if (other.id === dragRef.current.objId) continue;
        const bb = objBBox(other);
        if (snapX === null) {
          const hit = trySnapX([bb.x1, (bb.x1 + bb.x2) / 2, bb.x2]);
          if (hit) { snapX = hit.snap; newX = hit.out; }
        }
        if (snapY === null) {
          const hit = trySnapY([bb.y1, (bb.y1 + bb.y2) / 2, bb.y2]);
          if (hit) { snapY = hit.snap; newY = hit.out; }
        }
        if (snapX !== null && snapY !== null) break;
      }

      // Page-border snapping — fall back to the page's left/centre/right and
      // top/middle/bottom edges if no nearby object edge already caught
      // the drag. Same threshold; same anchor logic.
      if (pageWidth && pageWidth > 0 && snapX === null) {
        const hit = trySnapX([0, pageWidth / 2, pageWidth]);
        if (hit) { snapX = hit.snap; newX = hit.out; }
      }
      if (pageHeight && pageHeight > 0 && snapY === null) {
        const hit = trySnapY([0, pageHeight / 2, pageHeight]);
        if (hit) { snapY = hit.snap; newY = hit.out; }
      }
      // Ruler-guide snapping — pulls the drag onto any vertical guide (x) or
      // horizontal guide (y) within the same threshold band.
      if (snapX === null) {
        const xGuides = guides.filter((g) => g.axis === "v").map((g) => g.pos);
        if (xGuides.length > 0) {
          const hit = trySnapX(xGuides);
          if (hit) { snapX = hit.snap; newX = hit.out; }
        }
      }
      if (snapY === null) {
        const yGuides = guides.filter((g) => g.axis === "h").map((g) => g.pos);
        if (yGuides.length > 0) {
          const hit = trySnapY(yGuides);
          if (hit) { snapY = hit.snap; newY = hit.out; }
        }
      }

      if (snapX === null) newX = snap(rawX);
      if (snapY === null) newY = snap(rawY);
      setSnapLines({ x: snapX, y: snapY });

      // Hard-clamp to page bounds — skipped for lines (dx2/dy2) and
      // multi-waypoint shapes (points), whose bounding box isn't just x/y+w/h.
      if (dragRef.current.dx2 === undefined && !dragRef.current.startPoints) {
        const clamped = clampToPage(newX, newY, dw, dh, pageWidth, pageHeight);
        newX = clamped.x; newY = clamped.y;
      }

      const patch: Partial<SynopticObject> = { x: newX, y: newY };
      if (dragRef.current.dx2 !== undefined) {
        patch.x2 = newX + dragRef.current.dx2!;
        patch.y2 = newY + dragRef.current.dy2!;
      }
      if (dragRef.current.startPoints) {
        const sp = dragRef.current.startPoints;
        const dx = newX - sp[0].x;
        const dy = newY - sp[0].y;
        patch.points = sp.map((p) => ({ x: snap(p.x + dx), y: snap(p.y + dy) }));
        patch.x = patch.points[0].x;
        patch.y = patch.points[0].y;
      }
      onMove(dragRef.current.objId, patch);

      // Group drag: shift every other selected object by the same rigid
      // delta the anchor just moved by (post snapping/clamping), so the
      // whole selection moves together instead of only the object under
      // the cursor.
      if (dragRef.current.groupStart && dragRef.current.groupStart.length > 0) {
        const dx = newX - dragRef.current.startX;
        const dy = newY - dragRef.current.startY;
        for (const g of dragRef.current.groupStart) {
          const followerPatch: Partial<SynopticObject> = { x: g.x + dx, y: g.y + dy };
          if (g.x2 !== undefined) {
            followerPatch.x2 = g.x2 + dx;
            followerPatch.y2 = (g.y2 ?? 0) + dy;
          }
          if (g.points) {
            followerPatch.points = g.points.map((pp) => ({ x: pp.x + dx, y: pp.y + dy }));
          }
          onMove(g.id, followerPatch);
        }
      }
    } else if (selDragRef.current) {
      // Selection rect update — coords in SVG space
      const updated: SelRect = { ...selDragRef.current, curX: pt.x, curY: pt.y };
      selDragRef.current = updated;
      setSelRect(updated);
    }
  };

  const endDrag = () => {
    closeInteraction();
    dragRef.current = null;
    resizeRef.current = null;
    gridBorderRef.current = null;
    subBorderRef.current = null;
    panDragRef.current = null;
    setSnapLines({ x: null, y: null });

    // Commit guide drag: delete if the user released over the originating
    // ruler ("deleting" flag), otherwise persist the new position. Creating
    // a brand-new guide (no id yet) on top of the ruler simply discards it.
    if (guideDragRef.current && draggingGuide) {
      const ref = guideDragRef.current;
      if (draggingGuide.deleting) {
        if (ref.id) persistGuides(guides.filter((g) => g.id !== ref.id));
      } else if (ref.id) {
        persistGuides(guides.map((g) => g.id === ref.id ? { ...g, pos: Math.round(draggingGuide.pos) } : g));
      } else {
        const newGuide: Guide = {
          id: genId("g"),
          axis: ref.axis,
          pos: Math.round(draggingGuide.pos),
        };
        persistGuides([...guides, newGuide]);
      }
    }
    guideDragRef.current = null;
    setDraggingGuide(null);

    const rect = selDragRef.current;
    selDragRef.current = null;
    setSelRect(null);

    if (!rect || !onSelectMany) return;
    const dx = Math.abs(rect.curX - rect.startX);
    const dy = Math.abs(rect.curY - rect.startY);
    if (dx < 5 && dy < 5) return; // treat as click, let onClick handle it

    const x1 = Math.min(rect.startX, rect.curX);
    const y1 = Math.min(rect.startY, rect.curY);
    const x2 = Math.max(rect.startX, rect.curX);
    const y2 = Math.max(rect.startY, rect.curY);

    const ids = objects
      .filter((obj) => {
        const bb = objBBox(obj);
        // Intersection: rect overlaps bounding box (not just touch)
        return bb.x2 > x1 && bb.x1 < x2 && bb.y2 > y1 && bb.y1 < y2;
      })
      .map((o) => o.id);

    if (ids.length > 0) {
      suppressClick.current = true;
      onSelectMany(ids);
    }
  };

  const startDrag = (e: React.MouseEvent<SVGElement>, obj: SynopticObject) => {
    // Object drag wins: cancel any pending selection rect / pan.
    selDragRef.current = null;
    panDragRef.current = null;
    setSelRect(null);

    const svgEl = (e.currentTarget as SVGElement).ownerSVGElement!;
    const rect = svgEl.getBoundingClientRect();
    // Convert cursor to SVG space then compute offset from object origin.
    const pt = toSvg(e.clientX - rect.left, e.clientY - rect.top);
    const ds: DragState = {
      objId:   obj.id,
      offsetX: pt.x - (obj.x ?? 0),
      offsetY: pt.y - (obj.y ?? 0),
      startX:  obj.x ?? 0,
      startY:  obj.y ?? 0,
    };
    if (obj.type === "line") {
      ds.dx2 = (obj.x2 ?? obj.x + 100) - (obj.x ?? 0);
      ds.dy2 = (obj.y2 ?? obj.y ?? 0)  - (obj.y ?? 0);
    }
    if (obj.type === "pipe" && obj.points && obj.points.length >= 1) {
      ds.offsetX = pt.x - obj.points[0].x;
      ds.offsetY = pt.y - obj.points[0].y;
      ds.startPoints = obj.points.map((p) => ({ ...p }));
    }
    // Group drag: when the clicked object is part of a multi-selection,
    // capture every OTHER selected object's starting geometry so the same
    // rigid delta (computed from the anchor's snapped/clamped position each
    // tick) can be applied to the whole group, not just the object under
    // the cursor.
    if (selIds.length > 1 && selSet.has(obj.id)) {
      ds.groupStart = objects
        .filter((o) => o.id !== obj.id && selSet.has(o.id))
        .map((o) => ({
          id: o.id,
          x: o.x ?? 0,
          y: o.y ?? 0,
          x2: o.type === "line" ? (o.x2 ?? o.x + 100) : undefined,
          y2: o.type === "line" ? (o.y2 ?? o.y ?? 0)  : undefined,
          points: o.type === "pipe" ? o.points?.map((pp) => ({ ...pp })) : undefined,
        }));
    }
    openInteraction("Sposta oggetto");
    dragRef.current = ds;
  };

  return (
    <>
    {expandedTrendObj && (
      <TrendExpandedModal
        tags={[expandedTrendObj.tag ?? "", ...(expandedTrendObj.extra_tags ?? [])].filter(Boolean)}
        windowS={expandedTrendObj.window_s ?? 60}
        lineColor={expandedTrendObj.line_color ?? "var(--brand-primary, #3b82f6)"}
        yMin={expandedTrendObj.y_min}
        yMax={expandedTrendObj.y_max}
        opcuaBackfill={expandedTrendObj.opcua_backfill}
        seriesStyles={expandedTrendObj.trend_series_styles}
        dtDateOrder={expandedTrendObj.trend_dt_date_order}
        dtSeparator={expandedTrendObj.trend_dt_separator}
        dtTimeFormat={expandedTrendObj.trend_dt_time_format}
        dtShowSeconds={expandedTrendObj.trend_dt_show_seconds}
        dtShowYear={expandedTrendObj.trend_dt_show_year}
        dtTwoLines={expandedTrendObj.trend_dt_two_lines}
        dtAlwaysShowDate={expandedTrendObj.trend_dt_always_show_date}
        showThresholds={expandedTrendObj.trend_show_thresholds}
        warnLow={expandedTrendObj.warn_low}
        warnHigh={expandedTrendObj.warn_high}
        alarmLow={expandedTrendObj.alarm_low}
        alarmHigh={expandedTrendObj.alarm_high}
        showAlarmMarkers={expandedTrendObj.trend_show_alarm_markers}
        logScale={expandedTrendObj.trend_log_scale}
        yUnit={expandedTrendObj.unit}
        bgColor={expandedTrendObj.bg_color}
        bgImage={expandedTrendObj.bg_image}
        axisColor={expandedTrendObj.axis_color}
        gridColor={expandedTrendObj.grid_color}
        onClose={() => setExpandedTrendObj(null)}
      />
    )}
    <svg
      ref={svgRef}
      {...(() => {
        // Viewer-only (!onMove) sizing per project sizeMode. In the editor
        // (onMove present) this never applies — the editor's own zoom/pan
        // (viewT.zoom/panX/panY on the inner <g>) is independent of sizeMode.
        if (onMove || !pageWidth || !pageHeight) {
          return { width: "100%", height: "100%" };
        }
        if (sizeMode === "fixed") {
          // Pixel reali quando la pagina entra (fitScale === 1): è la promessa
          // della modalità "fisso" su un dispositivo noto. Quando non entra si
          // rimpicciolisce mantenendo le proporzioni (il viewBox regge lo
          // scaling) invece di mostrare scrollbar — sul pannello WP620 le barre
          // rubavano 70px di chrome più una ventina per sé stesse.
          if (fitScale >= 1) return { width: pageWidth, height: pageHeight };
          return {
            width: Math.round(pageWidth * fitScale),
            height: Math.round(pageHeight * fitScale),
            viewBox: `0 0 ${pageWidth} ${pageHeight}`,
            preserveAspectRatio: "xMidYMid meet",
          };
        }
        // "ratio" — scale-to-fit preserving aspect ratio (letterbox), today's
        // long-standing behavior against the standard reference resolution.
        return { width: "100%", height: "100%", viewBox: `0 0 ${pageWidth} ${pageHeight}`, preserveAspectRatio: "xMidYMid meet" };
      })()}
      style={{ background, display: "block", userSelect: "none",
               // Senza questo, l'overflow:hidden implicito di <svg> taglia
               // l'ultimo pixel (bordo compreso) di qualunque oggetto
               // posizionato a filo con pageWidth/pageHeight.
               overflow: "visible",
               cursor: panDragRef.current ? "grabbing" : undefined }}
      onMouseDown={handleSvgMouseDown}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        onSelect?.(null);
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      {/* Pattern def is in global SVG space so it tiles correctly after pan.
          Editor-only (onMove absent in the viewer) and snap-linked: the grid
          is a positioning aid, showing it when snap is off or in the viewer
          would be a visual artifact with no purpose. */}
      {onMove && snapEnabled && gridSize > 0 && (
        <defs>
          <pattern id="sws-grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
            <path
              d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
              fill="none" stroke={gridColor} strokeWidth="0.5"
            />
          </pattern>
        </defs>
      )}
      {/* F4.1: keyframes del lampeggio universale. prefers-reduced-motion
          spegne ogni blink (accessibilità) — l'attributo data-blink marca gli
          elementi animati inline. */}
      <style>{`@keyframes sws-obj-blink { 50% { opacity: 0.15 } }
        @media (prefers-reduced-motion: reduce) { [data-blink] { animation: none !important } }`}</style>
      {/* All zoomed+panned content is inside this group */}
      <g transform={`translate(${viewT.panX}, ${viewT.panY}) scale(${viewT.zoom})`}>
      {onMove && snapEnabled && gridSize > 0 && <rect x={-50000} y={-50000} width={100000} height={100000} fill="url(#sws-grid)" />}

      {/* Page boundary indicator — edit mode only, when dimensions are defined */}
      {onMove && pageWidth && pageHeight && (
        <rect
          x={0} y={0} width={pageWidth} height={pageHeight}
          fill="none" stroke="#3b82f6" strokeWidth={1} strokeDasharray="6 3"
          pointerEvents="none"
        />
      )}

      {sortByZ(objects).map((obj) => {
        // Visibility: in view mode, skip non-visible objects entirely.
        // In edit mode, always render so the designer can still select them
        // (rendered at reduced opacity to signal "hidden at runtime").
        const visible = isObjectVisible(obj, tagValues);
        const inEdit = !!onMove;
        if (!visible && !inEdit) return null;
        // F3.1 — gating per ruolo: sotto il min_role l'oggetto sparisce
        // ("hide") o resta visibile ma inerte ("disable": pointer-events
        // none blocca click, drag e input HTML nei foreignObject).
        const roleOk = isRoleAllowed(obj.min_role, viewerRole);
        if (!inEdit && !roleOk && obj.min_role_effect === "hide") return null;
        // F4 — lampeggio, stato allarme, stale e Bad-gray (tutti opt-in,
        // tutti calcolati qui una volta per ogni tipo di oggetto).
        const objW = obj.width ?? 100;
        const objH = obj.height ?? 50;
        const tvMain = obj.tag ? tagValues[obj.tag] : undefined;
        const alarmInfo = !inEdit && obj.tag ? alarmByTag.get(obj.tag) : undefined;
        let blinkOn = false;
        if (!inEdit) {
          if (obj.blink_mode === "always") blinkOn = true;
          else if (obj.blink_mode === "tag" && obj.blink_tag) {
            const bv = tagValues[obj.blink_tag]?.value;
            blinkOn = typeof bv === "boolean" ? bv : typeof bv === "number" ? bv !== 0 : !!bv;
          } else if (obj.blink_mode === "alarm") {
            blinkOn = !!alarmInfo && !alarmInfo.acked;
          }
        }
        const isStale = !inEdit && !!obj.stale_after_s && !!tvMain
          && nowMs - tvMain.timestamp_ms > obj.stale_after_s * 1000;
        const isBadGray = !inEdit && obj.bad_value_style === "gray" && tvMain?.quality === "Bad";
        const grayed = isStale || isBadGray;
        const gStyle: React.CSSProperties | undefined = (() => {
          const st: React.CSSProperties = {};
          if (!visible && inEdit) st.opacity = 0.35;
          if (!inEdit && !roleOk) { st.opacity = 0.45; st.pointerEvents = "none"; }
          if (grayed) { st.filter = "grayscale(0.9)"; st.opacity = 0.55; }
          if (blinkOn) st.animation = `sws-obj-blink ${obj.blink_rate_ms ?? 800}ms step-start infinite`;
          return Object.keys(st).length > 0 ? st : undefined;
        })();
        // Press/release dispatch (view mode only). Each handler resolves the
        // referenced function and forwards the per-binding parameter
        // overrides. Doesn't interfere with the per-type click handlers
        // inside SvgObject — both can fire.
        const onPress = !inEdit ? (() => {
          // button_action takes precedence for login/logout; for navigate it fires after on_press_fn.
          if (obj.button_action) {
            if (obj.button_action.type === "login" || obj.button_action.type === "logout") {
              onButtonAction?.(obj.button_action);
              return;
            }
            if (obj.button_action.type === "navigate") {
              if (obj.on_press_fn && onScript) onScript(obj.on_press_fn, obj.on_press_args ?? {});
              onButtonAction?.(obj.button_action);
              return;
            }
          }
          if (obj.on_press_fn && onScript) onScript(obj.on_press_fn, obj.on_press_args ?? {});
        }) : undefined;
        const onRelease = !inEdit && obj.on_release_fn && onScript
          ? () => onScript(obj.on_release_fn!, obj.on_release_args ?? {})
          : undefined;
        return (
          <g key={obj.id} style={gStyle} data-blink={blinkOn ? "1" : undefined} onMouseDown={obj.type !== "grid" ? onPress : undefined} onMouseUp={obj.type !== "grid" ? onRelease : undefined}>
            <SvgObject
              obj={obj}
              objects={objects}
              tagValues={tagValues}
              selected={selSet.has(obj.id)}
              selectedCount={selIds.length}
              isEditMode={inEdit}
              customSymbols={customSymbols}
              faceplates={faceplates}
              selectedCell={selectedCell}
              selectedCellChild={selectedCellChild}
              selectedCellRange={selectedCellRange}
              selectedSubCell={selectedSubCell}
              onSelect={onSelect}
              onStartDrag={onMove ? startDrag : undefined}
              onWriteTag={onWriteTag}
              onScript={onScript}
              onNavigate={onNavigate}
              onSelectCell={onSelectCell}
              onSelectCellChild={onSelectCellChild}
              onSelectCellRange={onSelectCellRange}
              onSelectSubCell={onSelectSubCell}
              onExpandTrend={!inEdit ? setExpandedTrendObj : undefined}
            />
            {/* F4.2: bordo di allarme opt-in — colorato per severità,
                lampeggia finché non riconosciuto. Bounding box stimato con i
                default per-tipo (per line/pipe è approssimativo). */}
            {!inEdit && obj.show_alarm_state && alarmInfo && (
              <rect x={obj.x - 3} y={obj.y - 3} width={objW + 6} height={objH + 6}
                fill="none" stroke={SEV_COLOR[alarmInfo.severity ?? "Warning"]} strokeWidth={2} rx={4}
                data-blink={!alarmInfo.acked ? "1" : undefined}
                style={{ pointerEvents: "none",
                         ...(alarmInfo.acked ? {} : { animation: "sws-obj-blink 800ms step-start infinite" }) }} />
            )}
            {/* F4.3: badge stale (l'attenuazione è già in gStyle) */}
            {isStale && (
              <text x={obj.x} y={obj.y - 5} fontSize={11} fill="#94a3b8"
                style={{ pointerEvents: "none" }}>⌛</text>
            )}
            {/* F4.3: QDot opt-in sui tipi che non lo disegnano da soli */}
            {!inEdit && obj.quality_dot === true && tvMain && !QDOT_BUILTIN_TYPES.has(obj.type) && (
              <QDot x={obj.x + objW - 8} y={obj.y + 8} quality={tvMain.quality}
                goodColor={obj.quality_dot_good_color} badColor={obj.quality_dot_bad_color}
                uncertainColor={obj.quality_dot_uncertain_color} />
            )}
            {inEdit && (() => {
              const bb = objBBox(obj);
              return (
                <rect
                  x={bb.x1} y={bb.y1}
                  width={bb.x2 - bb.x1} height={bb.y2 - bb.y1}
                  fill="none"
                  stroke="#475569"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  opacity={0.5}
                  style={{ pointerEvents: "none" }}
                />
              );
            })()}
          </g>
        );
      })}

      {selRect && (() => {
        const rx = Math.min(selRect.startX, selRect.curX);
        const ry = Math.min(selRect.startY, selRect.curY);
        const rw = Math.abs(selRect.curX - selRect.startX);
        const rh = Math.abs(selRect.curY - selRect.startY);
        const sw = 1 / viewT.zoom;
        return (
          <rect
            x={rx} y={ry} width={rw} height={rh}
            fill="rgba(59,130,246,0.1)" stroke="#3b82f6"
            strokeWidth={sw} strokeDasharray={`${4 * sw} ${2 * sw}`}
            pointerEvents="none"
          />
        );
      })()}

      {/* Line endpoint handles — single selected line in edit mode */}
      {onMove && selIds.length === 1 && (() => {
        const obj = objects.find((o) => o.id === selIds[0]);
        if (!obj || obj.type !== "line") return null;
        const x2 = obj.x2 ?? obj.x + 100;
        const y2 = obj.y2 ?? obj.y;
        const r = 5 / viewT.zoom;
        const sw = 1.5 / viewT.zoom;
        const makeEndpoint = (handle: "p1" | "p2", cx: number, cy: number) => (
          <circle
            key={handle}
            cx={cx} cy={cy} r={r}
            fill="white" stroke="#facc15" strokeWidth={sw}
            style={{ cursor: "crosshair" }}
            onMouseDown={(e) => {
              e.stopPropagation();
              dragRef.current = null;
              selDragRef.current = null;
              setSelRect(null);
              openInteraction("Sposta estremo linea");
              resizeRef.current = {
                objId: obj.id, handle,
                startX: e.clientX, startY: e.clientY,
                startObj: { x: obj.x ?? 0, y: obj.y ?? 0, width: 0, height: 0, x2, y2 },
              };
            }}
          />
        );
        return <>{makeEndpoint("p1", obj.x ?? 0, obj.y ?? 0)}{makeEndpoint("p2", x2, y2)}</>;
      })()}

      {/* Pipe waypoint handles — single selected pipe in edit mode */}
      {onMove && selIds.length === 1 && (() => {
        const obj = objects.find((o) => o.id === selIds[0]);
        if (!obj || obj.type !== "pipe") return null;
        const pts = obj.points ?? [];
        const r = 5 / viewT.zoom;
        const sw = 1.5 / viewT.zoom;
        return (
          <>
            {pts.map((pt, i) => (
              <circle key={i}
                cx={pt.x} cy={pt.y} r={r}
                fill="white" stroke="#facc15" strokeWidth={sw}
                style={{ cursor: "crosshair" }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = null;
                  selDragRef.current = null;
                  setSelRect(null);
                  openInteraction(`Sposta waypoint ${i}`);
                  resizeRef.current = {
                    objId: obj.id, handle: `wp-${i}`,
                    startX: e.clientX, startY: e.clientY,
                    startObj: { x: pt.x, y: pt.y, width: 0, height: 0 },
                  };
                }}
              />
            ))}
          </>
        );
      })()}

      {/* Resize handles — single selection, edit mode, no rotation, not line/grid/pipe */}
      {onMove && selIds.length === 1 && (() => {
        const obj = objects.find((o) => o.id === selIds[0]);
        if (!obj || obj.type === "line" || obj.type === "grid" || obj.type === "pipe" || (obj.rotation ?? 0) !== 0) return null;
        const bb = objBBox(obj);
        const cx = (bb.x1 + bb.x2) / 2;
        const cy = (bb.y1 + bb.y2) / 2;
        const hs = 4 / viewT.zoom;
        const sw = 1.5 / viewT.zoom;
        const handles: { id: string; x: number; y: number; cursor: string }[] = [
          { id: "tl", x: bb.x1, y: bb.y1, cursor: "nw-resize" },
          { id: "tc", x: cx,    y: bb.y1, cursor: "n-resize"  },
          { id: "tr", x: bb.x2, y: bb.y1, cursor: "ne-resize" },
          { id: "ml", x: bb.x1, y: cy,    cursor: "w-resize"  },
          { id: "mr", x: bb.x2, y: cy,    cursor: "e-resize"  },
          { id: "bl", x: bb.x1, y: bb.y2, cursor: "sw-resize" },
          { id: "bc", x: cx,    y: bb.y2, cursor: "s-resize"  },
          { id: "br", x: bb.x2, y: bb.y2, cursor: "se-resize" },
        ];
        return (
          <>
            {handles.map(({ id, x, y, cursor }) => (
              <rect
                key={id}
                x={x - hs} y={y - hs} width={hs * 2} height={hs * 2}
                fill="white" stroke="#facc15" strokeWidth={sw}
                style={{ cursor }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = null;
                  selDragRef.current = null;
                  setSelRect(null);
                  openInteraction("Ridimensiona oggetto");
                  resizeRef.current = {
                    objId: obj.id,
                    handle: id,
                    startX: e.clientX,
                    startY: e.clientY,
                    startObj: {
                      x: obj.x ?? 0, y: obj.y ?? 0,
                      width: obj.width ?? 0, height: obj.height ?? 0,
                    },
                  };
                }}
              />
            ))}
          </>
        );
      })()}

      {/* Grid interior border handles — single grid selected, edit mode.
          6 px corridor centred on each interior column/row border. Rendered
          AFTER cells (and AFTER the 8 corner handles) so they win the
          pointer hit-test inside the corridor. */}
      {onMove && selIds.length === 1 && (() => {
        const obj = objects.find((o) => o.id === selIds[0]);
        if (!obj || obj.type !== "grid") return null;
        const w = obj.width ?? 400;
        const h = obj.height ?? 300;
        const nRows = obj.grid_rows ?? 2;
        const nCols = obj.grid_cols ?? 2;
        const colWidthsDef = (obj.col_widths as number[] | undefined) ?? [];
        const colW: number[] = [];
        for (let c = 0; c < nCols; c++) {
          colW.push(c < colWidthsDef.length ? colWidthsDef[c] : w / nCols);
        }
        const rowHeightsDef = (obj.row_heights as number[] | undefined) ?? [];
        const rowH: number[] = [];
        for (let r = 0; r < nRows; r++) {
          rowH.push(r < rowHeightsDef.length ? rowHeightsDef[r] : h / nRows);
        }
        const colX: number[] = [];
        let cx0 = obj.x; for (let c = 0; c < nCols; c++) { colX.push(cx0); cx0 += colW[c]; }
        const rowY: number[] = [];
        let ry0 = obj.y; for (let r = 0; r < nRows; r++) { rowY.push(ry0); ry0 += rowH[r]; }
        const hitWidth = 6 / viewT.zoom;
        return (
          <>
            {Array.from({ length: Math.max(0, nCols - 1) }, (_, i) => (
              <rect
                key={`gbv-${i}`}
                x={colX[i + 1] - hitWidth / 2} y={obj.y}
                width={hitWidth} height={h}
                fill="transparent"
                style={{ cursor: "col-resize" }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = null;
                  resizeRef.current = null;
                  selDragRef.current = null;
                  setSelRect(null);
                  openInteraction(`Ridimensiona colonna ${i + 1}`);
                  gridBorderRef.current = {
                    objId: obj.id, axis: "col", index: i + 1,
                    startMouse: e.clientX,
                    startA: colW[i], startB: colW[i + 1],
                    startSizes: colW.slice(),
                  };
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ))}
            {Array.from({ length: Math.max(0, nRows - 1) }, (_, i) => (
              <rect
                key={`gbh-${i}`}
                x={obj.x} y={rowY[i + 1] - hitWidth / 2}
                width={w} height={hitWidth}
                fill="transparent"
                style={{ cursor: "row-resize" }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = null;
                  resizeRef.current = null;
                  selDragRef.current = null;
                  setSelRect(null);
                  openInteraction(`Ridimensiona riga ${i + 1}`);
                  gridBorderRef.current = {
                    objId: obj.id, axis: "row", index: i + 1,
                    startMouse: e.clientY,
                    startA: rowH[i], startB: rowH[i + 1],
                    startSizes: rowH.slice(),
                  };
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ))}
          </>
        );
      })()}

      {/* Sub-grid border handles — for every split cell (and every nested
          sub-cell that's also split) of the selected grid, render a 6 px
          transparent corridor over the divider. Walks `cell.sub` recursively
          so multi-level splits are all draggable. */}
      {onMove && selIds.length === 1 && (() => {
        const obj = objects.find((o) => o.id === selIds[0]);
        if (!obj || obj.type !== "grid") return null;
        const w = obj.width ?? 400;
        const h = obj.height ?? 300;
        const nRows = obj.grid_rows ?? 2;
        const nCols = obj.grid_cols ?? 2;
        const colWidthsDef = (obj.col_widths as number[] | undefined) ?? [];
        const colW: number[] = [];
        for (let c = 0; c < nCols; c++) colW.push(c < colWidthsDef.length ? colWidthsDef[c] : w / nCols);
        const rowHeightsDef = (obj.row_heights as number[] | undefined) ?? [];
        const rowH: number[] = [];
        for (let r = 0; r < nRows; r++) rowH.push(r < rowHeightsDef.length ? rowHeightsDef[r] : h / nRows);
        const colX: number[] = [];
        let cx0 = obj.x; for (let c = 0; c < nCols; c++) { colX.push(cx0); cx0 += colW[c]; }
        const rowY: number[] = [];
        let ry0 = obj.y; for (let r = 0; r < nRows; r++) { rowY.push(ry0); ry0 += rowH[r]; }
        const hitWidth = 6 / viewT.zoom;
        const cells = (obj.grid_cells as GridCell[] | undefined) ?? [];

        // Recursive helper: yields one handle per SubGrid along the tree.
        const handles: React.ReactNode[] = [];
        const walk = (
          sg: import("@/types").SubGrid,
          cellRow: number, cellCol: number,
          x: number, y: number, w: number, h: number,
          path: ("a" | "b")[],
        ) => {
          const ratio = Math.max(0.05, Math.min(0.95, sg.ratio ?? 0.5));
          // Emit one handle for THIS SubGrid (the divider between a and b).
          if (sg.orientation === "rows") {
            const borderY = y + h * ratio;
            handles.push(
              <rect
                key={`sbh-${cellRow}-${cellCol}-${path.join("")}`}
                x={x} y={borderY - hitWidth / 2}
                width={w} height={hitWidth}
                fill="transparent"
                style={{ cursor: "row-resize" }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = null;
                  resizeRef.current = null;
                  selDragRef.current = null;
                  setSelRect(null);
                  openInteraction("Ridimensiona sub-cella");
                  subBorderRef.current = {
                    objId: obj.id, row: cellRow, col: cellCol, path,
                    orientation: "rows",
                    startMouse: e.clientY,
                    startRatio: ratio,
                    cellPxSize: h,
                  };
                }}
                onClick={(e) => e.stopPropagation()}
              />,
            );
          } else {
            const borderX = x + w * ratio;
            handles.push(
              <rect
                key={`sbv-${cellRow}-${cellCol}-${path.join("")}`}
                x={borderX - hitWidth / 2} y={y}
                width={hitWidth} height={h}
                fill="transparent"
                style={{ cursor: "col-resize" }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = null;
                  resizeRef.current = null;
                  selDragRef.current = null;
                  setSelRect(null);
                  openInteraction("Ridimensiona sub-cella");
                  subBorderRef.current = {
                    objId: obj.id, row: cellRow, col: cellCol, path,
                    orientation: "cols",
                    startMouse: e.clientX,
                    startRatio: ratio,
                    cellPxSize: w,
                  };
                }}
                onClick={(e) => e.stopPropagation()}
              />,
            );
          }
          // Recurse into each slot if it has its own sub.
          let aX = x, aY = y, aW = w, aH = h, bX = x, bY = y, bW = w, bH = h;
          if (sg.orientation === "rows") {
            aH = h * ratio; bY = y + aH; bH = h - aH;
          } else {
            aW = w * ratio; bX = x + aW; bW = w - aW;
          }
          if (sg.a?.sub) walk(sg.a.sub, cellRow, cellCol, aX, aY, aW, aH, [...path, "a"]);
          if (sg.b?.sub) walk(sg.b.sub, cellRow, cellCol, bX, bY, bW, bH, [...path, "b"]);
        };

        for (const cd of cells) {
          if (!cd.sub) continue;
          const rs = cd.rowspan ?? 1;
          const cs = cd.colspan ?? 1;
          let cellW = 0;
          for (let cc = cd.col; cc < Math.min(cd.col + cs, nCols); cc++) cellW += colW[cc];
          let cellH = 0;
          for (let rr = cd.row; rr < Math.min(cd.row + rs, nRows); rr++) cellH += rowH[rr];
          walk(cd.sub, cd.row, cd.col, colX[cd.col], rowY[cd.row], cellW, cellH, []);
        }
        return <>{handles}</>;
      })()}

      {/* Snap guide lines — inside the transform so coords match SVG space */}
      {snapLines.x !== null && (
        <line x1={snapLines.x} y1={-50000} x2={snapLines.x} y2={50000}
          stroke="#06b6d4" strokeWidth={1 / viewT.zoom}
          style={{ pointerEvents: "none" }} />
      )}
      {snapLines.y !== null && (
        <line x1={-50000} y1={snapLines.y} x2={50000} y2={snapLines.y}
          stroke="#06b6d4" strokeWidth={1 / viewT.zoom}
          style={{ pointerEvents: "none" }} />
      )}

      {/* Ruler guides — page-local persisted lines, draggable in edit mode.
          Stroke width is scaled inverse to zoom so the line stays at ~1.5 px
          on screen regardless of zoom level. */}
      {onMove && showRulers && guides.map((g) => {
        const isDragging = guideDragRef.current?.id === g.id;
        const renderPos = isDragging && draggingGuide ? draggingGuide.pos : g.pos;
        const deleting = isDragging && draggingGuide?.deleting;
        const sw = 1.5 / viewT.zoom;
        const stroke = deleting ? "#ef4444" : "#f59e0b";
        return g.axis === "v" ? (
          <line key={g.id}
            x1={renderPos} y1={-50000} x2={renderPos} y2={50000}
            stroke={stroke} strokeWidth={sw} strokeDasharray={`${4 * sw} ${3 * sw}`}
            style={{ cursor: "ew-resize", opacity: deleting ? 0.5 : 1 }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              guideDragRef.current = { id: g.id, axis: "v", startPos: g.pos };
              setDraggingGuide({ axis: "v", pos: g.pos, deleting: false });
            }}
          />
        ) : (
          <line key={g.id}
            x1={-50000} y1={renderPos} x2={50000} y2={renderPos}
            stroke={stroke} strokeWidth={sw} strokeDasharray={`${4 * sw} ${3 * sw}`}
            style={{ cursor: "ns-resize", opacity: deleting ? 0.5 : 1 }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              guideDragRef.current = { id: g.id, axis: "h", startPos: g.pos };
              setDraggingGuide({ axis: "h", pos: g.pos, deleting: false });
            }}
          />
        );
      })}

      {/* Preview while creating a brand-new guide (no id committed yet). */}
      {onMove && showRulers && draggingGuide && !guideDragRef.current?.id && (
        draggingGuide.axis === "v" ? (
          <line x1={draggingGuide.pos} y1={-50000} x2={draggingGuide.pos} y2={50000}
            stroke="#f59e0b" strokeWidth={1.5 / viewT.zoom}
            strokeDasharray={`${4 * 1.5 / viewT.zoom} ${3 * 1.5 / viewT.zoom}`}
            style={{ pointerEvents: "none", opacity: draggingGuide.deleting ? 0 : 1 }}
          />
        ) : (
          <line x1={-50000} y1={draggingGuide.pos} x2={50000} y2={draggingGuide.pos}
            stroke="#f59e0b" strokeWidth={1.5 / viewT.zoom}
            strokeDasharray={`${4 * 1.5 / viewT.zoom} ${3 * 1.5 / viewT.zoom}`}
            style={{ pointerEvents: "none", opacity: draggingGuide.deleting ? 0 : 1 }}
          />
        )
      )}
      </g>{/* end zoom+pan group */}

      {/* Rulers — screen-space strips along top and left edges (edit mode).
          Tick spacing adapts to zoom level so labels never collide. Click+drag
          on a ruler spawns a fresh guide on the orthogonal axis. */}
      {onMove && showRulers && (() => {
        const z = viewT.zoom;
        // Pick a tick step that keeps adjacent labels ≥ 50 screen-px apart.
        // Steps follow a 1/2/5 progression across decades so the numbers
        // remain "round" at every zoom (e.g. 10, 20, 50, 100, 200, 500, 1000).
        const targetPx = 50;
        const rawStep = targetPx / z;
        const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const norm = rawStep / pow;
        const niceStep = (norm < 2 ? 1 : norm < 5 ? 2 : 5) * pow;
        // Visible range in SVG space — derive from element rect at render
        // time. We use a safe wide range as fallback (rendering offscreen
        // ticks is cheap).
        const el = svgRef.current;
        const wScreen = el?.clientWidth ?? 2000;
        const hScreen = el?.clientHeight ?? 1000;
        const minX = (-viewT.panX) / z;
        const maxX = (wScreen - viewT.panX) / z;
        const minY = (-viewT.panY) / z;
        const maxY = (hScreen - viewT.panY) / z;
        const firstTickX = Math.ceil(minX / niceStep) * niceStep;
        const firstTickY = Math.ceil(minY / niceStep) * niceStep;
        const ticksX: number[] = [];
        for (let v = firstTickX; v <= maxX; v += niceStep) ticksX.push(v);
        const ticksY: number[] = [];
        for (let v = firstTickY; v <= maxY; v += niceStep) ticksY.push(v);

        const rulerStyle: React.CSSProperties = {
          fill: "var(--brand-bg, #0f172a)", stroke: "var(--brand-surface-2, #334155)", strokeWidth: 1,
          cursor: "crosshair",
        };

        return (
          <g>
            {/* Top strip */}
            <rect x={0} y={0} width="100%" height={RULER_PX}
              style={rulerStyle}
              onMouseDown={(e) => {
                if (e.button !== 0 || !onMove) return;
                e.stopPropagation();
                const rect = (e.currentTarget.ownerSVGElement!).getBoundingClientRect();
                const pt = toSvg(e.clientX - rect.left, e.clientY - rect.top);
                guideDragRef.current = { id: null, axis: "v", startPos: pt.x };
                setDraggingGuide({ axis: "v", pos: pt.x, deleting: false });
              }}
            />
            {ticksX.map((v) => {
              const sx = v * z + viewT.panX;
              if (sx < RULER_PX) return null;
              return (
                <g key={`tx-${v}`} style={{ pointerEvents: "none" }}>
                  <line x1={sx} y1={RULER_PX - 5} x2={sx} y2={RULER_PX} strokeWidth={1}
                    style={{ stroke: "var(--brand-text-muted, #64748b)" }} />
                  <text x={sx + 2} y={11}
                    style={{ fontSize: 9, fill: "var(--brand-text-muted, #64748b)", fontFamily: "monospace" }}>
                    {v}
                  </text>
                </g>
              );
            })}
            {/* Left strip */}
            <rect x={0} y={0} width={RULER_PX} height="100%"
              style={rulerStyle}
              onMouseDown={(e) => {
                if (e.button !== 0 || !onMove) return;
                e.stopPropagation();
                const rect = (e.currentTarget.ownerSVGElement!).getBoundingClientRect();
                const pt = toSvg(e.clientX - rect.left, e.clientY - rect.top);
                guideDragRef.current = { id: null, axis: "h", startPos: pt.y };
                setDraggingGuide({ axis: "h", pos: pt.y, deleting: false });
              }}
            />
            {ticksY.map((v) => {
              const sy = v * z + viewT.panY;
              if (sy < RULER_PX) return null;
              return (
                <g key={`ty-${v}`} style={{ pointerEvents: "none" }}>
                  <line x1={RULER_PX - 5} y1={sy} x2={RULER_PX} y2={sy} strokeWidth={1}
                    style={{ stroke: "var(--brand-text-muted, #64748b)" }} />
                  <text x={2} y={sy + 8} transform={`rotate(-90 ${10} ${sy})`}
                    style={{ fontSize: 9, fill: "var(--brand-text-muted, #64748b)", fontFamily: "monospace" }}>
                    {v}
                  </text>
                </g>
              );
            })}
            {/* Corner square */}
            <rect x={0} y={0} width={RULER_PX} height={RULER_PX}
              strokeWidth={1}
              style={{ fill: "var(--brand-surface, #1e293b)", stroke: "var(--brand-surface-2, #334155)", cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); toggleRulers(); }}
            >
              <title>{t("canvas.rulersHide")}</title>
            </rect>
            <text x={RULER_PX / 2} y={RULER_PX / 2 + 3} textAnchor="middle"
              style={{ fontSize: 10, fill: "var(--brand-text-muted, #64748b)", pointerEvents: "none", fontFamily: "monospace" }}>
              ⟂
            </text>
          </g>
        );
      })()}

      {/* Ruler toggle button when rulers are hidden — small icon top-left. */}
      {onMove && !showRulers && (
        <g style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); toggleRulers(); }}>
          <rect x={2} y={2} width={20} height={20}
            style={{ fill: "var(--brand-surface, #1e293b)", stroke: "var(--brand-surface-2, #334155)" }} />
          <text x={12} y={16} textAnchor="middle"
            style={{ fontSize: 11, fill: "var(--brand-text-muted, #64748b)", fontFamily: "monospace", pointerEvents: "none" }}>⟂</text>
          <title>{t("canvas.rulersShow")}</title>
        </g>
      )}

      {/* The zoom readout and the fit button used to live here, in the canvas
          corner. They are now in the editor toolbar (EditorToolbar), which
          also carries the zoom slider — one readout, one place. */}

      {/* Mouse position indicator — bottom-left, outside the transform */}
      {onMove && mousePos && (
        <text x={6} y="100%" dy={-6}
          style={{ fontSize: 10, fill: "#475569", pointerEvents: "none", fontFamily: "monospace" }}>
          X:{Math.round(mousePos.x)} Y:{Math.round(mousePos.y)}
        </text>
      )}
    </svg>
    </>
  );
}

// ── Per-object props ──────────────────────────────────────────────────────────

export interface ObjProps {
  obj: SynopticObject;
  /** Full list of page objects — used by pipe rendering to resolve anchor points. */
  objects: SynopticObject[];
  tagValues: Record<string, TagState>;
  selected: boolean;
  /** Size of the current multi-selection (whole page, not just this object).
   *  Used to tell "drag one of several already-selected objects" (preserve
   *  the group) apart from "click a single selected object" (default 0/1 —
   *  unused, so nested/non-interactive SvgObject instances need not pass it). */
  selectedCount?: number;
  isEditMode: boolean;
  customSymbols: CustomSymbol[];
  faceplates?: FaceplateDef[];
  selectedCell?: { objectId: string; row: number; col: number } | null;
  selectedCellChild?: { objectId: string; row: number; col: number } | null;
  selectedCellRange?: { objectId: string; r1: number; c1: number; r2: number; c2: number } | null;
  selectedSubCell?: { objectId: string; row: number; col: number; path: ("a" | "b")[] } | null;
  onSelect?: (id: string | null, shift?: boolean) => void;
  onStartDrag?: (e: React.MouseEvent<SVGElement>, obj: SynopticObject) => void;
  onWriteTag?: (tagId: string, value: string | number | boolean) => void;
  onScript?: (fn: string, args: Record<string, string | number | boolean>) => void;
  onNavigate?: (pageId: string) => void;
  onSelectCell?: (objectId: string, row: number, col: number) => void;
  onSelectCellChild?: (objectId: string, row: number, col: number) => void;
  onSelectCellRange?: (objectId: string, r1: number, c1: number, r2: number, c2: number) => void;
  onSelectSubCell?: (objectId: string, row: number, col: number, path: ("a" | "b")[]) => void;
  onExpandTrend?: (obj: SynopticObject) => void;
}

// ── SparklineWidget ───────────────────────────────────────────────────────────

// ── Data log (F5.4): tabella storica paginata ───────────────────────────────
// Scarica la finestra (fino a 5000 campioni) e pagina lato client — il
// server non ha ancora un offset di paginazione; è annotato nel piano.
function DataLogWidget({ tag, windowS, pageSize, width, height, decimals, unit }: {
  tag: string; windowS: number; pageSize: number; width: number; height: number;
  decimals: number; unit?: string;
}) {
  const [rows, setRows] = useState<Sample[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!tag) return;
    setLoading(true);
    try {
      const now = Date.now();
      const hist = await api.getHistory(tag, { fromMs: now - windowS * 1000, toMs: now, limit: 5000 });
      setRows(hist.slice().reverse()); // più recenti in alto
      setPage(0);
    } catch { /* storico non disponibile */ }
    setLoading(false);
  }, [tag, windowS]);

  useEffect(() => { void load(); }, [load]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  const qColor = (q: string) => q === "Good" ? "var(--brand-success, #22c55e)"
    : q === "Bad" ? "var(--brand-danger, #ef4444)" : "var(--brand-warning, #eab308)";

  return (
    <div style={{ width, height, display: "flex", flexDirection: "column", fontSize: 11,
                  color: "var(--brand-text, #e2e8f0)", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 4px", flexShrink: 0 }}>
        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
          style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, color: "inherit", cursor: "pointer", padding: "0 6px" }}>◀</button>
        <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>{page + 1}/{pages}</span>
        <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
          style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, color: "inherit", cursor: "pointer", padding: "0 6px" }}>▶</button>
        <button onClick={() => void load()} title="Aggiorna"
          style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, color: "inherit", cursor: "pointer", padding: "0 6px" }}>⟳</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => api.exportHistoryCsv([tag], Date.now() - windowS * 1000, Date.now())} title="Esporta CSV"
          style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, color: "inherit", cursor: "pointer", padding: "0 6px" }}>⬇ CSV</button>
        {loading && <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>…</span>}
      </div>
      <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 3 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-muted, #94a3b8)" }}>
              <th style={{ textAlign: "left", padding: "2px 6px", fontWeight: 600 }}>Ora</th>
              <th style={{ textAlign: "right", padding: "2px 6px", fontWeight: 600 }}>Valore</th>
              <th style={{ textAlign: "center", padding: "2px 6px", fontWeight: 600 }}>Q</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => {
              const n = Number(r.value);
              return (
                <tr key={r.ts_ms + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(30,41,59,0.4)" }}>
                  <td style={{ padding: "1px 6px", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {new Date(r.ts_ms).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <td style={{ padding: "1px 6px", textAlign: "right", fontFamily: "monospace" }}>
                    {Number.isFinite(n) ? n.toFixed(decimals) : String(r.value)}{unit ? ` ${unit}` : ""}
                  </td>
                  <td style={{ padding: "1px 6px", textAlign: "center", color: qColor(r.quality) }}>●</td>
                </tr>
              );
            })}
            {pageRows.length === 0 && !loading && (
              <tr><td colSpan={3} style={{ padding: 8, textAlign: "center", color: "var(--brand-text-subtle, #64748b)" }}>Nessun campione nella finestra</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── KPI tile (F5.5): confronto vs periodo precedente ────────────────────────
// Media della finestra corrente vs media della finestra precedente via
// /api/history/:tag/stats (due chiamate), aggiornato ogni 30 s.
function KpiDelta({ tag, windowS }: { tag: string; windowS: number }) {
  const [delta, setDelta] = useState<number | null>(null);
  useEffect(() => {
    if (!tag) return;
    let cancelled = false;
    const load = async () => {
      try {
        const now = Date.now();
        const w = windowS * 1000;
        const [cur, prev] = await Promise.all([
          api.getHistoryStats(tag, { fromMs: now - w, toMs: now }),
          api.getHistoryStats(tag, { fromMs: now - 2 * w, toMs: now - w }),
        ]);
        if (cancelled) return;
        if (cur.count > 0 && prev.count > 0 && prev.avg !== 0) {
          setDelta(((cur.avg - prev.avg) / Math.abs(prev.avg)) * 100);
        } else {
          setDelta(null);
        }
      } catch { /* stats non disponibili: nessun confronto */ }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [tag, windowS]);

  if (delta === null) return null;
  const up = delta >= 0;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: up ? "var(--brand-success, #22c55e)" : "var(--brand-danger, #ef4444)" }}>
      {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function SparklineWidget({ tag, windowS, width, height, color, strokeWidth, fill, fillOpacity, showLast, yMin, yMax, tagValues }: {
  tag: string; windowS: number; width: number; height: number;
  color: string; strokeWidth: number; fill: boolean; fillOpacity: number;
  showLast: boolean; yMin?: number; yMax?: number;
  tagValues: Record<string, TagState>;
}) {
  const [samples, setSamples] = useState<{ ts: number; v: number }[]>([]);
  const tv = tag ? tagValues[tag] : undefined;

  // F5.3: seed dallo storico all'apertura pagina — prima il buffer partiva
  // vuoto e il grafico restava bianco per windowS secondi a ogni mount.
  useEffect(() => {
    if (!tag) return;
    let cancelled = false;
    const now = Date.now();
    api.getHistory(tag, { fromMs: now - windowS * 1000, toMs: now })
      .then((hist) => {
        if (cancelled) return;
        const seeded = hist
          .map((s) => ({ ts: s.ts_ms, v: Number(s.value) }))
          .filter((s) => Number.isFinite(s.v));
        // Il seed non deve scartare i live già arrivati nel frattempo.
        setSamples((prev) => {
          const firstLive = prev[0]?.ts ?? Infinity;
          return [...seeded.filter((s) => s.ts < firstLive), ...prev];
        });
      })
      .catch(() => { /* storico non disponibile: si parte live come prima */ });
    return () => { cancelled = true; };
  }, [tag, windowS]);

  useEffect(() => {
    if (tv === undefined) return;
    const v = Number(tv.value);
    if (!isFinite(v)) return;
    const now = Date.now();
    setSamples((prev) => {
      const cutoff = now - windowS * 1000;
      return [...prev.filter((s) => s.ts > cutoff), { ts: now, v }];
    });
  }, [tv?.value, windowS]);

  const pad = 2;
  const pw = width - pad * 2; const ph = height - pad * 2;
  if (samples.length < 2) {
    const last = samples[0]?.v;
    return (
      <div style={{ width, height, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={width} height={height}>
          <line x1={pad} y1={ph / 2 + pad} x2={pw + pad} y2={ph / 2 + pad} stroke={color} strokeWidth={strokeWidth} opacity={0.3} />
          {showLast && last !== undefined && (
            <text x={width - pad} y={pad + 10} textAnchor="end" fill={color} fontSize={9}>{last.toFixed(1)}</text>
          )}
        </svg>
      </div>
    );
  }

  const allV = samples.map((s) => s.v);
  const lo = yMin ?? Math.min(...allV); const hi = yMax ?? Math.max(...allV);
  const range = hi - lo || 1;
  const now2 = Date.now(); const oldest = now2 - windowS * 1000;

  const toX = (ts: number) => pad + ((ts - oldest) / (windowS * 1000)) * pw;
  const toY = (v: number) => pad + ph - ((v - lo) / range) * ph;

  const pts = samples.map((s) => `${toX(s.ts).toFixed(1)},${toY(s.v).toFixed(1)}`).join(" ");
  const last = samples[samples.length - 1];

  return (
    <div style={{ width, height, background: "transparent" }}>
      <svg width={width} height={height} style={{ overflow: "visible" }}>
        {fill && <path d={`M ${toX(samples[0].ts)} ${ph + pad} L ${pts} L ${toX(last.ts)} ${ph + pad} Z`} fill={color} fillOpacity={fillOpacity} />}
        <polyline points={pts} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
        {showLast && (
          <text x={width - pad} y={pad + 10} textAnchor="end" fill={color} fontSize={9}>{last.v.toFixed(1)}</text>
        )}
      </svg>
    </div>
  );
}

// ── AlarmViewerWidget ─────────────────────────────────────────────────────────

function AlarmViewerWidget({ width, height, mode, maxRows, prefix, allowedSev, showAck, showTs, showEmpty, bgColor }: {
  width: number; height: number; mode: "list" | "banner" | "table";
  maxRows: number; prefix: string;
  allowedSev?: AlarmSeverity[];
  showAck: boolean; showTs: boolean; showEmpty: boolean;
  bgColor?: string;
}) {
  const alarmsMap = useAppStore((s) => s.alarms);
  const authRole = useAppStore((s) => s.authRole);
  const canAck = authRole === "Admin" || authRole === "Supervisor" || authRole === "Operator";
  // F1.3: messaggi di allarme localizzati come ogni altro testo di progetto.
  const langTable = useAppStore((s) => s.project?.languages);
  const projLang = useAppStore((s) => s.projectLang);
  const msgLang = effectiveProjectLang(langTable) || projLang;
  const locMsg = (msg?: string) => resolveMsg(msg ?? "", msgLang, langTable);

  const filtered = Object.values(alarmsMap)
    .filter((a) => {
      if (!a.active) return false;
      if (prefix && !a.def.id.startsWith(prefix)) return false;
      if (allowedSev && allowedSev.length > 0 && !allowedSev.includes(a.def.severity!)) return false;
      return true;
    })
    .sort((a, b) => (b.activated_at_ms ?? 0) - (a.activated_at_ms ?? 0))
    .slice(0, maxRows);

  const sevColor = (sev: string) => SEV_COLOR[(sev as AlarmSeverity) ?? "Info"] ?? SEV_COLOR.Info;

  const handleAck = useCallback(async (id: string) => {
    try {
      const token = getAuthToken() ?? "";
      await fetch(`/api/alarms/${id}/ack`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* ignore */ }
  }, []);

  const containerStyle: React.CSSProperties = {
    width, height,
    background: bgColor ?? "rgba(15,23,42,0.92)",
    overflow: "hidden",
    fontFamily: "monospace",
    fontSize: 11,
    color: "var(--brand-text, #e2e8f0)",
    borderRadius: 4,
    border: "1px solid var(--brand-surface-2, #334155)",
    boxSizing: "border-box",
  };

  if (filtered.length === 0) {
    return (
      <div style={containerStyle}>
        {showEmpty && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--brand-border, #475569)" }}>
            Nessun allarme attivo
          </div>
        )}
      </div>
    );
  }

  if (mode === "banner") {
    const a = filtered[0];
    const sev = a.def.severity ?? "Warning";
    const text = `${sev.toUpperCase()}: ${locMsg(a.def.message) || a.def.id}`;
    return (
      <div style={{ ...containerStyle, background: sevColor(sev) + "33", display: "flex", alignItems: "center", overflow: "hidden" }}>
        <div style={{
          whiteSpace: "nowrap", animation: filtered.length > 1 ? "sws-marquee 10s linear infinite" : undefined,
          color: sevColor(sev), fontWeight: "bold", padding: "0 8px",
        }}>
          {text}
        </div>
        <style>{`@keyframes sws-marquee { 0%{transform:translateX(100%)} 100%{transform:translateX(-100%)} }`}</style>
      </div>
    );
  }

  if (mode === "table") {
    const severityRank = (s: string) => (s === "Critical" ? 0 : s === "Warning" ? 1 : 2);
    const columns: DataTableColumn<AlarmState>[] = [
      {
        key: "severity", header: "●", width: 22, align: "center", filterable: false,
        accessor: (a) => severityRank(a.def.severity ?? "Warning"),
        render: (a) => <span style={{ color: sevColor(a.def.severity ?? "Warning") }}>●</span>,
      },
      { key: "id", header: "ID", accessor: (a) => a.def.id },
      { key: "message", header: "Messaggio", accessor: (a) => locMsg(a.def.message) },
      ...(showTs ? [{
        key: "ts", header: "Attivato", width: 68, filterable: false,
        accessor: (a: AlarmState) => a.activated_at_ms ?? 0,
        render: (a: AlarmState) => a.activated_at_ms
          ? new Date(a.activated_at_ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
          : "—",
      } satisfies DataTableColumn<AlarmState>] : []),
      ...(showAck ? [{
        key: "ack", header: "ACK", width: 56, align: "center" as const, sortable: false, filterable: false,
        accessor: () => "",
        render: (a: AlarmState) => canAck && !a.acknowledged ? (
          <button
            onClick={(e) => { e.stopPropagation(); void handleAck(a.def.id); }}
            style={{ fontSize: 9, padding: "1px 6px", background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 2, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}
          >
            ACK
          </button>
        ) : a.acknowledged ? <span style={{ color: "var(--brand-text-subtle, #64748b)", fontStyle: "italic" }}>ACK</span> : null,
      } satisfies DataTableColumn<AlarmState>] : []),
    ];
    return (
      <div style={{ width, height, boxSizing: "border-box" }}>
        <DataTable<AlarmState>
          columns={columns}
          rows={filtered}
          rowKey={(a) => a.def.id}
          maxHeight={height}
          compact
        />
      </div>
    );
  }

  return (
    <div style={{ ...containerStyle, overflowY: "auto" }}>
      {filtered.map((a) => {
        const sev = a.def.severity ?? "Warning";
        return (
        <div key={a.def.id} style={{
          display: "flex", alignItems: "center", gap: 4, padding: "2px 6px",
          borderBottom: "1px solid var(--brand-surface, #1e293b)",
          background: sevColor(sev) + "18",
        }}>
          <span style={{ color: sevColor(sev), flexShrink: 0 }}>●</span>
          {showTs && a.activated_at_ms && (
            <span style={{ color: "var(--brand-border, #475569)", flexShrink: 0 }}>
              {new Date(a.activated_at_ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {locMsg(a.def.message) || a.def.id}
          </span>
          {showAck && canAck && !a.acknowledged && (
            <button
              onClick={(e) => { e.stopPropagation(); void handleAck(a.def.id); }}
              style={{ fontSize: 9, padding: "1px 4px", background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 2, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer", flexShrink: 0 }}>
              ACK
            </button>
          )}
        </div>
        );
      })}
    </div>
  );
}

/** Substitute `{param}` placeholders in a faceplate child's `tag`/`label`/
 *  `name`/`text` fields with the given parameter values. Extracted so the
 *  Faceplates config panel's live preview (`ConfigView.tsx`) can render a
 *  definition's `objects` the same way a placed `faceplate` instance does,
 *  without an instance's real `faceplate_params` (it passes placeholder
 *  values instead, one per declared param name). */
/** Campi strutturali che la sostituzione NON deve toccare: identità e
 *  riferimenti che parametrizzare romperebbe (id oggetto, tipo, gruppo,
 *  riferimento alla definizione del faceplate stesso). */
const FACEPLATE_SUB_EXCLUDE = new Set(["id", "type", "group_id", "faceplate_id"]);

/** F6.1 — sostituzione parametri su TUTTI i campi stringa, ricorsiva.
 *  Prima toccava solo tag/label/name/text: un faceplate pompa reale con
 *  `state_tag: "{p}.running"`, binding `{p}.mode` o soglie nelle celle grid
 *  non funzionava. Il walker attraversa oggetti e array (bindings, grid_cells,
 *  table_rows, faceplate_params annidati → pass-through dei parametri ai
 *  faceplate figli); un valore senza `{` passa per identità (niente copie). */
export function substituteFaceplateParams(
  child: SynopticObject,
  params: Record<string, string>,
): SynopticObject {
  if (Object.keys(params).length === 0) return child;
  const subStr = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.indexOf("{") >= 0 ? subStr(v) : v;
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => { const nx = walk(x); if (nx !== x) changed = true; return nx; });
      return changed ? out : v;
    }
    if (v && typeof v === "object") {
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        const nv = FACEPLATE_SUB_EXCLUDE.has(k) ? val : walk(val);
        out[k] = nv;
        if (nv !== val) changed = true;
      }
      return changed ? out : v;
    }
    return v;
  };
  return walk(child) as SynopticObject;
}

/** F6.2 — normalizza i parametri di una definizione (stringa nuda → oggetto). */
export function normalizeFaceplateParams(def: FaceplateDef): FaceplateParamDef[] {
  return (def.params ?? []).map((p) => (typeof p === "string" ? { name: p } : p));
}

/** F6.2 — parametri effettivi di un'istanza: valori dell'istanza + default
 *  della definizione per i parametri non forniti. */
export function effectiveFaceplateParams(
  def: FaceplateDef,
  instance: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of normalizeFaceplateParams(def)) {
    const v = instance?.[p.name];
    if (v !== undefined && v !== "") out[p.name] = v;
    else if (p.default !== undefined) out[p.name] = p.default;
  }
  // Chiavi extra dell'istanza (parametri rimossi dalla def): passano comunque,
  // così un template rinominato non rompe in silenzio la sostituzione.
  for (const [k, v] of Object.entries(instance ?? {})) {
    if (!(k in out) && v !== "") out[k] = v;
  }
  return out;
}

/** F6.4 — bbox della definizione (per lo scaling al box dell'istanza). */
export function faceplateDefBBox(def: FaceplateDef): { w: number; h: number } {
  let w = 0, h = 0;
  for (const c of def.objects) {
    w = Math.max(w, (c.x ?? 0) + (c.width ?? 100));
    h = Math.max(h, (c.y ?? 0) + (c.height ?? 50));
  }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

export function SvgObject(p: ObjProps) {
  const { objects, tagValues, selected, selectedCount = 0, isEditMode, customSymbols, faceplates = [], selectedCell, selectedCellChild, selectedCellRange, onSelect, onStartDrag, onWriteTag, onScript, onNavigate, onSelectCell, onSelectCellChild, onSelectCellRange, onExpandTrend } = p;
  const { t } = useTranslation();
  // F1.2: default ereditati dal TagDef (unità/range/limiti), poi binding.
  const projectTags = useAppStore((s) => s.project?.tags);
  const resolved = resolveObject(p.obj, tagValues);
  const obj = applyTagDefaults(
    resolved,
    resolved.tag && projectTags ? projectTags.find((td) => td.id === resolved.tag) : undefined,
  );
  // Drag-to-zoom range for the "trend" object type (T-48). Declared
  // unconditionally (rules of hooks) even though only the trend branch uses
  // it — this component instance is keyed by obj.id, so the state persists
  // correctly across re-renders of the same object, isolated per object.
  const [trendZoom, setTrendZoom] = useState<{ fromMs: number; toMs: number; yLo?: number; yHi?: number } | null>(null);
  // Draft text for the "setpoint" object type (T-46+ widget audit): null while
  // showing the live tag value, a string while the operator is typing a new
  // one — write only fires on explicit confirm (Enter/button), never on every
  // keystroke. Same unconditional-hooks reasoning as trendZoom above.
  const [setpointDraft, setSetpointDraft] = useState<string | null>(null);
  // F3.6: draft dello slider mentre si trascina (scrittura solo al rilascio)
  // e ultimo valore scritto per il deadband. Hook incondizionati come sopra.
  const [sliderDraft, setSliderDraft] = useState<number | null>(null);
  const sliderLastWritten = useRef<number | null>(null);
  // F3.4: tastierino numerico touch del setpoint. Hook incondizionato.
  const [keypadOpen, setKeypadOpen] = useState(false);

  // F3.2/F3.3: ogni scrittura originata da questo oggetto passa da qui —
  // conferma configurabile, e per i comandi critici re-auth (password della
  // sessione) + motivo obbligatorio, entrambi registrati nell'audit.
  const guardedWrite = (tagId: string | undefined, value: string | number | boolean) => {
    if (!tagId || isEditMode) return;
    if (obj.require_confirm) {
      const base = t("viewer.confirmWrite", { value: String(value) });
      const msg = obj.confirm_message?.trim() ? `${obj.confirm_message}\n\n${base}` : base;
      if (!window.confirm(msg)) return;
    }
    if (obj.critical) {
      // In no-auth mode non esistono password: il flusso salta la verifica
      // (il server risponderebbe comunque 204) ma il motivo resta richiesto.
      const st = useAppStore.getState();
      const noAuth = st.authToken === "no-auth";
      const finish = (reason?: string) => {
        if (obj.require_reason && !reason?.trim()) {
          window.alert(t("viewer.reasonRequired"));
          return;
        }
        // Sempre via HTTP: il motivo viaggia nel body e finisce nell'audit.
        api.writeTag(tagId, value, reason?.trim() || undefined)
          .catch((e: unknown) => window.alert(
            `${t("viewer.writeFailed", { tag: tagId })}\n${e instanceof Error ? e.message : String(e)}`));
      };
      const askReason = () => {
        const reason = obj.require_reason
          ? window.prompt(t("viewer.reasonPrompt")) ?? undefined
          : undefined;
        if (obj.require_reason && reason === undefined) return; // annullato
        finish(reason);
      };
      if (noAuth) { askReason(); return; }
      const pw = window.prompt(t("viewer.reauthPrompt"));
      if (pw === null) return; // annullato
      api.verifyPassword(pw)
        .then(() => askReason())
        .catch(() => window.alert(t("viewer.reauthFailed")));
      return;
    }
    onWriteTag?.(tagId, value);
  };

  const handleMouseDown = (e: React.MouseEvent<SVGElement>) => {
    if (obj.locked && isEditMode) return;
    e.stopPropagation();
    // Plain click on an object that's already part of a multi-selection:
    // don't collapse the selection down to just this object — preserve it
    // so the upcoming drag moves the whole group. Shift-click (toggle) and
    // clicking an object outside the current selection behave as before.
    const isPartOfMultiSelect = !e.shiftKey && selected && selectedCount > 1;
    if (!isPartOfMultiSelect) onSelect?.(obj.id, e.shiftKey);
    // Don't start a drag when the user is just shift-clicking to extend
    // a multi-selection; otherwise the position would jump on the very
    // first click in the additive flow.
    if (!e.shiftKey) onStartDrag?.(e, obj);
  };

  const editCursor = selected ? "grab" : "pointer";

  /** Selection bounding rect for edit mode */
  const selRect = (x: number, y: number, w: number, h: number) =>
    selected
      ? <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6}
          fill="none" stroke="#facc15" strokeWidth={1} strokeDasharray="4 2"
          style={{ pointerEvents: "none" }} />
      : null;

  /** Recursively render the contents of a split cell area. Walks `cell.sub`
   *  (and any nested `entry.sub`) down to leaf entries, drawing the bg
   *  rect + image + child for leaves and recursing for sub-divided slots.
   *  `pathPrefix` is empty at the top-level call (cell.sub) and grows by
   *  one "a"/"b" each recursion level. */
  const renderSubArea = (
    sg: import("@/types").SubGrid,
    x: number, y: number, w: number, h: number,
    pathPrefix: ("a" | "b")[],
    cellRow: number, cellCol: number, gridObjId: string,
  ): React.ReactNode => {
    const ratio = Math.max(0.05, Math.min(0.95, sg.ratio ?? 0.5));
    let aX = x, aY = y, aW = w, aH = h;
    let bX = x, bY = y, bW = w, bH = h;
    if (sg.orientation === "rows") {
      aH = h * ratio;
      bX = x; bY = y + aH; bW = w; bH = h - aH;
    } else {
      aW = w * ratio;
      bX = x + aW; bY = y; bW = w - aW; bH = h;
    }
    const slots: { key: "a" | "b"; entry: import("@/types").SubCellEntry | undefined; x: number; y: number; w: number; h: number }[] = [
      { key: "a", entry: sg.a, x: aX, y: aY, w: aW, h: aH },
      { key: "b", entry: sg.b, x: bX, y: bY, w: bW, h: bH },
    ];
    return (
      <>
        {slots.map(({ key: slot, entry, x: sx, y: sy, w: sw, h: sh }) => {
          const slotPath = [...pathPrefix, slot];
          const sel = p.selectedSubCell;
          const isSlotSel = isEditMode
            && sel?.objectId === gridObjId
            && sel.row === cellRow
            && sel.col === cellCol
            && sel.path.length === slotPath.length
            && sel.path.every((s, i) => s === slotPath[i]);
          // If this slot is itself split, recurse — the sub-sub-cells will
          // catch their own clicks (and stop propagation), so this slot's
          // bg rect underneath them is only reached on the (currently
          // impossible) "click on a non-existent gap" path. The bg rect
          // still renders so a future "select parent slot" affordance can
          // be added without restructuring.
          if (entry?.sub) {
            return (
              <g key={`sub-${slotPath.join("")}`}>
                {renderSubArea(entry.sub, sx, sy, sw, sh, slotPath, cellRow, cellCol, gridObjId)}
              </g>
            );
          }
          return (
            <g key={`sub-${slotPath.join("")}`}>
              <rect
                x={sx} y={sy} width={sw} height={sh}
                fill={entry?.bg_color ?? "transparent"}
                stroke="none"
                style={{ cursor: isEditMode ? "pointer" : "default" }}
                onMouseDown={(e) => {
                  if (!isEditMode) return;
                  e.stopPropagation();
                  // Select the grid object first so the right panel renders
                  // the object-properties branch (otherwise selectedObjectId
                  // would stay null and the panel would show page properties
                  // even while the sub-slot looks highlighted).
                  p.onSelect?.(gridObjId, false);
                  p.onSelectSubCell?.(gridObjId, cellRow, cellCol, slotPath);
                }}
                onClick={(e) => e.stopPropagation()}
              />
              {entry?.bg_image && (
                <image href={entry.bg_image}
                  x={sx} y={sy} width={sw} height={sh}
                  preserveAspectRatio="xMidYMid slice"
                  style={{ pointerEvents: "none" }} />
              )}
              {entry?.child && (() => {
                const ch2 = entry.child!;
                const cw = ch2.width ?? 100;
                const chh = ch2.height ?? 50;
                const childX = sx + (sw - cw) / 2;
                const childY = sy + (sh - chh) / 2;
                const placed = ch2.type === "line"
                  ? { ...ch2, x: childX, y: childY,
                      x2: childX + ((ch2.x2 ?? ch2.x + 100) - ch2.x),
                      y2: childY + ((ch2.y2 ?? ch2.y) - ch2.y) }
                  : { ...ch2, x: childX, y: childY };
                return (
                  <>
                    {/* Child visual — non-interactive in edit mode; the
                        overlay rect below catches clicks for selection. */}
                    <g style={{ pointerEvents: isEditMode ? "none" : "auto" }}>
                      <SvgObject
                        obj={placed}
                        objects={objects}
                        tagValues={tagValues}
                        selected={false}
                        isEditMode={false}
                        customSymbols={customSymbols}
                        faceplates={faceplates}
                        onWriteTag={onWriteTag}
                        onScript={onScript}
                        onNavigate={onNavigate}
                      />
                    </g>
                    {/* Click target — selects the parent sub-slot so the
                        panel surfaces the child's ObjectProps (and stops the
                        click from re-selecting through the slot rect
                        underneath, which is the same selection anyway but
                        the explicit stopPropagation keeps event flow tidy). */}
                    {isEditMode && (
                      <rect
                        x={childX} y={childY} width={cw} height={chh}
                        fill="transparent"
                        style={{ cursor: "pointer" }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          // Same reason as the sub-slot rect above: select
                          // the grid first so the panel routes to the
                          // object-properties branch, then nail down which
                          // sub-cell is being edited.
                          p.onSelect?.(gridObjId, false);
                          p.onSelectSubCell?.(gridObjId, cellRow, cellCol, slotPath);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    {/* Selection rect around the child — visible whenever
                        the slot holding it is selected, so the user can
                        confirm which object the panel is editing. */}
                    {isEditMode && isSlotSel && (
                      <rect
                        x={childX - 2} y={childY - 2}
                        width={cw + 4} height={chh + 4}
                        fill="none" stroke="#0d9488"
                        strokeWidth={1.5} strokeDasharray="4 2"
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                  </>
                );
              })()}
              {isSlotSel && (
                <rect
                  x={sx + 1} y={sy + 1} width={sw - 2} height={sh - 2}
                  fill="none" stroke="#14b8a6"
                  strokeWidth={1.5} strokeDasharray="4 2"
                  style={{ pointerEvents: "none" }}
                />
              )}
            </g>
          );
        })}
        {/* Divider line — visual only. Drag interaction handled by a wider
            transparent corridor rendered at SvgCanvas top level. */}
        {isEditMode && (() => {
          const divX1 = sg.orientation === "rows" ? aX : bX;
          const divY1 = sg.orientation === "rows" ? bY : aY;
          const divX2 = sg.orientation === "rows" ? aX + aW : bX;
          const divY2 = sg.orientation === "rows" ? bY : aY + aH;
          return (
            <line x1={divX1} y1={divY1} x2={divX2} y2={divY2}
              stroke="#475569" strokeWidth={1} strokeDasharray="3 3"
              style={{ pointerEvents: "none" }} />
          );
        })()}
      </>
    );
  };

  // ── Universal background layer ───────────────────────────────────────────
  // Flat color first, then image on top — the same stacking CSS gives
  // background-color + background-image. Rendered inside each type's own
  // applyTransform so rotation/flip carry over; pointerEvents none so it
  // never steals clicks from the object's own hit handlers. Types opt in by
  // calling this inside their block (not every type has a meaningful box:
  // line and pipe, for instance, are pure strokes).
  const bgLayer = (x: number, y: number, w: number, h: number, rx = 0) =>
    (obj.bg_color || obj.bg_image) ? (
      <>
        {obj.bg_color && (
          <rect x={x} y={y} width={w} height={h} rx={rx} fill={obj.bg_color} style={{ pointerEvents: "none" }} />
        )}
        {obj.bg_image && (
          <image href={obj.bg_image} x={x} y={y} width={w} height={h}
            preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
        )}
      </>
    ) : null;

  // ── RECT ────────────────────────────────────────────────────────────────────

  if (obj.type === "rect") {
    const w = obj.width ?? 100; const h = obj.height ?? 50;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    return (
      <>
        {applyTransform(obj, w, h, <>
          {/* F0.2: bg_color = fallback del fill (un bgLayer dietro un corpo
              opaco sarebbe invisibile — qui lo sfondo È il fill). */}
          <rect x={obj.x} y={obj.y} width={w} height={h}
            fill={obj.fill ?? obj.bg_color ?? "#555"}
            stroke={selected ? "#facc15" : (obj.stroke ?? "none")}
            strokeWidth={selected ? 2 : (obj.stroke_width ?? 0)}
            style={{ cursor: editCursor, ...transitionStyle(obj) }}
            onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
        </>)}
        {tv && obj.quality_dot !== false && <QDot x={obj.x + w - 8} y={obj.y + 8} quality={tv.quality} goodColor={obj.quality_dot_good_color} badColor={obj.quality_dot_bad_color} uncertainColor={obj.quality_dot_uncertain_color} />}
      </>
    );
  }

  // ── ELLIPSE ─────────────────────────────────────────────────────────────────

  if (obj.type === "ellipse") {
    const w = obj.width ?? 100; const h = obj.height ?? 60;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    return (
      <>
        {selRect(obj.x, obj.y, w, h)}
        {applyTransform(obj, w, h, <>
          {bgLayer(obj.x, obj.y, w, h, 4)}
          <ellipse cx={obj.x + w / 2} cy={obj.y + h / 2} rx={w / 2} ry={h / 2}
            fill={obj.fill ?? "#4a90d9"}
            stroke={obj.stroke ?? "none"} strokeWidth={obj.stroke_width ?? 0}
            style={{ cursor: editCursor, ...transitionStyle(obj) }}
            onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
        </>)}
        {tv && obj.quality_dot !== false && <QDot x={obj.x + w - 8} y={obj.y + 8} quality={tv.quality} goodColor={obj.quality_dot_good_color} badColor={obj.quality_dot_bad_color} uncertainColor={obj.quality_dot_uncertain_color} />}
      </>
    );
  }

  // ── LINE ────────────────────────────────────────────────────────────────────

  if (obj.type === "line") {
    const x2 = obj.x2 ?? obj.x + 100; const y2 = obj.y2 ?? obj.y;
    return (
      <>
        <line x1={obj.x} y1={obj.y} x2={x2} y2={y2}
          stroke={obj.stroke ?? "var(--brand-text, #e2e8f0)"} strokeWidth={obj.stroke_width ?? 2}
          strokeDasharray={obj.stroke_dasharray || undefined}
          style={{ cursor: editCursor, ...transitionStyle(obj) }}
          onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
        {selected && <>
          <circle cx={obj.x} cy={obj.y} r={4} fill="#facc15" style={{ pointerEvents: "none" }} />
          <circle cx={x2} cy={y2} r={4} fill="#facc15" style={{ pointerEvents: "none" }} />
        </>}
      </>
    );
  }

  // ── PIPE ────────────────────────────────────────────────────────────────────

  if (obj.type === "pipe") {
    const pts = resolveAnchoredPoints(obj, objects);
    if (pts.length < 2) return null;
    const pipeStyle = obj.pipe_style ?? "flat";
    const sw = obj.stroke_width ?? 8;
    const baseColor = obj.stroke ?? "#64748b";
    const routing = obj.routing ?? "straight";
    const pathD = buildPipeD(pts, routing);

    // State / alarm colour override
    const alarmTv = obj.alarm_tag ? tagValues[obj.alarm_tag] : undefined;
    const stateTv = obj.state_tag ? tagValues[obj.state_tag] : undefined;
    const pipeColor =
      (alarmTv && alarmTv.value) ? (obj.state_alarm_color ?? "#ef4444") :
      (stateTv && stateTv.value) ? (obj.state_on_color ?? baseColor) :
      (obj.state_tag ? (obj.state_off_color ?? baseColor) : baseColor);

    // Gradient
    const useGrad = obj.pipe_gradient ?? (pipeStyle === "tube");
    const gradId = `pipe-grad-${obj.id}`;
    const lightC = obj.gradient_light_color ?? lightenHex(pipeColor);
    const darkC  = obj.gradient_dark_color  ?? darkenHex(pipeColor);

    // Fill level
    const flTag = obj.fill_level_tag ? tagValues[obj.fill_level_tag] : undefined;
    const rawLevel = flTag
      ? ((obj.fill_level_scale ?? "0-100") === "0-100"
          ? Number(flTag.value) / 100
          : Number(flTag.value))
      : (obj.fill_level ?? 0);
    const fillLevel = clamp(rawLevel, 0, 1);
    const fillColor = obj.fill_color ?? "var(--brand-primary, #3b82f6)";
    const fillOffset = (obj.fill_direction ?? "start-to-end") === "start-to-end"
      ? (1 - fillLevel) : fillLevel;

    // Stroke widths per style
    const outerSw = sw + 2;
    const innerSw = Math.max(1, sw - 2);
    const wireSw  = Math.max(2, Math.round(sw / 4));
    const bodySw  = pipeStyle === "wire" ? wireSw : sw;
    const fillSw  = pipeStyle === "wire" ? Math.max(1, wireSw - 1) : innerSw;

    // Midpoint for label / quality dot
    const midPt = pts[Math.floor((pts.length - 1) / 2)];

    // Label
    const labelTv = obj.pipe_label_tag ? tagValues[obj.pipe_label_tag] : undefined;
    const labelText = labelTv
      ? formatValue(labelTv.value, obj.pipe_label_format ?? "{value}")
      : (obj.pipe_label ?? obj.label);

    // Marker size
    const mSz = Math.max(4, sw * (obj.marker_size ?? 1));
    const mId = (s: string) => `pipe-m${s}-${obj.id}`;

    const dasharray = pipeStyle === "wire" ? (obj.stroke_dasharray ?? "6,3") : (obj.stroke_dasharray ?? undefined);

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
         style={{ cursor: editCursor, opacity: obj.opacity ?? 1 }}>
        <defs>
          {useGrad && (
            <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%"   stopColor={lightC} />
              <stop offset="50%"  stopColor={pipeColor} />
              <stop offset="100%" stopColor={darkC} />
            </linearGradient>
          )}
          {obj.start_marker && obj.start_marker !== "none" && (
            <marker id={mId("s")} markerWidth={mSz} markerHeight={mSz}
                    refX={mSz / 2} refY={mSz / 2} orient="auto-start-reverse">
              {obj.start_marker === "arrow" && <path d={`M 0 0 L ${mSz} ${mSz/2} L 0 ${mSz} Z`} fill={pipeColor} />}
              {obj.start_marker === "dot"   && <circle cx={mSz/2} cy={mSz/2} r={mSz/2 - 0.5} fill={pipeColor} />}
              {obj.start_marker === "flange" && <rect x={0} y={0} width={mSz * 0.35} height={mSz} fill={pipeColor} />}
            </marker>
          )}
          {obj.end_marker && obj.end_marker !== "none" && (
            <marker id={mId("e")} markerWidth={mSz} markerHeight={mSz}
                    refX={mSz / 2} refY={mSz / 2} orient="auto">
              {obj.end_marker === "arrow" && <path d={`M 0 0 L ${mSz} ${mSz/2} L 0 ${mSz} Z`} fill={pipeColor} />}
              {obj.end_marker === "dot"   && <circle cx={mSz/2} cy={mSz/2} r={mSz/2 - 0.5} fill={pipeColor} />}
              {obj.end_marker === "flange" && <rect x={0} y={0} width={mSz * 0.35} height={mSz} fill={pipeColor} />}
            </marker>
          )}
        </defs>

        {/* Outer shadow for tube style */}
        {pipeStyle === "tube" && (
          <path d={pathD} fill="none" stroke={darkC} strokeWidth={outerSw}
            strokeLinecap="round" strokeLinejoin="round"
            style={{ pointerEvents: "none" }} />
        )}

        {/* Main pipe body */}
        <path d={pathD} fill="none"
          stroke={useGrad ? `url(#${gradId})` : pipeColor}
          strokeWidth={bodySw}
          strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={dasharray}
          markerStart={obj.start_marker && obj.start_marker !== "none" ? `url(#${mId("s")})` : undefined}
          markerEnd={obj.end_marker && obj.end_marker !== "none" ? `url(#${mId("e")})` : undefined}
          style={{ ...transitionStyle(obj) }} />

        {/* Inner highlight for tube style */}
        {pipeStyle === "tube" && (
          <path d={pathD} fill="none" stroke={lightC}
            strokeWidth={Math.max(1, Math.round(sw * 0.22))}
            strokeLinecap="round" strokeLinejoin="round"
            style={{ pointerEvents: "none", opacity: 0.55 }} />
        )}

        {/* Fill level overlay (stroke-dasharray trick with pathLength=1) */}
        {fillLevel > 0 && (
          <path d={pathD} fill="none"
            stroke={fillColor} strokeWidth={fillSw}
            strokeLinecap="round" strokeLinejoin="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={fillOffset}
            style={{ pointerEvents: "none", ...transitionStyle(obj) }} />
        )}

        {/* Transparent wider hit area so it's easy to click */}
        <path d={pathD} fill="none" stroke="transparent"
          strokeWidth={Math.max(bodySw, 14)}
          strokeLinecap="round" strokeLinejoin="round" />

        {/* Label — F0.2: colore e dimensione erano hardcoded. */}
        {labelText && (
          <text x={midPt.x} y={midPt.y - (obj.pipe_label_offset ?? 10)}
            textAnchor="middle" fill={obj.color ?? "#e2e8f0"} fontSize={obj.font_size ?? 12}
            style={{ pointerEvents: "none" }}>
            {labelText}
          </text>
        )}

        {/* Quality dot at midpoint */}
        {flTag && obj.quality_dot !== false && (
          <QDot x={midPt.x + 7} y={midPt.y - 7} quality={flTag.quality}
            goodColor={obj.quality_dot_good_color}
            badColor={obj.quality_dot_bad_color}
            uncertainColor={obj.quality_dot_uncertain_color} />
        )}
      </g>
    );
  }

  // ── TEXT ────────────────────────────────────────────────────────────────────

  if (obj.type === "text") {
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    // Precedence: bound tag → format template (default "{value}");
    //             otherwise → static `text` field; otherwise → placeholder.
    const content = tv != null
      ? formatValue(tv.value, obj.format ?? "{value}")
      : (obj.text ?? obj.tag ?? "Testo");
    const size      = obj.font_size ?? 14;
    const family    = obj.font_family ?? undefined;
    const weight    = obj.font_weight ?? "normal";
    const style     = obj.font_style ?? "normal";
    const anchor    = obj.text_anchor ?? "start";
    const staticColour = obj.color ?? obj.fill ?? "var(--brand-text, #e2e8f0)";
    const colour    = (obj.text_color_by_threshold && tv && Number.isFinite(Number(tv.value)))
      ? (thresholdColor(Number(tv.value), obj.alarm_low, obj.warn_low, obj.warn_high, obj.alarm_high) ?? staticColour)
      : staticColour;
    // Selection rect is a rough estimate — SVG text has no width attr without measuring.
    const approxW   = Math.max(40, content.length * size * 0.6);
    const dx        = anchor === "middle" ? -approxW / 2 : anchor === "end" ? -approxW : 0;
    return (
      <>
        {selRect(obj.x + dx - 2, obj.y - size + 2, approxW + 4, size + 6)}
        {applyTransform(obj, approxW, size, <>
          {bgLayer(obj.x + dx - 4, obj.y - size, approxW + 8, size + 8, 3)}
          <text
            x={obj.x}
            y={obj.y}
            fill={colour}
            fontSize={size}
            fontFamily={family}
            fontWeight={weight as any}
            fontStyle={style}
            textAnchor={anchor}
            style={{ cursor: editCursor, ...transitionStyle(obj) }}
            onMouseDown={handleMouseDown}
            onClick={(e) => e.stopPropagation()}
          >
            {content}
          </text>
        </>)}
        {tv && obj.quality_dot !== false && <QDot x={obj.x - 10} y={obj.y - size / 2} quality={tv.quality} goodColor={obj.quality_dot_good_color} badColor={obj.quality_dot_bad_color} uncertainColor={obj.quality_dot_uncertain_color} />}
      </>
    );
  }

  // ── BUTTON ──────────────────────────────────────────────────────────────────

  if (obj.type === "button") {
    const w = obj.width ?? 120; const h = obj.height ?? 40;
    // F3.5 — modalità comando: write (storica), momentary, toggle, set/reset,
    // increment/decrement. Il momentary usa press/release; le altre il click.
    const mode = obj.button_mode ?? "write";
    const doCommand = () => {
      if (!obj.tag) return;
      const tv = tagValues[obj.tag];
      const cur = tv?.value;
      switch (mode) {
        case "write":     guardedWrite(obj.tag, obj.write_value ?? true); break;
        case "toggle": {
          const on = typeof cur === "boolean" ? cur : typeof cur === "number" ? cur !== 0 : String(cur ?? "").length > 0;
          guardedWrite(obj.tag, !on); break;
        }
        case "set":       guardedWrite(obj.tag, obj.write_value ?? true); break;
        case "reset":     guardedWrite(obj.tag, obj.release_value ?? false); break;
        case "increment":
        case "decrement": {
          const base = typeof cur === "number" ? cur : Number(cur) || 0;
          const step = obj.step ?? 1;
          let next = mode === "increment" ? base + step : base - step;
          if (obj.min !== undefined) next = Math.max(next, obj.min);
          if (obj.max !== undefined) next = Math.min(next, obj.max);
          guardedWrite(obj.tag, next); break;
        }
        case "momentary": break; // gestito su press/release
      }
    };
    return (
      <g style={{ cursor: isEditMode ? editCursor : "pointer" }}
        onMouseDown={(e) => {
          if (isEditMode) { handleMouseDown(e); return; }
          if (mode === "momentary" && obj.tag) guardedWrite(obj.tag, obj.write_value ?? true);
        }}
        onMouseUp={() => {
          if (!isEditMode && mode === "momentary" && obj.tag) guardedWrite(obj.tag, obj.release_value ?? false);
        }}
        onMouseLeave={() => {
          // Il dito/mouse che scivola fuori NON deve lasciare il comando attivo.
          if (!isEditMode && mode === "momentary" && obj.tag) guardedWrite(obj.tag, obj.release_value ?? false);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditMode) doCommand();
          else onSelect?.(obj.id);
        }}>
        {applyTransform(obj, w, h, <>
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={6}
            fill={obj.fill ?? obj.bg_color ?? "var(--brand-primary, #3b82f6)"}
            stroke={selected ? "#facc15" : "var(--brand-primary-hover, #2563eb)"} strokeWidth={selected ? 2 : 1}
            style={transitionStyle(obj)} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          <text x={obj.x + w / 2} y={obj.y + h / 2 + 5}
            textAnchor="middle" fill={obj.color ?? "#fff"} fontSize={14} fontWeight={600}
            style={{ pointerEvents: "none" }}>
            {obj.label ?? "Button"}
          </text>
        </>)}
      </g>
    );
  }

  // ── NAVBUTTON ───────────────────────────────────────────────────────────────

  if (obj.type === "navbutton") {
    const w = obj.width ?? 140; const h = obj.height ?? 36;
    return (
      <g style={{ cursor: isEditMode ? editCursor : "pointer" }}
        onMouseDown={isEditMode ? handleMouseDown : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditMode && obj.target_page) onNavigate?.(obj.target_page);
          else if (isEditMode) onSelect?.(obj.id);
        }}>
        {applyTransform(obj, w, h, <>
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4}
            fill={obj.fill ?? obj.bg_color ?? "var(--brand-bg, #0f172a)"}
            stroke={selected ? "#facc15" : "var(--brand-primary, #3b82f6)"} strokeWidth={selected ? 2 : 1.5}
            style={transitionStyle(obj)} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          {/* F0.2: glifo e label seguono `color` (prima erano hardcoded). */}
          <text x={obj.x + 10} y={obj.y + h / 2 + 5}
            fill={obj.color ?? "var(--brand-primary, #3b82f6)"} fontSize={14}
            style={{ pointerEvents: "none" }}>▶</text>
          <text x={obj.x + 28} y={obj.y + h / 2 + 5}
            fill={obj.color ?? "var(--brand-text, #e2e8f0)"} fontSize={13}
            style={{ pointerEvents: "none" }}>
            {obj.label ?? "Go to page"}
          </text>
        </>)}
      </g>
    );
  }

  // ── LANGUAGE BUTTON (T-40) ──────────────────────────────────────────────────
  if (obj.type === "lang_button") {
    const w = obj.width ?? 80; const h = obj.height ?? 32;
    const code = obj.target_lang ?? "";
    const st = useAppStore.getState();
    const active = st.projectLang ? st.projectLang === code : st.project?.languages?.default === code;
    return (
      <g style={{ cursor: isEditMode ? editCursor : "pointer" }}
        onMouseDown={isEditMode ? handleMouseDown : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditMode && code) useAppStore.getState().setProjectLang(code);
          else if (isEditMode) onSelect?.(obj.id);
        }}>
        {applyTransform(obj, w, h, <>
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4}
            fill={obj.fill ?? (active ? "var(--brand-primary, #3b82f6)" : obj.bg_color ?? "var(--brand-surface-2, #334155)")}
            stroke={selected ? "#facc15" : "var(--brand-border, #475569)"} strokeWidth={selected ? 2 : 1}
            style={transitionStyle(obj)} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          <text x={obj.x + w / 2} y={obj.y + h / 2 + 5} textAnchor="middle"
            fill={active ? "#fff" : "var(--brand-text, #e2e8f0)"} fontSize={13} fontWeight={active ? 700 : 400}
            style={{ pointerEvents: "none" }}>
            {obj.label ?? (code ? code.toUpperCase() : "LANG")}
          </text>
        </>)}
      </g>
    );
  }

  // ── LANGUAGE SELECTOR (T-40) ────────────────────────────────────────────────
  if (obj.type === "lang_selector") {
    const w = obj.width ?? 120; const h = obj.height ?? 32;
    const st = useAppStore.getState();
    const langs = st.project?.languages?.langs ?? [];
    const cur = st.projectLang || st.project?.languages?.default || "";

    if (isEditMode) {
      // Edit mode: static SVG preview, draggable — a live <select> inside a
      // foreignObject (view mode below) swallows the mousedown before it
      // reaches this <g>, so dragging never started even with disabled={true}.
      // Same fix pattern as slider/table/text_list: real form control only in
      // view mode, plain shape here.
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
          style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4}
            fill={obj.fill ?? "var(--brand-surface-2, #334155)"}
            stroke="var(--brand-border, #475569)" strokeWidth={1} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          <text x={obj.x + 8} y={obj.y + h / 2 + 5} fill="var(--brand-text, #e2e8f0)" fontSize={13}
            style={{ pointerEvents: "none" }}>
            {cur ? cur.toUpperCase() : (langs[0] ?? "—")} ▾
          </text>
        </g>
      );
    }

    return (
      <g style={{ cursor: "default" }}>
        {applyTransform(obj, w, h,
          <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
            <select value={cur}
              onChange={(e) => useAppStore.getState().setProjectLang(e.target.value)}
              style={{ width: "100%", height: "100%", boxSizing: "border-box",
                background: obj.fill ?? "var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)",
                border: "1px solid var(--brand-border, #475569)",
                borderRadius: 4, fontSize: 13, padding: "0 6px",
                ...(obj.bg_image ? { backgroundImage: `url(${obj.bg_image})`, backgroundSize: "cover", backgroundPosition: "center" } : {}) }}>
              {langs.length === 0 && <option value="">—</option>}
              {langs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          </foreignObject>
        )}
      </g>
    );
  }

  // ── LED INDICATOR ───────────────────────────────────────────────────────────

  if (obj.type === "led") {
    const r = (obj.width ?? 24) / 2;
    const cx = obj.x + r; const cy = obj.y + r;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const onVal = obj.on_value ?? true;
    const isOn = tv != null && (
      typeof onVal === "boolean" ? Boolean(tv.value) === onVal
      : String(tv.value) === String(onVal)
    );
    const ledColor = tv == null
      ? "var(--brand-surface-2, #334155)"
      : tv.quality === "Bad"
        ? "#ef4444"
        : isOn ? (obj.on_color ?? "#22c55e") : (obj.off_color ?? "var(--brand-surface-2, #334155)");
    const glowColor = isOn ? (obj.on_color ?? "#22c55e") : "transparent";

    const ledW = r * 2;
    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
         style={{ cursor: editCursor }}>
        {selected && <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#facc15" strokeWidth={1} />}
        {applyTransform(obj, ledW, ledW, <>
          {bgLayer(obj.x, obj.y, ledW, ledW, 4)}
          {/* Glow ring */}
          {isOn && <circle cx={cx} cy={cy} r={r + 3} fill={glowColor} opacity={0.25} style={{ pointerEvents: "none" }} />}
          {/* LED body */}
          <circle cx={cx} cy={cy} r={r} fill={ledColor} style={transitionStyle(obj)} />
          {/* Highlight */}
          <circle cx={cx - r * 0.25} cy={cy - r * 0.25} r={r * 0.3} fill="white" opacity={0.3}
            style={{ pointerEvents: "none" }} />
          {/* Label */}
          {obj.label && (
            <text x={cx} y={obj.y + r * 2 + 14} textAnchor="middle" fill="#94a3b8" fontSize={11}
              style={{ pointerEvents: "none" }}>
              {obj.label}
            </text>
          )}
        </>)}
      </g>
    );
  }

  // ── STATE LAMP ───────────────────────────────────────────────────────────────
  // Same data model as text_list (text_list_entries: value→label→color), but
  // renders a colored circle (like led) with the matched entry's label next to
  // it, instead of just text — a middle ground between a binary led and a
  // purely-textual state readout.

  if (obj.type === "state_lamp") {
    const h = obj.height ?? 24;
    const r = h / 2;
    const cx = obj.x + r; const cy = obj.y + r;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const entry = tv != null ? matchTextListEntry(obj.text_list_entries, tv.value) : undefined;
    const lampColor = entry ? (entry.color ?? "var(--brand-text, #e2e8f0)") : "var(--brand-surface-2, #334155)";
    const label = entry ? entry.label : (obj.text_list_default ?? "");
    const labelColor = entry ? lampColor : (obj.text_list_default_color ?? "var(--brand-text-muted, #94a3b8)");
    const size = obj.font_size ?? 13;

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, obj.width ?? 140, h)}
        {bgLayer(obj.x, obj.y, obj.width ?? 140, h, 4)}
        <circle cx={cx} cy={cy} r={r - 2} fill={lampColor} style={transitionStyle(obj)} />
        <circle cx={cx - (r - 2) * 0.25} cy={cy - (r - 2) * 0.25} r={(r - 2) * 0.3} fill="white" opacity={0.3} style={{ pointerEvents: "none" }} />
        {label && (
          <text x={obj.x + h + 6} y={cy + size / 3} fill={labelColor} fontSize={size}
            style={{ pointerEvents: "none" }}>
            {label}
          </text>
        )}
        {tv && obj.quality_dot !== false && <QDot x={obj.x} y={obj.y} quality={tv.quality} />}
      </g>
    );
  }

  // ── PROGRESS BAR ────────────────────────────────────────────────────────────

  if (obj.type === "progress_bar") {
    const w = obj.width ?? 200; const h = obj.height ?? 28;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const min = obj.min ?? 0; const max = obj.max ?? 100;
    const rawVal = tv ? Number(tv.value) : min;
    const pct = clamp((rawVal - min) / (max - min), 0, 1);
    const barColor =
      thresholdColor(rawVal, obj.alarm_low, obj.warn_low, obj.warn_high, obj.alarm_high)
      ?? (obj.fill ?? "var(--brand-primary, #3b82f6)");
    // F0.2: orientation era offerta nel pannello ma il rendering era sempre
    // orizzontale. In verticale la barra riempie dal basso verso l'alto.
    const vertical = obj.orientation === "vertical";
    const barW = Math.round(pct * w);
    const barH = Math.round(pct * h);
    // Posizione (x1,y1)-(x2,y2) del marker di soglia per un valore dato.
    const markerLine = (value: number) => {
      const p2 = clamp((value - min) / (max - min), 0, 1);
      return vertical
        ? { x1: obj.x, y1: obj.y + h - p2 * h, x2: obj.x + w, y2: obj.y + h - p2 * h }
        : { x1: obj.x + p2 * w, y1: obj.y, x2: obj.x + p2 * w, y2: obj.y + h };
    };

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
         style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
        {applyTransform(obj, w, h, <>
          {/* Track */}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4} fill={obj.bg_color ?? "#1e293b"} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          {/* Fill */}
          {(vertical ? barH : barW) > 0 && (vertical ? (
            <rect x={obj.x} y={obj.y + h - barH} width={w} height={barH} rx={4} fill={barColor}
              style={transitionStyle(obj)} />
          ) : (
            <rect x={obj.x} y={obj.y} width={barW} height={h} rx={4} fill={barColor}
              style={transitionStyle(obj)} />
          ))}
          {/* Border */}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4}
            fill="none" stroke="#334155" strokeWidth={1} style={{ pointerEvents: "none" }} />
          {/* Value text */}
          {obj.show_value !== false && (
            <text x={obj.x + w / 2} y={obj.y + h / 2 + 4}
              textAnchor="middle" fill="#e2e8f0" fontSize={11} fontWeight={600}
              style={{ pointerEvents: "none" }}>
              {rawVal.toFixed(obj.decimals ?? 1)}{obj.unit ? ` ${obj.unit}` : ""}
            </text>
          )}
          {/* Warn/alarm markers */}
          {obj.warn_high !== undefined && (
            <line {...markerLine(obj.warn_high)}
              stroke="#eab308" strokeWidth={1.5} strokeDasharray="3 2"
              style={{ pointerEvents: "none" }} />
          )}
          {obj.alarm_high !== undefined && (
            <line {...markerLine(obj.alarm_high)}
              stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3 2"
              style={{ pointerEvents: "none" }} />
          )}
          {/* Label */}
          {obj.label && (
            <text x={obj.x} y={obj.y - 4} fill="#94a3b8" fontSize={11}
              style={{ pointerEvents: "none" }}>
              {obj.label}
            </text>
          )}
        </>)}
        {/* Quality dot — axis-aligned */}
        {tv && obj.quality_dot !== false && <QDot x={obj.x + w - 8} y={obj.y + 8} quality={tv.quality} goodColor={obj.quality_dot_good_color} badColor={obj.quality_dot_bad_color} uncertainColor={obj.quality_dot_uncertain_color} />}
      </g>
    );
  }

  // ── GAUGE ───────────────────────────────────────────────────────────────────

  if (obj.type === "gauge") {
    const w = obj.width ?? 160; const h = obj.height ?? 140;
    const cx = obj.x + w / 2;
    const cy = obj.y + h * 0.62;
    const R = Math.min(w * 0.38, h * 0.52);
    const START = -135; const END = 135; // degrees from North, clockwise
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const min = obj.min ?? 0; const max = obj.max ?? 100;
    const rawVal = tv ? Number(tv.value) : min;
    const pct = clamp((rawVal - min) / (max - min), 0, 1);
    const valueAngle = START + pct * 270;
    const arcColor =
      thresholdColor(rawVal, obj.alarm_low, obj.warn_low, obj.warn_high, obj.alarm_high)
      ?? (obj.fill ?? "#22c55e");

    const needleTip  = polar(cx, cy, R * 0.82, valueAngle);
    const needleBase = polar(cx, cy, R * 0.12, valueAngle + 180);

    // Threshold tick helpers
    const thresholdTick = (value: number, color: string) => {
      const pct2 = clamp((value - min) / (max - min), 0, 1);
      const angle = START + pct2 * 270;
      const inner = polar(cx, cy, R - 8, angle);
      const outer = polar(cx, cy, R + 2, angle);
      return <line key={`t${value}`} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
        stroke={color} strokeWidth={2} style={{ pointerEvents: "none" }} />;
    };

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
         style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
        {applyTransform(obj, w, h, <>
          {/* Invisible hit-area: <g> has no own geometry — without this rect clicks fall through */}
          <rect x={obj.x} y={obj.y} width={w} height={h} fill="transparent" />
          {bgLayer(obj.x, obj.y, w, h, 4)}
          {/* Background arc */}
          <path d={arcPath(cx, cy, R, START, END)}
            fill="none" stroke="#334155" strokeWidth={10} strokeLinecap="round"
            style={{ pointerEvents: "none" }} />
          {/* Value arc */}
          {pct > 0 && (
            <path d={arcPath(cx, cy, R, START, valueAngle)}
              fill="none" stroke={arcColor} strokeWidth={10} strokeLinecap="round"
              style={{ pointerEvents: "none", ...transitionStyle(obj) }} />
          )}
          {/* Threshold ticks */}
          {obj.warn_low  !== undefined && thresholdTick(obj.warn_low,  "#eab308")}
          {obj.warn_high !== undefined && thresholdTick(obj.warn_high, "#eab308")}
          {obj.alarm_low  !== undefined && thresholdTick(obj.alarm_low,  "#ef4444")}
          {obj.alarm_high !== undefined && thresholdTick(obj.alarm_high, "#ef4444")}
          {/* Needle */}
          <line x1={needleBase.x} y1={needleBase.y} x2={needleTip.x} y2={needleTip.y}
            stroke={obj.stroke ?? "#e2e8f0"} strokeWidth={2} strokeLinecap="round"
            style={{ pointerEvents: "none" }} />
          {/* Hub */}
          <circle cx={cx} cy={cy} r={6} fill={obj.stroke ?? "#e2e8f0"} style={{ pointerEvents: "none" }} />
          <circle cx={cx} cy={cy} r={3} fill="#0f172a" style={{ pointerEvents: "none" }} />
          {/* Min / max labels */}
          {(() => {
            const minP = polar(cx, cy, R + 14, START);
            const maxP = polar(cx, cy, R + 14, END);
            return <>
              <text x={minP.x} y={minP.y + 4} textAnchor="middle" fill={obj.color ?? "#64748b"} fontSize={10}
                style={{ pointerEvents: "none" }}>{min}</text>
              <text x={maxP.x} y={maxP.y + 4} textAnchor="middle" fill={obj.color ?? "#64748b"} fontSize={10}
                style={{ pointerEvents: "none" }}>{max}</text>
            </>;
          })()}
          {/* Value display — F0.2: show_value era offerto nel pannello ma ignorato. */}
          {obj.show_value !== false && (
            <text x={cx} y={cy + R * 0.35} textAnchor="middle"
              fill={obj.color ?? "#e2e8f0"} fontSize={20} fontWeight={700}
              style={{ pointerEvents: "none" }}>
              {typeof rawVal === "number" ? rawVal.toFixed(obj.decimals ?? 1) : rawVal}
            </text>
          )}
          {obj.show_value !== false && obj.unit && (
            <text x={cx} y={cy + R * 0.35 + 16} textAnchor="middle" fill={obj.color ?? "#94a3b8"} fontSize={11}
              style={{ pointerEvents: "none" }}>{obj.unit}</text>
          )}
          {/* Label */}
          {obj.label && (
            <text x={cx} y={obj.y + 14} textAnchor="middle" fill={obj.color ?? "#94a3b8"} fontSize={11}
              style={{ pointerEvents: "none" }}>{obj.label}</text>
          )}
        </>)}
        {/* Quality dot — axis-aligned */}
        {tv && obj.quality_dot !== false && <QDot x={obj.x + w - 10} y={obj.y + 10} quality={tv.quality} goodColor={obj.quality_dot_good_color} badColor={obj.quality_dot_bad_color} uncertainColor={obj.quality_dot_uncertain_color} />}
      </g>
    );
  }

  // ── SLIDER ──────────────────────────────────────────────────────────────────

  if (obj.type === "slider") {
    const w = obj.width ?? 200; const h = obj.height ?? 50;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const min = obj.min ?? 0; const max = obj.max ?? 100;
    const rawVal = tv ? Number(tv.value) : min;
    const trackY = obj.y + h / 2;
    // Stessa convenzione di radio_group: la proprietà è opzionale e l'assenza
    // vale "horizontal", che è come si comportava lo slider prima che
    // l'orientamento venisse letto.
    const isVertical = obj.orientation === "vertical";
    const readOnly = !!obj.read_only;
    const accent = obj.fill ?? "var(--brand-primary, #3b82f6)";
    const shownVal = sliderDraft ?? rawVal;
    const valueText = `${shownVal.toFixed(obj.decimals ?? (obj.step && obj.step < 1 ? 2 : 0))}${obj.unit ? ` ${obj.unit}` : ""}`;

    if (isEditMode) {
      // Edit mode: static SVG preview, draggable
      const labelEl = obj.label ? (
        <text x={obj.x + w / 2} y={obj.y + 12} textAnchor="middle"
          fill="#94a3b8" fontSize={11} style={{ pointerEvents: "none" }}>{obj.label}</text>
      ) : null;

      if (isVertical) {
        // L'anteprima deve cambiare insieme al runtime: finché restava
        // orizzontale, cambiare orientamento "non faceva niente" anche quando
        // il valore veniva salvato correttamente.
        const top = obj.y + (obj.label ? 18 : 4);
        const bottom = obj.y + h - 4;
        const len = Math.max(8, bottom - top);
        const cx = obj.x + w / 2;
        return (
          <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
             style={{ cursor: editCursor }}>
            {selRect(obj.x, obj.y, w, h)}
            {bgLayer(obj.x, obj.y, w, h, 4)}
            {labelEl}
            <rect x={cx - 3} y={top} width={6} height={len} rx={3} fill="#334155" />
            {/* Il riempimento parte dal basso: il minimo sta in fondo, come
                nel controllo ruotato a runtime. */}
            <rect x={cx - 3} y={top + len * 0.5} width={6} height={len * 0.5} rx={3} fill="#3b82f6" />
            <circle cx={cx} cy={top + len * 0.5} r={10}
              fill="#3b82f6" stroke="#1d4ed8" strokeWidth={2} />
            <text x={cx + 14} y={top + 4} fill="#64748b" fontSize={10}
              style={{ pointerEvents: "none" }}>{max}</text>
            <text x={cx + 14} y={bottom} fill="#64748b" fontSize={10}
              style={{ pointerEvents: "none" }}>{min}</text>
          </g>
        );
      }

      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
           style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          {bgLayer(obj.x, obj.y, w, h, 4)}
          {labelEl}
          <rect x={obj.x} y={trackY - 3} width={w} height={6} rx={3} fill="#334155" />
          <rect x={obj.x} y={trackY - 3} width={w * 0.5} height={6} rx={3} fill="#3b82f6" />
          <circle cx={obj.x + w * 0.5} cy={trackY} r={10}
            fill="#3b82f6" stroke="#1d4ed8" strokeWidth={2} />
          <text x={obj.x} y={obj.y + h + 2} fill="#64748b" fontSize={10}
            style={{ pointerEvents: "none" }}>{min}</text>
          <text x={obj.x + w} y={obj.y + h + 2} textAnchor="end" fill="#64748b" fontSize={10}
            style={{ pointerEvents: "none" }}>{max}</text>
        </g>
      );
    }

    // View mode: foreignObject with native range input.
    //
    // `disabled` e non solo un cursore diverso: la spunta "Sola lettura" era
    // offerta nel pannello proprietà e non faceva niente, quindi uno slider
    // dichiarato in sola lettura scriveva comunque il tag.
    // F3.6 — default nuovo: scrivi SOLO al rilascio (prima ogni pixel di
    // trascinamento generava una scrittura verso il PLC). write_on_release:
    // false ripristina la scrittura continua; write_deadband filtra le
    // variazioni sotto soglia in entrambe le modalità.
    const writeOnRelease = obj.write_on_release !== false;
    const commitSlider = (v: number) => {
      const last = sliderLastWritten.current;
      if (obj.write_deadband && last !== null && Math.abs(v - last) < obj.write_deadband) {
        setSliderDraft(null);
        return;
      }
      sliderLastWritten.current = v;
      guardedWrite(obj.tag!, v);
      setSliderDraft(null);
    };
    const releaseSlider = () => {
      if (writeOnRelease && sliderDraft !== null) commitSlider(sliderDraft);
    };
    const commonInput = {
      type: "range" as const,
      min, max,
      step: obj.step ?? 1,
      value: sliderDraft ?? rawVal,
      disabled: readOnly,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = Number(e.target.value);
        if (writeOnRelease) setSliderDraft(v);
        else commitSlider(v);
      },
      onMouseUp: releaseSlider,
      onTouchEnd: releaseSlider,
      onKeyUp: releaseSlider,
    };

    if (isVertical) {
      // Rotazione e non `writing-mode: vertical-rl`: quest'ultimo è lo standard
      // moderno ma vuole Chrome 120+/WebKit 17.4+, e sul browser dei pannelli
      // Yocto non sappiamo cosa ci sia — dove non è supportato lo slider
      // resterebbe orizzontale, cioè il difetto di partenza ma più difficile da
      // riconoscere. La rotazione funziona su qualunque motore e conserva il
      // comportamento nativo su touch e tastiera.
      //
      // -90° e non +90°: porta l'estremo `min` (a sinistra) in basso, che è
      // dove ci si aspetta il minimo di uno slider verticale.
      const labelH = obj.label ? 18 : 0;
      const valueH = obj.show_value !== false ? 18 : 0;
      // La lunghezza del controllo ruotato va data in pixel: dopo la rotazione
      // il riquadro di layout resta quello di prima, quindi non può ricavarla
      // da un `height: 100%` del contenitore.
      const trackLen = Math.max(24, h - labelH - valueH - 8);
      return (
        <>
          {bgLayer(obj.x, obj.y, w, h, 4)}
          <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 2, height: "100%", boxSizing: "border-box",
          }}>
            {obj.label && (
              <span style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 11, textAlign: "center" }}>
                {obj.label}
              </span>
            )}
            <div style={{
              height: trackLen, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <input
                {...commonInput}
                style={{
                  width: trackLen,
                  transform: "rotate(-90deg)",
                  accentColor: accent,
                  cursor: readOnly ? "default" : "pointer",
                }}
              />
            </div>
            {obj.show_value !== false && (
              <span style={{ color: "var(--brand-text, #e2e8f0)", fontSize: 12, textAlign: "center" }}>
                {valueText}
              </span>
            )}
          </div>
          </foreignObject>
        </>
      );
    }

    const foH = h + (obj.label ? 20 : 0);
    return (
      <>
        {bgLayer(obj.x, obj.y, w, foH, 4)}
        <foreignObject x={obj.x} y={obj.y} width={w} height={foH}>
        <div
          style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 0" }}
        >
          {obj.label && (
            <span style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 11, textAlign: "center" }}>
              {obj.label}
            </span>
          )}
          <input
            {...commonInput}
            style={{ width: "100%", accentColor: accent, cursor: readOnly ? "default" : "pointer" }}
          />
          {obj.show_value !== false && (
            <span style={{ color: "var(--brand-text, #e2e8f0)", fontSize: 12, textAlign: "center" }}>
              {valueText}
            </span>
          )}
        </div>
        </foreignObject>
      </>
    );
  }

  // ── SETPOINT ─────────────────────────────────────────────────────────────────
  // Numeric value entry with explicit confirm (button + Enter) — unlike
  // `slider`, which writes on every drag. Shows the live current value
  // alongside the input so the operator can see what they're changing from.

  if (obj.type === "setpoint") {
    const w = obj.width ?? 140; const h = obj.height ?? 56;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const currentVal = tv ? Number(tv.value) : undefined;
    const unit = obj.unit ? ` ${obj.unit}` : "";
    const readOnly = !!obj.read_only;

    if (isEditMode) {
      // Static look-alike of the real layout (label / "Attuale: …" / input +
      // "✓" button) instead of a generic box — same tagValues already in
      // scope, same pattern gauge/text/progress_bar use to show live values
      // in edit-mode without any new polling. No foreignObject, no <input>,
      // nothing writable: purely decorative shapes.
      const hasLabel = !!obj.label;
      const labelY = obj.y + 13;
      const currentY = obj.y + (hasLabel ? 27 : 13);
      const rowY = currentY + 6;
      const rowH = Math.max(18, h - (rowY - obj.y) - 4);
      const btnW = 22;
      const inputW = Math.max(20, w - btnW - 12);
      const currentText = currentVal !== undefined && Number.isFinite(currentVal) ? `${currentVal}${unit}` : "—";
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4} fill={obj.bg_color ?? "#0f172a"} stroke={selected ? "#facc15" : "#334155"} strokeWidth={selected ? 2 : 1} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          {hasLabel && (
            <text x={obj.x + 4} y={labelY} fill="#94a3b8" fontSize={11} style={{ pointerEvents: "none" }}>{obj.label}</text>
          )}
          <text x={obj.x + 4} y={currentY} fill="#64748b" fontSize={10} style={{ pointerEvents: "none" }}>
            {t("viewer.currentValue")} {currentText}
          </text>
          <rect x={obj.x + 4} y={rowY} width={inputW} height={rowH} rx={4} fill="#0f172a" stroke="#334155" style={{ pointerEvents: "none" }} />
          <text x={obj.x + 4 + 6} y={rowY + rowH / 2} dominantBaseline="central" fill="#e2e8f0" fontSize={12} style={{ pointerEvents: "none" }}>
            {currentVal !== undefined && Number.isFinite(currentVal) ? currentVal : ""}
          </text>
          <rect x={obj.x + 4 + inputW + 4} y={rowY} width={btnW} height={rowH} rx={4} fill="#3b82f6" style={{ pointerEvents: "none" }} />
          <text x={obj.x + 4 + inputW + 4 + btnW / 2} y={rowY + rowH / 2} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={12} style={{ pointerEvents: "none" }}>✓</text>
        </g>
      );
    }

    const commit = () => {
      if (setpointDraft === null || !obj.tag) return;
      const n = Number(setpointDraft);
      if (!Number.isFinite(n)) return; // leave the draft as-is so the operator can fix it
      guardedWrite(obj.tag, n);
      setSetpointDraft(null);
    };

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}>
        {selRect(obj.x, obj.y, w, h)}
        {bgLayer(obj.x, obj.y, w, h, 4)}
        <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "4px 2px", boxSizing: "border-box", height: "100%" }}>
            {obj.label && (
              <span style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 11 }}>{obj.label}</span>
            )}
            <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 10 }}>
              {t("viewer.currentValue")} {currentVal !== undefined && Number.isFinite(currentVal) ? `${currentVal}${unit}` : "—"}
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <input
                type="number"
                min={obj.min} max={obj.max} step={obj.step ?? 1}
                disabled={readOnly}
                value={setpointDraft ?? (currentVal !== undefined && Number.isFinite(currentVal) ? currentVal : "")}
                onChange={(e) => setSetpointDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  flex: 1, minWidth: 0, boxSizing: "border-box",
                  background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)",
                  borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "3px 6px", fontSize: 12,
                }}
              />
              <button
                disabled={readOnly || setpointDraft === null}
                onClick={(e) => { e.stopPropagation(); commit(); }}
                title="Scrivi"
                style={{
                  background: "var(--brand-primary, #3b82f6)", border: "none", borderRadius: 4,
                  color: "#fff", cursor: readOnly ? "default" : "pointer", padding: "0 10px", fontSize: 12,
                  opacity: (readOnly || setpointDraft === null) ? 0.5 : 1, flexShrink: 0,
                }}
              >
                ✓
              </button>
              {/* F3.4: tastierino touch — sui pannelli kiosk l'input HTML non
                  è digitabile (nessuna tastiera virtuale di sistema). */}
              {!readOnly && (
                <button
                  onClick={(e) => { e.stopPropagation(); setKeypadOpen(true); }}
                  title={t("keypad.open")}
                  style={{
                    background: "var(--brand-surface-2, #334155)", border: "none", borderRadius: 4,
                    color: "var(--brand-text, #e2e8f0)", cursor: "pointer", padding: "0 8px",
                    fontSize: 13, flexShrink: 0,
                  }}
                >
                  ⌨
                </button>
              )}
            </div>
          </div>
        </foreignObject>
        {keypadOpen && (
          <NumericKeypad
            label={obj.label}
            unit={obj.unit}
            initial={currentVal !== undefined && Number.isFinite(currentVal) ? currentVal : undefined}
            min={obj.min}
            max={obj.max}
            onConfirm={(n) => { setKeypadOpen(false); guardedWrite(obj.tag, n); }}
            onCancel={() => setKeypadOpen(false)}
          />
        )}
      </g>
    );
  }

  // ── CHECKBOX ────────────────────────────────────────────────────────────────

  if (obj.type === "checkbox") {
    const w = obj.width ?? 180; const h = obj.height ?? 32;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const checkedVal = obj.checked_value ?? true;
    const isChecked = tv != null && String(tv.value) === String(checkedVal);

    if (isEditMode) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
           style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          {bgLayer(obj.x, obj.y, w, h, 4)}
          <rect x={obj.x + 2} y={obj.y + h / 2 - 9} width={18} height={18} rx={3}
            fill="#334155" stroke="#64748b" strokeWidth={1.5} />
          <path d={`M ${obj.x + 6} ${obj.y + h / 2} L ${obj.x + 10} ${obj.y + h / 2 + 4} L ${obj.x + 16} ${obj.y + h / 2 - 4}`}
            stroke="#64748b" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <text x={obj.x + 28} y={obj.y + h / 2 + 5} fill="#e2e8f0" fontSize={13}>
            {obj.label ?? "Checkbox"}
          </text>
        </g>
      );
    }

    // View mode: foreignObject
    return (
      <>
        {bgLayer(obj.x, obj.y, w, h, 4)}
        <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, height: "100%", cursor: obj.read_only ? "default" : "pointer" }}
          onClick={() => {
            if (obj.read_only || !obj.tag) return;
            guardedWrite(obj.tag, isChecked ? (obj.unchecked_value ?? false) : checkedVal);
          }}
        >
          <div style={{
            width: 18, height: 18, borderRadius: 3, flexShrink: 0,
            background: isChecked ? (obj.fill ?? "var(--brand-primary, #3b82f6)") : "transparent",
            border: `2px solid ${isChecked ? (obj.fill ?? "var(--brand-primary, #3b82f6)") : "#64748b"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {isChecked && (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M2 6 L5 9 L10 3" stroke="white" strokeWidth="2" fill="none"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <span style={{ color: "var(--brand-text, #e2e8f0)", fontSize: 13, userSelect: "none" }}>
            {obj.label ?? ""}
          </span>
          {tv && tv.quality !== "Good" && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              background: qualityColor(tv.quality), display: "inline-block" }} />
          )}
        </div>
        </foreignObject>
      </>
    );
  }

  // ── RADIO ───────────────────────────────────────────────────────────────────

  if (obj.type === "radio") {
    const opts = obj.options ?? [];
    const w = obj.width ?? 180;
    const isH = obj.orientation === "horizontal";
    const itemW = isH ? Math.floor(w / Math.max(opts.length, 1)) : w;
    const itemH = 28;
    const totalH = obj.height ?? (isH ? itemH + (obj.label ? 20 : 0) : opts.length * itemH + (obj.label ? 20 : 0));
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const currentVal = tv ? tv.value : null;

    if (isEditMode) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
           style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, totalH)}
          {bgLayer(obj.x, obj.y, w, totalH, 4)}
          {obj.label && <text x={obj.x} y={obj.y + 12} fill="#94a3b8" fontSize={11}>{obj.label}</text>}
          {opts.map((opt, i) => {
            const ox = isH ? obj.x + i * itemW : obj.x;
            const oy = obj.y + (obj.label ? 20 : 0) + (isH ? 0 : i * itemH);
            return (
              <g key={i}>
                <circle cx={ox + 9} cy={oy + 9} r={8} fill="transparent" stroke="#64748b" strokeWidth={1.5} />
                {i === 0 && <circle cx={ox + 9} cy={oy + 9} r={4} fill="#3b82f6" />}
                <text x={ox + 24} y={oy + 14} fill="#e2e8f0" fontSize={13}>{opt.label}</text>
              </g>
            );
          })}
        </g>
      );
    }

    // View mode: foreignObject
    return (
      <>
        {bgLayer(obj.x, obj.y, w, totalH, 4)}
        <foreignObject x={obj.x} y={obj.y} width={w} height={totalH}>
        <div
          style={{ display: "flex", flexDirection: "column", gap: 2 }}
        >
          {obj.label && (
            <span style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 11, marginBottom: 4 }}>{obj.label}</span>
          )}
          <div style={{ display: "flex", flexDirection: isH ? "row" : "column", gap: isH ? 12 : 4 }}>
            {opts.map((opt, i) => (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 6, cursor: obj.read_only ? "default" : "pointer" }}>
                <input
                  type="radio"
                  name={obj.id}
                  disabled={obj.read_only}
                  checked={currentVal !== null && String(currentVal) === String(opt.value)}
                  onChange={() => guardedWrite(obj.tag!, opt.value as string | number | boolean)}
                  style={{ accentColor: obj.fill ?? "var(--brand-primary, #3b82f6)", cursor: obj.read_only ? "default" : "pointer" }}
                />
                <span style={{ color: "var(--brand-text, #e2e8f0)", fontSize: 13, userSelect: "none" }}>
                  {opt.label}
                </span>
              </label>
            ))}
          </div>
        </div>
        </foreignObject>
      </>
    );
  }

  // ── DATA TABLE ──────────────────────────────────────────────────────────────

  if (obj.type === "table") {
    const rows = obj.table_rows ?? [];
    const w = obj.width ?? 300;
    const rowH = 24;
    const headerH = 26;
    const totalH = obj.height ?? (headerH + rows.length * rowH + 2);
    const colLabel = w * 0.42;
    const colValue = w * 0.43;

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
         style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, totalH)}
        {applyTransform(obj, w, totalH, <>
          {/* Outer border */}
          <rect x={obj.x} y={obj.y} width={w} height={totalH} rx={4}
            fill={obj.bg_color ?? "#1e293b"} stroke={selected ? "#facc15" : "#334155"} strokeWidth={selected ? 2 : 1} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={totalH}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          {/* Header */}
          <rect x={obj.x} y={obj.y} width={w} height={headerH} rx={4}
            fill="#0f172a" style={{ pointerEvents: "none" }} />
          <rect x={obj.x} y={obj.y + 4} width={w} height={headerH - 4}
            fill="#0f172a" style={{ pointerEvents: "none" }} />
          <text x={obj.x + 10} y={obj.y + 17}
            fill="#64748b" fontSize={11} fontWeight={700} letterSpacing={0.5}
            style={{ pointerEvents: "none" }}>
            {obj.label ?? "DATI"}
          </text>
          <text x={obj.x + colLabel + 10} y={obj.y + 17}
            fill="#64748b" fontSize={11} fontWeight={700}
            style={{ pointerEvents: "none" }}>
            VALORE
          </text>
          <text x={obj.x + colLabel + colValue + 4} y={obj.y + 17}
            fill="#64748b" fontSize={11} fontWeight={700}
            style={{ pointerEvents: "none" }}>
            Q
          </text>
          {/* Column dividers */}
          <line x1={obj.x + colLabel} y1={obj.y} x2={obj.x + colLabel} y2={obj.y + totalH}
            stroke="#334155" strokeWidth={1} style={{ pointerEvents: "none" }} />
          <line x1={obj.x + colLabel + colValue} y1={obj.y}
            x2={obj.x + colLabel + colValue} y2={obj.y + totalH}
            stroke="#334155" strokeWidth={1} style={{ pointerEvents: "none" }} />
          {/* Rows */}
          {rows.map((row, i) => {
            const ry = obj.y + headerH + i * rowH;
            const tv = tagValues[row.tag];
            const valText = tv != null ? formatValue(tv.value, row.format) : "—";
            const isEven = i % 2 === 0;
            return (
              <g key={i}>
                {isEven && (
                  <rect x={obj.x + 1} y={ry} width={w - 2} height={rowH}
                    fill="#ffffff08" style={{ pointerEvents: "none" }} />
                )}
                <text x={obj.x + 8} y={ry + 16} fill="#cbd5e1" fontSize={12}
                  style={{ pointerEvents: "none" }}>
                  {row.label}
                </text>
                <text x={obj.x + colLabel + 8} y={ry + 16}
                  fill={tv ? (tv.quality === "Good" ? "var(--brand-text, #e2e8f0)" : tv.quality === "Bad" ? "#ef4444" : "#eab308") : "var(--brand-border, #475569)"}
                  fontSize={12} style={{ pointerEvents: "none" }}>
                  {valText}
                </text>
                {tv && (
                  <circle cx={obj.x + colLabel + colValue + 10} cy={ry + rowH / 2} r={4}
                    fill={qualityColor(tv.quality)} style={{ pointerEvents: "none" }} />
                )}
                {i < rows.length - 1 && (
                  <line x1={obj.x} y1={ry + rowH} x2={obj.x + w} y2={ry + rowH}
                    stroke="#1e293b" strokeWidth={1} style={{ pointerEvents: "none" }} />
                )}
              </g>
            );
          })}
          {/* Empty state */}
          {rows.length === 0 && (
            <text x={obj.x + w / 2} y={obj.y + headerH + 20}
              textAnchor="middle" fill="#475569" fontSize={12}
              style={{ pointerEvents: "none" }}>
              Nessuna riga — configura nelle proprietà
            </text>
          )}
        </>)}
      </g>
    );
  }

  // ── TREND ───────────────────────────────────────────────────────────────────

  if (obj.type === "trend") {
    const w = obj.width ?? 360;
    const h = obj.height ?? 180;
    // Edit mode: static placeholder (no polling, no canvas — drag-friendly).
    // View mode: full TrendCanvas with polling. The handleMouseDown captures
    // clicks even in view mode so the operator can still "select" if needed.
    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
         style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
        {isEditMode ? (
          <>
            {/* Il placeholder statico rispetta bg_color/bg_image: senza,
                l'anteprima in editor non mostrava mai lo sfondo configurato
                (il rendering vero via TrendCanvas esiste solo in runtime). */}
            <rect x={obj.x} y={obj.y} width={w} height={h} rx={4}
              fill={obj.bg_color ?? "#0f172a"} stroke={selected ? "#facc15" : "#334155"}
              strokeWidth={selected ? 2 : 1} />
            {obj.bg_image && (
              <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
                preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
            )}
            <text x={obj.x + w / 2} y={obj.y + h / 2 - 6}
              textAnchor="middle" fill="#64748b" fontSize={12}
              style={{ pointerEvents: "none" }}>
              Trend{obj.tag ? ` — ${obj.tag}` : ""}
            </text>
            <text x={obj.x + w / 2} y={obj.y + h / 2 + 10}
              textAnchor="middle" fill="#475569" fontSize={10}
              style={{ pointerEvents: "none" }}>
              {obj.window_s ?? 60}s · autofit
            </text>
          </>
        ) : (
          <>
            <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
              <TrendCanvas
                tags={[obj.tag ?? "", ...(obj.extra_tags ?? [])].filter(Boolean)}
                windowS={obj.window_s ?? 60}
                width={w}
                height={h}
                lineColor={obj.line_color ?? "var(--brand-primary, #3b82f6)"}
                yMin={trendZoom?.yLo !== undefined ? trendZoom.yLo : obj.y_min}
                yMax={trendZoom?.yHi !== undefined ? trendZoom.yHi : obj.y_max}
                opcuaBackfill={obj.opcua_backfill}
                seriesStyles={obj.trend_series_styles}
                dtDateOrder={obj.trend_dt_date_order}
                dtSeparator={obj.trend_dt_separator}
                dtTimeFormat={obj.trend_dt_time_format}
                dtShowSeconds={obj.trend_dt_show_seconds}
                dtShowYear={obj.trend_dt_show_year}
                dtTwoLines={obj.trend_dt_two_lines}
                dtAlwaysShowDate={obj.trend_dt_always_show_date}
                showThresholds={obj.trend_show_thresholds}
                warnLow={obj.warn_low}
                warnHigh={obj.warn_high}
                alarmLow={obj.alarm_low}
                alarmHigh={obj.alarm_high}
                showAlarmMarkers={obj.trend_show_alarm_markers}
                logScale={obj.trend_log_scale}
                yUnit={obj.unit}
                bgColor={obj.bg_color}
                bgImage={obj.bg_image}
                axisColor={obj.axis_color}
                gridColor={obj.grid_color}
                fromMs={trendZoom?.fromMs}
                toMs={trendZoom?.toMs}
                onRangeSelect={(fromMs, toMs, yLo, yHi) => setTrendZoom({ fromMs, toMs, yLo, yHi })}
                zoomed={trendZoom !== null}
                onResetZoom={() => setTrendZoom(null)}
                panStepS={obj.pan_step_s}
              />
            </foreignObject>
            {onExpandTrend && (
              <g
                style={{ cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); onExpandTrend(obj); }}
              >
                <title>Espandi trend</title>
                <rect
                  x={obj.x + w - 20} y={obj.y + 2}
                  width={17} height={14} rx={3}
                  fill="#1e293b" fillOpacity={0.85}
                  stroke="#334155" strokeWidth={0.5}
                />
                <text
                  x={obj.x + w - 11.5} y={obj.y + 9}
                  textAnchor="middle" dominantBaseline="middle"
                  fill="#64748b" fontSize={9}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >⤢</text>
              </g>
            )}
          </>
        )}
      </g>
    );
  }

  // ── XY PLOT ──────────────────────────────────────────────────────────────────
  // Live point + trailing trail against two tags (trajectory/position), not a
  // time series — see XyPlotCanvas for the sampling/trail logic.

  if (obj.type === "xy_plot") {
    const w = obj.width ?? 200; const h = obj.height ?? 200;

    if (isEditMode) {
      // Static axes + a fixed center point instead of the generic box — same
      // frame (PAD) as XyPlotCanvas below, no sampling/trail (that needs a
      // live tick interval, not appropriate for a static edit-mode preview).
      const PAD = 22;
      const plotW = Math.max(1, w - PAD * 2);
      const plotH = Math.max(1, h - PAD * 2);
      const xMinText = obj.xy_x_min !== undefined ? String(obj.xy_x_min) : "auto";
      const xMaxText = obj.xy_x_max !== undefined ? String(obj.xy_x_max) : "auto";
      const yMinText = obj.xy_y_min !== undefined ? String(obj.xy_y_min) : "auto";
      const yMaxText = obj.xy_y_max !== undefined ? String(obj.xy_y_max) : "auto";
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4} fill={obj.bg_color ?? "#0f172a"} stroke={selected ? "#facc15" : "#334155"} strokeWidth={selected ? 2 : 1} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          {obj.tag && obj.y_tag && (
            <text x={obj.x + w / 2} y={obj.y + 12} textAnchor="middle" fill="#64748b" fontSize={9} style={{ pointerEvents: "none" }}>
              {obj.tag} / {obj.y_tag}
            </text>
          )}
          <rect x={obj.x + PAD} y={obj.y + PAD} width={plotW} height={plotH} fill="none" stroke="#334155" style={{ pointerEvents: "none" }} />
          <circle cx={obj.x + PAD + plotW / 2} cy={obj.y + PAD + plotH / 2} r={4} fill={obj.line_color ?? "#3b82f6"} style={{ pointerEvents: "none" }} />
          <text x={obj.x + PAD} y={obj.y + h - 6} fill="#475569" fontSize={9} style={{ pointerEvents: "none" }}>{xMinText}</text>
          <text x={obj.x + PAD + plotW} y={obj.y + h - 6} textAnchor="end" fill="#475569" fontSize={9} style={{ pointerEvents: "none" }}>{xMaxText}</text>
          <text x={obj.x + 2} y={obj.y + PAD + 8} fill="#475569" fontSize={9} style={{ pointerEvents: "none" }}>{yMaxText}</text>
          <text x={obj.x + 2} y={obj.y + PAD + plotH} fill="#475569" fontSize={9} style={{ pointerEvents: "none" }}>{yMinText}</text>
        </g>
      );
    }

    const xv = obj.tag ? tagValues[obj.tag] : undefined;
    const yv = obj.y_tag ? tagValues[obj.y_tag] : undefined;

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}>
        {selRect(obj.x, obj.y, w, h)}
        <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
          <XyPlotCanvas
            xValue={xv ? Number(xv.value) : undefined}
            yValue={yv ? Number(yv.value) : undefined}
            trailS={obj.xy_trail_s}
            width={w}
            height={h}
            lineColor={obj.line_color}
            xMin={obj.xy_x_min}
            xMax={obj.xy_x_max}
            yMin={obj.xy_y_min}
            yMax={obj.xy_y_max}
            bgColor={obj.bg_color}
            bgImage={obj.bg_image}
          />
        </foreignObject>
      </g>
    );
  }

  // ── TEXT LIST ────────────────────────────────────────────────────────────────

  if (obj.type === "text_list") {
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const liveVal = tv?.value;
    const entry = matchTextListEntry(obj.text_list_entries, liveVal);
    const label = entry ? entry.label : (obj.text_list_default ?? (liveVal !== undefined ? String(liveVal) : "N/D"));
    const textFill = entry ? (entry.color ?? obj.color ?? "#f1f5f9") : (obj.text_list_default_color ?? "var(--brand-text-muted, #94a3b8)");
    const size = obj.font_size ?? 16;
    const anchor = obj.text_anchor ?? "middle";
    const cx = obj.x + (obj.width ?? 120) / 2;
    const cy = obj.y + (obj.height ?? 32) / 2;
    const tx = anchor === "middle" ? cx : anchor === "end" ? obj.x + (obj.width ?? 120) : obj.x;
    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, obj.width ?? 120, obj.height ?? 32)}
        {bgLayer(obj.x, obj.y, obj.width ?? 120, obj.height ?? 32, 4)}
        <text x={tx} y={cy + size / 3}
          fill={textFill} fontSize={size}
          fontFamily={obj.font_family} fontWeight={obj.font_weight as any ?? "normal"}
          fontStyle={obj.font_style ?? "normal"} textAnchor={anchor}
          style={{ pointerEvents: "none", ...transitionStyle(obj) }}>
          {label}
        </text>
        {tv && obj.quality_dot !== false && <QDot x={obj.x + 2} y={obj.y + 2} quality={tv.quality} />}
      </g>
    );
  }

  // ── BAR CHART ────────────────────────────────────────────────────────────────

  if (obj.type === "bar_chart") {
    const w = obj.width ?? 240; const h = obj.height ?? 180;
    const series = obj.bar_series ?? [];
    const orient = obj.bar_orientation ?? "vertical";
    const gap = clamp(obj.bar_gap ?? 0.2, 0, 0.9);
    const showValues = obj.bar_show_values !== false;
    const showLabels = obj.bar_show_labels !== false;
    const showThresh = obj.bar_show_thresholds !== false;
    const padT = 20; const padB = showLabels ? 28 : 8; const padL = 8; const padR = 8;
    const plotW = w - padL - padR; const plotH = h - padT - padB;
    const n = series.length || 1;
    const slotW = plotW / n;
    const barW = slotW * (1 - gap);

    if (isEditMode) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4} fill={obj.bg_color ?? "#0f172a"} stroke={selected ? "#facc15" : "#334155"} strokeWidth={selected ? 2 : 1} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          <text x={obj.x + w / 2} y={obj.y + h / 2} textAnchor="middle" fill="#64748b" fontSize={12} style={{ pointerEvents: "none" }}>
            Bar Chart — {series.length} serie
          </text>
        </g>
      );
    }

    const baseX = obj.x + padL; const baseY = obj.y + padT;
    const axisY = baseY + plotH;

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
        <rect x={obj.x} y={obj.y} width={w} height={h} rx={4} fill={obj.bg_color ?? "#0f172a"} stroke={selected ? "#facc15" : "#334155"} strokeWidth={selected ? 2 : 1} />
        {obj.bg_image && (
          <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
            preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
        )}
        <line x1={baseX} y1={baseY} x2={baseX} y2={axisY} stroke="#334155" strokeWidth={1} />
        <line x1={baseX} y1={axisY} x2={baseX + plotW} y2={axisY} stroke="#334155" strokeWidth={1} />
        {/* F0.2: bar_y_label esisteva nello schema ma non era mai disegnato. */}
        {obj.bar_y_label && (
          <text x={obj.x + 10} y={baseY + plotH / 2} textAnchor="middle" fill="#94a3b8" fontSize={10}
            transform={`rotate(-90 ${obj.x + 10} ${baseY + plotH / 2})`}
            style={{ pointerEvents: "none" }}>
            {obj.bar_y_label}
          </text>
        )}
        {series.map((s, i) => {
          const tv = s.tag ? tagValues[s.tag] : undefined;
          const val = tv ? Number(tv.value) : 0;
          const lo = s.min ?? obj.min ?? 0; const hi = s.max ?? obj.max ?? 100;
          const range = hi - lo;
          const pct = range === 0 ? 0 : clamp((val - lo) / range, 0, 1);
          if (orient === "vertical") {
            const bx = baseX + i * slotW + (slotW - barW) / 2;
            const bh = plotH * pct;
            const by = axisY - bh;
            return (
              <g key={i}>
                <rect x={bx} y={by} width={barW} height={bh} fill={s.color ?? PALETTE[i % PALETTE.length]} rx={2} style={transitionStyle(obj)} />
                {showValues && <text x={bx + barW / 2} y={Math.max(by - 3, baseY + 10)} textAnchor="middle" fill="#e2e8f0" fontSize={10} style={{ pointerEvents: "none" }}>{val.toFixed(1)}{obj.unit ?? ""}</text>}
                {showLabels && <text x={bx + barW / 2} y={axisY + 14} textAnchor="middle" fill="#94a3b8" fontSize={10} style={{ pointerEvents: "none" }}>{s.label}</text>}
              </g>
            );
          } else {
            const bh2 = slotW * (1 - gap); const bw2 = plotW * pct;
            const by2 = baseY + i * slotW + (slotW - bh2) / 2;
            return (
              <g key={i}>
                <rect x={baseX} y={by2} width={bw2} height={bh2} fill={s.color ?? PALETTE[i % PALETTE.length]} rx={2} style={transitionStyle(obj)} />
                {showValues && <text x={baseX + bw2 + 3} y={by2 + bh2 / 2 + 4} fill="#e2e8f0" fontSize={10} style={{ pointerEvents: "none" }}>{val.toFixed(1)}{obj.unit ?? ""}</text>}
                {showLabels && <text x={baseX - 3} y={by2 + bh2 / 2 + 4} textAnchor="end" fill="#94a3b8" fontSize={10} style={{ pointerEvents: "none" }}>{s.label}</text>}
              </g>
            );
          }
        })}
        {showThresh && orient === "vertical" && (obj.warn_high !== undefined) && (() => {
          const lo2 = obj.min ?? 0; const hi2 = obj.max ?? 100;
          const wy = axisY - plotH * clamp((obj.warn_high - lo2) / (hi2 - lo2), 0, 1);
          return <line key="wh" x1={baseX} y1={wy} x2={baseX + plotW} y2={wy} stroke="#f59e0b" strokeWidth={1} strokeDasharray="4,2" />;
        })()}
        {showThresh && orient === "vertical" && (obj.alarm_high !== undefined) && (() => {
          const lo2 = obj.min ?? 0; const hi2 = obj.max ?? 100;
          const ay = axisY - plotH * clamp((obj.alarm_high - lo2) / (hi2 - lo2), 0, 1);
          return <line key="ah" x1={baseX} y1={ay} x2={baseX + plotW} y2={ay} stroke="#ef4444" strokeWidth={1} strokeDasharray="4,2" />;
        })()}
      </g>
    );
  }

  // ── PIE / DONUT CHART ────────────────────────────────────────────────────────

  if (obj.type === "pie_chart") {
    const w = obj.width ?? 200; const h = obj.height ?? 200;
    const slices = obj.pie_slices ?? [];
    const mode = obj.pie_mode ?? "pie";
    const innerR = mode === "donut" ? clamp(obj.pie_inner_ratio ?? 0.5, 0.1, 0.9) : 0;
    const showLabels = obj.pie_show_labels !== false;
    const showLegend = obj.pie_show_legend === true;
    const legendH = showLegend ? Math.min(slices.length * 14 + 4, 60) : 0;
    const chartH = h - legendH;
    const cx2 = obj.x + w / 2; const cy2 = obj.y + chartH / 2;
    const r = Math.min(w, chartH) / 2 - 6;

    if (isEditMode) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4} fill={obj.bg_color ?? "#0f172a"} stroke={selected ? "#facc15" : "#334155"} strokeWidth={selected ? 2 : 1} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          <circle cx={cx2} cy={cy2} r={r} fill="none" stroke="#334155" strokeWidth={2} />
          {mode === "donut" && <circle cx={cx2} cy={cy2} r={r * innerR} fill="#0f172a" />}
          <text x={cx2} y={cy2 + 4} textAnchor="middle" fill="#64748b" fontSize={11} style={{ pointerEvents: "none" }}>
            {mode === "donut" ? "Donut" : "Pie"} — {slices.length} slice
          </text>
        </g>
      );
    }

    // View mode: no slices configured → render nothing.
    if (slices.length === 0) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4} fill={obj.bg_color ?? "#0f172a"} stroke="#1e293b" />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          <text x={cx2} y={cy2 + 4} textAnchor="middle" fill="#475569" fontSize={11} style={{ pointerEvents: "none" }}>Nessun dato</text>
        </g>
      );
    }

    const values = slices.map((s) => Math.max(0, Number(s.tag ? (tagValues[s.tag]?.value ?? 0) : 0)));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    let angle = -Math.PI / 2;

    const paths = slices.map((s, i) => {
      const pct = values[i] / total;
      const sweep = pct * 2 * Math.PI;
      const x1 = cx2 + r * Math.cos(angle); const y1 = cy2 + r * Math.sin(angle);
      angle += sweep;
      const x2 = cx2 + r * Math.cos(angle); const y2 = cy2 + r * Math.sin(angle);
      const large = sweep > Math.PI ? 1 : 0;
      let d: string;
      if (mode === "donut") {
        const ir = r * innerR;
        const ix1 = cx2 + ir * Math.cos(angle - sweep); const iy1 = cy2 + ir * Math.sin(angle - sweep);
        const ix2 = cx2 + ir * Math.cos(angle); const iy2 = cy2 + ir * Math.sin(angle);
        d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${ir} ${ir} 0 ${large} 0 ${ix1} ${iy1} Z`;
      } else {
        d = `M ${cx2} ${cy2} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
      }
      const midAngle = angle - sweep / 2;
      const labelR = r * (mode === "donut" ? (1 + innerR) / 2 : 0.65);
      return { d, color: s.color ?? PALETTE[i % PALETTE.length], pct, midAngle, labelR, label: s.label, key: i };
    });

    const centerTag = obj.pie_center_tag ? tagValues[obj.pie_center_tag] : undefined;
    const centerText = centerTag
      ? (obj.pie_center_format ? obj.pie_center_format.replace("{value}", String(centerTag.value)) : String(centerTag.value))
      : (obj.pie_center_text ?? "");

    // SVG arc is degenerate when a single slice covers exactly 360°
    // (start == end point). Detect and replace with a <circle>.
    const singleVisible = paths.filter((p) => p.pct > 0);
    const isFullCircle = singleVisible.length === 1 && singleVisible[0].pct >= 0.9999;

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
        {bgLayer(obj.x, obj.y, w, h, 4)}
        {isFullCircle ? (
          <>
            <circle cx={cx2} cy={cy2} r={r} fill={singleVisible[0].color} />
            {mode === "donut" && <circle cx={cx2} cy={cy2} r={r * innerR - 1} fill="#0f172a" />}
            {showLabels && <text x={cx2} y={cy2 + 4} textAnchor="middle" fill="#fff" fontSize={10} fontWeight="bold" style={{ pointerEvents: "none" }}>100%</text>}
          </>
        ) : paths.map(({ d, color, pct, midAngle, labelR, key }) => (
          <g key={key}>
            <path d={d} fill={color} stroke="#0f172a" strokeWidth={1} />
            {showLabels && pct > 0.05 && (
              <text
                x={cx2 + labelR * Math.cos(midAngle)}
                y={cy2 + labelR * Math.sin(midAngle) + 4}
                textAnchor="middle" fill="#fff" fontSize={10} fontWeight="bold"
                style={{ pointerEvents: "none" }}>
                {(pct * 100).toFixed(0)}%
              </text>
            )}
          </g>
        ))}
        {!isFullCircle && mode === "donut" && <circle cx={cx2} cy={cy2} r={r * innerR - 1} fill="#0f172a" />}
        {!isFullCircle && mode === "donut" && centerText && (
          <text x={cx2} y={cy2 + 5} textAnchor="middle" fill="#e2e8f0" fontSize={13} fontWeight="bold" style={{ pointerEvents: "none" }}>{centerText}</text>
        )}
        {showLegend && slices.map((s, i) => (
          <g key={i}>
            <rect x={obj.x + 6 + (i % 2) * (w / 2)} y={obj.y + chartH + 4 + Math.floor(i / 2) * 14} width={8} height={8} fill={s.color ?? PALETTE[i % PALETTE.length]} rx={1} />
            <text x={obj.x + 18 + (i % 2) * (w / 2)} y={obj.y + chartH + 11 + Math.floor(i / 2) * 14} fill="#94a3b8" fontSize={9} style={{ pointerEvents: "none" }}>{s.label}</text>
          </g>
        ))}
      </g>
    );
  }

  // ── SPARKLINE ────────────────────────────────────────────────────────────────

  if (obj.type === "data_log") {
    const w = obj.width ?? 380; const h = obj.height ?? 240;
    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
        {bgLayer(obj.x, obj.y, w, h, 4)}
        <rect x={obj.x} y={obj.y} width={w} height={h} rx={4} fill={obj.bg_color ? "transparent" : "var(--brand-bg, #0f172a)"}
          stroke={selected ? "#facc15" : "var(--brand-surface-2, #334155)"} strokeWidth={selected ? 2 : 1}
          style={{ pointerEvents: isEditMode ? undefined : "none" }} />
        {obj.label && (
          <text x={obj.x + 6} y={obj.y + 14} fill="var(--brand-text-muted, #94a3b8)" fontSize={11}
            style={{ pointerEvents: "none" }}>{obj.label}</text>
        )}
        {isEditMode ? (
          <text x={obj.x + w / 2} y={obj.y + h / 2} textAnchor="middle" fill="#64748b" fontSize={12}
            style={{ pointerEvents: "none" }}>
            Data log — {obj.tag || "nessun tag"}
          </text>
        ) : (
          <foreignObject x={obj.x + 4} y={obj.y + (obj.label ? 18 : 4)} width={w - 8} height={h - (obj.label ? 22 : 8)}>
            <DataLogWidget
              tag={obj.tag ?? ""} windowS={obj.window_s ?? 3600}
              pageSize={obj.datalog_page_size ?? 25}
              width={w - 8} height={h - (obj.label ? 22 : 8)}
              decimals={obj.decimals ?? 1} unit={obj.unit} />
          </foreignObject>
        )}
      </g>
    );
  }

  if (obj.type === "kpi_tile") {
    const w = obj.width ?? 180; const h = obj.height ?? 100;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const rawVal = tv ? Number(tv.value) : NaN;
    const valColor =
      (Number.isFinite(rawVal)
        ? thresholdColor(rawVal, obj.alarm_low, obj.warn_low, obj.warn_high, obj.alarm_high)
        : undefined) ?? obj.color ?? "var(--brand-text, #e2e8f0)";
    const windowS = obj.spark_window_s ?? 3600;
    const valueText = Number.isFinite(rawVal)
      ? `${rawVal.toFixed(obj.decimals ?? 1)}`
      : "—";

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
        <rect x={obj.x} y={obj.y} width={w} height={h} rx={6}
          fill={obj.bg_color ?? "var(--brand-surface, #1e293b)"}
          stroke={selected ? "#facc15" : "var(--brand-surface-2, #334155)"} strokeWidth={selected ? 2 : 1} />
        {obj.bg_image && (
          <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
            preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
        )}
        <text x={obj.x + 10} y={obj.y + 16} fill="var(--brand-text-muted, #94a3b8)" fontSize={11}
          style={{ pointerEvents: "none" }}>{obj.label ?? obj.tag ?? "KPI"}</text>
        <text x={obj.x + 10} y={obj.y + 44} fill={valColor} fontSize={26} fontWeight={700}
          style={{ pointerEvents: "none" }}>
          {valueText}
          {obj.unit && <tspan fontSize={12} fill="var(--brand-text-subtle, #64748b)"> {obj.unit}</tspan>}
        </text>
        {!isEditMode && obj.tag && (
          <>
            <foreignObject x={obj.x + w - 74} y={obj.y + 6} width={68} height={18} style={{ pointerEvents: "none" }}>
              <div style={{ textAlign: "right" }}>
                <KpiDelta tag={obj.tag} windowS={windowS} />
              </div>
            </foreignObject>
            <foreignObject x={obj.x + 6} y={obj.y + h - 34} width={w - 12} height={30} style={{ pointerEvents: "none" }}>
              <SparklineWidget
                tag={obj.tag} windowS={windowS} width={w - 12} height={30}
                color={obj.spark_color ?? "var(--brand-primary, #3b82f6)"}
                strokeWidth={1.5} fill fillOpacity={0.15} showLast={false}
                yMin={undefined} yMax={undefined} tagValues={tagValues} />
            </foreignObject>
          </>
        )}
        {isEditMode && (
          <polyline
            points={`${obj.x + 8},${obj.y + h - 12} ${obj.x + w * 0.35},${obj.y + h - 26} ${obj.x + w * 0.6},${obj.y + h - 8} ${obj.x + w - 8},${obj.y + h - 20}`}
            fill="none" stroke={obj.spark_color ?? "var(--brand-primary, #3b82f6)"} strokeWidth={1.5} opacity={0.5}
            style={{ pointerEvents: "none" }} />
        )}
        {tv && obj.quality_dot !== false && <QDot x={obj.x + w - 8} y={obj.y + h - 8} quality={tv.quality} goodColor={obj.quality_dot_good_color} badColor={obj.quality_dot_bad_color} uncertainColor={obj.quality_dot_uncertain_color} />}
      </g>
    );
  }

  if (obj.type === "sparkline") {
    const w = obj.width ?? 120; const h = obj.height ?? 30;
    const color = obj.spark_color ?? "var(--brand-primary, #3b82f6)";
    const strokeW = obj.spark_stroke_width ?? 1.5;
    const windowS = obj.spark_window_s ?? 60;

    if (isEditMode) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={2} fill={obj.bg_color ?? "#0f172a"} stroke={selected ? "#facc15" : "#1e293b"} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          <polyline
            points={`${obj.x + 4},${obj.y + h * 0.6} ${obj.x + w * 0.25},${obj.y + h * 0.3} ${obj.x + w * 0.5},${obj.y + h * 0.7} ${obj.x + w * 0.75},${obj.y + h * 0.2} ${obj.x + w - 4},${obj.y + h * 0.5}`}
            fill="none" stroke={color} strokeWidth={strokeW} opacity={0.6}
            style={{ pointerEvents: "none" }} />
        </g>
      );
    }

    // Runtime: use foreignObject with SparklineCanvas (inline component)
    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}>
        {selRect(obj.x, obj.y, w, h)}
        {bgLayer(obj.x, obj.y, w, h, 2)}
        <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
          <SparklineWidget
            tag={obj.tag ?? ""}
            windowS={windowS}
            width={w}
            height={h}
            color={color}
            strokeWidth={strokeW}
            fill={obj.spark_fill ?? false}
            fillOpacity={obj.spark_fill_opacity ?? 0.2}
            showLast={obj.spark_show_last ?? false}
            yMin={obj.y_min}
            yMax={obj.y_max}
            tagValues={tagValues}
          />
        </foreignObject>
      </g>
    );
  }

  // ── ALARM VIEWER ─────────────────────────────────────────────────────────────

  if (obj.type === "alarm_viewer") {
    const w = obj.width ?? 360; const h = obj.height ?? 160;
    const mode = obj.alarm_viewer_mode ?? "list";
    const maxRows = obj.alarm_viewer_max_rows ?? 5;
    const prefix = obj.alarm_viewer_id_prefix ?? "";
    const allowedSev = obj.alarm_viewer_severities;
    const showAck = obj.alarm_viewer_show_ack !== false;
    const showTs = obj.alarm_viewer_show_ts !== false;
    const showEmpty = obj.alarm_viewer_show_empty !== false;

    if (isEditMode) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4} fill="#0f172a" stroke={selected ? "#facc15" : "#334155"} strokeWidth={selected ? 2 : 1} />
          <text x={obj.x + w / 2} y={obj.y + h / 2} textAnchor="middle" fill="#64748b" fontSize={12} style={{ pointerEvents: "none" }}>
            Alarm Viewer ({mode})
          </text>
        </g>
      );
    }

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}>
        {selRect(obj.x, obj.y, w, h)}
        <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
          <AlarmViewerWidget
            width={w} height={h} mode={mode} maxRows={maxRows}
            prefix={prefix} allowedSev={allowedSev}
            showAck={showAck} showTs={showTs} showEmpty={showEmpty}
            bgColor={obj.alarm_viewer_bg_color}
          />
        </foreignObject>
      </g>
    );
  }

  // ── ALARM BELL ────────────────────────────────────────────────────────────────

  if (obj.type === "alarm_bell") {
    const w = obj.width ?? 130; const h = obj.height ?? 34;

    if (isEditMode) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={h / 2} fill={obj.bg_color ?? "#0f172a"} stroke={selected ? "#facc15" : "#334155"} strokeWidth={selected ? 2 : 1} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          <text x={obj.x + w / 2} y={obj.y + h / 2} textAnchor="middle" dominantBaseline="central" fill="#64748b" fontSize={12} style={{ pointerEvents: "none" }}>
            🔔 Allarmi
          </text>
        </g>
      );
    }

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}>
        {selRect(obj.x, obj.y, w, h)}
        {bgLayer(obj.x, obj.y, w, h, h / 2)}
        <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
          <AlarmBellPanel
            idPrefix={obj.alarm_bell_id_prefix}
            allowedSev={obj.alarm_bell_severities}
            showHistory={obj.alarm_bell_show_history ?? true}
            showShelve={obj.alarm_bell_show_shelve ?? true}
            badgeFill={obj.fill}
          />
        </foreignObject>
      </g>
    );
  }

  // ── ALARM BANNER ──────────────────────────────────────────────────────────────

  if (obj.type === "alarm_banner") {
    const w = obj.width ?? 600; const h = obj.height ?? 32;

    if (isEditMode) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4} fill={obj.bg_color ?? "#0f172a"} stroke={selected ? "#facc15" : "#334155"} strokeWidth={selected ? 2 : 1} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          <text x={obj.x + w / 2} y={obj.y + h / 2} textAnchor="middle" dominantBaseline="central" fill="#64748b" fontSize={12} style={{ pointerEvents: "none" }}>
            Barra Allarmi
          </text>
        </g>
      );
    }

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}>
        {selRect(obj.x, obj.y, w, h)}
        {bgLayer(obj.x, obj.y, w, h, 4)}
        <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
          <AlarmBanner
            idPrefix={obj.alarm_banner_id_prefix}
            allowedSev={obj.alarm_banner_severities}
          />
        </foreignObject>
      </g>
    );
  }

  // ── RECIPE PANEL ────────────────────────────────────────────────────────────

  if (obj.type === "recipe_panel") {
    const w = obj.width ?? 260; const h = obj.height ?? 160;

    if (isEditMode) {
      // Static skeleton (header bar + a few placeholder rows) instead of the
      // generic box — purely decorative, no store access, communicates "a
      // list of things" without pretending to know the real recipe list.
      const rowH = 12; const rowGap = 6; const rowX = obj.x + 8;
      const rowW = w - 16;
      const firstRowY = obj.y + 30;
      const rowCount = Math.max(0, Math.min(3, Math.floor((h - 38) / (rowH + rowGap))));
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4} fill={obj.bg_color ?? "#1e293b"} stroke={selected ? "#facc15" : "#334155"} strokeWidth={selected ? 2 : 1} style={{ pointerEvents: "none" }} />
          {obj.bg_image && (
            <image href={obj.bg_image} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
          )}
          <rect x={obj.x} y={obj.y} width={w} height={20} rx={4} fill="#334155" style={{ pointerEvents: "none" }} />
          <text x={obj.x + 8} y={obj.y + 14} fill="#94a3b8" fontSize={10} style={{ pointerEvents: "none" }}>📋 Ricette</text>
          {Array.from({ length: rowCount }, (_, i) => (
            <rect key={i} x={rowX} y={firstRowY + i * (rowH + rowGap)} width={rowW} height={rowH} rx={3}
              fill="#334155" opacity={0.6} style={{ pointerEvents: "none" }} />
          ))}
        </g>
      );
    }

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}>
        {selRect(obj.x, obj.y, w, h)}
        <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
          <div style={{ width: w, height: h, overflowY: "auto", boxSizing: "border-box", padding: 6, background: obj.bg_color ?? "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
            ...(obj.bg_image ? { backgroundImage: `url(${obj.bg_image})`, backgroundSize: "cover", backgroundPosition: "center" } : {}) }}>
            <RecipePanel idPrefix={obj.recipe_panel_id_prefix} compact />
          </div>
        </foreignObject>
      </g>
    );
  }

  // ── SYMBOL ──────────────────────────────────────────────────────────────────
  // Built-in SCADA symbol rendered inside a 100×100 design viewBox, scaled to
  // the object's width × height. State (off/on/alarm) is derived from tags:
  //   - alarm_tag truthy → alarm
  //   - state_tag truthy → on
  //   - otherwise        → off

  if (obj.type === "symbol") {
    const isCustom = obj.symbol_id?.startsWith("custom:");
    const customEntry = isCustom
      ? customSymbols.find((s) => s.id === obj.symbol_id!.slice(7))
      : undefined;
    const meta = !isCustom && obj.symbol_id ? SYMBOLS[obj.symbol_id] : undefined;
    const w = obj.width  ?? meta?.defaultWidth  ?? 80;
    const h = obj.height ?? meta?.defaultHeight ?? 80;

    if (!meta && !customEntry) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
           style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4}
            fill="#0f172a" stroke={selected ? "#facc15" : "#7f1d1d"} strokeWidth={selected ? 2 : 1} />
          <text x={obj.x + w / 2} y={obj.y + h / 2 + 4}
            textAnchor="middle" fill="#fca5a5" fontSize={11}
            style={{ pointerEvents: "none" }}>
            simbolo?
          </text>
        </g>
      );
    }

    const truthy = (id?: string) => {
      if (!id) return false;
      const tv = tagValues[id];
      if (!tv) return false;
      const v = tv.value;
      if (typeof v === "boolean") return v;
      if (typeof v === "number")  return v !== 0;
      if (typeof v === "string")  return v.trim().length > 0;
      return Boolean(v);
    };
    const state =
      truthy(obj.alarm_tag) ? "alarm" :
      truthy(obj.state_tag) ? "on" : "off";

    const badgeColor =
      state === "alarm" ? (obj.state_alarm_color ?? "#ef4444") :
      state === "on"    ? (obj.state_on_color    ?? "#22c55e") :
                          (obj.state_off_color   ?? "#64748b");

    return (
      <g style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
        {/* Transparent hit-area so the symbol is always clickable/draggable even when
            all visual children have pointerEvents:"none" (same fix as gauge). */}
        <rect x={obj.x} y={obj.y} width={w} height={h} fill="transparent"
          onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
          style={{ cursor: editCursor }} />
        {applyTransform(obj, w, h, <>
          {bgLayer(obj.x, obj.y, w, h, 4)}
          {customEntry ? (
            <image href={customEntry.url} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "none" }} />
          ) : meta!.kind === "builtin" && meta!.render ? (
            <svg x={obj.x} y={obj.y} width={w} height={h} viewBox="0 0 100 100">
              {meta!.render({
                state,
                off:   obj.state_off_color   ?? "#64748b",
                on:    obj.state_on_color    ?? "#22c55e",
                alarm: obj.state_alarm_color ?? "#ef4444",
              })}
            </svg>
          ) : (
            <image href={meta!.path} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "none" }} />
          )}
        </>)}
        {/* Status badge — axis-aligned, outside transform so it stays top-right
            regardless of rotation/flip orientation. */}
        {(obj.state_tag || obj.alarm_tag) && (
          <circle cx={obj.x + w - 7} cy={obj.y + 7} r={6}
            fill={badgeColor} stroke="#0f172a" strokeWidth={1}
            style={{ pointerEvents: "none", ...transitionStyle(obj) }} />
        )}
      </g>
    );
  }

  // ── GRID ────────────────────────────────────────────────────────────────────

  if (obj.type === "grid") {
    const w = obj.width ?? 400;
    const h = obj.height ?? 300;
    const nRows = obj.grid_rows ?? 2;
    const nCols = obj.grid_cols ?? 2;
    const showBorders = obj.grid_show_borders !== false;
    const borderColor = obj.grid_border_color ?? "#64748b";

    // Compute column widths
    const colWidthsDef = (obj.col_widths as number[] | undefined) ?? [];
    const colW: number[] = [];
    for (let c = 0; c < nCols; c++) {
      colW.push(c < colWidthsDef.length ? colWidthsDef[c] : w / nCols);
    }
    // Compute row heights
    const rowHeightsDef = (obj.row_heights as number[] | undefined) ?? [];
    const rowH: number[] = [];
    for (let r = 0; r < nRows; r++) {
      rowH.push(r < rowHeightsDef.length ? rowHeightsDef[r] : h / nRows);
    }
    // Cumulative offsets
    const colX: number[] = [];
    let cx = obj.x;
    for (let c = 0; c < nCols; c++) { colX.push(cx); cx += colW[c]; }
    const rowY: number[] = [];
    let ry = obj.y;
    for (let r = 0; r < nRows; r++) { rowY.push(ry); ry += rowH[r]; }

    // Map from "r-c" to cell definition
    const definedCells = (obj.grid_cells ?? []) as GridCell[];
    const cellMap = new Map<string, GridCell>();
    for (const cell of definedCells) cellMap.set(`${cell.row}-${cell.col}`, cell);

    // Track positions covered by a span (non-origin)
    const covered = new Set<string>();
    for (const cell of definedCells) {
      const rs = cell.rowspan ?? 1;
      const cs = cell.colspan ?? 1;
      for (let rr = cell.row; rr < Math.min(cell.row + rs, nRows); rr++) {
        for (let cc = cell.col; cc < Math.min(cell.col + cs, nCols); cc++) {
          if (rr !== cell.row || cc !== cell.col) covered.add(`${rr}-${cc}`);
        }
      }
    }

    return (
      <g>
        {bgLayer(obj.x, obj.y, w, h, 4)}
        {/* Transparent hit rect for grid-level drag/select */}
        <rect
          x={obj.x} y={obj.y} width={w} height={h}
          fill="transparent"
          stroke={selected ? "#facc15" : showBorders ? borderColor : "none"}
          strokeWidth={selected ? 2 : 1}
          onMouseDown={handleMouseDown}
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: editCursor }}
        />
        {Array.from({ length: nRows }, (_, r) =>
          Array.from({ length: nCols }, (_, c) => {
            const key = `${r}-${c}`;
            if (covered.has(key)) return null;

            const cellDef = cellMap.get(key);
            const rs = cellDef?.rowspan ?? 1;
            const cs = cellDef?.colspan ?? 1;
            let cellW = 0;
            for (let cc = c; cc < Math.min(c + cs, nCols); cc++) cellW += colW[cc];
            let cellH = 0;
            for (let rr = r; rr < Math.min(r + rs, nRows); rr++) cellH += rowH[rr];

            const cellVisible = (() => {
              if (!cellDef) return true;
              if (cellDef.visible_tag && tagValues[cellDef.visible_tag]) {
                const v = tagValues[cellDef.visible_tag].value;
                return typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : String(v).trim().length > 0;
              }
              return cellDef.visible !== false;
            })();
            if (!cellVisible && !isEditMode) return null;

            const isCellSel = isEditMode && selectedCell?.objectId === obj.id
              && selectedCell.row === r && selectedCell.col === c;

            return (
              <g
                key={key}
                style={{ opacity: !cellVisible && isEditMode ? 0.35 : 1 }}
                onMouseDown={(e) => {
                  if (isEditMode) {
                    e.stopPropagation();
                    // Shift+click on a cell of the already-selected grid
                    // extends the cell selection to a rectangular range
                    // anchored on the previously-selected cell. Does NOT
                    // start an object drag (would be confusing while
                    // building a range).
                    if (e.shiftKey && selectedCell?.objectId === obj.id) {
                      onSelectCellRange?.(obj.id, selectedCell.row, selectedCell.col, r, c);
                      return;
                    }
                    onSelect?.(obj.id, e.shiftKey);
                    if (!e.shiftKey) onStartDrag?.(e, obj);
                    onSelectCell?.(obj.id, r, c);
                  } else if (cellDef?.on_press_fn && onScript) {
                    e.stopPropagation();
                    onScript(cellDef.on_press_fn, {});
                  }
                }}
                onMouseEnter={(e) => {
                  // Shift+drag: primary button held + shift → extend range live
                  if (isEditMode && e.shiftKey && e.buttons === 1 && selectedCell?.objectId === obj.id) {
                    onSelectCellRange?.(obj.id, selectedCell.row, selectedCell.col, r, c);
                  }
                }}
                onMouseUp={(e) => {
                  if (!isEditMode && cellDef?.on_release_fn && onScript) {
                    e.stopPropagation();
                    onScript(cellDef.on_release_fn, {});
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <rect
                  x={colX[c]} y={rowY[r]} width={cellW} height={cellH}
                  fill={cellDef?.bg_color ?? "transparent"}
                  stroke={showBorders ? (isCellSel ? "#facc15" : borderColor) : "none"}
                  strokeWidth={isCellSel ? 2 : 1}
                  style={{
                    cursor: isEditMode ? "pointer"
                      : (cellDef?.on_press_fn ? "pointer" : "default"),
                  }}
                />
                {isEditMode && (
                  <rect
                    x={colX[c]} y={rowY[r]} width={cellW} height={cellH}
                    fill="none"
                    stroke={isCellSel ? "#facc15" : "var(--brand-border, #475569)"}
                    strokeWidth={isCellSel ? 1.5 : 1}
                    strokeDasharray="4 3"
                    opacity={isCellSel ? 0.9 : 0.5}
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {!cellDef?.sub && cellDef?.bg_image && (
                  <image
                    href={cellDef.bg_image}
                    x={colX[c]} y={rowY[r]} width={cellW} height={cellH}
                    preserveAspectRatio="xMidYMid slice"
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {cellDef?.sub && renderSubArea(cellDef.sub, colX[c], rowY[r], cellW, cellH, [], r, c, obj.id)}
                {!cellDef?.sub && cellDef?.child && (() => {
                  const child = cellDef.child!;
                  const cw = child.width ?? 100;
                  const ch = child.height ?? 50;
                  const childX = colX[c] + (cellW - cw) / 2;
                  const childY = rowY[r] + (cellH - ch) / 2;
                  const placed = child.type === "line"
                    ? { ...child, x: childX, y: childY,
                        x2: childX + ((child.x2 ?? child.x + 100) - child.x),
                        y2: childY + ((child.y2 ?? child.y) - child.y) }
                    : { ...child, x: childX, y: childY };
                  const isChildSel = isEditMode
                    && selectedCellChild?.objectId === obj.id
                    && selectedCellChild.row === r
                    && selectedCellChild.col === c;
                  return (
                    <>
                      {/* Child visual — always non-interactive in edit mode */}
                      <g style={{ pointerEvents: isEditMode ? "none" : "auto" }}>
                        <SvgObject
                          obj={placed}
                          objects={objects}
                          tagValues={tagValues}
                          selected={false}
                          isEditMode={false}
                          customSymbols={customSymbols}
                          onWriteTag={onWriteTag}
                          onScript={onScript}
                          onNavigate={onNavigate}
                        />
                      </g>
                      {/* Transparent overlay — enables clicking the child when the cell is already selected */}
                      {isEditMode && isCellSel && (
                        <rect
                          x={childX} y={childY} width={cw} height={ch}
                          fill="transparent"
                          style={{ cursor: "pointer" }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            onSelectCellChild?.(obj.id, r, c);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      {/* Teal selection rect around the child when it is the active sub-selection */}
                      {isEditMode && isChildSel && (
                        <rect
                          x={childX - 2} y={childY - 2}
                          width={cw + 4} height={ch + 4}
                          fill="none" stroke="#0d9488"
                          strokeWidth={1.5} strokeDasharray="4 2"
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                    </>
                  );
                })()}
              </g>
            );
          })
        )}

        {/* Multi-cell range overlay — teal dashed rect around the union of
            selected cells. Non-interactive so cells underneath remain clickable. */}
        {isEditMode && selectedCellRange?.objectId === obj.id && (() => {
          const { r1, c1, r2, c2 } = selectedCellRange;
          const safeR1 = Math.max(0, Math.min(nRows - 1, r1));
          const safeR2 = Math.max(0, Math.min(nRows - 1, r2));
          const safeC1 = Math.max(0, Math.min(nCols - 1, c1));
          const safeC2 = Math.max(0, Math.min(nCols - 1, c2));
          const rx = colX[safeC1];
          const ry = rowY[safeR1];
          let rw = 0;
          for (let cc = safeC1; cc <= safeC2; cc++) rw += colW[cc];
          let rh = 0;
          for (let rr = safeR1; rr <= safeR2; rr++) rh += rowH[rr];
          return (
            <rect
              x={rx} y={ry} width={rw} height={rh}
              fill="rgba(20,184,166,0.08)" stroke="#14b8a6"
              strokeWidth={2} strokeDasharray="6 4"
              style={{ pointerEvents: "none" }}
            />
          );
        })()}
      </g>
    );
  }

  // ── IMAGE ───────────────────────────────────────────────────────────────────

  if (obj.type === "image" && obj.src) {
    const w = obj.width ?? 100; const h = obj.height ?? 100;
    return (
      <>
        {selRect(obj.x, obj.y, w, h)}
        {applyTransform(obj, w, h, <>
          {bgLayer(obj.x, obj.y, w, h, 4)}
          <image href={obj.src} x={obj.x} y={obj.y} width={w} height={h}
            style={{ cursor: editCursor }}
            onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
        </>)}
      </>
    );
  }

  // ── Faceplate instance ────────────────────────────────────────────────────
  if (obj.type === "faceplate") {
    const defn = faceplates.find((f) => f.id === obj.faceplate_id);
    // F6.2: i default della definizione riempiono i parametri non forniti.
    const params = defn ? effectiveFaceplateParams(defn, obj.faceplate_params) : (obj.faceplate_params ?? {});
    const w = obj.width ?? 120;
    const h = obj.height ?? 80;

    if (!defn) {
      // Unknown faceplate — show placeholder
      return (
        <>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h}
            fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2"
            style={{ cursor: editCursor }} onMouseDown={handleMouseDown}
            onClick={(e) => e.stopPropagation()} />
          <text x={obj.x + 4} y={obj.y + 14} fill="#f59e0b" fontSize={11} fontFamily="monospace" style={{ pointerEvents: "none" }}>
            {obj.faceplate_id ?? "faceplate"}
          </text>
        </>
      );
    }

    // Substitute `{param}` placeholders in all string fields of a child object.
    // F6.4: gli override per-istanza si applicano DOPO la sostituzione
    // ("link spezzato" rispetto al template, per singolo figlio).
    const substituteParams = (child: SynopticObject) => {
      const sub = substituteFaceplateParams(child, params);
      const over = obj.faceplate_overrides?.[child.id];
      return over ? { ...sub, ...over, id: sub.id, type: sub.type } : sub;
    };
    // F6.4: scaling opzionale dei figli al box dell'istanza (uniforme sui due
    // assi per non distorcere i testi... no: viewBox-like, assi indipendenti,
    // come uno <svg> con preserveAspectRatio="none" — è ciò che l'utente
    // vede ridimensionando il box). Opt-in per retro-compatibilità.
    const defBox = defn ? faceplateDefBBox(defn) : { w, h };
    const scaleTf = obj.faceplate_scale
      ? ` scale(${(w / defBox.w).toFixed(4)}, ${(h / defBox.h).toFixed(4)})`
      : "";

    if (isEditMode) {
      // Edit mode: render the faceplate's own children (same substituteParams
      // as view mode) for a faithful preview — each child shows its own
      // edit-mode rendering, all static, no new polling. Children sit under
      // pointerEvents:none so they never intercept the click; a single
      // transparent hit-rect on top (same size as the faceplate) carries
      // select/drag, with onClick stopPropagation — same pattern as `symbol`/
      // `gauge`'s dedicated hit-area, and the one this block was missing
      // entirely (root cause of "faceplate not selectable from the canvas").
      return (
        <>
          {selRect(obj.x, obj.y, w, h)}
          {bgLayer(obj.x, obj.y, w, h, 4)}
          <g transform={`translate(${obj.x}, ${obj.y})${scaleTf}`} style={{ pointerEvents: "none" }}>
            {defn.objects.map((child, i) => {
              const resolved = substituteParams(child);
              return (
                <SvgObject
                  key={child.id ?? i}
                  obj={resolved}
                  objects={objects}
                  tagValues={tagValues}
                  selected={false}
                  isEditMode={true}
                  customSymbols={customSymbols}
                  faceplates={faceplates}
                  onWriteTag={onWriteTag}
                  onScript={onScript}
                  onNavigate={onNavigate}
                />
              );
            })}
          </g>
          <rect x={obj.x} y={obj.y} width={w} height={h}
            fill="transparent"
            style={{ cursor: "move" }} onMouseDown={handleMouseDown}
            onClick={(e) => e.stopPropagation()} />
          <text x={obj.x + 4} y={obj.y + h - 4} fill="#f59e0b" fontSize={9} fontFamily="monospace" style={{ pointerEvents: "none" }}>
            {defn.label}
          </text>
        </>
      );
    }

    // View mode: render child objects with param substitution at (obj.x, obj.y) offset
    return (
      <g transform={`translate(${obj.x}, ${obj.y})${scaleTf}`} style={{ cursor: "default" }}>
        {bgLayer(0, 0, obj.faceplate_scale ? defBox.w : w, obj.faceplate_scale ? defBox.h : h, 4)}
        {defn.objects.map((child, i) => {
          const resolved = substituteParams(child);
          return (
            <SvgObject
              key={child.id ?? i}
              obj={resolved}
              objects={objects}
              tagValues={tagValues}
              selected={false}
              isEditMode={false}
              customSymbols={customSymbols}
              faceplates={faceplates}
              onWriteTag={onWriteTag}
              onScript={onScript}
              onNavigate={onNavigate}
            />
          );
        })}
      </g>
    );
  }

  return null;
}
