/** Gli stili delle schede del dispositivo — Connessione, Installazione,
 *  Container.
 *
 *  Erano costanti dichiarate **dentro** `RuntimeConnectionTab`, quando quella
 *  scheda era una sola da 1 740 righe. Dividendola in tre (25-09-2026) o si
 *  copiavano in ogni file — e tre copie divergono al primo ritocco — o
 *  salivano qui. Sono gli stessi valori di prima, spostati e non ridisegnati:
 *  il collaudo della divisione deve poter dire «identico», e un cambiamento
 *  d'aspetto in mezzo lo renderebbe impossibile.
 */

export const INPUT: React.CSSProperties = {
  background: "var(--brand-bg, #020617)",
  color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 13,
};

export const BTN: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 5,
  cursor: "pointer",
  fontSize: 13,
  border: "1px solid var(--brand-surface-2, #334155)",
  background: "var(--brand-surface, #1e293b)",
  color: "var(--brand-text, #e2e8f0)",
};

export const BTN_PRIMARY: React.CSSProperties = {
  ...BTN,
  background: "#1d4ed8",
  border: "1px solid var(--brand-primary-hover, #2563eb)",
  color: "#fff",
  fontWeight: 600,
};

export const BTN_RED: React.CSSProperties = {
  ...BTN,
  background: "#450a0a",
  border: "1px solid #dc2626",
  color: "var(--brand-danger-soft, #fca5a5)",
};

/** Il riquadro di log con lo scorrimento, uguale in tutte e tre le schede. */
export const LOG_BOX: React.CSSProperties = {
  background: "var(--brand-bg, #020617)",
  border: "1px solid var(--brand-surface, #1e293b)",
  borderRadius: 4,
  padding: "8px 10px",
  maxHeight: 150,
  overflowY: "auto",
  marginTop: 8,
  fontFamily: "monospace",
  fontSize: 11,
};

/** Il colore di una riga di log: errore, fatto, avviso, o normale. */
export function coloreRigaLog(riga: string): string {
  if (riga.startsWith("ERROR")) return "var(--brand-danger-soft, #f87171)";
  if (riga === "DONE") return "var(--brand-success-soft, #4ade80)";
  if (riga.startsWith("WARN")) return "#fb923c";
  return "var(--brand-text-muted, #94a3b8)";
}
