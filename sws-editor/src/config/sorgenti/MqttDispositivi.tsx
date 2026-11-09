import { useTranslation } from "react-i18next";
import type { DispositivoMqtt, MqttSource, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { useAppStore } from "@/store";
import { allarmeDisponibilitaDispositivo, tagDisponibilitaDispositivo } from "@/config/sorgenti/disponibilita";
import {
  PRESET_DISPOSITIVO, disponibilitaDaPreset, presetDelDispositivo, raggruppaDaiTopic, type PresetDispositivo,
} from "@/config/sorgenti/dispositiviMqtt";
import { statoDispositivo, useStatoSorgenti } from "@/config/sorgenti/statoSorgenti";
import { PallinoStato } from "@/config/sorgenti/DispositiviModbus";
import { SezioneSorgente } from "@/config/sorgenti/card/SezioneSorgente";

const NESSUNO: never[] = [];

/** La sezione DISPOSITIVI di una sorgente MQTT (08-11-2026, piano
 *  `docs/archive/2026-11-08-mqtt-dispositivi.md`).
 *
 *  Nasce dal collaudo della presa Sandokan, lo stesso giorno: la disponibilità
 *  di sorgente funziona, ma è una per sorgente, e una casa ha trenta
 *  dispositivi dietro lo stesso broker. Qui ognuno ha il suo topic, il suo
 *  pallino, il suo tag `<sorgente>.<dispositivo>.disponibile` e il suo
 *  allarme; le righe della mappatura dicono di chi sono nella colonna
 *  «Dispositivo». */
export function MqttDispositiviSection({
  source,
  onChange,
  onCreateTag,
}: {
  source: MqttSource;
  onChange: (s: MqttSource) => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const { t } = useTranslation();
  const stato = useStatoSorgenti()[source.id];
  const allarmi = useAppStore((s) => s.project?.alarms ?? NESSUNO);
  const aggiungiTagInAttesa = useAppStore((s) => s.aggiungiTagInAttesa);
  const preparaAllarme = useAppStore((s) => s.preparaAllarme);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const dispositivi = source.dispositivi ?? [];
  const raggruppabili = raggruppaDaiTopic(source.topics, dispositivi);

  const tagDef = (d: string): TagDef => ({
    id: tagDisponibilitaDispositivo(source.id, d),
    description: t("sorgenti.dispositivi.descrizioneTag", { id: d, sorgente: source.id }),
    data_type: "bool",
  });
  const dichiara = (nuovi: DispositivoMqtt[]) => nuovi.forEach((d) => onCreateTag(tagDef(d.id)));

  const cambia = (i: number, d: DispositivoMqtt) => {
    const prima = dispositivi[i].id;
    onChange({
      ...source,
      dispositivi: dispositivi.map((x, j) => (j === i ? d : x)),
      // Rinominare un dispositivo si porta dietro le sue righe.
      topics: prima === d.id ? source.topics
        : source.topics.map((r) => (r.dispositivo === prima ? { ...r, dispositivo: d.id } : r)),
    });
  };
  const togli = (i: number) => {
    const via = dispositivi[i].id;
    onChange({
      ...source,
      dispositivi: dispositivi.filter((_, j) => j !== i),
      topics: source.topics.map((r) => (r.dispositivo === via ? { ...r, dispositivo: undefined } : r)),
    });
  };
  const aggiungi = () => {
    const d: DispositivoMqtt = { id: "", disponibilita: { topic: "", vivo: "online" } };
    onChange({ ...source, dispositivi: [...dispositivi, d] });
  };
  const raggruppa = () => {
    onChange({ ...source, topics: raggruppabili.righe, dispositivi: [...dispositivi, ...raggruppabili.nuovi] });
    dichiara(raggruppabili.nuovi);
  };

  return (
    <SezioneSorgente
      titolo={`${t("sorgenti.dispositivi.titolo")} (${dispositivi.length})`}
      apribile
      // Chiusa solo quando non c'è niente da fare: con delle righe da
      // raggruppare il pulsante deve vedersi.
      chiusaDiPartenza={dispositivi.length === 0 && raggruppabili.assegnate === 0}
      riepilogo={t("sorgenti.dispositivi.riepilogo", { count: dispositivi.length })}
      testid={`mqtt-dispositivi-${source.id}`}
    >
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 8, lineHeight: 1.4 }}>
        {t("sorgenti.dispositivi.nota")}
      </div>
      {dispositivi.length > 0 && (
        <table style={{ ...S.table, marginBottom: 8 }}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 20 }} />
              <th style={{ ...S.th, width: "20%" }}>{t("sorgenti.dispositivi.id")}</th>
              <th style={{ ...S.th, width: "13%" }}>{t("sorgenti.disponibilita.chi")}</th>
              <th style={{ ...S.th, width: "30%" }}>{t("cfg.topic")}</th>
              <th style={{ ...S.th, width: "9%" }}>{t("cfg.jsonPathOpt")}</th>
              <th style={{ ...S.th, width: "9%" }}>{t("sorgenti.disponibilita.vivo")}</th>
              <th style={{ ...S.th, width: "5%" }}>{t("sorgenti.dispositivi.righe")}</th>
              <th style={S.th} />
            </tr>
          </thead>
          <tbody>
            {dispositivi.map((d, i) => {
              const tag = tagDisponibilitaDispositivo(source.id, d.id);
              const esistente = allarmi.find((a) => a.tag.trim() === tag);
              const righe = source.topics.filter((r) => r.dispositivo === d.id).length;
              const preset = presetDelDispositivo(d);
              const set = (patch: Partial<DispositivoMqtt["disponibilita"]>) =>
                cambia(i, { ...d, disponibilita: { ...d.disponibilita, ...patch } });
              return (
                <tr key={i} data-testid={`mqtt-dispositivo-${i}`}>
                  <td style={S.td}>
                    <PallinoStato stato={statoDispositivo(stato, d.id)} testid={`mqtt-dispositivo-stato-${d.id}`} />
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} value={d.id} spellCheck={false} title={tag} data-testid={`mqtt-dispositivo-id-${i}`}
                      placeholder="presa.cucina"
                      onChange={(e) => cambia(i, { ...d, id: e.target.value })} />
                  </td>
                  <td style={S.td}>
                    <select style={{ ...S.inputSm, cursor: "pointer" }} value={preset} data-testid={`mqtt-dispositivo-preset-${i}`}
                      onChange={(e) => {
                        const k = e.target.value;
                        if (k !== "personalizzato") cambia(i, { ...d, disponibilita: disponibilitaDaPreset(k as PresetDispositivo, d.id) });
                      }}>
                      {(Object.keys(PRESET_DISPOSITIVO) as PresetDispositivo[]).map((k) => (
                        <option key={k} value={k}>{t(`sorgenti.dispositivi.preset.${k}`)}</option>
                      ))}
                      <option value="personalizzato">{t("sorgenti.disponibilita.personalizzato")}</option>
                    </select>
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} value={d.disponibilita.topic} spellCheck={false}
                      onChange={(e) => set({ topic: e.target.value })} />
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} value={d.disponibilita.json_path ?? ""} spellCheck={false}
                      onChange={(e) => set({ json_path: e.target.value || undefined })} />
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} value={d.disponibilita.vivo} spellCheck={false}
                      onChange={(e) => set({ vivo: e.target.value })} />
                  </td>
                  <td style={{ ...S.td, textAlign: "center", color: righe ? undefined : "var(--brand-warning, #f59e0b)" }}
                    title={righe ? undefined : t("sorgenti.dispositivi.senzaRighe")}>
                    {righe}
                  </td>
                  <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }}>
                    {esistente ? (
                      <button style={{ ...S.btn("ghost"), marginRight: 4 }} onClick={() => navigateToConfig("alarms", esistente.id)}>
                        {t("sorgenti.disponibilita.vaiAllarme")}
                      </button>
                    ) : (
                      <button style={{ ...S.btn("ghost"), marginRight: 4 }} data-testid={`mqtt-dispositivo-allarme-${i}`}
                        disabled={!d.id.trim()} title={t("sorgenti.disponibilita.creaAllarme")}
                        onClick={() => {
                          aggiungiTagInAttesa(tagDef(d.id));
                          preparaAllarme(allarmeDisponibilitaDispositivo(source.id, d.id,
                            t("sorgenti.dispositivi.messaggio", { id: d.id })));
                        }}>
                        ⚠ {t("sorgenti.dispositivi.allarme")}
                      </button>
                    )}
                    <button style={S.btn("danger")} onClick={() => togli(i)}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <button style={S.btn("ghost")} onClick={aggiungi}>{t("sorgenti.dispositivi.aggiungi")}</button>
      {raggruppabili.assegnate > 0 && (
        <button style={{ ...S.btn("ghost"), marginLeft: 8 }} data-testid="mqtt-raggruppa"
          title={t("sorgenti.dispositivi.raggruppaTitolo")} onClick={raggruppa}>
          {t("sorgenti.dispositivi.raggruppa", { count: raggruppabili.assegnate })}
        </button>
      )}
    </SezioneSorgente>
  );
}
