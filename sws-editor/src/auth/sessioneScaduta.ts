// Cosa fare quando il runtime rifiuta il token che abbiamo in mano.
//
// Nato da un guasto vero (14-09-2026): nell'IDE, definire il primo utente del
// progetto faceva comparire il modale «Sessione scaduta» — che chiede la
// password **dell'utente in sessione**, senza poterlo cambiare. In quel
// frangente l'utente in sessione è `admin`, l'Admin **sintetico** che il
// runtime inietta in modalità senza utenti: in `users.yaml` non esiste, e
// nessuna password poteva funzionare. Il modale era una porta dipinta sul
// muro.
//
// La sessione, poi, non era affatto «scaduta»: l'autenticazione si era
// **accesa in quel momento**, perché scrivere il primo utente la accende.

/** Che schermata ha senso mostrare dopo un rifiuto del token. */
export type AzioneSessione =
  /** C'era una sessione vera e va rinnovata: il modale con la password. */
  | "riautentica"
  /** Il token era il sentinella `"no-auth"`, che il server non ha mai emesso:
   *  non c'è nessuna sessione da rinnovare e nessun utente di cui conosciamo
   *  il nome. Si torna alla schermata di accesso, che il nome lo fa scrivere. */
  | "accedi-da-capo"
  /** Non eravamo autenticati: la schermata di accesso è già quella giusta. */
  | "niente";

/** `authToken` è quello nello store: `null` quando non si è autenticati,
 *  `"no-auth"` quando è il sentinella inventato dal frontend per rendere
 *  l'interfaccia in modalità senza utenti (`App.tsx`, `useAccessoSenzaUtenti`). */
export function azionePerSessioneRifiutata(authToken: string | null): AzioneSessione {
  if (!authToken) return "niente";
  if (authToken === "no-auth") return "accedi-da-capo";
  return "riautentica";
}

/** Il motivo da mostrare sulla schermata di accesso quando ci si arriva da un
 *  `"no-auth"` rifiutato: **dirlo** è metà della correzione, perché altrimenti
 *  ci si ritrova davanti a un login comparso dal nulla su un IDE che fino a un
 *  secondo prima non ne chiedeva nessuno. */
export const MOTIVO_AUTENTICAZIONE_ACCESA = "auth.autenticazioneAppenaAccesa";

/** Il tetto del timer di rinnovo: un giorno. */
export const RINNOVO_MASSIMO_MS = 24 * 3600_000;

/** Fra quanto rinnovare la sessione: cinque minuti prima della scadenza, ma
 *  mai prima di 30 s e **mai oltre un giorno**.
 *
 *  Il tetto non è prudenza. Con «ricordami» (30 giorni, 30-10-2026) il
 *  ritardo valeva ~2,59·10⁹ ms, oltre il massimo di `setTimeout` (2³¹-1 ms,
 *  ~24,8 giorni): il browser lo tronca e il timer scatta **subito**. Rinnovata,
 *  la sessione torna a 30 giorni e il timer ripartirebbe subito di nuovo, in
 *  ciclo. Un giorno sta comodo sotto il limite, e a ogni rinnovo il timer
 *  riparte dalla scadenza nuova. */
export function ritardoRinnovo(scadeMs: number, adessoMs: number): number {
  return Math.min(Math.max(scadeMs - adessoMs - 5 * 60_000, 30_000), RINNOVO_MASSIMO_MS);
}
