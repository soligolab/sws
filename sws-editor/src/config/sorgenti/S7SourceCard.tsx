import { useState } from "react";
import { useTranslation } from "react-i18next";
import { tipoDaS7 } from "@/tag/riconciliaTag";
import { TagInput } from "@/components/TagInput";
import type { S7DataType, S7Source, S7TagMapping, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { emptyS7Tag } from "@/config/sorgenti/vuote";

// ── S7SourceCard ──────────────────────────────────────────────────────────────

export function S7SourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: S7Source;
  onChange: (s: S7Source) => void;
  onDelete: () => void;
  onCreateTag: (t: TagDef) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  function upd(patch: Partial<S7Source>) {
    onChange({ ...source, ...patch });
  }

  function updateTag(idx: number, patch: Partial<S7TagMapping>) {
    const tags = source.tags.map((t, i) => i === idx ? { ...t, ...patch } : t);
    upd({ tags });
  }

  function addTag() {
    upd({ tags: [...source.tags, emptyS7Tag()] });
  }

  function removeTag(idx: number) {
    upd({ tags: source.tags.filter((_, i) => i !== idx) });
  }

  const headerRow = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}
      onClick={() => setCollapsed((c) => !c)}
    >
      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--brand-primary, #3b82f6)" }}>S7</span>
      <span style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
        {source.id} — {source.ip} R{source.rack}/S{source.slot}
        ({source.tags.length} tag)
      </span>
      <span style={{ marginLeft: "auto", color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>{collapsed ? "▶" : "▼"}</span>
      <button style={S.btnXs} onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
    </div>
  );

  if (collapsed) {
    return <div style={{ ...S.card, padding: "10px 16px" }}>{headerRow}</div>;
  }

  const inp = (label: string, val: string | number, set: (v: string) => void, type = "text") => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>{label}</span>
      <input
        type={type}
        value={val}
        onChange={(e) => set(e.target.value)}
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
        {inp("Rack", source.rack, (v) => upd({ rack: Number(v) }), "number")}
        {inp("Slot", source.slot, (v) => upd({ slot: Number(v) }), "number")}
        {inp("Poll (ms)", source.poll_interval_ms, (v) => upd({ poll_interval_ms: Number(v) }), "number")}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", marginBottom: 8 }}>TAG ({source.tags.length})</div>
        {source.tags.map((tm, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
            <TagInput
              value={tm.tag}
              onChange={(v) => updateTag(idx, { tag: v })}
              placeholder={t("cfg.tagIdPh")}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 160 }}
            />
            <select
              value={tm.area}
              onChange={(e) => updateTag(idx, { area: e.target.value as S7TagMapping["area"] })}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12 }}
            >
              <option value="db">DB</option>
              <option value="m">M (Merker)</option>
              <option value="i">I (Input)</option>
              <option value="q">Q (Output)</option>
            </select>
            {tm.area === "db" && (
              <input
                type="number"
                value={tm.db_num}
                onChange={(e) => updateTag(idx, { db_num: Number(e.target.value) })}
                title={t("cfg.dbNumber")}
                style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 60 }}
              />
            )}
            <input
              type="number"
              value={tm.byte_offset}
              onChange={(e) => updateTag(idx, { byte_offset: Number(e.target.value) })}
              title="byte offset"
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 60 }}
            />
            <select
              value={tm.data_type}
              onChange={(e) => updateTag(idx, { data_type: e.target.value as S7DataType })}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12 }}
            >
              <option value="real">REAL (4B float)</option>
              <option value="int">INT (2B signed)</option>
              <option value="dint">DINT (4B signed)</option>
              <option value="word">WORD (2B unsigned)</option>
              <option value="byte">BYTE</option>
              <option value="bool">BOOL</option>
            </select>
            {tm.data_type === "bool" && (
              <input
                type="number"
                min={0}
                max={7}
                value={tm.bit_offset}
                onChange={(e) => updateTag(idx, { bit_offset: Number(e.target.value) })}
                title="bit (0-7)"
                style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 50 }}
              />
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
              <input
                type="checkbox"
                checked={tm.writable}
                onChange={(e) => updateTag(idx, { writable: e.target.checked })}
              />
              Write
            </label>
            <button
              style={S.btnXs}
              onClick={() => { if (tm.tag) onCreateTag({ id: tm.tag, data_type: tipoDaS7(tm.data_type), description: "", history: false }); }}
              title={t("cfg.createTag")}
            >+var</button>
            <button style={S.btnXs} onClick={() => removeTag(idx)}>✕</button>
          </div>
        ))}
        <button style={S.btn("ghost")} onClick={addTag}>+ Tag</button>
      </div>
    </div>
  );
}
