// Cosa si traduce automaticamente, e cosa non si deve toccare (Fase 4 del
// piano multilingua, 15-09-2026; risponde ai punti 3 e 4 di Q43).
//
// Questo modulo non parla con nessun fornitore: decide soltanto. Il traduttore
// vero sta in `sws-web`, dietro un tratto con due realizzazioni — e una
// decisione pura si prova senza rete, mentre un traduttore no.

use crate::project::{LangEntry, LanguageTable};
use unicode_properties::emoji::UnicodeEmoji;

/// Un carattere del catalogo di caratteri speciali (T-71, 🏠 🔐 🔧...) è
/// **anche lui** un pezzo da non tradurre, per lo stesso motivo del
/// segnaposto: un fornitore automatico può alterarlo o perderlo dentro una
/// frase ("Pompa 🔧 avviata"). Non ogni carattere `Emoji=YES` conta — le
/// cifre ASCII e `#`/`*` lo sono solo per le sequenze keycap (0️⃣) e da sole
/// non hanno niente da proteggere.
fn e_simbolo_protetto(c: char) -> bool {
    !c.is_ascii() && c.is_emoji_char()
}

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

/// Segnaposto di formato **e** simboli del catalogo caratteri, uniti e
/// ordinati: dal punto di vista di chi spezza la frase sono la stessa cosa,
/// un pezzo che il traduttore non deve mai vedere.
fn punti_da_proteggere(s: &str) -> Vec<(usize, usize)> {
    let mut fuori = segnaposti(s);
    for (i, c) in s.char_indices() {
        if e_simbolo_protetto(c) {
            fuori.push((i, i + c.len_utf8()));
        }
    }
    fuori.sort_by_key(|&(inizio, _)| inizio);
    fuori
}

/// Un pezzo di una frase: o testo da tradurre, o un segnaposto da non toccare.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Pezzo {
    Testo(String),
    Segnaposto(String),
}

/// Spezza una frase nei suoi pezzi, separando i segnaposti dal testo.
///
/// **La via che non può fallire.** Dopo tre tentativi di far sopravvivere un
/// guardiano dentro il testo — NUL (non arrivava), `⟦0⟧` (riordinato in
/// «Warm stay: ⟦⟧0°C»), un carattere dell'area privata (cancellato senza
/// lasciare traccia) — la conclusione è che un fornitore
/// di traduzione è una **scatola nera**: quello che gli mandi può tornare
/// cambiato in modi che non si finisce mai di prevedere.
///
/// Quindi il segnaposto non gli si manda affatto. Si traduce solo il testo
/// attorno, e il segnaposto lo rimettiamo noi, che sappiamo dov'era.
///
/// Il prezzo, dichiarato: il traduttore non può **riordinare** il testo attorno
/// al segnaposto, perché vede i pezzi separatamente e perde il contesto. Per
/// «Soggiorno caldo: {value:.1f}°C» non cambia niente; per una lingua che
/// mettesse l'unità prima del numero il risultato è imperfetto — ma è
/// imperfetto e **intero**, non rotto, e resta marcato come automatico così una
/// correzione a mano lo sostituisce per sempre.
pub fn segmenta(s: &str) -> Vec<Pezzo> {
    let punti = punti_da_proteggere(s);
    if punti.is_empty() {
        return vec![Pezzo::Testo(s.to_string())];
    }
    let mut fuori = Vec::new();
    let mut ultimo = 0;
    for (inizio, fine) in punti {
        if inizio > ultimo {
            fuori.push(Pezzo::Testo(s[ultimo..inizio].to_string()));
        }
        fuori.push(Pezzo::Segnaposto(s[inizio..fine].to_string()));
        ultimo = fine;
    }
    if ultimo < s.len() {
        fuori.push(Pezzo::Testo(s[ultimo..].to_string()));
    }
    fuori
}

/// Vale la pena mandare questo pezzo a tradurre? Uno spazio o una unità di
/// misura non hanno niente da tradurre, e ogni chiamata costa.
pub fn da_mandare(p: &Pezzo) -> bool {
    match p {
        Pezzo::Segnaposto(_) => false,
        Pezzo::Testo(t) => t.chars().any(char::is_alphabetic),
    }
}

/// Separa gli spazi ai bordi dal testo vero: `("Soggiorno caldo: ")` →
/// `("", "Soggiorno caldo:", " ")`.
///
/// Serve perché gli spazi ai bordi di un pezzo sono **giunzioni**: tengono
/// staccato il testo dal segnaposto che segue. Un fornitore non ha motivo di
/// conservarli — la maggior parte restituisce la frase ripulita — e senza
/// questo «Soggiorno caldo: {v}°C» tornerebbe «Warm living room:22.0°C».
/// Stessa regola del segnaposto: ciò che possiamo rimettere noi non glielo
/// mandiamo.
pub fn bordi(t: &str) -> (&str, &str, &str) {
    let dentro = t.trim();
    if dentro.is_empty() {
        return ("", "", t);
    }
    let inizio = t.find(dentro).unwrap_or(0);
    (&t[..inizio], dentro, &t[inizio + dentro.len()..])
}

/// Il testo, una volta tradotto, va **approvato da una persona** invece di
/// finire subito fra i valori?
///
/// Sì se contiene un segnaposto di formato o un simbolo del catalogo — cioè
/// tutto ciò che `segmenta` tiene fuori dal traduttore. Il motivo non è che il
/// segnaposto si perda (quello non esce più dal processo): è che **spezza la
/// frase**, e il traduttore vede i pezzi senza contesto. Il 18-09-2026 il
/// maintainer ha scritto «Allarme di prova con 🎨 e testo»: il pezzo dopo
/// l'emoji, «e testo», è tornato «E Testo» — non tradotto, solo con la
/// maiuscola. Sembrava una traduzione e non lo era.
///
/// Decisione D4 del piano multilingua (sua, contro il consiglio, col prezzo
/// scritto): ogni voce così diventa una proposta in rosso, da rileggere e
/// approvare — anche quando è venuta bene, perché non si può sapere da fuori.
pub fn va_approvata(testo: &str) -> bool {
    segmenta(testo)
        .iter()
        .any(|p| matches!(p, Pezzo::Segnaposto(_)))
}

/// Una voce da mandare a tradurre.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DaTradurre {
    pub key: String,
    /// Il testo nella lingua sorgente, **così com'è**. Chi traduce lo spezza
    /// con `segmenta` e manda fuori solo i pezzi di testo: i segnaposti non
    /// escono dal processo.
    pub testo: String,
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
            // Niente lettere una volta tolti i segnaposti = niente da
            // tradurre, e ogni chiamata costa.
            if !segmenta(sorgente).iter().any(da_mandare) {
                return None;
            }
            Some(DaTradurre {
                key: e.key.clone(),
                testo: sorgente.clone(),
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

/// Registra una traduzione che è tornata **mutilata**: non entra fra i valori,
/// resta una proposta da correggere e approvare a mano.
pub fn proponi(entry: &mut LangEntry, lingua: &str, testo: String) {
    entry.proposte.insert(lingua.to_string(), testo);
}

/// L'autore ha accettato la proposta così com'è (o dopo averla corretta).
pub fn approva(entry: &mut LangEntry, lingua: &str, testo: String) {
    entry.proposte.remove(lingua);
    entry.values.insert(lingua.to_string(), testo);
    // Approvata da una persona: da ora è lavoro umano e la passata automatica
    // successiva non la tocca.
    entry.auto.retain(|l| l != lingua);
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
            proposte: Default::default(),
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
    fn segmenta_separa_il_testo_dai_segnaposti() {
        // È il caso vero del maintainer, quello su cui tre guardiani diversi
        // sono falliti.
        assert_eq!(
            segmenta("Soggiorno caldo: {value:.1f}°C"),
            vec![
                Pezzo::Testo("Soggiorno caldo: ".into()),
                Pezzo::Segnaposto("{value:.1f}".into()),
                Pezzo::Testo("°C".into()),
            ]
        );
    }

    #[test]
    fn il_segnaposto_non_esce_mai_dal_nostro_processo() {
        // La proprietà che rende questa via incapace di fallire: nessun pezzo
        // mandato a tradurre contiene un segnaposto. Qualunque cosa il
        // fornitore faccia al testo, il segnaposto lo rimettiamo noi.
        for frase in [
            "Soggiorno caldo: {value:.1f}°C",
            "{value} su {max}",
            "Batteria scarica: {value:.0f}%",
        ] {
            for p in segmenta(frase).iter().filter(|p| da_mandare(p)) {
                let Pezzo::Testo(t) = p else { unreachable!() };
                assert!(!t.contains('{'), "un segnaposto sta per uscire in {t:?}");
            }
        }
    }

    #[test]
    fn non_si_manda_a_tradurre_cio_che_non_ha_lettere() {
        // «°C», «%», uno spazio: niente da tradurre, e ogni chiamata costa.
        let pezzi = segmenta("Batteria: {value:.0f}%");
        let mandati: Vec<_> = pezzi.iter().filter(|p| da_mandare(p)).collect();
        assert_eq!(mandati.len(), 1);
        assert_eq!(mandati[0], &Pezzo::Testo("Batteria: ".into()));
    }

    #[test]
    fn una_frase_senza_segnaposti_resta_un_pezzo_solo() {
        // Il caso normale non deve diventare più costoso: una chiamata sola.
        assert_eq!(
            segmenta("Porta garage aperta"),
            vec![Pezzo::Testo("Porta garage aperta".into())]
        );
    }

    #[test]
    fn gli_spazi_di_giunzione_non_si_affidano_al_fornitore() {
        // Lo spazio dopo i due punti è ciò che tiene staccata la frase dal
        // numero: se lo perde, il pannello mostra «Warm living room:22.0°C».
        assert_eq!(bordi("Soggiorno caldo: "), ("", "Soggiorno caldo:", " "));
        assert_eq!(bordi(" di "), (" ", "di", " "));
        assert_eq!(bordi("Avvio"), ("", "Avvio", ""));
        // Un pezzo di soli spazi non ha un dentro: tutto coda, niente da
        // mandare (e `da_mandare` lo scarta comunque, non avendo lettere).
        assert_eq!(bordi("   "), ("", "", "   "));
    }

    #[test]
    fn un_emoji_del_catalogo_sopravvive_dentro_una_frase() {
        // Il caso di T-71: "Pompa 🔧 avviata" non deve tornare "Pompa
        // avviata" né "Pompa [wrench] avviata" da un fornitore automatico —
        // l'emoji è un pezzo a sé, come un segnaposto di formato.
        assert_eq!(
            segmenta("Pompa 🔧 avviata"),
            vec![
                Pezzo::Testo("Pompa ".into()),
                Pezzo::Segnaposto("🔧".into()),
                Pezzo::Testo(" avviata".into()),
            ]
        );
    }

    #[test]
    fn un_emoji_non_si_manda_mai_al_traduttore() {
        for frase in ["Pompa 🔧 avviata", "🏠 Casa", "Allarme 🔐🔒 sicurezza"] {
            for p in segmenta(frase).iter().filter(|p| da_mandare(p)) {
                let Pezzo::Testo(t) = p else { unreachable!() };
                assert!(
                    !t.chars().any(e_simbolo_protetto),
                    "un simbolo protetto sta per uscire in {t:?}"
                );
            }
        }
    }

    #[test]
    fn un_simbolo_bmp_gia_in_uso_e_protetto_come_le_emoji_vere() {
        // ☀ ⚡ ⚠ ⚙ (U+2600 e vicini) sono nel catalogo da prima di T-71 e
        // devono avere la stessa protezione delle emoji vere da U+1F300.
        assert_eq!(
            segmenta("Sole ☀ alto"),
            vec![
                Pezzo::Testo("Sole ".into()),
                Pezzo::Segnaposto("☀".into()),
                Pezzo::Testo(" alto".into()),
            ]
        );
    }

    #[test]
    fn le_cifre_ascii_non_sono_simboli_da_proteggere() {
        // 0-9, '#' e '*' sono `Emoji=YES` solo per le sequenze keycap
        // (0️⃣): da soli in una frase normale non vanno protetti, o ogni
        // numero in ogni progetto smetterebbe di poter essere ricomposto
        // liberamente dal traduttore insieme al testo attorno.
        assert_eq!(
            segmenta("Livello 5 su 10"),
            vec![Pezzo::Testo("Livello 5 su 10".into())]
        );
    }

    #[test]
    fn una_voce_con_segnaposto_o_simbolo_va_approvata() {
        // Il caso vero del maintainer: dopo l'emoji resta «e testo», che il
        // traduttore ha rimandato com'era con la maiuscola.
        assert!(va_approvata("Allarme di prova con 🎨 e testo"));
        assert!(va_approvata("Soggiorno caldo: {value:.1f}°C"));
        assert!(va_approvata("{value} bar"));
    }

    #[test]
    fn una_frase_semplice_non_va_approvata() {
        // Il prezzo di D4 va pagato solo dove serve: una frase senza
        // segnaposti né simboli arriva intera al traduttore, e resta un valore.
        assert!(!va_approvata("Porta garage aperta"));
        assert!(!va_approvata("Pompa 1 in marcia (derivato)"));
        // `{{token}}` non è un segnaposto: se ne occupa resolve_msg.
        assert!(!va_approvata("{{ciao}} mondo"));
    }

    #[test]
    fn i_token_della_tabella_lingue_non_sono_segnaposti() {
        // `{{chiave}}` è un riferimento alla tabella, non un formato di
        // stampa: se ne occupa `resolve_msg` molto prima, e trattarlo qui da
        // segnaposto spezzerebbe una frase che segnaposti non ne ha.
        assert_eq!(
            segmenta("{{ciao}} mondo"),
            vec![Pezzo::Testo("{{ciao}} mondo".into())]
        );
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
    fn una_traduzione_mutilata_diventa_una_proposta_e_non_un_valore() {
        // Una proposta non deve poter raggiungere un pannello: se il
        // segnaposto è andato perso, quel testo mostrerebbe la frase senza il
        // proprio numero. Ma nemmeno si butta — prima si scartava, e all'autore
        // restava un avviso criptico e nessun modo di recuperare il lavoro.
        let mut e = voce("t1", &[("it", "Pressione {value:.1f} bar")], &[]);
        proponi(&mut e, "de", "Druck bar".into());
        assert!(
            !e.values.contains_key("de"),
            "una proposta è finita fra i valori"
        );
        assert_eq!(e.proposte.get("de").unwrap(), "Druck bar");
    }

    #[test]
    fn approvare_una_proposta_la_rende_lavoro_umano() {
        let mut e = voce("t1", &[("it", "Pressione {value:.1f} bar")], &["de"]);
        proponi(&mut e, "de", "Druck bar".into());
        approva(&mut e, "de", "Druck {value:.1f} bar".into());
        assert_eq!(e.values.get("de").unwrap(), "Druck {value:.1f} bar");
        assert!(
            e.proposte.is_empty(),
            "la proposta è rimasta lì dopo l'approvazione"
        );
        // E da ora è lavoro umano: la passata automatica successiva non la tocca.
        assert!(!e.auto.iter().any(|l| l == "de"));
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
