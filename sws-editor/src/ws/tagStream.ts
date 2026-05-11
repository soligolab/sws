// TODO: exponential back-off reconnection.
import { useEffect } from "react";
import { useAppStore } from "@/store";
import type { TagQuality } from "@/types";

const WS_URL = import.meta.env.VITE_RUNTIME_WS_URL ?? "wss://localhost:8443/ws/tags";

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
