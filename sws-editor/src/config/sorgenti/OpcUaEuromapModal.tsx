import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { OpcUaEuromapVariable, OpcUaSource, TagDef } from "@/types";
import { S } from "@/config/comuni";

// ── OPC-UA Euromap auto-detect modal (BL-005b) ──────────────────────────────
//
// Walks the server address space looking for Variable nodes whose
// browse_name matches a known Euromap 77 (injection moulding) or 83
// (temperature control unit) variable. Match list is server-side. UI:
// run-scan → table with checkbox per match → import.

export function OpcUaEuromapModal({
  source, existingNodeIds, onClose, onCreateTag, onImport,
}: {
  source: OpcUaSource;
  existingNodeIds: Set<string>;
  onClose: () => void;
  onCreateTag: (tag: TagDef) => void;
  onImport: (picked: OpcUaEuromapVariable[], autoCreateTags: boolean) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    nodes_scanned: number;
    truncated: boolean;
    variables: OpcUaEuromapVariable[];
  } | null>(null);
  // Default = every match selected. Operator deselects what they don't want.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [autoCreateTags, setAutoCreateTags] = useState(true);
  // Kept for a future "create tag immediately" affordance per row.
  void onCreateTag;

  const runScan = async () => {
    setBusy(true);
    setError(null);
    try {
      const det = await api.detectOpcUaEuromap({
        endpoint_url: source.endpoint_url,
        source_id: source.id,
        auth: source.auth,
        security_policy: source.security_policy,
      });
      setResult(det);
      // Pre-select every match that isn't already imported.
      setPicked(new Set(
        det.variables
          .filter((v) => !existingNodeIds.has(v.node_id))
          .map((v) => v.node_id),
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { runScan(); }, []);

  const togglePick = (nodeId: string) => {
    if (existingNodeIds.has(nodeId)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const pickedVariables = result
    ? result.variables.filter((v) => picked.has(v.node_id))
    : [];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
          width: 760, maxHeight: "85vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--brand-surface, #1e293b)",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              🤖 Auto-detect Euromap 77 / 83
            </div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>
              {source.endpoint_url}
              {result && (
                <> · {result.nodes_scanned} nodi scansionati
                  {result.truncated && " (limite raggiunto)"}</>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        {error && (
          <div style={{ background: "var(--brand-danger-bg, #7f1d1d)", color: "#fecaca", padding: "8px 14px", fontSize: 12 }}>
            {error}
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", background: "#0a111e" }}>
          {busy && (
            <div style={{ padding: "24px 18px", color: "var(--brand-text-muted, #94a3b8)", fontSize: 13 }}>
              Scansione address space in corso (max ~500 nodi)…
            </div>
          )}
          {!busy && result && result.variables.length === 0 && (
            <div style={{ padding: "24px 18px", color: "var(--brand-text-subtle, #64748b)", fontSize: 13, fontStyle: "italic" }}>
              {t("cfgUi.noEuromap7783Variables")}
            </div>
          )}
          {!busy && result && result.variables.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--brand-bg, #0f172a)", borderBottom: "1px solid var(--brand-surface, #1e293b)", textAlign: "left" }}>
                  <th style={{ padding: "8px 12px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600, width: 24 }}></th>
                  <th style={{ padding: "8px 12px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600, width: 40 }}>{t("cfg.spec")}</th>
                  <th style={{ padding: "8px 12px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.variable")}</th>
                  <th style={{ padding: "8px 12px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.suggestedTag")}</th>
                  <th style={{ padding: "8px 12px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.nodeId")}</th>
                </tr>
              </thead>
              <tbody>
                {result.variables.map((v) => {
                  const imported = existingNodeIds.has(v.node_id);
                  const checked = picked.has(v.node_id);
                  return (
                    <tr
                      key={v.node_id}
                      onClick={() => togglePick(v.node_id)}
                      style={{
                        borderBottom: "1px solid var(--brand-surface, #1e293b)",
                        cursor: imported ? "not-allowed" : "pointer",
                        background: checked ? "#0f2922" : "transparent",
                        color: imported ? "var(--brand-text-subtle, #94a3b8)" : "var(--brand-text-2, #cbd5e1)",
                      }}
                    >
                      <td style={{ padding: "6px 12px" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={imported}
                          onChange={() => togglePick(v.node_id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: 14, height: 14 }}
                        />
                      </td>
                      <td style={{ padding: "6px 12px",
                        fontFamily: "monospace", color: v.spec === "77" ? "var(--brand-warning-soft, #fbbf24)" : "#a78bfa" }}>
                        {v.spec}
                      </td>
                      <td style={{ padding: "6px 12px" }}>
                        <div style={{ fontWeight: 600 }}>{v.canonical_name}</div>
                        <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)" }}>{v.description}</div>
                      </td>
                      <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#5eead4" }}>
                        {source.id}.{v.suggested_tag_suffix}
                      </td>
                      <td style={{ padding: "6px 12px", fontFamily: "monospace",
                        fontSize: 10, color: "var(--brand-text-subtle, #64748b)" }}>
                        {v.node_id}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--brand-surface, #1e293b)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
            <input
              type="checkbox"
              checked={autoCreateTags}
              onChange={(e) => setAutoCreateTags(e.target.checked)}
            />
            Crea automaticamente i tag SWS suggeriti
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.btn("ghost")} onClick={runScan} disabled={busy}>
              {busy ? "Scansione…" : "↻ Riprova"}
            </button>
            <button style={S.btn("ghost")} onClick={onClose}>{t("common.cancel")}</button>
            <button
              style={S.btn("primary")}
              disabled={pickedVariables.length === 0}
              onClick={() => onImport(pickedVariables, autoCreateTags)}
            >
              Importa {pickedVariables.length > 0 ? `(${pickedVariables.length})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
