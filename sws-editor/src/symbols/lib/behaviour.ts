// How the live parts of a symbol match their input and how the timed ones
// move (plan docs/plans/2026-11-19-animazioni-dei-simboli.md). Pure: twin of
// `sws-core/src/symbol_behaviour.rs`, with the cases in
// `tests/fixtures/symbol-pieces.json` — if the two engines diverged, the same
// tag would draw two different symbols.

import type { FillDir, SignalEntry } from "./manifest";

/** The first entry of a signal that `v` matches: by range when the entry has
 *  `value_min` or `value_max` (half-open, `min <= v < max`), otherwise by exact
 *  value compared as text. The rule of `matchTextListEntry`. */
export function signalEntry(entries: SignalEntry[], v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  const i = entries.findIndex((e) => {
    if (e.value_min !== undefined || e.value_max !== undefined) {
      if (!Number.isFinite(n)) return false;
      if (e.value_min !== undefined && n < e.value_min) return false;
      if (e.value_max !== undefined && n >= e.value_max) return false;
      return true;
    }
    return e.value !== undefined && String(e.value) === String(v);
  });
  return i < 0 ? null : i;
}

/** The shortest period of a vibration: at 20 frames a second a step lasts at
 *  least one frame. */
export const MIN_VIBRATE_MS = 200;
/** The shortest period of a pulse and of a blink. */
export const MIN_PERIOD_MS = 200;

/** The step of a vibration: 0, +1, 0, −1, a quarter of the period each. */
export function vibrateStep(ms: number, periodMs: number): -1 | 0 | 1 {
  const p = Math.floor(Math.max(periodMs, MIN_VIBRATE_MS));
  const q = Math.floor(((ms % p) * 4) / p);
  return q === 1 ? 1 : q === 3 ? -1 : 0;
}

/** The opacity of a pulse: 1 at the start and the end of the period, `1 −
 *  depth` in the middle, along a cosine. */
export function pulseOpacity(ms: number, periodMs: number, depth: number): number {
  const p = Math.floor(Math.max(periodMs, MIN_PERIOD_MS));
  const t = (ms % p) / p;
  const s = (1 - Math.cos(2 * Math.PI * t)) / 2;
  return 1 - Math.min(1, Math.max(0, depth)) * s;
}

/** Whether a blinking piece is dim now: the first half of the period, as
 *  `sws-obj-blink` with `step-start`. */
export function blinkDim(ms: number, periodMs: number): boolean {
  const p = Math.floor(Math.max(periodMs, 50));
  return ms % p < Math.floor(p / 2);
}

/** The window of a level at fraction `f`: the part of `[x, y, w, h]` the
 *  content fills, growing from `dir`'s side. */
export function levelWindow(dir: FillDir | undefined, [x, y, w, h]: [number, number, number, number], f: number): [number, number, number, number] {
  const k = Math.min(1, Math.max(0, f));
  switch (dir ?? "up") {
    case "down": return [x, y, w, h * k];
    case "right": return [x, y, w * k, h];
    case "left": return [x + w * (1 - k), y, w * k, h];
    default: return [x, y + h * (1 - k), w, h * k];
  }
}

/** Where a slide is at fraction `f`. */
export function slideOffset(f: number, dx: number, dy: number): [number, number] {
  const k = Math.min(1, Math.max(0, f));
  return [dx * k, dy * k];
}

/** A linear move from `from` to `to`, started at `t0`, lasting `ms`. */
export function transitionAt(t: { from: number; to: number; t0: number; ms: number }, now: number): number {
  if (t.ms <= 0) return t.to;
  const k = Math.min(1, Math.max(0, (now - t.t0) / t.ms));
  return t.from + (t.to - t.from) * k;
}

/** The period a rotor turns with on a panel drawing `fps` frames a second: the
 *  step per frame is kept under 0.45 × symmetry, or the wheel looks still or
 *  backwards. The web keeps the true speed; this is for the panel's preview. */
export function rotorPeriodForFps(periodS: number, symmetry: number, fps: number): number {
  if (!(symmetry > 0) || !(fps > 0)) return periodS;
  return Math.max(periodS, 360 / (0.45 * symmetry * fps));
}
