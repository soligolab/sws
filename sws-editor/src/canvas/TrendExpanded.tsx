import { useCallback, useEffect, useRef, useState } from "react";
import { TrendCanvas } from "./TrendCanvas";

interface TrendExpandedProps {
  tags: string[];
  windowS: number;
  lineColor?: string;
  yMin?: number;
  yMax?: number;
  pollMs?: number;
  opcuaBackfill?: boolean;
  onClose: () => void;
}

type RangePreset = "live" | "1h" | "8h" | "24h" | "7d";

const PRESETS: { id: RangePreset; label: string; seconds: number | null }[] = [
  { id: "live", label: "Live",  seconds: null },
  { id: "1h",   label: "1h",   seconds: 3600 },
  { id: "8h",   label: "8h",   seconds: 28800 },
  { id: "24h",  label: "24h",  seconds: 86400 },
  { id: "7d",   label: "7d",   seconds: 604800 },
];

export function TrendExpandedModal({
  tags,
  windowS,
  lineColor,
  yMin,
  yMax,
  pollMs,
  opcuaBackfill,
  onClose,
}: TrendExpandedProps) {
  const [preset, setPreset] = useState<RangePreset>("live");
  // Historical range anchor: pan shifts this offset (ms before now).
  const [offsetMs, setOffsetMs] = useState(0);
  const [hiddenIndices, setHiddenIndices] = useState<Set<number>>(new Set());
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 420 });
  const containerRef = useRef<HTMLDivElement>(null);

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

  const activePreset = PRESETS.find((p) => p.id === preset)!;
  const isLive = activePreset.seconds === null;
  const spanMs = isLive ? windowS * 1000 : activePreset.seconds! * 1000;

  // Compute explicit historical range (null when live).
  let fromMs: number | undefined;
  let toMs: number | undefined;
  if (!isLive) {
    const now = Date.now();
    toMs   = now - offsetMs;
    fromMs = toMs - spanMs;
  }

  const panStep = Math.round(spanMs * 0.25);

  const panBack = useCallback(() => {
    if (!isLive) setOffsetMs((o) => o + panStep);
  }, [isLive, panStep]);

  const panForward = useCallback(() => {
    if (!isLive) setOffsetMs((o) => Math.max(0, o - panStep));
  }, [isLive, panStep]);

  const toggleSeries = (idx: number) => {
    setHiddenIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const PALETTE = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#a855f7", "#06b6d4"];
  const colors = tags.map((_, i) => (i === 0 && lineColor ? lineColor : PALETTE[i % PALETTE.length]));

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
                onClick={() => { setPreset(p.id); setOffsetMs(0); }}
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
          </div>

          {/* Pan buttons (disabled in live mode) */}
          <button
            onClick={panBack}
            disabled={isLive}
            title="Indietro"
            style={{
              padding: "2px 8px", fontSize: 12, borderRadius: 4, cursor: isLive ? "default" : "pointer",
              border: "1px solid #334155", background: "#1e293b",
              color: isLive ? "#334155" : "#94a3b8",
            }}
          >◀</button>
          <button
            onClick={panForward}
            disabled={isLive || offsetMs === 0}
            title="Avanti"
            style={{
              padding: "2px 8px", fontSize: 12, borderRadius: 4,
              cursor: (isLive || offsetMs === 0) ? "default" : "pointer",
              border: "1px solid #334155", background: "#1e293b",
              color: (isLive || offsetMs === 0) ? "#334155" : "#94a3b8",
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
            yMin={yMin}
            yMax={yMax}
            pollMs={pollMs}
            opcuaBackfill={opcuaBackfill}
            fromMs={fromMs}
            toMs={toMs}
            hiddenIndices={hiddenIndices}
          />
        </div>
      </div>
    </div>
  );
}
