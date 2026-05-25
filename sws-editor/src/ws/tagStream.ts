import { useEffect } from "react";
import { getAuthToken } from "@/api/client";
import { useAppStore } from "@/store";
import type { TagQuality } from "@/types";
import { buildWsUrl } from "@/ws/wsUrl";
import { ReconnectingWs } from "@/ws/reconnectingWs";

let rws: ReconnectingWs | null = null;
let currentToken: string | null = null;

function getStream(): ReconnectingWs {
  const token = getAuthToken();
  if (rws && currentToken !== token) {
    rws.destroy();
    rws = null;
  }
  if (!rws) {
    currentToken = token;
    rws = new ReconnectingWs(() => buildWsUrl("/ws/tags", "VITE_RUNTIME_WS_URL"));
  }
  return rws;
}

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
  return rws?.send(JSON.stringify({ type: "write", tag, value })) ?? false;
}

export function useTagStream(): void {
  const updateTagValue = useAppStore((s) => s.updateTagValue);
  const authToken = useAppStore((s) => s.authToken);

  useEffect(() => {
    if (!authToken) {
      // Logged out: stop any pending reconnect.
      rws?.destroy();
      rws = null;
      currentToken = null;
      return;
    }

    const stream = getStream();

    const onMessage = (ev: MessageEvent) => {
      const text = typeof ev.data === "string" ? ev.data : "";
      try {
        const parsed = JSON.parse(text) as TagUpdate | WriteAck;
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

    stream.on("message", onMessage);
    return () => stream.off("message", onMessage);
  }, [updateTagValue, authToken]);
}
