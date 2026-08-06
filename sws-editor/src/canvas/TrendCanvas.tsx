import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import type { Sample, TrendSeriesStyle } from "@/types";

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
  /** Indices of series to hide (0-based, parallel to tags). */
  hiddenIndices?: Set<number>;
  /** Per-trace style (width/dash/fill/smooth), parallel to tags. */
  seriesStyles?: TrendSeriesStyle[];
  /** Drag-select a region on the plot to zoom into that time range. Fires on
   *  mouse-up when the drag exceeds a small pixel threshold (below it, it's
   *  treated as a plain hover click, preserving today's behaviour). */
  onRangeSelect?: (fromMs: number, toMs: number) => void;
  /** Shows a "reset zoom" button (same corner as the CSV download button)
   *  when the caller is currently displaying a range set via onRangeSelect. */
  zoomed?: boolean;
  onResetZoom?: () => void;
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

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtValue(v: number): string {
  // Compact-ish: integers as-is, decimals to 2 dp.
  if (Number.isInteger(v)) return v.toString();
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  return v.toFixed(2);
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
  seriesStyles,
  onRangeSelect,
  zoomed = false,
  onResetZoom,
}: TrendCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [series, setSeries] = useState<Sample[][]>(() => tags.map(() => []));
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [dragCurX, setDragCurX] = useState<number | null>(null);

  const isHistorical = explicitFromMs !== undefined && explicitToMs !== undefined;

  const colors = useMemo(
    () => tags.map((_, i) => resolveSeriesColor(i, lineColor, seriesStyles)),
    [tags, lineColor, seriesStyles]
  );

  useEffect(() => {
    setSeries(tags.map(() => []));
  }, [tags.join(",")]);

  // In historical mode: fetch once when range changes. In live mode: poll.
  useEffect(() => {
    if (tags.length === 0 || tags.every((t) => !t)) return;
    let cancelled = false;

    const fetch = async (fMs: number, tMs: number, backfill: boolean) => {
      try {
        const data = await Promise.all(
          tags.map((t) =>
            t
              ? api.getHistory(t, { fromMs: fMs, toMs: tMs, backfill: backfill || undefined })
              : Promise.resolve([] as Sample[])
          )
        );
        if (!cancelled) setSeries(data);
      } catch {
        // Runtime offline or tag missing — keep last data.
      }
    };

    if (isHistorical) {
      fetch(explicitFromMs!, explicitToMs!, false);
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
  }, [tags.join(","), windowS, pollMs, opcuaBackfill, isHistorical, explicitFromMs, explicitToMs]);

  // Layout constants for the plot area
  const PAD_TOP    = 6 + (tags.length > 1 ? 14 : 0); // legend space when multi-tag
  const PAD_BOTTOM = 18;
  const PAD_LEFT   = 6;
  const PAD_RIGHT  = 48;
  const plotW = width - PAD_LEFT - PAD_RIGHT;

  // X domain (same math as the draw effect below) — exposed at component
  // scope so the drag-to-zoom handler can convert screen-x → timestamp
  // without duplicating/desyncing the logic.
  const getXDomain = () => {
    const now = Date.now();
    const tMin = isHistorical ? explicitFromMs! : now - windowS * 1000;
    const tMax = isHistorical ? explicitToMs!   : now;
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

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onRangeSelect) return;
    const x = toCanvasX(e);
    setDragStartX(x);
    setDragCurX(x);
  };

  const handleMouseUp = () => {
    if (dragStartX === null || dragCurX === null) return;
    const delta = Math.abs(dragCurX - dragStartX);
    if (delta > DRAG_THRESHOLD_PX && onRangeSelect) {
      const { tMin, tSpan } = getXDomain();
      const toTs = (x: number) => tMin + ((x - PAD_LEFT) / plotW) * tSpan;
      const a = toTs(dragStartX);
      const b = toTs(dragCurX);
      onRangeSelect(Math.min(a, b), Math.max(a, b));
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
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#334155";
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

    // Y domain: per-canvas, computed from numeric samples across all series.
    let vMin = Number.POSITIVE_INFINITY;
    let vMax = Number.NEGATIVE_INFINITY;
    for (const s of series) for (const p of s) {
      const n = sampleToNumber(p.value);
      if (n !== null) {
        if (n < vMin) vMin = n;
        if (n > vMax) vMax = n;
      }
    }
    const autoFit = !(yMin !== undefined && yMax !== undefined && (yMin !== 0 || yMax !== 0));
    let yLo = autoFit ? vMin : yMin!;
    let yHi = autoFit ? vMax : yMax!;
    if (!Number.isFinite(yLo) || !Number.isFinite(yHi)) { yLo = 0; yHi = 1; }
    if (yLo === yHi) { yLo -= 0.5; yHi += 0.5; }
    const ySpan = Math.max(1e-9, yHi - yLo);

    const plotH = height - PAD_TOP - PAD_BOTTOM;
    const xAt = (ts: number) => PAD_LEFT + ((ts - tMin) / tSpan) * plotW;
    const yAt = (v: number)  => PAD_TOP  + plotH - ((v - yLo) / ySpan) * plotH;

    // ── Grid ──
    ctx.strokeStyle = "#1e293b";
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

    // ── Y axis labels (right edge) ──
    ctx.fillStyle = "#64748b";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = yHi - (ySpan * i) / 4;
      const y = PAD_TOP + (plotH * i) / 4;
      ctx.fillText(fmtValue(v), PAD_LEFT + plotW + 4, y);
    }

    // ── X axis labels (bottom) ──
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i <= 4; i++) {
      const ts = tMin + (tSpan * i) / 4;
      const x = PAD_LEFT + (plotW * i) / 4;
      // Skip leftmost label if too close to edge
      const align = i === 0 ? "left" : i === 4 ? "right" : "center";
      ctx.textAlign = align as CanvasTextAlign;
      ctx.fillText(fmtTime(ts), x, PAD_TOP + plotH + 3);
    }

    // ── Lines (one per series) ──
    series.forEach((points, idx) => {
      if (points.length < 1) return;
      if (hiddenIndices?.has(idx)) return;
      const style = seriesStyles?.[idx];
      const color = colors[idx];
      const smooth = style?.smooth ?? false;
      const runs = buildRuns(points, xAt, yAt);

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

    // ── Legend (top-left, when >1 series) ──
    if (tags.length > 1) {
      ctx.font = "10px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      let cx = PAD_LEFT + 2;
      const cy = PAD_TOP - 8;
      tags.forEach((t, idx) => {
        if (!t) return;
        const hidden = hiddenIndices?.has(idx);
        ctx.fillStyle = hidden ? "#334155" : colors[idx];
        ctx.fillRect(cx, cy - 4, 8, 8);
        ctx.fillStyle = hidden ? "#475569" : "#cbd5e1";
        ctx.fillText(t, cx + 12, cy);
        const w = ctx.measureText(t).width;
        cx += 12 + w + 12;
      });
    }

    // ── Drag-to-zoom selection rectangle ──
    if (dragStartX !== null && dragCurX !== null) {
      const x0 = Math.max(PAD_LEFT, Math.min(dragStartX, dragCurX));
      const x1 = Math.min(PAD_LEFT + plotW, Math.max(dragStartX, dragCurX));
      if (x1 > x0) {
        ctx.fillStyle = "rgba(59,130,246,0.18)";
        ctx.fillRect(x0, PAD_TOP, x1 - x0, plotH);
        ctx.strokeStyle = "#3b82f6";
        ctx.strokeRect(x0 + 0.5, PAD_TOP + 0.5, x1 - x0 - 1, plotH - 1);
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
        if (hiddenIndices?.has(idx)) return;
        let best: Sample | null = null;
        let bestDt = Infinity;
        for (const p of points) {
          const dt = Math.abs(p.ts_ms - tsAtHover);
          if (dt < bestDt) { bestDt = dt; best = p; }
        }
        if (!best) return;
        const n = sampleToNumber(best.value);
        if (n === null) return;
        const y = yAt(n);
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
        const tsLabel = fmtTime(tsAtHover);
        const lines = [tsLabel, ...hits.map((h) => `${h.tag}: ${fmtValue(h.value)}`)];
        const lineH = 14;
        const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
        const boxH = lines.length * lineH + 8;
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
        lines.forEach((line, i) => {
          if (i === 0) {
            ctx.fillStyle = "#94a3b8";
          } else {
            ctx.fillStyle = hits[i - 1].color;
          }
          ctx.fillText(line, bx + 8, by + 4 + i * lineH);
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
  }, [series, width, height, colors, yMin, yMax, hoverX, tags.join(","), windowS, isHistorical, explicitFromMs, explicitToMs, hiddenIndices, seriesStyles, dragStartX, dragCurX]);

  const hasSeries = series.some((s) => s.length > 0);

  return (
    <div style={{ position: "relative", width, height, display: "block" }}>
      <canvas
        ref={canvasRef}
        style={{ width, height, display: "block", cursor: onRangeSelect ? "crosshair" : "default" }}
        onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e); }}
        onMouseMove={(e) => {
          const x = toCanvasX(e);
          setHoverX(x);
          if (dragStartX !== null) setDragCurX(x);
        }}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setHoverX(null); setDragStartX(null); setDragCurX(null); }}
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
    </div>
  );
}
