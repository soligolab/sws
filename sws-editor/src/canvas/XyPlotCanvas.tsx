/**
 * Live point + trailing trail plotted against two tags (X/Y), not against
 * time — for trajectories/position (e.g. a gantry's X/Y, a joystick). Unlike
 * TrendCanvas, which fetches history over REST, this reads whatever the two
 * tags' latest values are (already flowing live into the parent's tagValues
 * via websocket) and samples them on its own interval, keeping only the
 * samples younger than `trailS`.
 */
import { useEffect, useRef, useState } from "react";

interface Point {
  x: number;
  y: number;
  t: number;
}

interface XyPlotCanvasProps {
  xValue?: number;
  yValue?: number;
  trailS?: number;
  width: number;
  height: number;
  lineColor?: string;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  pollMs?: number;
}

const PAD = 22;

export function XyPlotCanvas({
  xValue, yValue, trailS = 30, width, height,
  lineColor = "var(--brand-primary, #3b82f6)",
  xMin, xMax, yMin, yMax, pollMs = 200,
}: XyPlotCanvasProps) {
  const latest = useRef<{ x?: number; y?: number }>({});
  latest.current = { x: xValue, y: yValue };
  const [points, setPoints] = useState<Point[]>([]);

  useEffect(() => {
    const tick = () => {
      const { x, y } = latest.current;
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const now = Date.now();
      const cutoff = now - trailS * 1000;
      setPoints((prev) => [...prev, { x, y, t: now }].filter((p) => p.t >= cutoff));
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => clearInterval(id);
  }, [trailS, pollMs]);

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const loXRaw = xMin ?? (xs.length ? Math.min(...xs) : 0);
  const hiXRaw = xMax ?? (xs.length ? Math.max(...xs) : 1);
  const loYRaw = yMin ?? (ys.length ? Math.min(...ys) : 0);
  const hiYRaw = yMax ?? (ys.length ? Math.max(...ys) : 1);
  const loX = loXRaw, hiX = hiXRaw <= loXRaw ? loXRaw + 1 : hiXRaw;
  const loY = loYRaw, hiY = hiYRaw <= loYRaw ? loYRaw + 1 : hiYRaw;

  const plotW = Math.max(1, width - PAD * 2);
  const plotH = Math.max(1, height - PAD * 2);
  const px = (x: number) => PAD + ((x - loX) / (hiX - loX)) * plotW;
  const py = (y: number) => height - PAD - ((y - loY) / (hiY - loY)) * plotH;

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <rect x={0} y={0} width={width} height={height} fill="var(--brand-bg, #0f172a)" />
      <rect x={PAD} y={PAD} width={plotW} height={plotH} fill="none" stroke="var(--brand-surface-2, #334155)" strokeWidth={1} />
      {points.length > 1 && (
        <path d={pathD} fill="none" stroke={lineColor} strokeWidth={1.5} strokeOpacity={0.7} />
      )}
      {last ? (
        <circle cx={px(last.x)} cy={py(last.y)} r={4} fill={lineColor} />
      ) : (
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="var(--brand-text-subtle, #64748b)" fontSize={11}>
          in attesa di dati…
        </text>
      )}
    </svg>
  );
}
