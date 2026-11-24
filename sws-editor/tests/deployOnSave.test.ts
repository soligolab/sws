// Two deploys at once (test of the rc.29 on the WP630, 23-11-2026): with
// «deploy on save» on and changes not saved, «Deploy active project» saved
// first, that save started a deploy of its own, the explicit one got 409 from
// the server's lock, and the automatic one opened the destructive confirmation
// as if it were the answer to the button.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/finestraAvviso/finestraAvviso", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/finestraAvviso/finestraAvviso")>()),
  conferma: vi.fn(async () => false),
  avviso: vi.fn(async () => {}),
}));

import i18n from "../src/i18n";
import { api } from "../src/api/client";
import { avviso, conferma } from "../src/finestraAvviso/finestraAvviso";
import { flushBeforeDeploy } from "../src/config/schede/DevicesTab";
import { useAppStore } from "../src/store";
import type { ProjectInfo, SynopticPage } from "../src/types";

const PAGE = { id: "p1", name: "Home", objects: [] } as unknown as SynopticPage;
const PROJECT = { meta: { name: "p", version: "1" }, tags: [], sources: [] } as unknown as ProjectInfo;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let deploys: unknown[] = [];
let deployAnswer: () => Response = () => new Response("✓ done\n", { status: 200 });

describe("deploy on save and the explicit deploy", () => {
  beforeEach(() => {
    deploys = [];
    deployAnswer = () => new Response("✓ done\n", { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/remote/deploy")) {
        deploys.push(JSON.parse(String(init?.body ?? "{}")));
        return deployAnswer();
      }
      return new Response(null, { status: 204, headers: { "content-length": "0" } });
    }));
    vi.mocked(conferma).mockClear();
    vi.mocked(avviso).mockClear();
    useAppStore.setState({
      remoteConnected: true, deployAlSalvataggio: true, remoteDeployStatus: "idle", remoteDeployErrore: null,
      saveStatus: "idle", saveError: null, lockReadOnly: null, pendingSections: {}, authRole: null,
    });
    useAppStore.getState().setProject(structuredClone(PROJECT));
    useAppStore.getState().setPages([structuredClone(PAGE)], "p1");
    // A change not saved yet.
    useAppStore.setState((s) => ({ pagesRev: s.savedPagesRev + 1 }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("flushBeforeDeploy with deploy on save on sends a single POST /api/remote/deploy", async () => {
    const log: string[] = [];
    expect(await flushBeforeDeploy((m) => log.push(m))).toBe(true);
    // The explicit deploy of Connessione, right after.
    await api.deployToRuntime({ replaceUsers: false });
    await wait(30);
    expect(deploys).toHaveLength(1);
    expect(log.at(-1)).toBe(i18n.t("cfgUi.saved2"));
  });

  it("a save already running: flushBeforeDeploy waits for it, and that save sends nothing either", async () => {
    const running = useAppStore.getState().saveAll(); // Ctrl+S a moment before
    expect(useAppStore.getState().saveStatus).toBe("saving");
    const log: string[] = [];
    const ok = await flushBeforeDeploy((m) => log.push(m));
    expect(ok).toBe(true);
    expect(useAppStore.getState().saveStatus).not.toBe("saving");
    await running;
    await api.deployToRuntime({ replaceUsers: false });
    await wait(30);
    expect(deploys).toHaveLength(1);
  });

  it("a running save whose sections call markSaveOk: the flush waits for the whole save, no second one starts (review of the rc.30)", async () => {
    let calls = 0, inside = 0, overlap = false;
    // Two dirty sections, each saving like a SaveBar: «ok» as soon as it's done,
    // while saveAll is still in its loop.
    const section = async () => {
      calls++;
      inside++;
      if (inside > 1) overlap = true;
      await wait(15);
      useAppStore.getState().markSaveOk();
      await wait(15);
      inside--;
    };
    useAppStore.setState({ pendingSections: { tags: section, sources: section } });
    const running = useAppStore.getState().saveAll(); // Ctrl+S a moment before
    await wait(20); // the first section has said «ok»
    const ok = await flushBeforeDeploy(() => {});
    expect(ok).toBe(true);
    await running;
    expect(overlap).toBe(false);
    // The flush waited for the first save to the end: the two sections ran in it,
    // and at most once more after it (they are still registered), never alongside.
    expect(calls % 2).toBe(0);
    await api.deployToRuntime({ replaceUsers: false });
    await wait(30);
    expect(deploys).toHaveLength(1);
  });

  it("a deploy started by a save asks too, the same question; «no» stops it (decision of 24-11-2026)", async () => {
    deployAnswer = () => new Response(JSON.stringify({ conferma: "sostituisce-progetti", progetto: "p", progetti: [{ nome: "tiny-ty" }] }),
      { status: 428, headers: { "content-type": "application/json" } });
    await useAppStore.getState().saveAll();
    for (let i = 0; i < 100 && useAppStore.getState().remoteDeployStatus === "syncing"; i++) await wait(5);
    for (let i = 0; i < 100 && !vi.mocked(conferma).mock.calls.length; i++) await wait(5);
    expect(conferma).toHaveBeenCalledTimes(1);
    await wait(30);
    expect(deploys).toHaveLength(1);
    expect(useAppStore.getState().remoteDeployStatus).toBe("idle");
  });

  it("a save during a deploy waits for it and deploys once after it (review of the rc.30)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    deployAnswer = () => new Response(new ReadableStream({
      async start(c) { await gate; c.enqueue(new TextEncoder().encode("✓ done\n")); c.close(); },
    }), { status: 200 });
    const first = useAppStore.getState().deployOra(false);
    for (let i = 0; i < 100 && useAppStore.getState().remoteDeployStatus !== "syncing"; i++) await wait(5);
    await useAppStore.getState().saveAll();
    await wait(20);
    expect(deploys).toHaveLength(1);
    release();
    await first;
    for (let i = 0; i < 100 && deploys.length < 2; i++) await wait(5);
    expect(deploys).toHaveLength(2);
    await wait(30);
    expect(deploys).toHaveLength(2);
  });

  it("the explicit «Send now» still asks", async () => {
    deployAnswer = () => new Response(JSON.stringify({ conferma: "sostituisce-progetti", progetto: "p", progetti: [{ nome: "tiny-ty" }] }),
      { status: 428, headers: { "content-type": "application/json" } });
    await useAppStore.getState().deployOra(false);
    expect(conferma).toHaveBeenCalledTimes(1);
    // Said no: nothing sent after the question, and no automatic deploy either.
    await wait(30);
    expect(deploys).toHaveLength(1);
    expect(useAppStore.getState().remoteDeployStatus).toBe("idle");
  });
});
