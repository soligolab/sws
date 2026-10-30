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
/// Le porte che l'installer pubblica, solo su 127.0.0.1.
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
    let t = tokio::fs::read_to_string(config_dir.join(FILE_ESITO)).await.ok()?;
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
    matches!(tokio::time::timeout(std::time::Duration::from_millis(500), c).await, Ok(Ok(_)))
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
    let dati = Path::new(config).parent().map(|p| p.display().to_string()).unwrap_or_else(|| "/data/user/sws".into());
    vec![
        "/bin/bash".into(),
        format!("{config}/{}/install-container.sh", crate::quadlet::DIR_COPIA),
        "--solo-openplc".into(),
        "--data".into(),
        dati,
    ]
}

/// Lancia l'installazione e torna subito: il download dura minuti.
pub async fn installa(config_dir: &Path) -> Result<(), String> {
    let st = stato(config_dir).await.ok_or("Non è un pannello: OpenPLC si installa solo sul dispositivo.")?;
    if !st.si_puo_installare {
        return Err("Questo pannello non sa installare da sé: serve la reinstallazione dall'IDE \
                    (Istanza → Device → Installazione, «Installa anche OpenPLC»)."
            .into());
    }
    if st.ultimo_esito.as_ref().is_some_and(|e| e.esito == "in_corso") {
        return Err("Un'installazione di OpenPLC è già in corso.".into());
    }
    let host = crate::quadlet::host_config().ok_or("SWS_HOST_CONFIG_DIR assente")?;
    let copia = config_dir.join(crate::quadlet::DIR_COPIA);
    tokio::fs::create_dir_all(&copia).await.map_err(|e| format!("{}: {e}", copia.display()))?;
    tokio::fs::copy(
        Path::new(crate::quadlet::DIR_IMMAGINE).join("install-container.sh"),
        copia.join("install-container.sh"),
    )
    .await
    .map_err(|e| format!("copia dell'installer: {e}"))?;
    let utente = zbus::Connection::session().await.map_err(|e| format!("bus utente: {e}"))?;
    let adesso = chrono::Utc::now().timestamp_millis();
    scrivi_esito(
        config_dir,
        &Esito { esito: "in_corso".into(), messaggio: "Scarico e avvio OpenPLC Runtime".into(), quando_ms: adesso },
    )
    .await;
    let nome = format!("sws-openplc-installa-{}.service", adesso / 1000);
    let r = crate::display_target::bus::avvia_transitorio(&utente, &nome, "SWS: installazione di OpenPLC", &comando(&host))
        .await;
    if let Err(e) = &r {
        scrivi_esito(config_dir, &Esito { esito: "non_riuscito".into(), messaggio: e.clone(), quando_ms: adesso }).await;
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn il_comando_passa_la_cartella_dati_dell_host() {
        let c = comando("/data/user/sws/config/");
        assert_eq!(c[1], "/data/user/sws/config/quadlet-nuovo/install-container.sh");
        assert_eq!(&c[2..], ["--solo-openplc", "--data", "/data/user/sws"]);
    }

    #[test]
    fn un_in_corso_scaduto_diventa_non_riuscito() {
        let e = Esito { esito: "in_corso".into(), messaggio: String::new(), quando_ms: 0 };
        assert_eq!(normalizza(e.clone(), 60_000).esito, "in_corso");
        assert_eq!(normalizza(e, SCADENZA_MS + 1).esito, "non_riuscito");
    }

    /// L'esito si legge come lo scrive l'installer, che lo compone a mano.
    #[test]
    fn l_esito_si_legge_come_lo_scrive_l_installer() {
        let e: Esito =
            serde_json::from_str(r#"{"esito": "riuscito", "messaggio": "", "quando_ms": 1793370652000}"#).unwrap();
        assert_eq!(e.esito, "riuscito");
        let inst = include_str!("../../../../deploy/container/install-container.sh");
        assert!(inst.contains(FILE_ESITO), "l'installer non scrive più {FILE_ESITO}");
        assert!(inst.contains("--solo-openplc)"), "l'installer non accetta più --solo-openplc");
    }
}
