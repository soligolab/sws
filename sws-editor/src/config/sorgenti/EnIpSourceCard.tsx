import { useState } from "react";
import { useTranslation } from "react-i18next";
import { genId } from "@/id";
import { tipoDaEnIp } from "@/tag/riconciliaTag";
import { TagInput } from "@/components/TagInput";
import type { EnIpDataType, EnIpSource, EnIpTagMapping, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { SezioneSorgente } from "@/config/sorgenti/card/SezioneSorgente";
import { TestataSorgente } from "@/config/sorgenti/card/TestataSorgente";
import { DisponibilitaSezione } from "@/config/sorgenti/card/DisponibilitaSezione";

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
        tipo="ETHERNET/IP"
        colore="var(--brand-warning, #f59e0b)"
        id={source.id}
        riepilogo={`${source.ip} · slot ${source.slot} · ${source.tags.length} tag`}
        aperta={!collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        azioni={<button style={S.btn("danger")} onClick={onDelete}>{t("cfgUi.delete")}</button>}
      />
      {!collapsed && (
      <div style={{ padding: "0 16px 14px" }}>
      {/* L'indirizzo per primo, l'ID sorgente per ultimo (29-10-2026). */}
      <SezioneSorgente titolo={t("sorgenti.sezioni.collegamento")}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 100px 110px 1.2fr", gap: 12, marginBottom: 8 }}>
          {campo("IP PLC", source.ip, (v) => upd({ ip: v }))}
          {campo("Slot CIP", source.slot, (v) => upd({ slot: Number(v) }), "number")}
          {campo("Poll (ms)", source.poll_interval_ms, (v) => upd({ poll_interval_ms: Number(v) }), "number")}
          {campo(t("cfgUi.sourceId"), source.id, (v) => upd({ id: v }))}
        </div>
      </SezioneSorgente>

      <DisponibilitaSezione src={source} />

      <SezioneSorgente titolo={`${t("sorgenti.sezioni.variabili")} (${source.tags.length})`}>
        {source.tags.map((tm, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
            <TagInput
              value={tm.tag} onChange={(v) => updateTag(idx, { tag: v })}
              placeholder={t("cfg.swsTagIdPh")}
              style={{ ...S.inputSm, width: 150 }}
            />
            <input
              value={tm.plc_tag} onChange={(e) => updateTag(idx, { plc_tag: e.target.value })}
              placeholder={t("cfg.plcTag")}
              style={{ ...S.inputSm, width: 180 }}
            />
            <select
              value={tm.data_type}
              onChange={(e) => updateTag(idx, { data_type: e.target.value as EnIpDataType })}
              style={{ ...S.inputSm, width: "auto" }}
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
      </SezioneSorgente>
      </div>
      )}
    </div>
  );
}
