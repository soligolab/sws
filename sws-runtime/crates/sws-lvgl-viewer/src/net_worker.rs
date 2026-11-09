//! Le scritture di rete del viewer, su un thread loro (Q55).
//!
//! `put_tag`, `ack_alarm` e `apply_recipe` sono fire-and-forget: scrivono e non
//! serve aspettare l'esito per continuare a disegnare. Fino al 20-09-2026 giravano
//! con `rt_handle.spawn` sul runtime tokio condiviso del processo — lo stesso su
//! cui il 13-09 una POST che riceveva 200 non è tornata mai, dentro questo
//! binario e solo qui (Q55: causa mai spiegata, non riprodotta fuori dal viewer).
//!
//! Invece di sperare che quel combinazione non ricapiti, le scritture non passano
//! più di lì: un **thread dedicato**, con un runtime a un solo thread suo, prende
//! i comandi da un canale e li esegue **uno alla volta con `block_on`** — la
//! stessa forma che nel viewer si è provata funzionare (login, navigazione, storico).
//! Il loop di rendering non aspetta niente: mette il comando in coda e prosegue,
//! come già faceva con `tag_rx`/`ack_rx`. Non serve conoscere la causa del blocco
//! perché questo non dipenda da lei.
//!
//! Due conseguenze volute:
//! - **ordine**: le scritture partono nell'ordine in cui sono state fatte, cosa che
//!   con task indipendenti non era garantita (due scritture dello stesso tag in
//!   sequenza potevano arrivare invertite);
//! - **un tetto di tempo**: una risposta che non arriva mai non ferma per sempre la
//!   coda, e il difetto — se ricapita — si legge nel log invece di essere silenzio.
//!
//! Questo thread **non tocca mai LVGL**: fa solo rete e scrive sul log.
//!
//! L'accesso (`Comando::Accedi`) non sta nella coda: ogni login parte su un
//! thread suo, della stessa forma (`accedi_a_parte`). Nella coda un login lento
//! — fino a 60 s — tratteneva le scritture arrivate dopo, anche dopo «Annulla».

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use sws_core::tag::TagValue;

use crate::client;

/// Quanto aspettare una scrittura prima di rinunciarci e passare alla successiva.
const TETTO_DI_TEMPO: Duration = Duration::from_secs(15);

/// Una scrittura da mandare al server. Il token è quello della sessione **al
/// momento del comando** (non di quando parte): è la sessione con cui l'utente ha
/// premuto il pulsante.
pub enum Comando {
    PutTag {
        base_url: String,
        tag: String,
        value: TagValue,
        token: Option<String>,
    },
    AckAlarm {
        base_url: String,
        alarm_id: String,
        token: Option<String>,
    },
    ApplyRecipe {
        base_url: String,
        id: String,
        token: Option<String>,
        /// Dove scrivere com'è andata, per la riga d'esito del pannello ricette
        /// (25-10-2026): il thread di rete non tocca LVGL, il disegno la legge.
        esito: Option<EsitoRicetta>,
    },
    /// «Aggiorna ora» dell'avviso di aggiornamento (29-09-2026). Sta qui con le
    /// scritture per la stessa ragione delle altre — è una POST, la forma che
    /// ha bloccato il viewer il 13-09 — e per una in più: la risposta arriva
    /// **prima** che systemd sostituisca il processo, quindi il loop di
    /// rendering non deve nemmeno provare ad aspettarla.
    AvviaAggiornamento {
        base_url: String,
        token: Option<String>,
        /// Dove dire che il runtime ha risposto: «Aggiornamento in avvio…»
        /// finisce lì (09-11-2026).
        avviso: Option<crate::aggiornamento::SharedAvviso>,
    },
    /// L'accesso chiesto dall'avviso di aggiornamento (20-10-2026).
    ///
    /// Sta qui e non in un `block_on` dentro la callback LVGL per la ragione
    /// scritta in `lvgl_render.rs`: una POST dentro il thread di disegno ha
    /// bloccato il viewer il 13-09, e il login della pagina ci convive solo
    /// perché nessuno l'ha ancora toccato.
    ///
    /// Porta con sé gli `Arc` dello stato perché la risposta va scritta da
    /// qui: il pulsante che ha chiesto l'accesso, quando il token arriva, è
    /// già stato distrutto e ricostruito dal loop di disegno.
    ///
    /// Non passa dalla coda delle scritture: ha un thread suo
    /// (`accedi_a_parte`), così un login lento non le trattiene.
    Accedi {
        base_url: String,
        utente: String,
        password: String,
        sessione: crate::session::SharedSession,
        avviso: crate::aggiornamento::SharedAvviso,
        /// Il numero del tentativo (`aggiornamento::accesso_in_corso`): la
        /// risposta conta solo se il pannellino aspetta ancora questo.
        tentativo: u64,
        /// I 60 s dal tocco su «Accedi» (09-11-2026, come il web): qui si
        /// smette di aspettare, alla stessa ora in cui la card rinuncia. È il
        /// tetto di questo comando al posto di `TETTO_DI_TEMPO`: con quello
        /// un login lento spariva a 15 s senza dire niente, e la card restava
        /// in attesa finché qualcuno non premeva «Annulla».
        scadenza: Instant,
    },
    /// La configurazione del servizio riscritta dal pannello (02-10-2026).
    AggiornaQuadlet {
        base_url: String,
        token: Option<String>,
    },
    /// La risposta alla domanda dopo un aggiornamento (03-10-2026).
    ConfermaAggiornamento {
        base_url: String,
        token: Option<String>,
        scelta: String,
    },
}

impl Comando {
    fn descrizione(&self) -> String {
        match self {
            Comando::PutTag { tag, .. } => format!("scrittura del tag '{tag}'"),
            Comando::AckAlarm { alarm_id, .. } => format!("ack dell'allarme '{alarm_id}'"),
            Comando::ApplyRecipe { id, .. } => format!("applicazione della ricetta '{id}'"),
            Comando::AvviaAggiornamento { .. } => "avvio dell'aggiornamento".to_string(),
            Comando::AggiornaQuadlet { .. } => {
                "aggiornamento della configurazione del servizio".to_string()
            }
            Comando::ConfermaAggiornamento { scelta, .. } => {
                format!("risposta «{scelta}» alla conferma dell'aggiornamento")
            }
            Comando::Accedi { utente, .. } => format!("accesso come '{utente}'"),
        }
    }

    /// Quanto aspettare questo comando, da `adesso`: l'accesso fino alla sua
    /// scadenza, le altre scritture il tetto comune.
    fn tetto(&self, comune: Duration, adesso: Instant) -> Duration {
        match self {
            Comando::Accedi { scadenza, .. } => scadenza.saturating_duration_since(adesso),
            _ => comune,
        }
    }
}

async fn esegui(cmd: Comando) -> anyhow::Result<()> {
    match cmd {
        Comando::PutTag {
            base_url,
            tag,
            value,
            token,
        } => client::put_tag(&base_url, &tag, value, token.as_deref()).await,
        Comando::AckAlarm {
            base_url,
            alarm_id,
            token,
        } => client::ack_alarm(&base_url, &alarm_id, token.as_deref()).await,
        Comando::ApplyRecipe {
            base_url,
            id,
            token,
            esito,
        } => {
            let r = client::apply_recipe(base_url, id, token).await;
            if let Some(c) = esito {
                if let Ok(mut g) = c.lock() {
                    *g = Some(match &r {
                        Ok(_) => (true, "✓ ricetta applicata".into()),
                        Err(_) => (false, "✗ ricetta non applicata".into()),
                    });
                }
            }
            r
        }
        Comando::AvviaAggiornamento {
            base_url,
            token,
            avviso,
        } => {
            let r = client::avvia_aggiornamento(&base_url, token.as_deref()).await;
            if let Some(a) = avviso {
                crate::aggiornamento::avvio_risposto(&a, r.is_ok());
            }
            r
        }
        Comando::AggiornaQuadlet { base_url, token } => {
            client::aggiorna_quadlet(&base_url, token.as_deref()).await
        }
        Comando::ConfermaAggiornamento {
            base_url,
            token,
            scelta,
        } => client::conferma_aggiornamento(&base_url, token.as_deref(), &scelta).await,
        Comando::Accedi {
            base_url,
            utente,
            password,
            sessione,
            avviso,
            tentativo,
            scadenza: _,
        } => {
            match client::login(&base_url, &utente, &password).await {
                Ok(ok) => {
                    // Prima si chiede al pannellino se aspetta ancora, poi si
                    // entra: dopo la rinuncia a 60 s o un «Annulla» la
                    // risposta non conta, e chi ha rinunciato resta fuori.
                    let Ok(azione) = crate::aggiornamento::accesso_riuscito(&avviso, tentativo)
                    else {
                        anyhow::bail!("risposta arrivata quando non si aspettava più, ignorata");
                    };
                    let token = ok.token.clone();
                    if let Ok(mut s) = sessione.lock() {
                        s.set_logged_in(ok);
                    }
                    // Chi è entrato può vedere e usare oggetti che prima non
                    // poteva: la pagina si ridisegna (29-10-2026).
                    crate::session::chiedi_ridisegno();
                    // Entrati: si riprende il gesto che aveva chiesto l'accesso.
                    if let Some(a) = azione {
                        use crate::aggiornamento::AzioneRichiesta as A;
                        let token = Some(token);
                        let dopo = match a {
                            // Come il tocco con l'accesso già fatto: il
                            // pulsante resta spento e dice «in avvio». Prima
                            // la card tornava con «Aggiorna ora» premibile, e
                            // un secondo tocco faceva un secondo apply.
                            A::Aggiorna => {
                                crate::aggiornamento::avvia(&avviso, &base_url, token);
                                None
                            }
                            A::Quadlet => Some(Comando::AggiornaQuadlet { base_url, token }),
                            A::Conferma(scelta) => Some(Comando::ConfermaAggiornamento {
                                base_url,
                                token,
                                scelta,
                            }),
                            // Il comando della pagina lo ripete chi sta davanti.
                            A::Comando => None,
                            // Si voleva solo entrare.
                            A::Accesso => None,
                        };
                        if let Some(c) = dopo {
                            invia(c);
                        }
                    }
                    Ok(())
                }
                Err(e) => {
                    // Rifiutate o runtime irraggiungibile: si resta nel
                    // pannellino, col motivo.
                    crate::aggiornamento::accesso_rifiutato(&avviso, tentativo, e.to_string());
                    Err(e)
                }
            }
        }
    }
}

/// Esegue un comando fino al tetto di tempo. `Err` porta il testo da mettere nel log.
fn esegui_bloccando(
    rt: &tokio::runtime::Runtime,
    cmd: Comando,
    tetto: Duration,
) -> Result<(), String> {
    let cosa = cmd.descrizione();
    let tetto = cmd.tetto(tetto, Instant::now());
    // In un blocco `async`: `timeout` crea il suo timer subito, e fuori dal runtime panica.
    match rt.block_on(async { tokio::time::timeout(tetto, esegui(cmd)).await }) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(format!("{cosa} fallita: {e}")),
        Err(_) => Err(format!(
            "{cosa}: nessuna risposta in {}s, rinuncio",
            tetto.as_secs()
        )),
    }
}

/// Il rifiuto dell'ultimo comando, se c'è: lo scrive questo thread, lo legge
/// e lo svuota il ciclo di rendering per mostrarlo a schermo (22-10-2026,
/// piano `docs/plans/2026-10-22-sessione-che-non-sopravvive-al-deploy.md`).
///
/// Prima un comando rifiutato finiva **solo** su `stderr`: l'operatore vedeva
/// un pulsante che non faceva niente e non sapeva perché. «È la differenza fra
/// un difetto che si vede e uno che costa un collaudo» — e finché restava lì,
/// qualunque 403 futuro sarebbe stato di nuovo invisibile.
pub static RIFIUTO: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Il messaggio d'errore dice che il server ha rifiutato per autorizzazione?
///
/// Si guarda il testo e non un codice perché `esegui` restituisce già una
/// stringa: `error_for_status()` di reqwest ci mette dentro lo stato.
fn e_un_rifiuto(msg: &str) -> bool {
    msg.contains("401") || msg.contains("403")
}

/// Il runtime a un solo thread di un thread di rete; `None` se non si crea,
/// col motivo e la `conseguenza` nel log.
fn runtime_di_rete(conseguenza: &str) -> Option<tokio::runtime::Runtime> {
    match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => Some(rt),
        Err(e) => {
            eprintln!("[net] runtime del thread di rete non creato: {e} — {conseguenza}");
            None
        }
    }
}

/// L'esito di un comando: un rifiuto finisce nel log e, se è per
/// autorizzazione, in [`RIFIUTO`].
fn registra(esito: Result<(), String>) {
    if let Err(msg) = esito {
        eprintln!("[net] {msg}");
        if e_un_rifiuto(&msg) {
            // Lo raccoglie il ciclo di rendering al prossimo giro: qui non
            // si può toccare LVGL, questo è un altro thread.
            if let Ok(mut r) = RIFIUTO.lock() {
                *r = Some(msg);
            }
        }
    }
}

fn lavora(rx: Receiver<Comando>, tetto: Duration) {
    let Some(rt) = runtime_di_rete("le scritture non partiranno") else {
        return;
    };
    while let Ok(cmd) = rx.recv() {
        if matches!(cmd, Comando::Accedi { .. }) {
            accedi_a_parte(cmd, tetto);
            continue;
        }
        registra(esegui_bloccando(&rt, cmd, tetto));
    }
}

/// L'accesso su un thread suo (09-11-2026). Nella coda unica un login lento
/// — fino a 60 s, la sua scadenza — teneva ferme le scritture arrivate dopo:
/// un toggle premuto dopo «Annulla» mostrava lo stato vecchio e partiva da
/// solo quando il login finiva. Qui le scritture non aspettano mai il login,
/// e «Annulla» non ha niente da liberare: la risposta tardiva la scarta già
/// `accesso_riuscito`. Stessa forma del thread di rete — un runtime a un
/// thread suo e `block_on` — e non il runtime condiviso del processo (Q55).
fn accedi_a_parte(cmd: Comando, tetto: Duration) {
    let cosa = cmd.descrizione();
    let avviato = std::thread::Builder::new()
        .name("sws-net-accesso".into())
        .spawn(move || {
            if let Some(rt) = runtime_di_rete("l'accesso non parte") {
                registra(esegui_bloccando(&rt, cmd, tetto));
            }
        });
    if let Err(e) = avviato {
        // Il comando è andato col thread mancato: la card rinuncia da sola
        // alla sua scadenza, con «Nessuna risposta, riprova».
        eprintln!("[net] thread dell'accesso non avviabile: {e} — {cosa} persa");
    }
}

/// L'esito dell'applicazione di una ricetta: `(riuscita, testo)`, `None`
/// finché non si sa. Lo scrive il thread di rete, lo legge il disegno.
pub type EsitoRicetta = std::sync::Arc<std::sync::Mutex<Option<(bool, String)>>>;

static CODA: OnceLock<Sender<Comando>> = OnceLock::new();

/// Avvia il thread di rete. Idempotente: una seconda chiamata non fa niente.
pub fn avvia() {
    CODA.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("sws-net".into())
            .spawn(move || lavora(rx, TETTO_DI_TEMPO))
            .expect("thread di rete non avviabile");
        tx
    });
}

/// Mette una scrittura in coda e torna subito. Se il thread non è stato avviato la
/// scrittura si perde **dicendolo**: meglio un errore nel log di un comando
/// ingoiato.
pub fn invia(cmd: Comando) {
    match CODA.get() {
        Some(tx) => {
            if tx.send(cmd).is_err() {
                eprintln!("[net] il thread di rete non c'è più: scrittura persa");
            }
        }
        None => eprintln!(
            "[net] il thread di rete non è stato avviato: {} persa",
            cmd.descrizione()
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    /// Un server HTTP minimale che risponde `status` e registra le richieste. Se
    /// `muto`, accetta la connessione e non risponde mai.
    fn server(status: u16, muto: bool) -> (String, Arc<Mutex<Vec<String>>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        let visti = Arc::new(Mutex::new(Vec::new()));
        let v = visti.clone();
        std::thread::spawn(move || {
            for s in l.incoming() {
                let mut s = s.unwrap();
                let v = v.clone();
                std::thread::spawn(move || {
                    let mut buf = [0u8; 8192];
                    let n = s.read(&mut buf).unwrap_or(0);
                    v.lock()
                        .unwrap()
                        .push(String::from_utf8_lossy(&buf[..n]).into_owned());
                    if muto {
                        std::thread::sleep(Duration::from_secs(30));
                        return;
                    }
                    let body = r#"{"ok":true}"#;
                    let r = format!(
                        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = s.write_all(r.as_bytes());
                });
            }
        });
        (base, visti)
    }

    /// Un server di login che risponde `status` dopo `ritardo`: con 200 un
    /// accesso valido, come lo manda il runtime.
    fn server_login(status: u16, ritardo: Duration) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        std::thread::spawn(move || {
            for s in l.incoming() {
                let mut s = s.unwrap();
                std::thread::spawn(move || {
                    let mut buf = [0u8; 8192];
                    let _ = s.read(&mut buf);
                    std::thread::sleep(ritardo);
                    let body =
                        r#"{"token":"tok","username":"admin","role":"Admin","expires_at_ms":null}"#;
                    let r = format!(
                        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = s.write_all(r.as_bytes());
                });
            }
        });
        base
    }

    /// Il pannellino d'accesso con le credenziali appena partite.
    fn accesso_partito(adesso: Instant) -> (crate::aggiornamento::SharedAvviso, u64) {
        use crate::aggiornamento::{accesso_in_corso, chiedi_accesso, AzioneRichiesta};
        let avviso: crate::aggiornamento::SharedAvviso = Default::default();
        chiedi_accesso(&avviso, AzioneRichiesta::Accesso);
        let n = accesso_in_corso(&avviso, adesso);
        (avviso, n)
    }

    fn accedi(
        base_url: String,
        avviso: &crate::aggiornamento::SharedAvviso,
        sessione: &crate::session::SharedSession,
        tentativo: u64,
        scadenza: Instant,
    ) -> Comando {
        Comando::Accedi {
            base_url,
            utente: "admin".into(),
            password: "pw".into(),
            sessione: sessione.clone(),
            avviso: avviso.clone(),
            tentativo,
            scadenza,
        }
    }

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    #[test]
    fn una_put_che_riceve_200_completa_e_porta_il_token() {
        let (base, visti) = server(200, false);
        let r = esegui_bloccando(
            &rt(),
            Comando::PutTag {
                base_url: base,
                tag: "pompa.avvio".into(),
                value: TagValue::Bool(true),
                token: Some("tok".into()),
            },
            Duration::from_secs(5),
        );
        assert_eq!(r, Ok(()));
        let req = visti.lock().unwrap()[0].to_lowercase();
        assert!(req.starts_with("put /api/tags/pompa.avvio"), "{req}");
        assert!(req.contains("authorization: bearer tok"), "{req}");
    }

    #[test]
    fn una_post_di_ack_e_una_di_ricetta_che_ricevono_200_completano() {
        let (base, visti) = server(200, false);
        let t = rt();
        let ack = esegui_bloccando(
            &t,
            Comando::AckAlarm {
                base_url: base.clone(),
                alarm_id: "a1".into(),
                token: None,
            },
            Duration::from_secs(5),
        );
        let ric = esegui_bloccando(
            &t,
            Comando::ApplyRecipe {
                base_url: base,
                id: "r1".into(),
                token: Some("tok".into()),
                esito: None,
            },
            Duration::from_secs(5),
        );
        assert_eq!((ack, ric), (Ok(()), Ok(())));
        let visti = visti.lock().unwrap();
        assert!(
            visti[0]
                .to_lowercase()
                .starts_with("post /api/alarms/a1/ack"),
            "{}",
            visti[0]
        );
        assert!(
            visti[1]
                .to_lowercase()
                .starts_with("post /api/recipes/r1/apply"),
            "{}",
            visti[1]
        );
    }

    #[test]
    fn la_richiesta_di_aggiornamento_e_una_post_col_token() {
        let (base, visti) = server(200, false);
        let r = esegui_bloccando(
            &rt(),
            Comando::AvviaAggiornamento {
                base_url: base,
                token: Some("tok".into()),
                avviso: None,
            },
            Duration::from_secs(5),
        );
        assert_eq!(r, Ok(()));
        let req = visti.lock().unwrap()[0].to_lowercase();
        assert!(req.starts_with("post /api/update/apply"), "{req}");
        assert!(req.contains("authorization: bearer tok"), "{req}");
    }

    /// «Aggiornamento in avvio…» dura fino alla risposta del runtime: con un sì
    /// il pulsante resta spento («avviato»), con un no torna premibile.
    #[test]
    fn la_risposta_all_avvio_dell_aggiornamento_arriva_al_pulsante() {
        for (status, spento) in [(200, true), (500, false)] {
            let (base, _) = server(status, false);
            let avviso: crate::aggiornamento::SharedAvviso = Default::default();
            {
                let mut g = avviso.lock().unwrap();
                g.avvio_chiesto = true;
                g.avvio_in_volo = true;
            }
            let _ = esegui_bloccando(
                &rt(),
                Comando::AvviaAggiornamento {
                    base_url: base,
                    token: Some("tok".into()),
                    avviso: Some(avviso.clone()),
                },
                Duration::from_secs(5),
            );
            let g = avviso.lock().unwrap();
            assert!(!g.avvio_in_volo, "{status}");
            assert_eq!(g.aggiornamento_spento(), spento, "{status}");
        }
    }

    #[test]
    fn un_403_e_un_errore_che_si_legge_non_un_silenzio() {
        let (base, _) = server(403, false);
        let r = esegui_bloccando(
            &rt(),
            Comando::AckAlarm {
                base_url: base,
                alarm_id: "a1".into(),
                token: None,
            },
            Duration::from_secs(5),
        );
        let msg = r.unwrap_err();
        assert!(msg.contains("ack dell'allarme 'a1' fallita"), "{msg}");
    }

    #[test]
    fn una_risposta_che_non_arriva_non_ferma_la_coda_per_sempre() {
        let (base, _) = server(200, true);
        let t0 = std::time::Instant::now();
        let r = esegui_bloccando(
            &rt(),
            Comando::ApplyRecipe {
                base_url: base,
                id: "r1".into(),
                token: None,
                esito: None,
            },
            Duration::from_millis(300),
        );
        assert!(r.unwrap_err().contains("nessuna risposta"));
        assert!(t0.elapsed() < Duration::from_secs(3));
    }

    /// Una risposta che arriva quando il pannellino non la aspetta più non fa
    /// entrare: dopo la rinuncia a 60 s, o dopo «Annulla» (09-11-2026, come
    /// il web, dove la richiesta si annulla). Prima il token arrivava lo
    /// stesso, e chi aveva rinunciato si ritrovava dentro.
    #[test]
    fn una_risposta_che_non_si_aspetta_piu_non_fa_entrare() {
        use crate::aggiornamento::{annulla_accesso, Avviso, ACCESSO_MASSIMO};
        for caso in ["rinuncia a 60 s", "annulla"] {
            let base = server_login(200, Duration::ZERO);
            let t0 = Instant::now();
            let (avviso, n) = accesso_partito(t0);
            if caso == "annulla" {
                annulla_accesso(&avviso);
            } else {
                avviso
                    .lock()
                    .unwrap()
                    .avanza_attesa(t0 + ACCESSO_MASSIMO, "Nessuna risposta, riprova");
            }
            let sessione: crate::session::SharedSession = Default::default();
            let _ = esegui_bloccando(
                &rt(),
                accedi(base, &avviso, &sessione, n, t0 + Duration::from_secs(5)),
                Duration::from_secs(5),
            );
            assert!(
                !sessione.lock().unwrap().is_logged_in(),
                "{caso}: chi ha rinunciato resta fuori"
            );
            if caso != "annulla" {
                assert!(
                    matches!(
                        avviso.lock().unwrap().avviso(),
                        Avviso::Accesso { errore: Some(e), in_corso: false, .. }
                            if e == "Nessuna risposta, riprova"
                    ),
                    "il pannellino resta com'era"
                );
            }
        }
    }

    /// Il login aspetta fino alla sua scadenza, i 60 s dal tocco, e non il
    /// tetto comune delle scritture. Prima a 15 s il comando spariva senza
    /// scrivere niente, e la card restava in attesa finché qualcuno non
    /// premeva «Annulla».
    #[test]
    fn il_login_aspetta_la_sua_scadenza_non_il_tetto_comune() {
        let base = server_login(401, Duration::from_millis(600));
        let t0 = Instant::now();
        let (avviso, n) = accesso_partito(t0);
        let sessione: crate::session::SharedSession = Default::default();
        let _ = esegui_bloccando(
            &rt(),
            accedi(base, &avviso, &sessione, n, t0 + Duration::from_secs(5)),
            Duration::from_millis(200),
        );
        let g = avviso.lock().unwrap();
        let a = g.accesso.as_ref().expect("il pannellino resta aperto");
        assert!(!a.in_corso, "la card non resta in attesa");
        assert!(
            a.errore.as_deref().is_some_and(|e| e.contains("401")),
            "{:?}",
            a.errore
        );
    }

    /// E alla scadenza smette davvero di aspettare: la richiesta si
    /// abbandona alla stessa ora in cui la card rinuncia.
    #[test]
    fn il_login_si_ferma_alla_scadenza() {
        let (base, _) = server(200, true);
        let t0 = Instant::now();
        let (avviso, n) = accesso_partito(t0);
        let sessione: crate::session::SharedSession = Default::default();
        let r = esegui_bloccando(
            &rt(),
            accedi(base, &avviso, &sessione, n, t0 + Duration::from_millis(300)),
            Duration::from_secs(5),
        );
        assert!(r.unwrap_err().contains("nessuna risposta"));
        assert!(t0.elapsed() < Duration::from_secs(3), "{:?}", t0.elapsed());
    }

    /// Un login lento non trattiene le scritture (rilievo del 09-11-2026).
    /// Nella coda unica un PutTag premuto mentre il login aspettava partiva
    /// dopo la sua risposta — fino a 60 s, anche dopo «Annulla»: il bottone
    /// mostrava lo stato vecchio e il comando partiva da solo più tardi.
    #[test]
    fn un_login_lento_non_trattiene_le_scritture() {
        use crate::aggiornamento::annulla_accesso;
        let lento = server_login(200, Duration::from_secs(3));
        let (veloce, visti) = server(200, false);
        let t0 = Instant::now();
        let (avviso, n) = accesso_partito(t0);
        let sessione: crate::session::SharedSession = Default::default();
        let (tx, rx) = mpsc::channel();
        tx.send(accedi(
            lento,
            &avviso,
            &sessione,
            n,
            t0 + Duration::from_secs(60),
        ))
        .unwrap();
        // L'operatore rinuncia e preme un pulsante della pagina.
        annulla_accesso(&avviso);
        tx.send(Comando::PutTag {
            base_url: veloce,
            tag: "pompa.avvio".into(),
            value: TagValue::Bool(true),
            token: None,
        })
        .unwrap();
        drop(tx);
        // `lavora` esce quando il canale si chiude e la scrittura è partita.
        lavora(rx, Duration::from_secs(5));
        let atteso = t0.elapsed();
        assert!(
            !visti.lock().unwrap().is_empty(),
            "la scrittura non è partita"
        );
        assert!(
            atteso < Duration::from_millis(1500),
            "la scrittura ha aspettato il login: {atteso:?}"
        );
        assert!(
            !sessione.lock().unwrap().is_logged_in(),
            "chi ha rinunciato resta fuori"
        );
    }

    #[test]
    fn la_coda_globale_che_usa_il_viewer_esegue_una_scrittura() {
        // L'API vera: `avvia()` una volta, poi `invia()` dal thread principale — cioè
        // esattamente ciò che fa il loop di rendering.
        let (base, visti) = server(200, false);
        avvia();
        invia(Comando::AckAlarm {
            base_url: base,
            alarm_id: "a9".into(),
            token: Some("t".into()),
        });
        let t0 = std::time::Instant::now();
        while visti.lock().unwrap().is_empty() && t0.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(10));
        }
        let visti = visti.lock().unwrap();
        assert!(
            !visti.is_empty(),
            "la scrittura non è partita dalla coda globale"
        );
        assert!(
            visti[0]
                .to_lowercase()
                .starts_with("post /api/alarms/a9/ack"),
            "{}",
            visti[0]
        );
    }

    #[test]
    fn le_scritture_partono_nell_ordine_in_cui_sono_state_fatte() {
        let (base, visti) = server(200, false);
        let (tx, rx) = mpsc::channel();
        for i in 0..5 {
            tx.send(Comando::PutTag {
                base_url: base.clone(),
                tag: format!("t{i}"),
                value: TagValue::Int(i),
                token: None,
            })
            .unwrap();
        }
        drop(tx);
        // `lavora` esce quando il canale si chiude: le cinque partono in sequenza.
        lavora(rx, Duration::from_secs(5));
        let tag: Vec<String> = visti
            .lock()
            .unwrap()
            .iter()
            .map(|r| r.split_whitespace().nth(1).unwrap_or("").to_string())
            .collect();
        assert_eq!(
            tag,
            [
                "/api/tags/t0",
                "/api/tags/t1",
                "/api/tags/t2",
                "/api/tags/t3",
                "/api/tags/t4"
            ]
        );
    }
}
