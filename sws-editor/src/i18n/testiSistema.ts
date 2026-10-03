// Il testo di sistema del viewer web: le parole che il MOTORE scrive dentro la
// pagina — intestazioni di colonna, «sì»/«no», «N/D», «altro» — nella lingua dei
// **contenuti**, non dell'IDE.
//
// Fino al 18-09-2026 queste otto parole stavano in `it.json`/`en.json` sotto
// `viewerChrome.*` e passavano da `t()`: due lingue sole, e la lingua
// **dell'interfaccia**. Il pannello LVGL le aveva in cinque lingue e seguiva la
// lingua dei contenuti. Un operatore tedesco, con lo stesso progetto, leggeva
// «Zeit» sul vetro e «Time» nel browser.
//
// La tabella qui sotto è scritta nel modulo e non importata da un JSON: Vite non
// serve file fuori da `src/` e il bundle si porterebbe dentro un file di test.
// Ma **non è la fonte**: la fonte è `tests/fixtures/testi-sistema.json`, che il
// test `tests/testiSistema.test.ts` confronta parola per parola con questa
// tabella e che il test Rust di `sws-core::testi_sistema` confronta con quella.
// La guardia `scripts/check_testi_sistema.sh` lo fa senza eseguire niente.
//
// La shell del viewer (login, header, RuntimeView) NON passa da qui: è
// interfaccia, asse dell'IDE. Su LVGL non esiste una shell, quindi non c'è
// parità da tenere — lo schermo web può mostrare header in inglese e tabella in
// tedesco, ed è voluto.

export type VoceSistema =
  | "ora" | "allarme" | "confermato" | "si" | "no"
  | "messaggio" | "severita" | "tag" | "valore" | "attivato"
  | "dati" | "unita" | "altro" | "nd"
  | "allarme_attivo" | "escalation_non_riconosciuta" | "allarme_rientrato"
  | "stato" | "attivo" | "da_confermare" | "chiuso" | "interrotto"
  // L'avviso di aggiornamento sullo schermo del pannello (29-09-2026): le
  // uniche voci con un segnaposto, `{a}` e `{da}` — vedi `testoSistemaCon`.
  | "agg_titolo"
  | "agg_da"
  | "agg_novita"
  | "agg_aggiorna"
  | "agg_piu_tardi"
  | "agg_ignora"
  | "agg_in_corso"
  | "esito_titolo_ok"
  | "esito_titolo_ko"
  | "esito_versioni"
  | "esito_spiega"
  | "esito_chiudi"
  // Il trend senza dati (30-09-2026): lo scrive il motore dentro il grafico.
  | "trend_nessun_tag"
  | "trend_in_attesa"
  // La configurazione del servizio da aggiornare (02-10-2026): `{da}`, `{a}`.
  | "quadlet_titolo"
  | "quadlet_spiega"
  | "conf_titolo"
  | "conf_spiega"
  | "conf_dati"
  | "conf_pulisci"
  | "conf_dopo_riavvio"
  | "conf_ritorna"
  | "conf_ritorna_sicuro"
  | "conf_annulla";

export const LINGUE_SISTEMA = ["it", "de", "fr", "es", "en"] as const;
export type LinguaSistema = (typeof LINGUE_SISTEMA)[number];

/** Le lingue non elencate ripiegano sull'inglese, non sull'italiano. */
export const RIPIEGO: LinguaSistema = "en";

export const TESTI_SISTEMA: Record<VoceSistema, Record<LinguaSistema, string>> = {
  ora:        { it: "Ora",       de: "Zeit",        fr: "Heure",     es: "Hora",      en: "Time" },
  allarme:    { it: "Allarme",   de: "Alarm",       fr: "Alarme",    es: "Alarma",    en: "Alarm" },
  confermato: { it: "Conf.",     de: "Best.",       fr: "Acq.",      es: "Conf.",     en: "Ack" },
  si:         { it: "sì",        de: "ja",          fr: "oui",       es: "sí",        en: "yes" },
  no:         { it: "no",        de: "nein",        fr: "non",       es: "no",        en: "no" },
  messaggio:  { it: "Messaggio", de: "Meldung",     fr: "Message",   es: "Mensaje",   en: "Message" },
  severita:   { it: "Severità",  de: "Schweregrad", fr: "Gravité",   es: "Severidad", en: "Severity" },
  tag:        { it: "Tag",       de: "Tag",         fr: "Tag",       es: "Tag",       en: "Tag" },
  valore:     { it: "Valore",    de: "Wert",        fr: "Valeur",    es: "Valor",     en: "Value" },
  attivato:   { it: "Attivato",  de: "Ausgelöst",   fr: "Déclenché", es: "Activado",  en: "Triggered" },
  dati:       { it: "Dati",      de: "Daten",       fr: "Données",   es: "Datos",     en: "Data" },
  unita:      { it: "U.M.",      de: "Einh.",       fr: "Unité",     es: "Unidad",    en: "Unit" },
  altro:      { it: "altro",     de: "andere",      fr: "autres",    es: "otros",     en: "other" },
  nd:         { it: "N/D",       de: "k. A.",       fr: "N/D",       es: "N/D",       en: "N/A" },
  stato: { it: "Stato", de: "Status", fr: "État", es: "Estado", en: "State" },
  attivo: { it: "Attivo", de: "Aktiv", fr: "Actif", es: "Activo", en: "Active" },
  da_confermare: { it: "Da conf.", de: "Offen", fr: "À acq.", es: "Por conf.", en: "To ack" },
  chiuso: { it: "Chiuso", de: "Beendet", fr: "Clos", es: "Cerrado", en: "Closed" },
  interrotto: { it: "Interr.", de: "Abgebr.", fr: "Interr.", es: "Interr.", en: "Interr." },
  agg_titolo: {
    it: "Versione {a} disponibile",
    de: "Version {a} verfügbar",
    fr: "Version {a} disponible",
    es: "Versión {a} disponible",
    en: "Version {a} available",
  },
  agg_da: {
    it: "Questo pannello gira la {da}.",
    de: "Dieses Panel läuft mit {da}.",
    fr: "Ce panneau exécute la {da}.",
    es: "Este panel ejecuta la {da}.",
    en: "This panel runs {da}.",
  },
  agg_novita: { it: "Novità", de: "Neuerungen", fr: "Nouveautés", es: "Novedades", en: "What's new" },
  agg_aggiorna: { it: "Aggiorna ora", de: "Jetzt aktualisieren", fr: "Mettre à jour", es: "Actualizar ahora", en: "Update now" },
  agg_piu_tardi: { it: "Più tardi", de: "Später", fr: "Plus tard", es: "Más tarde", en: "Later" },
  agg_ignora: {
    it: "Ignora questa versione",
    de: "Diese Version überspringen",
    fr: "Ignorer cette version",
    es: "Omitir esta versión",
    en: "Skip this version",
  },
  agg_in_corso: {
    it: "Aggiornamento avviato…",
    de: "Aktualisierung gestartet…",
    fr: "Mise à jour lancée…",
    es: "Actualización iniciada…",
    en: "Update started…",
  },
  esito_titolo_ok: {
    it: "Aggiornamento completato",
    de: "Aktualisierung abgeschlossen",
    fr: "Mise à jour terminée",
    es: "Actualización completada",
    en: "Update completed",
  },
  esito_titolo_ko: {
    it: "Aggiornamento non riuscito",
    de: "Aktualisierung fehlgeschlagen",
    fr: "Échec de la mise à jour",
    es: "Error en la actualización",
    en: "Update failed",
  },
  esito_versioni: {
    it: "Il pannello è passato dalla {da} alla {a}.",
    de: "Das Panel ist von {da} auf {a} gewechselt.",
    fr: "Le panneau est passé de la {da} à la {a}.",
    es: "El panel ha pasado de la {da} a la {a}.",
    en: "The panel went from {da} to {a}.",
  },
  esito_spiega: {
    it: "Il pannello ha provato a passare alla {a}: la versione nuova non è partita bene, ed è tornato da solo alla {da}. Non c'è niente da fare qui: se ne occupa chi gestisce il pannello.",
    de: "Das Panel hat versucht, auf {a} zu wechseln: die neue Version ist nicht richtig gestartet, und es ist von selbst auf {da} zurückgekehrt. Hier ist nichts zu tun: darum kümmert sich, wer das Panel verwaltet.",
    fr: "Le panneau a tenté de passer à la {a} : la nouvelle version n'a pas démarré correctement, et il est revenu tout seul à la {da}. Rien à faire ici : la personne qui gère le panneau s'en occupe.",
    es: "El panel intentó pasar a la {a}: la versión nueva no arrancó bien, y volvió solo a la {da}. Aquí no hay nada que hacer: se encarga quien gestiona el panel.",
    en: "The panel tried to move to {a}: the new version did not start properly, and it went back to {da} by itself. Nothing to do here: whoever manages the panel will take care of it.",
  },
  esito_chiudi: { it: "Chiudi", de: "Schließen", fr: "Fermer", es: "Cerrar", en: "Close" },
  trend_nessun_tag: { it: "Tag non configurato", de: "Kein Tag konfiguriert", fr: "Aucun tag configuré", es: "Tag no configurado", en: "No tag configured" },
  trend_in_attesa: { it: "In attesa di campioni…", de: "Warte auf Messwerte…", fr: "En attente d'échantillons…", es: "Esperando muestras…", en: "Waiting for samples…" },
  quadlet_titolo: { it: "Configurazione del servizio da aggiornare", de: "Dienstkonfiguration aktualisieren", fr: "Configuration du service à mettre à jour", es: "Configuración del servicio por actualizar", en: "Service configuration needs updating" },
  quadlet_spiega: { it: "Il pannello ha la configurazione {da}, questa versione vuole la {a}. Aggiornandola il pannello si riavvia.", de: "Das Panel hat die Konfiguration {da}, diese Version erwartet {a}. Beim Aktualisieren startet das Panel neu.", fr: "Le panneau a la configuration {da}, cette version attend la {a}. La mise à jour redémarre le panneau.", es: "El panel tiene la configuración {da}, esta versión espera la {a}. Al actualizarla, el panel se reinicia.", en: "The panel has configuration {da}, this version expects {a}. Updating it restarts the panel." },
  conf_titolo: { it: "Confermare l'aggiornamento?", de: "Aktualisierung bestätigen?", fr: "Confirmer la mise à jour ?", es: "¿Confirmar la actualización?", en: "Confirm the update?" },
  conf_spiega: { it: "Il pannello ora gira con la {a}. Finché non confermi, la {da} resta sul pannello e ci si può tornare.", de: "Das Panel läuft jetzt mit {a}. Bis zur Bestätigung bleibt {da} auf dem Panel und man kann zurückkehren.", fr: "Le panneau tourne maintenant avec la {a}. Tant que vous ne confirmez pas, la {da} reste sur le panneau et on peut y revenir.", es: "El panel funciona ahora con la {a}. Hasta que confirmes, la {da} sigue en el panel y se puede volver a ella.", en: "The panel now runs {a}. Until you confirm, {da} stays on the panel and you can go back to it." },
  conf_dati: { it: "Tornando indietro si riprendono anche i dati di prima dell'aggiornamento: quelli scritti dopo si perdono.", de: "Beim Zurückkehren werden auch die Daten von vor der Aktualisierung wiederhergestellt: später geschriebene gehen verloren.", fr: "En revenant, les données d'avant la mise à jour sont aussi restaurées : celles écrites après sont perdues.", es: "Al volver también se recuperan los datos de antes de la actualización: los escritos después se pierden.", en: "Going back also restores the data from before the update: anything written since is lost." },
  conf_pulisci: { it: "Conferma e pulisci", de: "Bestätigen und aufräumen", fr: "Confirmer et nettoyer", es: "Confirmar y limpiar", en: "Confirm and clean up" },
  conf_dopo_riavvio: { it: "Conferma dopo il riavvio", de: "Nach dem Neustart bestätigen", fr: "Confirmer après le redémarrage", es: "Confirmar tras el reinicio", en: "Confirm after restart" },
  conf_ritorna: { it: "Torna alla {da}", de: "Zurück zu {da}", fr: "Revenir à la {da}", es: "Volver a la {da}", en: "Go back to {da}" },
  conf_ritorna_sicuro: { it: "Tornare davvero alla {da}? Il pannello si riavvia.", de: "Wirklich zu {da} zurückkehren? Das Panel startet neu.", fr: "Revenir vraiment à la {da} ? Le panneau redémarre.", es: "¿Volver realmente a la {da}? El panel se reinicia.", en: "Really go back to {da}? The panel restarts." },
  conf_annulla: { it: "Annulla", de: "Abbrechen", fr: "Annuler", es: "Cancelar", en: "Cancel" },
  allarme_attivo: {
    it: "🔴 ALLARME ATTIVO", de: "🔴 ALARM AKTIV", fr: "🔴 ALARME ACTIVE", es: "🔴 ALARMA ACTIVA", en: "🔴 ALARM ACTIVE",
  },
  escalation_non_riconosciuta: {
    it: "⏫ ESCALATION: allarme non riconosciuto",
    de: "⏫ ESKALATION: Alarm nicht quittiert",
    fr: "⏫ ESCALADE : alarme non acquittée",
    es: "⏫ ESCALADO: alarma no reconocida",
    en: "⏫ ESCALATION: alarm not acknowledged",
  },
  allarme_rientrato: {
    it: "🟢 RIENTRATO: allarme tornato normale", de: "🟢 ZURÜCKGEKEHRT: Alarm wieder normal", fr: "🟢 RETOUR : alarme revenue à la normale", es: "🟢 NORMALIZADA: alarma de vuelta a la normalidad", en: "🟢 CLEARED: alarm back to normal",
  },
};

function eLinguaSistema(l: string): l is LinguaSistema {
  return (LINGUE_SISTEMA as readonly string[]).includes(l);
}

/** La parola `voce` nella `lingua` dei contenuti; per una lingua non elencata,
 *  l'inglese. Mai una stringa vuota: un'intestazione vuota non si distingue da
 *  una colonna rotta. */
export function testoSistema(voce: VoceSistema, lingua: string): string {
  const l = eLinguaSistema(lingua) ? lingua : RIPIEGO;
  return TESTI_SISTEMA[voce][l];
}

/** La stessa frase con i segnaposto sostituiti: `{a}`, `{da}`.
 *
 *  Le frasi dell'avviso di aggiornamento sono le prime voci non atomiche della
 *  tabella. La sostituzione è letterale, come `testo_con` in Rust: due
 *  segnaposto in undici frasi non giustificano un motore di template, e tenere
 *  le due copie identiche è la condizione perché la guardia le sappia
 *  confrontare. Nota la forma `{nome}` e non `{{nome}}`: queste frasi non
 *  passano più da i18next.
 */
export function testoSistemaCon(
  voce: VoceSistema,
  lingua: string,
  valori: Record<string, string>,
): string {
  let s: string = testoSistema(voce, lingua);
  for (const [nome, v] of Object.entries(valori)) s = s.split(`{${nome}}`).join(v);
  return s;
}
