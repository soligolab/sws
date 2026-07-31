/**
 * Ricava l'URL del viewer (pagina operatore) a partire da quello dell'IDE.
 *
 * La porta del viewer è **dedotta** come `admin − 1`, non letta dal runtime,
 * che non la pubblica da nessuna parte. Vale per ogni installazione esistente:
 * `start_runtime.sh` usa 8443/8444 e 8445/8446 con `--instance N`, e il `CMD`
 * dei due Containerfile usa 8443/8444 — l'installer stesso lo stampa a fine
 * installazione ("viewer : …:8443   IDE : …:8444").
 *
 * È una convenzione, non un dato: chi avvia il runtime con porte arbitrarie
 * ottiene un indirizzo sbagliato. Per questo l'URL dedotto va **mostrato**
 * all'utente (nel tooltip del bottone) invece di essere aperto in silenzio, e
 * per questo chi lo usa sonda `/health` prima di aprire una scheda.
 *
 * Restituisce `null` quando la deduzione non ha senso: URL non valido, oppure
 * senza porta esplicita (`http://host` → la porta implicita è 80, e "79" non
 * significherebbe niente). Meglio nessun bottone che un bottone che sbaglia.
 */
export function viewerUrlFromAdmin(adminUrl: string | null | undefined): string | null {
  if (!adminUrl) return null;
  let u: URL;
  try {
    u = new URL(adminUrl);
  } catch {
    return null;
  }
  if (!u.port) return null;
  const admin = Number(u.port);
  if (!Number.isInteger(admin) || admin <= 1) return null;
  u.port = String(admin - 1);
  u.pathname = "/";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}
