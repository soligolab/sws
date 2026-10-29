import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QuickCreateTagModal } from "@/components/QuickCreateTagModal";
import { TagInput } from "@/components/TagInput";
import type { EntityMapping, HomeAssistantSource, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { emptyEntityMapping } from "@/config/sorgenti/vuote";
import { type HaBrowseTarget, HaBrowseModal } from "@/config/sorgenti/HaBrowseModal";
import { SezioneSorgente } from "@/config/sorgenti/card/SezioneSorgente";
import { TestataSorgente } from "@/config/sorgenti/card/TestataSorgente";
import { DisponibilitaSezione } from "@/config/sorgenti/card/DisponibilitaSezione";

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

  const etichetta = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;

  return (
    <div style={S.card}>
      <TestataSorgente
        tipo="HOME ASSISTANT"
        colore="var(--brand-warning, #f59e0b)"
        id={source.id}
        riepilogo={`${source.url} · ${t("sorgenti.nEntita", { count: source.entities.length })}`}
        aperta={open}
        onToggle={() => setOpen((v) => !v)}
        azioni={<button style={S.btn("danger")} onClick={onDelete}>{t("cfgUi.delete")}</button>}
      />

      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          {/* L'indirizzo per primo, l'ID sorgente per ultimo (29-10-2026). */}
          <SezioneSorgente titolo={t("sorgenti.sezioni.collegamento")}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr", gap: 12 }}>
              <div>
                <label style={etichetta}>{t("cfg.haUrl")}</label>
                <input style={S.input} placeholder="http://homeassistant.local:8123"
                  value={source.url}
                  onChange={(e) => setField("url", e.target.value)} spellCheck={false} />
              </div>
              <div>
                <label style={etichetta}>{t("cfg.sourceId")}</label>
                <input style={S.input} value={source.id}
                  onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
              </div>
            </div>
          </SezioneSorgente>

          {/* Il token e la sua variabile d'ambiente su una riga: prima la
              variabile stava da sola, sotto, e l'etichetta del token doveva
              rimandarci con «(oppure usa token_env)». */}
          <SezioneSorgente titolo={t("sorgenti.sezioni.autenticazione")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={etichetta}>{t("sorgenti.tokenAccesso")}</label>
                <input style={S.input} type="password" placeholder="long-lived access token"
                  value={source.token ?? ""}
                  onChange={(e) => setField("token", e.target.value || undefined)} />
              </div>
              <div>
                <label style={etichetta}>{t("cfgUi.envVariableForTheToken")}</label>
                <input style={S.input} placeholder="HA_TOKEN"
                  value={source.token_env ?? ""}
                  onChange={(e) => setField("token_env", e.target.value || undefined)}
                  spellCheck={false} />
              </div>
            </div>
          </SezioneSorgente>

          <DisponibilitaSezione src={source} />

          <SezioneSorgente titolo={`${t("sorgenti.sezioni.entita")} (${source.entities.length})`}>
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
                      <input style={S.inputSm} placeholder={t("sorgenti.statoPh")}
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
          </SezioneSorgente>
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
