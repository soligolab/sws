// TODO: load project, start tag engine, connect comm plugins.

mod log_file;
mod log_layer;

use anyhow::Context;
use clap::Parser;
use hyper::body::Incoming;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto::Builder as ConnBuilder;
use rcgen::generate_simple_self_signed;
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use sws_auth::{AuthState, Role};
use sws_core::{AlarmDb, LogBus, TagDb, TagWriteBus, DEFAULT_LOG_CAPACITY};
use sws_historian::{sqlite::SqliteStore, Historian};
use sws_pyscript::Engine as PyEngine;
use sws_web::SourceSupervisor;
use tokio::net::TcpListener;
use tokio_rustls::{
    rustls::{
        pki_types::{CertificateDer, PrivateKeyDer},
        ServerConfig,
    },
    TlsAcceptor,
};
use tower::Service;
use tracing::{info, warn};
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
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
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

    // Auth state: empty until a project is opened. When --project is set,
    // we swap to its users.yaml; otherwise the WelcomeScreen does it via
    // POST /api/projects/:name/open later.
    let auth = AuthState::empty(ttl, rate_limit, rate_window_dur);

    if let Some(project_path) = args.project.clone() {
        // Legacy auto-open path: bootstrap exactly as the single-project
        // runtime did, then mark this dir as active.
        match sws_core::project::Project::load(&project_path) {
            Ok(project) => {
                info!(
                    name = %project.meta.name,
                    tags = project.tags.len(),
                    alarms = project.alarms.len(),
                    functions = project.functions.len(),
                    "project loaded (legacy --project auto-open)",
                );
                project.populate_tags(&tag_db).await;
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

    // Historian recorder: append every TagDb update to the per-tag ring buffer.
    historian.clone().spawn_recorder(tag_db.clone());

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

    let app = sws_web::router::build(
        tag_db,
        bus,
        alarm_db,
        historian,
        py_engine,
        auth,
        supervisor.clone(),
        functions,
        active_dir,
        Arc::new(args.projects_root.clone()),
        Arc::new(args.templates_root.clone()),
        log_bus,
        Arc::new(logs_dir),
    );

    let addr: SocketAddr = "0.0.0.0:8443".parse()?;
    let listener = TcpListener::bind(addr).await?;
    info!(%addr, "HTTPS listener ready");

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
            let hyper_svc = hyper::service::service_fn(move |req: axum::extract::Request<Incoming>| {
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
