import type {
  AlarmDef,
  AlarmState,
  CustomSymbol,
  FunctionDef,
  LogEvent,
  LogFileEntry,
  ProjectInfo,
  ProjectListEntry,
  Sample,
  SourceDef,
  SynopticPage,
  TagDef,
  TemplateEntry,
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

/** Server signals an authenticated user must change their password before
 *  reaching any non-self-service endpoint. The runtime returns 403 with
 *  `{ error: "password_change_required" }`; the UI lifts the
 *  ChangePasswordScreen in response. */
export class PasswordChangeRequiredError extends Error {
  constructor() { super("password change required"); this.name = "PasswordChangeRequiredError"; }
}

/** Server returned 503 — no project is currently open.
 *  The WelcomeScreen should be shown so the user can pick or create one. */
export class NoProjectError extends Error {
  constructor() { super("no active project"); this.name = "NoProjectError"; }
}

export type UserRole = "Viewer" | "Operator" | "Supervisor" | "Admin";

export interface UserSummary {
  username: string;
  role: UserRole;
  must_change_password: boolean;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface CreateUserBody {
  username: string;
  password: string;
  role: UserRole;
  must_change_password?: boolean;
}

export interface UpdateUserBody {
  role?: UserRole;
  password?: string;
  must_change_password?: boolean;
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
  if (res.status === 503) {
    // Runtime has no active project. The WelcomeScreen should take over.
    throw new NoProjectError();
  }
  if (res.status === 403) {
    // The runtime gates everything but auth self-service when the session
    // user still has `must_change_password`. Peek at the JSON envelope so
    // the UI can react with a forced-change screen instead of a toast.
    let bodyText = "";
    try { bodyText = await res.text(); } catch { /* ignore */ }
    if (bodyText.includes("password_change_required")) {
      throw new PasswordChangeRequiredError();
    }
    throw new Error(`API ${path}: 403 Forbidden${bodyText ? ` — ${bodyText}` : ""}`);
  }
  if (!res.ok) {
    let bodyText = "";
    try { bodyText = await res.text(); } catch { /* ignore */ }
    throw new Error(`API ${path}: ${res.status} ${res.statusText}${bodyText ? ` — ${bodyText}` : ""}`);
  }
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
      role: UserRole;
      expires_at_ms: number;
      must_change_password: boolean;
    }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    request<void>("/api/auth/logout", { method: "POST" }),

  whoami: () =>
    request<{ username: string; role: UserRole; must_change_password: boolean }>(
      "/api/auth/whoami",
    ),

  changePassword: (oldPassword: string, newPassword: string) =>
    request<void>("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    }),

  // User management (Admin only)
  listUsers: () => request<UserSummary[]>("/api/auth/users"),

  createUser: (body: CreateUserBody) =>
    request<UserSummary>("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  updateUser: (username: string, body: UpdateUserBody) =>
    request<UserSummary>(`/api/auth/users/${encodeURIComponent(username)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  deleteUser: (username: string) =>
    request<void>(`/api/auth/users/${encodeURIComponent(username)}`, {
      method: "DELETE",
    }),

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

  updateFunctions: (functions: FunctionDef[]) =>
    request<void>("/api/project/functions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(functions),
    }),

  updateCustomSymbols: (symbols: CustomSymbol[]) =>
    request<void>("/api/project/custom-symbols", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(symbols),
    }),

  // Project import / export (Admin)
  //
  // Both endpoints speak `application/zip`. We expose the raw `Response`
  // for export so the caller can read the Content-Disposition header
  // before turning the body into a Blob for download.
  exportProjectZip: async (): Promise<Response> => {
    const headers = new Headers();
    if (getAuthToken()) headers.set("Authorization", `Bearer ${getAuthToken()}`);
    const res = await fetch(`${BASE_URL}/api/project/export`, { headers });
    if (res.status === 401) throw new AuthError();
    if (res.status === 403) throw new Error(`API /api/project/export: 403 Forbidden`);
    if (!res.ok) throw new Error(`API /api/project/export: ${res.status} ${res.statusText}`);
    return res;
  },

  importProjectZip: async (file: Blob): Promise<void> => {
    const headers = new Headers({ "Content-Type": "application/zip" });
    if (getAuthToken()) headers.set("Authorization", `Bearer ${getAuthToken()}`);
    const res = await fetch(`${BASE_URL}/api/project/import`, {
      method: "PUT",
      headers,
      body: file,
    });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      throw new Error(`API /api/project/import: ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`);
    }
  },

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

  // Runtime logs (Operator+)
  getLogs: () => request<LogEvent[]>("/api/logs"),
  listLogFiles: () => request<LogFileEntry[]>("/api/logs/files"),
  getLogFile: (date: string) => request<LogEvent[]>(`/api/logs/file?date=${encodeURIComponent(date)}`),

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

  // Script execution
  //
  // `execScript` runs a raw Python body. Today it stays available for
  // ad-hoc tooling (the FunctionEditor "Esegui" button) but synoptic
  // objects no longer carry inline code — they reference a named
  // FunctionDef and call `runFunction` instead.
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

  runFunction: (name: string, args?: Record<string, string | number | boolean>) =>
    request<{
      ok: boolean;
      stdout: string;
      stderr: string;
      sandboxed: boolean;
      error?: string;
    }>(`/api/script/run/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: args ?? {} }),
    }),

  // Multi-project management (pre-auth — no Bearer needed)
  listProjects: () =>
    request<ProjectListEntry[]>("/api/projects"),

  createProject: (req: { name: string; template?: string }) =>
    request<{ name: string }>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),

  openProject: (name: string) =>
    request<{ name: string; must_login: boolean }>(
      `/api/projects/${encodeURIComponent(name)}/open`,
      { method: "POST" },
    ),

  closeProject: () =>
    request<void>("/api/projects/close", { method: "POST" }),

  // Template gallery (pre-auth)
  listTemplates: () =>
    request<TemplateEntry[]>("/api/templates"),

  // Upload a project ZIP to create a new project (pre-auth).
  // `name` is optional — falls back to the name in manifest.json inside the ZIP.
  uploadProjectZip: async (file: Blob, name?: string): Promise<{ name: string }> => {
    const url = name
      ? `${BASE_URL}/api/projects/upload?name=${encodeURIComponent(name)}`
      : `${BASE_URL}/api/projects/upload`;
    const headers = new Headers({ "Content-Type": "application/zip" });
    if (TOKEN) headers.set("Authorization", `Bearer ${TOKEN}`);
    const res = await fetch(url, { method: "POST", headers, body: file });
    if (res.status === 409) throw new Error("Esiste già un progetto con questo nome.");
    if (res.status === 503) throw new NoProjectError();
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      throw new Error(`Upload ZIP: ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`);
    }
    return res.json();
  },
};
