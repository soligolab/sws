use axum::{extract::State, Json};
use serde::Serialize;
use sysinfo::{Disks, System};

use crate::router::AppState;

#[derive(Serialize)]
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

pub async fn get_system_status(State(state): State<AppState>) -> Json<SystemStatus> {
    let mut sys = System::new_all();
    sys.refresh_all();
    let disks = Disks::new_with_refreshed_list();
    let disk = disks.list().first();

    let active_project = state.project_dir.read().await
        .as_ref()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned());

    let alarms = state.alarms.snapshot().await;
    let alarm_active_count = alarms.iter().filter(|a| a.active).count();

    let tags = state.db.snapshot().await;
    let tag_count = tags.len();

    Json(SystemStatus {
        runtime_version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_s: state.started_at.elapsed().as_secs(),
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
    })
}
