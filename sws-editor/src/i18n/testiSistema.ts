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
  | "allarme_attivo" | "escalation_non_riconosciuta";

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
