//! Q49 — fiducia al primo contatto per i certificati TLS dei dispositivi.
//!
//! Fino al 2026-09-09 l'editor parlava con il runtime remoto accettando
//! **qualunque** certificato (`danger_accept_invalid_certs`, un verificatore
//! che diceva sempre sì nel relay). Cifratura sì, identità no: la stessa classe
//! di problema che si è appena chiusa su SSH scegliendo `accept-new` al posto
//! di `no`.
//!
//! Il meccanismo vero e proprio (l'archivio delle impronte, il verificatore
//! rustls, `client_config_pinnato`) vive in `sws_core::pin_tls` dal
//! 13-09-2026: MQTT e il viewer LVGL lo riusano senza dipendere da tutto
//! `sws-web` (axum, l'intero stack HTTP). Questo modulo resta il punto
//! d'ingresso per editor↔dispositivo — stesso nome, stessi tipi, solo
//! riesportati — più l'unica cosa che è davvero solo dell'editor: l'etichetta
//! dell'azione «dimentica» che la UI riconosce.
//!
//! L'archivio è `<config_dir>/dispositivi_conosciuti.yaml`, l'equivalente di
//! `known_hosts`.

use std::path::Path;

pub use sws_core::pin_tls::{
    client_config_pinnato, e_certificato_cambiato, impronta_sha256, ImprontaStore, Voce,
    MOTIVO_CERTIFICATO_CAMBIATO,
};

/// L'etichetta che la UI riconosce per mostrare il pulsante «dimentica».
pub const AZIONE_CERTIFICATO_CAMBIATO: &str = "certificato-cambiato";

const NOME_FILE: &str = "dispositivi_conosciuti.yaml";

/// Comodo per non ripetere il nome del file in ogni chiamante: stesso archivio
/// di sempre, stesso percorso di sempre.
pub fn store_dispositivi(config_dir: &Path) -> ImprontaStore {
    ImprontaStore::in_config(config_dir, NOME_FILE)
}

/// `https://pannello.local:8444/qualcosa` → `pannello.local:8444`. La porta
/// c'è sempre nella chiave: due servizi sullo stesso host possono avere
/// certificati diversi.
pub fn host_port_da_url(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url).ok()?;
    let host = u.host_str()?;
    let porta = u.port_or_known_default()?;
    Some(format!("{host}:{porta}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_chiave_e_host_e_porta_insieme() {
        assert_eq!(
            host_port_da_url("https://wp630.local:8444/api"),
            Some("wp630.local:8444".into())
        );
        assert_eq!(
            host_port_da_url("https://wp630.local"),
            Some("wp630.local:443".into())
        );
        assert_eq!(
            host_port_da_url("http://192.168.1.34:8444"),
            Some("192.168.1.34:8444".into())
        );
        assert_eq!(host_port_da_url("non è un url"), None);
    }

    #[test]
    fn lo_store_dei_dispositivi_usa_il_nome_file_di_sempre() {
        let d = tempfile::tempdir().unwrap();
        let s = store_dispositivi(d.path());
        assert_eq!(s.path(), d.path().join("dispositivi_conosciuti.yaml"));
    }
}
