//! The diagnostic export of the control panel: one zip for whoever gives
//! assistance, with what the About section says, the runtime's logs, the
//! audit and — where a helper can read them — the system's logs.
//!
//! - `GET  /api/control-panel/diagnostics` — the zip, downloaded;
//! - `POST /api/control-panel/diagnostics/usb` — the same zip written on the
//!   USB stick, where a helper can (Tiny TY).
//!
//! Neither the project nor the history go in (maintainer, 15-11-2026): they
//! are the customer's, and the history can be hundreds of megabytes.

use crate::router::AppState;
use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The newest runtime logs: one file a day, so about two weeks.
const MAX_LOG_FILES: usize = 14;
/// Per file: a log gone wild must not make the export unusable.
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const HELPER_WITHIN: Duration = Duration::from_secs(20);
/// A stick that was just inserted is mounted by Pixsys' rule a few seconds
/// later (4 s measured on the TY570): ten looks, a second apart. The LVGL
/// viewer waits 15 s for an answer, and the zip still has to be built.
const USB_MOUNT_TRIES: u32 = 8;
const USB_MOUNT_EVERY: Duration = Duration::from_secs(1);

/// The root helper of the Tiny TY (`deploy/tiny-ty/sws-diagnostics`), run
/// through sudo. `None`: no system logs and no USB stick here.
pub fn helper() -> Option<PathBuf> {
    std::env::var_os("SWS_DIAGNOSTICS_HELPER")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.exists())
}

/// The newest `runtime-*.jsonl` of the logs folder, oldest first.
pub fn log_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|d| {
            d.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with("runtime-") && n.ends_with(".jsonl"))
                })
                .collect()
        })
        .unwrap_or_default();
    // The date is in the name: sorting the names sorts the days.
    files.sort();
    let skip = files.len().saturating_sub(MAX_LOG_FILES);
    files.split_off(skip)
}

/// The end of a file, up to `max` bytes: in a log the end is what matters.
fn tail(path: &Path, max: u64) -> std::io::Result<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(max)))?;
    let mut out = Vec::new();
    f.take(max).read_to_end(&mut out)?;
    Ok(out)
}

async fn run_helper(helper: &Path, arg: &str, stdin: Option<Vec<u8>>) -> Result<Vec<u8>, String> {
    use tokio::io::AsyncWriteExt;
    let mut child = tokio::process::Command::new("sudo")
        .arg("-n")
        .arg(helper)
        .arg(arg)
        .stdin(if stdin.is_some() {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        })
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("diagnostics helper: {e}"))?;
    if let (Some(data), Some(mut pipe)) = (stdin, child.stdin.take()) {
        // A helper that stops before it has read everything (no stick, a full
        // one) closes the pipe: that is not the error, its message is. The
        // exit status and its stderr below say what happened.
        if let Err(e) = pipe.write_all(&data).await {
            if e.kind() != std::io::ErrorKind::BrokenPipe {
                return Err(format!("diagnostics helper: {e}"));
            }
        }
        // Closed here: the helper reads until the end.
    }
    let out = tokio::time::timeout(HELPER_WITHIN, child.wait_with_output())
        .await
        .map_err(|_| "diagnostics helper: no answer".to_string())?
        .map_err(|e| format!("diagnostics helper: {e}"))?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// The files of the export, as (name in the zip, content).
async fn collect(s: &AppState) -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();
    // What the About section shows, as it is now.
    if let Ok(body) = axum::body::to_bytes(
        super::about::about(State(s.clone())).await.into_body(),
        1 << 20,
    )
    .await
    {
        files.push(("about.json".to_string(), body.to_vec()));
    }
    let (logs, config) = (s.logs_dir.clone(), s.config_dir.clone());
    let from_disk = tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        for path in log_files(&logs) {
            if let (Some(name), Ok(data)) = (
                path.file_name().and_then(|n| n.to_str()),
                tail(&path, MAX_FILE_BYTES),
            ) {
                out.push((format!("runtime/{name}"), data));
            }
        }
        // Who changed what; no password is ever written there.
        for name in ["audit.jsonl", "control_panel.json"] {
            if let Ok(data) = tail(&config.join(name), MAX_FILE_BYTES) {
                out.push((format!("config/{name}"), data));
            }
        }
        out
    })
    .await
    .unwrap_or_default();
    files.extend(from_disk);
    if let Some(helper) = helper() {
        for (arg, name) in [
            ("journal", "system/journal.txt"),
            ("dmesg", "system/dmesg.txt"),
        ] {
            let data = match run_helper(&helper, arg, None).await {
                Ok(d) => d,
                // Said in the export itself: a missing file would not explain why.
                Err(e) => format!("not available: {e}\n").into_bytes(),
            };
            files.push((name.to_string(), data));
        }
    }
    files
}

pub fn zip_of(files: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    use zip::write::SimpleFileOptions;
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut cursor);
        let opts =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in files {
            z.start_file(name.as_str(), opts)
                .and_then(|()| z.write_all(data).map_err(Into::into))
                .map_err(|e| format!("diagnostics: {name}: {e}"))?;
        }
        z.finish().map_err(|e| format!("diagnostics: {e}"))?;
    }
    Ok(cursor.into_inner())
}

fn failed(e: String) -> Response {
    (StatusCode::BAD_GATEWAY, Json(json!({ "error": e }))).into_response()
}

pub async fn download(State(s): State<AppState>) -> Response {
    s.audit.log(
        "control_panel.diagnostics",
        None,
        json!({ "to": "download" }),
    );
    match zip_of(&collect(&s).await) {
        Ok(zip) => (
            [
                (header::CONTENT_TYPE, "application/zip"),
                (
                    header::CONTENT_DISPOSITION,
                    "attachment; filename=\"sws-diagnostics.zip\"",
                ),
            ],
            zip,
        )
            .into_response(),
        Err(e) => failed(e),
    }
}

/// → `{file}`: the name the helper gave the zip on the stick.
pub async fn to_usb(State(s): State<AppState>) -> Response {
    let Some(helper) = helper() else {
        return failed("this device cannot write on a USB stick".into());
    };
    s.audit
        .log("control_panel.diagnostics", None, json!({ "to": "usb" }));
    // Before the zip is built, not after: a stick that is not there (or not
    // mounted yet, Pixsys' rule takes ten seconds) has a stable code the panel
    // says in words.
    // A stick just inserted is mounted a few seconds later: wait for it, for
    // less than the viewer waits for the answer.
    for attempt in 0..USB_MOUNT_TRIES {
        match run_helper(&helper, "check-usb", None).await {
            Ok(_) => break,
            Err(e) if e == "usb-mounting" && attempt + 1 < USB_MOUNT_TRIES => {
                tokio::time::sleep(USB_MOUNT_EVERY).await;
            }
            Err(e) => return failed(e),
        }
    }
    let zip = match zip_of(&collect(&s).await) {
        Ok(z) => z,
        Err(e) => return failed(e),
    };
    match run_helper(&helper, "to-usb", Some(zip)).await {
        Ok(name) => Json(json!({ "file": String::from_utf8_lossy(&name).trim() })).into_response(),
        Err(e) => failed(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_newest_logs_go_in_and_nothing_else() {
        let d = tempfile::tempdir().unwrap();
        for day in 1..=20 {
            std::fs::write(
                d.path().join(format!("runtime-2026-11-{day:02}.jsonl")),
                "x",
            )
            .unwrap();
        }
        std::fs::write(d.path().join("README"), "x").unwrap();
        std::fs::write(d.path().join("other.jsonl"), "x").unwrap();
        let files = log_files(d.path());
        assert_eq!(files.len(), MAX_LOG_FILES);
        assert!(files[0].ends_with("runtime-2026-11-07.jsonl"));
        assert!(files[13].ends_with("runtime-2026-11-20.jsonl"));
        assert!(log_files(&d.path().join("missing")).is_empty());
    }

    #[test]
    fn a_long_file_keeps_its_end_and_the_zip_reads_back() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("log");
        std::fs::write(&path, b"0123456789").unwrap();
        assert_eq!(tail(&path, 4).unwrap(), b"6789");
        assert_eq!(tail(&path, 100).unwrap(), b"0123456789");
        let zip = zip_of(&[("runtime/a.jsonl".into(), b"hello".to_vec())]).unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(zip)).unwrap();
        let mut text = String::new();
        std::io::Read::read_to_string(&mut z.by_name("runtime/a.jsonl").unwrap(), &mut text)
            .unwrap();
        assert_eq!(text, "hello");
    }
}
