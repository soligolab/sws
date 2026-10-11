// Il primo deploy verso un pannello senza utenti (fetta E dell'abbinamento,
// 11-10-2026): il server risponde 428 `serve-admin` se il progetto non porta
// almeno un Admin. Non si conferma — si corregge il progetto: si spiega e si
// offre di aprire la scheda Utenti. Un posto solo per i tre percorsi di deploy
// (Connessione, Deploy in testata, Dispositivi), perché non divergano.
import i18n from "@/i18n";
import { useAppStore } from "@/store";

/** `true` se la risposta era `serve-admin` (e l'ha gestita): il deploy va
 *  fermato. */
export function gestisciServeAdmin(d: { conferma?: string } | null | undefined): boolean {
  if (d?.conferma !== "serve-admin") return false;
  if (window.confirm(i18n.t("abbinamento.serveAdmin"))) {
    useAppStore.getState().navigateToConfig("users");
  }
  return true;
}
