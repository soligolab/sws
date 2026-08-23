import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { useAlarmStream } from "@/ws/alarmStream";
import { AlarmHistory } from "@/components/AlarmHistory";
import { effectiveProjectLang, resolveMsg } from "@/i18n/projectI18n";
import { playAlarmBeep, worstSeverity } from "@/alarmSound";
import { SEV_COLOR } from "@/alarmSeverity";
import type { AlarmSeverity, AlarmState, ShelvedAlarm } from "@/types";

// ── AlarmBellPanel ────────────────────────────────────────────────────────────
//
// Estratto da `AlarmPanel` (ex chrome fissa in RuntimeView.tsx): stessa logica
// di ack/shelve/unshelve e storico, ma pensato per essere montato come oggetto
// SCADA piazzabile (`alarm_bell`) invece che fisso in alto a destra. Il
// dropdown esce dal proprio `foreignObject` via portale in `document.body`,
// ancorato alla posizione a schermo del bottone (funziona con zoom/pan canvas).

export interface AlarmBellPanelProps {
  idPrefix?: string;
  allowedSev?: AlarmSeverity[];
  showHistory?: boolean;
  showShelve?: boolean;
  badgeFill?: string;
  // ── F7.5 — segnalazione acustica ────────────────────────────────────────
  /** Attiva il suono alla comparsa di allarmi non confermati. */
  sound?: boolean;
  /** Severità che suonano (vuoto/assente = tutte). */
  soundSeverities?: AlarmSeverity[];
  /** Intervallo di ripetizione in secondi. Default 20. */
  soundRepeatS?: number;
  /** Silenzio imposto dall'esterno (in editor: mai suoni durante il disegno). */
  muted?: boolean;
}

export function AlarmBellPanel({ idPrefix = "", allowedSev, showHistory = true, showShelve = true, badgeFill,
  sound = false, soundSeverities, soundRepeatS = 20, muted: mutedProp }: AlarmBellPanelProps) {
  const { t } = useTranslation();
  useAlarmStream();

  const alarms = useAppStore((s) => s.alarms);
  // F1.3: messaggi di allarme localizzati come ogni altro testo di progetto.
  const langTable = useAppStore((s) => s.project?.languages);
  const projLang = useAppStore((s) => s.projectLang);
  const msgLang = effectiveProjectLang(langTable) || projLang;
  const updateAlarm = useAppStore((s) => s.updateAlarm);
  const authUser = useAppStore((s) => s.authUser);
  const [open, setOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"attivi" | "storico">("attivi");
  const [shelved, setShelved] = useState<ShelvedAlarm[]>([]);
  // shelveOpen: id of alarm whose inline shelve-form is expanded, or null
  const [shelveOpen, setShelveOpen] = useState<string | null>(null);
  const [shelveReason, setShelveReason] = useState("");
  const [shelveHours, setShelveHours] = useState<number>(8);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const { active, unack } = useMemo(() => {
    const list: AlarmState[] = Object.values(alarms).filter((a) => {
      if (idPrefix && !a.def.id.startsWith(idPrefix)) return false;
      if (allowedSev && allowedSev.length > 0 && !allowedSev.includes(a.def.severity!)) return false;
      return true;
    });
    const active = list
      .filter((a) => a.active)
      .sort((a, b) => (b.activated_at_ms ?? 0) - (a.activated_at_ms ?? 0));
    const unack = active.filter((a) => !a.acknowledged);
    return { active, unack };
  }, [alarms, idPrefix, allowedSev]);

  // ── F7.5 — segnalazione acustica ─────────────────────────────────────────
  // Suona alla comparsa di un allarme non confermato e poi ogni
  // `soundRepeatS`, finché resta non confermato. Il pulsante "tacita" ferma il
  // suono per gli allarmi ATTUALI: un allarme nuovo lo riattiva da solo,
  // altrimenti "tacita" diventerebbe uno spegnimento permanente che nessuno
  // ricorda di annullare.
  const [muted, setMuted] = useState(false);
  const silencedRef = useRef<Set<string>>(new Set());
  const lastBeepRef = useRef(0);

  const soundable = useMemo(() => unack.filter((a) =>
    !soundSeverities || soundSeverities.length === 0 || soundSeverities.includes(a.def.severity!)
  ), [unack, soundSeverities]);

  useEffect(() => {
    if (!sound || mutedProp) return;
    const pending = soundable.filter((a) => !silencedRef.current.has(a.def.id));
    if (pending.length === 0) return;
    const sev = worstSeverity(pending.map((a) => a.def.severity));
    if (!sev) return;
    const tick = () => {
      const now = Date.now();
      if (now - lastBeepRef.current < Math.max(2, soundRepeatS) * 1000) return;
      lastBeepRef.current = now;
      playAlarmBeep(sev);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sound, mutedProp, soundable, soundRepeatS]);

  // "Tacita": segna come già suonati gli allarmi in corso.
  const silenceNow = () => {
    for (const a of soundable) silencedRef.current.add(a.def.id);
    setMuted(true);
  };
  // Quando non resta niente da suonare, il pulsante torna disponibile.
  useEffect(() => {
    if (soundable.every((a) => silencedRef.current.has(a.def.id))) return;
    setMuted(false);
  }, [soundable]);

  // Refresh shelved list when panel opens (skip entirely if shelve UI is disabled).
  useEffect(() => {
    if (!open || !showShelve) return;
    api.listShelved().then(setShelved).catch(() => {});
  }, [open, showShelve]);

  const handleAck = async (a: AlarmState) => {
    try {
      await api.ackAlarm(a.def.id, authUser ?? undefined);
      updateAlarm({
        ...a,
        isa_state: a.isa_state === "active_unacked" ? "active_acked" : "normal",
        acknowledged: true,
        ack_at_ms: Date.now(),
      });
    } catch { /* WS broadcast reconciles */ }
  };

  const handleAckAll = async () => {
    for (const a of unack) await handleAck(a);
  };

  const handleShelve = async (id: string) => {
    const ms = shelveHours > 0 ? shelveHours * 3_600_000 : 0;
    try {
      await api.shelveAlarm(id, shelveReason || t("viewer.maintenance"), ms, "operator");
      const updated = await api.listShelved();
      setShelved(updated);
      setShelveOpen(null);
      setShelveReason("");
    } catch { /* ignore */ }
  };

  const handleUnshelve = async (id: string) => {
    try {
      await api.unshelveAlarm(id);
      setShelved((prev) => prev.filter((s) => s.alarm_id !== id));
    } catch { /* ignore */ }
  };

  const shelvedIds = showShelve ? new Set(shelved.map((s) => s.alarm_id)) : new Set<string>();
  // Active = not shelved; shown in main list
  const visibleActive = active.filter((a) => !shelvedIds.has(a.def.id));
  const badgeColor = unack.filter((a) => !shelvedIds.has(a.def.id)).length > 0
    ? "var(--brand-danger, #ef4444)"
    : (visibleActive.length > 0 ? "var(--brand-warning, #eab308)" : "var(--brand-border, #475569)");

  const toggleOpen = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setAnchor({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((v) => !v);
  };

  const tabs = (["attivi", "storico"] as const).filter((pt) => pt !== "storico" || showHistory);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        title={visibleActive.length === 0 ? t("viewer.noActiveAlarms") : `${visibleActive.length} ${t("viewer.active")}`}
        style={{
          width: "100%", height: "100%", boxSizing: "border-box",
          background: badgeFill ?? "var(--brand-surface, #1e293b)",
          border: `1px solid ${badgeColor}`,
          color: "var(--brand-text, #e2e8f0)",
          borderRadius: 999,
          cursor: "pointer",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        }}
      >
        <span style={{ color: badgeColor, fontSize: 14 }}>🔔</span>
        <span>{t("viewer.alarms")}</span>
        {/* F7.5 — "tacita": compare solo quando c'è davvero qualcosa che sta
            suonando, così non è un comando inerte sempre presente. Vive dentro
            il pulsante campanella (stopPropagation: non apre il pannello). */}
        {sound && !mutedProp && soundable.length > 0 && (
          <span
            role="button"
            title={muted ? t("viewer.silenced") : t("viewer.silence")}
            onClick={(e) => { e.stopPropagation(); silenceNow(); }}
            style={{
              fontSize: 12, padding: "0 4px", borderRadius: 4, cursor: "pointer",
              background: muted ? "var(--brand-surface-2, #334155)" : "transparent",
              color: muted ? "var(--brand-text-subtle, #64748b)" : "var(--brand-text, #e2e8f0)",
            }}
          >
            {muted ? "🔕" : "🔊"}
          </span>
        )}
        {visibleActive.length > 0 && (
          <span style={{ background: badgeColor, color: "var(--brand-bg, #0f172a)", padding: "1px 7px", borderRadius: 10, fontWeight: 700, fontSize: 11 }}>
            {visibleActive.length}
          </span>
        )}
        {showShelve && shelved.length > 0 && (
          <span style={{ background: "var(--brand-border, #475569)", color: "var(--brand-text, #e2e8f0)", padding: "1px 6px", borderRadius: 10, fontSize: 11 }} title={t("viewer.suppressed")}>
            ⏸{shelved.length}
          </span>
        )}
      </button>

      {open && anchor && createPortal(
        <div style={{
          position: "fixed", top: anchor.top, left: anchor.left, width: 400, maxHeight: "75vh",
          background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
          overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "0 6px 20px rgba(0,0,0,0.5)", zIndex: 9000,
        }}>
          {/* Header with tabs */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 12px", borderBottom: "1px solid var(--brand-surface-2, #334155)",
            background: "var(--brand-surface, #1e293b)", fontSize: 12, color: "var(--brand-text-muted, #94a3b8)",
          }}>
            <div style={{ display: "flex", gap: 2 }}>
              {tabs.map((pt) => (
                <button
                  key={pt}
                  onClick={() => setPanelTab(pt)}
                  style={{
                    padding: "2px 10px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                    background: panelTab === pt ? "var(--brand-surface-2, #334155)" : "transparent",
                    border: "none",
                    color: panelTab === pt ? "var(--brand-text, #e2e8f0)" : "var(--brand-text-subtle, #64748b)",
                    textTransform: "capitalize",
                  }}
                >
                  {pt === "attivi" ? `${t("viewer.activeTab")} (${visibleActive.length})` : t("viewer.history")}
                </button>
              ))}
            </div>
            {panelTab === "attivi" && unack.filter(a => !shelvedIds.has(a.def.id)).length > 1 && (
              <button onClick={handleAckAll} style={{ background: "var(--brand-surface-2, #334155)", border: "none", color: "var(--brand-text, #e2e8f0)", padding: "2px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>
                ACK tutti
              </button>
            )}
          </div>

          {/* Storico tab */}
          {panelTab === "storico" && showHistory && (
            <div style={{ overflowY: "auto", flex: 1, padding: 12 }}>
              <AlarmHistory />
            </div>
          )}

          {/* Active alarms */}
          {panelTab === "attivi" && <div style={{ overflowY: "auto", flex: 1 }}>
            {visibleActive.length === 0 && shelved.length === 0 ? (
              <div style={{ padding: 16, color: "var(--brand-text-subtle, #64748b)", fontSize: 12, textAlign: "center" }}>Nessun allarme attivo.</div>
            ) : visibleActive.map((a) => {
              const color = SEV_COLOR[a.def.severity ?? "Warning"];
              const isShelving = shelveOpen === a.def.id;
              return (
                <div key={a.def.id} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", opacity: a.acknowledged ? 0.55 : 1 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "var(--brand-text, #e2e8f0)", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.def.id}</div>
                      <div style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resolveMsg(a.def.message ?? "", msgLang, langTable)}</div>
                    </div>
                    {/* Shelve button */}
                    {showShelve && (
                      <button
                        onClick={() => { setShelveOpen(isShelving ? null : a.def.id); setShelveReason(""); setShelveHours(8); }}
                        title={t("viewer.suppressForMaintenance")}
                        style={{ background: isShelving ? "var(--brand-warning-bg, #78350f)" : "transparent", border: `1px solid ${isShelving ? "#d97706" : "var(--brand-surface-2, #334155)"}`, color: "#d97706", padding: "2px 6px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                      >
                        🔧
                      </button>
                    )}
                    {/* ACK button */}
                    {a.acknowledged ? (
                      <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 10, fontStyle: "italic" }}>ACK</span>
                    ) : (
                      <button onClick={() => handleAck(a)} style={{ background: color, color: "var(--brand-bg, #0f172a)", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer", fontWeight: 600, fontSize: 11 }}>ACK</button>
                    )}
                  </div>
                  {/* Inline shelve form */}
                  {showShelve && isShelving && (
                    <div style={{ padding: "6px 12px 10px", background: "#1a1a2e", display: "flex", flexDirection: "column", gap: 6 }}>
                      <input
                        autoFocus
                        placeholder={t("viewer.reasonPlaceholder")}
                        value={shelveReason}
                        onChange={(e) => setShelveReason(e.target.value)}
                        style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", fontSize: 12, padding: "4px 8px" }}
                      />
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>Durata (h):</label>
                        <input
                          type="number" min={0} max={720} step={1}
                          value={shelveHours}
                          onChange={(e) => setShelveHours(parseInt(e.target.value) || 0)}
                          style={{ width: 55, background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", fontSize: 12, padding: "3px 6px", textAlign: "center" }}
                        />
                        <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>(0 = indefinito)</span>
                        <button
                          onClick={() => handleShelve(a.def.id)}
                          style={{ marginLeft: "auto", background: "#92400e", border: "none", color: "#fef3c7", padding: "3px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                        >
                          Sopprimi
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Shelved section */}
            {showShelve && shelved.length > 0 && (
              <>
                <div style={{ padding: "4px 12px", background: "var(--brand-surface, #1e293b)", fontSize: 10, color: "var(--brand-text-subtle, #64748b)", fontWeight: 700, letterSpacing: 0.5, borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
                  SOPPRESSI ({shelved.length})
                </div>
                {shelved.map((sh) => (
                  <div key={sh.alarm_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid var(--brand-surface, #1e293b)", opacity: 0.7 }}>
                    <span style={{ fontSize: 12 }}>⏸</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sh.alarm_id}</div>
                      <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 11 }}>
                        {sh.reason}
                        {sh.until_ms > 0 && ` · fino ${new Date(sh.until_ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`}
                        {sh.until_ms === 0 && " · indefinito"}
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnshelve(sh.alarm_id)}
                      title={t("viewer.reactivateAlarm")}
                      style={{ background: "transparent", border: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text-muted, #94a3b8)", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                    >
                      Riattiva
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>}
        </div>,
        document.body
      )}
    </>
  );
}
