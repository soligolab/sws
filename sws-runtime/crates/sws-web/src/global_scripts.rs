//! Supervisor for global Python scripts defined in `project.yaml`.
//!
//! Each enabled `GlobalScriptDef` gets a dedicated tokio task whose lifecycle
//! is tied to a `CancellationToken`. `GlobalScriptSupervisor::stop()` cancels
//! all tasks (fire-and-forget — tasks will terminate asynchronously).
//!
//! The supervisor is wrapped in `Arc` so it is cheaply cloneable alongside
//! the rest of `AppState`.

use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

use sws_core::{GlobalScriptDef, ScriptTrigger, TagDb, TagValue, TagWriteBus};
use sws_pyscript::Engine as PyEngine;

/// Cheap clone handle for the running script supervisor.
#[derive(Clone)]
pub struct GlobalScriptSupervisor {
    cancel: CancellationToken,
}

impl GlobalScriptSupervisor {
    /// Spawn tasks for all enabled scripts in `scripts`.
    pub fn start(
        scripts: Vec<GlobalScriptDef>,
        db: Arc<TagDb>,
        bus: Arc<TagWriteBus>,
    ) -> Self {
        let cancel = CancellationToken::new();

        for script in scripts {
            if !script.enabled {
                debug!(id = %script.id, "global script disabled, skipping");
                continue;
            }
            let cancel_child = cancel.child_token();
            let py = PyEngine::new(db.clone(), bus.clone());
            let db_clone = db.clone();

            let id = script.id.clone();
            let trigger = script.trigger.clone();
            let code = script.code.clone();

            tokio::spawn(async move {
                info!(id = %id, ?trigger, "global script task starting");
                run_script_task(id, trigger, code, py, db_clone, cancel_child).await;
            });
        }

        Self { cancel }
    }

    /// Cancel all script tasks (non-blocking; tasks stop asynchronously).
    pub fn stop(&self) {
        self.cancel.cancel();
    }
}

async fn run_script_task(
    id: String,
    trigger: ScriptTrigger,
    code: String,
    py: PyEngine,
    db: Arc<TagDb>,
    cancel: CancellationToken,
) {
    match trigger {
        ScriptTrigger::Startup => {
            exec_once(&id, &code, &py).await;
        }

        ScriptTrigger::Interval { interval_s } => {
            let dur = Duration::from_secs(interval_s.max(1));
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = sleep(dur) => {
                        exec_once(&id, &code, &py).await;
                    }
                }
            }
        }

        ScriptTrigger::Cron { schedule } => {
            loop {
                let secs_until = seconds_until_next(&schedule);
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = sleep(Duration::from_secs(secs_until)) => {
                        exec_once(&id, &code, &py).await;
                    }
                }
            }
        }

        ScriptTrigger::TagChange { tag, edge } => {
            let mut rx = db.subscribe();
            let mut last_val: Option<TagValue> = db.get(&tag).await.map(|s| s.value);

            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    result = rx.recv() => {
                        match result {
                            Ok(update) if update.id == tag => {
                                let new_val = update.state.value.clone();
                                let fire = should_fire_on_edge(&edge, &last_val, &new_val);
                                last_val = Some(new_val);
                                if fire {
                                    exec_once(&id, &code, &py).await;
                                }
                            }
                            Ok(_) => {}
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                                warn!(id = %id, lagged = n, "global script missed tag updates");
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                error!(id = %id, "tag broadcast channel closed; stopping script");
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    info!(id = %id, "global script task stopped");
}

async fn exec_once(id: &str, code: &str, py: &PyEngine) {
    match py.execute(code.to_owned()).await {
        Ok(out) => {
            if !out.stdout.is_empty() {
                info!(id = %id, stdout = %out.stdout.trim_end(), "global script output");
            }
            if !out.stderr.is_empty() {
                warn!(id = %id, stderr = %out.stderr.trim_end(), "global script stderr");
            }
        }
        Err(e) => {
            error!(id = %id, error = %e, "global script execution failed");
        }
    }
}

/// Returns true when an edge condition is met.
fn should_fire_on_edge(edge: &str, prev: &Option<TagValue>, curr: &TagValue) -> bool {
    match edge {
        "any" => true,
        "rising" => {
            let was_false = prev.as_ref().map(is_falsy).unwrap_or(true);
            was_false && !is_falsy(curr)
        }
        "falling" => {
            let was_true = prev.as_ref().map(|v| !is_falsy(v)).unwrap_or(false);
            was_true && is_falsy(curr)
        }
        other => {
            warn!(edge = %other, "unknown edge type for global script; defaulting to 'any'");
            true
        }
    }
}

fn is_falsy(v: &TagValue) -> bool {
    match v {
        TagValue::Bool(b)  => !b,
        TagValue::Int(i)   => *i == 0,
        TagValue::Float(f) => *f == 0.0,
        TagValue::Str(s)   => s.is_empty() || s == "0" || s.eq_ignore_ascii_case("false"),
    }
}

// ── Minimal 5-field cron parser ───────────────────────────────────────────────
//
// Supports: `*`, specific values (e.g. `5`), and comma-lists (e.g. `0,30`).
// Ranges (`1-5`) and step values (`*/5`) are NOT supported — PoC scope.
// Returns the number of seconds until the next match, clamped to [1, 3600].

fn seconds_until_next(expr: &str) -> u64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let parsed = parse_cron(expr);

    // Scan forward minute-by-minute (max 24h = 1440 iterations).
    for offset_min in 1u64..=1440 {
        let candidate_s = now + offset_min * 60;
        // Align to the start of that minute.
        let candidate_s = (candidate_s / 60) * 60;

        if matches_cron(&parsed, candidate_s) {
            let delta = candidate_s.saturating_sub(now);
            return delta.max(1);
        }
    }
    // If no match found in 24h, retry in 1h.
    3600
}

struct CronParsed {
    minute:  Vec<u8>, // 0-59
    hour:    Vec<u8>, // 0-23
    day:     Vec<u8>, // 1-31
    month:   Vec<u8>, // 1-12
    weekday: Vec<u8>, // 0-6 (Sun=0)
}

fn parse_field(s: &str, min: u8, max: u8) -> Vec<u8> {
    if s == "*" {
        return (min..=max).collect();
    }
    s.split(',')
        .filter_map(|part| part.trim().parse::<u8>().ok())
        .filter(|&v| v >= min && v <= max)
        .collect()
}

fn parse_cron(expr: &str) -> CronParsed {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    let get = |i: usize, min, max| -> Vec<u8> {
        parts.get(i).map(|s| parse_field(s, min, max)).unwrap_or_else(|| (min..=max).collect())
    };
    CronParsed {
        minute:  get(0, 0, 59),
        hour:    get(1, 0, 23),
        day:     get(2, 1, 31),
        month:   get(3, 1, 12),
        weekday: get(4, 0, 6),
    }
}

fn matches_cron(c: &CronParsed, unix_s: u64) -> bool {
    // Convert unix timestamp to calendar fields (UTC).
    let secs_per_day = 86400u64;
    let secs_per_hour = 3600u64;
    let secs_per_min  = 60u64;

    let minute  = ((unix_s % secs_per_hour) / secs_per_min) as u8;
    let hour    = ((unix_s % secs_per_day) / secs_per_hour) as u8;

    // Days since Unix epoch (1970-01-01 = Thursday = weekday 4).
    let days_since_epoch = unix_s / secs_per_day;
    let weekday = ((days_since_epoch + 4) % 7) as u8; // 0=Sun

    // Gregorian calendar: year + month + day.
    let (year, month, day) = days_to_ymd(days_since_epoch);
    let _ = year;

    c.minute.contains(&minute)
        && c.hour.contains(&hour)
        && c.day.contains(&(day as u8))
        && c.month.contains(&(month as u8))
        && c.weekday.contains(&weekday)
}

/// Convert days-since-Unix-epoch to (year, month, day).
/// Civil calendar algorithm by Howard Hinnant (public domain).
fn days_to_ymd(z: u64) -> (i32, u32, u32) {
    let z = z as i64 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

// ─────────────────────────────────────────────────────────────────────────────

impl std::fmt::Debug for GlobalScriptSupervisor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "GlobalScriptSupervisor")
    }
}
