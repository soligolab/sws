// Il telaio delle schermate di accesso (login, cambio password): una pagina
// centrata e una scheda con il modulo. Prima ogni schermata aveva la sua copia
// dei due oggetti di stile (revisione 2026-09-09).

import type React from "react";

export const paginaCentrata: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  // Il margine laterale, che è ciò che impedisce alla scheda di toccare i
  // bordi su un telefono (28-10-2026). `height` secca diventa `minHeight`:
  // con una scheda più alta della finestra — un modulo con un avviso sopra —
  // `height: 100vh` tagliava invece di far scorrere.
  padding: 16,
  boxSizing: "border-box",
  background: "var(--brand-bg, #0f172a)",
  color: "var(--brand-text, #e2e8f0)",
  fontFamily: "system-ui, sans-serif, 'SWS Emoji'",
};

/** La scheda centrale di accesso, registrazione e simili.
 *
 *  `larghezza` è la **massima**, non quella fissa (28-10-2026): con `width`
 *  secca, più i 36 px di padding per lato, sotto i 400 px di finestra la
 *  scheda sforava e la pagina scorreva in orizzontale. Su un telefono era la
 *  prima cosa che si vedeva del prodotto. */
export function schedaModulo(larghezza: number): React.CSSProperties {
  return {
    background: "var(--brand-surface, #1e293b)",
    border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 10,
    padding: "32px 36px",
    width: "100%",
    maxWidth: larghezza,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
  };
}

// ── I pezzi del modulo (30-10-2026) ─────────────────────────────────────────
//
// Con la registrazione e il PIN le schermate di accesso sono diventate quattro
// (password, PIN, registrazione, codice di conferma): stavano tutte in
// `LoginScreen.tsx` come costanti locali, e la seconda copia sarebbe stata
// l'inizio di quattro stili che divergono.

export const etichettaAccesso: React.CSSProperties = {
  fontSize: 11,
  color: "var(--brand-text-muted, #94a3b8)",
  display: "block",
  marginBottom: 4,
};

export const campoAccesso: React.CSSProperties = {
  width: "100%",
  background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "7px 10px",
  color: "var(--brand-text, #e2e8f0)",
  fontSize: 14,
  boxSizing: "border-box",
};

/** Il pulsante principale del modulo; spento mentre si aspetta o si è bloccati. */
export function pulsanteAccesso(spento: boolean): React.CSSProperties {
  return {
    background: spento ? "var(--brand-surface-2, #334155)" : "var(--brand-primary, #3b82f6)",
    color: spento ? "var(--brand-text-subtle, #64748b)" : "var(--brand-on-primary, #fff)",
    border: "none",
    borderRadius: 4,
    padding: "8px 12px",
    cursor: spento ? "default" : "pointer",
    fontSize: 14,
    fontWeight: 600,
  };
}

/** Un collegamento fra le schermate («accedi con un PIN», «crea un account»). */
export const collegamentoAccesso: React.CSSProperties = {
  background: "transparent",
  color: "var(--brand-primary-testo, #60a5fa)",
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  padding: 0,
  textAlign: "left",
};

export const erroreAccesso: React.CSSProperties = {
  color: "var(--brand-danger-soft, #fca5a5)",
  fontSize: 12,
  background: "#7f1d1d33",
  padding: "6px 10px",
  borderRadius: 4,
};

export const avvisoAccesso: React.CSSProperties = {
  fontSize: 12,
  color: "var(--brand-text-muted, #94a3b8)",
  background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)",
  padding: "8px 10px",
  borderRadius: 4,
  lineHeight: 1.45,
};

export const casellaAccesso: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
  fontSize: 12,
  color: "var(--brand-text-muted, #94a3b8)",
  lineHeight: 1.4,
  cursor: "pointer",
};
