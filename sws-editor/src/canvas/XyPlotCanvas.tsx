/**
 * Multi-serie: punto live + scia contro coppie di tag (X/Y), non contro il
 * tempo — per traiettorie/posizione (es. X/Y di un carrello, un joystick, un
 * percorso misurato confrontato con un target). Migrazione F5.3x/T-70
 * (2026-09-12): prima una coppia sola, ora `series[]`.
 *
 * Ogni serie campiona la propria coppia dal vivo con un timer locale (non è
 * un poll di rete: legge valori già in `tagValues`, arrivati via websocket)
 * e fa un backfill una tantum dallo storico al mount (`GET /api/history/xy`,
 * accoppiato per riempimento lato server — vedi `merge_xy` in
 * sws-historian). Niente polling di rete ripetuto: "widget con storico: una
 * fetch al mount, niente polling in edit" (regole UI dell'editor, CLAUDE.md).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { predefinito } from "@/coloriPredefiniti";

export interface XyPlotSeriesLive {
  tag: string;
  yTag: string;
  label?: string;
  color?: string;
  width?: number;
  dash?: "solid" | "dashed" | "dotted";
  xValue?: number;
  yValue?: number;
}

interface Point {
  x: number;
  y: number;
  t: number;
}

interface XyPlotCanvasProps {
  series: XyPlotSeriesLive[];
  trailS?: number;
  width: number;
  height: number;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  /** Campionamento live in ms. Default 200 — comportamento invariato dalla
   *  versione a coppia singola. */
  sampleMs?: number;
  xLabel?: string;
  yLabel?: string;
  /** Universal background layer (color + image URL), same semantics as the
   *  other widgets' bg_color/bg_image. */
  bgColor?: string;
  bgImage?: string;
}

const PAD = 22;

// Stessa proporzione di `DASH_MAP` in TrendCanvas.tsx, tradotta in
// `stroke-dasharray` SVG invece che `ctx.setLineDash` (Canvas 2D).
const DASH_MAP: Record<NonNullable<XyPlotSeriesLive["dash"]>, string | undefined> = {
  solid: undefined,
  dashed: "6 3",
  dotted: "1 3",
};

// Colori di ripiego per le serie senza `color` esplicito — stesso spirito
// della palette di default usata altrove nel progetto per liste di serie.
const DEFAULT_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899"];

export function XyPlotCanvas({
  series, trailS = 30, width, height,
  xMin, xMax, yMin, yMax, sampleMs = 200,
  xLabel, yLabel, bgColor, bgImage,
}: XyPlotCanvasProps) {
  const { t } = useTranslation();
  const latest = useRef<{ x?: number; y?: number }[]>([]);
  latest.current = series.map((s) => ({ x: s.xValue, y: s.yValue }));
  const [pointsBySeries, setPointsBySeries] = useState<Point[][]>(() => series.map(() => []));

  // Il numero di serie può cambiare (aggiunta/rimossa dall'editor): se
  // cambia, si riparte da array vuoti invece di disallineare gli indici.
  useEffect(() => {
    setPointsBySeries((prev) => (prev.length === series.length ? prev : series.map(() => [])));
  }, [series.length]);

  // Backfill una tantum per coppia tag/y_tag, chiave sul contenuto delle
  // coppie e non sulla reference di `series` (che cambia a ogni render).
  const seriesKey = series.map((s) => `${s.tag}|${s.yTag}`).join(",");
  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const fromMs = now - trailS * 1000;
    series.forEach((s, i) => {
      if (!s.tag || !s.yTag) return;
      api.getHistoryXy(s.tag, s.yTag, { fromMs, toMs: now })
        .then((pts) => {
          if (cancelled) return;
          const hist: Point[] = pts.map((p) => ({ x: p.x, y: p.y, t: p.ts_ms }));
          setPointsBySeries((prev) => {
            if (i >= prev.length) return prev; // le serie sono cambiate nel frattempo
            // Storico più eventuali punti live già arrivati prima che la
            // fetch tornasse — il backfill non deve cancellarli.
            const cur = prev[i] ?? [];
            const merged = [...hist, ...cur.filter((p) => !hist.some((h) => h.t === p.t))];
            merged.sort((a, b) => a.t - b.t);
            const next = [...prev];
            next[i] = merged;
            return next;
          });
        })
        .catch(() => {
          // Runtime offline o tag assente: il campionamento live prosegue comunque.
        });
    });
    return () => { cancelled = true; };
    // `series` è intenzionalmente fuori dalle dipendenze: la chiave è
    // `seriesKey` (tag/y_tag), non colore/label/dash che non cambiano il
    // backfill da rifare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey, trailS]);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const cutoff = now - trailS * 1000;
      setPointsBySeries((prev) =>
        prev.map((pts, i) => {
          const { x, y } = latest.current[i] ?? {};
          const withNew =
            x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)
              ? [...pts, { x, y, t: now }]
              : pts;
          return withNew.filter((p) => p.t >= cutoff);
        }),
      );
    };
    tick();
    const id = setInterval(tick, sampleMs);
    return () => clearInterval(id);
  }, [trailS, sampleMs, series.length]);

  const allPoints = pointsBySeries.flat();
  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);
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

  const hasAnyPoint = allPoints.length > 0;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <rect x={0} y={0} width={width} height={height} fill={bgColor ?? predefinito("xy_plot", "bg_color") ?? "#0f172a"} />
      {bgImage && (
        <image href={bgImage} x={0} y={0} width={width} height={height}
          preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: "none" }} />
      )}
      <rect x={PAD} y={PAD} width={plotW} height={plotH} fill="none" stroke="#334155" strokeWidth={1} />
      {series.map((s, i) => {
        const pts = pointsBySeries[i] ?? [];
        if (pts.length < 1) return null;
        const color = s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];
        const pathD = pts.map((p, j) => `${j === 0 ? "M" : "L"} ${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join(" ");
        const last = pts[pts.length - 1];
        return (
          <g key={i}>
            {pts.length > 1 && (
              <path d={pathD} fill="none" stroke={color} strokeWidth={s.width ?? 1.5}
                strokeOpacity={0.7} strokeDasharray={DASH_MAP[s.dash ?? "solid"]} />
            )}
            <circle cx={px(last.x)} cy={py(last.y)} r={4} fill={color} />
          </g>
        );
      })}
      {!hasAnyPoint && (
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#64748b" fontSize={11}>
          {t("xyPlot.waiting")}
        </text>
      )}
      {xLabel && (
        <text x={PAD + plotW / 2} y={height - 6} textAnchor="middle" fill="#64748b" fontSize={10}>
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text x={11} y={PAD + plotH / 2} textAnchor="middle" fill="#64748b" fontSize={10}
          transform={`rotate(-90 11 ${PAD + plotH / 2})`}>
          {yLabel}
        </text>
      )}
    </svg>
  );
}
