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

/// `https://pannello.local:7444/qualcosa` → `pannello.local:7444`. La porta
/// c'è sempre nella chiave: due servizi sullo stesso host possono avere
/// certificati diversi.
pub fn host_port_da_url(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url).ok()?;
    let host = u.host_str()?;
    let porta = u.port_or_known_default()?;
    Some(format!("{host}:{porta}"))
}

// ── La vista dei certificati (25-10-2026) ────────────────────────────────────
//
// Decisioni 3, 4 e 8 del piano `docs/archive/2026-10-15-certificati-in-un-posto-solo.md`:
// una scheda che elenca tutti gli archivi di certificati e impronte di
// un'istanza — dello stesso processo, o del dispositivo collegato via
// `/api/remote/certificati`. Qui c'è la lettura, pura sulle cartelle che riceve,
// così si prova su una directory temporanea.

/// Quel che si legge di un certificato.
#[derive(Debug, Clone, Default, serde::Serialize, PartialEq)]
pub struct Dettagli {
    pub soggetto: String,
    pub emittente: String,
    /// I nomi alternativi (SAN): DNS e indirizzi.
    pub nomi: Vec<String>,
    pub valido_dal_ms: u64,
    pub valido_al_ms: u64,
    /// `sha256:<hex>` del DER, come nell'archivio delle impronte.
    pub impronta: String,
}

/// Soggetto, emittente, nomi, validità e impronta di un certificato DER.
pub fn leggi_certificato(der: &[u8]) -> Option<Dettagli> {
    use x509_cert::der::Decode;
    let c = x509_cert::Certificate::from_der(der).ok()?;
    let tbs = &c.tbs_certificate;
    let mut nomi = Vec::new();
    if let Ok(Some((_, san))) = tbs.get::<x509_cert::ext::pkix::SubjectAltName>() {
        for n in san.0 {
            match n {
                x509_cert::ext::pkix::name::GeneralName::DnsName(d) => nomi.push(d.to_string()),
                x509_cert::ext::pkix::name::GeneralName::IpAddress(ip) => {
                    let b = ip.as_bytes();
                    match b.len() {
                        4 => nomi.push(std::net::Ipv4Addr::new(b[0], b[1], b[2], b[3]).to_string()),
                        16 => {
                            let mut a = [0u8; 16];
                            a.copy_from_slice(b);
                            nomi.push(std::net::Ipv6Addr::from(a).to_string());
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
    Some(Dettagli {
        soggetto: tbs.subject.to_string(),
        emittente: tbs.issuer.to_string(),
        nomi,
        valido_dal_ms: tbs.validity.not_before.to_unix_duration().as_millis() as u64,
        valido_al_ms: tbs.validity.not_after.to_unix_duration().as_millis() as u64,
        impronta: impronta_sha256(der),
    })
}

/// Il primo certificato di un PEM (la foglia di una catena).
pub fn leggi_pem(pem: &[u8]) -> Option<Dettagli> {
    let mut r = std::io::BufReader::new(pem);
    let der = rustls_pemfile::certs(&mut r).next()?.ok()?;
    leggi_certificato(der.as_ref())
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct RigaImpronta {
    /// `host:porta`.
    pub chiave: String,
    pub impronta: String,
    pub visto_il_ms: u64,
}

/// Un archivio di impronte (fiducia al primo contatto). `disponibile: false`
/// quando questa istanza non lo vede — il viewer LVGL con un quadlet vecchio.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct ArchivioImpronte {
    pub disponibile: bool,
    pub righe: Vec<RigaImpronta>,
}

pub fn archivio_impronte(file: &Path, disponibile: bool) -> ArchivioImpronte {
    let righe = ImprontaStore::new(file.to_path_buf())
        .elenco()
        .into_iter()
        .map(|(chiave, v)| RigaImpronta { chiave, impronta: v.impronta, visto_il_ms: v.visto_il_ms })
        .collect();
    ArchivioImpronte { disponibile, righe }
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct CertificatoFile {
    pub file: String,
    /// `trusted`, `rejected` o `own` (il proprio).
    pub stato: String,
    pub dettagli: Option<Dettagli>,
}

/// I certificati di una PKI alla OPC-UA: `own/cert.der`, `trusted/`, `rejected/`.
pub fn certificati_pki(radice: &Path) -> Vec<CertificatoFile> {
    let mut out = Vec::new();
    if let Ok(der) = std::fs::read(radice.join("own").join("cert.der")) {
        out.push(CertificatoFile { file: "own/cert.der".into(), stato: "own".into(), dettagli: leggi_certificato(&der) });
    }
    for stato in ["trusted", "rejected"] {
        let Ok(voci) = std::fs::read_dir(radice.join(stato)) else { continue };
        let mut nomi: Vec<_> = voci.flatten().filter(|v| v.path().is_file()).collect();
        nomi.sort_by_key(|v| v.file_name());
        for v in nomi {
            let der = std::fs::read(v.path()).unwrap_or_default();
            out.push(CertificatoFile {
                file: v.file_name().to_string_lossy().to_string(),
                stato: stato.into(),
                dettagli: leggi_certificato(&der),
            });
        }
    }
    out
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct PkiSorgente {
    pub sorgente: String,
    pub certificati: Vec<CertificatoFile>,
}

#[derive(Debug, Clone, Default, serde::Serialize, PartialEq)]
pub struct Ssh {
    /// Gli host di `known_hosts`, col tipo di chiave. Un host sotto hash
    /// (`|1|…`) non si può leggere: compare come «nascosto».
    pub known_hosts: Vec<String>,
    /// La chiave pubblica di progetto (`.git/sws-ssh/id_ed25519.pub`): tipo e
    /// commento, se c'è.
    pub chiave_progetto: Option<String>,
}

pub fn ssh(home: Option<&Path>, progetto: Option<&Path>) -> Ssh {
    let known_hosts = home
        .and_then(|h| std::fs::read_to_string(h.join(".ssh").join("known_hosts")).ok())
        .map(|t| {
            t.lines()
                .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
                .map(|l| {
                    let mut p = l.split_whitespace();
                    let host = p.next().unwrap_or("");
                    let tipo = p.next().unwrap_or("");
                    let host = if host.starts_with("|1|") { "(nascosto)" } else { host };
                    format!("{host} {tipo}")
                })
                .collect()
        })
        .unwrap_or_default();
    let chiave_progetto = progetto
        .and_then(|p| std::fs::read_to_string(crate::git_deploy::cartella_chiave_progetto(p).join("id_ed25519.pub")).ok())
        .map(|t| {
            let mut p = t.split_whitespace();
            let tipo = p.next().unwrap_or("").to_string();
            let _corpo = p.next();
            let commento: Vec<&str> = p.collect();
            format!("{tipo} {}", commento.join(" ")).trim().to_string()
        });
    Ssh { known_hosts, chiave_progetto }
}

/// Tutti gli archivi di un'istanza.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct Inventario {
    /// Il certificato del server web (`<config>/tls.crt`), se c'è.
    pub tls: Option<Dettagli>,
    pub dispositivi: ArchivioImpronte,
    pub mqtt: ArchivioImpronte,
    pub viewer_lvgl: ArchivioImpronte,
    pub opcua_client: Vec<PkiSorgente>,
    /// La PKI del server OPC-UA (`<cwd>/pki`), se esiste.
    pub opcua_server: Option<Vec<CertificatoFile>>,
    pub ssh: Ssh,
}

/// Le cartelle da cui si legge, tutte passate da chi chiama.
pub struct Cartelle<'a> {
    pub config: &'a Path,
    pub progetto: Option<&'a Path>,
    pub sorgenti_opcua: &'a [String],
    pub viewer: &'a Path,
    pub pki_server: &'a Path,
    pub home: Option<&'a Path>,
}

pub fn inventario(c: &Cartelle) -> Inventario {
    let tls = std::fs::read(c.config.join("tls.crt")).ok().and_then(|p| leggi_pem(&p));
    let opcua_client = match c.progetto {
        Some(p) => c
            .sorgenti_opcua
            .iter()
            .map(|id| PkiSorgente { sorgente: id.clone(), certificati: certificati_pki(&p.join("opcua-pki").join(id)) })
            .collect(),
        None => Vec::new(),
    };
    Inventario {
        tls,
        dispositivi: archivio_impronte(&c.config.join(NOME_FILE), true),
        mqtt: archivio_impronte(&c.config.join(FILE_MQTT), true),
        viewer_lvgl: archivio_impronte(&c.viewer.join(FILE_VIEWER), c.viewer.is_dir()),
        opcua_client,
        opcua_server: c.pki_server.is_dir().then(|| certificati_pki(c.pki_server)),
        ssh: ssh(c.home, c.progetto),
    }
}

/// L'archivio dei broker MQTT (`main.rs` lo apre con questo nome).
pub const FILE_MQTT: &str = "mqtt_broker_conosciuti.yaml";
/// L'archivio del viewer LVGL (`sws-lvgl-viewer/src/tls.rs`).
pub const FILE_VIEWER: &str = "lvgl_tls_conosciuti.yaml";

#[cfg(test)]
mod tests {
    use super::*;

    /// La vista dei certificati legge davvero (25-10-2026): soggetto, nomi,
    /// validità e impronta di un autofirmato; tutti gli archivi da cartelle
    /// finte; le righe morte del pinning comprese.
    #[test]
    fn l_inventario_legge_tutti_gli_archivi() {
        let mut p = rcgen::CertificateParams::new(vec!["tc620.local".to_string(), "127.0.0.1".to_string()]).unwrap();
        p.distinguished_name.push(rcgen::DnType::CommonName, "tc620-garage");
        let k = rcgen::KeyPair::generate().unwrap();
        let cert = p.self_signed(&k).unwrap();
        let d = leggi_certificato(cert.der()).expect("si legge");
        assert!(d.soggetto.contains("tc620-garage"), "{}", d.soggetto);
        assert!(d.nomi.contains(&"tc620.local".to_string()) && d.nomi.contains(&"127.0.0.1".to_string()), "{:?}", d.nomi);
        assert!(d.valido_al_ms > d.valido_dal_ms);
        assert!(d.impronta.starts_with("sha256:"));

        let t = tempfile::tempdir().unwrap();
        let config = t.path().join("config");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::write(config.join("tls.crt"), cert.pem()).unwrap();
        let disp = store_dispositivi(&config);
        disp.memorizza("tc620.local:7444", "sha256:aa").unwrap();
        disp.memorizza("tc620.local:8444", "sha256:bb").unwrap(); // la riga morta delle porte vecchie
        let progetto = t.path().join("prog");
        let pki = progetto.join("opcua-pki").join("pressa");
        std::fs::create_dir_all(pki.join("rejected")).unwrap();
        std::fs::write(pki.join("rejected").join("server.der"), cert.der()).unwrap();
        let sorgenti = vec!["pressa".to_string()];
        let inv = inventario(&Cartelle {
            config: &config,
            progetto: Some(&progetto),
            sorgenti_opcua: &sorgenti,
            viewer: &t.path().join("viewer-assente"),
            pki_server: &t.path().join("pki-assente"),
            home: None,
        });
        assert_eq!(inv.tls.as_ref().map(|d| d.impronta.clone()), Some(d.impronta.clone()));
        assert_eq!(inv.dispositivi.righe.len(), 2, "le righe morte si vedono (decisione 8)");
        assert!(inv.mqtt.righe.is_empty());
        assert!(!inv.viewer_lvgl.disponibile, "senza la cartella del viewer: non disponibile, non vuoto");
        assert_eq!(inv.opcua_client[0].certificati[0].stato, "rejected");
        assert!(inv.opcua_client[0].certificati[0].dettagli.is_some());
        assert_eq!(inv.opcua_server, None);
    }

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
