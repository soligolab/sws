import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { useAlarmStream } from "@/ws/alarmStream";
import type { AlarmSeverity, AlarmState } from "@/types";

const SEV_COLOR: Record<AlarmSeverity, string> = {
  Info:     "#3b82f6",
  Warning:  "#eab308",
  Critical: "#ef4444",
};

function sev(state: AlarmState): AlarmSeverity {
  return state.def.severity ?? "Warning";
}

export function AlarmBanner() {
  const { t } = useTranslation();
  useAlarmStream();

  const alarms = useAppStore((s) => s.alarms);
  const updateAlarm = useAppStore((s) => s.updateAlarm);

  const { active, unack, mostRecent } = useMemo(() => {
    const list = Object.values(alarms);
    const active = list.filter((a) => a.active);
    const unack = active.filter((a) => !a.acknowledged);
    // Most-recent unacked first; otherwise most-recent active; otherwise nothing.
    const pool = unack.length > 0 ? unack : active;
    const mostRecent = pool
      .slice()
      .sort((a, b) => (b.activated_at_ms ?? 0) - (a.activated_at_ms ?? 0))[0];
    return { active, unack, mostRecent };
  }, [alarms]);

  if (active.length === 0) {
    return (
      <div style={{
        height: 32, background: "#1e293b", color: "#94a3b8",
        display: "flex", alignItems: "center", padding: "0 16px",
        fontSize: 13, borderBottom: "1px solid #334155",
      }}>
        {t("alarm.noAlarms")}
      </div>
    );
  }

  const color = SEV_COLOR[sev(mostRecent)];

  const handleAck = async () => {
    try {
      await api.ackAlarm(mostRecent.def.id);
      // Optimistic local update — the WS broadcast will follow and replace this.
      updateAlarm({ ...mostRecent, acknowledged: true, ack_at_ms: Date.now() });
    } catch {
      // ignore — next snapshot poll will reconcile
    }
  };

  return (
    <div style={{
      height: 32,
      background: `${color}22`, // 13% opacity tint
      borderBottom: `1px solid ${color}`,
      color: "#e2e8f0",
      display: "flex", alignItems: "center", padding: "0 16px",
      fontSize: 13, gap: 12,
    }}>
      <span style={{
        background: color, color: "#0f172a",
        padding: "1px 8px", borderRadius: 10, fontWeight: 700, fontSize: 11,
      }}>
        {active.length} attivi{unack.length > 0 ? ` · ${unack.length} non confermati` : ""}
      </span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <strong style={{ color }}>{mostRecent.def.id}</strong>
        {" — "}
        {mostRecent.def.message}
      </span>
      {!mostRecent.acknowledged && (
        <button
          onClick={handleAck}
          style={{
            background: color, color: "#0f172a", border: "none",
            borderRadius: 4, padding: "2px 12px", cursor: "pointer",
            fontWeight: 600, fontSize: 12,
          }}
        >
          ACK
        </button>
      )}
    </div>
  );
}
