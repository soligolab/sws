import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QuickCreateTagModal } from "@/components/QuickCreateTagModal";
import { TagInput } from "@/components/TagInput";
import type { EntityMapping, HomeAssistantSource, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { emptyEntityMapping } from "@/config/sorgenti/vuote";
import { type HaBrowseTarget, HaBrowseModal } from "@/config/sorgenti/HaBrowseModal";

// ── HomeAssistant card ────────────────────────────────────────────────────────

export function HomeAssistantSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: HomeAssistantSource;
  onChange: (s: HomeAssistantSource) => void;
  onDelete: () => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);
  const [browse, setBrowse] = useState<HaBrowseTarget | null>(null);

  const setField = <K extends keyof HomeAssistantSource>(k: K, v: HomeAssistantSource[K]) =>
    onChange({ ...source, [k]: v });

  const setEntity = (idx: number, patch: Partial<EntityMapping>) =>
    onChange({ ...source, entities: source.entities.map((e, i) => (i === idx ? { ...e, ...patch } : e)) });

  const addEntity = () =>
    onChange({ ...source, entities: [...source.entities, emptyEntityMapping()] });

  const removeEntity = (idx: number) =>
    onChange({ ...source, entities: source.entities.filter((_, i) => i !== idx) });

  return (
    <div style={S.card}>
      <div style={S.cardHead} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "var(--brand-warning, #f59e0b)", fontWeight: 700, letterSpacing: 1 }}>
            HOME ASSISTANT
          </span>
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{source.id}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>
            {source.url} — {source.entities.length} entità
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
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.sourceId")}</label>
              <input style={S.input} value={source.id}
                onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.haUrl")}</label>
              <input style={S.input} placeholder="http://homeassistant.local:8123"
                value={source.url}
                onChange={(e) => setField("url", e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
                Token accesso{" "}
                <span style={{ fontWeight: 400, color: "var(--brand-text-subtle, #94a3b8)" }}>(oppure usa token_env)</span>
              </label>
              <input style={S.input} type="password" placeholder="long-lived access token"
                value={source.token ?? ""}
                onChange={(e) => setField("token", e.target.value || undefined)} />
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
              {t("cfgUi.envVariableForTheToken")}
            </label>
            <input style={{ ...S.input, maxWidth: 240 }} placeholder="HA_TOKEN"
              value={source.token_env ?? ""}
              onChange={(e) => setField("token_env", e.target.value || undefined)}
              spellCheck={false} />
          </div>

          <div style={{ marginBottom: 6, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
            {t("cfgUi.haEntitiesSwsTags")}
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "18%" }}>{t("cfg.swsTag")}</th>
                <th style={{ ...S.th, width: "25%" }}>{t("cfg.haEntityId")}</th>
                <th style={{ ...S.th, width: "14%" }}>{t("cfg.attribute")}</th>
                <th style={{ ...S.th, width: "14%" }}>{t("cfg.writeDomain")}</th>
                <th style={{ ...S.th, width: "14%" }}>{t("cfg.writeService")}</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.entities.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...S.td, color: "var(--brand-text-subtle, #94a3b8)", textAlign: "center", padding: 12 }}>
                    {t("cfgUi.noEntitiesAddAMapping")}
                  </td>
                </tr>
              )}
              {source.entities.map((e, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)33" }}>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <TagInput style={S.inputSm} placeholder="sala.temp"
                        value={e.tag} onChange={(v) => setEntity(i, { tag: v })} />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }}
                        title={t("cfg.createTag")}
                        onClick={() => setQuickCreate({ rowIdx: i, prefill: e.tag })}
                      >＋</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input style={S.inputSm} placeholder="sensor.living_room_temperature"
                        value={e.entity_id}
                        onChange={(ev) => setEntity(i, { entity_id: ev.target.value })}
                        spellCheck={false} />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 13, lineHeight: 1 }}
                        title={t("cfg.browseEntities")}
                        onClick={() => setBrowse({ rowIdx: i, field: "entity_id" })}
                      >🔍</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input style={S.inputSm} placeholder="(stato)"
                        value={e.attribute ?? ""}
                        onChange={(ev) => setEntity(i, { attribute: ev.target.value || undefined })}
                        spellCheck={false} />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 13, lineHeight: 1 }}
                        title={t("cfg.browseAttributes")}
                        onClick={() => setBrowse({ rowIdx: i, field: "attribute" })}
                      >🔍</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} placeholder="light"
                      value={e.write_domain ?? ""}
                      onChange={(ev) => setEntity(i, { write_domain: ev.target.value || undefined })}
                      spellCheck={false} />
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} placeholder="turn_on"
                      value={e.write_service ?? ""}
                      onChange={(ev) => setEntity(i, { write_service: ev.target.value || undefined })}
                      spellCheck={false} />
                  </td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <button style={S.btn("danger")} onClick={() => removeEntity(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={S.btn("ghost")} onClick={addEntity}>{t("cfgUi.addEntity")}</button>
        </div>
      )}

      {browse !== null && (
        <HaBrowseModal
          sourceId={source.id}
          target={browse}
          onClose={() => setBrowse(null)}
          onSelect={(entityId, attribute) => {
            if (browse.field === "entity_id") {
              setEntity(browse.rowIdx, { entity_id: entityId });
            } else {
              setEntity(browse.rowIdx, { entity_id: entityId, attribute });
            }
            setBrowse(null);
          }}
        />
      )}

      {quickCreate !== null && (
        <QuickCreateTagModal
          initialId={quickCreate.prefill}
          onClose={() => setQuickCreate(null)}
          onConfirm={(tag: TagDef) => { onCreateTag(tag); setQuickCreate(null); }}
        />
      )}
    </div>
  );
}
