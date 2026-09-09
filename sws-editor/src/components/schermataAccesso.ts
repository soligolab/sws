// Il telaio delle schermate di accesso (login, cambio password): una pagina
// centrata e una scheda con il modulo. Prima ogni schermata aveva la sua copia
// dei due oggetti di stile (revisione 2026-09-09).

import type React from "react";

export const paginaCentrata: React.CSSProperties = {
  height: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--brand-bg, #0f172a)",
  color: "var(--brand-text, #e2e8f0)",
  fontFamily: "system-ui, sans-serif",
};

export function schedaModulo(larghezza: number): React.CSSProperties {
  return {
    background: "var(--brand-surface, #1e293b)",
    border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 10,
    padding: "32px 36px",
    width: larghezza,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
  };
}
