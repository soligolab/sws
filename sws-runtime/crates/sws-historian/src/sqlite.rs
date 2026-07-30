//! SQLite append-only log behind the in-memory ring buffer.
//!
//! Layout: one row per sample, indexed by (tag, ts_ms). The Historian
//! writes every sample here as well as into RAM; on startup it loads the
//! most-recent `max_per_tag` samples per tag back into RAM so the trend
//! object has data immediately after a runtime restart.
//!
//! Reads for trend queries still go to the in-memory ring (fast, no I/O
//! on the hot path). Falling back to SQLite for ranges older than the
//! ring's window is a follow-up.
//!
//! All rusqlite calls run on `tokio::task::spawn_blocking` because the
//! library is sync; the wrapper hides the boilerplate.

use std::{path::PathBuf, sync::Arc};
use rusqlite::{params, Connection, OptionalExtension};
use sws_core::{AlarmEvent, AlarmSeverity, TagQuality, TagValue};
use tokio::{sync::Mutex, task};
use tracing::{info, warn};

use crate::Sample;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS samples (
    tag       TEXT    NOT NULL,
    ts_ms     INTEGER NOT NULL,
    value     TEXT    NOT NULL,  -- JSON-encoded TagValue
    quality   TEXT    NOT NULL,  -- "Good" | "Bad" | "Uncertain"
    PRIMARY KEY (tag, ts_ms)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts_ms);

CREATE TABLE IF NOT EXISTS alarm_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    alarm_id        TEXT    NOT NULL,
    alarm_message   TEXT    NOT NULL DEFAULT '',
    severity        TEXT    NOT NULL DEFAULT 'Warning',
    ts_activated_ms INTEGER NOT NULL,
    ts_acked_ms     INTEGER,
    ts_normalized_ms INTEGER,
    duration_s      REAL,
    acked_by        TEXT
);
CREATE INDEX IF NOT EXISTS idx_alarm_events_ts  ON alarm_events(ts_activated_ms DESC);
CREATE INDEX IF NOT EXISTS idx_alarm_events_aid ON alarm_events(alarm_id);
"#;

/// Thin async wrapper around a single SQLite connection.
/// The PoC uses one connection serialised by a tokio Mutex — write rate is
/// low enough (one record per tag update) that contention is not a concern.
#[derive(Clone)]
pub struct SqliteStore {
    conn: Arc<Mutex<Connection>>,
    path: PathBuf,
}

impl SqliteStore {
    /// Open (creating if absent) a SQLite db at `path` and prepare the schema.
    pub async fn open(path: impl Into<PathBuf>) -> anyhow::Result<Self> {
        let path = path.into();
        let path_for_open = path.clone();
        let conn = task::spawn_blocking(move || -> anyhow::Result<Connection> {
            if let Some(parent) = path_for_open.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let c = Connection::open(&path_for_open)?;
            // WAL mode keeps reads (restore) unblocked by writes (recording).
            c.pragma_update(None, "journal_mode", &"WAL")?;
            c.pragma_update(None, "synchronous", &"NORMAL")?;
            c.execute_batch(SCHEMA)?;
            Ok(c)
        }).await??;
        info!(path = %path.display(), "historian: SQLite store opened");
        Ok(Self { conn: Arc::new(Mutex::new(conn)), path })
    }

    pub fn path(&self) -> &std::path::Path { &self.path }

    /// Append one sample. Best-effort: errors are logged, not propagated, so
    /// a transient disk hiccup never breaks the live tag stream.
    pub async fn append(&self, tag: &str, sample: &Sample) {
        let conn = self.conn.clone();
        let tag = tag.to_string();
        let ts = sample.ts_ms as i64;
        let value = serde_json::to_string(&sample.value)
            .unwrap_or_else(|_| "null".to_string());
        let quality = match sample.quality {
            TagQuality::Good      => "Good",
            TagQuality::Bad       => "Bad",
            TagQuality::Uncertain => "Uncertain",
        };
        let res = task::spawn_blocking(move || -> rusqlite::Result<()> {
            let c = conn.blocking_lock();
            c.execute(
                "INSERT OR REPLACE INTO samples (tag, ts_ms, value, quality) VALUES (?1, ?2, ?3, ?4)",
                params![tag, ts, value, quality],
            )?;
            Ok(())
        }).await;
        match res {
            Ok(Ok(())) => {}
            Ok(Err(e)) => warn!("historian: sqlite append failed: {e}"),
            Err(e)     => warn!("historian: sqlite append task panicked: {e}"),
        }
    }

    /// Load up to `limit` most-recent samples per tag from SQLite.
    /// Returns a map `tag → samples` (chronological order within each).
    pub async fn restore_recent(&self, limit: usize)
        -> anyhow::Result<Vec<(String, Vec<Sample>)>>
    {
        let conn = self.conn.clone();
        let out = task::spawn_blocking(move || -> rusqlite::Result<Vec<(String, Vec<Sample>)>> {
            let c = conn.blocking_lock();

            // Distinct tags first
            let mut tags: Vec<String> = Vec::new();
            {
                let mut stmt = c.prepare("SELECT DISTINCT tag FROM samples")?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
                for r in rows { tags.push(r?); }
            }

            let mut out: Vec<(String, Vec<Sample>)> = Vec::with_capacity(tags.len());
            for tag in tags {
                let mut stmt = c.prepare(
                    "SELECT ts_ms, value, quality
                       FROM samples
                      WHERE tag = ?1
                      ORDER BY ts_ms DESC
                      LIMIT ?2"
                )?;
                let rows = stmt.query_map(params![tag, limit as i64], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
                })?;
                let mut samples: Vec<Sample> = Vec::new();
                for r in rows {
                    let (ts, value_json, q) = r?;
                    let value: TagValue = serde_json::from_str(&value_json)
                        .unwrap_or(TagValue::Float(0.0));
                    let quality = match q.as_str() {
                        "Good" => TagQuality::Good,
                        "Bad"  => TagQuality::Bad,
                        _      => TagQuality::Uncertain,
                    };
                    samples.push(Sample { ts_ms: ts as u64, value, quality });
                }
                // Restore chronological order (we fetched DESC for the LIMIT)
                samples.reverse();
                out.push((tag, samples));
            }
            Ok(out)
        }).await??;
        Ok(out)
    }

    /// Fetch all samples for a tag in `[from_ms, to_ms]` (inclusive),
    /// ordered chronologically. Used by `Historian::query` as a fallback
    /// for ranges older than the in-memory ring.
    pub async fn query_range(&self, tag: &str, from_ms: u64, to_ms: u64) -> Vec<Sample> {
        let conn  = self.conn.clone();
        let tag   = tag.to_string();
        let res = task::spawn_blocking(move || -> rusqlite::Result<Vec<Sample>> {
            let c = conn.blocking_lock();
            let mut stmt = c.prepare(
                "SELECT ts_ms, value, quality
                   FROM samples
                  WHERE tag = ?1 AND ts_ms >= ?2 AND ts_ms <= ?3
                  ORDER BY ts_ms ASC",
            )?;
            let rows = stmt.query_map(
                params![tag, from_ms as i64, to_ms as i64],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
            )?;
            let mut samples = Vec::new();
            for r in rows {
                let (ts, value_json, q) = r?;
                let value: TagValue = serde_json::from_str(&value_json)
                    .unwrap_or(TagValue::Float(0.0));
                let quality = match q.as_str() {
                    "Good" => TagQuality::Good,
                    "Bad"  => TagQuality::Bad,
                    _      => TagQuality::Uncertain,
                };
                samples.push(Sample { ts_ms: ts as u64, value, quality });
            }
            Ok(samples)
        }).await;
        match res {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => { warn!("historian: query_range db error: {e}"); vec![] }
            Err(e)     => { warn!("historian: query_range task panicked: {e}"); vec![] }
        }
    }

    /// Delete all samples older than `cutoff_ms`.
    /// Returns the number of rows deleted.
    pub async fn prune_older_than_ms(&self, cutoff_ms: u64) -> anyhow::Result<usize> {
        let conn = self.conn.clone();
        let n = task::spawn_blocking(move || -> rusqlite::Result<usize> {
            let c = conn.blocking_lock();
            Ok(c.execute("DELETE FROM samples WHERE ts_ms < ?1", params![cutoff_ms as i64])?)
        }).await??;
        Ok(n)
    }

    /// Sample count across all tags (mostly for /metrics later).
    pub async fn total_samples(&self) -> anyhow::Result<i64> {
        let conn = self.conn.clone();
        let n = task::spawn_blocking(move || -> rusqlite::Result<i64> {
            let c = conn.blocking_lock();
            c.query_row("SELECT COUNT(*) FROM samples", [], |r| r.get(0))
                .optional()
                .map(|v| v.unwrap_or(0))
        }).await??;
        Ok(n)
    }

    /// Aggregate stats: (sample_count, oldest_ms, newest_ms, size_bytes, tag_count).
    pub async fn full_stats(&self) -> anyhow::Result<(u64, Option<u64>, Option<u64>, Option<u64>, u64)> {
        let conn = self.conn.clone();
        let path = self.path.clone();
        task::spawn_blocking(move || -> anyhow::Result<(u64, Option<u64>, Option<u64>, Option<u64>, u64)> {
            let c = conn.blocking_lock();
            let sample_count: i64 = c
                .query_row("SELECT COUNT(*) FROM samples", [], |r| r.get(0))
                .optional()?.unwrap_or(0);
            let oldest_ms: Option<i64> = c
                .query_row("SELECT MIN(ts_ms) FROM samples", [], |r| r.get(0))
                .optional()?.flatten();
            let newest_ms: Option<i64> = c
                .query_row("SELECT MAX(ts_ms) FROM samples", [], |r| r.get(0))
                .optional()?.flatten();
            let tag_count: i64 = c
                .query_row("SELECT COUNT(DISTINCT tag) FROM samples", [], |r| r.get(0))
                .optional()?.unwrap_or(0);
            let size_bytes = std::fs::metadata(&path).ok().map(|m| m.len());
            Ok((
                sample_count as u64,
                oldest_ms.map(|v| v as u64),
                newest_ms.map(|v| v as u64),
                size_bytes,
                tag_count as u64,
            ))
        }).await?
    }

    // ── Alarm event journal ───────────────────────────────────────────────────

    /// Persist one completed alarm event.
    pub async fn append_alarm_event(&self, ev: &AlarmEvent) {
        let conn         = self.conn.clone();
        let alarm_id     = ev.alarm_id.clone();
        let msg          = ev.alarm_message.clone();
        let sev          = format!("{:?}", ev.severity);
        let ts_act       = ev.ts_activated_ms as i64;
        let ts_ack       = ev.ts_acked_ms.map(|v| v as i64);
        let ts_norm      = ev.ts_normalized_ms.map(|v| v as i64);
        let duration     = ev.duration_s;
        let acked_by     = ev.acked_by.clone();
        let res = task::spawn_blocking(move || -> rusqlite::Result<()> {
            let c = conn.blocking_lock();
            c.execute(
                "INSERT INTO alarm_events \
                 (alarm_id, alarm_message, severity, ts_activated_ms, ts_acked_ms, ts_normalized_ms, duration_s, acked_by) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![alarm_id, msg, sev, ts_act, ts_ack, ts_norm, duration, acked_by],
            )?;
            Ok(())
        }).await;
        match res {
            Ok(Ok(())) => {}
            Ok(Err(e)) => warn!("historian: alarm_event insert failed: {e}"),
            Err(e)     => warn!("historian: alarm_event task panicked: {e}"),
        }
    }

    /// Query alarm events with optional filters. Returns events newest-first, up to `limit`.
    pub async fn query_alarm_events(
        &self,
        alarm_id: Option<&str>,
        from_ms: Option<u64>,
        to_ms: Option<u64>,
        limit: usize,
    ) -> Vec<AlarmEvent> {
        let conn     = self.conn.clone();
        let alarm_id = alarm_id.map(str::to_string);
        let res = task::spawn_blocking(move || -> rusqlite::Result<Vec<AlarmEvent>> {
            let c = conn.blocking_lock();
            // Use NULL-guard pattern: (?2 IS NULL OR col = ?2) avoids dynamic SQL.
            let mut stmt = c.prepare(
                "SELECT alarm_id, alarm_message, severity, ts_activated_ms, \
                        ts_acked_ms, ts_normalized_ms, duration_s, acked_by \
                   FROM alarm_events \
                  WHERE (?2 IS NULL OR alarm_id = ?2) \
                    AND (?3 IS NULL OR ts_activated_ms >= ?3) \
                    AND (?4 IS NULL OR ts_activated_ms <= ?4) \
                  ORDER BY ts_activated_ms DESC \
                  LIMIT ?1"
            )?;
            let rows = stmt.query_map(
                params![
                    limit as i64,
                    alarm_id,
                    from_ms.map(|v| v as i64),
                    to_ms.map(|v| v as i64),
                ],
                |r| Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                    r.get::<_, Option<f64>>(6)?,
                    r.get::<_, Option<String>>(7)?,
                )),
            )?;
            let mut events = Vec::new();
            for r in rows {
                let (aid, msg, sev_str, ts_act, ts_ack, ts_norm, dur, acked_by) = r?;
                let severity = match sev_str.as_str() {
                    "Info"     => AlarmSeverity::Info,
                    "Critical" => AlarmSeverity::Critical,
                    _          => AlarmSeverity::Warning,
                };
                events.push(AlarmEvent {
                    alarm_id: aid,
                    alarm_message: msg,
                    severity,
                    ts_activated_ms: ts_act as u64,
                    ts_acked_ms: ts_ack.map(|v| v as u64),
                    ts_normalized_ms: ts_norm.map(|v| v as u64),
                    duration_s: dur,
                    acked_by,
                });
            }
            Ok(events)
        }).await;
        match res {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => { warn!("historian: query_alarm_events db error: {e}"); vec![] }
            Err(e)     => { warn!("historian: query_alarm_events task panicked: {e}"); vec![] }
        }
    }

    /// Tag che hanno campioni nel database.
    ///
    /// Non coincide con i tag del progetto: un tag rinominato o rimosso lascia il
    /// proprio storico nel DB, e quello storico non è raggiungibile da nessuna
    /// pagina — è la definizione di "orfano" nella gestione database.
    pub async fn distinct_tags(&self) -> anyhow::Result<Vec<String>> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<Vec<String>> {
            let c = conn.blocking_lock();
            let mut stmt = c.prepare("SELECT DISTINCT tag FROM samples ORDER BY tag")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        }).await?
    }

    /// Cancella tutti i campioni di un tag. Ritorna quante righe sono sparite.
    ///
    /// Lo spazio su disco **non** si libera da sé: SQLite riusa le pagine ma non
    /// restringe il file. Serve `vacuum()` dopo, ed è la ragione per cui i due
    /// comandi stanno accanto nella UI.
    pub async fn delete_tag(&self, tag: &str) -> anyhow::Result<u64> {
        let conn = self.conn.clone();
        let tag = tag.to_string();
        task::spawn_blocking(move || -> anyhow::Result<u64> {
            let c = conn.blocking_lock();
            let n = c.execute("DELETE FROM samples WHERE tag = ?1", params![tag])?;
            Ok(n as u64)
        }).await?
    }

    /// `VACUUM` + checkpoint del WAL. Ritorna la dimensione del file prima e dopo.
    ///
    /// Il checkpoint serve perché qui SQLite gira in WAL: senza `TRUNCATE` il
    /// `-wal` resta grande e il recupero di spazio sembra non aver funzionato.
    pub async fn vacuum(&self) -> anyhow::Result<(u64, u64)> {
        let file_size = |p: &std::path::Path| -> u64 {
            let main = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
            let wal  = std::fs::metadata(p.with_extension("db-wal")).map(|m| m.len()).unwrap_or(0);
            main + wal
        };
        // Il checkpoint va fatto PRIMA di misurare, non insieme al VACUUM.
        // Misurando `main + wal` a WAL ancora pieno, il confronto registrava lo
        // spostamento dei dati dal WAL al file principale invece dello spazio
        // liberato — e riportava il file *cresciuto* dopo un VACUUM riuscito.
        // Visto in `scripts/check_database_mgmt.sh`: 1.161.848 → 1.276.888 byte.
        let conn = self.conn.clone();
        {
            let conn = conn.clone();
            task::spawn_blocking(move || -> anyhow::Result<()> {
                let c = conn.blocking_lock();
                c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
                Ok(())
            }).await??;
        }
        let before = file_size(&self.path);
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.blocking_lock();
            // Anche DOPO serve il checkpoint: in modalità WAL il VACUUM riscrive
            // l'intero database nel nuovo WAL, quindi misurando subito si
            // conterebbe due volte lo stesso contenuto — il file risultava
            // cresciuto di mezzo megabyte dopo aver liberato spazio.
            c.execute_batch("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")?;
            Ok(())
        }).await??;
        Ok((before, file_size(&self.path)))
    }

    /// Delete excess rows per tag, keeping only the `max_rows` most-recent.
    /// Returns total rows deleted.
    pub async fn prune_excess_rows(&self, max_rows: u64) -> anyhow::Result<u64> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<u64> {
            let c = conn.blocking_lock();
            let mut tags: Vec<String> = Vec::new();
            {
                let mut stmt = c.prepare("SELECT DISTINCT tag FROM samples")?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
                for r in rows { tags.push(r?); }
            }
            let mut deleted = 0u64;
            for tag in &tags {
                let count: i64 = c.query_row(
                    "SELECT COUNT(*) FROM samples WHERE tag = ?1",
                    params![tag], |r| r.get(0),
                ).optional()?.unwrap_or(0);
                if count as u64 > max_rows {
                    let cutoff: i64 = c.query_row(
                        "SELECT ts_ms FROM samples WHERE tag = ?1 ORDER BY ts_ms DESC LIMIT 1 OFFSET ?2",
                        params![tag, max_rows as i64],
                        |r| r.get(0),
                    )?;
                    let n = c.execute(
                        "DELETE FROM samples WHERE tag = ?1 AND ts_ms <= ?2",
                        params![tag, cutoff],
                    )?;
                    deleted += n as u64;
                }
            }
            Ok(deleted)
        }).await?
    }
}
