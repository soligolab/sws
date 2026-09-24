//! L'immagine di boot dal progetto al dispositivo (T-72 F5).
//!
//! Il progetto dichiara quale pagina di boot è «abilitata»
//! (`page_layout.boot_page_id`) e il browser ne ha già prodotto il PNG
//! (`boot/<nome>.png`, F4). Qui il runtime **dice all'host cosa vuole**, con lo
//! stesso schema di `display_target`: il runtime gira in un container rootless e
//! non può parlare col D-Bus dell'host, dove vive il launcher Pixsys; scrive
//! una richiesta in un file del volume condiviso, e un pezzo lato host
//! (`deploy/container/sws-boot-image-apply.sh`) la applica.
//!
//! ```text
//! <config_dir>/boot-image/boot.png   il PNG da installare
//! <config_dir>/boot-image/trigger    lo SHA-256 del PNG, oppure `none`
//! <config_dir>/boot-image/status     scritto dall'HOST: com'è andata
//! ```
//!
//! Una cartella e non due file accanto (`boot-image` + `boot-image.png`): il
//! trigger e la cartella non possono avere lo stesso nome, e il piano del
//! 18-09 li chiamava tutti e due `boot-image`.
//!
//! ## Cosa NON fa
//!
//! - Non tocca l'immagine se il progetto non abilita nessuna pagina: `none` non
//!   è «ripristina l'originale», è «non ho niente da installare». Il ripristino
//!   di fabbrica (`ResetBackgroundImage`) sarà un'azione esplicita.
//! - Non sa se il dispositivo è un Pixsys. Lo sa lo script host, che prova una
//!   lettura D-Bus e scrive `non_supportato` se non risponde.
//! - Non riscrive un contenuto identico: il trigger fa scattare un'unit
//!   systemd, e scatterebbe a ogni salvataggio di una qualunque sezione.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const DIR: &str = "boot-image";
pub const PNG: &str = "boot.png";
pub const TRIGGER: &str = "trigger";
pub const STATO: &str = "status";
/// Valore del trigger quando il progetto non abilita nessuna immagine.
pub const NESSUNA: &str = "none";

pub fn dir_at(config_dir: &Path) -> PathBuf {
    config_dir.join(DIR)
}

/// SHA-256 esadecimale.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .fold(String::new(), |mut s, b| {
            s.push_str(&format!("{b:02x}"));
            s
        })
}

/// Il PNG della pagina di boot abilitata dal progetto, se c'è. `None` in tutti
/// i casi in cui non c'è niente da installare: nessuna pagina abilitata, il
/// puntatore indica una pagina che non esiste più, la pagina non ha ancora un
/// PNG (si crea al salvataggio dall'IDE).
pub async fn png_abilitato(project_dir: &Path) -> Option<Vec<u8>> {
    let project = sws_core::project::Project::load(project_dir).ok()?;
    let id = project.page_layout.as_ref()?.boot_page_id.clone()?;
    for nome in crate::boot::elenca(project_dir).await {
        let yaml = tokio::fs::read_to_string(
            crate::boot::boot_dir_at(project_dir).join(format!("{nome}.yaml")),
        )
        .await
        .ok()?;
        let Ok(pagina) = serde_yaml::from_str::<crate::synoptic::SynopticPage>(&yaml) else {
            continue;
        };
        if pagina.id == id {
            return tokio::fs::read(
                crate::boot::boot_dir_at(project_dir).join(format!("{nome}.png")),
            )
            .await
            .ok();
        }
    }
    None
}

/// Scrive `contenuto` in `path` solo se è diverso da quello che c'è. `true` se
/// ha scritto.
async fn scrivi_se_diverso(path: &Path, contenuto: &[u8]) -> std::io::Result<bool> {
    if let Ok(attuale) = tokio::fs::read(path).await {
        if attuale == contenuto {
            return Ok(false);
        }
    }
    if let Some(p) = path.parent() {
        tokio::fs::create_dir_all(p).await?;
    }
    crate::router::scrivi_atomico(path, contenuto).await?;
    Ok(true)
}

/// Pubblica la richiesta per l'host. Gli errori si registrano e basta: un
/// progetto che non si legge o una directory non scrivibile non devono far
/// fallire il salvataggio che ha provocato la chiamata.
pub async fn publish(config_dir: &Path, project_dir: &Path) {
    let dir = dir_at(config_dir);
    let esito = async {
        match png_abilitato(project_dir).await {
            Some(png) => {
                let sha = sha256_hex(&png);
                // Prima il PNG, poi il trigger: l'host, che scatta sul trigger,
                // deve trovare il file già al suo posto.
                scrivi_se_diverso(&dir.join(PNG), &png).await?;
                let scritto = scrivi_se_diverso(&dir.join(TRIGGER), format!("{sha}\n").as_bytes()).await?;
                if scritto {
                    tracing::info!(sha256 = %sha, bytes = png.len(), "boot-image: richiesta pubblicata");
                    // Dal 24-09-2026 la chiamata al launcher la fa il runtime,
                    // via D-Bus, da dentro il container: il `trigger` qui sopra
                    // resta per i dispositivi che hanno ancora le unit
                    // sull'host, ma su un container col socket montato non lo
                    // aspetta più nessuno.
                    applica_col_launcher(config_dir, &dir.join(PNG), &sha).await;
                }
            }
            None => {
                if scrivi_se_diverso(&dir.join(TRIGGER), format!("{NESSUNA}\n").as_bytes()).await? {
                    tracing::info!("boot-image: nessuna immagine abilitata");
                }
            }
        }
        Ok::<(), std::io::Error>(())
    }
    .await;
    if let Err(e) = esito {
        tracing::warn!(dir = %dir.display(), "boot-image: richiesta non pubblicata: {e}");
    }
}

/// Chiede al launcher di usare il PNG appena pubblicato, e scrive l'esito in
/// `status` — lo stesso file che prima scriveva lo script sull'host, così la
/// scheda Runtime continua a leggere da un posto solo.
///
/// Silenziosa quando il launcher non c'è: un PC di sviluppo non ha un
/// `net.pixsys.Config1`, e non è un guasto del progetto.
async fn applica_col_launcher(config_dir: &Path, png: &Path, sha: &str) {
    let Some(host) = crate::launcher_dbus::percorso_host(config_dir, png) else {
        tracing::debug!("boot-image: SWS_HOST_CONFIG_DIR non impostata, non chiamo il launcher");
        return;
    };
    let esito = crate::launcher_dbus::imposta_immagine(&host).await;
    let (parola, nota) = match &esito {
        crate::launcher_dbus::Esito::Applicata { percorso_assoluto } => (
            "applicata",
            if *percorso_assoluto {
                "compare al prossimo avvio del pannello (percorso assoluto: si appoggia a un \
                 comportamento non documentato del launcher)"
            } else {
                "compare al prossimo avvio del pannello"
            }
            .to_string(),
        ),
        crate::launcher_dbus::Esito::NonSupportato => (
            "non_supportato",
            "questo dispositivo non espone net.pixsys.Config1.Launcher".to_string(),
        ),
        crate::launcher_dbus::Esito::PercorsoHostIgnoto => (
            "errore",
            "manca SWS_HOST_CONFIG_DIR: il container non sa il percorso sull'host".to_string(),
        ),
        crate::launcher_dbus::Esito::Errore(e) => ("errore", e.clone()),
    };
    tracing::info!(esito = parola, "boot-image: {nota}");
    let testo = format!("esito={parola}\nsha256={sha}\nnota={nota}\n");
    let path = dir_at(config_dir).join(STATO);
    if let Err(e) = tokio::fs::write(&path, testo).await {
        tracing::warn!(path = %path.display(), "boot-image: status non scritto: {e}");
    }
}

/// Com'è andata sull'host, come lo riferisce lo script (`status`), più cosa è
/// stato chiesto (`trigger`). È il **primo file scritto dall'host che il
/// runtime legge**.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct BootImageStato {
    /// `installato`, `non_supportato`, `nessuna_immagine`, `errore`.
    pub esito: String,
    pub sha256: Option<String>,
    pub quando: Option<String>,
    /// `relativo` o `assoluto`: la seconda si appoggia a un comportamento del
    /// launcher che non è documentato (`PathBuf::push` con un percorso
    /// assoluto), e se Pixsys lo corregge smette di funzionare.
    pub percorso: Option<String>,
    pub messaggio: Option<String>,
    /// Lo SHA-256 (o `none`) che il runtime ha chiesto per ultimo. Se diverso da
    /// `sha256`, l'host non ha ancora applicato l'ultima richiesta.
    pub richiesta: Option<String>,
}

/// Legge un file `chiave=valore`, una per riga. `None` se manca `esito`.
pub fn parse_stato(testo: &str) -> Option<BootImageStato> {
    let mut s = BootImageStato::default();
    for riga in testo.lines() {
        let Some((k, v)) = riga.split_once('=') else {
            continue;
        };
        let v = v.trim().to_string();
        let v = if v.is_empty() { None } else { Some(v) };
        match k.trim() {
            "esito" => s.esito = v.unwrap_or_default(),
            "sha256" => s.sha256 = v,
            "quando" => s.quando = v,
            "percorso" => s.percorso = v,
            "messaggio" => s.messaggio = v,
            _ => {}
        }
    }
    if s.esito.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Lo stato per `/api/system`. `None` = nessun dato (l'host non ha mai scritto
/// niente: dispositivo senza le unit, o non ancora scattate) — mai un errore.
pub async fn leggi_stato(config_dir: &Path) -> Option<BootImageStato> {
    let dir = dir_at(config_dir);
    let mut s = parse_stato(&tokio::fs::read_to_string(dir.join(STATO)).await.ok()?)?;
    s.richiesta = tokio::fs::read_to_string(dir.join(TRIGGER))
        .await
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    Some(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::boot;

    const PNG_FINTO: &[u8] = b"\x89PNG\r\n\x1a\nfinto";

    fn progetto(dir: &Path, boot_page_id: Option<&str>) {
        let layout = match boot_page_id {
            Some(id) => format!("page_layout:\n  size_mode: fixed\n  boot_page_id: {id}\n"),
            None => String::new(),
        };
        std::fs::write(
            dir.join("project.yaml"),
            format!("meta:\n  name: t\n  version: 0.1.0\n{layout}"),
        )
        .unwrap();
    }

    async fn pagina_con_png(dir: &Path, nome: &str, id: &str, png: Option<&[u8]>) {
        let mut p = boot::pagina_di_boot_iniziale();
        p.id = id.to_string();
        p.name = nome.to_string();
        boot::salva(dir, nome, &p, None).await.unwrap();
        if let Some(b) = png {
            boot::scrivi_png(dir, nome, b).await.unwrap();
        }
    }

    fn trigger(cfg: &Path) -> String {
        std::fs::read_to_string(dir_at(cfg).join(TRIGGER)).unwrap()
    }

    #[tokio::test]
    async fn una_pagina_abilitata_con_png_pubblica_il_png_e_il_suo_sha() {
        let (prj, cfg) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        progetto(prj.path(), Some("b1"));
        pagina_con_png(prj.path(), "Splash", "b1", Some(PNG_FINTO)).await;
        publish(cfg.path(), prj.path()).await;
        assert_eq!(trigger(cfg.path()).trim(), sha256_hex(PNG_FINTO));
        assert_eq!(
            std::fs::read(dir_at(cfg.path()).join(PNG)).unwrap(),
            PNG_FINTO
        );
    }

    #[tokio::test]
    async fn nessuna_pagina_abilitata_scrive_none_e_non_tocca_il_png_precedente() {
        let (prj, cfg) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        progetto(prj.path(), None);
        publish(cfg.path(), prj.path()).await;
        assert_eq!(trigger(cfg.path()).trim(), NESSUNA);
        assert!(!dir_at(cfg.path()).join(PNG).exists());
    }

    #[tokio::test]
    async fn il_puntatore_a_una_pagina_che_non_esiste_piu_non_installa_niente() {
        let (prj, cfg) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        progetto(prj.path(), Some("fantasma"));
        pagina_con_png(prj.path(), "Splash", "b1", Some(PNG_FINTO)).await;
        publish(cfg.path(), prj.path()).await;
        assert_eq!(trigger(cfg.path()).trim(), NESSUNA);
    }

    #[tokio::test]
    async fn una_pagina_abilitata_senza_png_non_installa_niente() {
        let (prj, cfg) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        progetto(prj.path(), Some("b1"));
        pagina_con_png(prj.path(), "Splash", "b1", None).await;
        publish(cfg.path(), prj.path()).await;
        assert_eq!(trigger(cfg.path()).trim(), NESSUNA);
    }

    #[tokio::test]
    async fn una_richiesta_identica_non_riscrive_il_trigger() {
        // Il trigger fa scattare un'unit systemd: riscriverlo a ogni salvataggio
        // la farebbe girare a ogni salvataggio.
        let (prj, cfg) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        progetto(prj.path(), Some("b1"));
        pagina_con_png(prj.path(), "Splash", "b1", Some(PNG_FINTO)).await;
        publish(cfg.path(), prj.path()).await;
        let path = dir_at(cfg.path()).join(TRIGGER);
        let prima = std::fs::metadata(&path).unwrap().modified().unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        publish(cfg.path(), prj.path()).await;
        assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), prima);
    }

    #[tokio::test]
    async fn cambiare_il_png_cambia_il_trigger() {
        let (prj, cfg) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        progetto(prj.path(), Some("b1"));
        pagina_con_png(prj.path(), "Splash", "b1", Some(PNG_FINTO)).await;
        publish(cfg.path(), prj.path()).await;
        let prima = trigger(cfg.path());
        boot::scrivi_png(prj.path(), "Splash", b"\x89PNG\r\n\x1a\naltro")
            .await
            .unwrap();
        publish(cfg.path(), prj.path()).await;
        assert_ne!(trigger(cfg.path()), prima);
    }

    #[test]
    fn lo_stato_dell_host_si_legge_e_manca_esito_e_nessun_dato() {
        let s = parse_stato(
            "esito=installato\nsha256=abc\nquando=2026-09-19T18:30:00Z\npercorso=assoluto\nmessaggio=\n",
        )
        .unwrap();
        assert_eq!(s.esito, "installato");
        assert_eq!(s.percorso.as_deref(), Some("assoluto"));
        assert_eq!(s.messaggio, None);
        assert_eq!(parse_stato("sha256=abc\n"), None);
        assert_eq!(parse_stato(""), None);
    }

    #[tokio::test]
    async fn lo_stato_riporta_anche_cosa_e_stato_chiesto() {
        let cfg = tempfile::tempdir().unwrap();
        assert_eq!(leggi_stato(cfg.path()).await, None);
        let d = dir_at(cfg.path());
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(STATO), "esito=installato\nsha256=aaa\n").unwrap();
        std::fs::write(d.join(TRIGGER), "bbb\n").unwrap();
        let s = leggi_stato(cfg.path()).await.unwrap();
        assert_eq!(s.sha256.as_deref(), Some("aaa"));
        assert_eq!(s.richiesta.as_deref(), Some("bbb"));
    }
}
