/** The trend shows a Bad tag as invalid, not as a valid line (test of the
 *  rc.29 on the WP630, 23-11-2026; plan `docs/plans/2026-11-23-correzioni-collaudo-rc30.md`, B).
 *
 *  History is requested with `ancora: true`, which repeats and prolongs the last
 *  sample: a Bad tag arrives as two Bad samples, and was drawn as a flat line at
 *  0.0 with «0» in the current-value badge. Buckets (windows over 15 minutes)
 *  carry no quality at all. The warning therefore follows the LIVE quality of
 *  each trace; the line breaks only on raw Bad samples. The LVGL twin is in
 *  `sws-lvgl-viewer/src/trend.rs` (`bad_quality_*`) and `lvgl_render.rs` (`trend_quality_tests`). */
import { act, render, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BucketSample, Sample, SynopticObject, TagState } from "@/types";

const history = vi.hoisted(() => ({
  raw: new Map<string, Sample[]>(),
  buckets: new Map<string, BucketSample[]>(),
  /** Requests answered: before the first one the chart is empty anyway. */
  served: 0,
}));

vi.mock("@/api/client", async () => {
  const real = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...real,
    api: {
      getHistory: async (tag: string) => { history.served++; return history.raw.get(tag) ?? []; },
      getHistoryBuckets: async (tag: string) => { history.served++; return history.buckets.get(tag) ?? []; },
      getAlarmHistory: async () => [],
      exportHistoryCsv: () => {},
    },
  };
});

import "../src/i18n/index";
import { BAD_QUALITY_COLOR, PALETTE, TrendCanvas, buildRuns, hasDrawableData, traceIsBad } from "@/canvas/TrendCanvas";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { TrendExpandedModal } from "@/canvas/TrendExpanded";
import { LinguaContenutiProvider } from "@/i18n/linguaContenuti";

/** A 2D context that records what is drawn: every method call with the
 *  fill/stroke colour in force at that moment. */
type Call = { fn: string; args: unknown[]; fillStyle: unknown; strokeStyle: unknown };
const calls: Call[] = [];
function fakeContext(): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {};
  return new Proxy(state, {
    get(target, prop: string) {
      if (prop === "measureText") return (s: string) => ({ width: s.length * 6 });
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push({ fn: prop, args, fillStyle: target.fillStyle, strokeStyle: target.strokeStyle });
      };
    },
    set(target, prop: string, v) {
      target[prop] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
  (() => fakeContext()) as unknown as HTMLCanvasElement["getContext"],
);
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The calls of the last complete draw pass (each one starts by filling the background). */
function lastDraw(): Call[] {
  let start = 0;
  calls.forEach((c, i) => {
    if (c.fn === "fillRect" && c.args[0] === 0 && c.args[1] === 0) start = i;
  });
  return calls.slice(start);
}
const texts = (draw: Call[]) => draw.filter((c) => c.fn === "fillText").map((c) => ({ text: c.args[0], color: c.fillStyle }));
const strokes = (draw: Call[]) => draw.filter((c) => c.fn === "stroke").map((c) => c.strokeStyle);

const NOW = Date.now();
const s = (ts: number, value: number, quality: Sample["quality"] = "Good"): Sample => ({ ts_ms: ts, value, quality });
/** What `ancora` returns for a tag Bad for longer than the window: the Bad
 *  sample repeated at the start and prolonged to now. */
const anchoredBad = (windowS: number): Sample[] => [s(NOW - windowS * 1000, 0, "Bad"), s(NOW, 0, "Bad")];
const ramp = (windowS: number): Sample[] =>
  Array.from({ length: 6 }, (_, i) => s(NOW - windowS * 1000 + (i * windowS * 1000) / 5, 10 + i));

const it_ = { lang: "it", table: null };
const INVALID = "Dato non valido";
/** The colour of the current-value badge when it prints a number. */
const BADGE_COLOR = "#94a3b8";

beforeEach(() => {
  calls.length = 0;
  history.raw.clear();
  history.buckets.clear();
  history.served = 0;
});

/** Waits until the history has been served and drawn: an empty chart with a
 *  live Bad trace already says «Dato non valido», so waiting for the text
 *  alone would pass before the data arrives. */
async function historyDrawn() {
  await waitFor(() => expect(history.served).toBeGreaterThan(0));
  await act(async () => { await Promise.resolve(); });
}

describe("buildRuns — the pen lifts on Bad samples", () => {
  const xAt = (ts: number) => ts;
  const yAt = (v: number) => v;
  it("Good, Bad, Good gives two runs", () => {
    const runs = buildRuns([s(1, 1), s(2, 2), s(3, 0, "Bad"), s(4, 4), s(5, 5)], xAt, yAt);
    expect(runs).toEqual([[{ x: 1, y: 1 }, { x: 2, y: 2 }], [{ x: 4, y: 4 }, { x: 5, y: 5 }]]);
  });
  it("all Bad gives no run", () => {
    expect(buildRuns([s(1, 0, "Bad"), s(2, 0, "Bad")], xAt, yAt)).toEqual([]);
  });
  it("a Bad tail ends the run", () => {
    expect(buildRuns([s(1, 1), s(2, 2), s(3, 0, "Bad")], xAt, yAt)).toEqual([[{ x: 1, y: 1 }, { x: 2, y: 2 }]]);
  });
  it("Uncertain stays drawn", () => {
    expect(buildRuns([s(1, 1, "Uncertain"), s(2, 2, "Uncertain")], xAt, yAt)).toEqual([[{ x: 1, y: 1 }, { x: 2, y: 2 }]]);
  });
});

describe("the waiting condition counts drawable samples", () => {
  it("an anchored all-Bad series has nothing to draw", () => {
    expect(hasDrawableData([anchoredBad(60)])).toBe(false);
    expect(hasDrawableData([ramp(60)])).toBe(true);
  });
  it("the live quality wins; without it, the last raw sample decides", () => {
    expect(traceIsBad(ramp(60), "Bad")).toBe(true);
    expect(traceIsBad(anchoredBad(60), "Good")).toBe(false);
    expect(traceIsBad(anchoredBad(60), undefined)).toBe(true);
    expect(traceIsBad(ramp(60), "Uncertain")).toBe(false);
  });
});

describe("TrendCanvas with a Bad trace", () => {
  it("an anchored all-Bad series with live Bad says «Dato non valido», not an empty chart", async () => {
    history.raw.set("t", anchoredBad(60));
    render(
      <LinguaContenutiProvider value={it_}>
        <TrendCanvas tags={["t"]} windowS={60} width={300} height={160} liveQualities={["Bad"]} />
      </LinguaContenutiProvider>,
    );
    await historyDrawn();
    const draw = lastDraw();
    // In the centre, where «In attesa di campioni…» was.
    expect(draw.filter((c) => c.fn === "fillText" && c.args[0] === INVALID).map((c) => [c.args[1], c.args[2], c.fillStyle]))
      .toEqual([[150, 80, BAD_QUALITY_COLOR]]);
    expect(texts(draw).map((t) => t.text)).not.toContain("In attesa di campioni…");
    // Nothing drawn as if it were valid: no line, no «0» badge.
    expect(strokes(draw)).not.toContain(PALETTE[0]);
    expect(texts(draw).filter((t) => t.color === BADGE_COLOR)).toEqual([]);
  });

  it("without live Bad and without samples it still waits", async () => {
    render(
      <LinguaContenutiProvider value={it_}>
        <TrendCanvas tags={["t"]} windowS={60} width={300} height={160} liveQualities={["Good"]} />
      </LinguaContenutiProvider>,
    );
    await historyDrawn();
    expect(texts(lastDraw())).toContainEqual({ text: "In attesa di campioni…", color: "#475569" });
  });

  it("a bucketed window with live Bad shows the warning in the badge, though buckets carry no quality", async () => {
    const windowS = 3600;
    history.buckets.set("t", Array.from({ length: 5 }, (_, i) => ({
      ts_ms: NOW - windowS * 1000 + i * 600_000, min: 0, max: 0, avg: 0, first: 0, last: 0, count: 10,
    })));
    render(
      <LinguaContenutiProvider value={it_}>
        <TrendCanvas tags={["t"]} windowS={windowS} width={300} height={160} liveQualities={["Bad"]} />
      </LinguaContenutiProvider>,
    );
    await historyDrawn();
    expect(texts(lastDraw())).toContainEqual({ text: INVALID, color: BAD_QUALITY_COLOR });
    // The bucket line is untouched in the rc (the buckets have no quality to break on),
    // and the badge no longer prints the number.
    expect(strokes(lastDraw())).toContain(PALETTE[0]);
    expect(texts(lastDraw()).filter((t) => t.color === BADGE_COLOR)).toEqual([]);
  });

  it("the «Espandi» modal gets the live quality too: a bucketed window with a Bad tag says so (review of the rc.30)", async () => {
    const windowS = 3600;
    history.buckets.set("t", Array.from({ length: 5 }, (_, i) => ({
      ts_ms: NOW - windowS * 1000 + i * 600_000, min: 0, max: 0, avg: 0, first: 0, last: 0, count: 10,
    })));
    render(
      <LinguaContenutiProvider value={it_}>
        <TrendExpandedModal tags={["t"]} windowS={windowS} liveQualities={["Bad"]} onClose={() => {}} />
      </LinguaContenutiProvider>,
    );
    await historyDrawn();
    expect(texts(lastDraw())).toContainEqual({ text: INVALID, color: BAD_QUALITY_COLOR });
    expect(texts(lastDraw()).filter((t) => t.color === BADGE_COLOR)).toEqual([]);
  });

  it("two traces, one Bad: the Good one stays drawn in its colour, the Bad one is marked in the legend", async () => {
    history.raw.set("good", ramp(60));
    history.raw.set("bad", anchoredBad(60));
    render(
      <LinguaContenutiProvider value={it_}>
        <TrendCanvas tags={["good", "bad"]} windowS={60} width={400} height={160} liveQualities={["Good", "Bad"]} />
      </LinguaContenutiProvider>,
    );
    await historyDrawn();
    expect(texts(lastDraw())).toContainEqual({ text: `(${INVALID})`, color: BAD_QUALITY_COLOR });
    const draw = lastDraw();
    expect(strokes(draw)).toContain(PALETTE[0]);
    expect(strokes(draw)).not.toContain(PALETTE[1]);
    // Legend: both names in the usual colour, swatches in the trace colours.
    expect(texts(draw)).toContainEqual({ text: "good", color: "#cbd5e1" });
    expect(texts(draw)).toContainEqual({ text: "bad", color: "#cbd5e1" });
    const swatches = draw.filter((c) => c.fn === "fillRect" && c.args[2] === 8).map((c) => c.fillStyle);
    expect(swatches).toEqual([PALETTE[0], PALETTE[1]]);
    // Only the Bad trace is marked, and no centre message.
    expect(texts(draw).filter((t) => t.text === `(${INVALID})`)).toHaveLength(1);
    expect(texts(draw).map((t) => t.text)).not.toContain(INVALID);
  });

  it("in edit the demo sinusoid stays for an empty series, and the live Bad still shows", async () => {
    render(
      <LinguaContenutiProvider value={it_}>
        <TrendCanvas tags={["t"]} windowS={60} width={300} height={160} liveQualities={["Bad"]} editPreview />
      </LinguaContenutiProvider>,
    );
    await historyDrawn();
    expect(texts(lastDraw())).toContainEqual({ text: INVALID, color: BAD_QUALITY_COLOR });
    expect(strokes(lastDraw())).toContain(PALETTE[0]);
    expect(texts(lastDraw()).map((t) => t.text)).toContain("anteprima");
  });
});

describe("the trend object passes the live quality of its traces", () => {
  const objects = [{ id: "tr", type: "trend", x: 0, y: 0, width: 300, height: 160, window_s: 60, trend_tags: [{ tag: "t" }] }] as SynopticObject[];
  const st = (value: number, quality: TagState["quality"]): TagState => ({ value, quality, timestamp_ms: NOW });
  const page = (values: Record<string, TagState>) => (
    <LinguaContenutiProvider value={it_}>
      <SvgCanvas objects={objects} tagValues={values} />
    </LinguaContenutiProvider>
  );

  it("a Bad tag reaches the canvas; a value change alone doesn't redraw it", async () => {
    history.raw.set("t", anchoredBad(60));
    const { rerender } = render(page({ t: st(0, "Good") }));
    await historyDrawn();
    expect(texts(lastDraw()).map((t) => t.text)).toContain("In attesa di campioni…");
    rerender(page({ t: st(0, "Bad") }));
    await waitFor(() => expect(texts(lastDraw())).toContainEqual({ text: INVALID, color: BAD_QUALITY_COLOR }));
    context.mockClear();
    rerender(page({ t: st(1, "Bad") }));
    expect(context).not.toHaveBeenCalled();
  });
});
