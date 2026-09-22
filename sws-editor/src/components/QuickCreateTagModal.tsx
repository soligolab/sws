// Definire una variabile senza uscire da dove la si sta usando: id, tipo,
// unità, descrizione, storico. Non scrive niente: mette la definizione **in
// attesa** nello store, e il Salva unico del progetto la crea insieme a tutto
// il resto (Fase 0b). Prima viveva dentro ConfigView, con tre campi soli e
// senza controllo dei doppioni, ed era una delle cinque strade di creazione.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { OpzioniTipo } from "./OpzioniTipo";
import { normalizzaTipo } from "@/tag/tipiScalari";
import type { TagDataType, TagDef } from "@/types";

const INPUT: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
  color: "var(--brand-text, #e2e8f0)", padding: "6px 8px", fontSize: 12,
};
const LABEL: React.CSSProperties = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 };
const BTN = (primario: boolean): React.CSSProperties => ({
  padding: "6px 14px", borderRadius: 4, fontSize: 12, cursor: "pointer",
  border: "1px solid " + (primario ? "var(--brand-primary, #3b82f6)" : "var(--brand-border, #475569)"),
  background: primario ? "var(--brand-primary, #3b82f6)" : "transparent",
  color: primario ? "var(--brand-on-primary, #0f172a)" : "var(--brand-text, #e2e8f0)",
});

export function QuickCreateTagModal({
  initialId, tipoSuggerito = "f64", onConfirm, onClose,
}: {
  initialId: string;
  /** Il tipo che la mappatura o l'oggetto lasciano intuire: precompila, non impone. */
  tipoSuggerito?: TagDataType;
  /** Riceve la definizione; il chiamante decide se metterla in attesa nello
   *  store (il default) o farne altro. */
  onConfirm: (tag: TagDef) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dichiarati = useAppStore((s) => s.project?.tags);
  const inAttesa = useAppStore((s) => s.tagInAttesa);
  const [id, setId] = useState(initialId.trim());
  const [description, setDescription] = useState("");
  const [dataType, setDataType] = useState<TagDataType>(tipoSuggerito);
  const [unit, setUnit] = useState("");
  const [history, setHistory] = useState(false);

  const esistenti = useMemo(
    () => new Set([...(dichiarati ?? []).map((x) => x.id), ...inAttesa.map((x) => x.id)]),
    [dichiarati, inAttesa],
  );
  const trimmed = id.trim();
  const doppione = trimmed !== "" && esistenti.has(trimmed);
  const puoCreare = trimmed !== "" && !doppione;

  const create = () => {
    if (!puoCreare) return;
    onConfirm({
      id: trimmed, description: description.trim(), data_type: dataType,
      unit: unit.trim() || undefined, history,
    });
    onClose();
  };
  const tasti = (e: React.KeyboardEvent) => { if (e.key === "Enter") create(); if (e.key === "Escape") onClose(); };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8, padding: 20, minWidth: 340, maxWidth: 460 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", marginBottom: 4 }}>{t("cfgUi.createVariable")}</div>
        <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 14 }}>{t("quickTag.intro")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={LABEL}>{t("cfg.tagIdReq")}</label>
            <input style={{ ...INPUT, ...(doppione ? { borderColor: "var(--brand-danger, #ef4444)" } : {}) }} value={id}
                   onChange={(e) => setId(e.target.value)} autoFocus spellCheck={false} onKeyDown={tasti} aria-invalid={doppione || undefined} />
            {doppione && <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #f87171)", marginTop: 3 }}>{t("quickTag.exists")}</div>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={LABEL}>{t("cfg.dataType")}</label>
              <select style={{ ...INPUT, cursor: "pointer" }} value={normalizzaTipo(dataType) ?? "f64"} onChange={(e) => setDataType(e.target.value as TagDataType)}>
                <OpzioniTipo />
              </select>
            </div>
            <div style={{ width: 110 }}>
              <label style={LABEL}>{t("quickTag.unit")}</label>
              <input style={INPUT} value={unit} onChange={(e) => setUnit(e.target.value)} spellCheck={false} onKeyDown={tasti} placeholder="°C, bar, %" />
            </div>
          </div>
          <div>
            <label style={LABEL}>{t("cfg.descriptionOpt")}</label>
            <input style={INPUT} value={description} onChange={(e) => setDescription(e.target.value)} spellCheck={false} onKeyDown={tasti} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--brand-text, #e2e8f0)", cursor: "pointer" }}>
            <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
            {t("quickTag.history")}
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button style={BTN(false)} onClick={onClose}>{t("common.cancel")}</button>
          <button style={{ ...BTN(true), opacity: puoCreare ? 1 : 0.5 }} onClick={create} disabled={!puoCreare}>{t("quickTag.create")}</button>
        </div>
      </div>
    </div>
  );
}
