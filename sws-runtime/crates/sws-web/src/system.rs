use std::path::Path;
use std::time::Instant;

use axum::{extract::State, Json};
use serde::Serialize;
use sws_core::{AlarmDb, TagDb};
use sysinfo::{Disks, System};

use crate::router::AppState;

#[derive(Serialize, Debug, PartialEq)]
pub struct SystemStatus {
    pub runtime_version: String,
    pub uptime_s: u64,
    pub active_project: Option<String>,
    pub tag_count: usize,
    pub source_count: usize,
    pub alarm_active_count: usize,
    pub historian_samples: u64,
    pub cpu_usage_pct: f32,
    pub mem_used_mb: u64,
    pub mem_total_mb: u64,
    pub disk_used_gb: u64,
    pub disk_total_gb: u64,
}

/// Pure helper that builds a [`SystemStatus`] from the few pieces of state
/// the handler actually needs. Split out from `get_system_status` so unit
/// tests can call it without spinning up a full `AppState` (which would
/// require PyO3 + Python on the test host).
pub async fn compute_system_status(
    db: &TagDb,
    alarms: &AlarmDb,
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

    SystemStatus {
        runtime_version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_s: started_at.elapsed().as_secs(),
        active_project,
        tag_count,
        source_count: 0,
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
        dir_guard.as_deref(),
        state.started_at,
    ).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use sws_core::{AlarmCondition, AlarmDb, AlarmDef, AlarmSeverity, TagDb, TagQuality, TagState, TagValue};

    /// Confirms the helper reflects the inputs it was given: tag count
    /// matches the seeded DB, active project is the directory's basename,
    /// uptime is non-zero, and version comes from the crate metadata.
    #[tokio::test]
    async fn compute_system_status_reflects_inputs() {
        let db = TagDb::new(64);
        db.set("t1".into(), TagValue::Float(1.0), TagQuality::Good).await;
        db.set("t2".into(), TagValue::Float(2.0), TagQuality::Good).await;
        db.set("t3".into(), TagValue::Bool(true), TagQuality::Good).await;

        let alarms = AlarmDb::new(64);
        alarms.load(vec![]).await;

        let started = Instant::now() - std::time::Duration::from_secs(5);
        let project_path = PathBuf::from("/tmp/demo-project");

        let status = compute_system_status(&db, &alarms, Some(&project_path), started).await;

        assert_eq!(status.tag_count, 3);
        assert_eq!(status.active_project.as_deref(), Some("demo-project"));
        assert!(status.uptime_s >= 5);
        assert!(!status.runtime_version.is_empty());
        // Memory total is platform-dependent; we only assert it's populated.
        assert!(status.mem_total_mb > 0);
    }

    #[tokio::test]
    async fn compute_system_status_no_project_is_none() {
        let db = TagDb::new(64);
        let alarms = AlarmDb::new(64);
        alarms.load(vec![]).await;
        let status = compute_system_status(&db, &alarms, None, Instant::now()).await;
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

        // Trigger evaluation: AlarmDb only flips active on evaluate().
        let state = TagState {
            value: TagValue::Float(100.0),
            quality: TagQuality::Good,
            timestamp_ms: 0,
        };
        alarms.evaluate("temp", &state).await;

        let status = compute_system_status(&db, &alarms, None, Instant::now()).await;
        assert_eq!(status.alarm_active_count, 1);
    }
}
