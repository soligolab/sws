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
//! T-10 additions:
//!   - Composite conditions: And / Or / Not
//!   - on_delay_s / off_delay_s: activation/clear hysteresis by time
//!   - inhibit_tag + inhibit_condition: suppress alarm based on another tag

use std::{
    collections::{HashMap, HashSet},
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
    #[default]
    Normal,
    ActiveUnacked,
    ActiveAcked,
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

/// Alarm trigger condition. Atomic and composite variants.
///
/// Composite conditions (`And`, `Or`, `Not`) let you express:
///   - range alarm: `And([Above{10}, Below{100}])` → fires when 10 < value < 100
///   - out-of-range: `Or([Above{100}, Below{10}])`
///   - inverted: `Not(BoolTrue)` ≡ BoolFalse
///
/// `dead_band` only applies to atomic `Above`/`Below` conditions.
/// Composite conditions propagate the dead_band to their children.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AlarmCondition {
    Above       { threshold: f64 },
    Below       { threshold: f64 },
    BoolEquals  { value: bool },
    BoolTrue,
    BoolFalse,
    /// Fires when ALL child conditions are true simultaneously.
    And { conditions: Vec<AlarmCondition> },
    /// Fires when ANY child condition is true.
    Or  { conditions: Vec<AlarmCondition> },
    /// Fires when the child condition is NOT true.
    Not { condition: Box<AlarmCondition> },
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
            Self::Above { threshold }        => Self::as_f64(value).map_or(false, |v| v >  *threshold),
            Self::Below { threshold }        => Self::as_f64(value).map_or(false, |v| v <  *threshold),
            Self::BoolEquals { value: want } => matches!(value, TagValue::Bool(b) if b == want),
            Self::BoolTrue                   => matches!(value, TagValue::Bool(true)),
            Self::BoolFalse                  => matches!(value, TagValue::Bool(false)),
            Self::And { conditions }         => conditions.iter().all(|c| c.evaluate(value)),
            Self::Or  { conditions }         => conditions.iter().any(|c| c.evaluate(value)),
            Self::Not { condition }          => !condition.evaluate(value),
        }
    }

    /// Returns true when the alarm should CLEAR (leave active state).
    /// For `Above`/`Below`, applies dead_band hysteresis.
    /// For composites, dead_band is propagated to atomic children.
    pub fn evaluate_clear(&self, value: &TagValue, dead_band: f64) -> bool {
        match self {
            Self::Above { threshold } =>
                Self::as_f64(value).map_or(true, |v| v < threshold - dead_band),
            Self::Below { threshold } =>
                Self::as_f64(value).map_or(true, |v| v > threshold + dead_band),
            Self::BoolEquals { value: want } =>
                !matches!(value, TagValue::Bool(b) if b == want),
            Self::BoolTrue  => !matches!(value, TagValue::Bool(true)),
            Self::BoolFalse => !matches!(value, TagValue::Bool(false)),
            // And fires when ALL true → clears when ANY clears
            Self::And { conditions } =>
                conditions.iter().any(|c| c.evaluate_clear(value, dead_band)),
            // Or fires when ANY true → clears when ALL clear
            Self::Or  { conditions } =>
                conditions.iter().all(|c| c.evaluate_clear(value, dead_band)),
            // Not fires when child is false → clears when child fires
            Self::Not { condition } => condition.evaluate(value),
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
    /// Seconds the condition must be continuously true before the alarm activates.
    /// 0 or absent → immediate activation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_delay_s: Option<f64>,
    /// Seconds the condition must be continuously false before the alarm clears.
    /// 0 or absent → immediate clear.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub off_delay_s: Option<f64>,
    /// Tag that, when its value matches `inhibit_condition` (default: BoolTrue),
    /// suppresses this alarm (prevents activation while inhibited).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inhibit_tag: Option<TagId>,
    /// Condition on `inhibit_tag` that means "alarm is inhibited".
    /// Defaults to `BoolTrue` when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inhibit_condition: Option<AlarmCondition>,
    /// Email addresses to notify on alarm activation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_email: Option<Vec<String>>,
    /// Seconds after activation before escalating (if alarm not ACKed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub escalate_after_s: Option<f64>,
    /// Email addresses to notify on escalation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub escalate_to: Option<Vec<String>>,
}

/// Live alarm state — serialized in WS/REST snapshots.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlarmState {
    pub def: AlarmDef,
    pub isa_state: IsaState,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlarmEvent {
    pub alarm_id: String,
    pub alarm_message: String,
    pub severity: AlarmSeverity,
    pub ts_activated_ms: u64,
    pub ts_acked_ms: Option<u64>,
    pub ts_normalized_ms: Option<u64>,
    pub duration_s: Option<f64>,
    pub acked_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShelvedAlarm {
    pub alarm_id: String,
    pub reason: String,
    pub until_ms: u64,
    pub shelved_by: String,
    pub shelved_at_ms: u64,
}

// ── Internal state ────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct OpenEvent {
    alarm_id: String,
    alarm_message: String,
    severity: AlarmSeverity,
    ts_activated_ms: u64,
    ts_acked_ms: Option<u64>,
    acked_by: Option<String>,
}

/// Per-alarm pending timer state for on_delay / off_delay.
#[derive(Debug, Default)]
struct AlarmTimer {
    /// Epoch ms when the condition first became true (for on_delay).
    /// None if condition is currently false or delay already elapsed.
    condition_true_since_ms:  Option<u64>,
    /// Epoch ms when the condition first became false (for off_delay).
    condition_false_since_ms: Option<u64>,
}

// ── AlarmDb ───────────────────────────────────────────────────────────────────

pub struct AlarmDb {
    states:         Arc<RwLock<HashMap<String, AlarmState>>>,
    by_tag:         Arc<RwLock<HashMap<TagId, Vec<String>>>>,
    /// Alarms that re-evaluate when their inhibit_tag changes.
    by_inhibit_tag: Arc<RwLock<HashMap<TagId, Vec<String>>>>,
    /// Last known value of each inhibit tag (updated on evaluate()).
    inhibit_values: Arc<RwLock<HashMap<TagId, TagValue>>>,
    timers:         Arc<RwLock<HashMap<String, AlarmTimer>>>,
    shelved:        Arc<RwLock<HashMap<String, ShelvedAlarm>>>,
    open_events:    Arc<RwLock<HashMap<String, OpenEvent>>>,
    journal:        Arc<RwLock<Vec<AlarmEvent>>>,
    tx:             broadcast::Sender<AlarmState>,
    journal_cb:     Arc<RwLock<Option<Box<dyn Fn(AlarmEvent) + Send + Sync + 'static>>>>,
}

impl AlarmDb {
    pub fn new(channel_capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(channel_capacity);
        Self {
            states:         Arc::new(RwLock::new(HashMap::new())),
            by_tag:         Arc::new(RwLock::new(HashMap::new())),
            by_inhibit_tag: Arc::new(RwLock::new(HashMap::new())),
            inhibit_values: Arc::new(RwLock::new(HashMap::new())),
            timers:         Arc::new(RwLock::new(HashMap::new())),
            shelved:        Arc::new(RwLock::new(HashMap::new())),
            open_events:    Arc::new(RwLock::new(HashMap::new())),
            journal:        Arc::new(RwLock::new(Vec::new())),
            tx,
            journal_cb:     Arc::new(RwLock::new(None)),
        }
    }

    pub async fn set_journal_callback<F>(&self, cb: F)
    where F: Fn(AlarmEvent) + Send + Sync + 'static,
    {
        *self.journal_cb.write().await = Some(Box::new(cb));
    }

    pub async fn load(&self, defs: Vec<AlarmDef>) {
        let mut states         = self.states.write().await;
        let mut by_tag         = self.by_tag.write().await;
        let mut by_inhibit_tag = self.by_inhibit_tag.write().await;
        let mut timers         = self.timers.write().await;
        states.clear();
        by_tag.clear();
        by_inhibit_tag.clear();
        timers.clear();
        self.shelved.write().await.clear();
        self.open_events.write().await.clear();
        self.journal.write().await.clear();
        self.inhibit_values.write().await.clear();
        for def in defs {
            by_tag.entry(def.tag.clone()).or_default().push(def.id.clone());
            if let Some(itag) = &def.inhibit_tag {
                by_inhibit_tag.entry(itag.clone()).or_default().push(def.id.clone());
            }
            timers.insert(def.id.clone(), AlarmTimer::default());
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

    pub async fn journal_snapshot(&self, limit: usize) -> Vec<AlarmEvent> {
        let j = self.journal.read().await;
        j.iter().rev().take(limit).cloned().collect()
    }

    pub async fn evaluate(&self, tag_id: &str, tag_state: &TagState) {
        let now = now_ms();

        // Auto-expire shelved entries.
        { self.shelved.write().await.retain(|_, sh| sh.until_ms == 0 || sh.until_ms > now); }
        let shelved_ids: HashSet<String> =
            self.shelved.read().await.keys().cloned().collect();

        // Collect affected alarm IDs.
        // use_cached=true → re-evaluate using alarm's last_value (inhibit-tag path)
        // use_cached=false → evaluate using tag_state.value (primary-tag path)
        let inhibit_ids: Vec<String> =
            self.by_inhibit_tag.read().await.get(tag_id).cloned().unwrap_or_default();
        let primary_ids: Vec<String> =
            self.by_tag.read().await.get(tag_id).cloned().unwrap_or_default();

        if inhibit_ids.is_empty() && primary_ids.is_empty() { return; }

        // Update inhibit cache before taking other write locks.
        if !inhibit_ids.is_empty() {
            self.inhibit_values.write().await.insert(tag_id.to_string(), tag_state.value.clone());
        }

        // Snapshot inhibit values for use inside the lock.
        let inhibit_values: HashMap<TagId, TagValue> =
            self.inhibit_values.read().await.clone();

        let mut to_emit: Vec<AlarmState> = Vec::new();
        let mut completed_events: Vec<AlarmEvent> = Vec::new();

        {
            let mut states      = self.states.write().await;
            let mut timers      = self.timers.write().await;
            let mut open_events = self.open_events.write().await;

            // Inhibit-tag path: re-evaluate using each alarm's cached last_value.
            for id in &inhibit_ids {
                if shelved_ids.contains(id) { continue; }
                let cached_val = match states.get(id).and_then(|s| s.last_value.clone()) {
                    Some(v) => v,
                    None    => continue, // alarm never evaluated — nothing to re-check
                };
                eval_one(
                    id, &cached_val, now, false, /* don't update last_value */
                    &mut states, &mut timers, &mut open_events,
                    &inhibit_values, &shelved_ids,
                    &mut to_emit, &mut completed_events,
                );
            }

            // Primary-tag path.
            for id in &primary_ids {
                if shelved_ids.contains(id) { continue; }
                eval_one(
                    id, &tag_state.value, now, true,
                    &mut states, &mut timers, &mut open_events,
                    &inhibit_values, &shelved_ids,
                    &mut to_emit, &mut completed_events,
                );
            }
        }

        // Persist completed events outside the state lock.
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

    pub async fn ack(&self, id: &str, by: Option<String>) -> bool {
        let mut states = self.states.write().await;
        let Some(s) = states.get_mut(id) else { return false };

        let transition = match s.isa_state {
            IsaState::ActiveUnacked => Some(IsaState::ActiveAcked),
            IsaState::NormalUnacked => Some(IsaState::Normal),
            _ => None,
        };
        let Some(next) = transition else { return true };

        let now = now_ms();
        s.isa_state = next;
        s.ack_at_ms = Some(now);
        s.sync_compat();

        let mut open_events = self.open_events.write().await;
        let mut completed_events: Vec<AlarmEvent> = Vec::new();

        if let Some(ev) = open_events.get_mut(id) {
            ev.ts_acked_ms = Some(now);
            ev.acked_by = by.clone();
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

// ── Core evaluation helper (sync — called inside async lock blocks) ────────────

#[allow(clippy::too_many_arguments)]
fn eval_one(
    id:               &str,
    tag_value:        &TagValue,
    now:              u64,
    update_last_val:  bool,
    states:           &mut HashMap<String, AlarmState>,
    timers:           &mut HashMap<String, AlarmTimer>,
    open_events:      &mut HashMap<String, OpenEvent>,
    inhibit_values:   &HashMap<TagId, TagValue>,
    shelved_ids:      &HashSet<String>,
    to_emit:          &mut Vec<AlarmState>,
    completed_events: &mut Vec<AlarmEvent>,
) {
    if shelved_ids.contains(id) { return; }
    let Some(s) = states.get_mut(id) else { return };

    // Cache last_value before inhibit check so inhibit-clear re-evaluation has
    // a value to work with even if the alarm was suppressed during this call.
    if update_last_val {
        s.last_value = Some(tag_value.clone());
    }

    // ── Inhibit check ──────────────────────────────────────────────────────────
    if let Some(itag) = &s.def.inhibit_tag.clone() {
        if let Some(ival) = inhibit_values.get(itag) {
            let inhibited = s.def.inhibit_condition.as_ref()
                .map(|cond| cond.evaluate(ival))
                .unwrap_or_else(|| matches!(ival, TagValue::Bool(true)));
            if inhibited { return; }
        }
    }

    // ── Raw condition check ────────────────────────────────────────────────────
    let raw_fired = s.def.condition.evaluate(tag_value);

    // ── Apply on_delay / off_delay ─────────────────────────────────────────────
    let timer = timers.entry(id.to_string()).or_insert_with(AlarmTimer::default);
    let fired = if raw_fired {
        // Condition is currently true.
        timer.condition_false_since_ms = None;
        if let Some(delay_s) = s.def.on_delay_s.filter(|&d| d > 0.0) {
            let delay_ms = (delay_s * 1000.0) as u64;
            if timer.condition_true_since_ms.is_none() {
                timer.condition_true_since_ms = Some(now);
            }
            now >= timer.condition_true_since_ms.unwrap() + delay_ms
        } else {
            timer.condition_true_since_ms = None;
            true
        }
    } else {
        // Condition is currently false.
        timer.condition_true_since_ms = None;
        if let Some(delay_s) = s.def.off_delay_s.filter(|&d| d > 0.0) {
            let delay_ms = (delay_s * 1000.0) as u64;
            if timer.condition_false_since_ms.is_none() {
                timer.condition_false_since_ms = Some(now);
            }
            // Still within off-delay → keep alarm active.
            now < timer.condition_false_since_ms.unwrap() + delay_ms
        } else {
            timer.condition_false_since_ms = None;
            false
        }
    };

    let dead_band = s.def.dead_band.unwrap_or(0.0);
    let prev = s.isa_state;

    match (prev, fired) {
        // Normal → ActiveUnacked
        (IsaState::Normal, true) => {
            s.isa_state = IsaState::ActiveUnacked;
            s.activated_at_ms = Some(now);
            s.ack_at_ms = None;
            s.normalized_at_ms = None;
            open_events.insert(id.to_string(), OpenEvent {
                alarm_id: id.to_string(),
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
        // ActiveUnacked cleared → NormalUnacked
        (IsaState::ActiveUnacked, false) => {
            let cleared = dead_band > 0.0
                && s.def.condition.evaluate_clear(tag_value, dead_band)
                || dead_band == 0.0;
            if cleared {
                s.isa_state = IsaState::NormalUnacked;
                s.normalized_at_ms = Some(now);
                if let Some(ev) = open_events.get_mut(id) {
                    ev.ts_acked_ms = None;
                }
                s.sync_compat();
                to_emit.push(s.clone());
            }
        }
        // ActiveAcked cleared → Normal
        (IsaState::ActiveAcked, false) => {
            let cleared = dead_band > 0.0
                && s.def.condition.evaluate_clear(tag_value, dead_band)
                || dead_band == 0.0;
            if cleared {
                s.isa_state = IsaState::Normal;
                s.normalized_at_ms = Some(now);
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
            on_delay_s: None,
            off_delay_s: None,
            inhibit_tag: None,
            inhibit_condition: None,
            notify_email: None,
            escalate_after_s: None,
            escalate_to: None,
        }
    }

    fn ts(value: TagValue) -> TagState {
        TagState { value, quality: TagQuality::Good, timestamp_ms: 0 }
    }

    #[tokio::test]
    async fn four_state_isa182_cycle() {
        let db = AlarmDb::new(8);
        db.load(vec![def("t", "tag", AlarmCondition::Above { threshold: 80.0 })]).await;

        db.evaluate("tag", &ts(TagValue::Float(90.0))).await;
        let snap = db.snapshot().await;
        assert_eq!(snap[0].isa_state, IsaState::ActiveUnacked);
        assert!(snap[0].active);
        assert!(!snap[0].acknowledged);

        db.ack("t", None).await;
        let snap = db.snapshot().await;
        assert_eq!(snap[0].isa_state, IsaState::ActiveAcked);

        db.evaluate("tag", &ts(TagValue::Float(70.0))).await;
        let snap = db.snapshot().await;
        assert_eq!(snap[0].isa_state, IsaState::Normal);

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

        db.evaluate("tag", &ts(TagValue::Float(70.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::NormalUnacked);

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
        db.ack("t", None).await;

        db.evaluate("tag", &ts(TagValue::Float(85.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::ActiveUnacked);

        db.evaluate("tag", &ts(TagValue::Float(79.5))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::ActiveUnacked, "above dead_band floor 78");

        db.evaluate("tag", &ts(TagValue::Float(77.0))).await;
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

    #[tokio::test]
    async fn and_condition_fires_only_when_all_true() {
        let db = AlarmDb::new(8);
        // Fires when 10 < value < 100 (range alarm)
        db.load(vec![def("r", "sensor", AlarmCondition::And {
            conditions: vec![
                AlarmCondition::Above { threshold: 10.0 },
                AlarmCondition::Below { threshold: 100.0 },
            ],
        })]).await;

        // Below lower bound → Normal
        db.evaluate("sensor", &ts(TagValue::Float(5.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::Normal);

        // In range → Active
        db.evaluate("sensor", &ts(TagValue::Float(50.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::ActiveUnacked);

        // Above upper bound → clears (And clears when ANY child clears)
        db.evaluate("sensor", &ts(TagValue::Float(200.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::NormalUnacked);
    }

    #[tokio::test]
    async fn or_condition_fires_when_any_true() {
        let db = AlarmDb::new(8);
        // Out-of-range: fires when < 10 OR > 100
        db.load(vec![def("r", "sensor", AlarmCondition::Or {
            conditions: vec![
                AlarmCondition::Below { threshold: 10.0 },
                AlarmCondition::Above { threshold: 100.0 },
            ],
        })]).await;

        db.evaluate("sensor", &ts(TagValue::Float(50.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::Normal);

        db.evaluate("sensor", &ts(TagValue::Float(5.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::ActiveUnacked);

        db.evaluate("sensor", &ts(TagValue::Float(50.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::NormalUnacked);
    }

    #[tokio::test]
    async fn not_condition() {
        let db = AlarmDb::new(8);
        // Fires when pump is NOT running
        db.load(vec![def("p", "pump.running", AlarmCondition::Not {
            condition: Box::new(AlarmCondition::BoolTrue),
        })]).await;

        // Pump off → alarm
        db.evaluate("pump.running", &ts(TagValue::Bool(false))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::ActiveUnacked);

        // Pump on → clear
        db.evaluate("pump.running", &ts(TagValue::Bool(true))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::NormalUnacked);
    }

    #[tokio::test]
    async fn on_delay_delays_activation() {
        let db = AlarmDb::new(8);
        // 60s on_delay — won't fire on first evaluate in test (time doesn't advance)
        let mut alarm = def("t", "temp", AlarmCondition::Above { threshold: 80.0 });
        alarm.on_delay_s = Some(60.0);
        db.load(vec![alarm]).await;

        // Condition true, but delay not elapsed → still Normal
        db.evaluate("temp", &ts(TagValue::Float(90.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::Normal, "on_delay not elapsed");

        // Condition clears → timer resets, still Normal
        db.evaluate("temp", &ts(TagValue::Float(70.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::Normal);
    }

    #[tokio::test]
    async fn inhibit_tag_suppresses_alarm() {
        let db = AlarmDb::new(8);
        let mut alarm = def("t", "temp", AlarmCondition::Above { threshold: 80.0 });
        alarm.inhibit_tag = Some("maintenance".into());
        // inhibit_condition defaults to BoolTrue
        db.load(vec![alarm]).await;

        // Inhibit active → condition fires but alarm stays Normal
        db.evaluate("maintenance", &ts(TagValue::Bool(true))).await;
        db.evaluate("temp", &ts(TagValue::Float(90.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::Normal, "inhibited");

        // Inhibit clears → alarm re-evaluates using cached value, activates
        db.evaluate("maintenance", &ts(TagValue::Bool(false))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::ActiveUnacked, "inhibit cleared");
    }
}
