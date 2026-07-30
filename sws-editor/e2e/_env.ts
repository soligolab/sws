/**
 * Indirizzi del runtime per i test end-to-end.
 *
 * Prima ogni spec aveva `https://localhost:8444` scritto dentro — sette
 * occorrenze in quattro file. Due conseguenze: `baseURL` di
 * `playwright.config.ts` valeva solo per l'unico file che usava percorsi
 * relativi, e tutte puntavano a **HTTPS**, che su un `.run/config` nuovo non è
 * attivo (il runtime parte in HTTP puro finché non gli si dà un certificato).
 * Risultato: la suite non poteva girare, ed è per questo che ha potuto derivare
 * senza che nessuno se ne accorgesse.
 *
 * Le variabili d'ambiente le imposta `scripts/check_e2e.sh`; i default valgono
 * per chi lancia `playwright test` a mano contro un runtime avviato con
 * `./scripts/start_runtime.sh`.
 */

/** Porta IDE/admin: tutte le route di progetto stanno qui, non sulla viewer. */
export const ADMIN = (process.env.SWS_E2E_ADMIN ?? "http://localhost:8444").replace(/\/$/, "");

/** Porta viewer (operatori). Assente in modalità IDE-only. */
export const VIEWER = (process.env.SWS_E2E_VIEWER ?? "http://localhost:8443").replace(/\/$/, "");

/** Credenziali admin attese dai test che fanno login. `start_runtime.sh` non
 *  semina nessun utente da sé: senza queste variabili il runtime parte in
 *  no-auth e non c'è login da fare. */
export const ADMIN_USER = process.env.SWS_ADMIN_USER ?? "admin";
export const ADMIN_PASS = process.env.SWS_ADMIN_PASSWORD ?? "admin";
