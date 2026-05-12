// TODO: exponential back-off reconnection.
import { useEffect } from "react";
import { useAppStore } from "@/store";
import type { TagQuality } from "@/types";

/**
 * Derive the WebSocket URL from `window.location` so it works whether the
 * browser is on the same machine or another host on the LAN. In dev mode
 * the Vite proxy upgrades `/ws/*` to the runtime; in production nginx
 * serves both the SPA and the WS on the same origin. An explicit override
 * via `VITE_RUNTIME_WS_URL` is still honoured.
 */
function defaultWsUrl(path: string): string {
  if (typeof window === "undefined") return `ws://localhost/${path}`;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${path}`;
}

const WS_URL = import.meta.env.VITE_RUNTIME_WS_URL ?? defaultWsUrl("/ws/tags");

let socket: WebSocket | null = null;

function getSocket(): WebSocket {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    socket = new WebSocket(WS_URL);
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
