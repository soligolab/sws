//! When each user last signed in on this device (plan
//! `docs/plans/2026-11-22-rc29-collaudo-utente-editor-simboli.md`, block B).
//!
//! A page can say «Welcome Mario — last login 21-11-2026 18:30»: the login
//! **before** this one, as banks do. The time is a fact of the device, not of
//! the project: the file is in the device's `config/` (`last_logins.json`), it
//! survives deploys, and it holds the project's users, the device's and the
//! directory's (LDAP) alike — a directory user is stored nowhere else.
//!
//! One small JSON map, `username → ms`. Written at every successful login;
//! a write that fails is logged and forgotten: losing a «last login» is not
//! worth refusing a login over.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

const FILE: &str = "last_logins.json";
/// More names than any panel has users: past it the oldest are dropped, so a
/// directory with thousands of accounts can't grow the file forever.
const MAX_ENTRIES: usize = 500;

fn path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE)
}

fn read(config_dir: &Path) -> HashMap<String, u64> {
    std::fs::read(path(config_dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// Records a login of `username` at `now_ms` and returns the one before, if
/// there was one. Serialised by the caller's lock (`LOCK` below) so two
/// logins at the same moment don't lose each other's line.
pub fn record(config_dir: &Path, username: &str, now_ms: u64) -> Option<u64> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if username.is_empty() {
        return None;
    }
    let mut map = read(config_dir);
    let previous = map.insert(username.to_string(), now_ms);
    if map.len() > MAX_ENTRIES {
        let mut by_age: Vec<(String, u64)> = map.iter().map(|(k, v)| (k.clone(), *v)).collect();
        by_age.sort_by_key(|(_, v)| *v);
        for (k, _) in by_age.into_iter().take(map.len() - MAX_ENTRIES) {
            map.remove(&k);
        }
    }
    let tmp = path(config_dir).with_extension("json.tmp");
    let written = serde_json::to_vec(&map)
        .map_err(std::io::Error::other)
        .and_then(|b| std::fs::write(&tmp, b))
        .and_then(|_| std::fs::rename(&tmp, path(config_dir)));
    if let Err(e) = written {
        tracing::warn!(error = %e, "last_logins: could not write {FILE}");
    }
    previous
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_previous_login_comes_back_and_the_new_one_is_kept() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(
            record(d.path(), "mario", 1_000),
            None,
            "first login: nothing before"
        );
        assert_eq!(record(d.path(), "mario", 2_000), Some(1_000));
        assert_eq!(record(d.path(), "anna", 2_500), None, "one line per user");
        assert_eq!(record(d.path(), "mario", 3_000), Some(2_000));
        assert_eq!(
            record(d.path(), "", 4_000),
            None,
            "anonymous: nothing recorded"
        );
    }
}
