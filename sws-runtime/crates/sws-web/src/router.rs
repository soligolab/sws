use std::{collections::HashMap, path::PathBuf, sync::Arc};
use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, put},
    Json, Router,
};
use serde::Deserialize;
use sws_core::{
    Project, ProjectMeta, SourceDef, TagDb, TagDef, TagId, TagQuality, TagState, TagUpdate,
    TagValue, TagWriteBus, WriteError,
};
use tracing::warn;
use crate::synoptic::{safe_filename, SynopticPage};

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<TagDb>,
    pub bus: Arc<TagWriteBus>,
    pub project_dir: Arc<PathBuf>,
}

pub fn build(db: Arc<TagDb>, bus: Arc<TagWriteBus>, project_dir: Arc<PathBuf>) -> Router {
    let state = AppState { db, bus, project_dir };
    Router::new()
        .route("/health",  get(|| async { "ok" }))
        .route("/metrics", get(|| async { "# SWS metrics placeholder\n" }))
        // Tag REST
        .route("/api/tags",      get(get_all_tags))
        .route("/api/tags/:id",  get(get_tag).put(write_tag))
        // Project info + config
        .route("/api/project",         get(get_project))
        .route("/api/project/tags",    put(update_project_tags))
        .route("/api/project/sources", put(update_project_sources))
        // Synoptic REST
        .route("/api/synoptics",      get(list_synoptics))
        .route("/api/synoptics/:name", get(get_synoptic).put(save_synoptic))
        // WebSocket
        .route("/ws/tags", get(ws_tags_handler))
        .with_state(state)
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

// ── Project endpoints ─────────────────────────────────────────────────────────

async fn get_project(State(s): State<AppState>) -> impl IntoResponse {
    match Project::load(&s.project_dir) {
        Ok(project) => Json(project).into_response(),
        Err(_)      => StatusCode::NOT_FOUND.into_response(),
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
    patch_project(&s.project_dir, |p| p.tags = tags).await
}

async fn update_project_sources(
    State(s): State<AppState>,
    Json(sources): Json<Vec<SourceDef>>,
) -> StatusCode {
    patch_project(&s.project_dir, |p| p.sources = sources).await
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
