// The device control panel API (`/api/control-panel/*`, plan
// docs/plans/2026-11-13-pannello-di-controllo.md). It lives outside the
// project's authentication: a service PIN opens a short service session, sent
// back in its own header. The viewer page is served by the device's runtime,
// so the paths are relative.

import type { Zone } from "./timezones";

export const SESSION_HEADER = "x-sws-control-panel";
/** On a request the panel makes by itself: it does not keep the session alive. */
export const WATCH_HEADER = "x-sws-control-panel-watch";

export type PinSource = "project" | "device" | "none";

export interface ControlPanelStatus {
  /** The master of the project, as before. */
  enabled: boolean;
  /** The two ways in, already composed with the master; absent on an older runtime = `enabled`. */
  gesture_enabled?: boolean;
  button_enabled?: boolean;
  pin: PinSource;
  /** The device's own brightness, `null` = the project's. */
  brightness?: number | null;
  /** The corner that opens the panel when held; absent on an older runtime = top right. */
  panel_corner?: RebootCorner;
  panel_corner_options?: PanelCornerOptions;
}

/** How the corner that opens the panel behaves; absent = 5 s in 80 px. */
export interface PanelCornerOptions {
  hold_secs: number;
  size_px: number;
}

export interface Capabilities {
  network: boolean;
  wifi: boolean;
  time: boolean;
  reboot: boolean;
  power_off: boolean;
  display: boolean;
  /** PixsysOS' own touch calibration can be started. */
  touch_calibration_service: boolean;
  /** A corner of the screen, held, reboots the device. */
  reboot_corner?: boolean;
}

export type RebootCorner = "none" | "top_left" | "top_right" | "bottom_right" | "bottom_left";

/** How the corner behaves where the LVGL viewer watches it (Tiny TY). */
export interface RebootCornerOptions {
  hold_secs: number;
  size_px: number;
  confirm: boolean;
}

export interface DisplaySettings {
  brightness: number | null;
  panel_corner?: RebootCorner;
  panel_corner_options?: PanelCornerOptions;
  /** The device mounted upside down; `null` where the system turns the screen. */
  flipped?: boolean | null;
  reboot_corner?: RebootCorner;
  /** `false`: the project switched the reboot corner off. */
  reboot_corner_allowed?: boolean;
  /** `null` on PixsysOS, which has its own fixed behaviour. */
  reboot_corner_options?: RebootCornerOptions | null;
}

/** `GET /about`: what runs on the device, read only. */
export interface About {
  sws: { version?: string; git?: string; build_ms?: number | null; uptime_s?: number };
  project: {
    name?: string | null; version?: string | null; loaded_ms?: number | null;
    size_bytes: number; history_bytes: number; pages: number; tags: number; sources: number;
  } | null;
  system: {
    os?: string | null; kernel?: string | null; image?: string | null;
    disk_used_gb?: number; disk_total_gb?: number; mem_used_mb?: number; mem_total_mb?: number;
    cpu_temp_c?: number | null; uptime_s?: number | null;
  };
  state: {
    sources_running?: number; sources?: number; armed?: boolean; alarms_active?: number;
    cloud?: string | null; update_available?: string | null; certificate_expires_ms?: number | null;
  };
  /** Whether the diagnostic export can go on a USB stick here. */
  diagnostics_usb?: boolean;
}

export type Ipv4Method = "auto" | "manual" | "disabled" | "other";

export interface Card {
  name: string;
  kind: "ethernet" | "wifi" | "other";
  state: "connected" | "connecting" | "disconnected" | "unavailable";
  mac: string | null;
  addresses: string[];
  /** The IPv6 addresses that are not link-local: all a Wi-Fi card has when the network gives no DHCP answer. */
  addresses6?: string[];
  gateway: string | null;
  dns: string[];
  method: Ipv4Method | null;
}

export interface Ipv4Change {
  method: "auto" | "manual";
  address?: string;
  prefix?: number;
  gateway?: string;
  dns?: string[];
}

export interface TimeState {
  timezone: string;
  ntp: boolean;
  can_ntp: boolean;
  ntp_synchronized: boolean;
  time_usec: number;
  /** What the NTP client measured: ppm fast (positive) or slow, and the last offset. */
  drift?: { ppm: number; offset_secs: number } | null;
  /** Absent or `null`: this system gives no clean way to choose them. */
  ntp_servers?: NtpServers | null;
}

/** The system's own NTP servers, or one to four written by hand. */
export interface NtpServers {
  manual: boolean;
  servers: string[];
}

export const MAX_NTP_SERVERS = 4;

/** A host name or an address: the same rule as the runtime. */
export function isNtpServer(s: string): boolean {
  return s.length > 0 && s.length <= 253 && /^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(s);
}

/** What was typed, split on spaces and commas. */
export function splitNtpServers(text: string): string[] {
  return text.split(/[\s,;]+/).filter((s) => s.length > 0);
}

export type WifiMode = "client" | "hotspot" | "idle" | "off";
export type WifiSecurity = "open" | "wpa" | "wpa3" | "enterprise";

export interface WifiNetwork {
  ssid: string;
  signal: number;
  security: WifiSecurity;
  known: boolean;
  active: boolean;
}

export interface WifiState {
  card: string | null;
  radio: boolean;
  mode: WifiMode;
  active_ssid: string | null;
  networks: WifiNetwork[];
  saved: string[];
  can_hotspot: boolean;
}

export interface Hotspot {
  enabled: boolean;
  ssid: string;
  password: string;
  /** Never saved: SSID and password are only a proposal. */
  proposed?: boolean;
  /** The `WIFI:` string for the joining QR code. */
  qr?: string;
}

export interface DeviceInfo {
  model: string | null;
  serial: string | null;
  hostname: string;
  sws_version: string;
  initial_pin: string | null;
  /** The cloud the panel is paired to, if any. */
  cloud?: string | null;
}

/** A refused PIN, with the seconds to wait when the device stopped listening. */
export class PinError extends Error {
  constructor(public retryAfterSecs: number | null) {
    super(retryAfterSecs ? `locked for ${retryAfterSecs} s` : "wrong PIN");
  }
}

/** The service session expired (or the runtime restarted): ask the PIN again. */
export class SessionExpired extends Error {}

async function errorText(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch { /* not JSON */ }
  return `HTTP ${res.status}`;
}

export async function getStatus(): Promise<ControlPanelStatus> {
  const res = await fetch("/api/control-panel");
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export async function openSession(pin: string): Promise<string> {
  const res = await fetch("/api/control-panel/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    throw new PinError(typeof body.retry_after_secs === "number" ? body.retry_after_secs : 60);
  }
  if (res.status === 401) throw new PinError(null);
  if (!res.ok) throw new Error(await errorText(res));
  const body = await res.json();
  return body.token as string;
}

/** The calls behind the service session. */
export function session(token: string) {
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    headers.set(SESSION_HEADER, token);
    if (init?.body !== undefined) headers.set("Content-Type", "application/json");
    const res = await fetch(`/api/control-panel${path}`, { ...init, headers });
    if (res.status === 401) throw new SessionExpired();
    if (!res.ok) throw new Error(await errorText(res));
    if (res.status === 204 || res.status === 202) return undefined as T;
    return res.json();
  };
  return {
    capabilities: () => call<Capabilities>("/capabilities"),
    info: () => call<DeviceInfo>("/info"),
    about: () => call<About>("/about"),
    /** The diagnostic export, as the zip to save. */
    diagnostics: async (): Promise<Blob> => {
      const res = await fetch("/api/control-panel/diagnostics", { headers: { [SESSION_HEADER]: token } });
      if (res.status === 401) throw new SessionExpired();
      if (!res.ok) throw new Error(await errorText(res));
      return res.blob();
    },
    /** The same zip written on the USB stick; answers with the file's name. */
    diagnosticsToUsb: () => call<{ file: string }>("/diagnostics/usb", { method: "POST" }),
    network: () => call<Card[]>("/network"),
    /** The cards read again by the panel itself, every few seconds. */
    watchNetwork: () => call<Card[]>("/network", { headers: { [WATCH_HEADER]: "1" } }),
    setIpv4: (card: string, change: Ipv4Change) =>
      call<{ confirm_within_secs: number }>(`/network/${encodeURIComponent(card)}`, {
        method: "PUT",
        body: JSON.stringify(change),
      }),
    confirmNetwork: () => call<void>("/network/confirm", { method: "POST" }),
    rollbackNetwork: () => call<void>("/network/rollback", { method: "POST" }),
    time: () => call<TimeState>("/time"),
    setTime: (change: { timezone?: string; ntp?: boolean; time_usec?: number; ntp_servers?: NtpServers }) =>
      call<void>("/time", { method: "PUT", body: JSON.stringify(change) }),
    timezones: () => call<Zone[]>("/timezones"),
    reboot: () => call<void>("/reboot", { method: "POST" }),
    powerOff: () => call<void>("/power-off", { method: "POST" }),
    /** Gives the device back: project, history, users and pairing removed —
     *  or, with `keepCloud`, everything but the cloud pairing. The PIN is asked
     *  again; `false` = the PIN was wrong. */
    reset: async (pin: string, keepCloud = false): Promise<boolean> => {
      const res = await fetch("/api/control-panel/reset", {
        method: "POST",
        headers: { [SESSION_HEADER]: token, "Content-Type": "application/json" },
        body: JSON.stringify({ pin, keep_cloud: keepCloud }),
      });
      if (res.status === 401) throw new SessionExpired();
      if (res.status === 403) return false;
      if (!res.ok) throw new Error(await errorText(res));
      return true;
    },
    wifi: () => call<WifiState>("/wifi"),
    wifiScan: () => call<void>("/wifi/scan", { method: "POST" }),
    wifiConnect: (req: { ssid: string; password?: string; hidden?: boolean }) =>
      call<{ confirm_within_secs: number }>("/wifi/connect", { method: "POST", body: JSON.stringify(req) }),
    wifiForget: (ssid: string) => call<void>("/wifi/forget", { method: "POST", body: JSON.stringify({ ssid }) }),
    wifiRadio: (enabled: boolean) => call<void>("/wifi/radio", { method: "PUT", body: JSON.stringify({ enabled }) }),
    hotspot: () => call<Hotspot>("/wifi/hotspot"),
    setHotspot: (h: { enabled: boolean; ssid: string; password: string }) =>
      call<{ confirm_within_secs: number }>("/wifi/hotspot", { method: "PUT", body: JSON.stringify(h) }),
    startTouchCalibration: () => call<void>("/touch-calibration", { method: "POST" }),
    display: () => call<DisplaySettings>("/display"),
    setFlip: (flipped: boolean) => call<void>("/flip", { method: "PUT", body: JSON.stringify({ flipped }) }),
    setPanelCorner: (corner: RebootCorner, options: PanelCornerOptions) =>
      call<void>("/panel-corner", { method: "PUT", body: JSON.stringify({ corner, options }) }),
    setRebootCorner: (corner: RebootCorner, options: RebootCornerOptions | null) =>
      call<void>("/reboot-corner", { method: "PUT", body: JSON.stringify({ corner, options }) }),
    setDisplay: (brightness: number | null) =>
      call<void>("/display", { method: "PUT", body: JSON.stringify({ brightness }) }),
  };
}

export type ControlPanelSession = ReturnType<typeof session>;

/** WPA2-PSK: 8 to 63 printable ASCII characters (the runtime checks it too). */
export function isPsk(s: string): boolean {
  return s.length >= 8 && s.length <= 63 && /^[\x20-\x7e]*$/.test(s);
}

/** `a.b.c.d` with four numbers 0-255. */
export function isIpv4(s: string): boolean {
  const parts = s.trim().split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** Splits `192.168.1.242/24` into address and prefix. */
export function splitCidr(cidr: string): { address: string; prefix: number } {
  const [address, prefix] = cidr.split("/");
  return { address, prefix: Number(prefix ?? 24) };
}
