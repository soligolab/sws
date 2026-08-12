import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { useAlarmStream } from "@/ws/alarmStream";
import { SEV_COLOR } from "@/alarmSeverity";
import type { AlarmSeverity, AlarmState, IsaState } from "@/types";

// Blinking animation only for active-unacked (the most urgent state).
function isaStyle(state: IsaState, color: string): React.CSSProperties {
  const base: React.CSSProperties = {
    background: color,
    color: "var(--brand-bg, #0f172a)",
    padding: "1px 8px",
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 11,
    flexShrink: 0,
  };
  if (state === "active_unacked") {
    return { ...base, animation: "sws-blink 1s step-start infinite" };
  }
  // normal_unacked
  return { ...base, background: "transparent", color: color, border: `1px solid ${color}` };
}

function sev(state: AlarmState): AlarmSeverity {
  return state.def.severity ?? "Warning";
}

export interface AlarmBannerProps {
  idPrefix?: string;
  allowedSev?: AlarmSeverity[];
}

/** Oggetto SCADA piazzabile `alarm_banner`: lista scrollabile di tutti gli
 *  allarmi non confermati (active_unacked/normal_unacked). Gli allarmi già
 *  confermati (ACK dato) o tornati normali non compaiono — l'altezza data
 *  all'oggetto determina quante righe entrano prima dello scroll. */
export function AlarmBanner({ idPrefix = "", allowedSev }: AlarmBannerProps = {}) {
  const { t } = useTranslation();
  useAlarmStream();

  const alarms = useAppStore((s) => s.alarms);
  const updateAlarm = useAppStore((s) => s.updateAlarm);
  const authUser = useAppStore((s) => s.authUser);

  const unacked = useMemo(() => {
    const list = Object.values(alarms).filter((a) => {
      if (idPrefix && !a.def.id.startsWith(idPrefix)) return false;
      if (allowedSev && allowedSev.length > 0 && !allowedSev.includes(a.def.severity!)) return false;
      return a.isa_state === "active_unacked" || a.isa_state === "normal_unacked";
    });
    // Priority order: active_unacked before normal_unacked, most recent first.
    const priority = (s: AlarmState) => (s.isa_state === "active_unacked" ? 0 : 1);
    return list
      .slice()
      .sort((a, b) => priority(a) - priority(b) || (b.activated_at_ms ?? 0) - (a.activated_at_ms ?? 0));
  }, [alarms, idPrefix, allowedSev]);

  const handleAck = async (alarm: AlarmState) => {
    try {
      // Pass username as "by" so the journal records who acknowledged.
      await api.ackAlarm(alarm.def.id, authUser ?? undefined);
      updateAlarm({
        ...alarm,
        isa_state: alarm.isa_state === "active_unacked" ? "active_acked" : "normal",
        acknowledged: true,
        ack_at_ms: Date.now(),
      });
    } catch {
      // next snapshot will reconcile
    }
  };

  if (unacked.length === 0) {
    return (
      <div style={{
        width: "100%", height: "100%", boxSizing: "border-box",
        background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-muted, #94a3b8)",
        display: "flex", alignItems: "center", padding: "0 16px",
        fontSize: 13,
        border: "1px solid var(--brand-surface-2, #334155)",
        borderRadius: 4,
      }}>
        {t("alarm.noAlarms")}
      </div>
    );
  }

  return (
    <>
      {/* Blink keyframe injected once */}
      <style>{`@keyframes sws-blink { 50% { opacity: 0.3; } }`}</style>
      <div style={{
        width: "100%", height: "100%", boxSizing: "border-box",
        border: "1px solid var(--brand-surface-2, #334155)",
        borderRadius: 4,
        display: "flex", flexDirection: "column",
        overflowY: "auto",
      }}>
        {unacked.map((a) => {
          const color = SEV_COLOR[sev(a)];
          return (
            <div key={a.def.id} style={{
              flexShrink: 0,
              boxSizing: "border-box",
              background: `${color}22`,
              borderBottom: `1px solid ${color}`,
              color: "var(--brand-text, #e2e8f0)",
              display: "flex", alignItems: "center", padding: "4px 16px",
              fontSize: 13, gap: 12,
            }}>
              <span style={isaStyle(a.isa_state, color)}>
                {t(`alarm.isa.${a.isa_state}`)}
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <strong style={{ color }}>{a.def.id}</strong>
                {" — "}
                {a.def.message}
              </span>
              <button
                onClick={() => handleAck(a)}
                style={{
                  background: color, color: "var(--brand-bg, #0f172a)", border: "none",
                  borderRadius: 4, padding: "2px 12px", cursor: "pointer",
                  fontWeight: 600, fontSize: 12, flexShrink: 0,
                }}
              >
                ACK
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
