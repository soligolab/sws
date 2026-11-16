//! `POST /api/control-panel/reset` `{pin}` — the device given back: the
//! project with its history, the users and the pairing go; the runtime starts
//! again waiting for a pairing, with no project.
//!
//! What stays (maintainer, 15-11-2026): the device's own settings made from
//! this panel (`control_panel.json`: corners, brightness, upside down), the
//! NTP servers, the identity of the installation, the certificates and the
//! audit log — and everything of the system: network, Wi-Fi, time.
//!
//! The PIN is asked again: a panel left open must not be enough.
//!
//! `keep_cloud` (16-11-2026): only the application goes — project, history,
//! users — and the cloud pairing stays. The panel comes back paired and
//! without users, waiting for its first project from the cloud IDE.

use super::{bad_request, gate, initial_pin, pin, project_config, LOCKOUT, MAX_FAILURES};
use crate::router::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use std::path::Path;
use std::time::{Duration, Instant};

/// What of the configuration folder belongs to the project, the users and the
/// pairing. Anything else there stays.
const CONFIG_GOES: [&str; 5] = [
    // The pairing: code, cloud tunnel, its credentials.
    "abbinamento.json",
    // The users of the device (those of the project go with the project).
    "utenti_dispositivo.yaml",
    // Which projects this device knew.
    "known_projects.json",
    // The project's boot image and what was derived from the project.
    "boot-image",
    "cache",
];

fn remove(path: &Path) -> std::io::Result<bool> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    if meta.is_dir() {
        std::fs::remove_dir_all(path)?;
    } else {
        std::fs::remove_file(path)?;
    }
    Ok(true)
}

/// The pairing file, which `keep_cloud` leaves in place.
const PAIRING: &str = "abbinamento.json";

/// Empties the projects folder and takes the pairing (unless `keep_cloud`),
/// the users and the project's traces out of the configuration. Returns what
/// it removed; goes on after an error, and reports the first.
pub fn wipe(
    projects_root: &Path,
    config_dir: &Path,
    keep_cloud: bool,
) -> (Vec<String>, Option<String>) {
    let mut removed = Vec::new();
    let mut failed = None;
    let mut take = |path: std::path::PathBuf| match remove(&path) {
        Ok(true) => removed.push(path.display().to_string()),
        Ok(false) => {}
        Err(e) => {
            failed.get_or_insert(format!("{}: {e}", path.display()));
        }
    };
    // Everything in the projects folder, markers included; the folder stays.
    if let Ok(entries) = std::fs::read_dir(projects_root) {
        for e in entries.flatten() {
            take(e.path());
        }
    }
    for name in CONFIG_GOES {
        if keep_cloud && name == PAIRING {
            continue;
        }
        take(config_dir.join(name));
    }
    (removed, failed)
}

#[derive(Deserialize)]
pub struct ResetBody {
    pin: String,
    #[serde(default)]
    keep_cloud: bool,
}

pub async fn reset(State(s): State<AppState>, Json(body): Json<ResetBody>) -> Response {
    // The same gate as the session: wrong PINs here count too.
    let now = Instant::now();
    if let Some(until) = gate().lock().unwrap().locked_until.filter(|t| *t > now) {
        let secs = until.duration_since(now).as_secs().max(1);
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "retry_after_secs": secs })),
        )
            .into_response();
    }
    let cfg = project_config(&s).await;
    if !pin::pin_matches(&body.pin, cfg.pin_hash.as_deref(), initial_pin().as_deref()) {
        let mut g = gate().lock().unwrap();
        g.failures += 1;
        if g.failures >= MAX_FAILURES {
            g.failures = 0;
            g.locked_until = Some(now + LOCKOUT);
        }
        tracing::warn!("control panel: wrong PIN for the reset");
        // 403, not 401: 401 is the session that expired.
        return StatusCode::FORBIDDEN.into_response();
    }
    if s.ide_only {
        return bad_request("an IDE has no device to give back".into());
    }
    let keep_cloud = body.keep_cloud;
    s.audit.log("control_panel.reset", None, json!({ "keep_cloud": keep_cloud }));
    if keep_cloud {
        tracing::warn!("control panel: project and users are being removed, the cloud pairing stays");
    } else {
        tracing::warn!("control panel: project, users and pairing are being removed");
    }

    // The factory boot image first, while the runtime still knows how.
    let _ = crate::boot_image::ripristina_fabbrica(&s.config_dir).await;
    // Nothing writes into the project while its folder goes.
    s.supervisor.stop_all().await;
    let (projects_root, config_dir) = (s.projects_root.clone(), s.config_dir.clone());
    let (removed, failed) = tokio::task::spawn_blocking(move || wipe(&projects_root, &config_dir, keep_cloud))
        .await
        .unwrap_or_else(|e| (Vec::new(), Some(e.to_string())));
    tracing::warn!(removed = removed.len(), ?failed, "control panel: reset");
    if let Some(e) = failed {
        return super::failed(format!("not everything could be removed: {e}"));
    }
    // A new process: no project open, a new pairing code. The answer leaves
    // first; the service manager (or this same call, where there is none)
    // starts the runtime again.
    tokio::spawn(async {
        tokio::time::sleep(Duration::from_millis(500)).await;
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            if let Ok(exe) = std::env::current_exe() {
                let args: Vec<_> = std::env::args_os().skip(1).collect();
                let err = std::process::Command::new(exe).args(args).exec();
                tracing::error!("reset: exec failed: {err}");
            }
        }
        std::process::exit(0);
    });
    StatusCode::ACCEPTED.into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_project_the_users_and_the_pairing_go_and_the_device_stays() {
        let d = tempfile::tempdir().unwrap();
        let (projects, config) = (d.path().join("projects"), d.path().join("config"));
        std::fs::create_dir_all(projects.join("plant/history")).unwrap();
        std::fs::write(projects.join("plant/project.yaml"), "x").unwrap();
        std::fs::write(projects.join("plant/users.yaml"), "x").unwrap();
        std::fs::write(projects.join("plant/history/historian.db"), "x").unwrap();
        std::fs::write(projects.join(".active-project"), "plant").unwrap();
        std::fs::create_dir_all(config.join("boot-image")).unwrap();
        for f in [
            "abbinamento.json",
            "utenti_dispositivo.yaml",
            "known_projects.json",
            "control_panel.json",
            "instance_id",
            "audit.jsonl",
            "tls.crt",
        ] {
            std::fs::write(config.join(f), "x").unwrap();
        }
        let (removed, failed) = wipe(&projects, &config, false);
        assert_eq!(failed, None);
        assert_eq!(removed.len(), 6);
        // The folder stays, empty: the next deploy lands there.
        assert_eq!(std::fs::read_dir(&projects).unwrap().count(), 0);
        let left: std::collections::BTreeSet<String> = std::fs::read_dir(&config)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            left.into_iter().collect::<Vec<_>>(),
            [
                "audit.jsonl",
                "control_panel.json",
                "instance_id",
                "tls.crt"
            ]
        );
        // Again: nothing left to remove, and no error.
        assert_eq!(wipe(&projects, &config, false), (Vec::new(), None));
    }

    #[test]
    fn keep_cloud_leaves_the_pairing_and_takes_the_rest() {
        let d = tempfile::tempdir().unwrap();
        let (projects, config) = (d.path().join("projects"), d.path().join("config"));
        std::fs::create_dir_all(projects.join("plant")).unwrap();
        std::fs::write(projects.join("plant/users.yaml"), "x").unwrap();
        std::fs::create_dir_all(&config).unwrap();
        for f in ["abbinamento.json", "utenti_dispositivo.yaml", "known_projects.json"] {
            std::fs::write(config.join(f), "x").unwrap();
        }
        let (_, failed) = wipe(&projects, &config, true);
        assert_eq!(failed, None);
        assert_eq!(std::fs::read_dir(&projects).unwrap().count(), 0);
        assert!(config.join("abbinamento.json").exists());
        assert!(!config.join("utenti_dispositivo.yaml").exists());
        assert!(!config.join("known_projects.json").exists());
    }
}
