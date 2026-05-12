use std::{
    collections::HashMap,
    fmt,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc, RwLock};

pub type TagId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: TagId,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)] // serializes as native JSON: true / 42 / 3.14 / "hello"
pub enum TagValue {
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TagQuality {
    Good,
    Bad,
    Uncertain,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagState {
    pub value: TagValue,
    pub quality: TagQuality,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagUpdate {
    pub id: TagId,
    pub state: TagState,
}

pub struct TagDb {
    store: Arc<RwLock<HashMap<TagId, TagState>>>,
    tx: broadcast::Sender<TagUpdate>,
}

impl TagDb {
    pub fn new(channel_capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(channel_capacity);
        Self {
            store: Arc::new(RwLock::new(HashMap::new())),
            tx,
        }
    }

    pub async fn set(&self, id: TagId, value: TagValue, quality: TagQuality) {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let state = TagState { value, quality, timestamp_ms: ts };
        self.store.write().await.insert(id.clone(), state.clone());
        let _ = self.tx.send(TagUpdate { id, state }); // no subscribers is fine
    }

    pub async fn get(&self, id: &str) -> Option<TagState> {
        self.store.read().await.get(id).cloned()
    }

    /// Remove a tag from the store. Returns `true` if the tag existed.
    /// Used by hot-reload to evict orphans after a project edit.
    /// Note: no "removed" event is broadcast — clients reconcile on next snapshot.
    pub async fn remove(&self, id: &str) -> bool {
        self.store.write().await.remove(id).is_some()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<TagUpdate> {
        self.tx.subscribe()
    }

    pub async fn snapshot(&self) -> HashMap<TagId, TagState> {
        self.store.read().await.clone()
    }
}

// ── TagWriteBus ──────────────────────────────────────────────────────────────
//
// Routes "write this value" requests to the plugin that owns the tag.
// Plugins register a sender per tag at startup; the API handler calls
// `write()` and the value is delivered to the owning plugin's mpsc receiver,
// which talks to the field device. If no plugin owns the tag, the bus
// returns `NoWriter` — the caller may then choose to update TagDb directly
// (useful for "virtual" tags with no source).

#[derive(Debug)]
pub enum WriteError {
    NoWriter(TagId),
    ChannelClosed(TagId),
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WriteError::NoWriter(t)      => write!(f, "no writer registered for tag '{t}'"),
            WriteError::ChannelClosed(t) => write!(f, "write channel for tag '{t}' closed"),
        }
    }
}

impl std::error::Error for WriteError {}

/// One write request flowing through the bus: which tag, what value.
/// A single plugin can own many tags by sharing one receiver and one
/// sender clone across its routes.
pub type WriteRequest = (TagId, TagValue);

pub struct TagWriteBus {
    routes: RwLock<HashMap<TagId, mpsc::Sender<WriteRequest>>>,
}

impl Default for TagWriteBus {
    fn default() -> Self { Self::new() }
}

impl TagWriteBus {
    pub fn new() -> Self {
        Self { routes: RwLock::new(HashMap::new()) }
    }

    /// A plugin that owns `tag_id` registers its sender. Latest registration wins
    /// (so a runtime reload that re-spawns a plugin replaces the stale entry).
    pub async fn register(&self, tag_id: TagId, sender: mpsc::Sender<WriteRequest>) {
        self.routes.write().await.insert(tag_id, sender);
    }

    /// Forward a write to the plugin that owns the tag.
    /// Returns `NoWriter` if the tag is not registered (caller decides fallback).
    pub async fn write(&self, tag_id: &str, value: TagValue) -> Result<(), WriteError> {
        let sender = {
            let routes = self.routes.read().await;
            routes.get(tag_id).cloned()
        };
        match sender {
            None => Err(WriteError::NoWriter(tag_id.to_string())),
            Some(s) => s.send((tag_id.to_string(), value)).await
                .map_err(|_| WriteError::ChannelClosed(tag_id.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn set_and_get() {
        let db = TagDb::new(16);
        db.set("pump1.speed".into(), TagValue::Float(42.5), TagQuality::Good).await;
        let s = db.get("pump1.speed").await.unwrap();
        assert_eq!(s.value, TagValue::Float(42.5));
        assert_eq!(s.quality, TagQuality::Good);
    }

    #[tokio::test]
    async fn subscribe_receives_update() {
        let db = TagDb::new(16);
        let mut rx = db.subscribe();
        db.set("valve1.open".into(), TagValue::Bool(true), TagQuality::Good).await;
        let upd = rx.recv().await.unwrap();
        assert_eq!(upd.id, "valve1.open");
        assert_eq!(upd.state.value, TagValue::Bool(true));
    }

    #[tokio::test]
    async fn write_bus_routes_to_owner() {
        let bus = TagWriteBus::new();
        let (tx, mut rx) = mpsc::channel(8);
        bus.register("pump1.speed".into(), tx).await;
        bus.write("pump1.speed", TagValue::Float(75.0)).await.unwrap();
        let got = rx.recv().await.unwrap();
        assert_eq!(got, ("pump1.speed".to_string(), TagValue::Float(75.0)));
    }

    #[tokio::test]
    async fn write_bus_unknown_tag_returns_no_writer() {
        let bus = TagWriteBus::new();
        let err = bus.write("nope", TagValue::Bool(true)).await.unwrap_err();
        assert!(matches!(err, WriteError::NoWriter(_)));
    }
}
