use axum::{response::IntoResponse, Json};
use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Serialize)]
pub struct DiscoveredRuntime {
    name: String,
    admin_url: String,
    viewer_url: String,
    version: Option<String>,
}

/// GET /api/discover — browse mDNS for _sws._tcp.local. services for ~2 s.
/// Returns an array of runtimes found on the LAN.
pub async fn discover_runtimes() -> impl IntoResponse {
    let runtimes = tokio::task::spawn_blocking(|| browse_mdns_blocking(2))
        .await
        .unwrap_or_default();
    Json(runtimes)
}

fn browse_mdns_blocking(timeout_secs: u64) -> Vec<DiscoveredRuntime> {
    use mdns_sd::{ServiceDaemon, ServiceEvent};

    let daemon = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(_) => return vec![],
    };

    let receiver = match daemon.browse("_sws._tcp.local.") {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let mut runtimes = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match receiver.recv_timeout(remaining) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let viewer_port = info.get_port();
                let admin_port: u16 = info
                    .get_property_val_str("admin_port")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(8444);
                let version = info.get_property_val_str("version").map(str::to_string);

                let ip = info
                    .get_addresses_v4()
                    .into_iter()
                    .next()
                    .map(|a| a.to_string())
                    .or_else(|| info.get_addresses().iter().next().map(|a| a.to_string()));

                if let Some(ip) = ip {
                    runtimes.push(DiscoveredRuntime {
                        name: info.get_fullname().to_string(),
                        admin_url: format!("https://{}:{}", ip, admin_port),
                        viewer_url: format!("https://{}:{}", ip, viewer_port),
                        version,
                    });
                }
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }

    let _ = daemon.shutdown();
    runtimes
}
