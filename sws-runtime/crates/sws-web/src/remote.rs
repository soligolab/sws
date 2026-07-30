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

/// Nome del progetto e utenti contenuti in un bundle di export.
///
/// Si legge dal bundle e non dallo stato locale perché è *questo* che arriverà
/// sul target: il nome decide se il deploy sta ridistribuendo lo stesso progetto
/// (e quindi va preservato lo stato del dispositivo), gli utenti servono solo per
/// dire al maintainer se differiscono da quelli sul dispositivo.
fn read_bundle_meta(zip: &[u8]) -> (Option<String>, Vec<String>) {
    let entry = |a: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>, name: &str| -> Option<String> {
        use std::io::Read;
        let mut e = a.by_name(name).ok()?;
        let mut buf = String::new();
        e.read_to_string(&mut buf).ok()?;
        Some(buf)
    };
    let mut archive = match zip::ZipArchive::new(std::io::Cursor::new(zip)) {
        Ok(a) => a,
        Err(_) => return (None, Vec::new()),
    };
    let name = entry(&mut archive, "manifest.json")
        .and_then(|txt| serde_json::from_str::<serde_json::Value>(&txt).ok())
        .and_then(|v| v["name"].as_str().map(|s| s.to_string()));
    // `users.yaml` è `{ users: [ { username, password_hash, … } ] }` (sws-auth).
    let users = entry(&mut archive, "users.yaml")
        .map(|txt| read_usernames(&txt))
        .unwrap_or_default();
    (name, users)
}

/// Confronta gli utenti del bundle con quelli sul dispositivo e lo riferisce nel
/// log del deploy. Non modifica nulla: allineare gli account è un'azione
/// esplicita ("Aggiorna utenti sul dispositivo" in Configurazione → Runtime),
/// perché un deploy che cambia chi può accedere a un pannello in servizio è
/// esattamente il genere di effetto collaterale che non si vuole scoprire dopo.
async fn report_user_divergence(
    client: &reqwest::Client,
    base: &str,
    auth_hdr: &Option<String>,
    bundle_users: &[String],
    send: &impl Fn(&str),
) {
    let mut r = client.get(format!("{base}/api/auth/users"));
    if let Some(h) = auth_hdr { r = r.header("Authorization", h); }
    let device_users: Vec<String> = match r.send().await {
        Ok(resp) if resp.status().is_success() => {
            let v: serde_json::Value = resp.json().await.unwrap_or_default();
            v.as_array().map(|a| a.iter()
                .filter_map(|u| u["username"].as_str().map(|s| s.to_string()))
                .collect()).unwrap_or_default()
        }
        // Lista non leggibile: il dispositivo ha utenti configurati e la
        // connessione non ha un token admin. Il confronto non si può fare, ma
        // **tacere è la scelta peggiore**: è il caso in cui il dispositivo ha
        // account veri, cioè quello in cui sapere che il deploy non li ha
        // toccati conta di più.
        _ => {
            send("ⓘ Il deploy non ha modificato gli account del dispositivo.");
            send("    Elenco non verificabile da qui: connettiti con credenziali admin per confrontarlo.");
            return;
        }
    };
    if bundle_users.is_empty() && device_users.is_empty() { return; }

    let mut only_project: Vec<&String> = bundle_users.iter().filter(|u| !device_users.contains(u)).collect();
    let mut only_device:  Vec<&String> = device_users.iter().filter(|u| !bundle_users.contains(u)).collect();
    only_project.sort(); only_device.sort();
    if only_project.is_empty() && only_device.is_empty() { return; }

    send("⚠ Gli utenti del progetto e quelli del dispositivo differiscono:");
    if !only_project.is_empty() {
        send(&format!("    solo nel progetto: {}", only_project.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
    }
    if !only_device.is_empty() {
        send(&format!("    solo sul dispositivo: {}", only_device.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
    }
    send("    Il deploy NON modifica gli account del dispositivo.");
    send("    Per allinearli: Configurazione → Runtime → \"Aggiorna utenti sul dispositivo\".");
}


/// `POST /api/remote/users` — spedisce `users.yaml` del progetto locale al
/// runtime remoto connesso, sostituendo gli account del dispositivo.
///
/// Esiste perché il deploy **non** li tocca più (decisione del maintainer): chi
/// aggiunge un utente nell'IDE deve poterlo mandare sul dispositivo, ma come
/// azione dichiarata, non come effetto collaterale invisibile di un deploy.
///
/// Si trasferisce il **file**, non le password: contiene gli hash Argon2, quindi
/// gli account arrivano funzionanti senza che né l'IDE né questa richiesta
/// vedano mai una password in chiaro.
pub async fn remote_push_users(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Response {
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, "Nessun runtime remoto connesso").into_response(),
    };
    let proj_dir = match s.project_dir.read().await.clone() {
        Some(d) => d,
        None => return (StatusCode::BAD_REQUEST, "Nessun progetto attivo").into_response(),
    };
    let users_path = proj_dir.join("users.yaml");
    let yaml = match tokio::fs::read_to_string(&users_path).await {
        Ok(y) => y,
        Err(_) => return (
            StatusCode::BAD_REQUEST,
            "Il progetto locale non ha utenti definiti: non c'è nulla da inviare.",
        ).into_response(),
    };
    let count = read_usernames(&yaml).len();
    if count == 0 {
        // Rifiutare è più sicuro che obbedire: spedire una lista vuota
        // chiuderebbe fuori dal pannello chiunque lo stia usando.
        return (
            StatusCode::BAD_REQUEST,
            "Il progetto locale non ha utenti: inviarli lascerebbe il dispositivo senza account.",
        ).into_response();
    }

    s.audit.log("remote.push_users", Some(user.username), serde_json::json!({
        "url": target.url, "users": count,
    }));

    let client = make_remote_client();
    let base = target.url.trim_end_matches('/');
    let mut req = client
        .put(format!("{base}/api/auth/users-file"))
        .header("Content-Type", "application/x-yaml")
        .body(yaml);
    if !target.token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", target.token));
    }
    match req.send().await {
        Ok(r) if r.status().is_success() => (
            StatusCode::OK,
            Json(serde_json::json!({
                "users": count,
                "note": "Le sessioni aperte sul dispositivo sono state invalidate: chi era collegato deve rifare il login.",
            })),
        ).into_response(),
        Ok(r) if r.status() == StatusCode::UNAUTHORIZED || r.status() == StatusCode::FORBIDDEN => (
            StatusCode::BAD_GATEWAY,
            "Il dispositivo ha rifiutato la richiesta (non autorizzato). Sostituire gli account \
             richiede una connessione con credenziali admin: riconnettiti compilando utente e \
             password del dispositivo, poi riprova.".to_string(),
        ).into_response(),
        Ok(r) => {
            let code = r.status();
            let body = r.text().await.unwrap_or_default();
            (StatusCode::BAD_GATEWAY, format!("Il dispositivo ha risposto {code}: {body}")).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("Richiesta al dispositivo fallita: {e}")).into_response(),
    }
}

/// Username contenuti in un `users.yaml` (`{ users: [ { username, … } ] }`).
pub fn read_usernames(yaml: &str) -> Vec<String> {
    serde_yaml::from_str::<serde_yaml::Value>(yaml)
        .ok()
        .and_then(|v| v["users"].as_sequence().map(|seq| {
            seq.iter().filter_map(|u| u["username"].as_str().map(|s| s.to_string())).collect()
        }))
        .unwrap_or_default()
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

        // Nome con cui il progetto arriverà sul target: si legge dal manifest
        // dello ZIP appena costruito, così è esattamente quello che userà
        // l'upload — e non una ricostruzione dal nome della cartella locale.
        let (deploy_name, bundle_users) = read_bundle_meta(&zip);

        let client = make_remote_client();
        let base = target.url.trim_end_matches('/').to_string();
        let auth_hdr: Option<String> = if target.token.is_empty() { None }
            else { Some(format!("Bearer {}", target.token)) };

        // Single-project runtime: wipe every existing project on the target so
        // the deploy fully overwrites it (not just the same-named one).
        // Vero se sul target esisteva un progetto con lo stesso nome e ne abbiamo
        // conservato lo stato: solo allora l'upload deve accettare la cartella
        // già esistente (e non cancellarla in caso di errore).
        let mut preserved_same_name = false;
        send("Aggiornamento progetto sul target…");
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
                            // Stesso nome = stai ridistribuendo QUESTO progetto: si
                            // rimuovono solo i file di progettazione e si lascia lo
                            // stato del dispositivo (database storico in testa).
                            // Nome diverso = lo stai sostituendo con un altro
                            // progetto, e preservarne lo storico non ha senso.
                            let same = deploy_name.as_deref() == Some(n);
                            let url = if same {
                                format!("{base}/api/projects/{}?preserve_state=true", pct_encode(n))
                            } else {
                                format!("{base}/api/projects/{}", pct_encode(n))
                            };
                            let mut rd = client.delete(url);
                            if let Some(h) = &auth_hdr { rd = rd.header("Authorization", h); }
                            match rd.send().await {
                                Ok(d) if d.status().is_success() => {
                                    if same {
                                        preserved_same_name = true;
                                        send(&format!("  ✓ \"{n}\": pagine sostituite, database e backup conservati"));
                                    } else {
                                        send(&format!("  ✓ rimosso \"{n}\""));
                                    }
                                }
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
        let upload_url = if preserved_same_name {
            // `deploy=true`: la cartella esiste già (svuotata dei soli file di
            // progettazione), `users.yaml` dello ZIP va ignorato e un errore non
            // deve cancellare la cartella.
            match &deploy_name {
                Some(n) => format!("{base}/api/projects/upload?deploy=true&name={}", pct_encode(n)),
                None    => format!("{base}/api/projects/upload?deploy=true"),
            }
        } else {
            format!("{base}/api/projects/upload")
        };
        let mut req = client.post(upload_url)
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
                // Gli account del dispositivo non vengono toccati dal deploy. Se
                // differiscono da quelli del progetto lo si dice qui: la scelta è
                // deliberata, ma se resta invisibile chi aggiunge un utente
                // nell'IDE si aspetta di trovarlo sul dispositivo e non lo trova.
                report_user_divergence(&client, &base, &auth_hdr, &bundle_users, &send).await;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Costruisce uno ZIP di export minimo in memoria.
    fn bundle(manifest: Option<&str>, users: Option<&str>) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut z = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
            if let Some(m) = manifest {
                z.start_file("manifest.json", opts).unwrap();
                z.write_all(m.as_bytes()).unwrap();
            }
            z.start_file("project.yaml", opts).unwrap();
            z.write_all(b"meta:\n  name: impianto\n").unwrap();
            if let Some(u) = users {
                z.start_file("users.yaml", opts).unwrap();
                z.write_all(u.as_bytes()).unwrap();
            }
            z.finish().unwrap();
        }
        buf
    }

    /// Il nome decide se il deploy prende il percorso che PRESERVA lo stato del
    /// dispositivo (nome uguale) o quello distruttivo (nome diverso). Se questa
    /// lettura fallisce in silenzio si torna a cancellare il database: è la
    /// ragione per cui il caso ha un test e non un'ispezione a occhio.
    #[test]
    fn legge_nome_e_utenti_dal_bundle() {
        let z = bundle(
            Some(r#"{"name":"impianto","version":"1"}"#),
            Some("users:\n  - username: admin_ide\n    role: Admin\n  - username: operatore\n    role: Operator\n"),
        );
        let (name, users) = read_bundle_meta(&z);
        assert_eq!(name.as_deref(), Some("impianto"));
        assert_eq!(users, vec!["admin_ide".to_string(), "operatore".to_string()]);
    }

    #[test]
    fn bundle_senza_users_yaml_non_ha_utenti() {
        let (name, users) = read_bundle_meta(&bundle(Some(r#"{"name":"x"}"#), None));
        assert_eq!(name.as_deref(), Some("x"));
        assert!(users.is_empty());
    }

    #[test]
    fn bundle_illeggibile_non_finge_un_nome() {
        // Nessun nome → il deploy NON deve credere di stare ridistribuendo lo
        // stesso progetto: meglio il comportamento distruttivo di prima che
        // sovrapporre pagine nuove a un progetto diverso.
        assert_eq!(read_bundle_meta(b"non uno zip").0, None);
        assert_eq!(read_bundle_meta(&bundle(None, None)).0, None);
    }
}
