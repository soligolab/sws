// Live runtime log feed: HTTP snapshot via GET /api/logs, then a WS tail
// from /ws/logs. Mirrors the alarmStream / tagStream singleton pattern so
// repeated component mounts don't open extra sockets.
//
// Operator+ only. If the current session is a Viewer, the hook returns
// early without opening the socket and the LogPanel renders a "no access"
// state.

import { useEffect } from "react";
import { api, getAuthToken } from "@/api/client";
import { useAppStore } from "@/store";
import type { LogEvent } from "@/types";

function buildWsUrl(path: string): string {
  const base = import.meta.env.VITE_LOGS_WS_URL
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
  if (socket && currentToken !== token) {
    try { socket.close(); } catch { /* ignore */ }
    socket = null;
  }
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    currentToken = token;
    socket = new WebSocket(buildWsUrl("/ws/logs"));
  }
  return socket;
}

export function useLogStream(): void {
  const authRole  = useAppStore((s) => s.authRole);
  const authToken = useAppStore((s) => s.authToken);
  const setLogs   = useAppStore((s) => s.setLogs);
  const appendLog = useAppStore((s) => s.appendLog);

  useEffect(() => {
    // Operator+ gate: skip both the REST seed and the WS open for Viewer.
    if (!authToken || authRole === "Viewer" || authRole === null) return;

    api.getLogs().then(setLogs).catch(() => {});

    const ws = getSocket();
    const onMessage = (ev: MessageEvent) => {
      try {
        const event = JSON.parse(ev.data as string) as LogEvent;
        if (event?.ts_ms !== undefined && event?.level) appendLog(event);
      } catch {
        // ignore malformed frames
      }
    };
    ws.addEventListener("message", onMessage);
    return () => ws.removeEventListener("message", onMessage);
  }, [authToken, authRole, setLogs, appendLog]);
}
