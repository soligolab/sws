//! `DatastoreBackend` — enum wrapping all supported persistence backends.
//!
//! We use enum dispatch (not trait objects) so async methods work without
//! boxing. Adding a new backend = new variant + arms in each match.

use serde::Serialize;
use sws_core::DatastoreBackendConfig;

use crate::Sample;
use crate::sqlite_backend::SqliteBackend;
use crate::postgres_backend::PostgresBackend;
use crate::odbc_backend::OdbcBackend;

/// Statistics reported by `GET /api/datastores/:id/stats`.
#[derive(Debug, Clone, Serialize)]
pub struct DatastoreStats {
    pub kind: &'static str,
    pub tag_count: u64,
    pub sample_count: u64,
    pub oldest_ms: Option<u64>,
    pub newest_ms: Option<u64>,
    /// Disk/storage size in bytes (when the backend can report it).
    pub size_bytes: Option<u64>,
    /// Whether the backend is currently reachable.
    pub connected: bool,
    pub error: Option<String>,
}

/// Unified persistence backend. Each variant delegates to a concrete
/// implementation. All methods are async and take `&self` — callers can
/// wrap in `Arc` freely.
pub enum DatastoreBackend {
    Sqlite(SqliteBackend),
    Postgres(PostgresBackend),
    Odbc(OdbcBackend),
}

impl DatastoreBackend {
    /// Build a backend from a `DatastoreBackendConfig` + resolved path for SQLite.
    /// The `project_dir` is used to resolve relative SQLite paths.
    pub async fn from_config(
        cfg: &DatastoreBackendConfig,
        project_dir: &std::path::Path,
    ) -> anyhow::Result<Self> {
        match cfg {
            DatastoreBackendConfig::Sqlite { path } => {
                let resolved = if path.starts_with('/') {
                    std::path::PathBuf::from(path)
                } else {
                    project_dir.join(path)
                };
                let backend = SqliteBackend::open(resolved).await?;
                Ok(DatastoreBackend::Sqlite(backend))
            }
            DatastoreBackendConfig::Postgres { host, port, database, username, password, ssl_mode, schema } => {
                let backend = PostgresBackend::connect(
                    host, *port, database, username,
                    password.as_deref(), ssl_mode, schema,
                ).await?;
                Ok(DatastoreBackend::Postgres(backend))
            }
            DatastoreBackendConfig::Odbc { dsn, connection_string, table, col_tag, col_value, col_ts } => {
                let backend = OdbcBackend::new(
                    dsn.clone(), connection_string.clone(),
                    table.clone(), col_tag.clone(), col_value.clone(), col_ts.clone(),
                ).await;
                Ok(DatastoreBackend::Odbc(backend))
            }
        }
    }

    pub fn kind_str(&self) -> &'static str {
        match self {
            DatastoreBackend::Sqlite(_)   => "sqlite",
            DatastoreBackend::Postgres(_) => "postgres",
            DatastoreBackend::Odbc(_)     => "odbc",
        }
    }

    pub async fn record(&self, tag_id: &str, sample: &Sample) {
        match self {
            DatastoreBackend::Sqlite(b)   => b.record(tag_id, sample).await,
            DatastoreBackend::Postgres(b) => b.record(tag_id, sample).await,
            DatastoreBackend::Odbc(b)     => b.record(tag_id, sample).await,
        }
    }

    pub async fn query(
        &self,
        tag_id: &str,
        from_ms: Option<u64>,
        to_ms: Option<u64>,
    ) -> Vec<Sample> {
        match self {
            DatastoreBackend::Sqlite(b)   => b.query(tag_id, from_ms, to_ms).await,
            DatastoreBackend::Postgres(b) => b.query(tag_id, from_ms, to_ms).await,
            DatastoreBackend::Odbc(b)     => b.query(tag_id, from_ms, to_ms).await,
        }
    }

    /// Verify the connection is alive. Returns Ok(description) or an error.
    pub async fn test(&self) -> anyhow::Result<String> {
        match self {
            DatastoreBackend::Sqlite(b)   => b.test().await,
            DatastoreBackend::Postgres(b) => b.test().await,
            DatastoreBackend::Odbc(b)     => b.test().await,
        }
    }

    pub async fn stats(&self) -> DatastoreStats {
        match self {
            DatastoreBackend::Sqlite(b)   => b.stats().await,
            DatastoreBackend::Postgres(b) => b.stats().await,
            DatastoreBackend::Odbc(b)     => b.stats().await,
        }
    }

    pub async fn purge(
        &self,
        retention_rows: Option<u64>,
        retention_days: Option<u64>,
    ) -> anyhow::Result<u64> {
        match self {
            DatastoreBackend::Sqlite(b)   => b.purge(retention_rows, retention_days).await,
            DatastoreBackend::Postgres(b) => b.purge(retention_rows, retention_days).await,
            DatastoreBackend::Odbc(b)     => b.purge(retention_rows, retention_days).await,
        }
    }

    /// Tag con campioni nel database.
    ///
    /// Implementato per SQLite, che è il caso della gestione database sul
    /// dispositivo. Per Postgres/ODBC si dichiara non supportato invece di
    /// restituire una lista vuota: una lista vuota si leggerebbe come "nessun
    /// tag orfano", che è un'informazione falsa.
    pub async fn tags(&self) -> anyhow::Result<Vec<String>> {
        match self {
            DatastoreBackend::Sqlite(b) => b.tags().await,
            _ => anyhow::bail!("elenco tag supportato solo sui datastore SQLite"),
        }
    }

    /// Cancella lo storico di un tag.
    pub async fn delete_tag(&self, tag: &str) -> anyhow::Result<u64> {
        match self {
            DatastoreBackend::Sqlite(b) => b.delete_tag(tag).await,
            _ => anyhow::bail!("cancellazione per tag supportata solo sui datastore SQLite"),
        }
    }

    /// `VACUUM` + checkpoint WAL. Ritorna (byte prima, byte dopo).
    pub async fn vacuum(&self) -> anyhow::Result<(u64, u64)> {
        match self {
            DatastoreBackend::Sqlite(b) => b.vacuum().await,
            _ => anyhow::bail!("VACUUM è specifico di SQLite"),
        }
    }

    /// Export raw samples for a set of tags in a time range. Used by the CSV
    /// export endpoint. Returns `(tag_id, samples)` pairs.
    pub async fn export(
        &self,
        tags: &[String],
        from_ms: Option<u64>,
        to_ms: Option<u64>,
    ) -> Vec<(String, Vec<Sample>)> {
        match self {
            DatastoreBackend::Sqlite(b)   => b.export(tags, from_ms, to_ms).await,
            DatastoreBackend::Postgres(b) => b.export(tags, from_ms, to_ms).await,
            DatastoreBackend::Odbc(b)     => b.export(tags, from_ms, to_ms).await,
        }
    }
}

/// Helper: current Unix timestamp in milliseconds.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
