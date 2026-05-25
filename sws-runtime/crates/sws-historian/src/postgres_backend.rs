//! PostgreSQL datastore backend using `tokio-postgres`.
//!
//! Schema (created on first connect):
//!   CREATE TABLE IF NOT EXISTS sws_samples (
//!     tag_id  TEXT   NOT NULL,
//!     ts_ms   BIGINT NOT NULL,
//!     value   DOUBLE PRECISION,
//!     quality TEXT   NOT NULL DEFAULT 'Good',
//!     PRIMARY KEY (tag_id, ts_ms)
//!   );
//!
//! TimescaleDB hypertable is attempted on first connect (best-effort, non-fatal
//! when TimescaleDB is not installed).
//!
//! Connection model: one persistent `tokio_postgres::Client` per backend.
//! When a query/insert fails, the backend marks itself disconnected and
//! tries to reconnect on the next operation. SCADA historian write rates
//! (1-10 writes/s per tag) don't warrant a full connection pool.

use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_postgres::{Client, NoTls};
use tracing::{info, warn};

use crate::backend::{DatastoreStats, now_ms};
use crate::Sample;
use sws_core::{TagQuality, TagValue};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS sws_samples (
    tag_id  TEXT   NOT NULL,
    ts_ms   BIGINT NOT NULL,
    value   DOUBLE PRECISION,
    quality TEXT   NOT NULL DEFAULT 'Good',
    PRIMARY KEY (tag_id, ts_ms)
);
CREATE INDEX IF NOT EXISTS idx_sws_samples_tag_ts ON sws_samples (tag_id, ts_ms);
";

/// Internal mutable state under a mutex.
struct Inner {
    client: Option<Client>,
}

pub struct PostgresBackend {
    connect_str: String,
    inner: Arc<Mutex<Inner>>,
}

impl PostgresBackend {
    pub async fn connect(
        host: &str,
        port: u16,
        database: &str,
        username: &str,
        password: Option<&str>,
        _ssl_mode: &str,
        schema: &str,
    ) -> anyhow::Result<Self> {
        let connect_str = build_connect_str(host, port, database, username, password);
        let client = connect_and_init(&connect_str, schema).await?;
        info!(host, port, database, "postgres: backend connected");
        Ok(Self {
            connect_str,
            inner: Arc::new(Mutex::new(Inner { client: Some(client) })),
        })
    }

    /// Get a live client, reconnecting if the previous one was dropped.
    async fn get_client(&self) -> Option<tokio::sync::MutexGuard<'_, Inner>> {
        let mut g = self.inner.lock().await;
        if g.client.is_none() {
            // Attempt reconnect.
            match connect_and_init(&self.connect_str, "public").await {
                Ok(c) => {
                    info!("postgres: reconnected");
                    g.client = Some(c);
                }
                Err(e) => {
                    warn!("postgres: reconnect failed: {e}");
                    return None;
                }
            }
        }
        Some(g)
    }

    pub async fn record(&self, tag_id: &str, sample: &Sample) {
        let value_f64 = match &sample.value {
            TagValue::Float(v) => *v,
            TagValue::Int(v)   => *v as f64,
            TagValue::Bool(v)  => if *v { 1.0 } else { 0.0 },
            TagValue::Str(_)   => return,
        };
        let quality = match sample.quality {
            TagQuality::Good      => "Good",
            TagQuality::Bad       => "Bad",
            TagQuality::Uncertain => "Uncertain",
        };
        let Some(mut g) = self.get_client().await else { return };
        let client = g.client.as_ref().unwrap();
        if let Err(e) = client.execute(
            "INSERT INTO sws_samples (tag_id, ts_ms, value, quality) \
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
            &[&tag_id, &(sample.ts_ms as i64), &value_f64, &quality],
        ).await {
            warn!("postgres: insert failed: {e}");
            g.client = None; // mark disconnected
        }
    }

    pub async fn query(
        &self,
        tag_id: &str,
        from_ms: Option<u64>,
        to_ms: Option<u64>,
    ) -> Vec<Sample> {
        let from = from_ms.unwrap_or(0) as i64;
        let to   = to_ms.map(|v| v as i64).unwrap_or(i64::MAX);
        let Some(mut g) = self.get_client().await else { return vec![] };
        let client = g.client.as_ref().unwrap();
        match client.query(
            "SELECT ts_ms, value, quality FROM sws_samples \
             WHERE tag_id = $1 AND ts_ms >= $2 AND ts_ms <= $3 \
             ORDER BY ts_ms ASC",
            &[&tag_id, &from, &to],
        ).await {
            Ok(rows) => rows.iter().map(|r| {
                let ts: i64  = r.get(0);
                let val: f64 = r.get(1);
                let q: &str  = r.get(2);
                Sample {
                    ts_ms: ts as u64,
                    value: TagValue::Float(val),
                    quality: match q {
                        "Good" => TagQuality::Good,
                        "Bad"  => TagQuality::Bad,
                        _      => TagQuality::Uncertain,
                    },
                }
            }).collect(),
            Err(e) => {
                warn!("postgres: query failed: {e}");
                g.client = None;
                vec![]
            }
        }
    }

    pub async fn test(&self) -> anyhow::Result<String> {
        match connect_and_init(&self.connect_str, "public").await {
            Ok(client) => {
                let row = client.query_one("SELECT version()", &[]).await?;
                let ver: &str = row.get(0);
                // Swap in the fresh client.
                self.inner.lock().await.client = Some(client);
                Ok(format!("PostgreSQL OK — {}", ver.lines().next().unwrap_or(ver)))
            }
            Err(e) => Err(e),
        }
    }

    pub async fn stats(&self) -> DatastoreStats {
        let Some(g) = self.get_client().await else {
            return DatastoreStats {
                kind: "postgres", tag_count: 0, sample_count: 0,
                oldest_ms: None, newest_ms: None, size_bytes: None,
                connected: false,
                error: Some("disconnected".into()),
            };
        };
        let client = g.client.as_ref().unwrap();
        let (sc, tc, old, new, sz) = async {
            let sc: i64 = client.query_one("SELECT COUNT(*) FROM sws_samples", &[])
                .await.ok().map(|r| r.get(0)).unwrap_or(0);
            let tc: i64 = client.query_one("SELECT COUNT(DISTINCT tag_id) FROM sws_samples", &[])
                .await.ok().map(|r| r.get(0)).unwrap_or(0);
            let old: Option<i64> = client.query_one("SELECT MIN(ts_ms) FROM sws_samples", &[])
                .await.ok().and_then(|r| r.try_get(0).ok());
            let new: Option<i64> = client.query_one("SELECT MAX(ts_ms) FROM sws_samples", &[])
                .await.ok().and_then(|r| r.try_get(0).ok());
            let sz: Option<i64> = client.query_one(
                "SELECT pg_total_relation_size('sws_samples')", &[],
            ).await.ok().map(|r| r.get(0));
            (sc, tc, old, new, sz)
        }.await;
        DatastoreStats {
            kind: "postgres",
            tag_count: tc as u64,
            sample_count: sc as u64,
            oldest_ms: old.map(|v| v as u64),
            newest_ms: new.map(|v| v as u64),
            size_bytes: sz.map(|v| v as u64),
            connected: true,
            error: None,
        }
    }

    pub async fn purge(
        &self,
        retention_rows: Option<u64>,
        retention_days: Option<u64>,
    ) -> anyhow::Result<u64> {
        let g = self.get_client().await
            .ok_or_else(|| anyhow::anyhow!("postgres: disconnected"))?;
        let client = g.client.as_ref().unwrap();
        let mut deleted = 0u64;
        if let Some(days) = retention_days {
            let cutoff = now_ms().saturating_sub(days * 86_400_000) as i64;
            deleted += client.execute("DELETE FROM sws_samples WHERE ts_ms < $1", &[&cutoff])
                .await.unwrap_or(0);
        }
        if let Some(max_rows) = retention_rows {
            let n = client.execute(
                "DELETE FROM sws_samples WHERE (tag_id, ts_ms) IN (
                    SELECT tag_id, ts_ms FROM (
                        SELECT tag_id, ts_ms,
                               ROW_NUMBER() OVER (PARTITION BY tag_id ORDER BY ts_ms DESC) AS rn
                        FROM sws_samples
                    ) sub WHERE rn > $1
                )",
                &[&(max_rows as i64)],
            ).await.unwrap_or(0);
            deleted += n;
        }
        Ok(deleted)
    }

    pub async fn export(
        &self,
        tags: &[String],
        from_ms: Option<u64>,
        to_ms: Option<u64>,
    ) -> Vec<(String, Vec<Sample>)> {
        let mut out = Vec::new();
        for tag in tags {
            out.push((tag.clone(), self.query(tag, from_ms, to_ms).await));
        }
        out
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn build_connect_str(
    host: &str, port: u16, database: &str,
    username: &str, password: Option<&str>,
) -> String {
    let mut s = format!("host={host} port={port} dbname={database} user={username}");
    if let Some(p) = password { s.push_str(&format!(" password={p}")); }
    s
}

async fn connect_and_init(connect_str: &str, schema: &str) -> anyhow::Result<Client> {
    let (client, connection) = tokio_postgres::connect(connect_str, NoTls).await
        .map_err(|e| anyhow::anyhow!("postgres connect: {e}"))?;
    // Drive the connection in a background task — it ends when the client is dropped.
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            warn!("postgres: connection closed: {e}");
        }
    });
    client.batch_execute(&format!("SET search_path TO \"{schema}\",public"))
        .await.map_err(|e| anyhow::anyhow!("search_path: {e}"))?;
    client.batch_execute(SCHEMA)
        .await.map_err(|e| anyhow::anyhow!("schema init: {e}"))?;
    // Best-effort TimescaleDB.
    if let Err(e) = client.execute(
        "SELECT create_hypertable('sws_samples','ts_ms',if_not_exists => TRUE)", &[],
    ).await {
        info!("postgres: TimescaleDB not available ({e}), using plain table");
    }
    Ok(client)
}
