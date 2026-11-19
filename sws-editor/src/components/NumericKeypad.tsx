import { useState } from "react";
import { createPortal } from "react-dom";
import { predefinito } from "@/coloriPredefiniti";
import { useLinguaContenuti } from "@/i18n/linguaContenuti";
import { testoSistema, testoSistemaCon } from "@/i18n/testiSistema";
import { initialDraft, press as pressKey, validateDraft, type KeypadError } from "@/components/numericKeypadLogic";

// ── Tastierino numerico touch (F3.4, piano SCADA-widgets) ───────────────────
//
// Sui pannelli industriali il browser kiosk non ha una tastiera virtuale di
// sistema: un <input type=number> non è digitabile. Questo overlay è l'input
// numerico primario del setpoint su touch (e comodo anche col mouse).
// Valida min/max PRIMA di confermare, con messaggio esplicito — l'input
// HTML si limitava a rifiutare in silenzio.
//
// The keys and the confirmation are `numericKeypadLogic.ts`, twin of the LVGL card
// (`numeric_keypad.rs`, 19-11-2026); the messages are system texts in the content language.

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
  /** Background of the ✓ (the setpoint's `confirm_fill`). */
  confirmFill?: string;
  onConfirm: (value: number) => void;
  onCancel: () => void;
}

function errorText(e: KeypadError, lang: string): string {
  if (e.kind === "below_min") return testoSistemaCon("keypad_below_min", lang, { min: String(e.min) });
  if (e.kind === "above_max") return testoSistemaCon("keypad_above_max", lang, { max: String(e.max) });
  return testoSistema("keypad_invalid", lang);
}

export function NumericKeypad({ label, unit, initial, min, max, confirmFill, onConfirm, onCancel }: Props) {
  const lingua = useLinguaContenuti();
  const [draft, setDraft] = useState<string>(initialDraft(initial));
  const [error, setError] = useState<string | null>(null);

  const press = (k: string) => {
    setError(null);
    setDraft((d) => pressKey(d, k, initial));
  };

  const confirm = () => {
    const r = validateDraft(draft, min, max);
    if ("error" in r) {
      setError(errorText(r.error, lingua.lang));
      return;
    }
    onConfirm(r.value);
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
          <button style={{ ...BTN, background: confirmFill ?? predefinito("setpoint", "confirm_fill"), color: "#fff" /* fixed-colour */ }}
            onClick={confirm}>✓</button>
        </div>
        <button
          style={{ ...BTN, padding: "8px 0", fontSize: 13, background: "transparent",
                   color: "var(--brand-text-subtle, #64748b)" }}
          onClick={onCancel}>
          {testoSistema("annulla", lingua.lang)}
        </button>
      </div>
    </div>,
    document.body,
  );
}
