// The moving effects of the symbols in the browser (plan
// docs/plans/2026-11-21-simboli-fase-8-effetti.md): bubbles, smoke, flame. The
// maintainer chose native animations on each engine: here SVG's own (SMIL),
// continuous; the panel draws frames from `sws-core/src/symbol_fx.rs`. The two
// share the numbers — where each bubble is, how big, how far it goes — and
// `tests/fixtures/symbol-fx.json` keeps them equal.

import type { ParteLib } from "./manifest";

const frac = (v: number) => v - Math.floor(v);

export const BUBBLE_COLOUR = "#bae6fd";
export const SMOKE_COLOUR = "#9ca3af";
export const SMOKE_PUFFS = 4;

/** The `i`-th bubble of `n` in the box: twin of `bubble` in symbol_fx.rs. */
export function bubble(i: number, n: number, x: number, y: number, w: number, h: number) {
  void n;
  const r = Math.max(Math.min(w, h) * 0.06 * (0.7 + 0.6 * frac(i * 0.37)), 0.8);
  return { cx: x + w * (0.1 + 0.8 * frac(i * 0.618034 + 0.13)), cy0: y + h - r, r, travel: Math.max(h - 2 * r, 0) };
}

/** Twin of `bubble_opacity`: the `keyTimes` below say the same. */
export function bubbleOpacity(phase: number): number {
  return phase < 0.1 ? phase / 0.1 : phase > 0.85 ? (1 - phase) / 0.15 : 1;
}

/** One puff of smoke: twin of `puff` in symbol_fx.rs. */
export function puff(i: number, x: number, y: number, w: number, h: number) {
  const side = i % 2 === 0 ? 1 : -1;
  const mid = x + w * 0.5;
  const r0 = w * 0.12;
  return { cx0: mid - 0.1 * w * side, cx1: mid + 0.1 * w * side, cy0: y + h - r0, cy1: y + h * 0.15, r0, r1: w * 0.37 };
}

export function isEffect(p: ParteLib | undefined): boolean {
  return p?.kind === "bubbles" || p?.kind === "smoke";
}

/** The effect of part `p`, moving: drawn over its layer while its input is true. */
export function EffectSvg({ p }: { p: ParteLib }) {
  if (p.kind === "smoke") {
    const period = p.period_ms ?? 2000;
    const c = p.color ?? SMOKE_COLOUR;
    return (
      <g data-fx="smoke" pointerEvents="none">
        {Array.from({ length: SMOKE_PUFFS }, (_, i) => {
          const q = puff(i, p.x, p.y, p.w, p.h);
          const a = { dur: `${period}ms`, begin: `${-(i / SMOKE_PUFFS) * period}ms`, repeatCount: "indefinite" };
          return (
            <circle key={i} cx={q.cx0} cy={q.cy0} r={q.r0} fill={c} stroke="none" opacity={0}>
              <animate attributeName="cx" from={q.cx0} to={q.cx1} {...a} />
              <animate attributeName="cy" from={q.cy0} to={q.cy1} {...a} />
              <animate attributeName="r" from={q.r0} to={q.r1} {...a} />
              <animate attributeName="opacity" values="0.6;0" {...a} />
            </circle>
          );
        })}
      </g>
    );
  }
  if (p.kind !== "bubbles") return null;
  const n = Math.max(1, Math.min(12, p.count ?? 6));
  const period = `${p.period_ms ?? 2000}ms`;
  const c = p.color ?? BUBBLE_COLOUR;
  return (
    <g data-fx="bubbles" pointerEvents="none">
      {Array.from({ length: n }, (_, i) => {
        const b = bubble(i, n, p.x, p.y, p.w, p.h);
        // A negative start: bubble i is already i/n along its way at time 0,
        // as `phase = frac(t + i/n)` on the panel.
        const begin = `${-(i / n) * (p.period_ms ?? 2000)}ms`;
        return (
          <circle key={i} cx={b.cx} cy={b.cy0} r={b.r} fill={c} fillOpacity={0.35} stroke={c}
            strokeWidth={Math.max(0.3, b.r * 0.25)} opacity={0}>
            <animate attributeName="cy" from={b.cy0} to={b.cy0 - b.travel} dur={period} begin={begin} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur={period} begin={begin} repeatCount="indefinite" />
          </circle>
        );
      })}
    </g>
  );
}
