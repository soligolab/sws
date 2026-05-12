// TODO: add auth header injection once session tokens are implemented.
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init);
  if (!res.ok) throw new Error(`API ${path}: ${res.status} ${res.statusText}`);
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const api = {
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
};
