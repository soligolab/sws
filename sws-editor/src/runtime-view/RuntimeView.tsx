import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { api } from "@/api/client";
import { getBrand } from "@/branding";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { AlarmHistory } from "@/components/AlarmHistory";
import { useAppStore } from "@/store";
import { useAlarmStream } from "@/ws/alarmStream";
import { useTagStream, tryTagWriteWs, sendSubscribe } from "@/ws/tagStream";
import type { AlarmSeverity, AlarmState, FunctionDef, RecipeSummary, ShelvedAlarm } from "@/types";

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
  background: "var(--brand-surface, #1e293b)",
  border: `1px solid ${hasError ? "#991b1b" : "var(--brand-surface-2, #334155)"}`,
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
              <span style={{ color: "var(--brand-text-muted, #94a3b8)", fontWeight: 700, fontSize: 11 }}>
                ⚡ {t.fn}
              </span>
              <button
                onClick={() => onClose(t.id)}
                style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 10 }}
              >
                ✕
              </button>
            </div>
            {t.stdout && <pre style={{ ...PRE, color: "var(--brand-text, #e2e8f0)" }}>{t.stdout.trimEnd()}</pre>}
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
  Info:     "var(--brand-primary, #3b82f6)",
  Warning:  "#eab308",
  Critical: "#ef4444",
};

function AlarmPanel() {
  useAlarmStream();

  const alarms = useAppStore((s) => s.alarms);
  const updateAlarm = useAppStore((s) => s.updateAlarm);
  const authUser = useAppStore((s) => s.authUser);
  const [open, setOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"attivi" | "storico">("attivi");
  const [shelved, setShelved] = useState<ShelvedAlarm[]>([]);
  // shelveOpen: id of alarm whose inline shelve-form is expanded, or null
  const [shelveOpen, setShelveOpen] = useState<string | null>(null);
  const [shelveReason, setShelveReason] = useState("");
  const [shelveHours, setShelveHours] = useState<number>(8);

  const { active, unack } = useMemo(() => {
    const list: AlarmState[] = Object.values(alarms);
    const active = list
      .filter((a) => a.active)
      .sort((a, b) => (b.activated_at_ms ?? 0) - (a.activated_at_ms ?? 0));
    const unack = active.filter((a) => !a.acknowledged);
    return { active, unack };
  }, [alarms]);

  // Refresh shelved list when panel opens.
  useEffect(() => {
    if (!open) return;
    api.listShelved().then(setShelved).catch(() => {});
  }, [open]);

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
      await api.shelveAlarm(id, shelveReason || "Manutenzione", ms, "operator");
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

  const shelvedIds = new Set(shelved.map((s) => s.alarm_id));
  // Active = not shelved; shown in main list
  const visibleActive = active.filter((a) => !shelvedIds.has(a.def.id));
  const badgeColor = unack.filter((a) => !shelvedIds.has(a.def.id)).length > 0
    ? "#ef4444"
    : (visibleActive.length > 0 ? "#eab308" : "var(--brand-border, #475569)");

  return (
    <div style={{ position: "fixed", top: 80, right: 16, zIndex: 7500, pointerEvents: "auto" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={visibleActive.length === 0 ? "Nessun allarme attivo" : `${visibleActive.length} attivi`}
        style={{
          background: "var(--brand-surface, #1e293b)",
          border: `1px solid ${badgeColor}`,
          color: "var(--brand-text, #e2e8f0)",
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
        {visibleActive.length > 0 && (
          <span style={{ background: badgeColor, color: "var(--brand-bg, #0f172a)", padding: "1px 7px", borderRadius: 10, fontWeight: 700, fontSize: 11 }}>
            {visibleActive.length}
          </span>
        )}
        {shelved.length > 0 && (
          <span style={{ background: "var(--brand-border, #475569)", color: "var(--brand-text, #e2e8f0)", padding: "1px 6px", borderRadius: 10, fontSize: 11 }} title="Soppresso">
            ⏸{shelved.length}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: 38, right: 0, width: 400, maxHeight: "75vh",
          background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
          overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
        }}>
          {/* Header with tabs */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 12px", borderBottom: "1px solid var(--brand-surface-2, #334155)",
            background: "var(--brand-surface, #1e293b)", fontSize: 12, color: "var(--brand-text-muted, #94a3b8)",
          }}>
            <div style={{ display: "flex", gap: 2 }}>
              {(["attivi", "storico"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setPanelTab(t)}
                  style={{
                    padding: "2px 10px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                    background: panelTab === t ? "var(--brand-surface-2, #334155)" : "transparent",
                    border: "none",
                    color: panelTab === t ? "var(--brand-text, #e2e8f0)" : "#64748b",
                    textTransform: "capitalize",
                  }}
                >
                  {t === "attivi" ? `Attivi (${visibleActive.length})` : "Storico"}
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
          {panelTab === "storico" && (
            <div style={{ overflowY: "auto", flex: 1, padding: 12 }}>
              <AlarmHistory />
            </div>
          )}

          {/* Active alarms */}
          {panelTab === "attivi" && <div style={{ overflowY: "auto", flex: 1 }}>
            {visibleActive.length === 0 && shelved.length === 0 ? (
              <div style={{ padding: 16, color: "#64748b", fontSize: 12, textAlign: "center" }}>Nessun allarme attivo.</div>
            ) : visibleActive.map((a) => {
              const color = SEV_COLOR[a.def.severity ?? "Warning"];
              const isShelving = shelveOpen === a.def.id;
              return (
                <div key={a.def.id} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", opacity: a.acknowledged ? 0.55 : 1 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "var(--brand-text, #e2e8f0)", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.def.id}</div>
                      <div style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.def.message}</div>
                    </div>
                    {/* Shelve button */}
                    <button
                      onClick={() => { setShelveOpen(isShelving ? null : a.def.id); setShelveReason(""); setShelveHours(8); }}
                      title="Sopprimi per manutenzione"
                      style={{ background: isShelving ? "#78350f" : "transparent", border: `1px solid ${isShelving ? "#d97706" : "var(--brand-surface-2, #334155)"}`, color: "#d97706", padding: "2px 6px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                    >
                      🔧
                    </button>
                    {/* ACK button */}
                    {a.acknowledged ? (
                      <span style={{ color: "#64748b", fontSize: 10, fontStyle: "italic" }}>ACK</span>
                    ) : (
                      <button onClick={() => handleAck(a)} style={{ background: color, color: "var(--brand-bg, #0f172a)", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer", fontWeight: 600, fontSize: 11 }}>ACK</button>
                    )}
                  </div>
                  {/* Inline shelve form */}
                  {isShelving && (
                    <div style={{ padding: "6px 12px 10px", background: "#1a1a2e", display: "flex", flexDirection: "column", gap: 6 }}>
                      <input
                        autoFocus
                        placeholder="Motivo (es. manutenzione programmata)"
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
                        <span style={{ fontSize: 11, color: "#64748b" }}>(0 = indefinito)</span>
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
            {shelved.length > 0 && (
              <>
                <div style={{ padding: "4px 12px", background: "var(--brand-surface, #1e293b)", fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 0.5, borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
                  SOPPRESSI ({shelved.length})
                </div>
                {shelved.map((sh) => (
                  <div key={sh.alarm_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid var(--brand-surface, #1e293b)", opacity: 0.7 }}>
                    <span style={{ fontSize: 12 }}>⏸</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sh.alarm_id}</div>
                      <div style={{ color: "#64748b", fontSize: 11 }}>
                        {sh.reason}
                        {sh.until_ms > 0 && ` · fino ${new Date(sh.until_ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`}
                        {sh.until_ms === 0 && " · indefinito"}
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnshelve(sh.alarm_id)}
                      title="Riattiva allarme"
                      style={{ background: "transparent", border: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text-muted, #94a3b8)", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                    >
                      Riattiva
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>}
        </div>
      )}
    </div>
  );
}

// ── RecipeModal ───────────────────────────────────────────────────────────────

function RecipeModal({ onClose, username }: { onClose: () => void; username: string }) {
  const [recipes, setRecipes]   = useState<RecipeSummary[]>([]);
  const [applying, setApplying] = useState<string | null>(null);
  const [result, setResult]     = useState<string>("");

  useEffect(() => {
    api.listRecipes().then(setRecipes).catch(() => setRecipes([]));
  }, []);

  const apply = useCallback(async (id: string) => {
    setApplying(id);
    setResult("");
    try {
      const r = await api.applyRecipe(id, username || "operator");
      setResult(`✓ ${r.applied}/${r.total} setpoint scritti` +
        (r.errors.length > 0 ? ` — Errori: ${r.errors.join(", ")}` : ""));
    } catch {
      setResult("Errore: impossibile applicare la ricetta.");
    } finally {
      setApplying(null);
    }
  }, [username]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
        padding: 24, minWidth: 380, maxWidth: 520, maxHeight: "80vh",
        overflowY: "auto", color: "var(--brand-text, #e2e8f0)",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Applica Ricetta</div>
        {recipes.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 13 }}>Nessuna ricetta disponibile.</div>
        ) : (
          recipes.map((r) => (
            <div key={r.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 0", borderBottom: "1px solid var(--brand-surface, #1e293b)",
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{r.id} · {r.setpoints_count} setpoint</div>
              </div>
              <button
                onClick={() => apply(r.id)}
                disabled={applying === r.id}
                style={{
                  padding: "4px 12px", borderRadius: 4, border: "none",
                  background: "#1d4ed8", color: "#fff", cursor: "pointer", fontSize: 12,
                  opacity: applying === r.id ? 0.6 : 1,
                }}
              >
                {applying === r.id ? "…" : "Applica"}
              </button>
            </div>
          ))
        )}
        {result && (
          <div style={{ marginTop: 12, fontSize: 12, color: result.startsWith("✓") ? "#22c55e" : "#ef4444" }}>
            {result}
          </div>
        )}
        <button onClick={onClose} style={{
          marginTop: 16, padding: "6px 16px", borderRadius: 4, border: "1px solid var(--brand-surface-2, #334155)",
          background: "transparent", color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer", fontSize: 12,
        }}>
          Chiudi
        </button>
      </div>
    </div>
  );
}

// ── RuntimeView ───────────────────────────────────────────────────────────────

export function RuntimeView() {
  const pages               = useAppStore((s) => s.pages);
  const currentPageId       = useAppStore((s) => s.currentPageId);
  const setCurrentPage      = useAppStore((s) => s.setCurrentPage);
  const tagValues           = useAppStore((s) => s.tagValues);
  const customSymbols       = useAppStore((s) => s.customSymbols);
  const faceplates          = useAppStore((s) => s.faceplates);
  const autoRotate          = useAppStore((s) => s.autoRotate);
  const autoRotateIntervalS = useAppStore((s) => s.autoRotateIntervalS);
  const setAutoRotate       = useAppStore((s) => s.setAutoRotate);
  const setAutoRotateIntervalS = useAppStore((s) => s.setAutoRotateIntervalS);

  const [toasts, setToasts]         = useState<ScriptToast[]>([]);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const username = useAppStore((s) => s.authUser) ?? "operator";

  // Kiosk auto-rotate: advance to the next non-skipped page on a fixed interval.
  useEffect(() => {
    if (!autoRotate) return;
    const rotatablePages = pages.filter((p) => !p.auto_rotate_skip);
    if (rotatablePages.length < 2) return;
    const id = setInterval(() => {
      const idx = rotatablePages.findIndex((p) => p.id === currentPageId);
      const next = rotatablePages[(idx + 1) % rotatablePages.length];
      setCurrentPage(next.id);
    }, autoRotateIntervalS * 1000);
    return () => clearInterval(id);
  }, [autoRotate, autoRotateIntervalS, pages, currentPageId, setCurrentPage]);

  useTagStream();

  // T-17: per-page subscription — tell the server which tags this page uses
  // so it sends delta frames only for those tags (bandwidth optimization).
  // When the page changes, re-subscribe to the new page's tags.
  const currentPage = pages.find((p) => p.id === currentPageId);
  const pageTagIds = useMemo(() => {
    const ids = new Set<string>();
    for (const obj of currentPage?.objects ?? []) {
      const o = obj as unknown as Record<string, unknown>;
      if (typeof o.tag === "string")       ids.add(o.tag);
      if (typeof o.value_tag === "string") ids.add(o.value_tag);
      if (typeof o.min_tag === "string")   ids.add(o.min_tag);
      if (typeof o.max_tag === "string")   ids.add(o.max_tag);
      // trend pens
      if (Array.isArray(o.pens)) {
        for (const pen of o.pens as unknown[]) {
          if (pen && typeof pen === "object" && "tag" in pen) ids.add(String((pen as Record<string, unknown>).tag));
        }
      }
    }
    return [...ids];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId, pages]);

  useEffect(() => {
    // Send subscribe. Empty array = all tags (no restriction).
    sendSubscribe(pageTagIds.length > 0 ? pageTagIds : []);
  }, [pageTagIds]);

  const addToast = (toast: ScriptToast, ttlMs: number) => {
    setToasts((ts) => [...ts, toast]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== toast.id)), ttlMs);
  };

  const closeToast = (id: string) => setToasts((ts) => ts.filter((t) => t.id !== id));

  const objects = currentPage?.objects ?? [];

  const handleWriteTag = (tagId: string, value: string | number | boolean) => {
    // Prefer the bidirectional WS path (zero HTTP round-trip + token reuse).
    // The HTTP PUT remains as the fallback when the socket isn't open
    // yet — first paint can race the upgrade handshake.
    if (tryTagWriteWs(tagId, value)) return;
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

  // T-19: touch swipe navigation between pages.
  const touchStartX = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 50) return; // threshold 50px
    const idx = pages.findIndex((p) => p.id === currentPageId);
    if (dx < 0 && idx < pages.length - 1) setCurrentPage(pages[idx + 1].id);
    if (dx > 0 && idx > 0) setCurrentPage(pages[idx - 1].id);
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Page navigation bar */}
      {pages.length > 1 && (
        <nav style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 8px",
          background: "var(--brand-bg, #0f172a)",
          borderBottom: "1px solid var(--brand-surface-2, #334155)",
          height: 36,
          flexShrink: 0,
          overflowX: "auto",
        }}>
          {getBrand().logoUrl && (
            <img
              src={getBrand().logoUrl!}
              alt={getBrand().name}
              title={getBrand().name}
              style={{ height: 20, width: "auto", marginRight: 8, flexShrink: 0 }}
            />
          )}
          <div style={{ flex: 1, display: "flex", gap: 2 }}>
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => { setAutoRotate(false); setCurrentPage(p.id); }}
              style={{
                padding: "4px 14px",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                opacity: p.auto_rotate_skip ? 0.5 : 1,
                fontSize: 13,
                fontWeight: p.id === currentPageId ? 700 : 400,
                background: p.id === currentPageId ? "var(--brand-primary, #3b82f6)" : "transparent",
                color: p.id === currentPageId ? "#fff" : "#64748b",
                whiteSpace: "nowrap",
              }}
            >
              {p.name}
            </button>
          ))}
          </div>
          {/* Auto-rotate controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8, flexShrink: 0 }}>
            <button
              onClick={() => setAutoRotate(!autoRotate)}
              title={autoRotate ? "Ferma rotazione automatica" : "Avvia rotazione automatica"}
              style={{
                padding: "2px 8px",
                border: `1px solid ${autoRotate ? "var(--brand-primary, #3b82f6)" : "var(--brand-surface-2, #334155)"}`,
                borderRadius: 4,
                background: autoRotate ? "#1d4ed8" : "transparent",
                color: autoRotate ? "#fff" : "#64748b",
                cursor: "pointer",
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              {autoRotate ? "⏹ Stop" : "▶ Ciclo"}
            </button>
            <input
              type="number"
              min={5}
              max={3600}
              value={autoRotateIntervalS}
              onChange={(e) => setAutoRotateIntervalS(Math.max(5, parseInt(e.target.value) || 30))}
              title="Intervallo rotazione (secondi)"
              style={{
                width: 44,
                padding: "2px 4px",
                background: "var(--brand-surface, #1e293b)",
                border: "1px solid var(--brand-surface-2, #334155)",
                borderRadius: 4,
                color: "var(--brand-text-muted, #94a3b8)",
                fontSize: 12,
                textAlign: "center",
              }}
            />
            <span style={{ color: "var(--brand-border, #475569)", fontSize: 11 }}>s</span>
          </div>
          {/* Recipe apply button */}
          <button
            onClick={() => setRecipeOpen(true)}
            title="Applica ricetta"
            style={{
              marginLeft: 8,
              padding: "2px 8px",
              border: "1px solid var(--brand-surface-2, #334155)",
              borderRadius: 4,
              background: "transparent",
              color: "#64748b",
              cursor: "pointer",
              fontSize: 12,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ⚗ Ricette
          </button>
        </nav>
      )}

      {/* Canvas */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <SvgCanvas
          objects={objects}
          tagValues={tagValues}
          background={currentPage?.background}
          customSymbols={customSymbols}
          faceplates={faceplates}
          pageWidth={currentPage?.width}
          pageHeight={currentPage?.height}
          onWriteTag={handleWriteTag}
          onScript={handleScript}
          onNavigate={setCurrentPage}
        />
      </div>

      {/* Alarm panel (top-right floating, dropdown with per-row ACK) */}
      <AlarmPanel />

      {/* Function test panel (bottom-left floating — operator picks a
          project function, edits parameter overrides, runs ad-hoc). */}
      <FunctionTestPanel onRun={handleScript} />

      {/* Script output toasts (bottom-right, auto-dismiss) */}
      <ScriptToasts toasts={toasts} onClose={closeToast} />

      {/* Recipe apply modal */}
      {recipeOpen && (
        <RecipeModal onClose={() => setRecipeOpen(false)} username={username} />
      )}
    </div>
  );
}

// ── Function test panel ──────────────────────────────────────────────────────
//
// Floating button at the bottom-left expands into a small dialog listing every
// project function. The operator picks one, optionally overrides its
// declared parameter defaults, and clicks Run. The same `onRun` handler used
// by canvas `on_press_fn` dispatches the call, so output appears in the
// existing toast surface and the runtime metrics counter increments.

function FunctionTestPanel({
  onRun,
}: {
  onRun: (fn: string, args: Record<string, string | number | boolean>) => void;
}) {
  const project = useAppStore((s) => s.project);
  const functions: FunctionDef[] = project?.functions ?? [];
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Per-function arg overrides, keyed by function id. Persists across opens
  // within the same session so the operator can iterate without retyping.
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({});

  if (functions.length === 0) return null; // nothing to test

  const selected = functions.find((f) => f.id === selectedId) ?? functions[0];
  const currentOverrides = overrides[selected.id] ?? {};

  const setArg = (paramName: string, raw: string) => {
    setOverrides((prev) => ({
      ...prev,
      [selected.id]: { ...(prev[selected.id] ?? {}), [paramName]: raw },
    }));
  };

  // Coerce string overrides back to the declared types via the param default
  // (bool/number/string). Empty string falls back to the declared default.
  const coerce = (raw: string, def: string | number | boolean | undefined): string | number | boolean => {
    if (raw === "" && def !== undefined) return def;
    if (typeof def === "boolean") return raw === "true" || raw === "1" || raw === "on";
    if (typeof def === "number")  {
      const n = Number(raw);
      return Number.isFinite(n) ? n : def;
    }
    return raw;
  };

  const handleRun = () => {
    const args: Record<string, string | number | boolean> = {};
    for (const p of selected.params) {
      const raw = currentOverrides[p.name] ?? "";
      args[p.name] = coerce(raw, p.default);
    }
    onRun(selected.name, args);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title={`Test funzioni (${functions.length} disponibili)`}
        style={{
          position: "fixed", bottom: 16, left: 16, zIndex: 8000,
          width: 40, height: 40, borderRadius: "50%",
          background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)",
          color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer", fontSize: 18,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
      >
        🧪
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed", bottom: 16, left: 16, zIndex: 8000,
        background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
        padding: "12px 14px", minWidth: 320, maxWidth: 420,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>🧪 Test funzioni</span>
        <button
          onClick={() => setOpen(false)}
          style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14 }}
        >×</button>
      </div>
      <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4 }}>
        Funzione
      </label>
      <select
        value={selected.id}
        onChange={(e) => setSelectedId(e.target.value)}
        style={{
          width: "100%", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
          border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "4px 6px",
          fontSize: 12, marginBottom: 8,
        }}
      >
        {functions.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
      {selected.description && (
        <div style={{ fontSize: 11, color: "#64748b", fontStyle: "italic", marginBottom: 8 }}>
          {selected.description}
        </div>
      )}
      {selected.params.length === 0 ? (
        <div style={{ fontSize: 11, color: "#64748b", padding: "4px 0", fontStyle: "italic" }}>
          Nessun parametro definito.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {selected.params.map((p) => {
            const raw = currentOverrides[p.name] ?? "";
            const placeholder = p.default !== undefined ? String(p.default) : "(nessun default)";
            return (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", minWidth: 90,
                  fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </span>
                <input
                  type="text"
                  value={raw}
                  placeholder={placeholder}
                  onChange={(e) => setArg(p.name, e.target.value)}
                  style={{
                    flex: 1, background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
                    border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, padding: "2px 6px",
                    fontSize: 11, fontFamily: "monospace",
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
      <button
        onClick={handleRun}
        style={{
          width: "100%", background: "#16a34a", color: "#f0fdf4",
          border: "none", borderRadius: 4, padding: "6px 0",
          cursor: "pointer", fontSize: 12, fontWeight: 600,
        }}
      >
        ▶ Esegui {selected.name}
      </button>
    </div>
  );
}
