import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModbusTcpSource, TagDef, TrasportoTcp } from "@/types";
import { S } from "@/config/comuni";
import { useAppStore } from "@/store";
import { busImplicito, conDispositivi, dispositiviDi, focusDispositivo, nuovoDispositivo } from "@/config/sorgenti/modbusDispositivi";
import { DispositivoModbusCard, ElencoDispositiviModbus } from "@/config/sorgenti/DispositiviModbus";
import { SezioneSorgente } from "@/config/sorgenti/card/SezioneSorgente";
import { TestataSorgente } from "@/config/sorgenti/card/TestataSorgente";
import { DisponibilitaSezione } from "@/config/sorgenti/card/DisponibilitaSezione";
import { CampoNumero } from "@/components/CampoNumero";

/** Il bus Modbus TCP (04-10-2026): l'indirizzo, il polling predefinito e i
 *  dispositivi dietro quell'indirizzo (più unit id = un gateway). Le mappature
 *  stanno nella card di ogni dispositivo.
 *
 *  **Con un dispositivo solo il bus è implicito** (25-10-2026): la card del
 *  dispositivo sta qui dentro, al posto dell'elenco, e un pulsante aggiunge un
 *  secondo unit id dietro lo stesso indirizzo — da lì il bus torna un livello. */
export function ModbusSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: ModbusTcpSource;
  onChange: (s: ModbusTcpSource) => void;
  onDelete: () => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const { t } = useTranslation();
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const implicito = busImplicito(source);
  const [open, setOpen] = useState(true);
  const n = dispositiviDi(source).length;

  const setField = <K extends keyof ModbusTcpSource>(k: K, v: ModbusTcpSource[K]) =>
    onChange({ ...source, [k]: v });

  const trasporto = source.trasporto ?? "mbap";
  // Le porte di fabbrica seguono il trasporto, finché nessuno le ha cambiate a
  // mano: 502 per il Modbus TCP, 8899 per le chiavette Solarman.
  const cambiaTrasporto = (v: TrasportoTcp) => {
    const porta = source.port === 502 && v === "solarman_v5" ? 8899 : source.port === 8899 && v !== "solarman_v5" ? 502 : source.port;
    onChange({ ...source, trasporto: v === "mbap" ? undefined : v, port: porta });
  };

  const etichetta = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;

  return (
    <div style={S.card}>
      <TestataSorgente
        tipo="MODBUS TCP"
        colore="var(--brand-primary-testo, #3b82f6)"
        id={source.id}
        riepilogo={`${source.host}:${source.port}${trasporto === "mbap" ? "" : ` · ${t(trasporto === "solarman_v5" ? "sorgenti.modbusTcp.trasportoSolarman" : "sorgenti.modbusTcp.trasportoRtu")}`} · ${t("cfg.modbusNDispositivi", { count: n })}`}
        aperta={open}
        onToggle={() => setOpen((v) => !v)}
        azioni={<button style={S.btn("danger")} onClick={onDelete}>{t("cfgUi.delete")}</button>}
      />

      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          {/* L'indirizzo per primo, l'ID sorgente per ultimo (29-10-2026). */}
          <SezioneSorgente titolo={t("sorgenti.sezioni.collegamento")}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 80px 140px 1.2fr", gap: 12, marginBottom: 8 }}>
              <div>
                <label style={etichetta}>{t("cfg.hostIp")}</label>
                <input style={S.input} value={source.host} onChange={(e) => setField("host", e.target.value)} spellCheck={false} />
              </div>
              <div>
                <label style={etichetta}>{t("cfg.port")}</label>
                <CampoNumero style={S.input} min={1} max={65535} value={source.port}
                  onTesto={(e) => setField("port", Number(e))} />
              </div>
              <div>
                <label style={etichetta}>{t("cfg.pollInterval")}</label>
                <CampoNumero style={S.input} min={100} value={source.poll_interval_ms}
                  title={t("cfg.modbusPollPredefinito")}
                  onTesto={(e) => setField("poll_interval_ms", Number(e))} />
              </div>
              <div>
                <label style={etichetta}>{t("cfg.sourceId")}</label>
                <input style={S.input} value={source.id} onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 8 }}>
              <div>
                <label style={etichetta}>{t("sorgenti.modbusTcp.trasporto")}</label>
                <select style={S.input} value={trasporto} title={t("sorgenti.modbusTcp.trasportoHint")}
                  data-testid={`modbus-trasporto-${source.id}`}
                  onChange={(e) => cambiaTrasporto(e.target.value as TrasportoTcp)}>
                  <option value="mbap">{t("sorgenti.modbusTcp.trasportoMbap")}</option>
                  <option value="rtu_su_tcp">{t("sorgenti.modbusTcp.trasportoRtu")}</option>
                  <option value="solarman_v5">{t("sorgenti.modbusTcp.trasportoSolarman")}</option>
                </select>
              </div>
              {trasporto === "solarman_v5" && (
                <div>
                  <label style={etichetta}>{t("sorgenti.modbusTcp.serialeLogger")}</label>
                  <CampoNumero style={S.input} min={0} value={source.seriale_logger ?? ""}
                    title={t("sorgenti.modbusTcp.serialeLoggerHint")}
                    onTesto={(e) => setField("seriale_logger", e === "" ? undefined : Number(e))} />
                </div>
              )}
            </div>
          </SezioneSorgente>

          <DisponibilitaSezione src={source} />

          {/* Il pulsante «è un gateway» sta qui e non in AVANZATE: aggiungere un
              secondo unit id dietro lo stesso indirizzo è una cosa che si fa,
              e nascosta in una sezione chiusa non la si troverebbe. */}
          <SezioneSorgente titolo={`${t("sorgenti.sezioni.dispositivi")} (${n})`}>
            {implicito ? (
              <>
                <DispositivoModbusCard bus={source} unit={dispositiviDi(source)[0].unit_id} onChange={onChange} onCreateTag={onCreateTag} />
                <button
                  style={S.btn("ghost")}
                  data-testid={`modbus-gateway-${source.id}`}
                  title={t("cfg.modbusGatewayHint")}
                  onClick={() => {
                    const d = nuovoDispositivo(source);
                    onChange(conDispositivi(source, [...dispositiviDi(source), d]));
                    navigateToConfig("protocols", focusDispositivo(source.id, d.unit_id));
                  }}
                >
                  {t("cfg.modbusGateway")}
                </button>
              </>
            ) : (
              <ElencoDispositiviModbus bus={source} onChange={onChange} />
            )}
          </SezioneSorgente>

          <SezioneSorgente titolo={t("sorgenti.sezioni.avanzate")} apribile chiusaDiPartenza
            riepilogo={t("sorgenti.modbusTcp.riepilogoAvanzate", { pausa: source.pausa_ms ?? 0, tentativi: source.tentativi ?? 0 })}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={etichetta}>{t("sorgenti.modbusTcp.pausa")}</label>
                <CampoNumero style={S.input} min={0} value={source.pausa_ms ?? 0} title={t("sorgenti.modbusTcp.pausaHint")}
                  onTesto={(e) => setField("pausa_ms", Number(e) || undefined)} />
              </div>
              <div>
                <label style={etichetta}>{t("sorgenti.modbusTcp.tentativi")}</label>
                <CampoNumero style={S.input} min={0} max={10} value={source.tentativi ?? 0} title={t("sorgenti.modbusTcp.tentativiHint")}
                  onTesto={(e) => setField("tentativi", Number(e) || undefined)} />
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 8 }}
              title={t("sorgenti.modbusTcp.diagnosticaHint", { id: source.id })}>
              <input type="checkbox" checked={!!source.diagnostica} onChange={(e) => setField("diagnostica", e.target.checked || undefined)} />
              {t("sorgenti.modbusTcp.diagnostica")}
            </label>
          </SezioneSorgente>
        </div>
      )}
    </div>
  );
}
