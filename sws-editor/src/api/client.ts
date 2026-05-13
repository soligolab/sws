import type {
  AlarmDef,
  AlarmState,
  ProjectInfo,
  Sample,
  SourceDef,
  SynopticPage,
  TagDef,
} from "@/types";

const BASE_URL = import.meta.env.VITE_RUNTIME_URL ?? "";

// Session token cache. Set by `setAuthToken` on login / store hydration;
// read on every `request()` call so that protected routes carry the
// Bearer header. Kept here (not in the Zustand store) so `api.*` can be
// called from non-React contexts and so tests can swap it cleanly.
let TOKEN: string | null = null;
export function setAuthToken(token: string | null) { TOKEN = token; }
export function getAuthToken(): string | null { return TOKEN; }

export class AuthError extends Error {
  constructor() { super("unauthorized"); this.name = "AuthError"; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (TOKEN) headers.set("Authorization", `Bearer ${TOKEN}`);
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (res.status === 401) {
    // Surface as a typed error so the UI can drop the stored token and
    // bounce back to the login screen without showing a generic 401 toast.
    throw new AuthError();
  }
  if (!res.ok) throw new Error(`API ${path}: ${res.status} ${res.statusText}`);
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{
      token: string;
      username: string;
      role: "Viewer" | "Operator" | "Supervisor" | "Admin";
      expires_at_ms: number;
    }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    request<void>("/api/auth/logout", { method: "POST" }),

  whoami: () =>
    request<{ username: string; role: string }>("/api/auth/whoami"),

  // Project config
  getProject: () =>
    request<ProjectInfo>("/api/project"),

  updateTags: (tags: TagDef[]) =>
    request<void>("/api/project/tags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tags),
    }),

  updateSources: (sources: SourceDef[]) =>
    request<void>("/api/project/sources", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sources),
    }),

  updateAlarms: (alarms: AlarmDef[]) =>
    request<void>("/api/project/alarms", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alarms),
    }),

  // Synoptics
  listSynoptics: () =>
    request<string[]>("/api/synoptics"),

  getSynoptic: (name: string) =>
    request<SynopticPage>(`/api/synoptics/${encodeURIComponent(name)}`),

  saveSynoptic: (page: SynopticPage) =>
    request<void>(`/api/synoptics/${encodeURIComponent(page.name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(page),
    }),

  // Tags
  writeTag: (id: string, value: number | string | boolean) =>
    request<void>(`/api/tags/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    }),

  // Alarms
  getAlarms: () =>
    request<AlarmState[]>("/api/alarms"),

  ackAlarm: (id: string) =>
    request<void>(`/api/alarms/${encodeURIComponent(id)}/ack`, { method: "POST" }),

  // Historian
  getHistory: (tag: string, opts?: { fromMs?: number; toMs?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.fromMs !== undefined) params.set("from", String(opts.fromMs));
    if (opts?.toMs   !== undefined) params.set("to",   String(opts.toMs));
    if (opts?.limit  !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return request<Sample[]>(
      `/api/history/${encodeURIComponent(tag)}${qs ? "?" + qs : ""}`,
    );
  },

  // Script execution (object on_press / on_release handlers)
  execScript: (code: string) =>
    request<{
      ok: boolean;
      stdout: string;
      stderr: string;
      sandboxed: boolean;
      error?: string;
    }>("/api/script/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }),
};
