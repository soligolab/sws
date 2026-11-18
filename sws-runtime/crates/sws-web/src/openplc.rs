//! OpenPLC sul pannello, installato dall'IDE (30-10-2026).
//!
//! Il piano `docs/archive/2026-10-20-openplc-sul-dispositivo.md` lo voleva
//! opzionale: si installa solo se qualcuno lo chiede. Fino a oggi chiederlo
//! voleva dire SSH e una flag dell'installer; da qui c'è un bottone, nella
//! stessa pagina dell'IDE dove sta «Configurazione del servizio».
//!
//! Funziona come [`crate::quadlet::aggiorna`]: il runtime copia l'installer
//! nella cartella config (montata, e visibile dall'host) e lo fa girare con un
//! **servizio transitorio dell'utente**, qui con `--solo-openplc`. Non tocca
//! SWS, quindi a differenza dei quadlet niente si riavvia. L'esito lo scrive
//! l'installer in [`FILE_ESITO`], che il runtime legge e l'IDE mostra.
//!
//! Il container di OpenPLC lo avvia `podman-restart.service`, non il servizio
//! transitorio: conmon finirebbe dentro quel servizio, e systemd lo
//! ucciderebbe quando finisce (trovato nel progetto GitPixsys/openplc).

use serde::{Deserialize, Serialize};
use std::path::Path;

const FILE_ESITO: &str = "openplc-esito.json";
/// Un «in corso» più vecchio di così è un'installazione morta per strada: il
/// download da 1 GB sul WP630 sta sotto i cinque minuti.
const SCADENZA_MS: i64 = 30 * 60 * 1000;
/// The REST API port of OpenPLC. The installer publishes it, like the other
/// OpenPLC ports, on every interface of the host (`podman create -p 8443:8443 …`
/// in `install-container.sh`): it is this runtime that calls it on 127.0.0.1.
const PORTA_API: u16 = 8443;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Esito {
    /// `in_corso`, `riuscito`, `non_riuscito`.
    pub esito: String,
    #[serde(default)]
    pub messaggio: String,
    pub quando_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Stato {
    /// L'API di OpenPLC risponde sulla 127.0.0.1 del pannello. Il runtime è in
    /// rete host, quindi la vede; in rete bridge no, e resta `false`.
    pub risponde: bool,
    /// Si può installare da qui: bus utente e cartella config dell'host noti.
    pub si_puo_installare: bool,
    pub ultimo_esito: Option<Esito>,
}

/// Un «in corso» scaduto diventa «non riuscito»: l'installer non è arrivato a
/// scrivere niente, e lasciarlo «in corso» per sempre terrebbe il bottone
/// spento.
pub fn normalizza(mut e: Esito, adesso_ms: i64) -> Esito {
    if e.esito == "in_corso" && adesso_ms - e.quando_ms > SCADENZA_MS {
        e.esito = "non_riuscito".into();
        e.messaggio = "L'installazione non ha mai finito: riprovare.".into();
    }
    e
}

async fn leggi_esito(config_dir: &Path) -> Option<Esito> {
    let t = tokio::fs::read_to_string(config_dir.join(FILE_ESITO))
        .await
        .ok()?;
    let e: Esito = serde_json::from_str(&t).ok()?;
    Some(normalizza(e, chrono::Utc::now().timestamp_millis()))
}

async fn scrivi_esito(config_dir: &Path, e: &Esito) {
    if let Ok(t) = serde_json::to_string(e) {
        let _ = tokio::fs::write(config_dir.join(FILE_ESITO), t).await;
    }
}

async fn risponde() -> bool {
    let c = tokio::net::TcpStream::connect(("127.0.0.1", PORTA_API));
    matches!(
        tokio::time::timeout(std::time::Duration::from_millis(500), c).await,
        Ok(Ok(_))
    )
}

/// `None` fuori da un pannello in container: niente da installare.
pub async fn stato(config_dir: &Path) -> Option<Stato> {
    crate::quadlet::versione_attesa().await?;
    let bus = zbus::Connection::session().await.is_ok();
    Some(Stato {
        risponde: risponde().await,
        si_puo_installare: bus && crate::quadlet::host_config().is_some(),
        ultimo_esito: leggi_esito(config_dir).await,
    })
}

/// Il comando del servizio transitorio, coi percorsi dell'host. `--data` è la
/// cartella sopra la config: l'installer scrive lì l'esito, e mette i dati di
/// OpenPLC accanto (`/data/user/openplc`).
pub fn comando(host_config: &str) -> Vec<String> {
    let config = host_config.trim_end_matches('/');
    let dati = Path::new(config)
        .parent()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "/data/user/sws".into());
    vec![
        "/bin/bash".into(),
        format!(
            "{config}/{}/install-container.sh",
            crate::quadlet::DIR_COPIA
        ),
        "--solo-openplc".into(),
        "--data".into(),
        dati,
    ]
}

/// Lancia l'installazione e torna subito: il download dura minuti.
pub async fn installa(config_dir: &Path) -> Result<(), String> {
    let st = stato(config_dir)
        .await
        .ok_or("Non è un pannello: OpenPLC si installa solo sul dispositivo.")?;
    if !st.si_puo_installare {
        return Err(
            "Questo pannello non sa installare da sé: serve la reinstallazione dall'IDE \
                    (Device → Installazione, «Installa anche OpenPLC»)."
                .into(),
        );
    }
    if st
        .ultimo_esito
        .as_ref()
        .is_some_and(|e| e.esito == "in_corso")
    {
        return Err("Un'installazione di OpenPLC è già in corso.".into());
    }
    let host = crate::quadlet::host_config().ok_or("SWS_HOST_CONFIG_DIR assente")?;
    let copia = config_dir.join(crate::quadlet::DIR_COPIA);
    tokio::fs::create_dir_all(&copia)
        .await
        .map_err(|e| format!("{}: {e}", copia.display()))?;
    tokio::fs::copy(
        Path::new(crate::quadlet::DIR_IMMAGINE).join("install-container.sh"),
        copia.join("install-container.sh"),
    )
    .await
    .map_err(|e| format!("copia dell'installer: {e}"))?;
    let utente = zbus::Connection::session()
        .await
        .map_err(|e| format!("bus utente: {e}"))?;
    let adesso = chrono::Utc::now().timestamp_millis();
    scrivi_esito(
        config_dir,
        &Esito {
            esito: "in_corso".into(),
            messaggio: "Scarico e avvio OpenPLC Runtime".into(),
            quando_ms: adesso,
        },
    )
    .await;
    let nome = format!("sws-openplc-installa-{}.service", adesso / 1000);
    let r = crate::display_target::bus::avvia_transitorio(
        &utente,
        &nome,
        "SWS: installazione di OpenPLC",
        &comando(&host),
    )
    .await;
    if let Err(e) = &r {
        scrivi_esito(
            config_dir,
            &Esito {
                esito: "non_riuscito".into(),
                messaggio: e.clone(),
                quando_ms: adesso,
            },
        )
        .await;
    }
    r
}

// ── The Editor's user (18-11-2026, decision D20 of the CRA sessions) ────────

/// What the installation knows of the Editor's user: written by
/// `install-container.sh` when it creates it, or by [`ensure_editor_user`] on a
/// panel installed before. `{"known": false}` when OpenPLC already had a user
/// made from the Editor: the password is not known here.
pub const CREDENTIALS_FILE: &str = "openplc-credentials.json";

/// The ports the installer publishes (`podman create -p …`), for the control
/// panel. Inside the container they are the standard ones.
pub const PORTS: [(&str, u16); 5] = [
    ("editor", 8443),
    ("modbus", 1502),
    ("s7", 10102),
    ("opcua", 14840),
    ("discovery", 33333),
];

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Credentials {
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default = "known_default")]
    pub known: bool,
    /// A user the installation did not create was already there on a fresh
    /// container: someone made it from the network in the first seconds.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub foreign: bool,
}

fn known_default() -> bool {
    true
}

pub fn read_credentials(config_dir: &Path) -> Option<Credentials> {
    let t = std::fs::read_to_string(config_dir.join(CREDENTIALS_FILE)).ok()?;
    let mut c: Credentials = serde_json::from_str(&t).ok()?;
    if c.username.is_none() || c.password.is_none() {
        c.known = false;
    }
    Some(c)
}

fn write_credentials(config_dir: &Path, c: &Credentials) -> std::io::Result<()> {
    use std::io::Write as _;
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt as _;
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    o.mode(0o600);
    let mut f = o.open(config_dir.join(CREDENTIALS_FILE))?;
    f.write_all(serde_json::to_string(c).unwrap_or_default().as_bytes())
}

/// OpenPLC is installed on this device: the installer finished, or it left
/// the Editor's credentials. Not «port 8443 answers»: on a development machine
/// that port can be something else.
pub fn installed(config_dir: &Path) -> bool {
    config_dir.join(CREDENTIALS_FILE).exists()
        || std::fs::read_to_string(config_dir.join(FILE_ESITO))
            .ok()
            .and_then(|t| serde_json::from_str::<Esito>(&t).ok())
            .is_some_and(|e| e.esito == "riuscito")
}

/// A client for OpenPLC's API on 127.0.0.1:8443. Its certificate is the one
/// OpenPLC makes for itself at the first start: nothing to check it against,
/// and the connection never leaves the device.
fn local_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()
}

/// What `POST /api/create-user` answered.
#[derive(Debug, PartialEq)]
pub enum CreateAnswer {
    Created,
    /// OpenPLC already has a user: only an Admin of OpenPLC can add one.
    AlreadyHasUser,
    Failed(String),
}

pub fn create_answer(status: u16) -> CreateAnswer {
    match status {
        201 => CreateAnswer::Created,
        401 => CreateAnswer::AlreadyHasUser,
        s => CreateAnswer::Failed(format!("HTTP {s}")),
    }
}

/// On a panel where OpenPLC was installed before 18-11-2026, the Editor's
/// user may still be missing: the first one to connect would create it. From a
/// minute after the start, the runtime creates it the way the installer does
/// now, trying once a minute for ten minutes while OpenPLC comes up. Nothing
/// where OpenPLC is not installed, or the file is already there.
pub async fn ensure_editor_user(config_dir: &Path) {
    for _ in 0..10 {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        if !installed(config_dir) || config_dir.join(CREDENTIALS_FILE).exists() {
            return;
        }
        if risponde().await {
            create_editor_user(config_dir).await;
            return;
        }
    }
}

async fn create_editor_user(config_dir: &Path) {
    let Some(client) = local_client() else {
        return;
    };
    let password = crate::control_panel::proposed_password();
    let status = client
        .post(format!("https://127.0.0.1:{PORTA_API}/api/create-user"))
        .json(&serde_json::json!({ "username": "admin", "password": password }))
        .send()
        .await
        .map(|r| r.status().as_u16());
    let credentials = match status.map(create_answer) {
        Ok(CreateAnswer::Created) => {
            tracing::info!(
                "OpenPLC: the Editor's user created, its password is in the control panel"
            );
            Credentials {
                username: Some("admin".into()),
                password: Some(password),
                known: true,
                foreign: false,
            }
        }
        Ok(CreateAnswer::AlreadyHasUser) => Credentials {
            known: false,
            ..Default::default()
        },
        Ok(CreateAnswer::Failed(e)) => {
            tracing::warn!("OpenPLC: the Editor's user not created: {e}");
            return;
        }
        Err(e) => {
            tracing::warn!("OpenPLC: the Editor's user not created: {e}");
            return;
        }
    };
    if let Err(e) = write_credentials(config_dir, &credentials) {
        tracing::warn!("OpenPLC: credentials not written: {e}");
    }
}

/// `GET /api/control-panel/openplc`: what the control panel shows, behind the
/// service PIN. The password included: it is there to be read by whoever
/// connects the Editor (decision of the maintainer, 18-11-2026).
pub async fn panel_view(config_dir: &Path) -> serde_json::Value {
    let answers = risponde().await;
    let version = if answers {
        match local_client() {
            Some(c) => match c
                .get(format!("https://127.0.0.1:{PORTA_API}/api/version"))
                .send()
                .await
            {
                Ok(r) => r
                    .json::<serde_json::Value>()
                    .await
                    .ok()
                    .and_then(|v| v.get("version")?.as_str().map(str::to_string)),
                Err(_) => None,
            },
            None => None,
        }
    } else {
        None
    };
    let credentials = read_credentials(config_dir);
    serde_json::json!({
        "installed": installed(config_dir),
        "answers": answers,
        "version": version,
        "credentials": credentials.as_ref().filter(|c| c.known).map(|c| serde_json::json!({
            "username": c.username,
            "password": c.password,
        })),
        "credentials_unknown": credentials.as_ref().is_some_and(|c| !c.known),
        "credentials_foreign": credentials.is_some_and(|c| c.foreign),
        "ports": PORTS.iter().map(|(k, v)| ((*k).to_string(), serde_json::json!(v))).collect::<serde_json::Map<_, _>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_credentials_file_says_what_is_known() {
        let d = tempfile::tempdir().unwrap();
        assert!(read_credentials(d.path()).is_none());
        assert!(!installed(d.path()));
        // As the installer writes it.
        std::fs::write(
            d.path().join(CREDENTIALS_FILE),
            r#"{"username": "admin", "password": "abc2345def", "created_ms": 1000}"#,
        )
        .unwrap();
        let c = read_credentials(d.path()).unwrap();
        assert!(c.known);
        assert_eq!(c.password.as_deref(), Some("abc2345def"));
        assert!(installed(d.path()));
        std::fs::write(d.path().join(CREDENTIALS_FILE), r#"{"known": false}"#).unwrap();
        assert!(!read_credentials(d.path()).unwrap().known);
        std::fs::write(
            d.path().join(CREDENTIALS_FILE),
            r#"{"known": false, "foreign": true}"#,
        )
        .unwrap();
        assert!(read_credentials(d.path()).unwrap().foreign);
    }

    #[test]
    fn written_credentials_are_private_and_read_back() {
        let d = tempfile::tempdir().unwrap();
        let c = Credentials {
            username: Some("admin".into()),
            password: Some("abc2345def".into()),
            known: true,
            foreign: false,
        };
        write_credentials(d.path(), &c).unwrap();
        assert_eq!(read_credentials(d.path()), Some(c));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(d.path().join(CREDENTIALS_FILE))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o077, 0, "{mode:o}");
        }
    }

    #[test]
    fn the_create_answer_of_openplc() {
        assert_eq!(create_answer(201), CreateAnswer::Created);
        assert_eq!(create_answer(401), CreateAnswer::AlreadyHasUser);
        assert!(matches!(create_answer(500), CreateAnswer::Failed(_)));
    }

    #[test]
    fn installed_after_a_successful_install() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            d.path().join(FILE_ESITO),
            r#"{"esito": "riuscito", "messaggio": "", "quando_ms": 1}"#,
        )
        .unwrap();
        assert!(installed(d.path()));
    }

    #[test]
    fn il_comando_passa_la_cartella_dati_dell_host() {
        let c = comando("/data/user/sws/config/");
        assert_eq!(
            c[1],
            "/data/user/sws/config/quadlet-nuovo/install-container.sh"
        );
        assert_eq!(&c[2..], ["--solo-openplc", "--data", "/data/user/sws"]);
    }

    #[test]
    fn un_in_corso_scaduto_diventa_non_riuscito() {
        let e = Esito {
            esito: "in_corso".into(),
            messaggio: String::new(),
            quando_ms: 0,
        };
        assert_eq!(normalizza(e.clone(), 60_000).esito, "in_corso");
        assert_eq!(normalizza(e, SCADENZA_MS + 1).esito, "non_riuscito");
    }

    /// L'esito si legge come lo scrive l'installer, che lo compone a mano.
    #[test]
    fn l_esito_si_legge_come_lo_scrive_l_installer() {
        let e: Esito = serde_json::from_str(
            r#"{"esito": "riuscito", "messaggio": "", "quando_ms": 1793370652000}"#,
        )
        .unwrap();
        assert_eq!(e.esito, "riuscito");
        let inst = include_str!("../../../../deploy/container/install-container.sh");
        assert!(
            inst.contains(FILE_ESITO),
            "l'installer non scrive più {FILE_ESITO}"
        );
        assert!(
            inst.contains("--solo-openplc)"),
            "l'installer non accetta più --solo-openplc"
        );
    }
}
