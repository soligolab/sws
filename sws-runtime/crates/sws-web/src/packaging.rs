//! T-28 — IDE Package Builder + SSH Device Deployer
//!
//! Endpoints (Admin only, port 8444):
//!   POST /api/build/package   — run scripts/package.sh, stream log
//!   GET  /api/build/packages  — list built tarballs in dist/
//!   POST /api/deploy/device   — SCP tarball + run install.sh via SSH

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

use crate::router::AppState;

// ── Shared build lock ─────────────────────────────────────────────────────────

pub type BuildLock = Arc<Mutex<bool>>;

pub fn new_build_lock() -> BuildLock {
    Arc::new(Mutex::new(false))
}

// ── Helpers shared with deploy ────────────────────────────────────────────────

fn sshpass_available() -> bool {
    std::process::Command::new("which")
        .arg("sshpass")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
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
                 Esegui il runtime dalla radice del repository (./scripts/dev.sh).",
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

        // Stream stdout line by line.
        use tokio::io::{AsyncBufReadExt, BufReader};
        if let Some(stdout) = child.stdout.take() {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                send(&line);
            }
        }
        // Drain stderr.
        if let Some(stderr) = child.stderr.take() {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                send(&line);
            }
        }

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

    // Sanitize tarball name: only basename, must end with .tar.gz.
    let basename = PathBuf::from(&req.tarball)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    if !basename.ends_with(".tar.gz") || basename.is_empty() {
        return (StatusCode::BAD_REQUEST, "tarball non valido\n").into_response();
    }

    let tarball_path = repo.join("dist").join(&basename);
    if !tarball_path.exists() {
        return (StatusCode::NOT_FOUND,
            format!("tarball non trovato: dist/{basename}\n")).into_response();
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(128);

    tokio::spawn(async move {
        let send = |msg: &str| { let _ = tx.try_send(format!("{msg}\n")); };

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

// ── SSH helper ────────────────────────────────────────────────────────────────

async fn run_ssh_cmd(
    use_sshpass: bool,
    password: &str,
    prog: &str,
    args: &[&str],
    send: &impl Fn(&str),
) -> bool {
    let status = if use_sshpass {
        let mut full_args = vec!["-p", password, prog];
        full_args.extend_from_slice(args);
        Command::new("sshpass").args(&full_args).status().await
    } else {
        Command::new(prog).args(args).status().await
    };

    match status {
        Ok(s) if s.success() => true,
        Ok(s) => {
            send(&format!("ERROR: {} fallito (exit {})", prog, s.code().unwrap_or(-1)));
            false
        }
        Err(e) => {
            send(&format!("ERROR: impossibile eseguire {prog}: {e}"));
            false
        }
    }
}
