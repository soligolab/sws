/** Le conferme che un deploy chiede dopo un 428 (F2 della Finestra di avviso,
 *  05-11-2026). Il server guarda e si ferma **prima** di toccare qualcosa;
 *  decide chi guarda lo schermo. Un posto solo per i tre percorsi di deploy
 *  (testata e salvataggio nello store, Connessione, Dispositivi): prima ognuno
 *  aveva la sua copia della catena, coi `window.confirm` del browser, e le tre
 *  copie differivano già nelle condizioni. */
// `i18next` e non `@/i18n`, come lo store: questo modulo lo importa lo store, e
// `@/i18n` caricherebbe le traduzioni in ogni test che usa lo store.
import i18n from "i18next";
import { avviso, conferma, scegli } from "@/finestraAvviso/finestraAvviso";

/** I flag con cui una richiesta di deploy dice al server cosa è già stato
 *  confermato: gli stessi nomi di `api.deployToRuntime`. */
export interface ConfermeDeploy {
  confirmNoUsers: boolean;
  confirmReplace: boolean;
  confirmMissingSymbols: boolean;
  confirmUsersChange: boolean;
  /** The device restarts to turn the screen (rc.30). */
  confirmRotation: boolean;
  /** The answer to `sostituisce-progetti` with `scelte` (27-11-2026). */
  replaceMode: ModoSostituzione | null;
}

/** What the deploy does to the panel project with another name (27-11-2026):
 *  the same values as `ReplaceMode` in `remote.rs`. */
export type ModoSostituzione = "same_plant" | "keep_users" | "delete_all";
const MODI: readonly ModoSostituzione[] = ["same_plant", "keep_users", "delete_all"];

export const NESSUNA_CONFERMA: ConfermeDeploy = {
  confirmNoUsers: false,
  confirmReplace: false,
  confirmMissingSymbols: false,
  confirmUsersChange: false,
  confirmRotation: false,
  replaceMode: null,
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
  utenti?: string[];
  utenti_progetto?: string[];
  /** `rotate-screen`: quarter turns now and after the deploy. */
  current?: number;
  wanted?: number;
  portrait?: boolean;
  /** `sostituisce-progetti` (27-11-2026): the answers to offer, the panel
   *  project that takes the new name, and whether the two are the same plant
   *  (`false` = two different identities, `null` = unknown). */
  scelte?: string[];
  erede?: string | null;
  stesso_impianto?: boolean | null;
  /** «Replace users too» is on: with «same plant» the users come from the
   *  project (27-11-2026). */
  sostituisci_utenti?: boolean;
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

/** The question of a deploy over a panel project with another name, with the
 *  answers (27-11-2026, plan `2026-11-27-cambio-di-nome-del-progetto`). Pure,
 *  for the tests. */
export function testoSceltaImpianto(d: Dati428, scelte: readonly ModoSostituzione[]): string {
  const elenco = (d.progetti ?? [])
    .map((p) => (p.storico_byte != null
      ? i18n.t("cfg.deploySostituisceVoce", { nome: p.nome, mb: (p.storico_byte / 1_000_000).toFixed(1) })
      : i18n.t("cfg.deploySostituisceVoceSenzaPeso", { nome: p.nome })))
    .join("\n");
  const progetto = d.progetto ?? "?";
  const erede = d.erede ?? "?";
  const stato = d.stesso_impianto === false
    ? i18n.t("cfg.deployImpiantoDiverso", { erede, progetto })
    : i18n.t("cfg.deployImpiantoIgnoto", { erede, progetto });
  const righe = scelte.map((s) => i18n.t(
    s === "same_plant" && d.sostituisci_utenti ? "cfg.deployScelta.same_plant.aiutoUtentiProgetto" : `cfg.deployScelta.${s}.aiuto`,
    { erede },
  )).join("\n");
  return `${i18n.t("cfg.deployImpiantoDomanda", { progetto, elenco })}\n\n${stato}\n\n${righe}`;
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

/** Il testo della conferma prima di un deploy che sostituisce gli utenti del
 *  pannello (07-11-2026). Puro, per i test. */
export function testoSostituzioneUtenti(d: Dati428): string {
  const pannello = d.utenti_dispositivo?.length ? d.utenti_dispositivo.join(", ") : i18n.t("cfg.deployNoUsersUnknown");
  const progetto = (d.utenti_progetto ?? []).join(", ");
  const base = i18n.t("cfg.deployUtentiSostituiti", { pannello, progetto: progetto || "?" });
  const cambio = d.utenti?.length ? `\n\n${i18n.t("cfg.deployUtentiDaCambiare", { utenti: d.utenti.join(", ") })}` : "";
  return `${base}${cambio}\n\n${i18n.t("cfg.deployUtentiTieni")}`;
}

/** Chiede quello che il 428 chiede, e dice come proseguire. */
export async function confermaDopo428(d: Dati428, gia: ConfermeDeploy): Promise<Esito428> {
  // Il pannello non conosce dei simboli di libreria (M9): si avvisa, e si può
  // procedere — li disegnerà come segnaposto.
  if (d.conferma === "simboli-mancanti" && !gia.confirmMissingSymbols) {
    const si = await conferma({ testo: testoSimboliMancanti(d.simboli ?? [], !!d.non_verificabile, d.versione_pannello) });
    return si ? { tipo: "riprova", conferme: { ...gia, confirmMissingSymbols: true } } : { tipo: "annullato" };
  }
  // The panel doesn't know the photos in symbols (plan
  // 2026-11-21-simboli-fase-3-foto): it couldn't load the project. Not a
  // confirmation — it is said, and nothing is sent.
  if (d.conferma === "symbol-photos-unsupported") {
    await avviso({ livello: "errore", testo: i18n.t("cfg.deploySymbolPhotos") });
    return { tipo: "annullato" };
  }
  // The session held for the panel is a project user's: the deploy closes
  // the project, the session ends with it, and the panel would stay without a
  // project half way (rc.30, collaudo on the PLX800). Not a confirmation.
  if (d.conferma === "project-session") {
    await avviso({ livello: "errore", testo: i18n.t("cfg.deployProjectSession") });
    return { tipo: "annullato" };
  }
  // The project turns the screen, and the system does it by restarting the
  // device — on a controller its PLCs stop too (rc.30, collaudo on the PLX800:
  // two restarts nobody had been told about).
  if (d.conferma === "rotate-screen" && !gia.confirmRotation) {
    const si = await conferma({
      testo: i18n.t(d.portrait ? "cfg.deployRotateScreenPortrait" : "cfg.deployRotateScreenLandscape"),
      pericolo: true,
    });
    return si ? { tipo: "riprova", conferme: { ...gia, confirmRotation: true } } : { tipo: "annullato" };
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
  // Gli utenti del progetto al posto di quelli del pannello (collaudo del
  // 07-11-2026): lo si dice prima. `utenti-da-cambiare` è il nome della rc.3,
  // che chiedeva solo per gli utenti col cambio password obbligatorio.
  if ((d.conferma === "utenti-sostituiti" || d.conferma === "utenti-da-cambiare") && !gia.confirmUsersChange) {
    const si = await conferma({ testo: testoSostituzioneUtenti(d) });
    return si ? { tipo: "riprova", conferme: { ...gia, confirmUsersChange: true } } : { tipo: "annullato" };
  }
  // A panel too old to rename its project (27-11-2026): keeping history or
  // users needs an update; «delete all» works. Not a confirmation.
  if (d.conferma === "plant-identity-unsupported") {
    await avviso({ livello: "errore", testo: i18n.t("cfg.deployPlantIdentityUnsupported") });
    return { tipo: "annullato" };
  }
  // A panel project with another name, and a choice (27-11-2026): the same
  // plant, another plant with the same users, or a new project.
  const scelte = (d.scelte ?? []).filter((x): x is ModoSostituzione => (MODI as readonly string[]).includes(x));
  if (d.conferma === "sostituisce-progetti" && scelte.length > 0 && !gia.replaceMode) {
    const modo = await scegli<ModoSostituzione>({
      titolo: i18n.t("cfg.deployImpiantoTitolo"),
      testo: testoSceltaImpianto(d, scelte),
      scelte: scelte.map((x) => ({ valore: x, etichetta: i18n.t(`cfg.deployScelta.${x}.etichetta`), pericolo: x !== "same_plant" })),
    });
    if (modo === null) return { tipo: "annullato" };
    // «Same plant» on a project without identity writes `meta.plant_id` in
    // `project.yaml`: the next save must not take it for a conflict.
    if (modo === "same_plant") {
      const { dimenticaVersioneProgetto } = await import("@/api/client");
      dimenticaVersioneProgetto();
    }
    return { tipo: "riprova", conferme: { ...gia, replaceMode: modo, confirmReplace: true } };
  }
  // Il deploy cancellerebbe progetti con un altro nome, storico compreso.
  if (d.conferma === "sostituisce-progetti" && !gia.confirmReplace) {
    const si = await conferma({ testo: testoSostituzione(d.progetto, d.progetti ?? []), pericolo: true });
    return si ? { tipo: "riprova", conferme: { ...gia, confirmReplace: true } } : { tipo: "annullato" };
  }
  // Il progetto non ha utenti e il dispositivo ne ha: dopo, senza un Admin del
  // dispositivo, il pannello resta chiuso finché non lo si abbina di nuovo
  // (da 11-10-2026 non è più aperto a chiunque). `conferma` assente: un server
  // di prima che la mettesse.
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
