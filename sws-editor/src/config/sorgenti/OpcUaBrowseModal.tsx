import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { OpcUaBrowsedNode, OpcUaSource } from "@/types";
import { S } from "@/config/comuni";

// ── OPC-UA browse modal ──────────────────────────────────────────────────────
//
// Tree view of the server's address space. Each "Object" folder is
// expandable on click — we lazy-load one level at a time so the payload
// stays small and the server doesn't have to fan out the whole namespace.
// "Variable" leaves are selectable via checkbox; "Method" rows are
// rendered but disabled (writes-to-method not in scope).

export function OpcUaBrowseModal({
  source, existingNodeIds, onClose, onImport,
}: {
  source: OpcUaSource;
  existingNodeIds: Set<string>;
  onClose: () => void;
  onImport: (picked: OpcUaBrowsedNode[]) => void;
}) {
  const { t } = useTranslation();
  // children[parentNodeId | "@root"] = level returned by browse_one_level
  const [children, setChildren] = useState<Record<string, OpcUaBrowsedNode[]>>({});
  // expanded folder keys; "@root" is always logically expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["@root"]));
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Selected variable rows (keyed by NodeId).
  const [picked, setPicked] = useState<Map<string, OpcUaBrowsedNode>>(new Map());

  const loadLevel = async (parentNodeId: string | null) => {
    const key = parentNodeId ?? "@root";
    if (children[key]) return; // cached
    setError(null);
    setBusy((prev) => new Set(prev).add(key));
    try {
      const res = await api.browseOpcUa({
        endpoint_url: source.endpoint_url,
        source_id: source.id,
        auth: source.auth,
        parent_node_id: parentNodeId ?? undefined,
      });
      setChildren((prev) => ({ ...prev, [key]: res.nodes }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  useEffect(() => { loadLevel(null); }, []);

  const toggleExpand = (n: OpcUaBrowsedNode) => {
    if (n.node_class === "Variable" || n.node_class === "Method") return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(n.node_id)) {
        next.delete(n.node_id);
      } else {
        next.add(n.node_id);
        if (!children[n.node_id]) {
          loadLevel(n.node_id);
        }
      }
      return next;
    });
  };

  const togglePick = (n: OpcUaBrowsedNode) => {
    if (n.node_class !== "Variable") return;
    if (existingNodeIds.has(n.node_id)) return; // already imported
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(n.node_id)) next.delete(n.node_id);
      else next.set(n.node_id, n);
      return next;
    });
  };

  const renderLevel = (parentKey: string, depth: number): React.ReactNode => {
    const lvl = children[parentKey];
    const loading = busy.has(parentKey);
    if (!lvl && loading) {
      return (
        <div style={{ paddingLeft: depth * 16 + 28, color: "var(--brand-text-subtle, #64748b)", fontSize: 11, fontStyle: "italic" }}>
          {t("cfgUi.loading")}
        </div>
      );
    }
    if (!lvl) return null;
    if (lvl.length === 0) {
      return (
        <div style={{ paddingLeft: depth * 16 + 28, color: "var(--brand-text-subtle, #64748b)", fontSize: 11, fontStyle: "italic" }}>
          {t("cfgUi.empty")}
        </div>
      );
    }
    return lvl.map((n) => {
      const isFolder = n.node_class === "Object" || n.node_class === "View";
      const isVariable = n.node_class === "Variable";
      const isExpanded = expanded.has(n.node_id);
      const isPicked = picked.has(n.node_id);
      const isImported = existingNodeIds.has(n.node_id);
      const icon = isFolder ? "📁" : isVariable ? "📊" : n.node_class === "Method" ? "⚙" : "·";
      const labelColor = isVariable
        ? (isImported ? "var(--brand-border, #475569)" : isPicked ? "#5eead4" : "var(--brand-text-2, #cbd5e1)")
        : isFolder ? "var(--brand-warning-soft, #facc15)"
        : "var(--brand-text-subtle, #64748b)";
      return (
        <div key={n.node_id}>
          <div
            onClick={() => isFolder ? toggleExpand(n) : togglePick(n)}
            style={{
              paddingLeft: depth * 16 + 8,
              paddingTop: 3, paddingBottom: 3,
              display: "flex", alignItems: "center", gap: 6,
              cursor: isFolder ? "pointer" : isVariable ? (isImported ? "not-allowed" : "pointer") : "default",
              background: isPicked ? "#0f2922" : "transparent",
              fontSize: 12, color: labelColor,
            }}
            title={isImported ? t("cfgUi.alreadyImported") : n.node_id}
          >
            {isFolder ? (
              <span style={{ width: 12, color: "var(--brand-text-subtle, #64748b)" }}>{isExpanded ? "▼" : "▶"}</span>
            ) : isVariable ? (
              <input
                type="checkbox"
                checked={isPicked}
                disabled={isImported}
                onChange={() => togglePick(n)}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 12, height: 12 }}
              />
            ) : (
              <span style={{ width: 12 }} />
            )}
            <span>{icon}</span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {n.display_name || n.browse_name || n.node_id}
            </span>
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--brand-text-subtle, #94a3b8)" }}>
              {n.node_id}
            </span>
          </div>
          {isFolder && isExpanded && renderLevel(n.node_id, depth + 1)}
        </div>
      );
    });
  };

  const pickedList = Array.from(picked.values());

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
          width: 720, maxHeight: "80vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--brand-surface, #1e293b)",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Sfoglia server OPC-UA</div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>{source.endpoint_url}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        {error && (
          <div style={{ background: "var(--brand-danger-bg, #7f1d1d)", color: "#fecaca", padding: "8px 14px", fontSize: 12 }}>
            {error}
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", background: "#0a111e" }}>
          {renderLevel("@root", 0)}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--brand-surface, #1e293b)",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, color: pickedList.length > 0 ? "#5eead4" : "var(--brand-text-subtle, #64748b)" }}>
            {pickedList.length === 0
              ? t("cfgUi.expandAnObjectAndSelect")
              : `${pickedList.length} nod${pickedList.length === 1 ? "o" : "i"} selezionat${pickedList.length === 1 ? "o" : "i"}.`}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.btn("ghost")} onClick={onClose}>{t("common.cancel")}</button>
            <button
              style={S.btn("primary")}
              disabled={pickedList.length === 0}
              onClick={() => onImport(pickedList)}
            >
              Importa {pickedList.length > 0 ? `(${pickedList.length})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
