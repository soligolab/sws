/** The device control panel on the web viewer (plan
 *  docs/plans/2026-11-13-pannello-di-controllo.md, phase 2): PIN, network
 *  change with its confirmation, the corner gesture, the boot button. */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import "../src/i18n/index";
import { ControlPanel } from "../src/control-panel/ControlPanel";
import { ControlPanelLauncher, BOOT_BUTTON_MS, openControlPanel } from "../src/control-panel/ControlPanelLauncher";
import { HOLD_MS, holdComplete, holdProgress, inCorner, startHold, stillHolding } from "../src/control-panel/cornerHold";
import { isIpv4, splitCidr } from "../src/control-panel/api";
import { panelLanguage } from "../src/control-panel/language";

function reply(status: number, body?: unknown) {
  return Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

const CARD = {
  name: "eth0", kind: "ethernet", state: "connected", mac: "7c:6c:39:06:e9:90",
  addresses: ["192.168.1.242/24"], gateway: "192.168.1.254", dns: ["192.168.1.251"], method: "auto",
};

/** A fake runtime: answers by path and method, records what it was asked. */
function fakeRuntime(over: Record<string, () => Promise<Response>> = {}) {
  const calls: { path: string; method: string; body?: string; token?: string | null }[] = [];
  const routes: Record<string, () => Promise<Response>> = {
    "GET /api/control-panel": () => reply(200, { enabled: true, pin: "device" }),
    "POST /api/control-panel/session": () => reply(200, { token: "tok", idle_secs: 900 }),
    "GET /api/control-panel/capabilities": () => reply(200, { network: true, wifi: false, time: true, reboot: true, power_off: false }),
    "GET /api/control-panel/info": () => reply(200, { model: "TY570-1AD-P1", serial: "P1", hostname: "ty570-1ad-p1-06e990", sws_version: "2.26.0", initial_pin: "06e990" }),
    "GET /api/control-panel/network": () => reply(200, [CARD]),
    "PUT /api/control-panel/network/eth0": () => reply(200, { confirm_within_secs: 60 }),
    "POST /api/control-panel/network/confirm": () => reply(204),
    ...over,
  };
  const f = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ path: url, method, body: init?.body as string | undefined, token: headers.get("x-sws-control-panel") });
    const r = routes[`${method} ${url}`];
    return r ? r() : reply(404);
  });
  vi.stubGlobal("fetch", f);
  return calls;
}

async function typePin(pin: string) {
  for (const k of pin) fireEvent.click(screen.getByRole("button", { name: k }));
  fireEvent.click(screen.getByRole("button", { name: /Entra|Enter/ }));
}

describe("the corner gesture", () => {
  it("starts only in the top-right corner, and only a still finger completes it", () => {
    expect(inCorner(1000, 20, 1024)).toBe(true);
    expect(inCorner(500, 20, 1024)).toBe(false);
    expect(startHold(500, 20, 1024, 0)).toBeNull();
    const h = startHold(1000, 20, 1024, 0)!;
    expect(holdProgress(h, HOLD_MS / 2)).toBeCloseTo(0.5);
    expect(holdComplete(h, HOLD_MS - 1)).toBe(false);
    expect(holdComplete(h, HOLD_MS)).toBe(true);
    expect(stillHolding(h, 1005, 25)).toBe(true);
    expect(stillHolding(h, 1000, 60)).toBe(false);
  });

  it("checks addresses", () => {
    expect(isIpv4("192.168.1.50")).toBe(true);
    expect(isIpv4("192.168.1.256")).toBe(false);
    expect(isIpv4("192.168.1")).toBe(false);
    expect(splitCidr("10.0.0.5/8")).toEqual({ address: "10.0.0.5", prefix: 8 });
  });
});

describe("the panel language", () => {
  it("follows the content language, not the UI one", () => {
    expect(panelLanguage("it", "en")).toBe("it");
    expect(panelLanguage("en-GB", "it")).toBe("en");
    // A content language the UI has no words for: English.
    expect(panelLanguage("de", "it")).toBe("en");
    // No project yet (the pairing screen): the UI language.
    expect(panelLanguage("", "it")).toBe("it");
  });
});

describe("ControlPanel", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("a wrong PIN says so and stays on the PIN", async () => {
    fakeRuntime({ "POST /api/control-panel/session": () => reply(401) });
    render(<ControlPanel onClose={() => {}} />);
    await typePin("123456");
    expect((await screen.findByRole("alert")).textContent).toMatch(/sbagliato|Wrong/);
    expect(screen.getByTestId("control-panel-pin")).toBeTruthy();
  });

  it("the right PIN opens the panel, and every call carries the session", async () => {
    const calls = fakeRuntime();
    render(<ControlPanel onClose={() => {}} />);
    await typePin("06e990");
    expect(await screen.findByTestId("card-eth0")).toBeTruthy();
    expect(calls.find((c) => c.path === "/api/control-panel/session")!.body).toBe(JSON.stringify({ pin: "06e990" }));
    expect(calls.filter((c) => c.path === "/api/control-panel/network").every((c) => c.token === "tok")).toBe(true);
    // Wi-Fi is off: this device has no card for it.
    expect((screen.getByTestId("control-panel-section-wifi") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a static address is sent, then the confirmation bar counts down and confirms", async () => {
    const calls = fakeRuntime();
    render(<ControlPanel onClose={() => {}} />);
    await typePin("06e990");
    fireEvent.click(await screen.findByRole("button", { name: /Modifica|Change/ }));
    fireEvent.click(screen.getByRole("button", { name: /Statico|Static/ }));
    fireEvent.change(screen.getByTestId("ip-address"), { target: { value: "192.168.1.50" } });
    fireEvent.click(screen.getByRole("button", { name: /Applica|Apply/ }));
    const bar = await screen.findByTestId("network-confirm");
    expect(bar.textContent).toMatch(/60|59/);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(JSON.parse(put.body!)).toMatchObject({ method: "manual", address: "192.168.1.50", prefix: 24, gateway: "192.168.1.254" });
    fireEvent.click(screen.getByRole("button", { name: /^Conferma$|^Confirm$/ }));
    await vi.waitFor(() => expect(calls.some((c) => c.path === "/api/control-panel/network/confirm")).toBe(true));
  });

  it("an invalid address cannot be applied", async () => {
    fakeRuntime();
    render(<ControlPanel onClose={() => {}} />);
    await typePin("06e990");
    fireEvent.click(await screen.findByRole("button", { name: /Modifica|Change/ }));
    fireEvent.click(screen.getByRole("button", { name: /Statico|Static/ }));
    fireEvent.change(screen.getByTestId("ip-address"), { target: { value: "192.168.1.300" } });
    expect((screen.getByRole("button", { name: /Applica|Apply/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("ControlPanelLauncher", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("shows the boot button for five seconds, then hides it", async () => {
    vi.useFakeTimers();
    fakeRuntime();
    render(<ControlPanelLauncher />);
    expect(screen.getByTestId("control-panel-boot")).toBeTruthy();
    for (let i = 0; i < BOOT_BUTTON_MS / 1000; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    expect(screen.queryByTestId("control-panel-boot")).toBeNull();
  });

  it("the synoptic action opens it, unless the project disabled the panel", async () => {
    fakeRuntime();
    const { unmount } = render(<ControlPanelLauncher />);
    await act(async () => { await Promise.resolve(); });
    act(() => openControlPanel());
    expect(await screen.findByTestId("control-panel-pin")).toBeTruthy();
    unmount();

    fakeRuntime({ "GET /api/control-panel": () => reply(200, { enabled: false, pin: "project" }) });
    render(<ControlPanelLauncher />);
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => openControlPanel());
    expect(screen.queryByTestId("control-panel-pin")).toBeNull();
    // The boot button stays: it is the way back.
    expect(screen.getByTestId("control-panel-boot")).toBeTruthy();
  });
});
