import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { useAlarmStream } from "@/ws/alarmStream";
import type { AlarmSeverity, AlarmState, IsaState } from "@/types";

const SEV_COLOR: Record<AlarmSeverity, string> = {
  Info:     "var(--brand-primary, #3b82f6)",
  Warning:  "var(--brand-warning, #eab308)",
  Critical: "var(--brand-danger, #ef4444)",
};

// Blinking animation only for active-unacked (the most urgent state).
function isaStyle(state: IsaState, color: string): React.CSSProperties {
  const base: React.CSSProperties = {
    background: color,
    color: "var(--brand-bg, #0f172a)",
    padding: "1px 8px",
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 11,
  };
  if (state === "active_unacked") {
    return { ...base, animation: "sws-blink 1s step-start infinite" };
  }
  if (state === "normal_unacked") {
    return { ...base, background: "transparent", color: color, border: `1px solid ${color}` };
  }
  return base;
}

function sev(state: AlarmState): AlarmSeverity {
  return state.def.severity ?? "Warning";
}

/**
 * Fascia allarmi in cima al viewer.
 *
 * `overlay`: modalità "viewer a schermo pieno" (impostazione di progetto
 * `hide_viewer_chrome`). La fascia sparisce del tutto quando non ci sono
 * allarmi — invece di occupare 32px per dire "nessun allarme" — e quando ce ne
 * sono compare **sovrapposta** al synoptic, senza rubare spazio alla pagina.
 * Senza `overlay` resta il comportamento storico: sempre presente, nel flusso.
 */
export function AlarmBanner({ overlay = false }: { overlay?: boolean } = {}) {
  const { t } = useTranslation();
  useAlarmStream();

  const alarms = useAppStore((s) => s.alarms);
  const updateAlarm = useAppStore((s) => s.updateAlarm);
  const authUser = useAppStore((s) => s.authUser);

  const { alerting, unacked, mostUrgent } = useMemo(() => {
    const list = Object.values(alarms);
    // "alerting" = any state that is not Normal
    const alerting = list.filter((a) => a.isa_state !== "normal");
    const unacked  = list.filter((a) =>
      a.isa_state === "active_unacked" || a.isa_state === "normal_unacked"
    );
    // Priority order: active_unacked > active_acked > normal_unacked
    const priority = (s: AlarmState) =>
      s.isa_state === "active_unacked" ? 0
      : s.isa_state === "active_acked" ? 1
      : s.isa_state === "normal_unacked" ? 2
      : 3;
    const mostUrgent = alerting
      .slice()
      .sort((a, b) => priority(a) - priority(b) || (b.activated_at_ms ?? 0) - (a.activated_at_ms ?? 0))[0];
    return { alerting, unacked, mostUrgent };
  }, [alarms]);

  // In overlay non si mostra nulla a riposo: è il senso della modalità.
  if (alerting.length === 0 && overlay) return null;

  if (alerting.length === 0) {
    return (
      <div style={{
        height: 32, background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-muted, #94a3b8)",
        display: "flex", alignItems: "center", padding: "0 16px",
        fontSize: 13, borderBottom: "1px solid var(--brand-surface-2, #334155)",
      }}>
        {t("alarm.noAlarms")}
      </div>
    );
  }

  const color = SEV_COLOR[sev(mostUrgent)];

  const handleAck = async () => {
    try {
      // Pass username as "by" so the journal records who acknowledged.
      await api.ackAlarm(mostUrgent.def.id, authUser ?? undefined);
      updateAlarm({
        ...mostUrgent,
        isa_state: mostUrgent.isa_state === "active_unacked" ? "active_acked" : "normal",
        acknowledged: true,
        ack_at_ms: Date.now(),
      });
    } catch {
      // next snapshot will reconcile
    }
  };

  const needsAck = mostUrgent.isa_state === "active_unacked" || mostUrgent.isa_state === "normal_unacked";

  return (
    <>
      {/* Blink keyframe injected once */}
      <style>{`@keyframes sws-blink { 50% { opacity: 0.3; } }`}</style>
      <div style={{
        height: 32,
        boxSizing: "border-box",
        background: overlay ? `${color}dd` : `${color}22`,
        borderBottom: `1px solid ${color}`,
        color: "var(--brand-text, #e2e8f0)",
        display: "flex", alignItems: "center", padding: "0 16px",
        fontSize: 13, gap: 12,
        // Sovrapposto: sopra il synoptic, senza spostarlo. Sfondo più opaco
        // perché qui sotto c'è il disegno, non lo sfondo dell'app.
        ...(overlay ? {
          position: "fixed" as const, top: 0, left: 0, right: 0, zIndex: 8500,
        } : {}),
      }}>
        <span style={isaStyle(mostUrgent.isa_state, color)}>
          {alerting.length} {unacked.length > 0 ? `· ${unacked.length} non conf.` : ""}
        </span>
        <span style={{ fontSize: 10, color, flexShrink: 0 }}>
          {t(`alarm.isa.${mostUrgent.isa_state}`)}
        </span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <strong style={{ color }}>{mostUrgent.def.id}</strong>
          {" — "}
          {mostUrgent.def.message}
        </span>
        {needsAck && (
          <button
            onClick={handleAck}
            style={{
              background: color, color: "var(--brand-bg, #0f172a)", border: "none",
              borderRadius: 4, padding: "2px 12px", cursor: "pointer",
              fontWeight: 600, fontSize: 12,
            }}
          >
            ACK
          </button>
        )}
      </div>
    </>
  );
}
