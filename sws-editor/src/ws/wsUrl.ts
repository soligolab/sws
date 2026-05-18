// Shared helper for building authenticated WebSocket URLs.
//
// Resolution order:
//   1. Per-stream override (`VITE_RUNTIME_WS_URL`, etc.) — full URL, takes precedence
//      so power users can pin individual streams.
//   2. `VITE_RUNTIME_URL` — single env var that points at the runtime origin
//      (e.g. `https://px30.local:8443`). We strip the trailing slash and swap
//      http→ws to derive the WS scheme.
//   3. `window.location` — same-origin (the dev proxy or production bundle case).
//
// The session token is appended as `?token=...` because browsers can't set
// Authorization headers on the WebSocket upgrade handshake. The runtime's
// auth middleware accepts the token from either the header or the query
// string.

import { getAuthToken } from "@/api/client";

export function buildWsUrl(path: string, overrideEnvKey?: string): string {
  let base: string;
  const override = overrideEnvKey
    ? (import.meta.env as Record<string, string | undefined>)[overrideEnvKey]
    : undefined;
  if (override) {
    base = override;
  } else if (import.meta.env.VITE_RUNTIME_URL) {
    const origin = import.meta.env.VITE_RUNTIME_URL.replace(/\/$/, "");
    base = `${origin.replace(/^http/, "ws")}${path}`;
  } else if (typeof window === "undefined") {
    base = `ws://localhost${path}`;
  } else {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    base = `${scheme}://${window.location.host}${path}`;
  }
  const token = getAuthToken();
  if (!token) return base;
  return `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}
