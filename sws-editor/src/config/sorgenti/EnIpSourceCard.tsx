import { useState } from "react";
import { useTranslation } from "react-i18next";
import { genId } from "@/id";
import { tipoDaEnIp } from "@/tag/riconciliaTag";
import { TagInput } from "@/components/TagInput";
import type { EnIpDataType, EnIpSource, EnIpTagMapping, TagDef } from "@/types";
import { S } from "@/config/comuni";

// ── EtherNet/IP ───────────────────────────────────────────────────────────────

export function emptyEnIp(): EnIpSource {
  return {
    kind: "enip",
    id: `enip-${genId()}`,
    ip: "192.168.1.10",
    slot: 0,
    poll_interval_ms: 500,
    tags: [],
  };
}

function emptyEnIpTag(): EnIpTagMapping {
  return { tag: "", plc_tag: "", data_type: "real", writable: false };
}

export function EnIpSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: EnIpSource;
  onChange: (s: EnIpSource) => void;
  onDelete: () => void;
  onCreateTag: (t: TagDef) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  function upd(patch: Partial<EnIpSource>) { onChange({ ...source, ...patch }); }
  function updateTag(idx: number, patch: Partial<EnIpTagMapping>) {
    upd({ tags: source.tags.map((t, i) => i === idx ? { ...t, ...patch } : t) });
  }

  const headerRow = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}
      onClick={() => setCollapsed((c) => !c)}
    >
      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--brand-warning, #f59e0b)" }}>EtherNet/IP</span>
      <span style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
        {source.id} — {source.ip} slot {source.slot} ({source.tags.length} tag)
      </span>
      <span style={{ marginLeft: "auto", color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>{collapsed ? "▶" : "▼"}</span>
      <button style={S.btnXs} onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
    </div>
  );

  if (collapsed) return <div style={{ ...S.card, padding: "10px 16px" }}>{headerRow}</div>;

  const inp = (label: string, val: string | number, set: (v: string) => void, type = "text") => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>{label}</span>
      <input
        type={type} value={val} onChange={(e) => set(e.target.value)}
        style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: 120 }}
      />
    </label>
  );

  return (
    <div style={S.card}>
      {headerRow}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        {inp(t("cfgUi.sourceId"), source.id, (v) => upd({ id: v }))}
        {inp("IP PLC", source.ip, (v) => upd({ ip: v }))}
        {inp("Slot CIP", source.slot, (v) => upd({ slot: Number(v) }), "number")}
        {inp("Poll (ms)", source.poll_interval_ms, (v) => upd({ poll_interval_ms: Number(v) }), "number")}
      </div>
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", marginBottom: 8 }}>TAG ({source.tags.length})</div>
        {source.tags.map((tm, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
            <TagInput
              value={tm.tag} onChange={(v) => updateTag(idx, { tag: v })}
              placeholder={t("cfg.swsTagIdPh")}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 150 }}
            />
            <input
              value={tm.plc_tag} onChange={(e) => updateTag(idx, { plc_tag: e.target.value })}
              placeholder={t("cfg.plcTag")}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 180 }}
            />
            <select
              value={tm.data_type}
              onChange={(e) => updateTag(idx, { data_type: e.target.value as EnIpDataType })}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12 }}
            >
              <option value="real">REAL (f32)</option>
              <option value="dint">DINT (i32)</option>
              <option value="int">INT (i16)</option>
              <option value="lint">LINT (i64)</option>
              <option value="sint">SINT (i8)</option>
              <option value="bool">BOOL</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
              <input type="checkbox" checked={tm.writable} onChange={(e) => updateTag(idx, { writable: e.target.checked })} />
              Write
            </label>
            <button
              style={S.btnXs}
              onClick={() => { if (tm.tag) onCreateTag({ id: tm.tag, data_type: tipoDaEnIp(tm.data_type), description: "", history: false }); }}
              title={t("cfg.createTag")}
            >+var</button>
            <button style={S.btnXs} onClick={() => upd({ tags: source.tags.filter((_, i) => i !== idx) })}>✕</button>
          </div>
        ))}
        <button style={S.btn("ghost")} onClick={() => upd({ tags: [...source.tags, emptyEnIpTag()] })}>+ Tag</button>
      </div>
    </div>
  );
}
