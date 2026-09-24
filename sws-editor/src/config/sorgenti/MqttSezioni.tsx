import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { MqttLastWill, MqttSource, MqttTlsConfig } from "@/types";
import { S } from "@/config/comuni";

// ── MqttSourceCard sub-sections (auth / connection / TLS / last-will) ────────

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6, marginTop: 8, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
      {children}
    </div>
  );
}

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
      <SectionHeader>AUTENTICAZIONE</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
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
              title={show ? "Nascondi" : "Mostra"}
            >
              {show ? "🙈" : "👁"}
            </button>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
            Password da env (opz.) — alternativa al campo password, letta a runtime
          </label>
          <input
            style={S.input}
            placeholder="es. MQTT_PUMP1_PWD"
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
      <SectionHeader>{t("cfgUi.connection")}</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
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
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.maxSilenceSecs")}</label>
          <input
            style={{ ...S.input, maxWidth: 160 }}
            type="number" min={1}
            value={source.max_silence_secs ?? ""}
            placeholder={t("cfg.maxSilenceSecsPlaceholder")}
            onChange={(e) => onChange({ max_silence_secs: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
          <p style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", margin: "4px 0 0" }}>
            {t("cfg.maxSilenceSecsHint")}
          </p>
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
      <SectionHeader>TLS</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, marginBottom: 12, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={current.enabled}
            onChange={(e) => setField("enabled", e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Abilita TLS
        </label>
        <input
          style={S.input}
          placeholder="ca_cert_path (PEM, richiesto se abilitato)"
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
}: {
  source: MqttSource;
  onChange: (patch: Partial<MqttSource>) => void;
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
      <SectionHeader>CLIENT ID</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "auto 220px 1fr", gap: 12, marginBottom: 8, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setRandom({ enabled: e.target.checked })}
            style={{ marginRight: 6 }}
          />
          Random Client ID
        </label>
        <select
          style={S.input}
          value={position}
          onChange={(e) => setRandom({ position: e.target.value as "prefix" | "suffix" })}
          disabled={!enabled}
        >
          <option value="suffix">client_id come suffisso</option>
          <option value="prefix">client_id come prefisso</option>
        </select>
        <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
          {enabled
            ? "Ogni istanza (IDE e ogni device) aggiunge un id univoco persistente — client_id resta solo l'etichetta."
            : t("cfgUi.literalClientIdIdenticalOn")}
        </span>
      </div>

      {!enabled && (
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
            {pushing ? "Invio…" : t("cfgUi.sendClientIdToThe")}
          </button>
        </div>
      )}
      {pushMsg && (
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
      <SectionHeader>LAST WILL</SectionHeader>
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
