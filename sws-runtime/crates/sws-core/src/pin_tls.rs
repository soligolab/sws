//! Q49 — fiducia al primo contatto (TOFU) per i certificati TLS self-signed,
//! condivisa fra chi parla con un dispositivo/broker su LAN: l'editor verso
//! il runtime remoto (`sws-web::certificati`, che riesporta questo modulo),
//! il plugin MQTT verso un broker, e il viewer LVGL verso il proprio runtime.
//!
//! Nato in `sws-web/src/certificati.rs` il 2026-09-09 per editor↔dispositivo;
//! spostato qui il 13-09-2026 perché MQTT e LVGL potessero riusarlo senza
//! dipendere da `sws-web` (che porta axum e l'intero stack HTTP — troppo per
//! un plugin o un binario cross-compilato, stesso principio già seguito per
//! `session.rs` in `sws-lvgl-viewer`). `sws-core` non li aveva: qui bastano
//! `rustls` (già "ring" ovunque nel workspace) e `sha2`, pura Rust.
//!
//! Stesso modello mentale di `known_hosts` per SSH:
//!
//! - **primo contatto**: si memorizza l'impronta SHA-256 del certificato e si
//!   prosegue — niente CA da interrogare, i pannelli/broker di test hanno
//!   certificati self-signed;
//! - **stessa impronta** le volte dopo: si prosegue in silenzio;
//! - **impronta diversa**: si rifiuta e si dice perché. Mai automatico: un
//!   factory reset e un attacco sono indistinguibili da fuori — chi consuma
//!   questo modulo decide come offrire il gesto di «dimentica» (un pulsante
//!   nella UI per l'editor, la cancellazione manuale della riga di YAML per
//!   un CLI come il viewer LVGL).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Il marcatore che finisce nell'errore TLS quando l'impronta non combacia.
/// Chi riceve l'errore (reqwest, tungstenite, rumqttc) lo incarta più volte:
/// si cerca questa stringa nel testo, non un tipo.
pub const MOTIVO_CERTIFICATO_CAMBIATO: &str = "certificato del dispositivo cambiato";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Voce {
    /// `sha256:<hex>` del certificato foglia, in DER.
    pub impronta: String,
    pub visto_il_ms: u64,
}

/// `host:porta` → impronta. Un file, riletto a ogni uso: è piccolo, cambia di
/// rado, e così due processi (editor e guardia) non si pestano una cache.
#[derive(Debug)]
pub struct ImprontaStore {
    path: PathBuf,
}

impl ImprontaStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn in_config(config_dir: &Path, nome_file: &str) -> Self {
        Self::new(config_dir.join(nome_file))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn carica(&self) -> BTreeMap<String, Voce> {
        match std::fs::read_to_string(&self.path) {
            Ok(t) if !t.trim().is_empty() => serde_yaml::from_str(&t).unwrap_or_default(),
            _ => BTreeMap::new(),
        }
    }

    fn salva(&self, m: &BTreeMap<String, Voce>) -> std::io::Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let testo = serde_yaml::to_string(m).map_err(std::io::Error::other)?;
        std::fs::write(&self.path, testo)
    }

    pub fn impronta_di(&self, host_port: &str) -> Option<String> {
        self.carica().get(host_port).map(|v| v.impronta.clone())
    }

    pub fn memorizza(&self, host_port: &str, impronta: &str) -> std::io::Result<()> {
        let mut m = self.carica();
        m.insert(
            host_port.to_string(),
            Voce {
                impronta: impronta.to_string(),
                visto_il_ms: crate::now_ms(),
            },
        );
        self.salva(&m)
    }

    /// `true` se c'era qualcosa da togliere.
    pub fn dimentica(&self, host_port: &str) -> std::io::Result<bool> {
        let mut m = self.carica();
        let c = m.remove(host_port).is_some();
        if c {
            self.salva(&m)?;
        }
        Ok(c)
    }

    /// Tutte le voci per un host, qualunque porta: il pulsante «dimentica» della
    /// UI conosce l'host, non sempre la porta con cui era stato salvato.
    pub fn dimentica_host(&self, host: &str) -> std::io::Result<Vec<String>> {
        let mut m = self.carica();
        let chiavi: Vec<String> = m
            .keys()
            .filter(|k| {
                k.rsplit_once(':')
                    .map(|(h, _)| h == host)
                    .unwrap_or(*k == host)
            })
            .cloned()
            .collect();
        for k in &chiavi {
            m.remove(k);
        }
        if !chiavi.is_empty() {
            self.salva(&m)?;
        }
        Ok(chiavi)
    }
}

pub fn impronta_sha256(der: &[u8]) -> String {
    let h = Sha256::digest(der);
    let mut s = String::with_capacity(7 + 64);
    s.push_str("sha256:");
    for b in h {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// L'errore che si ha in mano è il nostro rifiuto per impronta cambiata?
pub fn e_certificato_cambiato(testo: &str) -> bool {
    testo.contains(MOTIVO_CERTIFICATO_CAMBIATO)
}

/// Il verificatore: firma verificata davvero (con gli algoritmi del provider),
/// catena NON verificata (self-signed, nessuna CA), identità = impronta nota.
#[derive(Debug)]
struct VerificatorePin {
    host_port: String,
    store: Arc<ImprontaStore>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for VerificatorePin {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let vista = impronta_sha256(end_entity.as_ref());
        match self.store.impronta_di(&self.host_port) {
            Some(nota) if nota == vista => Ok(ServerCertVerified::assertion()),
            Some(nota) => Err(rustls::Error::General(format!(
                "{MOTIVO_CERTIFICATO_CAMBIATO}: {} presentava {nota}, ora presenta {vista}",
                self.host_port
            ))),
            None => {
                // Primo contatto: si memorizza. Se il disco rifiuta, meglio
                // fermarsi che fidarsi senza poterselo ricordare.
                self.store.memorizza(&self.host_port, &vista).map_err(|e| {
                    rustls::Error::General(format!(
                        "impossibile memorizzare l'impronta di {}: {e}",
                        self.host_port
                    ))
                })?;
                tracing::info!(host = %self.host_port, impronta = %vista, "certificato memorizzato al primo contatto");
                Ok(ServerCertVerified::assertion())
            }
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// `ClientConfig` rustls che si fida di `host_port` per impronta.
pub fn client_config_pinnato(host_port: &str, store: Arc<ImprontaStore>) -> rustls::ClientConfig {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verificatore = Arc::new(VerificatorePin {
        host_port: host_port.to_string(),
        store,
        provider: provider.clone(),
    });
    rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("versioni TLS predefinite")
        .dangerous()
        .with_custom_certificate_verifier(verificatore)
        .with_no_client_auth()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_prova() -> (tempfile::TempDir, Arc<ImprontaStore>) {
        let d = tempfile::tempdir().unwrap();
        let s = Arc::new(ImprontaStore::in_config(d.path(), "conosciuti.yaml"));
        (d, s)
    }

    fn verifica(v: &VerificatorePin, der: &[u8]) -> Result<ServerCertVerified, rustls::Error> {
        let sn = ServerName::try_from("pannello.local").unwrap();
        v.verify_server_cert(
            &CertificateDer::from(der.to_vec()),
            &[],
            &sn,
            &[],
            UnixTime::now(),
        )
    }

    fn verificatore(store: Arc<ImprontaStore>) -> VerificatorePin {
        VerificatorePin {
            host_port: "pannello.local:8444".into(),
            store,
            provider: Arc::new(rustls::crypto::ring::default_provider()),
        }
    }

    #[test]
    fn primo_contatto_memorizza_e_accetta() {
        let (_d, store) = store_prova();
        let v = verificatore(store.clone());
        assert!(verifica(&v, b"cert-A").is_ok());
        assert_eq!(
            store.impronta_di("pannello.local:8444"),
            Some(impronta_sha256(b"cert-A"))
        );
    }

    #[test]
    fn stesso_certificato_passa_diverso_no() {
        let (_d, store) = store_prova();
        let v = verificatore(store.clone());
        verifica(&v, b"cert-A").unwrap();
        assert!(verifica(&v, b"cert-A").is_ok(), "stessa impronta");
        let err = verifica(&v, b"cert-B").unwrap_err().to_string();
        assert!(e_certificato_cambiato(&err), "{err}");
        // e NON ha sovrascritto la voce: la decisione resta a una persona
        assert_eq!(
            store.impronta_di("pannello.local:8444"),
            Some(impronta_sha256(b"cert-A"))
        );
    }

    #[test]
    fn dimenticare_riapre_il_primo_contatto() {
        let (_d, store) = store_prova();
        let v = verificatore(store.clone());
        verifica(&v, b"cert-A").unwrap();
        assert!(verifica(&v, b"cert-B").is_err());
        assert_eq!(
            store.dimentica_host("pannello.local").unwrap(),
            vec!["pannello.local:8444".to_string()]
        );
        assert!(
            verifica(&v, b"cert-B").is_ok(),
            "dopo «dimentica» il nuovo certificato è il primo contatto"
        );
        assert_eq!(
            store.impronta_di("pannello.local:8444"),
            Some(impronta_sha256(b"cert-B"))
        );
    }

    #[test]
    fn dimentica_host_toglie_tutte_le_porte_di_quell_host_e_nient_altro() {
        let (_d, store) = store_prova();
        store.memorizza("a.local:8444", "sha256:1").unwrap();
        store.memorizza("a.local:8443", "sha256:2").unwrap();
        store.memorizza("b.local:8444", "sha256:3").unwrap();
        let tolte = store.dimentica_host("a.local").unwrap();
        assert_eq!(tolte.len(), 2);
        assert_eq!(store.impronta_di("b.local:8444"), Some("sha256:3".into()));
        assert!(store.dimentica_host("nessuno.local").unwrap().is_empty());
    }

    #[test]
    fn un_archivio_corrotto_non_blocca_ma_non_fida() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("conosciuti.yaml");
        std::fs::write(&p, "{ non: [yaml valido").unwrap();
        let store = ImprontaStore::new(p);
        assert_eq!(
            store.impronta_di("x:1"),
            None,
            "corrotto = vuoto, quindi primo contatto, mai «passa»"
        );
    }
}
