import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { QuickCreateTagModal } from "@/components/QuickCreateTagModal";
import { TagInput } from "@/components/TagInput";
import type { MqttSource, TagDef, TopicMapping } from "@/types";
import { S } from "@/config/comuni";
import { emptyTopic } from "@/config/sorgenti/vuote";
import { MqttBrowseModal } from "@/config/sorgenti/MqttBrowseModal";
import { MqttJsonExtractModal } from "@/config/sorgenti/MqttJsonExtractModal";
import { MqttAuthSection, MqttConnectionSection, MqttTlsSection, MqttRandomClientIdSection, MqttLastWillSection, MqttDisponibilitaSection } from "@/config/sorgenti/MqttSezioni";
import { SezioneSorgente } from "@/config/sorgenti/card/SezioneSorgente";
import { TestataSorgente } from "@/config/sorgenti/card/TestataSorgente";
import { DisponibilitaSezione } from "@/config/sorgenti/card/DisponibilitaSezione";
import { SparkplugSection } from "@/config/sorgenti/SparkplugSection";
import { compilaRichiesteZigbee2mqtt, pubblicabile, richiestaZigbee2mqtt } from "@/config/sorgenti/richiestaStato";

// ── MQTT card ─────────────────────────────────────────────────────────────────
//
// L'ordine delle sezioni è quello dell'importanza (29-10-2026, piano
// `docs/plans/2026-10-29-card-delle-sorgenti.md`, scelte del maintainer sul
// mockup): BROKER, AUTENTICAZIONE, DISPONIBILITÀ, MAPPATURA sempre aperte;
// connessione, TLS, last will e l'invio del client id in AVANZATE, chiusa.
// Prima i campi stavano nell'ordine in cui erano nati, l'ID sorgente per primo
// e il pulsante dell'allarme di disponibilità sotto la card, a fine pagina.

/** Il modo della mappatura: topic per topic, o Sparkplug B. Prima era una
 *  casella in fondo alla card che, accesa, faceva sparire la tabella dei topic
 *  senza dire dove fosse finita. */
function ModoMappatura({ source, onChange }: { source: MqttSource; onChange: (s: MqttSource) => void }) {
  const { t } = useTranslation();
  const sparkplug = !!source.sparkplug;
  const bottone = (attivo: boolean): React.CSSProperties => ({
    padding: "3px 10px", fontSize: 12, cursor: attivo ? "default" : "pointer", border: "none",
    background: attivo ? "var(--brand-primary, #3b82f6)" : "transparent",
    color: attivo ? "var(--brand-on-primary, #0f172a)" : "var(--brand-text-subtle, #94a3b8)",
    fontWeight: attivo ? 600 : 400,
  });
  return (
    <span role="group" aria-label={t("sorgenti.modo.titolo")} title={t("sorgenti.modo.titolo")}
      style={{ display: "inline-flex", border: "1px solid var(--brand-border, #475569)", borderRadius: 5, overflow: "hidden" }}>
      <button type="button" data-testid="modo-topic" aria-pressed={!sparkplug} style={bottone(!sparkplug)}
        onClick={() => {
          if (!sparkplug) return;
          // Tornare ai topic butta la configurazione Sparkplug, come la casella
          // di prima. Con delle metriche dentro si chiede: un clic su un
          // interruttore è più facile da sbagliare di una casella con la sua
          // scritta accanto.
          if ((source.sparkplug?.metrics.length ?? 0) > 0 && !window.confirm(t("sorgenti.modo.confermaTopic"))) return;
          onChange({ ...source, sparkplug: undefined });
        }}>{t("sorgenti.modo.topic")}</button>
      <button type="button" data-testid="modo-sparkplug" aria-pressed={sparkplug} style={bottone(sparkplug)}
        onClick={() => {
          if (sparkplug) return;
          onChange({ ...source, sparkplug: { group_id: "", host_id: "SWS-SCADA", metrics: [] } });
        }}>{t("sorgenti.modo.sparkplug")}</button>
    </span>
  );
}

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

  // Quante righe di Zigbee2MQTT sono ancora senza richiesta di stato: il
  // pulsante che le compila compare solo se ce n'è almeno una.
  const daCompilare = compilaRichiesteZigbee2mqtt(source.topics).toccate;

  const removeTopic = (idx: number) =>
    onChange({ ...source, topics: source.topics.filter((_, i) => i !== idx) });

  const etichetta = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;
  const nMappatura = source.sparkplug ? source.sparkplug.metrics.length : source.topics.length;

  return (
    <div style={S.card}>
      <TestataSorgente
        tipo="MQTT"
        colore="#a855f7"
        id={source.id}
        riepilogo={`${source.host}:${source.port} · ${source.topics.length} topic`}
        aperta={open}
        onToggle={() => setOpen((v) => !v)}
        azioni={<>
          <button style={S.btn("ghost")} onClick={() => setBrowseOpen(true)}>
            {t("sorgenti.sfogliaBroker")}
          </button>
          {!source.sparkplug && (
            <button style={S.btn("ghost")} onClick={() => setJsonExtractOpen(true)} title={t("cfgUi.pasteAJsonPayloadAnd")}>
              {t("sorgenti.estraiJson")}
            </button>
          )}
          <button style={S.btn("danger")} onClick={onDelete}>{t("cfgUi.delete")}</button>
        </>}
      />

      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          {/* L'indirizzo per primo, l'ID sorgente per ultimo: è il campo che si
              tocca quasi mai, e stava davanti a tutti. */}
          <SezioneSorgente titolo={t("sorgenti.sezioni.broker")}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 90px 1.5fr 1.2fr", gap: 12, marginBottom: 8 }}>
              <div>
                <label style={etichetta}>{t("cfg.hostIp")}</label>
                <input style={S.input} value={source.host} spellCheck={false}
                  onChange={(e) => setField("host", e.target.value)} />
              </div>
              <div>
                <label style={etichetta}>{t("cfg.port")}</label>
                <input style={S.input} type="number" min={1} max={65535} value={source.port}
                  onChange={(e) => setField("port", Number(e.target.value))} />
              </div>
              <div>
                <label style={etichetta}>{t("cfg.clientId")}</label>
                <input style={S.input} value={source.client_id} spellCheck={false}
                  onChange={(e) => setField("client_id", e.target.value)} />
              </div>
              <div>
                <label style={etichetta}>{t("cfg.sourceId")}</label>
                <input style={S.input} value={source.id} spellCheck={false}
                  onChange={(e) => setField("id", e.target.value)} />
              </div>
            </div>
            <MqttRandomClientIdSection source={source}
              onChange={(patch) => onChange({ ...source, ...patch })} />
          </SezioneSorgente>

          <SezioneSorgente titolo={t("sorgenti.sezioni.autenticazione")}>
            <MqttAuthSection source={source} onChange={(patch) => onChange({ ...source, ...patch })} />
          </SezioneSorgente>

          {/* Prima della mappatura: con ventiquattro topic, dopo la tabella il
              pulsante dell'allarme stava a fine pagina. */}
          {!source.sparkplug && (
            <DisponibilitaSezione src={source}>
              <MqttDisponibilitaSection
                source={source}
                onChange={(d) => onChange({ ...source, disponibilita: d })}
                onCreateTag={onCreateTag}
              />
            </DisponibilitaSezione>
          )}

          <SezioneSorgente
            titolo={`${t("sorgenti.sezioni.mappatura")} (${nMappatura})`}
            destra={<ModoMappatura source={source} onChange={onChange} />}
          >
            {source.sparkplug ? (
              <SparkplugSection
                spb={source.sparkplug}
                onChange={(spb) => onChange({ ...source, sparkplug: spb })}
                onCreateTag={onCreateTag}
              />
            ) : (<>
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
                <Fragment key={i}>
                <tr style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)33" }}>
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
                  <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      style={{ ...S.btn(tp.richiesta_stato ? "primary" : "ghost"), marginRight: 4 }}
                      title={t("sorgenti.richiestaStatoTitolo")}
                      data-testid={`richiesta-stato-${i}`}
                      onClick={() => setTopic(i, { richiesta_stato: tp.richiesta_stato ? undefined : richiestaZigbee2mqtt(tp) })}
                    >⟳</button>
                    <button style={S.btn("danger")} onClick={() => removeTopic(i)}>✕</button>
                  </td>
                </tr>
                {tp.richiesta_stato && (
                  <tr style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)33" }}>
                    <td style={{ ...S.td, fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", textAlign: "right" }}>
                      ⟳ {t("sorgenti.richiestaStato")}
                    </td>
                    <td style={S.td}>
                      <input
                        style={{ ...S.inputSm, borderColor: pubblicabile(tp.richiesta_stato.topic) ? undefined : "var(--brand-danger, #ef4444)" }}
                        value={tp.richiesta_stato.topic}
                        title={t("sorgenti.richiestaStatoTopic")}
                        onChange={(e) => setTopic(i, { richiesta_stato: { ...tp.richiesta_stato!, topic: e.target.value } })}
                        spellCheck={false}
                      />
                    </td>
                    <td colSpan={3} style={S.td}>
                      <input
                        style={S.inputSm}
                        value={tp.richiesta_stato.payload}
                        title={t("sorgenti.richiestaStatoPayload")}
                        onChange={(e) => setTopic(i, { richiesta_stato: { ...tp.richiesta_stato!, payload: e.target.value } })}
                        spellCheck={false}
                      />
                    </td>
                    <td style={S.td} />
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>

          <button style={S.btn("ghost")} onClick={addTopic}>
            {t("cfgUi.addTopic")}
          </button>
          {daCompilare > 0 && (
            <button
              style={{ ...S.btn("ghost"), marginLeft: 8 }}
              title={t("sorgenti.compilaRichiesteTitolo")}
              data-testid="compila-richieste-z2m"
              onClick={() => onChange({ ...source, topics: compilaRichiesteZigbee2mqtt(source.topics).righe })}
            >
              {t("sorgenti.compilaRichieste", { count: daCompilare })}
            </button>
          )}
            </>)}
          </SezioneSorgente>

          <SezioneSorgente
            titolo={t("sorgenti.sezioni.avanzate")}
            apribile
            chiusaDiPartenza
            riepilogo={t("sorgenti.riepilogoAvanzateMqtt")}
            testid={`mqtt-avanzate-${source.id}`}
          >
            <MqttConnectionSection source={source} onChange={(patch) => onChange({ ...source, ...patch })} />
            <MqttTlsSection tls={source.tls} onChange={(tls) => onChange({ ...source, tls })} />
            <MqttLastWillSection lw={source.last_will} onChange={(lw) => onChange({ ...source, last_will: lw })} />
            <MqttRandomClientIdSection invio source={source}
              onChange={(patch) => onChange({ ...source, ...patch })} />
          </SezioneSorgente>
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
