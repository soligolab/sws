//! `DatastoreRegistry` — routes tag writes to the correct backend.
//!
//! Loaded once at startup from `Project::datastores`. Each tag with `history =
//! true` is routed to its `datastore_id` (or the first configured datastore).
//! Deadband and minimum-interval filtering are applied per-tag before persisting.
//!
//! The registry is `Arc`-wrapped by the caller; `spawn_recorder` takes an `Arc<Self>`.

use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use sws_core::{Project, TagId};
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::backend::{DatastoreBackend, DatastoreStats};
use crate::Sample;

// ── Per-tag filter state ──────────────────────────────────────────────────────

struct TagFilter {
    deadband: Option<f64>,
    min_interval_ms: Option<u64>,
    last_value: Option<f64>,
    last_ts_ms: u64,
}

impl TagFilter {
    fn new(deadband: Option<f64>, min_interval_ms: Option<u64>) -> Self {
        Self {
            deadband,
            min_interval_ms,
            last_value: None,
            last_ts_ms: 0,
        }
    }

    /// Returns true if the sample should be recorded (passes deadband + interval).
    fn should_record(&mut self, sample: &Sample) -> bool {
        // Minimum interval check.
        if let Some(min_ms) = self.min_interval_ms {
            if sample.ts_ms.saturating_sub(self.last_ts_ms) < min_ms {
                return false;
            }
        }
        // Deadband check (numeric values only).
        if let Some(db) = self.deadband {
            if let Some(last_v) = self.last_value {
                let current = match &sample.value {
                    sws_core::TagValue::Float(v) => *v,
                    sws_core::TagValue::Int(v) => *v as f64,
                    sws_core::TagValue::Bool(v) => {
                        if *v {
                            1.0
                        } else {
                            0.0
                        }
                    }
                    sws_core::TagValue::Str(_)
                    | sws_core::TagValue::Array(_)
                    | sws_core::TagValue::Struct(_) => {
                        // Stringhe e compositi: si registra sempre, non c'è una
                        // banda morta che abbia senso.
                        self.last_ts_ms = sample.ts_ms;
                        return true;
                    }
                };
                if (current - last_v).abs() < db {
                    return false;
                }
                self.last_value = Some(current);
            } else {
                // First sample — always record, seed last_value.
                self.last_value = match &sample.value {
                    sws_core::TagValue::Float(v) => Some(*v),
                    sws_core::TagValue::Int(v) => Some(*v as f64),
                    sws_core::TagValue::Bool(v) => Some(if *v { 1.0 } else { 0.0 }),
                    sws_core::TagValue::Str(_)
                    | sws_core::TagValue::Array(_)
                    | sws_core::TagValue::Struct(_) => None,
                };
            }
        }
        self.last_ts_ms = sample.ts_ms;
        true
    }
}

// ── Per-tag routing entry ─────────────────────────────────────────────────────

struct TagRoute {
    datastore_idx: usize,
    filter: TagFilter,
}

// ── Registry ─────────────────────────────────────────────────────────────────

pub struct DatastoreRegistry {
    backends: Vec<(String, DatastoreBackend)>, // (id, backend)
    routes: RwLock<HashMap<TagId, TagRoute>>,
    /// Il registratore è già partito: `spawn_recorder` non ne avvia un secondo.
    /// Fino al 26-09-2026 all'avvio con `--project` ne partivano due (uno da
    /// `apply_loaded_project`, uno da `main.rs`) sullo stesso registro.
    registratore_avviato: AtomicBool,
    /// Il registro è stato sostituito (progetto chiuso o riaperto): il suo
    /// registratore si ferma al prossimo aggiornamento. Prima restava vivo per
    /// sempre, e aprendo un progetto dopo l'altro i registratori si accumulavano.
    chiuso: AtomicBool,
}

impl DatastoreRegistry {
    /// Build the registry from the project datastores list.
    /// Returns `None` when `project.datastores` is empty (caller falls back to
    /// the legacy `Historian` path).
    pub async fn from_project(
        project: &Project,
        project_dir: &Path,
    ) -> anyhow::Result<Option<Arc<Self>>> {
        if project.datastores.is_empty() {
            return Ok(None);
        }

        let mut backends = Vec::new();
        for ds in &project.datastores {
            match DatastoreBackend::from_config(&ds.backend, project_dir).await {
                Ok(b) => {
                    info!(id = %ds.id, kind = b.kind_str(), "datastore: backend initialized");
                    backends.push((ds.id.clone(), b));
                }
                Err(e) => {
                    warn!(id = %ds.id, "datastore: backend init failed: {e}");
                    return Err(e);
                }
            }
        }

        // Build route table from the project tag definitions.
        //
        // Fase 1e (22-09-2026): un'**istanza** non si registra intera — lo
        // storico tiene scalari, e Postgres ha una colonna numerica. Si
        // registrano le sue **foglie**, con l'id di percorso. L'interruttore
        // `history` sta sulla **radice** (scelta del maintainer): acceso,
        // entrano tutte le foglie; il tipo può escluderne una con
        // `history: false` sul membro, e vale per tutte le istanze. Banda
        // morta e intervallo minimo vengono dal membro, se li dichiara.
        let mut routes = HashMap::new();
        for tag in &project.tags {
            if !tag.history {
                continue;
            }
            let datastore_idx = if let Some(ref id) = tag.datastore_id {
                backends.iter().position(|(bid, _)| bid == id).unwrap_or(0)
            } else {
                0
            };
            let foglie = match sws_core::Forma::da_tag(tag, &project.types) {
                Ok(Some(forma)) => forma.foglie(&tag.id, &project.types),
                _ => Vec::new(),
            };
            if foglie.is_empty() {
                routes.insert(
                    tag.id.clone(),
                    TagRoute {
                        datastore_idx,
                        filter: TagFilter::new(tag.history_deadband, tag.history_min_interval_ms),
                    },
                );
                continue;
            }
            for f in foglie {
                let (registra, deadband, intervallo) = match &f.membro {
                    Some(m) => (m.history, m.history_deadband, m.history_min_interval_ms),
                    None => (true, tag.history_deadband, tag.history_min_interval_ms),
                };
                if !registra {
                    continue;
                }
                routes.insert(
                    f.percorso,
                    TagRoute {
                        datastore_idx,
                        filter: TagFilter::new(deadband, intervallo),
                    },
                );
            }
        }

        Ok(Some(Arc::new(Self {
            backends,
            routes: RwLock::new(routes),
            registratore_avviato: AtomicBool::new(false),
            chiuso: AtomicBool::new(false),
        })))
    }

    /// Record a sample.  Applies deadband/interval filter and routes to the
    /// correct backend. No-op for tags not in the route table (history disabled).
    pub async fn record(&self, tag_id: &str, sample: &Sample) {
        let mut routes = self.routes.write().await;
        let Some(route) = routes.get_mut(tag_id) else {
            return;
        };
        if !route.filter.should_record(sample) {
            return;
        }
        let idx = route.datastore_idx;
        drop(routes);
        if let Some((_, backend)) = self.backends.get(idx) {
            backend.record(tag_id, sample).await;
        }
    }

    /// Query a tag's history from its assigned backend.
    pub async fn query(
        &self,
        tag_id: &str,
        from_ms: Option<u64>,
        to_ms: Option<u64>,
    ) -> Vec<Sample> {
        let routes = self.routes.read().await;
        let idx = routes.get(tag_id).map(|r| r.datastore_idx).unwrap_or(0);
        drop(routes);
        match self.backends.get(idx) {
            Some((_, b)) => b.query(tag_id, from_ms, to_ms).await,
            None => vec![],
        }
    }

    /// Test a backend by id. Returns Ok(description) or error.
    pub async fn test_backend(&self, id: &str) -> anyhow::Result<String> {
        match self.backends.iter().find(|(bid, _)| bid == id) {
            Some((_, b)) => b.test().await,
            None => anyhow::bail!("datastore '{id}' not found"),
        }
    }

    /// Stats for a single backend.
    pub async fn backend_stats(&self, id: &str) -> Option<DatastoreStats> {
        match self.backends.iter().find(|(bid, _)| bid == id) {
            Some((_, b)) => Some(b.stats().await),
            None => None,
        }
    }

    /// Stats for all backends. Returns `(id, stats)` pairs.
    pub async fn all_stats(&self) -> Vec<(String, DatastoreStats)> {
        let mut out = Vec::new();
        for (id, b) in &self.backends {
            out.push((id.clone(), b.stats().await));
        }
        out
    }

    /// Purge a specific backend. Returns rows deleted.
    pub async fn purge_backend(
        &self,
        id: &str,
        retention_rows: Option<u64>,
        retention_days: Option<u64>,
    ) -> anyhow::Result<u64> {
        match self.backends.iter().find(|(bid, _)| bid == id) {
            Some((_, b)) => b.purge(retention_rows, retention_days).await,
            None => anyhow::bail!("datastore '{id}' not found"),
        }
    }

    /// Export raw samples from a specific backend.
    pub async fn export_backend(
        &self,
        id: &str,
        tags: &[String],
        from_ms: Option<u64>,
        to_ms: Option<u64>,
    ) -> anyhow::Result<Vec<(String, Vec<Sample>)>> {
        match self.backends.iter().find(|(bid, _)| bid == id) {
            Some((_, b)) => Ok(b.export(tags, from_ms, to_ms).await),
            None => anyhow::bail!("datastore '{id}' not found"),
        }
    }

    /// Tag con campioni nel backend indicato.
    pub async fn list_backend_tags(&self, id: &str) -> anyhow::Result<Vec<String>> {
        match self.backends.iter().find(|(bid, _)| bid == id) {
            Some((_, b)) => b.tags().await,
            None => anyhow::bail!("datastore '{id}' not found"),
        }
    }

    /// Cancella lo storico di un tag nel backend indicato.
    pub async fn delete_backend_tag(&self, id: &str, tag: &str) -> anyhow::Result<u64> {
        match self.backends.iter().find(|(bid, _)| bid == id) {
            Some((_, b)) => b.delete_tag(tag).await,
            None => anyhow::bail!("datastore '{id}' not found"),
        }
    }

    /// `VACUUM` sul backend indicato. Ritorna (byte prima, byte dopo).
    pub async fn vacuum_backend(&self, id: &str) -> anyhow::Result<(u64, u64)> {
        match self.backends.iter().find(|(bid, _)| bid == id) {
            Some((_, b)) => b.vacuum().await,
            None => anyhow::bail!("datastore '{id}' not found"),
        }
    }

    /// `SqliteStore::pulisci_storico` sul backend indicato, con i tag
    /// storicizzati di questo progetto (le rotte: foglie comprese). Solo SQLite.
    pub async fn pulisci_storico_backend(
        &self,
        id: &str,
        anteprima: bool,
    ) -> anyhow::Result<crate::sqlite::EsitoPulizia> {
        let tenere: Vec<String> = self.routes.read().await.keys().cloned().collect();
        match self.backends.iter().find(|(bid, _)| bid == id) {
            Some((_, crate::backend::DatastoreBackend::Sqlite(b))) => {
                b.store().pulisci_storico(tenere, anteprima).await
            }
            Some(_) => anyhow::bail!("la pulizia dello storico vale solo per SQLite"),
            None => anyhow::bail!("datastore '{id}' not found"),
        }
    }

    /// Return a list of all configured backend ids.
    pub fn backend_ids(&self) -> Vec<String> {
        self.backends.iter().map(|(id, _)| id.clone()).collect()
    }

    /// Path del file database del backend indicato (solo SQLite).
    pub fn backend_db_path(&self, id: &str) -> Option<std::path::PathBuf> {
        self.backends
            .iter()
            .find(|(bid, _)| bid == id)
            .and_then(|(_, b)| b.db_path().ok())
    }

    /// Copia consistente (point-in-time, via `VACUUM INTO`) del database del
    /// backend indicato in `dest`. Solo SQLite.
    pub async fn download_backend(&self, id: &str, dest: &Path) -> anyhow::Result<()> {
        match self.backends.iter().find(|(bid, _)| bid == id) {
            Some((_, b)) => b.download_to(dest).await,
            None => anyhow::bail!("datastore '{id}' not found"),
        }
    }

    /// Sostituisce il file database del backend indicato con `bytes` (backup
    /// automatico del precedente, nessun hot-swap della connessione live —
    /// serve un riavvio). Ritorna il path del backup creato.
    pub async fn replace_backend_file(
        &self,
        id: &str,
        bytes: Vec<u8>,
    ) -> anyhow::Result<std::path::PathBuf> {
        match self.backends.iter().find(|(bid, _)| bid == id) {
            Some((_, b)) => b.replace_file(bytes).await,
            None => anyhow::bail!("datastore '{id}' not found"),
        }
    }

    /// Return the SqliteStore of the first SQLite backend (clone is cheap — Arc-backed).
    /// Used by open_project to give the global Historian the per-project store.
    pub fn primary_sqlite_store(&self) -> Option<crate::sqlite::SqliteStore> {
        for (_, backend) in &self.backends {
            if let crate::backend::DatastoreBackend::Sqlite(b) = backend {
                return Some(b.store().clone());
            }
        }
        None
    }

    /// Ferma il registratore di questo registro (al prossimo aggiornamento).
    /// Da chiamare quando il registro viene sostituito o tolto.
    pub fn chiudi(&self) {
        self.chiuso.store(true, Ordering::SeqCst);
    }

    /// Spawn a recorder task that subscribes to `tag_db` and routes every update.
    ///
    /// Una volta sola per registro: una seconda chiamata non avvia niente. Il
    /// task finisce quando il registro è `chiudi`-uso o il `TagDb` si chiude.
    pub fn spawn_recorder(
        self: Arc<Self>,
        tag_db: Arc<sws_core::TagDb>,
    ) -> tokio::task::JoinHandle<()> {
        if self.registratore_avviato.swap(true, Ordering::SeqCst) {
            return tokio::spawn(async {});
        }
        let mut rx = tag_db.subscribe();
        tokio::spawn(async move {
            loop {
                if self.chiuso.load(Ordering::SeqCst) {
                    break;
                }
                match rx.recv().await {
                    Ok(_) if self.chiuso.load(Ordering::SeqCst) => break,
                    Ok(update) => {
                        // Fase 1e: l'aggiornamento di una radice composita si
                        // espande nelle sue foglie, che sono scalari e hanno
                        // ognuna la sua qualità. Per un tag piatto
                        // `espandi_foglie` ritorna l'aggiornamento stesso.
                        for (id, st) in tag_db.espandi_foglie(&update).await {
                            let sample = Sample {
                                ts_ms: st.timestamp_ms,
                                value: st.value,
                                quality: st.quality,
                            };
                            self.record(&id, &sample).await;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        warn!("datastore recorder lagged by {n}");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        })
    }
}
#[cfg(test)]
mod foglie_tests {
    use super::*;
    use sws_core::Project;

    fn progetto() -> Project {
        serde_yaml::from_str(
            r#"
meta: { name: p, version: "1" }
types:
  - id: Motore
    members:
      - { name: velocita, data_type: f32, history_deadband: 0.5 }
      - { name: marcia, data_type: bool }
      - { name: nome, data_type: string(8), history: false }
tags:
  - { id: motore1, type_ref: Motore, history: true }
  - { id: motore2, type_ref: Motore, history: false }
  - { id: piatto, data_type: f64, history: true, history_deadband: 2.0 }
sources: []
alarms: []
datastores:
  - { id: default, label: d, backend: { kind: sqlite, path: "h.db" } }
"#,
        )
        .unwrap()
    }

    /// Fase 1e: si registrano le FOGLIE, con l'interruttore sulla radice e i
    /// parametri dal membro. Una radice composita non entra intera: lo storico
    /// tiene scalari, e Postgres ha una colonna numerica.
    #[tokio::test]
    async fn le_rotte_dello_storico_sono_per_foglia() {
        let dir = tempfile::tempdir().unwrap();
        let reg = DatastoreRegistry::from_project(&progetto(), dir.path())
            .await
            .unwrap()
            .expect("registro");
        let mut ids: Vec<String> = reg.routes.read().await.keys().cloned().collect();
        ids.sort();
        assert_eq!(
            ids,
            [
                "motore1.marcia".to_string(),
                "motore1.velocita".to_string(),
                "piatto".to_string(),
            ],
            "motore2 ha lo storico spento; `nome` è escluso dal tipo; la radice non c'è"
        );
        // la banda morta viene dal membro, non dalla radice
        let routes = reg.routes.read().await;
        assert_eq!(routes["motore1.velocita"].filter.deadband, Some(0.5));
        assert_eq!(routes["motore1.marcia"].filter.deadband, None);
        assert_eq!(routes["piatto"].filter.deadband, Some(2.0));
    }

    /// Un registratore solo per registro, e si ferma alla chiusura (26-09-2026:
    /// prima all'avvio con `--project` ne partivano due, e aprendo un progetto
    /// dopo l'altro quelli vecchi restavano vivi).
    #[tokio::test]
    async fn un_registratore_solo_e_si_ferma_alla_chiusura() {
        let dir = tempfile::tempdir().unwrap();
        let reg = DatastoreRegistry::from_project(&progetto(), dir.path())
            .await
            .unwrap()
            .expect("registro");
        let db = Arc::new(sws_core::TagDb::new(64));
        let _uno = reg.clone().spawn_recorder(db.clone());
        let secondo = reg.clone().spawn_recorder(db.clone());
        secondo.await.unwrap(); // il secondo finisce subito: non ha avviato niente
        let store = reg.primary_sqlite_store().unwrap();
        let conta = || async { store.total_samples().await.unwrap() };

        db.set("piatto".into(), sws_core::TagValue::Float(1.0), sws_core::TagQuality::Good).await;
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        assert_eq!(conta().await, 1, "un campione, non due");

        reg.chiudi();
        db.set("piatto".into(), sws_core::TagValue::Float(50.0), sws_core::TagQuality::Good).await;
        db.set("piatto".into(), sws_core::TagValue::Float(90.0), sws_core::TagQuality::Good).await;
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        assert_eq!(conta().await, 1, "chiuso: non registra più");
    }
}
