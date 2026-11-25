/** The device control panel on the web viewer (plan
 *  docs/archive/2026-11-13-pannello-di-controllo.md, phase 2): PIN, network
 *  change with its confirmation, the corner gesture, the boot button. */
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import "../src/i18n/index";

// After a reset the page loads again when the runtime answers (25-11-2026):
// here only that the panel asks for it; the wait is in viewerStreamsRecover.
const reload = vi.hoisted(() => {
  const cancel = vi.fn();
  return { cancel, whenBack: vi.fn(() => cancel) };
});
vi.mock("../src/control-panel/reloadWhenBack", () => ({ reloadWhenBack: reload.whenBack }));
import { ControlPanel } from "../src/control-panel/ControlPanel";
import { ControlPanelLauncher, BOOT_BUTTON_MS, openControlPanel } from "../src/control-panel/ControlPanelLauncher";
import { GRACE_MS, HOLD_MS, holdComplete, holdProgress, inCorner, startHold, stillHolding } from "../src/control-panel/cornerHold";
import { isIpv4, splitCidr } from "../src/control-panel/api";
import { panelLanguage } from "../src/control-panel/language";
import { cityOf, continentsIn, countriesIn, search, zoneLabel } from "../src/control-panel/timezones";

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
  it("starts only in the chosen corner, and lasts while the finger stays in it", () => {
    expect(inCorner(1000, 20, 1024, 600, "top_right")).toBe(true);
    expect(inCorner(500, 20, 1024, 600, "top_right")).toBe(false);
    expect(inCorner(1000, 20, 1024, 600, "none")).toBe(false);
    expect(inCorner(20, 580, 1024, 600, "bottom_left")).toBe(true);
    expect(startHold(500, 20, 1024, 600, "top_right", 0)).toBeNull();
    expect(startHold(1000, 20, 1024, 600, "bottom_left", 0)).toBeNull();
    const h = startHold(1000, 20, 1024, 600, "top_right", 0)!;
    // The first moment counts for nothing: no ring, and the hold starts after it.
    expect(holdProgress(h, GRACE_MS)).toBe(0);
    expect(holdProgress(h, GRACE_MS + HOLD_MS / 2)).toBeCloseTo(0.5);
    expect(holdComplete(h, HOLD_MS)).toBe(false);
    expect(holdComplete(h, GRACE_MS + HOLD_MS - 1)).toBe(false);
    expect(holdComplete(h, GRACE_MS + HOLD_MS)).toBe(true);
    expect(stillHolding(h, 960, 70, 1024, 600)).toBe(true);
    expect(stillHolding(h, 1000, 120, 1024, 600)).toBe(false);
    // The device's own measures: a larger corner, a shorter hold.
    expect(startHold(900, 100, 1024, 600, "top_right", 0)).toBeNull();
    const wide = startHold(900, 100, 1024, 600, "top_right", 0, 160, 2_000)!;
    expect(stillHolding(wide, 860, 150, 1024, 600)).toBe(true);
    expect(holdComplete(wide, GRACE_MS + 1_999)).toBe(false);
    expect(holdComplete(wide, GRACE_MS + 2_000)).toBe(true);
    expect(holdProgress(wide, GRACE_MS + 1_000)).toBeCloseTo(0.5);
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

  it("giving the device back asks the PIN again, says so when it is wrong, and goes through with the right one", async () => {
    let pinOk = false;
    const calls = fakeRuntime({
      "POST /api/control-panel/reset": () => (pinOk ? reply(202) : reply(403)),
    });
    render(<ControlPanel onClose={() => {}} />);
    await typePin("06e990");
    await screen.findByTestId("card-eth0");
    fireEvent.click(screen.getByTestId("control-panel-section-device"));
    fireEvent.click(await screen.findByTestId("reset-ask"));
    // Nothing is sent before the PIN is typed.
    expect((screen.getByTestId("reset-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some((c) => c.path === "/api/control-panel/reset")).toBe(false);
    fireEvent.change(screen.getByTestId("reset-pin"), { target: { value: "000000" } });
    fireEvent.click(screen.getByTestId("reset-confirm"));
    expect((await screen.findByText(/PIN sbagliato|Wrong PIN/)).textContent).toBeTruthy();
    pinOk = true;
    fireEvent.change(screen.getByTestId("reset-pin"), { target: { value: "06e990" } });
    fireEvent.click(screen.getByTestId("reset-confirm"));
    expect(await screen.findByText(/Fatto|Done/)).toBeTruthy();
    const sent = calls.filter((c) => c.path === "/api/control-panel/reset");
    expect(sent.map((c) => c.body)).toEqual([
      JSON.stringify({ pin: "000000", keep_cloud: false }),
      JSON.stringify({ pin: "06e990", keep_cloud: false }),
    ]);
    expect(sent.every((c) => c.token === "tok")).toBe(true);
    // Not paired to a cloud: no option to keep it.
    expect(screen.queryByTestId("reset-keep-cloud-ask")).toBeNull();
  });

  it("a panel paired to the cloud can remove only the project and keep the pairing", async () => {
    reload.whenBack.mockClear();
    reload.cancel.mockClear();
    const calls = fakeRuntime({
      "GET /api/control-panel/info": () => reply(200, { model: "TY570-1AD-P1", serial: "P1", hostname: "ty570-1ad-p1-06e990", sws_version: "2.26.0", initial_pin: "06e990", cloud: "tunnel.soligo.net" }),
      "POST /api/control-panel/reset": () => reply(202),
    });
    const { unmount } = render(<ControlPanel onClose={() => {}} />);
    await typePin("06e990");
    await screen.findByTestId("card-eth0");
    fireEvent.click(screen.getByTestId("control-panel-section-device"));
    fireEvent.click(await screen.findByTestId("reset-keep-cloud-ask"));
    fireEvent.change(screen.getByTestId("reset-pin"), { target: { value: "06e990" } });
    fireEvent.click(screen.getByTestId("reset-confirm"));
    expect(await screen.findByText(/ancora abbinato al cloud|still paired to the cloud/)).toBeTruthy();
    const sent = calls.filter((c) => c.path === "/api/control-panel/reset");
    expect(sent.map((c) => c.body)).toEqual([JSON.stringify({ pin: "06e990", keep_cloud: true })]);
    // Collaudo of 2.27.0-dev.3 (25-11-2026): the page under the panel stayed
    // frozen after this reset; now it loads again when the runtime answers.
    // The request comes after the reset's answer: wait for it.
    await waitFor(() => expect(reload.whenBack).toHaveBeenCalledTimes(1));
    // The restarted runtime answers 401 to the old session, and the panel goes
    // back to the PIN keypad: the reload must survive the panel going away
    // (review of 25-11-2026).
    unmount();
    expect(reload.cancel).not.toHaveBeenCalled();
  });

  it("away from the device's screen, without a project PIN, it says to set one (CRA D13, 18-11-2026)", async () => {
    fakeRuntime({ "GET /api/control-panel": () => reply(200, { enabled: true, pin: "screen_only", origin: "network" }) });
    render(<ControlPanel onClose={() => {}} />);
    expect((await screen.findByTestId("control-panel-screen-only")).textContent).toMatch(/PIN del progetto|project's PIN/);
  });

  it("from the cloud's remote screen only the reset that keeps the pairing (CRA D14, 18-11-2026)", async () => {
    fakeRuntime({
      "GET /api/control-panel/info": () => reply(200, { model: "TY570-1AD-P1", serial: "P1", hostname: "ty570-1ad-p1-06e990", sws_version: "2.26.0", initial_pin: null, cloud: "tunnel.soligo.net", origin: "remote_screen" }),
    });
    render(<ControlPanel onClose={() => {}} />);
    await typePin("4711aa");
    await screen.findByTestId("card-eth0");
    fireEvent.click(screen.getByTestId("control-panel-section-device"));
    expect(await screen.findByTestId("reset-remote-note")).toBeTruthy();
    expect(screen.queryByTestId("reset-ask")).toBeNull();
    expect(screen.getByTestId("reset-keep-cloud-ask")).toBeTruthy();
  });

  it("OpenPLC, where installed, shows the Editor's user and password behind the PIN (CRA D20, 18-11-2026)", async () => {
    const calls = fakeRuntime({
      "GET /api/control-panel/capabilities": () => reply(200, { network: true, wifi: false, time: true, reboot: true, power_off: false, openplc: true }),
      "GET /api/control-panel/openplc": () => reply(200, {
        installed: true, answers: true, version: "v4.3.1",
        credentials: { username: "admin", password: "abc2345def" }, credentials_unknown: false,
        ports: { editor: 8443, modbus: 1502, s7: 10102, opcua: 14840, discovery: 33333 },
      }),
    });
    render(<ControlPanel onClose={() => {}} />);
    await typePin("06e990");
    await screen.findByTestId("card-eth0");
    fireEvent.click(screen.getByTestId("control-panel-section-openplc"));
    expect((await screen.findByTestId("openplc-password")).textContent).toBe("abc2345def");
    expect(screen.getByTestId("openplc-state").textContent).toMatch(/v4\.3\.1/);
    expect(calls.find((c) => c.path === "/api/control-panel/openplc")!.token).toBe("tok");
  });

  it("without OpenPLC there is no OpenPLC section", async () => {
    fakeRuntime();
    render(<ControlPanel onClose={() => {}} />);
    await typePin("06e990");
    await screen.findByTestId("card-eth0");
    expect(screen.queryByTestId("control-panel-section-openplc")).toBeNull();
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

const WIFI = {
  card: "wlan0", radio: true, mode: "client", active_ssid: "Casa", can_hotspot: true, saved: ["Casa"],
  networks: [
    { ssid: "Casa", signal: 78, security: "wpa", known: true, active: true },
    { ssid: "Officina", signal: 54, security: "wpa3", known: false, active: false },
    { ssid: "Aziendale", signal: 33, security: "enterprise", known: false, active: false },
  ],
};

function wifiRuntime(over: Record<string, () => Promise<Response>> = {}) {
  return fakeRuntime({
    "GET /api/control-panel/capabilities": () => reply(200, { network: true, wifi: true, time: true, reboot: true, power_off: false, display: true }),
    "GET /api/control-panel/wifi": () => reply(200, WIFI),
    "GET /api/control-panel/wifi/hotspot": () => reply(200, { enabled: false, ssid: "sws-06e990", password: "abcdefgh23", proposed: true, qr: "WIFI:T:WPA;S:sws-06e990;P:abcdefgh23;;" }),
    "POST /api/control-panel/wifi/connect": () => reply(200, { confirm_within_secs: 60 }),
    "PUT /api/control-panel/wifi/hotspot": () => reply(200, { confirm_within_secs: 60 }),
    "GET /api/control-panel/display": () => reply(200, { brightness: null }),
    "PUT /api/control-panel/display": () => reply(204),
    ...over,
  });
}

describe("ControlPanel, Wi-Fi and screen (phase 4)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  async function openSection(id: string) {
    render(<ControlPanel onClose={() => {}} />);
    await typePin("06e990");
    await screen.findByTestId("card-eth0");
    await vi.waitFor(() => expect((screen.getByTestId(`control-panel-section-${id}`) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId(`control-panel-section-${id}`));
  }

  it("lists the networks; an 802.1X one cannot be joined", async () => {
    wifiRuntime();
    await openSection("wifi");
    const ent = await screen.findByTestId("wifi-Aziendale");
    expect(ent.textContent).toMatch(/802.1X/);
    expect(ent.querySelector("button")).toBeNull();
    expect(screen.getByTestId("wifi-Casa").textContent).toMatch(/collegata|connected/);
  });

  it("a new network asks for its password on the on-screen keyboard, then waits for the confirmation", async () => {
    const calls = wifiRuntime();
    await openSection("wifi");
    const row = await screen.findByTestId("wifi-Officina");
    fireEvent.click(row.querySelector("button")!);
    expect(screen.getByTestId("text-keyboard")).toBeTruthy();
    for (const k of "officina") fireEvent.click(screen.getByRole("button", { name: k }));
    fireEvent.click(screen.getByRole("button", { name: /Fatto|Done/ }));
    await screen.findByTestId("network-confirm");
    const post = calls.find((c) => c.path === "/api/control-panel/wifi/connect")!;
    expect(JSON.parse(post.body!)).toMatchObject({ ssid: "Officina", password: "officina", hidden: false });
  });

  it("a refused password says so, without a confirmation to give (TY570, 14-11-2026)", async () => {
    wifiRuntime({ "POST /api/control-panel/wifi/connect": () => reply(502, { error: "wifi-wrong-password" }) });
    await openSection("wifi");
    fireEvent.click((await screen.findByTestId("wifi-Officina")).querySelector("button")!);
    for (const k of "sbagliata") fireEvent.click(screen.getByRole("button", { name: k }));
    fireEvent.click(screen.getByRole("button", { name: /Fatto|Done/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/rifiutato la password|refused the password/);
    expect(screen.queryByTestId("network-confirm")).toBeNull();
  });

  it("the joined network shows its addresses", async () => {
    wifiRuntime({ "GET /api/control-panel/network": () => reply(200, [CARD, { ...CARD, name: "wlan0", kind: "wifi", addresses: ["192.168.1.77/24"] }]) });
    await openSection("wifi");
    expect((await screen.findByTestId("wifi-addresses")).textContent).toBe("192.168.1.77/24");
  });

  it("joined with no IPv4 (the network's DHCP does not answer): the IPv6 address and a line that says so (TY570, 15-11-2026)", async () => {
    wifiRuntime({ "GET /api/control-panel/network": () => reply(200, [CARD, {
      ...CARD, name: "wlan0", kind: "wifi", addresses: [], addresses6: ["2001:b07:aac:2cae:4aa0:c12f:5adf:6f64/64"],
    }]) });
    await openSection("wifi");
    expect((await screen.findByTestId("wifi-addresses")).textContent).toBe("2001:b07:aac:2cae:4aa0:c12f:5adf:6f64/64");
    expect(screen.getByTestId("wifi-no-ipv4").textContent).toMatch(/IPv4/);
  });

  it("a Wi-Fi dongle plugged in shows up without reopening the section (TY570, 14-11-2026)", async () => {
    let cards: unknown[] = [CARD];
    const calls = wifiRuntime({ "GET /api/control-panel/network": () => reply(200, cards) });
    await openSection("wifi");
    await screen.findByTestId("wifi-Casa");
    const wifiReads = () => calls.filter((c) => c.path === "/api/control-panel/wifi").length;
    const before = wifiReads();
    cards = [CARD, { ...CARD, name: "wlan0", kind: "wifi", addresses: ["192.168.1.77/24"] }];
    await vi.waitFor(() => expect(wifiReads()).toBeGreaterThan(before), { timeout: 5_000 });
    expect((await screen.findByTestId("wifi-addresses")).textContent).toBe("192.168.1.77/24");
  });

  it("a dongle plugged in turns the Wi-Fi section on; the watch does not keep the session alive", async () => {
    let cards: unknown[] = [CARD];
    let wifi = false;
    fakeRuntime({
      "GET /api/control-panel/network": () => reply(200, cards),
      "GET /api/control-panel/capabilities": () => reply(200, { network: true, wifi, time: true, reboot: true, power_off: false }),
    });
    render(<ControlPanel onClose={() => {}} />);
    await typePin("06e990");
    await screen.findByTestId("card-eth0");
    const button = () => screen.getByTestId("control-panel-section-wifi") as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    cards = [CARD, { ...CARD, name: "wlan0", kind: "wifi", addresses: [] }];
    wifi = true;
    await vi.waitFor(() => expect(button().disabled).toBe(false), { timeout: 5_000 });
    const watches = vi.mocked(fetch).mock.calls.filter(([, init]) => new Headers(init?.headers).has("x-sws-control-panel-watch"));
    expect(watches.length).toBeGreaterThan(0);
  });

  it("the hotspot starts from the proposal and sends SSID and password", async () => {
    const calls = wifiRuntime();
    await openSection("wifi");
    fireEvent.click(await screen.findByRole("button", { name: /Accendi l'hotspot|Turn the hotspot on/ }));
    expect((screen.getByTestId("wifi-password") as HTMLInputElement).value).toBe("abcdefgh23");
    const buttons = screen.getAllByRole("button", { name: /Accendi l'hotspot|Turn the hotspot on/ });
    fireEvent.click(buttons[buttons.length - 1]);
    await screen.findByTestId("network-confirm");
    const put = calls.find((c) => c.path === "/api/control-panel/wifi/hotspot" && c.method === "PUT")!;
    expect(JSON.parse(put.body!)).toEqual({ enabled: true, ssid: "sws-06e990", password: "abcdefgh23" });
  });

  it("the brightness is the device's until set back to the project's", async () => {
    const calls = wifiRuntime();
    await openSection("screen");
    fireEvent.click(await screen.findByRole("button", { name: /Regolata qui|Set here/ }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.path === "/api/control-panel/display")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === "PUT" && c.path === "/api/control-panel/display")!.body!)).toEqual({ brightness: 80 });
    await screen.findByTestId("brightness");
    fireEvent.click(screen.getByRole("button", { name: /Come dice il progetto|As the project says/ }));
    await vi.waitFor(() => expect(calls.filter((c) => c.method === "PUT" && c.path === "/api/control-panel/display").length).toBe(2));
    expect(JSON.parse(calls.filter((c) => c.method === "PUT" && c.path === "/api/control-panel/display")[1].body!)).toEqual({ brightness: null });
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

describe("the time zone picker (TY570, 14-11-2026)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const ZONES = [
    { zone: "Europe/Rome", country: "IT" }, { zone: "Europe/Paris", country: "FR" },
    { zone: "America/New_York", country: "US" }, { zone: "America/Chicago", country: "US" },
    { zone: "America/Argentina/Buenos_Aires", country: "AR" }, { zone: "UTC", country: null },
    { zone: "US/Eastern", country: null }, { zone: "Europe/Belfast", country: null },
  ];

  it("groups by continent and country, accents ignored by the filter", () => {
    expect(continentsIn(ZONES)).toEqual(["Europe", "America", "other"]);
    const am = countriesIn(ZONES, "America", "it");
    expect(am.map((c) => c.name)).toEqual(["Argentina", "Stati Uniti"]);
    expect(am[1].zones).toEqual(["America/New_York", "America/Chicago"]);
    expect(cityOf("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneLabel(ZONES[0], "it")).toBe("Rome — Italia");
    expect(search(ZONES, "itàl", "it").map((z) => z.zone)).toEqual(["Europe/Rome"]);
    expect(search(ZONES, "buenos", "en").map((z) => z.zone)).toEqual(["America/Argentina/Buenos_Aires"]);
    expect(search(ZONES, "ro", "en").map((z) => z.zone)).toEqual(["Europe/Rome"]);
    // The old aliases without a country are not offered.
    expect(search(ZONES, "belfast", "en")).toEqual([]);
    expect(countriesIn(ZONES, "Europe", "en").every((c) => c.code !== null)).toBe(true);
  });

  async function openTime(calls = fakeRuntime({
    "GET /api/control-panel/time": () => reply(200, { timezone: "UTC", ntp: true, can_ntp: true, ntp_synchronized: true, time_usec: 1_794_000_000_000_000 }),
    "GET /api/control-panel/timezones": () => reply(200, ZONES),
    "PUT /api/control-panel/time": () => reply(204),
  })) {
    render(<ControlPanel onClose={() => {}} />);
    await typePin("06e990");
    await screen.findByTestId("card-eth0");
    fireEvent.click(screen.getByTestId("control-panel-section-time"));
    fireEvent.click(await screen.findByTestId("timezone-change"));
    return calls;
  }

  it("continent, then a country with one zone: chosen at once", async () => {
    const calls = await openTime();
    fireEvent.click(screen.getByRole("button", { name: /Europa|Europe/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Italia|^Italy/ }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.path === "/api/control-panel/time")).toBe(true));
    const put = calls.find((c) => c.method === "PUT" && c.path === "/api/control-panel/time")!;
    expect(JSON.parse(put.body!)).toEqual({ timezone: "Europe/Rome" });
  });

  it("a country with more zones asks for the city; the filter lists matches directly", async () => {
    const calls = await openTime();
    fireEvent.click(screen.getByRole("button", { name: /America/ }));
    fireEvent.click(screen.getByRole("button", { name: /Stati Uniti|United States/ }));
    expect(screen.getByTestId("timezone-cities").textContent).toMatch(/Chicago/);
    fireEvent.click(screen.getByRole("button", { name: /Chicago/ }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.body?.includes("America/Chicago"))).toBe(true));
    fireEvent.click(await screen.findByTestId("timezone-change"));
    fireEvent.change(screen.getByTestId("timezone-filter"), { target: { value: "par" } });
    expect(screen.getByTestId("timezone-results").textContent).toMatch(/Paris/);
  });
});
