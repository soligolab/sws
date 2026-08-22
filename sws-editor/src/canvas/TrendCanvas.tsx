import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import type { AlarmEvent, BucketSample, Sample, TrendSeriesStyle } from "@/types";

/**
 * Multi-tag trend chart on a 2D canvas. Polls GET /api/history/:tag for each
 * series every `pollMs`, re-fits the axes, and redraws.
 *
 * Drawing:
 * - Background frame + grid (4 horizontal divisions).
 * - One line per series in its assigned colour.
 * - Y-axis labels on the right (5 ticks with numeric values).
 * - X-axis labels along the bottom (4 ticks as HH:MM:SS, local time).
 * - Top-left legend listing each tag with its colour swatch.
 * - On mouse hover: crosshair line + per-series value box at the nearest
 *   sample timestamp.
 *
 * Bool samples are coerced to 0/1; strings are parsed to f64 best-effort.
 * Y range: hard `[yMin, yMax]` if both > 0 (config), otherwise autofit.
 */

/** Shared with TrendExpanded.tsx so the two views never drift on which
 *  color a given series index gets. */
export const PALETTE = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#a855f7", "#06b6d4"];

/** Resolves the display color for series `i`: explicit per-trace style wins,
 *  then `lineColor` for the first series (legacy), then the shared palette. */
export function resolveSeriesColor(i: number, lineColor?: string, seriesStyles?: TrendSeriesStyle[]): string {
  const styleColor = seriesStyles?.[i]?.color;
  if (styleColor) return styleColor;
  if (i === 0 && lineColor) return lineColor;
  return PALETTE[i % PALETTE.length];
}

const DASH_MAP: Record<NonNullable<TrendSeriesStyle["dash"]>, number[]> = {
  solid: [],
  dashed: [6, 3],
  dotted: [1, 3],
};

/** Splits a series into contiguous runs of plottable {x,y} points, breaking
 *  wherever a sample can't be coerced to a number (mirrors the old
 *  "pen lifts on null" stroke logic, now shared with fill). */
function buildRuns(points: Sample[], xAt: (ts: number) => number, yAt: (v: number) => number): { x: number; y: number }[][] {
  const runs: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const p of points) {
    const n = sampleToNumber(p.value);
    if (n === null) {
      if (current.length) { runs.push(current); current = []; }
      continue;
    }
    current.push({ x: xAt(p.ts_ms), y: yAt(n) });
  }
  if (current.length) runs.push(current);
  return runs;
}

/** Traces `pts` onto the current path starting from a `moveTo` on the first
 *  point. `smooth`: cosmetic corner-rounding via midpoint quadratic curves —
 *  not resampling, doesn't alter recorded values. */
function tracePoints(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], smooth: boolean) {
  ctx.moveTo(pts[0].x, pts[0].y);
  if (!smooth || pts.length < 3) {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

interface TrendCanvasProps {
  /** Tag IDs to plot. First entry uses lineColor (if given) or the palette. */
  tags: string[];
  windowS: number;
  width: number;
  height: number;
  /** Colour for the first series. Other series fall back to the palette. */
  lineColor?: string;
  yMin?: number;
  yMax?: number;
  pollMs?: number;
  /** When true, the first poll request includes backfill=true to seed the chart
   *  with data from the OPC-UA server's historian (if the tag has an OPC-UA source). */
  opcuaBackfill?: boolean;
  /** Explicit time range. When both are set, overrides the rolling windowS window.
   *  Polling is disabled in this mode (data is fetched once on mount/change). */
  fromMs?: number;
  toMs?: number;
  /** Indices of series to hide (0-based, parallel to tags). When provided,
   *  visibility is CONTROLLED by the caller: legend clicks report through
   *  `onLegendToggle` and this prop stays the single source of truth (the
   *  "Espandi" modal works this way, its toolbar has its own toggle buttons).
   *  When absent, the canvas keeps its own internal toggle state, seeded from
   *  `seriesStyles[].hidden` (the persisted initial visibility). */
  hiddenIndices?: Set<number>;
  /** Legend-click callback for controlled visibility (see hiddenIndices). */
  onLegendToggle?: (idx: number) => void;
  /** Per-trace style (width/dash/fill/smooth), parallel to tags. */
  seriesStyles?: TrendSeriesStyle[];
  /** Drag-select a region on the plot to zoom into that time range. Fires on
   *  mouse-up when the drag exceeds a small pixel threshold (below it, it's
   *  treated as a plain hover click, preserving today's behaviour).
   *  When the drag also has a meaningful vertical extent, `yLo`/`yHi` carry
   *  the selected value range on the SHARED scale (own-scale traces keep
   *  their autofit — zooming a per-trace axis has no single answer, so it's
   *  deliberately out of scope); undefined for a mostly-horizontal drag. */
  onRangeSelect?: (fromMs: number, toMs: number, yLo?: number, yHi?: number) => void;
  /** Shows a "reset zoom" button (same corner as the CSV download button)
   *  when the caller is currently displaying a range set via onRangeSelect. */
  zoomed?: boolean;
  onResetZoom?: () => void;
  /** Seconds moved per ◀/▶ click. Defaults to 25% of windowS when omitted. */
  panStepS?: number;
  /** Date/time display config for axis ticks + hover tooltip. Unset fields
   *  fall back to DEFAULT_DT_CONFIG. */
  dtDateOrder?: TrendDateTimeConfig["dateOrder"];
  dtSeparator?: TrendDateTimeConfig["separator"];
  dtTimeFormat?: TrendDateTimeConfig["timeFormat"];
  dtShowSeconds?: boolean;
  dtShowYear?: boolean;
  dtTwoLines?: boolean;
  dtAlwaysShowDate?: boolean;
  /** Dashed horizontal threshold lines on the shared Y scale (amber for warn,
   *  red for alarm) — same convention as the bar chart's bar_show_thresholds.
   *  Not drawn when every trace uses its own scale (thresholds are values on
   *  the shared axis; without it they have no geometric meaning). */
  showThresholds?: boolean;
  warnLow?: number;
  warnHigh?: number;
  alarmLow?: number;
  alarmHigh?: number;
  /** Vertical markers at each alarm activation inside the visible window
   *  (from GET /api/alarms/history). Every alarm of the project, not just
   *  ones bound to the plotted tags — the events journal doesn't carry the
   *  tag, and "what was going on when this fired" is exactly the question a
   *  trend with markers answers. */
  showAlarmMarkers?: boolean;
  /** F5.2x: scala Y logaritmica (solo scala condivisa, richiede dominio > 0). */
  logScale?: boolean;
  /** F5.2x: unità dell'asse Y condiviso (dal tag via F1), mostrata sul tick alto. */
  yUnit?: string;
  /** F5.2x: modalità cursori di misura — il click piazza il cursore A, il
   *  secondo il B (letture per traccia + Δt/Δv); il terzo ricomincia. */
  measureMode?: boolean;
  /** Chart background color (replaces the hardcoded slate). */
  bgColor?: string;
  /** Background image URL, drawn above bgColor and below grid/traces.
   *  Loaded through an Image() cache — the 2D canvas has no declarative
   *  <image href> like SVG. */
  bgImage?: string;
  /** Frame + tick-label color (X and shared-Y axis). */
  axisColor?: string;
  /** Grid-lines color. */
  gridColor?: string;
}

const SMALL_BTN: React.CSSProperties = {
  background: "#1e293b", border: "1px solid #334155",
  color: "#64748b", borderRadius: 3, cursor: "pointer",
  fontSize: 10, padding: "2px 5px", lineHeight: 1.4,
  opacity: 0.7,
};

function sampleToNumber(v: Sample["value"]): number | null {
  if (typeof v === "number")  return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface TrendDateTimeConfig {
  dateOrder: "dmy" | "mdy" | "ymd";
  separator: "-" | "/" | ".";
  timeFormat: "24h" | "12h";
  showSeconds: boolean;
  showYear: boolean;
  twoLines: boolean;
  alwaysShowDate: boolean;
}

export const DEFAULT_DT_CONFIG: TrendDateTimeConfig = {
  dateOrder: "dmy",
  separator: "/",
  timeFormat: "24h",
  showSeconds: false,
  showYear: false,
  twoLines: true,
  alwaysShowDate: false,
};

/** Date shown only once the visible range spans more than 24h (unless
 * `alwaysShowDate` forces it) — hovering/reading across a multi-day trend
 * without a date is meaningless (the range can easily cross midnight after
 * the runtime has been up for days), but a same-day trend doesn't need one.
 * Returns one line, or two (`line2` = time) when `twoLines` is set and a
 * date is actually being shown — a single line always covers "time only". */
function fmtDateTimeParts(ts: number, spanMs: number, cfg: TrendDateTimeConfig): { line1: string; line2?: string } {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");

  let hours = d.getHours();
  let suffix = "";
  if (cfg.timeFormat === "12h") {
    suffix = hours >= 12 ? " PM" : " AM";
    hours = hours % 12 || 12;
  }
  const hourStr = cfg.timeFormat === "12h" ? hours.toString() : pad(hours);
  const secs = cfg.showSeconds ? `:${pad(d.getSeconds())}` : "";
  const timeStr = `${hourStr}:${pad(d.getMinutes())}${secs}${suffix}`;

  const showDate = cfg.alwaysShowDate || spanMs > 86_400_000;
  if (!showDate) return { line1: timeStr };

  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear().toString();
  // "ymd" without a year is meaningless — degrades to "mdy" (matches the
  // original compact format's field order when no year is requested).
  const order = cfg.showYear ? cfg.dateOrder : (cfg.dateOrder === "ymd" ? "mdy" : cfg.dateOrder);
  const fields =
    order === "ymd" ? [year, month, day] :
    order === "dmy" ? (cfg.showYear ? [day, month, year] : [day, month]) :
    (cfg.showYear ? [month, day, year] : [month, day]);
  const dateStr = fields.join(cfg.separator);

  return cfg.twoLines ? { line1: dateStr, line2: timeStr } : { line1: `${dateStr} ${timeStr}` };
}

function fmtValue(v: number): string {
  // Compact-ish: integers as-is, decimals to 2 dp.
  if (Number.isInteger(v)) return v.toString();
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  return v.toFixed(2);
}

/** Compact "how far back" label for the pan indicator, e.g. "45s", "12m", "2h05m". */
function fmtOffset(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return `${Math.round(ms / 1000)}s`;
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m.toString().padStart(2, "0")}m`;
}

export function TrendCanvas({
  tags,
  windowS,
  width,
  height,
  lineColor,
  yMin,
  yMax,
  pollMs = 2000,
  opcuaBackfill = false,
  fromMs: explicitFromMs,
  toMs: explicitToMs,
  hiddenIndices,
  onLegendToggle,
  seriesStyles,
  onRangeSelect,
  zoomed = false,
  onResetZoom,
  panStepS,
  dtDateOrder,
  dtSeparator,
  dtTimeFormat,
  dtShowSeconds,
  dtShowYear,
  dtTwoLines,
  dtAlwaysShowDate,
  showThresholds = false,
  warnLow,
  warnHigh,
  alarmLow,
  alarmHigh,
  showAlarmMarkers = false,
  logScale = false,
  yUnit,
  measureMode = false,
  bgColor,
  bgImage,
  axisColor,
  gridColor,
}: TrendCanvasProps) {
  const dtConfig: TrendDateTimeConfig = {
    dateOrder: dtDateOrder ?? DEFAULT_DT_CONFIG.dateOrder,
    separator: dtSeparator ?? DEFAULT_DT_CONFIG.separator,
    timeFormat: dtTimeFormat ?? DEFAULT_DT_CONFIG.timeFormat,
    showSeconds: dtShowSeconds ?? DEFAULT_DT_CONFIG.showSeconds,
    showYear: dtShowYear ?? DEFAULT_DT_CONFIG.showYear,
    twoLines: dtTwoLines ?? DEFAULT_DT_CONFIG.twoLines,
    alwaysShowDate: dtAlwaysShowDate ?? DEFAULT_DT_CONFIG.alwaysShowDate,
  };
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [series, setSeries] = useState<Sample[][]>(() => tags.map(() => []));
  // F5.2: banda min/max per serie quando i dati arrivano aggregati a bucket
  // (finestre lunghe). Vuoto = dati raw, nessuna banda.
  const [envelopes, setEnvelopes] = useState<Map<number, BucketSample[]>>(new Map());
  const [alarmEvents, setAlarmEvents] = useState<AlarmEvent[]>([]);
  // Background image cache: one Image() per URL, a tick to redraw on load.
  const bgImgRef = useRef<{ url: string; img: HTMLImageElement | null }>({ url: "", img: null });
  const [bgImgTick, setBgImgTick] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  // F5.2x: timestamp dei cursori di misura (max 2), attivi solo in measureMode.
  const [cursors, setCursors] = useState<number[]>([]);
  const [dragCurX, setDragCurX] = useState<number | null>(null);

  // Uncontrolled trace visibility (compact widget): seeded once from the
  // persisted `seriesStyles[].hidden`, then toggled by legend clicks. When
  // the caller passes `hiddenIndices` (controlled, e.g. the Espandi modal),
  // this state is bypassed entirely.
  const [localHidden, setLocalHidden] = useState<Set<number>>(
    () => new Set((seriesStyles ?? []).flatMap((s, i) => (s?.hidden ? [i] : [])))
  );
  const effHidden = hiddenIndices ?? localHidden;
  // Legend entry hit boxes, rebuilt on every draw (canvas has no DOM to click).
  const legendBoxesRef = useRef<{ x0: number; x1: number; y0: number; y1: number; idx: number }[]>([]);
  const [overLegend, setOverLegend] = useState(false);
  // Vertical drag extent — refs, not state: they only matter at mouse-up (the
  // selection box redraws are already driven by dragCurX's state updates).
  const dragStartYRef = useRef(0);
  const dragCurYRef = useRef(0);
  // Shared-scale mapping captured at the last draw, so mouse-up can invert
  // screen-Y → value without re-deriving the whole domain outside the effect.
  const sharedScaleRef = useRef<{ yLo: number; yHi: number; plotH: number; padTop: number; hasShared: boolean } | null>(null);

  const isHistorical = explicitFromMs !== undefined && explicitToMs !== undefined;
  // Pan (◀/▶) only makes sense for this widget's own rolling window — when the
  // caller (TrendExpandedModal, or a drag-to-zoom selection) already drives an
  // explicit range, isHistorical is true and the pan buttons stay hidden.
  const panEnabled = !isHistorical;
  const [offsetMs, setOffsetMs] = useState(0);
  const panStep = Math.round((panStepS ?? windowS * 0.25) * 1000);

  const colors = useMemo(
    () => tags.map((_, i) => resolveSeriesColor(i, lineColor, seriesStyles)),
    [tags, lineColor, seriesStyles]
  );

  // Indices of traces with their own dedicated Y-axis (drawn as extra labeled
  // columns on the left instead of sharing the single right-hand axis).
  // Hidden traces don't reserve a column — nothing to label if it's not drawn.
  const ownScaleIndices = useMemo(
    () => tags.map((_, i) => i).filter((i) => seriesStyles?.[i]?.own_scale && !effHidden.has(i)),
    [tags, seriesStyles, effHidden]
  );

  useEffect(() => {
    setSeries(tags.map(() => []));
    setOffsetMs(0);
  }, [tags.join(",")]);

  // In historical mode (explicit range) or while panned: fetch once when the
  // range changes. Live (offsetMs === 0, no explicit range): poll.
  useEffect(() => {
    if (tags.length === 0 || tags.every((t) => !t)) return;
    let cancelled = false;

    const fetch = async (fMs: number, tMs: number, backfill: boolean) => {
      try {
        // F5.2: sopra i 15 minuti di finestra i dati arrivano aggregati
        // (~un bucket per pixel) — prima un trend su 30 giorni scaricava
        // TUTTI i campioni. La linea segue la media, la banda min/max
        // preserva i picchi.
        const spanMs = tMs - fMs;
        const useBuckets = spanMs > 15 * 60_000;
        if (useBuckets) {
          const bucketMs = Math.max(1000, Math.round(spanMs / Math.max(200, width - 60)));
          const data = await Promise.all(
            tags.map((t) =>
              t
                ? api.getHistoryBuckets(t, { fromMs: fMs, toMs: tMs, bucketMs, backfill: backfill || undefined })
                : Promise.resolve([] as BucketSample[])
            )
          );
          if (!cancelled) {
            setSeries(data.map((buckets) => buckets.map((b) => ({
              ts_ms: b.ts_ms + bucketMs / 2, value: b.avg, quality: "Good" as const,
            }))));
            setEnvelopes(new Map(data.map((buckets, i) => [i, buckets])));
          }
        } else {
          const data = await Promise.all(
            tags.map((t) =>
              t
                ? api.getHistory(t, { fromMs: fMs, toMs: tMs, backfill: backfill || undefined })
                : Promise.resolve([] as Sample[])
            )
          );
          if (!cancelled) { setSeries(data); setEnvelopes(new Map()); }
        }
      } catch {
        // Runtime offline or tag missing — keep last data.
      }
      if (showAlarmMarkers) {
        try {
          const events = await api.getAlarmHistory({ from_ms: fMs, to_ms: tMs, limit: 200 });
          if (!cancelled) setAlarmEvents(events);
        } catch {
          // Journal unavailable (e.g. no store) — markers just don't appear.
        }
      }
    };

    if (isHistorical || offsetMs !== 0) {
      const { tMin, tSpan } = getXDomain();
      fetch(tMin, tMin + tSpan, false);
      return () => { cancelled = true; };
    }

    let firstTick = true;
    const tick = async () => {
      const { tMin, tSpan } = getXDomain();
      const backfill = firstTick && opcuaBackfill;
      firstTick = false;
      await fetch(tMin, tMin + tSpan, backfill);
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [tags.join(","), windowS, pollMs, opcuaBackfill, isHistorical, explicitFromMs, explicitToMs, offsetMs, showAlarmMarkers]);

  // Layout constants for the plot area
  const PAD_TOP    = 6 + (tags.length > 1 ? 14 : 0); // legend space when multi-tag
  const PAD_BOTTOM = 18 + (panEnabled ? 14 : 0); // room for the ◀/▶ pan buttons
  const PAD_LEFT_BASE = 6;
  const OWN_SCALE_COL_W = 40;
  // One extra labeled column per own-scale trace, stacked to the left of the
  // plot — the shared axis keeps its usual spot on the right.
  const PAD_LEFT   = PAD_LEFT_BASE + ownScaleIndices.length * OWN_SCALE_COL_W;
  const PAD_RIGHT  = 48;
  const plotW = width - PAD_LEFT - PAD_RIGHT;

  // X domain (same math as the draw effect below) — exposed at component
  // scope so the drag-to-zoom handler can convert screen-x → timestamp
  // without duplicating/desyncing the logic. `offsetMs` shifts the rolling
  // live window back in time (pan ◀/▶); ignored once isHistorical (explicit
  // range from the caller, e.g. a drag-to-zoom selection) takes over.
  const getXDomain = () => {
    const now = Date.now();
    const tMin = isHistorical ? explicitFromMs! : now - offsetMs - windowS * 1000;
    const tMax = isHistorical ? explicitToMs!   : now - offsetMs;
    return { tMin, tSpan: Math.max(1, tMax - tMin) };
  };

  const DRAG_THRESHOLD_PX = 8;

  // The canvas is drawn in its own nominal `width`/`height` coordinate space
  // (PAD_LEFT, plotW, xAt(...) are all in that space), but when the synoptic
  // page is rendered at a zoom/fitScale other than 100% (auto-fit, editor
  // zoom), the canvas's on-screen box (getBoundingClientRect) is smaller or
  // larger than that nominal size. Without rescaling, raw client-pixel deltas
  // get plugged into the nominal-space math, and the drag box/crosshair drift
  // away from the actual cursor as soon as the page isn't at exactly 100%.
  const toCanvasX = (e: { clientX: number; currentTarget: HTMLCanvasElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = rect.width > 0 ? width / rect.width : 1;
    return (e.clientX - rect.left) * scale;
  };
  const toCanvasY = (e: { clientY: number; currentTarget: HTMLCanvasElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = rect.height > 0 ? height / rect.height : 1;
    return (e.clientY - rect.top) * scale;
  };

  const hitLegend = (x: number, y: number): number | null => {
    for (const b of legendBoxesRef.current) {
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b.idx;
    }
    return null;
  };

  useEffect(() => { if (!measureMode) setCursors([]); }, [measureMode]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Even without onRangeSelect the down-point is tracked, so a click on the
    // legend can be told apart from a drag on mouse-up.
    const x = toCanvasX(e);
    const y = toCanvasY(e);
    setDragStartX(x);
    setDragCurX(x);
    dragStartYRef.current = y;
    dragCurYRef.current = y;
  };

  const handleMouseUp = () => {
    if (dragStartX === null || dragCurX === null) {
      return;
    }
    const dx = Math.abs(dragCurX - dragStartX);
    const dy = Math.abs(dragCurYRef.current - dragStartYRef.current);

    if (dx <= DRAG_THRESHOLD_PX && dy <= DRAG_THRESHOLD_PX) {
      // F5.2x: in modalità misura il click piazza i cursori (la legenda
      // resta cliccabile: ha priorità se il click la colpisce).
      const legendIdx = hitLegend(dragStartX, dragStartYRef.current);
      if (measureMode && legendIdx === null) {
        const { tMin, tSpan } = getXDomain();
        const ts = tMin + ((dragStartX - PAD_LEFT) / plotW) * tSpan;
        setCursors((prev) => (prev.length >= 2 ? [ts] : [...prev, ts].sort((a, b) => a - b)));
        setDragStartX(null); setDragCurX(null);
        return;
      }
      // Plain click: legend toggle if it landed on a legend entry.
      const idx = legendIdx;
      if (idx !== null) {
        if (onLegendToggle) {
          onLegendToggle(idx);
        } else {
          setLocalHidden((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx); else next.add(idx);
            return next;
          });
        }
      }
    } else if (onRangeSelect) {
      const { tMin, tSpan } = getXDomain();
      const toTs = (x: number) => tMin + ((x - PAD_LEFT) / plotW) * tSpan;
      const a = toTs(dragStartX);
      const b = toTs(dragCurX);
      // Y zoom applies to the shared scale only (own-scale traces keep their
      // autofit): the selection box's vertical extent is inverted through the
      // shared mapping captured at the last draw. A mostly-horizontal drag
      // (small dy) keeps today's time-only zoom.
      let selYLo: number | undefined;
      let selYHi: number | undefined;
      const shared = sharedScaleRef.current;
      if (dy > DRAG_THRESHOLD_PX && shared && shared.hasShared) {
        const invY = (py: number) =>
          shared.yLo + ((shared.padTop + shared.plotH - py) / shared.plotH) * (shared.yHi - shared.yLo);
        const v1 = invY(dragStartYRef.current);
        const v2 = invY(dragCurYRef.current);
        selYLo = Math.min(v1, v2);
        selYHi = Math.max(v1, v2);
      }
      onRangeSelect(Math.min(a, b), Math.max(a, b), selYLo, selYHi);
    }
    setDragStartX(null);
    setDragCurX(null);
  };

  // Drawing pass — runs on every state change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(width  * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background + frame
    ctx.fillStyle = bgColor ?? "#0f172a";
    ctx.fillRect(0, 0, width, height);
    if (bgImage) {
      if (bgImgRef.current.url !== bgImage) {
        // New URL: start loading, redraw when ready (the tick in the deps).
        const img = new Image();
        img.onload = () => { bgImgRef.current = { url: bgImage, img }; setBgImgTick((t) => t + 1); };
        img.onerror = () => { bgImgRef.current = { url: bgImage, img: null }; };
        bgImgRef.current = { url: bgImage, img: null };
        img.src = bgImage;
      } else if (bgImgRef.current.img) {
        ctx.drawImage(bgImgRef.current.img, 0, 0, width, height);
      }
    }
    ctx.strokeStyle = axisColor ?? "#334155";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    const hasAnyData = series.some((s) => s.length >= 2);
    if (!hasAnyData) {
      ctx.fillStyle = "#475569";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      const msg = tags.length === 0 || tags.every((t) => !t)
        ? "Tag non configurato"
        : "In attesa di campioni…";
      ctx.fillText(msg, width / 2, height / 2);
      return;
    }

    // X domain: explicit historical range or rolling live window.
    const { tMin, tSpan } = getXDomain();

    // Y domain: shared scale, computed only from series NOT using their own
    // axis (own-scale traces are excluded so a 0-12 trace can't get squashed
    // by a 230 one sharing the same range, or vice versa).
    let vMin = Number.POSITIVE_INFINITY;
    let vMax = Number.NEGATIVE_INFINITY;
    series.forEach((s, idx) => {
      if (ownScaleIndices.includes(idx) || effHidden.has(idx)) return;
      for (const p of s) {
        const n = sampleToNumber(p.value);
        if (n !== null) {
          if (n < vMin) vMin = n;
          if (n > vMax) vMax = n;
        }
      }
    });
    // F5.2: la banda min/max entra nel dominio, o i picchi uscirebbero dal plot.
    envelopes.forEach((buckets, idx) => {
      if (ownScaleIndices.includes(idx) || effHidden.has(idx)) return;
      for (const b of buckets) {
        if (b.min < vMin) vMin = b.min;
        if (b.max > vMax) vMax = b.max;
      }
    });
    const autoFit = !(yMin !== undefined && yMax !== undefined && (yMin !== 0 || yMax !== 0));
    let yLo = autoFit ? vMin : yMin!;
    let yHi = autoFit ? vMax : yMax!;
    if (!Number.isFinite(yLo) || !Number.isFinite(yHi)) { yLo = 0; yHi = 1; }
    if (yLo === yHi) { yLo -= 0.5; yHi += 0.5; }
    const ySpan = Math.max(1e-9, yHi - yLo);
    const hasSharedSeries = tags.some((_, idx) => !ownScaleIndices.includes(idx) && !effHidden.has(idx));

    // Independent domain per own-scale trace: autofit on that trace's own
    // samples only (no y_min/y_max override for these yet — always autofit).
    const ownDomains = new Map<number, { lo: number; hi: number; span: number }>();
    for (const idx of ownScaleIndices) {
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (const p of series[idx] ?? []) {
        const n = sampleToNumber(p.value);
        if (n !== null) {
          if (n < lo) lo = n;
          if (n > hi) hi = n;
        }
      }
      for (const b of envelopes.get(idx) ?? []) {
        if (b.min < lo) lo = b.min;
        if (b.max > hi) hi = b.max;
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
      if (lo === hi) { lo -= 0.5; hi += 0.5; }
      ownDomains.set(idx, { lo, hi, span: Math.max(1e-9, hi - lo) });
    }

    // X-axis labels may need a second line (date above time) — reserve the
    // extra height only when a date is actually going to be shown this draw
    // (same tSpan-based decision fmtDateTimeParts makes internally).
    const xAxisShowsDate = dtConfig.alwaysShowDate || tSpan > 86_400_000;
    const xAxisLineH = 11;
    const effBottom = PAD_BOTTOM + (xAxisShowsDate && dtConfig.twoLines ? xAxisLineH : 0);

    const plotH = height - PAD_TOP - effBottom;
    const xAt = (ts: number) => PAD_LEFT + ((ts - tMin) / tSpan) * plotW;
    // F5.2x: scala log sulla sola scala condivisa; richiede dominio positivo
    // (con lo <= 0 si resta in lineare — un log di zero non esiste).
    const useLog = logScale && yLo > 0 && yHi > yLo;
    const lLo = useLog ? Math.log10(yLo) : 0;
    const lSpan = useLog ? Math.max(1e-9, Math.log10(yHi) - lLo) : 0;
    const yAt = (v: number) => useLog
      ? PAD_TOP + plotH - ((Math.log10(Math.max(v, yLo)) - lLo) / lSpan) * plotH
      : PAD_TOP + plotH - ((v - yLo) / ySpan) * plotH;
    // Expose the shared mapping to the mouse-up handler (Y zoom inversion) —
    // l'inversione è lineare, quindi con la scala log lo zoom Y è disattivato.
    sharedScaleRef.current = { yLo, yHi, plotH, padTop: PAD_TOP, hasShared: hasSharedSeries && !useLog };
    // Per-series Y mapper: an own-scale trace maps through its own domain,
    // everything else shares `yAt` above.
    const yAtFor = (idx: number) => {
      const dom = ownDomains.get(idx);
      if (!dom) return yAt;
      return (v: number) => PAD_TOP + plotH - ((v - dom.lo) / dom.span) * plotH;
    };

    // ── Grid ──
    ctx.strokeStyle = gridColor ?? "#1e293b";
    ctx.lineWidth = 1;
    // Horizontal grid (4 divisions)
    for (let i = 1; i < 4; i++) {
      const y = PAD_TOP + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(PAD_LEFT + plotW, y);
      ctx.stroke();
    }
    // Vertical grid (4 divisions)
    for (let i = 1; i < 4; i++) {
      const x = PAD_LEFT + (plotW * i) / 4;
      ctx.beginPath();
      ctx.moveTo(x, PAD_TOP);
      ctx.lineTo(x, PAD_TOP + plotH);
      ctx.stroke();
    }

    // ── Y axis labels (right edge, shared scale) ──
    // Skipped when every trace has its own scale — a shared axis nobody uses
    // would just be a confusing, meaningless 0-1 range.
    if (hasSharedSeries) {
      ctx.fillStyle = axisColor ?? "#64748b";
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= 4; i++) {
        const v = useLog
          ? Math.pow(10, lLo + lSpan * (4 - i) / 4)
          : yHi - (ySpan * i) / 4;
        const y = PAD_TOP + (plotH * i) / 4;
        const suffix = i === 0 && yUnit ? ` ${yUnit}` : "";
        ctx.fillText(fmtValue(v) + suffix, PAD_LEFT + plotW + 4, y);
      }
    }

    // ── Y axis labels (left edge, one column per own-scale trace) ──
    // Same 5 tick y-positions as the shared/right axis (0/25/50/75/100% of
    // plot height) so all axes line up visually — only the values differ,
    // each mapped through that trace's own domain. Colored to match the
    // trace's line so it's clear which axis belongs to which.
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ownScaleIndices.forEach((idx, col) => {
      const dom = ownDomains.get(idx);
      if (!dom) return;
      ctx.fillStyle = colors[idx];
      const xRight = PAD_LEFT_BASE + (col + 1) * OWN_SCALE_COL_W - 4;
      for (let i = 0; i <= 4; i++) {
        const v = dom.hi - (dom.span * i) / 4;
        const y = PAD_TOP + (plotH * i) / 4;
        ctx.fillText(fmtValue(v), xRight, y);
      }
    });

    // ── X axis labels (bottom) ──
    // fillStyle set explicitly: the per-trace own-scale columns above leave
    // the context tinted with the last trace's color, and inheriting it here
    // painted the time labels in that color (regression from the own-scale
    // work, caught during the style pass).
    ctx.fillStyle = axisColor ?? "#64748b";
    ctx.textBaseline = "top";
    for (let i = 0; i <= 4; i++) {
      const ts = tMin + (tSpan * i) / 4;
      const x = PAD_LEFT + (plotW * i) / 4;
      // Skip leftmost label if too close to edge
      const align = i === 0 ? "left" : i === 4 ? "right" : "center";
      ctx.textAlign = align as CanvasTextAlign;
      const parts = fmtDateTimeParts(ts, tSpan, dtConfig);
      ctx.fillText(parts.line1, x, PAD_TOP + plotH + 3);
      if (parts.line2) ctx.fillText(parts.line2, x, PAD_TOP + plotH + 3 + xAxisLineH);
    }

    // ── Warn/alarm threshold lines (shared scale only) ──
    // Same colors/dash as the bar chart's bar_show_thresholds. Drawn before
    // the series so the traces stay readable on top of them. Skipped when no
    // trace uses the shared scale: the values would have no axis to belong to.
    if (showThresholds && hasSharedSeries) {
      const thresholdDefs: { v: number | undefined; color: string }[] = [
        { v: warnLow,   color: "#f59e0b" },
        { v: warnHigh,  color: "#f59e0b" },
        { v: alarmLow,  color: "#ef4444" },
        { v: alarmHigh, color: "#ef4444" },
      ];
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      for (const t of thresholdDefs) {
        if (t.v === undefined) continue;
        const y = yAt(t.v);
        if (y < PAD_TOP || y > PAD_TOP + plotH) continue; // fuori dal range visibile
        ctx.strokeStyle = t.color;
        ctx.beginPath();
        ctx.moveTo(PAD_LEFT, y);
        ctx.lineTo(PAD_LEFT + plotW, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // ── F5.2: banda min/max (solo dati aggregati) ──
    envelopes.forEach((buckets, idx) => {
      if (buckets.length < 2 || effHidden.has(idx)) return;
      const yFn = yAtFor(idx);
      ctx.fillStyle = colors[idx];
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      buckets.forEach((b, i) => {
        const x = xAt(b.ts_ms);
        if (i === 0) ctx.moveTo(x, yFn(b.max)); else ctx.lineTo(x, yFn(b.max));
      });
      for (let i = buckets.length - 1; i >= 0; i--) {
        ctx.lineTo(xAt(buckets[i].ts_ms), yFn(buckets[i].min));
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // ── Lines (one per series) ──
    series.forEach((points, idx) => {
      if (points.length < 1) return;
      if (effHidden.has(idx)) return;
      const style = seriesStyles?.[idx];
      const color = colors[idx];
      const smooth = style?.smooth ?? false;
      const runs = buildRuns(points, xAt, yAtFor(idx));

      // Area fill under the curve, one closed path per contiguous run —
      // closed down to the plot baseline (yAt(yLo) === PAD_TOP + plotH).
      if (style?.fill) {
        ctx.fillStyle = color;
        ctx.globalAlpha = style.fill_opacity ?? 0.15;
        for (const run of runs) {
          if (run.length < 2) continue;
          ctx.beginPath();
          tracePoints(ctx, run, smooth);
          ctx.lineTo(run[run.length - 1].x, PAD_TOP + plotH);
          ctx.lineTo(run[0].x, PAD_TOP + plotH);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = style?.width ?? 1.5;
      ctx.lineJoin = "round";
      ctx.setLineDash(DASH_MAP[style?.dash ?? "solid"]);
      for (const run of runs) {
        if (run.length < 1) continue;
        ctx.beginPath();
        if (run.length === 1) {
          ctx.moveTo(run[0].x, run[0].y);
          ctx.lineTo(run[0].x, run[0].y);
        } else {
          tracePoints(ctx, run, smooth);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    });

    // ── Alarm activation markers ──
    // Thin dashed verticals + a triangle badge at the top edge, colored by
    // severity. Drawn above the traces: an alarm is an annotation the eye
    // should find, not background decoration.
    if (showAlarmMarkers && alarmEvents.length > 0) {
      const sevColor: Record<string, string> = { Info: "#3b82f6", Warning: "#f59e0b", Critical: "#ef4444" };
      for (const ev of alarmEvents) {
        const ts = ev.ts_activated_ms;
        if (ts < tMin || ts > tMin + tSpan) continue;
        const x = xAt(ts);
        const color = sevColor[ev.severity] ?? "#f59e0b";
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x, PAD_TOP);
        ctx.lineTo(x, PAD_TOP + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - 4, PAD_TOP);
        ctx.lineTo(x + 4, PAD_TOP);
        ctx.lineTo(x, PAD_TOP + 6);
        ctx.closePath();
        ctx.fill();
      }
    }

    // ── Legend (top-left, when >1 series) ──
    // Each entry's bounding box is recorded so clicks can toggle the trace
    // (canvas text isn't clickable DOM — hit-testing is manual).
    legendBoxesRef.current = [];
    if (tags.length > 1) {
      ctx.font = "10px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      let cx = PAD_LEFT + 2;
      const cy = PAD_TOP - 8;
      tags.forEach((t, idx) => {
        if (!t) return;
        const hidden = effHidden.has(idx);
        ctx.fillStyle = hidden ? "#334155" : colors[idx];
        ctx.fillRect(cx, cy - 4, 8, 8);
        ctx.fillStyle = hidden ? "#475569" : "#cbd5e1";
        ctx.fillText(t, cx + 12, cy);
        const w = ctx.measureText(t).width;
        legendBoxesRef.current.push({ x0: cx, x1: cx + 12 + w, y0: cy - 7, y1: cy + 7, idx });
        cx += 12 + w + 12;
      });
    }

    // ── F5.2x: cursori di misura ──
    if (cursors.length > 0) {
      const nearestVal = (idx: number, ts: number): number | null => {
        const pts = series[idx] ?? [];
        let best: number | null = null;
        let bestDist = Infinity;
        for (const p of pts) {
          const d = Math.abs(p.ts_ms - ts);
          if (d < bestDist) {
            const n = sampleToNumber(p.value);
            if (n !== null) { best = n; bestDist = d; }
          } else if (d > bestDist) break; // ordinati per ts: oltre il minimo
        }
        return best;
      };
      // Linee verticali A/B
      cursors.forEach((ts, ci) => {
        const x = xAt(ts);
        if (x < PAD_LEFT || x > PAD_LEFT + plotW) return;
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(x, PAD_TOP);
        ctx.lineTo(x, PAD_TOP + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#f59e0b";
        ctx.font = "bold 10px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(ci === 0 ? "A" : "B", x, PAD_TOP + 9);
      });
      // Riquadro letture: valore per traccia visibile su A (e B), Δt/Δv con 2 cursori
      const lines: { text: string; color: string }[] = [];
      const visIdx = tags.map((_, i) => i).filter((i) => !effHidden.has(i)).slice(0, 4);
      cursors.forEach((ts, ci) => {
        const tp = fmtDateTimeParts(ts, tSpan, dtConfig);
        lines.push({ text: `${ci === 0 ? "A" : "B"}: ${tp.line2 ? `${tp.line2} ` : ""}${tp.line1}`, color: "#f59e0b" });
        for (const i of visIdx) {
          const v = nearestVal(i, ts);
          lines.push({ text: `  ${tags[i]}: ${v === null ? "—" : fmtValue(v)}`, color: colors[i] });
        }
      });
      if (cursors.length === 2) {
        const dtMs = cursors[1] - cursors[0];
        const dtText = dtMs >= 60_000 ? `${(dtMs / 60_000).toFixed(1)} min` : `${(dtMs / 1000).toFixed(1)} s`;
        lines.push({ text: `Δt: ${dtText}`, color: "#e2e8f0" });
        for (const i of visIdx) {
          const va = nearestVal(i, cursors[0]);
          const vb = nearestVal(i, cursors[1]);
          if (va !== null && vb !== null) {
            lines.push({ text: `  Δ${tags[i]}: ${fmtValue(vb - va)}`, color: colors[i] });
          }
        }
      }
      const boxW = Math.min(240, Math.max(...lines.map((l) => l.text.length)) * 6.2 + 12);
      const boxH = lines.length * 13 + 8;
      const bx = PAD_LEFT + 6;
      const by = PAD_TOP + 4;
      ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = "#334155";
      ctx.strokeRect(bx, by, boxW, boxH);
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      lines.forEach((l, li) => {
        ctx.fillStyle = l.color;
        ctx.fillText(l.text, bx + 6, by + 5 + li * 13);
      });
    }

    // ── Drag-to-zoom selection rectangle (2D: time + shared-scale Y) ──
    if (dragStartX !== null && dragCurX !== null) {
      const x0 = Math.max(PAD_LEFT, Math.min(dragStartX, dragCurX));
      const x1 = Math.min(PAD_LEFT + plotW, Math.max(dragStartX, dragCurX));
      // The vertical extent collapses to the full plot height while the drag
      // is still mostly horizontal — same threshold the mouse-up handler uses
      // to decide whether to zoom Y at all, so the preview never promises a
      // Y zoom that won't happen.
      const rawY0 = Math.min(dragStartYRef.current, dragCurYRef.current);
      const rawY1 = Math.max(dragStartYRef.current, dragCurYRef.current);
      const dyBigEnough = rawY1 - rawY0 > DRAG_THRESHOLD_PX;
      const y0 = dyBigEnough ? Math.max(PAD_TOP, rawY0) : PAD_TOP;
      const y1 = dyBigEnough ? Math.min(PAD_TOP + plotH, rawY1) : PAD_TOP + plotH;
      if (x1 > x0 && y1 > y0) {
        ctx.fillStyle = "rgba(59,130,246,0.18)";
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.strokeStyle = "#3b82f6";
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
      }
    }

    // ── Hover crosshair + per-series tooltip ──
    if (hoverX !== null && hoverX >= PAD_LEFT && hoverX <= PAD_LEFT + plotW) {
      // Vertical crosshair
      ctx.strokeStyle = "#475569";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hoverX, PAD_TOP);
      ctx.lineTo(hoverX, PAD_TOP + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      const tsAtHover = tMin + ((hoverX - PAD_LEFT) / plotW) * tSpan;

      // For each series, snap to the nearest sample
      const hits: { tag: string; color: string; value: number; y: number }[] = [];
      series.forEach((points, idx) => {
        if (!points.length) return;
        if (effHidden.has(idx)) return;
        let best: Sample | null = null;
        let bestDt = Infinity;
        for (const p of points) {
          const dt = Math.abs(p.ts_ms - tsAtHover);
          if (dt < bestDt) { bestDt = dt; best = p; }
        }
        if (!best) return;
        const n = sampleToNumber(best.value);
        if (n === null) return;
        const y = yAtFor(idx)(n);
        hits.push({ tag: tags[idx] ?? "", color: colors[idx], value: n, y });
        // Dot on the sample
        ctx.fillStyle = colors[idx];
        ctx.beginPath();
        ctx.arc(xAt(best.ts_ms), y, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      // Tooltip box
      if (hits.length > 0) {
        ctx.font = "11px ui-monospace, monospace";
        const tsParts = fmtDateTimeParts(tsAtHover, tSpan, dtConfig);
        const tsLines = tsParts.line2 ? [tsParts.line1, tsParts.line2] : [tsParts.line1];
        const sevColor: Record<string, string> = { Info: "#3b82f6", Warning: "#f59e0b", Critical: "#ef4444" };
        const nearbyAlarms = showAlarmMarkers
          ? alarmEvents.filter((ev) => Math.abs(xAt(ev.ts_activated_ms) - hoverX) < 5)
          : [];
        const entries: { text: string; color: string }[] = [
          ...tsLines.map((l) => ({ text: l, color: "#94a3b8" })),
          ...hits.map((h) => ({ text: `${h.tag}: ${fmtValue(h.value)}`, color: h.color })),
          ...nearbyAlarms.map((ev) => ({ text: `⚠ ${ev.alarm_message}`, color: sevColor[ev.severity] ?? "#f59e0b" })),
        ];
        const lineH = 14;
        const boxW = Math.max(...entries.map((e) => ctx.measureText(e.text).width)) + 16;
        const boxH = entries.length * lineH + 8;
        // Place to the right of the cursor unless we'd clip
        let bx = hoverX + 8;
        if (bx + boxW > PAD_LEFT + plotW) bx = hoverX - boxW - 8;
        const by = Math.max(PAD_TOP + 2, Math.min(PAD_TOP + plotH - boxH - 2, PAD_TOP + 8));
        ctx.fillStyle = "#0f172aee";
        ctx.strokeStyle = "#334155";
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        entries.forEach((entry, i) => {
          ctx.fillStyle = entry.color;
          ctx.fillText(entry.text, bx + 8, by + 4 + i * lineH);
        });
      }
    }

    // ── Current-value badge (top-right corner of plot area) ──
    if (hoverX === null) {
      const last = series.map((s) => s[s.length - 1]).filter(Boolean);
      const lastN = last.length === 1 ? sampleToNumber(last[0].value) : null;
      if (lastN !== null && tags.length === 1) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText(fmtValue(lastN), PAD_LEFT + plotW - 4, PAD_TOP + 4);
      }
    }
  }, [series, envelopes, width, height, colors, yMin, yMax, hoverX, tags.join(","), windowS, isHistorical, explicitFromMs, explicitToMs, offsetMs, effHidden, seriesStyles, dragStartX, dragCurX, dtDateOrder, dtSeparator, dtTimeFormat, dtShowSeconds, dtShowYear, dtTwoLines, dtAlwaysShowDate, showThresholds, warnLow, warnHigh, alarmLow, alarmHigh, showAlarmMarkers, alarmEvents, bgColor, bgImage, bgImgTick, axisColor, gridColor, logScale, yUnit, cursors, measureMode]);

  const hasSeries = series.some((s) => s.length > 0);

  return (
    <div style={{ position: "relative", width, height, display: "block" }}>
      <canvas
        ref={canvasRef}
        style={{ width, height, display: "block", cursor: overLegend ? "pointer" : onRangeSelect ? "crosshair" : "default" }}
        onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e); }}
        onMouseMove={(e) => {
          const x = toCanvasX(e);
          const y = toCanvasY(e);
          setHoverX(x);
          if (dragStartX !== null) {
            setDragCurX(x);
            dragCurYRef.current = y;
          }
          setOverLegend(hitLegend(x, y) !== null);
        }}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setHoverX(null); setDragStartX(null); setDragCurX(null); setOverLegend(false); }}
      />
      {hasSeries && (
        <div style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 4 }}>
          {zoomed && onResetZoom && (
            <button
              title="Reset zoom"
              onClick={onResetZoom}
              style={SMALL_BTN}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
            >
              ⟲
            </button>
          )}
          <button
            title="Scarica CSV"
            onClick={() => {
              const { tMin, tSpan } = getXDomain();
              api.exportHistoryCsv(tags.filter(Boolean), tMin, tMin + tSpan);
            }}
            style={SMALL_BTN}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
          >
            ⬇ CSV
          </button>
        </div>
      )}
      {panEnabled && (
        <>
          <button
            title="Indietro nel tempo"
            onClick={() => setOffsetMs((o) => o + panStep)}
            style={{
              position: "absolute", bottom: 4, left: 4,
              background: "#1e293b", border: "1px solid #334155",
              color: "#64748b", borderRadius: 3, cursor: "pointer",
              fontSize: 10, padding: "2px 5px", lineHeight: 1.4,
              opacity: 0.7,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
          >
            ◀
          </button>
          {offsetMs !== 0 && (
            <span
              style={{
                position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)",
                color: "#64748b", fontSize: 10, background: "#1e293bcc",
                borderRadius: 3, padding: "2px 5px", lineHeight: 1.4, pointerEvents: "none",
              }}
            >
              -{fmtOffset(offsetMs)}
            </span>
          )}
          <button
            title="Avanti nel tempo"
            onClick={() => setOffsetMs((o) => Math.max(0, o - panStep))}
            disabled={offsetMs === 0}
            style={{
              position: "absolute", bottom: 4, right: 4,
              background: "#1e293b", border: "1px solid #334155",
              color: offsetMs === 0 ? "#334155" : "#64748b", borderRadius: 3,
              cursor: offsetMs === 0 ? "default" : "pointer",
              fontSize: 10, padding: "2px 5px", lineHeight: 1.4,
              opacity: offsetMs === 0 ? 0.4 : 0.7,
            }}
            onMouseEnter={(e) => { if (offsetMs !== 0) e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { if (offsetMs !== 0) e.currentTarget.style.opacity = "0.7"; }}
          >
            ▶
          </button>
        </>
      )}
    </div>
  );
}
