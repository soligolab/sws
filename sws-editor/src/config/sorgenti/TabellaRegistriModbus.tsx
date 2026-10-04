import { useTranslation } from "react-i18next";
import { TagInput } from "@/components/TagInput";
import { useAppStore } from "@/store";
import type { OrdineModbus, RegisterMapping } from "@/types";
import { S } from "@/config/comuni";
import { registriMappatura, type AreaModbus } from "@/config/sorgenti/modbusRegistri";

const AREE: AreaModbus[] = ["holding", "input", "coil", "discrete"];
/** I formati sul filo (catalogo, 04-10-2026): «dal tipo» è il vuoto. */
const FORMATI = ["", "i16", "u16", "i32", "u32", "f32", "i64", "u64", "f64"];
const ORDINI: OrdineModbus[] = ["abcd", "cdab", "badc", "dcba"];

/** Ordine di parole e byte della sorgente (Fase 3, 04-10-2026). */
export function CampoOrdineModbus({ value, onChange }: { value: OrdineModbus | undefined; onChange: (o: OrdineModbus) => void }) {
  const { t } = useTranslation();
  return (
    <div>
      <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.modbusOrdine")}</label>
      <select style={S.input} value={value ?? "abcd"} onChange={(e) => onChange(e.target.value as OrdineModbus)} title={t("cfg.modbusOrdineHint")}>
        {ORDINI.map((o) => <option key={o} value={o}>{t(`cfg.modbusOrdini.${o}`)}</option>)}
      </select>
    </div>
  );
}

/** La tabella delle mappature, la stessa per Modbus TCP e RTU (prima erano due
 *  copie). Le colonne nuove della Fase 3: l'area e i registri **calcolati** dal
 *  tipo del tag — non si scrivono a mano. */
export function TabellaRegistriModbus({ registri, setRegister, removeRegister, onQuickCreate }: {
  registri: RegisterMapping[];
  setRegister: (idx: number, patch: Partial<RegisterMapping>) => void;
  removeRegister: (idx: number) => void;
  onQuickCreate: (idx: number, prefill: string) => void;
}) {
  const { t } = useTranslation();
  const project = useAppStore((s) => s.project);
  return (
    <>
      <div style={{ marginBottom: 6, fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontWeight: 600, letterSpacing: 0.5 }}>
        {t("cfg.modbusMappature")}
      </div>
      <table style={{ ...S.table, marginBottom: 8 }}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: "28%" }}>{t("cfg.variableTagId")}</th>
            <th style={{ ...S.th, width: "13%" }}>{t("cfg.modbusArea")}</th>
            <th style={{ ...S.th, width: "9%" }}>{t("cfg.registerAddr")}</th>
            <th style={{ ...S.th, width: "10%" }} title={t("cfg.modbusFormatoHint")}>{t("cfg.modbusFormato")}</th>
            <th style={{ ...S.th, width: "7%" }} title={t("cfg.modbusBitHint")}>{t("cfg.modbusBitCol")}</th>
            <th style={{ ...S.th, width: "9%" }}>{t("cfg.scale")}</th>
            <th style={{ ...S.th, width: "5%" }} title={t("cfg.modbusSolaLetturaHint")}>{t("cfg.modbusSolaLettura")}</th>
            <th style={{ ...S.th, width: "14%" }}>{t("cfg.modbusRegistri")}</th>
            <th style={S.th} />
          </tr>
        </thead>
        <tbody>
          {registri.length === 0 && (
            <tr>
              <td colSpan={9} style={{ ...S.td, color: "var(--brand-text-subtle, #94a3b8)", textAlign: "center", padding: 12 }}>
                {t("cfgUi.noRegistersAddAMapping")}
              </td>
            </tr>
          )}
          {registri.map((r, i) => {
            const reg = registriMappatura(r.tag, r.area, project, r);
            const scalaAttiva = reg.storico || !!r.formato;
            const aBit = r.area === "coil" || r.area === "discrete";
            return (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)33" }}>
                <td style={S.td}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <TagInput style={S.inputSm} placeholder="pump1.speed" value={r.tag} onChange={(v) => setRegister(i, { tag: v })} />
                    <button style={{ ...S.btn("ghost"), padding: "4px 7px", fontSize: 14, lineHeight: 1 }} title={t("cfg.createTag")}
                      onClick={() => onQuickCreate(i, r.tag)}>＋</button>
                  </div>
                </td>
                <td style={S.td}>
                  <select style={S.inputSm} value={r.area ?? "holding"}
                    onChange={(e) => setRegister(i, { area: e.target.value === "holding" ? undefined : e.target.value as AreaModbus })}>
                    {AREE.map((a) => <option key={a} value={a}>{t(`cfg.modbusAree.${a}`)}</option>)}
                  </select>
                </td>
                <td style={S.td}>
                  <input style={S.inputSm} type="number" min={0} value={r.address}
                    onChange={(e) => setRegister(i, { address: Number(e.target.value) })} />
                </td>
                <td style={S.td}>
                  <select style={S.inputSm} value={r.formato ?? ""} disabled={aBit || r.bit !== undefined}
                    onChange={(e) => setRegister(i, { formato: e.target.value || undefined })}>
                    {FORMATI.map((f) => <option key={f} value={f}>{f || t("cfg.modbusDalTipo")}</option>)}
                  </select>
                </td>
                <td style={S.td}>
                  <input style={S.inputSm} type="number" min={0} max={15} value={r.bit ?? ""} disabled={aBit}
                    onChange={(e) => setRegister(i, { bit: e.target.value === "" ? undefined : Math.max(0, Math.min(15, Number(e.target.value))) })} />
                </td>
                <td style={S.td}>
                  <input style={S.inputSm} type="number" step="0.001" value={r.scale}
                    onChange={(e) => setRegister(i, { scale: Number(e.target.value) })}
                    disabled={!scalaAttiva} title={scalaAttiva ? undefined : t("cfg.modbusScalaSoloStorici")} />
                </td>
                <td style={{ ...S.td, textAlign: "center" }}>
                  <input type="checkbox" checked={!!r.sola_lettura} title={t("cfg.modbusSolaLetturaHint")}
                    onChange={(e) => setRegister(i, { sola_lettura: e.target.checked || undefined })} />
                </td>
                <td style={{ ...S.td, color: "var(--brand-text-subtle, #64748b)", fontSize: 11 }}
                  title={reg.storico ? t("cfg.modbusStoricoHint") : undefined}>
                  {t(aBit ? "cfg.modbusBit" : "cfg.modbusRegistriN", { n: reg.n, tipo: reg.dettaglio })}
                  {reg.storico && " " + t("cfg.modbusComePrima")}
                </td>
                <td style={{ ...S.td, textAlign: "right" }}>
                  <button style={S.btn("danger")} onClick={() => removeRegister(i)}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
