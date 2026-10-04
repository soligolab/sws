import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModbusTcpSource } from "@/types";
import { S } from "@/config/comuni";
import { dispositiviDi } from "@/config/sorgenti/modbusDispositivi";
import { ElencoDispositiviModbus, PallinoStato } from "@/config/sorgenti/DispositiviModbus";
import { useStatoSorgenti } from "@/config/sorgenti/statoSorgenti";

/** Il bus Modbus TCP (04-10-2026): l'indirizzo, il polling predefinito e i
 *  dispositivi dietro quell'indirizzo (più unit id = un gateway). Le mappature
 *  stanno nella card di ogni dispositivo. */
export function ModbusSourceCard({
  source,
  onChange,
  onDelete,
}: {
  source: ModbusTcpSource;
  onChange: (s: ModbusTcpSource) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const stato = useStatoSorgenti()[source.id];

  const setField = <K extends keyof ModbusTcpSource>(k: K, v: ModbusTcpSource[K]) =>
    onChange({ ...source, [k]: v });

  const etichetta = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 } as const;

  return (
    <div style={S.card}>
      <div style={S.cardHead} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PallinoStato stato={stato} testid={`stato-bus-${source.id}`} />
          <span style={{ fontSize: 11, color: "var(--brand-primary, #3b82f6)", fontWeight: 700, letterSpacing: 1 }}>
            MODBUS TCP
          </span>
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{source.id}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>
            {source.host}:{source.port} — {t("cfg.modbusNDispositivi", { count: dispositiviDi(source).length })}
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
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 80px 140px",
            gap: 12,
            marginBottom: 16,
          }}>
            <div>
              <label style={etichetta}>{t("cfg.sourceId")}</label>
              <input style={S.input} value={source.id} onChange={(e) => setField("id", e.target.value)} spellCheck={false} />
            </div>
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
          </div>

          <ElencoDispositiviModbus bus={source} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
