import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { useAppStore } from "@/store";
import { useAlarmStream } from "@/ws/alarmStream";
import { useTagStream } from "@/ws/tagStream";
import type { AlarmSeverity, AlarmState } from "@/types";

// ── Script output toast ───────────────────────────────────────────────────────

type ScriptToast = {
  id: string;
  fn: string;
  stdout?: string;
  stderr?: string;
  error?: string;
};

const TOAST_PANEL: React.CSSProperties = {
  position: "fixed",
  bottom: 16,
  right: 16,
  display: "flex",
  flexDirection: "column-reverse",
  gap: 8,
  zIndex: 8000,
  maxWidth: 380,
  pointerEvents: "none",
};

const TOAST_CARD = (hasError: boolean): React.CSSProperties => ({
  background: "#1e293b",
  border: `1px solid ${hasError ? "#991b1b" : "#334155"}`,
  borderRadius: 8,
  padding: "10px 14px",
  boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
  fontSize: 12,
  pointerEvents: "auto",
});

const PRE: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 120,
  overflowY: "auto",
  fontFamily: "monospace",
  fontSize: 11,
};

function ScriptToasts({ toasts, onClose }: { toasts: ScriptToast[]; onClose: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div style={TOAST_PANEL}>
      {toasts.slice(-4).map((t) => {
        const hasError = !!(t.error || t.stderr);
        return (
          <div key={t.id} style={TOAST_CARD(hasError)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 11 }}>
                ⚡ {t.fn}
              </span>
              <button
                onClick={() => onClose(t.id)}
                style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 10 }}
              >
                ✕
              </button>
            </div>
            {t.stdout && <pre style={{ ...PRE, color: "#e2e8f0" }}>{t.stdout.trimEnd()}</pre>}
            {t.stderr && <pre style={{ ...PRE, color: "#fbbf24", marginTop: t.stdout ? 4 : 0 }}>{t.stderr.trimEnd()}</pre>}
            {t.error  && <pre style={{ ...PRE, color: "#fca5a5", marginTop: (t.stdout || t.stderr) ? 4 : 0 }}>{t.error.trimEnd()}</pre>}
          </div>
        );
      })}
    </div>
  );
}

// ── Alarm panel (operator ACK) ───────────────────────────────────────────────
//
// Floating top-right panel listing active alarms with per-row ACK. The
// app-level AlarmBanner already surfaces the most-recent unacked one;
// this panel exposes the full list so operators can ACK them out of
// order or review acknowledged-but-still-active conditions.

const SEV_COLOR: Record<AlarmSeverity, string> = {
  Info:     "#3b82f6",
  Warning:  "#eab308",
  Critical: "#ef4444",
};

function AlarmPanel() {
  // Subscribe to the live stream so the list updates without a manual reload.
  // Cheap: the WS is a singleton shared with AlarmBanner.
  useAlarmStream();

  const alarms = useAppStore((s) => s.alarms);
  const updateAlarm = useAppStore((s) => s.updateAlarm);
  const [open, setOpen] = useState(false);

  const { active, unack } = useMemo(() => {
    const list: AlarmState[] = Object.values(alarms);
    const active = list
      .filter((a) => a.active)
      .sort((a, b) => (b.activated_at_ms ?? 0) - (a.activated_at_ms ?? 0));
    const unack = active.filter((a) => !a.acknowledged);
    return { active, unack };
  }, [alarms]);

  const handleAck = async (a: AlarmState) => {
    try {
      await api.ackAlarm(a.def.id);
      updateAlarm({ ...a, acknowledged: true, ack_at_ms: Date.now() });
    } catch {
      // Next WS broadcast (or the snapshot refetch in the hook) will reconcile.
    }
  };

  const handleAckAll = async () => {
    // Sequential — the runtime ACKs are idempotent and the list is short.
    for (const a of unack) await handleAck(a);
  };

  const badgeColor = unack.length > 0 ? "#ef4444" : (active.length > 0 ? "#eab308" : "#475569");

  return (
    <div style={{ position: "fixed", top: 80, right: 16, zIndex: 7500, pointerEvents: "auto" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={active.length === 0 ? "Nessun allarme attivo" : `${active.length} attivi${unack.length > 0 ? ` (${unack.length} non confermati)` : ""}`}
        style={{
          background: "#1e293b",
          border: `1px solid ${badgeColor}`,
          color: "#e2e8f0",
          padding: "6px 12px",
          borderRadius: 999,
          cursor: "pointer",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        }}
      >
        <span style={{ color: badgeColor, fontSize: 14 }}>🔔</span>
        <span>Allarmi</span>
        {active.length > 0 && (
          <span style={{
            background: badgeColor, color: "#0f172a",
            padding: "1px 7px", borderRadius: 10, fontWeight: 700, fontSize: 11,
          }}>
            {active.length}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: 38, right: 0,
          width: 380, maxHeight: "70vh",
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 8,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", borderBottom: "1px solid #334155",
            background: "#1e293b", fontSize: 12, color: "#94a3b8",
          }}>
            <span>
              {active.length} attivi{unack.length > 0 ? ` · ${unack.length} non conf.` : ""}
            </span>
            {unack.length > 1 && (
              <button
                onClick={handleAckAll}
                style={{
                  background: "#334155", border: "none", color: "#e2e8f0",
                  padding: "2px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11,
                }}
              >
                ACK tutti
              </button>
            )}
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {active.length === 0 ? (
              <div style={{ padding: 16, color: "#64748b", fontSize: 12, textAlign: "center" }}>
                Nessun allarme attivo.
              </div>
            ) : active.map((a) => {
              const color = SEV_COLOR[a.def.severity ?? "Warning"];
              return (
                <div key={a.def.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", borderBottom: "1px solid #1e293b",
                  opacity: a.acknowledged ? 0.55 : 1,
                }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: color, flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.def.id}
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.def.message}
                    </div>
                  </div>
                  {a.acknowledged ? (
                    <span style={{ color: "#64748b", fontSize: 10, fontStyle: "italic" }}>ACK</span>
                  ) : (
                    <button
                      onClick={() => handleAck(a)}
                      style={{
                        background: color, color: "#0f172a", border: "none",
                        borderRadius: 4, padding: "2px 10px", cursor: "pointer",
                        fontWeight: 600, fontSize: 11,
                      }}
                    >
                      ACK
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── RuntimeView ───────────────────────────────────────────────────────────────

export function RuntimeView() {
  const pages          = useAppStore((s) => s.pages);
  const currentPageId  = useAppStore((s) => s.currentPageId);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const tagValues      = useAppStore((s) => s.tagValues);
  const customSymbols  = useAppStore((s) => s.customSymbols);

  const [toasts, setToasts] = useState<ScriptToast[]>([]);

  useTagStream();

  const addToast = (toast: ScriptToast, ttlMs: number) => {
    setToasts((ts) => [...ts, toast]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== toast.id)), ttlMs);
  };

  const closeToast = (id: string) => setToasts((ts) => ts.filter((t) => t.id !== id));

  const currentPage = pages.find((p) => p.id === currentPageId);
  const objects     = currentPage?.objects ?? [];

  const handleWriteTag = (tagId: string, value: string | number | boolean) => {
    api.writeTag(tagId, value).catch(console.error);
  };

  const handleScript = (fn: string, args: Record<string, string | number | boolean>) => {
    api.runFunction(fn, args).then((r) => {
      if (r.stdout) console.log(`[${fn} stdout]`, r.stdout.trimEnd());
      if (r.stderr) console.warn(`[${fn} stderr]`, r.stderr.trimEnd());
      if (!r.ok && r.error) console.warn(`[${fn}]`, r.error);

      const hasOutput = r.stdout || r.stderr || (!r.ok && r.error);
      if (hasOutput) {
        addToast(
          {
            id: `${Date.now()}-${Math.random()}`,
            fn,
            stdout: r.stdout || undefined,
            stderr: r.stderr || undefined,
            error: !r.ok ? (r.error || undefined) : undefined,
          },
          r.ok ? 5000 : 10_000,
        );
      }
    }).catch((e: any) => {
      console.error(`[${fn}]`, e);
      addToast({ id: `${Date.now()}-${Math.random()}`, fn, error: String(e?.message ?? e) }, 10_000);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Page navigation bar */}
      {pages.length > 1 && (
        <nav style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 8px",
          background: "#0f172a",
          borderBottom: "1px solid #334155",
          height: 36,
          flexShrink: 0,
          overflowX: "auto",
        }}>
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => setCurrentPage(p.id)}
              style={{
                padding: "4px 14px",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: p.id === currentPageId ? 700 : 400,
                background: p.id === currentPageId ? "#3b82f6" : "transparent",
                color: p.id === currentPageId ? "#fff" : "#64748b",
                whiteSpace: "nowrap",
              }}
            >
              {p.name}
            </button>
          ))}
        </nav>
      )}

      {/* Canvas */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <SvgCanvas
          objects={objects}
          tagValues={tagValues}
          background={currentPage?.background}
          customSymbols={customSymbols}
          pageWidth={currentPage?.width}
          pageHeight={currentPage?.height}
          onWriteTag={handleWriteTag}
          onScript={handleScript}
          onNavigate={setCurrentPage}
        />
      </div>

      {/* Alarm panel (top-right floating, dropdown with per-row ACK) */}
      <AlarmPanel />

      {/* Script output toasts (bottom-right, auto-dismiss) */}
      <ScriptToasts toasts={toasts} onClose={closeToast} />
    </div>
  );
}
