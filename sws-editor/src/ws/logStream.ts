// Live runtime log feed: HTTP snapshot via GET /api/logs, then a WS tail
// from /ws/logs. Mirrors the alarmStream / tagStream singleton pattern so
// repeated component mounts don't open extra sockets.
//
// Operator+ only. If the current session is a Viewer the hook returns early
// without opening the socket and the LogPanel renders a "no access" state.

import { useEffect } from "react";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { LogEvent } from "@/types";
import { buildWsUrl } from "@/ws/wsUrl";
import { socketCondiviso } from "@/ws/singletonWs";

const socket = socketCondiviso(() => buildWsUrl("/ws/logs", "VITE_LOGS_WS_URL"));

export function useLogStream(): void {
  const authRole  = useAppStore((s) => s.authRole);
  const authToken = useAppStore((s) => s.authToken);
  const setLogs   = useAppStore((s) => s.setLogs);
  const appendLog = useAppStore((s) => s.appendLog);

  useEffect(() => {
    if (!authToken || authRole === "Viewer" || authRole === null) {
      socket.chiudi();
      return;
    }

    api.getLogs().then(setLogs).catch(() => {});

    const stream = socket.prendi();

    const onMessage = (ev: MessageEvent) => {
      try {
        const event = JSON.parse(ev.data as string) as LogEvent;
        if (event?.ts_ms !== undefined && event?.level) appendLog(event);
      } catch {
        // ignore malformed frames
      }
    };

    stream.on("message", onMessage);
    return () => stream.off("message", onMessage);
  }, [authToken, authRole, setLogs, appendLog]);
}
