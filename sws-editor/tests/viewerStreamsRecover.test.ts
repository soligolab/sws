// The viewer page that stayed frozen after «delete only the project» (collaudo
// of 2.27.0-dev.3 on the PLX800, 25-11-2026; plan
// docs/plans/2026-11-25-correzioni-collaudo-dev3.md, part A).
//
// After the reset the runtime answered but refused the sockets for two
// minutes. The tag socket gave up after six attempts, and the deploy that
// followed loaded the pages but left the values frozen, with the commands
// lost, until the browser started again. These tests hold the two parts of the
// correction: the streams of the viewer never give up, and after a reset the
// page loads again when the runtime answers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { socketCondiviso } from "@/ws/singletonWs";
import { keepStreamsAlive, resetStreamPolicy, streamsKeptAlive } from "@/ws/streamPolicy";
import { CHECK_EVERY_MS, FIRST_CHECK_MS, reloadWhenBack, type ReloadDeps } from "@/control-panel/reloadWhenBack";

class FakeWs {
  static last: FakeWs | null = null;
  static opened = 0;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  private listeners = new Map<string, Set<(ev: unknown) => void>>();
  constructor(public url: string) { FakeWs.last = this; FakeWs.opened += 1; }
  addEventListener(t: string, h: (ev: unknown) => void) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(h);
  }
  removeEventListener(t: string, h: (ev: unknown) => void) { this.listeners.get(t)?.delete(h); }
  close() { /* noop */ }
  /** Opens and closes at once: what a refusing runtime does. */
  refuse() {
    this.listeners.get("open")?.forEach((h) => h({}));
    this.listeners.get("close")?.forEach((h) => h({ code: 1006, reason: "" }));
  }
}

/** A runtime that refuses every attempt for minutes, like the PLX800 after
 *  the reset: each new socket is refused, then the wait runs out. */
function refuseTwelveTimes() {
  for (let i = 0; i < 12; i++) {
    FakeWs.last!.refuse();
    vi.advanceTimersByTime(60_000);
  }
}

describe("the live streams of the viewer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWs.opened = 0; FakeWs.last = null;
    vi.stubGlobal("WebSocket", FakeWs as unknown as typeof WebSocket);
    resetStreamPolicy();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetStreamPolicy();
  });

  it("in the viewer they never give up: after twelve refusals they still try", () => {
    keepStreamsAlive();
    const socket = socketCondiviso(() => "ws://panel/ws/tags", () => ({ persistent: streamsKeptAlive() }));
    socket.prendi();
    refuseTwelveTimes();
    // Twelve refusals, and a thirteenth attempt already open: no giving up.
    expect(FakeWs.opened).toBe(13);
  });

  it("in the IDE they still give up after six unstable connections", () => {
    const socket = socketCondiviso(() => "ws://ide/ws/tags", () => ({ persistent: streamsKeptAlive() }));
    socket.prendi();
    refuseTwelveTimes();
    const before = FakeWs.opened;
    vi.advanceTimersByTime(120_000);
    expect(FakeWs.opened).toBe(before);
    expect(before).toBeLessThanOrEqual(6);
  });

  it("a stream that gave up opens again when asked (a new project)", () => {
    const socket = socketCondiviso(() => "ws://ide/ws/tags");
    socket.prendi();
    refuseTwelveTimes();
    const before = FakeWs.opened;
    socket.riprova();
    expect(FakeWs.opened).toBe(before + 1);
  });
});

describe("after a reset the page loads again", () => {
  function fakeDeps(answers: boolean[]) {
    const timers: { fn: () => void; ms: number; id: number }[] = [];
    let next = 1;
    const deps: ReloadDeps & { reloads: number; asked: number } = {
      reloads: 0,
      asked: 0,
      answers: () => { deps.asked += 1; return Promise.resolve(answers.shift() ?? true); },
      reload: () => { deps.reloads += 1; },
      setTimer: (fn, ms) => { const id = next++; timers.push({ fn, ms, id }); return id; },
      clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    };
    /** Runs the timer that is waiting, and lets its check finish. */
    const tick = async () => {
      const t = timers.shift();
      if (!t) return null;
      t.fn();
      await Promise.resolve();
      await Promise.resolve();
      return t.ms;
    };
    return { deps, tick, timers };
  }

  it("waits for the runtime, then loads the page once", async () => {
    const { deps, tick } = fakeDeps([false, false, true]);
    reloadWhenBack(deps);
    expect(await tick()).toBe(FIRST_CHECK_MS);
    expect(deps.reloads).toBe(0);
    expect(await tick()).toBe(CHECK_EVERY_MS);
    expect(deps.reloads).toBe(0);
    expect(await tick()).toBe(CHECK_EVERY_MS);
    expect(deps.reloads).toBe(1);
    expect(await tick()).toBeNull();
  });

  it("does not check before the old process is gone", async () => {
    const { deps, timers } = fakeDeps([true]);
    reloadWhenBack(deps);
    expect(deps.asked).toBe(0);
    expect(timers[0].ms).toBe(FIRST_CHECK_MS);
  });

  it("stops when the panel goes away", async () => {
    const { deps, tick, timers } = fakeDeps([true]);
    const stop = reloadWhenBack(deps);
    stop();
    expect(timers).toHaveLength(0);
    expect(await tick()).toBeNull();
    expect(deps.reloads).toBe(0);
  });
});
