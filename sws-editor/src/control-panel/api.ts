// The device control panel API (`/api/control-panel/*`, plan
// docs/plans/2026-11-13-pannello-di-controllo.md). It lives outside the
// project's authentication: a service PIN opens a short service session, sent
// back in its own header. The viewer page is served by the device's runtime,
// so the paths are relative.

export const SESSION_HEADER = "x-sws-control-panel";

export type PinSource = "project" | "device" | "none";

export interface ControlPanelStatus {
  enabled: boolean;
  pin: PinSource;
}

export interface Capabilities {
  network: boolean;
  wifi: boolean;
  time: boolean;
  reboot: boolean;
  power_off: boolean;
}

export type Ipv4Method = "auto" | "manual" | "disabled" | "other";

export interface Card {
  name: string;
  kind: "ethernet" | "wifi" | "other";
  state: "connected" | "connecting" | "disconnected" | "unavailable";
  mac: string | null;
  addresses: string[];
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
}

export interface DeviceInfo {
  model: string | null;
  serial: string | null;
  hostname: string;
  sws_version: string;
  initial_pin: string | null;
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
    network: () => call<Card[]>("/network"),
    setIpv4: (card: string, change: Ipv4Change) =>
      call<{ confirm_within_secs: number }>(`/network/${encodeURIComponent(card)}`, {
        method: "PUT",
        body: JSON.stringify(change),
      }),
    confirmNetwork: () => call<void>("/network/confirm", { method: "POST" }),
    rollbackNetwork: () => call<void>("/network/rollback", { method: "POST" }),
    time: () => call<TimeState>("/time"),
    setTime: (change: { timezone?: string; ntp?: boolean; time_usec?: number }) =>
      call<void>("/time", { method: "PUT", body: JSON.stringify(change) }),
    timezones: () => call<string[]>("/timezones"),
    reboot: () => call<void>("/reboot", { method: "POST" }),
    powerOff: () => call<void>("/power-off", { method: "POST" }),
  };
}

export type ControlPanelSession = ReturnType<typeof session>;

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
