//! SQLite append-only log behind the in-memory ring buffer.
//!
//! Layout: one row per sample, indexed by (tag, ts_ms). The Historian
//! writes every sample here as well as into RAM; on startup it loads the
//! most-recent `max_per_tag` samples per tag back into RAM so the trend
//! object has data immediately after a runtime restart.
//!
//! Reads for trend queries still go to the in-memory ring (fast, no I/O
//! on the hot path). Falling back to SQLite for ranges older than the
//! ring's window is a follow-up.
//!
//! All rusqlite calls run on `tokio::task::spawn_blocking` because the
//! library is sync; the wrapper hides the boilerplate.

use std::{path::PathBuf, sync::Arc};
use rusqlite::{params, Connection, OptionalExtension};
use sws_core::{TagQuality, TagValue};
use tokio::{sync::Mutex, task};
use tracing::{info, warn};

use crate::Sample;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS samples (
    tag       TEXT    NOT NULL,
    ts_ms     INTEGER NOT NULL,
    value     TEXT    NOT NULL,  -- JSON-encoded TagValue
    quality   TEXT    NOT NULL,  -- "Good" | "Bad" | "Uncertain"
    PRIMARY KEY (tag, ts_ms)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts_ms);
"#;

/// Thin async wrapper around a single SQLite connection.
/// The PoC uses one connection serialised by a tokio Mutex — write rate is
/// low enough (one record per tag update) that contention is not a concern.
#[derive(Clone)]
pub struct SqliteStore {
    conn: Arc<Mutex<Connection>>,
    path: PathBuf,
}

impl SqliteStore {
    /// Open (creating if absent) a SQLite db at `path` and prepare the schema.
    pub async fn open(path: impl Into<PathBuf>) -> anyhow::Result<Self> {
        let path = path.into();
        let path_for_open = path.clone();
        let conn = task::spawn_blocking(move || -> anyhow::Result<Connection> {
            if let Some(parent) = path_for_open.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let c = Connection::open(&path_for_open)?;
            // WAL mode keeps reads (restore) unblocked by writes (recording).
            c.pragma_update(None, "journal_mode", &"WAL")?;
            c.pragma_update(None, "synchronous", &"NORMAL")?;
            c.execute_batch(SCHEMA)?;
            Ok(c)
        }).await??;
        info!(path = %path.display(), "historian: SQLite store opened");
        Ok(Self { conn: Arc::new(Mutex::new(conn)), path })
    }

    pub fn path(&self) -> &std::path::Path { &self.path }

    /// Append one sample. Best-effort: errors are logged, not propagated, so
    /// a transient disk hiccup never breaks the live tag stream.
    pub async fn append(&self, tag: &str, sample: &Sample) {
        let conn = self.conn.clone();
        let tag = tag.to_string();
        let ts = sample.ts_ms as i64;
        let value = serde_json::to_string(&sample.value)
            .unwrap_or_else(|_| "null".to_string());
        let quality = match sample.quality {
            TagQuality::Good      => "Good",
            TagQuality::Bad       => "Bad",
            TagQuality::Uncertain => "Uncertain",
        };
        let res = task::spawn_blocking(move || -> rusqlite::Result<()> {
            let c = conn.blocking_lock();
            c.execute(
                "INSERT OR REPLACE INTO samples (tag, ts_ms, value, quality) VALUES (?1, ?2, ?3, ?4)",
                params![tag, ts, value, quality],
            )?;
            Ok(())
        }).await;
        match res {
            Ok(Ok(())) => {}
            Ok(Err(e)) => warn!("historian: sqlite append failed: {e}"),
            Err(e)     => warn!("historian: sqlite append task panicked: {e}"),
        }
    }

    /// Load up to `limit` most-recent samples per tag from SQLite.
    /// Returns a map `tag → samples` (chronological order within each).
    pub async fn restore_recent(&self, limit: usize)
        -> anyhow::Result<Vec<(String, Vec<Sample>)>>
    {
        let conn = self.conn.clone();
        let out = task::spawn_blocking(move || -> rusqlite::Result<Vec<(String, Vec<Sample>)>> {
            let c = conn.blocking_lock();

            // Distinct tags first
            let mut tags: Vec<String> = Vec::new();
            {
                let mut stmt = c.prepare("SELECT DISTINCT tag FROM samples")?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
                for r in rows { tags.push(r?); }
            }

            let mut out: Vec<(String, Vec<Sample>)> = Vec::with_capacity(tags.len());
            for tag in tags {
                let mut stmt = c.prepare(
                    "SELECT ts_ms, value, quality
                       FROM samples
                      WHERE tag = ?1
                      ORDER BY ts_ms DESC
                      LIMIT ?2"
                )?;
                let rows = stmt.query_map(params![tag, limit as i64], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
                })?;
                let mut samples: Vec<Sample> = Vec::new();
                for r in rows {
                    let (ts, value_json, q) = r?;
                    let value: TagValue = serde_json::from_str(&value_json)
                        .unwrap_or(TagValue::Float(0.0));
                    let quality = match q.as_str() {
                        "Good" => TagQuality::Good,
                        "Bad"  => TagQuality::Bad,
                        _      => TagQuality::Uncertain,
                    };
                    samples.push(Sample { ts_ms: ts as u64, value, quality });
                }
                // Restore chronological order (we fetched DESC for the LIMIT)
                samples.reverse();
                out.push((tag, samples));
            }
            Ok(out)
        }).await??;
        Ok(out)
    }

    /// Fetch all samples for a tag in `[from_ms, to_ms]` (inclusive),
    /// ordered chronologically. Used by `Historian::query` as a fallback
    /// for ranges older than the in-memory ring.
    pub async fn query_range(&self, tag: &str, from_ms: u64, to_ms: u64) -> Vec<Sample> {
        let conn  = self.conn.clone();
        let tag   = tag.to_string();
        let res = task::spawn_blocking(move || -> rusqlite::Result<Vec<Sample>> {
            let c = conn.blocking_lock();
            let mut stmt = c.prepare(
                "SELECT ts_ms, value, quality
                   FROM samples
                  WHERE tag = ?1 AND ts_ms >= ?2 AND ts_ms <= ?3
                  ORDER BY ts_ms ASC",
            )?;
            let rows = stmt.query_map(
                params![tag, from_ms as i64, to_ms as i64],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
            )?;
            let mut samples = Vec::new();
            for r in rows {
                let (ts, value_json, q) = r?;
                let value: TagValue = serde_json::from_str(&value_json)
                    .unwrap_or(TagValue::Float(0.0));
                let quality = match q.as_str() {
                    "Good" => TagQuality::Good,
                    "Bad"  => TagQuality::Bad,
                    _      => TagQuality::Uncertain,
                };
                samples.push(Sample { ts_ms: ts as u64, value, quality });
            }
            Ok(samples)
        }).await;
        match res {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => { warn!("historian: query_range db error: {e}"); vec![] }
            Err(e)     => { warn!("historian: query_range task panicked: {e}"); vec![] }
        }
    }

    /// Delete all samples older than `cutoff_ms`.
    /// Returns the number of rows deleted.
    pub async fn prune_older_than_ms(&self, cutoff_ms: u64) -> anyhow::Result<usize> {
        let conn = self.conn.clone();
        let n = task::spawn_blocking(move || -> rusqlite::Result<usize> {
            let c = conn.blocking_lock();
            Ok(c.execute("DELETE FROM samples WHERE ts_ms < ?1", params![cutoff_ms as i64])?)
        }).await??;
        Ok(n)
    }

    /// Sample count across all tags (mostly for /metrics later).
    pub async fn total_samples(&self) -> anyhow::Result<i64> {
        let conn = self.conn.clone();
        let n = task::spawn_blocking(move || -> rusqlite::Result<i64> {
            let c = conn.blocking_lock();
            c.query_row("SELECT COUNT(*) FROM samples", [], |r| r.get(0))
                .optional()
                .map(|v| v.unwrap_or(0))
        }).await??;
        Ok(n)
    }

    /// Aggregate stats: (sample_count, oldest_ms, newest_ms, size_bytes, tag_count).
    pub async fn full_stats(&self) -> anyhow::Result<(u64, Option<u64>, Option<u64>, Option<u64>, u64)> {
        let conn = self.conn.clone();
        let path = self.path.clone();
        task::spawn_blocking(move || -> anyhow::Result<(u64, Option<u64>, Option<u64>, Option<u64>, u64)> {
            let c = conn.blocking_lock();
            let sample_count: i64 = c
                .query_row("SELECT COUNT(*) FROM samples", [], |r| r.get(0))
                .optional()?.unwrap_or(0);
            let oldest_ms: Option<i64> = c
                .query_row("SELECT MIN(ts_ms) FROM samples", [], |r| r.get(0))
                .optional()?.flatten();
            let newest_ms: Option<i64> = c
                .query_row("SELECT MAX(ts_ms) FROM samples", [], |r| r.get(0))
                .optional()?.flatten();
            let tag_count: i64 = c
                .query_row("SELECT COUNT(DISTINCT tag) FROM samples", [], |r| r.get(0))
                .optional()?.unwrap_or(0);
            let size_bytes = std::fs::metadata(&path).ok().map(|m| m.len());
            Ok((
                sample_count as u64,
                oldest_ms.map(|v| v as u64),
                newest_ms.map(|v| v as u64),
                size_bytes,
                tag_count as u64,
            ))
        }).await?
    }

    /// Delete excess rows per tag, keeping only the `max_rows` most-recent.
    /// Returns total rows deleted.
    pub async fn prune_excess_rows(&self, max_rows: u64) -> anyhow::Result<u64> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<u64> {
            let c = conn.blocking_lock();
            let mut tags: Vec<String> = Vec::new();
            {
                let mut stmt = c.prepare("SELECT DISTINCT tag FROM samples")?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
                for r in rows { tags.push(r?); }
            }
            let mut deleted = 0u64;
            for tag in &tags {
                let count: i64 = c.query_row(
                    "SELECT COUNT(*) FROM samples WHERE tag = ?1",
                    params![tag], |r| r.get(0),
                ).optional()?.unwrap_or(0);
                if count as u64 > max_rows {
                    let cutoff: i64 = c.query_row(
                        "SELECT ts_ms FROM samples WHERE tag = ?1 ORDER BY ts_ms DESC LIMIT 1 OFFSET ?2",
                        params![tag, max_rows as i64],
                        |r| r.get(0),
                    )?;
                    let n = c.execute(
                        "DELETE FROM samples WHERE tag = ?1 AND ts_ms <= ?2",
                        params![tag, cutoff],
                    )?;
                    deleted += n as u64;
                }
            }
            Ok(deleted)
        }).await?
    }
}
