// The keyframes of the animated pieces (plan
// docs/plans/2026-11-19-animazioni-dei-simboli.md): one named rule per
// parameter, written once in a `<style>` of the document head.
//
// Named rules and not `var()` inside `@keyframes`: the browsers of the panels
// are not all recent, and a named rule works everywhere. And their own
// `<style>`: the symbol editor draws symbols without the canvas, whose
// `<style>` holds the keyframes of the page objects.

import { pulseOpacity } from "./behaviour";

const STYLE_ID = "sws-piece-keyframes";
const written = new Set<string>();

function ensure(name: string, body: string): string {
  if (typeof document === "undefined" || written.has(name)) return name;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.appendChild(document.createTextNode(`@keyframes ${name} {${body}}\n`));
  written.add(name);
  return name;
}

/** Vibration: 0, +a, 0, −a, a quarter of the period each (with `step-end`,
 *  each quarter holds the value at its start, as `vibrateStep`). */
export function vibrateKeyframes(axis: "x" | "y", amplitude: number): string {
  const a = Math.round(amplitude * 100) / 100;
  const t = (d: number) => (axis === "x" ? `translate(${d}px, 0)` : `translate(0, ${d}px)`);
  return ensure(`sws-vib-${axis}-${String(a).replace(/[^0-9]/g, "_")}`,
    `0%{transform:${t(0)}}25%{transform:${t(a)}}50%{transform:${t(0)}}75%{transform:${t(-a)}}100%{transform:${t(0)}}`);
}

/** The steps of a pulse, sampled from `pulseOpacity`: the browser draws
 *  straight lines between them. */
export function pulseStops(depth: number): [number, number][] {
  return Array.from({ length: 11 }, (_, i) => [i * 10, Math.round(pulseOpacity(i * 100, 1000, depth) * 1000) / 1000]);
}

export function pulseKeyframes(depth: number): string {
  const d = Math.round(Math.min(1, Math.max(0, depth)) * 100);
  return ensure(`sws-pulse-${d}`, pulseStops(d / 100).map(([p, o]) => `${p}%{opacity:${o}}`).join(""));
}

/** The blink of a signal entry: the same square wave as `sws-obj-blink` on the
 *  canvas (dim in the first half, with `step-start`). */
export function blinkKeyframes(): string {
  return ensure("sws-piece-blink", "50%{opacity:.15}");
}

/** The turn of a rotor, for drawings shown without the canvas. */
export function spinKeyframes(): string {
  return ensure("sws-piece-spin", "from{transform:rotate(0deg)}to{transform:rotate(360deg)}");
}
