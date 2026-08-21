import { useCallback, useEffect, useRef, useState } from "react";
import { TrendCanvas, resolveSeriesColor, type TrendDateTimeConfig } from "./TrendCanvas";
import { api } from "@/api/client";
import type { TrendSeriesStyle } from "@/types";

interface TrendExpandedProps {
  tags: string[];
  windowS: number;
  lineColor?: string;
  yMin?: number;
  yMax?: number;
  pollMs?: number;
  opcuaBackfill?: boolean;
  seriesStyles?: TrendSeriesStyle[];
  dtDateOrder?: TrendDateTimeConfig["dateOrder"];
  dtSeparator?: TrendDateTimeConfig["separator"];
  dtTimeFormat?: TrendDateTimeConfig["timeFormat"];
  dtShowSeconds?: boolean;
  dtShowYear?: boolean;
  dtTwoLines?: boolean;
  dtAlwaysShowDate?: boolean;
  showThresholds?: boolean;
  warnLow?: number;
  warnHigh?: number;
  alarmLow?: number;
  alarmHigh?: number;
  showAlarmMarkers?: boolean;
  bgColor?: string;
  bgImage?: string;
  axisColor?: string;
  gridColor?: string;
  onClose: () => void;
}

type RangePreset = "live" | "1h" | "8h" | "24h" | "7d" | "all" | "custom";

// "all" has no fixed span — its range is resolved from the earliest recorded
// sample (see the effect below), not from `seconds`.
const PRESETS: { id: RangePreset; label: string; seconds: number | null }[] = [
  { id: "live", label: "Live",  seconds: null },
  { id: "1h",   label: "1h",   seconds: 3600 },
  { id: "8h",   label: "8h",   seconds: 28800 },
  { id: "24h",  label: "24h",  seconds: 86400 },
  { id: "7d",   label: "7d",   seconds: 604800 },
  { id: "all",  label: "Tutto", seconds: null },
];

export function TrendExpandedModal({
  tags,
  windowS,
  lineColor,
  yMin,
  yMax,
  pollMs,
  opcuaBackfill,
  seriesStyles,
  dtDateOrder,
  dtSeparator,
  dtTimeFormat,
  dtShowSeconds,
  dtShowYear,
  dtTwoLines,
  dtAlwaysShowDate,
  showThresholds,
  warnLow,
  warnHigh,
  alarmLow,
  alarmHigh,
  showAlarmMarkers,
  bgColor,
  bgImage,
  axisColor,
  gridColor,
  onClose,
}: TrendExpandedProps) {
  const [preset, setPreset] = useState<RangePreset>("live");
  // Historical range anchor: pan shifts this offset (ms before now).
  const [offsetMs, setOffsetMs] = useState(0);
  // Drag-to-zoom range, set via onRangeSelect on the canvas below (T-48).
  // Lives alongside the preset system as its own pseudo-preset ("custom").
  const [customRange, setCustomRange] = useState<{ fromMs: number; toMs: number; yLo?: number; yHi?: number } | null>(null);
  // Seeded from the persisted per-trace `hidden` flags; toggled at runtime by
  // both the toolbar buttons and legend clicks (single source of truth here).
  const [hiddenIndices, setHiddenIndices] = useState<Set<number>>(
    () => new Set((seriesStyles ?? []).flatMap((s, i) => (s?.hidden ? [i] : [])))
  );
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 420 });
  const containerRef = useRef<HTMLDivElement>(null);

  // "Tutto": resolved once per selection from the earliest sample across all
  // series (via GET /api/history/:tag/stats), not a fixed span like the other
  // presets — so it needs an async lookup instead of pure now-anchored math.
  const [allRange, setAllRange] = useState<{ fromMs: number; toMs: number } | null>(null);
  const [allLoading, setAllLoading] = useState(false);

  useEffect(() => {
    if (preset !== "all") { setAllRange(null); return; }
    let cancelled = false;
    setAllLoading(true);
    Promise.all(tags.filter(Boolean).map((t) => api.getHistoryStats(t).catch(() => null)))
      .then((stats) => {
        if (cancelled) return;
        const firstTimestamps = stats
          .map((s) => s?.first_ts)
          .filter((v): v is number => v != null);
        const fromMs = firstTimestamps.length > 0 ? Math.min(...firstTimestamps) : Date.now();
        setAllRange({ fromMs, toMs: Date.now() });
      })
      .finally(() => { if (!cancelled) setAllLoading(false); });
    return () => { cancelled = true; };
  }, [preset, tags.join(",")]);

  // Resize observer to fill modal body.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const activePreset = PRESETS.find((p) => p.id === preset);
  const isLive   = preset === "live";
  const isAll    = preset === "all";
  const isCustom = preset === "custom";
  const spanMs = isLive ? windowS * 1000 : (isAll || isCustom) ? 0 : activePreset!.seconds! * 1000;

  // Compute explicit historical range (undefined when live).
  let fromMs: number | undefined;
  let toMs: number | undefined;
  if (isCustom && customRange) {
    fromMs = customRange.fromMs;
    toMs   = customRange.toMs;
  } else if (isAll) {
    fromMs = allRange?.fromMs;
    toMs   = allRange?.toMs;
  } else if (!isLive) {
    const now = Date.now();
    toMs   = now - offsetMs;
    fromMs = toMs - spanMs;
  }

  const panDisabled = isLive || isAll || isCustom;
  const panStep = Math.round(spanMs * 0.25);

  const panBack = useCallback(() => {
    if (!panDisabled) setOffsetMs((o) => o + panStep);
  }, [panDisabled, panStep]);

  const panForward = useCallback(() => {
    if (!panDisabled) setOffsetMs((o) => Math.max(0, o - panStep));
  }, [panDisabled, panStep]);

  const toggleSeries = (idx: number) => {
    setHiddenIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const colors = tags.map((_, i) => resolveSeriesColor(i, lineColor, seriesStyles));

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#0f172a", border: "1px solid #334155", borderRadius: 8,
          display: "flex", flexDirection: "column",
          width: "min(92vw, 1100px)", height: "min(88vh, 680px)",
          overflow: "hidden",
        }}
      >
        {/* ── Toolbar ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 10px", borderBottom: "1px solid #1e293b",
          flexShrink: 0,
        }}>
          {/* Range presets */}
          <div style={{ display: "flex", gap: 3 }}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => { setPreset(p.id); setOffsetMs(0); setCustomRange(null); }}
                style={{
                  padding: "2px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                  border: "1px solid",
                  borderColor: preset === p.id ? "#3b82f6" : "#334155",
                  background: preset === p.id ? "#1e3a5f" : "#1e293b",
                  color: preset === p.id ? "#93c5fd" : "#64748b",
                }}
              >
                {p.label}
              </button>
            ))}
            {isCustom && (
              <span style={{
                padding: "2px 8px", fontSize: 11, borderRadius: 4,
                border: "1px solid #3b82f6", background: "#1e3a5f", color: "#93c5fd",
              }}>
                Selezione
              </span>
            )}
          </div>

          {/* Pan buttons (disabled in live/all/custom mode) */}
          <button
            onClick={panBack}
            disabled={panDisabled}
            title="Indietro"
            style={{
              padding: "2px 8px", fontSize: 12, borderRadius: 4, cursor: panDisabled ? "default" : "pointer",
              border: "1px solid #334155", background: "#1e293b",
              color: panDisabled ? "#334155" : "#94a3b8",
            }}
          >◀</button>
          <button
            onClick={panForward}
            disabled={panDisabled || offsetMs === 0}
            title="Avanti"
            style={{
              padding: "2px 8px", fontSize: 12, borderRadius: 4,
              cursor: (panDisabled || offsetMs === 0) ? "default" : "pointer",
              border: "1px solid #334155", background: "#1e293b",
              color: (panDisabled || offsetMs === 0) ? "#334155" : "#94a3b8",
            }}
          >▶</button>

          {/* Series toggles */}
          {tags.length > 1 && (
            <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
              {tags.map((t, i) => {
                const hidden = hiddenIndices.has(i);
                return (
                  <button
                    key={i}
                    onClick={() => toggleSeries(i)}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "2px 6px", fontSize: 10, borderRadius: 4, cursor: "pointer",
                      border: "1px solid #334155", background: "transparent",
                      color: hidden ? "#475569" : "#cbd5e1",
                      textDecoration: hidden ? "line-through" : "none",
                    }}
                  >
                    <span style={{
                      display: "inline-block", width: 8, height: 8, borderRadius: 2,
                      background: hidden ? "#334155" : colors[i],
                    }} />
                    {t}
                  </button>
                );
              })}
            </div>
          )}

          {isAll && allLoading && (
            <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>Carico…</span>
          )}

          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              padding: "2px 8px", fontSize: 13, borderRadius: 4, cursor: "pointer",
              border: "1px solid #334155", background: "#1e293b", color: "#94a3b8",
            }}
          >✕</button>
        </div>

        {/* ── Canvas area ── */}
        <div ref={containerRef} style={{ flex: 1, overflow: "hidden" }}>
          <TrendCanvas
            tags={tags}
            windowS={windowS}
            width={canvasSize.w}
            height={canvasSize.h}
            lineColor={lineColor}
            yMin={isCustom && customRange?.yLo !== undefined ? customRange.yLo : yMin}
            yMax={isCustom && customRange?.yHi !== undefined ? customRange.yHi : yMax}
            pollMs={pollMs}
            opcuaBackfill={opcuaBackfill}
            fromMs={fromMs}
            toMs={toMs}
            hiddenIndices={hiddenIndices}
            onLegendToggle={toggleSeries}
            seriesStyles={seriesStyles}
            dtDateOrder={dtDateOrder}
            dtSeparator={dtSeparator}
            dtTimeFormat={dtTimeFormat}
            dtShowSeconds={dtShowSeconds}
            dtShowYear={dtShowYear}
            dtTwoLines={dtTwoLines}
            dtAlwaysShowDate={dtAlwaysShowDate}
            showThresholds={showThresholds}
            warnLow={warnLow}
            warnHigh={warnHigh}
            alarmLow={alarmLow}
            alarmHigh={alarmHigh}
            showAlarmMarkers={showAlarmMarkers}
            bgColor={bgColor}
            bgImage={bgImage}
            axisColor={axisColor}
            gridColor={gridColor}
            onRangeSelect={(rFromMs, rToMs, rYLo, rYHi) => { setCustomRange({ fromMs: rFromMs, toMs: rToMs, yLo: rYLo, yHi: rYHi }); setPreset("custom"); }}
            zoomed={isCustom}
            onResetZoom={() => { setPreset("live"); setOffsetMs(0); setCustomRange(null); }}
          />
        </div>
      </div>
    </div>
  );
}
