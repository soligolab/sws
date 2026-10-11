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
//!
//! **Prima le autorità pubbliche (10-10-2026).** Un certificato firmato da una
//! CA pubblica e valido per il nome chiamato passa senza impronta: è la
//! verifica dei browser, e vale almeno quanto un'impronta presa al primo
//! contatto. Serve al gateway nel cloud (`sws.soligo.net`, Let's Encrypt): il
//! certificato si rinnova ogni ~60 giorni e con la sola impronta ogni rinnovo
//! sarebbe stato un «certificato cambiato». Solo se la verifica pubblica
//! fallisce — sempre, per un pannello in LAN con un certificato autofirmato —
//! vale il modello di sopra, intatto.

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
    /// La verifica dei browser, con le autorità pubbliche. `None` solo se non
    /// si è riusciti a costruirla: allora resta la sola impronta, come prima.
    pubblico: Option<Arc<rustls::client::WebPkiServerVerifier>>,
}

fn verificatore_pubblico(
    radici: rustls::RootCertStore,
    provider: Arc<CryptoProvider>,
) -> Option<Arc<rustls::client::WebPkiServerVerifier>> {
    rustls::client::WebPkiServerVerifier::builder_with_provider(Arc::new(radici), provider)
        .build()
        .map_err(|e| tracing::warn!("verifica con le autorità pubbliche non disponibile: {e}"))
        .ok()
}

fn radici_pubbliche() -> rustls::RootCertStore {
    rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    }
}

impl ServerCertVerifier for VerificatorePin {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if let Some(p) = &self.pubblico {
            if p.verify_server_cert(end_entity, intermediates, server_name, ocsp, now).is_ok() {
                return Ok(ServerCertVerified::assertion());
            }
        }
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
        pubblico: verificatore_pubblico(radici_pubbliche(), provider.clone()),
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
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        VerificatorePin {
            host_port: "pannello.local:8444".into(),
            store,
            pubblico: verificatore_pubblico(radici_pubbliche(), provider.clone()),
            provider,
        }
    }

    /// Una CA «pubblica» di prova e un certificato firmato da lei per `nome`.
    fn ca_e_foglia(nome: &str) -> (rustls::RootCertStore, Vec<u8>, Vec<u8>) {
        use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair};
        let chiave_ca = KeyPair::generate().unwrap();
        let mut pca = CertificateParams::new(Vec::<String>::new()).unwrap();
        pca.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        let ca = pca.self_signed(&chiave_ca).unwrap();
        let foglia = |n: &str| {
            let k = KeyPair::generate().unwrap();
            CertificateParams::new(vec![n.to_string()])
                .unwrap()
                .signed_by(&k, &ca, &chiave_ca)
                .unwrap()
                .der()
                .to_vec()
        };
        let mut radici = rustls::RootCertStore::empty();
        radici.add(ca.der().clone()).unwrap();
        (radici, foglia(nome), foglia(nome))
    }

    fn verifica_nome(v: &VerificatorePin, nome: &str, der: &[u8]) -> Result<ServerCertVerified, rustls::Error> {
        let sn = ServerName::try_from(nome.to_string()).unwrap();
        v.verify_server_cert(&CertificateDer::from(der.to_vec()), &[], &sn, &[], UnixTime::now())
    }

    #[test]
    fn un_certificato_pubblico_passa_anche_rinnovato_senza_impronte() {
        let (_d, store) = store_prova();
        let (radici, primo, rinnovato) = ca_e_foglia("sws.soligo.net");
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let v = VerificatorePin {
            host_port: "sws.soligo.net:443".into(),
            store: store.clone(),
            pubblico: verificatore_pubblico(radici, provider.clone()),
            provider,
        };
        // Un'impronta vecchia memorizzata (il caso del 10-10-2026) non conta.
        store.memorizza("sws.soligo.net:443", "sha256:vecchia").unwrap();
        assert!(verifica_nome(&v, "sws.soligo.net", &primo).is_ok());
        assert!(verifica_nome(&v, "sws.soligo.net", &rinnovato).is_ok(), "il rinnovo passa");
        assert_eq!(store.impronta_di("sws.soligo.net:443").as_deref(), Some("sha256:vecchia"), "e non si tocca l'archivio");
        // Lo stesso certificato per un altro nome non è pubblico per quel
        // nome: si torna all'impronta, che qui non c'è → primo contatto.
        let (_d2, store2) = store_prova();
        let (radici2, altro, _) = ca_e_foglia("sws.soligo.net");
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let v2 = VerificatorePin {
            host_port: "evil.example:443".into(),
            store: store2.clone(),
            pubblico: verificatore_pubblico(radici2, provider.clone()),
            provider,
        };
        assert!(verifica_nome(&v2, "evil.example", &altro).is_ok());
        assert!(store2.impronta_di("evil.example:443").is_some(), "è passato per l'impronta");
    }

    #[test]
    fn un_autofirmato_cambiato_resta_rifiutato_con_le_radici_vere() {
        let (_d, store) = store_prova();
        let v = verificatore(store);
        let (_, a, b) = ca_e_foglia("pannello.local");
        assert!(verifica_nome(&v, "pannello.local", &a).is_ok(), "primo contatto");
        let e = verifica_nome(&v, "pannello.local", &b).unwrap_err();
        assert!(e_certificato_cambiato(&e.to_string()));
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
