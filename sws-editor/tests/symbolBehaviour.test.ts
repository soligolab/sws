/** The live parts of a symbol and the timed pieces: **the cases are not here**,
 *  they are in `tests/fixtures/symbol-pieces.json`, and the panel checks them too
 *  (`sws-core/src/symbol_behaviour.rs`). Plan docs/archive/2026-11-19-animazioni-dei-simboli.md. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { valoriParti } from "../src/symbols/lib/libreria";
import type { FillDir, SignalEntry, SimboloLib } from "../src/symbols/lib/manifest";
import type { ParteLegata } from "../src/types";
import {
  blinkDim, levelWindow, pulseOpacity, rotorPeriodForFps, signalEntry, transitionAt, vibrateStep,
} from "../src/symbols/lib/behaviour";

type Rect = [number, number, number, number];
const fx = JSON.parse(readFileSync(resolve(__dirname, "../../tests/fixtures/symbol-pieces.json"), "utf8")) as {
  parts: SimboloLib["parts"];
  values: { name: string; bindings: Record<string, ParteLegata>; tags: Record<string, unknown>; expected: Record<string, unknown> }[];
  signal: { name: string; entries: SignalEntry[]; value: unknown; expected: number | null }[];
  time: {
    vibrate: [number, number, number][];
    pulse: [number, number, number, number][];
    blink: [number, number, boolean][];
    level_window: [FillDir, Rect, number, Rect][];
    rotor_period: [number, number, number, number][];
    transition: [number, number, number, number, number, number][];
  };
};

describe("valoriParti — the shared cases", () => {
  for (const c of fx.values) {
    it(c.name, () => {
      const v = valoriParti(fx.parts, c.bindings, (t) => c.tags[t]);
      // `null` = left out: a rotor or a level not bound follows the symbol.
      for (const [id, want] of Object.entries(c.expected)) expect(v[id] ?? null, id).toEqual(want);
    });
  }
});

describe("signalEntry — the shared cases", () => {
  for (const c of fx.signal) it(c.name, () => expect(signalEntry(c.entries, c.value)).toBe(c.expected));
});

describe("the timed pieces — the shared tables", () => {
  it("vibrate", () => {
    for (const [ms, p, want] of fx.time.vibrate) expect(vibrateStep(ms, p), `${ms} ${p}`).toBe(want);
  });
  it("pulse", () => {
    for (const [ms, p, d, want] of fx.time.pulse) expect(pulseOpacity(ms, p, d)).toBeCloseTo(want, 3);
  });
  it("blink", () => {
    for (const [ms, p, want] of fx.time.blink) expect(blinkDim(ms, p), `${ms} ${p}`).toBe(want);
  });
  it("level window", () => {
    for (const [dir, r, f, want] of fx.time.level_window) {
      levelWindow(dir, r, f).forEach((x, i) => expect(x, `${dir} ${f}`).toBeCloseTo(want[i], 9));
    }
  });
  it("rotor period on the panel", () => {
    for (const [p, s, fps, want] of fx.time.rotor_period) expect(rotorPeriodForFps(p, s, fps)).toBeCloseTo(want, 3);
  });
  it("transition", () => {
    for (const [from, to, t0, ms, now, want] of fx.time.transition) {
      expect(transitionAt({ from, to, t0, ms }, now)).toBeCloseTo(want, 9);
    }
  });
});
