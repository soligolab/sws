/**
 * Gli stili della console, in un posto solo.
 *
 * Inline come nel resto dell'editor (non ci sono fogli di stile per
 * componente), ma estratti qui invece di ripetuti: la console ha quattro
 * schermate che devono somigliarsi, e copiare un `padding` in quattro punti è
 * il modo in cui smettono di somigliarsi alla prima modifica.
 *
 * I colori passano **sempre** dai token `--brand-*`, con un valore di ripiego:
 * la console eredita il marchio come il resto dell'applicazione, e un colore
 * scritto a mano qui sarebbe l'unico punto che non cambia col tema.
 */
import type { CSSProperties } from "react";

export const scheda: CSSProperties = {
  background: "var(--brand-surface, #1e293b)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 8,
  padding: 14,
};

export const titoletto: CSSProperties = {
  fontSize: 11,
  color: "var(--brand-text-muted, #94a3b8)",
  display: "block",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

export const campo: CSSProperties = {
  width: "100%",
  background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "7px 10px",
  color: "var(--brand-text, #e2e8f0)",
  fontSize: 14,
  boxSizing: "border-box",
};

export const riga: CSSProperties = { marginBottom: 12 };

export function pulsante(attivo: boolean): CSSProperties {
  return {
    background: attivo ? "var(--brand-primary, #3b82f6)" : "var(--brand-surface-2, #334155)",
    color: attivo ? "var(--brand-on-primary, #fff)" : "var(--brand-text-subtle, #64748b)",
    border: "none",
    borderRadius: 4,
    padding: "8px 14px",
    cursor: attivo ? "pointer" : "default",
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
  };
}

export const avviso: CSSProperties = {
  fontSize: 11,
  color: "var(--brand-warning-soft, #fbbf24)",
  background: "#78350f33",
  padding: "6px 10px",
  borderRadius: 4,
  lineHeight: 1.5,
};

export const errore: CSSProperties = {
  fontSize: 13,
  color: "var(--brand-danger-soft, #fca5a5)",
  background: "#7f1d1d33",
  padding: "8px 12px",
  borderRadius: 4,
  lineHeight: 1.4,
};

/** Elenco a sinistra, dettaglio a destra. */
export const elencoEDettaglio: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(320px, 1.4fr) minmax(280px, 1fr)",
  gap: 16,
  alignItems: "start",
};

export function rigaElenco(scelta: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "1fr auto auto auto",
    gap: 10,
    alignItems: "center",
    padding: "9px 12px",
    cursor: "pointer",
    fontSize: 13,
    background: scelta ? "var(--brand-surface-2, #334155)" : "transparent",
    borderLeft: `3px solid ${scelta ? "var(--brand-primary, #3b82f6)" : "transparent"}`,
  };
}

export function coloreStato(s: string): string {
  if (s === "approvata") return "var(--brand-success-soft, #86efac)";
  if (s === "sospesa") return "var(--brand-danger-soft, #fca5a5)";
  return "var(--brand-warning-soft, #fbbf24)";
}
