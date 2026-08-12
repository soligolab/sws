use std::net::IpAddr;
use std::path::Path;
use std::time::Instant;

use axum::{extract::State, http::StatusCode, response::{IntoResponse, Response}, Json};
use rcgen::{CertificateParams, KeyPair, SanType};
use serde::{Deserialize, Serialize};
use sws_core::{AlarmDb, TagDb};
use sysinfo::{Disks, System};

use crate::router::{active_dir, AppState};
use crate::source_supervisor::SourceSupervisor;

#[derive(Serialize, Debug, PartialEq)]
pub struct SystemStatus {
    pub runtime_version: String,
    pub uptime_s: u64,
    pub active_project: Option<String>,
    /// Runtime version that last saved the active project's `project.yaml`
    /// (`None` if no project is open or the file predates version stamping).
    pub project_saved_by: Option<String>,
    /// True when the active project was saved by a different runtime version
    /// and the IDE should offer to re-save it in the current format.
    pub project_needs_update: bool,
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

    // Version-drift detection: read the on-disk project to compare the runtime
    // that saved it against this build. Cheap (a small YAML file) and only when
    // a project is open.
    let (project_saved_by, project_needs_update) = match project_dir
        .and_then(|p| sws_core::Project::load(p).ok())
    {
        Some(p) => (p.saved_by.clone(), p.needs_update()),
        None => (None, false),
    };

    let alarms_snap = alarms.snapshot().await;
    let alarm_active_count = alarms_snap.iter().filter(|a| a.active).count();

    let tags = db.snapshot().await;
    let tag_count = tags.len();
    let source_count = supervisor.running_count().await;

    SystemStatus {
        runtime_version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_s: started_at.elapsed().as_secs(),
        active_project,
        project_saved_by,
        project_needs_update,
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

/// `POST /api/project/migrate` — re-save the active project in the current
/// runtime's on-disk format, stamping this build's version. Reloading the
/// project through the tolerant deserializer and writing it back normalizes
/// the file and clears the IDE's "needs update" warning. 409 if no project
/// is open.
pub async fn migrate_project(State(s): State<AppState>) -> Response {
    let project_dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(_) => return (StatusCode::CONFLICT, "no active project").into_response(),
    };
    let mut project = match sws_core::Project::load(&project_dir) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("migrate_project: load failed: {e:#}");
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("load failed: {e}")).into_response();
        }
    };
    if let Err(e) = project.save_to(&project_dir) {
        tracing::warn!("migrate_project: save failed: {e:#}");
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("save failed: {e}")).into_response();
    }
    tracing::info!(
        version = sws_core::project::runtime_version(),
        "project re-saved to current runtime version"
    );
    StatusCode::NO_CONTENT.into_response()
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
    crate::telegram::stop_sender(&s).await;
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
    let mut project = match sws_core::Project::load(&project_dir) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("system_start: project load failed: {e:#}");
            return StatusCode::INTERNAL_SERVER_ERROR;
        }
    };
    crate::projects::resolve_mqtt_client_ids(&project.meta.name, &mut project.sources, &s.config_dir, &s.instance_id);
    s.supervisor.reload(project.sources).await;
    crate::projects::start_project_services(&s, project.notifications, project.global_scripts).await;
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

// ── TLS management endpoints ─────────────────────────────────────────────────

#[derive(Serialize)]
pub struct TlsStatus {
    pub enabled: bool,
}

/// `GET /api/system/tls` — returns whether TLS is currently active.
pub async fn get_tls_status(State(s): State<AppState>) -> Json<TlsStatus> {
    let enabled = s.config_dir.join("tls.crt").exists();
    Json(TlsStatus { enabled })
}

/// `POST /api/system/tls/generate` — generate a self-signed cert, write to config dir,
/// then reboot so the new TLS config takes effect.
pub async fn generate_tls_cert(State(s): State<AppState>) -> StatusCode {
    let config_dir = (*s.config_dir).clone();
    match tokio::task::spawn_blocking(move || generate_cert_files(&config_dir)).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            tracing::error!("generate_tls_cert: {e:#}");
            return StatusCode::INTERNAL_SERVER_ERROR;
        }
        Err(e) => {
            tracing::error!("generate_tls_cert: join error: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR;
        }
    }
    tracing::info!("TLS certificate generated — rebooting to activate HTTPS");
    system_reboot(State(s)).await
}

/// `DELETE /api/system/tls` — remove the TLS cert files and reboot into plain HTTP.
pub async fn remove_tls_cert(State(s): State<AppState>) -> StatusCode {
    let cert_path = s.config_dir.join("tls.crt");
    let key_path  = s.config_dir.join("tls.key");
    for path in [&cert_path, &key_path] {
        if path.exists() {
            if let Err(e) = tokio::fs::remove_file(path).await {
                tracing::error!("remove_tls_cert: could not remove {}: {e}", path.display());
                return StatusCode::INTERNAL_SERVER_ERROR;
            }
        }
    }
    tracing::info!("TLS certificate removed — rebooting to plain HTTP");
    system_reboot(State(s)).await
}

#[derive(Deserialize)]
pub struct TlsUpload {
    pub cert_pem: String,
    pub key_pem: String,
}

/// `PUT /api/system/tls` — upload a user-provided certificate + private key (PEM),
/// validate that they parse and match, write them to the config dir, then reboot
/// so the new cert takes effect (HTTPS). Rejects invalid input before writing so
/// the user gets immediate feedback instead of a silent self-signed regeneration.
pub async fn upload_tls_cert(State(s): State<AppState>, Json(body): Json<TlsUpload>) -> Response {
    if let Err(e) = validate_cert_key(&body.cert_pem, &body.key_pem) {
        tracing::warn!("upload_tls_cert: invalid cert/key: {e:#}");
        return (
            StatusCode::BAD_REQUEST,
            format!("Certificato/chiave non validi: {e}"),
        )
            .into_response();
    }

    let config_dir = (*s.config_dir).clone();
    let cert = body.cert_pem;
    let key = body.key_pem;
    let write = tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        use anyhow::Context;
        std::fs::create_dir_all(&config_dir).context("creating config directory")?;
        std::fs::write(config_dir.join("tls.crt"), cert.as_bytes()).context("writing tls.crt")?;
        std::fs::write(config_dir.join("tls.key"), key.as_bytes()).context("writing tls.key")?;
        Ok(())
    })
    .await;
    match write {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            tracing::error!("upload_tls_cert: write failed: {e:#}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        Err(e) => {
            tracing::error!("upload_tls_cert: join error: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }
    tracing::info!("TLS certificate uploaded — rebooting to activate HTTPS");
    system_reboot(State(s)).await.into_response()
}

/// Parse a PEM cert chain + private key and confirm they form a valid TLS
/// keypair (mirrors the runtime's startup loader). `with_single_cert` also
/// catches a key that does not match the certificate.
fn validate_cert_key(cert_pem: &str, key_pem: &str) -> anyhow::Result<()> {
    use anyhow::Context;
    let certs: Vec<rustls::pki_types::CertificateDer<'static>> =
        rustls_pemfile::certs(&mut cert_pem.as_bytes())
            .collect::<Result<_, _>>()
            .context("parsing certificate PEM")?;
    anyhow::ensure!(!certs.is_empty(), "nessun certificato trovato nel PEM");
    let key = rustls_pemfile::private_key(&mut key_pem.as_bytes())
        .context("parsing private key PEM")?
        .ok_or_else(|| anyhow::anyhow!("nessuna chiave privata trovata nel PEM"))?;
    rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .context("la chiave privata non corrisponde al certificato")?;
    Ok(())
}

fn generate_cert_files(config_dir: &std::path::Path) -> anyhow::Result<()> {
    use anyhow::Context;

    std::fs::create_dir_all(config_dir).context("creating config directory")?;

    // Detect LAN IP via connected UDP socket (no packets sent).
    let lan_ip: Option<IpAddr> = (|| {
        let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
        sock.connect("8.8.8.8:80").ok()?;
        sock.local_addr().ok().map(|a| a.ip())
    })();

    let mut params = CertificateParams::new(vec!["localhost".to_string()])
        .context("rcgen: CertificateParams::new")?;
    params.subject_alt_names.push(SanType::IpAddress(
        std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
    ));
    if let Some(ip) = lan_ip {
        params.subject_alt_names.push(SanType::IpAddress(ip));
        tracing::info!(%ip, "TLS cert will include LAN IP SAN");
    }

    let key_pair = KeyPair::generate().context("rcgen: KeyPair::generate")?;
    let cert = params.self_signed(&key_pair).context("rcgen: self_signed")?;

    std::fs::write(config_dir.join("tls.crt"), cert.pem()).context("writing tls.crt")?;
    std::fs::write(config_dir.join("tls.key"), key_pair.serialize_pem()).context("writing tls.key")?;
    tracing::info!(path = %config_dir.display(), "self-signed TLS certificate saved");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use sws_core::{AlarmCondition, AlarmDb, AlarmDef, AlarmSeverity, TagDb, TagQuality, TagState, TagValue};
    use sws_core::TagWriteBus;

    fn make_supervisor() -> std::sync::Arc<crate::source_supervisor::SourceSupervisor> {
        let db = std::sync::Arc::new(TagDb::new(64));
        let bus = std::sync::Arc::new(TagWriteBus::new());
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
            dead_band: None,
            on_delay_s: None,
            off_delay_s: None,
            inhibit_tag: None,
            inhibit_condition: None,
            notify_email: None,
            escalate_after_s: None,
            escalate_to: None,
            telegram_mode: None,
            telegram_chat_ids: None,
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

    /// Generate a fresh self-signed cert+key PEM pair for validation tests.
    /// Also installs the ring CryptoProvider (the runtime does this in `main()`;
    /// the test process must do it before `ServerConfig::builder()` is used).
    fn make_cert_key() -> (String, String) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let key = KeyPair::generate().unwrap();
        let params = CertificateParams::new(vec!["localhost".to_string()]).unwrap();
        let cert = params.self_signed(&key).unwrap();
        (cert.pem(), key.serialize_pem())
    }

    #[test]
    fn validate_cert_key_accepts_matching_pair() {
        let (cert, key) = make_cert_key();
        assert!(validate_cert_key(&cert, &key).is_ok());
    }

    #[test]
    fn validate_cert_key_rejects_garbage() {
        assert!(validate_cert_key("not a cert", "not a key").is_err());
        let (cert, _) = make_cert_key();
        assert!(validate_cert_key(&cert, "").is_err(), "missing key must fail");
    }

    #[test]
    fn validate_cert_key_rejects_mismatched_key() {
        let (cert, _) = make_cert_key();
        let (_, other_key) = make_cert_key();
        // A valid cert and a valid key, but from different keypairs → must be rejected.
        assert!(validate_cert_key(&cert, &other_key).is_err());
    }
}
