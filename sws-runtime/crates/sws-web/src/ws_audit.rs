//! The audit rows of the writes made on the tag socket (rc.30).
//!
//! Until rc.29 the socket wrote no row at all, while the manual says every tag
//! write ends up in the audit log (collaudo on the PLX800, 23-11-2026: a dozen
//! commands from the viewer, only the logins in `audit.jsonl`). A row per
//! frame, though, is not what a socket needs: a slider being dragged sends tens
//! of writes a second, the performance bench thousands, and on a panel the
//! audit file is never trimmed and is read whole at every start.
//!
//! So each socket has one small task that turns its writes into rows:
//! - the **first** write of a tag is a row at once, as on the REST route;
//! - the writes of the same tag in the second after it become **one** row,
//!   with the last value and how many they were (`coalesced`), written when
//!   the second is over (or when the socket closes);
//! - at most [`ROWS_PER_SECOND`] immediate rows a second per socket: beyond
//!   that, one row a second says how many writes were not listed one by one
//!   (`summarized`), so a flood cannot fill the panel's disk;
//! - a frame that finds the queue full is counted, and said in a row.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::mpsc;
use tokio::time::{Duration, Instant, MissedTickBehavior};

/// How long the writes of one tag are gathered into one row.
const WINDOW: Duration = Duration::from_secs(1);
/// Immediate rows a second, per socket.
const ROWS_PER_SECOND: u32 = 20;
/// Frames waiting for the task; beyond, they are counted, not queued.
const QUEUE: usize = 1024;

/// One write as the socket saw it: the action (`tag.write`,
/// `tag.write_denied`, `tag.write_rejected_type`), who, the tag, and the
/// detail of the row (with `via: ws`).
pub struct WsWrite {
    pub action: &'static str,
    pub who: Option<String>,
    pub tag: String,
    pub detail: serde_json::Value,
}

/// The handle the socket keeps; dropping it ends the task, which writes what
/// it still holds.
pub struct WsAudit {
    tx: mpsc::Sender<WsWrite>,
    dropped: Arc<AtomicU64>,
}

impl WsAudit {
    pub fn start(audit: Arc<sws_audit::AuditLog>) -> Self {
        Self::start_with(move |action, who, detail| audit.log(action, who, detail))
    }

    fn start_with<F>(log: F) -> Self
    where
        F: FnMut(&'static str, Option<String>, serde_json::Value) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel(QUEUE);
        let dropped = Arc::new(AtomicU64::new(0));
        tokio::spawn(run(rx, dropped.clone(), log));
        Self { tx, dropped }
    }

    pub fn record(&self, write: WsWrite) {
        if self.tx.try_send(write).is_err() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}

struct Burst {
    started: Instant,
    who: Option<String>,
    last: Option<serde_json::Value>,
    more: u64,
}

async fn run<F>(mut rx: mpsc::Receiver<WsWrite>, dropped: Arc<AtomicU64>, mut log: F)
where
    F: FnMut(&'static str, Option<String>, serde_json::Value),
{
    let mut bursts: HashMap<(&'static str, String), Burst> = HashMap::new();
    let mut over: HashMap<&'static str, (u64, Option<String>)> = HashMap::new();
    let mut second = Instant::now();
    let mut rows = 0u32;
    let mut tick = tokio::time::interval(WINDOW);
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            w = rx.recv() => {
                let Some(w) = w else { break };
                let now = Instant::now();
                if now.duration_since(second) >= WINDOW {
                    second = now;
                    rows = 0;
                }
                let key = (w.action, w.tag);
                if let Some(b) = bursts.get_mut(&key) {
                    if now.duration_since(b.started) < WINDOW {
                        b.last = Some(w.detail);
                        b.who = w.who;
                        b.more += 1;
                        continue;
                    }
                }
                if let Some(b) = bursts.remove(&key) {
                    close(&mut log, key.0, b);
                }
                if rows >= ROWS_PER_SECOND {
                    let e = over.entry(w.action).or_insert((0, None));
                    e.0 += 1;
                    e.1 = w.who;
                    continue;
                }
                rows += 1;
                log(w.action, w.who.clone(), w.detail);
                bursts.insert(key, Burst { started: now, who: w.who, last: None, more: 0 });
            }
            _ = tick.tick() => {
                let now = Instant::now();
                let done: Vec<_> = bursts
                    .iter()
                    .filter(|(_, b)| now.duration_since(b.started) >= WINDOW)
                    .map(|(k, _)| k.clone())
                    .collect();
                for k in done {
                    if let Some(b) = bursts.remove(&k) {
                        close(&mut log, k.0, b);
                    }
                }
                flush_over(&mut log, &mut over, &dropped);
            }
        }
    }
    for ((action, _), b) in bursts.drain() {
        close(&mut log, action, b);
    }
    flush_over(&mut log, &mut over, &dropped);
}

/// The row of a burst: the last value, and how many writes came after the
/// row already written. Nothing when the first write was the only one.
fn close<F>(log: &mut F, action: &'static str, b: Burst)
where
    F: FnMut(&'static str, Option<String>, serde_json::Value),
{
    if let Some(mut detail) = b.last {
        if let Some(o) = detail.as_object_mut() {
            o.insert("coalesced".into(), b.more.into());
        }
        log(action, b.who, detail);
    }
}

fn flush_over<F>(
    log: &mut F,
    over: &mut HashMap<&'static str, (u64, Option<String>)>,
    dropped: &AtomicU64,
) where
    F: FnMut(&'static str, Option<String>, serde_json::Value),
{
    for (action, (count, who)) in over.drain() {
        log(
            action,
            who,
            serde_json::json!({ "via": "ws", "summarized": count }),
        );
    }
    let lost = dropped.swap(0, Ordering::Relaxed);
    if lost > 0 {
        log(
            "tag.write_unrecorded",
            None,
            serde_json::json!({ "via": "ws", "count": lost }),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    type Rows = Arc<Mutex<Vec<(String, Option<String>, serde_json::Value)>>>;

    fn collector() -> (WsAudit, Rows) {
        let rows: Rows = Arc::default();
        let r = rows.clone();
        let a = WsAudit::start_with(move |action, who, detail| {
            r.lock().unwrap().push((action.to_string(), who, detail));
        });
        (a, rows)
    }

    fn write(tag: &str, value: i64) -> WsWrite {
        WsWrite {
            action: "tag.write",
            who: Some("op".into()),
            tag: tag.into(),
            detail: serde_json::json!({ "tag": tag, "value": value, "via": "ws" }),
        }
    }

    async fn settle() {
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_single_write_is_one_row_at_once() {
        let (a, rows) = collector();
        a.record(write("light", 1));
        settle().await;
        assert_eq!(rows.lock().unwrap().len(), 1);
        tokio::time::sleep(Duration::from_secs(3)).await;
        let rows = rows.lock().unwrap();
        assert_eq!(rows.len(), 1, "nothing more for a lone write: {rows:?}");
        assert_eq!(rows[0].1.as_deref(), Some("op"));
        assert_eq!(rows[0].2["value"], 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_dragged_slider_is_two_rows_with_the_last_value() {
        let (a, rows) = collector();
        for v in 0..10 {
            a.record(write("speed", v));
            settle().await;
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
        let rows = rows.lock().unwrap();
        assert_eq!(rows.len(), 2, "{rows:?}");
        assert_eq!(rows[0].2["value"], 0);
        assert_eq!(rows[1].2["value"], 9);
        assert_eq!(rows[1].2["coalesced"], 9);
    }

    #[tokio::test(start_paused = true)]
    async fn a_flood_is_bounded_and_counted() {
        let (a, rows) = collector();
        for i in 0..100 {
            a.record(write(&format!("t{i}"), i));
        }
        settle().await;
        tokio::time::sleep(Duration::from_secs(3)).await;
        let rows = rows.lock().unwrap();
        let single = rows
            .iter()
            .filter(|r| r.2.get("summarized").is_none())
            .count();
        let summary: Vec<_> = rows
            .iter()
            .filter(|r| r.2.get("summarized").is_some())
            .collect();
        assert_eq!(single, ROWS_PER_SECOND as usize);
        assert_eq!(summary.len(), 1);
        assert_eq!(summary[0].2["summarized"], 100 - ROWS_PER_SECOND as u64);
    }

    #[tokio::test(start_paused = true)]
    async fn closing_the_socket_writes_what_was_held() {
        let (a, rows) = collector();
        a.record(write("speed", 1));
        a.record(write("speed", 2));
        settle().await;
        drop(a);
        settle().await;
        let rows = rows.lock().unwrap();
        assert_eq!(rows.len(), 2, "{rows:?}");
        assert_eq!(rows[1].2["value"], 2);
        assert_eq!(rows[1].2["coalesced"], 1);
    }
}
