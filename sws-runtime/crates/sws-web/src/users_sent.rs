//! Which users a device last received from this IDE.
//!
//! Users travel to a panel on the first deploy and when they change, not on
//! every deploy (maintainer, 16-11-2026: «l'invio di default viene fatto solo
//! alla prima connessione e alla modifica degli utenti, non ad ogni upload»).
//! After a deploy that carried them, the fingerprint of the project's
//! `users.yaml` is kept here, per device; the IDE asks
//! `GET /api/remote/users-pending` to know whether «replace the users» should
//! start checked.
//!
//! One file in the config folder, `users-sent.json`: `{ "<device url>":
//! "<sha256 of users.yaml>" }`. A runtime holds one project at a time, so the
//! device is the key. Lost or unreadable, every device counts as never sent:
//! the IDE proposes sending once more, which is the safe side.

use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;

const FILE: &str = "users-sent.json";

pub fn fingerprint(users_yaml: &[u8]) -> String {
    Sha256::digest(users_yaml)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn key(device_url: &str) -> String {
    device_url.trim_end_matches('/').to_string()
}

async fn load(config_dir: &Path) -> BTreeMap<String, String> {
    tokio::fs::read(config_dir.join(FILE))
        .await
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// Remembers that `device_url` now has these users.
pub async fn record(config_dir: &Path, device_url: &str, users_yaml: &[u8]) {
    let mut map = load(config_dir).await;
    map.insert(key(device_url), fingerprint(users_yaml));
    let Ok(json) = serde_json::to_vec_pretty(&map) else {
        return;
    };
    let tmp = config_dir.join(format!("{FILE}.tmp"));
    if tokio::fs::write(&tmp, json).await.is_ok() {
        if let Err(e) = tokio::fs::rename(&tmp, config_dir.join(FILE)).await {
            tracing::warn!("users-sent: not saved: {e}");
        }
    }
}

/// Why the users should (or need not) go with the next deploy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Pending {
    /// The panel has no users yet: the first deploy brings them anyway.
    FirstDeploy,
    /// Never sent from here (or the record is lost).
    NeverSent,
    /// The project's users differ from the ones last sent.
    Changed,
    /// Same users as last time.
    Same,
}

impl Pending {
    pub fn send(self) -> bool {
        self != Pending::Same
    }
}

pub fn pending(panel_waiting: bool, last_sent: Option<&str>, current: Option<&[u8]>) -> Pending {
    if panel_waiting {
        return Pending::FirstDeploy;
    }
    match (last_sent, current) {
        (None, _) => Pending::NeverSent,
        (Some(f), Some(c)) if f == fingerprint(c) => Pending::Same,
        (Some(f), None) if f == fingerprint(b"") => Pending::Same,
        _ => Pending::Changed,
    }
}

/// The fingerprint last recorded for `device_url`.
pub async fn last_sent(config_dir: &Path, device_url: &str) -> Option<String> {
    load(config_dir).await.remove(&key(device_url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_users_need_not_travel() {
        let f = fingerprint(b"users: []\n");
        assert_eq!(
            pending(false, Some(&f), Some(b"users: []\n")),
            Pending::Same
        );
        assert!(!Pending::Same.send());
    }

    #[test]
    fn changed_never_sent_and_first_deploy_travel() {
        let f = fingerprint(b"users: [a]\n");
        assert_eq!(
            pending(false, Some(&f), Some(b"users: [b]\n")),
            Pending::Changed
        );
        assert_eq!(
            pending(false, None, Some(b"users: [b]\n")),
            Pending::NeverSent
        );
        assert_eq!(
            pending(true, Some(&f), Some(b"users: [a]\n")),
            Pending::FirstDeploy
        );
        assert!(
            Pending::Changed.send() && Pending::NeverSent.send() && Pending::FirstDeploy.send()
        );
    }

    #[tokio::test]
    async fn the_record_survives_and_ignores_the_trailing_slash() {
        let dir = tempfile::tempdir().unwrap();
        record(dir.path(), "https://ty.local:7444/", b"x").await;
        assert_eq!(
            last_sent(dir.path(), "https://ty.local:7444").await,
            Some(fingerprint(b"x"))
        );
    }
}
