import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { Sample } from "@/types";

/**
 * Polls GET /api/history/:tag every `pollMs` and draws a basic line chart
 * on a 2D canvas. Bool samples are coerced to 0/1, strings parsed to f64
 * where possible. Y-axis: hard `[yMin, yMax]` if both > 0, else autofit.
 *
 * Out of scope: zoom/pan, multi-tag overlay, decimation. PoC just needs
 * "operator can see the trend during the demo."
 */
interface TrendCanvasProps {
  tag: string;
  windowS: number;
  width: number;
  height: number;
  lineColor?: string;
  yMin?: number;
  yMax?: number;
  pollMs?: number;
}

function sampleToNumber(v: Sample["value"]): number | null {
  if (typeof v === "number")  return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function TrendCanvas({
  tag,
  windowS,
  width,
  height,
  lineColor = "#3b82f6",
  yMin,
  yMax,
  pollMs = 2000,
}: TrendCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);

  // Polling loop — fetches the last `windowS` seconds of data.
  useEffect(() => {
    if (!tag) return;
    let cancelled = false;

    const tick = async () => {
      const now = Date.now();
      try {
        const data = await api.getHistory(tag, { fromMs: now - windowS * 1000, toMs: now });
        if (!cancelled) setSamples(data);
      } catch {
        // Runtime offline / endpoint missing — keep last data; the canvas
        // will just stop refreshing rather than going blank.
      }
    };

    tick();
    const id = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [tag, windowS, pollMs]);

  // Redraw whenever samples change or the size shifts.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Match backing store to CSS pixels for crisp lines on HiDPI.
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

    if (samples.length < 2) {
      ctx.fillStyle = "#475569";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        tag ? "In attesa di campioni…" : "Tag non configurato",
        width / 2,
        height / 2,
      );
      return;
    }

    // Map samples → (x in [0..width], y in [0..height])
    const tMin = samples[0].ts_ms;
    const tMax = samples[samples.length - 1].ts_ms;
    const tSpan = Math.max(1, tMax - tMin);

    const points: { x: number; y: number | null }[] = [];
    let vMin = Number.POSITIVE_INFINITY;
    let vMax = Number.NEGATIVE_INFINITY;
    for (const s of samples) {
      const n = sampleToNumber(s.value);
      if (n !== null) {
        if (n < vMin) vMin = n;
        if (n > vMax) vMax = n;
      }
    }
    const autoFit = !(yMin !== undefined && yMax !== undefined && (yMin !== 0 || yMax !== 0));
    const yLo = autoFit ? vMin : yMin!;
    const yHi = autoFit ? vMax : yMax!;
    const ySpan = Math.max(1e-9, yHi - yLo);
    const pad = 6;
    const plotW = width - pad * 2;
    const plotH = height - pad * 2;

    for (const s of samples) {
      const n = sampleToNumber(s.value);
      const x = pad + ((s.ts_ms - tMin) / tSpan) * plotW;
      const y = n === null ? null : pad + plotH - ((n - yLo) / ySpan) * plotH;
      points.push({ x, y });
    }

    // Y-axis grid: 3 horizontal lines, no labels (Phase 2 polish)
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = pad + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
    }

    // Line
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let pen = false;
    for (const p of points) {
      if (p.y === null) { pen = false; continue; }
      if (!pen) { ctx.moveTo(p.x, p.y); pen = true; }
      else      { ctx.lineTo(p.x, p.y); }
    }
    ctx.stroke();

    // Current-value badge top-right
    const last = samples[samples.length - 1];
    const lastN = sampleToNumber(last.value);
    if (lastN !== null) {
      const txt = `${lastN.toFixed(2)}`;
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(txt, width - pad, pad + 11);
    }
  }, [samples, width, height, lineColor, yMin, yMax, tag]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: "block" }}
    />
  );
}
