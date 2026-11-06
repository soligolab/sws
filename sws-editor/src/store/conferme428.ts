/** Le conferme che un deploy chiede dopo un 428 (F2 della Finestra di avviso,
 *  05-11-2026). Il server guarda e si ferma **prima** di toccare qualcosa;
 *  decide chi guarda lo schermo. Un posto solo per i tre percorsi di deploy
 *  (testata e salvataggio nello store, Connessione, Dispositivi): prima ognuno
 *  aveva la sua copia della catena, coi `window.confirm` del browser, e le tre
 *  copie differivano già nelle condizioni. */
// `i18next` e non `@/i18n`, come lo store: questo modulo lo importa lo store, e
// `@/i18n` caricherebbe le traduzioni in ogni test che usa lo store.
import i18n from "i18next";
import { conferma } from "@/finestraAvviso/finestraAvviso";

/** I flag con cui una richiesta di deploy dice al server cosa è già stato
 *  confermato: gli stessi nomi di `api.deployToRuntime`. */
export interface ConfermeDeploy {
  confirmNoUsers: boolean;
  confirmReplace: boolean;
  confirmMissingSymbols: boolean;
}

export const NESSUNA_CONFERMA: ConfermeDeploy = {
  confirmNoUsers: false,
  confirmReplace: false,
  confirmMissingSymbols: false,
};

/** Il corpo di un 428 di `/api/remote/deploy` (`remote.rs`). */
export interface Dati428 {
  conferma?: string;
  utenti_dispositivo?: string[] | null;
  progetto?: string | null;
  progetti?: { nome: string; storico_byte?: number | null }[];
  simboli?: string[];
  non_verificabile?: boolean;
  versione_pannello?: string | null;
}

/** - `riprova`: chi guarda ha confermato, si rifà la richiesta con `conferme`;
 *  - `annullato`: ha detto no, e non si è toccato niente;
 *  - `serve-admin`: non si conferma, si corregge il progetto (la finestra l'ha
 *    già detto, e ha offerto la scheda Utenti);
 *  - `nessuna`: un 428 che non chiede niente di nuovo — un errore, da mostrare. */
export type Esito428 =
  | { tipo: "riprova"; conferme: ConfermeDeploy }
  | { tipo: "annullato" }
  | { tipo: "serve-admin" }
  | { tipo: "nessuna" };

/** Il testo della conferma prima di un deploy che cancella dal pannello
 *  progetti con un altro nome (03-10-2026). Puro, per i test. */
export function testoSostituzione(
  progetto: string | null | undefined,
  progetti: { nome: string; storico_byte?: number | null }[],
): string {
  const elenco = progetti
    .map((p) => (p.storico_byte != null
      ? i18n.t("cfg.deploySostituisceVoce", { nome: p.nome, mb: (p.storico_byte / 1_000_000).toFixed(1) })
      : i18n.t("cfg.deploySostituisceVoceSenzaPeso", { nome: p.nome })))
    .join("\n");
  return i18n.t("cfg.deploySostituisceConfirm", { progetto: progetto ?? "?", elenco });
}

/** Il testo della conferma quando il pannello non conosce dei simboli di
 *  libreria usati dal progetto (M9, 14-10-2026). Puro, per i test. */
export function testoSimboliMancanti(simboli: string[], nonVerificabile: boolean, versione?: string | null): string {
  const elenco = simboli.map((s) => `• ${s}`).join("\n");
  // Il pannello non dice quali simboli ha (02-11-2026): prima il testo diceva
  // «senza la libreria di simboli», che era falso — era la porta di gestione a
  // non servire il manifesto.
  return i18n.t(nonVerificabile ? "cfg.deploySimboliNonVerificabili" : "cfg.deploySimboliMancanti",
    { n: simboli.length, elenco, versione: versione ?? "?" });
}

/** Chiede quello che il 428 chiede, e dice come proseguire. */
export async function confermaDopo428(d: Dati428, gia: ConfermeDeploy): Promise<Esito428> {
  // Il pannello non conosce dei simboli di libreria (M9): si avvisa, e si può
  // procedere — li disegnerà come segnaposto.
  if (d.conferma === "simboli-mancanti" && !gia.confirmMissingSymbols) {
    const si = await conferma({ testo: testoSimboliMancanti(d.simboli ?? [], !!d.non_verificabile, d.versione_pannello) });
    return si ? { tipo: "riprova", conferme: { ...gia, confirmMissingSymbols: true } } : { tipo: "annullato" };
  }
  // Il pannello non ha utenti e il progetto non porta un Admin (fetta E,
  // 11-10-2026): non si conferma, si corregge il progetto.
  if (d.conferma === "serve-admin") {
    if (await conferma({ testo: i18n.t("abbinamento.serveAdmin"), si: i18n.t("abbinamento.serveAdminApri") })) {
      // Dinamico: lo store importa questo modulo.
      const { useAppStore } = await import("@/store");
      useAppStore.getState().navigateToConfig("users");
    }
    return { tipo: "serve-admin" };
  }
  // Il deploy cancellerebbe progetti con un altro nome, storico compreso.
  if (d.conferma === "sostituisce-progetti" && !gia.confirmReplace) {
    const si = await conferma({ testo: testoSostituzione(d.progetto, d.progetti ?? []), pericolo: true });
    return si ? { tipo: "riprova", conferme: { ...gia, confirmReplace: true } } : { tipo: "annullato" };
  }
  // Il progetto non ha utenti e il dispositivo ne ha: dopo, il pannello resta
  // aperto a chiunque. `conferma` assente: un server di prima che la mettesse.
  if ((d.conferma === "utenti-vuoti" || d.conferma === undefined) && !gia.confirmNoUsers) {
    const elenco = d.utenti_dispositivo?.length ? d.utenti_dispositivo.join(", ") : i18n.t("cfg.deployNoUsersUnknown");
    const si = await conferma({
      titolo: i18n.t("cfg.deployNoUsersTitolo"),
      testo: i18n.t("cfg.deployNoUsersConfirm", { utenti: elenco }),
      pericolo: true,
    });
    return si ? { tipo: "riprova", conferme: { ...gia, confirmNoUsers: true } } : { tipo: "annullato" };
  }
  return { tipo: "nessuna" };
}
