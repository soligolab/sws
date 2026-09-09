// Il telaio comune delle finestre staccate (chat, log): stili e le due schermate
// che precedono il contenuto — «sto controllando» e «qui non sei autenticato».
// Prima ogni finestra ne aveva una copia (revisione 2026-09-09).

import type React from "react";

export const vuoto: React.CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  textAlign: "center",
  color: "var(--brand-text, #e2e8f0)",
  background: "var(--brand-bg, #0b1220)",
};

export const avviso: React.CSSProperties = {
  flexShrink: 0,
  padding: "4px 10px",
  fontSize: 11,
  color: "var(--brand-text-subtle, #64748b)",
  background: "var(--brand-surface, #131c2e)",
  borderBottom: "1px solid var(--brand-surface-2, #334155)",
};

export const bottone: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 13,
  cursor: "pointer",
  color: "var(--brand-text, #e2e8f0)",
  background: "var(--brand-surface-2, #334155)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 6,
};

/** Gli utenti esistono e nessuno ha fatto login in QUESTO browser: si rimanda
 *  alla finestra dell'editor invece di aprire una seconda sessione. */
export function SchermataSenzaAccesso({ titolo, suggerimento, ricarica }: {
  titolo: string; suggerimento: string; ricarica: string;
}) {
  return (
    <div style={vuoto}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{titolo}</div>
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 12 }}>{suggerimento}</div>
      <button style={bottone} onClick={() => window.location.reload()}>{ricarica}</button>
    </div>
  );
}
