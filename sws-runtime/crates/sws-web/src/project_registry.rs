//! Known-projects registry: `name -> {path, last_opened_ms}`, persisted as
//! JSON at `<config_dir>/known_projects.json`.
//!
//! Touched automatically on every successful create/open, so the WelcomeScreen
//! can show a "recent projects" list ordered by recency — covering both
//! default-root projects (`projects_root/<name>`, discovered today by a
//! directory scan) and "external" ones created at a custom parent path chosen
//! by the maintainer (e.g. their Documents folder, a backup share). No
//! migration needed: the file starts absent/empty and fills in from first use;
//! pre-existing root-scoped projects are still found by the legacy scan even
//! before they ever get a registry entry.

use std::{collections::HashMap, path::{Path, PathBuf}};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownProjectEntry {
    pub path: PathBuf,
    pub last_opened_ms: u64,
}

pub struct ProjectRegistry {
    file: PathBuf,
    entries: RwLock<HashMap<String, KnownProjectEntry>>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl ProjectRegistry {
    /// Load from `<config_dir>/known_projects.json`. Missing/corrupt file →
    /// empty registry (first-run friendly, never fatal).
    pub async fn load(config_dir: &Path) -> Self {
        let file = config_dir.join("known_projects.json");
        let entries = match tokio::fs::read_to_string(&file).await {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => HashMap::new(),
        };
        Self { file, entries: RwLock::new(entries) }
    }

    /// Record (or update) that `name` at `path` was just created/opened.
    pub async fn touch(&self, name: &str, path: &Path) {
        {
            let mut map = self.entries.write().await;
            map.insert(name.to_string(), KnownProjectEntry {
                path: path.to_path_buf(),
                last_opened_ms: now_ms(),
            });
        }
        self.persist().await;
    }

    /// Remove an entry (external "remove from list", or cleanup after a
    /// root-scoped delete).
    pub async fn remove(&self, name: &str) {
        { self.entries.write().await.remove(name); }
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

    pub async fn get_path(&self, name: &str) -> Option<PathBuf> {
        self.entries.read().await.get(name).map(|e| e.path.clone())
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
