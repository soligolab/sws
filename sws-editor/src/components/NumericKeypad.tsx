import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

// ── Tastierino numerico touch (F3.4, piano SCADA-widgets) ───────────────────
//
// Sui pannelli industriali il browser kiosk non ha una tastiera virtuale di
// sistema: un <input type=number> non è digitabile. Questo overlay è l'input
// numerico primario del setpoint su touch (e comodo anche col mouse).
// Valida min/max PRIMA di confermare, con messaggio esplicito — l'input
// HTML si limitava a rifiutare in silenzio.

const BTN: React.CSSProperties = {
  padding: "14px 0",
  fontSize: 20,
  fontWeight: 600,
  background: "var(--brand-surface, #1e293b)",
  color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 8,
  cursor: "pointer",
  userSelect: "none",
};

interface Props {
  label?: string;
  unit?: string;
  initial?: number;
  min?: number;
  max?: number;
  onConfirm: (value: number) => void;
  onCancel: () => void;
}

export function NumericKeypad({ label, unit, initial, min, max, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>(initial !== undefined && Number.isFinite(initial) ? String(initial) : "");
  const [error, setError] = useState<string | null>(null);

  const press = (k: string) => {
    setError(null);
    setDraft((d) => {
      if (k === "C") return "";
      if (k === "⌫") return d.slice(0, -1);
      if (k === "±") return d.startsWith("-") ? d.slice(1) : `-${d}`;
      if (k === "." && d.includes(".")) return d;
      // Un primo tasto numerico sostituisce il valore precaricato, come si
      // aspetta chiunque abbia usato un HMI: si preme "5" per scrivere 5,
      // non per accodarlo al valore attuale.
      return d === String(initial ?? "") ? (k === "." ? "0." : k) : d + k;
    });
  };

  const confirm = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) {
      setError(t("keypad.invalid"));
      return;
    }
    if (min !== undefined && n < min) { setError(t("keypad.belowMin", { min })); return; }
    if (max !== undefined && n > max) { setError(t("keypad.aboveMax", { max })); return; }
    onConfirm(n);
  };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.65)",
               display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)",
                    borderRadius: 12, padding: 18, width: 280, display: "flex", flexDirection: "column", gap: 10 }}>
        {label && (
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text-muted, #94a3b8)" }}>{label}</div>
        )}
        <div style={{ background: "var(--brand-surface, #1e293b)", border: `1px solid ${error ? "var(--brand-danger, #ef4444)" : "var(--brand-surface-2, #334155)"}`,
                      borderRadius: 8, padding: "10px 12px", fontSize: 26, fontFamily: "monospace",
                      color: "var(--brand-text, #e2e8f0)", textAlign: "right", minHeight: 34 }}>
          {draft || "—"}{unit ? <span style={{ fontSize: 14, color: "var(--brand-text-subtle, #64748b)" }}> {unit}</span> : null}
        </div>
        {(min !== undefined || max !== undefined) && (
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", textAlign: "right" }}>
            {min !== undefined ? `min ${min}` : ""}{min !== undefined && max !== undefined ? " · " : ""}{max !== undefined ? `max ${max}` : ""}
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: "var(--brand-danger-soft, #fca5a5)" }}>{error}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {["7", "8", "9", "4", "5", "6", "1", "2", "3", "±", "0", "."].map((k) => (
            <button key={k} style={BTN} onClick={() => press(k)}>{k}</button>
          ))}
          <button style={{ ...BTN, fontSize: 15 }} onClick={() => press("C")}>C</button>
          <button style={{ ...BTN, fontSize: 15 }} onClick={() => press("⌫")}>⌫</button>
          <button style={{ ...BTN, background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)" }}
            onClick={confirm}>✓</button>
        </div>
        <button
          style={{ ...BTN, padding: "8px 0", fontSize: 13, background: "transparent",
                   color: "var(--brand-text-subtle, #64748b)" }}
          onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
