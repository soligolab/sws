import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { emptyHost } from "@/config/sorgenteHost";
import type { SourceDef } from "@/types";
import { useAppStore } from "@/store";
import { useSezioneSincronizzata } from "@/config/useSezioneSincronizzata";
import { TRANS_COMP, BarraConflittoSezione, S, SaveBar } from "@/config/comuni";
import { emptyModbus, emptyModbusRtu, sorgentiSenzaRigheVuote, emptyMqtt, emptyOpcUa, emptyOpcUaServer, emptyHomeAssistant, emptyS7 } from "@/config/sorgenti/vuote";
import { S7SourceCard } from "@/config/sorgenti/S7SourceCard";
import { HostSourceCard } from "@/config/sorgenti/HostSourceCard";
import { emptyEnIp, EnIpSourceCard } from "@/config/sorgenti/EnIpSourceCard";
import { HomeAssistantSourceCard } from "@/config/sorgenti/HomeAssistantSourceCard";
import { OpcUaSourceCard } from "@/config/sorgenti/OpcUaSourceCard";
import { OpcUaServerSourceCard } from "@/config/sorgenti/OpcUaServerSourceCard";
import { ModbusSourceCard } from "@/config/sorgenti/ModbusSourceCard";
import { ModbusRtuSourceCard } from "@/config/sorgenti/ModbusRtuSourceCard";
import { MqttSourceCard } from "@/config/sorgenti/MqttSourceCard";

// ── PROTOCOLS tab ─────────────────────────────────────────────────────────────

export function ProtocolsTab() {
  const { t }                  = useTranslation();
  const storeProject           = useAppStore((s) => s.project);
  const updateProjectSources   = useAppStore((s) => s.updateProjectSources);
  const markSaveOk             = useAppStore((s) => s.markSaveOk);
  // Le variabili in attesa stanno nello store (Fase 0b): «+var», modale e
  // wizard le mettono lì, e il Salva unico le crea se ancora referenziate.
  const tagInAttesa            = useAppStore((s) => s.tagInAttesa);
  const handleCreateTag        = useAppStore((s) => s.aggiungiTagInAttesa);

  const [sources, setSources]  = useState<SourceDef[]>(storeProject?.sources ?? []);
  const [saving, setSaving]    = useState(false);
  const [saved, setSaved]      = useState(false);

  // Dipendere dalla sola LUNGHEZZA copriva il caso comune ma non tutti: un
  // progetto ricaricato con lo stesso numero di sorgenti non si
  // risincronizzava, e uno con un numero diverso cancellava le modifiche in
  // corso senza dire niente. Qui «modificato» si deduce dal riferimento:
  // `applica` assegna proprio l'array dello store, quindi finché nessuno ha
  // toccato niente i due sono lo stesso oggetto.
  const sync = useSezioneSincronizzata<SourceDef[]>({
    remoto: storeProject?.sources,
    applica: setSources,
    modificato: sources !== storeProject?.sources,
    progetto: storeProject?.meta?.name,
  });

  const addModbus = () =>
    setSources((prev) => [...prev, emptyModbus()]);

  const addModbusRtu = () =>
    setSources((prev) => [...prev, emptyModbusRtu()]);

  const addMqtt = () =>
    setSources((prev) => [...prev, emptyMqtt()]);

  const addOpcUa = () =>
    setSources((prev) => [...prev, emptyOpcUa()]);

  const addOpcUaServer = () =>
    setSources((prev) => [...prev, emptyOpcUaServer()]);

  const addHomeAssistant = () =>
    setSources((prev) => [...prev, emptyHomeAssistant()]);

  const addS7 = () =>
    setSources((prev) => [...prev, emptyS7()]);

  const addEnIp = () =>
    setSources((prev) => [...prev, emptyEnIp()]);

  const addHost = () =>
    setSources((prev) => [...prev, emptyHost()]);

  const updateSource = (idx: number, updated: SourceDef) =>
    setSources((prev) => prev.map((s, i) => (i === idx ? updated : s)));

  const removeSource = (idx: number) =>
    setSources((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    setSaving(true);
    try {
      // La tabella mostra quello che è stato davvero salvato, non quello che
      // c'era prima della potatura.
      const puliti = sorgentiSenzaRigheVuote(sources);
      if (puliti !== sources) setSources(puliti);
      await api.updateSources(puliti);
      updateProjectSources(puliti);
      setSaved(true);
      // Vedi commento analogo in TagsTab: segnala il salvataggio riuscito
      // allo stato globale che alimenta la finestra "salvataggio nostro" del
      // watcher progetto, altrimenti il banner "cambiato esternamente"
      // scatta anche sulla sessione che ha appena salvato.
      markSaveOk();
      setTimeout(() => setSaved(false), 5000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.section}>
      {/* `sources !== storeProject.sources` è intenzione dell'utente, non
          confronto strutturale: `sync.applica` assegna proprio l'array dello
          store, quindi un riferimento diverso esiste solo dopo una modifica. */}
      <SaveBar
        onSave={handleSave}
        saving={saving}
        saved={saved}
        savedNotice={t("cfgUi.savedSourcesReconnectedOnThe")}
        section="sources"
        dirty={sources !== storeProject?.sources}
      />
      <BarraConflittoSezione sync={sync} t={t} />
      {storeProject?.sorgenti_da_rivedere && (
        // Q58 — il progetto viene da un template: gli indirizzi sono quelli
        // dell'esempio, e il runtime non li usa finché una persona non li ha
        // guardati. Salvare da qui **è** la conferma: non c'è un secondo
        // pulsante che chiede la stessa cosa (regola «una sezione per dato»).
        <div
          style={{
            background: "rgba(234, 179, 8, 0.12)",
            border: "1px solid var(--brand-warning, #eab308)",
            borderRadius: 6,
            padding: "10px 12px",
            marginBottom: 12,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <Trans i18nKey="cfgUi.sourcesNotStartedNotice" components={TRANS_COMP} />
        </div>
      )}
      <div style={S.sectionTitle}>SORGENTI DATI / PROTOCOLLI</div>
      <div style={S.notice}>
        <Trans i18nKey="cfgUi.protocolsNotice" components={TRANS_COMP} />
      </div>

      {sources.length === 0 && (
        <div style={{ color: "var(--brand-text-subtle, #94a3b8)", fontSize: 13, marginBottom: 16 }}>
          {t("cfgUi.noSourcesConfigured")}
        </div>
      )}

      {sources.map((src, i) => {
        if (src.kind === "modbus_tcp") {
          return (
            <ModbusSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "modbus_rtu") {
          return (
            <ModbusRtuSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "mqtt") {
          return (
            <MqttSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "opcua_client") {
          return (
            <OpcUaSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "opcua_server") {
          return (
            <OpcUaServerSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "homeassistant") {
          return (
            <HomeAssistantSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "s7") {
          return (
            <S7SourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "enip") {
          return (
            <EnIpSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        if (src.kind === "host") {
          return (
            <HostSourceCard
              key={i}
              source={src}
              onChange={(updated) => updateSource(i, updated)}
              onDelete={() => removeSource(i)}
              onCreateTag={handleCreateTag}
            />
          );
        }
        return null;
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        <button style={S.btn("ghost")} onClick={addModbus}>
          {t("cfgUi.addModbusTcp")}
        </button>
        <button style={S.btn("ghost")} onClick={addModbusRtu}>
          {t("cfgUi.addModbusRtu")}
        </button>
        <button style={S.btn("ghost")} onClick={addMqtt}>
          {t("cfgUi.addMqtt")}
        </button>
        <button style={S.btn("ghost")} onClick={addOpcUa}>
          {t("cfgUi.addOpcUaClient")}
        </button>
        <button style={S.btn("ghost")} onClick={addOpcUaServer}>
          {t("cfgUi.addOpcUaServer")}
        </button>
        <button style={S.btn("ghost")} onClick={addHomeAssistant}>
          {t("cfgUi.addHomeassistant")}
        </button>
        <button style={S.btn("ghost")} onClick={addS7}>
          {t("cfgUi.addS7Siemens")}
        </button>
        <button style={S.btn("ghost")} onClick={addEnIp}>
          {t("cfgUi.addEthernetIpAllenBradley")}
        </button>
        <button style={S.btn("ghost")} onClick={addHost}>
          {t("cfgUi.addHost")}
        </button>
      </div>

      {tagInAttesa.length > 0 && (
        <div style={{ ...S.notice, marginTop: 12 }}>
          {t("cfgUi.tagInAttesa", { n: tagInAttesa.length, ids: tagInAttesa.map((x) => x.id).join(", ") })}
        </div>
      )}
    </div>
  );
}
