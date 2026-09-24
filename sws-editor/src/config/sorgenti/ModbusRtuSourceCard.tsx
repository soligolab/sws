import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QuickCreateTagModal } from "@/components/QuickCreateTagModal";
import { TagInput } from "@/components/TagInput";
import type { ModbusRtuSource, RegisterMapping, TagDef } from "@/types";
import { S } from "@/config/comuni";
import { emptyRegister } from "@/config/sorgenti/vuote";

// ── Modbus RTU card ───────────────────────────────────────────────────────────

export function ModbusRtuSourceCard({
  source,
  onChange,
  onDelete,
  onCreateTag,
}: {
  source: ModbusRtuSource;
  onChange: (s: ModbusRtuSource) => void;
  onDelete: () => void;
  onCreateTag: (tag: TagDef) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [quickCreate, setQuickCreate] = useState<{ rowIdx: number; prefill: string } | null>(null);

  const setField = <K extends keyof ModbusRtuSource>(k: K, v: ModbusRtuSource[K]) =>
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
      <div style={S.cardHead} onClick={() => setOpen((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "var(--brand-warning, #f59e0b)", fontWeight: 700, letterSpacing: 1 }}>
            MODBUS RTU
          </span>
          <span style={{ fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{source.id}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12 }}>
            {source.device} — {source.baud_rate} baud — {source.registers.length} registri
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

          <div style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "80px 160px 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.unitId")}</label>
              <input style={S.input} type="number" min={0} max={255}
                value={source.unit_id}
                onChange={(e) => setField("unit_id", Number(e.target.value))} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.pollInterval")}</label>
              <input style={S.input} type="number" min={100}
                value={source.poll_interval_ms}
                onChange={(e) => setField("poll_interval_ms", Number(e.target.value))} />
            </div>
          </div>

          {/* Register mappings — shared structure with Modbus TCP */}
          <div style={{ marginBottom: 6, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
            MAPPATURA REGISTRI HOLDING
          </div>
          <table style={{ ...S.table, marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "40%" }}>{t("cfg.variableTagId")}</th>
                <th style={{ ...S.th, width: "20%" }}>{t("cfg.registerAddr")}</th>
                <th style={{ ...S.th, width: "20%" }}>{t("cfg.scale")}</th>
                <th style={{ ...S.th, width: "20%" }}>{t("cfg.dataType")}</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {source.registers.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...S.td, color: "var(--brand-text-subtle, #94a3b8)", textAlign: "center", padding: 12 }}>
                    {t("cfgUi.noRegistersAddAMapping")}
                  </td>
                </tr>
              )}
              {source.registers.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)33" }}>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <TagInput
                        style={S.inputSm}
                        placeholder="pump1.speed"
                        value={r.tag}
                        onChange={(v) => setRegister(i, { tag: v })}
                      />
                      <button
                        style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }}
                        title={t("cfg.createTag")}
                        onClick={() => setQuickCreate({ rowIdx: i, prefill: r.tag })}
                      >＋</button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} type="number" min={0}
                      value={r.address}
                      onChange={(e) => setRegister(i, { address: Number(e.target.value) })} />
                  </td>
                  <td style={S.td}>
                    <input style={S.inputSm} type="number" step="0.001"
                      value={r.scale}
                      onChange={(e) => setRegister(i, { scale: Number(e.target.value) })} />
                  </td>
                  <td style={{ ...S.td, color: "var(--brand-text-subtle, #64748b)", fontSize: 11 }}>Float (×scala)</td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <button style={S.btn("danger")} onClick={() => removeRegister(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

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
