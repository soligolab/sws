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

use crate::tag::{TagId, TagQuality, TagState, TagValue};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{broadcast, RwLock};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum AlarmSeverity {
    Info,
    #[default]
    Warning,
    Critical,
}

impl AlarmSeverity {
    /// Per `skip_serializing_if`: il valore che serde metterebbe comunque.
    pub fn e_default(&self) -> bool {
        *self == AlarmSeverity::default()
    }
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AlarmCondition {
    Above {
        threshold: f64,
    },
    Below {
        threshold: f64,
    },
    BoolEquals {
        value: bool,
    },
    BoolTrue,
    BoolFalse,
    /// Fires when ALL child conditions are true simultaneously.
    And {
        conditions: Vec<AlarmCondition>,
    },
    /// Fires when ANY child condition is true.
    Or {
        conditions: Vec<AlarmCondition>,
    },
    /// Fires when the child condition is NOT true.
    Not {
        condition: Box<AlarmCondition>,
    },
}

impl AlarmCondition {
    fn as_f64(v: &TagValue) -> Option<f64> {
        match v {
            TagValue::Float(f) => Some(*f),
            TagValue::Int(i) => Some(*i as f64),
            TagValue::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            TagValue::Str(s) => s.trim().parse().ok(),
            // Un array o una struttura NON sono un numero (Fase 1b): un
            // allarme si mette su una foglia, non su una radice. `None` =
            // la condizione non scatta, come per una stringa non numerica.
            TagValue::Array(_) | TagValue::Struct(_) => None,
        }
    }

    pub fn evaluate(&self, value: &TagValue) -> bool {
        match self {
            Self::Above { threshold } => Self::as_f64(value).is_some_and(|v| v > *threshold),
            Self::Below { threshold } => Self::as_f64(value).is_some_and(|v| v < *threshold),
            Self::BoolEquals { value: want } => matches!(value, TagValue::Bool(b) if b == want),
            Self::BoolTrue => matches!(value, TagValue::Bool(true)),
            Self::BoolFalse => matches!(value, TagValue::Bool(false)),
            Self::And { conditions } => conditions.iter().all(|c| c.evaluate(value)),
            Self::Or { conditions } => conditions.iter().any(|c| c.evaluate(value)),
            Self::Not { condition } => !condition.evaluate(value),
        }
    }

    /// Returns true when the alarm should CLEAR (leave active state).
    /// For `Above`/`Below`, applies dead_band hysteresis.
    /// For composites, dead_band is propagated to atomic children.
    pub fn evaluate_clear(&self, value: &TagValue, dead_band: f64) -> bool {
        match self {
            Self::Above { threshold } => {
                Self::as_f64(value).is_none_or(|v| v < threshold - dead_band)
            }
            Self::Below { threshold } => {
                Self::as_f64(value).is_none_or(|v| v > threshold + dead_band)
            }
            Self::BoolEquals { value: want } => !matches!(value, TagValue::Bool(b) if b == want),
            Self::BoolTrue => !matches!(value, TagValue::Bool(true)),
            Self::BoolFalse => !matches!(value, TagValue::Bool(false)),
            // And fires when ALL true → clears when ANY clears
            Self::And { conditions } => conditions
                .iter()
                .any(|c| c.evaluate_clear(value, dead_band)),
            // Or fires when ANY true → clears when ALL clear
            Self::Or { conditions } => conditions
                .iter()
                .all(|c| c.evaluate_clear(value, dead_band)),
            // Not fires when child is false → clears when child fires
            Self::Not { condition } => condition.evaluate(value),
        }
    }
}

/// Un livello di un allarme: quando scatta, quanto è grave, cosa dice.
///
/// Un tag si aggancia a **un solo** allarme, e i livelli sono le soglie dentro
/// quell'allarme (decisione del maintainer, 23-09-2026). Prima si
/// dichiaravano N allarmi distinti sullo stesso tag e scattavano **tutti
/// insieme**: con soglie 60/70/80 e il valore a 85 il runtime ne teneva tre
/// attivi per un solo fenomeno, l'operatore vedeva tre righe e la notifica
/// partiva tre volte.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AlarmLevel {
    pub condition: AlarmCondition,
    #[serde(default)]
    pub severity: AlarmSeverity,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub message: String,
    /// Isteresi di **questo** livello; assente = quella dell'allarme.
    ///
    /// Serve davvero: nel template `homeassistant-pro` «batteria sotto 15%» ha
    /// banda morta 3 e «sotto 5%» ha banda morta 1, perché una soglia di
    /// guardia e una di emergenza non oscillano allo stesso modo. Tenendola
    /// solo sull'allarme, unire i due livelli ne avrebbe persa una.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dead_band: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlarmDef {
    pub id: String,
    pub tag: TagId,
    /// I livelli, dal 23-09-2026. Vuoto = questo allarme è nel **formato
    /// vecchio** (`condition`/`severity`/`message` qui sotto): si legge, per
    /// poter aprire e correggere un progetto scritto prima, ma il validatore
    /// **rifiuta il salvataggio** finché qualcuno non lo converte a mano. Non
    /// c'è migrazione automatica: decisione del maintainer, «sono progetti di
    /// test/prova, basta correggere i template e non permettermi di salvare un
    /// progetto riaperto se non correggo io gli allarmi».
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub levels: Vec<AlarmLevel>,
    /// Formato vecchio: una condizione sola. Si deserializza ancora; nessuno
    /// la scrive più.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<AlarmCondition>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub message: String,
    /// Severità del formato vecchio. Nel formato nuovo sta nei livelli e
    /// questo campo non significa niente: non si riscrive quando vale il
    /// default, per non lasciare nel file una riga che sembra decidere
    /// qualcosa e non decide niente.
    #[serde(default, skip_serializing_if = "AlarmSeverity::e_default")]
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
    /// Where this alarm's Telegram message goes. **Absent means `Global`**, so
    /// projects written before this field existed keep notifying every chat —
    /// which is what they did, and silently changing that would lose alarms.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telegram_mode: Option<AlarmTelegramMode>,
    /// Chats for `AlarmTelegramMode::Chats`. Ignored in the other two modes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telegram_chat_ids: Option<Vec<String>>,
}

impl AlarmDef {
    /// I livelli effettivi: quelli dichiarati, o il formato vecchio letto come
    /// un livello solo. Il motore passa **sempre** di qui, così un progetto
    /// non ancora convertito continua a proteggere l'impianto mentre qualcuno
    /// lo sistema.
    pub fn livelli(&self) -> Vec<AlarmLevel> {
        if !self.levels.is_empty() {
            return self.levels.clone();
        }
        match &self.condition {
            Some(c) => vec![AlarmLevel {
                condition: c.clone(),
                severity: self.severity,
                message: self.message.clone(),
                dead_band: None,
            }],
            None => Vec::new(),
        }
    }

    /// Scritto prima del 23-09-2026: una condizione sola, fuori dai livelli.
    /// Il validatore lo rifiuta al salvataggio.
    pub fn formato_vecchio(&self) -> bool {
        self.levels.is_empty() && self.condition.is_some()
    }

    /// Il livello che vince fra quelli veri, e il suo indice.
    ///
    /// **La severità più alta**, qualunque sia l'ordine in cui le condizioni
    /// sono scritte (decisione del maintainer, 23-09-2026); a parità vince la
    /// prima dichiarata. Con soglie 60/70/80 e il valore a 85 l'allarme è
    /// Critical, che è quello che uno si aspetta guardando il pannello — con
    /// l'ordine di dichiarazione sarebbe stato Info, cioè il contrario.
    pub fn livello_vincente(&self, value: &TagValue) -> Option<(usize, AlarmLevel)> {
        self.livelli()
            .into_iter()
            .enumerate()
            .filter(|(_, l)| l.condition.evaluate(value))
            .max_by_key(|(i, l)| (l.severity, std::cmp::Reverse(*i)))
    }
}

/// Per-alarm Telegram routing.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AlarmTelegramMode {
    /// The chats configured in Configuration → Notifications. The default.
    #[default]
    Global,
    /// Only the chats listed in `telegram_chat_ids`.
    Chats,
    /// No Telegram message for this alarm.
    Off,
}

/// Resolved routing for one alarm — what the notification supervisor acts on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TelegramRouting {
    /// Don't send.
    Skip,
    /// Send to the globally configured chats.
    GlobalChats,
    /// Send only to these chats. May be **empty**, which the caller reports as a
    /// misconfiguration rather than quietly falling back to the global chats:
    /// "specific chats" with none listed is an unfinished setting, and falling
    /// back would broadcast an alarm the user was trying to narrow.
    Chats(Vec<String>),
}

impl AlarmDef {
    /// Where this alarm's Telegram message should go.
    pub fn telegram_routing(&self) -> TelegramRouting {
        match self.telegram_mode.unwrap_or_default() {
            AlarmTelegramMode::Global => TelegramRouting::GlobalChats,
            AlarmTelegramMode::Off => TelegramRouting::Skip,
            AlarmTelegramMode::Chats => {
                TelegramRouting::Chats(self.telegram_chat_ids.clone().unwrap_or_default())
            }
        }
    }
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
    /// La severità del **livello che sta scattando adesso** (23-09-2026).
    /// Con più livelli in un allarme, `def.severity` non basta più: dice
    /// quella del formato vecchio, non quella in vigore. Chi mostra o notifica
    /// deve leggere questa.
    #[serde(default)]
    pub severity: AlarmSeverity,
    /// Il messaggio del livello che sta scattando adesso, stessa ragione.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub message: String,
    /// L'indice del livello in vigore, per chi deve dire *quale* soglia è.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<usize>,
}

fn def_severity_iniziale(d: &AlarmDef) -> AlarmSeverity {
    d.livelli()
        .first()
        .map(|l| l.severity)
        .unwrap_or(d.severity)
}

fn def_message_iniziale(d: &AlarmDef) -> String {
    d.livelli()
        .first()
        .map(|l| l.message.clone())
        .unwrap_or_else(|| d.message.clone())
}

impl AlarmState {
    fn from_def(def: AlarmDef) -> Self {
        Self {
            isa_state: IsaState::Normal,
            active: false,
            acknowledged: false,
            activated_at_ms: None,
            ack_at_ms: None,
            normalized_at_ms: None,
            last_value: None,
            // A riposo vale il primo livello: è quello che l'elenco mostra
            // quando l'allarme non sta scattando.
            severity: def_severity_iniziale(&def),
            message: def_message_iniziale(&def),
            level: None,
            def,
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
    condition_true_since_ms: Option<u64>,
    /// Epoch ms when the condition first became false (for off_delay).
    condition_false_since_ms: Option<u64>,
}

// ── AlarmDb ───────────────────────────────────────────────────────────────────

/// Callback opzionale chiamata a ogni evento (il giornale degli allarmi).
type JournalCb = Arc<RwLock<Option<Box<dyn Fn(AlarmEvent) + Send + Sync + 'static>>>>;

pub struct AlarmDb {
    states: Arc<RwLock<HashMap<String, AlarmState>>>,
    by_tag: Arc<RwLock<HashMap<TagId, Vec<String>>>>,
    /// Alarms that re-evaluate when their inhibit_tag changes.
    by_inhibit_tag: Arc<RwLock<HashMap<TagId, Vec<String>>>>,
    /// Last known value of each inhibit tag (updated on evaluate()).
    inhibit_values: Arc<RwLock<HashMap<TagId, TagValue>>>,
    timers: Arc<RwLock<HashMap<String, AlarmTimer>>>,
    shelved: Arc<RwLock<HashMap<String, ShelvedAlarm>>>,
    open_events: Arc<RwLock<HashMap<String, OpenEvent>>>,
    journal: Arc<RwLock<Vec<AlarmEvent>>>,
    tx: broadcast::Sender<AlarmState>,
    journal_cb: JournalCb,
}

impl AlarmDb {
    pub fn new(channel_capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(channel_capacity);
        Self {
            states: Arc::new(RwLock::new(HashMap::new())),
            by_tag: Arc::new(RwLock::new(HashMap::new())),
            by_inhibit_tag: Arc::new(RwLock::new(HashMap::new())),
            inhibit_values: Arc::new(RwLock::new(HashMap::new())),
            timers: Arc::new(RwLock::new(HashMap::new())),
            shelved: Arc::new(RwLock::new(HashMap::new())),
            open_events: Arc::new(RwLock::new(HashMap::new())),
            journal: Arc::new(RwLock::new(Vec::new())),
            tx,
            journal_cb: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn set_journal_callback<F>(&self, cb: F)
    where
        F: Fn(AlarmEvent) + Send + Sync + 'static,
    {
        *self.journal_cb.write().await = Some(Box::new(cb));
    }

    pub async fn load(&self, defs: Vec<AlarmDef>) {
        let mut states = self.states.write().await;
        let mut by_tag = self.by_tag.write().await;
        let mut by_inhibit_tag = self.by_inhibit_tag.write().await;
        let mut timers = self.timers.write().await;
        states.clear();
        by_tag.clear();
        by_inhibit_tag.clear();
        timers.clear();
        self.shelved.write().await.clear();
        self.open_events.write().await.clear();
        self.journal.write().await.clear();
        self.inhibit_values.write().await.clear();
        for def in defs {
            by_tag
                .entry(def.tag.clone())
                .or_default()
                .push(def.id.clone());
            if let Some(itag) = &def.inhibit_tag {
                by_inhibit_tag
                    .entry(itag.clone())
                    .or_default()
                    .push(def.id.clone());
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
        // **Un dato inattendibile non decide niente.**
        //
        // Fino al 16-09-2026 qui si guardava solo `tag_state.value`, e la
        // qualità non veniva consultata mai — `quality` compariva in questo
        // file soltanto dentro i test. Intanto un plugin che perdeva la
        // sorgente scriveva `Float(0.0)` con qualità `Bad` per dire «non so
        // più»: un valore inventato da noi, che qui veniva creduto.
        //
        // Effetto misurato su un impianto vero: un allarme «potenza sotto
        // 0.1 W» scattava a **ogni riconnessione fallita** e mandava la
        // notifica Telegram — anche con la pompa che girava, anche alle tre di
        // notte quando il broker si riavviava. Il maintainer lo vedeva a ogni
        // accensione del pannello e a ogni apertura dell'IDE.
        //
        // Né scatta né rientra: l'allarme **resta com'è**. Un allarme attivo non
        // si spegne perché è caduta la sorgente — sarebbe il verso pericoloso
        // dello stesso errore, e metterebbe a tacere una cosa che sta ancora
        // suonando.
        if tag_state.quality != TagQuality::Good {
            return;
        }
        let now = now_ms();

        // Auto-expire shelved entries.
        {
            self.shelved
                .write()
                .await
                .retain(|_, sh| sh.until_ms == 0 || sh.until_ms > now);
        }
        let shelved_ids: HashSet<String> = self.shelved.read().await.keys().cloned().collect();

        // Collect affected alarm IDs.
        // use_cached=true → re-evaluate using alarm's last_value (inhibit-tag path)
        // use_cached=false → evaluate using tag_state.value (primary-tag path)
        let inhibit_ids: Vec<String> = self
            .by_inhibit_tag
            .read()
            .await
            .get(tag_id)
            .cloned()
            .unwrap_or_default();
        let primary_ids: Vec<String> = self
            .by_tag
            .read()
            .await
            .get(tag_id)
            .cloned()
            .unwrap_or_default();

        if inhibit_ids.is_empty() && primary_ids.is_empty() {
            return;
        }

        // Update inhibit cache before taking other write locks.
        if !inhibit_ids.is_empty() {
            self.inhibit_values
                .write()
                .await
                .insert(tag_id.to_string(), tag_state.value.clone());
        }

        // Snapshot inhibit values for use inside the lock.
        let inhibit_values: HashMap<TagId, TagValue> = self.inhibit_values.read().await.clone();

        let mut to_emit: Vec<AlarmState> = Vec::new();
        let mut completed_events: Vec<AlarmEvent> = Vec::new();

        {
            let mut states = self.states.write().await;
            let mut timers = self.timers.write().await;
            let mut open_events = self.open_events.write().await;

            // Inhibit-tag path: re-evaluate using each alarm's cached last_value.
            for id in &inhibit_ids {
                if shelved_ids.contains(id) {
                    continue;
                }
                let cached_val = match states.get(id).and_then(|s| s.last_value.clone()) {
                    Some(v) => v,
                    None => continue, // alarm never evaluated — nothing to re-check
                };
                eval_one(
                    id,
                    &cached_val,
                    now,
                    false, /* don't update last_value */
                    &mut states,
                    &mut timers,
                    &mut open_events,
                    &inhibit_values,
                    &shelved_ids,
                    &mut to_emit,
                    &mut completed_events,
                );
            }

            // Primary-tag path.
            for id in &primary_ids {
                if shelved_ids.contains(id) {
                    continue;
                }
                eval_one(
                    id,
                    &tag_state.value,
                    now,
                    true,
                    &mut states,
                    &mut timers,
                    &mut open_events,
                    &inhibit_values,
                    &shelved_ids,
                    &mut to_emit,
                    &mut completed_events,
                );
            }
        }

        // Persist completed events outside the state lock.
        if !completed_events.is_empty() {
            let cb = self.journal_cb.read().await;
            let mut journal = self.journal.write().await;
            for ev in completed_events {
                if let Some(f) = cb.as_ref() {
                    f(ev.clone());
                }
                journal.push(ev);
            }
        }
        for st in to_emit {
            let _ = self.tx.send(st);
        }
    }

    pub async fn ack(&self, id: &str, by: Option<String>) -> bool {
        let mut states = self.states.write().await;
        let Some(s) = states.get_mut(id) else {
            return false;
        };

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
                if let Some(f) = cb.as_ref() {
                    f(ev.clone());
                }
                journal.push(ev);
            }
        }

        let _ = self.tx.send(snap);
        true
    }

    pub async fn shelve(
        &self,
        id: &str,
        reason: String,
        duration_ms: u64,
        shelved_by: String,
    ) -> bool {
        if !self.states.read().await.contains_key(id) {
            return false;
        }
        let now = now_ms();
        let until_ms = if duration_ms == 0 {
            0
        } else {
            now + duration_ms
        };
        self.shelved.write().await.insert(
            id.to_string(),
            ShelvedAlarm {
                alarm_id: id.to_string(),
                reason,
                until_ms,
                shelved_by,
                shelved_at_ms: now,
            },
        );
        true
    }

    pub async fn unshelve(&self, id: &str) {
        self.shelved.write().await.remove(id);
    }

    pub async fn shelved_snapshot(&self) -> Vec<ShelvedAlarm> {
        let now = now_ms();
        self.shelved
            .read()
            .await
            .values()
            .filter(|sh| sh.until_ms == 0 || sh.until_ms > now)
            .cloned()
            .collect()
    }
}

// ── Core evaluation helper (sync — called inside async lock blocks) ────────────

#[allow(clippy::too_many_arguments)]
fn eval_one(
    id: &str,
    tag_value: &TagValue,
    now: u64,
    update_last_val: bool,
    states: &mut HashMap<String, AlarmState>,
    timers: &mut HashMap<String, AlarmTimer>,
    open_events: &mut HashMap<String, OpenEvent>,
    inhibit_values: &HashMap<TagId, TagValue>,
    shelved_ids: &HashSet<String>,
    to_emit: &mut Vec<AlarmState>,
    completed_events: &mut Vec<AlarmEvent>,
) {
    if shelved_ids.contains(id) {
        return;
    }
    let Some(s) = states.get_mut(id) else { return };

    // Cache last_value before inhibit check so inhibit-clear re-evaluation has
    // a value to work with even if the alarm was suppressed during this call.
    if update_last_val {
        s.last_value = Some(tag_value.clone());
    }

    // ── Inhibit check ──────────────────────────────────────────────────────────
    if let Some(itag) = &s.def.inhibit_tag.clone() {
        if let Some(ival) = inhibit_values.get(itag) {
            let inhibited = s
                .def
                .inhibit_condition
                .as_ref()
                .map(|cond| cond.evaluate(ival))
                .unwrap_or_else(|| matches!(ival, TagValue::Bool(true)));
            if inhibited {
                return;
            }
        }
    }

    // ── Quale livello sta scattando ────────────────────────────────────────────
    // La severità più alta fra le condizioni vere (23-09-2026). L'allarme è uno
    // solo: i livelli sono le sue soglie, non tre allarmi diversi.
    let vincente = s.def.livello_vincente(tag_value);
    let raw_fired = vincente.is_some();

    // ── Apply on_delay / off_delay ─────────────────────────────────────────────
    let timer = timers.entry(id.to_string()).or_default();
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
    // Con più livelli «rientrato» vuol dire **nessuno** più vero, isteresi
    // compresa: basta una soglia ancora superata e l'allarme resta.
    let tutti_rientrati = s.def.livelli().iter().all(|l| {
        l.condition
            .evaluate_clear(tag_value, l.dead_band.unwrap_or(dead_band))
    });

    // Il peggioramento su un allarme già confermato lo rimette da confermare
    // (decisione del maintainer, 23-09-2026): chi ha messo a tacere un Warning
    // deve accorgersi di essere finito in Critical. Un miglioramento no: il
    // livello scende e la conferma resta valida.
    if let Some((idx, liv)) = &vincente {
        if fired && liv.severity > s.severity && s.isa_state != IsaState::Normal {
            if s.isa_state == IsaState::ActiveAcked {
                s.isa_state = IsaState::ActiveUnacked;
                s.ack_at_ms = None;
            }
            s.severity = liv.severity;
            s.message = liv.message.clone();
            s.level = Some(*idx);
            s.sync_compat();
            to_emit.push(s.clone());
        } else if fired {
            s.severity = liv.severity;
            s.message = liv.message.clone();
            s.level = Some(*idx);
        }
    }

    match (prev, fired) {
        // Normal → ActiveUnacked
        (IsaState::Normal, true) => {
            s.isa_state = IsaState::ActiveUnacked;
            s.activated_at_ms = Some(now);
            s.ack_at_ms = None;
            s.normalized_at_ms = None;
            open_events.insert(
                id.to_string(),
                OpenEvent {
                    alarm_id: id.to_string(),
                    alarm_message: s.def.message.clone(),
                    severity: s.def.severity,
                    ts_activated_ms: now,
                    ts_acked_ms: None,
                    acked_by: None,
                },
            );
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
            let cleared = tutti_rientrati;
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
            let cleared = tutti_rientrati;
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

/// Adesso, in millisecondi dall'epoca Unix.
///
/// Vive qui perché è il minimo comune di tutto il workspace: fino al
/// 2026-09-09 la stessa funzione era scritta **nove volte** in sette crate
/// (con due nomi diversi). Un orologio solo è anche l'unico modo di poterlo
/// un giorno sostituire — per i test, o per un tempo monotono — in un punto.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tag::TagQuality;

    /// Un allarme a un livello solo, nel formato nuovo. I test che c'erano
    /// prima descrivono la stessa cosa: una soglia, una severità.
    fn def(id: &str, tag: &str, cond: AlarmCondition) -> AlarmDef {
        livelli(
            id,
            tag,
            vec![AlarmLevel {
                condition: cond,
                severity: AlarmSeverity::Warning,
                message: format!("{id} fired"),
                dead_band: None,
            }],
        )
    }

    /// Un allarme con i livelli che gli si danno.
    fn livelli(id: &str, tag: &str, levels: Vec<AlarmLevel>) -> AlarmDef {
        AlarmDef {
            id: id.into(),
            tag: tag.into(),
            levels,
            condition: None,
            message: String::new(),
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
            telegram_mode: None,
            telegram_chat_ids: None,
        }
    }

    fn ts(value: TagValue) -> TagState {
        TagState {
            value,
            quality: TagQuality::Good,
            timestamp_ms: 0,
        }
    }

    #[tokio::test]
    async fn four_state_isa182_cycle() {
        let db = AlarmDb::new(8);
        db.load(vec![def(
            "t",
            "tag",
            AlarmCondition::Above { threshold: 80.0 },
        )])
        .await;

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
        db.load(vec![def(
            "t",
            "tag",
            AlarmCondition::Above { threshold: 80.0 },
        )])
        .await;

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
        assert_eq!(
            db.snapshot().await[0].isa_state,
            IsaState::ActiveUnacked,
            "above dead_band floor 78"
        );

        db.evaluate("tag", &ts(TagValue::Float(77.0))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::NormalUnacked);
    }

    #[tokio::test]
    async fn bool_condition_cycle() {
        let db = AlarmDb::new(8);
        db.load(vec![def("f", "pump.fault", AlarmCondition::BoolTrue)])
            .await;
        db.evaluate("pump.fault", &ts(TagValue::Bool(true))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::ActiveUnacked);
        db.evaluate("pump.fault", &ts(TagValue::Bool(false))).await;
        assert_eq!(db.snapshot().await[0].isa_state, IsaState::NormalUnacked);
    }

    #[tokio::test]
    async fn and_condition_fires_only_when_all_true() {
        let db = AlarmDb::new(8);
        // Fires when 10 < value < 100 (range alarm)
        db.load(vec![def(
            "r",
            "sensor",
            AlarmCondition::And {
                conditions: vec![
                    AlarmCondition::Above { threshold: 10.0 },
                    AlarmCondition::Below { threshold: 100.0 },
                ],
            },
        )])
        .await;

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
        db.load(vec![def(
            "r",
            "sensor",
            AlarmCondition::Or {
                conditions: vec![
                    AlarmCondition::Below { threshold: 10.0 },
                    AlarmCondition::Above { threshold: 100.0 },
                ],
            },
        )])
        .await;

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
        db.load(vec![def(
            "p",
            "pump.running",
            AlarmCondition::Not {
                condition: Box::new(AlarmCondition::BoolTrue),
            },
        )])
        .await;

        // Pump off → alarm
        db.evaluate("pump.running", &ts(TagValue::Bool(false)))
            .await;
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
        assert_eq!(
            db.snapshot().await[0].isa_state,
            IsaState::Normal,
            "on_delay not elapsed"
        );

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
        assert_eq!(
            db.snapshot().await[0].isa_state,
            IsaState::Normal,
            "inhibited"
        );

        // Inhibit clears → alarm re-evaluates using cached value, activates
        db.evaluate("maintenance", &ts(TagValue::Bool(false))).await;
        assert_eq!(
            db.snapshot().await[0].isa_state,
            IsaState::ActiveUnacked,
            "inhibit cleared"
        );
    }

    // ── Instradamento Telegram per allarme ────────────────────────────────────

    #[test]
    fn telegram_routing_assente_significa_chat_globali() {
        // I progetti scritti prima di questo campo notificavano tutte le chat.
        // Se l'assenza valesse "non notificare", aggiornare SWS spegnerebbe in
        // silenzio le notifiche di allarmi già in servizio.
        let d = def("a1", "t", AlarmCondition::BoolTrue);
        assert_eq!(d.telegram_routing(), TelegramRouting::GlobalChats);
        // E deve restare assente in YAML, non comparire come `global`.
        let y = serde_yaml::to_string(&d).unwrap();
        assert!(
            !y.contains("telegram_mode"),
            "campo scritto anche se assente:\n{y}"
        );
    }

    #[test]
    fn telegram_routing_off_non_manda_nulla() {
        let mut d = def("a2", "t", AlarmCondition::BoolTrue);
        d.telegram_mode = Some(AlarmTelegramMode::Off);
        // Chat rimaste da una scelta precedente: non devono resuscitare l'invio.
        d.telegram_chat_ids = Some(vec!["123".into()]);
        assert_eq!(d.telegram_routing(), TelegramRouting::Skip);
    }

    #[test]
    fn telegram_routing_chat_specifiche() {
        let mut d = def("a3", "t", AlarmCondition::BoolTrue);
        d.telegram_mode = Some(AlarmTelegramMode::Chats);
        d.telegram_chat_ids = Some(vec!["1".into(), "2".into()]);
        assert_eq!(
            d.telegram_routing(),
            TelegramRouting::Chats(vec!["1".into(), "2".into()])
        );
    }

    #[test]
    fn telegram_routing_chat_specifiche_vuote_non_ricadono_sul_globale() {
        // Impostazione incompleta: l'utente stava restringendo i destinatari.
        // Ricadere sulle chat globali manderebbe l'allarme proprio a tutti.
        let mut d = def("a4", "t", AlarmCondition::BoolTrue);
        d.telegram_mode = Some(AlarmTelegramMode::Chats);
        assert_eq!(d.telegram_routing(), TelegramRouting::Chats(vec![]));
    }

    #[test]
    fn telegram_mode_off_sopravvive_al_giro_su_yaml() {
        // `off` in YAML è un token booleano (YAML 1.1: off/on/no/yes). Se
        // serializzatore e parser non sono d'accordo, l'allarme messo a "non
        // notificare" torna dal disco come errore di parsing — cioè il progetto
        // non si apre più. Il giro completo è l'unica verifica che conta.
        let mut d = def("a6", "t", AlarmCondition::BoolTrue);
        d.telegram_mode = Some(AlarmTelegramMode::Off);
        let y = serde_yaml::to_string(&d).unwrap();
        let back: AlarmDef = serde_yaml::from_str(&y).expect("rilettura di telegram_mode: off");
        assert_eq!(
            back.telegram_routing(),
            TelegramRouting::Skip,
            "YAML prodotto:\n{y}"
        );
    }

    #[test]
    fn telegram_mode_si_deserializza_in_snake_case() {
        let d: AlarmDef = serde_yaml::from_str(
            "id: a5\ntag: t\ncondition:\n  kind: bool_true\nmessage: m\ntelegram_mode: chats\ntelegram_chat_ids: ['-100123']\n",
        ).unwrap();
        assert_eq!(
            d.telegram_routing(),
            TelegramRouting::Chats(vec!["-100123".into()])
        );
    }

    // ── Un allarme, più livelli (23-09-2026) ───────────────────────────────

    fn liv(soglia: f64, sev: AlarmSeverity) -> AlarmLevel {
        AlarmLevel {
            condition: AlarmCondition::Above { threshold: soglia },
            severity: sev,
            message: format!("sopra {soglia}"),
            dead_band: None,
        }
    }

    fn tre_livelli() -> AlarmDef {
        livelli(
            "a1",
            "t",
            vec![
                liv(60.0, AlarmSeverity::Info),
                liv(70.0, AlarmSeverity::Warning),
                liv(80.0, AlarmSeverity::Critical),
            ],
        )
    }

    /// Il caso che ha fatto nascere il modello: con soglie 60/70/80 e il
    /// valore a 85 prima scattavano **tre allarmi distinti**. Ora è un allarme
    /// solo, e vince la severità più alta — non la prima scritta.
    #[test]
    fn vince_la_severita_piu_alta_non_l_ordine() {
        let d = tre_livelli();
        let v = |x: f64| {
            d.livello_vincente(&TagValue::Float(x))
                .map(|(i, l)| (i, l.severity))
        };
        assert_eq!(v(85.0), Some((2, AlarmSeverity::Critical)));
        assert_eq!(v(75.0), Some((1, AlarmSeverity::Warning)));
        assert_eq!(v(65.0), Some((0, AlarmSeverity::Info)));
        assert_eq!(v(10.0), None);
    }

    /// A parità di severità vince la prima dichiarata: due modi di dire la
    /// stessa gravità non devono dipendere dall'ordine di valutazione.
    #[test]
    fn a_parita_di_severita_vince_la_prima() {
        let d = livelli(
            "a1",
            "t",
            vec![
                AlarmLevel {
                    condition: AlarmCondition::Above { threshold: 10.0 },
                    severity: AlarmSeverity::Warning,
                    message: "prima".into(),
                    dead_band: None,
                },
                AlarmLevel {
                    condition: AlarmCondition::Above { threshold: 20.0 },
                    severity: AlarmSeverity::Warning,
                    message: "seconda".into(),
                    dead_band: None,
                },
            ],
        );
        let (i, l) = d.livello_vincente(&TagValue::Float(50.0)).unwrap();
        assert_eq!((i, l.message.as_str()), (0, "prima"));
    }

    /// Lo stato porta la severità **in vigore**, non quella della definizione:
    /// è quella che l'elenco mostra e che la notifica usa.
    #[tokio::test]
    async fn lo_stato_dice_la_severita_del_livello_in_vigore() {
        let db = AlarmDb::new(8);
        db.load(vec![tre_livelli()]).await;

        db.evaluate("t", &ts(TagValue::Float(65.0))).await;
        let s = db.snapshot().await;
        assert_eq!(s[0].severity, AlarmSeverity::Info);
        assert!(s[0].active);

        db.evaluate("t", &ts(TagValue::Float(85.0))).await;
        let s = db.snapshot().await;
        assert_eq!(s[0].severity, AlarmSeverity::Critical);
        assert_eq!(s[0].message, "sopra 80");
        // **Un** allarme, non tre: è il punto del modello.
        assert_eq!(s.len(), 1);
    }

    /// Peggiorando, un allarme già confermato torna da confermare: chi ha
    /// messo a tacere un Warning deve accorgersi del Critical.
    #[tokio::test]
    async fn il_peggioramento_rimette_da_confermare() {
        let db = AlarmDb::new(8);
        db.load(vec![tre_livelli()]).await;
        db.evaluate("t", &ts(TagValue::Float(75.0))).await;
        db.ack("a1", Some("mario".into())).await;
        let s = db.snapshot().await;
        assert_eq!(s[0].isa_state, IsaState::ActiveAcked);

        db.evaluate("t", &ts(TagValue::Float(85.0))).await;
        let s = db.snapshot().await;
        assert_eq!(
            s[0].isa_state,
            IsaState::ActiveUnacked,
            "il Critical va confermato di nuovo"
        );
        assert_eq!(s[0].severity, AlarmSeverity::Critical);
    }

    /// Migliorando no: la conferma resta valida, il livello scende.
    #[tokio::test]
    async fn il_miglioramento_non_annulla_la_conferma() {
        let db = AlarmDb::new(8);
        db.load(vec![tre_livelli()]).await;
        db.evaluate("t", &ts(TagValue::Float(85.0))).await;
        db.ack("a1", Some("mario".into())).await;
        db.evaluate("t", &ts(TagValue::Float(65.0))).await;
        let s = db.snapshot().await;
        assert_eq!(s[0].isa_state, IsaState::ActiveAcked);
        assert!(s[0].active, "una soglia più bassa è ancora superata");
    }

    /// L'allarme rientra solo quando **nessun** livello è più vero.
    #[tokio::test]
    async fn rientra_solo_quando_nessuna_soglia_e_superata() {
        let db = AlarmDb::new(8);
        db.load(vec![tre_livelli()]).await;
        db.evaluate("t", &ts(TagValue::Float(85.0))).await;
        db.evaluate("t", &ts(TagValue::Float(65.0))).await;
        assert!(db.snapshot().await[0].active, "sopra 60 è ancora vera");
        db.evaluate("t", &ts(TagValue::Float(5.0))).await;
        assert!(!db.snapshot().await[0].active);
    }

    /// Il formato vecchio si legge ancora — serve a poter APRIRE un progetto
    /// scritto prima e correggerlo — e si riconosce.
    #[test]
    fn il_formato_vecchio_si_legge_e_si_riconosce() {
        let d: AlarmDef = serde_yaml::from_str(
            "id: a1\ntag: t\ncondition: { kind: above, threshold: 60 }\nmessage: caldo\nseverity: Critical\n",
        )
        .unwrap();
        assert!(d.formato_vecchio());
        let l = d.livelli();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].severity, AlarmSeverity::Critical);
        assert_eq!(l[0].message, "caldo");
        assert_eq!(
            d.livello_vincente(&TagValue::Float(99.0))
                .unwrap()
                .1
                .severity,
            AlarmSeverity::Critical
        );

        // Il formato nuovo non è «vecchio», e non riscrive `condition`.
        let n = tre_livelli();
        assert!(!n.formato_vecchio());
        let y = serde_yaml::to_string(&n).unwrap();
        // Nessun campo di PRIMO livello del formato vecchio: le `condition:`
        // che restano sono quelle dentro i livelli, rientrate.
        assert!(
            !y.lines()
                .any(|r| r == "condition:" || r.starts_with("condition:")),
            "{y}"
        );
        assert!(!y.lines().any(|r| r.starts_with("severity:")), "{y}");
        assert!(y.contains("levels:"), "{y}");
    }
}

/// Un allarme non deve credere a un dato che il sistema stesso ha dichiarato
/// inattendibile.
///
/// Il guasto da cui nasce, misurato su un impianto vero il 16-09-2026: un
/// plugin che perdeva la sorgente scriveva `Float(0.0)` con qualità `Bad` per
/// dire «non so più», e l'allarme «potenza sotto 0.1 W» ci credeva. Risultato:
/// una notifica Telegram a ogni accensione del pannello, a ogni apertura
/// dell'IDE e a ogni riconnessione fallita — con la pompa che girava.
#[cfg(test)]
mod qualita_tests {
    use super::*;
    use crate::tag::TagQuality;

    fn stato(v: f64, q: TagQuality) -> TagState {
        TagState {
            value: TagValue::Float(v),
            quality: q,
            timestamp_ms: now_ms(),
        }
    }

    fn def() -> AlarmDef {
        serde_yaml::from_str(
            "id: pompa_spenta\ntag: p.potenza\nmessage: spenta\ncondition:\n  kind: below\n  threshold: 0.1\n",
        )
        .expect("AlarmDef di prova")
    }

    async fn attivo(db: &AlarmDb) -> bool {
        db.snapshot()
            .await
            .first()
            .map(|a| a.active)
            .unwrap_or(false)
    }

    #[tokio::test]
    async fn un_valore_inattendibile_non_fa_scattare_l_allarme() {
        // È il caso del maintainer: lo zero non veniva dall'impianto, veniva
        // da noi.
        let db = AlarmDb::new(8);
        db.load(vec![def()]).await;
        db.evaluate("p.potenza", &stato(0.0, TagQuality::Bad)).await;
        assert!(
            !attivo(&db).await,
            "ha creduto a un valore dichiarato inattendibile"
        );
    }

    #[tokio::test]
    async fn un_valore_buono_lo_fa_scattare_come_sempre() {
        let db = AlarmDb::new(8);
        db.load(vec![def()]).await;
        db.evaluate("p.potenza", &stato(0.0, TagQuality::Good))
            .await;
        assert!(
            attivo(&db).await,
            "un dato buono deve far scattare l'allarme"
        );
    }

    #[tokio::test]
    async fn una_sorgente_che_cade_non_mette_a_tacere_un_allarme_attivo() {
        // Il verso pericoloso dello stesso errore: se l'allarme sta suonando e
        // la sorgente cade, spegnerlo nasconderebbe una cosa ancora vera.
        let db = AlarmDb::new(8);
        db.load(vec![def()]).await;
        db.evaluate("p.potenza", &stato(0.0, TagQuality::Good))
            .await;
        assert!(attivo(&db).await);
        db.evaluate("p.potenza", &stato(99.0, TagQuality::Bad))
            .await;
        assert!(
            attivo(&db).await,
            "una sorgente caduta ha spento un allarme vero"
        );
    }
}
