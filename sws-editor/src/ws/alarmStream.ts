import { useEffect } from "react";
import { api, getAuthToken } from "@/api/client";
import { useAppStore } from "@/store";
import type { AlarmState } from "@/types";
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
    rws = new ReconnectingWs(() => buildWsUrl("/ws/alarms", "VITE_ALARMS_WS_URL"));
  }
  return rws;
}

export function useAlarmStream(): void {
  const setAlarms   = useAppStore((s) => s.setAlarms);
  const updateAlarm = useAppStore((s) => s.updateAlarm);
  const authToken   = useAppStore((s) => s.authToken);

  useEffect(() => {
    if (!authToken) {
      rws?.destroy();
      rws = null;
      currentToken = null;
      return;
    }

    // Prime with a snapshot via HTTP, then subscribe to live transitions.
    api.getAlarms().then(setAlarms).catch(() => {});

    const stream = getStream();

    const onMessage = (ev: MessageEvent) => {
      try {
        const state = JSON.parse(ev.data as string) as AlarmState;
        if (state?.def?.id) updateAlarm(state);
      } catch {
        // ignore malformed frames
      }
    };

    stream.on("message", onMessage);
    return () => stream.off("message", onMessage);
  }, [setAlarms, updateAlarm, authToken]);
}
