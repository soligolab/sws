//! L'istantanea dei dati prima di un aggiornamento (03-10-2026, piano
//! `docs/plans/2026-10-03-pulizia-immagini-dopo-aggiornamento.md`).
//!
//! Tornare alla versione precedente non basta riportare l'immagine: una versione
//! nuova può aver cambiato i dati in un modo che quella vecchia non sa leggere
//! (lo storico compatto della rc.18 è il primo caso, ed è a senso unico). Prima
//! di ogni aggiornamento, quindi, il runtime copia **config e progetti** in
//! `<config>/istantanea/`; lo script dell'host (`immagini.sh ritorna`) li rimette
//! al loro posto se l'operatore torna indietro, e `immagini.sh pulisci` li toglie
//! quando l'aggiornamento è confermato.
//!
//! Cosa resta fuori: i `backups/` dei progetti (restano dove sono e non si
//! ripristinano), i log, le copie `historian-prima-della-pulizia-*`, i file
//! `-wal`/`-shm` (ogni database si copia con [`copia_coerente`], che li
//! incorpora), e le cartelle di lavoro di questo stesso meccanismo.
//!
//! [`copia_coerente`]: sws_historian::sqlite::copia_coerente

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const DIR: &str = "istantanea";
const DIR_TMP: &str = "istantanea.tmp";
const FILE_INFO: &str = "istantanea.json";

/// Nella cartella config: file e cartelle di questo meccanismo e dei suoi
/// vicini, che non hanno senso dentro l'istantanea (e alcuni la conterrebbero).
const ESCLUSI_CONFIG: &[&str] = &[DIR, DIR_TMP, "quadlet-nuovo", "pulizia", "immagini.stato", "immagini.json", "ritorno.json"];
/// In ogni progetto, a qualunque profondità.
const ESCLUSI_PROGETTO: &[&str] = &["backups", "logs", ".run"];

/// Le due cartelle dei dati, fissate all'avvio da `main`.
static RADICI: OnceLock<(PathBuf, PathBuf)> = OnceLock::new();

pub fn imposta_radici(config_dir: PathBuf, projects_root: PathBuf) {
    let _ = RADICI.set((config_dir, projects_root));
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Info {
    /// La versione che girava quando è stata presa: quella a cui riporta.
    pub versione: String,
    pub quando_ms: i64,
    pub byte: u64,
}

/// Un file o una cartella da lasciare fuori. `nella_config` = siamo al primo
/// livello della cartella config.
pub fn escluso(nome: &str, nella_config: bool) -> bool {
    (nella_config && ESCLUSI_CONFIG.contains(&nome))
        || ESCLUSI_PROGETTO.contains(&nome)
        || nome.starts_with("historian-prima-della-pulizia")
        || nome.ends_with(".db-wal")
        || nome.ends_with(".db-shm")
        || nome.ends_with("-journal")
}

/// Si prende solo su un dispositivo: lì c'è la cartella config dell'host.
pub fn su_dispositivo() -> bool {
    std::env::var("SWS_HOST_CONFIG_DIR").map(|s| !s.trim().is_empty()).unwrap_or(false)
}

/// Lo spazio che serve: l'istantanea stimata più metà di margine. Pura.
pub fn spazio_basta(stima: u64, libero: u64) -> bool {
    libero >= stima.saturating_add(stima / 2)
}

fn dimensione(p: &Path, nella_config: bool) -> u64 {
    let Ok(m) = std::fs::symlink_metadata(p) else { return 0 };
    if m.is_file() {
        return m.len();
    }
    if !m.is_dir() {
        return 0;
    }
    let mut tot = 0;
    if let Ok(rd) = std::fs::read_dir(p) {
        for e in rd.flatten() {
            let nome = e.file_name().to_string_lossy().into_owned();
            if !escluso(&nome, nella_config) {
                tot += dimensione(&e.path(), false);
            }
        }
    }
    tot
}

fn copia(src: &Path, dst: &Path, nella_config: bool) -> std::io::Result<()> {
    let m = std::fs::symlink_metadata(src)?;
    if m.is_dir() {
        std::fs::create_dir_all(dst)?;
        for e in std::fs::read_dir(src)? {
            let e = e?;
            let nome = e.file_name().to_string_lossy().into_owned();
            if escluso(&nome, nella_config) {
                continue;
            }
            copia(&e.path(), &dst.join(&nome), false)?;
        }
    } else if m.is_file() {
        if src.extension().is_some_and(|x| x == "db") {
            // Un database: copia coerente, anche se qualcuno ci sta scrivendo.
            if let Err(e) = sws_historian::sqlite::copia_coerente(src, dst) {
                // Non è un SQLite (o è rotto): i byte, come qualunque altro file.
                tracing::debug!(file = %src.display(), "istantanea: non è un database leggibile ({e}), copio i byte");
                std::fs::copy(src, dst)?;
            }
        } else {
            std::fs::copy(src, dst)?;
        }
    } else if m.file_type().is_symlink() {
        #[cfg(unix)]
        {
            let t = std::fs::read_link(src)?;
            let _ = std::os::unix::fs::symlink(t, dst);
        }
    }
    Ok(())
}

fn spazio_libero(p: &Path) -> Option<u64> {
    // Il disco con il punto di montaggio più lungo che contiene il percorso.
    let p = std::fs::canonicalize(p).ok()?;
    let dischi = sysinfo::Disks::new_with_refreshed_list();
    dischi
        .list()
        .iter()
        .filter(|d| p.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
}

/// Prende l'istantanea. `Ok(None)` fuori da un dispositivo (niente da fare);
/// `Err` se non c'è spazio o la copia fallisce — e allora l'aggiornamento non
/// parte: aggiornare senza una via di ritorno coi dati è proprio ciò che
/// l'istantanea esiste per evitare.
pub async fn prendi(versione: &str) -> Result<Option<Info>, String> {
    if !su_dispositivo() {
        return Ok(None);
    }
    let Some((config, progetti)) = RADICI.get().cloned() else {
        return Err("istantanea: cartelle dei dati non impostate".into());
    };
    let versione = versione.to_string();
    tokio::task::spawn_blocking(move || prendi_in(&config, &progetti, &versione))
        .await
        .map_err(|e| format!("istantanea: {e}"))?
        .map(Some)
}

/// Il lavoro vero, sincrono e con le cartelle esplicite (per i test).
pub fn prendi_in(config: &Path, progetti: &Path, versione: &str) -> Result<Info, String> {
    let stima = dimensione(config, true) + dimensione(progetti, false);
    if let Some(libero) = spazio_libero(config) {
        if !spazio_basta(stima, libero) {
            return Err(format!(
                "Spazio insufficiente per l'istantanea dei dati prima dell'aggiornamento: servono circa {} MB, \
                 liberi {} MB. Confermare l'aggiornamento precedente (toglie le immagini vecchie e la sua \
                 istantanea) o liberare spazio, poi riprovare.",
                (stima + stima / 2) / 1_000_000,
                libero / 1_000_000
            ));
        }
    }
    let tmp = config.join(DIR_TMP);
    let _ = std::fs::remove_dir_all(&tmp);
    let err = |e: std::io::Error| format!("istantanea: {e}");
    std::fs::create_dir_all(&tmp).map_err(err)?;
    copia(config, &tmp.join("config"), true).map_err(err)?;
    if progetti.is_dir() {
        copia(progetti, &tmp.join("projects"), false).map_err(err)?;
    }
    let info = Info { versione: versione.into(), quando_ms: chrono::Utc::now().timestamp_millis(), byte: dimensione(&tmp, false) };
    std::fs::write(tmp.join(FILE_INFO), serde_json::to_vec_pretty(&info).unwrap_or_default()).map_err(err)?;
    // Al posto di quella vecchia solo quando la nuova è completa.
    let dir = config.join(DIR);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::rename(&tmp, &dir).map_err(err)?;
    tracing::info!(byte = info.byte, versione = %info.versione, "istantanea dei dati presa prima dell'aggiornamento");
    Ok(info)
}

/// L'istantanea presente, se c'è.
pub fn info(config: &Path) -> Option<Info> {
    let t = std::fs::read(config.join(DIR).join(FILE_INFO)).ok()?;
    serde_json::from_slice(&t).ok()
}

pub fn togli(config: &Path) {
    let _ = std::fs::remove_dir_all(config.join(DIR));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosa_resta_fuori() {
        assert!(escluso("istantanea", true));
        assert!(!escluso("istantanea", false), "fuori dalla config è un nome come un altro");
        assert!(escluso("backups", false));
        assert!(escluso("historian-prima-della-pulizia-2026-09-26.db", false));
        assert!(escluso("historian.db-wal", false));
        assert!(!escluso("historian.db", false));
        assert!(!escluso("project.yaml", false));
    }

    #[test]
    fn lo_spazio() {
        assert!(spazio_basta(100, 150));
        assert!(!spazio_basta(100, 149));
        assert!(spazio_basta(0, 0));
    }

    #[test]
    fn copia_config_e_progetti_coerenti() {
        let t = tempfile::tempdir().unwrap();
        let config = t.path().join("config");
        let progetti = t.path().join("projects");
        std::fs::create_dir_all(config.join("quadlet-nuovo")).unwrap();
        std::fs::write(config.join("aggiornamento.yaml"), "pilota: null\n").unwrap();
        std::fs::write(config.join("quadlet-nuovo/x"), "x").unwrap();
        let p = progetti.join("casa");
        std::fs::create_dir_all(p.join("history")).unwrap();
        std::fs::create_dir_all(p.join("backups/2026")).unwrap();
        std::fs::write(p.join("project.yaml"), "name: casa\n").unwrap();
        std::fs::write(p.join("backups/2026/project.yaml"), "vecchio").unwrap();
        std::fs::write(p.join("history/historian-prima-della-pulizia-x.db"), "grande").unwrap();
        // Un database in WAL con una scrittura ancora nel -wal.
        let db = p.join("history/historian.db");
        let c = rusqlite::Connection::open(&db).unwrap();
        c.pragma_update(None, "journal_mode", "WAL").unwrap();
        c.execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES (1),(2),(3);").unwrap();

        let info = prendi_in(&config, &progetti, "2.12.0-rc.17").unwrap();
        assert_eq!(info.versione, "2.12.0-rc.17");
        let ist = config.join(DIR);
        assert!(ist.join("config/aggiornamento.yaml").is_file());
        assert!(!ist.join("config/quadlet-nuovo").exists());
        assert!(!ist.join("config/istantanea.tmp").exists());
        assert!(ist.join("projects/casa/project.yaml").is_file());
        assert!(!ist.join("projects/casa/backups").exists());
        assert!(!ist.join("projects/casa/history/historian-prima-della-pulizia-x.db").exists());
        assert!(!ist.join("projects/casa/history/historian.db-wal").exists());
        let copia = rusqlite::Connection::open(ist.join("projects/casa/history/historian.db")).unwrap();
        let n: i64 = copia.query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 3, "la copia contiene anche ciò che stava nel WAL");
        assert_eq!(super::info(&config), Some(info));

        // Una seconda istantanea sostituisce la prima, e non contiene sé stessa.
        prendi_in(&config, &progetti, "2.12.0-rc.18").unwrap();
        assert!(!ist.join("config/istantanea").exists());
        assert_eq!(super::info(&config).unwrap().versione, "2.12.0-rc.18");
        togli(&config);
        assert!(super::info(&config).is_none());
        drop(c);
    }
}
