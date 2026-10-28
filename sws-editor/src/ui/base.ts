/**
 * Le primitive dell'interfaccia, in un posto solo.
 *
 * Inline come nel resto dell'editor (non ci sono fogli di stile per
 * componente), ma estratte qui invece che ripetute: copiare un `padding` in
 * quattro punti è il modo in cui quattro schermate smettono di somigliarsi
 * alla prima modifica.
 *
 * I colori passano **sempre** dai token `--brand-*`, con un valore di ripiego:
 * l'interfaccia eredita il marchio, e un colore scritto a mano qui sarebbe
 * l'unico punto che non cambia col tema.
 *
 * # Da dove viene, e dove va (28-10-2026)
 *
 * Era `console/stile.ts` e serviva la sola console. Il ramo B del piano
 * `docs/plans/2026-10-26-aprire-sws-soligo-net.md` chiedeva un modulo di
 * primitive per le schermate di accesso e scelta progetto, che non usavano
 * **nessuno** dei sistemi esistenti e avevano le loro costanti locali.
 *
 * Scriverne uno nuovo accanto agli altri tre avrebbe fatto quattro sistemi, e
 * un quarto che nessun altro usa è debito, non ordine. Quindi non è nato
 * niente di nuovo: è **salito** quello della console, che era il più piccolo e
 * già tutto sui token. Da tre sistemi si è passati a due.
 *
 * Quello che resta da assorbire è `config/comuni.tsx`, il più grande. Non si
 * fa in un colpo solo e non si fa adesso: si fa quando una scheda di
 * configurazione va toccata per altro, un pezzo per volta.
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

// ── La porta d'ingresso: accesso, scelta progetto, i loro modali ─────────────
//
// Due taglie, e non per distrazione. La console è un posto dove si lavora a
// lungo su elenchi densi: campi da 7 px, pulsanti da 13 px. Le schermate che un
// nuovo arrivato vede per prime le ha volute «chiare e ariose come l'IDE di
// oggi» (maintainer, 26-10-2026), quindi un passo più larghe.
//
// Erano costanti locali di `WelcomeScreen.tsx`, salite qui il 28-10-2026
// insieme alla console: quel file si spezza in cinque, e senza un posto comune
// le stesse quattro costanti sarebbero finite copiate in ognuno.
//
// **Quando due taglie diventeranno una**, sarà una decisione di disegno e non
// un riordino: va chiesta, non fatta di passaggio.

/** Una scheda su cui si clicca: un progetto nell'elenco. */
export const schedaCliccabile: CSSProperties = {
  background: "var(--brand-surface, #1e293b)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 8,
  padding: "12px 16px",
  display: "flex",
  alignItems: "center",
  gap: 12,
  cursor: "pointer",
  transition: "border-color 0.15s",
};

/** Il pulsante dell'azione principale: uno per schermata. */
export const pulsantePrimario: CSSProperties = {
  padding: "8px 20px",
  background: "var(--brand-primary, #3b82f6)",
  color: "var(--brand-on-primary, #fff)",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
};

/** Tutti gli altri: annulla, alternative, azioni secondarie. */
export const pulsanteSecondario: CSSProperties = {
  padding: "8px 20px",
  background: "transparent",
  color: "var(--brand-text-muted, #94a3b8)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
};

/** Un campo di testo nella taglia della porta d'ingresso. */
export const campoAmpio: CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "var(--brand-bg, #0f172a)",
  color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

/** Il margine verticale della pagina di scelta progetto, in px.
 *
 *  Sta qui e non come numero in due file perché **due** file lo usano, e uno
 *  dei due lo usa al contrario: `WelcomeScreen` lo mette come padding del
 *  contenitore, `BarraIdentita` lo risale con un margine negativo per stare in
 *  cima alla finestra. Fino al 28-10-2026 erano due `32` scritti a mano, e
 *  cambiarne uno spostava la barra di sotto o la mandava fuori schermo, senza
 *  che niente lo dicesse. */
export const MARGINE_PAGINA_BENVENUTO = 32;
