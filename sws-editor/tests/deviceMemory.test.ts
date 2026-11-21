import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../src/i18n/index";
import { api } from "../src/api/client";
import { useAppStore } from "../src/store";
import { rispondi } from "../src/finestraAvviso/finestraAvviso";
import { mirrorLastDevice, offerReconnect, rememberDevice } from "../src/config/deviceMemory";
import { RT_URL_KEY, RT_USER_KEY } from "../src/config/schede/RuntimeConnectionTab";

describe("the panel each project remembers", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().setProject({ meta: { name: "A", version: "1" }, tags: [] } as never);
    useAppStore.getState().setRemoteConnected(false);
  });
  afterEach(() => vi.restoreAllMocks());

  it("the connection form follows the open project, and empties for one without a panel", () => {
    localStorage.setItem(RT_URL_KEY, "https://other-project-panel:7444");
    localStorage.setItem(RT_USER_KEY, "someone");
    mirrorLastDevice({ url: "https://wp630.local:7444/", username: "admin" });
    expect(localStorage.getItem(RT_URL_KEY)).toBe("https://wp630.local:7444");
    expect(localStorage.getItem(RT_USER_KEY)).toBe("admin");
    mirrorLastDevice(undefined);
    expect(localStorage.getItem(RT_URL_KEY)).toBeNull();
    expect(localStorage.getItem(RT_USER_KEY)).toBeNull();
  });

  it("a connection is remembered once, without making the project dirty", async () => {
    const put = vi.spyOn(api, "setLastDevice").mockResolvedValue(undefined);
    await rememberDevice("http://192.168.1.204:7444/", "admin");
    expect(put).toHaveBeenCalledWith({ url: "http://192.168.1.204:7444", username: "admin" });
    expect(useAppStore.getState().project?.last_device).toEqual({ url: "http://192.168.1.204:7444", username: "admin" });
    await rememberDevice("http://192.168.1.204:7444", "admin");
    expect(put).toHaveBeenCalledTimes(1);
    // Another user is another memory.
    await rememberDevice("http://192.168.1.204:7444", "");
    expect(put).toHaveBeenLastCalledWith({ url: "http://192.168.1.204:7444" });
  });

  it("«Reconnect» connects; «Not now» leaves things as they are", async () => {
    const connect = vi.spyOn(api, "remoteConnect").mockResolvedValue({ ok: true } as never);
    let auto = rispondi(false);
    try { await offerReconnect({ url: "http://tc620:7444" }); } finally { auto.ferma(); }
    expect(connect).not.toHaveBeenCalled();
    expect((auto.chiamate[0] as { testo?: string }).testo).toContain("http://tc620:7444");
    auto = rispondi(true);
    try { await offerReconnect({ url: "http://tc620:7444", username: "admin" }); } finally { auto.ferma(); }
    expect(connect).toHaveBeenCalledWith("http://tc620:7444", "admin", undefined);
    expect(useAppStore.getState().remoteConnected).toBe(true);
    expect(useAppStore.getState().remoteUrl).toBe("http://tc620:7444");
  });

  it("a panel that wants a password leads to the connection form", async () => {
    vi.spyOn(api, "remoteConnect").mockResolvedValue({ ok: false, error: "401" } as never);
    const go = vi.fn();
    useAppStore.setState({ navigateToConfig: go } as never);
    const auto = rispondi(true);
    try { await offerReconnect({ url: "https://wp630:7444", username: "admin" }); } finally { auto.ferma(); }
    expect(go).toHaveBeenCalledWith("runtime");
    expect(useAppStore.getState().remoteConnected).toBe(false);
  });
});
