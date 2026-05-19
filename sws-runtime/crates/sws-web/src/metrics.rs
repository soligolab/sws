//! Prometheus metrics for SWS.
//!
//! Installs a process-global `PrometheusHandle` on first call to
//! [`install_recorder`]; the `/metrics` handler renders it on demand. Live
//! gauges (CPU, memory, uptime, tag/alarm counts) are sampled at scrape
//! time so they always reflect the moment Prometheus pulled them — no
//! background tickers required for the PoC.
//!
//! Exposition format follows the Prometheus text 0.0.4 spec, which is
//! what `metrics-exporter-prometheus` produces by default.

use std::sync::OnceLock;

use axum::{extract::State, http::header, response::IntoResponse};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use sysinfo::{Disks, System};

use crate::router::AppState;

static HANDLE: OnceLock<PrometheusHandle> = OnceLock::new();

/// Install the Prometheus recorder as the global `metrics` recorder.
/// Idempotent: subsequent calls return the previously-installed handle
/// without re-installing (the underlying recorder install would panic
/// on the second call, so we gate on `OnceLock`).
pub fn install_recorder() -> &'static PrometheusHandle {
    HANDLE.get_or_init(|| {
        PrometheusBuilder::new()
            .install_recorder()
            .expect("install prometheus recorder")
    })
}

/// `GET /metrics` — Prometheus text exposition format.
pub async fn get_metrics(State(state): State<AppState>) -> impl IntoResponse {
    // Sample fresh values per scrape. The cost (a sysinfo refresh plus two
    // store snapshots) is well under the cost of a typical Prometheus
    // scrape interval (15-60 s), and avoids running a background ticker
    // that would emit metrics nobody scrapes.
    let mut sys = System::new_all();
    sys.refresh_all();
    let disks = Disks::new_with_refreshed_list();
    let disk = disks.list().first();

    let tag_count = state.db.snapshot().await.len() as f64;
    let alarms = state.alarms.snapshot().await;
    let alarm_active = alarms.iter().filter(|a| a.active).count() as f64;
    let alarm_total = alarms.len() as f64;

    // Emit gauges via the global recorder — these calls become numbers in
    // the rendered output below.
    metrics::gauge!("sws_uptime_seconds")
        .set(state.started_at.elapsed().as_secs_f64());
    metrics::gauge!("sws_tag_count").set(tag_count);
    metrics::gauge!("sws_alarm_active_count").set(alarm_active);
    metrics::gauge!("sws_alarm_total").set(alarm_total);
    metrics::gauge!("sws_cpu_usage_pct")
        .set(sys.global_cpu_info().cpu_usage() as f64);
    metrics::gauge!("sws_memory_used_bytes")
        .set(sys.used_memory() as f64);
    metrics::gauge!("sws_memory_total_bytes")
        .set(sys.total_memory() as f64);
    if let Some(d) = disk {
        metrics::gauge!("sws_disk_used_bytes")
            .set((d.total_space() - d.available_space()) as f64);
        metrics::gauge!("sws_disk_total_bytes")
            .set(d.total_space() as f64);
    }

    let handle = install_recorder();
    let body = handle.render();
    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
        body,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// install_recorder must be idempotent. The underlying `set_global_recorder`
    /// panics if called twice, so the OnceLock guard is the only thing keeping
    /// repeated calls — common in tests that spin up multiple routers — safe.
    #[test]
    fn install_recorder_is_idempotent() {
        let h1 = install_recorder() as *const PrometheusHandle;
        let h2 = install_recorder() as *const PrometheusHandle;
        assert_eq!(h1, h2);
    }

    /// After emitting a value the rendered exposition should mention the
    /// metric name. We don't assert on the exact format (the exporter owns
    /// that) — just that our key appears.
    #[test]
    fn render_includes_emitted_gauges() {
        let handle = install_recorder();
        metrics::gauge!("sws_test_render_gauge").set(42.0);
        let out = handle.render();
        assert!(out.contains("sws_test_render_gauge"), "missing key: {out}");
    }
}
