// TODO: exponential back-off reconnection (shared with tagStream).
import { useEffect } from "react";
import { api, getAuthToken } from "@/api/client";
import { useAppStore } from "@/store";
import type { AlarmState } from "@/types";
import { buildWsUrl } from "@/ws/wsUrl";

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
    socket = new WebSocket(buildWsUrl("/ws/alarms", "VITE_ALARMS_WS_URL"));
  }
  return socket;
}

export function useAlarmStream(): void {
  const setAlarms    = useAppStore((s) => s.setAlarms);
  const updateAlarm  = useAppStore((s) => s.updateAlarm);

  useEffect(() => {
    // Prime with a snapshot via HTTP, then subscribe to live transitions.
    // The WS handler also sends the snapshot first, but a parallel REST call
    // lets the UI render before the socket finishes opening.
    api.getAlarms().then(setAlarms).catch(() => {});

    const ws = getSocket();
    const onMessage = (ev: MessageEvent) => {
      try {
        const state = JSON.parse(ev.data as string) as AlarmState;
        if (state?.def?.id) updateAlarm(state);
      } catch {
        // ignore malformed frames
      }
    };
    ws.addEventListener("message", onMessage);
    return () => ws.removeEventListener("message", onMessage);
  }, [setAlarms, updateAlarm]);
}
