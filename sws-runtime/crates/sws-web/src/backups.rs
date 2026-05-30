//! Project backups — point-in-time snapshots of the project files
//! (`project.yaml`, `synoptics/`, `users.yaml`) in `<project>/.bak/<ts>/`.
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

use std::path::{Path, PathBuf};

use axum::{extract::{Path as AxPath, State}, http::StatusCode, response::{IntoResponse, Response}, Json};
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
    ".history",  // per-project SQLite historian — needed to restore on another host
    "recipes",   // recipe files (skipped silently if absent)
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
    project_dir.join(".bak")
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

/// Enumerate every backup directory in `<project>/.bak/`, newest first.
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
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => {
            warn!("backup restore {name} failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("restore failed: {e}")).into_response()
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
