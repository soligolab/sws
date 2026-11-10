//! Il viewer partito **mentre il runtime non risponde** (10-11-2026).
//!
//! Gemello della schermata del viewer web: il 10-11-2026 sul WP630, col
//! runtime fermo 15 s, il viewer web ha mostrato «No active project», che non
//! era vero. Il viewer LVGL non mostrava niente: `resolve_start_page` falliva,
//! il processo usciva, e `Restart=always` lo rilanciava ogni 5 s con lo schermo
//! vuoto in mezzo. Succede al boot (il viewer prima del runtime) e quando il
//! viewer riparte durante un riavvio del runtime.
//!
//! Ora, se il runtime **non è in ascolto** (connessione rifiutata o scaduta),
//! a schermo c'è «Il pannello si sta riavviando, riprovo…» e un thread lo
//! risente ogni 2 s; appena risponde il viewer riparte da sé (`exec`, come per
//! l'abbinamento) e segue la strada di sempre. Un certificato cambiato (Q49)
//! non è un runtime fermo: quello resta l'errore che dice dove correggere.
//!
//! Durante un fermo **a pagina aperta** il viewer LVGL faceva già la cosa
//! giusta: il socket riprova per sempre, la pagina resta, la fascia «Dati in
//! ritardo» lo dice, e alla riconnessione la pagina si rilegge.

use std::time::Duration;

use crate::model::SynopticPage;
use crate::testi_sistema::{testo, Testo};

/// Ogni quanto si risente il runtime.
const RIPROVA: Duration = Duration::from_secs(2);
/// Quanto aspettare una risposta prima di dire che non c'è.
const SONDA: Duration = Duration::from_secs(2);

/// La lingua della schermata: quella scelta l'ultima volta su questo pannello,
/// o l'inglese (il progetto, per definizione, non si può ancora leggere).
pub fn lingua() -> String {
    crate::client::lingua_salvata_grezza().unwrap_or_else(|| "en".into())
}

/// La pagina della schermata, 800×480 come quella dell'abbinamento. Sotto,
/// la stessa frase in inglese se la lingua è un'altra: chi la legge può non
/// essere chi ha scelto la lingua.
pub fn pagina(lingua: &str) -> anyhow::Result<SynopticPage> {
    let riga = |id: &str, y: u32, corpo: u32, colore: &str, t: &str| {
        serde_json::json!({
            "id": id, "type": "text", "x": 400, "y": y, "width": 720, "height": 50,
            "text": t, "font_size": corpo, "color": colore, "text_anchor": "middle",
        })
    };
    let mut oggetti = vec![riga(
        "titolo",
        200,
        26,
        "#e2e8f0",
        testo(Testo::PannelloInRiavvio, lingua),
    )];
    let inglese = testo(Testo::PannelloInRiavvio, "en");
    if testo(Testo::PannelloInRiavvio, lingua) != inglese {
        oggetti.push(riga("en", 270, 15, "#64748b", inglese));
    }
    let v = serde_json::json!({
        "id": "__riavvio",
        "name": "riavvio",
        "background": "#0f172a",
        "width": 800,
        "height": 480,
        "objects": oggetti,
    });
    Ok(serde_json::from_value(v)?)
}

/// Vero se il runtime a quell'indirizzo **non è in ascolto**: la connessione
/// è rifiutata o non arriva. Una risposta qualunque (anche un errore HTTP) o
/// un certificato cambiato non sono un runtime fermo.
pub async fn runtime_fermo(base_url: &str) -> bool {
    match crate::client::sonda_health(base_url, SONDA).await {
        Ok(()) => false,
        Err(e) => {
            let fermo = e.is_connect() || e.is_timeout();
            fermo && crate::tls::spiega_certificato_cambiato(&format!("{e:?}")).is_none()
        }
    }
}

/// Risente il runtime ogni 2 s e, appena non è più fermo, riavvia il viewer
/// con gli stessi argomenti.
pub fn avvia_attesa(rt: tokio::runtime::Handle, base_url: String) {
    std::thread::spawn(move || loop {
        std::thread::sleep(RIPROVA);
        if !rt.block_on(runtime_fermo(&base_url)) {
            eprintln!("[riavvio] il runtime risponde: riparto sulla pagina del progetto");
            crate::abbinamento::riavvia();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn testi(p: &SynopticPage) -> Vec<String> {
        p.objects.iter().filter_map(|o| o.text.clone()).collect()
    }

    #[test]
    fn la_pagina_dice_che_si_riavvia_nella_lingua_e_in_inglese() {
        let it = pagina("it").unwrap();
        assert_eq!(it.width, Some(800.0));
        assert_eq!(
            testi(&it),
            vec![
                "Il pannello si sta riavviando, riprovo…".to_string(),
                "The panel is restarting, retrying…".to_string(),
            ]
        );
        // In inglese una riga sola, non due uguali.
        assert_eq!(
            testi(&pagina("en").unwrap()),
            vec!["The panel is restarting, retrying…".to_string()]
        );
    }

    #[tokio::test]
    async fn una_porta_chiusa_e_un_runtime_fermo() {
        // Una porta presa e subito liberata: nessuno in ascolto.
        let porta = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        assert!(runtime_fermo(&format!("http://127.0.0.1:{porta}")).await);
    }

    #[tokio::test]
    async fn un_runtime_che_risponde_anche_con_un_errore_non_e_fermo() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let porta = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut s, _)) = l.accept().await {
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf).await;
                let _ = s
                    .write_all(b"HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0\r\n\r\n")
                    .await;
            }
        });
        assert!(!runtime_fermo(&format!("http://127.0.0.1:{porta}")).await);
    }
}
