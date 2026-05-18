// TODO: exponential back-off reconnection.
import { useEffect } from "react";
import { getAuthToken } from "@/api/client";
import { useAppStore } from "@/store";
import type { TagQuality } from "@/types";
import { buildWsUrl } from "@/ws/wsUrl";

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
    socket = new WebSocket(buildWsUrl("/ws/tags", "VITE_RUNTIME_WS_URL"));
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
