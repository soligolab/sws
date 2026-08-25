//! Project backups — point-in-time snapshots of the project files
//! (`project.yaml`, `synoptics/`, `users.yaml`) in `<project>/backups/<ts>/`.
//!
//! Two entry points:
//!   - the runtime spawns an auto-backup loop on startup when the user
//!     provides `--auto-backup-interval-minutes N`,
//!   - admin REST endpoints let the operator trigger / list / restore /
//!     delete backups on demand.
//!
//! Naming: backup directories are named `YYYY-MM-DDTHH-MM-SSZ` (UTC,
//! filesystem-safe). Lexicographic sort = chronological order, which keeps
//! the prune logic trivial.

use std::io::Write;
use std::path::{Path, PathBuf};

use axum::{
    body::Body,
    extract::{Path as AxPath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use time::OffsetDateTime;
use tracing::{info, warn};

use crate::router::{active_dir, AppState};

/// Files / dirs at the project root that participate in a backup. The list
/// is intentionally small — runtime artefacts (`logs/`, `audit/`, `.run/`)
/// are excluded because they belong to operations, not to the design.
const BACKED_UP: &[&str] = &[
    "project.yaml",
    "synoptics",
    "users.yaml",
    "history",   // per-project SQLite historian — needed to restore on another host
    "recipes",   // recipe files (skipped silently if absent)
    "images",    // user-uploaded images referenced by synoptics (bg_image & co.)
];

#[derive(Serialize, Debug, Clone)]
pub struct BackupInfo {
    /// Directory name (e.g. `2026-05-19T12-30-00Z`). Used as the path param
    /// for restore/delete.
    pub name: String,
    pub created_at_ms: i128,
    /// Total bytes occupied by this backup (sum of file sizes). Best-effort.
    pub size_bytes: u64,
}

/// Directory that holds every snapshot for a given project.
pub fn bak_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("backups")
}

fn timestamp_name() -> String {
    let now = OffsetDateTime::now_utc();
    // Filesystem-safe ISO 8601: colons in time → dashes. Keep the trailing
    // `Z` so the format is still recognisable as UTC ISO 8601.
    format!(
        "{:04}-{:02}-{:02}T{:02}-{:02}-{:02}Z",
        now.year(), now.month() as u8, now.day(),
        now.hour(), now.minute(), now.second(),
    )
}

/// Recursive copy with no skip list — used internally for backup and
/// restore. Skips broken symlinks but otherwise descends everywhere.
fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_file() {
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(src, dst)?;
        return Ok(());
    }
    if !src.is_dir() {
        // Symlink target gone or special file — skip silently.
        return Ok(());
    }
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        copy_recursive(&from, &to)?;
    }
    Ok(())
}

fn dir_size(path: &Path) -> u64 {
    let mut total: u64 = 0;
    if path.is_file() {
        return path.metadata().map(|m| m.len()).unwrap_or(0);
    }
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            total = total.saturating_add(dir_size(&entry.path()));
        }
    }
    total
}

/// Take a snapshot now. Returns the path of the freshly-created directory.
/// Errors propagate up; caller logs.
pub fn backup_now(project_dir: &Path) -> std::io::Result<PathBuf> {
    let dst = bak_dir(project_dir).join(timestamp_name());
    std::fs::create_dir_all(&dst)?;
    for name in BACKED_UP {
        let src = project_dir.join(name);
        if !src.exists() { continue; }
        let to = dst.join(name);
        copy_recursive(&src, &to)?;
    }
    Ok(dst)
}

/// Enumerate every backup directory in `<project>/backups/`, newest first.
pub fn list_backups(project_dir: &Path) -> Vec<BackupInfo> {
    let dir = bak_dir(project_dir);
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new(); };
    let mut out: Vec<BackupInfo> = entries.filter_map(|e| e.ok()).filter_map(|entry| {
        if !entry.file_type().ok()?.is_dir() { return None; }
        let name = entry.file_name().to_string_lossy().into_owned();
        let meta = entry.metadata().ok()?;
        let created_at_ms = meta.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i128)
            .unwrap_or(0);
        let size_bytes = dir_size(&entry.path());
        Some(BackupInfo { name, created_at_ms, size_bytes })
    }).collect();
    // Names sort lexicographically = chronologically thanks to the
    // YYYY-MM-DDTHH-MM-SSZ format. Newest first.
    out.sort_by(|a, b| b.name.cmp(&a.name));
    out
}

/// Restore a snapshot back over the live project. Each path listed in
/// `BACKED_UP` is first deleted from the live project (if present), then
/// copied back from the snapshot. Files inside the project that weren't
/// part of the snapshot are left untouched — this is a partial restore by
/// design (we don't want to nuke user-introduced files like `.env`).
pub fn restore_backup(project_dir: &Path, name: &str) -> std::io::Result<()> {
    let src_root = bak_dir(project_dir).join(name);
    if !src_root.is_dir() {
        return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "backup not found"));
    }
    for entry in BACKED_UP {
        let live = project_dir.join(entry);
        let snap = src_root.join(entry);
        if !snap.exists() { continue; }
        if live.exists() {
            if live.is_dir() {
                std::fs::remove_dir_all(&live)?;
            } else {
                std::fs::remove_file(&live)?;
            }
        }
        copy_recursive(&snap, &live)?;
    }
    Ok(())
}

/// Zip an entire directory tree (relative paths preserved), for a raw
/// download of a backup snapshot — the snapshot can contain arbitrary binary
/// files (`history/historian.db`), so this walks and copies bytes as-is
/// rather than re-serializing anything, unlike `build_export_zip`.
fn zip_directory(dir: &Path) -> std::io::Result<Vec<u8>> {
    use zip::write::SimpleFileOptions;
    let mut cursor = std::io::Cursor::new(Vec::<u8>::new());
    {
        let mut z = zip::ZipWriter::new(&mut cursor);
        // Stored (uncompressed) — same choice as build_export_zip elsewhere
        // in this codebase; enabling Deflate would need a zip crate feature
        // not currently active, and a backup is downloaded rarely enough
        // that the extra disk-over-network bytes aren't worth chasing.
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        add_dir_to_zip(&mut z, dir, dir, opts)?;
        z.finish().map_err(std::io::Error::other)?;
    }
    Ok(cursor.into_inner())
}

fn add_dir_to_zip<W: std::io::Write + std::io::Seek>(
    z: &mut zip::ZipWriter<W>,
    base: &Path,
    dir: &Path,
    opts: zip::write::SimpleFileOptions,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let rel = path.strip_prefix(base)
            .map_err(std::io::Error::other)?
            .to_string_lossy()
            .replace('\\', "/");
        if path.is_dir() {
            add_dir_to_zip(z, base, &path, opts)?;
        } else if path.is_file() {
            z.start_file(rel, opts).map_err(std::io::Error::other)?;
            z.write_all(&std::fs::read(&path)?)?;
        }
    }
    Ok(())
}

/// Remove a single snapshot by directory name.
pub fn delete_backup(project_dir: &Path, name: &str) -> std::io::Result<()> {
    let path = bak_dir(project_dir).join(name);
    if !path.is_dir() {
        return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "backup not found"));
    }
    std::fs::remove_dir_all(&path)
}

/// Trim the backup list to the most recent `keep` entries.
pub fn prune_backups(project_dir: &Path, keep: usize) {
    let backups = list_backups(project_dir);
    if backups.len() <= keep { return; }
    for b in backups.into_iter().skip(keep) {
        if let Err(e) = delete_backup(project_dir, &b.name) {
            warn!("backups: cannot prune {}: {e}", b.name);
        } else {
            info!("backups: pruned old snapshot {}", b.name);
        }
    }
}

// ── HTTP handlers ────────────────────────────────────────────────────────────

pub async fn list_backups_handler(State(s): State<AppState>) -> Response {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    Json(list_backups(&dir)).into_response()
}

pub async fn create_backup_handler(State(s): State<AppState>) -> Response {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    match backup_now(&dir) {
        Ok(path) => {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            info!(backup = %name, "backup created");
            Json(serde_json::json!({ "name": name })).into_response()
        }
        Err(e) => {
            warn!("backup create failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("backup failed: {e}")).into_response()
        }
    }
}

pub async fn restore_backup_handler(
    State(s): State<AppState>,
    AxPath(name): AxPath<String>,
) -> Response {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    if !safe_backup_name(&name) {
        return (StatusCode::BAD_REQUEST, "invalid backup name").into_response();
    }
    match restore_backup(&dir, &name) {
        Ok(()) => {
            info!(backup = %name, "backup restored");
            // Il progetto su disco è tornato indietro nel tempo: chi ne sta
            // disegnando una pagina sta guardando qualcosa che non c'è più (Q20).
            crate::router::signal_project_changed(&s, "restore");
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => {
            warn!("backup restore {name} failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("restore failed: {e}")).into_response()
        }
    }
}

/// `GET /api/backups/:name/download` — zip di un singolo snapshot, per
/// archiviarlo fuori dal device (l'intera cartella `backups/<name>/`, stesso
/// contenuto di un restore: project.yaml, synoptics, users.yaml, `history/`,
/// recipes).
pub async fn download_backup_handler(
    State(s): State<AppState>,
    AxPath(name): AxPath<String>,
) -> Response {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    if !safe_backup_name(&name) {
        return (StatusCode::BAD_REQUEST, "invalid backup name").into_response();
    }
    let backup_dir = bak_dir(&dir).join(&name);
    if !backup_dir.is_dir() {
        return (StatusCode::NOT_FOUND, "backup not found").into_response();
    }
    match zip_directory(&backup_dir) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/zip")
            .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{name}.zip\""))
            .body(Body::from(bytes))
            .unwrap(),
        Err(e) => {
            warn!("backup download {name} failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("zip failed: {e}")).into_response()
        }
    }
}

pub async fn delete_backup_handler(
    State(s): State<AppState>,
    AxPath(name): AxPath<String>,
) -> Response {
    let dir = match active_dir(&s).await { Ok(d) => d, Err(c) => return c.into_response() };
    if !safe_backup_name(&name) {
        return (StatusCode::BAD_REQUEST, "invalid backup name").into_response();
    }
    match delete_backup(&dir, &name) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::NOT_FOUND, format!("not found: {e}")).into_response(),
    }
}

/// Restricts the backup name to the timestamp format we produce. Prevents
/// `..`, `/`, and other traversal attempts via the path param.
fn safe_backup_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 32
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == 'T' || c == 'Z')
        && !name.contains("..")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(dir: &Path, rel: &str, body: &str) {
        let full = dir.join(rel);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(full, body).unwrap();
    }

    #[test]
    fn backup_and_restore_roundtrips() {
        let tmp = TempDir::new().unwrap();
        let project = tmp.path();
        write(project, "project.yaml", "name: test\n");
        write(project, "synoptics/Page 1.yaml", "id: a\nname: Page 1\nobjects: []\n");
        write(project, "users.yaml", "users: []\n");

        let snap = backup_now(project).unwrap();
        assert!(snap.exists());
        // Mutate the live state.
        write(project, "project.yaml", "name: changed\n");
        std::fs::remove_file(project.join("synoptics/Page 1.yaml")).unwrap();

        // Restore should bring back the snapshotted content.
        let snap_name = snap.file_name().unwrap().to_string_lossy().into_owned();
        restore_backup(project, &snap_name).unwrap();
        assert_eq!(
            std::fs::read_to_string(project.join("project.yaml")).unwrap(),
            "name: test\n"
        );
        assert!(project.join("synoptics/Page 1.yaml").exists());
    }

    #[test]
    fn zip_directory_preserves_files_and_binary_content() {
        let tmp = TempDir::new().unwrap();
        let project = tmp.path();
        write(project, "project.yaml", "name: test\n");
        write(project, "synoptics/Page 1.yaml", "id: a\n");
        // Binario non-UTF8, come sarebbe history/historian.db davvero.
        let db_path = project.join("history/historian.db");
        std::fs::create_dir_all(db_path.parent().unwrap()).unwrap();
        std::fs::write(&db_path, [0u8, 159, 146, 150, 1, 2, 3]).unwrap();

        let snap = backup_now(project).unwrap();
        let zip_bytes = zip_directory(&snap).unwrap();

        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes)).unwrap();
        let mut names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        names.sort();
        assert_eq!(names, vec![
            "history/historian.db",
            "project.yaml",
            "synoptics/Page 1.yaml",
        ]);

        let mut db_entry = archive.by_name("history/historian.db").unwrap();
        let mut out = Vec::new();
        std::io::Read::read_to_end(&mut db_entry, &mut out).unwrap();
        assert_eq!(out, vec![0u8, 159, 146, 150, 1, 2, 3]);
    }

    #[test]
    fn list_backups_sorts_newest_first() {
        let tmp = TempDir::new().unwrap();
        let project = tmp.path();
        write(project, "project.yaml", "x: 1");
        // Manually create three backups with predictable names.
        for name in ["2026-01-01T00-00-00Z", "2026-02-01T00-00-00Z", "2026-03-01T00-00-00Z"] {
            let p = bak_dir(project).join(name);
            std::fs::create_dir_all(&p).unwrap();
            std::fs::write(p.join("project.yaml"), "x: 1").unwrap();
        }
        let list = list_backups(project);
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].name, "2026-03-01T00-00-00Z");
        assert_eq!(list[2].name, "2026-01-01T00-00-00Z");
    }

    #[test]
    fn prune_drops_oldest_beyond_keep() {
        let tmp = TempDir::new().unwrap();
        let project = tmp.path();
        for i in 0..5 {
            let name = format!("2026-01-0{i}T00-00-00Z");
            let p = bak_dir(project).join(&name);
            std::fs::create_dir_all(&p).unwrap();
            std::fs::write(p.join("a"), "").unwrap();
        }
        prune_backups(project, 2);
        let remaining = list_backups(project);
        assert_eq!(remaining.len(), 2);
        assert_eq!(remaining[0].name, "2026-01-04T00-00-00Z");
        assert_eq!(remaining[1].name, "2026-01-03T00-00-00Z");
    }

    #[test]
    fn safe_backup_name_rejects_traversal() {
        assert!(safe_backup_name("2026-05-19T12-00-00Z"));
        assert!(!safe_backup_name(""));
        assert!(!safe_backup_name("../etc/passwd"));
        assert!(!safe_backup_name("foo/bar"));
        assert!(!safe_backup_name(".."));
        assert!(!safe_backup_name(&"a".repeat(40)));
    }
}
