//! In-memory log bus — keeps the last N tracing events in a ring buffer
//! and re-broadcasts every new one to live subscribers.
//!
//! Wire shape (`LogEvent`) is what the UI eats:
//! `{ ts_ms, level: "INFO", target: "sws_plugin_mqtt", message: "...", fields: {...} }`.
//!
//! The bus itself only stores and broadcasts. The bridge from
//! `tracing::Event` → `LogEvent` lives in `sws-runtime/src/log_layer.rs`
//! to keep `sws-core` free of a `tracing-subscriber` dependency.

use std::{collections::VecDeque, sync::Mutex};

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

/// One captured `tracing::Event`. Fields beyond `message` are flattened
/// into the JSON map so the frontend can render them later without
/// schema churn.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LogEvent {
    pub ts_ms: u64,
    pub level: String, // "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR"
    pub target: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub fields: serde_json::Map<String, serde_json::Value>,
}

// ── Il DEBUG a richiesta (18-10-2026) ────────────────────────────────────────
//
// Il bus dei log ha un livello suo, separato da quello dell'uscita standard e
// del file: di base è quello del runtime (INFO, o `RUST_LOG`), e sale a DEBUG
// per i moduli di SWS **solo finché qualcuno l'ha chiesto** — l'amministratore di
// piattaforma che guarda il log di un pannello dall'IDE (`ws_logs_dispositivo`).
// Il runtime registra qui come alzarlo e abbassarlo (`registra_alzatore`), perché
// `sws-core` non dipende da `tracing-subscriber`.

static ALZATORE: std::sync::OnceLock<Box<dyn Fn(bool) + Send + Sync>> = std::sync::OnceLock::new();
static RICHIESTE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
static DEBUG_DI_BASE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Il runtime dice come cambiare il livello del bus, e se di base è già DEBUG.
pub fn registra_alzatore(f: Box<dyn Fn(bool) + Send + Sync>, debug_di_base: bool) {
    DEBUG_DI_BASE.store(debug_di_base, std::sync::atomic::Ordering::Relaxed);
    let _ = ALZATORE.set(f);
}

/// Il livello di base è già DEBUG (`RUST_LOG`): il file li scrive.
pub fn debug_di_base() -> bool {
    DEBUG_DI_BASE.load(std::sync::atomic::Ordering::Relaxed)
}

/// Una richiesta di DEBUG: finché vive, il bus riceve il DEBUG di SWS.
pub struct RichiestaDebug(());

impl Drop for RichiestaDebug {
    fn drop(&mut self) {
        if RICHIESTE.fetch_sub(1, std::sync::atomic::Ordering::AcqRel) == 1 {
            if let Some(f) = ALZATORE.get() {
                f(false);
            }
        }
    }
}

pub fn richiedi_debug() -> RichiestaDebug {
    if RICHIESTE.fetch_add(1, std::sync::atomic::Ordering::AcqRel) == 0 {
        if let Some(f) = ALZATORE.get() {
            f(true);
        }
    }
    RichiestaDebug(())
}

/// Default ring-buffer + broadcast capacity. Sized for ~30 s at 30 ev/s
/// or a slow boot trace, whichever comes first.
pub const DEFAULT_LOG_CAPACITY: usize = 1000;

pub struct LogBus {
    cap: usize,
    buffer: Mutex<VecDeque<LogEvent>>,
    tx: broadcast::Sender<LogEvent>,
}

impl LogBus {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity.max(16));
        Self {
            cap: capacity,
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

    /// Il DEBUG a richiesta (18-10-2026): si alza alla prima richiesta, si
    /// abbassa quando cade l'ultima, non a ogni richiesta.
    #[test]
    fn il_debug_si_alza_alla_prima_richiesta_e_si_abbassa_all_ultima() {
        use std::sync::{Arc, Mutex};
        let visti: Arc<Mutex<Vec<bool>>> = Arc::default();
        let v = visti.clone();
        registra_alzatore(Box::new(move |a| v.lock().unwrap().push(a)), false);
        let a = richiedi_debug();
        let b = richiedi_debug();
        drop(a);
        assert_eq!(*visti.lock().unwrap(), vec![true]);
        drop(b);
        assert_eq!(*visti.lock().unwrap(), vec![true, false]);
        assert!(!debug_di_base());
    }

    use super::*;

    fn ev(msg: &str) -> LogEvent {
        LogEvent {
            ts_ms: 1,
            level: "INFO".into(),
            target: "test".into(),
            message: msg.into(),
            fields: Default::default(),
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
