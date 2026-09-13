//! Q49 — fiducia al primo contatto per il certificato del runtime.
//!
//! Fino al 13-09-2026 questo client accettava **qualunque** certificato
//! (`AcceptAnyCert`/`danger_accept_invalid_certs`): comodo perché il runtime
//! genera certificati self-signed al volo (`rcgen`), ma cifratura senza
//! identità — lo stesso compromesso già chiuso per editor↔dispositivo il
//! 2026-09-09 (`sws-web/src/certificati.rs`, ora `sws_core::pin_tls`).
//!
//! Il deploy di fabbrica (container e Yocto) punta sempre a `127.0.0.1`/
//! `localhost` — il viewer e il suo runtime vivono sullo stesso dispositivo —
//! ma `--base-url`/`SWS_LVGL_BASE_URL` restano configurabili, e pinnare qui
//! costa poco (stessa rustls "ring" del resto del workspace): uniformità con
//! editor↔dispositivo e MQTT, deciso col maintainer il 13-09-2026.
//!
//! Nessuna UI qui per il gesto di «dimentica» (è un CLI, non una pagina):
//! un'impronta cambiata rifiuta la connessione e stampa il percorso del file
//! da correggere a mano — stesso principio di `known_hosts`, editabile con un
//! editor di testo invece che con `ssh-keygen -R`.

use std::path::PathBuf;
use std::sync::Arc;

use sws_core::pin_tls::{e_certificato_cambiato, ImprontaStore};

const NOME_FILE: &str = "lvgl_tls_conosciuti.yaml";

/// `~/.config/sws/lvgl_tls_conosciuti.yaml` — stessa cartella di
/// `~/.config/sws/lvgl_session.json` (vedi `session::session_path`), un file
/// in più nella stessa convenzione.
fn store_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".config/sws").join(NOME_FILE))
}

fn store() -> anyhow::Result<ImprontaStore> {
    let path = store_path()
        .ok_or_else(|| anyhow::anyhow!("variabile HOME assente: impossibile aprire {NOME_FILE}"))?;
    Ok(ImprontaStore::new(path))
}

/// `host:porta` da un URL qualunque (base URL o URL completo di endpoint) —
/// la parte che conta per l'impronta è solo quella.
fn host_port_da_url(url: &str) -> anyhow::Result<String> {
    let u = reqwest::Url::parse(url).map_err(|e| anyhow::anyhow!("URL non valido «{url}»: {e}"))?;
    let host = u
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("URL senza host: «{url}»"))?;
    let porta = u
        .port_or_known_default()
        .ok_or_else(|| anyhow::anyhow!("URL senza porta nota: «{url}»"))?;
    Ok(format!("{host}:{porta}"))
}

/// `rustls::ClientConfig` pinnato sull'impronta di `url` (base URL o URL
/// completo, indifferentemente) — per `reqwest::ClientBuilder::use_preconfigured_tls`,
/// che vuole il valore posseduto, non un `Arc`. Un file riletto ad ogni
/// chiamata — piccolo, cambia di rado, vedi `sws_core::pin_tls`.
pub fn pinned_client_config(url: &str) -> anyhow::Result<rustls::ClientConfig> {
    let host_port = host_port_da_url(url)?;
    let store = Arc::new(store()?);
    Ok(sws_core::pin_tls::client_config_pinnato(&host_port, store))
}

/// Come sopra, ma dentro un `Arc` — per `tokio_tungstenite::Connector::Rustls`,
/// che lo vuole così.
///
/// Un'impronta cambiata non è un errore di rete generico: il messaggio dice
/// esplicitamente dove intervenire, perché qui non c'è un pulsante «dimentica»
/// da premere.
pub fn pinned_client_config_arc(url: &str) -> anyhow::Result<Arc<rustls::ClientConfig>> {
    Ok(Arc::new(pinned_client_config(url)?))
}

/// Il messaggio da mostrare quando una richiesta fallisce per impronta
/// cambiata — non generico, dice dove correggere a mano.
pub fn spiega_certificato_cambiato(errore: &str) -> Option<String> {
    if !e_certificato_cambiato(errore) {
        return None;
    }
    let percorso = store_path()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| NOME_FILE.to_string());
    Some(format!(
        "{errore}\n\
         Il certificato del runtime è cambiato da quando questo pannello l'ha visto \
         l'ultima volta — potrebbe essere legittimo (un runtime reinstallato) o no. \
         Per accettare il nuovo certificato, togli la riga di «{percorso}» che inizia \
         con l'host di questo runtime, poi riprova."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_porta_da_base_url_e_da_url_completo() {
        assert_eq!(
            host_port_da_url("https://127.0.0.1:8443").unwrap(),
            "127.0.0.1:8443"
        );
        assert_eq!(
            host_port_da_url("wss://localhost:8443/ws/tags").unwrap(),
            "localhost:8443"
        );
    }

    #[test]
    fn un_url_senza_host_e_un_errore_non_un_panico() {
        assert!(host_port_da_url("non è un url").is_err());
    }

    #[test]
    fn il_messaggio_di_spiegazione_solo_per_lerrore_giusto() {
        assert!(spiega_certificato_cambiato("connection refused").is_none());
        let spiegato = spiega_certificato_cambiato(&format!(
            "{}: 127.0.0.1:8443 presentava X, ora presenta Y",
            sws_core::pin_tls::MOTIVO_CERTIFICATO_CAMBIATO
        ));
        assert!(spiegato.is_some());
        assert!(spiegato.unwrap().contains("lvgl_tls_conosciuti.yaml"));
    }
}
