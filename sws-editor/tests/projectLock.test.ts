import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../src/i18n/index";
import { api, setLockTab, ProjectLockedError } from "../src/api/client";
import { useAppStore } from "../src/store";
import { rispondi } from "../src/finestraAvviso/finestraAvviso";
import { TAB_ID, onOpen, heartbeat } from "../src/projectLock/projectLock";

/** The project lock, IDE side (plan 2026-11-21, branch 4). */
describe("the project lock in the IDE", () => {
  const holder = { user: "mario", since_ms: Date.now() - 12 * 60_000, same_user: false };
  beforeEach(() => useAppStore.getState().setLockReadOnly(null));
  afterEach(() => { vi.restoreAllMocks(); setLockTab(null); });

  it("the tab id survives a reload of the same tab", () => {
    expect(sessionStorage.getItem("sws.projectLock.tab")).toBe(TAB_ID);
  });

  it("opening a project someone holds says who and since when; read-only", async () => {
    const auto = rispondi("read");
    try { expect(await onOpen(holder)).toBe(true); } finally { auto.ferma(); }
    expect((auto.chiamate[0] as { testo?: string }).testo).toMatch(/mario.*12/);
    expect(useAppStore.getState().lockReadOnly).toEqual(holder);
  });

  it("the same user is told it is another tab of theirs", async () => {
    const auto = rispondi(null);
    try { expect(await onOpen({ ...holder, same_user: true })).toBe(false); } finally { auto.ferma(); }
    expect((auto.chiamate[0] as { testo?: string }).testo).toMatch(/scheda|tab/);
  });

  it("taking control claims with take", async () => {
    const claim = vi.spyOn(api, "projectLock").mockResolvedValue({ held: true });
    const auto = rispondi("take");
    try { expect(await onOpen(holder)).toBe(true); } finally { auto.ferma(); }
    expect(claim).toHaveBeenCalledWith(TAB_ID, true);
    expect(useAppStore.getState().lockReadOnly).toBeNull();
  });

  it("a heartbeat that finds the lock taken turns the tab read-only, and says by whom", async () => {
    vi.spyOn(api, "projectLock").mockResolvedValue({ held: false, holder });
    const auto = rispondi(undefined);
    try { await heartbeat(); } finally { auto.ferma(); }
    expect(useAppStore.getState().lockReadOnly).toEqual(holder);
    expect((auto.chiamate[0] as { testo?: string }).testo).toContain("mario");
  });

  it("a read-only tab does not beat, so it never takes an expired lock by itself", async () => {
    useAppStore.getState().setLockReadOnly(holder);
    const claim = vi.spyOn(api, "projectLock");
    await heartbeat();
    expect(claim).not.toHaveBeenCalled();
  });

  it("saving is refused while read-only", async () => {
    useAppStore.getState().setLockReadOnly(holder);
    await useAppStore.getState().saveAll();
    expect(useAppStore.getState().saveStatus).toBe("error");
    expect(useAppStore.getState().saveError).toMatch(/sola lettura|read-only/);
  });

  it("requests carry the tab once the IDE has a project, and a 423 says why", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("locked", { status: 423, headers: { "x-sws-conflitto": "lock" } }));
    setLockTab("tab-x");
    await expect(api.releaseProjectLock("tab-x")).rejects.toBeInstanceOf(ProjectLockedError);
    const h = new Headers((fetchSpy.mock.calls[0][1] as RequestInit).headers);
    expect(h.get("X-SWS-Tab")).toBe("tab-x");
  });
});
