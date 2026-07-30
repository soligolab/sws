//! SQLite datastore backend — wraps the existing `SqliteStore` with the
//! unified `DatastoreBackend` interface.

use std::path::PathBuf;

use crate::backend::{DatastoreStats, now_ms};
use crate::sqlite::SqliteStore;
use crate::Sample;

pub struct SqliteBackend {
    store: SqliteStore,
}

impl SqliteBackend {
    pub async fn open(path: PathBuf) -> anyhow::Result<Self> {
        let store = SqliteStore::open(path).await?;
        Ok(Self { store })
    }

    pub fn path(&self) -> &std::path::Path {
        self.store.path()
    }

    pub fn store(&self) -> &SqliteStore {
        &self.store
    }

    pub async fn record(&self, tag_id: &str, sample: &Sample) {
        self.store.append(tag_id, sample).await;
    }

    pub async fn query(
        &self,
        tag_id: &str,
        from_ms: Option<u64>,
        to_ms: Option<u64>,
    ) -> Vec<Sample> {
        let from = from_ms.unwrap_or(0);
        let to   = to_ms.unwrap_or(u64::MAX);
        self.store.query_range(tag_id, from, to).await
    }

    pub async fn test(&self) -> anyhow::Result<String> {
        let n = self.store.total_samples().await?;
        Ok(format!(
            "SQLite OK — {} samples total at {}",
            n,
            self.store.path().display(),
        ))
    }

    pub async fn stats(&self) -> DatastoreStats {
        let (sample_count, oldest_ms, newest_ms, size_bytes, tag_count, error) =
            match self.store.full_stats().await {
                Ok(s) => (s.0, s.1, s.2, s.3, s.4, None),
                Err(e) => (0, None, None, None, 0, Some(e.to_string())),
            };
        DatastoreStats {
            kind: "sqlite",
            tag_count,
            sample_count,
            oldest_ms,
            newest_ms,
            size_bytes,
            connected: error.is_none(),
            error,
        }
    }

    pub async fn purge(
        &self,
        retention_rows: Option<u64>,
        retention_days: Option<u64>,
    ) -> anyhow::Result<u64> {
        let mut deleted = 0u64;
        if let Some(days) = retention_days {
            let cutoff = now_ms().saturating_sub(days * 86_400_000);
            deleted += self.store.prune_older_than_ms(cutoff).await? as u64;
        }
        if let Some(max_rows) = retention_rows {
            deleted += self.store.prune_excess_rows(max_rows).await?;
        }
        Ok(deleted)
    }

    /// Tag con campioni nel DB (vedi `SqliteStore::distinct_tags`).
    pub async fn tags(&self) -> anyhow::Result<Vec<String>> {
        self.store.distinct_tags().await
    }

    /// Cancella lo storico di un tag.
    pub async fn delete_tag(&self, tag: &str) -> anyhow::Result<u64> {
        self.store.delete_tag(tag).await
    }

    /// `VACUUM` + checkpoint WAL. Ritorna (byte prima, byte dopo).
    pub async fn vacuum(&self) -> anyhow::Result<(u64, u64)> {
        self.store.vacuum().await
    }

    pub async fn export(
        &self,
        tags: &[String],
        from_ms: Option<u64>,
        to_ms: Option<u64>,
    ) -> Vec<(String, Vec<Sample>)> {
        let from = from_ms.unwrap_or(0);
        let to   = to_ms.unwrap_or(u64::MAX);
        let mut out = Vec::new();
        for tag in tags {
            let samples = self.store.query_range(tag, from, to).await;
            out.push((tag.clone(), samples));
        }
        out
    }
}
