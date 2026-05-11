// TODO: add auth header injection once session tokens are implemented.

const BASE_URL = import.meta.env.VITE_RUNTIME_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init);
  if (!res.ok) throw new Error(`API ${path}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  getTags: (ids: string[]) =>
    request<Record<string, unknown>>(`/api/tags?ids=${ids.join(",")}`),
  getProject: () => request<unknown>("/api/project"),
};
