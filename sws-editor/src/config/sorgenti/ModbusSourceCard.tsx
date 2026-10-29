import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModbusTcpSource, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { useAppStore } from "@/store";
import { busImplicito, conDispositivi, dispositiviDi, focusDispositivo, nuovoDispositivo } from "@/config/sorgenti/modbusDispositivi";
import { DispositivoModbusCard, ElencoDispositiviModbus } from "@/config/sorgenti/DispositiviModbus";
import { SezioneSorgente } from "@/config/sorgenti/card/SezioneSorgente";
import { TestataSorgente } from "@/config/sorgenti/card/TestataSorgente";
import { DisponibilitaSezione } from "@/config/sorgenti/card/DisponibilitaSezione";

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

  const etichetta = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;

  return (
    <div style={S.card}>
      <TestataSorgente
        tipo="MODBUS TCP"
        colore="var(--brand-primary-testo, #3b82f6)"
        id={source.id}
        riepilogo={`${source.host}:${source.port} · ${t("cfg.modbusNDispositivi", { count: n })}`}
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
                <input style={S.input} type="number" min={1} max={65535} value={source.port}
                  onChange={(e) => setField("port", Number(e.target.value))} />
              </div>
              <div>
                <label style={etichetta}>{t("cfg.pollInterval")}</label>
                <input style={S.input} type="number" min={100} value={source.poll_interval_ms}
                  title={t("cfg.modbusPollPredefinito")}
                  onChange={(e) => setField("poll_interval_ms", Number(e.target.value))} />
              </div>
              <div>
                <label style={etichetta}>{t("cfg.sourceId")}</label>
                <input style={S.input} value={source.id} onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
              </div>
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
        </div>
      )}
    </div>
  );
}
