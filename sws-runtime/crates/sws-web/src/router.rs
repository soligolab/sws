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
    AlarmDb, AlarmDef, AlarmState, CustomSymbol, FunctionDef, LogBus, LogEvent, Project,
    ProjectMeta, SourceDef, TagDb, TagDef, TagId, TagQuality, TagState, TagUpdate, TagValue,
    TagWriteBus, WriteError, MAX_FUNCTION_CODE_BYTES,
};
use sws_historian::{Historian, Sample};
use sws_pyscript::{Engine as PyEngine, ExecOutput};
use tokio::sync::RwLock;
use tracing::warn;
use crate::source_supervisor::SourceSupervisor;
use crate::synoptic::{safe_filename, SynopticPage};

/// Resolved function registry keyed by name. Hot-swapped on every
/// `PUT /api/project/functions` so the run endpoint always sees the
/// latest body without a restart.
pub type FunctionsRegistry = Arc<RwLock<HashMap<String, FunctionDef>>>;

/// Mutable handle on the currently-active project directory. `None` means
/// "no project open" — handlers that need a project dir gate on this and
/// return 503. Wrapped in RwLock so `open`/`close` can swap it in-place
/// without rebuilding the whole AppState.
pub type ActiveProjectDir = Arc<RwLock<Option<PathBuf>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<TagDb>,
    pub bus: Arc<TagWriteBus>,
    pub alarms: Arc<AlarmDb>,
    pub historian: Arc<Historian>,
    pub py: PyEngine,
    pub auth: Arc<AuthState>,
    pub supervisor: Arc<SourceSupervisor>,
    pub functions: FunctionsRegistry,
    pub project_dir: ActiveProjectDir,
    pub projects_root: Arc<PathBuf>,
    pub templates_root: Arc<PathBuf>,
    pub logs: Arc<LogBus>,
    pub logs_dir: Arc<PathBuf>,
    pub started_at: std::time::Instant,
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
    py: PyEngine,
    auth: Arc<AuthState>,
    supervisor: Arc<SourceSupervisor>,
    functions: FunctionsRegistry,
    project_dir: ActiveProjectDir,
    projects_root: Arc<PathBuf>,
    templates_root: Arc<PathBuf>,
    logs: Arc<LogBus>,
    logs_dir: Arc<PathBuf>,
    started_at: std::time::Instant,
    www_dir: Option<PathBuf>,
) -> Router {
    let state = AppState { db, bus, alarms, historian, py, auth, supervisor, functions, project_dir, projects_root, templates_root, logs, logs_dir, started_at };

    // Routes that need Admin privileges (PUT /api/project/* — schema edits,
    // plus the multi-user CRUD).
    let admin_routes = Router::new()
        .route("/api/project/tags",           put(update_project_tags))
        .route("/api/project/sources",        put(update_project_sources))
        .route("/api/project/alarms",         put(update_project_alarms))
        .route("/api/project/functions",      put(update_project_functions))
        .route("/api/project/custom-symbols", put(update_project_custom_symbols))
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
        .route_layer(middleware::from_fn(require_admin));

    // Routes that need Operator+ (tag writes, alarm ACK, script exec,
    // synoptic save). Viewers can read everything but can't change state.
    let operator_routes = Router::new()
        .route("/api/tags/:id",        put(write_tag))
        .route("/api/alarms/:id/ack",  post(ack_alarm))
        .route("/api/script/exec",     post(exec_script))
        .route("/api/script/run/:name", post(run_function))
        .route("/api/synoptics/:name", put(save_synoptic))
        // Single-page YAML import — body is the raw YAML; replaces or creates
        // the named page. Allocates a fresh id so an import never collides
        // with an existing one.
        .route("/api/synoptics/import", post(import_synoptic_yaml))
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
        .route("/api/system",             get(crate::system::get_system_status))
        .route_layer(middleware::from_fn(require_operator));

    // Routes any authenticated user (incl. Viewer) can hit.
    let read_routes = Router::new()
        // Tag REST (reads)
        .route("/api/tags",      get(get_all_tags))
        .route("/api/tags/:id",  get(get_tag))
        // Alarm REST (reads)
        .route("/api/alarms",    get(get_alarms))
        // Historian
        .route("/api/history/:tag", get(get_history))
        // Project info (read)
        .route("/api/project",   get(get_project))
        // Synoptic REST (reads)
        .route("/api/synoptics",       get(list_synoptics))
        .route("/api/synoptics/:name", get(get_synoptic))
        // Per-page export — raw YAML download. Same shape as the file on disk,
        // small enough to skip the ZIP wrapper used by the bulk export.
        .route("/api/synoptics/:name/export", get(export_synoptic_yaml))
        // WebSocket streams
        .route("/ws/tags",   get(ws_tags_handler))
        .route("/ws/alarms", get(ws_alarms_handler));

    // The "blocking" set — all routes above plus all the operator/admin
    // routes — is gated by the must_change_password flag in addition to
    // the role checks. A user flagged for password change can still hit
    // the self-service endpoints below.
    let blocking = read_routes
        .merge(operator_routes)
        .merge(admin_routes)
        .route_layer(middleware::from_fn(require_password_changed));

    // Self-service endpoints: any authenticated user, including one with
    // must_change_password=true, can hit these.
    let self_service = Router::new()
        .route("/api/auth/whoami",          get(whoami))
        .route("/api/auth/logout",          post(logout))
        .route("/api/auth/change-password", post(change_password));

    let protected = blocking
        .merge(self_service)
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));

    // Pre-auth project lifecycle endpoints — the WelcomeScreen calls these
    // before any session token exists. They operate on `projects_root` and
    // `templates_root` only (no AuthState dependency).
    let project_lifecycle = Router::new()
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

    // Always-open routes: liveness probes + login + project lifecycle.
    let open = Router::new()
        .route("/health",  get(|| async { "ok" }))
        .route("/metrics", get(crate::metrics::get_metrics))
        .route("/api/auth/login", post(login))
        .merge(project_lifecycle);

    let mut app = open.merge(protected);

    // Serve the Vite-built SPA from disk when --www is provided. Any path that
    // doesn't match an API/WS route falls through to ServeDir; 404s inside
    // ServeDir fall back to index.html so the SPA can handle client-side
    // routing on a refresh. This is the "single-binary" deployment shape:
    // the editor container is no longer required.
    if let Some(dir) = www_dir {
        let index = dir.join("index.html");
        let fallback = ServeDir::new(&dir).not_found_service(ServeFile::new(index));
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

    app.layer(cors).with_state(state)
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
    });
    next.run(req).await
}

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub username: String,
    pub role: Role,
    pub must_change_password: bool,
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

async fn require_admin(req: Request, next: Next) -> Response {
    if let Some(code) = check_role(&req, Role::Admin) {
        return code.into_response();
    }
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

// ── Auth endpoints ───────────────────────────────────────────────────────────

async fn login(
    State(s): State<AppState>,
    Json(creds): Json<Credentials>,
) -> Response {
    match s.auth.login(&creds).await {
        Ok(ok)  => Json(ok).into_response(),
        Err(LoginError::BadCredentials) => StatusCode::UNAUTHORIZED.into_response(),
        Err(LoginError::RateLimited)    => StatusCode::TOO_MANY_REQUESTS.into_response(),
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

#[derive(serde::Serialize)]
struct Whoami {
    username: String,
    role: Role,
    must_change_password: bool,
}

async fn whoami(req: Request) -> Json<Whoami> {
    // require_auth has already inserted AuthUser; missing here would be a bug.
    let user = req.extensions().get::<AuthUser>().cloned()
        .unwrap_or(AuthUser { username: String::new(), role: Role::Viewer, must_change_password: false });
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
}

async fn get_history(
    State(s): State<AppState>,
    Path(tag): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Json<Vec<Sample>> {
    let mut samples = s.historian.query(&tag, q.from, q.to).await;
    if let Some(n) = q.limit {
        if samples.len() > n {
            samples = samples.split_off(samples.len() - n);
        }
    }
    Json(samples)
}

// ── Alarm endpoints ──────────────────────────────────────────────────────────

async fn get_alarms(State(s): State<AppState>) -> Json<Vec<AlarmState>> {
    Json(s.alarms.snapshot().await)
}

async fn ack_alarm(State(s): State<AppState>, Path(id): Path<String>) -> StatusCode {
    if s.alarms.ack(&id).await { StatusCode::NO_CONTENT } else { StatusCode::NOT_FOUND }
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
        Err(_) => StatusCode::NOT_FOUND.into_response(),
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
    status
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

    let buf = match build_export_zip(&manifest, &project, &pages) {
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

async fn list_synoptics(State(s): State<AppState>) -> Response {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let dir = synoptics_dir_at(&project_dir);
    let mut names = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    names.push(stem.to_owned());
                }
            }
        }
    }
    names.sort();
    Json(names).into_response()
}

async fn get_synoptic(
    State(s): State<AppState>,
    Path(name): Path<String>,
) -> Response {
    let project_dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    let path = synoptics_dir_at(&project_dir).join(format!("{}.yaml", safe_filename(&name)));
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => match serde_yaml::from_str::<SynopticPage>(&text) {
            Ok(page) => Json(page).into_response(),
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

// ── WebSocket ────────────────────────────────────────────────────────────────

/// Inbound message frame for `/ws/tags`. Only one variant for now (`write`)
/// but the discriminated-union shape leaves room for future ones
/// (`subscribe`, `unsubscribe`, etc.). Unknown variants are rejected by
/// `serde_json` and logged on the receiver task.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum InboundMsg {
    /// Operator+ write. `req_id` is an optional correlation id echoed in
    /// the ack so the client can match the response to its request.
    Write {
        tag: String,
        value: TagValue,
        #[serde(default)]
        req_id: Option<String>,
    },
}

/// Outbound ack for a `write` request. Sent on the same socket the
/// caller used.
#[derive(serde::Serialize)]
struct WriteAck {
    #[serde(rename = "type")]
    ty: &'static str, // always "ack"
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
    // Split the socket so the broadcast pump (sends) and the inbound write
    // loop (receives) can run concurrently. mpsc bridges incoming writes
    // back to the sender so we serialise every outbound message through
    // one task — otherwise concurrent sends would race on the WS framer.
    use futures_util::{SinkExt, StreamExt};
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<Message>(32);

    // Initial snapshot frame.
    for (id, state) in db.snapshot().await {
        let update = TagUpdate { id, state };
        if let Ok(text) = serde_json::to_string(&update) {
            if out_tx.send(Message::Text(text)).await.is_err() {
                return;
            }
        }
    }

    // Forwarder: pumps the mpsc queue onto the socket.
    let forward_task = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if ws_tx.send(msg).await.is_err() { break; }
        }
    });

    // Broadcast subscriber: every tag update lands in the queue as a
    // serialised TagUpdate JSON frame.
    let mut rx = db.subscribe();
    let broadcast_tx = out_tx.clone();
    let broadcast_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(update) => {
                    if let Ok(text) = serde_json::to_string(&update) {
                        if broadcast_tx.send(Message::Text(text)).await.is_err() { break; }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!("ws/tags subscriber lagged by {n}");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Inbound loop: read client frames and dispatch writes. Closing the
    // socket from this side propagates: dropping `out_tx` ends the
    // forwarder task; aborting `broadcast_task` cleans up the subscriber.
    while let Some(frame) = ws_rx.next().await {
        let frame = match frame {
            Ok(f) => f,
            Err(_) => break,
        };
        match frame {
            Message::Text(text) => {
                let parsed: Result<InboundMsg, _> = serde_json::from_str(&text);
                let Ok(msg) = parsed else {
                    let ack = WriteAck {
                        ty: "ack", req_id: None, tag: String::new(),
                        ok: false, error: Some("invalid frame".into()),
                    };
                    let _ = out_tx.send(Message::Text(serde_json::to_string(&ack).unwrap_or_default())).await;
                    continue;
                };
                match msg {
                    InboundMsg::Write { tag, value, req_id } => {
                        // Role gate: Operator+ only. Mirror the HTTP
                        // /api/tags/:id rule so the WS path doesn't open
                        // a side channel that bypasses it.
                        if role < Role::Operator {
                            let ack = WriteAck {
                                ty: "ack", req_id, tag,
                                ok: false, error: Some("forbidden: Operator+ required".into()),
                            };
                            let _ = out_tx.send(Message::Text(serde_json::to_string(&ack).unwrap_or_default())).await;
                            continue;
                        }
                        // Route through the bus (plugin) first; fall back
                        // to direct TagDb set so virtual / scripted tags
                        // keep working. Same shape as write_tag().
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
                }
            }
            Message::Close(_) => break,
            // Pings are handled by axum's WS layer; binary frames are
            // not a supported protocol on this endpoint.
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
    };

    match sws_plugin_opcua::detect_euromap(&cfg).await {
        Ok(det) => Json(det).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, format!("opcua euromap detection failed: {e}")).into_response(),
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
