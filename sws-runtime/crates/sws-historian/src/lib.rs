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
//!
//! Out of scope (later polish):
//! - Deadband / on-change-only filtering — we record every update; plugins
//!   are expected to deduplicate at source if needed.
//! - Decimation for long-range queries; we just slice the buffer.
//! - Read-fallback to SQLite for ranges older than the in-memory window.

pub mod sqlite;

use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
};
use serde::{Deserialize, Serialize};
use sws_core::{TagDb, TagId, TagQuality, TagState, TagValue};
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::sqlite::SqliteStore;

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
    /// Result is in chronological order.
    pub async fn query(&self, tag: &str, from_ms: Option<u64>, to_ms: Option<u64>) -> Vec<Sample> {
        let buf = self.buffers.read().await;
        let Some(q) = buf.get(tag) else { return Vec::new() };
        q.iter()
            .filter(|s| from_ms.map_or(true, |f| s.ts_ms >= f))
            .filter(|s| to_ms.map_or(true, |t| s.ts_ms <= t))
            .cloned()
            .collect()
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
}
