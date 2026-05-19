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

interface WriteAck {
  type: "ack";
  req_id?: string | null;
  tag: string;
  ok: boolean;
  error?: string;
}

/**
 * Send a tag write through the live /ws/tags socket if it's open. Returns
 * `true` when the frame was queued; the caller can fall back to the HTTP
 * PUT path when it returns `false` (socket connecting, closed, or token
 * not yet set). Saves a full HTTP round-trip for low-latency operator
 * actions (button presses, slider drags) and reuses the auth token the
 * socket was upgraded with.
 */
export function tryTagWriteWs(
  tag: string,
  value: number | string | boolean,
): boolean {
  const s = socket;
  if (!s || s.readyState !== WebSocket.OPEN) return false;
  try {
    s.send(JSON.stringify({ type: "write", tag, value }));
    return true;
  } catch {
    return false;
  }
}

export function useTagStream(): void {
  const updateTagValue = useAppStore((s) => s.updateTagValue);

  useEffect(() => {
    const ws = getSocket();

    const onMessage = (ev: MessageEvent) => {
      const text = typeof ev.data === "string" ? ev.data : "";
      try {
        const parsed = JSON.parse(text) as TagUpdate | WriteAck;
        // Discriminate by shape: write acks carry { type: "ack" }, tag
        // updates carry { id, state }. Acks aren't propagated to the
        // store — at most we log a failure so the operator sees it.
        if ((parsed as WriteAck).type === "ack") {
          const ack = parsed as WriteAck;
          if (!ack.ok) {
            // eslint-disable-next-line no-console
            console.warn(`[ws/tags] write ${ack.tag} failed: ${ack.error ?? "?"}`);
          }
          return;
        }
        const upd = parsed as TagUpdate;
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
