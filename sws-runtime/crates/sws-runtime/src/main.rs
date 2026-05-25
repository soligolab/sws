// TODO: load project, start tag engine, connect comm plugins.

mod log_file;
mod log_layer;

use anyhow::Context;
use clap::Parser;
use hyper::body::Incoming;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto::Builder as ConnBuilder;
use rcgen::generate_simple_self_signed;
use std::{net::{IpAddr, SocketAddr}, path::PathBuf, sync::Arc};
use sws_auth::{AuthState, Role};
use sws_core::{AlarmDb, LogBus, TagDb, TagQuality, TagWriteBus, DEFAULT_LOG_CAPACITY};
use sws_historian::{sqlite::SqliteStore, DatastoreRegistry, Historian};
use sws_pyscript::Engine as PyEngine;
use sws_web::{router::DerivedTagsRegistry, SourceSupervisor};
use tokio::net::TcpListener;
use tokio_rustls::{
    rustls::{
        pki_types::{CertificateDer, PrivateKeyDer},
        ServerConfig,
    },
    TlsAcceptor,
};
use tower::Service;
use tracing::{debug, info, warn};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::log_layer::LogBusLayer;

#[derive(Parser, Debug)]
#[command(name = "sws-runtime", about = "Soligo Web SCADA runtime")]
struct Args {
    /// Runtime config directory (TLS certificates stored here)
    #[arg(long, default_value = "/var/sws/config")]
    config: PathBuf,

    /// Root directory containing all projects (one subfolder per project).
    /// The editor's WelcomeScreen lists subfolders of this path; create /
    /// open / close operate inside it.
    #[arg(long, default_value = "/var/sws/projects")]
    projects_root: PathBuf,

    /// Root directory containing bundled project templates (one subfolder
    /// per template, each with `template.yaml` + project files).
    /// Used by `GET /api/templates` and copied into new projects when the
    /// user picks a template in the WelcomeScreen.
    #[arg(long, default_value = "/var/sws/templates")]
    templates_root: PathBuf,

    /// Legacy single-project flag. When set, the runtime auto-opens this
    /// project at boot (backwards compat for dev.sh and operator containers).
    /// When unset, the runtime starts with no active project — the
    /// WelcomeScreen lists candidates from `--projects-root`.
    #[arg(long)]
    project: Option<PathBuf>,

    /// Directory where rotating JSONL log files are written.
    /// Defaults to `<projects_root>/logs`.
    #[arg(long)]
    logs: Option<PathBuf>,

    /// When set, the runtime also serves a static SPA bundle from this
    /// directory at the root path. Used for the single-binary deployment
    /// where the runtime container ships the editor's `dist/` and no
    /// separate Nginx container is needed.
    #[arg(long)]
    www: Option<PathBuf>,

    /// Shell command to spawn once the HTTPS listener answers `/health` OK.
    /// Used for kiosk-mode deployments on PX30 / RK3399: the runtime starts
    /// the browser itself, no operator login required.
    ///
    /// Typical value: `chromium --kiosk --no-sandbox --app=https://localhost:8443`
    /// or `epiphany-browser --application-mode https://localhost:8443`.
    ///
    /// The child process is launched fire-and-forget: it is not monitored,
    /// restarted, or killed by the runtime. If the browser dies, the runtime
    /// keeps running. Stdout/stderr of the child inherit from the runtime's
    /// stdio (visible in journald / podman logs).
    #[arg(long)]
    kiosk_browser: Option<String>,

    /// Spawn sws-kiosk (WebKitGTK native window) once /health answers OK.
    /// Alternative to --kiosk-browser for devices without a full browser
    /// installed (Wayland compositor required, no desktop environment needed).
    /// The sws-kiosk binary must be in the same directory as sws-runtime.
    #[arg(long)]
    kiosk_wayland: bool,

    /// Take an automatic backup every N minutes. 0 (default) disables the
    /// loop. Backups go under `<project>/.bak/<UTC-timestamp>/` and cover
    /// `project.yaml`, `synoptics/`, and `users.yaml`. Triggered via the
    /// `/api/backups` POST endpoint on demand regardless of this setting.
    #[arg(long, default_value_t = 0u64)]
    auto_backup_interval_minutes: u64,

    /// Keep at most this many auto-backups; older ones are pruned after
    /// each tick. Manual backups created via the API are also subject to
    /// this cap. 0 disables pruning (keep everything — careful on small
    /// disks).
    #[arg(long, default_value_t = 20u64)]
    auto_backup_retention: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Rustls 0.23 panics if multiple crypto providers end up in the dep graph
    // (e.g., `ring` via rcgen + `aws-lc-rs` via hyper-rustls/reqwest) without
    // an explicit call here.  `.ok()` silently accepts "already installed" in
    // case any upstream crate calls this first.
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();

    let args = Args::parse();

    // LogBus is built first so the tracing subscriber can hold an Arc clone.
    // Anything emitted by tracing from here on is captured in-memory in addition
    // to the JSON-to-stdout fmt layer.
    let log_bus = Arc::new(LogBus::new(DEFAULT_LOG_CAPACITY));

    // `from_default_env()` with RUST_LOG unset yields an empty filter that
    // rejects every event — that silently disabled the log panel until now.
    // Fall back to INFO so dev.sh and the container both produce logs out
    // of the box; power users still override with RUST_LOG=debug etc.
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().json())
        .with(LogBusLayer::new(log_bus.clone()))
        .init();

    // Mirror every captured event onto disk as JSONL, rotated by date.
    // Independent of the stdout fmt layer so the file survives orchestrator
    // log-capture quirks (podman/journald wrap policies). Errors inside the
    // writer go to stderr to avoid feedback loops via tracing → LogBus.
    let logs_dir = args.logs.clone().unwrap_or_else(|| {
        args.projects_root.join("logs")
    });
    let retention_days = std::env::var("SWS_LOG_RETENTION_DAYS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(7u32);
    log_file::spawn_file_writer(log_bus.clone(), logs_dir.clone(), retention_days);

    info!(
        version        = env!("CARGO_PKG_VERSION"),
        config         = %args.config.display(),
        projects_root  = %args.projects_root.display(),
        templates_root = %args.templates_root.display(),
        project        = ?args.project.as_ref().map(|p| p.display().to_string()),
        logs           = %logs_dir.display(),
        retention      = retention_days,
        www            = ?args.www.as_ref().map(|p| p.display().to_string()),
        "SWS runtime starting"
    );

    let acceptor = build_tls_acceptor(&args.config)?;

    let tag_db    = Arc::new(TagDb::new(256));
    let bus       = Arc::new(TagWriteBus::new());
    let alarm_db  = Arc::new(AlarmDb::new(64));
    // 5_000 samples × ~100 tags ≈ a few MB. Adjust per-tag cap when we learn
    // realistic project sizes — for now this is the PoC sizing.
    // SQLite persistence is opt-in via SWS_HISTORIAN_DB. If unset, the
    // historian is RAM-only (current PoC default).
    let historian = match std::env::var("SWS_HISTORIAN_DB").ok() {
        Some(path) if !path.is_empty() => match SqliteStore::open(&path).await {
            Ok(store) => match Historian::with_sqlite(5_000, store).await {
                Ok(h) => Arc::new(h),
                Err(e) => {
                    warn!("historian: SQLite restore failed ({e}), starting empty");
                    Arc::new(Historian::new(5_000))
                }
            },
            Err(e) => {
                warn!("historian: cannot open SQLite at {path} ({e}), falling back to RAM-only");
                Arc::new(Historian::new(5_000))
            }
        },
        _ => Arc::new(Historian::new(5_000)),
    };
    let py_engine = PyEngine::new(tag_db.clone(), bus.clone());
    let supervisor = SourceSupervisor::new(tag_db.clone(), bus.clone());
    // Empty registry — populated below from project.yaml (if present).
    let functions: sws_web::router::FunctionsRegistry =
        Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new()));
    let derived_tags: DerivedTagsRegistry =
        Arc::new(tokio::sync::RwLock::new(Vec::new()));

    // Admin credentials must be provided via env. The runtime refuses to
    // start without one — "no default credentials" commitment in
    // docs/CONTEXT.md §6. Supervisor / operator / viewer passwords are
    // optional; missing roles just aren't seeded.
    let admin_user = std::env::var("SWS_ADMIN_USER").unwrap_or_else(|_| "admin".into());
    let admin_pwd  = std::env::var("SWS_ADMIN_PASSWORD")
        .context("SWS_ADMIN_PASSWORD is required on first start (no default password)")?;
    let mut accounts: Vec<(String, Role, String)> = vec![
        (admin_user, Role::Admin, admin_pwd),
    ];
    if let Ok(pwd) = std::env::var("SWS_SUPERVISOR_PASSWORD") {
        let user = std::env::var("SWS_SUPERVISOR_USER").unwrap_or_else(|_| "supervisor".into());
        accounts.push((user, Role::Supervisor, pwd));
    }
    if let Ok(pwd) = std::env::var("SWS_OPERATOR_PASSWORD") {
        let user = std::env::var("SWS_OPERATOR_USER").unwrap_or_else(|_| "operator".into());
        accounts.push((user, Role::Operator, pwd));
    }
    if let Ok(pwd) = std::env::var("SWS_VIEWER_PASSWORD") {
        let user = std::env::var("SWS_VIEWER_USER").unwrap_or_else(|_| "viewer".into());
        accounts.push((user, Role::Viewer, pwd));
    }
    let ttl_secs    = std::env::var("SWS_SESSION_TTL_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(8 * 3600);
    let rate_limit  = std::env::var("SWS_LOGIN_RATE_LIMIT").ok().and_then(|s| s.parse().ok()).unwrap_or(5);
    let rate_window = std::env::var("SWS_LOGIN_RATE_WINDOW_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(60);
    let ttl = std::time::Duration::from_secs(ttl_secs);
    let rate_window_dur = std::time::Duration::from_secs(rate_window);

    // Active project handle — None until the user opens one (or until
    // --project auto-opens below for legacy single-project deploys).
    let active_dir: sws_web::router::ActiveProjectDir =
        Arc::new(tokio::sync::RwLock::new(None));

    // Datastore registry: built from project.datastores when a project is
    // known at startup. None = legacy historian-only mode.
    let mut registry: Option<Arc<DatastoreRegistry>> = None;

    // Auth state: empty until a project is opened. When --project is set,
    // we swap to its users.yaml; otherwise the WelcomeScreen does it via
    // POST /api/projects/:name/open later.
    let auth = AuthState::empty(ttl, rate_limit, rate_window_dur);

    if let Some(project_path) = args.project.clone() {
        // Legacy auto-open path: bootstrap exactly as the single-project
        // runtime did, then mark this dir as active.
        supervisor.set_pki_root(project_path.join(".opcua-pki")).await;
        match sws_core::project::Project::load(&project_path) {
            Ok(project) => {
                info!(
                    name = %project.meta.name,
                    tags = project.tags.len(),
                    alarms = project.alarms.len(),
                    functions = project.functions.len(),
                    "project loaded (legacy --project auto-open)",
                );
                // Seed derived tags before populate_tags so they start Uncertain.
                {
                    let mut derived = derived_tags.write().await;
                    for t in &project.tags {
                        if let Some(expr) = &t.expression {
                            derived.push((t.id.clone(), expr.clone()));
                        }
                    }
                }
                project.populate_tags(&tag_db).await;
                // Build datastore registry while project is still whole (before
                // field moves below).
                match DatastoreRegistry::from_project(&project, &project_path).await {
                    Ok(Some(reg)) => {
                        info!(
                            backends = reg.backend_ids().len(),
                            "datastore registry initialized"
                        );
                        registry = Some(reg);
                    }
                    Ok(None) => {} // no datastores configured, keep historian-only mode
                    Err(e) => warn!("datastore registry init failed: {e:#}"),
                }
                alarm_db.load(project.alarms).await;
                supervisor.reload(project.sources).await;
                // Seed the function registry. Duplicates from project.yaml
                // are silently last-wins; PUT /api/project/functions
                // enforces unique names from then on.
                {
                    let mut map = functions.write().await;
                    for f in project.functions {
                        map.insert(f.name.clone(), f);
                    }
                }
            }
            Err(e) => {
                warn!("project.yaml not found or invalid — starting with empty tag database: {e:#}");
            }
        }
        // Swap auth to point at this project's users.yaml, seeded from env.
        if let Err(e) = auth.swap_store(project_path.join("users.yaml"), accounts).await {
            anyhow::bail!("failed to bootstrap auth from --project: {e}");
        }
        *active_dir.write().await = Some(project_path);
    } else {
        info!("no --project specified — starting with no active project (WelcomeScreen will list /api/projects)");
    }

    // Auto-backup loop. Skipped entirely when --auto-backup-interval-minutes
    // is 0 (the default). Runs on a fixed interval, take a snapshot of the
    // currently-active project (if any), then prune old snapshots beyond the
    // retention cap. Errors are logged but the loop continues.
    if args.auto_backup_interval_minutes > 0 {
        let dir_handle = active_dir.clone();
        let interval_min = args.auto_backup_interval_minutes;
        let retention = args.auto_backup_retention as usize;
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(
                std::time::Duration::from_secs(interval_min * 60),
            );
            // First tick fires immediately; skip it so we don't snapshot the
            // moment the process starts (before the user has done any work).
            tick.tick().await;
            loop {
                tick.tick().await;
                let dir_opt = dir_handle.read().await.clone();
                let Some(dir) = dir_opt else { continue }; // no project open
                let dir2 = dir.clone();
                let result = tokio::task::spawn_blocking(move || {
                    sws_web::backups::backup_now(&dir2)
                }).await;
                match result {
                    Ok(Ok(path)) => {
                        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string();
                        info!(backup = %name, "auto-backup created");
                        if retention > 0 {
                            let dir3 = dir.clone();
                            let _ = tokio::task::spawn_blocking(move || {
                                sws_web::backups::prune_backups(&dir3, retention);
                            }).await;
                        }
                    }
                    Ok(Err(e)) => warn!("auto-backup failed: {e}"),
                    Err(e) => warn!("auto-backup task panicked: {e}"),
                }
            }
        });
        info!(
            interval_min  = args.auto_backup_interval_minutes,
            retention     = args.auto_backup_retention,
            "auto-backup loop started",
        );
    }

    // Alarm evaluator: every TagDb update is fed to AlarmDb, which re-evaluates
    // the alarms watching that tag and broadcasts any transitions.
    {
        let adb = alarm_db.clone();
        let mut tag_rx = tag_db.subscribe();
        tokio::spawn(async move {
            loop {
                match tag_rx.recv().await {
                    Ok(update) => adb.evaluate(&update.id, &update.state).await,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        warn!("alarm evaluator lagged by {n}");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    // Derived tag evaluator: on every TagDb update, re-evaluate all expressions
    // whose result may have changed.  Each expression runs in spawn_blocking
    // (PyO3 requires a non-async context) and updates the tag with Good/Bad
    // quality depending on whether the Python eval succeeds.
    //
    // Design notes:
    // - We batch-drain the broadcast channel after the first wake-up so that a
    //   burst of N source updates (e.g. populate_tags) causes only ONE Python
    //   eval round instead of N.
    // - We skip evaluation when every changed tag in the batch is itself a
    //   derived tag.  This breaks the feedback loop: db.set() on a derived tag
    //   emits a broadcast that would otherwise re-trigger evaluation endlessly.
    //   Limitation: a derived tag that reads another derived tag won't chain
    //   automatically — acceptable for the PoC (no current use case).
    {
        let db = tag_db.clone();
        let derived = derived_tags.clone();
        let mut tag_rx = tag_db.subscribe();
        tokio::spawn(async move {
            loop {
                match tag_rx.recv().await {
                    Ok(first) => {
                        // Collect the first changed id, then drain all pending
                        // messages without blocking to collapse bursts.
                        let mut changed: std::collections::HashSet<String> =
                            std::collections::HashSet::new();
                        changed.insert(first.id);
                        loop {
                            match tag_rx.try_recv() {
                                Ok(u)  => { changed.insert(u.id); }
                                Err(_) => break,
                            }
                        }

                        let pairs = derived.read().await.clone();
                        if pairs.is_empty() { continue; }

                        // Skip if every trigger is itself a derived tag — prevents
                        // the db.set() → broadcast → re-eval feedback loop.
                        let derived_ids: std::collections::HashSet<&str> =
                            pairs.iter().map(|(id, _)| id.as_str()).collect();
                        if changed.iter().all(|id| derived_ids.contains(id.as_str())) {
                            continue;
                        }

                        let snapshot: std::collections::HashMap<String, sws_core::TagValue> =
                            db.snapshot().await.into_iter().map(|(k, v)| (k, v.value)).collect();
                        for (id, expr) in pairs {
                            match sws_pyscript::eval_expression(expr, snapshot.clone()).await {
                                Ok(value) => {
                                    db.set(id, value, TagQuality::Good).await;
                                }
                                Err(e) => {
                                    warn!(tag = %id, "derived tag eval error: {e}");
                                    // Keep last good value; just log — don't overwrite with garbage.
                                }
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        // Log at debug: with the feedback-loop guard this should
                        // never happen in normal operation.
                        debug!("derived tag evaluator lagged by {n}");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    // Alarm webhook dispatcher: subscribe to the alarm broadcast; for every
    // transition to ACTIVE fire an HTTP POST to `notify_url` (best-effort).
    {
        let mut alarm_rx = alarm_db.subscribe();
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        tokio::spawn(async move {
            loop {
                match alarm_rx.recv().await {
                    Ok(state) => {
                        // Bump the Prometheus counter on every transition we
                        // observe (active or recovery), labelled by direction
                        // + severity. This is the single broadcast all alarms
                        // flow through, so it's the right spot for the metric.
                        let direction = if state.active { "activated" } else { "recovered" };
                        let severity = format!("{:?}", state.def.severity);
                        metrics::counter!("sws_alarm_transitions_total",
                            "direction" => direction.to_string(),
                            "severity"  => severity,
                        ).increment(1);
                        // Only notify on fresh activation (not ack or recovery).
                        if !state.active { continue; }
                        let Some(url) = &state.def.notify_url else { continue };
                        if url.trim().is_empty() { continue; }
                        let payload = serde_json::json!({
                            "id":       state.def.id,
                            "message":  state.def.message,
                            "severity": format!("{:?}", state.def.severity),
                            "tag":      state.def.tag,
                            "ts_ms":    state.activated_at_ms,
                            "value":    state.last_value,
                        });
                        let url = url.clone();
                        let client = http.clone();
                        tokio::spawn(async move {
                            match client.post(&url).json(&payload).send().await {
                                Ok(r)  => info!(alarm = %payload["id"], status = r.status().as_u16(), "alarm webhook sent"),
                                Err(e) => warn!(alarm = %payload["id"], url, "alarm webhook failed: {e}"),
                            }
                        });
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        warn!("alarm webhook dispatcher lagged by {n}");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    // Historian recorder: append every TagDb update to the per-tag ring buffer.
    historian.clone().spawn_recorder(tag_db.clone());

    // Datastore registry recorder: routes updates to external backends.
    // Runs in addition to the historian (both receive every update).
    if let Some(reg) = &registry {
        reg.clone().spawn_recorder(tag_db.clone());
    }

    // Historian SQLite pruning: run once at startup then every 24 h.
    // Only effective when SWS_HISTORIAN_DB is set (no-op on RAM-only mode).
    {
        let historian_prune = historian.clone();
        let retention_days: u64 = std::env::var("SWS_HISTORIAN_RETENTION_DAYS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);
        tokio::spawn(async move {
            loop {
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                let cutoff_ms = now_ms.saturating_sub(retention_days * 24 * 3600 * 1_000);
                historian_prune.prune_older_than_ms(cutoff_ms).await;
                tokio::time::sleep(std::time::Duration::from_secs(24 * 3600)).await;
            }
        });
    }

    let started_at = std::time::Instant::now();

    // Parse SWS_IP_ALLOWLIST="192.168.1.0/24,10.0.0.0/8".
    // Empty / unset → no restriction (all IPs allowed).
    let ip_allowlist: Arc<Vec<(IpAddr, u8)>> = Arc::new(
        std::env::var("SWS_IP_ALLOWLIST")
            .unwrap_or_default()
            .split(',')
            .filter_map(|entry| {
                let entry = entry.trim();
                if entry.is_empty() { return None; }
                let (addr_str, prefix_str) = if let Some(pos) = entry.find('/') {
                    (&entry[..pos], &entry[pos+1..])
                } else {
                    (entry, "32")
                };
                let addr: IpAddr = addr_str.parse().ok()?;
                let prefix: u8 = prefix_str.parse().ok()?;
                Some((addr, prefix))
            })
            .collect()
    );
    if !ip_allowlist.is_empty() {
        info!(entries = ip_allowlist.len(), "IP allowlist active for /api/auth/login");
    }

    let app = sws_web::router::build(
        tag_db,
        bus,
        alarm_db,
        historian,
        registry,
        py_engine,
        auth,
        supervisor.clone(),
        functions,
        derived_tags.clone(),
        active_dir,
        Arc::new(args.projects_root.clone()),
        Arc::new(args.templates_root.clone()),
        log_bus,
        Arc::new(logs_dir),
        started_at,
        ip_allowlist,
        args.www.clone(),
    );

    let addr: SocketAddr = "0.0.0.0:8443".parse()?;
    let listener = TcpListener::bind(addr).await?;
    info!(%addr, "HTTPS listener ready");

    // Kiosk-mode browser spawn: once /health answers OK, run the operator-
    // provided shell command (typically a kiosk browser). Fire-and-forget —
    // the runtime never restarts or kills the child, and the child's death
    // doesn't stop the runtime. PoC-grade: no retries beyond the initial
    // health-check poll, no log capture (stdio inherits).
    if let Some(cmd) = args.kiosk_browser.clone() {
        tokio::spawn(async move {
            // Tolerate self-signed cert (rcgen-generated on first run).
            let client = reqwest::Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(std::time::Duration::from_millis(500))
                .build()
                .unwrap_or_default();
            let mut ready = false;
            for _ in 0..50 {
                if let Ok(r) = client.get("https://localhost:8443/health").send().await {
                    if r.status().is_success() { ready = true; break; }
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            if !ready {
                warn!(kiosk = %cmd, "kiosk: /health didn't answer in 5s — skipping browser spawn");
                return;
            }
            info!(kiosk = %cmd, "kiosk: spawning browser");
            match tokio::process::Command::new("sh")
                .arg("-c").arg(&cmd)
                .stdin(std::process::Stdio::null())
                .spawn()
            {
                Ok(_child) => { /* fire-and-forget, child inherits stdout/stderr */ }
                Err(e)     => warn!(kiosk = %cmd, "kiosk: spawn failed: {e}"),
            }
        });
    }

    if args.kiosk_wayland {
        tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(std::time::Duration::from_millis(500))
                .build()
                .unwrap_or_default();
            let mut ready = false;
            for _ in 0..50 {
                if let Ok(r) = client.get("https://localhost:8443/health").send().await {
                    if r.status().is_success() { ready = true; break; }
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            if !ready {
                warn!("kiosk-wayland: /health didn't answer in 5s — skipping sws-kiosk spawn");
                return;
            }
            // Look for sws-kiosk next to the current executable, fall back to PATH.
            let binary = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("sws-kiosk")))
                .unwrap_or_else(|| "sws-kiosk".into());
            info!(binary = %binary.display(), "kiosk-wayland: spawning sws-kiosk");
            match tokio::process::Command::new(&binary)
                .arg("https://localhost:8443")
                .arg("--allow-insecure-tls")
                .stdin(std::process::Stdio::null())
                .spawn()
            {
                Ok(_child) => { /* fire-and-forget */ }
                Err(e) => warn!(binary = %binary.display(), "kiosk-wayland: spawn failed: {e}"),
            }
        });
    }

    loop {
        let (stream, peer) = tokio::select! {
            res = listener.accept() => match res {
                Ok(v)  => v,
                Err(e) => { warn!("accept error: {e}"); continue; }
            },
            _ = tokio::signal::ctrl_c() => {
                info!("shutdown signal received");
                break;
            }
        };

        let acceptor = acceptor.clone();
        let svc = app.clone();

        tokio::spawn(async move {
            let tls_stream = match acceptor.accept(stream).await {
                Ok(s)  => s,
                Err(e) => { warn!(%peer, "TLS handshake failed: {e}"); return; }
            };
            let io = TokioIo::new(tls_stream);
            let hyper_svc = hyper::service::service_fn(move |mut req: axum::extract::Request<Incoming>| {
                req.extensions_mut().insert(peer);
                svc.clone().call(req)
            });
            if let Err(e) = ConnBuilder::new(TokioExecutor::new())
                .serve_connection_with_upgrades(io, hyper_svc)
                .await
            {
                warn!(%peer, "connection error: {e}");
            }
        });
    }

    Ok(())
}

/// Load `tls.crt`/`tls.key` from `config_dir`.
/// Generates a self-signed certificate for `localhost` on first run.
fn build_tls_acceptor(config_dir: &PathBuf) -> anyhow::Result<TlsAcceptor> {
    let cert_path = config_dir.join("tls.crt");
    let key_path  = config_dir.join("tls.key");

    if !cert_path.exists() || !key_path.exists() {
        info!("generating self-signed TLS certificate");
        std::fs::create_dir_all(config_dir).context("creating config directory")?;
        let certified = generate_simple_self_signed(vec!["localhost".into()])
            .context("rcgen: generate_simple_self_signed")?;
        std::fs::write(&cert_path, certified.cert.pem())
            .context("writing tls.crt")?;
        std::fs::write(&key_path, certified.key_pair.serialize_pem())
            .context("writing tls.key")?;
    }

    let cert_pem = std::fs::read(&cert_path).context("reading tls.crt")?;
    let key_pem  = std::fs::read(&key_path).context("reading tls.key")?;

    let certs: Vec<CertificateDer<'static>> =
        rustls_pemfile::certs(&mut cert_pem.as_slice())
            .collect::<Result<_, _>>()
            .context("parsing certificate PEM")?;

    let key: PrivateKeyDer<'static> =
        rustls_pemfile::private_key(&mut key_pem.as_slice())
            .context("parsing private key PEM")?
            .ok_or_else(|| anyhow::anyhow!("no private key found in tls.key"))?;

    let tls_cfg = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .context("building TLS ServerConfig")?;

    Ok(TlsAcceptor::from(Arc::new(tls_cfg)))
}
