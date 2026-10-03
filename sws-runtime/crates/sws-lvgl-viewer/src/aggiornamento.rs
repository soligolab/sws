//! L'avviso di aggiornamento sullo schermo del pannello (decisioni 41, 44 e
//! 52-54 del piano `docs/archive/2026-09-27-aggiornamento-runtime-e-bus-utente.md`).
//!
//! È il gemello di `sws-editor/src/runtime-view/AvvisoAggiornamento.tsx`: la
//! decisione 41 dice «in web **e** in LVGL», e fino al 29-09-2026 era fatta
//! solo a metà. Una funzione a metà è peggio di una assente — chi ha un
//! pannello LVGL non sapeva di non essere avvisato.
//!
//! # Cosa sta qui e cosa no
//!
//! Qui: **quando** mostrare qualcosa, **cosa** ricordare fra un avvio e
//! l'altro, e il controllo periodico. Tutte funzioni pure o rete, zero LVGL —
//! il disegno è in `lvgl_render.rs`. La separazione non è estetica: nel crate
//! non c'è una rete di test a schermo (solo `#[cfg(test)]` in-file, e
//! `--istantanea` non esercita la rete, `main.rs`), quindi tutto ciò che si
//! può decidere fuori dallo schermo va deciso fuori dallo schermo, dove un
//! test lo raggiunge.
//!
//! # Solo su un pannello senza utenti
//!
//! Senza utenti chiunque stia davanti al vetro è già Admin, e il pulsante non
//! dà un potere che non avrebbe già. Con utenti definiti l'aggiornamento resta
//! il percorso dell'Admin dall'IDE, e sullo schermo non compare niente: il
//! runtime risponde 403 e `client::stato_aggiornamento` lo traduce in
//! `Ok(None)`, che **spegne** il controllo invece di ritentare ogni minuto.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::client::{self, EventoAggiornamento, NovitaVersione, QuadletSistema, StatoAggiornamento};

/// Ogni quanto si guarda se il runtime è ripartito. Gemello di
/// `CONTROLLO_RIAVVIO_MS` nel web.
///
/// **Non è ogni quanto si chiede al registry.** Quello si chiede all'avvio e a
/// ogni riavvio del runtime, e basta: è la regola del web, riconfermata dal
/// maintainer per LVGL il 29-09-2026 con la sua conseguenza sotto gli occhi —
/// un pannello acceso da mesi, a cui nessuno ricarica niente, una versione
/// nuova la scopre solo quando il runtime riparte. Succede comunque ogni
/// tanto (aggiornamenti, pilota automatico, corrente), e chi vuole saperlo
/// subito guarda dall'IDE, che interroga il registry appena si apre la
/// scheda. L'alternativa — un ricontrollo a orologio — è stata valutata e
/// scartata: non è un difetto da correggere, è una scelta.
pub const CONTROLLO_RIAVVIO: Duration = Duration::from_secs(60);
/// Ogni quanto si richiede lo stato mentre un aggiornamento è in corso:
/// l'esito «riuscito» si scrive solo dopo un paio di minuti di vita della
/// versione nuova. Gemello di `RICHIESTA_ESITO_MS`.
pub const RICHIESTA_ESITO: Duration = Duration::from_secs(30);

/// Il runtime è ripartito se il suo `uptime_s` è sceso.
///
/// Porta `ripartito()` del gemello web, e serve per la stessa ragione: un
/// pannello acceso da mesi non ricarica niente quando il runtime si riavvia,
/// e senza questo l'avviso lo vedrebbe solo chi spegne e riaccende. È anche
/// il modo in cui il pannello si accorge che l'aggiornamento che ha chiesto è
/// andato in porto — nessuno glielo dice, il suo interlocutore è stato
/// sostituito.
pub fn ripartito(prima: Option<u64>, adesso: u64) -> bool {
    matches!(prima, Some(p) if adesso < p)
}

/// Quel che sopravvive allo spegnimento. Il web usa `localStorage`; qui il
/// file accanto a `lvgl_session.json`, nella stessa convenzione
/// (`~/.config/sws/`) e non in un percorso nuovo inventato.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Visto {
    /// La versione che qualcuno ha scelto di ignorare, con «Ignora questa
    /// versione».
    #[serde(default)]
    pub ignorata: Option<String>,
    /// L'id dell'ultimo esito chiuso: «chiuso una volta, non ricompare per
    /// quell'aggiornamento» (decisione 54).
    #[serde(default)]
    pub esito_chiuso: Option<i64>,
}

fn percorso() -> Option<std::path::PathBuf> {
    Some(crate::cartella_stato()?.join("lvgl_aggiornamento.json"))
}

impl Visto {
    /// Mai un errore fatale: un file assente, illeggibile o scritto da una
    /// versione futura vuol dire «non ho memoria», non «non parto».
    pub fn carica() -> Visto {
        percorso()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    /// Scrittura best-effort, come `SessionState::save`: se il disco è pieno
    /// o `$HOME` non c'è, l'avviso ricomparirà al prossimo avvio — fastidioso,
    /// non rotto.
    pub fn salva(&self) {
        let Some(p) = percorso() else { return };
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(j) = serde_json::to_vec_pretty(self) {
            let _ = std::fs::write(&p, j);
        }
    }
}

/// Cosa deve comparire sullo schermo adesso.
#[derive(Debug, Clone, PartialEq)]
pub enum Avviso {
    /// Niente: nessuna versione nuova, o già rimandata, o un pannello con utenti.
    Niente,
    /// L'esito dell'ultimo aggiornamento, finché non lo si chiude.
    Esito {
        evento: EventoAggiornamento,
        /// Le Novità della versione che gira, per «Aggiornato alla Y: cosa cambia».
        novita: Option<NovitaVersione>,
    },
    /// La configurazione del servizio è più vecchia di quella della versione
    /// che gira, e il pannello la sa aggiornare (02-10-2026).
    Quadlet {
        da: String,
        a: String,
    },
    /// C'è una versione più nuova.
    VersioneNuova {
        /// Quella che gira adesso.
        da: String,
        /// Quella disponibile.
        a: String,
        novita: Vec<NovitaVersione>,
    },
}

/// La regola di comparsa, tutta in un posto e senza toccare niente.
///
/// **L'esito viene prima della versione nuova**, come nel web: con il pilota
/// automatico l'esito è l'unico modo, davanti al pannello, di sapere che è
/// cambiato qualcosa, e sovrapporgli un avviso di *un'altra* versione nuova
/// renderebbe incomprensibili tutti e due.
///
/// `rimandato` è «Più tardi»: vive in memoria e muore al riavvio del runtime,
/// che è appunto quello che «fino al prossimo avvio» significa. `visto.ignorata`
/// invece sopravvive — altrimenti non sarebbe un ignorare, sarebbe un
/// rimandare (decisione 44).
pub fn da_mostrare(
    stato: Option<&StatoAggiornamento>,
    senza_utenti: bool,
    rimandato: bool,
    visto: &Visto,
) -> Avviso {
    if !senza_utenti {
        return Avviso::Niente;
    }
    let Some(st) = stato else {
        return Avviso::Niente;
    };
    if let Some(e) = &st.evento {
        if visto.esito_chiuso != Some(e.id) {
            return Avviso::Esito {
                evento: e.clone(),
                novita: st.novita_installata.clone(),
            };
        }
    }
    let Some(a) = &st.disponibile else {
        return Avviso::Niente;
    };
    if rimandato || visto.ignorata.as_deref() == Some(a.as_str()) {
        return Avviso::Niente;
    }
    Avviso::VersioneNuova {
        da: st.versione.clone(),
        a: a.clone(),
        novita: st.novita.clone(),
    }
}

/// La regola completa: [`da_mostrare`] più la configurazione del servizio,
/// che sta **dopo l'esito e prima della versione nuova**, come sul web —
/// dopo un aggiornamento che porta quadlet nuovi è il passo che resta.
pub fn da_mostrare_tutto(
    stato: Option<&StatoAggiornamento>,
    senza_utenti: bool,
    rimandato: bool,
    visto: &Visto,
    quadlet: Option<&QuadletSistema>,
    quadlet_rimandato: bool,
) -> Avviso {
    let base = da_mostrare(stato, senza_utenti, rimandato, visto);
    if !senza_utenti || matches!(base, Avviso::Esito { .. }) {
        return base;
    }
    match quadlet {
        Some(q) if q.da_aggiornare && q.si_puo_aggiornare && !quadlet_rimandato => Avviso::Quadlet {
            da: q.installata.map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
            a: q.attesa.map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
        },
        _ => base,
    }
}

/// Le novità nella lingua dei contenuti, con ripiego sull'italiano quando la
/// versione inglese non c'è — stessa regola di `novitaNellaLingua` nel web
/// (decisione 57). Torna `(testo, compatibilità)`.
pub fn novita_nella_lingua(n: &NovitaVersione, lingua: &str) -> (String, String) {
    let inglese = lingua != "it";
    let scegli = |en: &str, it: &str| {
        if inglese && !en.is_empty() {
            en.to_string()
        } else {
            it.to_string()
        }
    };
    (
        scegli(&n.testo_en, &n.testo),
        scegli(&n.compatibilita_en, &n.compatibilita),
    )
}

/// Quel che il thread di controllo aggiorna e il disegno legge, con lo stesso
/// `Arc<Mutex<_>>` di `SharedSession`/`SharedAlarms`.
#[derive(Debug, Default)]
pub struct StatoAvviso {
    pub stato: Option<StatoAggiornamento>,
    pub senza_utenti: bool,
    /// «Più tardi»: in memoria, muore col processo e col riavvio del runtime.
    pub rimandato: bool,
    pub visto: Visto,
    /// «Aggiorna ora» è stato premuto: il pulsante cambia testo e si spegne.
    pub avvio_chiesto: bool,
    /// La configurazione del servizio, da `/api/system` (02-10-2026).
    pub quadlet: Option<QuadletSistema>,
    /// «Più tardi» sulla configurazione: fino al prossimo avvio del runtime.
    pub quadlet_rimandato: bool,
    /// Cresce a ogni cambiamento: il disegno ridisegna l'overlay solo quando
    /// serve, invece di ricostruirlo a ogni frame.
    pub generazione: u64,
}

pub type SharedAvviso = Arc<Mutex<StatoAvviso>>;

impl StatoAvviso {
    fn cambiato(&mut self) {
        self.generazione = self.generazione.wrapping_add(1);
    }

    pub fn avviso(&self) -> Avviso {
        da_mostrare_tutto(
            self.stato.as_ref(),
            self.senza_utenti,
            self.rimandato,
            &self.visto,
            self.quadlet.as_ref(),
            self.quadlet_rimandato,
        )
    }
}

/// «Più tardi».
pub fn rimanda(s: &SharedAvviso) {
    if let Ok(mut g) = s.lock() {
        g.rimandato = true;
        g.cambiato();
    }
}

/// «Più tardi» sulla configurazione del servizio.
pub fn rimanda_quadlet(s: &SharedAvviso) {
    if let Ok(mut g) = s.lock() {
        g.quadlet_rimandato = true;
        g.cambiato();
    }
}

/// «Aggiorna» sulla configurazione del servizio: la richiesta va al thread di
/// rete, e da lì il pannello si riavvia.
pub fn aggiorna_quadlet(s: &SharedAvviso, base_url: &str, token: Option<String>) {
    if let Ok(mut g) = s.lock() {
        g.avvio_chiesto = true;
        g.cambiato();
    }
    crate::net_worker::invia(crate::net_worker::Comando::AggiornaQuadlet {
        base_url: base_url.to_string(),
        token,
    });
}

/// «Ignora questa versione»: ricordato su disco.
pub fn ignora(s: &SharedAvviso, versione: &str) {
    if let Ok(mut g) = s.lock() {
        g.visto.ignorata = Some(versione.to_string());
        g.visto.salva();
        g.cambiato();
    }
}

/// «Chiudi» sull'esito.
pub fn chiudi_esito(s: &SharedAvviso, id: i64) {
    if let Ok(mut g) = s.lock() {
        g.visto.esito_chiuso = Some(id);
        g.visto.salva();
        g.cambiato();
    }
}

/// «Aggiorna ora»: mette la richiesta in coda al thread di rete e segna il
/// pulsante come premuto. Da qui il runtime si riavvia e questo processo
/// viene sostituito: non c'è nessun «riuscito» da mostrare dopo, e mostrarlo
/// mentirebbe sul fatto che l'aggiornamento sia finito.
pub fn avvia(s: &SharedAvviso, base_url: &str, token: Option<String>) {
    if let Ok(mut g) = s.lock() {
        g.avvio_chiesto = true;
        g.cambiato();
    }
    crate::net_worker::invia(crate::net_worker::Comando::AvviaAggiornamento {
        base_url: base_url.to_string(),
        token,
    });
}

/// Il thread che tiene aggiornato lo stato.
///
/// Un thread suo con `block_on`, come `net_worker` e per la stessa ragione
/// (Q55): il loop di rendering non aspetta mai la rete. Qui in più il ciclo è
/// lento — un minuto — quindi anche una richiesta che non torna non costa
/// nulla a nessuno.
pub fn avvia_controllo(stato: SharedAvviso, base_url: String, sessione: crate::session::SharedSession) {
    std::thread::Builder::new()
        .name("sws-aggiornamento".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("[aggiornamento] runtime non creato: {e} — nessun avviso a schermo");
                    return;
                }
            };
            let mut ultimo_uptime: Option<u64> = None;
            let mut prima_volta = true;
            loop {
                let token = sessione
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .token
                    .clone();
                let attesa = rt.block_on(giro(
                    &stato,
                    &base_url,
                    token.as_deref(),
                    &mut ultimo_uptime,
                    &mut prima_volta,
                ));
                std::thread::sleep(attesa);
            }
        })
        .expect("thread dell'avviso di aggiornamento non avviabile");
}

/// Un giro del controllo. Torna quanto aspettare prima del prossimo.
async fn giro(
    stato: &SharedAvviso,
    base_url: &str,
    token: Option<&str>,
    ultimo_uptime: &mut Option<u64>,
    prima_volta: &mut bool,
) -> Duration {
    let Ok(sys) = client::fetch_system(base_url).await else {
        return CONTROLLO_RIAVVIO;
    };
    let riavvio = ripartito(*ultimo_uptime, sys.uptime_s);
    *ultimo_uptime = Some(sys.uptime_s);
    let senza_utenti = !sys.auth_required;
    if let Ok(mut g) = stato.lock() {
        if g.senza_utenti != senza_utenti {
            g.senza_utenti = senza_utenti;
            g.cambiato();
        }
        // «Più tardi» vale fino al prossimo avvio del runtime (decisione 44).
        if riavvio && g.rimandato {
            g.rimandato = false;
            g.cambiato();
        }
        if riavvio && g.quadlet_rimandato {
            g.quadlet_rimandato = false;
            g.cambiato();
        }
        if g.quadlet != sys.quadlet {
            g.quadlet = sys.quadlet.clone();
            g.cambiato();
        }
        // Il riavvio è anche la fine dell'aggiornamento che avevamo chiesto.
        if riavvio && g.avvio_chiesto {
            g.avvio_chiesto = false;
            g.cambiato();
        }
    }
    let da_chiedere = *prima_volta || riavvio;
    *prima_volta = false;
    if !senza_utenti {
        return CONTROLLO_RIAVVIO;
    }
    let in_corso = stato
        .lock()
        .ok()
        .and_then(|g| g.stato.as_ref().map(|s| s.in_corso))
        .unwrap_or(false);
    if !da_chiedere && !in_corso {
        return CONTROLLO_RIAVVIO;
    }
    match client::stato_aggiornamento(base_url, token).await {
        // 401/403: questo pannello ha utenti, l'avviso non è affar suo.
        Ok(None) => {
            if let Ok(mut g) = stato.lock() {
                if g.senza_utenti {
                    g.senza_utenti = false;
                    g.cambiato();
                }
            }
            CONTROLLO_RIAVVIO
        }
        Ok(Some(s)) => {
            let ancora = s.in_corso;
            if let Ok(mut g) = stato.lock() {
                g.stato = Some(s);
                g.cambiato();
            }
            if ancora {
                RICHIESTA_ESITO
            } else {
                CONTROLLO_RIAVVIO
            }
        }
        // Registry irraggiungibile: nessun avviso, e nessun allarme.
        Err(_) => CONTROLLO_RIAVVIO,
    }
}

/// Uno stato finto per guardare l'avviso senza aspettare una release vera.
///
/// Serve a due cose che altrimenti costerebbero un giro di build e di
/// pubblicazione ciascuna: vedere il **disegno** in un'istantanea PNG
/// (`--istantanea`, che non esercita la rete e quindi non vedrebbe mai un
/// avviso vero) e provare i pulsanti sul pannello prima che una versione
/// nuova esista davvero. Fuori da `--avviso-di-prova` non lo costruisce
/// nessuno.
pub fn stato_di_prova(quale: &str) -> Option<StatoAggiornamento> {
    use crate::client::EsitoAggiornamento;
    let novita = |v: &str| NovitaVersione {
        versione: v.to_string(),
        testo: "Avviso di aggiornamento anche sul pannello LVGL.\nStorico allarmi dallo scatto della riga.".into(),
        compatibilita: "I progetti salvati con la 2.11 vanno riaperti una volta.".into(),
        testo_en: "Update notice on the LVGL panel too.\nAlarm history from when the row starts.".into(),
        compatibilita_en: "Projects saved with 2.11 must be reopened once.".into(),
    };
    let base = StatoAggiornamento {
        versione: env!("CARGO_PKG_VERSION").to_string(),
        ..Default::default()
    };
    Some(match quale {
        "nuova" => StatoAggiornamento {
            disponibile: Some("2.13.0".into()),
            novita: vec![novita("2.12.1"), novita("2.13.0")],
            ..base
        },
        "riuscito" => StatoAggiornamento {
            evento: Some(EventoAggiornamento {
                id: 1,
                da: "2.11.0".into(),
                a: Some(base.versione.clone()),
                esito: EsitoAggiornamento::Riuscito,
            }),
            novita_installata: Some(novita(&base.versione)),
            ..base
        },
        "non-riuscito" => StatoAggiornamento {
            evento: Some(EventoAggiornamento {
                id: 2,
                da: base.versione.clone(),
                a: Some("2.13.0".into()),
                esito: EsitoAggiornamento::NonRiuscito,
            }),
            ..base
        },
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::EsitoAggiornamento;

    fn novita(v: &str) -> NovitaVersione {
        NovitaVersione {
            versione: v.into(),
            testo: "cose nuove".into(),
            ..Default::default()
        }
    }

    fn con_nuova() -> StatoAggiornamento {
        StatoAggiornamento {
            versione: "2.12.0-rc.9".into(),
            disponibile: Some("2.12.0-rc.10".into()),
            novita: vec![novita("2.12.0-rc.10")],
            ..Default::default()
        }
    }

    fn evento(id: i64) -> EventoAggiornamento {
        EventoAggiornamento {
            id,
            da: "2.12.0-rc.8".into(),
            a: Some("2.12.0-rc.9".into()),
            esito: EsitoAggiornamento::Riuscito,
        }
    }

    #[test]
    fn il_riavvio_si_riconosce_dall_uptime_che_scende() {
        // Il primo giro non sa niente: non è un riavvio, o l'avviso
        // ricomparirebbe a ogni avvio del viewer.
        assert!(!ripartito(None, 10));
        assert!(!ripartito(Some(10), 70));
        assert!(!ripartito(Some(10), 10));
        assert!(ripartito(Some(3600), 12));
    }

    #[test]
    fn su_un_pannello_con_utenti_non_compare_niente() {
        let st = con_nuova();
        assert_eq!(
            da_mostrare(Some(&st), false, false, &Visto::default()),
            Avviso::Niente
        );
    }

    #[test]
    fn senza_utenti_e_con_una_versione_nuova_compare() {
        let st = con_nuova();
        match da_mostrare(Some(&st), true, false, &Visto::default()) {
            Avviso::VersioneNuova { da, a, novita } => {
                assert_eq!((da.as_str(), a.as_str()), ("2.12.0-rc.9", "2.12.0-rc.10"));
                assert_eq!(novita.len(), 1);
            }
            altro => panic!("atteso l'avviso di versione nuova, avuto {altro:?}"),
        }
    }

    #[test]
    fn l_esito_viene_prima_della_versione_nuova() {
        // Tutti e due in campo: con il pilota automatico l'esito è l'unico
        // modo di sapere che è cambiato qualcosa, e sovrapporgli l'avviso di
        // *un'altra* versione li renderebbe incomprensibili entrambi.
        let mut st = con_nuova();
        st.evento = Some(evento(7));
        assert!(matches!(
            da_mostrare(Some(&st), true, false, &Visto::default()),
            Avviso::Esito { .. }
        ));
    }

    #[test]
    fn un_esito_chiuso_non_ricompare_e_lascia_il_posto_alla_versione_nuova() {
        let mut st = con_nuova();
        st.evento = Some(evento(7));
        let visto = Visto {
            esito_chiuso: Some(7),
            ..Default::default()
        };
        assert!(matches!(
            da_mostrare(Some(&st), true, false, &visto),
            Avviso::VersioneNuova { .. }
        ));
        // Ma un esito *diverso*, più recente, sì.
        st.evento = Some(evento(8));
        assert!(matches!(
            da_mostrare(Some(&st), true, false, &visto),
            Avviso::Esito { .. }
        ));
    }

    #[test]
    fn piu_tardi_nasconde_fino_al_riavvio_ignora_anche_dopo() {
        let st = con_nuova();
        assert_eq!(
            da_mostrare(Some(&st), true, true, &Visto::default()),
            Avviso::Niente,
            "«Più tardi» deve nascondere l'avviso"
        );
        let ignorata = Visto {
            ignorata: Some("2.12.0-rc.10".into()),
            ..Default::default()
        };
        assert_eq!(
            da_mostrare(Some(&st), true, false, &ignorata),
            Avviso::Niente
        );
    }

    #[test]
    fn ignorare_una_versione_non_nasconde_quella_dopo() {
        // Altrimenti «Ignora» diventerebbe «non avvisarmi mai più», che non è
        // quello che dice il pulsante.
        let st = con_nuova();
        let vecchia = Visto {
            ignorata: Some("2.12.0-rc.9".into()),
            ..Default::default()
        };
        assert!(matches!(
            da_mostrare(Some(&st), true, false, &vecchia),
            Avviso::VersioneNuova { .. }
        ));
    }

    fn q(da: u32, a: u32, si_puo: bool) -> QuadletSistema {
        QuadletSistema { installata: Some(da), attesa: Some(a), da_aggiornare: da < a, si_puo_aggiornare: si_puo }
    }

    #[test]
    fn la_configurazione_vecchia_si_offre_dopo_l_esito_e_prima_della_versione_nuova() {
        let v = Visto::default();
        let quad = q(0, 1, true);
        // Prima della versione nuova.
        assert_eq!(
            da_mostrare_tutto(Some(&con_nuova()), true, false, &v, Some(&quad), false),
            Avviso::Quadlet { da: "0".into(), a: "1".into() }
        );
        // L'esito viene prima di tutto.
        let mut st = con_nuova();
        st.evento = Some(evento(7));
        assert!(matches!(da_mostrare_tutto(Some(&st), true, false, &v, Some(&quad), false), Avviso::Esito { .. }));
        // Anche senza stato dell'aggiornamento (registry irraggiungibile).
        assert!(matches!(da_mostrare_tutto(None, true, false, &v, Some(&quad), false), Avviso::Quadlet { .. }));
    }

    #[test]
    fn la_configurazione_non_si_offre_con_utenti_rimandata_o_se_non_si_puo() {
        let v = Visto::default();
        assert_eq!(da_mostrare_tutto(None, false, false, &v, Some(&q(0, 1, true)), false), Avviso::Niente);
        assert_eq!(da_mostrare_tutto(None, true, false, &v, Some(&q(0, 1, true)), true), Avviso::Niente);
        assert_eq!(da_mostrare_tutto(None, true, false, &v, Some(&q(0, 1, false)), false), Avviso::Niente);
        assert_eq!(da_mostrare_tutto(None, true, false, &v, Some(&q(1, 1, true)), false), Avviso::Niente);
    }

    #[test]
    fn senza_versione_nuova_e_senza_esito_non_cè_niente_da_dire() {
        let st = StatoAggiornamento {
            versione: "2.12.0-rc.10".into(),
            ..Default::default()
        };
        assert_eq!(
            da_mostrare(Some(&st), true, false, &Visto::default()),
            Avviso::Niente
        );
        assert_eq!(
            da_mostrare(None, true, false, &Visto::default()),
            Avviso::Niente
        );
    }

    #[test]
    fn le_novita_seguono_la_lingua_e_ripiegano_sull_italiano() {
        let n = NovitaVersione {
            versione: "2.12.0".into(),
            testo: "cose nuove".into(),
            compatibilita: "riaprire i progetti".into(),
            testo_en: "what's new".into(),
            compatibilita_en: String::new(),
        };
        assert_eq!(novita_nella_lingua(&n, "it").0, "cose nuove");
        assert_eq!(novita_nella_lingua(&n, "de").0, "what's new");
        // L'inglese che manca ripiega sull'italiano: meglio una riga in una
        // lingua sola che una riga vuota su un avviso di compatibilità.
        assert_eq!(novita_nella_lingua(&n, "de").1, "riaprire i progetti");
    }

    #[test]
    fn un_file_di_memoria_vuoto_o_rotto_vale_nessuna_memoria() {
        assert_eq!(
            serde_json::from_str::<Visto>("{}").unwrap(),
            Visto::default()
        );
        let v = Visto {
            ignorata: Some("2.12.0".into()),
            esito_chiuso: Some(3),
        };
        let giro: Visto = serde_json::from_slice(&serde_json::to_vec(&v).unwrap()).unwrap();
        assert_eq!(giro, v);
    }
}
