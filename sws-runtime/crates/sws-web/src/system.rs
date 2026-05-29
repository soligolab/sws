use std::path::Path;
use std::time::Instant;

use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;
use sws_core::{AlarmDb, TagDb};
use sysinfo::{Disks, System};

use crate::global_scripts::GlobalScriptSupervisor;
use crate::router::{active_dir, AppState};
use crate::source_supervisor::SourceSupervisor;

#[derive(Serialize, Debug, PartialEq)]
pub struct SystemStatus {
    pub runtime_version: String,
    pub uptime_s: u64,
    pub active_project: Option<String>,
    pub tag_count: usize,
    pub source_count: usize,
    /// True when the supervisor has at least one source running.
    pub sources_running: bool,
    pub alarm_active_count: usize,
    pub historian_samples: u64,
    pub cpu_usage_pct: f32,
    pub mem_used_mb: u64,
    pub mem_total_mb: u64,
    pub disk_used_gb: u64,
    pub disk_total_gb: u64,
}

pub async fn compute_system_status(
    db: &TagDb,
    alarms: &AlarmDb,
    supervisor: &SourceSupervisor,
    project_dir: Option<&Path>,
    started_at: Instant,
) -> SystemStatus {
    let mut sys = System::new_all();
    sys.refresh_all();
    let disks = Disks::new_with_refreshed_list();
    let disk = disks.list().first();

    let active_project = project_dir
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned());

    let alarms_snap = alarms.snapshot().await;
    let alarm_active_count = alarms_snap.iter().filter(|a| a.active).count();

    let tags = db.snapshot().await;
    let tag_count = tags.len();
    let source_count = supervisor.running_count().await;

    SystemStatus {
        runtime_version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_s: started_at.elapsed().as_secs(),
        active_project,
        tag_count,
        source_count,
        sources_running: source_count > 0,
        alarm_active_count,
        historian_samples: 0,
        cpu_usage_pct: sys.global_cpu_info().cpu_usage(),
        mem_used_mb: sys.used_memory() / 1_048_576,
        mem_total_mb: sys.total_memory() / 1_048_576,
        disk_used_gb: disk.map(|d| (d.total_space() - d.available_space()) / 1_073_741_824).unwrap_or(0),
        disk_total_gb: disk.map(|d| d.total_space() / 1_073_741_824).unwrap_or(0),
    }
}

pub async fn get_system_status(State(state): State<AppState>) -> Json<SystemStatus> {
    let dir_guard = state.project_dir.read().await;
    Json(compute_system_status(
        &state.db,
        &state.alarms,
        &state.supervisor,
        dir_guard.as_deref(),
        state.started_at,
    ).await)
}

/// `POST /api/system/stop` — stop all sources and script/notification supervisors.
/// The web server and tag DB remain active; the project is still "open".
pub async fn system_stop(State(s): State<AppState>) -> StatusCode {
    s.supervisor.reload(vec![]).await;
    if let Some(sc) = s.script_supervisor.write().await.take() {
        sc.stop();
    }
    if let Some(ns) = s.notification_supervisor.write().await.take() {
        ns.stop();
    }
    tracing::info!("runtime acquisition stopped by operator");
    StatusCode::NO_CONTENT
}

/// `POST /api/system/start` — reload sources + script supervisor from the
/// current project on disk. No-op if no project is active.
pub async fn system_start(State(s): State<AppState>) -> StatusCode {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE,
    };
    let project = match sws_core::Project::load(&project_dir) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("system_start: project load failed: {e:#}");
            return StatusCode::INTERNAL_SERVER_ERROR;
        }
    };
    s.supervisor.reload(project.sources).await;
    if !project.global_scripts.is_empty() {
        let sc = GlobalScriptSupervisor::start(
            project.global_scripts,
            s.db.clone(),
            s.bus.clone(),
        );
        *s.script_supervisor.write().await = Some(sc);
    }
    if let Some(notif) = project.notifications {
        let ns = crate::notifications::NotificationSupervisor::start(s.alarms.clone(), notif);
        *s.notification_supervisor.write().await = Some(ns);
    }
    tracing::info!("runtime acquisition started by operator");
    StatusCode::NO_CONTENT
}

/// `POST /api/system/reboot` — gracefully replaces the current process with a
/// fresh instance of the same binary and args (Unix `exec`). All WebSocket
/// clients disconnect and reconnect after the new instance is up (~1-2s).
///
/// Before exec, persists the current project path to `{projects_root}/.last-opened`
/// so the new instance can auto-reopen the same project (handled in main.rs).
pub async fn system_reboot(State(s): State<AppState>) -> StatusCode {
    // Snapshot state before the async block moves ownership.
    let projects_root = (*s.projects_root).clone();
    let project_dir   = s.project_dir.read().await.clone();

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;

        // Persist the currently-open project so the fresh process can reopen it.
        if let Some(dir) = &project_dir {
            let marker = projects_root.join(".last-opened");
            if let Err(e) = std::fs::write(&marker, dir.to_string_lossy().as_bytes()) {
                tracing::warn!("reboot: could not write .last-opened: {e}");
            }
        }

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let exe = match std::env::current_exe() {
                Ok(e) => e,
                Err(e) => {
                    tracing::error!("reboot: current_exe: {e}");
                    std::process::exit(1);
                }
            };
            let args: Vec<_> = std::env::args_os().skip(1).collect();
            let err = std::process::Command::new(&exe).args(&args).exec();
            tracing::error!("reboot: exec failed: {err}");
        }
        std::process::exit(0);
    });
    tracing::info!("runtime reboot requested");
    StatusCode::NO_CONTENT
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use sws_core::{AlarmCondition, AlarmDb, AlarmDef, AlarmSeverity, TagDb, TagQuality, TagState, TagValue};
    use sws_core::TagWriteBus;

    fn make_supervisor() -> std::sync::Arc<crate::source_supervisor::SourceSupervisor> {
        let db = std::sync::Arc::new(TagDb::new(64));
        let bus = TagWriteBus::new(64);
        crate::source_supervisor::SourceSupervisor::new(db, bus)
    }

    #[tokio::test]
    async fn compute_system_status_reflects_inputs() {
        let db = TagDb::new(64);
        db.set("t1".into(), TagValue::Float(1.0), TagQuality::Good).await;
        db.set("t2".into(), TagValue::Float(2.0), TagQuality::Good).await;
        db.set("t3".into(), TagValue::Bool(true), TagQuality::Good).await;

        let alarms = AlarmDb::new(64);
        alarms.load(vec![]).await;

        let supervisor = make_supervisor();
        let started = Instant::now() - std::time::Duration::from_secs(5);
        let project_path = PathBuf::from("/tmp/demo-project");

        let status = compute_system_status(&db, &alarms, &supervisor, Some(&project_path), started).await;

        assert_eq!(status.tag_count, 3);
        assert_eq!(status.active_project.as_deref(), Some("demo-project"));
        assert!(status.uptime_s >= 5);
        assert!(!status.runtime_version.is_empty());
        assert!(status.mem_total_mb > 0);
        assert_eq!(status.source_count, 0);
        assert!(!status.sources_running);
    }

    #[tokio::test]
    async fn compute_system_status_no_project_is_none() {
        let db = TagDb::new(64);
        let alarms = AlarmDb::new(64);
        alarms.load(vec![]).await;
        let supervisor = make_supervisor();
        let status = compute_system_status(&db, &alarms, &supervisor, None, Instant::now()).await;
        assert!(status.active_project.is_none());
        assert_eq!(status.tag_count, 0);
        assert_eq!(status.alarm_active_count, 0);
    }

    #[tokio::test]
    async fn alarm_active_count_includes_only_active() {
        let db = TagDb::new(64);
        db.set("temp".into(), TagValue::Float(100.0), TagQuality::Good).await;

        let alarms = AlarmDb::new(64);
        alarms.load(vec![AlarmDef {
            id: "hi".into(),
            tag: "temp".into(),
            condition: AlarmCondition::Above { threshold: 50.0 },
            severity: AlarmSeverity::Warning,
            message: "too hot".into(),
            notify_url: None,
        }]).await;

        let state = TagState {
            value: TagValue::Float(100.0),
            quality: TagQuality::Good,
            timestamp_ms: 0,
        };
        alarms.evaluate("temp", &state).await;

        let supervisor = make_supervisor();
        let status = compute_system_status(&db, &alarms, &supervisor, None, Instant::now()).await;
        assert_eq!(status.alarm_active_count, 1);
    }
}
