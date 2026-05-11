// TODO: implement WSS reconnection with exponential back-off.
import { useEffect } from "react";
import { useAppStore } from "@/store";
import type { TagValue } from "@/types";

const WS_URL = import.meta.env.VITE_RUNTIME_WS_URL ?? "wss://localhost:8443/ws/tags";

let socket: WebSocket | null = null;

function getSocket(): WebSocket {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    socket = new WebSocket(WS_URL);
  }
  return socket;
}

export function useTagStream(tagIds: string[]): void {
  const updateTagValues = useAppStore((s) => s.updateTagValues);

  useEffect(() => {
    if (tagIds.length === 0) return;
    const ws = getSocket();

    const subscribe = () => {
      ws.send(JSON.stringify({ type: "subscribe", tags: tagIds }));
    };

    if (ws.readyState === WebSocket.OPEN) {
      subscribe();
    } else {
      ws.addEventListener("open", subscribe, { once: true });
    }

    const onMessage = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data as string) as Record<string, TagValue>;
      updateTagValues(data);
    };
    ws.addEventListener("message", onMessage);

    return () => {
      ws.removeEventListener("message", onMessage);
      // Unsubscribe only if socket is still alive
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "unsubscribe", tags: tagIds }));
      }
    };
  }, [tagIds.join(","), updateTagValues]); // eslint-disable-line react-hooks/exhaustive-deps
}
