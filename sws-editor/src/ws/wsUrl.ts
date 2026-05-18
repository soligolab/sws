// Shared helper for building authenticated WebSocket URLs.
//
// Resolution order:
//   1. Per-stream override (`VITE_RUNTIME_WS_URL`, etc.) — full URL, takes
//      precedence so power users can pin individual streams.
//   2. localStorage runtime override (ARCH-004) — when the user has connected
//      to a remote runtime via the WelcomeScreen modal, `api.getRuntimeBaseUrl()`
//      returns its origin and we swap http→ws to derive the WS scheme.
//   3. `VITE_RUNTIME_URL` env var — build-time default (handled inside
//      `getRuntimeBaseUrl` already).
//   4. `window.location` — same-origin (Vite proxy in dev, single-binary in
//      production where the runtime itself serves the SPA).
//
// The session token is appended as `?token=...` because browsers can't set
// Authorization headers on the WebSocket upgrade handshake. The runtime's
// auth middleware accepts the token from either the header or the query
// string.

import { getAuthToken, getRuntimeBaseUrl } from "@/api/client";

export function buildWsUrl(path: string, overrideEnvKey?: string): string {
  let base: string;
  const override = overrideEnvKey
    ? (import.meta.env as Record<string, string | undefined>)[overrideEnvKey]
    : undefined;
  if (override) {
    base = override;
  } else {
    const runtimeBase = getRuntimeBaseUrl();
    if (runtimeBase) {
      base = `${runtimeBase.replace(/^http/, "ws")}${path}`;
    } else if (typeof window === "undefined") {
      base = `ws://localhost${path}`;
    } else {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      base = `${scheme}://${window.location.host}${path}`;
    }
  }
  const token = getAuthToken();
  if (!token) return base;
  return `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}
