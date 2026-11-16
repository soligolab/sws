//! The history of AI spending of the installation: per month, per purpose,
//! per provider (phase G5 of `docs/archive/2026-11-10-assistente-secondo-giro.md`).
//!
//! Until 16-11-2026 there was only the cap of a conversation and of a purpose:
//! nobody could tell what the assistant had cost last month. Every paid call
//! that already computes its cost (assistant turns, symbols, translation,
//! backgrounds) adds it here.
//!
//! # Where and how
//!
//! One small JSON file in `config_dir`, next to `ai.yaml` (keys and caps live
//! there too): `ai-spending.json`. It holds sums, not calls, so it does not grow
//! with use; only the last [`MAX_MONTHS`] months are kept. Every add rewrites it
//! atomically (temporary file + rename) under a process-wide lock, so two
//! conversations that pay at the same moment do not lose each other's cost.
//!
//! Spending is recorded, never enforced: a file that cannot be written logs a
//! warning and the call goes on. The caps stay where they are.
//!
//! # A file that cannot be read is never overwritten
//!
//! Only a **missing** file is an empty history. A file that is there and is not
//! valid JSON any more (edited by hand, a disk fault) is set aside as
//! `ai-spending.json.broken-<date>-<time>` before a new one is started, so the
//! months it held can be recovered by hand. Any other read error (permissions,
//! I/O) skips the write: that one cost is lost, with a warning, and the file
//! stays as it is. Both would otherwise wipe up to three years of history at
//! the first paid call, silently. The copies set aside are not removed: each
//! one takes a file broken from outside, which the atomic write never produces.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub const FILE: &str = "ai-spending.json";

/// How many months the file keeps: three years of history is plenty for a
/// panel, and keeps the file a few kilobytes.
pub const MAX_MONTHS: usize = 36;

/// What one purpose spent with one provider in one month.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Cell {
    pub usd: f64,
    pub calls: u64,
}

/// month (`YYYY-MM`) → purpose → provider → spending.
pub type Months = BTreeMap<String, BTreeMap<String, BTreeMap<String, Cell>>>;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Record {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub months: Months,
}

/// Why the file that is there gave no record.
#[derive(Debug)]
pub enum ReadError {
    /// It is not a valid record any more.
    Broken(serde_json::Error),
    /// It could not be read at all (permissions, I/O).
    Unreadable(std::io::Error),
}

impl std::fmt::Display for ReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReadError::Broken(e) => write!(f, "not a valid record: {e}"),
            ReadError::Unreadable(e) => write!(f, "cannot be read: {e}"),
        }
    }
}

impl Record {
    pub fn path(config_dir: &Path) -> PathBuf {
        config_dir.join(FILE)
    }

    /// The record of the file. Only a missing file is an empty record: the
    /// writer must tell it from a file it cannot read, see the module.
    pub fn read(config_dir: &Path) -> Result<Self, ReadError> {
        match std::fs::read(Self::path(config_dir)) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(ReadError::Broken),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(ReadError::Unreadable(e)),
        }
    }

    /// [`Record::read`] for who only shows it: a file that cannot be read is an
    /// empty record, with a warning. Nothing is written.
    pub fn load(config_dir: &Path) -> Self {
        Self::read(config_dir).unwrap_or_else(|e| {
            let p = Self::path(config_dir);
            tracing::warn!(path = %p.display(), error = %e, "the AI spending history is not readable: shown as empty");
            Self::default()
        })
    }

    fn add(&mut self, month: &str, purpose: &str, provider: &str, usd: f64) {
        let cell = self
            .months
            .entry(month.to_string())
            .or_default()
            .entry(purpose.to_string())
            .or_default()
            .entry(provider.to_string())
            .or_default();
        cell.usd += usd;
        cell.calls += 1;
        // `YYYY-MM` sorts as text: the first keys are the oldest.
        while self.months.len() > MAX_MONTHS {
            let oldest = self.months.keys().next().cloned();
            if let Some(k) = oldest {
                self.months.remove(&k);
            }
        }
    }

    fn save(&self, config_dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(config_dir)?;
        let bytes = serde_json::to_vec_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        sws_core::segreti::scrivi_atomico_0600(&Self::path(config_dir), &bytes)
    }

    /// The total of one month.
    pub fn total_of(&self, month: &str) -> f64 {
        self.months
            .get(month)
            .map(|p| p.values().flat_map(|v| v.values()).map(|c| c.usd).sum())
            .unwrap_or(0.0)
    }
}

/// What `GET /api/ai/spending` answers: the months from the newest, each with
/// its total and one row per purpose and provider; `current` is always the
/// first, even when nothing was spent in it yet.
pub fn report(record: &Record, current: &str) -> serde_json::Value {
    use serde_json::json;
    let mut names: Vec<&str> = record.months.keys().map(String::as_str).collect();
    if !names.contains(&current) {
        names.push(current);
    }
    // `YYYY-MM` sorts as text.
    names.sort_unstable_by(|a, b| b.cmp(a));
    let mut all_usd = 0.0;
    let mut all_calls = 0u64;
    let months: Vec<_> = names
        .into_iter()
        .map(|month| {
            let mut rows = Vec::new();
            let (mut usd, mut calls) = (0.0, 0u64);
            for (purpose, providers) in record.months.get(month).into_iter().flatten() {
                for (provider, cell) in providers {
                    usd += cell.usd;
                    calls += cell.calls;
                    rows.push(json!({ "purpose": purpose, "provider": provider,
                                      "usd": cell.usd, "calls": cell.calls }));
                }
            }
            all_usd += usd;
            all_calls += calls;
            json!({ "month": month, "usd": usd, "calls": calls, "rows": rows })
        })
        .collect();
    json!({
        "current_month": current,
        "months": months,
        "total": { "usd": all_usd, "calls": all_calls },
        "kept_months": MAX_MONTHS,
    })
}

/// The month of now, local time: `2026-11`.
pub fn current_month() -> String {
    chrono::Local::now().format("%Y-%m").to_string()
}

/// Moves a broken file next to itself, under a name that says when, and never
/// over a copy that is already there. Returns the new path.
fn set_aside(path: &Path) -> std::io::Result<PathBuf> {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let name = |n: u32| {
        let mut s = path.as_os_str().to_os_string();
        s.push(format!(".broken-{stamp}"));
        if n > 1 {
            s.push(format!("-{n}"));
        }
        PathBuf::from(s)
    };
    let free = (1..=1000)
        .map(name)
        .find(|p| !p.exists())
        .ok_or_else(|| std::io::Error::other("too many broken copies"))?;
    std::fs::rename(path, &free)?;
    Ok(free)
}

/// Serialises read-modify-write across the whole process.
static LOCK: Mutex<()> = Mutex::new(());

/// Adds a cost to the current month. Never fails the caller: see the module.
pub fn add(config_dir: &Path, purpose: &str, provider: &str, usd: f64) {
    add_in_month(config_dir, &current_month(), purpose, provider, usd);
}

/// [`add`] for a given month (the tests move the clock this way).
pub fn add_in_month(config_dir: &Path, month: &str, purpose: &str, provider: &str, usd: f64) {
    if !usd.is_finite() || usd < 0.0 || purpose.is_empty() || provider.is_empty() {
        return;
    }
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = Record::path(config_dir);
    let mut r = match Record::read(config_dir) {
        Ok(r) => r,
        Err(ReadError::Broken(e)) => match set_aside(&path) {
            Ok(kept) => {
                tracing::warn!(path = %path.display(), kept = %kept.display(), error = %e,
                    "the AI spending history was not valid JSON: set aside, a new one starts");
                Record::default()
            }
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, purpose, provider, usd,
                    "the AI spending history is broken and cannot be set aside: this cost is not recorded");
                return;
            }
        },
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, purpose, provider, usd,
                "the AI spending history cannot be read: this cost is not recorded");
            return;
        }
    };
    r.version = 1;
    r.add(month, purpose, provider, usd);
    if let Err(e) = r.save(config_dir) {
        tracing::warn!(error = %e, purpose, provider, "cannot write the AI spending history");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_sum_by_month_purpose_and_provider() {
        let d = tempfile::tempdir().unwrap();
        add_in_month(d.path(), "2026-11", "assistente", "anthropic", 1.5);
        add_in_month(d.path(), "2026-11", "assistente", "anthropic", 0.25);
        add_in_month(d.path(), "2026-11", "sfondi", "bfl", 0.045);
        let r = Record::load(d.path());
        let c = r.months["2026-11"]["assistente"]["anthropic"];
        assert_eq!(c.calls, 2);
        assert!((c.usd - 1.75).abs() < 1e-9);
        assert!((r.total_of("2026-11") - 1.795).abs() < 1e-9);
        assert_eq!(r.total_of("2026-10"), 0.0);
    }

    #[test]
    fn a_new_month_starts_from_zero_and_keeps_the_old_one() {
        let d = tempfile::tempdir().unwrap();
        add_in_month(d.path(), "2026-10", "traduzione", "kimi", 0.01);
        add_in_month(d.path(), "2026-11", "traduzione", "kimi", 0.02);
        let r = Record::load(d.path());
        assert_eq!(r.months.len(), 2);
        assert!((r.total_of("2026-10") - 0.01).abs() < 1e-9);
        assert!((r.total_of("2026-11") - 0.02).abs() < 1e-9);
        assert_eq!(current_month().len(), 7);
    }

    #[test]
    fn only_the_last_months_are_kept() {
        let d = tempfile::tempdir().unwrap();
        for i in 0..(MAX_MONTHS + 4) {
            let m = format!("{}-{:02}", 2020 + i / 12, i % 12 + 1);
            add_in_month(d.path(), &m, "assistente", "kimi", 1.0);
        }
        let r = Record::load(d.path());
        assert_eq!(r.months.len(), MAX_MONTHS);
        assert!(!r.months.contains_key("2020-01"), "the oldest goes first");
    }

    fn files_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn it_survives_a_restart() {
        let d = tempfile::tempdir().unwrap();
        add_in_month(d.path(), "2026-11", "simboli", "anthropic", 0.3);
        let text = std::fs::read_to_string(Record::path(d.path())).unwrap();
        assert!(text.contains("\"simboli\"") && text.contains("\"version\": 1"));
        add_in_month(d.path(), "2026-11", "simboli", "anthropic", 0.3);
        assert_eq!(
            Record::load(d.path()).months["2026-11"]["simboli"]["anthropic"].calls,
            2
        );
        // No temporary file left behind.
        assert_eq!(files_in(d.path()), [FILE]);
    }

    /// A file that is not JSON any more held months of history: the next paid
    /// call must not write a new record over it.
    #[test]
    fn a_broken_file_is_set_aside_not_overwritten() {
        let d = tempfile::tempdir().unwrap();
        let broken = "{ \"version\": 1, \"months\": { \"2026-10\": {,} } }";
        std::fs::write(Record::path(d.path()), broken).unwrap();
        assert!(matches!(Record::read(d.path()), Err(ReadError::Broken(_))));
        // Showing it writes nothing.
        assert_eq!(Record::load(d.path()), Record::default());
        assert_eq!(files_in(d.path()), [FILE]);

        add_in_month(d.path(), "2026-11", "simboli", "anthropic", 0.3);
        assert_eq!(
            Record::load(d.path()).months["2026-11"]["simboli"]["anthropic"].calls,
            1
        );
        let names = files_in(d.path());
        assert_eq!(names.len(), 2, "{names:?}");
        let kept = names
            .iter()
            .find(|n| n.starts_with("ai-spending.json.broken-"))
            .expect("the broken file is kept");
        assert_eq!(
            std::fs::read_to_string(d.path().join(kept)).unwrap(),
            broken
        );

        // A second broken file in the same second does not replace the first.
        std::fs::write(Record::path(d.path()), "again").unwrap();
        add_in_month(d.path(), "2026-11", "simboli", "anthropic", 0.3);
        let copies: Vec<String> = files_in(d.path())
            .into_iter()
            .filter(|n| n.contains(".broken-"))
            .collect();
        assert_eq!(copies.len(), 2, "{copies:?}");
        let texts: Vec<String> = copies
            .iter()
            .map(|n| std::fs::read_to_string(d.path().join(n)).unwrap())
            .collect();
        assert!(texts.contains(&broken.to_string()) && texts.contains(&"again".to_string()));
    }

    /// A read error that is not «missing» says nothing about what the file
    /// holds: the add is skipped and the file is left alone. A directory in
    /// its place is a read error on every system, whoever runs the tests.
    #[test]
    fn a_file_that_cannot_be_read_is_left_alone() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir(Record::path(d.path())).unwrap();
        std::fs::write(Record::path(d.path()).join("inside"), "x").unwrap();
        assert!(matches!(
            Record::read(d.path()),
            Err(ReadError::Unreadable(_))
        ));
        add_in_month(d.path(), "2026-11", "simboli", "anthropic", 0.3);
        assert_eq!(files_in(d.path()), [FILE]);
        assert!(Record::path(d.path()).join("inside").exists());
        assert_eq!(Record::load(d.path()), Record::default());
    }

    #[test]
    fn the_report_lists_the_months_from_the_newest_with_their_totals() {
        let d = tempfile::tempdir().unwrap();
        add_in_month(d.path(), "2026-09", "assistente", "anthropic", 2.0);
        add_in_month(d.path(), "2026-10", "sfondi", "bfl", 0.045);
        add_in_month(d.path(), "2026-10", "sfondi", "openai", 0.07);
        add_in_month(d.path(), "2026-10", "assistente", "kimi", 1.0);
        let v = report(&Record::load(d.path()), "2026-11");
        let months: Vec<&str> = v["months"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["month"].as_str().unwrap())
            .collect();
        // The current month is there even with nothing spent.
        assert_eq!(months, ["2026-11", "2026-10", "2026-09"]);
        assert_eq!(v["current_month"], "2026-11");
        assert_eq!(v["months"][0]["usd"], 0.0);
        assert_eq!(v["months"][0]["rows"].as_array().unwrap().len(), 0);
        let october = &v["months"][1];
        assert!((october["usd"].as_f64().unwrap() - 1.115).abs() < 1e-9);
        assert_eq!(october["calls"], 3);
        assert_eq!(october["rows"].as_array().unwrap().len(), 3);
        assert!(october["rows"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| { r["purpose"] == "sfondi" && r["provider"] == "bfl" && r["calls"] == 1 }));
        assert!((v["total"]["usd"].as_f64().unwrap() - 3.115).abs() < 1e-9);
        // An empty record still has its current month.
        let empty = report(&Record::default(), "2026-11");
        assert_eq!(empty["months"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn nonsense_costs_are_ignored() {
        let d = tempfile::tempdir().unwrap();
        add_in_month(d.path(), "2026-11", "assistente", "kimi", f64::NAN);
        add_in_month(d.path(), "2026-11", "assistente", "kimi", -1.0);
        add_in_month(d.path(), "2026-11", "", "kimi", 1.0);
        assert!(!Record::path(d.path()).exists());
    }

    #[test]
    fn concurrent_adds_are_all_counted() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().to_path_buf();
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let dir = dir.clone();
                std::thread::spawn(move || {
                    for _ in 0..25 {
                        add_in_month(&dir, "2026-11", "assistente", "anthropic", 0.01);
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        let c = Record::load(&dir).months["2026-11"]["assistente"]["anthropic"];
        assert_eq!(c.calls, 200);
        assert!((c.usd - 2.0).abs() < 1e-9);
    }
}
