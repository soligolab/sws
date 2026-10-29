import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModbusRtuSource } from "@/types";
import { S } from "@/config/comuni";
import { dispositiviDi } from "@/config/sorgenti/modbusDispositivi";
import { ElencoDispositiviModbus } from "@/config/sorgenti/DispositiviModbus";
import { SezioneSorgente } from "@/config/sorgenti/card/SezioneSorgente";
import { TestataSorgente } from "@/config/sorgenti/card/TestataSorgente";
import { DisponibilitaSezione } from "@/config/sorgenti/card/DisponibilitaSezione";
import { CampoPortaSeriale } from "@/config/sorgenti/CampoPortaSeriale";

// ── Modbus RTU: il bus ────────────────────────────────────────────────────────

/** La linea seriale (04-10-2026): la porta e i suoi parametri, il polling
 *  predefinito e gli slave sulla linea. La porta si apre una volta sola, gli
 *  slave si interrogano a turno; le mappature stanno nella card di ogni slave. */
export function ModbusRtuSourceCard({
  source,
  onChange,
  onDelete,
}: {
  source: ModbusRtuSource;
  onChange: (s: ModbusRtuSource) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const n = dispositiviDi(source).length;
  const etichetta = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;

  const setField = <K extends keyof ModbusRtuSource>(k: K, v: ModbusRtuSource[K]) =>
    onChange({ ...source, [k]: v });

  return (
    <div style={S.card}>
      <TestataSorgente
        tipo="MODBUS RTU"
        colore="var(--brand-warning, #f59e0b)"
        id={source.id}
        riepilogo={`${source.device} · ${source.baud_rate} baud · ${t("cfg.modbusNDispositivi", { count: n })}`}
        aperta={open}
        onToggle={() => setOpen((v) => !v)}
        azioni={<button style={S.btn("danger")} onClick={onDelete}>{t("cfgUi.delete")}</button>}
      />

      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          {/* La linea seriale prima, poi il polling e l'ID sorgente, che si
              tocca quasi mai (29-10-2026). */}
          <SezioneSorgente titolo={t("sorgenti.sezioni.collegamento")}>
            <div style={{ display: "grid", gridTemplateColumns: "280px 110px 120px 80px 80px", gap: 12, marginBottom: 10 }}>
              <CampoPortaSeriale value={source.device} onChange={(v) => setField("device", v)} idLista={`porte-${source.id}`} />
              <div>
                <label style={etichetta}>{t("cfg.baudRate")}</label>
                <input style={S.input} type="number" min={1200} max={921600} step={100}
                  value={source.baud_rate}
                  onChange={(e) => setField("baud_rate", Number(e.target.value))} />
              </div>
              <div>
                <label style={etichetta}>{t("cfg.parity")}</label>
                <select style={S.input} value={source.parity}
                  onChange={(e) => setField("parity", e.target.value)}>
                  <option value="N">{t("cfgUi.noneN")}</option>
                  <option value="E">{t("sorgenti.pari")}</option>
                  <option value="O">{t("sorgenti.dispari")}</option>
                </select>
              </div>
              <div>
                <label style={etichetta}>{t("cfg.dataBits")}</label>
                <select style={S.input} value={source.data_bits}
                  onChange={(e) => setField("data_bits", Number(e.target.value))}>
                  <option value={8}>8</option>
                  <option value={7}>7</option>
                </select>
              </div>
              <div>
                <label style={etichetta}>{t("cfg.stopBits")}</label>
                <select style={S.input} value={source.stop_bits}
                  onChange={(e) => setField("stop_bits", Number(e.target.value))}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12, marginBottom: 8 }}>
              <div>
                <label style={etichetta}>{t("cfg.pollInterval")}</label>
                <input style={S.input} type="number" min={100}
                  value={source.poll_interval_ms} title={t("cfg.modbusPollPredefinito")}
                  onChange={(e) => setField("poll_interval_ms", Number(e.target.value))} />
              </div>
              <div>
                <label style={etichetta}>{t("cfg.sourceId")}</label>
                <input style={{ ...S.input, maxWidth: 280 }} value={source.id}
                  onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
              </div>
            </div>
          </SezioneSorgente>

          <DisponibilitaSezione src={source} />

          <SezioneSorgente titolo={`${t("sorgenti.sezioni.dispositivi")} (${n})`}>
            <ElencoDispositiviModbus bus={source} onChange={onChange} />
          </SezioneSorgente>
        </div>
      )}
    </div>
  );
}
