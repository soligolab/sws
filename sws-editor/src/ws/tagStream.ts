// TODO: exponential back-off reconnection.
import { useEffect } from "react";
import { getAuthToken } from "@/api/client";
import { useAppStore } from "@/store";
import type { TagQuality } from "@/types";

/**
 * Derive the WebSocket URL from `window.location` so it works whether the
 * browser is on the same machine or another host on the LAN. In dev mode
 * the Vite proxy upgrades `/ws/*` to the runtime; in production nginx
 * serves both the SPA and the WS on the same origin. An explicit override
 * via `VITE_RUNTIME_WS_URL` is still honoured.
 *
 * Auth: browsers can't set Authorization on the WebSocket upgrade, so we
 * pass the session token as the `?token=...` query param, which the
 * runtime's auth middleware accepts.
 */
function buildWsUrl(path: string): string {
  const base = import.meta.env.VITE_RUNTIME_WS_URL
    ?? (typeof window === "undefined"
          ? `ws://localhost${path}`
          : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${path}`);
  const token = getAuthToken();
  if (!token) return base;
  return `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

let socket: WebSocket | null = null;
let currentToken: string | null = null;

function getSocket(): WebSocket {
  const token = getAuthToken();
  // Drop a socket opened under a different token (e.g. login/logout cycle).
  if (socket && currentToken !== token) {
    try { socket.close(); } catch { /* ignore */ }
    socket = null;
  }
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    currentToken = token;
    socket = new WebSocket(buildWsUrl("/ws/tags"));
  }
  return socket;
}

// Wire format sent by sws-web /ws/tags
interface TagUpdate {
  id: string;
  state: {
    value: number | string | boolean;
    quality: string;
    timestamp_ms: number;
  };
}

export function useTagStream(): void {
  const updateTagValue = useAppStore((s) => s.updateTagValue);

  useEffect(() => {
    const ws = getSocket();

    const onMessage = (ev: MessageEvent) => {
      try {
        const upd = JSON.parse(ev.data as string) as TagUpdate;
        if (upd?.id && upd?.state) {
          updateTagValue(upd.id, {
            value: upd.state.value,
            quality: upd.state.quality as TagQuality,
            timestamp_ms: upd.state.timestamp_ms,
          });
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.addEventListener("message", onMessage);
    return () => ws.removeEventListener("message", onMessage);
  }, [updateTagValue]);
}
