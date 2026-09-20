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

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::OnceLock;
use std::time::Duration;

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
    },
}

impl Comando {
    fn descrizione(&self) -> String {
        match self {
            Comando::PutTag { tag, .. } => format!("scrittura del tag '{tag}'"),
            Comando::AckAlarm { alarm_id, .. } => format!("ack dell'allarme '{alarm_id}'"),
            Comando::ApplyRecipe { id, .. } => format!("applicazione della ricetta '{id}'"),
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
        } => client::apply_recipe(base_url, id, token).await,
    }
}

/// Esegue un comando fino al tetto di tempo. `Err` porta il testo da mettere nel log.
fn esegui_bloccando(
    rt: &tokio::runtime::Runtime,
    cmd: Comando,
    tetto: Duration,
) -> Result<(), String> {
    let cosa = cmd.descrizione();
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

fn lavora(rx: Receiver<Comando>, tetto: Duration) {
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!(
                "[net] runtime del thread di rete non creato: {e} — le scritture non partiranno"
            );
            return;
        }
    };
    while let Ok(cmd) = rx.recv() {
        if let Err(msg) = esegui_bloccando(&rt, cmd, tetto) {
            eprintln!("[net] {msg}");
        }
    }
}

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
            },
            Duration::from_millis(300),
        );
        assert!(r.unwrap_err().contains("nessuna risposta"));
        assert!(t0.elapsed() < Duration::from_secs(3));
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
