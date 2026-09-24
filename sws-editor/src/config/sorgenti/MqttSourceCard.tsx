import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QuickCreateTagModal } from "@/components/QuickCreateTagModal";
import { TagInput } from "@/components/TagInput";
import type { MqttSource, TagDef, TopicMapping } from "@/types";
import { S } from "@/config/comuni";
import { emptyTopic } from "@/config/sorgenti/vuote";
import { MqttBrowseModal } from "@/config/sorgenti/MqttBrowseModal";
import { MqttJsonExtractModal } from "@/config/sorgenti/MqttJsonExtractModal";
import { MqttAuthSection, MqttConnectionSection, MqttTlsSection, MqttRandomClientIdSection, MqttLastWillSection } from "@/config/sorgenti/MqttSezioni";
import { SparkplugSection } from "@/config/sorgenti/SparkplugSection";

// ── MQTT card ─────────────────────────────────────────────────────────────────

export function MqttSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: MqttSource;
  onChange: (s: MqttSource) => void;
  onDelete: () => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [jsonExtractOpen, setJsonExtractOpen] = useState(false);

  const setField = <K extends keyof MqttSource>(k: K, v: MqttSource[K]) =>
    onChange({ ...source, [k]: v });

  const setTopic = (idx: number, patch: Partial<TopicMapping>) =>
    onChange({
      ...source,
      topics: source.topics.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    });

  const addTopic = () =>
    onChange({ ...source, topics: [...source.topics, emptyTopic()] });

  const removeTopic = (idx: number) =>
    onChange({ ...source, topics: source.topics.filter((_, i) => i !== idx) });

  return (
    <div style={S.card}>
      <div style={S.cardHead} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#a855f7", fontWeight: 700, letterSpacing: 1 }}>
            MQTT
          </span>
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{source.id}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>
            {source.host}:{source.port} — {source.topics.length} topic
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={S.btn("ghost")}
            onClick={(e) => { e.stopPropagation(); setBrowseOpen(true); }}
          >
            Sfoglia broker
          </button>
          {!source.sparkplug && (
            <button
              style={S.btn("ghost")}
              onClick={(e) => { e.stopPropagation(); setJsonExtractOpen(true); }}
              title={t("cfgUi.pasteAJsonPayloadAnd")}
            >
              Estrai da JSON
            </button>
          )}
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
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 90px 1fr",
            gap: 12,
            marginBottom: 16,
          }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.sourceId")}</label>
              <input
                style={S.input}
                value={source.id}
                onChange={(e) => setField("id", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.hostIp")}</label>
              <input
                style={S.input}
                value={source.host}
                onChange={(e) => setField("host", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.port")}</label>
              <input
                style={S.input}
                type="number"
                min={1} max={65535}
                value={source.port}
                onChange={(e) => setField("port", Number(e.target.value))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.clientId")}</label>
              <input
                style={S.input}
                value={source.client_id}
                onChange={(e) => setField("client_id", e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>

          <MqttRandomClientIdSection
            source={source}
            onChange={(patch) => onChange({ ...source, ...patch })}
          />

          <MqttAuthSection
            source={source}
            onChange={(patch) => onChange({ ...source, ...patch })}
          />
          <MqttConnectionSection
            source={source}
            onChange={(patch) => onChange({ ...source, ...patch })}
          />
          <MqttTlsSection
            tls={source.tls}
            onChange={(tls) => onChange({ ...source, tls })}
          />
          <MqttLastWillSection
            lw={source.last_will}
            onChange={(lw) => onChange({ ...source, last_will: lw })}
          />

          <SparkplugSection
            spb={source.sparkplug}
            onChange={(spb) => onChange({ ...source, sparkplug: spb })}
            onCreateTag={onCreateTag}
          />

          {!source.sparkplug && (
          <><div style={{ marginBottom: 6, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
            MAPPATURA TOPIC
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "18%" }}>{t("cfg.variableTagId")}</th>
                <th style={{ ...S.th, width: "32%" }}>{t("cfg.topicIn")}</th>
                <th style={{ ...S.th, width: "14%" }}>{t("cfg.jsonPathOpt")}</th>
                <th style={{ ...S.th, width: "22%" }}>{t("cfg.topicOut")}</th>
                <th style={{ ...S.th, width: "6%" }}>QoS</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.topics.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...S.td, color: "var(--brand-text-subtle, #94a3b8)", textAlign: "center", padding: 12 }}>
                    {t("cfgUi.noTopicsAddAMapping")}
                  </td>
                </tr>
              )}
              {source.topics.map((tp, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)33" }}>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <TagInput
                        style={S.inputSm}
                        placeholder="pump1.speed"
                        value={tp.tag}
                        onChange={(v) => setTopic(i, { tag: v })}
                      />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }}
                        title={t("cfg.createTag")}
                        onClick={() => setQuickCreate({ rowIdx: i, prefill: tp.tag })}
                      >＋</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <input
                      style={S.inputSm}
                      placeholder="plant/floor1/temperature"
                      value={tp.topic}
                      onChange={(e) => setTopic(i, { topic: e.target.value })}
                      spellCheck={false}
                    />
                  </td>
                  <td style={S.td}>
                    <input
                      style={S.inputSm}
                      placeholder="es. temperature"
                      value={tp.json_path ?? ""}
                      onChange={(e) => setTopic(i, { json_path: e.target.value || undefined })}
                      spellCheck={false}
                    />
                  </td>
                  <td style={S.td}>
                    <input
                      style={S.inputSm}
                      placeholder="es. plant/floor1/cmd"
                      value={tp.publish_topic ?? ""}
                      onChange={(e) => setTopic(i, { publish_topic: e.target.value || undefined })}
                      spellCheck={false}
                    />
                  </td>
                  <td style={S.td}>
                    <select
                      style={{ ...S.inputSm, cursor: "pointer" }}
                      value={tp.qos ?? ""}
                      onChange={(e) => setTopic(i, { qos: e.target.value === "" ? undefined : Number(e.target.value) })}
                    >
                      <option value="">def.</option>
                      <option value="0">0</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                    </select>
                  </td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <button style={S.btn("danger")} onClick={() => removeTopic(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button style={S.btn("ghost")} onClick={addTopic}>
            {t("cfgUi.addTopic")}
          </button>
          </>)}
        </div>
      )}
      {quickCreate !== null && (
        <QuickCreateTagModal
          initialId={quickCreate.prefill}
          onConfirm={(tag) => {
            onCreateTag(tag);
            setTopic(quickCreate.rowIdx, { tag: tag.id });
          }}
          onClose={() => setQuickCreate(null)}
        />
      )}
      {browseOpen && (
        <MqttBrowseModal
          source={source}
          onImport={(newTopics) => {
            onChange({ ...source, topics: [...source.topics, ...newTopics] });
          }}
          onClose={() => setBrowseOpen(false)}
        />
      )}
      {jsonExtractOpen && (
        <MqttJsonExtractModal
          source={source}
          onGenerate={(rows, tags) => {
            onChange({ ...source, topics: [...source.topics, ...rows] });
            tags.forEach(onCreateTag);
          }}
          onClose={() => setJsonExtractOpen(false)}
        />
      )}
    </div>
  );
}
