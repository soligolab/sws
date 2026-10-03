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

use rusqlite::{params, Connection, OptionalExtension};
use std::{path::PathBuf, sync::Arc};
use sws_core::{AlarmEvent, AlarmSeverity, TagQuality, TagValue};
use tokio::{sync::Mutex, task};
use tracing::{info, warn};

use crate::Sample;

/// Quante righe toglie (o toglierebbe, in anteprima) `pulisci_storico`, e
/// quante ne restano.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct EsitoPulizia {
    pub non_storicizzati: u64,
    pub ripetuti: u64,
    pub restanti: u64,
}

/// I tag distinti dello storico, **a salti sull'indice** invece che con
/// `SELECT DISTINCT tag`: per ogni tag si chiede il primo tag successivo, e con
/// la chiave primaria `(tag, ts_ms)` ogni domanda è una ricerca, non una
/// lettura. Misurato il 26-09-2026 sullo storico di CasaDomotica (590 MB, 7
/// milioni di righe, 73 tag): `DISTINCT` 7,2 s a disco freddo, cioè quasi tutta
/// l'attesa all'apertura del progetto; questa 0,01 s. Esce in ordine alfabetico.
const SQL_TAG_DISTINTI: &str = "WITH RECURSIVE t(tag) AS (
    SELECT min(tag) FROM samples
    UNION ALL
    SELECT (SELECT min(tag) FROM samples WHERE tag > t.tag) FROM t WHERE t.tag IS NOT NULL
) SELECT tag FROM t WHERE tag IS NOT NULL";

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

/// La prima migrazione di questo crate (25-09-2026): fino ad allora lo schema
/// cresceva solo con `CREATE … IF NOT EXISTS`, che su una tabella esistente
/// non aggiunge colonne.
///
/// - `interrotto`: la riga è stata chiusa senza che l'allarme finisse il suo
///   giro (runtime spento o caduto, allarmi ricaricati).
/// - l'indice `(alarm_id, ts_activated_ms)`: la chiave con cui la riga si
///   aggiorna a ogni transizione. **Non** `UNIQUE`: se un database vecchio
///   avesse due righe con la stessa chiave, la creazione fallirebbe e il
///   progetto non si aprirebbe più.
fn migra_allarmi(c: &Connection) -> rusqlite::Result<()> {
    let ha_colonna = c
        .prepare("SELECT 1 FROM pragma_table_info('alarm_events') WHERE name = 'interrotto'")?
        .exists([])?;
    if !ha_colonna {
        c.execute_batch(
            "ALTER TABLE alarm_events ADD COLUMN interrotto INTEGER NOT NULL DEFAULT 0;",
        )?;
    }
    c.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_alarm_events_key ON alarm_events(alarm_id, ts_activated_ms);",
    )
}

/// Scrive la riga di uno scatto: aggiorna quella con la stessa chiave, o la
/// aggiunge. In transazione, così una lettura non vede mai mezza operazione.
fn scrivi_riga(c: &Connection, ev: &AlarmEvent) -> rusqlite::Result<()> {
    let tx = c.unchecked_transaction()?;
    let sev = format!("{:?}", ev.severity);
    let ts_act = ev.ts_activated_ms as i64;
    let ts_ack = ev.ts_acked_ms.map(|v| v as i64);
    let ts_norm = ev.ts_normalized_ms.map(|v| v as i64);
    let toccate = tx.execute(
        "UPDATE alarm_events SET alarm_message = ?3, severity = ?4, ts_acked_ms = ?5,                 ts_normalized_ms = ?6, duration_s = ?7, acked_by = ?8, interrotto = ?9           WHERE alarm_id = ?1 AND ts_activated_ms = ?2",
        params![ev.alarm_id, ts_act, ev.alarm_message, sev, ts_ack, ts_norm, ev.duration_s, ev.acked_by, ev.interrotto],
    )?;
    if toccate == 0 {
        tx.execute(
            "INSERT INTO alarm_events              (alarm_id, alarm_message, severity, ts_activated_ms, ts_acked_ms, ts_normalized_ms, duration_s, acked_by, interrotto)              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![ev.alarm_id, ev.alarm_message, sev, ts_act, ts_ack, ts_norm, ev.duration_s, ev.acked_by, ev.interrotto],
        )?;
    }
    tx.commit()
}

/// Copia coerente di un database SQLite **da un'altra connessione** (03-10-2026,
/// l'istantanea prima di un aggiornamento): `VACUUM INTO` da una connessione di
/// sola lettura vede un'istantanea del file, WAL compreso, anche mentre il
/// runtime ci scrive — una copia dei byte di `db`+`-wal` presa a metà di una
/// scrittura può non riaprirsi. Il risultato è un solo file, già compattato.
/// Sincrona: chi la chiama sta già su un thread bloccante.
pub fn copia_coerente(sorgente: &std::path::Path, dest: &std::path::Path) -> rusqlite::Result<()> {
    let c = Connection::open_with_flags(sorgente, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    c.busy_timeout(std::time::Duration::from_secs(10))?;
    c.execute("VACUUM INTO ?1", params![dest.to_string_lossy().into_owned()])?;
    Ok(())
}

/// Thin async wrapper around a single SQLite connection.
/// The PoC uses one connection serialised by a tokio Mutex — write rate is
/// low enough (one record per tag update) that contention is not a concern.
#[derive(Clone)]
pub struct SqliteStore {
    conn: Arc<Mutex<Connection>>,
    path: PathBuf,
}

/// (campioni, primo ts, ultimo ts, byte su disco… — vedi `stats`): il tipo grezzo
/// che il thread bloccante restituisce prima di diventare `DatastoreStats`.
type StatsGrezze = (u64, Option<u64>, Option<u64>, Option<u64>, u64);

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
            c.pragma_update(None, "journal_mode", "WAL")?;
            c.pragma_update(None, "synchronous", "NORMAL")?;
            c.execute_batch(SCHEMA)?;
            migra_allarmi(&c)?;
            Ok(c)
        })
        .await??;
        info!(path = %path.display(), "historian: SQLite store opened");
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            path,
        })
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    /// Append one sample. Best-effort: errors are logged, not propagated, so
    /// a transient disk hiccup never breaks the live tag stream.
    pub async fn append(&self, tag: &str, sample: &Sample) {
        let conn = self.conn.clone();
        let tag = tag.to_string();
        let ts = sample.ts_ms as i64;
        let value = serde_json::to_string(&sample.value).unwrap_or_else(|_| "null".to_string());
        let quality = match sample.quality {
            TagQuality::Good => "Good",
            TagQuality::Bad => "Bad",
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
            Err(e) => warn!("historian: sqlite append task panicked: {e}"),
        }
    }

    /// Load up to `limit` most-recent samples per tag from SQLite.
    /// Returns a map `tag → samples` (chronological order within each).
    pub async fn restore_recent(&self, limit: usize) -> anyhow::Result<Vec<(String, Vec<Sample>)>> {
        let conn = self.conn.clone();
        let out = task::spawn_blocking(move || -> rusqlite::Result<Vec<(String, Vec<Sample>)>> {
            let c = conn.blocking_lock();

            // Distinct tags first
            let mut tags: Vec<String> = Vec::new();
            {
                let mut stmt = c.prepare(SQL_TAG_DISTINTI)?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
                for r in rows {
                    tags.push(r?);
                }
            }

            let mut out: Vec<(String, Vec<Sample>)> = Vec::with_capacity(tags.len());
            for tag in tags {
                let mut stmt = c.prepare(
                    "SELECT ts_ms, value, quality
                       FROM samples
                      WHERE tag = ?1
                      ORDER BY ts_ms DESC
                      LIMIT ?2",
                )?;
                let rows = stmt.query_map(params![tag, limit as i64], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })?;
                let mut samples: Vec<Sample> = Vec::new();
                for r in rows {
                    let (ts, value_json, q) = r?;
                    let value: TagValue =
                        serde_json::from_str(&value_json).unwrap_or(TagValue::Float(0.0));
                    let quality = match q.as_str() {
                        "Good" => TagQuality::Good,
                        "Bad" => TagQuality::Bad,
                        _ => TagQuality::Uncertain,
                    };
                    samples.push(Sample {
                        ts_ms: ts as u64,
                        value,
                        quality,
                    });
                }
                // Restore chronological order (we fetched DESC for the LIMIT)
                samples.reverse();
                out.push((tag, samples));
            }
            Ok(out)
        })
        .await??;
        Ok(out)
    }

    /// Fetch all samples for a tag in `[from_ms, to_ms]` (inclusive),
    /// ordered chronologically. Used by `Historian::query` as a fallback
    /// for ranges older than the in-memory ring.
    /// L'ultimo campione di `tag` **prima** di `ts_ms` — l'ancoraggio di un
    /// trend su un valore fermo (1-10-2026). `None` se non ce n'è.
    pub async fn last_before(&self, tag: &str, ts_ms: u64) -> Option<Sample> {
        let conn = self.conn.clone();
        let tag = tag.to_string();
        task::spawn_blocking(move || -> Option<Sample> {
            let c = conn.blocking_lock();
            let (ts, value_json, q): (i64, String, String) = c
                .query_row(
                    "SELECT ts_ms, value, quality FROM samples
                      WHERE tag = ?1 AND ts_ms < ?2 ORDER BY ts_ms DESC LIMIT 1",
                    params![tag, ts_ms as i64],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .ok()?;
            Some(Sample {
                ts_ms: ts as u64,
                value: serde_json::from_str(&value_json).ok()?,
                quality: match q.as_str() {
                    "Good" => TagQuality::Good,
                    "Bad" => TagQuality::Bad,
                    _ => TagQuality::Uncertain,
                },
            })
        })
        .await
        .ok()
        .flatten()
    }

    pub async fn query_range(&self, tag: &str, from_ms: u64, to_ms: u64) -> Vec<Sample> {
        let conn = self.conn.clone();
        let tag = tag.to_string();
        let res = task::spawn_blocking(move || -> rusqlite::Result<Vec<Sample>> {
            let c = conn.blocking_lock();
            let mut stmt = c.prepare(
                "SELECT ts_ms, value, quality
                   FROM samples
                  WHERE tag = ?1 AND ts_ms >= ?2 AND ts_ms <= ?3
                  ORDER BY ts_ms ASC",
            )?;
            let rows = stmt.query_map(params![tag, from_ms as i64, to_ms as i64], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?;
            let mut samples = Vec::new();
            for r in rows {
                let (ts, value_json, q) = r?;
                let value: TagValue =
                    serde_json::from_str(&value_json).unwrap_or(TagValue::Float(0.0));
                let quality = match q.as_str() {
                    "Good" => TagQuality::Good,
                    "Bad" => TagQuality::Bad,
                    _ => TagQuality::Uncertain,
                };
                samples.push(Sample {
                    ts_ms: ts as u64,
                    value,
                    quality,
                });
            }
            Ok(samples)
        })
        .await;
        match res {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => {
                warn!("historian: query_range db error: {e}");
                vec![]
            }
            Err(e) => {
                warn!("historian: query_range task panicked: {e}");
                vec![]
            }
        }
    }

    /// Delete all samples older than `cutoff_ms`.
    /// Returns the number of rows deleted.
    pub async fn prune_older_than_ms(&self, cutoff_ms: u64) -> anyhow::Result<usize> {
        let conn = self.conn.clone();
        let n = task::spawn_blocking(move || -> rusqlite::Result<usize> {
            let c = conn.blocking_lock();
            c.execute(
                "DELETE FROM samples WHERE ts_ms < ?1",
                params![cutoff_ms as i64],
            )
        })
        .await??;
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
        })
        .await??;
        Ok(n)
    }

    /// Aggregate stats: (sample_count, oldest_ms, newest_ms, size_bytes, tag_count).
    pub async fn full_stats(&self) -> anyhow::Result<StatsGrezze> {
        let conn = self.conn.clone();
        let path = self.path.clone();
        task::spawn_blocking(move || -> anyhow::Result<StatsGrezze> {
            let c = conn.blocking_lock();
            let sample_count: i64 = c
                .query_row("SELECT COUNT(*) FROM samples", [], |r| r.get(0))
                .optional()?
                .unwrap_or(0);
            let oldest_ms: Option<i64> = c
                .query_row("SELECT MIN(ts_ms) FROM samples", [], |r| r.get(0))
                .optional()?
                .flatten();
            let newest_ms: Option<i64> = c
                .query_row("SELECT MAX(ts_ms) FROM samples", [], |r| r.get(0))
                .optional()?
                .flatten();
            let tag_count: i64 = c
                .query_row(&format!("SELECT COUNT(*) FROM ({SQL_TAG_DISTINTI})"), [], |r| r.get(0))
                .optional()?
                .unwrap_or(0);
            let size_bytes = std::fs::metadata(&path).ok().map(|m| m.len());
            Ok((
                sample_count as u64,
                oldest_ms.map(|v| v as u64),
                newest_ms.map(|v| v as u64),
                size_bytes,
                tag_count as u64,
            ))
        })
        .await?
    }

    // ── Alarm event journal ───────────────────────────────────────────────────

    /// Scrive la riga di uno scatto (upsert per `alarm_id` + `ts_activated_ms`).
    ///
    /// Dal 25-09-2026 la riga nasce allo scatto e si riscrive a ogni
    /// transizione; prima si scriveva una volta sola, a evento completo.
    pub async fn upsert_alarm_event(&self, ev: &AlarmEvent) {
        let conn = self.conn.clone();
        let ev = ev.clone();
        let res = task::spawn_blocking(move || -> rusqlite::Result<()> {
            let c = conn.blocking_lock();
            scrivi_riga(&c, &ev)
        })
        .await;
        match res {
            Ok(Ok(())) => {}
            Ok(Err(e)) => warn!("historian: alarm_event upsert failed: {e}"),
            Err(e) => warn!("historian: alarm_event task panicked: {e}"),
        }
    }

    /// Chiude come interrotte le righe rimaste aperte (senza rientro o senza
    /// conferma) da un giro precedente: runtime spento o caduto. Si chiama
    /// quando il progetto aggancia lo store, prima che gli allarmi valutino.
    /// Restituisce quante ne ha chiuse.
    ///
    /// `vive` sono gli scatti (id, istante di scatto) che gli allarmi hanno
    /// ripreso dal giro prima — ricarica o deploy dello stesso progetto,
    /// 26-09-2026: quelle righe sono ancora aperte perché l'allarme è ancora
    /// in corso, non perché qualcosa si è interrotto, e vanno lasciate stare.
    pub async fn chiudi_eventi_interrotti(&self, ora_ms: u64, vive: &[(String, u64)]) -> usize {
        let conn = self.conn.clone();
        let ora = ora_ms as i64;
        let vive: Vec<(String, i64)> = vive.iter().map(|(id, ts)| (id.clone(), *ts as i64)).collect();
        let res = task::spawn_blocking(move || -> rusqlite::Result<usize> {
            let mut c = conn.blocking_lock();
            let tx = c.transaction()?;
            tx.execute_batch("CREATE TEMP TABLE IF NOT EXISTS righe_vive (alarm_id TEXT, ts INTEGER); DELETE FROM righe_vive;")?;
            for (id, ts) in &vive {
                tx.execute("INSERT INTO righe_vive VALUES (?1, ?2)", params![id, ts])?;
            }
            let n = tx.execute(
                "UPDATE alarm_events                     SET interrotto = 1,                         duration_s = COALESCE(duration_s, (?1 - ts_activated_ms) / 1000.0),                         ts_normalized_ms = COALESCE(ts_normalized_ms, ?1)                   WHERE interrotto = 0 AND (ts_normalized_ms IS NULL OR ts_acked_ms IS NULL)                     AND NOT EXISTS (SELECT 1 FROM righe_vive v                                      WHERE v.alarm_id = alarm_events.alarm_id                                        AND v.ts = alarm_events.ts_activated_ms)",
                params![ora],
            )?;
            tx.execute_batch("DELETE FROM righe_vive;")?;
            tx.commit()?;
            Ok(n)
        })
        .await;
        match res {
            Ok(Ok(n)) => n,
            Ok(Err(e)) => {
                warn!("historian: chiusura righe interrotte fallita: {e}");
                0
            }
            Err(e) => {
                warn!("historian: chiusura righe interrotte, task panicked: {e}");
                0
            }
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
        let conn = self.conn.clone();
        let alarm_id = alarm_id.map(str::to_string);
        let res = task::spawn_blocking(move || -> rusqlite::Result<Vec<AlarmEvent>> {
            let c = conn.blocking_lock();
            // Use NULL-guard pattern: (?2 IS NULL OR col = ?2) avoids dynamic SQL.
            let mut stmt = c.prepare(
                "SELECT alarm_id, alarm_message, severity, ts_activated_ms, \
                        ts_acked_ms, ts_normalized_ms, duration_s, acked_by, interrotto \
                   FROM alarm_events \
                  WHERE (?2 IS NULL OR alarm_id = ?2) \
                    AND (?3 IS NULL OR ts_activated_ms >= ?3) \
                    AND (?4 IS NULL OR ts_activated_ms <= ?4) \
                  ORDER BY ts_activated_ms DESC \
                  LIMIT ?1",
            )?;
            let rows = stmt.query_map(
                params![
                    limit as i64,
                    alarm_id,
                    from_ms.map(|v| v as i64),
                    to_ms.map(|v| v as i64),
                ],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, Option<i64>>(4)?,
                        r.get::<_, Option<i64>>(5)?,
                        r.get::<_, Option<f64>>(6)?,
                        r.get::<_, Option<String>>(7)?,
                        r.get::<_, bool>(8)?,
                    ))
                },
            )?;
            let mut events = Vec::new();
            for r in rows {
                let (aid, msg, sev_str, ts_act, ts_ack, ts_norm, dur, acked_by, interrotto) = r?;
                let severity = match sev_str.as_str() {
                    "Info" => AlarmSeverity::Info,
                    "Critical" => AlarmSeverity::Critical,
                    _ => AlarmSeverity::Warning,
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
                    interrotto,
                });
            }
            Ok(events)
        })
        .await;
        match res {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => {
                warn!("historian: query_alarm_events db error: {e}");
                vec![]
            }
            Err(e) => {
                warn!("historian: query_alarm_events task panicked: {e}");
                vec![]
            }
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
            let mut stmt = c.prepare(SQL_TAG_DISTINTI)?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
        .await?
    }

    /// Pulisce lo storico gonfiato dalla doppia scrittura di prima del
    /// 26-09-2026 (vedi `Historian::record`): toglie i campioni dei tag che non
    /// stanno in `tenere` (quelli senza `history: true`, compreso l'eventuale
    /// tag col nome vuoto) e, per quelli che ci stanno, le **ripetizioni** —
    /// il campione con valore e qualità uguali al precedente dello stesso tag.
    /// L'ultimo campione di ogni tag resta sempre: dice «fino a qui valeva
    /// così». I grafici disegnano gli stessi gradini.
    ///
    /// Con `anteprima` conta e basta. Tutto in una transazione; lo spazio si
    /// recupera dopo, con `vacuum()`.
    pub async fn pulisci_storico(&self, tenere: Vec<String>, anteprima: bool) -> anyhow::Result<EsitoPulizia> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<EsitoPulizia> {
            let mut c = conn.blocking_lock();
            let tx = c.transaction()?;
            tx.execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS pul_tenere(tag TEXT PRIMARY KEY);
                 DELETE FROM pul_tenere;
                 DROP TABLE IF EXISTS pul_ripetuti;",
            )?;
            {
                let mut ins = tx.prepare("INSERT OR IGNORE INTO pul_tenere(tag) VALUES (?1)")?;
                for t in &tenere {
                    ins.execute(params![t])?;
                }
            }
            tx.execute_batch(
                "CREATE TEMP TABLE pul_ripetuti AS
                   SELECT tag, ts_ms FROM (
                     SELECT tag, ts_ms, value, quality,
                            LAG(value)   OVER w AS pv,
                            LAG(quality) OVER w AS pq,
                            LEAD(ts_ms)  OVER w AS nx
                       FROM samples WHERE tag IN (SELECT tag FROM pul_tenere)
                     WINDOW w AS (PARTITION BY tag ORDER BY ts_ms))
                   WHERE value = pv AND quality = pq AND nx IS NOT NULL;",
            )?;
            let non_storicizzati: i64 = tx.query_row(
                "SELECT COUNT(*) FROM samples WHERE tag NOT IN (SELECT tag FROM pul_tenere)",
                [],
                |r| r.get(0),
            )?;
            let ripetuti: i64 = tx.query_row("SELECT COUNT(*) FROM pul_ripetuti", [], |r| r.get(0))?;
            let totale: i64 = tx.query_row("SELECT COUNT(*) FROM samples", [], |r| r.get(0))?;
            if anteprima {
                tx.rollback()?;
            } else {
                tx.execute("DELETE FROM samples WHERE tag NOT IN (SELECT tag FROM pul_tenere)", [])?;
                tx.execute(
                    "DELETE FROM samples WHERE (tag, ts_ms) IN (SELECT tag, ts_ms FROM pul_ripetuti)",
                    [],
                )?;
                tx.execute_batch("DROP TABLE IF EXISTS pul_ripetuti; DELETE FROM pul_tenere;")?;
                tx.commit()?;
            }
            Ok(EsitoPulizia {
                non_storicizzati: non_storicizzati as u64,
                ripetuti: ripetuti as u64,
                restanti: (totale - non_storicizzati - ripetuti).max(0) as u64,
            })
        })
        .await?
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
        })
        .await?
    }

    /// `VACUUM` + checkpoint del WAL. Ritorna la dimensione del file prima e dopo.
    ///
    /// Il checkpoint serve perché qui SQLite gira in WAL: senza `TRUNCATE` il
    /// `-wal` resta grande e il recupero di spazio sembra non aver funzionato.
    pub async fn vacuum(&self) -> anyhow::Result<(u64, u64)> {
        let file_size = |p: &std::path::Path| -> u64 {
            let main = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
            let wal = std::fs::metadata(p.with_extension("db-wal"))
                .map(|m| m.len())
                .unwrap_or(0);
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
            })
            .await??;
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
        })
        .await??;
        Ok((before, file_size(&self.path)))
    }

    /// Write a consistent, compacted copy of the live database to `dest`,
    /// via SQLite's own `VACUUM INTO` — unlike a raw file copy (`std::fs::copy`
    /// on `self.path()`), this is safe to run while the connection keeps
    /// recording live samples: SQLite guarantees the destination is a
    /// point-in-time snapshot, not a torn read of a WAL-mode file.
    pub async fn vacuum_into(&self, dest: &std::path::Path) -> anyhow::Result<()> {
        let conn = self.conn.clone();
        let dest = dest.to_path_buf();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.blocking_lock();
            let dest_str = dest.to_string_lossy().into_owned();
            c.execute("VACUUM INTO ?1", params![dest_str])?;
            Ok(())
        })
        .await??;
        Ok(())
    }

    /// Replace the database file at `path` with `bytes`, keeping the previous
    /// file as a timestamped backup (`<path>.bak-<epoch_ms>`) instead of
    /// deleting it outright. Deliberately does **not** touch any already-open
    /// `SqliteStore` connection to the old file — a POSIX rename doesn't
    /// affect existing file descriptors, so a live process keeps writing to
    /// the old (now-renamed-away) inode until it restarts and reopens
    /// `path`. Callers must surface that a restart is required; this
    /// function only performs the on-disk swap. Also drops the old file's
    /// stale `-wal`/`-shm` sidecars, which don't apply to the new database.
    pub async fn replace_file_at(
        path: &std::path::Path,
        bytes: Vec<u8>,
    ) -> anyhow::Result<std::path::PathBuf> {
        let path = path.to_path_buf();
        task::spawn_blocking(move || -> anyhow::Result<std::path::PathBuf> {
            let backup = std::path::PathBuf::from(format!(
                "{}.bak-{}",
                path.display(),
                crate::backend::now_ms(),
            ));
            if path.exists() {
                std::fs::rename(&path, &backup)?;
            }
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&path, &bytes)?;
            let _ = std::fs::remove_file(path.with_extension("db-wal"));
            let _ = std::fs::remove_file(path.with_extension("db-shm"));
            Ok(backup)
        })
        .await?
    }

    /// Delete excess rows per tag, keeping only the `max_rows` most-recent.
    /// Returns total rows deleted.
    pub async fn prune_excess_rows(&self, max_rows: u64) -> anyhow::Result<u64> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<u64> {
            let c = conn.blocking_lock();
            let mut tags: Vec<String> = Vec::new();
            {
                let mut stmt = c.prepare(SQL_TAG_DISTINTI)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn riga(id: &str, ts: u64) -> AlarmEvent {
        AlarmEvent {
            alarm_id: id.into(),
            alarm_message: "sopra 80".into(),
            severity: AlarmSeverity::Critical,
            ts_activated_ms: ts,
            ts_acked_ms: None,
            ts_normalized_ms: None,
            duration_s: None,
            acked_by: None,
            interrotto: false,
        }
    }

    /// La riga di uno scatto si scrive allo scatto e si **aggiorna**, non si
    /// duplica: è ciò che rende possibile lo storico dallo scatto (25-09-2026).
    #[tokio::test]
    async fn upsert_scrive_e_poi_aggiorna_la_stessa_riga() {
        let dir = tempfile::tempdir().unwrap();
        let store = SqliteStore::open(dir.path().join("a.db")).await.unwrap();
        let mut ev = riga("a1", 1000);
        store.upsert_alarm_event(&ev).await;
        ev.ts_normalized_ms = Some(5000);
        ev.duration_s = Some(4.0);
        store.upsert_alarm_event(&ev).await;
        store.upsert_alarm_event(&riga("a1", 9000)).await;
        let righe = store.query_alarm_events(Some("a1"), None, None, 10).await;
        assert_eq!(righe.len(), 2, "due scatti, due righe");
        assert_eq!(righe[1], ev, "la prima riga è aggiornata, non duplicata");
    }

    /// Un database scritto prima della colonna `interrotto` si apre, e la
    /// riceve: senza migrazione ogni scrittura fallirebbe.
    #[tokio::test]
    async fn un_database_vecchio_riceve_la_colonna_interrotto() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vecchio.db");
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE alarm_events (id INTEGER PRIMARY KEY AUTOINCREMENT, alarm_id TEXT NOT NULL, \
                 alarm_message TEXT NOT NULL DEFAULT '', severity TEXT NOT NULL DEFAULT 'Warning', \
                 ts_activated_ms INTEGER NOT NULL, ts_acked_ms INTEGER, ts_normalized_ms INTEGER, \
                 duration_s REAL, acked_by TEXT); \
                 INSERT INTO alarm_events (alarm_id, ts_activated_ms, ts_acked_ms, ts_normalized_ms) VALUES ('v', 1, 2, 3);",
            )
            .unwrap();
        }
        let store = SqliteStore::open(&path).await.unwrap();
        let righe = store.query_alarm_events(None, None, None, 10).await;
        assert_eq!(righe.len(), 1);
        assert!(!righe[0].interrotto);
        store.upsert_alarm_event(&riga("a1", 1000)).await;
        assert_eq!(store.query_alarm_events(None, None, None, 10).await.len(), 2);
    }

    /// Le righe aperte da un giro precedente (una caduta) si chiudono come
    /// interrotte; quelle complete non si toccano.
    #[tokio::test]
    async fn le_righe_aperte_si_chiudono_come_interrotte() {
        let dir = tempfile::tempdir().unwrap();
        let store = SqliteStore::open(dir.path().join("a.db")).await.unwrap();
        store.upsert_alarm_event(&riga("aperta", 1000)).await;
        let mut completa = riga("completa", 2000);
        completa.ts_acked_ms = Some(2500);
        completa.ts_normalized_ms = Some(3000);
        completa.duration_s = Some(1.0);
        store.upsert_alarm_event(&completa).await;

        // Uno scatto ripreso dagli allarmi (ricarica dello stesso progetto)
        // resta aperto: l'allarme è ancora in corso.
        store.upsert_alarm_event(&riga("ripresa", 1500)).await;
        let vive = vec![("ripresa".to_string(), 1500)];
        assert_eq!(store.chiudi_eventi_interrotti(11_000, &vive).await, 1);
        let ripresa = &store.query_alarm_events(Some("ripresa"), None, None, 1).await[0];
        assert!(!ripresa.interrotto);
        assert_eq!(ripresa.ts_normalized_ms, None);
        let aperta = &store.query_alarm_events(Some("aperta"), None, None, 1).await[0];
        assert!(aperta.interrotto);
        assert_eq!(aperta.ts_normalized_ms, Some(11_000));
        assert_eq!(aperta.duration_s, Some(10.0));
        let completa_letta = &store.query_alarm_events(Some("completa"), None, None, 1).await[0];
        assert_eq!(completa_letta, &completa);
    }

    #[tokio::test]
    async fn vacuum_into_produces_a_consistent_copy() {
        let dir = std::env::temp_dir().join(format!(
            "sws-historian-vacuum-into-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src_path = dir.join("src.db");
        let dest_path = dir.join("dest.db");

        let store = SqliteStore::open(&src_path).await.unwrap();
        for i in 0..5u64 {
            let sample = Sample {
                ts_ms: i * 10,
                value: TagValue::Float(i as f64),
                quality: TagQuality::Good,
            };
            store.append("t", &sample).await;
        }

        store.vacuum_into(&dest_path).await.unwrap();

        let dest_store = SqliteStore::open(&dest_path).await.unwrap();
        let dest_samples = dest_store.query_range("t", 0, 1_000_000).await;
        assert_eq!(dest_samples.len(), 5);
        assert_eq!(dest_samples[0].ts_ms, 0);
        assert_eq!(dest_samples.last().unwrap().ts_ms, 40);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// La ricerca a salti dà gli stessi tag di `SELECT DISTINCT`, in ordine,
    /// e il ricaricamento all'apertura li trova tutti con i loro ultimi campioni.
    #[tokio::test]
    async fn tag_distinti_a_salti_come_distinct() {
        let dir = tempfile::tempdir().unwrap();
        let store = SqliteStore::open(dir.path().join("s.db")).await.unwrap();
        for (tag, n) in [("b.tag", 3u64), ("a.tag", 5), ("c.tag", 1), ("a.tag.figlio", 2)] {
            for i in 0..n {
                let s = Sample { ts_ms: 1_000 + i, value: TagValue::Float(i as f64), quality: TagQuality::Good };
                store.append(tag, &s).await;
            }
        }
        let a_salti = store.distinct_tags().await.unwrap();
        assert_eq!(a_salti, ["a.tag", "a.tag.figlio", "b.tag", "c.tag"]);
        {
            let c = store.conn.lock().await;
            let mut st = c.prepare("SELECT DISTINCT tag FROM samples ORDER BY tag").unwrap();
            let vecchio: Vec<String> = st.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
            assert_eq!(a_salti, vecchio);
        }
        let ricaricati = store.restore_recent(2).await.unwrap();
        assert_eq!(ricaricati.len(), 4);
        assert!(ricaricati.iter().all(|(_, v)| v.len() <= 2));
        assert_eq!(store.full_stats().await.unwrap().4, 4, "tag_count");
        // Uno storico vuoto non dà tag, e non va in errore.
        let vuoto = SqliteStore::open(dir.path().join("v.db")).await.unwrap();
        assert!(vuoto.distinct_tags().await.unwrap().is_empty());
    }

    /// La pulizia toglie i tag non storicizzati e le ripetizioni, tiene i
    /// cambi (anche di sola qualità) e l'ultimo campione; l'anteprima conta e
    /// non tocca niente.
    #[tokio::test]
    async fn pulisci_storico_toglie_il_superfluo() {
        let dir = tempfile::tempdir().unwrap();
        let store = SqliteStore::open(dir.path().join("p.db")).await.unwrap();
        let campione = |ts: u64, v: f64, q: TagQuality| Sample { ts_ms: ts, value: TagValue::Float(v), quality: q };
        // storicizzato: 1 1 1 2 2 (Bad) 2 2 → restano 1(ts1) 2(ts4) 2Bad(ts5) 2(ts6) 2(ts7 ultimo)
        let serie = [(1, 1.0, TagQuality::Good), (2, 1.0, TagQuality::Good), (3, 1.0, TagQuality::Good),
                     (4, 2.0, TagQuality::Good), (5, 2.0, TagQuality::Bad), (6, 2.0, TagQuality::Good),
                     (7, 2.0, TagQuality::Good)];
        for (ts, v, q) in serie { store.append("tenuto", &campione(ts, v, q)).await; }
        for ts in 1..=5 { store.append("scartato", &campione(ts, 0.0, TagQuality::Good)).await; }
        store.append("", &campione(1, 0.0, TagQuality::Bad)).await;

        let prova = store.pulisci_storico(vec!["tenuto".into()], true).await.unwrap();
        assert_eq!(prova, EsitoPulizia { non_storicizzati: 6, ripetuti: 2, restanti: 5 });
        assert_eq!(store.total_samples().await.unwrap(), 13, "l'anteprima non cancella");

        let fatto = store.pulisci_storico(vec!["tenuto".into()], false).await.unwrap();
        assert_eq!(fatto, prova);
        assert_eq!(store.distinct_tags().await.unwrap(), ["tenuto"]);
        let ts: Vec<u64> = store.query_range("tenuto", 0, 100).await.iter().map(|s| s.ts_ms).collect();
        assert_eq!(ts, [1, 4, 5, 6, 7]);
    }
}
