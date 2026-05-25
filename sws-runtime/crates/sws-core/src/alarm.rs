//! Minimal alarm engine for the PoC.
//!
//! An `AlarmDef` watches one `TagId` with a `AlarmCondition`. The runtime
//! evaluates conditions whenever the tag changes (subscribing to `TagDb`'s
//! broadcast) and stores transitions in an `AlarmDb`. The UI subscribes to
//! the alarm broadcast (or polls `GET /api/alarms`) and acknowledges via
//! `POST /api/alarms/:id/ack`.
//!
//! Out of scope for the PoC: multi-condition (AND/OR) rules, time-based
//! delays, alarm groups. Shelving implemented in Phase 2 (S-49).

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
    fn as_f64(v: &TagValue) -> Option<f64> {
        match v {
            TagValue::Float(f) => Some(*f),
            TagValue::Int(i)   => Some(*i as f64),
            TagValue::Bool(b)  => Some(if *b { 1.0 } else { 0.0 }),
            TagValue::Str(s)   => s.trim().parse().ok(),
        }
    }

    /// Evaluate this condition against the current tag value.
    /// Returns false if the value can't be coerced into the expected type.
    pub fn evaluate(&self, value: &TagValue) -> bool {
        match self {
            AlarmCondition::Above { threshold }        => Self::as_f64(value).map_or(false, |v| v >  *threshold),
            AlarmCondition::Below { threshold }        => Self::as_f64(value).map_or(false, |v| v <  *threshold),
            AlarmCondition::BoolEquals { value: want } => matches!(value, TagValue::Bool(b) if b == want),
        }
    }

    /// Evaluate the "return-to-normal" condition considering a dead-band.
    /// When dead_band > 0, the alarm only clears when the value has moved
    /// `dead_band` units past the threshold (hysteresis).
    /// BoolEquals alarms have no numeric dead-band — they clear normally.
    pub fn evaluate_clear(&self, value: &TagValue, dead_band: f64) -> bool {
        match self {
            AlarmCondition::Above { threshold } =>
                Self::as_f64(value).map_or(true, |v| v < threshold - dead_band),
            AlarmCondition::Below { threshold } =>
                Self::as_f64(value).map_or(true, |v| v > threshold + dead_band),
            AlarmCondition::BoolEquals { value: want } =>
                !matches!(value, TagValue::Bool(b) if b == want),
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
    /// Optional webhook URL. When set, a POST is fired to this URL each time
    /// the alarm transitions to ACTIVE. Payload: `AlarmWebhookPayload` JSON.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_url: Option<String>,
    /// Hysteresis band (same unit as the tag value). When set, the alarm only
    /// clears when the value has moved `dead_band` units back past the threshold.
    /// Prevents alarm chatter on noisy signals near the setpoint.
    /// Example: Above(80) + dead_band=2 → clears only below 78, not at 79.9.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dead_band: Option<f64>,
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

/// A shelved (suppressed) alarm entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShelvedAlarm {
    pub alarm_id: String,
    pub reason: String,
    /// Epoch-ms when the shelving expires. `0` = indefinite (never auto-unshelves).
    pub until_ms: u64,
    pub shelved_by: String,
    pub shelved_at_ms: u64,
}

/// In-memory alarm registry + broadcast for live UI updates.
/// Mirrors the shape of TagDb deliberately.
pub struct AlarmDb {
    states: Arc<RwLock<HashMap<String, AlarmState>>>,
    /// Reverse index: tag → IDs of alarms that watch it.
    by_tag: Arc<RwLock<HashMap<TagId, Vec<String>>>>,
    /// Shelved (suppressed) alarms: id → shelving metadata.
    shelved: Arc<RwLock<HashMap<String, ShelvedAlarm>>>,
    tx: broadcast::Sender<AlarmState>,
}

impl AlarmDb {
    pub fn new(channel_capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(channel_capacity);
        Self {
            states:  Arc::new(RwLock::new(HashMap::new())),
            by_tag:  Arc::new(RwLock::new(HashMap::new())),
            shelved: Arc::new(RwLock::new(HashMap::new())),
            tx,
        }
    }

    /// Register every alarm definition. Call at startup after loading the project.
    pub async fn load(&self, defs: Vec<AlarmDef>) {
        let mut states = self.states.write().await;
        let mut by_tag = self.by_tag.write().await;
        states.clear();
        by_tag.clear();
        self.shelved.write().await.clear();
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

        // Auto-expire shelved entries whose `until_ms` has passed.
        {
            let mut shelved = self.shelved.write().await;
            shelved.retain(|_, sh| sh.until_ms == 0 || sh.until_ms > now);
        }

        // Snapshot shelved IDs so we can skip them during evaluation.
        let shelved_ids: std::collections::HashSet<String> =
            self.shelved.read().await.keys().cloned().collect();

        let mut to_emit: Vec<AlarmState> = Vec::new();
        {
            let mut states = self.states.write().await;
            for id in &watchers {
                // Shelved alarms are suppressed — skip evaluation entirely.
                if shelved_ids.contains(id) { continue; }
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
                    // With dead_band: only clear when the value has moved past
                    // (threshold ± dead_band), not just crossed back over threshold.
                    let cleared = match s.def.dead_band {
                        Some(db) if db > 0.0 =>
                            s.def.condition.evaluate_clear(&tag_state.value, db),
                        _ => true,
                    };
                    if cleared {
                        s.active = false;
                        // Keep ack flag — once acked, the recovery is recorded but the
                        // operator doesn't have to ack a second time.
                        to_emit.push(s.clone());
                    }
                }
            }
        }

        for st in to_emit {
            let _ = self.tx.send(st);
        }
    }

    /// Shelve (suppress) an alarm for `duration_ms` milliseconds (`0` = indefinite).
    /// Returns `false` if the alarm id is unknown.
    pub async fn shelve(&self, id: &str, reason: String, duration_ms: u64, shelved_by: String) -> bool {
        if !self.states.read().await.contains_key(id) { return false; }
        let now = now_ms();
        let until_ms = if duration_ms == 0 { 0 } else { now + duration_ms };
        self.shelved.write().await.insert(id.to_string(), ShelvedAlarm {
            alarm_id: id.to_string(),
            reason,
            until_ms,
            shelved_by,
            shelved_at_ms: now,
        });
        true
    }

    /// Unshelve (re-activate) an alarm. Idempotent.
    pub async fn unshelve(&self, id: &str) {
        self.shelved.write().await.remove(id);
    }

    /// Snapshot of all currently-shelved alarms.
    pub async fn shelved_snapshot(&self) -> Vec<ShelvedAlarm> {
        let now = now_ms();
        self.shelved.read().await.values()
            .filter(|sh| sh.until_ms == 0 || sh.until_ms > now)
            .cloned()
            .collect()
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
            notify_url: None,
            dead_band: None,
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
    async fn dead_band_prevents_premature_clear() {
        let db = AlarmDb::new(8);
        let mut alarm = def("temp_high", "boiler.t", AlarmCondition::Above { threshold: 80.0 });
        alarm.dead_band = Some(2.0);
        db.load(vec![alarm]).await;

        // Fire at 85
        db.evaluate("boiler.t", &ts(TagValue::Float(85.0))).await;
        assert!(db.snapshot().await[0].active, "should activate at 85");

        // Drop to 79.5: still above (threshold - dead_band = 78), so alarm stays
        db.evaluate("boiler.t", &ts(TagValue::Float(79.5))).await;
        assert!(db.snapshot().await[0].active, "should stay active at 79.5 (above dead_band floor 78)");

        // Drop to 77: below 78 → alarm clears
        db.evaluate("boiler.t", &ts(TagValue::Float(77.0))).await;
        assert!(!db.snapshot().await[0].active, "should clear at 77 (below dead_band floor 78)");
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
