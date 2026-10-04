import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QuickCreateTagModal } from "@/components/QuickCreateTagModal";
import type { ModbusTcpSource, RegisterMapping, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { emptyRegister } from "@/config/sorgenti/vuote";
import { CampoOrdineModbus, TabellaRegistriModbus } from "@/config/sorgenti/TabellaRegistriModbus";

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
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);

  const setField = <K extends keyof ModbusTcpSource>(k: K, v: ModbusTcpSource[K]) =>
    onChange({ ...source, [k]: v });

  const setRegister = (idx: number, patch: Partial<RegisterMapping>) =>
    onChange({
      ...source,
      registers: source.registers.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    });

  const addRegister = () =>
    onChange({ ...source, registers: [...source.registers, emptyRegister()] });

  const removeRegister = (idx: number) =>
    onChange({ ...source, registers: source.registers.filter((_, i) => i !== idx) });

  return (
    <div style={S.card}>
      {/* Card header */}
      <div style={S.cardHead} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "var(--brand-primary, #3b82f6)", fontWeight: 700, letterSpacing: 1 }}>
            MODBUS TCP
          </span>
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{source.id}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>
            {source.host}:{source.port} — {source.registers.length} registri
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
          {/* Connection parameters */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 80px 80px",
            gap: 12,
            marginBottom: 16,
          }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.sourceId")}</label>
              <input
                style={S.input}
                value={source.id}
                onChange={(e) => setField("id", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.hostIp")}</label>
              <input
                style={S.input}
                value={source.host}
                onChange={(e) => setField("host", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.port")}</label>
              <input
                style={S.input}
                type="number"
                min={1} max={65535}
                value={source.port}
                onChange={(e) => setField("port", Number(e.target.value))}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.unitId")}</label>
              <input
                style={S.input}
                type="number"
                min={0} max={255}
                value={source.unit_id}
                onChange={(e) => setField("unit_id", Number(e.target.value))}
              />
            </div>
          </div>

          <div style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "160px 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.pollInterval")}</label>
              <input
                style={S.input}
                type="number"
                min={100}
                value={source.poll_interval_ms}
                onChange={(e) => setField("poll_interval_ms", Number(e.target.value))}
              />
            </div>
            <CampoOrdineModbus value={source.ordine} onChange={(o) => setField("ordine", o === "abcd" ? undefined : o)} />
          </div>

          <TabellaRegistriModbus registri={source.registers} setRegister={setRegister} removeRegister={removeRegister}
            onQuickCreate={(rowIdx, prefill) => setQuickCreate({ rowIdx, prefill })} />

          <button style={S.btn("ghost")} onClick={addRegister}>
            {t("cfgUi.addRegister")}
          </button>
        </div>
      )}
      {quickCreate !== null && (
        <QuickCreateTagModal
          initialId={quickCreate.prefill}
          onConfirm={(tag) => {
            onCreateTag(tag);
            setRegister(quickCreate.rowIdx, { tag: tag.id });
          }}
          onClose={() => setQuickCreate(null)}
        />
      )}
    </div>
  );
}
