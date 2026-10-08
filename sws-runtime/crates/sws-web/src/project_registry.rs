//! Known-projects registry: `<azienda>/<nome> -> {path, last_opened_ms}`,
//! persisted as JSON at `<config_dir>/known_projects.json`.
//!
//! **La chiave è il riferimento, non il nome** (07-10-2026). Finché era il
//! nome nudo, due aziende con un progetto «impianto» si sovrascrivevano a
//! vicenda: l'ultima che lo apriva vinceva, e l'altra si ritrovava la voce
//! puntata alla cartella sbagliata. Il segmento dell'azienda è la sua
//! **cartella**, perché la cartella è ciò che sta sul disco, e `-` per
//! l'azienda implicita, che cartella non ne ha.
//!
//! Touched automatically on every successful create/open, so the WelcomeScreen
//! can show a "recent projects" list ordered by recency — covering both
//! default-root projects (`projects_root/<name>`, discovered today by a
//! directory scan) and "external" ones created at a custom parent path chosen
//! by the maintainer (e.g. their Documents folder, a backup share). No
//! migration needed: the file starts absent/empty and fills in from first use;
//! pre-existing root-scoped projects are still found by the legacy scan even
//! before they ever get a registry entry.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
use sws_core::now_ms;
use tokio::sync::RwLock;
use tracing::warn;

/// Il segmento che indica l'azienda **implicita** in un riferimento.
///
/// Non una stringa vuota: `"/impianto"` sarebbe una chiave che inizia per
/// barra e un indirizzo con due barre di fila, e tutti e due si leggono male.
pub const AZIENDA_IMPLICITA: &str = "-";

/// Il riferimento di un progetto, come lo usano chiave e indirizzo.
pub fn riferimento(azienda: &str, nome: &str) -> String {
    format!("{azienda}/{nome}")
}

/// Porta le chiavi vecchie — nomi nudi — alla forma `<azienda>/<nome>`.
///
/// Il segmento si ricava dal **percorso registrato**, non assunto implicito:
/// una cartella d'azienda può esistere già, e dare `-` alla cieca
/// produrrebbe una chiave che dice «radice» su una voce che sta in
/// `<radice>/<azienda>/`. Il risultato sarebbe un doppione nell'elenco — la
/// scansione trova la cartella vera, il registro insiste con l'altra — e un
/// indirizzo che non apre niente. Il percorso è il fatto, qui come altrove.
///
/// Nessun file si sposta: cambia solo come il registro li chiama. Se il file
/// manca o è illeggibile non si perde niente — il registro è già oggi una
/// cache che la scansione ricostruisce.
fn migra_chiavi(
    vecchie: HashMap<String, KnownProjectEntry>,
    radice: &Path,
) -> HashMap<String, KnownProjectEntry> {
    let mut nuove = HashMap::with_capacity(vecchie.len());
    let mut migrate = 0usize;
    for (chiave, voce) in vecchie {
        if chiave.contains('/') {
            nuove.insert(chiave, voce);
        } else {
            let seg = crate::projects::segmento_da_percorso(radice, &voce.path);
            nuove.insert(riferimento(&seg, &chiave), voce);
            migrate += 1;
        }
    }
    if migrate > 0 {
        warn!("project_registry: {migrate} voci portate alla chiave «azienda/nome»");
    }
    nuove
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownProjectEntry {
    pub path: PathBuf,
    pub last_opened_ms: u64,
}

pub struct ProjectRegistry {
    file: PathBuf,
    entries: RwLock<HashMap<String, KnownProjectEntry>>,
}

impl ProjectRegistry {
    /// Load from `<config_dir>/known_projects.json`. Missing/corrupt file →
    /// empty registry (first-run friendly, never fatal).
    pub async fn load(config_dir: &Path, projects_root: &Path) -> Self {
        let file = config_dir.join("known_projects.json");
        let entries: HashMap<String, KnownProjectEntry> =
            match tokio::fs::read_to_string(&file).await {
                Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
                Err(_) => HashMap::new(),
            };
        let entries = migra_chiavi(entries, projects_root);
        Self {
            file,
            entries: RwLock::new(entries),
        }
    }

    /// Record (or update) that the project at `chiave` (`<azienda>/<nome>`)
    /// living at `path` was just created/opened.
    pub async fn touch(&self, chiave: &str, path: &Path) {
        {
            let mut map = self.entries.write().await;
            map.insert(
                chiave.to_string(),
                KnownProjectEntry {
                    path: path.to_path_buf(),
                    last_opened_ms: now_ms(),
                },
            );
        }
        self.persist().await;
    }

    /// Remove an entry (external "remove from list", or cleanup after a
    /// root-scoped delete).
    pub async fn remove(&self, name: &str) {
        {
            self.entries.write().await.remove(name);
        }
        self.persist().await;
    }

    /// Move an entry from `old_name` to `new_name`, keeping its path/timestamp
    /// (used for external rename, which doesn't move the folder on disk).
    pub async fn rename_key(&self, old_name: &str, new_name: &str) {
        {
            let mut map = self.entries.write().await;
            if let Some(entry) = map.remove(old_name) {
                map.insert(new_name.to_string(), entry);
            }
        }
        self.persist().await;
    }

    /// Il percorso registrato di `name` — **solo se il progetto c'è ancora**.
    ///
    /// Una voce il cui `project.yaml` non esiste più (cartella spostata, cancellata
    /// a mano, o portata altrove come quando i progetti dell'IDE sono passati da
    /// `.run-editor/projects` a `~/sws_projects`, 20-09-2026) è **potata** e vale
    /// «non registrato». Prima il registro vinceva sempre: `open_project` cercava la
    /// cartella vecchia, rispondeva 404 «project not found» senza guardare
    /// `projects_root`, e i nomi delle voci morte bloccavano anche il «crea» con lo
    /// stesso nome.
    pub async fn get_path(&self, name: &str) -> Option<PathBuf> {
        let path = self
            .entries
            .read()
            .await
            .get(name)
            .map(|e| e.path.clone())?;
        if tokio::fs::try_exists(path.join("project.yaml"))
            .await
            .unwrap_or(false)
        {
            return Some(path);
        }
        warn!(
            "project_registry: '{name}' punta a {} che non ha più un project.yaml — voce rimossa",
            path.display()
        );
        self.remove(name).await;
        None
    }

    /// Full snapshot, used by `list_projects` to merge with the directory scan.
    pub async fn snapshot(&self) -> HashMap<String, KnownProjectEntry> {
        self.entries.read().await.clone()
    }

    async fn persist(&self) {
        let map = self.entries.read().await;
        match serde_json::to_string_pretty(&*map) {
            Ok(json) => {
                if let Err(e) = tokio::fs::write(&self.file, json).await {
                    warn!("project_registry: write {}: {e}", self.file.display());
                }
            }
            Err(e) => warn!("project_registry: serialize failed: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La migrazione guarda **dove sta** il progetto, non tira a indovinare.
    ///
    /// Una voce vecchia che punta dentro una cartella d'azienda deve
    /// diventare `azienda/nome`: con `-/nome` la scansione troverebbe la
    /// cartella vera e il registro insisterebbe con un'altra chiave, cioe due
    /// righe per lo stesso progetto e un indirizzo che non apre niente.
    /// Successo davvero il 07-10-2026, spostando i progetti di prova in
    /// `pixsys/` prima che la migrazione sapesse leggere il percorso.
    #[test]
    fn la_migrazione_delle_chiavi_legge_il_percorso() {
        let radice = Path::new("/progetti");
        let mut vecchie = HashMap::new();
        for (nome, percorso) in [
            ("impianto", "/progetti/impianto"),
            ("LVGL", "/progetti/pixsys/LVGL"),
            ("f0b", "/altrove/f0b"),
        ] {
            vecchie.insert(
                nome.to_string(),
                KnownProjectEntry { path: PathBuf::from(percorso), last_opened_ms: 1 },
            );
        }
        // Una chiave gia nella forma nuova non si tocca.
        vecchie.insert(
            "acme/forno".to_string(),
            KnownProjectEntry { path: PathBuf::from("/progetti/acme/forno"), last_opened_ms: 2 },
        );

        let nuove = migra_chiavi(vecchie, radice);
        let mut chiavi: Vec<_> = nuove.keys().cloned().collect();
        chiavi.sort();
        assert_eq!(
            chiavi,
            vec!["-/f0b", "-/impianto", "acme/forno", "pixsys/LVGL"],
            "chiavi migrate male"
        );
        assert_eq!(nuove["pixsys/LVGL"].path, PathBuf::from("/progetti/pixsys/LVGL"));
    }

    fn cartella(nome: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sws-reg-{nome}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[tokio::test]
    async fn una_voce_con_il_progetto_al_suo_posto_si_risolve() {
        let cfg = cartella("cfg1");
        let prj = cartella("prj1");
        std::fs::write(prj.join("project.yaml"), "meta: {}\n").unwrap();
        let reg = ProjectRegistry::load(&cfg, &cfg).await;
        reg.touch("casa", &prj).await;
        assert_eq!(reg.get_path("casa").await, Some(prj));
    }

    #[tokio::test]
    async fn una_voce_morta_si_pota_e_non_vince_sulla_radice_dei_progetti() {
        // Il caso del 20-09-2026: i progetti spostati in ~/sws_projects, il registro con i vecchi
        // percorsi. La voce non deve più mascherare la cartella vera.
        let cfg = cartella("cfg2");
        let vecchio = cartella("prj2"); // esiste ma senza project.yaml
        let reg = ProjectRegistry::load(&cfg, &cfg).await;
        reg.touch("casa", &vecchio).await;
        assert_eq!(reg.get_path("casa").await, None);
        assert!(
            reg.snapshot().await.is_empty(),
            "la voce morta doveva sparire"
        );
        // E sparisce anche dal file.
        let riletto = ProjectRegistry::load(&cfg, &cfg).await;
        assert!(riletto.snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn una_cartella_scomparsa_non_e_un_errore() {
        let cfg = cartella("cfg3");
        let reg = ProjectRegistry::load(&cfg, &cfg).await;
        reg.touch("fantasma", Path::new("/non/esiste/proprio"))
            .await;
        assert_eq!(reg.get_path("fantasma").await, None);
    }
}
