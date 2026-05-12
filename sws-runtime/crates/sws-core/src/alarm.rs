//! Minimal alarm engine for the PoC.
//!
//! An `AlarmDef` watches one `TagId` with a `AlarmCondition`. The runtime
//! evaluates conditions whenever the tag changes (subscribing to `TagDb`'s
//! broadcast) and stores transitions in an `AlarmDb`. The UI subscribes to
//! the alarm broadcast (or polls `GET /api/alarms`) and acknowledges via
//! `POST /api/alarms/:id/ack`.
//!
//! Out of scope for the PoC: hysteresis, deadband, multi-condition (AND/OR)
//! rules, time-based delays, alarm groups, shelving. All Phase 2 polish.

use std::{
    collections::HashMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};
use crate::tag::{TagId, TagState, TagValue};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AlarmSeverity {
    Info,
    Warning,
    Critical,
}

impl Default for AlarmSeverity {
    fn default() -> Self { Self::Warning }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AlarmCondition {
    /// Fire when the tag's numeric value goes strictly above `threshold`.
    Above       { threshold: f64 },
    /// Fire when the tag's numeric value goes strictly below `threshold`.
    Below       { threshold: f64 },
    /// Fire when a Bool tag matches `value`.
    BoolEquals  { value: bool },
}

impl AlarmCondition {
    /// Evaluate this condition against the current tag value.
    /// Returns false if the value can't be coerced into the expected type.
    pub fn evaluate(&self, value: &TagValue) -> bool {
        let as_f64 = |v: &TagValue| -> Option<f64> {
            match v {
                TagValue::Float(f) => Some(*f),
                TagValue::Int(i)   => Some(*i as f64),
                TagValue::Bool(b)  => Some(if *b { 1.0 } else { 0.0 }),
                TagValue::Str(s)   => s.trim().parse().ok(),
            }
        };
        match self {
            AlarmCondition::Above { threshold }      => as_f64(value).map_or(false, |v| v >  *threshold),
            AlarmCondition::Below { threshold }      => as_f64(value).map_or(false, |v| v <  *threshold),
            AlarmCondition::BoolEquals { value: want } => matches!(value, TagValue::Bool(b) if b == want),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlarmDef {
    pub id: String,
    pub tag: TagId,
    pub condition: AlarmCondition,
    pub message: String,
    #[serde(default)]
    pub severity: AlarmSeverity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlarmState {
    pub def: AlarmDef,
    pub active: bool,
    pub acknowledged: bool,
    pub activated_at_ms: Option<u64>,
    pub ack_at_ms: Option<u64>,
    pub last_value: Option<TagValue>,
}

impl AlarmState {
    fn from_def(def: AlarmDef) -> Self {
        Self {
            def,
            active: false,
            acknowledged: false,
            activated_at_ms: None,
            ack_at_ms: None,
            last_value: None,
        }
    }
}

/// In-memory alarm registry + broadcast for live UI updates.
/// Mirrors the shape of TagDb deliberately.
pub struct AlarmDb {
    states: Arc<RwLock<HashMap<String, AlarmState>>>,
    /// Reverse index: tag → IDs of alarms that watch it.
    by_tag: Arc<RwLock<HashMap<TagId, Vec<String>>>>,
    tx: broadcast::Sender<AlarmState>,
}

impl AlarmDb {
    pub fn new(channel_capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(channel_capacity);
        Self {
            states: Arc::new(RwLock::new(HashMap::new())),
            by_tag: Arc::new(RwLock::new(HashMap::new())),
            tx,
        }
    }

    /// Register every alarm definition. Call at startup after loading the project.
    pub async fn load(&self, defs: Vec<AlarmDef>) {
        let mut states = self.states.write().await;
        let mut by_tag = self.by_tag.write().await;
        states.clear();
        by_tag.clear();
        for def in defs {
            by_tag.entry(def.tag.clone()).or_default().push(def.id.clone());
            states.insert(def.id.clone(), AlarmState::from_def(def));
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AlarmState> {
        self.tx.subscribe()
    }

    pub async fn snapshot(&self) -> Vec<AlarmState> {
        let mut v: Vec<AlarmState> = self.states.read().await.values().cloned().collect();
        v.sort_by(|a, b| a.def.id.cmp(&b.def.id));
        v
    }

    /// Drive evaluation: called for every TagDb update. Emits a broadcast
    /// whenever an alarm transitions active/inactive (or ack changes).
    pub async fn evaluate(&self, tag_id: &str, tag_state: &TagState) {
        // Collect IDs of alarms watching this tag without holding the lock during the write.
        let watchers: Vec<String> = self
            .by_tag.read().await
            .get(tag_id)
            .cloned()
            .unwrap_or_default();

        if watchers.is_empty() { return; }

        let now = now_ms();
        let mut to_emit: Vec<AlarmState> = Vec::new();
        {
            let mut states = self.states.write().await;
            for id in &watchers {
                let Some(s) = states.get_mut(id) else { continue };
                let fired = s.def.condition.evaluate(&tag_state.value);
                s.last_value = Some(tag_state.value.clone());

                if fired && !s.active {
                    s.active = true;
                    s.acknowledged = false;
                    s.activated_at_ms = Some(now);
                    s.ack_at_ms = None;
                    to_emit.push(s.clone());
                } else if !fired && s.active {
                    s.active = false;
                    // Keep ack flag — once acked, the recovery is recorded but the
                    // operator doesn't have to ack a second time.
                    to_emit.push(s.clone());
                }
            }
        }

        for st in to_emit {
            let _ = self.tx.send(st);
        }
    }

    /// Mark an alarm as acknowledged. Idempotent.
    /// Returns `true` if the alarm exists.
    pub async fn ack(&self, id: &str) -> bool {
        let mut states = self.states.write().await;
        let Some(s) = states.get_mut(id) else { return false };
        if !s.acknowledged {
            s.acknowledged = true;
            s.ack_at_ms = Some(now_ms());
            let snap = s.clone();
            drop(states);
            let _ = self.tx.send(snap);
        }
        true
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tag::TagQuality;

    fn def(id: &str, tag: &str, cond: AlarmCondition) -> AlarmDef {
        AlarmDef {
            id: id.into(),
            tag: tag.into(),
            condition: cond,
            message: format!("{id} fired"),
            severity: AlarmSeverity::Warning,
        }
    }

    fn ts(value: TagValue) -> TagState {
        TagState { value, quality: TagQuality::Good, timestamp_ms: 0 }
    }

    #[tokio::test]
    async fn fires_when_above_threshold() {
        let db = AlarmDb::new(8);
        db.load(vec![def("temp_high", "boiler.t", AlarmCondition::Above { threshold: 80.0 })]).await;
        db.evaluate("boiler.t", &ts(TagValue::Float(85.0))).await;
        let snap = db.snapshot().await;
        assert!(snap[0].active);
        assert!(!snap[0].acknowledged);
    }

    #[tokio::test]
    async fn clears_when_back_below() {
        let db = AlarmDb::new(8);
        db.load(vec![def("temp_high", "boiler.t", AlarmCondition::Above { threshold: 80.0 })]).await;
        db.evaluate("boiler.t", &ts(TagValue::Float(85.0))).await;
        db.evaluate("boiler.t", &ts(TagValue::Float(75.0))).await;
        let snap = db.snapshot().await;
        assert!(!snap[0].active);
    }

    #[tokio::test]
    async fn ack_sticks_until_recurrence() {
        let db = AlarmDb::new(8);
        db.load(vec![def("temp_high", "boiler.t", AlarmCondition::Above { threshold: 80.0 })]).await;
        db.evaluate("boiler.t", &ts(TagValue::Float(85.0))).await;
        assert!(db.ack("temp_high").await);
        let snap = db.snapshot().await;
        assert!(snap[0].acknowledged);

        // Recovery + re-fire: ack must reset
        db.evaluate("boiler.t", &ts(TagValue::Float(70.0))).await;
        db.evaluate("boiler.t", &ts(TagValue::Float(90.0))).await;
        let snap = db.snapshot().await;
        assert!(snap[0].active);
        assert!(!snap[0].acknowledged);
    }

    #[tokio::test]
    async fn bool_equals_condition() {
        let db = AlarmDb::new(8);
        db.load(vec![def("fault", "pump.fault", AlarmCondition::BoolEquals { value: true })]).await;
        db.evaluate("pump.fault", &ts(TagValue::Bool(true))).await;
        assert!(db.snapshot().await[0].active);
        db.evaluate("pump.fault", &ts(TagValue::Bool(false))).await;
        assert!(!db.snapshot().await[0].active);
    }
}
