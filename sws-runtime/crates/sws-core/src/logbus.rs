//! In-memory log bus — keeps the last N tracing events in a ring buffer
//! and re-broadcasts every new one to live subscribers.
//!
//! Wire shape (`LogEvent`) is what the UI eats:
//! `{ ts_ms, level: "INFO", target: "sws_plugin_mqtt", message: "...", fields: {...} }`.
//!
//! The bus itself only stores and broadcasts. The bridge from
//! `tracing::Event` → `LogEvent` lives in `sws-runtime/src/log_layer.rs`
//! to keep `sws-core` free of a `tracing-subscriber` dependency.

use std::{
    collections::VecDeque,
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

/// One captured `tracing::Event`. Fields beyond `message` are flattened
/// into the JSON map so the frontend can render them later without
/// schema churn.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LogEvent {
    pub ts_ms:   u64,
    pub level:   String, // "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR"
    pub target:  String,
    pub message: String,
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub fields:  serde_json::Map<String, serde_json::Value>,
}

/// Default ring-buffer + broadcast capacity. Sized for ~30 s at 30 ev/s
/// or a slow boot trace, whichever comes first.
pub const DEFAULT_LOG_CAPACITY: usize = 1000;

pub struct LogBus {
    cap:    usize,
    buffer: Mutex<VecDeque<LogEvent>>,
    tx:     broadcast::Sender<LogEvent>,
}

impl LogBus {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity.max(16));
        Self {
            cap:    capacity,
            buffer: Mutex::new(VecDeque::with_capacity(capacity)),
            tx,
        }
    }

    /// Push one event. Pruned to `cap` from the front. Broadcast errors
    /// (no subscribers) are ignored — the ring buffer is the source of
    /// truth for late joiners.
    pub fn record(&self, ev: LogEvent) {
        if let Ok(mut q) = self.buffer.lock() {
            if q.len() >= self.cap {
                q.pop_front();
            }
            q.push_back(ev.clone());
        }
        let _ = self.tx.send(ev);
    }

    /// Snapshot of every event currently in the ring, oldest first.
    pub fn snapshot(&self) -> Vec<LogEvent> {
        self.buffer
            .lock()
            .map(|q| q.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<LogEvent> {
        self.tx.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(msg: &str) -> LogEvent {
        LogEvent {
            ts_ms:   1,
            level:   "INFO".into(),
            target:  "test".into(),
            message: msg.into(),
            fields:  Default::default(),
        }
    }

    #[test]
    fn ring_evicts_oldest() {
        let bus = LogBus::new(3);
        bus.record(ev("a"));
        bus.record(ev("b"));
        bus.record(ev("c"));
        bus.record(ev("d"));
        let snap = bus.snapshot();
        assert_eq!(snap.len(), 3);
        assert_eq!(snap[0].message, "b");
        assert_eq!(snap[2].message, "d");
    }

    #[tokio::test]
    async fn broadcast_delivers_live() {
        let bus = LogBus::new(10);
        let mut rx = bus.subscribe();
        bus.record(ev("hello"));
        let got = rx.recv().await.unwrap();
        assert_eq!(got.message, "hello");
    }
}
