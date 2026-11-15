//! `GET /api/control-panel/about` — what runs on this device, read only: SWS,
//! the project, the system and how things are going. It is the page someone
//! reads to the person on the phone (maintainer, 15-11-2026: «una sezione con
//! i dati di sws, versione e informazioni base del progetto tra cui data di
//! caricamento e spazio occupato dal progetto, runtime escluso»).

use crate::router::AppState;
use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

/// The history lives inside the project folder, and is what fills the disk:
/// it is counted apart.
const HISTORY_DIR: &str = "history";
const PAGES_DIR: &str = "synoptics";
const PIXSYS_IMAGE_INFO: &str = "/etc/pixsys/pixsys.info";
/// The update check asks the registry: the page must not wait for a network
/// that is not there.
const UPDATE_WITHIN: Duration = Duration::from_secs(4);

/// Bytes under `dir`, without the entry named `skip` at its top level.
pub fn dir_size(dir: &Path, skip: Option<&str>) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| skip.is_none_or(|s| e.file_name() != s))
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path(), None),
            Ok(t) if t.is_file() => e.metadata().map_or(0, |m| m.len()),
            _ => 0,
        })
        .sum()
}

/// `PRETTY_NAME` of an `os-release` file.
pub fn os_name(os_release: &str) -> Option<String> {
    os_release.lines().find_map(|l| {
        let v = l.strip_prefix("PRETTY_NAME=")?.trim().trim_matches('"');
        (!v.is_empty()).then(|| v.to_string())
    })
}

/// Seconds since the system started, from `/proc/uptime`.
pub fn system_uptime(proc_uptime: &str) -> Option<u64> {
    let secs: f64 = proc_uptime.split_whitespace().next()?.parse().ok()?;
    Some(secs as u64)
}

fn pages(project: &Path) -> usize {
    std::fs::read_dir(project.join(PAGES_DIR))
        .map(|d| d.flatten().filter(|e| e.path().is_file()).count())
        .unwrap_or(0)
}

fn modified_ms(path: &Path) -> Option<u64> {
    let t = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(t.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// The manufacturer's image, where it says one: «5.0a (07/10/2026 18:00)».
fn manufacturer_image() -> Option<String> {
    let info = Path::new(PIXSYS_IMAGE_INFO);
    let revision = sws_plugin_host::pixsys_device_info(info, "Revision")?;
    Some(
        match sws_plugin_host::pixsys_device_info(info, "Build date") {
            Some(date) => format!("{revision} ({date})"),
            None => revision,
        },
    )
}

fn cpu_temperature() -> Option<f32> {
    let t = std::fs::read_to_string("/sys/class/thermal/thermal_zone0/temp").ok()?;
    Some(t.trim().parse::<f32>().ok()? / 1000.0)
}

pub async fn about(State(s): State<AppState>) -> Response {
    let Json(status) = crate::system::get_system_status(State(s.clone()), None).await;
    let project_dir = s.project_dir.read().await.clone();

    let project = match project_dir {
        Some(dir) => {
            let meta = sws_core::project::Project::load(&dir).ok().map(|p| p.meta);
            // Walking the folder is disk work: off the async threads.
            let measured = tokio::task::spawn_blocking(move || {
                (
                    dir_size(&dir, Some(HISTORY_DIR)),
                    dir_size(&dir.join(HISTORY_DIR), None),
                    pages(&dir),
                    // A deploy rewrites the project file: its date is the load's.
                    modified_ms(&dir.join("project.yaml")),
                )
            })
            .await
            .ok();
            measured.map(|(size, history, pages, loaded)| {
                json!({
                    "name": meta.as_ref().map(|m| m.name.clone()).or(status.active_project.clone()),
                    "version": meta.map(|m| m.version).filter(|v| !v.is_empty()),
                    "loaded_ms": loaded,
                    "size_bytes": size,
                    "history_bytes": history,
                    "pages": pages,
                    "tags": status.tag_count,
                    "sources": status.source_count,
                })
            })
        }
        None => None,
    };

    let update = tokio::time::timeout(UPDATE_WITHIN, crate::aggiornamento::stato())
        .await
        .ok()
        .and_then(|u| u.disponibile);
    let certificate = std::fs::read(s.config_dir.join("tls.crt"))
        .ok()
        .and_then(|pem| crate::certificati::leggi_pem(&pem))
        .map(|c| c.valido_al_ms);

    Json(json!({
        "sws": {
            "version": status.runtime_version,
            "git": status.runtime_git,
            "build_ms": status.runtime_build_ms,
            "uptime_s": status.uptime_s,
        },
        "project": project,
        "system": {
            "os": std::fs::read_to_string("/etc/os-release").ok().and_then(|t| os_name(&t)),
            "kernel": std::fs::read_to_string("/proc/sys/kernel/osrelease")
                .ok()
                .map(|k| k.trim().to_string()),
            "image": manufacturer_image(),
            "arch": status.arch,
            "disk_used_gb": status.disk_used_gb,
            "disk_total_gb": status.disk_total_gb,
            "mem_used_mb": status.mem_used_mb,
            "mem_total_mb": status.mem_total_mb,
            "cpu_temp_c": cpu_temperature(),
            "uptime_s": std::fs::read_to_string("/proc/uptime")
                .ok()
                .and_then(|t| system_uptime(&t)),
        },
        "state": {
            "sources_running": s.supervisor.running_count().await,
            "sources": status.source_count,
            "armed": status.armed,
            "alarms_active": status.alarm_active_count,
            "cloud": s.abbinamento.tunnel().map(|(name, _)| name),
            "update_available": update,
            "certificate_expires_ms": certificate,
        },
        // Whether the diagnostic export can go on a USB stick here.
        "diagnostics_usb": super::diagnostics::helper().is_some(),
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_project_is_measured_without_its_history() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("synoptics")).unwrap();
        std::fs::create_dir_all(d.path().join("history")).unwrap();
        std::fs::create_dir_all(d.path().join("images/history")).unwrap();
        std::fs::write(d.path().join("project.yaml"), [0u8; 100]).unwrap();
        std::fs::write(d.path().join("synoptics/a.yaml"), [0u8; 30]).unwrap();
        std::fs::write(d.path().join("synoptics/b.yaml"), [0u8; 20]).unwrap();
        // Only the top-level `history` is the historian's.
        std::fs::write(d.path().join("images/history/x.png"), [0u8; 7]).unwrap();
        std::fs::write(d.path().join("history/historian.db"), [0u8; 5000]).unwrap();
        assert_eq!(dir_size(d.path(), Some(HISTORY_DIR)), 157);
        assert_eq!(dir_size(&d.path().join(HISTORY_DIR), None), 5000);
        assert_eq!(pages(d.path()), 2);
        assert_eq!(dir_size(&d.path().join("missing"), None), 0);
    }

    #[test]
    fn the_system_files_are_read() {
        assert_eq!(
            os_name("NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 22.04.5 LTS\"\n").as_deref(),
            Some("Ubuntu 22.04.5 LTS")
        );
        assert_eq!(os_name("NAME=x\n"), None);
        assert_eq!(system_uptime("34410.37 61234.11\n"), Some(34410));
        assert_eq!(system_uptime(""), None);
    }
}
