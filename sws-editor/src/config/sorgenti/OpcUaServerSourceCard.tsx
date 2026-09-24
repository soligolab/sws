import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QuickCreateTagModal } from "@/components/QuickCreateTagModal";
import { TagInput } from "@/components/TagInput";
import type { OpcUaServerNodeMapping, OpcUaServerSource, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { emptyOpcUaServerNode } from "@/config/sorgenti/vuote";

// ── OPC-UA server card ───────────────────────────────────────────────────────

export function OpcUaServerSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: OpcUaServerSource;
  onChange: (s: OpcUaServerSource) => void;
  onDelete: () => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);

  const setField = <K extends keyof OpcUaServerSource>(k: K, v: OpcUaServerSource[K]) =>
    onChange({ ...source, [k]: v });

  const setNode = (idx: number, patch: Partial<OpcUaServerNodeMapping>) =>
    onChange({ ...source, nodes: source.nodes.map((n, i) => (i === idx ? { ...n, ...patch } : n)) });

  const addNode = () =>
    onChange({ ...source, nodes: [...source.nodes, emptyOpcUaServerNode()] });

  const removeNode = (idx: number) =>
    onChange({ ...source, nodes: source.nodes.filter((_, i) => i !== idx) });

  return (
    <div style={S.card}>
      <div style={S.cardHead} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#8b5cf6", fontWeight: 700, letterSpacing: 1 }}>
            OPC-UA SERVER
          </span>
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{source.id}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>
            :{source.port} — {source.nodes.length} nodi
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={S.btn("danger")}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            {t("cfgUi.delete")}
          </button>
          <span style={{ color: "var(--brand-text-subtle, #94a3b8)", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.sourceId")}</label>
              <input style={S.input} value={source.id}
                onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.tcpPort")}</label>
              <input style={S.input} type="number" min={1} max={65535}
                value={source.port}
                onChange={(e) => setField("port", Number(e.target.value))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.namespaceUri")}</label>
              <input style={S.input} value={source.namespace_uri}
                onChange={(e) => setField("namespace_uri", e.target.value)} spellCheck={false} />
            </div>
          </div>

          <div style={{ marginBottom: 6, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
            NODI ESPOSTI
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "45%" }}>{t("cfg.variableTagId")}</th>
                <th style={{ ...S.th, width: "45%" }}>{t("cfg.opcuaNodeIdOpt")}</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.nodes.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ ...S.td, color: "var(--brand-text-subtle, #94a3b8)", textAlign: "center", padding: 12 }}>
                    {t("cfgUi.noNodesAddAMapping")}
                  </td>
                </tr>
              )}
              {source.nodes.map((n, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)33" }}>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <TagInput style={S.inputSm} placeholder="pump1.speed"
                        value={n.tag} onChange={(v) => setNode(i, { tag: v })} />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }}
                        title={t("cfg.createTag")}
                        onClick={() => setQuickCreate({ rowIdx: i, prefill: n.tag })}
                      >＋</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} placeholder={n.tag || "uguale al tag"}
                      value={n.node_id ?? ""}
                      onChange={(e) => setNode(i, { node_id: e.target.value || undefined })}
                      spellCheck={false} />
                  </td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <button style={S.btn("danger")} onClick={() => removeNode(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={S.btn("ghost")} onClick={addNode}>{t("cfgUi.addNode")}</button>
        </div>
      )}
      {quickCreate !== null && (
        <QuickCreateTagModal
          initialId={quickCreate.prefill}
          onConfirm={(tag) => {
            onCreateTag(tag);
            setNode(quickCreate.rowIdx, { tag: tag.id });
          }}
          onClose={() => setQuickCreate(null)}
        />
      )}
    </div>
  );
}
