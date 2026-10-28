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
