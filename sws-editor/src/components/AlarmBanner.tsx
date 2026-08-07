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

export interface AlarmBannerProps {
  /** Modalità "viewer a schermo pieno" (impostazione di progetto
   *  `hide_viewer_chrome`): sparisce del tutto a riposo, sovrapposta fixed
   *  top quando c'è qualcosa da mostrare. Solo per la vecchia chrome fissa. */
  overlay?: boolean;
  /** Per l'oggetto SCADA piazzabile `alarm_banner`: riempie il box del
   *  foreignObject invece di occupare 100% larghezza fissa in cima. */
  boxed?: boolean;
  /** Altezza in modalità non-boxed (default storico: 32px). */
  height?: number;
  idPrefix?: string;
  allowedSev?: AlarmSeverity[];
}

/** Fascia allarmi — chrome fissa storica (`overlay`/inline) o oggetto SCADA
 *  piazzabile (`boxed`), stessa logica di priorità ISA/blink/ACK. */
export function AlarmBanner({ overlay = false, boxed = false, height = 32, idPrefix = "", allowedSev }: AlarmBannerProps = {}) {
  const { t } = useTranslation();
  useAlarmStream();

  const alarms = useAppStore((s) => s.alarms);
  const updateAlarm = useAppStore((s) => s.updateAlarm);
  const authUser = useAppStore((s) => s.authUser);

  const { alerting, unacked, mostUrgent } = useMemo(() => {
    const list = Object.values(alarms).filter((a) => {
      if (idPrefix && !a.def.id.startsWith(idPrefix)) return false;
      if (allowedSev && allowedSev.length > 0 && !allowedSev.includes(a.def.severity!)) return false;
      return true;
    });
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
  }, [alarms, idPrefix, allowedSev]);

  // In overlay non si mostra nulla a riposo: è il senso della modalità.
  if (alerting.length === 0 && overlay) return null;

  const sizeStyle: React.CSSProperties = boxed
    ? { width: "100%", height: "100%", boxSizing: "border-box" }
    : { height };

  if (alerting.length === 0) {
    return (
      <div style={{
        ...sizeStyle, background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-muted, #94a3b8)",
        display: "flex", alignItems: "center", padding: "0 16px",
        fontSize: 13,
        border: boxed ? "1px solid var(--brand-surface-2, #334155)" : undefined,
        borderBottom: boxed ? undefined : "1px solid var(--brand-surface-2, #334155)",
        borderRadius: boxed ? 4 : undefined,
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
        ...sizeStyle,
        boxSizing: "border-box",
        background: overlay ? `${color}dd` : `${color}22`,
        border: boxed ? `1px solid ${color}` : undefined,
        borderBottom: boxed ? undefined : `1px solid ${color}`,
        borderRadius: boxed ? 4 : undefined,
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
