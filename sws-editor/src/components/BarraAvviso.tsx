// La barra di avviso sotto l'intestazione dell'IDE: una riga colorata con
// un'icona, un messaggio, un eventuale «Ricarica adesso» e la ✕.
//
// In App.tsx ce n'erano cinque scritte per esteso, identiche a meno del colore e
// del testo (runtime tornato raggiungibile, frontend nuovo, progetto cambiato
// da fuori, finestra chat bloccata, finestra log bloccata): ~90 righe che
// cambiavano insieme e non sempre insieme. Revisione 2026-09-09.

import type React from "react";

export type TonoBarra = "successo" | "primario" | "attenzione" | "pericolo";

const TONI: Record<TonoBarra, { sfondo: string; bordo: string; testo: string }> = {
  successo:   { sfondo: "var(--brand-success-bg, #166534)",  bordo: "var(--brand-success, #22c55e)",       testo: "#fff" },
  primario:   { sfondo: "var(--brand-primary, #3b82f6)",     bordo: "var(--brand-primary-hover, #2563eb)", testo: "#fff" },
  attenzione: { sfondo: "var(--brand-warning-bg, #78350f)",  bordo: "var(--brand-warning, #f59e0b)",       testo: "var(--brand-warning-soft, #facc15)" },
  pericolo:   { sfondo: "var(--brand-danger-soft, #451a1a)", bordo: "var(--brand-danger, #ef4444)",        testo: "var(--brand-text, #e2e8f0)" },
};

export function BarraAvviso({ tono, icona, children, stileBottone, ricarica, onChiudi, titoloChiudi, compatta }: {
  tono: TonoBarra;
  icona: string;
  children: React.ReactNode;
  /** Lo stile base dei pulsanti dell'intestazione (HDR_BTN), da cui derivano i due qui. */
  stileBottone: React.CSSProperties;
  /** Se presente, un pulsante che ricarica la pagina, con questa etichetta. */
  ricarica?: string;
  onChiudi: () => void;
  titoloChiudi?: string;
  /** Barre d'errore delle finestre staccate: un filo più basse. */
  compatta?: boolean;
}) {
  const c = TONI[tono];
  return (
    <div style={{
      background: c.sfondo, borderBottom: `1px solid ${c.bordo}`,
      padding: compatta ? "5px 16px" : "6px 16px", display: "flex", alignItems: "center", gap: 12,
      fontSize: 12, color: c.testo, flexShrink: 0,
    }}>
      <span>{icona}</span>
      <span style={{ flex: 1 }}>{children}</span>
      {ricarica && (
        <button
          style={{ ...stileBottone, background: "transparent", color: c.testo, borderColor: tono === "attenzione" ? c.bordo : c.testo }}
          onClick={() => window.location.reload()}
        >
          {ricarica}
        </button>
      )}
      <button
        style={compatta
          ? { ...stileBottone, padding: "2px 8px" }
          : { ...stileBottone, background: "transparent", color: c.testo, border: "none" }}
        onClick={onChiudi}
        title={titoloChiudi}
      >
        ✕
      </button>
    </div>
  );
}
