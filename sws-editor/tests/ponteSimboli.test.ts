// The bridge between the IDE and the symbol editor's own window (22-11-2026):
// the window gets the symbol and the project from the IDE, asks the version
// and the symbols before writing, and the IDE takes what was written.
//
// rc.30 (test of the rc.29, 23-11-2026): every save from the window showed the
// «project changed» bar in the IDE; the window wrote its own, old list of
// symbols, erasing what the IDE had got meanwhile; and it could write into a
// project the IDE no longer had open.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../src/canvas/ImmagineSvg", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/canvas/ImmagineSvg")>()),
  dimenticaImmagine: vi.fn(),
}));

import i18n from "../src/i18n";
import { api, impostaVersioneProgetto, versioneProgetto } from "../src/api/client";
import { idEditore } from "../src/ai/ponte";
import { dimenticaImmagine } from "../src/canvas/ImmagineSvg";
import { useAppStore } from "../src/store";
import {
  avviaPonteSimboliIde, CANALE_SIMBOLI, collegaFinestra, disconnectSymbolWindow, preparaFinestra, rebaseSymbols,
  type MessaggioSimboli,
} from "../src/symbols/editor/ponteSimboli";
import { writeHooks, writeSymbols } from "../src/symbols/editor/open";
import { useProjectWatcher } from "../src/ws/projectWatcher";
import type { DescrizioneSimbolo, ProjectInfo } from "../src/types";

const sym = (slug: string, it = slug) =>
  ({ slug, w: 100, h: 140, body: "body-pump", it, en: it, ops: [] }) as unknown as DescrizioneSimbolo;
const stufa = sym("stufa", "Stufa");
const project = (simboli: DescrizioneSimbolo[], name = "Casa") =>
  ({ meta: { name, version: "1" }, tags: [], sources: [], simboli }) as unknown as ProjectInfo;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms = 2000) {
  for (const end = Date.now() + ms; !ok() && Date.now() < end;) await wait(5);
}

/** The rebaselines the bridge asks of the IDE's project watcher. */
function rebaselines() {
  const seen: unknown[] = [];
  const on = (e: Event) => { if ((e as CustomEvent).detail?.source === "symbol-window") seen.push(e); };
  window.addEventListener("sws:project-switched", on);
  return { seen, stop: () => window.removeEventListener("sws:project-switched", on) };
}

/** IDE and window in one page, as the tests have them: the same store. */
async function ideAndWindow(simboli: DescrizioneSimbolo[] = [stufa]) {
  act(() => {
    useAppStore.getState().setProject(project(simboli));
    useAppStore.getState().closeSymbolEditor();
  });
  impostaVersioneProgetto("v7");
  const stop = avviaPonteSimboliIde();
  const t = preparaFinestra({ draft: simboli[0] ?? stufa, isNew: false });
  const ok = await collegaFinestra(`#e=${encodeURIComponent(idEditore())}&t=${encodeURIComponent(t)}`);
  return { ok, stop };
}

/** The PUTs of the symbols, as the runtime would get them. */
function recordPuts() {
  const puts: DescrizioneSimbolo[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/api/project/simboli") && init?.method === "PUT") puts.push(JSON.parse(String(init.body)));
    return new Response(null, { status: 204, headers: { "content-length": "0" } });
  }));
  return puts;
}

describe("the symbol editor's own window", () => {
  let stop = () => {};
  afterEach(() => {
    stop();
    stop = () => {};
    disconnectSymbolWindow();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.mocked(dimenticaImmagine).mockClear();
  });

  it("gets the symbol and the project from the IDE, and the IDE takes what it wrote", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    const r = await ideAndWindow();
    stop = r.stop;
    expect(r.ok).toBe(true);
    expect(useAppStore.getState().symbolEditor?.draft.slug).toBe("stufa");
    expect(useAppStore.getState().symbolEditor?.inline).toBe(true);
    // The IDE saved, and got a symbol from the library, meanwhile: the window
    // writes its change on the IDE's version and on the IDE's symbols — not on
    // the list it got when it opened, which would erase «forno».
    impostaVersioneProgetto("v8");
    act(() => useAppStore.getState().updateProjectSimboli([stufa, sym("forno")]));
    const nuova = { ...stufa, it: "Stufa nuova" };
    const written = await writeHooks.before!([stufa], [nuova]);
    expect(versioneProgetto()).toBe("v8");
    expect(written.map((s) => [s.slug, s.it])).toEqual([["stufa", "Stufa nuova"], ["forno", "forno"]]);
    writeHooks.after!(written);
    await wait(50);
    expect(useAppStore.getState().project?.simboli?.map((s) => s.it)).toEqual(["Stufa nuova", "forno"]);
  });

  it("says so when no IDE answers", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    expect(await collegaFinestra("#e=nobody&t=x")).toBe(false);
  }, 10000);

  // The regression of C, end to end: the watcher of the IDE, the bridge, the window.
  it("a save from the window brings no «project changed» bar; a later change with no message does", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    stop = (await ideAndWindow()).stop;
    const fp = vi.spyOn(api, "getProjectFingerprint").mockResolvedValue({ sha256: "A", computed_at_ms: 0 } as never);
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useProjectWatcher(onChange, 100));
    try {
      await until(() => fp.mock.calls.length >= 1);
      // Right after a tick, so the next one is ~100 ms away: the window writes
      // project.yaml and tells the IDE.
      const n = fp.mock.calls.length;
      await until(() => fp.mock.calls.length > n);
      await wait(1);
      fp.mockResolvedValue({ sha256: "B", computed_at_ms: 0 } as never);
      writeHooks.after!([{ ...stufa, it: "Stufa nuova" }]);
      await wait(300);
      expect(onChange).not.toHaveBeenCalled();
      // Someone else changes the project: that one warns.
      fp.mockResolvedValue({ sha256: "C", computed_at_ms: 0 } as never);
      await until(() => onChange.mock.calls.length > 0, 1000);
      expect(onChange).toHaveBeenCalledWith("C");
    } finally {
      unmount();
    }
  });

  it("saved and wrote meant for another IDE re-fix nothing: the second tab must see the bar", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    stop = (await ideAndWindow()).stop;
    const r = rebaselines();
    const c = new BroadcastChannel(CANALE_SIMBOLI);
    c.postMessage({ type: "saved", da: "w", a: "another-ide", ref: null, simboli: [], versione: null } satisfies MessaggioSimboli);
    c.postMessage({ type: "wrote", da: "w", a: "another-ide", ref: null, path: "/api/project/images/x.png" } satisfies MessaggioSimboli);
    await wait(80);
    c.close();
    r.stop();
    expect(r.seen).toHaveLength(0);
    expect(useAppStore.getState().project?.simboli).toHaveLength(1);
  });

  it("images and «Genera foto» written by the window reach the IDE; symbols, pages and /rename don't; no loop", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    stop = (await ideAndWindow()).stop;
    const r = rebaselines();
    const write = (path: string) => window.dispatchEvent(new CustomEvent("sws:project-switched", { detail: { path } }));
    write("/api/project/images/x.png?replace=1");
    write("/api/symbols/ai/photo");
    write("/api/project/images/y%20z.png"); // a DELETE
    write("/api/project/simboli");
    write("/api/synoptics/Home");
    write("/api/project/images/x.png/rename");
    await wait(80);
    expect(r.seen).toHaveLength(3);
    expect(vi.mocked(dimenticaImmagine).mock.calls).toEqual([["/api/project/images/x.png"], ["/api/project/images/y z.png"]]);
    // The IDE's own rebaseline carries no path: nothing bounces back.
    await wait(80);
    r.stop();
    expect(r.seen).toHaveLength(3);
  });

  it("once unhooked, the window forwards nothing", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    stop = (await ideAndWindow()).stop;
    disconnectSymbolWindow();
    const r = rebaselines();
    window.dispatchEvent(new CustomEvent("sws:project-switched", { detail: { path: "/api/project/images/x.png" } }));
    await wait(80);
    r.stop();
    expect(r.seen).toHaveLength(0);
    expect(writeHooks.before).toBeNull();
    expect(writeHooks.after).toBeNull();
  });

  it("another project open in the IDE: the window refuses to save, and its messages are dropped", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    stop = (await ideAndWindow()).stop;
    const puts = recordPuts();
    act(() => useAppStore.getState().setProject(project([sym("caldaia")], "Officina")));
    const err = await writeSymbols([{ ...stufa, it: "Stufa nuova" }]);
    expect(err).toBe(i18n.t("symbolEditor.window.otherProject"));
    expect(puts).toHaveLength(0);
    // A `saved` that left before the switch changes nothing here.
    const r = rebaselines();
    writeHooks.after!([stufa]);
    await wait(80);
    r.stop();
    expect(r.seen).toHaveLength(0);
    expect(useAppStore.getState().project?.simboli?.map((s) => s.slug)).toEqual(["caldaia"]);
  });

  it("the same project closed and opened again counts as another one; an IDE reloaded on it doesn't", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    stop = (await ideAndWindow()).stop;
    act(() => useAppStore.setState({ project: null }));
    act(() => useAppStore.getState().setProject(project([stufa])));
    await expect(writeHooks.before!([stufa], [stufa])).rejects.toThrow(i18n.t("symbolEditor.window.otherProject"));
    // A window opened before a reload of the IDE: its epoch is unknown here,
    // the name decides.
    const c = new BroadcastChannel(CANALE_SIMBOLI);
    const answer = new Promise<MessaggioSimboli>((resolve) => {
      c.onmessage = (ev: MessageEvent<MessaggioSimboli>) => { if (ev.data.a === "old-window") resolve(ev.data); };
    });
    c.postMessage({ type: "ask-version", da: "old-window", a: idEditore(), ref: "-|Casa#before-the-reload" } satisfies MessaggioSimboli);
    const v = await answer;
    c.close();
    expect(v).toMatchObject({ type: "version", simboli: [{ slug: "stufa" }] });
    expect((v as { refused?: boolean }).refused).toBeFalsy();
  });
});

// The window against an IDE of its own (a channel that answers as the IDE
// would), so the window's list can be older than the IDE's.
describe("the window's list is older than the IDE's", () => {
  const A = sym("a"), B = sym("b");
  let ide: BroadcastChannel | null = null;
  afterEach(() => { ide?.close(); ide = null; disconnectSymbolWindow(); vi.unstubAllGlobals(); });

  async function windowOn(list: DescrizioneSimbolo[]) {
    const held = { list, saved: [] as DescrizioneSimbolo[][] };
    ide = new BroadcastChannel(CANALE_SIMBOLI);
    const c = ide;
    c.onmessage = (ev: MessageEvent<MessaggioSimboli>) => {
      const m = ev.data;
      if (m.a !== "fake-ide") return;
      if (m.type === "hello") {
        c.postMessage({
          type: "state", da: "fake-ide", a: m.da, target: { draft: list[0], isNew: false }, project: project(list),
          pages: [], currentPageId: null, versione: "v1", lockTab: "tab", ref: "-|Casa#e",
        } satisfies MessaggioSimboli);
      } else if (m.type === "ask-version") {
        c.postMessage({ type: "version", da: "fake-ide", a: m.da, versione: "v2", simboli: held.list } satisfies MessaggioSimboli);
      } else if (m.type === "saved") {
        held.saved.push(m.simboli);
        held.list = m.simboli;
      }
    };
    expect(await collegaFinestra("#e=fake-ide&t=x")).toBe(true);
    return held;
  }

  it("two windows on two symbols: both changes stay", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    const puts = recordPuts();
    const held = await windowOn([A, B]);
    // The other window saved a′, and the IDE took it.
    const A2 = sym("a", "a′");
    held.list = [A2, B];
    const B2 = sym("b", "b′");
    expect(await writeSymbols([A, B2])).toBeNull();
    expect(puts).toEqual([[A2, B2]]);
    await until(() => held.saved.length > 0);
    expect(held.saved).toEqual([[A2, B2]]);
    expect(useAppStore.getState().project?.simboli).toEqual([A2, B2]);
  });

  it("a symbol the IDE has and hasn't saved yet (an AI proposal) is not erased", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    const puts = recordPuts();
    const held = await windowOn([A, B]);
    held.list = [A, B, sym("proposed")];
    expect(await writeSymbols([sym("a", "a′"), B])).toBeNull();
    expect(puts[0].map((s) => s.slug)).toEqual(["a", "b", "proposed"]);
  });

  it("the same symbol changed in the IDE too: refused, nothing written", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    const puts = recordPuts();
    const held = await windowOn([A, B]);
    held.list = [sym("a", "the IDE's"), B];
    const err = await writeSymbols([sym("a", "the window's"), B]);
    expect(err).toBe(i18n.t("symbolEditor.window.conflict", { slugs: "a" }));
    expect(puts).toHaveLength(0);
    // The window keeps its list as it was.
    expect(useAppStore.getState().project?.simboli).toEqual([A, B]);
  });
});

describe("rebaseSymbols", () => {
  const A = sym("a"), B = sym("b"), C = sym("c");
  const ok = (r: ReturnType<typeof rebaseSymbols>) => {
    if (!r.ok) throw new Error(`conflict on ${r.slugs.join(", ")}`);
    return r.symbols;
  };

  it("adds, replaces and removes only what the window touched", () => {
    const A2 = sym("a", "a′");
    expect(ok(rebaseSymbols([A, B], [A2, B], [A, B, C]))).toEqual([A2, B, C]);
    expect(ok(rebaseSymbols([A, B], [A, B, sym("d")], [A, B, C]))).toEqual([A, B, C, sym("d")]);
    expect(ok(rebaseSymbols([A, B], [A], [A, B, C]))).toEqual([A, C]);
  });

  it("keeps what only the IDE changed", () => {
    const B2 = sym("b", "b in the IDE");
    expect(ok(rebaseSymbols([A, B], [sym("a", "a′"), B], [A, B2]))).toEqual([sym("a", "a′"), B2]);
  });

  it("a slug changed on both sides is a conflict", () => {
    expect(rebaseSymbols([A, B], [sym("a", "window"), B], [sym("a", "IDE"), B])).toEqual({ ok: false, slugs: ["a"] });
  });

  it("«Save as» on a slug that appeared in the IDE meanwhile is a conflict", () => {
    expect(rebaseSymbols([A], [A, sym("copy", "window")], [A, sym("copy", "IDE")])).toEqual({ ok: false, slugs: ["copy"] });
  });

  it("the same change on both sides is none", () => {
    expect(ok(rebaseSymbols([A, B], [A], [A]))).toEqual([A]);
    expect(ok(rebaseSymbols([A], [sym("a", "a′")], [sym("a", "a′")]))).toEqual([sym("a", "a′")]);
  });

  it("the order of the keys doesn't make a change", () => {
    // The IDE's copy of «a» came back through the bridge with its keys in
    // another order: same symbol, no conflict.
    const reordered = { ops: [], en: "a", it: "a", body: "body-pump", h: 140, w: 100, slug: "a" } as unknown as DescrizioneSimbolo;
    expect(ok(rebaseSymbols([A], [sym("a", "a′")], [reordered]))).toEqual([sym("a", "a′")]);
  });
});
