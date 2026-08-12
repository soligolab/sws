mod log_file;
mod log_layer;

use anyhow::Context;
use clap::Parser;
use hyper::body::Incoming;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto::Builder as ConnBuilder;
use rcgen::{CertificateParams, KeyPair, SanType};
use std::{net::{IpAddr, SocketAddr}, path::PathBuf, sync::Arc};
use sws_auth::{AuthState, Role};
use sws_core::{AlarmDb, LogBus, TagDb, TagQuality, TagWriteBus, DEFAULT_LOG_CAPACITY};
use sws_historian::Historian;
use sws_pyscript::Engine as PyEngine;
use sws_web::{router::{DerivedTagsRegistry, RegistryCell, ScriptSupervisorCell}, SourceSupervisor};
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
    /// project at boot (backwards compat for the launcher scripts and operator
    /// containers).
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

    /// Kiosk mode: bind the viewer port to 127.0.0.1 instead of 0.0.0.0.
    /// The synoptic is then only reachable by a local browser (sws-kiosk or
    /// Chromium kiosk launched on the same machine). The admin port is
    /// always bound to 0.0.0.0 so a technician's laptop can reach it.
    #[arg(long)]
    kiosk: bool,

    /// HTTPS port for the operator viewer (RuntimeViewer SPA, optional_auth).
    /// When omitted, the viewer is not started — only the admin IDE port is
    /// active (IDE-only mode, used by start_editor.sh on the developer's PC).
    /// Pass --viewer-port 8443 to enable the viewer (start_runtime.sh).
    #[arg(long)]
    viewer_port: Option<u16>,

    /// HTTPS port for the admin IDE (full App SPA, required_auth). Default: 8444.
    /// Override when running multiple runtime instances on the same host.
    #[arg(long, default_value_t = 8444u16)]
    admin_port: u16,

    /// Operator-only hardening (CRA attack-surface reduction, OPEN_QUESTIONS Q8):
    /// do NOT bind the admin/IDE port at all and drop the ad-hoc `/api/script/exec`
    /// endpoint from the viewer. Only the operator viewer + button-bound functions
    /// remain. Requires --viewer-port. Config edits, project management and
    /// arbitrary script execution become unavailable on the device.
    #[arg(long)]
    no_admin: bool,

    /// Plain HTTP port for the TLS certificate acceptance helper page.
    /// Serves a small interactive page (no cert needed) that guides the user
    /// to accept the self-signed certificate and then redirects to the HTTPS IDE.
    /// Used by start_editor.sh and start_runtime.sh as the primary entry point
    /// for first-time or post-.run-reset access.
    #[arg(long)]
    http_port: Option<u16>,

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

// HTML page served on the plain-HTTP companion port to guide certificate acceptance.
// Placeholders replaced at startup: __ADMIN_PORT__ with the actual admin port.
// /cert on this HTTP port serves the TLS cert file for direct download.
const CERT_PAGE_TEMPLATE: &str = r##"<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SWS — Certificato TLS</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100vh;margin:0;padding:24px;gap:0}
    h2{margin:0 0 8px;font-size:20px;font-weight:600;text-align:center}
    .lead{margin:0 0 28px;color:#94a3b8;text-align:center;max-width:400px;line-height:1.5;font-size:14px}
    .card{background:#1e293b;border:1px solid #334155;border-radius:10px;
          padding:20px 24px;max-width:480px;width:100%;margin-bottom:16px}
    .card h3{margin:0 0 10px;font-size:14px;font-weight:600;color:#cbd5e1}
    .card p{margin:0 0 12px;font-size:13px;color:#94a3b8;line-height:1.5}
    .row{display:flex;gap:8px;align-items:center}
    input[type=text]{flex:1;background:#0f172a;border:1px solid #334155;border-radius:6px;
                     padding:7px 10px;color:#e2e8f0;font-size:13px;font-family:monospace}
    .btn{padding:7px 16px;border:none;border-radius:6px;cursor:pointer;
         font-size:13px;font-weight:500;white-space:nowrap}
    .btn-blue{background:#2563eb;color:#fff}
    .btn-blue:hover{background:#1d4ed8}
    .btn-slate{background:#334155;color:#e2e8f0}
    .btn-slate:hover{background:#475569}
    a.btn{text-decoration:none;display:inline-block}
    #status{margin-top:4px;font-size:12px;color:#64748b;text-align:center;min-height:18px}
    .divider{color:#334155;margin:0 0 16px;text-align:center;font-size:12px}
  </style>
</head>
<body>
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#3b82f6"
       stroke-width="1.5" style="margin-bottom:12px">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0110 0v4"/>
  </svg>
  <h2>Certificato TLS non approvato</h2>
  <p class="lead">SWS usa un certificato self-signed. Il browser deve approvarlo una volta prima di poter accedere all'IDE.</p>

  <div class="card">
    <h3>Opzione A — accettazione rapida (una sessione)</h3>
    <p>Copia questo URL e incollalo nella <strong>barra degli indirizzi</strong> del browser.
       Clicca "Avanzate" &rarr; "Procedi" per accettare il certificato.</p>
    <div class="row">
      <input id="url" type="text" readonly value="">
      <button class="btn btn-slate" onclick="copyUrl()">Copia</button>
    </div>
    <p id="status" style="margin-top:8px"></p>
  </div>

  <div class="divider">— oppure —</div>

  <div class="card">
    <h3>Opzione B — installazione permanente (consigliata)</h3>
    <p>Scarica il certificato e importalo nel browser. Dopo l'importazione non verrà mai più chiesto.</p>
    <div class="row">
      <a class="btn btn-blue" href="/cert" download="sws.crt">Scarica sws.crt</a>
      <span style="font-size:12px;color:#64748b">
        Chrome: Impostazioni &rarr; Privacy &rarr; Sicurezza &rarr; Gestisci certificati &rarr; Importa &rarr; seleziona sws.crt &rarr; "Autorità di certificazione"
      </span>
    </div>
  </div>

  <script>
    var PORT = '__ADMIN_PORT__';
    var ORIGIN = 'https://' + window.location.hostname + ':' + PORT;
    var healthUrl = ORIGIN + '/health';
    document.getElementById('url').value = healthUrl;

    function copyUrl() {
      navigator.clipboard.writeText(healthUrl).then(function() {
        document.getElementById('status').textContent = 'URL copiato. Incollalo nella barra degli indirizzi e accetta il certificato, poi torna qui.';
      });
    }

    function poll() {
      fetch(ORIGIN + '/health')
        .then(function(r) {
          if (r.ok) {
            document.getElementById('status').textContent = 'Certificato approvato - reindirizzamento...';
            setTimeout(function() { window.location.href = ORIGIN + '/'; }, 800);
          } else { wait(); }
        })
        .catch(function() { wait(); });
    }
    function wait() { setTimeout(poll, 1200); }
    poll();
  </script>
</body>
</html>"##;

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
    // Fall back to INFO so the launcher scripts and the container both produce logs out
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
    // Default logs dir is a sibling of projects_root (not inside it), so that
    // list_projects never mistakes the log directory for a project.
    let logs_dir = args.logs.clone().unwrap_or_else(|| {
        args.projects_root
            .parent()
            .unwrap_or(&args.projects_root)
            .join("logs")
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

    // TLS is opt-in: if config_dir/tls.crt exists, start in HTTPS mode.
    // Otherwise serve plain HTTP — localhost is a "secure context" in all
    // modern browsers, so the editor works without any cert acceptance step.
    // Users can enable TLS from ConfigView → Stato → Certificato TLS.
    std::fs::create_dir_all(&args.config).context("creating config directory")?;
    let acceptor: Option<TlsAcceptor> = if args.config.join("tls.crt").exists() {
        Some(build_tls_acceptor(&args.config)?)
    } else {
        info!("no TLS certificate found — plain HTTP mode (enable via ConfigView → Stato → Certificato TLS)");
        None
    };

    // Computed here (before the project auto-open below, which needs it to
    // resolve MQTT client ids) rather than nearer its other uses further
    // down — see `apply_loaded_project` in sws-web::projects.
    let config_dir = Arc::new(args.config.clone());
    let instance_id = Arc::new(load_or_create_instance_id(&config_dir));
    info!(instance_id = %instance_id, "runtime instance id (used for random MQTT client ids)");

    let tag_db    = Arc::new(TagDb::new(256));
    let bus       = Arc::new(TagWriteBus::new());
    let alarm_db  = Arc::new(AlarmDb::new(64));
    // 5_000 samples × ~100 tags ≈ a few MB. Adjust per-tag cap when we learn
    // realistic project sizes — for now this is the PoC sizing.
    // Historian starts RAM-only. open_project calls historian.swap_store() to
    // attach the per-project SQLite so history is isolated between projects.
    let historian = Arc::new(Historian::new(5_000));
    let py_engine = PyEngine::new(tag_db.clone(), bus.clone());
    let supervisor = SourceSupervisor::new(tag_db.clone(), bus.clone());
    // Empty registries — populated below from project.yaml (if present).
    let functions: sws_web::router::FunctionsRegistry =
        Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new()));
    let derived_tags: DerivedTagsRegistry =
        Arc::new(tokio::sync::RwLock::new(Vec::new()));
    let script_supervisor: ScriptSupervisorCell =
        Arc::new(tokio::sync::RwLock::new(None));

    // Env-var credentials are optional. When SWS_ADMIN_PASSWORD is not set
    // (and users.yaml is absent or empty), the runtime starts in no-auth mode:
    // all routes are open without a token. Set SWS_ADMIN_PASSWORD to seed an
    // admin account and enable authentication.
    let admin_user = std::env::var("SWS_ADMIN_USER").unwrap_or_else(|_| "admin".into());
    let admin_pwd  = std::env::var("SWS_ADMIN_PASSWORD").unwrap_or_default();
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

    // Datastore registry: hot-swappable cell initialised empty.
    // Populated below from project.yaml (if --project was passed) or later
    // by open_project when the user opens a project via WelcomeScreen.
    let registry: RegistryCell = Arc::new(tokio::sync::RwLock::new(None));

    // Auth state: empty until a project is opened. When --project is set,
    // we swap to its users.yaml; otherwise the WelcomeScreen does it via
    // POST /api/projects/:name/open later.
    let auth = AuthState::empty(ttl, rate_limit, rate_window_dur);

    // Resolve which project to auto-open. The runtime is single-project: it
    // should always come back up serving the project on disk, in this order:
    //   1. explicit --project flag
    //   2. .active-project marker (written on every open, persistent)
    //   3. legacy .last-opened reboot marker (consumed once)
    //   4. the only project directory present under projects_root
    let project_arg = args.project.clone().or_else(|| {
        // 2. Persistent "last active project" marker — NOT consumed, so a plain
        //    restart reopens the same project.
        let active = args.projects_root.join(".active-project");
        if let Ok(s) = std::fs::read_to_string(&active) {
            let p = std::path::PathBuf::from(s.trim());
            if p.is_dir() {
                info!(path = %p.display(), "auto-opening last active project (.active-project)");
                return Some(p);
            }
            warn!(path = %p.display(), ".active-project path no longer exists, ignoring");
        }
        // 3. Legacy reboot marker — consume so a clean start ignores it.
        let legacy = args.projects_root.join(".last-opened");
        if let Ok(s) = std::fs::read_to_string(&legacy) {
            let p = std::path::PathBuf::from(s.trim());
            let _ = std::fs::remove_file(&legacy);
            if p.is_dir() {
                info!(path = %p.display(), "auto-reopening project from .last-opened");
                return Some(p);
            }
            warn!(path = %p.display(), ".last-opened path no longer exists, ignoring");
        }
        // 4. Single-project fallback: open the only project on disk.
        match single_project_dir(&args.projects_root) {
            Some(p) => {
                info!(path = %p.display(), "auto-opening the only project present");
                Some(p)
            }
            None => None,
        }
    });

    // Servizi da avviare dopo router::build() per il progetto aperto al boot:
    // (notifiche, script globali). `None` = nessun progetto auto-aperto.
    let mut boot_services: Option<(Option<sws_core::NotificationConfig>, Vec<sws_core::GlobalScriptDef>)> = None;

    if let Some(project_path) = project_arg {
        // Legacy auto-open path: bootstrap exactly as the single-project
        // runtime did, then mark this dir as active.
        supervisor.set_pki_root(project_path.join(".opcua-pki")).await;
        match sws_core::project::Project::load(&project_path) {
            Ok(mut project) => {
                // Notifiche e script globali si mettono da parte: i loro
                // supervisori vivono in AppState, che nasce in router::build()
                // più sotto, quindi non si possono avviare adesso — vedi
                // start_project_services.
                //
                // Il resto del caricamento passa da `apply_loaded_project`,
                // condivisa con `open_project` (sws-web/src/projects.rs): prima
                // questo percorso ricopiava quella logica a mano, e ogni pezzo
                // dimenticato restava invisibile finché non serviva — storico,
                // notifiche e più di recente la risoluzione del client_id MQTT
                // sono finiti mancanti così, in tre occasioni separate.
                //
                // Stesso motivo per l'iniezione qui sotto: `open_project`
                // inietta un datastore SQLite di default quando il progetto
                // non ne ha uno esplicito in project.yaml, ma questo path di
                // auto-apertura al boot — il caso normale in un device in
                // campo — non lo faceva. Un progetto senza `datastores:`
                // esplicito partiva quindi senza storico allarmi, in
                // silenzio: nessuno store SQLite, nessun `journal_callback`
                // agganciato in `apply_loaded_project`.
                if project.datastores.is_empty() {
                    project.datastores.push(sws_web::projects::default_datastore());
                }
                let (notifications, global_scripts) = sws_web::projects::apply_loaded_project(
                    &project_path, project,
                    &tag_db, &registry, &historian, &alarm_db, &supervisor,
                    &derived_tags, &functions, &config_dir, &instance_id,
                ).await;
                boot_services = Some((notifications, global_scripts));
            }
            Err(e) => {
                warn!("project.yaml not found or invalid — starting with empty tag database: {e:#}");
            }
        }
        // Swap auth to point at this project's users.yaml, seeded from env.
        if let Err(e) = auth.swap_store(project_path.join("users.yaml"), accounts).await {
            anyhow::bail!("failed to bootstrap auth from --project: {e}");
        }
        // Persist the choice so a plain restart reopens the same project.
        let marker = args.projects_root.join(".active-project");
        if let Err(e) = std::fs::write(&marker, project_path.to_string_lossy().as_bytes()) {
            warn!("could not write .active-project marker: {e}");
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
    // Spawned at startup if --project already has datastores; also spawned
    // dynamically by open_project when the user opens a project later.
    if let Some(reg) = registry.read().await.as_ref().map(Arc::clone) {
        reg.spawn_recorder(tag_db.clone());
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

    let cert_path: Option<Arc<PathBuf>> = acceptor.as_ref()
        .map(|_| Arc::new(args.config.join("tls.crt")));
    let http_cert_path: Option<PathBuf> = cert_path.as_ref().map(|p| (**p).clone());

    // Append-only audit log (OPEN_QUESTIONS Q8). One file spanning the process
    // lifetime (not per-project) so the trail survives project switches.
    // SWS_AUDIT_KEY (if set) enables HMAC signing on top of the hash chain.
    let audit_key = std::env::var("SWS_AUDIT_KEY").ok().filter(|k| !k.is_empty()).map(|k| k.into_bytes());
    if audit_key.is_none() {
        info!("SWS_AUDIT_KEY not set — audit log is hash-chained but unsigned (tamper-evident, not tamper-resistant)");
    }
    let audit = Arc::new(sws_audit::AuditLog::open(config_dir.join("audit.jsonl"), audit_key));

    // Known-projects registry (recent projects list + custom-path projects
    // outside projects_root). Borrows config_dir; build() below takes it by
    // value afterward, so this must load first.
    let known_projects = Arc::new(sws_web::project_registry::ProjectRegistry::load(&config_dir).await);

    let (runtime_app, admin_app, app_state) = sws_web::router::build(
        tag_db,
        bus,
        alarm_db,
        historian,
        registry,
        py_engine,
        auth,
        supervisor.clone(),
        script_supervisor,
        functions,
        derived_tags.clone(),
        active_dir,
        Arc::new(args.projects_root.clone()),
        Arc::new(args.templates_root.clone()),
        log_bus,
        Arc::new(logs_dir),
        started_at,
        ip_allowlist,
        config_dir,
        cert_path,
        args.www.clone(),
        args.no_admin,
        audit,
        known_projects,
        instance_id,
    );

    // Servizi del progetto auto-aperto al boot: canale Telegram, script globali,
    // supervisore delle notifiche. Vanno qui perché vivono in AppState, che
    // esiste solo da build() in poi.
    //
    // Senza questo, dopo ogni riavvio del dispositivo gli allarmi non mandavano
    // né email né Telegram e gli script globali non partivano, finché qualcuno
    // non riapriva il progetto dall'IDE — e riaprirlo non è qualcosa che si
    // faccia su un pannello in servizio. Verificato sul dispositivo: al boot
    // nessuna riga "notification supervisor started", dopo un POST
    // /api/projects/<n>/open la riga compare e l'allarme manda il messaggio.
    if let Some((notifications, global_scripts)) = boot_services {
        sws_web::projects::start_project_services(&app_state, notifications, global_scripts).await;
    }

    // Runtime listener (synoptic, optional-auth): only started when --viewer-port is given.
    // Omitting --viewer-port starts in IDE-only mode (start_editor.sh on developer's PC).
    let runtime_listener: Option<TcpListener> = if let Some(vport) = args.viewer_port {
        let bind = if args.kiosk {
            format!("127.0.0.1:{vport}")
        } else {
            format!("0.0.0.0:{vport}")
        };
        let addr: SocketAddr = bind.parse()?;
        let l = TcpListener::bind(addr).await?;
        info!(addr = %addr, kiosk = args.kiosk, tls = acceptor.is_some(), "runtime listener ready");
        Some(l)
    } else {
        info!("--viewer-port not set — IDE-only mode (admin port only)");
        None
    };

    // Admin listener (all routes, auth required): 0.0.0.0. Skipped entirely in
    // operator-only mode (--no-admin), which removes the IDE/admin surface from
    // the device (OPEN_QUESTIONS Q8).
    if args.no_admin && args.viewer_port.is_none() {
        anyhow::bail!("--no-admin richiede --viewer-port (altrimenti nessuna porta verrebbe servita)");
    }
    let admin_listener: Option<TcpListener> = if args.no_admin {
        warn!("--no-admin: superficie IDE/admin DISABILITATA (solo viewer operatore + funzioni bound)");
        None
    } else {
        let admin_addr: SocketAddr = format!("0.0.0.0:{}", args.admin_port).parse()?;
        let l = TcpListener::bind(admin_addr).await?;
        info!(addr = %admin_addr, tls = acceptor.is_some(), "admin listener ready");
        Some(l)
    };

    // HTTP companion listener: plain HTTP, no TLS. Serves a cert-acceptance helper
    // page so users can approve the self-signed cert without knowing the /health URL.
    // Only useful (and only started) when TLS is active — in plain HTTP mode the main
    // ports are already plain HTTP so no companion is needed.
    let http_listener: Option<TcpListener> = if let (Some(hp), true) = (args.http_port, acceptor.is_some()) {
        let addr: SocketAddr = format!("0.0.0.0:{hp}").parse()?;
        let l = TcpListener::bind(addr).await?;
        info!(addr = %addr, "HTTP cert-acceptance listener ready");
        Some(l)
    } else {
        None
    };

    // Build the HTTP app: cert-acceptance page at "/" and cert download at "/cert".
    let http_app: Option<axum::Router> = http_listener.as_ref().map(|_| {
        let page = CERT_PAGE_TEMPLATE
            .replace("__ADMIN_PORT__", &args.admin_port.to_string());
        let cert_file = http_cert_path.clone();
        axum::Router::new()
            .route("/", axum::routing::get(move || {
                let body = page.clone();
                async move {
                    axum::response::Response::builder()
                        .header(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")
                        .header(axum::http::header::CACHE_CONTROL, "no-store")
                        .body(axum::body::Body::from(body))
                        .unwrap()
                }
            }))
            .route("/cert", axum::routing::get(move || {
                let path = cert_file.clone();
                async move {
                    match path {
                        Some(p) => match tokio::fs::read(&p).await {
                            Ok(bytes) => axum::response::Response::builder()
                                .header(axum::http::header::CONTENT_TYPE, "application/x-x509-ca-cert")
                                .header("Content-Disposition", "attachment; filename=\"sws.crt\"")
                                .header(axum::http::header::CACHE_CONTROL, "no-store")
                                .body(axum::body::Body::from(bytes))
                                .unwrap(),
                            Err(e) => axum::response::Response::builder()
                                .status(500)
                                .body(axum::body::Body::from(format!("cert not found: {e}")))
                                .unwrap(),
                        },
                        None => axum::response::Response::builder()
                            .status(404)
                            .body(axum::body::Body::from("no TLS certificate"))
                            .unwrap(),
                    }
                }
            }))
    });

    // Announce this runtime on the local network via mDNS (viewer port only).
    // Skipped in IDE-only mode (no viewer port = no service to discover).
    let _mdns_svc = args.viewer_port.map(|vp| announce_mdns(vp, args.admin_port, acceptor.is_some()));

    // Kiosk-mode browser spawn: once /health answers OK, run the operator-
    // provided shell command (typically a kiosk browser). Fire-and-forget —
    // the runtime never restarts or kills the child, and the child's death
    // doesn't stop the runtime. PoC-grade: no retries beyond the initial
    // health-check poll, no log capture (stdio inherits).
    if let (Some(cmd), Some(vport)) = (args.kiosk_browser.clone(), args.viewer_port) {
        tokio::spawn(async move {
            // Tolerate self-signed cert (rcgen-generated on first run).
            let client = reqwest::Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(std::time::Duration::from_millis(500))
                .build()
                .unwrap_or_default();
            let health_url = format!("https://localhost:{vport}/health");
            let mut ready = false;
            for _ in 0..50 {
                if let Ok(r) = client.get(&health_url).send().await {
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

    if let (true, Some(vport)) = (args.kiosk_wayland, args.viewer_port) {
        tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(std::time::Duration::from_millis(500))
                .build()
                .unwrap_or_default();
            let health_url = format!("https://localhost:{vport}/health");
            let mut ready = false;
            for _ in 0..50 {
                if let Ok(r) = client.get(&health_url).send().await {
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
        // Accept on all listeners in parallel.
        // kind=0 → viewer (HTTPS), kind=1 → admin (HTTPS), kind=2 → HTTP companion.
        // Listeners that are not configured use std::future::pending() so their
        // branch never fires without blocking the others.
        let (stream, peer, kind) = tokio::select! {
            res = async {
                match runtime_listener.as_ref() {
                    Some(l) => l.accept().await.map(|(s, p)| (s, p, 0u8)),
                    None    => std::future::pending::<std::io::Result<_>>().await,
                }
            } => match res {
                Ok(x) => x,
                Err(e) => { warn!("runtime accept error: {e}"); continue; }
            },
            res = async {
                match admin_listener.as_ref() {
                    Some(l) => l.accept().await.map(|(s, p)| (s, p, 1u8)),
                    None    => std::future::pending::<std::io::Result<_>>().await,
                }
            } => match res {
                Ok(x) => x,
                Err(e) => { warn!("admin accept error: {e}"); continue; }
            },
            res = async {
                match http_listener.as_ref() {
                    Some(l) => l.accept().await.map(|(s, p)| (s, p, 2u8)),
                    None    => std::future::pending::<std::io::Result<_>>().await,
                }
            } => match res {
                Ok(x) => x,
                Err(e) => { warn!("http accept error: {e}"); continue; }
            },
            // SIGINT (Ctrl-C, interactive) *and* SIGTERM (podman stop,
            // systemctl stop, container OOM handling). Handling only SIGINT
            // meant every supervised stop waited out the grace period and
            // ended in SIGKILL — 10 s per `podman stop` and, worse, a hard
            // kill in the middle of a project.yaml / SQLite write.
            _ = shutdown_signal() => {
                info!("shutdown signal received");
                break;
            }
        };

        // HTTP companion: serve plain (no TLS), then continue to next accept.
        if kind == 2 {
            if let Some(ref app) = http_app {
                let app = app.clone();
                tokio::spawn(async move {
                    let io = TokioIo::new(stream);
                    let svc = hyper::service::service_fn(move |req| app.clone().call(req));
                    if let Err(e) = ConnBuilder::new(TokioExecutor::new())
                        .serve_connection(io, svc)
                        .await
                    {
                        debug!(%peer, "http connection closed: {e}");
                    }
                });
            }
            continue;
        }

        // Pick the right Axum app, then serve — with TLS if a cert is configured,
        // otherwise as plain HTTP (localhost is a "secure context" in modern browsers).
        let svc = if kind == 0 { runtime_app.clone() } else { admin_app.clone() };

        match acceptor.clone() {
            Some(tls_acceptor) => {
                tokio::spawn(async move {
                    let tls_stream = match tls_acceptor.accept(stream).await {
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
            None => {
                tokio::spawn(async move {
                    let io = TokioIo::new(stream);
                    let hyper_svc = hyper::service::service_fn(move |mut req: axum::extract::Request<Incoming>| {
                        req.extensions_mut().insert(peer);
                        svc.clone().call(req)
                    });
                    if let Err(e) = ConnBuilder::new(TokioExecutor::new())
                        .serve_connection_with_upgrades(io, hyper_svc)
                        .await
                    {
                        debug!(%peer, "plain HTTP connection closed: {e}");
                    }
                });
            }
        }
    }

    Ok(())
}

/// Resolves when the process is asked to stop: SIGINT (Ctrl-C) or SIGTERM.
///
/// SIGTERM is the one supervisors actually send — `podman stop`, `systemctl
/// stop`. Listening only for SIGINT made every managed stop hit the grace
/// period and get SIGKILLed, which can truncate an in-flight write.
///
/// On non-Unix targets only SIGINT is available; the SIGTERM arm is compiled
/// out rather than emulated.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        // If the handler cannot be installed we still want Ctrl-C to work,
        // so fall back to a future that never completes instead of panicking.
        let mut sigterm = match signal(SignalKind::terminate()) {
            Ok(s) => s,
            Err(e) => {
                warn!("cannot install SIGTERM handler: {e} — only SIGINT will stop the runtime");
                let _ = tokio::signal::ctrl_c().await;
                return;
            }
        };
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = sigterm.recv()          => {}
        }
    }

    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

/// Single-project fallback for auto-open: if exactly one directory under
/// `projects_root` contains a `project.yaml`, return its path. Returns `None`
/// when there are zero or more than one (the WelcomeScreen then takes over).
fn single_project_dir(projects_root: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut found: Option<std::path::PathBuf> = None;
    let entries = std::fs::read_dir(projects_root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        // Skip dot-dirs (logs, .history, markers) and anything without project.yaml.
        if path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with('.')) {
            continue;
        }
        if !path.join("project.yaml").is_file() {
            continue;
        }
        if found.is_some() {
            // More than one project — not a single-project layout.
            return None;
        }
        found = Some(path);
    }
    found
}

/// Decide the container engine from the markers a container runtime leaves in
/// the filesystem. Pure so it can be tested without actually being in a
/// container — the caller does the I/O.
///
/// `/run/.containerenv` è il marcatore di podman, `/.dockerenv` quello di
/// docker; entrambi sono creati dal motore, non dall'immagine, quindi
/// funzionano anche con l'immagine legacy e senza ricostruire niente.
/// Il cgroup è il ripiego: su alcune configurazioni rootless il file di podman
/// non c'è, ma la gerarchia cgroup nomina comunque `libpod`/`docker`.
fn container_engine_from_markers(
    has_containerenv: bool,
    has_dockerenv: bool,
    cgroup: &str,
) -> Option<&'static str> {
    // Docker per primo: un docker può montare `/run/.containerenv` per
    // compatibilità, mentre `/.dockerenv` non compare mai sotto podman.
    if has_dockerenv {
        return Some("docker");
    }
    if has_containerenv {
        return Some("podman");
    }
    if cgroup.contains("libpod") {
        return Some("podman");
    }
    if cgroup.contains("docker") {
        return Some("docker");
    }
    // `containerd` da solo non dice quale motore c'è sopra: si dichiara
    // container senza inventare un nome.
    if cgroup.contains("containerd") {
        return Some("container");
    }
    None
}

/// `Some("podman" | "docker" | "container")` quando il runtime gira dentro un
/// container, `None` quando gira nudo sull'host.
///
/// `SWS_CONTAINER_ENGINE` forza il valore per i casi che il rilevamento non
/// copre. Deliberatamente **non** impostata nei nostri Containerfile: la stessa
/// immagine può essere eseguita da motori diversi, e un valore cotto
/// nell'immagine mentirebbe.
fn detect_container_engine() -> Option<String> {
    if let Ok(forced) = std::env::var("SWS_CONTAINER_ENGINE") {
        let forced = forced.trim().to_string();
        if !forced.is_empty() {
            return Some(forced);
        }
    }
    let cgroup = std::fs::read_to_string("/proc/self/cgroup").unwrap_or_default();
    container_engine_from_markers(
        std::path::Path::new("/run/.containerenv").exists(),
        std::path::Path::new("/.dockerenv").exists(),
        &cgroup,
    )
    .map(str::to_string)
}

/// Announce this runtime as `_sws._tcp.local.` via mDNS.
/// The ServiceDaemon must stay alive for the announcement to remain visible;
/// drop it to unregister. Returns `None` if the daemon or registration fails
/// (non-fatal — mDNS is optional).
fn announce_mdns(viewer_port: u16, admin_port: u16, tls: bool) -> Option<mdns_sd::ServiceDaemon> {
    use mdns_sd::{ServiceDaemon, ServiceInfo};

    let daemon = ServiceDaemon::new()
        .map_err(|e| warn!("mDNS: daemon create failed: {e}"))
        .ok()?;

    let hostname = std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "sws-runtime".to_string());

    let host_fqdn = format!("{}.local.", hostname);
    let admin_port_str = admin_port.to_string();
    // Lo schema va annunciato, non indovinato: il runtime parte in HTTP finché
    // non esiste un certificato, e un client che assume https costruisce URL
    // che non rispondono. Chi ascolta usa "https" come default per restare
    // compatibile con runtime più vecchi che non pubblicano questa proprietà.
    let scheme = if tls { "https" } else { "http" };
    // `container` c'è solo dentro un container, col nome del motore. Un runtime
    // nativo non annuncia la proprietà affatto: chi ascolta non deve poter
    // confondere "nativo" con "non lo so" (un runtime più vecchio di questo
    // campo non lo pubblica comunque).
    let container = detect_container_engine();
    let mut properties = vec![
        ("admin_port", admin_port_str.as_str()),
        ("scheme", scheme),
        ("version", env!("CARGO_PKG_VERSION")),
    ];
    if let Some(engine) = container.as_deref() {
        properties.push(("container", engine));
    }

    let service_info = match ServiceInfo::new(
        "_sws._tcp.local.",
        &hostname,
        &host_fqdn,
        "", // empty = enable_addr_auto below
        viewer_port,
        &properties[..],
    ) {
        Ok(info) => info.enable_addr_auto(),
        Err(e) => {
            warn!("mDNS: ServiceInfo build failed: {e}");
            return None;
        }
    };

    match daemon.register(service_info) {
        Ok(_) => {
            info!(
                instance = %hostname,
                viewer_port,
                admin_port,
                container = container.as_deref().unwrap_or("no"),
                "mDNS service announced (_sws._tcp.local.)"
            );
            Some(daemon)
        }
        Err(e) => {
            warn!("mDNS: register failed: {e}");
            None
        }
    }
}

/// Detect the primary outbound LAN IP via a connected UDP socket (no packets sent).
fn detect_lan_ip() -> Option<std::net::IpAddr> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    sock.local_addr().ok().map(|a| a.ip())
}

/// Try to load an existing TLS cert+key pair from disk. Returns an error if the
/// files are missing, corrupted, or cannot be parsed by rustls.
fn try_load_existing_tls(
    cert_path: &std::path::Path,
    key_path: &std::path::Path,
) -> anyhow::Result<TlsAcceptor> {
    let cert_pem = std::fs::read(cert_path).context("reading tls.crt")?;
    let key_pem  = std::fs::read(key_path).context("reading tls.key")?;
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

/// Load (or create) a short random id identifying this runtime instance,
/// persisted in `config_dir/instance_id` — same load-or-generate-and-save
/// pattern as the TLS cert above, so it survives restarts/updates but
/// differs between the IDE and every deployed device. Used to derive
/// collision-free MQTT client ids (see `RandomClientId` in sws-core).
/// Not a UUID/crypto-grade id on purpose: it only needs to disambiguate a
/// handful of concurrent instances against the same broker, and pulling in
/// a `rand`/`uuid` dependency for that would be overkill for the PoC.
fn load_or_create_instance_id(config_dir: &std::path::Path) -> String {
    let path = config_dir.join("instance_id");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seed = (nanos as u64) ^ (u64::from(std::process::id()) << 32);
    let id = format!("{:06x}", seed & 0xff_ffff);
    if let Err(e) = std::fs::create_dir_all(config_dir)
        .and_then(|()| std::fs::write(&path, &id))
    {
        warn!("could not persist instance_id ({e}) — using it for this run only");
    }
    id
}

/// Build (or reuse) a self-signed TLS certificate with SANs:
///   - DNS: localhost
///   - IP:  127.0.0.1
///   - IP:  <LAN IP> (auto-detected)
///
/// If `config_dir/tls.crt` and `tls.key` already exist and are loadable, they
/// are reused so the browser does not need to re-accept the cert on every restart.
/// Regeneration happens only when the files are missing or unreadable.
/// The cert file is saved to `config_dir/tls.crt` for manual browser import.
fn build_tls_acceptor(config_dir: &PathBuf) -> anyhow::Result<TlsAcceptor> {
    let cert_path = config_dir.join("tls.crt");
    let key_path  = config_dir.join("tls.key");

    std::fs::create_dir_all(config_dir).context("creating config directory")?;

    // Reuse existing cert if present and loadable — avoids forcing the browser
    // to re-accept the TLS exception on every runtime restart.
    if cert_path.exists() && key_path.exists() {
        match try_load_existing_tls(&cert_path, &key_path) {
            Ok(acceptor) => {
                info!(path = %cert_path.display(), "reusing existing TLS certificate");
                return Ok(acceptor);
            }
            Err(e) => warn!("existing TLS cert unloadable ({e}), regenerating"),
        }
    }

    // Build SAN list: localhost + loopback IP + LAN IP
    let lan_ip = detect_lan_ip();
    let mut params = CertificateParams::new(vec!["localhost".to_string()])
        .context("rcgen: CertificateParams::new")?;
    params.subject_alt_names.push(SanType::IpAddress(
        std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
    ));
    if let Some(ip) = lan_ip {
        params.subject_alt_names.push(SanType::IpAddress(ip));
        info!(%ip, "TLS cert will include LAN IP SAN");
    }

    let key_pair = KeyPair::generate().context("rcgen: KeyPair::generate")?;
    let cert = params.self_signed(&key_pair).context("rcgen: self_signed")?;

    std::fs::write(&cert_path, cert.pem()).context("writing tls.crt")?;
    std::fs::write(&key_path, key_pair.serialize_pem()).context("writing tls.key")?;
    info!(path = %cert_path.display(), "self-signed TLS certificate saved (import to trust)");

    try_load_existing_tls(&cert_path, &key_path)
}

#[cfg(test)]
mod tests {
    use super::container_engine_from_markers;

    /// Host nudo: nessun marcatore, cgroup della macchina.
    #[test]
    fn nessun_marcatore_significa_nativo() {
        assert_eq!(
            container_engine_from_markers(false, false, "0::/user.slice/user-1000.slice"),
            None
        );
    }

    #[test]
    fn riconosce_podman_e_docker_dai_file_marcatori() {
        assert_eq!(container_engine_from_markers(true, false, ""), Some("podman"));
        assert_eq!(container_engine_from_markers(false, true, ""), Some("docker"));
    }

    /// Un docker che monta anche `/run/.containerenv` non deve passare per
    /// podman: `/.dockerenv` è il segnale più specifico dei due.
    #[test]
    fn docker_vince_quando_ci_sono_entrambi_i_marcatori() {
        assert_eq!(container_engine_from_markers(true, true, ""), Some("docker"));
    }

    /// Ripiego per le configurazioni rootless dove il file di podman non c'è.
    #[test]
    fn ricade_sul_cgroup_quando_i_file_mancano() {
        assert_eq!(
            container_engine_from_markers(false, false, "0::/machine.slice/libpod-abc123.scope"),
            Some("podman")
        );
        assert_eq!(
            container_engine_from_markers(false, false, "0::/docker/abc123"),
            Some("docker")
        );
    }

    /// `containerd` non dice quale motore c'è sopra: si dichiara container
    /// senza inventare un nome che finirebbe nella UI.
    #[test]
    fn containerd_da_solo_resta_generico() {
        assert_eq!(
            container_engine_from_markers(false, false, "0::/system.slice/containerd.service"),
            Some("container")
        );
    }
}
