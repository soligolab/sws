import { useEffect } from "react";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { AlarmState } from "@/types";
import { buildWsUrl } from "@/ws/wsUrl";
import { socketCondiviso } from "@/ws/singletonWs";

const socket = socketCondiviso(() => buildWsUrl("/ws/alarms", "VITE_ALARMS_WS_URL"));

export function useAlarmStream(): void {
  const setAlarms   = useAppStore((s) => s.setAlarms);
  const updateAlarm = useAppStore((s) => s.updateAlarm);
  const authToken   = useAppStore((s) => s.authToken);

  useEffect(() => {
    if (!authToken) {
      socket.chiudi();
      return;
    }

    // Prime with a snapshot via HTTP, then subscribe to live transitions.
    api.getAlarms().then(setAlarms).catch(() => {});

    const stream = socket.prendi();

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
