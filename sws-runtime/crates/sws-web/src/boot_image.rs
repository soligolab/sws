//! L'immagine di boot dal progetto al dispositivo (T-72 F5).
//!
//! Il progetto dichiara quale pagina di boot è «abilitata»
//! (`page_layout.boot_page_id`) e il browser ne ha già prodotto il PNG
//! (`boot/<nome>.png`, F4). Qui il runtime lo copia nella sua config e chiede
//! al launcher Pixsys di usarlo, **via D-Bus, da dentro il container**
//! (`launcher_dbus.rs`, dal 24-09-2026).
//!
//! ```text
//! <config_dir>/boot-image/boot.png   il PNG pubblicato (il launcher lo copia)
//! <config_dir>/boot-image/status     com'è andata: letto da /api/system
//! ```
//!
//! **Una strada sola dal 27-09-2026.** Fino ad allora c'era anche un file
//! `trigger` per uno script sull'host, già tolto il 24-09: il runtime lo
//! scriveva ancora e chiamava il launcher **solo quando il trigger cambiava**.
//! Un pannello con un trigger scritto e mai applicato (il TC620: PNG del 20-09,
//! launcher ancora su «Default») non recuperava più. Ora si chiama il launcher
//! finché `status` non dice `installato` con lo SHA di quel PNG.
//!
//! ## Cosa NON fa
//!
//! - Non tocca l'immagine se il progetto non abilita nessuna pagina: «nessuna
//!   immagine» non è «ripristina l'originale». Il ripristino di fabbrica è
//!   un'azione esplicita ([`ripristina_fabbrica`], pulsante nella scheda
//!   Runtime).
//! - Non richiama il launcher a ogni salvataggio: solo se il PNG è cambiato o
//!   se l'ultima volta non è andata.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const DIR: &str = "boot-image";
pub const PNG: &str = "boot.png";
pub const STATO: &str = "status";
/// Il file che il runtime scriveva fino al 27-09-2026 per lo script sull'host:
/// si toglie se c'è ancora, perché nessuno lo legge più.
const TRIGGER_VECCHIO: &str = "trigger";

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

/// Perché si pubblica: decide se un ripristino di fabbrica va rispettato.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Occasione {
    /// L'avvio del runtime, col progetto già aperto da prima. Un ripristino di
    /// fabbrica **resta**: il 27-09 sul TC620 il runtime, ripartendo, ha
    /// riapplicato l'immagine subito dopo che il maintainer l'aveva tolta.
    Avvio,
    /// Il progetto è cambiato (deploy, apertura, import, una pagina salvata):
    /// è la richiesta esplicita di usare l'immagine del progetto.
    Modifica,
}

/// Pubblica il PNG della pagina abilitata e chiede al launcher di usarlo. Gli
/// errori si registrano e basta: un progetto che non si legge o una directory
/// non scrivibile non devono far fallire il salvataggio che ha provocato la
/// chiamata.
pub async fn publish(config_dir: &Path, project_dir: &Path, occasione: Occasione) {
    let dir = dir_at(config_dir);
    let _ = tokio::fs::remove_file(dir.join(TRIGGER_VECCHIO)).await;
    let esito = async {
        match png_abilitato(project_dir).await {
            Some(png) => {
                let sha = sha256_hex(&png);
                let cambiato = scrivi_se_diverso(&dir.join(PNG), &png).await?;
                let attuale = leggi_file_stato(config_dir).await;
                if serve_applicare(attuale.as_ref(), &sha, cambiato, occasione) {
                    tracing::info!(sha256 = %sha, bytes = png.len(), cambiato, "boot-image: chiedo al launcher");
                    applica_col_launcher(config_dir, &dir.join(PNG), &sha).await;
                }
            }
            None => {
                if scrivi_se_diverso(&dir.join(STATO), b"esito=nessuna_immagine\n").await? {
                    tracing::info!("boot-image: nessuna immagine abilitata");
                }
            }
        }
        Ok::<(), std::io::Error>(())
    }
    .await;
    if let Err(e) = esito {
        tracing::warn!(dir = %dir.display(), "boot-image: non pubblicata: {e}");
    }
}

/// Il launcher va chiamato se il PNG è cambiato, oppure se non c'è ancora un
/// `installato` per **questo** SHA: prima volta, un errore l'ultima volta, un
/// ripristino di fabbrica, un pannello rimasto indietro (il TC620 del 27-09).
/// Non a ogni salvataggio: la chiamata riscrive il TOML del launcher.
///
/// All'**avvio**, un ripristino di fabbrica si rispetta finché il PNG è lo
/// stesso: dura fino al prossimo deploy, non fino al prossimo riavvio.
fn serve_applicare(
    attuale: Option<&BootImageStato>,
    sha: &str,
    png_cambiato: bool,
    occasione: Occasione,
) -> bool {
    if png_cambiato {
        return true;
    }
    if occasione == Occasione::Avvio && matches!(attuale, Some(s) if s.esito == "fabbrica") {
        return false;
    }
    !matches!(attuale, Some(s) if s.esito == "installato" && s.sha256.as_deref() == Some(sha))
}

/// Chiede al launcher di usare il PNG appena pubblicato, e scrive l'esito in
/// `status` con le chiavi che [`parse_stato`] legge.
///
/// Senza `SWS_HOST_CONFIG_DIR` non chiama e non scrive: un PC di sviluppo o
/// un'istanza IDE non hanno un launcher, e non è un guasto del progetto.
async fn applica_col_launcher(config_dir: &Path, png: &Path, sha: &str) {
    let Some(host) = crate::launcher_dbus::percorso_host(config_dir, png) else {
        tracing::debug!("boot-image: SWS_HOST_CONFIG_DIR non impostata, non chiamo il launcher");
        return;
    };
    let esito = crate::launcher_dbus::imposta_immagine(&host).await;
    let stato = match &esito {
        crate::launcher_dbus::Esito::Applicata { percorso_assoluto } => BootImageStato {
            esito: "installato".into(),
            sha256: Some(sha.to_string()),
            percorso: Some(if *percorso_assoluto { "assoluto" } else { "relativo" }.into()),
            ..Default::default()
        },
        crate::launcher_dbus::Esito::NonSupportato => BootImageStato {
            esito: "non_supportato".into(),
            messaggio: Some("questo dispositivo non espone net.pixsys.Config1.Launcher".into()),
            ..Default::default()
        },
        crate::launcher_dbus::Esito::PercorsoHostIgnoto => BootImageStato {
            esito: "errore".into(),
            messaggio: Some("manca SWS_HOST_CONFIG_DIR: il container non sa il percorso sull'host".into()),
            ..Default::default()
        },
        crate::launcher_dbus::Esito::Errore(e) => BootImageStato {
            esito: "errore".into(),
            sha256: Some(sha.to_string()),
            messaggio: Some(e.clone()),
            ..Default::default()
        },
    };
    tracing::info!(esito = %stato.esito, messaggio = ?stato.messaggio, "boot-image: risposta del launcher");
    scrivi_stato(config_dir, stato).await;
}

/// Torna all'immagine di fabbrica del pannello (`ResetBackgroundImage`) e
/// scrive `esito=fabbrica`. Il PNG pubblicato **resta**: toglierlo lo farebbe
/// risultare «cambiato» al prossimo avvio, che lo riapplicherebbe. Il prossimo
/// deploy lo reinstalla, perché `status` non dice più `installato`.
pub async fn ripristina_fabbrica(config_dir: &Path) -> Result<BootImageStato, String> {
    match crate::launcher_dbus::ripristina().await {
        crate::launcher_dbus::Esito::Applicata { .. } => {
            let stato = BootImageStato { esito: "fabbrica".into(), ..Default::default() };
            scrivi_stato(config_dir, stato).await;
            Ok(leggi_stato(config_dir).await.unwrap_or_default())
        }
        crate::launcher_dbus::Esito::NonSupportato => {
            Err("questo dispositivo non ha il launcher Pixsys: non c'è un'immagine di fabbrica da ripristinare".into())
        }
        crate::launcher_dbus::Esito::PercorsoHostIgnoto => Err("percorso host ignoto".into()),
        crate::launcher_dbus::Esito::Errore(e) => Err(e),
    }
}

async fn scrivi_stato(config_dir: &Path, mut stato: BootImageStato) {
    stato.quando = Some(ora_iso());
    let mut testo = format!("esito={}\n", stato.esito);
    for (k, v) in [
        ("sha256", &stato.sha256),
        ("quando", &stato.quando),
        ("percorso", &stato.percorso),
        ("messaggio", &stato.messaggio),
    ] {
        if let Some(v) = v {
            // Una riga per chiave: un a-capo nel messaggio del bus la spezzerebbe.
            testo.push_str(&format!("{k}={}\n", v.replace('\n', " ")));
        }
    }
    let path = dir_at(config_dir).join(STATO);
    if let Some(p) = path.parent() {
        let _ = tokio::fs::create_dir_all(p).await;
    }
    if let Err(e) = crate::router::scrivi_atomico(&path, testo.as_bytes()).await {
        tracing::warn!(path = %path.display(), "boot-image: status non scritto: {e}");
    }
}

fn ora_iso() -> String {
    let n = time::OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        n.year(),
        n.month() as u8,
        n.day(),
        n.hour(),
        n.minute(),
        n.second()
    )
}

/// Com'è andata col launcher (`status`), più lo SHA del PNG pubblicato adesso.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct BootImageStato {
    /// `installato`, `non_supportato`, `nessuna_immagine`, `fabbrica`, `errore`.
    pub esito: String,
    pub sha256: Option<String>,
    pub quando: Option<String>,
    /// `relativo` o `assoluto`: la seconda si appoggia a un comportamento del
    /// launcher che non è documentato (`PathBuf::push` con un percorso
    /// assoluto), e se Pixsys lo corregge smette di funzionare.
    pub percorso: Option<String>,
    pub messaggio: Option<String>,
    /// Lo SHA-256 del PNG pubblicato adesso. Se diverso da `sha256`, il
    /// launcher non ha ancora quello: la scheda dice «in attesa».
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

async fn leggi_file_stato(config_dir: &Path) -> Option<BootImageStato> {
    parse_stato(&tokio::fs::read_to_string(dir_at(config_dir).join(STATO)).await.ok()?)
}

/// Lo stato per `/api/system`. `None` = nessun dato (il runtime non ha ancora
/// chiesto niente al launcher) — mai un errore.
pub async fn leggi_stato(config_dir: &Path) -> Option<BootImageStato> {
    let mut s = leggi_file_stato(config_dir).await?;
    s.richiesta = tokio::fs::read(dir_at(config_dir).join(PNG))
        .await
        .ok()
        .map(|b| sha256_hex(&b));
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

    fn stato(cfg: &Path) -> Option<String> {
        std::fs::read_to_string(dir_at(cfg).join(STATO)).ok()
    }

    #[tokio::test]
    async fn una_pagina_abilitata_con_png_pubblica_il_png() {
        let (prj, cfg) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        progetto(prj.path(), Some("b1"));
        pagina_con_png(prj.path(), "Splash", "b1", Some(PNG_FINTO)).await;
        publish(cfg.path(), prj.path(), Occasione::Modifica).await;
        assert_eq!(std::fs::read(dir_at(cfg.path()).join(PNG)).unwrap(), PNG_FINTO);
        // Il file del meccanismo vecchio non si scrive più.
        assert!(!dir_at(cfg.path()).join(TRIGGER_VECCHIO).exists());
    }

    #[tokio::test]
    async fn il_trigger_rimasto_da_una_versione_vecchia_si_toglie() {
        let (prj, cfg) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let d = dir_at(cfg.path());
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(TRIGGER_VECCHIO), "abc\n").unwrap();
        progetto(prj.path(), None);
        publish(cfg.path(), prj.path(), Occasione::Modifica).await;
        assert!(!d.join(TRIGGER_VECCHIO).exists());
    }

    #[tokio::test]
    async fn nessuna_pagina_abilitata_lo_dice_e_non_scrive_png() {
        let (prj, cfg) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        progetto(prj.path(), None);
        publish(cfg.path(), prj.path(), Occasione::Modifica).await;
        assert_eq!(stato(cfg.path()).as_deref(), Some("esito=nessuna_immagine\n"));
        assert!(!dir_at(cfg.path()).join(PNG).exists());
    }

    #[tokio::test]
    async fn il_puntatore_a_una_pagina_che_non_esiste_piu_non_installa_niente() {
        let (prj, cfg) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        progetto(prj.path(), Some("fantasma"));
        pagina_con_png(prj.path(), "Splash", "b1", Some(PNG_FINTO)).await;
        publish(cfg.path(), prj.path(), Occasione::Modifica).await;
        assert!(!dir_at(cfg.path()).join(PNG).exists());
    }

    #[tokio::test]
    async fn una_pagina_abilitata_senza_png_non_installa_niente() {
        let (prj, cfg) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        progetto(prj.path(), Some("b1"));
        pagina_con_png(prj.path(), "Splash", "b1", None).await;
        publish(cfg.path(), prj.path(), Occasione::Modifica).await;
        assert!(!dir_at(cfg.path()).join(PNG).exists());
    }

    fn st(esito: &str, sha: Option<&str>) -> BootImageStato {
        BootImageStato { esito: esito.into(), sha256: sha.map(Into::into), ..Default::default() }
    }

    /// Il difetto del TC620 (27-09): PNG pubblicato il 20-09, mai applicato,
    /// e il launcher non si richiamava più perché il PNG non cambiava.
    #[test]
    fn il_launcher_si_richiama_finche_non_e_installato_quel_png() {
        const M: Occasione = Occasione::Modifica;
        // PNG già al suo posto, nessuno stato: si chiama.
        assert!(serve_applicare(None, "aaa", false, M));
        // L'ultima volta è andata male, o c'è stato un ripristino: si chiama.
        assert!(serve_applicare(Some(&st("errore", Some("aaa"))), "aaa", false, M));
        assert!(serve_applicare(Some(&st("fabbrica", None)), "aaa", false, M));
        // Installato un PNG diverso: si chiama.
        assert!(serve_applicare(Some(&st("installato", Some("bbb"))), "aaa", false, M));
        // Installato proprio questo: non si richiama a ogni salvataggio.
        assert!(!serve_applicare(Some(&st("installato", Some("aaa"))), "aaa", false, M));
        // PNG cambiato: si chiama sempre.
        assert!(serve_applicare(Some(&st("installato", Some("aaa"))), "aaa", true, M));
    }

    /// Il secondo difetto del TC620 (27-09): ripristino di fabbrica, riavvio,
    /// e il runtime ripartendo riapplicava l'immagine del progetto.
    #[test]
    fn un_ripristino_di_fabbrica_resiste_al_riavvio_ma_non_al_deploy() {
        let fabbrica = st("fabbrica", None);
        assert!(!serve_applicare(Some(&fabbrica), "aaa", false, Occasione::Avvio));
        assert!(serve_applicare(Some(&fabbrica), "aaa", false, Occasione::Modifica));
        // All'avvio un PNG davvero nuovo si applica comunque.
        assert!(serve_applicare(Some(&fabbrica), "aaa", true, Occasione::Avvio));
        // E all'avvio un pannello mai applicato recupera (il primo difetto).
        assert!(serve_applicare(None, "aaa", false, Occasione::Avvio));
    }

    /// Chi scrive `status` e chi lo legge usano le stesse chiavi: il 24-09 il
    /// runtime scriveva `esito=applicata` e `nota=`, e la scheda mostrava la
    /// parola grezza senza il messaggio.
    #[tokio::test]
    async fn lo_stato_scritto_si_rilegge_con_le_stesse_chiavi() {
        let cfg = tempfile::tempdir().unwrap();
        scrivi_stato(
            cfg.path(),
            BootImageStato {
                esito: "errore".into(),
                sha256: Some("aaa".into()),
                messaggio: Some("due\nrighe".into()),
                ..Default::default()
            },
        )
        .await;
        let s = leggi_stato(cfg.path()).await.unwrap();
        assert_eq!(s.esito, "errore");
        assert_eq!(s.sha256.as_deref(), Some("aaa"));
        assert_eq!(s.messaggio.as_deref(), Some("due righe"));
        assert!(s.quando.is_some());
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
    async fn lo_stato_riporta_lo_sha_del_png_pubblicato() {
        let cfg = tempfile::tempdir().unwrap();
        assert_eq!(leggi_stato(cfg.path()).await, None);
        let d = dir_at(cfg.path());
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(STATO), "esito=installato\nsha256=aaa\n").unwrap();
        std::fs::write(d.join(PNG), PNG_FINTO).unwrap();
        let s = leggi_stato(cfg.path()).await.unwrap();
        assert_eq!(s.sha256.as_deref(), Some("aaa"));
        assert_eq!(s.richiesta, Some(sha256_hex(PNG_FINTO)));
    }
}
