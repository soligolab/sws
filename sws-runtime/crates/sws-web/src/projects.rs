//! Multi-project endpoints — list / create / open / close.
//!
//! Pre-auth: these endpoints run outside the auth middleware so the
//! WelcomeScreen can show a project picker without a session token. Once
//! a project is opened, the per-project AuthState gates everything else.

use crate::router::{active_dir, AppState};
use crate::templates::copy_dir_all;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::{Path as StdPath, PathBuf};
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
    s.auth.clear().await;
    *s.project_dir.write().await = None;
    info!("project closed");
    StatusCode::NO_CONTENT.into_response()
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
