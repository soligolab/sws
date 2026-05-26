//! ISA-18.2-compliant alarm engine.
//!
//! State machine (4 states per ISA-18.2):
//!
//!   Normal ────activate───► Active-Unacked
//!                                  │ ack()
//!                                  ▼
//!   Normal ◄───normalize──── Active-Acked
//!
//!   Normal-Unacked ◄─────────── (cleared before ack)
//!      │ ack()
//!      ▼
//!   Normal
//!
//! Transitions that produce journal events:
//!   - ACTIVATE   (Normal → Active-Unacked): ts_activated recorded
//!   - ACK        (Active-Unacked → Active-Acked)
//!   - NORMALIZE  (Active-Acked → Normal OR Active-Unacked → Normal-Unacked)
//!   - NORM-ACK   (Normal-Unacked → Normal): completes the event row

use std::{
    collections::HashMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};
use crate::tag::{TagId, TagState, TagValue};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AlarmSeverity {
    Info,
    Warning,
    Critical,
}

impl Default for AlarmSeverity {
    fn default() -> Self { Self::Warning }
}

/// ISA-18.2 alarm state — four states.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum IsaState {
    /// Not active, no outstanding ack needed — steady state.
    #[default]
    Normal,
    /// Condition is active and operator has not acknowledged.
    ActiveUnacked,
    /// Condition is active and operator has acknowledged.
    ActiveAcked,
    /// Condition cleared but operator has not yet acknowledged the event.
    NormalUnacked,
}

impl IsaState {
    pub fn is_active(self) -> bool {
        matches!(self, IsaState::ActiveUnacked | IsaState::ActiveAcked)
    }
    pub fn needs_ack(self) -> bool {
        matches!(self, IsaState::ActiveUnacked | IsaState::NormalUnacked)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AlarmCondition {
    Above       { threshold: f64 },
    Below       { threshold: f64 },
    BoolEquals  { value: bool },
    BoolTrue,
    BoolFalse,
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

    pub fn evaluate(&self, value: &TagValue) -> bool {
        match self {
            AlarmCondition::Above { threshold }        => Self::as_f64(value).map_or(false, |v| v >  *threshold),
            AlarmCondition::Below { threshold }        => Self::as_f64(value).map_or(false, |v| v <  *threshold),
            AlarmCondition::BoolEquals { value: want } => matches!(value, TagValue::Bool(b) if b == want),
            AlarmCondition::BoolTrue                   => matches!(value, TagValue::Bool(true)),
            AlarmCondition::BoolFalse                  => matches!(value, TagValue::Bool(false)),
        }
    }

    pub fn evaluate_clear(&self, value: &TagValue, dead_band: f64) -> bool {
        match self {
            AlarmCondition::Above { threshold } =>
                Self::as_f64(value).map_or(true, |v| v < threshold - dead_band),
            AlarmCondition::Below { threshold } =>
                Self::as_f64(value).map_or(true, |v| v > threshold + dead_band),
            AlarmCondition::BoolEquals { value: want } =>
                !matches!(value, TagValue::Bool(b) if b == want),
            AlarmCondition::BoolTrue  => !matches!(value, TagValue::Bool(true)),
            AlarmCondition::BoolFalse => !matches!(value, TagValue::Bool(false)),
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dead_band: Option<f64>,
}

/// Live alarm state — serialized in WS/REST snapshots.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlarmState {
    pub def: AlarmDef,
    /// ISA-18.2 four-state value.
    pub isa_state: IsaState,
    /// Convenience fields derived from `isa_state` for backward-compat.
    pub active: bool,
    pub acknowledged: bool,
    pub activated_at_ms: Option<u64>,
    pub ack_at_ms: Option<u64>,
    pub normalized_at_ms: Option<u64>,
    pub last_value: Option<TagValue>,
}

impl AlarmState {
    fn from_def(def: AlarmDef) -> Self {
        Self {
            def,
            isa_state: IsaState::Normal,
            active: false,
            acknowledged: false,
            activated_at_ms: None,
            ack_at_ms: None,
            normalized_at_ms: None,
            last_value: None,
        }
    }

    fn sync_compat(&mut self) {
        self.active = self.isa_state.is_active();
        self.acknowledged = !self.isa_state.needs_ack() && self.isa_state != IsaState::Normal
            || self.isa_state == IsaState::ActiveAcked;
    }
}

/// One completed (or in-progress) alarm event in the journal.
/// `normalized_at_ms` and `acked_by`/`ack_at_ms` are None while the alarm
/// is still active.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlarmEvent {
    /// Matches `AlarmDef.id`.
    pub alarm_id: String,
    pub alarm_message: String,
    pub severity: AlarmSeverity,
    pub ts_activated_ms: u64,
    pub ts_acked_ms: Option<u64>,
    pub ts_normalized_ms: Option<u64>,
    /// Duration active in seconds (None while still active).
    pub duration_s: Option<f64>,
    pub acked_by: Option<String>,
}

/// A shelved (suppressed) alarm.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShelvedAlarm {
    pub alarm_id: String,
    pub reason: String,
    pub until_ms: u64,
    pub shelved_by: String,
    pub shelved_at_ms: u64,
}

// ── In-progress event tracker (not persisted — lives in memory) ───────────────

#[derive(Debug, Clone)]
struct OpenEvent {
    alarm_id: String,
    alarm_message: String,
    severity: AlarmSeverity,
    ts_activated_ms: u64,
    ts_acked_ms: Option<u64>,
    acked_by: Option<String>,
}

// ── AlarmDb ───────────────────────────────────────────────────────────────────

pub struct AlarmDb {
    states:      Arc<RwLock<HashMap<String, AlarmState>>>,
    by_tag:      Arc<RwLock<HashMap<TagId, Vec<String>>>>,
    shelved:     Arc<RwLock<HashMap<String, ShelvedAlarm>>>,
    open_events: Arc<RwLock<HashMap<String, OpenEvent>>>,
    /// Completed journal events (in-memory; lost on restart — SQLite persistence
    /// is wired in separately via the journal callback).
    journal:     Arc<RwLock<Vec<AlarmEvent>>>,
    tx: broadcast::Sender<AlarmState>,
    /// Optional async callback fired on each completed journal event.
    /// Set externally to persist to SQLite.
    journal_cb:  Arc<RwLock<Option<Box<dyn Fn(AlarmEvent) + Send + Sync + 'static>>>>,
}

impl AlarmDb {
    pub fn new(channel_capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(channel_capacity);
        Self {
            states:      Arc::new(RwLock::new(HashMap::new())),
            by_tag:      Arc::new(RwLock::new(HashMap::new())),
            shelved:     Arc::new(RwLock::new(HashMap::new())),
            open_events: Arc::new(RwLock::new(HashMap::new())),
            journal:     Arc::new(RwLock::new(Vec::new())),
            tx,
            journal_cb:  Arc::new(RwLock::new(None)),
        }
    }

    /// Register a callback invoked whenever an alarm event completes.
    /// Used by the SQLite alarm journal layer to persist events.
    pub async fn set_journal_callback<F>(&self, cb: F)
    where
        F: Fn(AlarmEvent) + Send + Sync + 'static,
    {
        *self.journal_cb.write().await = Some(Box::new(cb));
    }

    pub async fn load(&self, defs: Vec<AlarmDef>) {
        let mut states = self.states.write().await;
        let mut by_tag = self.by_tag.write().await;
        states.clear();
        by_tag.clear();
        self.shelved.write().await.clear();
        self.open_events.write().await.clear();
        self.journal.write().await.clear();
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

    /// Recent journal events, newest first. `limit` caps the returned count.
    pub async fn journal_snapshot(&self, limit: usize) -> Vec<AlarmEvent> {
        let j = self.journal.read().await;
        j.iter().rev().take(limit).cloned().collect()
    }

    pub async fn evaluate(&self, tag_id: &str, tag_state: &TagState) {
        let watchers: Vec<String> = self
            .by_tag.read().await
            .get(tag_id)
            .cloned()
            .unwrap_or_default();

        if watchers.is_empty() { return; }

        let now = now_ms();

        // Auto-expire shelved entries.
        {
            let mut shelved = self.shelved.write().await;
            shelved.retain(|_, sh| sh.until_ms == 0 || sh.until_ms > now);
        }
        let shelved_ids: std::collections::HashSet<String> =
            self.shelved.read().await.keys().cloned().collect();

        let mut to_emit: Vec<AlarmState> = Vec::new();
        let mut completed_events: Vec<AlarmEvent> = Vec::new();

        {
            let mut states      = self.states.write().await;
            let mut open_events = self.open_events.write().await;

            for id in &watchers {
                if shelved_ids.contains(id) { continue; }
                let Some(s) = states.get_mut(id) else { continue };
                let fired   = s.def.condition.evaluate(&tag_state.value);
                s.last_value = Some(tag_state.value.clone());

                let prev = s.isa_state;

                match (prev, fired) {
                    // Normal → ActiveUnacked (activate)
                    (IsaState::Normal, true) => {
                        s.isa_state = IsaState::ActiveUnacked;
                        s.activated_at_ms = Some(now);
                        s.ack_at_ms = None;
                        s.normalized_at_ms = None;
                        open_events.insert(id.clone(), OpenEvent {
                            alarm_id: id.clone(),
                            alarm_message: s.def.message.clone(),
                            severity: s.def.severity,
                            ts_activated_ms: now,
                            ts_acked_ms: None,
                            acked_by: None,
                        });
                        s.sync_compat();
                        to_emit.push(s.clone());
                    }
                    // NormalUnacked → ActiveUnacked (re-activate before ack)
                    (IsaState::NormalUnacked, true) => {
                        s.isa_state = IsaState::ActiveUnacked;
                        s.activated_at_ms = Some(now);
                        s.sync_compat();
                        to_emit.push(s.clone());
                    }
                    // ActiveUnacked cleared → NormalUnacked (normalize without ack)
                    (IsaState::ActiveUnacked, false) => {
                        let cleared = s.def.dead_band
                            .map(|db| db > 0.0 && s.def.condition.evaluate_clear(&tag_state.value, db))
                            .unwrap_or(true);
                        if cleared {
                            s.isa_state = IsaState::NormalUnacked;
                            s.normalized_at_ms = Some(now);
                            // Update open event but don't complete it yet.
                            if let Some(ev) = open_events.get_mut(id) {
                                ev.ts_acked_ms = None;
                            }
                            s.sync_compat();
                            to_emit.push(s.clone());
                        }
                    }
                    // ActiveAcked cleared → Normal (clean close)
                    (IsaState::ActiveAcked, false) => {
                        let cleared = s.def.dead_band
                            .map(|db| db > 0.0 && s.def.condition.evaluate_clear(&tag_state.value, db))
                            .unwrap_or(true);
                        if cleared {
                            s.isa_state = IsaState::Normal;
                            s.normalized_at_ms = Some(now);
                            // Complete the journal event.
                            if let Some(ev) = open_events.remove(id) {
                                let duration_s = Some((now - ev.ts_activated_ms) as f64 / 1000.0);
                                completed_events.push(AlarmEvent {
                                    alarm_id: ev.alarm_id,
                                    alarm_message: ev.alarm_message,
                                    severity: ev.severity,
                                    ts_activated_ms: ev.ts_activated_ms,
                                    ts_acked_ms: ev.ts_acked_ms,
                                    ts_normalized_ms: Some(now),
                                    duration_s,
                                    acked_by: ev.acked_by,
                                });
                            }
                            s.sync_compat();
                            to_emit.push(s.clone());
                        }
                    }
                    _ => {}
                }
            }
        }

        // Persist + store completed events outside the state lock.
        if !completed_events.is_empty() {
            let cb = self.journal_cb.read().await;
            let mut journal = self.journal.write().await;
            for ev in completed_events {
                if let Some(f) = cb.as_ref() { f(ev.clone()); }
                journal.push(ev);
            }
        }

        for st in to_emit {
            let _ = self.tx.send(st);
        }
    }

    /// Acknowledge the alarm identified by `id`. `by` is the operator name/id.
    pub async fn ack(&self, id: &str, by: Option<String>) -> bool {
        let mut states = self.states.write().await;
        let Some(s) = states.get_mut(id) else { return false };

        let transition = match s.isa_state {
            IsaState::ActiveUnacked => Some(IsaState::ActiveAcked),
            IsaState::NormalUnacked => Some(IsaState::Normal),
            _ => None,
        };
        let Some(next) = transition else { return true /* already acked */ };

        let now = now_ms();
        s.isa_state = next;
        s.ack_at_ms = Some(now);
        s.sync_compat();

        // Update open event with ack info.
        let mut open_events = self.open_events.write().await;
        let mut completed_events: Vec<AlarmEvent> = Vec::new();

        if let Some(ev) = open_events.get_mut(id) {
            ev.ts_acked_ms = Some(now);
            ev.acked_by = by.clone();
            // NormalUnacked → Normal completes the event immediately.
            if next == IsaState::Normal {
                let ev = open_events.remove(id).unwrap();
                let duration_s = Some((now - ev.ts_activated_ms) as f64 / 1000.0);
                completed_events.push(AlarmEvent {
                    alarm_id: ev.alarm_id,
                    alarm_message: ev.alarm_message,
                    severity: ev.severity,
                    ts_activated_ms: ev.ts_activated_ms,
                    ts_acked_ms: ev.ts_acked_ms,
                    ts_normalized_ms: s.normalized_at_ms,
                    duration_s,
                    acked_by: ev.acked_by,
                });
            }
        }

        let snap = s.clone();
        drop(states);
        drop(open_events);

        if !completed_events.is_empty() {
            let cb = self.journal_cb.read().await;
            let mut journal = self.journal.write().await;
            for ev in completed_events {
                if let Some(f) = cb.as_ref() { f(ev.clone()); }
                journal.push(ev);
            }
        }

        let _ = self.tx.send(snap);
        true
    }

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

    pub async fn unshelve(&self, id: &str) {
        self.shelved.write().await.remove(id);
    }

    pub async fn shelved_snapshot(&self) -> Vec<ShelvedAlarm> {
        let now = now_ms();
        self.shelved.read().await.values()
            .filter(|sh| sh.until_ms == 0 || sh.until_ms > now)
            .cloned()
            .collect()
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
    async fn four_state_isa182_cycle() {
        let db = AlarmDb::new(8);
        db.load(vec![def("t", "tag", AlarmCondition::Above { threshold: 80.0 })]).await;

        // Activate → ActiveUnacked
        db.evaluate("tag", &ts(TagValue::Float(90.0))).await;
        let snap = db.snapshot().await;
        assert_eq!(snap[0].isa_state, IsaState::ActiveUnacked);
        assert!(snap[0].active);
        assert!(!snap[0].acknowledged);

        // Ack → ActiveAcked
        db.ack("t", None).await;
        let snap = db.snapshot().await;
        assert_eq!(snap[0].isa_state, IsaState::ActiveAcked);
        assert!(snap[0].active);

        // Normalize → Normal (event complete)
        db.evaluate("tag", &ts(TagValue::Float(70.0))).await;
        let snap = db.snapshot().await;
        assert_eq!(snap[0].isa_state, IsaState::Normal);
        assert!(!snap[0].active);

        let events = db.journal_snapshot(10).await;
        assert_eq!(events.len(), 1);
        assert!(events[0].ts_acked_ms.is_some());
        assert!(events[0].ts_normalized_ms.is_some());
    }

    #[tokio::test]
    async fn normalize_before_ack_gives_normal_unacked() {
        let db = AlarmDb::new(8);
        db.load(vec![def("t", "tag", AlarmCondition::Above { threshold: 80.0 })]).await;

        db.evaluate("tag", &ts(TagValue::Float(90.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::ActiveUnacked);

        // Normalize without ack → NormalUnacked
        db.evaluate("tag", &ts(TagValue::Float(70.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::NormalUnacked);

        // Ack → Normal, event completes
        db.ack("t", None).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::Normal);
        assert_eq!(db.journal_snapshot(10).await.len(), 1);
    }

    #[tokio::test]
    async fn dead_band_prevents_premature_clear() {
        let db = AlarmDb::new(8);
        let mut alarm = def("t", "tag", AlarmCondition::Above { threshold: 80.0 });
        alarm.dead_band = Some(2.0);
        db.load(vec![alarm]).await;
        db.ack("t", None).await; // pre-ack so it goes to ActiveAcked on fire

        db.evaluate("tag", &ts(TagValue::Float(85.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::ActiveUnacked);

        db.evaluate("tag", &ts(TagValue::Float(79.5))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::ActiveUnacked, "above dead_band floor 78");

        db.evaluate("tag", &ts(TagValue::Float(77.0))).await;
        // Still ActiveUnacked (not yet acked) but normalize should fire.
        // Dead_band: threshold(80) - db(2) = 78. 77 < 78 → clears.
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::NormalUnacked);
    }

    #[tokio::test]
    async fn bool_condition_cycle() {
        let db = AlarmDb::new(8);
        db.load(vec![def("f", "pump.fault", AlarmCondition::BoolTrue)]).await;
        db.evaluate("pump.fault", &ts(TagValue::Bool(true))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::ActiveUnacked);
        db.evaluate("pump.fault", &ts(TagValue::Bool(false))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::NormalUnacked);
    }
}
