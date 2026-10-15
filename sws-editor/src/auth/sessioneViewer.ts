// Quale token tiene il viewer all'apertura della pagina (15-10-2026).
//
// Fino a questa data `RuntimeViewer` chiamava `whoami()` e metteva **sempre**
// il sentinella `"no-auth"`, anche con una sessione vera salvata. Il commento
// diceva che la chiamata era «innocua»: non lo era. Un operatore che aveva
// fatto login e ricaricava la pagina perdeva la sessione, e su un pannello
// abbinato ogni sua scrittura tornava «forbidden: Operator+ required». Trovato
// collaudando il simbolo che comanda sul TC620. È la stessa correzione fatta in
// `App.tsx` il 06-10-2026 per l'IDE: un token vero che funziona si tiene.

/** `tokenSalvato` è quello dello store (o `null`); `utente` è il nome che
 *  `whoami` ha risposto con quel token — vuoto per un anonimo. */
export function tokenDelViewer(tokenSalvato: string | null, utente: string): string {
  const vero = !!tokenSalvato && tokenSalvato !== "no-auth";
  // Con un token vero, un nome nella risposta vuol dire che il server l'ha
  // riconosciuto. Un anonimo invece vuol dire scaduto: si torna al sentinella.
  return vero && utente ? tokenSalvato : "no-auth";
}
