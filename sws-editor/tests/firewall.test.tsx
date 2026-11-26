/** The device firewall (26-11-2026): the draft of the changes, and the editor
 *  shared by the IDE and the control panel. Plan
 *  docs/archive/2026-11-26-firewall-dei-dispositivi.md. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import {
  addItem, composeRule, draftIsSensitive, editItem, opsToSend, rowsOf, toggle, validPort, validSource,
  type FirewallApi, type FirewallView, type ZoneView,
} from "../src/firewall/core";
import { FirewallEditor, type FirewallSkin } from "../src/firewall/FirewallEditor";
import { api, type SystemStatus } from "../src/api/client";
import { useAppStore } from "../src/store";
import { FirewallTab } from "../src/config/schede/FirewallTab";

afterEach(() => { vi.restoreAllMocks(); });

function zone(): ZoneView {
  return {
    name: "public", default: true, interfaces: ["ethernet0"], sources: [],
    entries: [
      { kind: "service", name: "ssh", enabled: true, ports: ["22/tcp"] },
      { kind: "service", name: "cockpit", enabled: true, ports: ["9090/tcp"] },
      { kind: "port", port: "7444", protocol: "tcp", enabled: true },
      { kind: "service", name: "atvise", enabled: false, ports: ["4840/tcp"], disabled_by: "admin", disabled_at_ms: 1 },
    ],
  };
}

function view(): FirewallView {
  return {
    available: true, default_zone: "public", zones: [zone()], known_services: ["atvise", "cockpit", "http", "ssh"],
    listen_ports: [{ port: 7443, protocol: "tcp", sws: true, open_in: [] }, { port: 7444, protocol: "tcp", sws: true, open_in: ["public"] }],
    pending: null, confirm_within_secs: 60,
  };
}

describe("the draft", () => {
  it("switches an entry off and back, without leaving an operation", () => {
    const z = zone();
    const cockpit = rowsOf(z, [])[1];
    const d = toggle([], z, cockpit);
    expect(d).toEqual([{ zone: "public", action: "remove", item: { kind: "service", name: "cockpit" } }]);
    const off = rowsOf(z, d)[1];
    expect(off.on).toBe(false);
    expect(off.changed).toBe(true);
    expect(toggle(d, z, off)).toEqual([]);
  });

  it("switches a disabled entry on with an addition", () => {
    const z = zone();
    const atvise = rowsOf(z, [])[3];
    expect(atvise.on).toBe(false);
    expect(toggle([], z, atvise)).toEqual([{ zone: "public", action: "add", item: { kind: "service", name: "atvise" } }]);
  });

  it("edits a port as one change: the old one out, the new one in", () => {
    const z = zone();
    const p = rowsOf(z, [])[2];
    const d = editItem([], z, p, { kind: "port", port: "7445", protocol: "tcp" });
    expect(opsToSend(d)).toEqual([
      { zone: "public", action: "remove", item: { kind: "port", port: "7444", protocol: "tcp" } },
      { zone: "public", action: "add", item: { kind: "port", port: "7445", protocol: "tcp" } },
    ]);
    const rows = rowsOf(z, d);
    expect(rows.find((r) => r.added)?.entry).toMatchObject({ kind: "port", port: "7445" });
  });

  it("does not add an entry twice", () => {
    const z = zone();
    expect(addItem([], z, { kind: "service", name: "ssh" })).toEqual([]);
    const d = addItem([], z, { kind: "port", port: "4840", protocol: "tcp" });
    expect(addItem(d, z, { kind: "port", port: "4840", protocol: "tcp" })).toEqual(d);
  });

  it("knows the changes that can cut the line to the device", () => {
    const v = view();
    const z = v.zones[0];
    expect(draftIsSensitive(v, toggle([], z, rowsOf(z, [])[1]))).toBe(false);
    expect(draftIsSensitive(v, toggle([], z, rowsOf(z, [])[0]))).toBe(true);
    expect(draftIsSensitive(v, toggle([], z, rowsOf(z, [])[2]))).toBe(true);
  });

  it("writes rules the way the runtime does, and checks ports and sources", () => {
    expect(composeRule({ source: "192.168.0.0/23", target: { kind: "port", port: "7444", protocol: "tcp" }, verdict: "accept" }))
      .toBe('rule family="ipv4" source address="192.168.0.0/23" port port="7444" protocol="tcp" accept');
    expect(composeRule({ source: "fd00::/8", target: { kind: "service", name: "ssh" }, verdict: "drop" }))
      .toBe('rule family="ipv6" source address="fd00::/8" service name="ssh" drop');
    expect(validPort("1740-1743")).toBe(true);
    expect(validPort("0")).toBe(false);
    expect(validPort("10-5")).toBe(false);
    expect(validSource("192.168.0.0/23")).toBe(true);
    expect(validSource("192.168.0.300")).toBe(false);
    expect(validSource("10.0.0.0/33")).toBe(false);
  });
});

const SKIN: FirewallSkin = {
  text: "#fff", muted: "#999", line: "#333", accent: "#00f", ok: "#0f0", warn: "#fa0", bad: "#f00",
  panel: "#111", bg: "#000", barBg: "#320", barText: "#fff",
  btn: {}, btnPrimary: {}, btnDanger: {}, card: {}, input: {},
};

function fakeApi(v: FirewallView): FirewallApi & { applied: unknown[] } {
  const applied: unknown[] = [];
  return {
    applied,
    get: vi.fn(async () => v),
    apply: vi.fn(async (ops) => { applied.push(ops); v.pending = { ops, seconds_left: 60 }; return { confirm_within_secs: 60 }; }),
    confirmChange: vi.fn(async () => { v.pending = null; }),
    rollbackChange: vi.fn(async () => { v.pending = null; }),
  };
}

describe("the editor", () => {
  it("shows every entry, disables two in one change, and asks to confirm", async () => {
    const v = view();
    const fw = fakeApi(v);
    render(<FirewallEditor api={fw} t={i18n.t} skin={SKIN} />);
    await screen.findByTestId("firewall-zone-public");
    // The disabled entry is there, off.
    expect(screen.getByRole("switch", { name: i18n.t("firewall.switchOn", { what: "atvise" }) })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: i18n.t("firewall.switchOff", { what: "cockpit" }) }));
    fireEvent.click(screen.getByRole("switch", { name: i18n.t("firewall.switchOff", { what: "ssh" }) }));
    expect(screen.getByTestId("firewall-draft-count").textContent).toBe(i18n.t("firewall.draftCount", { count: 2 }));
    fireEvent.click(screen.getByTestId("firewall-apply"));
    // ssh is a connection: the review says so.
    expect(screen.getByTestId("firewall-sensitive")).toBeTruthy();
    fireEvent.click(screen.getByTestId("firewall-send"));
    await waitFor(() => expect(fw.apply).toHaveBeenCalledTimes(1));
    expect(fw.applied[0]).toHaveLength(2);
    expect(await screen.findByTestId("firewall-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("firewall-confirm-ok"));
    await waitFor(() => expect(fw.confirmChange).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("firewall-confirm")).toBeNull());
  });

  it("opens a closed port of SWS from the list of the listening ports", async () => {
    const fw = fakeApi(view());
    render(<FirewallEditor api={fw} t={i18n.t} skin={SKIN} />);
    fireEvent.click(await screen.findByTestId("firewall-open-7443"));
    fireEvent.click(screen.getByTestId("firewall-apply"));
    fireEvent.click(screen.getByTestId("firewall-send"));
    await waitFor(() => expect(fw.apply).toHaveBeenCalledWith([
      { zone: "public", action: "add", item: { kind: "port", port: "7443", protocol: "tcp" } },
    ]));
  });

  it("adds a rule for one network", async () => {
    const fw = fakeApi(view());
    render(<FirewallEditor api={fw} t={i18n.t} skin={SKIN} />);
    fireEvent.click(await screen.findByTestId("firewall-add-rule-public"));
    fireEvent.change(screen.getByTestId("firewall-rule-source"), { target: { value: "192.168.0.0/23" } });
    fireEvent.change(screen.getByTestId("firewall-rule-port"), { target: { value: "7444" } });
    fireEvent.click(screen.getByTestId("firewall-form-ok"));
    fireEvent.click(screen.getByTestId("firewall-apply"));
    fireEvent.click(screen.getByTestId("firewall-send"));
    await waitFor(() => expect(fw.apply).toHaveBeenCalledWith([{
      zone: "public", action: "add",
      item: { kind: "rich_rule", rule: 'rule family="ipv4" source address="192.168.0.0/23" port port="7444" protocol="tcp" accept' },
    }]));
  });

  it("says when firewalld is not there", async () => {
    const fw = fakeApi({ ...view(), available: false });
    render(<FirewallEditor api={fw} t={i18n.t} skin={SKIN} />);
    expect(await screen.findByTestId("firewall-unavailable")).toBeTruthy();
  });
});

describe("Device → Firewall", () => {
  it("without a connected panel it asks for one", () => {
    useAppStore.setState({ remoteConnected: false });
    render(<FirewallTab />);
    expect(screen.getByTestId("firewall-not-connected")).toBeTruthy();
  });

  it("a panel without firewalld says so", async () => {
    useAppStore.setState({ remoteConnected: true });
    vi.spyOn(api, "remoteGetSystemStatus").mockResolvedValue({ firewall: false } as unknown as SystemStatus);
    render(<FirewallTab />);
    expect(await screen.findByTestId("firewall-unavailable")).toBeTruthy();
    useAppStore.setState({ remoteConnected: false });
  });
});
