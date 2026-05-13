use std::{collections::HashMap, path::PathBuf, sync::Arc};
use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, Path, Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use sws_auth::{AuthState, Credentials, LoginError, LoginOk, Role};
use sws_core::{
    AlarmDb, AlarmDef, AlarmState, FunctionDef, LogBus, LogEvent, Project, ProjectMeta, SourceDef,
    TagDb, TagDef, TagId, TagQuality, TagState, TagUpdate, TagValue, TagWriteBus, WriteError,
    MAX_FUNCTION_CODE_BYTES,
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
    pub project_dir: Arc<PathBuf>,
    pub logs: Arc<LogBus>,
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
    project_dir: Arc<PathBuf>,
    logs: Arc<LogBus>,
) -> Router {
    let state = AppState { db, bus, alarms, historian, py, auth, supervisor, functions, project_dir, logs };

    // Routes that need Admin privileges (PUT /api/project/* — schema edits,
    // plus the multi-user CRUD).
    let admin_routes = Router::new()
        .route("/api/project/tags",       put(update_project_tags))
        .route("/api/project/sources",    put(update_project_sources))
        .route("/api/project/alarms",     put(update_project_alarms))
        .route("/api/project/functions",  put(update_project_functions))
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
        // Logs — read-only but Operator+ so the audit surface stays
        // narrow (logs may include schema/secret hints).
        .route("/api/logs",            get(get_logs))
        .route("/ws/logs",             get(ws_logs_handler))
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

    // Always-open routes: liveness probes + login.
    let open = Router::new()
        .route("/health",  get(|| async { "ok" }))
        .route("/metrics", get(|| async { "# SWS metrics placeholder\n" }))
        .route("/api/auth/login", post(login));

    open.merge(protected).with_state(state)
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
        Ok(ExecOutput { stdout, stderr, sandboxed }) => Json(ScriptResult {
            ok: true, stdout, stderr, sandboxed, error: None,
        }),
        Err(e) => Json(ScriptResult {
            ok: false, error: Some(e), sandboxed: s.py.is_sandboxed(),
            ..Default::default()
        }),
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

async fn get_project(State(s): State<AppState>) -> impl IntoResponse {
    match Project::load(&s.project_dir) {
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

    let status = patch_project(&s.project_dir, |p| p.tags = tags).await;
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
    // Restore masked secrets: any MQTT source whose password came back as
    // the placeholder string is interpreted as "leave unchanged" — we look
    // the previous value up from the on-disk project. Without this round
    // a normal edit through the UI would wipe stored passwords.
    let previous = Project::load(&s.project_dir).ok();
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
    let status = patch_project(&s.project_dir, |p| p.sources = sources).await;
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
    let clone = alarms.clone();
    let status = patch_project(&s.project_dir, |p| p.alarms = alarms).await;
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

    let clone = functions.clone();
    let status = patch_project(&s.project_dir, |p| p.functions = functions).await;
    if status == StatusCode::NO_CONTENT {
        let mut map = s.functions.write().await;
        map.clear();
        for f in clone { map.insert(f.name.clone(), f); }
    }
    status.into_response()
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
        Ok(ExecOutput { stdout, stderr, sandboxed }) => Json(ScriptResult {
            ok: true, stdout, stderr, sandboxed, error: None,
        }).into_response(),
        Err(e) => Json(ScriptResult {
            ok: false, error: Some(e), sandboxed: s.py.is_sandboxed(),
            ..Default::default()
        }).into_response(),
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

fn synoptics_dir(state: &AppState) -> PathBuf {
    state.project_dir.join("synoptics")
}

async fn list_synoptics(State(s): State<AppState>) -> Json<Vec<String>> {
    let dir = synoptics_dir(&s);
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
    Json(names)
}

async fn get_synoptic(
    State(s): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let path = synoptics_dir(&s).join(format!("{}.yaml", safe_filename(&name)));
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

async fn save_synoptic(
    State(s): State<AppState>,
    Path(name): Path<String>,
    Json(page): Json<SynopticPage>,
) -> impl IntoResponse {
    let dir = synoptics_dir(&s);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        warn!("cannot create synoptics dir: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    let path = dir.join(format!("{}.yaml", safe_filename(&name)));
    match serde_yaml::to_string(&page) {
        Ok(yaml) => match tokio::fs::write(&path, yaml).await {
            Ok(_) => StatusCode::NO_CONTENT,
            Err(e) => { warn!("write {}: {e}", path.display()); StatusCode::INTERNAL_SERVER_ERROR }
        },
        Err(e) => { warn!("serialize synoptic: {e}"); StatusCode::INTERNAL_SERVER_ERROR }
    }
}

// ── WebSocket ────────────────────────────────────────────────────────────────

async fn ws_tags_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, s.db))
}

async fn handle_ws(mut socket: WebSocket, db: Arc<TagDb>) {
    for (id, state) in db.snapshot().await {
        let update = TagUpdate { id, state };
        if let Ok(text) = serde_json::to_string(&update) {
            if socket.send(Message::Text(text)).await.is_err() { return; }
        }
    }
    let mut rx = db.subscribe();
    loop {
        match rx.recv().await {
            Ok(update) => {
                if let Ok(text) = serde_json::to_string(&update) {
                    if socket.send(Message::Text(text)).await.is_err() { break; }
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                warn!("ws/tags subscriber lagged by {n}");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}

// ── Log streaming ────────────────────────────────────────────────────────────

async fn get_logs(State(s): State<AppState>) -> Json<Vec<LogEvent>> {
    Json(s.logs.snapshot())
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
