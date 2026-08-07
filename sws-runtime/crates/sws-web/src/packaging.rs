//! T-28 — IDE Package Builder + SSH Device Deployer
//!
//! Endpoints (Admin only, port 8444):
//!   POST /api/build/package             — run scripts/package.sh, stream log
//!   GET  /api/build/packages            — list built tarballs in dist/
//!   POST /api/deploy/device             — SCP tarball + run install.sh via SSH
//!   GET  /api/build/container-packages  — list built container image archives in dist/
//!   POST /api/deploy/device-container   — SCP image+installer + run install-container.sh via SSH
//!   POST /api/deploy/device-container/manage — lifecycle on an already-installed
//!        container: status/start/stop/restart/enable/disable/restart-policy/uninstall,
//!        locally or over SSH

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
    for arch in ["aarch64-generic", "aarch64", "x86_64"] {
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
    /// Archivio immagine in `dist/` (solo basename). Obbligatorio **soltanto**
    /// in modalità archivio: dal registry non si copia niente e resta vuoto.
    /// La SPA non ha più un campo suo: dal 2026-07-30 sta dentro l'immagine
    /// (vedi Containerfile.aarch64/.x86_64). Un client più vecchio che manda
    /// ancora `www_tarball` non rompe niente — serde ignora i campi in più.
    #[serde(default)]
    pub image_tarball: String,
    /// `"registry"` o `"archive"`. Assente = si deduce dal resto, vedi
    /// `resolve_image_spec`: è così che un IDE più vecchio, che questo campo
    /// non lo manda, continua a installare dal proprio archivio.
    #[serde(default)]
    pub image_source: Option<String>,
    /// Riferimento del registry. Vuoto = lo compone l'installer sul dispositivo
    /// da `uname -m`: l'IDE non sa su che architettura sta installando.
    #[serde(default)]
    pub image_ref: String,
    /// Azzera i dati del dispositivo prima di installare (`--uninstall
    /// --purge`). Mai desumibile da altri campi e `false` per default: un
    /// default sbagliato qui cancella progetti su una macchina in servizio.
    #[serde(default)]
    pub clean_install: bool,
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

/// Da dove arriva l'immagine sul dispositivo.
///
/// `Registry` con riferimento **vuoto** significa "decidilo tu": l'architettura
/// la deduce `install-container.sh` da `uname -m` sul dispositivo, che è l'unico
/// a saperla con certezza — dall'IDE si installa su macchine diverse da quella
/// di sviluppo.
///
/// Che sia un enum e non due `Option` incrociati non è estetica: garantisce per
/// costruzione che `--pull` e `--image` non finiscano mai nello stesso comando,
/// combinazione che l'installer rifiuta.
#[derive(Debug, PartialEq)]
enum ImageSpec {
    Archive(String),
    Registry(String),
}

/// Caratteri ammessi in un riferimento di registry. `:` e `@` servono per tag e
/// digest; tutto il resto è escluso perché il riferimento finisce interpolato in
/// un comando eseguito via SSH sul dispositivo, esattamente come `remote_dir`.
fn registry_ref_is_safe(r: &str) -> bool {
    !r.is_empty()
        && r.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '@' | '-'))
        // Un riferimento che inizia con `-` verrebbe scartato in SILENZIO
        // dall'installer, che lo scambierebbe per una flag e ripiegherebbe sul
        // default: si installerebbe un'immagine diversa da quella chiesta.
        && !r.starts_with('-')
}

/// Decide da dove prendere l'immagine, validando quel che serve.
///
/// `source` è `Option` e non ha un default a "registry" di proposito: un IDE
/// più vecchio manda solo `image_tarball` e nessuna sorgente, e interpretarlo
/// come "registry" gli farebbe ignorare in silenzio l'archivio che ha scelto,
/// scaricando dal registry un'immagine che nessuno ha chiesto.
fn resolve_image_spec(
    source: Option<&str>,
    image_tarball: &str,
    image_ref: &str,
) -> Result<ImageSpec, String> {
    let want_archive = match source {
        Some("archive") => true,
        Some("registry") => false,
        Some(other) => return Err(format!("sorgente immagine sconosciuta: {other}")),
        None => !image_tarball.is_empty(),
    };

    if want_archive {
        if image_tarball.is_empty() {
            return Err("sorgente 'archive' senza image_tarball".to_string());
        }
        return Ok(ImageSpec::Archive(image_tarball.to_string()));
    }

    if image_ref.is_empty() {
        return Ok(ImageSpec::Registry(String::new()));
    }
    if !registry_ref_is_safe(image_ref) {
        return Err(format!("riferimento immagine non valido: {image_ref}"));
    }
    Ok(ImageSpec::Registry(image_ref.to_string()))
}

/// Prefisso comune dei comandi remoti. Estratto perché le tre varianti
/// (installazione, pull-only, purge) non divergano nel tempo.
fn install_sh(remote_dir: &str) -> String {
    format!("cd {remote_dir} && chmod +x install-container.sh && ./install-container.sh")
}

/// Build the remote `install-container.sh` invocation. Split out from
/// `deploy_device_container` so it's unit-testable without an actual SSH
/// round-trip — mirrors `resolve_dist_file`/`parse_image_tarball` above.
fn build_install_cmd(remote_dir: &str, image: &ImageSpec, data_path: &str) -> String {
    let mut cmd = install_sh(remote_dir);
    match image {
        ImageSpec::Archive(f) => cmd.push_str(&format!(" --image {f}")),
        ImageSpec::Registry(r) if r.is_empty() => cmd.push_str(" --pull"),
        ImageSpec::Registry(r) => cmd.push_str(&format!(" --pull {r}")),
    }
    if !data_path.is_empty() {
        cmd.push_str(&format!(" --data {data_path}"));
    }
    cmd
}

/// Comando che procura l'immagine e basta, da eseguire **prima** di un purge.
///
/// `None` in modalità archivio: lì l'immagine è già stata copiata via scp, non
/// c'è niente da procurare e nessuna rete da cui dipendere.
fn build_pull_only_cmd(remote_dir: &str, image: &ImageSpec) -> Option<String> {
    match image {
        ImageSpec::Archive(_) => None,
        ImageSpec::Registry(r) => {
            let mut cmd = install_sh(remote_dir);
            cmd.push_str(" --pull-only");
            if !r.is_empty() {
                cmd.push_str(&format!(" {r}"));
            }
            Some(cmd)
        }
    }
}

/// Comando che azzera i dati del dispositivo.
///
/// **Deve ripetere `--data`.** L'installer fa `rm -rf "$DATA"` e `DATA` viene
/// dal parsing delle flag: senza ripetere il percorso scelto nel pannello, il
/// purge cancellerebbe il default `/data/user/sws` lasciando intatti i dati veri
/// — cioè distruggerebbe i dati sbagliati e mancherebbe quelli giusti.
///
/// È un comando a sé e non un'opzione dell'installazione perché `--uninstall`
/// esce con `exit 0` e non prosegue mai.
fn build_purge_cmd(remote_dir: &str, data_path: &str) -> String {
    let mut cmd = install_sh(remote_dir);
    cmd.push_str(" --uninstall --purge");
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
/// Due sorgenti per l'immagine. Dal **registry** si copiano solo installer e
/// unit (pochi kB) e il dispositivo scarica i layer che gli mancano: è la
/// strada normale. Da **archivio** si copiano ~59 MB via scp: serve dove il
/// registry non si raggiunge, che in campo è il caso normale.
///
/// Con `clean_install` l'immagine viene procurata **prima** di cancellare i
/// dati (`--pull-only`), non dopo: altrimenti un pull fallito su un purge già
/// eseguito lascerebbe il dispositivo senza dati e senza runtime.
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

    let image_spec = match resolve_image_spec(
        req.image_source.as_deref(),
        &req.image_tarball,
        &req.image_ref,
    ) {
        Ok(spec) => spec,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("{e}\n")).into_response(),
    };

    // L'archivio si risolve solo se serve davvero: con la sorgente registry
    // `dist/` può non esistere affatto, ed è il caso di chi installa senza aver
    // mai fatto una build.
    let image_path = match &image_spec {
        ImageSpec::Archive(name) => match resolve_dist_file(&repo, name) {
            Ok(p) => Some(p),
            Err(e) => return (StatusCode::BAD_REQUEST, format!("{e}\n")).into_response(),
        },
        ImageSpec::Registry(_) => None,
    };

    let installer_src = repo.join("deploy/container/install-container.sh");
    let quadlet_src = repo.join("deploy/container/sws-runtime.container");
    if !installer_src.exists() || !quadlet_src.exists() {
        return (StatusCode::INTERNAL_SERVER_ERROR,
            "deploy/container/install-container.sh o sws-runtime.container mancante nel repo\n"
        ).into_response();
    }

    // Riga di riepilogo composta qui, dove i dati ci sono ancora tutti.
    let source_line = match &image_spec {
        ImageSpec::Archive(name) => format!("==> immagine: archivio {name}"),
        ImageSpec::Registry(r) if r.is_empty() =>
            "==> immagine: registry (latest-<arch>, l'architettura la decide il dispositivo)".to_string(),
        ImageSpec::Registry(r) => format!("==> immagine: registry ({r})"),
    };

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
        send(&source_line);

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

        // ── 2. SCP ─────────────────────────────────────────────────────────
        // Installer e unit sempre: l'installer legge la unit da una posizione
        // relativa a sé stesso, quindi devono atterrare nella stessa directory.
        // L'immagine solo dal percorso offline — dal registry se la procura il
        // dispositivo, ed è lì che si risparmiano i 59 MB.
        // La SPA non è fra questi in nessuno dei due casi: viaggia dentro
        // l'immagine dal 2026-07-30.
        let mut uploads: Vec<(&str, &std::path::Path)> = Vec::with_capacity(3);
        if let Some(p) = image_path.as_deref() {
            uploads.push(("immagine", p));
        }
        uploads.push(("installer", installer_src.as_path()));
        uploads.push(("unit quadlet", quadlet_src.as_path()));
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

        // ── 2-bis. Installazione pulita ────────────────────────────────────
        // L'ordine è: procura l'immagine, POI cancella. Al contrario, un pull
        // fallito dopo un purge già eseguito lascerebbe il dispositivo senza
        // dati e senza runtime — e senza rete non ci sarebbe modo di rimediare
        // da remoto. Dal percorso offline non serve: l'immagine è appena
        // arrivata via scp.
        if req.clean_install {
            if let Some(pull_cmd) = build_pull_only_cmd(&req.remote_dir, &image_spec) {
                send("==> Procuro l'immagine PRIMA di azzerare i dati...");
                let ok = run_ssh_cmd(
                    use_sshpass, &req.password,
                    "ssh",
                    &["-p", &port_str, "-o", "StrictHostKeyChecking=no",
                      &host_str, &pull_cmd],
                    &send,
                ).await;
                if !ok {
                    send("ERROR: immagine non procurata. Nessun dato è stato cancellato e il runtime è intatto.");
                    return;
                }
            }

            let purged = if req.data_path.is_empty() { "/data/user/sws" } else { &req.data_path };
            send(&format!("WARN: installazione pulita — azzero progetti, configurazione e storico in {purged}"));
            let purge_cmd = build_purge_cmd(&req.remote_dir, &req.data_path);
            let ok = run_ssh_cmd(
                use_sshpass, &req.password,
                "ssh",
                &["-p", &port_str, "-o", "StrictHostKeyChecking=no",
                  &host_str, &purge_cmd],
                &send,
            ).await;
            if !ok {
                // Fermarsi e dichiarare lo stato reale: installare sopra una
                // directory dati in stato ignoto sarebbe peggio del fallimento.
                send("ERROR: azzeramento fallito. Il servizio è stato rimosso e i dati potrebbero \
                      essere cancellati solo in parte. Ripeti SENZA \"installazione pulita\" per \
                      rimettere in servizio il runtime.");
                return;
            }
        }

        // ── 3. Esegui install-container.sh (NESSUN sudo: podman rootless) ──
        send("==> Installazione (install-container.sh, podman rootless — nessun sudo richiesto)...");
        let install_cmd = build_install_cmd(&req.remote_dir, &image_spec, &req.data_path);
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

// ── POST /api/deploy/device-container/manage ───────────────────────────────────

/// Fixed container/unit name — same hardcoded value `install-container.sh` and
/// `sws-runtime.container` use. Not user-configurable anywhere in the IDE today,
/// so a single constant here is enough (no per-install naming to track).
const CONTAINER_NAME: &str = "sws-runtime";

#[derive(Debug, Deserialize)]
pub struct ContainerManageRequest {
    /// `true` = no SSH, run the command on the host running this backend
    /// process. The escape hatch for the situation that motivated this
    /// endpoint: a stray container on the dev machine itself, with no SSH
    /// server configured toward `localhost`.
    #[serde(default)]
    pub local: bool,
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub password: String,
    /// "status" | "start" | "stop" | "restart" | "enable" | "disable"
    /// | "set_restart_policy" | "uninstall".
    pub action: String,
    /// "always" | "on-failure" | "no" — only read for `set_restart_policy`.
    #[serde(default)]
    pub restart_policy: String,
    /// Also wipe the data directory — only read for `uninstall`.
    #[serde(default)]
    pub purge: bool,
    /// Data directory to wipe when `purge` is set. Empty = the installer's own
    /// default (`/data/user/sws`), same convention as `effectiveDataPath()` on
    /// the frontend and `build_purge_cmd` above.
    #[serde(default)]
    pub data_path: String,
}

/// Restart policies accepted by `set_restart_policy`, matching systemd's
/// `Restart=` directive. A closed set — unlike `registry_ref_is_safe` above,
/// there's no need for a char-class validator when the whole domain is three
/// fixed strings.
fn restart_policy_is_safe(p: &str) -> bool {
    matches!(p, "always" | "on-failure" | "no")
}

/// Build the single shell command for a container lifecycle action. Pure and
/// unit-testable without SSH/processes, same shape as `build_install_cmd` /
/// `build_purge_cmd` above. Acts on the unit **already installed** on the
/// target (fixed name, see `CONTAINER_NAME`) — no `remote_dir` involved, unlike
/// `deploy_device_container`: this works even for a device set up in an
/// earlier session or by hand.
fn build_manage_cmd(
    action: &str,
    restart_policy: &str,
    purge: bool,
    data_path: &str,
) -> Result<String, String> {
    let name = CONTAINER_NAME;
    match action {
        // NOTA: `systemctl --user is-enabled` risponde sempre "generated" per
        // una unit quadlet — è generata da zero a ogni daemon-reload/boot
        // dalla sezione [Install] del file .container, non da un unit file
        // persistente, quindi non ha uno stato enabled/disabled classico da
        // interrogare. Verificato dal vivo: dopo un `disable` la risposta di
        // `is-enabled` non cambia. L'unico segnale vero è la riga `WantedBy=`
        // nel file sorgente stesso — la stessa che `enable`/`disable` sotto
        // commentano/scommentano.
        "status" => Ok(format!(
            "echo '== systemctl --user status =='; systemctl --user status {name} --no-pager -l || true; \
             echo; echo '== avvio automatico al boot =='; \
             (grep -q '^WantedBy=' ~/.config/containers/systemd/{name}.container 2>/dev/null \
                && echo 'abilitato' || echo 'disabilitato'); \
             echo; echo '== linger =='; loginctl show-user \"$USER\" --property=Linger || true; \
             echo; echo '== container =='; podman ps -a --filter name={name} || true"
        )),
        "start" | "stop" | "restart" => Ok(format!("systemctl --user {action} {name}")),
        // `systemctl --user enable/disable` è un no-op per una unit generata da
        // quadlet (vedi nota sopra): l'unico modo reale di cambiare l'avvio al
        // boot è commentare/scommentare `WantedBy=` nel file sorgente e far
        // rigenerare la unit con `daemon-reload` — stesso meccanismo di
        // `set_restart_policy` sotto. Non tocca lo stato corrente (nessun
        // `--now`): un `disable` non ferma il container in esecuzione.
        "enable" => Ok(format!(
            "sed -i 's/^#\\(WantedBy=.*\\)/\\1/' ~/.config/containers/systemd/{name}.container \
             && systemctl --user daemon-reload"
        )),
        "disable" => Ok(format!(
            "sed -i 's/^\\(WantedBy=.*\\)/#\\1/' ~/.config/containers/systemd/{name}.container \
             && systemctl --user daemon-reload"
        )),
        "set_restart_policy" => {
            if !restart_policy_is_safe(restart_policy) {
                return Err(format!("policy di restart non valida: {restart_policy}"));
            }
            Ok(format!(
                "sed -i \"s/^Restart=.*/Restart={restart_policy}/\" \
                 ~/.config/containers/systemd/{name}.container && systemctl --user daemon-reload"
            ))
        }
        "uninstall" => {
            let mut cmd = format!(
                "systemctl --user disable --now {name} 2>/dev/null || true; \
                 rm -f ~/.config/containers/systemd/{name}.container; \
                 systemctl --user daemon-reload 2>/dev/null || true; \
                 podman rm -f {name} >/dev/null 2>&1 || true"
            );
            if purge {
                let data = if data_path.is_empty() { "/data/user/sws" } else { data_path };
                if !validate_remote_path(data) {
                    return Err(
                        "data_path non valido: deve essere un percorso assoluto senza '..' né caratteri speciali"
                            .to_string(),
                    );
                }
                cmd.push_str(&format!("; rm -rf {data}"));
            }
            Ok(cmd)
        }
        other => Err(format!("azione sconosciuta: {other}")),
    }
}

/// Lifecycle actions (status/start/stop/restart/enable/disable/restart-policy/
/// uninstall) on an already-installed `sws-runtime` container — either locally
/// on this host (`local: true`) or over SSH, same streaming-response shape as
/// `deploy_device_container` above (one line per chunk, `DONE`/`ERROR:` markers
/// the frontend log viewer already knows how to color).
pub async fn manage_device_container(EJson(req): EJson<ContainerManageRequest>) -> Response {
    let cmd = match build_manage_cmd(&req.action, &req.restart_policy, req.purge, &req.data_path) {
        Ok(c) => c,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("{e}\n")).into_response(),
    };
    if !req.local && (req.host.is_empty() || req.user.is_empty()) {
        return (StatusCode::BAD_REQUEST, "host e user sono obbligatori in modalità remota\n").into_response();
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(128);

    tokio::spawn(async move {
        let send = |msg: &str| {
            let _ = tx.try_send(format!("{msg}\n"));
            log_deploy_line!("sws_web::manage_container", msg);
        };

        send(&format!(
            "==> azione: {} ({})",
            req.action,
            if req.local { "locale" } else { "remoto" }
        ));

        let ok = if req.local {
            run_local_cmd(&cmd, &send).await
        } else {
            let use_sshpass = sshpass_available();
            if !use_sshpass {
                send("WARN: sshpass non trovato — la password verrà ignorata. Assicurati che la chiave SSH sia preconfigurata.");
            }
            let host_str = format!("{}@{}", req.user, req.host);
            let port_str = req.port.to_string();
            run_ssh_cmd(
                use_sshpass, &req.password,
                "ssh",
                &["-p", &port_str, "-o", "StrictHostKeyChecking=no", &host_str, &cmd],
                &send,
            ).await
        };

        send(if ok { "DONE" } else { "ERROR: azione fallita" });
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

// ── Local execution helper ──────────────────────────────────────────────────────

/// Same shape as `run_ssh_cmd` above (drains stdout/stderr concurrently, streams
/// each line via `send`, returns whether the command exited 0) but runs the
/// command **on this host**, no SSH — the local half of manage/uninstall
/// actions. Mirrors the streaming pattern `build_package` already uses for
/// local process output (concurrent stdout/stderr drain, not a buffering
/// `.output()` that would withhold all feedback until the command finishes).
async fn run_local_cmd(cmd: &str, send: &impl Fn(&str)) -> bool {
    let mut c = Command::new("sh");
    c.arg("-c").arg(cmd);
    c.stdout(std::process::Stdio::piped());
    c.stderr(std::process::Stdio::piped());

    let mut child = match c.spawn() {
        Ok(c) => c,
        Err(e) => {
            send(&format!("ERROR: impossibile eseguire il comando: {e}"));
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
    tokio::join!(drain_stdout, drain_stderr);

    match child.wait().await {
        Ok(s) if s.success() => true,
        Ok(s) => {
            send(&format!("ERROR: comando fallito (exit {})", s.code().unwrap_or(-1)));
            false
        }
        Err(e) => {
            send(&format!("ERROR: impossibile attendere il comando: {e}"));
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_image_tarball_extracts_version_and_arch() {
        // CalVer, la forma reale dalla release 2026.7.0 in poi.
        assert_eq!(
            parse_image_tarball("sws-runtime-2026.7.0-aarch64-image.tar.gz"),
            Some(("2026.7.0".to_string(), "aarch64".to_string())),
        );
        // Versione con suffisso di pre-release: era la forma prima di 2026.7.0
        // e resta il caso interessante, perché contiene trattini come il resto
        // del nome.
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
    fn parse_image_tarball_distinguishes_generic_from_sdk_aarch64() {
        // Il percorso generico (senza SDK Pixsys, scripts/build_container_
        // aarch64_generic.sh) non deve confondersi con quello Pixsys-tuned:
        // stesso target architetturale, garanzie diverse.
        assert_eq!(
            parse_image_tarball("sws-runtime-2026.7.0-aarch64-generic-image.tar.gz"),
            Some(("2026.7.0".to_string(), "aarch64-generic".to_string())),
        );
        assert_eq!(
            parse_image_tarball("sws-runtime-2026.7.0-aarch64-image.tar.gz"),
            Some(("2026.7.0".to_string(), "aarch64".to_string())),
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

    fn archive(f: &str) -> ImageSpec { ImageSpec::Archive(f.to_string()) }
    fn registry(r: &str) -> ImageSpec { ImageSpec::Registry(r.to_string()) }

    /// Il percorso offline è già stato collaudato su un dispositivo vero: la
    /// stringa che produce non deve cambiare di un carattere.
    #[test]
    fn build_install_cmd_omits_data_flag_when_empty() {
        let cmd = build_install_cmd("/tmp/sws-deploy", &archive("img.tar.gz"), "");
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
        let cmd = build_install_cmd("/tmp/sws-deploy", &archive("img.tar.gz"), "/opt/sws-data");
        assert!(!cmd.contains("--www"), "comando inatteso: {cmd}");
    }

    #[test]
    fn build_install_cmd_appends_data_flag_when_present() {
        let cmd = build_install_cmd("/tmp/sws-deploy", &archive("img.tar.gz"), "/opt/sws-data");
        assert_eq!(
            cmd,
            "cd /tmp/sws-deploy && chmod +x install-container.sh && \
             ./install-container.sh --image img.tar.gz --data /opt/sws-data"
        );
    }

    /// Senza riferimento il tag lo compone il dispositivo da `uname -m`: il
    /// comando deve dire `--pull` e basta, non inventare un'architettura.
    #[test]
    fn build_install_cmd_registry_senza_riferimento() {
        let cmd = build_install_cmd("/tmp/sws-deploy", &registry(""), "");
        assert_eq!(
            cmd,
            "cd /tmp/sws-deploy && chmod +x install-container.sh && \
             ./install-container.sh --pull"
        );
    }

    #[test]
    fn build_install_cmd_registry_con_riferimento_e_data() {
        let cmd = build_install_cmd(
            "/tmp/sws-deploy",
            &registry("ghcr.io/soligolab/sws-runtime:2026.7.0-amd64"),
            "/opt/sws-data",
        );
        assert_eq!(
            cmd,
            "cd /tmp/sws-deploy && chmod +x install-container.sh && \
             ./install-container.sh --pull ghcr.io/soligolab/sws-runtime:2026.7.0-amd64 \
             --data /opt/sws-data"
        );
    }

    /// L'installer rifiuta `--pull` e `--image` insieme: l'enum deve renderlo
    /// impossibile, non solo improbabile.
    #[test]
    fn build_install_cmd_non_mescola_mai_pull_e_image() {
        for spec in [archive("img.tar.gz"), registry(""), registry("reg:tag")] {
            let cmd = build_install_cmd("/tmp/d", &spec, "/data/user/sws");
            assert!(
                !(cmd.contains("--pull") && cmd.contains("--image")),
                "comando con entrambe le flag: {cmd}"
            );
        }
    }

    /// Il test che protegge dal cancellare la directory sbagliata: senza
    /// `--data`, il purge azzererebbe il default invece del percorso scelto.
    #[test]
    fn build_purge_cmd_porta_lo_stesso_data() {
        let cmd = build_purge_cmd("/tmp/sws-deploy", "/opt/sws-data");
        assert_eq!(
            cmd,
            "cd /tmp/sws-deploy && chmod +x install-container.sh && \
             ./install-container.sh --uninstall --purge --data /opt/sws-data"
        );
    }

    #[test]
    fn build_purge_cmd_omette_data_se_vuoto_ma_purga_sempre() {
        let cmd = build_purge_cmd("/tmp/sws-deploy", "");
        assert!(cmd.ends_with("--uninstall --purge"), "comando inatteso: {cmd}");
        assert!(!cmd.contains("--data"));
    }

    /// In modalità archivio l'immagine è già sul dispositivo: non c'è niente da
    /// procurare, quindi nessun comando.
    #[test]
    fn build_pull_only_cmd_solo_per_il_registry() {
        assert_eq!(build_pull_only_cmd("/tmp/d", &archive("img.tar.gz")), None);
        assert_eq!(
            build_pull_only_cmd("/tmp/d", &registry("")).as_deref(),
            Some("cd /tmp/d && chmod +x install-container.sh && ./install-container.sh --pull-only")
        );
        assert_eq!(
            build_pull_only_cmd("/tmp/d", &registry("reg:tag")).as_deref(),
            Some("cd /tmp/d && chmod +x install-container.sh && ./install-container.sh --pull-only reg:tag")
        );
    }

    #[test]
    fn resolve_image_spec_senza_sorgente_e_senza_archivio_va_al_registry() {
        assert_eq!(resolve_image_spec(None, "", ""), Ok(ImageSpec::Registry(String::new())));
    }

    /// Compatibilità: un IDE più vecchio manda solo `image_tarball`. Non deve
    /// vedersi ignorare l'archivio scelto in favore del registry.
    #[test]
    fn resolve_image_spec_client_vecchio_resta_su_archivio() {
        assert_eq!(
            resolve_image_spec(None, "sws-runtime-2026.7.0-aarch64-image.tar.gz", ""),
            Ok(archive("sws-runtime-2026.7.0-aarch64-image.tar.gz"))
        );
    }

    #[test]
    fn resolve_image_spec_archive_senza_tarball_e_errore() {
        assert!(resolve_image_spec(Some("archive"), "", "").is_err());
    }

    #[test]
    fn resolve_image_spec_rifiuta_sorgente_sconosciuta() {
        assert!(resolve_image_spec(Some("ftp"), "", "").is_err());
    }

    #[test]
    fn resolve_image_spec_accetta_tag_e_digest() {
        assert!(resolve_image_spec(Some("registry"), "", "ghcr.io/soligolab/sws-runtime:latest-arm64").is_ok());
        assert!(resolve_image_spec(
            Some("registry"), "",
            "ghcr.io/soligolab/sws-runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ).is_ok());
    }

    /// Il riferimento finisce interpolato in un comando eseguito via SSH sul
    /// dispositivo: stessa classe di rischio di `remote_dir`.
    #[test]
    fn resolve_image_spec_rifiuta_riferimenti_pericolosi() {
        for cattivo in [
            "reg:tag; rm -rf /",
            "$(id)",
            "`id`",
            "reg tag",
            "reg:tag && reboot",
            // Verrebbe scambiato per una flag e scartato in silenzio.
            "--pull",
        ] {
            assert!(
                resolve_image_spec(Some("registry"), "", cattivo).is_err(),
                "accettato un riferimento pericoloso: {cattivo}"
            );
        }
    }

    #[test]
    fn restart_policy_is_safe_accetta_solo_i_tre_valori_systemd() {
        assert!(restart_policy_is_safe("always"));
        assert!(restart_policy_is_safe("on-failure"));
        assert!(restart_policy_is_safe("no"));
        assert!(!restart_policy_is_safe("unless-stopped")); // sintassi Docker, non systemd
        assert!(!restart_policy_is_safe("always; rm -rf /"));
        assert!(!restart_policy_is_safe(""));
    }

    #[test]
    fn build_manage_cmd_status_include_tutte_le_sezioni() {
        let cmd = build_manage_cmd("status", "", false, "").unwrap();
        assert!(cmd.contains("systemctl --user status sws-runtime"));
        // Non `is-enabled` (sempre "generated" per una unit quadlet, vedi nota
        // sopra build_manage_cmd) — il segnale vero è la riga WantedBy= letta
        // dal file sorgente.
        assert!(cmd.contains("grep -q '^WantedBy=' ~/.config/containers/systemd/sws-runtime.container"));
        assert!(cmd.contains("loginctl show-user \"$USER\" --property=Linger"));
        assert!(cmd.contains("podman ps -a --filter name=sws-runtime"));
    }

    #[test]
    fn build_manage_cmd_start_stop_restart() {
        for (action, expected) in [
            ("start", "systemctl --user start sws-runtime"),
            ("stop", "systemctl --user stop sws-runtime"),
            ("restart", "systemctl --user restart sws-runtime"),
        ] {
            assert_eq!(build_manage_cmd(action, "", false, "").unwrap(), expected);
        }
    }

    /// `systemctl --user enable/disable` è un no-op per una unit generata da
    /// quadlet (verificato dal vivo: `is-enabled` non cambia dopo `disable`) —
    /// l'unica leva reale è la riga `WantedBy=` nel file .container stesso.
    #[test]
    fn build_manage_cmd_enable_disable_editano_wantedby_non_systemctl() {
        let en = build_manage_cmd("enable", "", false, "").unwrap();
        assert!(!en.contains("systemctl --user enable"), "deve editare il file, non chiamare enable: {en}");
        assert!(en.contains("WantedBy"));
        assert!(en.contains("daemon-reload"));

        let dis = build_manage_cmd("disable", "", false, "").unwrap();
        assert!(!dis.contains("systemctl --user disable"), "deve editare il file, non chiamare disable: {dis}");
        assert!(dis.contains("WantedBy"));
        assert!(dis.contains("daemon-reload"));
    }

    /// `enable`/`disable` NON devono portare `--now`: toccano solo
    /// l'abilitazione al boot, non lo stato corrente del servizio.
    #[test]
    fn build_manage_cmd_enable_disable_non_toccano_now() {
        assert!(!build_manage_cmd("enable", "", false, "").unwrap().contains("--now"));
        assert!(!build_manage_cmd("disable", "", false, "").unwrap().contains("--now"));
    }

    #[test]
    fn build_manage_cmd_set_restart_policy_riscrive_la_unit() {
        let cmd = build_manage_cmd("set_restart_policy", "on-failure", false, "").unwrap();
        assert_eq!(
            cmd,
            "sed -i \"s/^Restart=.*/Restart=on-failure/\" \
             ~/.config/containers/systemd/sws-runtime.container && systemctl --user daemon-reload"
        );
    }

    #[test]
    fn build_manage_cmd_set_restart_policy_rifiuta_valori_non_ammessi() {
        assert!(build_manage_cmd("set_restart_policy", "unless-stopped", false, "").is_err());
        assert!(build_manage_cmd("set_restart_policy", "always; rm -rf /", false, "").is_err());
    }

    /// `disable --now` + rimozione unit + `podman rm -f`, stesso ordine del
    /// blocco `--uninstall` in install-container.sh (righe 136-151) — senza
    /// purge non deve toccare i dati.
    #[test]
    fn build_manage_cmd_uninstall_senza_purge() {
        let cmd = build_manage_cmd("uninstall", "", false, "").unwrap();
        assert!(cmd.contains("systemctl --user disable --now sws-runtime"));
        assert!(cmd.contains("rm -f ~/.config/containers/systemd/sws-runtime.container"));
        assert!(cmd.contains("systemctl --user daemon-reload"));
        assert!(cmd.contains("podman rm -f sws-runtime"));
        assert!(!cmd.contains("rm -rf"), "senza purge non deve cancellare dati: {cmd}");
    }

    /// Stesso principio di `build_purge_cmd_porta_lo_stesso_data`: il percorso
    /// dati deve essere quello scelto dall'utente, non un default indovinato.
    #[test]
    fn build_manage_cmd_uninstall_con_purge_usa_il_data_path_scelto() {
        let cmd = build_manage_cmd("uninstall", "", true, "/opt/sws-data").unwrap();
        assert!(cmd.ends_with("rm -rf /opt/sws-data"), "comando inatteso: {cmd}");
    }

    #[test]
    fn build_manage_cmd_uninstall_con_purge_e_data_path_vuoto_usa_il_default() {
        let cmd = build_manage_cmd("uninstall", "", true, "").unwrap();
        assert!(cmd.ends_with("rm -rf /data/user/sws"), "comando inatteso: {cmd}");
    }

    /// Stessa classe di rischio di `validate_remote_path`: il path finisce
    /// interpolato in un comando eseguito via SSH o in locale.
    #[test]
    fn build_manage_cmd_uninstall_con_purge_rifiuta_data_path_pericoloso() {
        assert!(build_manage_cmd("uninstall", "", true, "/tmp/foo; rm -rf /").is_err());
        assert!(build_manage_cmd("uninstall", "", true, "relative/dir").is_err());
    }

    #[test]
    fn build_manage_cmd_rifiuta_azione_sconosciuta() {
        assert!(build_manage_cmd("reboot", "", false, "").is_err());
    }
}
