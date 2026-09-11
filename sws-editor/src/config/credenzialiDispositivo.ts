// Come ci si autentica verso un dispositivo registrato, e cosa dire quando
// non riesce (T-68).
//
// Nato da un guasto vero: «Connetti» riusciva e subito dopo «Deploy»
// rispondeva `429 Too Many Requests`. Quattro cose si erano sommate — il
// dispositivo preso dal discovery nasceva senza utente, il campo per
// aggiungerlo non compariva mai, il deploy faceva comunque il login con
// credenziali vuote, e cinque tentativi falliti bloccavano l'account. Le due
// decisioni che evitano di ripetere il giro stanno qui, pure e provabili.

/** Che cosa fare prima di parlare con un dispositivo. */
export type ModoAccesso =
  /** Il pannello dichiara di non avere utenti: il login non serve e non va
   *  fatto. È la stessa lezione di T-57 — lì applicata a «Connetti», qui no. */
  | "senza-login"
  /** Ci sono credenziali e il pannello le vuole. */
  | "login"
  /** Il pannello vuole un utente e noi non ce l'abbiamo. Non si tenta: un
   *  login con utente vuoto è un fallimento sicuro, e **cinque fallimenti
   *  bloccano l'account per un minuto**. Meglio dirlo prima di bruciare il
   *  budget di qualcun altro. */
  | "credenziali-mancanti";

/** `authRequired` è ciò che il dispositivo dichiara in `GET /api/system`;
 *  `undefined` quando non si è riusciti a chiederglielo.
 *
 *  Non sapere vale come «serve il login»: è il verso prudente — provare a
 *  entrare con le credenziali che si hanno costa un tentativo, mentre saltare
 *  il login su un pannello che invece lo vuole farebbe fallire tutto il
 *  deploy più avanti, con un errore meno chiaro. */
export function modoAccesso(
  authRequired: boolean | undefined,
  utente: string,
  password: string,
): ModoAccesso {
  if (authRequired === false) return "senza-login";
  if (!utente.trim()) return "credenziali-mancanti";
  // La password vuota è legittima e si prova: un pannello può avere un utente
  // senza password, e comunque è il dispositivo a decidere, non noi.
  void password;
  return "login";
}

/** Il messaggio per un login rifiutato, con dentro cosa fare.
 *
 *  Il 429 è il caso che conta: il pannello blocca l'account dopo cinque
 *  tentativi falliti in un minuto, e **ogni nuovo tentativo allunga il
 *  blocco** (`sws-auth`: «while already locked: extend lockout on every new
 *  attempt»). Un messaggio che dice solo «429 Too Many Requests» porta a fare
 *  esattamente la cosa che tiene bloccati: riprovare.
 *
 *  `retryAfter` è l'header `Retry-After`, in secondi, che il runtime manda
 *  insieme al 429. */
export function spiegaLoginFallito(status: number, retryAfter: string | null): string {
  if (status === 429) {
    const s = Number(retryAfter);
    const quanto = Number.isFinite(s) && s > 0 ? `${Math.ceil(s)} secondi` : "circa un minuto";
    return `Il pannello ha bloccato l'accesso per ${quanto} dopo troppi tentativi falliti. `
      + "Aspetta **senza** riprovare: ogni nuovo tentativo allunga il blocco. "
      + "Poi controlla l'utente e la password del dispositivo.";
  }
  if (status === 401 || status === 403) {
    return "Utente o password del pannello non validi. "
      + "Sono le credenziali **SWS** definite nel progetto, non quelle SSH del dispositivo.";
  }
  return `Login al pannello fallito (${status}).`;
}

/** Il messaggio per quando non si hanno credenziali da provare. */
export function spiegaCredenzialiMancanti(): string {
  return "Questo dispositivo non ha un utente registrato e il pannello ne vuole uno. "
    + "Scrivilo nella colonna «Utente SWS» della riga, con la sua password.";
}
