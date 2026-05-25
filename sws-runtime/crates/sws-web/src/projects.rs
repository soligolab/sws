//! Multi-project endpoints — list / create / open / close / upload-zip.
//!
//! Pre-auth: these endpoints run outside the auth middleware so the
//! WelcomeScreen can show a project picker without a session token. Once
//! a project is opened, the per-project AuthState gates everything else.

use crate::router::{active_dir, AppState};
use crate::templates::copy_dir_all;
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    io::{Cursor, Read},
    path::{Path as StdPath, PathBuf},
};
use sws_core::{Project, ProjectMeta};
use tracing::{info, warn};

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ProjectListEntry {
    pub name: String,
    pub has_project_yaml: bool,
    pub last_modified_ms: Option<u64>,
}

#[derive(Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    /// Optional template id (subfolder under `templates_root`).
    /// When None, a minimal `project.yaml` is written instead.
    #[serde(default)]
    pub template: Option<String>,
}

#[derive(Serialize)]
pub struct OpenProjectResponse {
    pub name: String,
    pub must_login: bool,
}

// ── safe_project_name ────────────────────────────────────────────────────────

/// Sanitize a user-supplied project name into a safe folder name.
/// Rejects empty / dot-prefixed / parent-traversal / slash-bearing inputs.
pub fn safe_project_name(name: &str) -> Result<String, &'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("project name is empty");
    }
    if trimmed.starts_with('.') {
        return Err("project name cannot start with '.'");
    }
    if trimmed.len() > 64 {
        return Err("project name is too long (max 64 chars)");
    }
    for c in trimmed.chars() {
        if matches!(c, '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            return Err("project name contains an invalid character");
        }
    }
    if trimmed == "." || trimmed == ".." {
        return Err("invalid project name");
    }
    Ok(trimmed.to_string())
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// `GET /api/projects` — list subfolders of `projects_root` that contain a
/// `project.yaml`. Pre-auth so the WelcomeScreen can populate without a
/// session.
pub async fn list_projects(State(s): State<AppState>) -> Response {
    let root: &StdPath = s.projects_root.as_path();
    let mut entries: Vec<ProjectListEntry> = Vec::new();

    let mut dir = match tokio::fs::read_dir(root).await {
        Ok(d) => d,
        Err(e) => {
            warn!("list_projects: cannot read {}: {e}", root.display());
            return Json::<Vec<ProjectListEntry>>(vec![]).into_response();
        }
    };
    while let Ok(Some(entry)) = dir.next_entry().await {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name.starts_with('.') {
            continue;
        }
        let meta = match tokio::fs::metadata(&path).await {
            Ok(m) if m.is_dir() => m,
            _ => continue,
        };
        let yaml_path = path.join("project.yaml");
        let has_project_yaml = tokio::fs::try_exists(&yaml_path).await.unwrap_or(false);
        let last_modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        entries.push(ProjectListEntry { name, has_project_yaml, last_modified_ms });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Json(entries).into_response()
}

/// `POST /api/projects` — create a new project folder under `projects_root`,
/// optionally seeded from a template. Returns 409 if the folder exists.
pub async fn create_project(
    State(s): State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> Response {
    let safe_name = match safe_project_name(&req.name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    let target = s.projects_root.join(&safe_name);
    if tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return (StatusCode::CONFLICT, "project already exists").into_response();
    }

    if let Err(e) = tokio::fs::create_dir_all(&target).await {
        warn!("create_project: mkdir {}: {e}", target.display());
        return (StatusCode::INTERNAL_SERVER_ERROR, "cannot create project dir").into_response();
    }

    match req.template.as_deref().filter(|t| !t.is_empty()) {
        Some(template_id) => {
            let source = s.templates_root.join(template_id);
            if !tokio::fs::try_exists(&source).await.unwrap_or(false) {
                let _ = tokio::fs::remove_dir_all(&target).await;
                return (StatusCode::NOT_FOUND, "template not found").into_response();
            }
            // Recursive copy, skipping `template.yaml` (metadata-only).
            if let Err(e) = copy_dir_all(&source, &target, &["template.yaml"]).await {
                warn!("create_project: copy template: {e}");
                let _ = tokio::fs::remove_dir_all(&target).await;
                return (StatusCode::INTERNAL_SERVER_ERROR, "copy template failed")
                    .into_response();
            }
            info!(name = %safe_name, template = template_id, "project created from template");
        }
        None => {
            // Write a minimal project.yaml so the welcome list sees it.
            let project = Project {
                meta: ProjectMeta {
                    name: safe_name.clone(),
                    version: "0.1.0".into(),
                },
                tags: vec![],
                sources: vec![],
                alarms: vec![],
                functions: vec![],
                custom_symbols: vec![],
                datastores: vec![],
            };
            let yaml = match serde_yaml::to_string(&project) {
                Ok(y) => y,
                Err(e) => {
                    warn!("create_project: serialize: {e}");
                    return (StatusCode::INTERNAL_SERVER_ERROR, "serialize failed")
                        .into_response();
                }
            };
            if let Err(e) = tokio::fs::write(target.join("project.yaml"), yaml).await {
                warn!("create_project: write project.yaml: {e}");
                return (StatusCode::INTERNAL_SERVER_ERROR, "write project.yaml failed")
                    .into_response();
            }
            info!(name = %safe_name, "project created (empty)");
        }
    }

    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "name": safe_name })),
    )
        .into_response()
}

/// `POST /api/projects/:name/open` — switch the runtime's active project.
/// Loads `project.yaml`, populates TagDb (clear + populate), reloads
/// AlarmDb / supervisor / functions registry, swaps AuthState to the new
/// `users.yaml`. **Invalidates all current session tokens** — clients
/// must re-login.
pub async fn open_project(
    State(s): State<AppState>,
    Path(name): Path<String>,
) -> Response {
    let safe_name = match safe_project_name(&name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    let project_dir = s.projects_root.join(&safe_name);
    if !tokio::fs::try_exists(&project_dir).await.unwrap_or(false) {
        return (StatusCode::NOT_FOUND, "project not found").into_response();
    }

    // Read seed from env so newly-opened projects without a users.yaml
    // get bootstrapped with admin/etc. — same flow as the legacy
    // single-project boot.
    let seed = build_seed_accounts();

    // 1. Clear current project state.
    s.db.clear().await;
    s.alarms.load(vec![]).await;
    s.supervisor.reload(vec![]).await;
    s.functions.write().await.clear();
    s.derived_tags.write().await.clear();

    // Point the OPC-UA plugin at this project's PKI dir so cert + key
    // travel with the project (back up + restore included).
    s.supervisor.set_pki_root(project_dir.join(".opcua-pki")).await;

    // 2. Load and apply the new project.
    match Project::load(&project_dir) {
        Ok(project) => {
            info!(
                name = %project.meta.name,
                tags = project.tags.len(),
                alarms = project.alarms.len(),
                functions = project.functions.len(),
                "project opened",
            );
            // Seed derived tags before populate_tags so they start Uncertain
            // until the evaluator task computes the first real value.
            {
                let derived: Vec<(String, String)> = project.tags.iter()
                    .filter_map(|t| t.expression.as_ref().map(|e| (t.id.clone(), e.clone())))
                    .collect();
                *s.derived_tags.write().await = derived;
            }
            project.populate_tags(&s.db).await;
            s.alarms.load(project.alarms).await;
            s.supervisor.reload(project.sources).await;
            {
                let mut map = s.functions.write().await;
                for f in project.functions {
                    map.insert(f.name.clone(), f);
                }
            }
        }
        Err(e) => {
            warn!("open_project: project.yaml missing or invalid: {e:#}");
        }
    }

    // 3. Swap auth store. Drops all sessions → forces re-login.
    if let Err(e) = s.auth.swap_store(project_dir.join("users.yaml"), seed).await {
        warn!("open_project: swap_store failed: {e:#}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("auth swap failed: {e}"),
        )
            .into_response();
    }

    // 4. Mark the project as active.
    *s.project_dir.write().await = Some(project_dir);

    Json(OpenProjectResponse {
        name: safe_name,
        must_login: true,
    })
    .into_response()
}

/// `POST /api/projects/close` — close the active project.
/// Drops TagDb / AlarmDb / supervisor sources / functions / auth.
/// All sessions become invalid.
pub async fn close_project(State(s): State<AppState>) -> Response {
    // Check there's something to close.
    if active_dir(&s).await.is_err() {
        return (StatusCode::NO_CONTENT, ()).into_response();
    }
    s.db.clear().await;
    s.alarms.load(vec![]).await;
    s.supervisor.reload(vec![]).await;
    s.functions.write().await.clear();
    s.derived_tags.write().await.clear();
    s.auth.clear().await;
    *s.project_dir.write().await = None;
    info!("project closed");
    StatusCode::NO_CONTENT.into_response()
}

// ── Delete / Rename / Duplicate ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RenameRequest {
    pub new_name: String,
}

/// `DELETE /api/projects/:name` — permanently remove a project folder.
/// Returns 409 if the project is currently open.
pub async fn delete_project(
    State(s): State<AppState>,
    Path(name): Path<String>,
) -> Response {
    let safe_name = match safe_project_name(&name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    let target = s.projects_root.join(&safe_name);
    if !tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Reject if the project is currently open.
    if let Ok(active) = active_dir(&s).await {
        if active == target {
            return (StatusCode::CONFLICT, "project is currently open — close it first")
                .into_response();
        }
    }
    if let Err(e) = tokio::fs::remove_dir_all(&target).await {
        warn!("delete_project: remove {}: {e}", target.display());
        return (StatusCode::INTERNAL_SERVER_ERROR, "cannot delete project dir").into_response();
    }
    info!(name = %safe_name, "project deleted");
    StatusCode::NO_CONTENT.into_response()
}

/// `POST /api/projects/:name/rename` — rename a project folder.
/// Body: `{ "new_name": "..." }`.
/// If the project is currently open, updates the active project_dir pointer.
pub async fn rename_project(
    State(s): State<AppState>,
    Path(name): Path<String>,
    Json(req): Json<RenameRequest>,
) -> Response {
    let old_name = match safe_project_name(&name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    let new_name = match safe_project_name(&req.new_name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    if old_name == new_name {
        return (StatusCode::BAD_REQUEST, "new name is the same as the current name").into_response();
    }
    let old_dir = s.projects_root.join(&old_name);
    let new_dir = s.projects_root.join(&new_name);
    if !tokio::fs::try_exists(&old_dir).await.unwrap_or(false) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if tokio::fs::try_exists(&new_dir).await.unwrap_or(false) {
        return (StatusCode::CONFLICT, "a project with the new name already exists").into_response();
    }
    if let Err(e) = tokio::fs::rename(&old_dir, &new_dir).await {
        warn!("rename_project: rename {old_name} → {new_name}: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "cannot rename project dir").into_response();
    }
    // If the renamed project was open, update the active pointer.
    {
        let mut lock = s.project_dir.write().await;
        if lock.as_deref() == Some(old_dir.as_path()) {
            *lock = Some(new_dir.clone());
        }
    }
    info!(old = %old_name, new = %new_name, "project renamed");
    Json(serde_json::json!({ "name": new_name })).into_response()
}

/// `POST /api/projects/:name/duplicate` — copy a project to a new folder.
/// Body: `{ "new_name": "..." }`.
pub async fn duplicate_project(
    State(s): State<AppState>,
    Path(name): Path<String>,
    Json(req): Json<RenameRequest>,
) -> Response {
    let src_name = match safe_project_name(&name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    let dst_name = match safe_project_name(&req.new_name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    let src_dir = s.projects_root.join(&src_name);
    let dst_dir = s.projects_root.join(&dst_name);
    if !tokio::fs::try_exists(&src_dir).await.unwrap_or(false) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if tokio::fs::try_exists(&dst_dir).await.unwrap_or(false) {
        return (StatusCode::CONFLICT, "a project with the new name already exists").into_response();
    }
    if let Err(e) = copy_dir_all(&src_dir, &dst_dir, &[]).await {
        warn!("duplicate_project: copy {src_name} → {dst_name}: {e}");
        let _ = tokio::fs::remove_dir_all(&dst_dir).await;
        return (StatusCode::INTERNAL_SERVER_ERROR, "copy failed").into_response();
    }
    info!(src = %src_name, dst = %dst_name, "project duplicated");
    (StatusCode::CREATED, Json(serde_json::json!({ "name": dst_name }))).into_response()
}

// ── Upload from ZIP ───────────────────────────────────────────────────────────

#[derive(Deserialize, Default)]
pub struct UploadQuery {
    /// Optional project name override. When absent the name is read from the
    /// ZIP's `manifest.json`; if `manifest.json` is missing the upload is
    /// rejected with 400.
    #[serde(default)]
    pub name: Option<String>,
}

// Minimal manifest — we only need `name` to derive the folder name.
#[derive(serde::Deserialize)]
struct UploadManifest {
    name: String,
}

/// `POST /api/projects/upload` — create a new project by uploading an SWS
/// export ZIP (same format as `GET /api/project/export`).
///
/// - Body: raw `application/zip` bytes.
/// - Query param `?name=<override>` is optional; falls back to `manifest.json`.
/// - Returns 201 `{"name": "..."}` on success, 409 if the folder exists.
/// - Pre-auth: no session token required.
pub async fn upload_project_zip(
    State(s): State<AppState>,
    Query(q): Query<UploadQuery>,
    body: Bytes,
) -> Response {
    // 1. Parse the ZIP.
    let mut archive = match zip::ZipArchive::new(Cursor::new(body.as_ref())) {
        Ok(a)  => a,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("not a valid zip: {e}")).into_response(),
    };

    // 2. Determine the project name.
    let raw_name = match q.name.filter(|n| !n.trim().is_empty()) {
        Some(n) => n,
        None => {
            // Read manifest.json from the archive.
            match read_zip_entry(&mut archive, "manifest.json") {
                Ok(Some(bytes)) => match serde_json::from_slice::<UploadManifest>(&bytes) {
                    Ok(m) => m.name,
                    Err(e) => return (StatusCode::BAD_REQUEST,
                        format!("manifest.json parse error: {e}")).into_response(),
                },
                Ok(None) => return (StatusCode::BAD_REQUEST,
                    "ZIP has no manifest.json — supply ?name= query param").into_response(),
                Err(e) => return (StatusCode::BAD_REQUEST,
                    format!("zip read error: {e}")).into_response(),
            }
        }
    };

    let safe_name = match safe_project_name(&raw_name) {
        Ok(n) => n,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };

    // 3. Reject if the folder already exists.
    let target = s.projects_root.join(&safe_name);
    if tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return (StatusCode::CONFLICT, "project already exists").into_response();
    }
    if let Err(e) = tokio::fs::create_dir_all(&target).await {
        warn!("upload_project_zip: mkdir {}: {e}", target.display());
        return (StatusCode::INTERNAL_SERVER_ERROR, "cannot create project dir").into_response();
    }

    // 4. Extract every file from the ZIP into the project folder.
    //    We trust the manifest.json name and skip it; everything else lands at
    //    its relative path under `target`. We refuse `..` components.
    let file_names: Vec<String> = archive.file_names().map(|n| n.to_string()).collect();
    for entry_name in &file_names {
        if entry_name == "manifest.json" {
            continue; // metadata only — not needed on disk
        }
        // Safety: reject traversal paths.
        if entry_name.contains("..") || entry_name.starts_with('/') {
            warn!("upload_project_zip: skipping suspicious entry '{entry_name}'");
            continue;
        }
        let dest = target.join(entry_name);
        // Ensure parent dirs exist (e.g. synoptics/).
        if let Some(parent) = dest.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                warn!("upload_project_zip: mkdir {}: {e}", parent.display());
                let _ = tokio::fs::remove_dir_all(&target).await;
                return (StatusCode::INTERNAL_SERVER_ERROR, "cannot create subdirectory")
                    .into_response();
            }
        }
        match read_zip_entry(&mut archive, entry_name) {
            Ok(Some(bytes)) => {
                if let Err(e) = tokio::fs::write(&dest, bytes).await {
                    warn!("upload_project_zip: write {entry_name}: {e}");
                    let _ = tokio::fs::remove_dir_all(&target).await;
                    return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
                }
            }
            Ok(None) => { /* entry disappeared between listing and reading — skip */ }
            Err(e) => {
                warn!("upload_project_zip: read {entry_name}: {e}");
                let _ = tokio::fs::remove_dir_all(&target).await;
                return (StatusCode::INTERNAL_SERVER_ERROR, "zip read failed").into_response();
            }
        }
    }

    info!(name = %safe_name, "project created from uploaded ZIP");
    (StatusCode::CREATED, Json(serde_json::json!({ "name": safe_name }))).into_response()
}

/// Read a named entry from a ZipArchive into a byte vector.
/// Returns `Ok(None)` if the entry does not exist.
fn read_zip_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> zip::result::ZipResult<Option<Vec<u8>>> {
    match archive.by_name(name) {
        Ok(mut entry) => {
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;
            Ok(Some(buf))
        }
        Err(zip::result::ZipError::FileNotFound) => Ok(None),
        Err(e) => Err(e),
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Re-read SWS_ADMIN_PASSWORD etc. from env so a freshly-opened project
/// without a `users.yaml` gets seeded. Mirrors main.rs bootstrap.
fn build_seed_accounts() -> Vec<(String, sws_auth::Role, String)> {
    use sws_auth::Role;
    let mut accounts: Vec<(String, Role, String)> = Vec::new();
    let admin_user = std::env::var("SWS_ADMIN_USER").unwrap_or_else(|_| "admin".into());
    if let Ok(pwd) = std::env::var("SWS_ADMIN_PASSWORD") {
        accounts.push((admin_user, Role::Admin, pwd));
    }
    if let Ok(pwd) = std::env::var("SWS_SUPERVISOR_PASSWORD") {
        let user = std::env::var("SWS_SUPERVISOR_USER").unwrap_or_else(|_| "supervisor".into());
        accounts.push((user, Role::Supervisor, pwd));
    }
    if let Ok(pwd) = std::env::var("SWS_OPERATOR_PASSWORD") {
        let user = std::env::var("SWS_OPERATOR_USER").unwrap_or_else(|_| "operator".into());
        accounts.push((user, Role::Operator, pwd));
    }
    if let Ok(pwd) = std::env::var("SWS_VIEWER_PASSWORD") {
        let user = std::env::var("SWS_VIEWER_USER").unwrap_or_else(|_| "viewer".into());
        accounts.push((user, Role::Viewer, pwd));
    }
    accounts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_project_name_accepts_basic() {
        assert_eq!(safe_project_name("foo").unwrap(), "foo");
        assert_eq!(safe_project_name("foo-bar_2026").unwrap(), "foo-bar_2026");
        assert_eq!(safe_project_name("  foo  ").unwrap(), "foo");
    }

    #[test]
    fn safe_project_name_rejects_traversal_and_slashes() {
        assert!(safe_project_name("").is_err());
        assert!(safe_project_name(".hidden").is_err());
        assert!(safe_project_name("..").is_err());
        assert!(safe_project_name("foo/bar").is_err());
        assert!(safe_project_name("foo\\bar").is_err());
        assert!(safe_project_name("foo:bar").is_err());
        assert!(safe_project_name(&"x".repeat(100)).is_err());
    }
}

#[allow(unused_imports)]
use PathBuf as _; // keep PathBuf import discoverable for future extensions
