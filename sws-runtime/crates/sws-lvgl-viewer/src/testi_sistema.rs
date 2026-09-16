// Il testo di sistema del viewer operatore: intestazioni di colonna e parole
// come «sì»/«no» che questo motore scrive da sé.
//
// **È una terza categoria**, e finché non le si dà un nome si finisce per
// trattarla come una delle altre due, sbagliando:
//
//   1. i **contenuti di progetto** stanno nella tabella lingue e li scrive
//      l'autore (`resolve_msg`);
//   2. l'**interfaccia dell'editor** sta in `sws-editor/src/i18n/*.json` e vive
//      nel browser — qui non arriva;
//   3. questo: parole che nessun progetto contiene e che nessun editor mostra,
//      ma che un operatore legge sul vetro.
//
// Fino al 16-09-2026 erano **italiano cablato** dentro `lvgl_render.rs`: un
// pannello tedesco con un progetto tradotto bene mostrava comunque «Ora»,
// «Conf.», «sì». Il web aveva già il proprio asse (i18next) e lo usava; questo
// motore non ne aveva nessuno.
//
// Perché una tabella in chiaro e non un file di traduzione: sono otto parole.
// Un meccanismo per otto parole costa più di quanto renda, e lo stesso
// ragionamento è già scritto in `sws-web/src/notifications.rs`, dove le
// etichette di una notifica hanno la stessa forma.
//
// La lingua è quella dei **contenuti** (`SharedLang`): è quella che l'operatore
// ha scelto col `lang_button`, e usare qualcosa di diverso vorrebbe dire una
// riga tradotta accanto a una no, nella stessa tabella.

/// Le parole che questo motore scrive da sé.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Testo {
    Ora,
    Allarme,
    Confermato,
    Si,
    No,
}

/// Le lingue non elencate ripiegano sull'**inglese**, non sull'italiano:
/// l'italiano era italiano solo perché lo era chi ha scritto il codice.
pub fn testo(t: Testo, lingua: &str) -> &'static str {
    use Testo::*;
    match (t, lingua) {
        (Ora, "it") => "Ora",
        (Ora, "de") => "Zeit",
        (Ora, "fr") => "Heure",
        (Ora, "es") => "Hora",
        (Ora, _) => "Time",

        (Allarme, "it") => "Allarme",
        (Allarme, "de") => "Alarm",
        (Allarme, "fr") => "Alarme",
        (Allarme, "es") => "Alarma",
        (Allarme, _) => "Alarm",

        // Abbreviato in tutte le lingue: è l'intestazione di una colonna
        // stretta, e una parola intera la farebbe tagliare — sul vetro si
        // leggerebbe «Confer…».
        (Confermato, "it") => "Conf.",
        (Confermato, "de") => "Best.",
        (Confermato, "fr") => "Acq.",
        (Confermato, "es") => "Conf.",
        (Confermato, _) => "Ack",

        (Si, "it") => "sì",
        (Si, "de") => "ja",
        (Si, "fr") => "oui",
        (Si, "es") => "sí",
        (Si, _) => "yes",

        (No, "it") => "no",
        (No, "de") => "nein",
        (No, "fr") => "non",
        (No, "es") => "no",
        (No, _) => "no",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_lingua_nota_ha_le_sue_parole() {
        assert_eq!(testo(Testo::Ora, "de"), "Zeit");
        assert_eq!(testo(Testo::Si, "es"), "sí");
    }

    #[test]
    fn una_lingua_sconosciuta_ripiega_sull_inglese_non_sull_italiano() {
        // L'italiano era italiano solo perché lo era chi ha scritto il codice.
        assert_eq!(testo(Testo::Ora, "sv"), "Time");
        assert_eq!(testo(Testo::Confermato, ""), "Ack");
    }

    #[test]
    fn nessuna_parola_e_vuota() {
        // Un'intestazione vuota su una tabella non si distingue da una colonna
        // rotta, e questo motore non ha modo di segnalarlo.
        for t in [
            Testo::Ora,
            Testo::Allarme,
            Testo::Confermato,
            Testo::Si,
            Testo::No,
        ] {
            for l in ["it", "de", "fr", "es", "sv", ""] {
                assert!(!testo(t, l).is_empty(), "{t:?}/{l} è vuoto");
            }
        }
    }
}
