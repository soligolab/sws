use std::{collections::HashMap, io::{Cursor, Read, Write}, path::PathBuf, sync::Arc};
use axum::{
    body::Bytes,
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, Path, Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use serde::Deserialize;
use sws_auth::{AuthState, Credentials, LoginError, LoginOk, Role};
use sws_core::{
    AlarmDb, AlarmDef, AlarmEvent, AlarmState, CustomSymbol, FunctionDef, GlobalScriptDef,
    LogBus, LogEvent, NotificationConfig, Project, ProjectMeta, SourceDef, TagDb, TagDef,
    TagId, TagQuality, TagState, TagValue, TagWriteBus, WriteError,
    MAX_FUNCTION_CODE_BYTES,
};
use sws_historian::{DatastoreRegistry, Historian, Sample};
use sws_pyscript::{Engine as PyEngine, ExecOutput};
use tokio::sync::RwLock;
use tracing::{info, warn};
use crate::global_scripts::GlobalScriptSupervisor;
use crate::notifications::NotificationSupervisor;
use crate::recipe::{RecipeApplyEvent, RecipeDef};
use crate::source_supervisor::SourceSupervisor;
use crate::synoptic::{safe_filename, FaceplateDef, SynopticPage};

/// Resolved function registry keyed by name. Hot-swapped on every
/// `PUT /api/project/functions` so the run endpoint always sees the
/// latest body without a restart.
pub type FunctionsRegistry = Arc<RwLock<HashMap<String, FunctionDef>>>;

/// Hot-swappable datastore registry. Replaced on every `open_project` so
/// the historian connects to the new project's backends without a restart.
pub type RegistryCell = Arc<RwLock<Option<Arc<DatastoreRegistry>>>>;

/// List of `(tag_id, expression)` pairs for derived/calculated tags.
/// Updated whenever the project's tag list changes; read by the derived-tag
/// evaluator task that runs in the runtime.
pub type DerivedTagsRegistry = Arc<RwLock<Vec<(String, String)>>>;

/// Mutable handle on the currently-active project directory. `None` means
/// "no project open" — handlers that need a project dir gate on this and
/// return 503. Wrapped in RwLock so `open`/`close` can swap it in-place
/// without rebuilding the whole AppState.
pub type ActiveProjectDir = Arc<RwLock<Option<PathBuf>>>;

/// Swappable handle for the global-script supervisor. `None` = no project open
/// or project has no global_scripts.
pub type ScriptSupervisorCell = Arc<RwLock<Option<GlobalScriptSupervisor>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<TagDb>,
    pub bus: Arc<TagWriteBus>,
    pub alarms: Arc<AlarmDb>,
    pub historian: Arc<Historian>,
    /// Multi-backend datastore registry. Hot-swapped on every `open_project`.
    /// `None` when no project is open or the project has no `datastores`.
    pub registry: RegistryCell,
    pub py: PyEngine,
    pub auth: Arc<AuthState>,
    pub supervisor: Arc<SourceSupervisor>,
    pub script_supervisor: ScriptSupervisorCell,
    pub functions: FunctionsRegistry,
    pub derived_tags: DerivedTagsRegistry,
    pub project_dir: ActiveProjectDir,
    pub projects_root: Arc<PathBuf>,
    pub templates_root: Arc<PathBuf>,
    pub logs: Arc<LogBus>,
    pub logs_dir: Arc<PathBuf>,
    pub started_at: std::time::Instant,
    /// Parsed CIDR entries from `SWS_IP_ALLOWLIST`. Empty = no restriction.
    pub ip_allowlist: Arc<Vec<(std::net::IpAddr, u8)>>,
    /// In-memory log of recipe apply events. Cleared on project open/close.
    pub recipe_log: Arc<RwLock<Vec<RecipeApplyEvent>>>,
    /// Active notification supervisor (email + escalation). Replaced on project open.
    pub notification_supervisor: Arc<RwLock<Option<NotificationSupervisor>>>,
    /// Runtime config directory (where tls.crt/tls.key live). Used by TLS management endpoints.
    pub config_dir: Arc<PathBuf>,
    /// Path to the TLS certificate PEM for `GET /cert` (browser import).
    /// `None` when running in plain HTTP mode (no TLS configured).
    pub cert_path: Option<Arc<PathBuf>>,
    /// True while scripts/package.sh is running. Prevents concurrent builds.
    pub build_running: crate::packaging::BuildLock,
    /// Repository root (where scripts/package.sh lives). None on deployed instances.
    pub repo_root: crate::packaging::RepoRoot,
    /// Currently-connected remote runtime target (set by POST /api/remote/connect).
    /// `None` when no remote is connected. Used by the WS relay handlers.
    pub remote_target: Arc<RwLock<Option<crate::remote::RemoteTarget>>>,
}

/// Resolve the active project directory or return 503. Used at the top
/// of every handler that needs a project dir (most of them).
pub async fn active_dir(state: &AppState) -> Result<PathBuf, StatusCode> {
    state.project_dir.read().await.clone().ok_or(StatusCode::SERVICE_UNAVAILABLE)
}

pub fn build(
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    alarms: Arc<AlarmDb>,
    historian: Arc<Historian>,
    registry: RegistryCell,
    py: PyEngine,
    auth: Arc<AuthState>,
    supervisor: Arc<SourceSupervisor>,
    script_supervisor: ScriptSupervisorCell,
    functions: FunctionsRegistry,
    derived_tags: DerivedTagsRegistry,
    project_dir: ActiveProjectDir,
    projects_root: Arc<PathBuf>,
    templates_root: Arc<PathBuf>,
    logs: Arc<LogBus>,
    logs_dir: Arc<PathBuf>,
    started_at: std::time::Instant,
    ip_allowlist: Arc<Vec<(std::net::IpAddr, u8)>>,
    config_dir: Arc<PathBuf>,
    cert_path: Option<Arc<PathBuf>>,
    www_dir: Option<PathBuf>,
) -> (Router, Router) {
    let state = AppState { db, bus, alarms, historian, registry, py, auth, supervisor, script_supervisor, functions, derived_tags, project_dir, projects_root, templates_root, logs, logs_dir, started_at, ip_allowlist, recipe_log: Arc::new(RwLock::new(Vec::new())), notification_supervisor: Arc::new(RwLock::new(None)), config_dir, cert_path, build_running: crate::packaging::new_build_lock(), repo_root: crate::packaging::new_repo_root(), remote_target: Arc::new(RwLock::new(None)) };
    // Build the runtime router (8443) before consuming state for admin.
    let runtime_app = build_runtime_inner(state.clone(), www_dir.clone());

    // Routes that need Admin privileges (PUT /api/project/* — schema edits,
    // plus the multi-user CRUD).
    let admin_routes = Router::new()
        .route("/api/project/tags",           put(update_project_tags))
        .route("/api/project/tags/import-csv", post(import_tags_csv))
        .route("/api/project/sources",        put(update_project_sources))
        .route("/api/project/alarms",         put(update_project_alarms))
        .route("/api/project/functions",      put(update_project_functions))
        .route("/api/project/custom-symbols", put(update_project_custom_symbols))
        .route("/api/project/datastores",      put(update_project_datastores))
        .route("/api/project/global-scripts",  put(update_project_global_scripts))
        .route("/api/project/notifications",   put(update_project_notifications))
        .route("/api/project/rollback",        post(trigger_rollback))
        // Bulk project export/import (single ZIP carrying project.yaml +
        // every synoptic). Destructive on the import side — Admin only.
        .route("/api/project/export",     get(export_project_zip))
        .route("/api/project/import",     put(import_project_zip))
        // Backup management (admin-only; restore is destructive).
        .route("/api/backups",
            get(crate::backups::list_backups_handler).post(crate::backups::create_backup_handler))
        .route("/api/backups/:name",
            delete(crate::backups::delete_backup_handler))
        .route("/api/backups/:name/restore",
            post(crate::backups::restore_backup_handler))
        .route("/api/auth/users",         get(list_users).post(create_user))
        .route("/api/auth/users/:username",
            axum::routing::put(update_user).delete(delete_user))
        // Remote deploy: download binary from GitHub Releases + SCP to device.
        .route("/api/deploy/remote",       post(crate::deploy::deploy_remote))
        // Git push: push to default remote/branch. Admin-only (risk of exposing credentials).
        .route("/api/project/git/push",    post(git_push))
        // T-28: local package build + SSH device deploy.
        .route("/api/build/package",       post(crate::packaging::build_package))
        .route("/api/build/packages",      get(crate::packaging::list_packages))
        .route("/api/deploy/device",       post(crate::packaging::deploy_device))
        .route_layer(middleware::from_fn(require_admin));

    // Routes that need Operator+ (tag writes, alarm ACK, script exec,
    // alarm-actionable observability). Viewers can read everything but
    // can't change state. Synoptic writes moved to supervisor_routes
    // below — Operators are runtime users, not project editors.
    let operator_routes = Router::new()
        .route("/api/tags/:id",           put(write_tag))
        .route("/api/alarms/:id/ack",     post(ack_alarm))
        .route("/api/alarms/:id/shelve",  post(shelve_alarm).delete(unshelve_alarm))
        .route("/api/alarms/shelved",     get(list_shelved_alarms))
        // Recipe apply — writes multiple tags atomically
        .route("/api/recipes/:id/apply",  post(apply_recipe))
        .route("/api/script/exec",     post(exec_script))
        .route("/api/script/run/:name", post(run_function))
        // Logs — read-only but Operator+ so the audit surface stays
        // narrow (logs may include schema/secret hints).
        .route("/api/logs",            get(get_logs))
        .route("/api/logs/files",      get(list_log_files))
        .route("/api/logs/file",       get(get_log_file))
        .route("/ws/logs",             get(ws_logs_handler))
        // MQTT broker browse: temporary connection, subscribe #, return topics.
        .route("/api/sources/mqtt/browse", post(mqtt_browse_handler))
        // OPC-UA server browse: one level under a NodeId (default Objects).
        .route("/api/sources/opcua/browse", post(opcua_browse_handler))
        // OPC-UA Euromap 77/83 companion-spec auto-detect.
        .route("/api/sources/opcua/detect-euromap", post(opcua_detect_euromap_handler))
        // OPC-UA historical read — fetches raw data directly from the server's historian.
        .route("/api/sources/opcua/history", post(opcua_history_handler))
        // HomeAssistant entity browse: proxy GET /api/states to HA and return entities.
        .route("/api/sources/ha/browse", post(ha_browse_handler))
        .route("/api/system",             get(crate::system::get_system_status))
        .route("/api/project/deploy",     post(trigger_deploy))
        .route_layer(middleware::from_fn(require_operator));

    let system_ctrl_routes = Router::new()
        .route("/api/system/stop",         post(crate::system::system_stop))
        .route("/api/system/start",        post(crate::system::system_start))
        .route("/api/system/reboot",       post(crate::system::system_reboot))
        .route("/api/system/tls",          get(crate::system::get_tls_status))
        .route("/api/system/tls/generate", post(crate::system::generate_tls_cert))
        .route("/api/system/tls",          put(crate::system::upload_tls_cert))
        .route("/api/system/tls",          delete(crate::system::remove_tls_cert))
        // Remote runtime bridge: connect/disconnect/status + WS relay
        .route("/api/remote/connect",      post(crate::remote::connect_remote)
                                           .delete(crate::remote::disconnect_remote))
        .route("/api/remote/status",       get(crate::remote::remote_status))
        .route("/api/remote/deploy",       post(crate::remote::remote_deploy))
        .route("/ws/remote/:sub",          get(crate::remote_relay::ws_relay_handler))
        .route_layer(middleware::from_fn(require_admin));

    // Routes that need Supervisor+ — project editing surface that
    // Operators must not touch (synoptic page write + per-page YAML
    // import). PUT /api/project/* schema-level routes live in
    // admin_routes above; this group only covers what the frontend
    // editor saves.
    let supervisor_routes = Router::new()
        .route("/api/synoptics/:name", put(save_synoptic))
        .route("/api/synoptics/import", post(import_synoptic_yaml))
        // mDNS discovery: scan LAN for _sws._tcp.local. services (~2 s).
        // Supervisor+ only — used from the RuntimeConnectionTab deploy panel.
        .route("/api/discover", get(crate::discover::discover_runtimes))
        // Git commit: stage all changes and create a commit.
        .route("/api/project/git/commit", post(git_commit))
        .route_layer(middleware::from_fn(require_supervisor));

    // Routes any authenticated user (incl. Viewer) can hit.
    let read_routes = Router::new()
        // Tag REST (reads)
        .route("/api/tags",      get(get_all_tags))
        .route("/api/tags/:id",  get(get_tag))
        // Alarm REST (reads)
        .route("/api/alarms",         get(get_alarms))
        .route("/api/alarms/history", get(get_alarm_history))
        // Historian
        .route("/api/history/export",      get(export_history_csv))   // literal before :tag
        .route("/api/history/:tag/stats",  get(tag_history_stats))
        .route("/api/history/:tag",        get(get_history))
        // (Datastore routes are in a dedicated router below — see datastore_routes)
        // Synoptic REST (reads)
        .route("/api/synoptics",       get(list_synoptics))
        .route("/api/synoptics/:name", get(get_synoptic))
        // Per-page export — raw YAML download. Same shape as the file on disk,
        // small enough to skip the ZIP wrapper used by the bulk export.
        .route("/api/synoptics/:name/export", get(export_synoptic_yaml))
        // Faceplate REST (read + write — Operator+ can read, Configurator+ can write)
        .route("/api/faceplates",       get(list_faceplates))
        .route("/api/faceplates/:id",   get(get_faceplate).put(save_faceplate).delete(delete_faceplate))
        // Recipe REST (read)
        .route("/api/recipes",          get(list_recipes))
        .route("/api/recipes/history",  get(get_recipe_history))
        .route("/api/recipes/:id",      get(get_recipe).put(save_recipe).delete(delete_recipe))
        // GitOps status (read-only — any authenticated user)
        .route("/api/project/git-status", get(get_git_status))
        // Project fingerprint: SHA256 of project.yaml + all synoptics.
        // Clients compare local vs. remote fingerprint to verify deployment sync.
        .route("/api/project/fingerprint", get(get_project_fingerprint))
        // WebSocket streams
        .route("/ws/tags",   get(ws_tags_handler))
        .route("/ws/alarms", get(ws_alarms_handler));

    // Datastore routes — all in ONE router to avoid Axum v0.7 matchit
    // conflicts when routers with overlapping `:id` prefixes are merged.
    // Admin-only operations use per-route middleware instead of a
    // shared route_layer so they coexist with the read routes.
    let require_admin_layer = middleware::from_fn(require_admin);
    let datastore_routes = Router::new()
        .route("/api/datastores",           get(list_datastores))
        .route("/api/datastores/:id/stats", get(datastore_stats))
        .route("/api/datastores/:id/test",
            post(datastore_test).route_layer(require_admin_layer.clone()))
        .route("/api/datastores/:id/purge",
            post(datastore_purge).route_layer(require_admin_layer.clone()))
        .route("/api/datastores/:id/export",
            get(datastore_export).route_layer(require_admin_layer.clone()));

    // OPC-UA cert trust management — separate router to avoid matchit
    // conflicts with /api/sources/opcua/browse (literal) vs :id (param).
    // GET list is Supervisor+; POST trust and DELETE are Admin-only.
    let require_supervisor_layer = middleware::from_fn(require_supervisor);
    let opcua_cert_routes = Router::new()
        .route("/api/sources/:id/opcua/certs",
            get(opcua_list_certs).route_layer(require_supervisor_layer))
        .route("/api/sources/:id/opcua/certs/:filename/trust",
            post(opcua_trust_cert).route_layer(require_admin_layer.clone()))
        .route("/api/sources/:id/opcua/certs/:filename",
            delete(opcua_delete_cert).route_layer(require_admin_layer));

    // The "blocking" set — all routes above plus all the operator/admin
    // routes — is gated by the must_change_password flag in addition to
    // the role checks. A user flagged for password change can still hit
    // the self-service endpoints below.
    let blocking = read_routes
        .merge(operator_routes)
        .merge(supervisor_routes)
        .merge(admin_routes)
        .merge(system_ctrl_routes)
        .merge(datastore_routes)
        .merge(opcua_cert_routes)
        .route_layer(middleware::from_fn(require_password_changed));

    // Self-service endpoints: any authenticated user, including one with
    // must_change_password=true, can hit these.
    let self_service = Router::new()
        .route("/api/auth/whoami",          get(whoami))
        .route("/api/auth/logout",          post(logout))
        .route("/api/auth/change-password", post(change_password))
        .route("/api/auth/refresh",         post(refresh_session));

    let protected = blocking
        .merge(self_service)
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));

    // Pre-auth project lifecycle endpoints — the WelcomeScreen calls these
    // before any session token exists. They operate on `projects_root` and
    // `templates_root` only (no AuthState dependency).
    // GET /api/project is also pre-auth: the WelcomeScreen needs to know
    // whether a project is active (503 = none) before any session exists.
    let project_lifecycle = Router::new()
        .route("/api/project",   get(get_project))
        .route("/api/projects",
            get(crate::projects::list_projects).post(crate::projects::create_project))
        .route("/api/projects/:name/open",
            post(crate::projects::open_project))
        .route("/api/projects/:name/rename",
            post(crate::projects::rename_project))
        .route("/api/projects/:name/duplicate",
            post(crate::projects::duplicate_project))
        .route("/api/projects/:name",
            delete(crate::projects::delete_project))
        .route("/api/projects/close",
            post(crate::projects::close_project))
        .route("/api/projects/upload",
            post(crate::projects::upload_project_zip))
        .route("/api/templates",
            get(crate::templates::list_templates));

    // Install the Prometheus recorder once. Calling this multiple times in
    // the same process (e.g. tests that build several routers) is safe.
    crate::metrics::install_recorder();

    // Serve a self-unregistering service-worker script on the admin port.
    // The runtime SPA previously registered a SW at this origin; this stub
    // immediately unregisters it so browsers stop receiving the cached runtime
    // SPA and load index-admin.html instead.
    let sw_unregister = get(|| async {
        (
            [(axum::http::header::CONTENT_TYPE,  "application/javascript"),
             (axum::http::header::CACHE_CONTROL, "no-store")],
            "self.addEventListener('install',()=>self.skipWaiting());\
             self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));",
        )
    });

    // Always-open routes: liveness probes + login + cert download + project lifecycle.
    let open = Router::new()
        .route("/health",  get(|| async { "ok" }))
        .route("/metrics", get(crate::metrics::get_metrics))
        .route("/cert",    get(get_cert))
        .route("/sw.js",   sw_unregister)
        .route("/api/auth/login", post(login))
        .merge(project_lifecycle);

    let mut app = open.merge(protected);

    // Serve the Vite-built SPA from disk when --www is provided. Any path that
    // doesn't match an API/WS route falls through to ServeDir; 404s inside
    // ServeDir fall back to admin.html (admin SPA) so the SPA can handle
    // client-side routing on a refresh. Falls back to index.html when the
    // admin bundle hasn't been built yet (dev mode).
    if let Some(dir) = www_dir {
        // "index-admin.html" is the Vite output for the admin entry point.
        // Falls back to index.html when the admin bundle hasn't been built.
        let admin_html = dir.join("index-admin.html");
        let fallback_html = if admin_html.exists() { admin_html } else { dir.join("index.html") };
        // Disable ServeDir's automatic directory-index (which would serve
        // index.html for "/"), so that "/" also falls into not_found_service
        // and gets served index-admin.html instead.
        let fallback = ServeDir::new(&dir)
            .append_index_html_on_directories(false)
            .not_found_service(ServeFile::new(fallback_html));
        app = app.fallback_service(fallback);
    }

    // HTTP request counter — applied to every route, identifies the matched
    // route template (not the raw URI) so cardinality stays bounded.
    app = app.layer(middleware::from_fn(crate::metrics::track_http_metrics));

    // Permissive CORS for the "editor on laptop → runtime on PX30" deployment
    // shape (ARCH-004). The editor sets the runtime URL via localStorage and
    // talks to a different origin; without this layer the browser blocks
    // every cross-origin fetch at the preflight stage.
    //
    // Bearer-token auth is unaffected: `Allow-Credentials` stays at the
    // default (false), so no cookies cross origins. The `*` wildcard is
    // CRA-non-compliant — when the PoC graduates to product, narrow this to
    // a configured allowlist (see follow-ups in STATUS.md).
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    (runtime_app, app.layer(cors).with_state(state))
}

/// Build the runtime router served on port 8443 (synoptic view only).
///
/// All routes are wrapped with `optional_auth` — unauthenticated requests get
/// `Role::Viewer` (anonymous read-only). Write routes (`put`, `post` that mutate
/// state) still require `Operator+` via `require_operator`.
///
/// Routes NOT included here: project editing (`PUT /api/project/*`), synoptic
/// editing (`PUT /api/synoptics/*`), backups, users, system control, project
/// lifecycle, log viewer, source browse, datastore admin.
fn build_runtime_inner(state: AppState, www_dir: Option<PathBuf>) -> Router {
    // Operator-required routes: tag writes, alarm ops, recipe apply, scripts.
    let operator_routes = Router::new()
        .route("/api/tags/:id",          put(write_tag))
        .route("/api/alarms/:id/ack",    post(ack_alarm))
        .route("/api/alarms/:id/shelve", post(shelve_alarm).delete(unshelve_alarm))
        .route("/api/alarms/shelved",    get(list_shelved_alarms))
        .route("/api/recipes/:id/apply", post(apply_recipe))
        .route("/api/script/exec",       post(exec_script))
        .route("/api/script/run/:name",  post(run_function))
        .route("/api/system",            get(crate::system::get_system_status))
        .route_layer(middleware::from_fn(require_operator));

    // Anonymous-readable routes: synoptic, tags, alarms, history, WS streams.
    let read_routes = Router::new()
        .route("/api/tags",               get(get_all_tags))
        .route("/api/tags/:id",           get(get_tag))
        .route("/api/alarms",             get(get_alarms))
        .route("/api/alarms/history",     get(get_alarm_history))
        .route("/api/history/export",     get(export_history_csv))
        .route("/api/history/:tag/stats", get(tag_history_stats))
        .route("/api/history/:tag",       get(get_history))
        .route("/api/synoptics",          get(list_synoptics))
        .route("/api/synoptics/:name",    get(get_synoptic))
        .route("/api/faceplates",         get(list_faceplates))
        .route("/api/faceplates/:id",     get(get_faceplate))
        .route("/api/recipes",            get(list_recipes))
        .route("/api/recipes/history",    get(get_recipe_history))
        .route("/api/recipes/:id",        get(get_recipe))
        .route("/api/datastores",         get(list_datastores))
        .route("/api/datastores/:id/stats", get(datastore_stats))
        .route("/api/project/fingerprint", get(get_project_fingerprint))
        .route("/ws/tags",                get(ws_tags_handler))
        .route("/ws/alarms",              get(ws_alarms_handler));

    // Self-service: token must be valid but not blocked by password-change flag.
    let self_service = Router::new()
        .route("/api/auth/whoami",          get(whoami))
        .route("/api/auth/logout",          post(logout))
        .route("/api/auth/change-password", post(change_password))
        .route("/api/auth/refresh",         post(refresh_session));

    // Wrap all gated routes with optional_auth so every request has AuthUser.
    let gated = read_routes
        .merge(operator_routes)
        .merge(self_service)
        .route_layer(middleware::from_fn_with_state(state.clone(), optional_auth));

    // Open: no auth needed. Only /api/project (current active project status)
    // is exposed on the runtime port — project management routes live on 8444 only.
    let open = Router::new()
        .route("/health",         get(|| async { "ok" }))
        .route("/metrics",        get(crate::metrics::get_metrics))
        .route("/cert",           get(get_cert))
        .route("/api/auth/login", post(login))
        .route("/api/project",    get(get_project));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let mut router = open.merge(gated)
        .layer(middleware::from_fn(crate::metrics::track_http_metrics))
        .layer(cors)
        .with_state(state);

    if let Some(dir) = www_dir {
        let index_html = dir.join("index.html");
        let fallback = ServeDir::new(&dir).not_found_service(ServeFile::new(index_html));
        router = router.fallback_service(fallback);
    }

    router
}

// ── Auth middleware ──────────────────────────────────────────────────────────

/// Look up a bearer token in either the `Authorization: Bearer ...` header
/// or the `?token=...` query string (the latter is for browser WebSocket
/// upgrades, which cannot set custom headers). Inserts the resolved
/// username into request extensions for downstream handlers.
async fn require_auth(
    State(s): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    // No users defined (no project, or project without users) → open / no-auth mode.
    // Inject a synthetic AuthUser so all downstream handlers see an Admin-level
    // caller — the frontend never shows the login screen and all routes work.
    if !s.auth.has_users().await {
        req.extensions_mut().insert(AuthUser {
            username: "admin".to_string(),
            role: Role::Admin,
            must_change_password: false,
            allowed_zones: vec![],
        });
        return next.run(req).await;
    }

    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|t| t.to_string())
        .or_else(|| {
            let uri = req.uri();
            let q = uri.query().unwrap_or("");
            url_form_decode(q).into_iter()
                .find(|(k, _)| k == "token")
                .map(|(_, v)| v)
        });

    let Some(token) = token else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Some(info) = s.auth.validate(&token).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let must_change = info.must_change_password;
    req.extensions_mut().insert(AuthUser {
        username: info.username,
        role: info.role,
        must_change_password: must_change,
        allowed_zones: info.allowed_zones,
    });
    next.run(req).await
}

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub username: String,
    pub role: Role,
    pub must_change_password: bool,
    /// Empty = all zones allowed.
    pub allowed_zones: Vec<String>,
}

/// When the user is flagged "must change password", any API call other
/// than the self-service trio (`/api/auth/change-password`, `whoami`,
/// `logout`) is rejected with 403 + a sentinel error code so the
/// frontend can route to the dedicated screen. This middleware must run
/// AFTER `require_auth`.
async fn require_password_changed(req: Request, next: Next) -> Response {
    if let Some(user) = req.extensions().get::<AuthUser>() {
        if user.must_change_password {
            return (
                StatusCode::FORBIDDEN,
                axum::Json(serde_json::json!({
                    "error":  "password_change_required",
                    "detail": "you must change your password before using the API",
                })),
            ).into_response();
        }
    }
    next.run(req).await
}

/// Reject the request if the caller's role is below `min`. Must run
/// AFTER `require_auth` so the `AuthUser` extension is populated.
fn check_role(req: &Request, min: Role) -> Option<StatusCode> {
    let Some(user) = req.extensions().get::<AuthUser>() else {
        return Some(StatusCode::UNAUTHORIZED);
    };
    if user.role < min { Some(StatusCode::FORBIDDEN) } else { None }
}

async fn require_operator(req: Request, next: Next) -> Response {
    if let Some(code) = check_role(&req, Role::Operator) {
        return code.into_response();
    }
    next.run(req).await
}

async fn require_supervisor(req: Request, next: Next) -> Response {
    if let Some(code) = check_role(&req, Role::Supervisor) {
        return code.into_response();
    }
    next.run(req).await
}

async fn require_admin(req: Request, next: Next) -> Response {
    if let Some(code) = check_role(&req, Role::Admin) {
        return code.into_response();
    }
    next.run(req).await
}

/// Optional auth: tries to authenticate from the bearer token / `?token=` query
/// parameter. If the token is missing or invalid, inserts an anonymous
/// `AuthUser` with `Role::Viewer` so all downstream handlers still have an
/// `AuthUser` in extensions. Routes that need more than read access still apply
/// `require_operator` / `require_admin` on top of this.
///
/// Used by the runtime router (port 8443) to allow anonymous read-only access
/// to the synoptic SPA without removing the role-check guards on write routes.
async fn optional_auth(
    State(s): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t.to_string())
        .or_else(|| {
            let q = req.uri().query().unwrap_or("");
            url_form_decode(q).into_iter()
                .find(|(k, _)| k == "token")
                .map(|(_, v)| v)
        });

    let auth_user = if let Some(tok) = token {
        if let Some(info) = s.auth.validate(&tok).await {
            AuthUser {
                username: info.username,
                role: info.role,
                must_change_password: info.must_change_password,
                allowed_zones: info.allowed_zones,
            }
        } else {
            // Expired / unknown token → anonymous
            AuthUser { username: String::new(), role: Role::Viewer, must_change_password: false, allowed_zones: vec![] }
        }
    } else {
        // No token → anonymous read-only
        AuthUser { username: String::new(), role: Role::Viewer, must_change_password: false, allowed_zones: vec![] }
    };
    req.extensions_mut().insert(auth_user);
    next.run(req).await
}

/// Minimal application/x-www-form-urlencoded parser — only handles the
/// shape we need (`k=v&k2=v2`) without pulling in a dep.
fn url_form_decode(q: &str) -> Vec<(String, String)> {
    q.split('&')
        .filter(|p| !p.is_empty())
        .filter_map(|p| {
            let mut it = p.splitn(2, '=');
            let k = it.next()?.to_string();
            let v = it.next().unwrap_or("").to_string();
            Some((k, v))
        })
        .collect()
}

// ── Cert download ─────────────────────────────────────────────────────────────

/// Serve the TLS certificate PEM so users can import it into their browser.
/// Open endpoint (no auth) — the cert is the public key only, no secret.
async fn get_cert(State(s): State<AppState>) -> Response {
    let Some(ref path) = s.cert_path else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match tokio::fs::read(path.as_ref()).await {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/x-pem-file")
            .header(header::CONTENT_DISPOSITION, "attachment; filename=\"sws.crt\"")
            .body(axum::body::Body::from(bytes))
            .unwrap(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// ── Auth endpoints ───────────────────────────────────────────────────────────

async fn login(
    State(s): State<AppState>,
    peer: Option<axum::extract::Extension<std::net::SocketAddr>>,
    headers: axum::http::HeaderMap,
    Json(creds): Json<Credentials>,
) -> Response {
    // IP allowlist check — only enforced when SWS_IP_ALLOWLIST is set.
    if !s.ip_allowlist.is_empty() {
        let peer_ip: Option<std::net::IpAddr> = peer
            .map(|axum::extract::Extension(sa)| sa.ip())
            .or_else(|| {
                headers.get("x-forwarded-for")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.split(',').next())
                    .and_then(|ip| ip.trim().parse().ok())
            });
        let allowed = peer_ip.map_or(false, |ip| {
            s.ip_allowlist.iter().any(|(net, prefix)| ip_in_cidr(ip, *net, *prefix))
        });
        if !allowed {
            warn!(peer = ?peer_ip, "login blocked by IP allowlist");
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    match s.auth.login(&creds).await {
        Ok(ok) => Json(ok).into_response(),
        Err(LoginError::BadCredentials) => StatusCode::UNAUTHORIZED.into_response(),
        Err(LoginError::RateLimited { retry_after_secs }) => (
            StatusCode::TOO_MANY_REQUESTS,
            [(axum::http::header::RETRY_AFTER, retry_after_secs.to_string())],
        ).into_response(),
    }
}

/// Returns true when `ip` falls within the CIDR block `network/prefix_len`.
fn ip_in_cidr(ip: std::net::IpAddr, network: std::net::IpAddr, prefix_len: u8) -> bool {
    use std::net::IpAddr;
    match (ip, network) {
        (IpAddr::V4(ip4), IpAddr::V4(net4)) => {
            if prefix_len == 0 { return true; }
            let shift = 32u32.saturating_sub(prefix_len as u32);
            u32::from(ip4) >> shift == u32::from(net4) >> shift
        }
        (IpAddr::V6(ip6), IpAddr::V6(net6)) => {
            if prefix_len == 0 { return true; }
            let shift = 128u128.saturating_sub(prefix_len as u128);
            u128::from(ip6) >> shift == u128::from(net6) >> shift
        }
        _ => false, // IPv4 vs IPv6 mismatch
    }
}

async fn logout(
    State(s): State<AppState>,
    req: Request,
) -> StatusCode {
    let token = req.headers().get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));
    if let Some(t) = token { s.auth.logout(t).await; }
    StatusCode::NO_CONTENT
}

/// Slide the session TTL and return the refreshed expiry timestamp.
/// The client uses this to reschedule its proactive refresh timer.
/// Returns 401 when the token is already expired (client should re-login).
async fn refresh_session(
    State(s): State<AppState>,
    req: Request,
) -> Response {
    let token = req.headers().get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));
    let Some(token) = token else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    match s.auth.touch(token).await {
        Some(expires_at_ms) => Json(serde_json::json!({ "expires_at_ms": expires_at_ms })).into_response(),
        None                => StatusCode::UNAUTHORIZED.into_response(),
    }
}

#[derive(serde::Serialize)]
struct Whoami {
    username: String,
    role: Role,
    must_change_password: bool,
}

async fn whoami(req: Request) -> Json<Whoami> {
    // require_auth has already inserted AuthUser; missing here would be a bug.
    let user = req.extensions().get::<AuthUser>().cloned()
        .unwrap_or(AuthUser { username: String::new(), role: Role::Viewer, must_change_password: false, allowed_zones: vec![] });
    Json(Whoami {
        username: user.username,
        role: user.role,
        must_change_password: user.must_change_password,
    })
}

#[allow(dead_code)]
fn _force_login_ok_used(_: LoginOk) {}

// ── User CRUD (admin) ────────────────────────────────────────────────────────

async fn list_users(State(s): State<AppState>) -> Json<Vec<sws_auth::UserSummary>> {
    Json(s.auth.list_users().await)
}

async fn create_user(
    State(s): State<AppState>,
    Json(body): Json<sws_auth::CreateUser>,
) -> Response {
    match s.auth.create_user(body).await {
        Ok(u)  => (StatusCode::CREATED, Json(u)).into_response(),
        Err(e) => user_error_to_response(e),
    }
}

async fn update_user(
    State(s): State<AppState>,
    Path(username): Path<String>,
    Json(patch): Json<sws_auth::UserPatch>,
) -> Response {
    match s.auth.update_user(&username, patch).await {
        Ok(u)  => Json(u).into_response(),
        Err(e) => user_error_to_response(e),
    }
}

async fn delete_user(
    State(s): State<AppState>,
    Path(username): Path<String>,
    req: Request,
) -> Response {
    // Forbid an admin from deleting their own currently-logged-in account —
    // this would lock the operator out of their own session immediately.
    if let Some(caller) = req.extensions().get::<AuthUser>() {
        if caller.username == username {
            return (StatusCode::CONFLICT,
                    Json(serde_json::json!({"error": "cannot_delete_self"})))
                .into_response();
        }
    }
    match s.auth.delete_user(&username).await {
        Ok(())  => StatusCode::NO_CONTENT.into_response(),
        Err(e)  => user_error_to_response(e),
    }
}

async fn change_password(
    State(s): State<AppState>,
    req: Request,
) -> Response {
    let user = match req.extensions().get::<AuthUser>().cloned() {
        Some(u) => u,
        None    => return StatusCode::UNAUTHORIZED.into_response(),
    };
    // Re-read the JSON body manually since we already consumed `req` for
    // extensions. axum 0.7 doesn't let us pass both req and Json by value
    // without re-architecting the handler — extract the body manually.
    let bytes = match axum::body::to_bytes(req.into_body(), 64 * 1024).await {
        Ok(b)  => b,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("body: {e}")).into_response(),
    };
    let body: sws_auth::ChangePassword = match serde_json::from_slice(&bytes) {
        Ok(b)  => b,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("json: {e}")).into_response(),
    };
    match s.auth.change_password(&user.username, body).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => user_error_to_response(e),
    }
}

fn user_error_to_response(e: sws_auth::UserError) -> Response {
    use sws_auth::UserError::*;
    let (code, msg) = match &e {
        NotFound          => (StatusCode::NOT_FOUND,           "not_found"),
        AlreadyExists     => (StatusCode::CONFLICT,            "already_exists"),
        LastAdmin         => (StatusCode::CONFLICT,            "last_admin"),
        InvalidPassword   => (StatusCode::UNPROCESSABLE_ENTITY,"invalid_password"),
        StorageError(_)   => (StatusCode::INTERNAL_SERVER_ERROR,"storage_error"),
    };
    (code, Json(serde_json::json!({
        "error":  msg,
        "detail": e.to_string(),
    }))).into_response()
}

// ── Tag endpoints ────────────────────────────────────────────────────────────

async fn get_all_tags(State(s): State<AppState>) -> Json<HashMap<TagId, TagState>> {
    Json(s.db.snapshot().await)
}

async fn get_tag(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    match s.db.get(&id).await {
        Some(state) => Json(state).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[derive(Deserialize)]
struct WriteTagBody { value: TagValue }

async fn write_tag(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<WriteTagBody>,
) -> StatusCode {
    // Prefer routing through a plugin (so the value is pushed to the device).
    // If no plugin owns the tag (purely virtual / scripted tags), fall back to
    // setting the TagDb directly so the UI write path keeps working.
    match s.bus.write(&id, body.value.clone()).await {
        Ok(()) => StatusCode::ACCEPTED,
        Err(WriteError::NoWriter(_)) => {
            s.db.set(id, body.value, TagQuality::Good).await;
            StatusCode::NO_CONTENT
        }
        Err(e @ WriteError::ChannelClosed(_)) => {
            warn!("write_tag: {e}");
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}

// ── Script execution ─────────────────────────────────────────────────────────
//
// NOTE: scripts run with full Python privileges — no RestrictedPython yet
// (Q1 in docs/OPEN_QUESTIONS.md). Once auth lands this endpoint will be
// gated; for now the assumption is that the LAN is private.

#[derive(Deserialize)]
struct ScriptBody {
    code: String,
}

#[derive(serde::Serialize, Default)]
struct ScriptResult {
    ok: bool,
    /// Captured stdout from the script (empty string if none).
    stdout: String,
    /// Captured stderr — including the formatted traceback when the script raised.
    stderr: String,
    /// True when the script ran through RestrictedPython.
    sandboxed: bool,
    /// Human-readable error string on failure / timeout.
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

async fn exec_script(
    State(s): State<AppState>,
    Json(body): Json<ScriptBody>,
) -> Json<ScriptResult> {
    match s.py.execute(body.code).await {
        Ok(ExecOutput { stdout, stderr, sandboxed }) => {
            metrics::counter!("sws_script_exec_total", "endpoint" => "exec", "status" => "ok").increment(1);
            Json(ScriptResult { ok: true, stdout, stderr, sandboxed, error: None })
        }
        Err(e) => {
            metrics::counter!("sws_script_exec_total", "endpoint" => "exec", "status" => "error").increment(1);
            Json(ScriptResult {
                ok: false, error: Some(e), sandboxed: s.py.is_sandboxed(),
                ..Default::default()
            })
        }
    }
}

// ── Historian endpoints ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct HistoryQuery {
    from: Option<u64>,
    to:   Option<u64>,
    /// If provided, returns at most the last `limit` samples in the range.
    limit: Option<usize>,
    /// When true, transparently backfills from the OPC-UA server's historian
    /// for any tag that originates from an OPC-UA source. Merged with and
    /// deduplicated against the local historian samples.
    #[serde(default)]
    backfill: bool,
}

async fn get_history(
    State(s): State<AppState>,
    Path(tag): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Json<Vec<Sample>> {
    let mut samples = s.historian.query(&tag, q.from, q.to).await;

    if q.backfill {
        samples = opcua_backfill_history(&s, &tag, q.from, q.to, samples).await;
    }

    if let Some(n) = q.limit {
        if samples.len() > n {
            samples = samples.split_off(samples.len() - n);
        }
    }
    Json(samples)
}

// ── Feature #4: CSV export ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ExportCsvQuery {
    /// Comma-separated list of tag IDs.
    tags: Option<String>,
    from_ms: Option<u64>,
    to_ms:   Option<u64>,
}

/// GET /api/history/export?tags=a,b&from_ms=&to_ms=
/// Returns a CSV file with columns: ts_ms,ts_iso,tag_id,value,quality.
/// `ts_iso` is RFC 3339 UTC (e.g. 2026-05-22T10:30:00.000Z).
async fn export_history_csv(
    State(s): State<AppState>,
    Query(q): Query<ExportCsvQuery>,
) -> impl IntoResponse {
    let tag_list: Vec<String> = q.tags
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(String::from)
        .collect();

    if tag_list.is_empty() {
        return (StatusCode::BAD_REQUEST, "tag parameter 'tags' required").into_response();
    }

    struct Row { ts_ms: u64, tag: String, val: String, quality: &'static str }
    let mut rows: Vec<Row> = Vec::new();

    for tag in &tag_list {
        let samples = s.historian.query(tag, q.from_ms, q.to_ms).await;
        for sample in samples {
            let val = match &sample.value {
                TagValue::Float(f) => format!("{f}"),
                TagValue::Int(i)   => format!("{i}"),
                TagValue::Bool(b)  => if *b { "1".into() } else { "0".into() },
                TagValue::Str(s)   => format!("\"{s}\""),
            };
            let quality = match sample.quality {
                TagQuality::Good      => "Good",
                TagQuality::Bad       => "Bad",
                TagQuality::Uncertain => "Uncertain",
            };
            rows.push(Row { ts_ms: sample.ts_ms, tag: tag.clone(), val, quality });
        }
    }

    rows.sort_by_key(|r| r.ts_ms);

    let mut csv = String::from("ts_ms,ts_iso,tag_id,value,quality\n");
    for r in &rows {
        let iso = ms_to_iso(r.ts_ms);
        csv.push_str(&format!("{},{},{},{},{}\n", r.ts_ms, iso, r.tag, r.val, r.quality));
    }

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE,        "text/csv; charset=utf-8"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"export.csv\""),
        ],
        csv,
    ).into_response()
}

/// Convert a Unix millisecond timestamp to a compact ISO 8601 UTC string
/// (e.g. "2026-05-22T10:30:00.123Z") without requiring the `formatting`
/// feature of the `time` crate.
fn ms_to_iso(ts_ms: u64) -> String {
    use time::OffsetDateTime;
    let secs = (ts_ms / 1000) as i64;
    let millis = (ts_ms % 1000) as u32;
    match OffsetDateTime::from_unix_timestamp(secs) {
        Ok(dt) => {
            let mo = dt.month() as u8;
            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
                dt.year(), mo, dt.day(),
                dt.hour(), dt.minute(), dt.second(),
                millis
            )
        }
        Err(_) => format!("{ts_ms}"),
    }
}

// ── Feature #5: Statistiche aggregate ────────────────────────────────────────

#[derive(Deserialize)]
struct StatsQuery {
    from_ms: Option<u64>,
    to_ms:   Option<u64>,
}

#[derive(serde::Serialize)]
struct HistoryStats {
    tag: String,
    count: usize,
    min: f64,
    max: f64,
    avg: f64,
    stddev: f64,
    first_ts: Option<u64>,
    last_ts:  Option<u64>,
}

/// GET /api/history/:tag/stats?from_ms=&to_ms=
async fn tag_history_stats(
    State(s): State<AppState>,
    Path(tag): Path<String>,
    Query(q): Query<StatsQuery>,
) -> impl IntoResponse {
    let samples = s.historian.query(&tag, q.from_ms, q.to_ms).await;

    let nums: Vec<f64> = samples.iter().filter_map(|s| match &s.value {
        TagValue::Float(f) => Some(*f),
        TagValue::Int(i)   => Some(*i as f64),
        TagValue::Bool(b)  => Some(if *b { 1.0 } else { 0.0 }),
        TagValue::Str(v)   => v.trim().parse().ok(),
    }).collect();

    if nums.is_empty() {
        return Json(HistoryStats {
            tag,
            count: 0, min: 0.0, max: 0.0, avg: 0.0, stddev: 0.0,
            first_ts: None, last_ts: None,
        }).into_response();
    }

    let count = nums.len();
    let min = nums.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let avg = nums.iter().sum::<f64>() / count as f64;
    let variance = nums.iter().map(|v| (v - avg).powi(2)).sum::<f64>() / count as f64;
    let stddev = variance.sqrt();

    Json(HistoryStats {
        tag,
        count,
        min,
        max,
        avg,
        stddev,
        first_ts: samples.first().map(|s| s.ts_ms),
        last_ts:  samples.last().map(|s| s.ts_ms),
    }).into_response()
}

/// If `tag` is subscribed from an OPC-UA source, query that server's historian
/// and merge the results with the existing local `samples`. No-ops silently when
/// the project can't be loaded or the tag has no OPC-UA source.
async fn opcua_backfill_history(
    s: &AppState,
    tag: &str,
    from_ms: Option<u64>,
    to_ms:   Option<u64>,
    mut local: Vec<Sample>,
) -> Vec<Sample> {
    let Ok(dir) = active_dir(s).await else { return local };
    let Ok(project) = sws_core::project::Project::load(&dir) else { return local };

    // Find the OPC-UA source that maps this tag to a node_id.
    for source in &project.sources {
        let SourceDef::OpcUaClient(cfg) = source else { continue };
        let Some(mapping) = cfg.nodes.iter().find(|n| n.tag == tag) else { continue };

        match sws_plugin_opcua::read_history(cfg, &mapping.node_id, from_ms, to_ms, 1000).await {
            Ok(hist) => {
                // Build the set of timestamps already in local storage to
                // avoid adding duplicates for the overlap period.
                let local_ts: std::collections::HashSet<u64> =
                    local.iter().map(|s| s.ts_ms).collect();
                for h in hist {
                    if local_ts.contains(&h.ts_ms) { continue; }
                    local.push(Sample {
                        ts_ms:   h.ts_ms,
                        value:   TagValue::Float(h.value),
                        quality: match h.quality {
                            "Good"      => TagQuality::Good,
                            "Bad"       => TagQuality::Bad,
                            _           => TagQuality::Uncertain,
                        },
                    });
                }
                local.sort_unstable_by_key(|s| s.ts_ms);
                return local;
            }
            Err(e) => {
                warn!(tag = %tag, node = %mapping.node_id, "opcua history backfill: {e}");
                return local;
            }
        }
    }
    local
}

// ── Datastore endpoints ──────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct DatastoreListItem {
    id: String,
    connected: bool,
    error: Option<String>,
}

async fn list_datastores(State(s): State<AppState>) -> Json<Vec<DatastoreListItem>> {
    if let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) {
        let stats = reg.all_stats().await;
        return Json(stats.into_iter().map(|(id, st)| DatastoreListItem {
            id,
            connected: st.connected,
            error: st.error,
        }).collect());
    }
    Json(vec![])
}

/// Load a datastore backend from project.yaml for one-shot ops (test / stats).
async fn backend_from_project(
    s: &AppState,
    id: &str,
) -> Result<sws_historian::DatastoreBackend, Response> {
    let dir = active_dir(s).await.map_err(|c| c.into_response())?;
    let project = sws_core::project::Project::load(&dir)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR,
                      format!("cannot load project: {e}")).into_response())?;
    let cfg = project.datastores.into_iter().find(|d| d.id == id)
        .ok_or_else(|| (StatusCode::NOT_FOUND,
                        format!("datastore '{id}' not found")).into_response())?;
    sws_historian::DatastoreBackend::from_config(&cfg.backend, &dir).await
        .map_err(|e| (StatusCode::BAD_GATEWAY,
                      format!("cannot connect: {e}")).into_response())
}

async fn datastore_stats(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    // Live registry first; fall back to one-shot query from project config.
    if let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) {
        if let Some(stats) = reg.backend_stats(&id).await {
            if let Some(ref err) = stats.error {
                warn!(datastore_id = %id, "datastore stats error: {err}");
            }
            return Json(stats).into_response();
        }
    }
    match backend_from_project(&s, &id).await {
        Ok(backend) => {
            let stats = backend.stats().await;
            if let Some(ref err) = stats.error {
                warn!(datastore_id = %id, "datastore stats error: {err}");
            }
            Json(stats).into_response()
        }
        Err(r) => r,
    }
}

async fn datastore_test(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    // Live registry first.
    if let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) {
        if reg.backend_ids().contains(&id) {
            return match reg.test_backend(&id).await {
                Ok(msg)  => Json(msg).into_response(),
                Err(e)   => {
                    warn!(datastore_id = %id, "datastore test failed: {e}");
                    (StatusCode::BAD_GATEWAY, e.to_string()).into_response()
                }
            };
        }
    }
    // Not in registry — one-shot test from project config (common when the
    // user just saved a new datastore and clicks Test before restarting).
    match backend_from_project(&s, &id).await {
        Ok(backend) => match backend.test().await {
            Ok(msg)  => Json(msg).into_response(),
            Err(e)   => {
                warn!(datastore_id = %id, "datastore test failed: {e}");
                (StatusCode::BAD_GATEWAY, e.to_string()).into_response()
            }
        },
        Err(r) => r,
    }
}

#[derive(serde::Deserialize)]
struct PurgeBody {
    retention_rows: Option<u64>,
    retention_days: Option<u64>,
}

async fn datastore_purge(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<PurgeBody>,
) -> Response {
    let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) else {
        return (StatusCode::NOT_FOUND, "no datastores configured").into_response();
    };
    match reg.purge_backend(&id, body.retention_rows, body.retention_days).await {
        Ok(n)  => Json(serde_json::json!({ "deleted": n })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(serde::Deserialize)]
struct ExportQuery {
    tags:    Option<String>, // comma-separated tag ids
    from_ms: Option<u64>,
    to_ms:   Option<u64>,
}

#[derive(serde::Serialize)]
struct ExportTagResult {
    tag_id: String,
    samples: Vec<Sample>,
}

async fn datastore_export(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<ExportQuery>,
) -> Response {
    let Some(reg) = s.registry.read().await.as_ref().map(Arc::clone) else {
        return (StatusCode::NOT_FOUND, "no datastores configured").into_response();
    };
    let tags: Vec<String> = q.tags.unwrap_or_default()
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    match reg.export_backend(&id, &tags, q.from_ms, q.to_ms).await {
        Ok(pairs) => {
            let out: Vec<ExportTagResult> = pairs.into_iter()
                .map(|(tag_id, samples)| ExportTagResult { tag_id, samples })
                .collect();
            Json(out).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// ── Alarm endpoints ──────────────────────────────────────────────────────────

async fn get_alarms(State(s): State<AppState>) -> Json<Vec<AlarmState>> {
    Json(s.alarms.snapshot().await)
}

#[derive(serde::Deserialize, Default)]
struct AckRequest {
    #[serde(default)]
    by: Option<String>,
}

async fn ack_alarm(
    State(s): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<AckRequest>>,
) -> StatusCode {
    let by = body.and_then(|b| b.by.clone());
    if s.alarms.ack(&id, by).await { StatusCode::NO_CONTENT } else { StatusCode::NOT_FOUND }
}

#[derive(serde::Deserialize, Default)]
struct AlarmHistoryQuery {
    alarm_id: Option<String>,
    from_ms:  Option<u64>,
    to_ms:    Option<u64>,
    #[serde(default = "default_limit")]
    limit:    usize,
}
fn default_limit() -> usize { 200 }

async fn get_alarm_history(
    State(s): State<AppState>,
    Query(q): Query<AlarmHistoryQuery>,
) -> Json<Vec<AlarmEvent>> {
    // Try SQLite first; fall back to in-memory journal.
    let events = if let Some(store) = s.historian.sqlite_store().await {
        store.query_alarm_events(
            q.alarm_id.as_deref(),
            q.from_ms,
            q.to_ms,
            q.limit,
        ).await
    } else {
        s.alarms.journal_snapshot(q.limit).await
    };
    Json(events)
}

#[derive(serde::Deserialize)]
struct ShelveRequest {
    reason: String,
    /// Duration in milliseconds; 0 = indefinite.
    #[serde(default)]
    duration_ms: u64,
    #[serde(default)]
    shelved_by: String,
}

async fn shelve_alarm(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ShelveRequest>,
) -> StatusCode {
    if s.alarms.shelve(&id, body.reason, body.duration_ms, body.shelved_by).await {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

async fn unshelve_alarm(State(s): State<AppState>, Path(id): Path<String>) -> StatusCode {
    s.alarms.unshelve(&id).await;
    StatusCode::NO_CONTENT
}

async fn list_shelved_alarms(State(s): State<AppState>) -> Json<Vec<sws_core::ShelvedAlarm>> {
    Json(s.alarms.shelved_snapshot().await)
}

async fn ws_alarms_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_alarms_ws(socket, s.alarms))
}

async fn handle_alarms_ws(mut socket: WebSocket, alarms: Arc<AlarmDb>) {
    // Send the current snapshot first so a fresh client sees the full state,
    // then forward live broadcasts.
    for state in alarms.snapshot().await {
        if let Ok(text) = serde_json::to_string(&state) {
            if socket.send(Message::Text(text)).await.is_err() { return; }
        }
    }
    let mut rx = alarms.subscribe();
    loop {
        match rx.recv().await {
            Ok(state) => {
                if let Ok(text) = serde_json::to_string(&state) {
                    if socket.send(Message::Text(text)).await.is_err() { break; }
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                warn!("ws/alarms subscriber lagged by {n}");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}

// ── Project endpoints ─────────────────────────────────────────────────────────

/// Marker the API substitutes for stored MQTT passwords on GET responses.
/// The PUT handler treats this exact string as "keep the previous value"
/// so a round-trip GET → edit → PUT through the editor doesn't accidentally
/// wipe a secret the operator can't see.
const MASKED_PASSWORD: &str = "********";

async fn get_project(State(s): State<AppState>) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(code) => return code.into_response(),
    };
    match Project::load(&dir) {
        Ok(mut project) => {
            mask_project_secrets(&mut project);
            Json(project).into_response()
        }
        Err(e) => {
            tracing::error!("project load failed: {e:#}");
            (StatusCode::INTERNAL_SERVER_ERROR,
             format!("project parse error: {e}")).into_response()
        }
    }
}

/// Replace any sensitive field on the project with the placeholder
/// constant before it's serialised to the caller.
fn mask_project_secrets(project: &mut Project) {
    for src in &mut project.sources {
        if let SourceDef::Mqtt(c) = src {
            if c.password.is_some() {
                c.password = Some(MASKED_PASSWORD.to_string());
            }
        }
    }
    if let Some(notif) = &mut project.notifications {
        if let Some(smtp) = &mut notif.smtp {
            if smtp.password.is_some() {
                smtp.password = Some(MASKED_PASSWORD.to_string());
            }
        }
    }
}

/// Read project.yaml (or build a minimal default), apply `f`, write back.
async fn patch_project<F>(project_dir: &std::path::Path, f: F) -> StatusCode
where
    F: FnOnce(&mut Project),
{
    let mut project = Project::load(project_dir).unwrap_or_else(|_| Project {
        meta: ProjectMeta { name: "default".into(), version: "0.1.0".into() },
        tags: vec![],
        sources: vec![],
        alarms: vec![],
        functions: vec![],
        custom_symbols: vec![],
        datastores: vec![],
        global_scripts: vec![],
        notifications: None,
    });
    f(&mut project);
    if let Err(e) = tokio::fs::create_dir_all(project_dir).await {
        warn!("cannot create project dir: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    let path = project_dir.join("project.yaml");
    match serde_yaml::to_string(&project) {
        Ok(yaml) => match tokio::fs::write(&path, yaml).await {
            Ok(_)  => StatusCode::NO_CONTENT,
            Err(e) => { warn!("write project.yaml: {e}"); StatusCode::INTERNAL_SERVER_ERROR }
        },
        Err(e) => { warn!("serialize project: {e}"); StatusCode::INTERNAL_SERVER_ERROR }
    }
}

async fn update_project_tags(
    State(s): State<AppState>,
    Json(tags): Json<Vec<TagDef>>,
) -> StatusCode {
    // Compute diff against current TagDb so newly-defined tags get seeded
    // and orphans get evicted — no runtime restart required.
    let current_ids: std::collections::HashSet<TagId> =
        s.db.snapshot().await.into_keys().collect();
    let new_ids: std::collections::HashSet<TagId> =
        tags.iter().map(|t| t.id.clone()).collect();

    let to_add: Vec<TagDef> = tags.iter()
        .filter(|t| !current_ids.contains(&t.id))
        .cloned()
        .collect();
    let to_remove: Vec<TagId> = current_ids
        .difference(&new_ids)
        .cloned()
        .collect();
    // Collect derived pairs before tags is consumed by patch_project closure.
    let derived: Vec<(String, String)> = tags.iter()
        .filter_map(|t| t.expression.as_ref().map(|e| (t.id.clone(), e.clone())))
        .collect();

    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c };
    let status = patch_project(&dir, |p| p.tags = tags).await;
    if status != StatusCode::NO_CONTENT {
        return status;
    }
    for t in &to_add {
        s.db.set(t.id.clone(), t.initial_value(), TagQuality::Uncertain).await;
    }
    for id in &to_remove {
        s.db.remove(id).await;
    }
    *s.derived_tags.write().await = derived;
    status
}

/// POST /api/project/tags/import-csv
/// Body: plain text CSV (UTF-8). First row must be a header row containing
/// at least `id`. Optional columns: `data_type`, `description`, `history`,
/// `expression`. Unknown columns are ignored.
/// Behaviour: merges the uploaded tags with the existing project tags — adds
/// new ones, updates matching IDs, leaves unmentioned tags unchanged.
async fn import_tags_csv(
    State(s): State<AppState>,
    body: Bytes,
) -> Response {
    let text = match std::str::from_utf8(&body) {
        Ok(t) => t,
        Err(_) => return (StatusCode::BAD_REQUEST, "CSV must be UTF-8").into_response(),
    };

    let mut lines = text.lines();
    let header_line = match lines.next() {
        Some(h) => h,
        None    => return (StatusCode::BAD_REQUEST, "Empty CSV").into_response(),
    };

    // Parse header to find column indices.
    let cols: Vec<&str> = header_line.split(',').map(str::trim).collect();
    let col = |name: &str| -> Option<usize> { cols.iter().position(|&c| c == name) };
    let Some(id_col) = col("id") else {
        return (StatusCode::BAD_REQUEST, "CSV missing 'id' column").into_response();
    };
    let dt_col   = col("data_type");
    let desc_col = col("description");
    let hist_col = col("history");
    let expr_col = col("expression");

    // Parse data rows.
    let mut imported: Vec<TagDef> = Vec::new();
    for (line_no, line) in lines.enumerate() {
        let line = line.trim();
        if line.is_empty() { continue; }
        let fields: Vec<&str> = line.split(',').collect();
        let get = |idx: usize| fields.get(idx).map(|s| s.trim()).unwrap_or("");
        let id = get(id_col);
        if id.is_empty() { continue; }
        let tag = TagDef {
            id: id.to_string(),
            description: desc_col.map(|i| get(i).to_string()).unwrap_or_default(),
            data_type: dt_col.map(|i| get(i).to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "float".into()),
            history: hist_col.map(|i| matches!(get(i).to_lowercase().as_str(), "true" | "1" | "yes")).unwrap_or(false),
            datastore_id: None,
            history_deadband: None,
            history_min_interval_ms: None,
            expression: expr_col.map(|i| get(i).to_string()).filter(|s| !s.is_empty()),
        };
        let _ = line_no; // suppress warning
        imported.push(tag);
    }

    if imported.is_empty() {
        return (StatusCode::BAD_REQUEST, "No valid rows in CSV").into_response();
    }

    // Merge: load current, upsert imported.
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let status = patch_project(&dir, |p| {
        for new_tag in &imported {
            if let Some(existing) = p.tags.iter_mut().find(|t| t.id == new_tag.id) {
                *existing = new_tag.clone();
            } else {
                p.tags.push(new_tag.clone());
            }
        }
    }).await;
    if status != StatusCode::NO_CONTENT {
        return status.into_response();
    }
    // Seed any newly-added tags into TagDb.
    let current_ids: std::collections::HashSet<TagId> = s.db.snapshot().await.into_keys().collect();
    for t in &imported {
        if !current_ids.contains(&t.id) {
            s.db.set(t.id.clone(), t.initial_value(), TagQuality::Uncertain).await;
        }
    }
    // Re-sync derived tags (re-load updated project from disk).
    let dir2 = active_dir(&s).await.ok();
    if let Some(dir2) = dir2 {
        if let Ok(proj) = Project::load(&dir2) {
            let derived: Vec<(String, String)> = proj.tags.iter()
                .filter_map(|t| t.expression.as_ref().map(|e| (t.id.clone(), e.clone())))
                .collect();
            *s.derived_tags.write().await = derived;
        }
    }
    Json(serde_json::json!({ "imported": imported.len() })).into_response()
}

async fn update_project_sources(
    State(s): State<AppState>,
    Json(mut sources): Json<Vec<SourceDef>>,
) -> StatusCode {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c };
    // Restore masked secrets: any MQTT source whose password came back as
    // the placeholder string is interpreted as "leave unchanged" — we look
    // the previous value up from the on-disk project. Without this round
    // a normal edit through the UI would wipe stored passwords.
    let previous = Project::load(&dir).ok();
    if let Some(prev) = previous.as_ref() {
        for src in &mut sources {
            if let SourceDef::Mqtt(new_cfg) = src {
                if matches!(&new_cfg.password, Some(p) if p == MASKED_PASSWORD) {
                    let prev_pw = prev.sources.iter().find_map(|s| match s {
                        SourceDef::Mqtt(c) if c.id == new_cfg.id => c.password.clone(),
                        _ => None,
                    });
                    new_cfg.password = prev_pw;
                }
            }
        }
    }

    // Hot-reload: persist first, then diff against the supervisor's current
    // set. New/removed sources are spawned/cancelled in-place — no runtime
    // restart needed.
    let clone = sources.clone();
    let status = patch_project(&dir, |p| p.sources = sources).await;
    if status == StatusCode::NO_CONTENT {
        s.supervisor.reload(clone).await;
    }
    status
}

async fn update_project_alarms(
    State(s): State<AppState>,
    Json(alarms): Json<Vec<AlarmDef>>,
) -> StatusCode {
    // Hot-reload: AlarmDb::load fully replaces the registry (clear + insert).
    // In-flight active alarms are reset; the next TagDb update will re-evaluate
    // and re-fire any still-tripped conditions.
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c };
    let clone = alarms.clone();
    let status = patch_project(&dir, |p| p.alarms = alarms).await;
    if status == StatusCode::NO_CONTENT {
        s.alarms.load(clone).await;
    }
    status
}

/// Validate + persist + hot-swap the reusable Python functions list.
/// Rejects unsafe param names and oversized code bodies before writing.
async fn update_project_functions(
    State(s): State<AppState>,
    Json(functions): Json<Vec<FunctionDef>>,
) -> Response {
    // 1. Code-size cap — keeps `project.yaml` from ballooning.
    for f in &functions {
        if f.code.len() > MAX_FUNCTION_CODE_BYTES {
            return (StatusCode::PAYLOAD_TOO_LARGE,
                format!("function '{}' code is {} bytes; max {}",
                    f.name, f.code.len(), MAX_FUNCTION_CODE_BYTES)).into_response();
        }
    }

    // 2. Param-name validation — must be a Python identifier, not a keyword.
    for f in &functions {
        for p in &f.params {
            if !is_valid_python_identifier(&p.name) {
                return (StatusCode::UNPROCESSABLE_ENTITY,
                    format!("function '{}': param '{}' is not a valid Python identifier",
                        f.name, p.name)).into_response();
            }
        }
    }

    // 3. Unique names — the registry is keyed by `name`; duplicates collapse
    //    silently otherwise.
    let mut seen = std::collections::HashSet::new();
    for f in &functions {
        if !seen.insert(f.name.as_str()) {
            return (StatusCode::UNPROCESSABLE_ENTITY,
                format!("duplicate function name '{}'", f.name)).into_response();
        }
    }

    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let clone = functions.clone();
    let status = patch_project(&dir, |p| p.functions = functions).await;
    if status == StatusCode::NO_CONTENT {
        let mut map = s.functions.write().await;
        map.clear();
        for f in clone { map.insert(f.name.clone(), f); }
    }
    status.into_response()
}

async fn update_project_custom_symbols(
    State(s): State<AppState>,
    Json(symbols): Json<Vec<CustomSymbol>>,
) -> StatusCode {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c };
    patch_project(&dir, |p| p.custom_symbols = symbols).await
}

async fn update_project_datastores(
    State(s): State<AppState>,
    Json(datastores): Json<Vec<sws_core::DatastoreConfig>>,
) -> StatusCode {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c };
    patch_project(&dir, |p| p.datastores = datastores).await
}

// ── Project import / export (Admin only) ─────────────────────────────────────
//
// Bundle layout inside the ZIP:
//   manifest.json         {"format_version":"1.0","name":"...","exported_at_ms":...,"secrets_masked":true}
//   project.yaml          MQTT passwords stripped (`None`)
//   synoptics/<name>.yaml one per page, name sanitised via `safe_filename`
//
// `users.yaml` is NEVER included — password hashes stay on the host runtime.

const BUNDLE_FORMAT_VERSION: &str = "1.0";

#[derive(serde::Serialize, serde::Deserialize)]
struct BundleManifest {
    format_version:  String,
    name:            String,
    exported_at_ms:  u64,
    secrets_masked:  bool,
}

/// Build a ZIP of the active project from `dir` (same logic as the export
/// endpoint but callable internally — used by `remote_deploy`).
pub(crate) async fn build_project_zip(dir: &std::path::Path) -> anyhow::Result<Vec<u8>> {
    let mut project = Project::load(dir)
        .map_err(|e| anyhow::anyhow!("cannot load project: {e}"))?;
    for src in &mut project.sources {
        if let SourceDef::Mqtt(c) = src { c.password = None; }
    }
    let pages = load_all_synoptics(&synoptics_dir_at(dir)).await
        .map_err(|e| anyhow::anyhow!("cannot read synoptics: {e}"))?;
    let project_name = project.meta.name.clone();
    let exported_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let manifest = BundleManifest {
        format_version: BUNDLE_FORMAT_VERSION.into(),
        name:           project_name,
        exported_at_ms,
        secrets_masked: true,
    };
    let users_yaml = std::fs::read_to_string(dir.join("users.yaml")).ok();
    build_export_zip(&manifest, &project, &pages, users_yaml.as_deref())
}

async fn export_project_zip(State(s): State<AppState>) -> Response {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    // 1. Load the project from disk and strip MQTT passwords.
    let mut project = match Project::load(&dir) {
        Ok(p)  => p,
        Err(e) => {
            warn!("export: cannot load project: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot load project").into_response();
        }
    };
    for src in &mut project.sources {
        if let SourceDef::Mqtt(c) = src {
            c.password = None;
        }
    }

    // 2. Load every synoptic page from disk.
    let pages = match load_all_synoptics(&synoptics_dir_at(&dir)).await {
        Ok(v)  => v,
        Err(e) => {
            warn!("export: cannot read synoptics: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot read synoptics").into_response();
        }
    };

    // 3. Build the ZIP in memory.
    let project_name = project.meta.name.clone();
    let exported_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let manifest = BundleManifest {
        format_version: BUNDLE_FORMAT_VERSION.into(),
        name:           project_name.clone(),
        exported_at_ms,
        secrets_masked: true,
    };

    // Include users.yaml if present so credentials travel with the project.
    let users_yaml = std::fs::read_to_string(dir.join("users.yaml")).ok();

    let buf = match build_export_zip(&manifest, &project, &pages, users_yaml.as_deref()) {
        Ok(b)  => b,
        Err(e) => {
            warn!("export: zip build failed: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "zip build failed").into_response();
        }
    };

    let filename = format!(
        "sws-project-{}-{}.zip",
        sanitize_filename_chunk(&project_name),
        timestamp_for_filename(exported_at_ms),
    );

    tracing::info!(name = %project_name, bytes = buf.len(), "project export");

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\"")),
        ],
        buf,
    ).into_response()
}

fn build_export_zip(
    manifest: &BundleManifest,
    project: &Project,
    pages: &[SynopticPage],
    users_yaml: Option<&str>,
) -> anyhow::Result<Vec<u8>> {
    use zip::write::SimpleFileOptions;
    let mut cursor = Cursor::new(Vec::<u8>::new());
    {
        let mut z = zip::ZipWriter::new(&mut cursor);
        // Stored (uncompressed) keeps us off the flate2 codec path; the
        // bundle is a handful of small YAML files so compression saves
        // negligible bytes.
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

        z.start_file("manifest.json", opts)?;
        z.write_all(serde_json::to_string_pretty(manifest)?.as_bytes())?;

        z.start_file("project.yaml", opts)?;
        z.write_all(serde_yaml::to_string(project)?.as_bytes())?;

        for page in pages {
            let path = format!("synoptics/{}.yaml", safe_filename(&page.name));
            z.start_file(path, opts)?;
            z.write_all(serde_yaml::to_string(page)?.as_bytes())?;
        }
        if let Some(users) = users_yaml {
            z.start_file("users.yaml", opts)?;
            z.write_all(users.as_bytes())?;
        }
        z.finish()?;
    }
    Ok(cursor.into_inner())
}

async fn load_all_synoptics(dir: &std::path::Path) -> std::io::Result<Vec<SynopticPage>> {
    let mut out = Vec::new();
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e),
    };
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
            continue;
        }
        let text = tokio::fs::read_to_string(&path).await?;
        match serde_yaml::from_str::<SynopticPage>(&text) {
            Ok(page) => out.push(page),
            Err(e) => warn!("export: skipping malformed synoptic {:?}: {e}", path),
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

async fn import_project_zip(State(s): State<AppState>, body: Bytes) -> Response {
    let active_project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    // 1. Parse the ZIP from raw bytes.
    let mut archive = match zip::ZipArchive::new(Cursor::new(body.as_ref())) {
        Ok(a)  => a,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("not a valid zip: {e}")).into_response(),
    };

    // 2. Read manifest.json and validate format_version.
    let manifest: BundleManifest = match read_zip_text(&mut archive, "manifest.json") {
        Ok(Some(text)) => match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => return (StatusCode::BAD_REQUEST,
                format!("manifest.json parse error: {e}")).into_response(),
        },
        Ok(None) => return (StatusCode::BAD_REQUEST, "missing manifest.json").into_response(),
        Err(e)   => return (StatusCode::BAD_REQUEST, format!("zip read error: {e}")).into_response(),
    };
    if manifest.format_version != BUNDLE_FORMAT_VERSION {
        return (StatusCode::BAD_REQUEST,
            format!("unsupported format_version: {}", manifest.format_version)).into_response();
    }

    // 3. Read project.yaml.
    let project_text = match read_zip_text(&mut archive, "project.yaml") {
        Ok(Some(t)) => t,
        Ok(None)    => return (StatusCode::BAD_REQUEST, "missing project.yaml").into_response(),
        Err(e)      => return (StatusCode::BAD_REQUEST, format!("zip read error: {e}")).into_response(),
    };
    let mut project: Project = match serde_yaml::from_str(&project_text) {
        Ok(p)  => p,
        Err(e) => return (StatusCode::BAD_REQUEST,
            format!("project.yaml parse error: {e}")).into_response(),
    };
    // Defensive: scrub the "********" sentinel in case an older client
    // included it in the bundle. Treat as "no password set".
    for src in &mut project.sources {
        if let SourceDef::Mqtt(c) = src {
            if matches!(&c.password, Some(p) if p == MASKED_PASSWORD) {
                c.password = None;
            }
        }
    }

    // 4. Read every synoptics/*.yaml in the archive.
    let mut pages: Vec<SynopticPage> = Vec::new();
    let file_names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    for name in file_names {
        if !name.starts_with("synoptics/") || !name.ends_with(".yaml") {
            continue;
        }
        let text = match read_zip_text(&mut archive, &name) {
            Ok(Some(t)) => t,
            Ok(None)    => continue,
            Err(e)      => return (StatusCode::BAD_REQUEST,
                format!("zip read error on {name}: {e}")).into_response(),
        };
        match serde_yaml::from_str::<SynopticPage>(&text) {
            Ok(p)  => pages.push(p),
            Err(e) => return (StatusCode::BAD_REQUEST,
                format!("{name} parse error: {e}")).into_response(),
        }
    }

    // 5. Atomically replace on disk.
    let project_dir: &std::path::Path = active_project_dir.as_path();
    if let Err(e) = tokio::fs::create_dir_all(project_dir).await {
        warn!("import: cannot create project dir: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "cannot create project dir").into_response();
    }
    let project_path = project_dir.join("project.yaml");
    let serialized_project = match serde_yaml::to_string(&project) {
        Ok(y)  => y,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR,
            format!("project.yaml serialize: {e}")).into_response(),
    };
    if let Err(e) = tokio::fs::write(&project_path, serialized_project).await {
        warn!("import: write project.yaml: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write project.yaml").into_response();
    }

    let syn_dir = synoptics_dir_at(project_dir);
    if let Err(e) = tokio::fs::create_dir_all(&syn_dir).await {
        warn!("import: cannot create synoptics dir: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "cannot create synoptics dir").into_response();
    }

    // 5a. Compute the set of filenames the bundle declares (after sanitising).
    let kept_files: std::collections::HashSet<String> = pages.iter()
        .map(|p| format!("{}.yaml", safe_filename(&p.name)))
        .collect();

    // 5b. Replace mode — delete any synoptic on disk not in the bundle.
    if let Ok(mut entries) = tokio::fs::read_dir(&syn_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
            if !kept_files.contains(&fname) {
                if let Err(e) = tokio::fs::remove_file(&path).await {
                    warn!("import: cannot delete orphan synoptic {:?}: {e}", path);
                }
            }
        }
    }

    // 5c. Write each imported synoptic.
    for page in &pages {
        let path = syn_dir.join(format!("{}.yaml", safe_filename(&page.name)));
        let yaml = match serde_yaml::to_string(page) {
            Ok(y)  => y,
            Err(e) => {
                warn!("import: serialize synoptic '{}': {e}", page.name);
                return (StatusCode::INTERNAL_SERVER_ERROR,
                    format!("serialize synoptic '{}'", page.name)).into_response();
            }
        };
        if let Err(e) = tokio::fs::write(&path, yaml).await {
            warn!("import: write synoptic '{}': {e}", page.name);
            return (StatusCode::INTERNAL_SERVER_ERROR,
                format!("write synoptic '{}'", page.name)).into_response();
        }
    }

    // 6. Hot-reload — mirror the per-section PUT handlers' side effects so
    //    the runtime reflects the new project without a restart.
    let current_ids: std::collections::HashSet<TagId> =
        s.db.snapshot().await.into_keys().collect();
    let new_ids: std::collections::HashSet<TagId> =
        project.tags.iter().map(|t| t.id.clone()).collect();
    for t in project.tags.iter().filter(|t| !current_ids.contains(&t.id)) {
        s.db.set(t.id.clone(), t.initial_value(), TagQuality::Uncertain).await;
    }
    for id in current_ids.difference(&new_ids) {
        s.db.remove(id).await;
    }
    s.alarms.load(project.alarms.clone()).await;
    s.supervisor.reload(project.sources.clone()).await;
    {
        let mut map = s.functions.write().await;
        map.clear();
        for f in project.functions.iter().cloned() {
            map.insert(f.name.clone(), f);
        }
    }
    {
        let derived: Vec<(String, String)> = project.tags.iter()
            .filter_map(|t| t.expression.as_ref().map(|e| (t.id.clone(), e.clone())))
            .collect();
        *s.derived_tags.write().await = derived;
    }

    tracing::info!(
        name  = %project.meta.name,
        tags  = project.tags.len(),
        pages = pages.len(),
        "project import",
    );

    StatusCode::NO_CONTENT.into_response()
}

fn read_zip_text(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    name: &str,
) -> std::io::Result<Option<String>> {
    let mut file = match archive.by_name(name) {
        Ok(f)  => f,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
    };
    let mut buf = String::new();
    file.read_to_string(&mut buf)?;
    Ok(Some(buf))
}

/// Strip filename-unsafe characters; reused for the download attachment.
fn sanitize_filename_chunk(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' => c,
            _ => '_',
        })
        .collect()
}

/// `YYYY-MM-DDTHH-MM` from a Unix-millis timestamp, UTC. Self-rolled so
/// we don't pull in `chrono` just for a filename.
fn timestamp_for_filename(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let (y, mo, d, h, mi) = unix_to_ymdhm(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}-{mi:02}")
}

fn unix_to_ymdhm(secs: i64) -> (i32, u32, u32, u32, u32) {
    // Days since 1970-01-01.
    let total_minutes = secs.div_euclid(60);
    let mi = (total_minutes.rem_euclid(60)) as u32;
    let total_hours   = total_minutes.div_euclid(60);
    let h  = (total_hours.rem_euclid(24)) as u32;
    let mut days = total_hours.div_euclid(24);

    // Forward-walk through years from 1970. Works fine for any reasonable
    // present-day timestamp; nothing fancier needed for filename use.
    let mut y: i32 = 1970;
    loop {
        let leap = is_leap(y);
        let yd = if leap { 366 } else { 365 };
        if days >= yd as i64 {
            days -= yd as i64;
            y += 1;
        } else {
            break;
        }
    }
    let leap = is_leap(y);
    let months: [i64; 12] = [
        31,
        if leap { 29 } else { 28 },
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];
    let mut mo: u32 = 1;
    for (i, n) in months.iter().enumerate() {
        if days < *n {
            mo = (i + 1) as u32;
            break;
        }
        days -= n;
    }
    let d = (days + 1) as u32;
    (y, mo, d, h, mi)
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

#[derive(Deserialize, Default)]
struct RunBody {
    #[serde(default)]
    args: serde_json::Map<String, serde_json::Value>,
}

/// Execute a named function with the provided argument bindings.
/// Returns the same shape as `/api/script/exec` so callers share a path.
async fn run_function(
    State(s): State<AppState>,
    Path(name): Path<String>,
    body: Option<Json<RunBody>>,
) -> Response {
    let code = {
        let map = s.functions.read().await;
        match map.get(&name) {
            Some(f) => f.code.clone(),
            None    => return (StatusCode::NOT_FOUND,
                format!("no function named '{name}'")).into_response(),
        }
    };
    let args = body.map(|Json(b)| b.args).unwrap_or_default();
    match s.py.execute_with_args(code, args).await {
        Ok(ExecOutput { stdout, stderr, sandboxed }) => {
            metrics::counter!("sws_script_exec_total", "endpoint" => "run", "status" => "ok").increment(1);
            Json(ScriptResult { ok: true, stdout, stderr, sandboxed, error: None }).into_response()
        }
        Err(e) => {
            metrics::counter!("sws_script_exec_total", "endpoint" => "run", "status" => "error").increment(1);
            Json(ScriptResult {
                ok: false, error: Some(e), sandboxed: s.py.is_sandboxed(),
                ..Default::default()
            }).into_response()
        }
    }
}

/// Tight Python-identifier check used for FunctionParam.name. Rejects the
/// hard-coded keyword list (a subset of `keyword.kwlist` — covers everything
/// you'd reasonably shadow as a parameter).
fn is_valid_python_identifier(s: &str) -> bool {
    if s.is_empty() { return false; }
    let mut chars = s.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_alphabetic() || first == '_') { return false; }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') { return false; }
    const KEYWORDS: &[&str] = &[
        "False", "None", "True", "and", "as", "assert", "async", "await",
        "break", "class", "continue", "def", "del", "elif", "else", "except",
        "finally", "for", "from", "global", "if", "import", "in", "is",
        "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
        "while", "with", "yield", "match", "case",
    ];
    !KEYWORDS.contains(&s)
}

// ── Synoptic endpoints ───────────────────────────────────────────────────────

/// Compute the synoptics directory for a given project root.
pub fn synoptics_dir_at(project_dir: &std::path::Path) -> PathBuf {
    project_dir.join("synoptics")
}

/// Returns true if `user_zones` (empty = all zones) can access a page with `page_zones`
/// (None or empty = accessible to all).
fn zone_allowed(user_zones: &[String], page_zones: &Option<Vec<String>>) -> bool {
    match page_zones {
        None => true,
        Some(pz) if pz.is_empty() => true,
        Some(pz) => {
            // user_zones empty = user has no zone restriction → can access any page
            if user_zones.is_empty() { return true; }
            user_zones.iter().any(|z| pz.contains(z))
        }
    }
}

async fn list_synoptics(
    State(s): State<AppState>,
    axum::extract::Extension(user): axum::extract::Extension<AuthUser>,
) -> Response {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let dir = synoptics_dir_at(&project_dir);
    let mut names = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    // Zone filter: peek at zones field without fully parsing objects.
                    let allowed = if user.allowed_zones.is_empty() {
                        true // admin/no-restriction users see all pages
                    } else if let Ok(text) = tokio::fs::read_to_string(&path).await {
                        if let Ok(page) = serde_yaml::from_str::<SynopticPage>(&text) {
                            zone_allowed(&user.allowed_zones, &page.zones)
                        } else { true }
                    } else { true };
                    if allowed {
                        names.push(stem.to_owned());
                    }
                }
            }
        }
    }
    names.sort();
    Json(names).into_response()
}

async fn get_synoptic(
    State(s): State<AppState>,
    axum::extract::Extension(user): axum::extract::Extension<AuthUser>,
    Path(name): Path<String>,
) -> Response {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let path = synoptics_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&name)));
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => match serde_yaml::from_str::<SynopticPage>(&text) {
            Ok(page) => {
                if !zone_allowed(&user.allowed_zones, &page.zones) {
                    return StatusCode::FORBIDDEN.into_response();
                }
                Json(page).into_response()
            }
            Err(e) => {
                warn!("failed to parse synoptic {name}: {e}");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        },
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `GET /api/synoptics/:name/export` — returns the synoptic file as raw YAML
/// with a `Content-Disposition: attachment` header so browsers download it.
/// Same content as `/api/synoptics/:name` (the file on disk), just bytes —
/// no JSON round-trip — and Content-Type set to `application/x-yaml`.
async fn export_synoptic_yaml(
    State(s): State<AppState>,
    Path(name): Path<String>,
) -> Response {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let safe = safe_filename(&name);
    let path = synoptics_dir_at(&project_dir).join(format!("{}.yaml", safe));
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let filename = format!("{}.yaml", safe);
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/x-yaml; charset=utf-8".to_string()),
                    (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\"")),
                ],
                bytes,
            ).into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `POST /api/synoptics/import` — accepts raw YAML in the request body and
/// installs it as a new page. The page's internal `id` is regenerated to
/// avoid collisions with existing pages, and the filename is derived from
/// the page's `name` (with collision handling: appending `-2`, `-3`, …).
///
/// Returns 200 + `{ id, name, filename }` on success so the editor can
/// jump to the imported page.
async fn import_synoptic_yaml(
    State(s): State<AppState>,
    body: Bytes,
) -> Response {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let dir = synoptics_dir_at(&project_dir);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        warn!("import_synoptic: cannot create synoptics dir: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    let text = match std::str::from_utf8(&body) {
        Ok(t)  => t,
        Err(_) => return (StatusCode::BAD_REQUEST, "body is not UTF-8").into_response(),
    };
    let mut page: SynopticPage = match serde_yaml::from_str(text) {
        Ok(p)  => p,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("invalid synoptic YAML: {e}")).into_response(),
    };

    // Always allocate a fresh id so imports never collide with existing pages.
    // Format mirrors the editor's `genId()` (alphanumeric base36).
    let new_id = format!(
        "imported-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    page.id = new_id.clone();

    // Resolve a non-colliding filename. If `<name>.yaml` already exists, try
    // `<name>-2.yaml`, `<name>-3.yaml`, … and rename the page in-memory to
    // match so the human-readable label stays in sync with the file on disk.
    let base = safe_filename(&page.name);
    let mut filename = format!("{base}.yaml");
    let mut suffix = 2;
    while dir.join(&filename).exists() {
        let new_name = format!("{} ({})", page.name, suffix);
        filename = format!("{}.yaml", safe_filename(&new_name));
        if !dir.join(&filename).exists() {
            page.name = new_name;
            break;
        }
        suffix += 1;
        if suffix > 100 {
            return (StatusCode::INTERNAL_SERVER_ERROR, "too many name collisions").into_response();
        }
    }

    let yaml = match serde_yaml::to_string(&page) {
        Ok(y)  => y,
        Err(e) => {
            warn!("import_synoptic: serialize: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let path = dir.join(&filename);
    if let Err(e) = tokio::fs::write(&path, yaml).await {
        warn!("import_synoptic: write {}: {e}", path.display());
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    Json(serde_json::json!({
        "id":       new_id,
        "name":     page.name,
        "filename": filename,
    })).into_response()
}

async fn save_synoptic(
    State(s): State<AppState>,
    Path(name): Path<String>,
    Json(page): Json<SynopticPage>,
) -> StatusCode {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c };
    let dir = synoptics_dir_at(&project_dir);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        warn!("cannot create synoptics dir: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    let new_filename = format!("{}.yaml", safe_filename(&name));
    let path = dir.join(&new_filename);
    let yaml = match serde_yaml::to_string(&page) {
        Ok(y) => y,
        Err(e) => { warn!("serialize synoptic: {e}"); return StatusCode::INTERNAL_SERVER_ERROR; }
    };
    if let Err(e) = tokio::fs::write(&path, yaml).await {
        warn!("write {}: {e}", path.display());
        return StatusCode::INTERNAL_SERVER_ERROR;
    }

    // Remove any stale files that share this page's `id` but have a different
    // filename — left behind when the user renames a page.
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let fname = entry.file_name();
            let fname_str = fname.to_string_lossy();
            if !fname_str.ends_with(".yaml") || fname_str == new_filename.as_str() {
                continue;
            }
            // Only remove if this stale file has the same internal id.
            if let Ok(text) = tokio::fs::read_to_string(entry.path()).await {
                #[derive(serde::Deserialize)]
                struct IdOnly { id: String }
                if let Ok(p) = serde_yaml::from_str::<IdOnly>(&text) {
                    if p.id == page.id {
                        if let Err(e) = tokio::fs::remove_file(entry.path()).await {
                            warn!("save_synoptic: cannot remove stale {:?}: {e}", entry.path());
                        }
                    }
                }
            }
        }
    }

    StatusCode::NO_CONTENT
}

// ── Faceplate endpoints ──────────────────────────────────────────────────────

// Built-in faceplates embedded at compile time — always available.
const BUILTIN_FACEPLATES: &[(&str, &str)] = &[
    ("motor_basic",  include_str!("../../../assets/faceplates/motor_basic.yaml")),
    ("valve_basic",  include_str!("../../../assets/faceplates/valve_basic.yaml")),
    ("tank_level",   include_str!("../../../assets/faceplates/tank_level.yaml")),
];

fn faceplates_dir_at(project_dir: &std::path::Path) -> PathBuf {
    project_dir.join("faceplates")
}

async fn list_faceplates(State(s): State<AppState>) -> Response {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let dir = faceplates_dir_at(&project_dir);
    let mut ids: std::collections::HashSet<String> = BUILTIN_FACEPLATES.iter()
        .map(|(id, _)| id.to_string()).collect();
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    ids.insert(stem.to_owned());
                }
            }
        }
    }
    let mut sorted: Vec<String> = ids.into_iter().collect();
    sorted.sort();
    Json(sorted).into_response()
}

async fn get_faceplate(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let path = faceplates_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&id)));
    // Project-specific faceplate wins over built-in.
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(t) => t,
        Err(_) => {
            // Fall back to built-in.
            match BUILTIN_FACEPLATES.iter().find(|(bid, _)| *bid == id.as_str()) {
                Some((_, yaml)) => yaml.to_string(),
                None => return StatusCode::NOT_FOUND.into_response(),
            }
        }
    };
    match serde_yaml::from_str::<FaceplateDef>(&text) {
        Ok(fp) => Json(fp).into_response(),
        Err(e) => {
            warn!("failed to parse faceplate {id}: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn save_faceplate(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(mut fp): Json<FaceplateDef>,
) -> StatusCode {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c };
    let dir = faceplates_dir_at(&project_dir);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        warn!("cannot create faceplates dir: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    fp.id = id.clone();
    let path = dir.join(format!("{}.yaml", safe_filename(&id)));
    match serde_yaml::to_string(&fp) {
        Ok(yaml) => match tokio::fs::write(&path, yaml.as_bytes()).await {
            Ok(()) => StatusCode::NO_CONTENT,
            Err(e) => { warn!("cannot write faceplate {id}: {e}"); StatusCode::INTERNAL_SERVER_ERROR }
        },
        Err(e) => { warn!("cannot serialize faceplate {id}: {e}"); StatusCode::INTERNAL_SERVER_ERROR }
    }
}

async fn delete_faceplate(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> StatusCode {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c };
    let path = faceplates_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&id)));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

// ── Recipes ───────────────────────────────────────────────────────────────────

fn recipes_dir_at(project_dir: &std::path::Path) -> PathBuf {
    project_dir.join("recipes")
}

async fn list_recipes(State(s): State<AppState>) -> Response {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let dir = recipes_dir_at(&project_dir);
    let mut recipes: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
                if let Ok(text) = tokio::fs::read_to_string(&path).await {
                    if let Ok(r) = serde_yaml::from_str::<RecipeDef>(&text) {
                        recipes.push(serde_json::json!({
                            "id": r.id,
                            "name": r.name,
                            "setpoints_count": r.setpoints.len()
                        }));
                    }
                }
            }
        }
    }
    recipes.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    Json(recipes).into_response()
}

async fn get_recipe(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let path = recipes_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&id)));
    match tokio::fs::read_to_string(&path).await {
        Err(_) => StatusCode::NOT_FOUND.into_response(),
        Ok(text) => match serde_yaml::from_str::<RecipeDef>(&text) {
            Ok(r) => Json(r).into_response(),
            Err(e) => {
                warn!("failed to parse recipe {id}: {e}");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        },
    }
}

async fn save_recipe(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(mut recipe): Json<RecipeDef>,
) -> StatusCode {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c };
    let dir = recipes_dir_at(&project_dir);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        warn!("cannot create recipes dir: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    recipe.id = id.clone();
    let path = dir.join(format!("{}.yaml", safe_filename(&id)));
    match serde_yaml::to_string(&recipe) {
        Ok(yaml) => match tokio::fs::write(&path, yaml.as_bytes()).await {
            Ok(()) => StatusCode::NO_CONTENT,
            Err(e) => { warn!("cannot write recipe {id}: {e}"); StatusCode::INTERNAL_SERVER_ERROR }
        },
        Err(e) => { warn!("cannot serialize recipe {id}: {e}"); StatusCode::INTERNAL_SERVER_ERROR }
    }
}

async fn delete_recipe(State(s): State<AppState>, Path(id): Path<String>) -> StatusCode {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c };
    let path = recipes_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&id)));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

#[derive(serde::Deserialize)]
struct ApplyRecipeBody {
    #[serde(default = "default_applied_by")]
    applied_by: String,
}
fn default_applied_by() -> String { "operator".to_string() }

async fn apply_recipe(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ApplyRecipeBody>,
) -> Response {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let path = recipes_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&id)));
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(t) => t,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let recipe = match serde_yaml::from_str::<RecipeDef>(&text) {
        Ok(r) => r,
        Err(e) => {
            warn!("recipe parse error {id}: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let mut applied = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for sp in &recipe.setpoints {
        let tv = match json_to_tag_value(&sp.value) {
            Some(v) => v,
            None => {
                errors.push(format!("{}: unsupported value type", sp.tag));
                continue;
            }
        };
        match s.bus.write(&sp.tag, tv.clone()).await {
            Ok(()) => applied += 1,
            Err(WriteError::NoWriter(_)) => {
                s.db.set(sp.tag.clone(), tv, TagQuality::Good).await;
                applied += 1;
            }
            Err(e) => errors.push(format!("{}: {e}", sp.tag)),
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    s.recipe_log.write().await.push(RecipeApplyEvent {
        recipe_id:       recipe.id.clone(),
        recipe_name:     recipe.name.clone(),
        ts_ms:           now,
        applied_by:      body.applied_by.clone(),
        setpoints_count: applied,
    });

    Json(serde_json::json!({
        "recipe_id": recipe.id,
        "applied": applied,
        "total": recipe.setpoints.len(),
        "errors": errors,
        "applied_by": body.applied_by,
        "ts_ms": now,
    })).into_response()
}

async fn get_recipe_history(State(s): State<AppState>) -> impl IntoResponse {
    let mut events: Vec<RecipeApplyEvent> = s.recipe_log.read().await.clone();
    events.sort_by(|a, b| b.ts_ms.cmp(&a.ts_ms));
    Json(events)
}

fn json_to_tag_value(v: &serde_json::Value) -> Option<TagValue> {
    match v {
        serde_json::Value::Bool(b)   => Some(TagValue::Bool(*b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() { Some(TagValue::Int(i)) }
            else { n.as_f64().map(TagValue::Float) }
        }
        serde_json::Value::String(s) => Some(TagValue::Str(s.clone())),
        _ => None,
    }
}

// ── WebSocket (T-16 delta batching + T-17 per-page subscription) ─────────────
//
// Protocol v2 (from this commit):
//   Client → Server:
//     {type:"subscribe", tags:["id1","id2",...]}  — ["*"] or [] = all tags
//     {type:"write", tag, value, req_id?}           — Operator+ only
//
//   Server → Client:
//     {type:"snapshot", tags:[{id,value,quality,ts}], seq:N}  — on connect or re-subscribe
//     {type:"delta",   changed:[{id,value,quality,ts}], seq:N} — batched updates (≤50ms window)
//     {type:"ack",     tag, ok, req_id?, error?}               — write response

/// Inbound message frame for `/ws/tags`.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum InboundMsg {
    Write {
        tag: String,
        value: TagValue,
        #[serde(default)]
        req_id: Option<String>,
    },
    /// Replace the subscription filter. ["*"] or empty = all tags (default).
    Subscribe {
        tags: Vec<String>,
    },
}

#[derive(serde::Serialize)]
struct WsTagEntry<'a> {
    id: &'a str,
    value: &'a TagValue,
    quality: &'a TagQuality,
    ts: u64,
}

#[derive(serde::Serialize)]
struct WsSnapshotMsg<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    tags: Vec<WsTagEntry<'a>>,
    seq: u64,
}

#[derive(serde::Serialize)]
struct WsDeltaMsg<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    changed: Vec<WsTagEntry<'a>>,
    seq: u64,
}

#[derive(serde::Serialize)]
struct WriteAck {
    #[serde(rename = "type")]
    ty: &'static str,
    req_id: Option<String>,
    tag: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

async fn ws_tags_handler(
    ws: WebSocketUpgrade,
    State(s): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, s.db, s.bus, user.role))
}

async fn handle_ws(socket: WebSocket, db: Arc<TagDb>, bus: Arc<TagWriteBus>, role: Role) {
    use futures_util::{SinkExt, StreamExt};
    use std::collections::{HashMap, HashSet};

    let (mut ws_tx, mut ws_rx) = socket.split();
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<Message>(64);

    // Sequence counter (per-connection monotonic).
    let mut seq: u64 = 0;

    // Helper: build + send snapshot for the current subscription.
    let send_snapshot = |sub: &Option<HashSet<String>>, snapshot: Vec<(TagId, TagState)>, seq: u64, tx: &tokio::sync::mpsc::Sender<Message>| {
        let tags: Vec<_> = snapshot.iter()
            .filter(|(id, _)| sub.as_ref().map_or(true, |s| s.contains(id)))
            .map(|(id, st)| (id.clone(), st.clone()))
            .collect();
        let entries: Vec<WsTagEntry> = tags.iter().map(|(id, st)| WsTagEntry {
            id,
            value: &st.value,
            quality: &st.quality,
            ts: st.timestamp_ms,
        }).collect();
        let msg = WsSnapshotMsg { ty: "snapshot", tags: entries, seq };
        if let Ok(text) = serde_json::to_string(&msg) {
            let _ = tx.try_send(Message::Text(text));
        }
    };

    // Initial snapshot.
    let snapshot = db.snapshot().await;
    {
        let entries: Vec<_> = snapshot.iter()
            .map(|(id, st)| (id.clone(), st.clone()))
            .collect();
        let ws_entries: Vec<WsTagEntry> = entries.iter().map(|(id, st)| WsTagEntry {
            id,
            value: &st.value,
            quality: &st.quality,
            ts: st.timestamp_ms,
        }).collect();
        let msg = WsSnapshotMsg { ty: "snapshot", tags: ws_entries, seq };
        if let Ok(text) = serde_json::to_string(&msg) {
            if out_tx.send(Message::Text(text)).await.is_err() { return; }
        }
    }

    // Forwarder: pumps mpsc → socket.
    let forward_task = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if ws_tx.send(msg).await.is_err() { break; }
        }
    });

    // Delta batcher: collects incoming tag updates into a 50ms window,
    // then flushes as one delta frame.
    let mut rx = db.subscribe();
    let broadcast_tx = out_tx.clone();

    // pending accumulator: id → latest state within the current window.
    let mut pending: HashMap<String, TagState> = HashMap::new();
    let flush_interval = std::time::Duration::from_millis(50);
    let mut flush_tick = tokio::time::interval(flush_interval);
    flush_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // subscription_rx: notified when the subscription changes so the batcher
    // can use the current filter. We share it via an atomic-guarded cell.
    use std::sync::Arc as StdArc;
    let sub_cell: StdArc<tokio::sync::RwLock<Option<HashSet<String>>>> =
        StdArc::new(tokio::sync::RwLock::new(None));
    let sub_cell_batcher = StdArc::clone(&sub_cell);

    let mut batcher_seq: u64 = seq + 1; // seq 0 used by snapshot
    let broadcast_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                res = rx.recv() => {
                    match res {
                        Ok(update) => {
                            pending.insert(update.id, update.state);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            warn!("ws/tags subscriber lagged by {n}");
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
                _ = flush_tick.tick() => {
                    if pending.is_empty() { continue; }
                    let sub = sub_cell_batcher.read().await;
                    let changed: Vec<(String, TagState)> = pending.drain()
                        .filter(|(id, _)| sub.as_ref().map_or(true, |s| s.contains(id)))
                        .collect();
                    drop(sub);
                    if changed.is_empty() { continue; }
                    let entries: Vec<WsTagEntry> = changed.iter().map(|(id, st)| WsTagEntry {
                        id,
                        value: &st.value,
                        quality: &st.quality,
                        ts: st.timestamp_ms,
                    }).collect();
                    let msg = WsDeltaMsg { ty: "delta", changed: entries, seq: batcher_seq };
                    batcher_seq = batcher_seq.wrapping_add(1);
                    if let Ok(text) = serde_json::to_string(&msg) {
                        if broadcast_tx.send(Message::Text(text)).await.is_err() { break; }
                    }
                }
            }
        }
    });

    // Inbound loop: writes and subscribe messages.
    while let Some(frame) = ws_rx.next().await {
        let frame = match frame { Ok(f) => f, Err(_) => break };
        match frame {
            Message::Text(text) => {
                let parsed: Result<InboundMsg, _> = serde_json::from_str(&text);
                let Ok(msg) = parsed else {
                    let ack = WriteAck { ty: "ack", req_id: None, tag: String::new(), ok: false, error: Some("invalid frame".into()) };
                    let _ = out_tx.send(Message::Text(serde_json::to_string(&ack).unwrap_or_default())).await;
                    continue;
                };
                match msg {
                    InboundMsg::Write { tag, value, req_id } => {
                        if role < Role::Operator {
                            let ack = WriteAck { ty: "ack", req_id, tag, ok: false, error: Some("forbidden: Operator+ required".into()) };
                            let _ = out_tx.send(Message::Text(serde_json::to_string(&ack).unwrap_or_default())).await;
                            continue;
                        }
                        let (ok, err) = match bus.write(&tag, value.clone()).await {
                            Ok(()) => (true, None),
                            Err(WriteError::NoWriter(_)) => {
                                db.set(tag.clone(), value, TagQuality::Good).await;
                                (true, None)
                            }
                            Err(e @ WriteError::ChannelClosed(_)) => (false, Some(e.to_string())),
                        };
                        let ack = WriteAck { ty: "ack", req_id, tag, ok, error: err };
                        let _ = out_tx.send(Message::Text(serde_json::to_string(&ack).unwrap_or_default())).await;
                    }
                    InboundMsg::Subscribe { tags } => {
                        // Update subscription filter.
                        let new_sub: Option<HashSet<String>> = if tags.is_empty() || tags.iter().any(|t| t == "*") {
                            None // all tags
                        } else {
                            Some(tags.into_iter().collect())
                        };
                        // Update shared filter for the batcher task.
                        *sub_cell.write().await = new_sub.clone();
                        // Send fresh snapshot for the new subscription.
                        seq = seq.wrapping_add(1);
                        let snap = db.snapshot().await;
                        let snap_vec: Vec<(TagId, TagState)> = snap.into_iter().collect();
                        send_snapshot(&new_sub, snap_vec, seq, &out_tx);
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    broadcast_task.abort();
    drop(out_tx);
    let _ = forward_task.await;
}

// ── Log streaming ────────────────────────────────────────────────────────────

async fn get_logs(State(s): State<AppState>) -> Json<Vec<LogEvent>> {
    Json(s.logs.snapshot())
}

/// `GET /api/logs/files` — list available historical JSONL files in logs_dir.
/// Returns `[{ date: "YYYY-MM-DD", size_bytes }]` sorted newest-first.
async fn list_log_files(State(s): State<AppState>) -> Response {
    #[derive(serde::Serialize)]
    struct FileEntry { date: String, size_bytes: u64 }

    let dir = s.logs_dir.as_path();
    let mut out: Vec<FileEntry> = Vec::new();

    if let Ok(mut rd) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(entry)) = rd.next_entry().await {
            let fname = entry.file_name();
            let fname_str = fname.to_string_lossy();
            // Match "runtime-YYYY-MM-DD.jsonl"
            if let Some(date) = fname_str
                .strip_prefix("runtime-")
                .and_then(|s| s.strip_suffix(".jsonl"))
            {
                // Validate date format: YYYY-MM-DD (10 chars, digits and dashes)
                if date.len() == 10 && date.chars().all(|c| c.is_ascii_digit() || c == '-') {
                    let size_bytes = entry.metadata().await.map(|m| m.len()).unwrap_or(0);
                    out.push(FileEntry { date: date.to_string(), size_bytes });
                }
            }
        }
    }

    out.sort_by(|a, b| b.date.cmp(&a.date)); // newest first
    Json(out).into_response()
}

/// `GET /api/logs/file?date=YYYY-MM-DD` — parse and return a historical log file.
async fn get_log_file(
    State(s): State<AppState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let date = match q.get("date") {
        Some(d) if d.len() == 10 && d.chars().all(|c| c.is_ascii_digit() || c == '-') => d.clone(),
        _ => return (StatusCode::BAD_REQUEST, "missing or invalid ?date=YYYY-MM-DD").into_response(),
    };
    let path = s.logs_dir.join(format!("runtime-{date}.jsonl"));
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(t)  => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return (StatusCode::NOT_FOUND, "log file not found").into_response();
        }
        Err(e) => {
            warn!("get_log_file: read {}: {e}", path.display());
            return (StatusCode::INTERNAL_SERVER_ERROR, "cannot read log file").into_response();
        }
    };

    let events: Vec<LogEvent> = text
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();

    Json(events).into_response()
}

async fn ws_logs_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_logs_ws(socket, s.logs))
}

async fn handle_logs_ws(mut socket: WebSocket, logs: Arc<LogBus>) {
    // Snapshot first so a fresh client sees recent history before the live tail.
    for ev in logs.snapshot() {
        if let Ok(text) = serde_json::to_string(&ev) {
            if socket.send(Message::Text(text)).await.is_err() { return; }
        }
    }
    let mut rx = logs.subscribe();
    loop {
        match rx.recv().await {
            Ok(ev) => {
                if let Ok(text) = serde_json::to_string(&ev) {
                    if socket.send(Message::Text(text)).await.is_err() { break; }
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                // Lagged subscribers silently miss events — the snapshot
                // already covered everything up to subscribe-time and we
                // don't emit a "log about logs" to avoid a feedback loop.
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}

// ── MQTT broker browse ────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct MqttBrowseRequest {
    host: String,
    port: u16,
    /// If provided and `password` is the masked sentinel, the real password is
    /// resolved from the saved project source with this ID.
    source_id: Option<String>,
    client_id: String,
    username: Option<String>,
    password: Option<String>,
    #[serde(default)]
    tls_enabled: bool,
    ca_cert_path: Option<String>,
    /// Seconds to listen. Capped at 15 to avoid long-blocking requests.
    duration_secs: Option<u8>,
}

#[derive(serde::Serialize)]
struct BrowsedTopicDto {
    topic: String,
    sample_payload: String,
}

#[derive(serde::Serialize)]
struct MqttBrowseResponse {
    topics: Vec<BrowsedTopicDto>,
}

// ── OPC-UA browse (BL-005 step 3) ────────────────────────────────────────────

#[derive(Deserialize)]
struct OpcUaBrowseRequest {
    endpoint_url: String,
    /// When the caller sends the masked sentinel password, we substitute the
    /// real one from project.yaml by looking up the matching source id.
    /// Same pattern as mqtt_browse_handler.
    #[serde(default)]
    source_id: Option<String>,
    #[serde(default)]
    auth: Option<sws_core::OpcUaAuth>,
    /// Optional NodeId to browse under (e.g. `ns=2;s=Machine`). Defaults to
    /// the Objects folder on the server.
    #[serde(default)]
    parent_node_id: Option<String>,
    /// Optional browse direction: "forward" (default), "inverse" (inbound
    /// refs), or "both". Forward is what the UI tree uses.
    #[serde(default)]
    direction: Option<sws_plugin_opcua::BrowseDir>,
    /// Optional security policy override (defaults to "None" if unset).
    /// Useful when the caller wants to test a Basic256Sha256 connection
    /// without saving the source first.
    #[serde(default)]
    security_policy: Option<String>,
}

async fn opcua_browse_handler(
    State(s): State<AppState>,
    Json(mut req): Json<OpcUaBrowseRequest>,
) -> Response {
    // Resolve a masked password from project.yaml when the editor sends
    // the sentinel — keeps secrets out of round-trips just like the MQTT
    // path. Only `UsernamePassword` carries a password.
    if let Some(sws_core::OpcUaAuth::UsernamePassword { password: Some(ref p), .. }) = req.auth {
        if p == MASKED_PASSWORD {
            if let (Some(ref sid), Ok(dir)) = (req.source_id.as_ref(), active_dir(&s).await) {
                if let Ok(project) = Project::load(&dir) {
                    for src in &project.sources {
                        if let SourceDef::OpcUaClient(c) = src {
                            if c.id.as_str() == sid.as_str() {
                                if let sws_core::OpcUaAuth::UsernamePassword {
                                    password: Some(stored), ..
                                } = &c.auth {
                                    if let sws_core::OpcUaAuth::UsernamePassword {
                                        password, ..
                                    } = &mut req.auth.as_mut().unwrap() {
                                        *password = Some(stored.clone());
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    // Build a throwaway OpcUaClientConfig for the helper. We don't touch
    // the persisted project — the browse is a one-shot lookup.
    let cfg = sws_core::OpcUaClientConfig {
        id: "browse".into(),
        endpoint_url: req.endpoint_url,
        security_policy: req.security_policy.unwrap_or_else(|| "None".into()),
        auth: req.auth.unwrap_or_default(),
        subscription_interval_ms: 1000,
        nodes: Vec::new(),
        trust_all_certs: true,
    };
    let direction = req.direction.unwrap_or_default();

    match sws_plugin_opcua::browse_one_level(&cfg, req.parent_node_id.as_deref(), direction).await {
        Ok(nodes) => Json(serde_json::json!({ "nodes": nodes })).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, format!("opcua browse failed: {e}")).into_response(),
    }
}

#[derive(Deserialize)]
struct OpcUaDetectEuromapRequest {
    endpoint_url: String,
    #[serde(default)]
    source_id: Option<String>,
    #[serde(default)]
    auth: Option<sws_core::OpcUaAuth>,
    #[serde(default)]
    security_policy: Option<String>,
}

async fn opcua_detect_euromap_handler(
    State(s): State<AppState>,
    Json(mut req): Json<OpcUaDetectEuromapRequest>,
) -> Response {
    // Same masked-password sentinel resolution pattern as opcua_browse.
    if let Some(sws_core::OpcUaAuth::UsernamePassword { password: Some(ref p), .. }) = req.auth {
        if p == MASKED_PASSWORD {
            if let (Some(ref sid), Ok(dir)) = (req.source_id.as_ref(), active_dir(&s).await) {
                if let Ok(project) = Project::load(&dir) {
                    for src in &project.sources {
                        if let SourceDef::OpcUaClient(c) = src {
                            if c.id.as_str() == sid.as_str() {
                                if let sws_core::OpcUaAuth::UsernamePassword {
                                    password: Some(stored), ..
                                } = &c.auth {
                                    if let sws_core::OpcUaAuth::UsernamePassword {
                                        password, ..
                                    } = &mut req.auth.as_mut().unwrap() {
                                        *password = Some(stored.clone());
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    let cfg = sws_core::OpcUaClientConfig {
        id: "euromap".into(),
        endpoint_url: req.endpoint_url,
        security_policy: req.security_policy.unwrap_or_else(|| "None".into()),
        auth: req.auth.unwrap_or_default(),
        subscription_interval_ms: 1000,
        nodes: Vec::new(),
        trust_all_certs: true,
    };

    match sws_plugin_opcua::detect_euromap(&cfg).await {
        Ok(det) => Json(det).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, format!("opcua euromap detection failed: {e}")).into_response(),
    }
}

// ── OPC-UA historical read ────────────────────────────────────────────────────
//
// POST /api/sources/opcua/history
// Body: { endpoint_url, auth?, security_policy?, node_id, from_ms?, to_ms?, max_values? }
// Returns: [ { ts_ms, value, quality }, … ] sorted ascending by ts_ms.
//
// Operator+ can call this. The source_id field (optional) is used to resolve
// credentials from project.yaml when the editor sends the masked sentinel.

#[derive(serde::Deserialize)]
struct OpcUaHistoryRequest {
    endpoint_url: String,
    #[serde(default)]
    source_id: Option<String>,
    #[serde(default)]
    auth: Option<sws_core::OpcUaAuth>,
    #[serde(default)]
    security_policy: Option<String>,
    node_id: String,
    #[serde(default)]
    from_ms: Option<u64>,
    #[serde(default)]
    to_ms: Option<u64>,
    /// Maximum data points returned by the server. Capped at 2000 server-side.
    #[serde(default)]
    max_values: Option<u32>,
}

async fn opcua_history_handler(
    State(s): State<AppState>,
    Json(mut req): Json<OpcUaHistoryRequest>,
) -> Response {
    // Resolve masked credentials from project.yaml (same pattern as browse).
    if let Some(ref sid) = req.source_id.clone() {
        if req.auth.as_ref().map_or(true, |a| {
            matches!(a, sws_core::OpcUaAuth::UsernamePassword { password: Some(p), .. } if p == MASKED_PASSWORD)
        }) {
            if let Ok(dir) = active_dir(&s).await {
                if let Ok(project) = Project::load(&dir) {
                    if let Some(src) = project.sources.iter().find(|src| {
                        matches!(src, sws_core::SourceDef::OpcUaClient(c) if c.id == *sid)
                    }) {
                        if let sws_core::SourceDef::OpcUaClient(c) = src {
                            req.auth = Some(c.auth.clone());
                        }
                    }
                }
            }
        }
    }

    let cfg = sws_core::OpcUaClientConfig {
        id: "history".into(),
        endpoint_url: req.endpoint_url,
        security_policy: req.security_policy.unwrap_or_else(|| "None".into()),
        auth: req.auth.unwrap_or_default(),
        subscription_interval_ms: 1000,
        nodes: Vec::new(),
        trust_all_certs: true,
    };

    let max_values = req.max_values.unwrap_or(500).min(2000);

    match sws_plugin_opcua::read_history(&cfg, &req.node_id, req.from_ms, req.to_ms, max_values).await {
        Ok(samples) => Json(samples).into_response(),
        Err(e) => {
            warn!(node = %req.node_id, "opcua history read failed: {e}");
            (StatusCode::BAD_GATEWAY, format!("opcua history read failed: {e}")).into_response()
        }
    }
}

async fn mqtt_browse_handler(
    State(s): State<AppState>,
    Json(mut req): Json<MqttBrowseRequest>,
) -> Response {
    // Resolve a masked password from the saved project if the caller sent the
    // sentinel and told us which source ID to look up.
    if req.password.as_deref() == Some(MASKED_PASSWORD) {
        if let Some(ref sid) = req.source_id {
            if let Ok(dir) = active_dir(&s).await {
                if let Ok(project) = Project::load(&dir) {
                    for src in &project.sources {
                        if let SourceDef::Mqtt(c) = src {
                            if &c.id == sid {
                                req.password = c.password.clone();
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    let duration = req.duration_secs.unwrap_or(8).min(15);
    let params = sws_plugin_mqtt::BrowseParams {
        host: req.host,
        port: req.port,
        client_id: req.client_id,
        username: req.username,
        password: req.password,
        tls_enabled: req.tls_enabled,
        ca_cert_path: req.ca_cert_path,
        duration_secs: duration,
    };

    let topics = sws_plugin_mqtt::browse(params).await
        .into_iter()
        .map(|t| BrowsedTopicDto { topic: t.topic, sample_payload: t.sample_payload })
        .collect();

    Json(MqttBrowseResponse { topics }).into_response()
}

// ── OPC-UA certificate trust management ──────────────────────────────────────
//
// async-opcua writes server certs to:
//   {pki_root}/{source_id}/trusted/certs/*.der   — explicitly trusted
//   {pki_root}/{source_id}/rejected/certs/*.der  — rejected / pending review
//
// The pki_root lives at {project_dir}/.opcua-pki/ (set by source_supervisor).

#[derive(serde::Serialize)]
struct OpcUaCertEntry {
    filename: String,
    status:   &'static str, // "trusted" | "rejected"
    size_bytes: u64,
}

/// List certs in the per-source trust store.
/// Returns all .der files from trusted/certs and rejected/certs directories.
async fn opcua_list_certs(
    State(s): State<AppState>,
    Path(source_id): Path<String>,
) -> Response {
    let Ok(dir) = active_dir(&s).await else {
        return (StatusCode::SERVICE_UNAVAILABLE, "no active project").into_response();
    };
    let pki_root = dir.join(".opcua-pki").join(&source_id);
    let mut entries: Vec<OpcUaCertEntry> = vec![];
    for (subdir, status) in [("trusted/certs", "trusted"), ("rejected/certs", "rejected")] {
        let cert_dir = pki_root.join(subdir);
        let Ok(mut rd) = tokio::fs::read_dir(&cert_dir).await else { continue };
        while let Ok(Some(ent)) = rd.next_entry().await {
            let name = ent.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".der") { continue; }
            let size = ent.metadata().await.map(|m| m.len()).unwrap_or(0);
            entries.push(OpcUaCertEntry { filename: name, status, size_bytes: size });
        }
    }
    Json(entries).into_response()
}

/// Move a cert from rejected/certs to trusted/certs (or no-op if already there).
async fn opcua_trust_cert(
    State(s): State<AppState>,
    Path((source_id, filename)): Path<(String, String)>,
) -> Response {
    if !is_safe_cert_filename(&filename) {
        return (StatusCode::BAD_REQUEST, "invalid filename").into_response();
    }
    let Ok(dir) = active_dir(&s).await else {
        return (StatusCode::SERVICE_UNAVAILABLE, "no active project").into_response();
    };
    let pki_root = dir.join(".opcua-pki").join(&source_id);
    let rejected  = pki_root.join("rejected/certs").join(&filename);
    let trusted   = pki_root.join("trusted/certs");
    if rejected.exists() {
        if let Err(e) = tokio::fs::create_dir_all(&trusted).await {
            return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
        }
        if let Err(e) = tokio::fs::rename(&rejected, trusted.join(&filename)).await {
            warn!(source = %source_id, file = %filename, "opcua trust: rename failed: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
        }
    }
    StatusCode::NO_CONTENT.into_response()
}

/// Remove a cert from either trusted or rejected store.
async fn opcua_delete_cert(
    State(s): State<AppState>,
    Path((source_id, filename)): Path<(String, String)>,
) -> Response {
    if !is_safe_cert_filename(&filename) {
        return (StatusCode::BAD_REQUEST, "invalid filename").into_response();
    }
    let Ok(dir) = active_dir(&s).await else {
        return (StatusCode::SERVICE_UNAVAILABLE, "no active project").into_response();
    };
    let pki_root = dir.join(".opcua-pki").join(&source_id);
    let mut deleted = false;
    for subdir in ["trusted/certs", "rejected/certs"] {
        let path = pki_root.join(subdir).join(&filename);
        if path.exists() {
            if let Err(e) = tokio::fs::remove_file(&path).await {
                warn!(source = %source_id, file = %filename, "opcua delete cert: {e}");
                return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
            }
            deleted = true;
        }
    }
    if deleted {
        StatusCode::NO_CONTENT.into_response()
    } else {
        (StatusCode::NOT_FOUND, "cert not found").into_response()
    }
}

/// Safety check: filename must be a plain `*.der` with no path components.
fn is_safe_cert_filename(name: &str) -> bool {
    !name.contains('/') && !name.contains('\\') && !name.starts_with('.') && name.ends_with(".der")
}

// ── HomeAssistant entity browse ───────────────────────────────────────────────

#[derive(Deserialize)]
struct HaBrowseRequest {
    /// Source id from the project's sources list — used to look up url+token.
    source_id: String,
    /// Optional filter: only return entities whose id starts with this prefix
    /// (e.g. "sensor.", "light.", "binary_sensor.").
    #[serde(default)]
    domain_filter: Option<String>,
}

#[derive(serde::Serialize)]
struct HaBrowsedEntity {
    entity_id:     String,
    state:         String,
    friendly_name: Option<String>,
    /// Non-empty attribute names for this entity (sorted, for UI display).
    attributes:    Vec<String>,
}

async fn ha_browse_handler(
    State(s): State<AppState>,
    Json(req): Json<HaBrowseRequest>,
) -> Response {
    // Resolve url + token from the saved project.
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(_) => return (StatusCode::BAD_REQUEST, "no project open").into_response(),
    };
    let project = match Project::load(&dir) {
        Ok(p) => p,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("project load: {e}")).into_response(),
    };

    let (url, token) = match project.sources.iter().find_map(|src| {
        if let SourceDef::HomeAssistant(c) = src {
            if c.id == req.source_id { return Some((c.url.clone(), c.token.clone(), c.token_env.clone())); }
        }
        None
    }) {
        Some((url, token_plain, token_env)) => {
            let tok = if let Some(env) = token_env {
                std::env::var(&env).unwrap_or_default()
            } else {
                token_plain.unwrap_or_default()
            };
            (url, tok)
        }
        None => return (StatusCode::NOT_FOUND, "HomeAssistant source not found").into_response(),
    };

    if token.is_empty() {
        return (StatusCode::BAD_REQUEST, "HomeAssistant token not configured").into_response();
    }

    let states_url = format!("{}/api/states", url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = match client
        .get(&states_url)
        .header("Authorization", format!("Bearer {token}"))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("HA unreachable: {e}")).into_response(),
    };

    if !resp.status().is_success() {
        return (
            StatusCode::BAD_GATEWAY,
            format!("HA returned {}", resp.status()),
        ).into_response();
    }

    let raw: Vec<serde_json::Value> = match resp.json().await {
        Ok(v) => v,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("HA parse error: {e}")).into_response(),
    };

    let domain_filter = req.domain_filter.as_deref().unwrap_or("");
    let mut entities: Vec<HaBrowsedEntity> = raw.into_iter()
        .filter_map(|v| {
            let entity_id = v.get("entity_id")?.as_str()?.to_string();
            if !domain_filter.is_empty() && !entity_id.starts_with(domain_filter) {
                return None;
            }
            let state = v.get("state").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let attrs = v.get("attributes").and_then(|a| a.as_object());
            let friendly_name = attrs
                .and_then(|a| a.get("friendly_name"))
                .and_then(|f| f.as_str())
                .map(|s| s.to_string());
            let mut attribute_names: Vec<String> = attrs
                .map(|a| {
                    let mut names: Vec<String> = a.keys()
                        .filter(|k| *k != "friendly_name")
                        .cloned()
                        .collect();
                    names.sort();
                    names
                })
                .unwrap_or_default();
            attribute_names.sort();
            Some(HaBrowsedEntity { entity_id, state, friendly_name, attributes: attribute_names })
        })
        .collect();

    entities.sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    Json(entities).into_response()
}

// ── Global scripts ────────────────────────────────────────────────────────────

/// `PUT /api/project/global-scripts` — replace the global script list.
/// Saves to project.yaml and hot-swaps the supervisor.
async fn update_project_global_scripts(
    State(s): State<AppState>,
    Json(scripts): Json<Vec<GlobalScriptDef>>,
) -> StatusCode {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c };
    let status = patch_project(&dir, |p| p.global_scripts = scripts.clone()).await;
    if status == StatusCode::NO_CONTENT {
        // Hot-swap: cancel running scripts, start new set.
        if let Some(old) = s.script_supervisor.write().await.take() {
            old.stop();
        }
        if !scripts.is_empty() {
            let sc = crate::global_scripts::GlobalScriptSupervisor::start(
                scripts,
                s.db.clone(),
                s.bus.clone(),
            );
            *s.script_supervisor.write().await = Some(sc);
        }
    }
    status
}

// ── T-24 Project fingerprint ─────────────────────────────────────────────────

/// `GET /api/project/fingerprint` — SHA-256 of project.yaml + all synoptic YAMLs.
/// The fingerprint is deterministic: same file contents = same hash regardless of
/// when it is computed. Clients compare local vs. remote fingerprint to verify that
/// a deployment is in sync.
async fn get_project_fingerprint(State(s): State<AppState>) -> impl IntoResponse {
    use sha2::{Digest, Sha256};
    use std::time::{SystemTime, UNIX_EPOCH};

    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };

    let result = tokio::task::spawn_blocking(move || -> anyhow::Result<String> {
        let mut hasher = Sha256::new();

        // 1. Hash project.yaml
        let yaml = std::fs::read(dir.join("project.yaml"))
            .map_err(|e| anyhow::anyhow!("project.yaml: {e}"))?;
        hasher.update(&yaml);

        // 2. Hash synoptics sorted by filename for determinism
        let syn_dir = dir.join("synoptics");
        if syn_dir.is_dir() {
            let mut entries: Vec<std::path::PathBuf> = std::fs::read_dir(&syn_dir)
                .map_err(|e| anyhow::anyhow!("synoptics/: {e}"))?
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("yaml"))
                .collect();
            entries.sort();
            for path in &entries {
                // Prefix with filename so two files with identical content but
                // different names produce different overall hashes.
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    hasher.update(name.as_bytes());
                }
                let content = std::fs::read(path)
                    .map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?;
                hasher.update(&content);
            }
        }

        let digest = hasher.finalize();
        Ok(digest.iter().fold(String::new(), |mut s, b| { s.push_str(&format!("{:02x}", b)); s }))
    }).await;

    match result {
        Ok(Ok(sha256)) => {
            let computed_at_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Json(serde_json::json!({ "sha256": sha256, "computed_at_ms": computed_at_ms })).into_response()
        }
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e)     => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// ── T-20 GitOps ──────────────────────────────────────────────────────────────

/// `GET /api/project/git-status` — git commit info for the active project dir.
async fn get_git_status(State(s): State<AppState>) -> impl IntoResponse {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let gd = crate::git_deploy::GitDeploy::new(dir);
    if !gd.is_git_repo() {
        return StatusCode::NOT_FOUND.into_response();
    }
    match gd.status() {
        Ok(st) => Json(st).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `POST /api/project/deploy` — `git pull --ff-only` then soft-reload.
async fn trigger_deploy(State(s): State<AppState>) -> impl IntoResponse {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let gd = crate::git_deploy::GitDeploy::new(dir.clone());
    if !gd.is_git_repo() {
        return (StatusCode::BAD_REQUEST, "not a git repository").into_response();
    }
    match tokio::task::spawn_blocking(move || gd.pull()).await {
        Ok(Ok(msg)) => {
            soft_reload_project(&s, &dir).await;
            Json(serde_json::json!({ "message": msg })).into_response()
        }
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `POST /api/project/rollback` — `git reset --hard HEAD~1` then soft-reload.
async fn trigger_rollback(State(s): State<AppState>) -> impl IntoResponse {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let gd = crate::git_deploy::GitDeploy::new(dir.clone());
    if !gd.is_git_repo() {
        return (StatusCode::BAD_REQUEST, "not a git repository").into_response();
    }
    match tokio::task::spawn_blocking(move || gd.rollback()).await {
        Ok(Ok(msg)) => {
            soft_reload_project(&s, &dir).await;
            Json(serde_json::json!({ "message": msg })).into_response()
        }
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `POST /api/project/git/commit` — `git add -A && git commit -m <message>`.
async fn git_commit(State(s): State<AppState>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let gd = crate::git_deploy::GitDeploy::new(dir);
    if !gd.is_git_repo() {
        return (StatusCode::BAD_REQUEST, "not a git repository").into_response();
    }
    let message = body.get("message").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if message.is_empty() {
        return (StatusCode::BAD_REQUEST, "commit message is required").into_response();
    }
    match tokio::task::spawn_blocking(move || gd.commit(&message)).await {
        Ok(Ok(msg)) => Json(serde_json::json!({ "message": msg })).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e)     => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// `POST /api/project/git/push` — `git push` to default remote/branch.
async fn git_push(State(s): State<AppState>) -> impl IntoResponse {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let gd = crate::git_deploy::GitDeploy::new(dir);
    if !gd.is_git_repo() {
        return (StatusCode::BAD_REQUEST, "not a git repository").into_response();
    }
    match tokio::task::spawn_blocking(move || gd.push()).await {
        Ok(Ok(msg)) => Json(serde_json::json!({ "message": msg })).into_response(),
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        Err(e)     => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// Reload project YAML without restarting sources or clearing the historian.
/// Used by GitOps deploy/rollback to apply config changes from new commits.
async fn soft_reload_project(s: &AppState, dir: &std::path::Path) {
    let project = match Project::load(dir) {
        Ok(p) => p,
        Err(e) => { warn!("git deploy: project reload failed: {e:#}"); return; }
    };
    {
        let derived: Vec<(String, String)> = project.tags.iter()
            .filter_map(|t| t.expression.as_ref().map(|e| (t.id.clone(), e.clone())))
            .collect();
        *s.derived_tags.write().await = derived;
    }
    project.populate_tags(&s.db).await;
    s.alarms.load(project.alarms.clone()).await;
    {
        let mut funcs = s.functions.write().await;
        funcs.clear();
        for f in &project.functions {
            funcs.insert(f.name.clone(), f.clone());
        }
    }
    info!(dir = %dir.display(), "git deploy: project soft-reloaded");
}

/// `PUT /api/project/notifications` — save SMTP / notification config and hot-swap supervisor.
/// Preserves the existing SMTP password if the caller sends the masked placeholder.
async fn update_project_notifications(
    State(s): State<AppState>,
    Json(config): Json<Option<NotificationConfig>>,
) -> StatusCode {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c };

    // Preserve existing password when the UI sends the masked placeholder.
    let config = if let Some(mut cfg) = config {
        if let Some(smtp) = &mut cfg.smtp {
            if smtp.password.as_deref() == Some(MASKED_PASSWORD) {
                // Load the real password from disk.
                if let Ok(existing) = Project::load(&dir) {
                    smtp.password = existing.notifications
                        .and_then(|n| n.smtp)
                        .and_then(|s| s.password);
                }
            }
        }
        Some(cfg)
    } else {
        None
    };

    let config_clone = config.clone();
    let status = patch_project(&dir, |p| p.notifications = config_clone).await;
    if status == StatusCode::NO_CONTENT {
        // Hot-swap notification supervisor.
        if let Some(old) = s.notification_supervisor.write().await.take() {
            old.stop();
        }
        if let Some(cfg) = config {
            let sup = crate::notifications::NotificationSupervisor::start(
                s.alarms.clone(),
                cfg,
            );
            *s.notification_supervisor.write().await = Some(sup);
        }
    }
    status
}
