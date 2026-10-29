import { useTranslation } from "react-i18next";
import { TagInput } from "@/components/TagInput";
import type { SparkplugConfig, SparkplugMetricMapping, TagDef } from "@/types";
import { S } from "@/config/comuni";

// ── Sparkplug B section (inside MqttSourceCard) ───────────────────────────────
//
// Dal 29-10-2026 Sparkplug B non si accende con una casella sua: è un **modo
// della mappatura**, scelto da `[Topic | Sparkplug B]` nel titolo della sezione
// MAPPATURA della card (scelta del maintainer sul mockup). Qui resta solo la
// sua configurazione, che si mostra quando il modo è quello. Stessi dati di
// prima: `source.sparkplug` presente o no.
// Piano: docs/plans/2026-10-29-card-delle-sorgenti.md

export function SparkplugSection({
  spb,
  onChange,
  onCreateTag,
}: {
  spb?: SparkplugConfig;
  onChange: (spb: SparkplugConfig | undefined) => void;
  onCreateTag: (t: TagDef) => void;
}) {
  const { t } = useTranslation();
  const enabled = !!spb;
  const current: SparkplugConfig = spb ?? { group_id: "", host_id: "SWS-SCADA", metrics: [] };

  function setField<K extends keyof SparkplugConfig>(k: K, v: SparkplugConfig[K]) {
    onChange({ ...current, [k]: v });
  }
  function addMetric() {
    setField("metrics", [...current.metrics, { metric_name: "", tag: "", writable: false }]);
  }
  function updateMetric(idx: number, patch: Partial<SparkplugMetricMapping>) {
    setField("metrics", current.metrics.map((m, i) => i === idx ? { ...m, ...patch } : m));
  }
  function removeMetric(idx: number) {
    setField("metrics", current.metrics.filter((_, i) => i !== idx));
  }

  return (
    <>
      {enabled && (
        <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", marginBottom: 8 }}>
          {t("cfgUi.sparkplugBModeProtobufPayloads")}
        </div>
      )}
      {enabled && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.groupId")}</label>
              <input
                style={S.input}
                placeholder="plant-a"
                value={current.group_id}
                onChange={(e) => setField("group_id", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.scadaHostId")}</label>
              <input
                style={S.input}
                value={current.host_id}
                onChange={(e) => setField("host_id", e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", marginBottom: 6 }}>
            METRICHE ({current.metrics.length})
          </div>
          {current.metrics.map((m, idx) => (
            <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <TagInput
                value={m.tag} onChange={(v) => updateMetric(idx, { tag: v })}
                placeholder={t("cfg.swsTagIdPh")}
                style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 160 }}
              />
              <input
                value={m.metric_name} onChange={(e) => updateMetric(idx, { metric_name: e.target.value })}
                placeholder={t("cfg.sparkplugMetric")}
                style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text, #e2e8f0)", padding: "4px 6px", fontSize: 12, width: 200 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
                <input type="checkbox" checked={m.writable} onChange={(e) => updateMetric(idx, { writable: e.target.checked })} />
                NCMD write
              </label>
              <button
                style={S.btnXs}
                onClick={() => { if (m.tag) onCreateTag({ id: m.tag, data_type: "float", description: "", history: false }); }}
                title={t("cfg.createTag")}
              >+var</button>
              <button style={S.btnXs} onClick={() => removeMetric(idx)}>✕</button>
            </div>
          ))}
          <button style={S.btn("ghost")} onClick={addMetric}>{t("sorgenti.piuMetrica")}</button>
        </>
      )}
    </>
  );
}
