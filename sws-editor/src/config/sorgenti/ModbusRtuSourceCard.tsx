import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModbusRtuSource } from "@/types";
import { S } from "@/config/comuni";
import { dispositiviDi } from "@/config/sorgenti/modbusDispositivi";
import { ElencoDispositiviModbus, PallinoStato } from "@/config/sorgenti/DispositiviModbus";
import { useStatoSorgenti } from "@/config/sorgenti/statoSorgenti";

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
  const stato = useStatoSorgenti()[source.id];

  const setField = <K extends keyof ModbusRtuSource>(k: K, v: ModbusRtuSource[K]) =>
    onChange({ ...source, [k]: v });

  return (
    <div style={S.card}>
      <div style={S.cardHead} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PallinoStato stato={stato} testid={`stato-bus-${source.id}`} />
          <span style={{ fontSize: 11, color: "var(--brand-warning, #f59e0b)", fontWeight: 700, letterSpacing: 1 }}>
            MODBUS RTU
          </span>
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{source.id}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>
            {source.device} — {source.baud_rate} baud — {t("cfg.modbusNDispositivi", { count: dispositiviDi(source).length })}
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
          {/* Serial port parameters */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 120px 80px 80px 80px 80px",
            gap: 12,
            marginBottom: 16,
          }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.sourceId")}</label>
              <input style={S.input} value={source.id}
                onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.serialDevice")}</label>
              <input style={S.input} value={source.device}
                onChange={(e) => setField("device", e.target.value)} spellCheck={false}
                placeholder="/dev/ttyUSB0" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.baudRate")}</label>
              <input style={S.input} type="number" min={1200} max={921600} step={100}
                value={source.baud_rate}
                onChange={(e) => setField("baud_rate", Number(e.target.value))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.parity")}</label>
              <select style={S.input} value={source.parity}
                onChange={(e) => setField("parity", e.target.value)}>
                <option value="N">{t("cfgUi.noneN")}</option>
                <option value="E">Pari (E)</option>
                <option value="O">Dispari (O)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.dataBits")}</label>
              <select style={S.input} value={source.data_bits}
                onChange={(e) => setField("data_bits", Number(e.target.value))}>
                <option value={8}>8</option>
                <option value={7}>7</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.stopBits")}</label>
              <select style={S.input} value={source.stop_bits}
                onChange={(e) => setField("stop_bits", Number(e.target.value))}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "160px 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.pollInterval")}</label>
              <input style={S.input} type="number" min={100}
                value={source.poll_interval_ms} title={t("cfg.modbusPollPredefinito")}
                onChange={(e) => setField("poll_interval_ms", Number(e.target.value))} />
            </div>
          </div>

          <ElencoDispositiviModbus bus={source} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
