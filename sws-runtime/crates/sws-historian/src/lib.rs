//! In-memory ring-buffer historian for the PoC, optionally backed by SQLite
//! for durability across restarts.
//!
//! Each tag gets its own bounded `VecDeque<Sample>`. Older samples are dropped
//! when the cap is hit. Range queries filter by `[from_ms, to_ms]`. A spawned
//! recorder task subscribes to `TagDb`'s broadcast and appends every update.
//!
//! When a `SqliteStore` is attached via `Historian::with_sqlite(...)`:
//! - Every `record()` is also persisted (best-effort, non-blocking on errors).
//! - On startup, `Historian::restore_from_sqlite()` reloads up to `max_per_tag`
//!   recent samples per tag from disk into the in-memory ring.
//! - `query()` falls back to SQLite for time ranges older than the in-memory ring.
//! - `prune_older_than_ms()` deletes SQLite rows outside the retention window.
//!
//! Query result decimation: when a query returns more than `DECIMATION_THRESHOLD`
//! samples, the result is thinned to that count using uniform stride sampling.
//! This keeps trend chart rendering fast for wide time windows.
//!
//! Out of scope (later polish):
//! - Deadband / on-change-only filtering — we record every update; plugins
//!   are expected to deduplicate at source if needed.
//! - LTTB (Largest Triangle Three Buckets) decimation — uniform stride is good
//!   enough for the PoC; LTTB preserves extrema better for sparse spiky data.

pub mod sqlite;
pub mod backend;
pub mod sqlite_backend;
pub mod postgres_backend;
pub mod odbc_backend;
pub mod registry;

pub use backend::{DatastoreBackend, DatastoreStats};
pub use registry::DatastoreRegistry;

use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
};
use serde::{Deserialize, Serialize};
use sws_core::{TagDb, TagId, TagQuality, TagState, TagValue};
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::sqlite::SqliteStore;

/// When a query returns more samples than this, the result is decimated to
/// this count via uniform stride. Keeps the trend chart responsive for wide
/// time windows without losing the overall shape of the data.
const DECIMATION_THRESHOLD: usize = 1_000;

/// Thin `samples` to at most `max` points using uniform stride.
/// Keeps the first and last samples so the chart ends are always accurate.
fn decimate(samples: Vec<Sample>, max: usize) -> Vec<Sample> {
    if samples.len() <= max { return samples; }
    let n = samples.len();
    // Always include the first and last; distribute the rest uniformly.
    let stride = (n - 1) as f64 / (max - 1) as f64;
    (0..max)
        .map(|i| samples[((i as f64 * stride).round() as usize).min(n - 1)].clone())
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sample {
    pub ts_ms: u64,
    pub value: TagValue,
    pub quality: TagQuality,
}

pub struct Historian {
    buffers: RwLock<HashMap<TagId, VecDeque<Sample>>>,
    max_per_tag: usize,
    store: Option<SqliteStore>,
}

impl Historian {
    pub fn new(max_per_tag: usize) -> Self {
        Self {
            buffers: RwLock::new(HashMap::new()),
            max_per_tag,
            store: None,
        }
    }

    /// Attach a SQLite store and seed the in-memory ring from disk.
    /// Returns the new Historian so the runtime can build it inline.
    pub async fn with_sqlite(max_per_tag: usize, store: SqliteStore) -> anyhow::Result<Self> {
        let mut h = Self::new(max_per_tag);
        let restored = store.restore_recent(max_per_tag).await?;
        let total: usize = restored.iter().map(|(_, v)| v.len()).sum();
        {
            let mut buf = h.buffers.write().await;
            for (tag, samples) in restored {
                let q: VecDeque<Sample> = samples.into_iter().collect();
                buf.insert(tag, q);
            }
        }
        info!(samples = total, "historian: restored from SQLite");
        h.store = Some(store);
        Ok(h)
    }

    /// Access the underlying SQLite store, if attached.
    pub fn sqlite_store(&self) -> Option<&SqliteStore> {
        self.store.as_ref()
    }

    /// Discard all in-memory samples for all tags.
    /// Called on project open/close to prevent inter-project data leakage.
    /// The SQLite store (if any) is left intact — its data remains on disk.
    pub async fn clear(&self) {
        self.buffers.write().await.clear();
    }

    /// Append a sample for `tag`. Drops the oldest if the cap is hit.
    /// Also persists to SQLite (best-effort) when a store is attached.
    pub async fn record(&self, tag: &str, state: &TagState) {
        let sample = Sample {
            ts_ms: state.timestamp_ms,
            value: state.value.clone(),
            quality: state.quality.clone(),
        };
        {
            let mut buf = self.buffers.write().await;
            let q = buf.entry(tag.to_string()).or_insert_with(VecDeque::new);
            if q.len() >= self.max_per_tag {
                q.pop_front();
            }
            q.push_back(sample.clone());
        }
        if let Some(store) = &self.store {
            store.append(tag, &sample).await;
        }
    }

    /// Return samples in `[from, to]` (inclusive). `None` bounds mean unbounded.
    /// Result is in chronological order with decimation applied when > `DECIMATION_THRESHOLD`.
    ///
    /// When a SQLite store is attached and `from_ms` precedes the oldest in-memory
    /// sample, the missing range is fetched from SQLite and prepended — so the
    /// trend widget can scroll back beyond the ring-buffer window.
    pub async fn query(&self, tag: &str, from_ms: Option<u64>, to_ms: Option<u64>) -> Vec<Sample> {
        let buf = self.buffers.read().await;

        // Collect in-memory samples and note the oldest timestamp in the ring.
        let (mem_samples, oldest_mem_ts): (Vec<Sample>, Option<u64>) = match buf.get(tag) {
            Some(q) => {
                let oldest = q.front().map(|s| s.ts_ms);
                let filtered = q.iter()
                    .filter(|s| from_ms.map_or(true, |f| s.ts_ms >= f))
                    .filter(|s| to_ms.map_or(true, |t| s.ts_ms <= t))
                    .cloned()
                    .collect();
                (filtered, oldest)
            }
            None => (Vec::new(), None),
        };
        drop(buf); // release the read lock before any SQLite I/O

        // SQLite fallback: when from_ms is older than the ring's oldest sample,
        // prepend the gap from disk. Skip when there's no store or no from_ms.
        let mut samples = if let (Some(store), Some(from), Some(oldest)) =
            (&self.store, from_ms, oldest_mem_ts)
        {
            if from < oldest {
                let sqlite_to = oldest.saturating_sub(1);
                let mut older = store.query_range(tag, from, sqlite_to).await;
                older.extend(mem_samples);
                older
            } else {
                mem_samples
            }
        } else {
            mem_samples
        };

        // Decimate when the result exceeds the threshold.
        if samples.len() > DECIMATION_THRESHOLD {
            samples = decimate(samples, DECIMATION_THRESHOLD);
        }

        samples
    }

    /// Delete SQLite samples older than `cutoff_ms`.
    /// No-op when no SQLite store is attached.
    pub async fn prune_older_than_ms(&self, cutoff_ms: u64) {
        if let Some(store) = &self.store {
            match store.prune_older_than_ms(cutoff_ms).await {
                Ok(n) if n > 0 => info!(rows = n, "historian: pruned old SQLite samples"),
                Ok(_)          => {}
                Err(e)         => warn!("historian: prune failed: {e}"),
            }
        }
    }

    /// Spawn a recorder task that subscribes to `tag_db` and records every update.
    /// Returns the JoinHandle in case the runtime wants to abort on shutdown.
    pub fn spawn_recorder(self: Arc<Self>, tag_db: Arc<TagDb>) -> tokio::task::JoinHandle<()> {
        let mut rx = tag_db.subscribe();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(update) => self.record(&update.id, &update.state).await,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        warn!("historian recorder lagged by {n}");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(ts: u64, v: f64) -> TagState {
        TagState { value: TagValue::Float(v), quality: TagQuality::Good, timestamp_ms: ts }
    }

    #[tokio::test]
    async fn record_and_query() {
        let h = Historian::new(100);
        h.record("t", &st(10, 1.0)).await;
        h.record("t", &st(20, 2.0)).await;
        h.record("t", &st(30, 3.0)).await;
        let all = h.query("t", None, None).await;
        assert_eq!(all.len(), 3);
        let mid = h.query("t", Some(15), Some(25)).await;
        assert_eq!(mid.len(), 1);
        assert_eq!(mid[0].ts_ms, 20);
    }

    #[tokio::test]
    async fn ring_drops_oldest() {
        let h = Historian::new(2);
        h.record("t", &st(10, 1.0)).await;
        h.record("t", &st(20, 2.0)).await;
        h.record("t", &st(30, 3.0)).await;
        let all = h.query("t", None, None).await;
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].ts_ms, 20);
        assert_eq!(all[1].ts_ms, 30);
    }

    #[tokio::test]
    async fn unknown_tag_returns_empty() {
        let h = Historian::new(10);
        assert!(h.query("nope", None, None).await.is_empty());
    }

    #[test]
    fn decimate_keeps_first_and_last() {
        let samples: Vec<Sample> = (0..100u64)
            .map(|i| Sample { ts_ms: i, value: TagValue::Float(i as f64), quality: TagQuality::Good })
            .collect();
        let out = decimate(samples, 10);
        assert_eq!(out.len(), 10);
        assert_eq!(out[0].ts_ms, 0);
        assert_eq!(out[9].ts_ms, 99);
    }

    #[test]
    fn decimate_noop_when_under_threshold() {
        let samples: Vec<Sample> = (0..5u64)
            .map(|i| Sample { ts_ms: i, value: TagValue::Float(i as f64), quality: TagQuality::Good })
            .collect();
        let out = decimate(samples, 10);
        assert_eq!(out.len(), 5);
    }

    #[tokio::test]
    async fn query_decimates_large_result() {
        let h = Historian::new(2_000);
        for i in 0..1_200u64 {
            h.record("t", &TagState { value: TagValue::Float(i as f64), quality: TagQuality::Good, timestamp_ms: i }).await;
        }
        let all = h.query("t", None, None).await;
        assert!(all.len() <= DECIMATION_THRESHOLD, "expected decimation, got {}", all.len());
        // First and last should be preserved
        assert_eq!(all[0].ts_ms, 0);
        assert_eq!(all.last().unwrap().ts_ms, 1_199);
    }
}
