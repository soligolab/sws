import { useState } from "react";
import { useTranslation } from "react-i18next";
import { tipoDaS7 } from "@/tag/riconciliaTag";
import { TagInput } from "@/components/TagInput";
import type { S7DataType, S7Source, S7TagMapping, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { emptyS7Tag } from "@/config/sorgenti/vuote";
import { SezioneSorgente } from "@/config/sorgenti/card/SezioneSorgente";
import { TestataSorgente } from "@/config/sorgenti/card/TestataSorgente";
import { DisponibilitaSezione } from "@/config/sorgenti/card/DisponibilitaSezione";

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

  const etichetta = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;
  const campo = (label: string, val: string | number, set: (v: string) => void, type = "text") => (
    <div>
      <label style={etichetta}>{label}</label>
      <input type={type} value={val} onChange={(e) => set(e.target.value)} style={S.input} spellCheck={false} />
    </div>
  );

  return (
    <div style={S.card}>
      <TestataSorgente
        tipo="S7"
        colore="var(--brand-primary-testo, #3b82f6)"
        id={source.id}
        riepilogo={`${source.ip}${source.port ? `:${source.port}` : ""} · R${source.rack}/S${source.slot} · ${source.tags.length} tag`}
        aperta={!collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        azioni={<button style={S.btn("danger")} onClick={onDelete}>{t("cfgUi.delete")}</button>}
      />
      {!collapsed && (
      <div style={{ padding: "0 16px 14px" }}>
      {/* L'indirizzo per primo, l'ID sorgente per ultimo (29-10-2026). Prima
          la card aperta non aveva margini interni: testata e campi toccavano
          il bordo, perché il margine c'era solo da chiusa. */}
      <SezioneSorgente titolo={t("sorgenti.sezioni.collegamento")}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 90px 80px 80px 110px 1.2fr", gap: 12, marginBottom: 8 }}>
          {campo("IP PLC", source.ip, (v) => upd({ ip: v }))}
          {campo(t("cfgUi.s7Porta"), source.port ?? "", (v) => upd({ port: v === "" ? undefined : Number(v) }), "number")}
          {campo("Rack", source.rack, (v) => upd({ rack: Number(v) }), "number")}
          {campo("Slot", source.slot, (v) => upd({ slot: Number(v) }), "number")}
          {campo("Poll (ms)", source.poll_interval_ms, (v) => upd({ poll_interval_ms: Number(v) }), "number")}
          {campo(t("cfgUi.sourceId"), source.id, (v) => upd({ id: v }))}
        </div>
      </SezioneSorgente>

      <DisponibilitaSezione src={source} />

      <SezioneSorgente titolo={`${t("sorgenti.sezioni.variabili")} (${source.tags.length})`}>
        {source.tags.map((tm, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
            <TagInput
              value={tm.tag}
              onChange={(v) => updateTag(idx, { tag: v })}
              placeholder={t("cfg.tagIdPh")}
              style={{ ...S.inputSm, width: 160 }}
            />
            <select
              value={tm.area}
              onChange={(e) => updateTag(idx, { area: e.target.value as S7TagMapping["area"] })}
              style={{ ...S.inputSm, width: "auto" }}
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
                style={{ ...S.inputSm, width: 60 }}
              />
            )}
            <input
              type="number"
              value={tm.byte_offset}
              onChange={(e) => updateTag(idx, { byte_offset: Number(e.target.value) })}
              title="byte offset"
              style={{ ...S.inputSm, width: 60 }}
            />
            <select
              value={tm.data_type}
              onChange={(e) => updateTag(idx, { data_type: e.target.value as S7DataType })}
              style={{ ...S.inputSm, width: "auto" }}
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
                style={{ ...S.inputSm, width: 50 }}
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
      </SezioneSorgente>
      </div>
      )}
    </div>
  );
}
