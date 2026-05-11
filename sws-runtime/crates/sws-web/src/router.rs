use std::{collections::HashMap, sync::Arc};
use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use sws_core::{TagDb, TagId, TagState, TagUpdate};
use tracing::warn;

pub fn build(db: Arc<TagDb>) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/metrics", get(|| async { "# SWS metrics placeholder\n" }))
        .route("/api/tags", get(get_all_tags))
        .route("/api/tags/:id", get(get_tag))
        .route("/ws/tags", get(ws_tags_handler))
        .with_state(db)
}

async fn get_all_tags(State(db): State<Arc<TagDb>>) -> Json<HashMap<TagId, TagState>> {
    Json(db.snapshot().await)
}

async fn get_tag(
    State(db): State<Arc<TagDb>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match db.get(&id).await {
        Some(state) => Json(state).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn ws_tags_handler(
    ws: WebSocketUpgrade,
    State(db): State<Arc<TagDb>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, db))
}

async fn handle_ws(mut socket: WebSocket, db: Arc<TagDb>) {
    // Send current snapshot so the client has values immediately on connect
    for (id, state) in db.snapshot().await {
        let update = TagUpdate { id, state };
        if let Ok(text) = serde_json::to_string(&update) {
            if socket.send(Message::Text(text)).await.is_err() {
                return;
            }
        }
    }

    // Stream subsequent updates
    let mut rx = db.subscribe();
    loop {
        match rx.recv().await {
            Ok(update) => {
                if let Ok(text) = serde_json::to_string(&update) {
                    if socket.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                warn!("ws/tags subscriber lagged by {n} messages");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}
