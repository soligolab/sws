//! Persist LogBus events to disk as JSONL with daily rotation.
//!
//! Subscribes to the shared [`LogBus`] broadcast and writes each event as a
//! single JSONL line to `<dir>/runtime-YYYY-MM-DD.jsonl`. When the date in an
//! event differs from the currently open file, the writer rotates to a new
//! file (UTC). On startup, any `runtime-YYYY-MM-DD.jsonl` older than
//! `retention_days` is deleted.
//!
//! The writer's own errors go to stderr via `eprintln!` rather than
//! `tracing::warn!` — otherwise a failing disk would feed back through
//! `LogBus` → broadcast → this task and amplify on every event.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use sws_core::LogBus;
use time::OffsetDateTime;
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::broadcast::error::RecvError;

/// Spawn a tokio task that persists every event from `bus` to a daily JSONL
/// file under `dir`. Returns the join handle; the task lives until the
/// broadcast channel closes.
pub fn spawn_file_writer(
    bus: Arc<LogBus>,
    dir: PathBuf,
    retention_days: u32,
) -> tokio::task::JoinHandle<()> {
    // Subscribe synchronously before the task is scheduled — otherwise
    // events broadcast between this call and the task's first poll are lost.
    let mut rx = bus.subscribe();
    tokio::spawn(async move {
        if let Err(e) = tokio::fs::create_dir_all(&dir).await {
            eprintln!("log_file: cannot create log dir {dir:?}: {e}");
            return;
        }

        if retention_days > 0 {
            let today = date_from_ts_ms(now_ms());
            if let Err(e) = prune_old(&dir, &today, retention_days).await {
                eprintln!("log_file: prune_old failed: {e}");
            }
        }

        let mut open: Option<(String, File)> = None;

        loop {
            let ev = match rx.recv().await {
                Ok(ev) => ev,
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            };
            let date = date_from_ts_ms(ev.ts_ms);

            let needs_open = open
                .as_ref()
                .map(|(d, _)| d != &date)
                .unwrap_or(true);
            if needs_open {
                match open_log(&dir, &date).await {
                    Ok(f) => open = Some((date.clone(), f)),
                    Err(e) => {
                        eprintln!(
                            "log_file: cannot open {dir:?}/runtime-{date}.jsonl: {e}"
                        );
                        open = None;
                        continue;
                    }
                }
            }

            let Some((_, file)) = open.as_mut() else { continue };

            let line = match serde_json::to_string(&ev) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("log_file: serialize failed: {e}");
                    continue;
                }
            };
            if let Err(e) = file.write_all(line.as_bytes()).await {
                eprintln!("log_file: write failed: {e}");
                open = None;
                continue;
            }
            if let Err(e) = file.write_all(b"\n").await {
                eprintln!("log_file: write failed: {e}");
                open = None;
            }
        }
    })
}

async fn open_log(dir: &Path, date: &str) -> std::io::Result<File> {
    let path = dir.join(format!("runtime-{date}.jsonl"));
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
}

/// Format `YYYY-MM-DD` from Unix epoch milliseconds (UTC). Falls back to
/// `"1970-01-01"` on out-of-range input so callers never need to branch.
pub(crate) fn date_from_ts_ms(ts_ms: u64) -> String {
    let secs = (ts_ms / 1000) as i64;
    match OffsetDateTime::from_unix_timestamp(secs) {
        Ok(dt) => format!(
            "{:04}-{:02}-{:02}",
            dt.year(),
            u8::from(dt.month()),
            dt.day()
        ),
        Err(_) => "1970-01-01".into(),
    }
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Delete `runtime-YYYY-MM-DD.jsonl` files strictly older than
/// `today - retention_days`. The cutoff itself is kept.
async fn prune_old(
    dir: &Path,
    today: &str,
    retention_days: u32,
) -> std::io::Result<()> {
    let Some(cutoff) = date_minus_days(today, retention_days) else {
        return Ok(());
    };
    let mut entries = tokio::fs::read_dir(dir).await?;
    let mut removed = 0usize;
    while let Some(entry) = entries.next_entry().await? {
        let name = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue,
        };
        let Some(rest) = name.strip_prefix("runtime-") else { continue };
        let Some(date) = rest.strip_suffix(".jsonl") else { continue };
        if date.len() == 10 && date < cutoff.as_str()
            && tokio::fs::remove_file(entry.path()).await.is_ok() {
                removed += 1;
            }
    }
    if removed > 0 {
        eprintln!(
            "log_file: pruned {removed} old log file(s) older than {cutoff}"
        );
    }
    Ok(())
}

fn date_minus_days(today: &str, n: u32) -> Option<String> {
    let secs = parse_date_to_secs(today)?;
    let new_secs = secs.checked_sub(i64::from(n) * 86_400)?;
    let dt = OffsetDateTime::from_unix_timestamp(new_secs).ok()?;
    Some(format!(
        "{:04}-{:02}-{:02}",
        dt.year(),
        u8::from(dt.month()),
        dt.day()
    ))
}

fn parse_date_to_secs(s: &str) -> Option<i64> {
    if s.len() != 10 {
        return None;
    }
    let year: i32 = s[0..4].parse().ok()?;
    let month: u8 = s[5..7].parse().ok()?;
    let day: u8 = s[8..10].parse().ok()?;
    let m = time::Month::try_from(month).ok()?;
    let date = time::Date::from_calendar_date(year, m, day).ok()?;
    let dt = date.with_hms(0, 0, 0).ok()?.assume_utc();
    Some(dt.unix_timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sws_core::LogEvent;

    /// Throwaway scratch directory; removed on drop. Avoids pulling in
    /// `tempfile` just for a couple of tests.
    struct TestDir(PathBuf);
    impl TestDir {
        fn new(label: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let p = std::env::temp_dir()
                .join(format!("sws-log-test-{label}-{nanos}"));
            std::fs::create_dir_all(&p).unwrap();
            TestDir(p)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn date_from_ts_ms_is_deterministic() {
        // 2024-03-15 00:00:00 UTC.
        assert_eq!(date_from_ts_ms(1_710_460_800_000), "2024-03-15");
        // Same day, just before midnight UTC.
        assert_eq!(date_from_ts_ms(1_710_547_199_000), "2024-03-15");
        // Next day.
        assert_eq!(date_from_ts_ms(1_710_547_200_000), "2024-03-16");
    }

    #[test]
    fn date_minus_days_handles_month_and_year_boundaries() {
        assert_eq!(date_minus_days("2024-03-15", 7).as_deref(), Some("2024-03-08"));
        // Leap year: March 1 minus 1 day → Feb 29.
        assert_eq!(date_minus_days("2024-03-01", 1).as_deref(), Some("2024-02-29"));
        // Non-leap: March 1 minus 1 day → Feb 28.
        assert_eq!(date_minus_days("2023-03-01", 1).as_deref(), Some("2023-02-28"));
        // Year crossing.
        assert_eq!(date_minus_days("2024-01-01", 1).as_deref(), Some("2023-12-31"));
    }

    #[tokio::test]
    async fn prune_old_keeps_recent_and_removes_old() {
        let td = TestDir::new("prune");
        let dir = td.path();

        std::fs::write(dir.join("runtime-2020-01-01.jsonl"), "").unwrap();
        std::fs::write(dir.join("runtime-2024-03-08.jsonl"), "").unwrap();
        std::fs::write(dir.join("runtime-2024-03-15.jsonl"), "").unwrap();
        std::fs::write(dir.join("unrelated.txt"), "hi").unwrap();

        prune_old(dir, "2024-03-15", 7).await.unwrap();

        assert!(!dir.join("runtime-2020-01-01.jsonl").exists());
        // Exactly at cutoff (today - 7) is kept.
        assert!(dir.join("runtime-2024-03-08.jsonl").exists());
        assert!(dir.join("runtime-2024-03-15.jsonl").exists());
        // Non-matching names are ignored.
        assert!(dir.join("unrelated.txt").exists());
    }

    #[tokio::test]
    async fn writer_appends_jsonl_lines() {
        let td = TestDir::new("write");
        let dir = td.path().to_path_buf();
        let bus = Arc::new(LogBus::new(16));
        let h = spawn_file_writer(bus.clone(), dir.clone(), 0);

        for msg in ["one", "two"] {
            bus.record(LogEvent {
                ts_ms: 1_710_460_800_000, // 2024-03-15
                level: "INFO".into(),
                target: "test".into(),
                message: msg.into(),
                fields: Default::default(),
            });
        }

        // Yield repeatedly until both lines land — avoids fixed sleeps.
        let path = dir.join("runtime-2024-03-15.jsonl");
        for _ in 0..50 {
            if let Ok(s) = tokio::fs::read_to_string(&path).await {
                if s.lines().count() >= 2 {
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        let content = tokio::fs::read_to_string(&path).await.unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2);
        for (line, expected) in lines.iter().zip(["one", "two"]) {
            let parsed: LogEvent = serde_json::from_str(line).unwrap();
            assert_eq!(parsed.message, expected);
        }
        h.abort();
    }
}
