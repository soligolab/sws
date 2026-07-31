//! T-28 — IDE Package Builder + SSH Device Deployer
//!
//! Endpoints (Admin only, port 8444):
//!   POST /api/build/package             — run scripts/package.sh, stream log
//!   GET  /api/build/packages            — list built tarballs in dist/
//!   POST /api/deploy/device             — SCP tarball + run install.sh via SSH
//!   GET  /api/build/container-packages  — list built container image archives in dist/
//!   POST /api/deploy/device-container   — SCP image+installer + run install-container.sh via SSH

use axum::{
    body::Body,
    extract::{Json as EJson, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::{
    convert::Infallible,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::process::Command;
use tokio_stream::StreamExt;
use tracing::{error, info, warn};

use crate::router::AppState;

// ── Shared build lock ─────────────────────────────────────────────────────────

pub type BuildLock = Arc<Mutex<bool>>;

pub fn new_build_lock() -> BuildLock {
    Arc::new(Mutex::new(false))
}

// ── Helpers shared with deploy ────────────────────────────────────────────────

/// Mirror a progress/error line from a streaming build/deploy handler into the
/// app's main `tracing` logger (JSONL log files + Log viewer panel), not just
/// the ephemeral HTTP chunked stream the browser reads. `$target` must be a
/// literal — tracing callsites are cached as statics, so it can't be a
/// runtime value.
macro_rules! log_deploy_line {
    ($target:literal, $msg:expr) => {{
        let msg = $msg;
        if msg.starts_with("ERROR") {
            error!(target: $target, "{msg}");
        } else if msg.starts_with("WARN") {
            warn!(target: $target, "{msg}");
        } else {
            info!(target: $target, "{msg}");
        }
    }};
}

fn sshpass_available() -> bool {
    std::process::Command::new("which")
        .arg("sshpass")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Validate a remote path used in SSH commands.
/// Must be absolute, contain no `..` components, and consist only of
/// alphanumeric characters plus `-`, `_`, `.`, `/`.
/// This prevents shell injection when the path is interpolated into a
/// remote command string (e.g. `mkdir -p <dir> && tar xzf ... -C <dir>`).
fn validate_remote_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.contains("..")
        && path.chars().all(|c| c.is_ascii_alphanumeric() || "-_./".contains(c))
}

/// Resolve the repository root: current_dir() if scripts/package.sh exists there.
pub fn resolve_repo_root() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    if cwd.join("scripts/package.sh").exists() {
        Some(cwd)
    } else {
        None
    }
}

pub type RepoRoot = Arc<Option<PathBuf>>;

pub fn new_repo_root() -> RepoRoot {
    Arc::new(resolve_repo_root())
}

// ── POST /api/build/package ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BuildRequest {
    #[serde(default)]
    pub no_rust: bool,
    #[serde(default)]
    pub no_spa: bool,
}

pub async fn build_package(
    State(s): State<AppState>,
    EJson(req): EJson<BuildRequest>,
) -> Response {
    let repo = match s.repo_root.as_ref() {
        Some(p) => p.clone(),
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                "Build non disponibile: scripts/package.sh non trovato nella directory corrente.\n\
                 Esegui il runtime dalla radice del repository (./scripts/start_runtime.sh).",
            ).into_response();
        }
    };

    // Mutex: solo un build alla volta.
    {
        let mut running = s.build_running.lock().unwrap();
        if *running {
            return (StatusCode::CONFLICT, "Build già in corso.\n").into_response();
        }
        *running = true;
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(128);
    let lock = s.build_running.clone();

    tokio::spawn(async move {
        let send = |msg: &str| {
            let _ = tx.try_send(format!("{msg}\n"));
            log_deploy_line!("sws_web::build", msg);
        };

        let script = repo.join("scripts/package.sh");
        let mut cmd = Command::new("bash");
        cmd.arg(script.as_os_str());
        if req.no_rust { cmd.arg("--no-rust"); }
        if req.no_spa  { cmd.arg("--no-spa");  }
        // Merge stdout + stderr so both appear in the log stream.
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        cmd.current_dir(&repo);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                send(&format!("ERROR: impossibile avviare scripts/package.sh: {e}"));
                *lock.lock().unwrap() = false;
                return;
            }
        };

        // Read stdout and stderr concurrently to avoid pipe deadlock.
        // cargo build writes heavily to stderr; draining them sequentially
        // would block once either pipe's OS buffer fills (~64 KB).
        use tokio::io::{AsyncBufReadExt, BufReader};
        let stderr = child.stderr.take();
        let stdout = child.stdout.take();
        let tx_err = tx.clone();
        let stderr_task = tokio::spawn(async move {
            if let Some(s) = stderr {
                let mut lines = BufReader::new(s).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx_err.try_send(format!("{line}\n"));
                }
            }
        });
        if let Some(s) = stdout {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                send(&line);
            }
        }
        let _ = stderr_task.await;

        match child.wait().await {
            Ok(status) if status.success() => send("DONE"),
            Ok(status) => send(&format!("ERROR: package.sh terminato con codice {}", status.code().unwrap_or(-1))),
            Err(e) => send(&format!("ERROR: wait fallito: {e}")),
        }

        *lock.lock().unwrap() = false;
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx)
        .map(|line| Ok::<_, Infallible>(axum::body::Bytes::from(line)));

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/plain; charset=utf-8")
        .header("x-content-type-options", "nosniff")
        .body(Body::from_stream(stream))
        .unwrap()
}

// ── GET /api/build/packages ───────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PackageFile {
    pub name: String,
    pub size_bytes: u64,
    pub mtime_ms: u64,
}

pub async fn list_packages(State(s): State<AppState>) -> impl IntoResponse {
    let repo = match s.repo_root.as_ref() {
        Some(p) => p.clone(),
        None => return axum::Json(Vec::<PackageFile>::new()),
    };

    let dist = repo.join("dist");
    let mut files: Vec<PackageFile> = Vec::new();

    if let Ok(mut rd) = tokio::fs::read_dir(&dist).await {
        while let Ok(Some(entry)) = rd.next_entry().await {
            let path = entry.path();
            let name = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if !name.ends_with(".tar.gz") { continue; }
            if let Ok(meta) = tokio::fs::metadata(&path).await {
                let mtime_ms = meta.modified().ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                files.push(PackageFile {
                    name,
                    size_bytes: meta.len(),
                    mtime_ms,
                });
            }
        }
    }

    // Sort by mtime descending (newest first).
    files.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    axum::Json(files)
}

// ── GET /api/build/container-packages ─────────────────────────────────────────

/// Parse a container image archive name (`sws-runtime-<version>-<arch>-image.tar.gz`)
/// into `(version, arch)`. Returns `None` for anything else in `dist/`
/// (native binary tarballs, the SPA archive itself, stray files...).
fn parse_image_tarball(name: &str) -> Option<(String, String)> {
    let rest = name.strip_prefix("sws-runtime-")?;
    for arch in ["aarch64", "x86_64"] {
        if let Some(version) = rest.strip_suffix(&format!("-{arch}-image.tar.gz")) {
            return Some((version.to_string(), arch.to_string()));
        }
    }
    None
}

#[derive(Debug, Serialize)]
pub struct ContainerPackage {
    pub image_tarball: String,
    pub arch: String,
    pub version: String,
    pub size_bytes: u64,
    pub mtime_ms: u64,
}

pub async fn list_container_packages(State(s): State<AppState>) -> impl IntoResponse {
    let repo = match s.repo_root.as_ref() {
        Some(p) => p.clone(),
        None => return axum::Json(Vec::<ContainerPackage>::new()),
    };

    let dist = repo.join("dist");
    let mut out: Vec<ContainerPackage> = Vec::new();

    if let Ok(mut rd) = tokio::fs::read_dir(&dist).await {
        while let Ok(Some(entry)) = rd.next_entry().await {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            let Some((version, arch)) = parse_image_tarball(&name) else { continue };
            let Ok(meta) = tokio::fs::metadata(&path).await else { continue };
            let mtime_ms = meta.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(ContainerPackage {
                image_tarball: name,
                arch,
                version,
                size_bytes: meta.len(),
                mtime_ms,
            });
        }
    }

    out.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    axum::Json(out)
}

// ── POST /api/deploy/device ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct DeviceDeployRequest {
    /// Tarball file name (basename only, must exist in dist/).
    pub tarball: String,
    /// SSH hostname or IP.
    pub host: String,
    /// SSH port (default 22).
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    /// SSH username.
    pub user: String,
    /// SSH password (sent via sshpass if available).
    pub password: String,
    /// Remote working directory for the tarball + extraction.
    #[serde(default = "default_remote_dir")]
    pub remote_dir: String,
}

fn default_ssh_port() -> u16 { 22 }
fn default_remote_dir() -> String { "/tmp/sws-deploy".to_string() }

pub async fn deploy_device(
    State(s): State<AppState>,
    EJson(req): EJson<DeviceDeployRequest>,
) -> Response {
    let repo = match s.repo_root.as_ref() {
        Some(p) => p.clone(),
        None => {
            return (StatusCode::SERVICE_UNAVAILABLE,
                "repo_root non disponibile\n").into_response();
        }
    };

    // Validate remote_dir before accepting the request.
    if !validate_remote_path(&req.remote_dir) {
        return (StatusCode::BAD_REQUEST,
            "remote_dir non valido: deve essere un percorso assoluto senza '..' né caratteri speciali\n"
        ).into_response();
    }

    // Sanitize tarball name: only basename, must end with .tar.gz.
    let basename = PathBuf::from(&req.tarball)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    if !basename.ends_with(".tar.gz") || basename.is_empty() {
        return (StatusCode::BAD_REQUEST, "tarball non valido\n").into_response();
    }

    // Canonicalize to catch symlink escapes from dist/.
    let dist_dir = repo.join("dist");
    let tarball_path = dist_dir.join(&basename);
    if !tarball_path.exists() {
        return (StatusCode::NOT_FOUND,
            format!("tarball non trovato: dist/{basename}\n")).into_response();
    }
    let canon = match tarball_path.canonicalize() {
        Ok(p) => p,
        Err(_) => return (StatusCode::NOT_FOUND, "tarball non trovato\n").into_response(),
    };
    let canon_dist = match dist_dir.canonicalize() {
        Ok(p) => p,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "dist/ non trovata\n").into_response(),
    };
    if !canon.starts_with(&canon_dist) {
        return (StatusCode::BAD_REQUEST, "tarball fuori da dist/\n").into_response();
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(128);

    tokio::spawn(async move {
        let send = |msg: &str| {
            let _ = tx.try_send(format!("{msg}\n"));
            log_deploy_line!("sws_web::deploy", msg);
        };

        let use_sshpass = sshpass_available();
        if !use_sshpass {
            send("WARN: sshpass non trovato — la password verrà ignorata. Assicurati che la chiave SSH sia preconfigurata.");
        }

        let host_str = format!("{}@{}", req.user, req.host);
        let port_str = req.port.to_string();
        let remote_tar = format!("{}/{}", req.remote_dir, basename);

        // Stem = nome senza .tar.gz (es. sws-0.1.0-dev-linux-x86_64)
        let stem = basename.trim_end_matches(".tar.gz");
        let remote_install = format!("{}/{}/install.sh", req.remote_dir, stem);

        // ── 1. SCP upload ─────────────────────────────────────────────────
        send(&format!("==> SCP: {} → {}:{}", tarball_path.display(), host_str, remote_tar));

        let scp_ok = run_ssh_cmd(
            use_sshpass, &req.password,
            "scp",
            &["-P", &port_str, "-o", "StrictHostKeyChecking=no",
              tarball_path.to_str().unwrap_or(""), &format!("{host_str}:{remote_tar}")],
            &send,
        ).await;
        if !scp_ok { return; }
        send("==> SCP completato");

        // ── 2. Estrai il tarball ──────────────────────────────────────────
        send("==> Estrazione tarball...");
        let extract_cmd = format!("mkdir -p {dir} && tar xzf {tar} -C {dir}",
            dir = req.remote_dir, tar = remote_tar);
        let ok = run_ssh_cmd(
            use_sshpass, &req.password,
            "ssh",
            &["-p", &port_str, "-o", "StrictHostKeyChecking=no",
              &host_str, &extract_cmd],
            &send,
        ).await;
        if !ok { return; }

        // ── 3. Esegui install.sh ──────────────────────────────────────────
        send("==> Installazione (install.sh)...");
        let install_cmd = format!("chmod +x {remote_install} && sudo {remote_install}");
        let ok = run_ssh_cmd(
            use_sshpass, &req.password,
            "ssh",
            &["-p", &port_str, "-o", "StrictHostKeyChecking=no",
              &host_str, &install_cmd],
            &send,
        ).await;
        if !ok { return; }

        // ── 4. Health check ───────────────────────────────────────────────
        send("==> Health check...");
        let hc_cmd = "sleep 3 && curl -sk https://localhost:8443/health";
        let ok = run_ssh_cmd(
            use_sshpass, &req.password,
            "ssh",
            &["-p", &port_str, "-o", "StrictHostKeyChecking=no",
              &host_str, hc_cmd],
            &send,
        ).await;
        if ok {
            send("==> Health check: OK");
        } else {
            send("WARN: health check non risponde — il servizio potrebbe ancora essere in avvio");
        }

        send("DONE");
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx)
        .map(|line| Ok::<_, Infallible>(axum::body::Bytes::from(line)));

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/plain; charset=utf-8")
        .header("x-content-type-options", "nosniff")
        .body(Body::from_stream(stream))
        .unwrap()
}

// ── POST /api/deploy/device-container ─────────────────────────────────────────

/// Sanitize a `dist/`-relative filename and resolve it to an absolute path,
/// rejecting anything that isn't a plain basename actually inside `dist/`
/// (symlink escapes included) — same checks `deploy_device` inlines for its
/// single tarball, factored out here because this handler needs it twice.
fn resolve_dist_file(repo: &std::path::Path, name: &str) -> Result<PathBuf, String> {
    let basename = PathBuf::from(name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    if !basename.ends_with(".tar.gz") || basename.is_empty() {
        return Err(format!("nome file non valido: {name}"));
    }
    let dist_dir = repo.join("dist");
    let path = dist_dir.join(&basename);
    if !path.exists() {
        return Err(format!("file non trovato: dist/{basename}"));
    }
    let canon = path.canonicalize().map_err(|_| "file non trovato".to_string())?;
    let canon_dist = dist_dir.canonicalize().map_err(|_| "dist/ non trovata".to_string())?;
    if !canon.starts_with(&canon_dist) {
        return Err(format!("{basename} è fuori da dist/"));
    }
    Ok(path)
}

#[derive(Debug, Deserialize)]
pub struct DeviceContainerDeployRequest {
    /// Container image archive (basename only, must exist in dist/).
    /// La SPA non ha più un campo suo: dal 2026-07-30 sta dentro l'immagine
    /// (vedi Containerfile.aarch64/.x86_64). Un client più vecchio che manda
    /// ancora `www_tarball` non rompe niente — serde ignora i campi in più.
    pub image_tarball: String,
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    pub user: String,
    pub password: String,
    #[serde(default = "default_remote_dir")]
    pub remote_dir: String,
    /// Override for install-container.sh's `--data` (device data directory).
    /// Empty string = let the script use its own default (`/data/user/sws`,
    /// the Pixsys Yocto convention) — the right path differs per device
    /// model, see the IDE's brand-specific data-path presets.
    #[serde(default)]
    pub data_path: String,
}

/// Build the remote `install-container.sh` invocation. Split out from
/// `deploy_device_container` so it's unit-testable without an actual SSH
/// round-trip — mirrors `resolve_dist_file`/`parse_image_tarball` above.
fn build_install_cmd(remote_dir: &str, image: &str, data_path: &str) -> String {
    let mut cmd = format!(
        "cd {remote_dir} && chmod +x install-container.sh && ./install-container.sh --image {image}"
    );
    if !data_path.is_empty() {
        cmd.push_str(&format!(" --data {data_path}"));
    }
    cmd
}

/// Same shape as `deploy_device`, but installs the runtime **as a rootless
/// Podman container** instead of the native binary: ships the image archive
/// plus `deploy/container/install-container.sh` and its quadlet unit
/// (install-container.sh reads the unit from its own directory, so both must
/// land in the same `remote_dir`), then runs the installer over SSH —
/// **without `sudo`**, unlike the native-binary path, because rootless
/// Podman needs none.
///
/// Questo è il percorso **offline**: copia un archivio da ~59 MB via scp.
/// Quando il dispositivo raggiunge il registry, `install-container.sh --pull`
/// trasferisce solo il layer cambiato — vedi docs/DEPLOY_CONTAINER_AARCH64.md.
pub async fn deploy_device_container(
    State(s): State<AppState>,
    EJson(req): EJson<DeviceContainerDeployRequest>,
) -> Response {
    let repo = match s.repo_root.as_ref() {
        Some(p) => p.clone(),
        None => {
            return (StatusCode::SERVICE_UNAVAILABLE,
                "repo_root non disponibile\n").into_response();
        }
    };

    if !validate_remote_path(&req.remote_dir) {
        return (StatusCode::BAD_REQUEST,
            "remote_dir non valido: deve essere un percorso assoluto senza '..' né caratteri speciali\n"
        ).into_response();
    }
    if !req.data_path.is_empty() && !validate_remote_path(&req.data_path) {
        return (StatusCode::BAD_REQUEST,
            "data_path non valido: deve essere un percorso assoluto senza '..' né caratteri speciali\n"
        ).into_response();
    }

    let image_path = match resolve_dist_file(&repo, &req.image_tarball) {
        Ok(p) => p,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("{e}\n")).into_response(),
    };
    let installer_src = repo.join("deploy/container/install-container.sh");
    let quadlet_src = repo.join("deploy/container/sws-runtime.container");
    if !installer_src.exists() || !quadlet_src.exists() {
        return (StatusCode::INTERNAL_SERVER_ERROR,
            "deploy/container/install-container.sh o sws-runtime.container mancante nel repo\n"
        ).into_response();
    }

    let image_basename = image_path.file_name().unwrap().to_str().unwrap().to_string();

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(128);

    tokio::spawn(async move {
        let send = |msg: &str| {
            let _ = tx.try_send(format!("{msg}\n"));
            log_deploy_line!("sws_web::deploy_container", msg);
        };

        let use_sshpass = sshpass_available();
        if !use_sshpass {
            send("WARN: sshpass non trovato — la password verrà ignorata. Assicurati che la chiave SSH sia preconfigurata.");
        }

        let host_str = format!("{}@{}", req.user, req.host);
        let port_str = req.port.to_string();

        // ── 1. Crea remote_dir ──────────────────────────────────────────────
        // A differenza di deploy_device (che scp-a dentro /tmp/..., quasi
        // sempre già presente), qui remote_dir deve esistere PRIMA di ognuno
        // dei tre scp che seguono, non solo prima dell'estrazione.
        send(&format!("==> mkdir -p {} sul device", req.remote_dir));
        let ok = run_ssh_cmd(
            use_sshpass, &req.password,
            "ssh",
            &["-p", &port_str, "-o", "StrictHostKeyChecking=no",
              &host_str, &format!("mkdir -p {}", req.remote_dir)],
            &send,
        ).await;
        if !ok { return; }

        // ── 2. SCP dei tre file (immagine, installer, quadlet) ─────────────
        // La SPA non è più fra questi: viaggia dentro l'immagine.
        let uploads: [(&str, &std::path::Path); 3] = [
            ("immagine", image_path.as_path()),
            ("installer", installer_src.as_path()),
            ("unit quadlet", quadlet_src.as_path()),
        ];
        for (label, local) in uploads {
            send(&format!("==> SCP {label}: {} → {}:{}", local.display(), host_str, req.remote_dir));
            let ok = run_ssh_cmd(
                use_sshpass, &req.password,
                "scp",
                &["-P", &port_str, "-o", "StrictHostKeyChecking=no",
                  local.to_str().unwrap_or(""), &format!("{host_str}:{}/", req.remote_dir)],
                &send,
            ).await;
            if !ok { return; }
        }
        send("==> SCP completato");

        // ── 3. Esegui install-container.sh (NESSUN sudo: podman rootless) ──
        send("==> Installazione (install-container.sh, podman rootless — nessun sudo richiesto)...");
        let install_cmd = build_install_cmd(&req.remote_dir, &image_basename, &req.data_path);
        let ok = run_ssh_cmd(
            use_sshpass, &req.password,
            "ssh",
            &["-p", &port_str, "-o", "StrictHostKeyChecking=no",
              &host_str, &install_cmd],
            &send,
        ).await;
        if !ok { return; }

        // ── 4. Health check ─────────────────────────────────────────────────
        // http, non https: il container parte in HTTP finché non c'è un
        // certificato TLS in config/ (stesso motivo dell'HEALTHCHECK
        // nel Containerfile).
        send("==> Health check...");
        let hc_cmd = "sleep 3 && curl -fs http://localhost:8443/health";
        let ok = run_ssh_cmd(
            use_sshpass, &req.password,
            "ssh",
            &["-p", &port_str, "-o", "StrictHostKeyChecking=no",
              &host_str, hc_cmd],
            &send,
        ).await;
        if ok {
            send("==> Health check: OK");
        } else {
            send("WARN: health check non risponde — il servizio potrebbe ancora essere in avvio");
        }

        send("DONE");
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx)
        .map(|line| Ok::<_, Infallible>(axum::body::Bytes::from(line)));

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/plain; charset=utf-8")
        .header("x-content-type-options", "nosniff")
        .body(Body::from_stream(stream))
        .unwrap()
}

// ── SSH helper ────────────────────────────────────────────────────────────────

async fn run_ssh_cmd(
    use_sshpass: bool,
    password: &str,
    prog: &str,
    args: &[&str],
    send: &impl Fn(&str),
) -> bool {
    // ConnectTimeout copre l'host irraggiungibile in entrambi i casi. BatchMode=yes
    // va aggiunto SOLO quando non usiamo sshpass: forza ssh/scp a fallire subito
    // invece di restare appesi in un prompt interattivo (password o
    // keyboard-interactive) che qui non può mai ricevere risposta — questo
    // processo backend non ha un terminale né un DISPLAY funzionante per
    // ssh-askpass. Con sshpass invece serve che ssh TENTI l'auth a password
    // (è quello che sshpass intercetta), quindi BatchMode=yes andrebbe a
    // rompere proprio il meccanismo che dovrebbe abilitare.
    let mut cmd = if use_sshpass {
        let mut full_args = vec!["-p", password, prog, "-o", "ConnectTimeout=10"];
        full_args.extend_from_slice(args);
        let mut c = Command::new("sshpass");
        c.args(&full_args);
        c
    } else {
        let mut full_args = vec!["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
        full_args.extend_from_slice(args);
        let mut c = Command::new(prog);
        c.args(&full_args);
        c
    };

    // Prima catturavamo solo lo stato di uscita: stdout/stderr di ssh/scp (e
    // dell'eventuale comando remoto, tipo l'output di install-container.sh)
    // finivano ereditati dallo stdio del processo backend — invisibili sia
    // nello stream della UI sia nei log. Un "exit 1" da solo non dice nulla
    // di utile: catturiamo e inoltriamo ogni riga, così l'errore vero (quello
    // stampato sul device) arriva nel log come tutto il resto.
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            send(&format!("ERROR: impossibile eseguire {prog}: {e}"));
            return false;
        }
    };

    use tokio::io::{AsyncBufReadExt, BufReader};
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let drain_stdout = async {
        if let Some(s) = stdout {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                send(&format!("    {line}"));
            }
        }
    };
    let drain_stderr = async {
        if let Some(s) = stderr {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                send(&format!("    {line}"));
            }
        }
    };
    // Concorrenti, non in sequenza: altrimenti se il comando scrive tanto su
    // uno dei due flussi mentre drieniamo solo l'altro, il buffer del pipe
    // (~64KB) si riempie e il processo resta bloccato in scrittura.
    tokio::join!(drain_stdout, drain_stderr);

    match child.wait().await {
        Ok(s) if s.success() => true,
        Ok(s) => {
            send(&format!("ERROR: {} fallito (exit {})", prog, s.code().unwrap_or(-1)));
            false
        }
        Err(e) => {
            send(&format!("ERROR: impossibile attendere {prog}: {e}"));
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_image_tarball_extracts_version_and_arch() {
        assert_eq!(
            parse_image_tarball("sws-runtime-0.1.0-dev-x86_64-image.tar.gz"),
            Some(("0.1.0-dev".to_string(), "x86_64".to_string())),
        );
        assert_eq!(
            parse_image_tarball("sws-runtime-1.2.3-aarch64-image.tar.gz"),
            Some(("1.2.3".to_string(), "aarch64".to_string())),
        );
    }

    #[test]
    fn parse_image_tarball_rejects_unrelated_files() {
        assert_eq!(parse_image_tarball("sws-www-0.1.0-dev.tar.gz"), None);
        assert_eq!(parse_image_tarball("sws-0.1.0-dev-linux-x86_64.tar.gz"), None);
        assert_eq!(parse_image_tarball("random-file.tar.gz"), None);
        // arch presente ma senza il suffisso -image: non è un'immagine container.
        assert_eq!(parse_image_tarball("sws-runtime-0.1.0-dev-x86_64.tar.gz"), None);
    }

    #[test]
    fn validate_remote_path_accepts_absolute_clean_paths() {
        assert!(validate_remote_path("/tmp/sws-deploy"));
        assert!(validate_remote_path("/data/user/sws"));
    }

    #[test]
    fn validate_remote_path_rejects_relative_traversal_and_shell_metacharacters() {
        assert!(!validate_remote_path("relative/dir"));
        assert!(!validate_remote_path("/tmp/../etc"));
        assert!(!validate_remote_path("/tmp/foo; rm -rf /"));
        assert!(!validate_remote_path("/tmp/$(whoami)"));
    }

    #[test]
    fn build_install_cmd_omits_data_flag_when_empty() {
        let cmd = build_install_cmd("/tmp/sws-deploy", "img.tar.gz", "");
        assert_eq!(
            cmd,
            "cd /tmp/sws-deploy && chmod +x install-container.sh && \
             ./install-container.sh --image img.tar.gz"
        );
    }

    /// La SPA sta dentro l'immagine dal 2026-07-30: il comando remoto non deve
    /// più passare `--www`, che l'installer ora rifiuta con un errore esplicito.
    #[test]
    fn build_install_cmd_never_passes_www() {
        let cmd = build_install_cmd("/tmp/sws-deploy", "img.tar.gz", "/opt/sws-data");
        assert!(!cmd.contains("--www"), "comando inatteso: {cmd}");
    }

    #[test]
    fn build_install_cmd_appends_data_flag_when_present() {
        let cmd = build_install_cmd("/tmp/sws-deploy", "img.tar.gz", "/opt/sws-data");
        assert_eq!(
            cmd,
            "cd /tmp/sws-deploy && chmod +x install-container.sh && \
             ./install-container.sh --image img.tar.gz --data /opt/sws-data"
        );
    }
}
