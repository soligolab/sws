// Live runtime log feed from /ws/logs: the server sends its ring first, then
// the live tail. (Fino al 07-11-2026 c'era anche una GET /api/logs, che
// portava le stesse righe una seconda volta.) Le righe passano dal versatore
// (`versaLog.ts`), che le versa a blocchi e scarta quelle già viste. Mirrors the alarmStream / tagStream singleton pattern so
// repeated component mounts don't open extra sockets.
//
// Operator+ only. If the current session is a Viewer the hook returns early
// without opening the socket and the LogPanel renders a "no access" state.

import { useEffect } from "react";
import { useAppStore } from "@/store";
import type { LogEvent } from "@/types";
import { buildWsUrl } from "@/ws/wsUrl";
import { socketCondiviso } from "@/ws/singletonWs";
import { creaVersatore } from "@/ws/versaLog";

const socket = socketCondiviso(() => buildWsUrl("/ws/logs", "VITE_LOGS_WS_URL"));

export function useLogStream(): void {
  const authRole  = useAppStore((s) => s.authRole);
  const authToken = useAppStore((s) => s.authToken);
  const appendLogs = useAppStore((s) => s.appendLogs);
  const clearLogs  = useAppStore((s) => s.clearLogs);

  useEffect(() => {
    if (!authToken || authRole === "Viewer" || authRole === null) {
      socket.chiudi();
      return;
    }

    const stream = socket.prendi();
    const versatore = creaVersatore(appendLogs, clearLogs);

    const onMessage = (ev: MessageEvent) => {
      try {
        const event = JSON.parse(ev.data as string) as LogEvent;
        if (event?.ts_ms !== undefined && event?.level) versatore.metti(event);
      } catch {
        // ignore malformed frames
      }
    };

    stream.on("message", onMessage);
    return () => {
      stream.off("message", onMessage);
      versatore.ferma();
    };
  }, [authToken, authRole, appendLogs, clearLogs]);
}
