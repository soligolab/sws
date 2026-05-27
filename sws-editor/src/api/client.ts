import type {
  AlarmDef,
  AlarmEvent,
  AlarmState,
  CustomSymbol,
  DatastoreConfig,
  DatastoreListItem,
  DatastoreStats,
  FaceplateDef,
  FunctionDef,
  GlobalScriptDef,
  HaBrowsedEntity,
  HistoryStats,
  LogEvent,
  LogFileEntry,
  MqttBrowseRequest,
  MqttBrowseResponse,
  NotificationConfig,
  OpcUaBrowseRequest,
  OpcUaBrowseResponse,
  OpcUaCertEntry,
  OpcUaDetectEuromapRequest,
  OpcUaEuromapDetection,
  OpcUaHistoricalSample,
  OpcUaHistoryRequest,
  ProjectInfo,
  ProjectListEntry,
  Sample,
  SourceDef,
  RecipeApplyEvent,
  RecipeApplyResult,
  RecipeDef,
  RecipeSummary,
  ShelvedAlarm,
  SynopticPage,
  TagDef,
  TemplateEntry,
} from "@/types";

// Runtime URL resolution order (ARCH-002 + ARCH-004):
//
//   1. localStorage `sws.runtimeBaseUrl` — user-toggleable at runtime via
//      the WelcomeScreen "Runtime remoto" modal. Lets the same SPA bundle
//      connect to different runtimes (laptop ↔ PX30) without rebuilding.
//   2. `VITE_RUNTIME_URL` env var — build-time default for dev workflows
//      that always target a fixed remote runtime.
//   3. Empty string → same-origin (Vite proxy in dev, single-binary in
//      production where the runtime itself serves the SPA).
//
// Read on every request so a localStorage change takes effect on the
// next call (no app reload required for the api layer; the WelcomeScreen
// does a full `window.location.reload()` anyway to reset auth + project
// state cleanly when the user switches runtime).
const RUNTIME_BASE_URL_KEY = "sws.runtimeBaseUrl";

function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    try {
      const v = window.localStorage.getItem(RUNTIME_BASE_URL_KEY);
      if (v) return v.replace(/\/$/, "");
    } catch { /* ignore */ }
  }
  return (import.meta.env.VITE_RUNTIME_URL as string | undefined) ?? "";
}

export function getRuntimeBaseUrl(): string {
  return getBaseUrl();
}

/** Switch the SPA to a different runtime origin. Pass `null` (or the
 *  empty string) to revert to same-origin. Caller is responsible for
 *  clearing the auth token and reloading the page — the runtime URL
 *  carries identity (tokens issued by the old runtime are invalid on
 *  the new one). */
export function setRuntimeBaseUrl(url: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (url && url.trim() !== "") {
      window.localStorage.setItem(RUNTIME_BASE_URL_KEY, url.trim().replace(/\/$/, ""));
    } else {
      window.localStorage.removeItem(RUNTIME_BASE_URL_KEY);
    }
  } catch { /* ignore */ }
}

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

/** The runtime is not reachable (network error, or proxy returned 502/504).
 *  Distinct from AuthError so the UI can show "start the runtime" rather than
 *  "wrong password". */
export class RuntimeUnavailableError extends Error {
  constructor() { super("runtime unavailable"); this.name = "RuntimeUnavailableError"; }
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

/** Login returned 429 Too Many Requests. `retryAfterSecs` is the value of
 *  the Retry-After header (defaults to 60 if the header is absent). */
export class RateLimitedError extends Error {
  retryAfterSecs: number;
  constructor(secs: number) {
    super("rate limited");
    this.name = "RateLimitedError";
    this.retryAfterSecs = secs;
  }
}

export type UserRole = "Viewer" | "Operator" | "Supervisor" | "Admin";

export interface UserSummary {
  username: string;
  role: UserRole;
  must_change_password: boolean;
  created_at_ms: number;
  updated_at_ms: number;
  /** null = use system default, 0 = never expires, n = n seconds */
  session_ttl_secs: number | null;
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
  /** null = reset to system default, 0 = never expires, n = n seconds */
  session_ttl_secs?: number | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (TOKEN) headers.set("Authorization", `Bearer ${TOKEN}`);
  let res: Response;
  try {
    res = await fetch(`${getBaseUrl()}${path}`, { ...init, headers });
  } catch {
    // Network error (ECONNREFUSED, DNS failure, …) — runtime is not reachable.
    throw new RuntimeUnavailableError();
  }
  if (res.status === 502 || res.status === 504) {
    // Vite proxy / reverse proxy couldn't reach the upstream runtime.
    throw new RuntimeUnavailableError();
  }
  if (res.status === 401) {
    // If we had a token, the session expired mid-use — signal the UI to show
    // a re-auth overlay rather than fully clearing and redirecting.
    if (TOKEN) window.dispatchEvent(new CustomEvent("sws:session-expired"));
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
  if (res.status === 429) {
    const raw = res.headers.get("Retry-After");
    const secs = raw !== null ? parseInt(raw, 10) : NaN;
    throw new RateLimitedError(Number.isFinite(secs) ? secs : 60);
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
      expires_at_ms: number | null;
      must_change_password: boolean;
    }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    request<void>("/api/auth/logout", { method: "POST" }),

  refresh: () =>
    request<{ expires_at_ms: number | null }>("/api/auth/refresh", { method: "POST" }),

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

  importTagsCsv: (csvText: string) =>
    request<{ imported: number }>("/api/project/tags/import-csv", {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: csvText,
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
    const res = await fetch(`${getBaseUrl()}/api/project/export`, { headers });
    if (res.status === 401) throw new AuthError();
    if (res.status === 403) throw new Error(`API /api/project/export: 403 Forbidden`);
    if (!res.ok) throw new Error(`API /api/project/export: ${res.status} ${res.statusText}`);
    return res;
  },

  importProjectZip: async (file: Blob): Promise<void> => {
    const headers = new Headers({ "Content-Type": "application/zip" });
    if (getAuthToken()) headers.set("Authorization", `Bearer ${getAuthToken()}`);
    const res = await fetch(`${getBaseUrl()}/api/project/import`, {
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

  // Single-page YAML export — returns the file body + filename pulled from
  // the Content-Disposition header so the UI can trigger a browser download
  // with the same name the runtime produced.
  exportSynopticYaml: async (name: string): Promise<{ blob: Blob; filename: string }> => {
    const headers = new Headers();
    if (getAuthToken()) headers.set("Authorization", `Bearer ${getAuthToken()}`);
    const res = await fetch(`${getBaseUrl()}/api/synoptics/${encodeURIComponent(name)}/export`, { headers });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) throw new Error(`API export synoptic ${name}: ${res.status} ${res.statusText}`);
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = cd.match(/filename="([^"]+)"/);
    const filename = m?.[1] ?? `${name}.yaml`;
    const blob = await res.blob();
    return { blob, filename };
  },

  importSynopticYaml: (yamlText: string) =>
    request<{ id: string; name: string; filename: string }>(`/api/synoptics/import`, {
      method: "POST",
      headers: { "Content-Type": "application/x-yaml" },
      body: yamlText,
    }),

  // ── Faceplate API ────────────────────────────────────────────────────────
  listFaceplates: () => request<string[]>("/api/faceplates"),
  getFaceplate: (id: string) => request<FaceplateDef>(`/api/faceplates/${encodeURIComponent(id)}`),
  saveFaceplate: (fp: FaceplateDef) =>
    request<void>(`/api/faceplates/${encodeURIComponent(fp.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fp),
    }),
  deleteFaceplate: (id: string) =>
    request<void>(`/api/faceplates/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // ── Recipe API ───────────────────────────────────────────────────────────
  listRecipes: () => request<RecipeSummary[]>("/api/recipes"),
  getRecipe: (id: string) => request<RecipeDef>(`/api/recipes/${encodeURIComponent(id)}`),
  saveRecipe: (r: RecipeDef) =>
    request<void>(`/api/recipes/${encodeURIComponent(r.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r),
    }),
  deleteRecipe: (id: string) =>
    request<void>(`/api/recipes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  applyRecipe: (id: string, applied_by: string) =>
    request<RecipeApplyResult>(`/api/recipes/${encodeURIComponent(id)}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applied_by }),
    }),
  getRecipeHistory: () => request<RecipeApplyEvent[]>("/api/recipes/history"),

  // Backups — admin-only. The list is sorted newest-first by the server.
  listBackups: () =>
    request<Array<{ name: string; created_at_ms: number; size_bytes: number }>>(
      "/api/backups",
    ),

  createBackup: () =>
    request<{ name: string }>("/api/backups", { method: "POST" }),

  restoreBackup: (name: string) =>
    request<void>(`/api/backups/${encodeURIComponent(name)}/restore`, { method: "POST" }),

  deleteBackup: (name: string) =>
    request<void>(`/api/backups/${encodeURIComponent(name)}`, { method: "DELETE" }),

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

  ackAlarm: (id: string, by?: string) =>
    request<void>(`/api/alarms/${encodeURIComponent(id)}/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ by: by ?? null }),
    }),

  getAlarmHistory: (params?: { alarm_id?: string; from_ms?: number; to_ms?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.alarm_id) q.set("alarm_id", params.alarm_id);
    if (params?.from_ms != null) q.set("from_ms", String(params.from_ms));
    if (params?.to_ms != null) q.set("to_ms", String(params.to_ms));
    if (params?.limit != null) q.set("limit", String(params.limit));
    return request<AlarmEvent[]>(`/api/alarms/history?${q}`);
  },

  shelveAlarm: (id: string, reason: string, durationMs: number, shelvedBy: string) =>
    request<void>(`/api/alarms/${encodeURIComponent(id)}/shelve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, duration_ms: durationMs, shelved_by: shelvedBy }),
    }),

  unshelveAlarm: (id: string) =>
    request<void>(`/api/alarms/${encodeURIComponent(id)}/shelve`, { method: "DELETE" }),

  listShelved: () =>
    request<ShelvedAlarm[]>("/api/alarms/shelved"),

  // Runtime logs (Operator+)
  getLogs: () => request<LogEvent[]>("/api/logs"),
  listLogFiles: () => request<LogFileEntry[]>("/api/logs/files"),
  getLogFile: (date: string) => request<LogEvent[]>(`/api/logs/file?date=${encodeURIComponent(date)}`),

  // Historian
  getHistory: (tag: string, opts?: { fromMs?: number; toMs?: number; limit?: number; backfill?: boolean }) => {
    const params = new URLSearchParams();
    if (opts?.fromMs   !== undefined) params.set("from",     String(opts.fromMs));
    if (opts?.toMs     !== undefined) params.set("to",       String(opts.toMs));
    if (opts?.limit    !== undefined) params.set("limit",    String(opts.limit));
    if (opts?.backfill)               params.set("backfill", "true");
    const qs = params.toString();
    return request<Sample[]>(
      `/api/history/${encodeURIComponent(tag)}${qs ? "?" + qs : ""}`,
    );
  },

  /** GET /api/history/export?tags=a,b&from_ms=&to_ms=
   *  Triggers a browser download of a CSV file with all samples for the given tags. */
  exportHistoryCsv: (tags: string[], fromMs?: number, toMs?: number): void => {
    const params = new URLSearchParams({ tags: tags.join(",") });
    if (fromMs !== undefined) params.set("from_ms", String(fromMs));
    if (toMs   !== undefined) params.set("to_ms",   String(toMs));
    const url = `${getBaseUrl()}/api/history/export?${params}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  /** GET /api/history/:tag/stats?from_ms=&to_ms= */
  getHistoryStats: (tag: string, opts?: { fromMs?: number; toMs?: number }) => {
    const params = new URLSearchParams();
    if (opts?.fromMs !== undefined) params.set("from_ms", String(opts.fromMs));
    if (opts?.toMs   !== undefined) params.set("to_ms",   String(opts.toMs));
    const qs = params.toString();
    return request<HistoryStats>(
      `/api/history/${encodeURIComponent(tag)}/stats${qs ? "?" + qs : ""}`,
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

  deleteProject: (name: string) =>
    request<void>(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" }),

  renameProject: (name: string, newName: string) =>
    request<{ name: string }>(`/api/projects/${encodeURIComponent(name)}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: newName }),
    }),

  duplicateProject: (name: string, newName: string) =>
    request<{ name: string }>(`/api/projects/${encodeURIComponent(name)}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: newName }),
    }),

  // Template gallery (pre-auth)
  listTemplates: () =>
    request<TemplateEntry[]>("/api/templates"),

  // Upload a project ZIP to create a new project (pre-auth).
  // `name` is optional — falls back to the name in manifest.json inside the ZIP.
  // MQTT broker browse: connect ephemerally, subscribe #, return discovered topics.
  browseMqttTopics: (req: MqttBrowseRequest): Promise<MqttBrowseResponse> =>
    request<MqttBrowseResponse>("/api/sources/mqtt/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),

  browseOpcUa: (req: OpcUaBrowseRequest): Promise<OpcUaBrowseResponse> =>
    request<OpcUaBrowseResponse>("/api/sources/opcua/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),

  browseHaEntities: (sourceId: string, domainFilter?: string): Promise<HaBrowsedEntity[]> =>
    request<HaBrowsedEntity[]>("/api/sources/ha/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId, domain_filter: domainFilter ?? null }),
    }),

  detectOpcUaEuromap: (req: OpcUaDetectEuromapRequest): Promise<OpcUaEuromapDetection> =>
    request<OpcUaEuromapDetection>("/api/sources/opcua/detect-euromap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),

  // OPC-UA historical read — fetches raw data directly from the server's historian (Operator+)
  readOpcUaHistory: (req: OpcUaHistoryRequest) =>
    request<OpcUaHistoricalSample[]>("/api/sources/opcua/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),

  // OPC-UA certificate trust management (Supervisor+ list, Admin trust/delete)
  listOpcUaCerts: (sourceId: string) =>
    request<OpcUaCertEntry[]>(`/api/sources/${encodeURIComponent(sourceId)}/opcua/certs`),

  trustOpcUaCert: (sourceId: string, filename: string) =>
    request<void>(
      `/api/sources/${encodeURIComponent(sourceId)}/opcua/certs/${encodeURIComponent(filename)}/trust`,
      { method: "POST" },
    ),

  deleteOpcUaCert: (sourceId: string, filename: string) =>
    request<void>(
      `/api/sources/${encodeURIComponent(sourceId)}/opcua/certs/${encodeURIComponent(filename)}`,
      { method: "DELETE" },
    ),

  getSystemStatus: (): Promise<{
    runtime_version: string;
    uptime_s: number;
    active_project: string | null;
    tag_count: number;
    source_count: number;
    alarm_active_count: number;
    historian_samples: number;
    cpu_usage_pct: number;
    mem_used_mb: number;
    mem_total_mb: number;
    disk_used_gb: number;
    disk_total_gb: number;
  }> => request("/api/system"),

  // Datastores (runtime stats + admin ops)
  listDatastores: () => request<DatastoreListItem[]>("/api/datastores"),

  datastoreStats: (id: string) =>
    request<DatastoreStats>(`/api/datastores/${encodeURIComponent(id)}/stats`),

  testDatastore: (id: string) =>
    request<string>(`/api/datastores/${encodeURIComponent(id)}/test`, { method: "POST" }),

  purgeDatastore: (id: string, body: { retention_rows?: number; retention_days?: number }) =>
    request<{ deleted: number }>(`/api/datastores/${encodeURIComponent(id)}/purge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  exportDatastore: (id: string, opts?: { tags?: string[]; fromMs?: number; toMs?: number }) => {
    const params = new URLSearchParams();
    if (opts?.tags?.length)    params.set("tags",    opts.tags.join(","));
    if (opts?.fromMs != null)  params.set("from_ms", String(opts.fromMs));
    if (opts?.toMs   != null)  params.set("to_ms",   String(opts.toMs));
    const qs = params.toString();
    return request<{ tag_id: string; samples: Sample[] }[]>(
      `/api/datastores/${encodeURIComponent(id)}/export${qs ? "?" + qs : ""}`,
    );
  },

  // Project datastores config (saved as part of PUT /api/project/tags — uses existing endpoint)
  saveDatastores: (datastores: DatastoreConfig[]) =>
    request<void>("/api/project/datastores", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datastores),
    }),

  saveGlobalScripts: (scripts: GlobalScriptDef[]) =>
    request<void>("/api/project/global-scripts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scripts),
    }),

  saveNotifications: (config: NotificationConfig | null) =>
    request<void>("/api/project/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }),

  uploadProjectZip: async (file: Blob, name?: string): Promise<{ name: string }> => {
    const url = name
      ? `${getBaseUrl()}/api/projects/upload?name=${encodeURIComponent(name)}`
      : `${getBaseUrl()}/api/projects/upload`;
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
