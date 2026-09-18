//! Il testo di sistema: le parole che il **runtime** scrive da sé dentro una
//! pagina o dentro una notifica, in una lingua che non è né quella dell'editor
//! né un contenuto d'autore.
//!
//! **È una terza categoria**, e finché non le si dà un nome si finisce per
//! trattarla come una delle altre due, sbagliando:
//!
//!   1. i **contenuti di progetto** stanno nella tabella lingue e li scrive
//!      l'autore (`resolve_msg`);
//!   2. l'**interfaccia dell'editor** sta in `sws-editor/src/i18n/*.json` e vive
//!      nel browser;
//!   3. questo: intestazioni di colonna, «sì»/«no», «N/D», il titolo di una
//!      notifica — parole che nessun progetto contiene e che nessun editor
//!      mostra, ma che un operatore legge sul vetro o nella posta.
//!
//! **Perché sta in `sws-core` e non nel viewer.** Fino al 18-09-2026 queste
//! parole vivevano in tre posti che non si conoscevano: il viewer LVGL (5, in
//! cinque lingue), le notifiche (8, cinque lingue) e il web (8, **due** lingue,
//! e seguivano la lingua dell'IDE invece di quella dei contenuti). Un operatore
//! tedesco leggeva «Zeit» sul pannello e «Time» nel browser. Ora la tabella è
//! **una**, `tests/fixtures/testi-sistema.json`, letta dal test di questo
//! modulo, dal test TypeScript e da una guardia statica che verifica che le due
//! implementazioni la contengano parola per parola.
//!
//! Perché una tabella in chiaro e non un file di traduzione: sono sedici parole.
//! Un meccanismo per sedici parole costa più di quanto renda.
//!
//! La lingua è quella dei **contenuti** — quella scelta col `lang_button` sul
//! pannello, `notify_lang` per una notifica — e mai quella dell'editor: usare
//! un'altra lingua vorrebbe dire una riga tradotta accanto a una no, nella
//! stessa tabella.

/// Le parole che il runtime scrive da sé. I nomi in `da_nome` sono le chiavi
/// della fixture condivisa.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Testo {
    Ora,
    Allarme,
    Confermato,
    Si,
    No,
    Messaggio,
    Severita,
    Tag,
    Valore,
    Attivato,
    Dati,
    Unita,
    Altro,
    Nd,
    AllarmeAttivo,
    EscalationNonRiconosciuta,
}

/// Tutte le voci, per i test che devono iterarle senza ripetere l'elenco a
/// mano — che è come si dimentica l'ultima aggiunta.
pub const TUTTI: &[Testo] = &[
    Testo::Ora,
    Testo::Allarme,
    Testo::Confermato,
    Testo::Si,
    Testo::No,
    Testo::Messaggio,
    Testo::Severita,
    Testo::Tag,
    Testo::Valore,
    Testo::Attivato,
    Testo::Dati,
    Testo::Unita,
    Testo::Altro,
    Testo::Nd,
    Testo::AllarmeAttivo,
    Testo::EscalationNonRiconosciuta,
];

/// Dal nome nella fixture alla voce. `None` = la fixture ha una voce che
/// questo modulo non conosce: il test lo dice, e la si aggiunge qui.
pub fn da_nome(nome: &str) -> Option<Testo> {
    Some(match nome {
        "ora" => Testo::Ora,
        "allarme" => Testo::Allarme,
        "confermato" => Testo::Confermato,
        "si" => Testo::Si,
        "no" => Testo::No,
        "messaggio" => Testo::Messaggio,
        "severita" => Testo::Severita,
        "tag" => Testo::Tag,
        "valore" => Testo::Valore,
        "attivato" => Testo::Attivato,
        "dati" => Testo::Dati,
        "unita" => Testo::Unita,
        "altro" => Testo::Altro,
        "nd" => Testo::Nd,
        "allarme_attivo" => Testo::AllarmeAttivo,
        "escalation_non_riconosciuta" => Testo::EscalationNonRiconosciuta,
        _ => return None,
    })
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

        (Messaggio, "it") => "Messaggio",
        (Messaggio, "de") => "Meldung",
        (Messaggio, "fr") => "Message",
        (Messaggio, "es") => "Mensaje",
        (Messaggio, _) => "Message",

        (Severita, "it") => "Severità",
        (Severita, "de") => "Schweregrad",
        (Severita, "fr") => "Gravité",
        (Severita, "es") => "Severidad",
        (Severita, _) => "Severity",

        (Tag, _) => "Tag",

        (Valore, "it") => "Valore",
        (Valore, "de") => "Wert",
        (Valore, "fr") => "Valeur",
        (Valore, "es") => "Valor",
        (Valore, _) => "Value",

        (Attivato, "it") => "Attivato",
        (Attivato, "de") => "Ausgelöst",
        (Attivato, "fr") => "Déclenché",
        (Attivato, "es") => "Activado",
        (Attivato, _) => "Triggered",

        (Dati, "it") => "Dati",
        (Dati, "de") => "Daten",
        (Dati, "fr") => "Données",
        (Dati, "es") => "Datos",
        (Dati, _) => "Data",

        (Unita, "it") => "U.M.",
        (Unita, "de") => "Einh.",
        (Unita, "fr") => "Unité",
        (Unita, "es") => "Unidad",
        (Unita, _) => "Unit",

        (Altro, "it") => "altro",
        (Altro, "de") => "andere",
        (Altro, "fr") => "autres",
        (Altro, "es") => "otros",
        (Altro, _) => "other",

        (Nd, "it") => "N/D",
        (Nd, "de") => "k. A.",
        (Nd, "fr") => "N/D",
        (Nd, "es") => "N/D",
        (Nd, _) => "N/A",

        (AllarmeAttivo, "it") => "🔴 ALLARME ATTIVO",
        (AllarmeAttivo, "de") => "🔴 ALARM AKTIV",
        (AllarmeAttivo, "fr") => "🔴 ALARME ACTIVE",
        (AllarmeAttivo, "es") => "🔴 ALARMA ACTIVA",
        (AllarmeAttivo, _) => "🔴 ALARM ACTIVE",

        (EscalationNonRiconosciuta, "it") => "⏫ ESCALATION: allarme non riconosciuto",
        (EscalationNonRiconosciuta, "de") => "⏫ ESKALATION: Alarm nicht quittiert",
        (EscalationNonRiconosciuta, "fr") => "⏫ ESCALADE : alarme non acquittée",
        (EscalationNonRiconosciuta, "es") => "⏫ ESCALADO: alarma no reconocida",
        (EscalationNonRiconosciuta, _) => "⏫ ESCALATION: alarm not acknowledged",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[derive(serde::Deserialize)]
    struct Fixture {
        ripiego: String,
        voci: BTreeMap<String, BTreeMap<String, String>>,
    }

    fn fixture() -> Fixture {
        let percorso = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../tests/fixtures/testi-sistema.json"
        );
        let testo = std::fs::read_to_string(percorso)
            .unwrap_or_else(|e| panic!("la tabella condivisa manca ({percorso}): {e}"));
        serde_json::from_str(&testo).expect("tabella condivisa non valida")
    }

    /// La stessa tabella la legge il test TypeScript (`tests/testiSistema.test.ts`):
    /// non una copia, **lo stesso file**. È così che «Zeit» sul pannello e
    /// «Time» nel browser non possono più succedere senza che qualcosa diventi
    /// rosso.
    #[test]
    fn la_tabella_condivisa_col_web() {
        let f = fixture();
        let mut rotti = Vec::new();
        for (nome, lingue) in &f.voci {
            let Some(t) = da_nome(nome) else {
                rotti.push(format!("  la fixture ha «{nome}», questo modulo no: aggiungilo a `Testo` e a `da_nome`"));
                continue;
            };
            for (lingua, atteso) in lingue {
                let avuto = testo(t, lingua);
                if avuto != atteso {
                    rotti.push(format!(
                        "  {nome}/{lingua}: atteso {atteso:?}, avuto {avuto:?}"
                    ));
                }
            }
            // Una lingua che nessuno ha elencato: il ripiego dichiarato.
            let ripiego = &lingue[&f.ripiego];
            let avuto = testo(t, "sv");
            if avuto != ripiego {
                rotti.push(format!(
                    "  {nome}/sv: atteso il ripiego {ripiego:?}, avuto {avuto:?}"
                ));
            }
        }
        // E nel verso opposto: ogni voce di questo modulo sta nella fixture.
        for t in TUTTI {
            let nome = f.voci.keys().find(|n| da_nome(n) == Some(*t));
            if nome.is_none() {
                rotti.push(format!("  {t:?} non ha una voce nella fixture"));
            }
        }
        assert!(
            rotti.is_empty(),
            "{} divergenze dalla tabella condivisa:\n{}",
            rotti.len(),
            rotti.join("\n")
        );
    }

    #[test]
    fn nessuna_parola_e_vuota() {
        // Un'intestazione vuota su una tabella non si distingue da una colonna
        // rotta, e il motore LVGL non ha modo di segnalarlo.
        for t in TUTTI {
            for l in ["it", "de", "fr", "es", "sv", ""] {
                assert!(!testo(*t, l).is_empty(), "{t:?}/{l} è vuoto");
            }
        }
    }

    #[test]
    fn una_lingua_sconosciuta_ripiega_sull_inglese_non_sull_italiano() {
        assert_eq!(testo(Testo::Ora, "sv"), "Time");
        assert_eq!(testo(Testo::Confermato, ""), "Ack");
    }
}
