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

/// Scaling lineare raw→eng di un tag (F1, piano SCADA-widgets). Definito in
/// `TagDef` (raw_min/raw_max/eng_min/eng_max), installato a ogni apertura di
/// progetto via `TagDb::set_scales`.
#[derive(Debug, Clone, Copy)]
pub struct LinearScale {
    pub raw_min: f64,
    pub raw_max: f64,
    pub eng_min: f64,
    pub eng_max: f64,
}

impl LinearScale {
    pub fn to_eng(&self, raw: f64) -> f64 {
        if self.raw_max == self.raw_min { return raw; }
        self.eng_min + (raw - self.raw_min) * (self.eng_max - self.eng_min) / (self.raw_max - self.raw_min)
    }
    pub fn to_raw(&self, eng: f64) -> f64 {
        if self.eng_max == self.eng_min { return eng; }
        self.raw_min + (eng - self.eng_min) * (self.raw_max - self.raw_min) / (self.eng_max - self.eng_min)
    }
}

pub struct TagDb {
    store: Arc<RwLock<HashMap<TagId, TagState>>>,
    tx: broadcast::Sender<TagUpdate>,
    /// Scaling per-tag applicato SOLO da `ingest()` (plugin di protocollo).
    scales: Arc<RwLock<HashMap<TagId, LinearScale>>>,
    /// Ruolo minimo di scrittura per-tag (`TagDef.write_min_role`, F3.1).
    /// Stringhe grezze: sws-core non conosce i tipi di sws-auth — il web
    /// layer le interpreta. Aggiornata insieme a `scales`.
    write_roles: Arc<RwLock<HashMap<TagId, String>>>,
}

impl TagDb {
    pub fn new(channel_capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(channel_capacity);
        Self {
            store: Arc::new(RwLock::new(HashMap::new())),
            tx,
            scales: Arc::new(RwLock::new(HashMap::new())),
            write_roles: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Sostituisce la mappa dei ruoli minimi di scrittura (F3.1).
    pub async fn set_write_roles(&self, roles: HashMap<TagId, String>) {
        *self.write_roles.write().await = roles;
    }

    /// Ruolo minimo di scrittura del tag, se definito.
    pub async fn write_role_of(&self, id: &str) -> Option<String> {
        self.write_roles.read().await.get(id).cloned()
    }

    /// Sostituisce la mappa degli scaling. Chiamata a ogni apertura/chiusura
    /// progetto (mappa vuota = nessuno scaling).
    pub async fn set_scales(&self, scales: HashMap<TagId, LinearScale>) {
        *self.scales.write().await = scales;
    }

    /// Converte un valore ingegneristico nel valore raw da scrivere sul
    /// device, se il tag ha uno scaling. Usato dai percorsi di scrittura
    /// (API/WS/ricette) prima di consegnare al TagWriteBus.
    pub async fn scale_to_raw(&self, id: &str, value: TagValue) -> TagValue {
        let Some(scale) = self.scales.read().await.get(id).copied() else { return value };
        match value {
            TagValue::Float(v) => TagValue::Float(scale.to_raw(v)),
            TagValue::Int(v)   => TagValue::Float(scale.to_raw(v as f64)),
            other => other,
        }
    }

    /// Ingresso dati dai PLUGIN DI PROTOCOLLO: come `set()`, ma applica lo
    /// scaling raw→eng se il tag lo definisce. Gli altri produttori (script,
    /// tag derivati, populate iniziale, API su tag virtuali) usano `set()`:
    /// producono già valori ingegneristici e scalarli due volte sarebbe un bug.
    pub async fn ingest(&self, id: TagId, value: TagValue, quality: TagQuality) {
        let scaled = match (self.scales.read().await.get(&id).copied(), value) {
            (Some(s), TagValue::Float(v)) => TagValue::Float(s.to_eng(v)),
            (Some(s), TagValue::Int(v))   => TagValue::Float(s.to_eng(v as f64)),
            (_, v) => v,
        };
        self.set(id, scaled, quality).await;
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

    /// Drop every tag. Used by project switch / close to reset the in-memory
    /// store before populating the next project's tags.
    pub async fn clear(&self) {
        self.store.write().await.clear();
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

    /// Drop all routes for the given tag ids. Called by the source supervisor
    /// when a plugin is being stopped — leaves the bus in a state where the
    /// next write to an unowned tag falls back to the direct TagDb path.
    pub async fn unregister_many(&self, tag_ids: &[TagId]) {
        let mut routes = self.routes.write().await;
        for id in tag_ids {
            routes.remove(id);
        }
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
