// Cosa si traduce automaticamente, e cosa non si deve toccare (Fase 4 del
// piano multilingua, 15-09-2026; risponde ai punti 3 e 4 di Q43).
//
// Questo modulo non parla con nessun fornitore: decide soltanto. Il traduttore
// vero sta in `sws-web`, dietro un tratto con due realizzazioni — e una
// decisione pura si prova senza rete, mentre un traduttore no.

use crate::project::{LangEntry, LanguageTable};

/// Un segnaposto di formato: `{value}`, `{value:.1f}`, `{tag}`.
///
/// **Non è testo.** Tradurre `{value:.1f}` significa rompere il formato di un
/// widget, e un fornitore automatico lo tradurrà volentieri se gliene si dà
/// l'occasione: «{value:.1f} bar» in tedesco può tornare con il segnaposto
/// tradotto, riscritto o spostato dentro una parola. Q43 lo elenca come terzo
/// nodo da sciogliere, ed è l'unico che rompe qualcosa in modo silenzioso —
/// il pannello continua a disegnare, mostrando la formula invece del numero.
fn segnaposti(s: &str) -> Vec<(usize, usize)> {
    let b = s.as_bytes();
    let mut fuori = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'{' {
            // `{{` è un token della tabella lingue, non un segnaposto: se ne
            // occupa `resolve_msg`, e qui va saltato senza confonderlo.
            if i + 1 < b.len() && b[i + 1] == b'{' {
                i += 2;
                continue;
            }
            if let Some(chiuso) = s[i..].find('}') {
                let fine = i + chiuso + 1;
                let dentro = &s[i + 1..fine - 1];
                let plausibile = !dentro.is_empty()
                    && dentro
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || ":._+-# ".contains(c));
                if plausibile {
                    fuori.push((i, fine));
                    i = fine;
                    continue;
                }
            }
        }
        i += 1;
    }
    fuori
}

/// Sostituisce i segnaposti con dei guardiani numerati, e restituisce anche
/// l'elenco per rimetterli a posto.
///
/// I guardiani sono `\u{0}0\u{0}`, `\u{0}1\u{0}`…: caratteri che nessun
/// traduttore tocca e che nessun autore digita. Un guardiano fatto di lettere
/// (`PH0`, `__0__`) verrebbe tradotto o spaziato, e ci si accorgerebbe del
/// problema solo guardando un pannello vero.
pub fn proteggi(s: &str) -> (String, Vec<String>) {
    let punti = segnaposti(s);
    if punti.is_empty() {
        return (s.to_string(), Vec::new());
    }
    let mut fuori = String::with_capacity(s.len());
    let mut originali = Vec::new();
    let mut ultimo = 0;
    for (inizio, fine) in punti {
        fuori.push_str(&s[ultimo..inizio]);
        fuori.push('\u{0}');
        fuori.push_str(&originali.len().to_string());
        fuori.push('\u{0}');
        originali.push(s[inizio..fine].to_string());
        ultimo = fine;
    }
    fuori.push_str(&s[ultimo..]);
    (fuori, originali)
}

/// Rimette i segnaposti al loro posto dopo la traduzione.
///
/// Un guardiano che non torna indietro è un segnale, non un dettaglio: vuol
/// dire che il fornitore l'ha mangiato, e la traduzione va scartata invece che
/// salvata mutilata.
pub fn ripristina(tradotto: &str, originali: &[String]) -> Option<String> {
    let mut fuori = tradotto.to_string();
    for (i, orig) in originali.iter().enumerate() {
        let guardiano = format!("\u{0}{i}\u{0}");
        if !fuori.contains(&guardiano) {
            return None;
        }
        fuori = fuori.replace(&guardiano, orig);
    }
    Some(fuori)
}

/// Una voce da mandare a tradurre.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DaTradurre {
    pub key: String,
    /// Il testo nella lingua sorgente, coi segnaposti già protetti.
    pub testo: String,
    /// I segnaposti tolti, per rimetterli dopo.
    pub segnaposti: Vec<String>,
}

/// Quali voci vanno tradotte da `da` verso `a`.
///
/// **Una traduzione scritta a mano non si sovrascrive** (Q43, punto 4): senza
/// questa regola la passata successiva cancella il lavoro umano, e chi l'aveva
/// fatto se ne accorge quando il pannello è già in campo. Il segno è
/// `LangEntry.auto`: elenca le lingue riempite dalla macchina, e una correzione
/// a mano lo toglie. Con `sovrascrivi` si rifà tutto **tranne** ciò che è
/// umano — che resta comunque intoccabile.
///
/// Non si manda a tradurre: una voce senza testo sorgente, una già presente
/// nella lingua di arrivo (salvo `sovrascrivi` su una automatica), e una il cui
/// testo — tolti i segnaposti — non contiene nemmeno una lettera.
pub fn da_tradurre(
    tabella: &LanguageTable,
    da: &str,
    a: &str,
    sovrascrivi: bool,
) -> Vec<DaTradurre> {
    tabella
        .entries
        .iter()
        .filter_map(|e| {
            let sorgente = e.values.get(da)?;
            if sorgente.trim().is_empty() {
                return None;
            }
            let gia = e
                .values
                .get(a)
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false);
            if gia {
                let automatica = e.auto.iter().any(|l| l == a);
                if !(sovrascrivi && automatica) {
                    return None;
                }
            }
            let (protetto, segnaposti) = proteggi(sorgente);
            if !protetto.chars().any(char::is_alphabetic) {
                return None;
            }
            Some(DaTradurre {
                key: e.key.clone(),
                testo: protetto,
                segnaposti,
            })
        })
        .collect()
}

/// Scrive una traduzione automatica nella tabella, marcandola come tale.
pub fn scrivi_automatica(entry: &mut LangEntry, lingua: &str, testo: String) {
    entry.values.insert(lingua.to_string(), testo);
    if !entry.auto.iter().any(|l| l == lingua) {
        entry.auto.push(lingua.to_string());
    }
}

/// Toglie il marchio «automatica»: qualcuno l'ha corretta a mano, e da ora è
/// sua. Va chiamata da chi modifica la tabella nell'editor.
pub fn marca_come_umana(entry: &mut LangEntry, lingua: &str) {
    entry.auto.retain(|l| l != lingua);
}

/// Cosa si traduce, cosa si protegge, cosa si lascia stare.
///
/// I due difetti che questi test tengono fermi sono quelli che Q43 elencava
/// come nodi 3 e 4: un segnaposto tradotto rompe il formato di un widget **in
/// silenzio** (il pannello continua a disegnare, mostrando la formula invece
/// del numero), e una passata automatica che riscrive tutto cancella il lavoro
/// di chi aveva corretto a mano.
#[cfg(test)]
mod tests {
    use super::*;

    fn voce(key: &str, valori: &[(&str, &str)], auto: &[&str]) -> LangEntry {
        LangEntry {
            key: key.into(),
            values: valori
                .iter()
                .map(|(l, t)| (l.to_string(), t.to_string()))
                .collect(),
            auto: auto.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn tabella(entries: Vec<LangEntry>) -> LanguageTable {
        LanguageTable {
            default: "it".into(),
            langs: vec!["it".into(), "de".into()],
            entries,
        }
    }

    #[test]
    fn il_segnaposto_esce_dal_testo_e_ci_rientra_identico() {
        let (protetto, orig) = proteggi("Pressione {value:.1f} bar");
        assert!(!protetto.contains("{value"), "il segnaposto è ancora lì");
        assert_eq!(orig, vec!["{value:.1f}"]);
        // Il fornitore traduce ciò che vede e lascia stare il guardiano.
        let tradotto = protetto.replace("Pressione", "Druck");
        assert_eq!(
            ripristina(&tradotto, &orig).unwrap(),
            "Druck {value:.1f} bar"
        );
    }

    #[test]
    fn piu_segnaposti_tornano_al_posto_giusto_anche_se_riordinati() {
        let (protetto, orig) = proteggi("{a} di {b}");
        // Il tedesco inverte: è proprio il motivo per cui la frase si traduce
        // intera invece di spezzarla attorno ai segnaposti.
        let invertito = protetto
            .split(" di ")
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" von ");
        let fuori = ripristina(&invertito, &orig).unwrap();
        assert_eq!(fuori, "{b} von {a}");
    }

    #[test]
    fn un_guardiano_mangiato_dal_fornitore_fa_scartare_la_traduzione() {
        // Salvare una traduzione mutilata sarebbe peggio che non tradurre: il
        // widget mostrerebbe una frase senza il proprio valore.
        let (_, orig) = proteggi("Pressione {value} bar");
        assert!(ripristina("Druck bar", &orig).is_none());
    }

    #[test]
    fn i_token_della_tabella_lingue_non_sono_segnaposti() {
        // `{{chiave}}` è un riferimento alla tabella, non un formato: se ne
        // occupa `resolve_msg`, e confonderli qui li proteggerebbe due volte.
        let (protetto, orig) = proteggi("{{ciao}} mondo");
        assert_eq!(protetto, "{{ciao}} mondo");
        assert!(orig.is_empty());
    }

    #[test]
    fn non_si_traduce_cio_che_e_gia_tradotto() {
        let t = tabella(vec![voce("t1", &[("it", "Avvio"), ("de", "Start")], &[])]);
        assert!(da_tradurre(&t, "it", "de", false).is_empty());
    }

    #[test]
    fn una_traduzione_umana_non_si_sovrascrive_nemmeno_chiedendolo() {
        // È il punto 4 di Q43. `sovrascrivi` rifà le automatiche; il lavoro di
        // una persona resta intoccabile, altrimenti il pulsante «ritraduci
        // tutto» diventa un pulsante «butta via le correzioni».
        let t = tabella(vec![voce("t1", &[("it", "Avvio"), ("de", "Anlauf")], &[])]);
        assert!(da_tradurre(&t, "it", "de", true).is_empty());
    }

    #[test]
    fn una_traduzione_automatica_si_rifa_solo_se_lo_si_chiede() {
        let t = tabella(vec![voce(
            "t1",
            &[("it", "Avvio"), ("de", "Start")],
            &["de"],
        )]);
        assert!(da_tradurre(&t, "it", "de", false).is_empty());
        assert_eq!(da_tradurre(&t, "it", "de", true).len(), 1);
    }

    #[test]
    fn senza_testo_sorgente_non_c_e_niente_da_tradurre() {
        let t = tabella(vec![
            voce("t1", &[("de", "Start")], &[]),
            voce("t2", &[("it", "   ")], &[]),
        ]);
        assert!(da_tradurre(&t, "it", "de", false).is_empty());
    }

    #[test]
    fn un_testo_fatto_solo_di_segnaposti_e_numeri_non_si_manda_a_tradurre() {
        // Niente lettere = niente da tradurre, e ogni chiamata costa.
        let t = tabella(vec![
            voce("t1", &[("it", "{value:.1f}")], &[]),
            voce("t2", &[("it", "42")], &[]),
        ]);
        assert!(da_tradurre(&t, "it", "de", false).is_empty());
    }

    #[test]
    fn scrivere_e_correggere_a_mano_cambiano_il_marchio() {
        let mut e = voce("t1", &[("it", "Avvio")], &[]);
        scrivi_automatica(&mut e, "de", "Start".into());
        assert_eq!(e.values.get("de").unwrap(), "Start");
        assert_eq!(e.auto, vec!["de".to_string()]);
        marca_come_umana(&mut e, "de");
        assert!(
            e.auto.is_empty(),
            "la correzione a mano non ha tolto il marchio"
        );
    }
}
