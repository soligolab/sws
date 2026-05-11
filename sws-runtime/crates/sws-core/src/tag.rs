use std::{
    collections::HashMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};

pub type TagId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: TagId,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

    pub fn subscribe(&self) -> broadcast::Receiver<TagUpdate> {
        self.tx.subscribe()
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
}
