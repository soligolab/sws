/// Remote deploy handler: download a SWS binary from GitHub Releases and
/// SCP it to a target device via ssh/scp system commands.
///
/// POST /api/deploy/remote  (admin-only, served on port 8444)
/// Body: DeployRequest (JSON)
/// Response: newline-delimited log lines (chunked transfer), each line is a
///   plain text status message.  The HTTP status is always 200 — errors are
///   reported as log lines starting with "ERROR: ".
use axum::{
    body::Body,
    extract::Json as EJson,
    http::StatusCode,
    response::Response,
};
use serde::Deserialize;
use tokio::process::Command;
use tokio_stream::StreamExt;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
pub struct DeployRequest {
    /// "amd64" or "arm64"
    pub arch:     String,
    /// SSH hostname or IP
    pub host:     String,
    /// SSH port (default 22)
    #[serde(default = "default_port")]
    pub port:     u16,
    /// SSH username
    pub user:     String,
    /// SSH password (plain). Used via sshpass; avoid key-based auth complexity for PoC.
    pub password: String,
    /// Remote install path (default: /data/user/sws)
    #[serde(default = "default_path")]
    pub remote_path: String,
}

fn default_port() -> u16 { 22 }
fn default_path() -> String { "/data/user/sws".to_string() }

fn validate_remote_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.contains("..")
        && path.chars().all(|c| c.is_ascii_alphanumeric() || "-_./".contains(c))
}

/// Build the GitHub Releases URL for the sws-runtime binary.
fn binary_url(arch: &str) -> String {
    // Releases follow the pattern: sws-runtime-linux-{arch}
    // We always pull "latest".
    format!(
        "https://github.com/soligolab/sws/releases/latest/download/sws-runtime-linux-{arch}"
    )
}

pub async fn deploy_remote(EJson(req): EJson<DeployRequest>) -> Response {
    // Stream log lines back to the client as a chunked response.
    let (tx, rx) = tokio::sync::mpsc::channel::<String>(64);

    let arch         = req.arch.clone();
    let host         = req.host.clone();
    let port         = req.port;
    let user         = req.user.clone();
    let password     = req.password.clone();
    let remote_path  = req.remote_path.clone();

    tokio::spawn(async move {
        let send = |msg: &str| {
            let line = format!("{}\n", msg);
            let _ = tx.try_send(line);
        };

        // Validate arch
        if arch != "amd64" && arch != "arm64" {
            send(&format!("ERROR: architettura non supportata: {arch}. Usa 'amd64' o 'arm64'."));
            return;
        }

        // Validate remote_path before interpolating into SSH commands.
        if !validate_remote_path(&remote_path) {
            send("ERROR: remote_path non valido: deve essere assoluto senza '..' né caratteri speciali");
            return;
        }

        let url = binary_url(&arch);
        send(&format!("INFO: scarico binario da {url}"));

        // Download with reqwest to a temp file
        let tmp_path = format!("/tmp/sws-runtime-{arch}-deploy");
        let download_result = async {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()?;
            let mut response = client.get(&url).send().await?.error_for_status()?;
            let mut file = tokio::fs::File::create(&tmp_path).await?;
            use tokio::io::AsyncWriteExt;
            while let Some(chunk) = response.chunk().await? {
                file.write_all(&chunk).await?;
            }
            file.flush().await?;
            Ok::<(), anyhow::Error>(())
        }.await;

        if let Err(e) = download_result {
            send(&format!("ERROR: download fallito: {e}"));
            return;
        }
        send("INFO: download completato");

        // Make executable
        let _ = tokio::fs::set_permissions(&tmp_path,
            std::os::unix::fs::PermissionsExt::from_mode(0o755)).await;

        // Check that sshpass is available
        let sshpass_check = Command::new("which").arg("sshpass").output().await;
        let use_sshpass = sshpass_check.map(|o| o.status.success()).unwrap_or(false);
        if !use_sshpass {
            send("WARN: sshpass non trovato — il deploy userà SSH senza password (richiede chiave SSH preconfigurata)");
        }

        // SCP the binary
        let remote_file = format!("{remote_path}/sws-runtime");
        send(&format!("INFO: carico {tmp_path} → {user}@{host}:{remote_file}"));

        let scp_status = if use_sshpass {
            Command::new("sshpass")
                .args(["-p", &password, "scp",
                    "-P", &port.to_string(),
                    "-o", "StrictHostKeyChecking=no",
                    &tmp_path,
                    &format!("{user}@{host}:{remote_file}"),
                ])
                .status().await
        } else {
            Command::new("scp")
                .args([
                    "-P", &port.to_string(),
                    "-o", "StrictHostKeyChecking=no",
                    &tmp_path,
                    &format!("{user}@{host}:{remote_file}"),
                ])
                .status().await
        };

        match scp_status {
            Ok(s) if s.success() => send("INFO: SCP completato"),
            Ok(s) => { send(&format!("ERROR: SCP fallito (exit {})", s.code().unwrap_or(-1))); return; }
            Err(e) => { send(&format!("ERROR: SCP errore: {e}")); return; }
        }

        // Restart the systemd service
        send("INFO: riavvio sws-runtime.service sul dispositivo remoto…");

        let restart_cmd = "systemctl restart sws-runtime.service";
        let ssh_args: Vec<String> = if use_sshpass {
            vec![
                "-p".into(), password.clone(),
                "ssh".into(),
                "-p".into(), port.to_string(),
                "-o".into(), "StrictHostKeyChecking=no".into(),
                format!("{user}@{host}"),
                restart_cmd.into(),
            ]
        } else {
            vec![
                "-p".into(), port.to_string(),
                "-o".into(), "StrictHostKeyChecking=no".into(),
                format!("{user}@{host}"),
                restart_cmd.into(),
            ]
        };

        let ssh_prog = if use_sshpass { "sshpass" } else { "ssh" };
        let restart_status = Command::new(ssh_prog).args(&ssh_args).status().await;

        match restart_status {
            Ok(s) if s.success() => send("INFO: servizio riavviato con successo"),
            Ok(s) => send(&format!("WARN: restart fallito (exit {}). Riavvia manualmente.", s.code().unwrap_or(-1))),
            Err(e) => send(&format!("WARN: impossibile connettersi per il restart: {e}")),
        }

        // Cleanup temp file
        let _ = tokio::fs::remove_file(&tmp_path).await;
        send("DONE");
    });

    // Convert the channel receiver into a streaming body
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx)
        .map(|line| Ok::<_, std::convert::Infallible>(axum::body::Bytes::from(line)));

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/plain; charset=utf-8")
        .header("x-content-type-options", "nosniff")
        .body(Body::from_stream(stream))
        .unwrap()
}

// Re-export for use in router.rs
pub use self::deploy_remote as handler;
