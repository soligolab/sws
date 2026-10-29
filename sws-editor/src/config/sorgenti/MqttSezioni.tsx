import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { DisponibilitaMqtt, MqttLastWill, MqttSource, MqttTlsConfig, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { PRESET_DISPONIBILITA, presetDi, tagDefDisponibilita, type PresetDisponibilita } from "@/config/sorgenti/disponibilita";
import { SottoTitolo } from "@/config/sorgenti/card/SezioneSorgente";

// ── MqttSourceCard sub-sections (auth / connection / TLS / last-will) ────────
//
// Dal 29-10-2026 queste sezioni **non hanno un titolo loro**: lo mette la card,
// con `SezioneSorgente` (titolo in pieno contrasto) o `SottoTitolo` dentro
// AVANZATE. Prima ognuna aveva il suo `SectionHeader`, dello stesso colore delle
// etichette dei campi — ed era quello il «poco contrasto» del collaudo.
// Piano: docs/archive/2026-10-29-card-delle-sorgenti.md

export function MqttAuthSection({
  source,
  onChange,
}: {
  source: MqttSource;
  onChange: (patch: Partial<MqttSource>) => void;
}) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.username")}</label>
          <input
            style={S.input}
            value={source.username ?? ""}
            onChange={(e) => onChange({ username: e.target.value || undefined })}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
            Password{" "}
            <span style={{ color: "var(--brand-text-subtle, #94a3b8)" }}>{t("cfgUi.leaveToKeepUnchanged")}</span>
          </label>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              style={S.input}
              type={show ? "text" : "password"}
              value={source.password ?? ""}
              onChange={(e) => onChange({ password: e.target.value || undefined })}
              autoComplete="new-password"
              spellCheck={false}
            />
            <button
              type="button"
              style={S.btn("ghost")}
              onClick={() => setShow((v) => !v)}
              title={show ? t("sorgenti.nascondi") : t("sorgenti.mostra")}
            >
              {show ? "🙈" : "👁"}
            </button>
          </div>
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
            {t("sorgenti.passwordEnv")}
          </label>
          <input
            style={S.input}
            placeholder={t("sorgenti.passwordEnvPh")}
            value={source.password_env ?? ""}
            onChange={(e) => onChange({ password_env: e.target.value || undefined })}
            spellCheck={false}
          />
        </div>
      </div>
    </>
  );
}

export function MqttConnectionSection({
  source,
  onChange,
}: {
  source: MqttSource;
  onChange: (patch: Partial<MqttSource>) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <SottoTitolo>{t("sorgenti.sezioni.connessione")}</SottoTitolo>
      {/* Quattro colonne: il watchdog è un parametro di connessione, e stava da
          solo su una riga sua (osservazione del maintainer, 29-10-2026). */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.keepAlive")}</label>
          <input
            style={S.input}
            type="number" min={1} max={3600}
            value={source.keep_alive_secs ?? ""}
            placeholder="10"
            onChange={(e) => onChange({ keep_alive_secs: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.defaultQos")}</label>
          <select
            style={{ ...S.input, cursor: "pointer" }}
            value={source.qos ?? ""}
            onChange={(e) => onChange({ qos: e.target.value === "" ? undefined : Number(e.target.value) })}
          >
            <option value="">0 (default)</option>
            <option value="0">0 — at most once</option>
            <option value="1">1 — at least once</option>
            <option value="2">2 — exactly once</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.cleanSession")}</label>
          <select
            style={{ ...S.input, cursor: "pointer" }}
            value={source.clean_session === undefined ? "" : source.clean_session ? "true" : "false"}
            onChange={(e) => onChange({ clean_session: e.target.value === "" ? undefined : e.target.value === "true" })}
          >
            <option value="">default (true)</option>
            <option value="true">true — drop server-side state</option>
            <option value="false">false — preserve subscriptions</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}
            title={t("cfg.maxSilenceSecsHint")}>{t("cfg.maxSilenceSecs")}</label>
          <input
            style={S.input}
            type="number" min={1}
            value={source.max_silence_secs ?? ""}
            placeholder={t("cfg.maxSilenceSecsPlaceholder")}
            title={t("cfg.maxSilenceSecsHint")}
            onChange={(e) => onChange({ max_silence_secs: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
      </div>
    </>
  );
}

export function MqttTlsSection({
  tls,
  onChange,
}: {
  tls?: MqttTlsConfig;
  onChange: (tls: MqttTlsConfig | undefined) => void;
}) {
  const { t } = useTranslation();
  const current: MqttTlsConfig = tls ?? { enabled: false };
  const setField = <K extends keyof MqttTlsConfig>(k: K, v: MqttTlsConfig[K]) =>
    onChange({ ...current, [k]: v });
  return (
    <>
      <SottoTitolo>TLS</SottoTitolo>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, marginBottom: 12, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={current.enabled}
            onChange={(e) => setField("enabled", e.target.checked)}
            style={{ marginRight: 6 }}
          />
          {t("sorgenti.abilitaTls")}
        </label>
        <input
          style={S.input}
          placeholder={t("sorgenti.caCertPh")}
          value={current.ca_cert_path ?? ""}
          onChange={(e) => setField("ca_cert_path", e.target.value || undefined)}
          spellCheck={false}
          disabled={!current.enabled}
        />
        {/* Fino al 2026-08-24 diceva "skip verify (not impl.)": la spunta si
            salvava, il runtime la registrava nel log e validava comunque la
            catena. Ora fa quello che dice, quindi l'avviso deve dire cosa
            comporta — una casella di sicurezza che mente è peggio di una
            assente, in tutt'e due i versi. */}
        <label style={{ fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)", cursor: "pointer" }}
          title={t("cfg.mqttInsecureTitle")}>
          <input
            type="checkbox"
            checked={current.insecure_skip_verify ?? false}
            onChange={(e) => setField("insecure_skip_verify", e.target.checked)}
            style={{ marginRight: 6 }}
            disabled={!current.enabled}
          />
          {t("cfgUi.doNotVerifyTheBroker")}
        </label>
        {current.enabled && current.insecure_skip_verify && (
          <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)", marginTop: 4 }}>
            {t("cfgUi.encryptedTrafficButUnauthenticatedBroker")}
          </div>
        )}
      </div>
    </>
  );
}

/// Client ID MQTT: letterale (identico su ogni istanza che apre il progetto,
/// IDE compreso — rischio di collisione se lo stesso progetto gira anche su
/// uno o più device) oppure "Random" (ogni istanza glue un id persistente
/// univoco al client_id, usato come prefisso/suffisso). Le due modalità sono
/// alternative: quando Random è attivo l'invio manuale al device non ha
/// senso (il device si genera già il proprio id) e si nasconde.
export function MqttRandomClientIdSection({
  source,
  onChange,
  invio = false,
}: {
  source: MqttSource;
  onChange: (patch: Partial<MqttSource>) => void;
  /** Dal 29-10-2026 la card ne mostra due pezzi in due posti: la scelta
   *  («casuale», in BROKER, accanto al Client ID a cui si riferisce) e, con
   *  `invio`, l'invio al dispositivo (in AVANZATE, perché si fa una volta sola). */
  invio?: boolean;
}) {
  const { t } = useTranslation();
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const enabled = source.random_client_id?.enabled ?? false;
  const position = source.random_client_id?.position ?? "suffix";

  const setRandom = (patch: Partial<{ enabled: boolean; position: "prefix" | "suffix" }>) =>
    onChange({ random_client_id: { enabled, position, ...patch } });

  const [pushValue, setPushValue] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const handlePush = async () => {
    const label = pushValue.trim() || t("cfg.pushMqttClientIdDefaultLabel");
    if (!window.confirm(
      t("cfg.pushMqttClientIdConfirm", { label, source: source.id })
    )) return;
    setPushing(true); setPushMsg(null);
    try {
      await api.pushMqttClientIdOverride(source.id, pushValue.trim() || null);
      setPushMsg(pushValue.trim() ? t("cfgUi.sentToTheDevice") : t("cfgUi.overrideRemovedFromTheDevice"));
    } catch (e: any) {
      setPushMsg(`✗ ${e?.message ?? String(e)}`);
    } finally {
      setPushing(false);
    }
  };

  return (
    <>
      {!invio && (
      <div style={{ display: "grid", gridTemplateColumns: "auto 220px 1fr", gap: 12, marginBottom: 8, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setRandom({ enabled: e.target.checked })}
            style={{ marginRight: 6 }}
          />
          {t("sorgenti.clientIdCasuale")}
        </label>
        <select
          style={S.input}
          value={position}
          onChange={(e) => setRandom({ position: e.target.value as "prefix" | "suffix" })}
          disabled={!enabled}
        >
          <option value="suffix">{t("sorgenti.clientIdSuffisso")}</option>
          <option value="prefix">{t("sorgenti.clientIdPrefisso")}</option>
        </select>
        <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
          {enabled
            ? t("sorgenti.clientIdUnivoco")
            : t("cfgUi.literalClientIdIdenticalOn")}
        </span>
      </div>
      )}

      {invio && !enabled && <SottoTitolo>Client ID</SottoTitolo>}
      {invio && !enabled && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            style={{ ...S.input, flex: 1 }}
            placeholder={t("cfgUi.clientIdToSendTo")}
            value={pushValue}
            onChange={(e) => setPushValue(e.target.value)}
            disabled={!remoteConnected || pushing}
            spellCheck={false}
          />
          <button
            style={S.btn("ghost")}
            onClick={handlePush}
            disabled={!remoteConnected || pushing}
            title={remoteConnected ? "" : t("cfgUi.connectToADeviceFrom")}
          >
            {pushing ? t("common.invio") : t("cfgUi.sendClientIdToThe")}
          </button>
        </div>
      )}
      {invio && pushMsg && (
        <div style={{
          fontSize: 12, marginBottom: 12,
          color: pushMsg.startsWith("✓") ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger-soft, #f87171)",
        }}>
          {pushMsg}
        </div>
      )}
    </>
  );
}

export function MqttLastWillSection({
  lw,
  onChange,
}: {
  lw?: MqttLastWill;
  onChange: (lw: MqttLastWill | undefined) => void;
}) {
  const { t } = useTranslation();
  const enabled = !!lw;
  const current: MqttLastWill = lw ?? { topic: "", payload: "", qos: 0, retain: false };
  const setField = <K extends keyof MqttLastWill>(k: K, v: MqttLastWill[K]) =>
    onChange({ ...current, [k]: v });
  return (
    <>
      <SottoTitolo>Last will</SottoTitolo>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(e.target.checked ? current : undefined)}
            style={{ marginRight: 6 }}
          />
          {t("cfgUi.publishALastWillWhen")}
        </label>
      </div>
      {enabled && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 12, marginBottom: 12, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.topic")}</label>
            <input
              style={S.input}
              placeholder="plant/floor1/status"
              value={current.topic}
              onChange={(e) => setField("topic", e.target.value)}
              spellCheck={false}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.payload")}</label>
            <input
              style={S.input}
              placeholder="es. offline"
              value={current.payload}
              onChange={(e) => setField("payload", e.target.value)}
              spellCheck={false}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>QoS</label>
            <select
              style={{ ...S.input, cursor: "pointer", minWidth: 70 }}
              value={current.qos}
              onChange={(e) => setField("qos", Number(e.target.value))}
            >
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>Retain</label>
            <input
              type="checkbox"
              checked={current.retain}
              onChange={(e) => setField("retain", e.target.checked)}
              style={{ accentColor: "var(--brand-primary, #3b82f6)", marginTop: 5 }}
            />
          </div>
        </div>
      )}
    </>
  );
}

/** Chi sta dall'altra parte del broker (28-10-2026, piano «chi sta dall'altra
 *  parte»). Un broker vivo non vuol dire un Zigbee2MQTT vivo: qui si dice quale
 *  topic lo racconta. Le impostazioni pronte riempiono i tre campi; `{nome}`
 *  resta da sostituire col nome del dispositivo. Accenderla dichiara il tag
 *  `<sorgente>.disponibile`, così il selettore e la validazione lo vedono. */
export function MqttDisponibilitaSection({
  source,
  onChange,
  onCreateTag,
}: {
  source: MqttSource;
  onChange: (d: DisponibilitaMqtt | undefined) => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const { t } = useTranslation();
  const d = source.disponibilita;
  const preset = presetDi(d);
  const set = (patch: Partial<DisponibilitaMqtt>) => onChange({ ...(d ?? { topic: "", vivo: "" }), ...patch });
  const scegli = (k: string) => {
    if (k === "") return onChange(undefined);
    if (k === "personalizzato") return onChange(d ?? { topic: "", vivo: "online" });
    const p = PRESET_DISPONIBILITA[k as PresetDisponibilita];
    onChange({ topic: p.topic, vivo: p.vivo, ...("json_path" in p ? { json_path: p.json_path } : {}) });
    onCreateTag(tagDefDisponibilita(source.id, t("sorgenti.disponibilita.descrizioneTag", { id: source.id })));
  };
  const etichetta = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;
  return (
    <>
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 8, lineHeight: 1.4 }}>
        {t("sorgenti.disponibilita.nota")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 120px 120px", gap: 12, marginBottom: 12, alignItems: "end" }}>
        <label style={etichetta}>{t("sorgenti.disponibilita.chi")}
          <select style={{ ...S.input, cursor: "pointer" }} value={preset ?? ""} data-testid="disponibilita-preset"
            onChange={(e) => scegli(e.target.value)}>
            <option value="">{t("sorgenti.disponibilita.soloBroker")}</option>
            <option value="zigbee2mqtt">Zigbee2MQTT</option>
            <option value="tasmota">Tasmota</option>
            <option value="shelly">Shelly</option>
            <option value="esphome">ESPHome</option>
            <option value="personalizzato">{t("sorgenti.disponibilita.personalizzato")}</option>
          </select>
        </label>
        {d && (<>
          <label style={etichetta}>{t("cfg.topic")}
            <input style={S.input} value={d.topic} spellCheck={false} data-testid="disponibilita-topic"
              onChange={(e) => set({ topic: e.target.value })} />
          </label>
          <label style={etichetta}>{t("cfg.jsonPathOpt")}
            <input style={S.input} value={d.json_path ?? ""} spellCheck={false}
              onChange={(e) => set({ json_path: e.target.value || undefined })} />
          </label>
          <label style={etichetta}>{t("sorgenti.disponibilita.vivo")}
            <input style={S.input} value={d.vivo} spellCheck={false}
              onChange={(e) => set({ vivo: e.target.value })} />
          </label>
        </>)}
      </div>
      {d?.topic.includes("{nome}") && (
        <div style={{ fontSize: 11, color: "var(--brand-warning, #f59e0b)", marginTop: -6, marginBottom: 10 }}>
          {t("sorgenti.disponibilita.nomeDaSostituire")}
        </div>
      )}
    </>
  );
}
