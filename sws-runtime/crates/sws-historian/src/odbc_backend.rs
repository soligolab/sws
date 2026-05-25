//! ODBC datastore backend — stub implementation.
//!
//! Full ODBC wiring (via `odbc-api` + unixODBC) is deferred until a concrete
//! SQL Server / Oracle target is confirmed for the PoC.  All methods return a
//! clear "not compiled in" error so the rest of the stack compiles and the UI
//! can display a meaningful status message.
//!
//! To enable: add `odbc-api` to Cargo.toml, uncomment the feature gate here,
//! and implement the sync helpers under `cfg(feature = "odbc")`.

use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::warn;

use crate::backend::DatastoreStats;
use crate::Sample;

#[allow(dead_code)]
pub struct OdbcBackend {
    dsn: Option<String>,
    connection_string: Option<String>,
    table: String,
    col_tag: String,
    col_value: String,
    col_ts: String,
    connected: Arc<RwLock<bool>>,
}

impl OdbcBackend {
    pub async fn new(
        dsn: Option<String>,
        connection_string: Option<String>,
        table: String,
        col_tag: String,
        col_value: String,
        col_ts: String,
    ) -> Self {
        Self {
            dsn, connection_string, table, col_tag, col_value, col_ts,
            connected: Arc::new(RwLock::new(false)),
        }
    }

    fn target_label(&self) -> String {
        self.dsn.as_deref()
            .or(self.connection_string.as_deref())
            .unwrap_or("<no DSN/connection string>")
            .to_string()
    }

    pub async fn record(&self, _tag_id: &str, _sample: &Sample) {
        warn!("odbc: record ignored — ODBC backend not compiled in");
    }

    pub async fn query(&self, _tag_id: &str, _from_ms: Option<u64>, _to_ms: Option<u64>) -> Vec<Sample> {
        vec![]
    }

    pub async fn test(&self) -> anyhow::Result<String> {
        anyhow::bail!(
            "ODBC backend not compiled in (target: {}). \
             Add `odbc-api` to Cargo.toml and reinstall unixODBC to enable.",
            self.target_label()
        )
    }

    pub async fn stats(&self) -> DatastoreStats {
        DatastoreStats {
            kind: "odbc",
            tag_count: 0,
            sample_count: 0,
            oldest_ms: None,
            newest_ms: None,
            size_bytes: None,
            connected: false,
            error: Some(format!(
                "ODBC not compiled in (target: {})",
                self.target_label()
            )),
        }
    }

    pub async fn purge(
        &self,
        _retention_rows: Option<u64>,
        _retention_days: Option<u64>,
    ) -> anyhow::Result<u64> {
        anyhow::bail!("ODBC backend not compiled in")
    }

    pub async fn export(
        &self,
        _tags: &[String],
        _from_ms: Option<u64>,
        _to_ms: Option<u64>,
    ) -> Vec<(String, Vec<Sample>)> {
        vec![]
    }
}
