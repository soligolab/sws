use std::time::{SystemTime, UNIX_EPOCH};
use axum::{
    body::Body,
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use crate::router::{AppState, AuthUser};

/// Credentials for a connected remote runtime. Stored in AppState and used
/// by the WS relay handlers to proxy `/ws/remote/{tags,alarms,logs}`.
/// Volatile — cleared on local runtime restart.
#[derive(Clone, Debug)]
pub struct RemoteTarget {
    pub url: String,           // "http://192.168.1.10:8444" — no trailing slash
    pub token: String,         // UUID session token issued by the remote
    pub connected_at_ms: u64,  // Unix epoch ms
}

#[derive(Deserialize)]
pub struct ConnectBody {
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Serialize)]
pub struct ConnectResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct RemoteStatus {
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected_at_ms: Option<u64>,
}

/// `POST /api/remote/connect` — authenticate against a remote runtime and
/// store the session token. Used by RuntimeConnectionTab instead of the old
/// browser-side fetch to `{target}/api/auth/login`.
pub async fn connect_remote(
    State(s): State<AppState>,
    Json(body): Json<ConnectBody>,
) -> (StatusCode, Json<ConnectResult>) {
    let url = body.url.trim().trim_end_matches('/').to_string();

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return (StatusCode::BAD_REQUEST, Json(ConnectResult {
            ok: false,
            error: Some("URL must start with http:// or https://".into()),
        }));
    }

    // Use reqwest (already a dep) to authenticate against the remote. Accept
    // self-signed certs — on a trusted LAN this is the right default for PoC.
    let client = match reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(ConnectResult {
            ok: false,
            error: Some(format!("HTTP client error: {e}")),
        })),
    };

    // If credentials are provided, authenticate against the remote; otherwise
    // connect without a token (the remote is in no-auth / no-users mode).
    let username = body.username.as_deref().unwrap_or("").trim().to_string();
    let token = if username.is_empty() {
        String::new()
    } else {
        let password = body.password.as_deref().unwrap_or("").to_string();
        let login_url = format!("{url}/api/auth/login");
        let res = match client
            .post(&login_url)
            .json(&serde_json::json!({ "username": username, "password": password }))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return (StatusCode::BAD_GATEWAY, Json(ConnectResult {
                ok: false,
                error: Some(format!("Cannot reach {url}: {e}")),
            })),
        };

        if res.status() == 401 {
            return (StatusCode::UNAUTHORIZED, Json(ConnectResult {
                ok: false,
                error: Some("Wrong credentials for the remote runtime".into()),
            }));
        }
        if !res.status().is_success() {
            let code = res.status();
            return (StatusCode::BAD_GATEWAY, Json(ConnectResult {
                ok: false,
                error: Some(format!("Remote login returned {code}")),
            }));
        }

        let payload: serde_json::Value = match res.json().await {
            Ok(j) => j,
            Err(e) => return (StatusCode::BAD_GATEWAY, Json(ConnectResult {
                ok: false,
                error: Some(format!("Bad JSON from remote login: {e}")),
            })),
        };

        match payload.get("token").and_then(|t| t.as_str()) {
            Some(t) => t.to_string(),
            None => return (StatusCode::BAD_GATEWAY, Json(ConnectResult {
                ok: false,
                error: Some("Remote login response has no 'token' field".into()),
            })),
        }
    };

    // Verify the URL really points at an ADMIN/IDE port before declaring the
    // connection good. Two reasons this check has to exist:
    //  - in no-auth mode the block above performs NO request at all, so any
    //    reachable (or even unreachable) URL used to turn the UI green;
    //  - probing /health would not help: it answers on the viewer port too.
    // The project-lifecycle routes live only on the admin port (dual-port
    // architecture), so `GET /api/projects` is the discriminating probe — it
    // is pre-auth there, hence usable with or without a token.
    // Without this, connecting to the viewer port succeeded and the failure
    // surfaced only later as "404 Not Found" + "405 Method Not Allowed"
    // in the middle of a deploy.
    let probe_url = format!("{url}/api/projects");
    let mut probe = client.get(&probe_url);
    if !token.is_empty() {
        probe = probe.bearer_auth(&token);
    }
    match probe.send().await {
        Ok(r) if r.status().is_success() => {}
        Ok(r) if r.status() == StatusCode::NOT_FOUND => {
            return (StatusCode::BAD_GATEWAY, Json(ConnectResult {
                ok: false,
                error: Some(format!(
                    "{url} answers but exposes no project API — this looks like the \
                     viewer port. Use the IDE/admin port instead (8444 by default)."
                )),
            }));
        }
        Ok(r) => {
            let code = r.status();
            return (StatusCode::BAD_GATEWAY, Json(ConnectResult {
                ok: false,
                error: Some(format!("Target returned {code} on /api/projects")),
            }));
        }
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, Json(ConnectResult {
                ok: false,
                error: Some(format!("Cannot reach {url}: {e}")),
            }));
        }
    }

    let connected_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    *s.remote_target.write().await = Some(RemoteTarget { url: url.clone(), token, connected_at_ms });
    tracing::info!(remote = %url, "connected to remote runtime");

    (StatusCode::OK, Json(ConnectResult { ok: true, error: None }))
}

/// `DELETE /api/remote/connect` — clear the remote target state.
pub async fn disconnect_remote(State(s): State<AppState>) -> StatusCode {
    if s.remote_target.write().await.take().is_some() {
        tracing::info!("disconnected from remote runtime");
    }
    StatusCode::NO_CONTENT
}

fn make_remote_client() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("reqwest client")
}

/// Percent-encode a string for use in a URL path segment (simple ASCII-safe version).
fn pct_encode(s: &str) -> String {
    s.chars().map(|c| match c {
        'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
        _ => format!("%{:02X}", c as u32),
    }).collect()
}

/// `POST /api/remote/deploy` — export the active local project as a ZIP and
/// upload it to the connected remote runtime server-side (AcceptAnyCert,
/// reuses the existing session token from `remote_target`).
/// Returns a streaming newline-delimited text log.
pub async fn remote_deploy(
    State(s): State<AppState>,
    Extension(_user): Extension<AuthUser>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "Nessun runtime remoto connesso").into_response(),
    };
    let proj_dir = match s.project_dir.read().await.clone() {
        Some(d) => d,
        None => return (StatusCode::BAD_REQUEST, "Nessun progetto attivo").into_response(),
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(64);

    tokio::spawn(async move {
        let send = |msg: &str| { let _ = tx.try_send(format!("{msg}\n")); };

        send("Esportazione progetto locale…");
        let zip = match crate::router::build_project_zip(&proj_dir).await {
            Ok(z) => z,
            Err(e) => { send(&format!("✗ {e}")); return; }
        };
        send(&format!("✓ Esportato ({:.1} KB)", zip.len() as f64 / 1024.0));

        let client = make_remote_client();
        let base = target.url.trim_end_matches('/').to_string();
        let auth_hdr: Option<String> = if target.token.is_empty() { None }
            else { Some(format!("Bearer {}", target.token)) };

        // Single-project runtime: wipe every existing project on the target so
        // the deploy fully overwrites it (not just the same-named one).
        send("Pulizia progetti esistenti sul target…");
        let mut r = client.get(format!("{base}/api/projects"));
        if let Some(h) = &auth_hdr { r = r.header("Authorization", h); }
        match r.send().await {
            Ok(resp) if resp.status().is_success() => {
                let list: serde_json::Value = resp.json().await.unwrap_or_default();
                if let Some(arr) = list.as_array() {
                    if !arr.is_empty() {
                        // Close any active project first so delete isn't rejected (409).
                        let mut rc = client.post(format!("{base}/api/projects/close"));
                        if let Some(h) = &auth_hdr { rc = rc.header("Authorization", h); }
                        let _ = rc.send().await;
                    }
                    for item in arr {
                        if let Some(n) = item["name"].as_str() {
                            let mut rd = client.delete(format!("{base}/api/projects/{}", pct_encode(n)));
                            if let Some(h) = &auth_hdr { rd = rd.header("Authorization", h); }
                            match rd.send().await {
                                Ok(d) if d.status().is_success() => send(&format!("  ✓ rimosso \"{n}\"")),
                                Ok(d) => send(&format!("  ⚠ \"{n}\": {}", d.status())),
                                Err(e) => send(&format!("  ⚠ \"{n}\": {e}")),
                            }
                        }
                    }
                }
            }
            Ok(resp) => send(&format!("⚠ Lista progetti non disponibile: {}", resp.status())),
            Err(e)   => send(&format!("⚠ Lista progetti non disponibile: {e}")),
        }

        // Upload ZIP
        send("Upload ZIP al target…");
        let mut req = client.post(format!("{base}/api/projects/upload"))
            .header("Content-Type", "application/zip")
            .body(zip.clone());
        if let Some(h) = &auth_hdr { req = req.header("Authorization", h); }
        let upload_res = match req.send().await {
            Ok(r) => r,
            Err(e) => { send(&format!("✗ {e}")); return; }
        };

        // Handle 409 conflict: close + delete old project, then retry
        let upload_res = if upload_res.status() == 409 {
            let body: serde_json::Value = upload_res.json().await.unwrap_or_default();
            let existing = body["name"].as_str().unwrap_or("?").to_string();
            send(&format!("Conflitto: rimozione \"{existing}\" dal target…"));

            // close active project on remote (ignore errors — might already be closed)
            let mut r = client.post(format!("{base}/api/projects/close"));
            if let Some(h) = &auth_hdr { r = r.header("Authorization", h); }
            let _ = r.send().await;

            // delete the conflicting project
            let mut r = client.delete(format!("{base}/api/projects/{}", pct_encode(&existing)));
            if let Some(h) = &auth_hdr { r = r.header("Authorization", h); }
            let del = match r.send().await {
                Ok(d) => d,
                Err(e) => { send(&format!("✗ {e}")); return; }
            };
            if !del.status().is_success() {
                send(&format!("✗ Delete fallito: {}", del.status()));
                return;
            }
            send(&format!("✓ Rimosso \"{existing}\""));

            // retry upload
            let mut req = client.post(format!("{base}/api/projects/upload"))
                .header("Content-Type", "application/zip")
                .body(zip.clone());
            if let Some(h) = &auth_hdr { req = req.header("Authorization", h); }
            match req.send().await {
                Ok(u) => u,
                Err(e) => { send(&format!("✗ {e}")); return; }
            }
        } else {
            upload_res
        };

        if !upload_res.status().is_success() {
            send(&format!("✗ Upload fallito: {}", upload_res.status()));
            return;
        }
        let body: serde_json::Value = upload_res.json().await.unwrap_or_default();
        let uploaded_name = body["name"].as_str().unwrap_or("?").to_string();
        send(&format!("✓ Caricato come \"{uploaded_name}\""));

        // Open (activate) the uploaded project on the remote
        send("Attivazione progetto…");
        let mut r = client.post(format!("{base}/api/projects/{}/open", pct_encode(&uploaded_name)));
        if let Some(h) = &auth_hdr { r = r.header("Authorization", h); }
        match r.send().await {
            Ok(o) if o.status().is_success() => {
                send(&format!("✓ \"{uploaded_name}\" attivo sul runtime"));
                send("🚀 Deploy completato!");
            }
            Ok(o) => send(&format!("✗ Attivazione fallita: {}", o.status())),
            Err(e) => send(&format!("✗ {e}")),
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx)
        .map(|l| Ok::<_, std::convert::Infallible>(axum::body::Bytes::from(l)));
    Response::builder()
        .header("content-type", "text/plain; charset=utf-8")
        .header("x-content-type-options", "nosniff")
        .body(Body::from_stream(stream))
        .unwrap()
}

/// `POST /api/remote/project/delete` — delete the project currently active on
/// the connected remote runtime (close + DELETE). Single-project model: there
/// is at most one project, so we resolve its name from the remote's
/// `/api/system` and remove it.
pub async fn delete_remote_project(
    State(s): State<AppState>,
    Extension(_user): Extension<AuthUser>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "Nessun runtime remoto connesso").into_response(),
    };
    let client = make_remote_client();
    let base = target.url.trim_end_matches('/').to_string();
    let auth_hdr: Option<String> = if target.token.is_empty() { None }
        else { Some(format!("Bearer {}", target.token)) };

    // Resolve the active project name from the remote system status.
    let mut r = client.get(format!("{base}/api/system"));
    if let Some(h) = &auth_hdr { r = r.header("Authorization", h); }
    let active = match r.send().await {
        Ok(resp) if resp.status().is_success() => {
            let v: serde_json::Value = resp.json().await.unwrap_or_default();
            v["active_project"].as_str().map(|s| s.to_string())
        }
        Ok(resp) => return (StatusCode::BAD_GATEWAY, format!("Stato runtime: {}", resp.status())).into_response(),
        Err(e)   => return (StatusCode::BAD_GATEWAY, format!("Stato runtime: {e}")).into_response(),
    };
    let name = match active {
        Some(n) => n,
        None => return (StatusCode::CONFLICT, "Nessun progetto attivo sul runtime").into_response(),
    };

    // Close (so delete isn't rejected with 409) then delete.
    let mut rc = client.post(format!("{base}/api/projects/close"));
    if let Some(h) = &auth_hdr { rc = rc.header("Authorization", h); }
    let _ = rc.send().await;

    let mut rd = client.delete(format!("{base}/api/projects/{}", pct_encode(&name)));
    if let Some(h) = &auth_hdr { rd = rd.header("Authorization", h); }
    match rd.send().await {
        Ok(d) if d.status().is_success() => {
            tracing::info!(project = %name, "deleted active project on remote runtime");
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(d) => (StatusCode::BAD_GATEWAY, format!("Delete fallito: {}", d.status())).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, format!("{e}")).into_response(),
    }
}

/// `GET /api/remote/status` — return connection state (polled by the IDE
/// every 5 s to detect remote restart / session expiry).
pub async fn remote_status(State(s): State<AppState>) -> Json<RemoteStatus> {
    let guard = s.remote_target.read().await;
    match guard.as_ref() {
        Some(t) => Json(RemoteStatus {
            connected: true,
            url: Some(t.url.clone()),
            connected_at_ms: Some(t.connected_at_ms),
        }),
        None => Json(RemoteStatus { connected: false, url: None, connected_at_ms: None }),
    }
}
