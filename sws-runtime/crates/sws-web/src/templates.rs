//! Project templates — `GET /api/templates` + recursive directory copy.
//!
//! A template is a folder under `templates_root` containing a
//! `template.yaml` metadata file plus the project payload (project.yaml,
//! synoptics/, custom_symbols/, ...). The folder name is the template id;
//! `template.yaml` carries the user-facing label and description.

use crate::router::AppState;
use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::warn;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct TemplateEntry {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Deserialize, Default)]
struct TemplateYaml {
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// `GET /api/templates` — list subfolders of `templates_root` with their
/// `template.yaml` metadata (when present).
pub async fn list_templates(State(s): State<AppState>) -> Response {
    let root = s.templates_root.as_path();
    let mut out: Vec<TemplateEntry> = Vec::new();

    let mut dir = match tokio::fs::read_dir(root).await {
        Ok(d) => d,
        Err(e) => {
            warn!("list_templates: cannot read {}: {e}", root.display());
            return Json::<Vec<TemplateEntry>>(vec![]).into_response();
        }
    };
    while let Ok(Some(entry)) = dir.next_entry().await {
        let path = entry.path();
        let id = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n.to_string(),
            _ => continue,
        };
        match tokio::fs::metadata(&path).await {
            Ok(m) if m.is_dir() => {}
            _ => continue,
        }

        let yaml_path = path.join("template.yaml");
        let (label, description) = match tokio::fs::read_to_string(&yaml_path).await {
            Ok(text) => match serde_yaml::from_str::<TemplateYaml>(&text) {
                Ok(t) => (t.label.unwrap_or_else(|| id.clone()), t.description),
                Err(e) => {
                    warn!("list_templates: parse {yaml_path:?}: {e}");
                    (id.clone(), None)
                }
            },
            Err(_) => (id.clone(), None),
        };
        out.push(TemplateEntry { id, label, description });
    }

    out.sort_by(|a, b| a.id.cmp(&b.id));
    Json(out).into_response()
}

// ── Recursive copy ───────────────────────────────────────────────────────────

/// Recursively copy `src` into `dst`. Skips entries whose top-level
/// filename matches one of `skip` (used to omit `template.yaml` when
/// seeding a project from a template).
pub fn copy_dir_all<'a>(
    src: &'a Path,
    dst: &'a Path,
    skip: &'a [&'a str],
) -> std::pin::Pin<Box<dyn std::future::Future<Output = std::io::Result<()>> + Send + 'a>> {
    Box::pin(async move {
        tokio::fs::create_dir_all(dst).await?;
        let mut entries = tokio::fs::read_dir(src).await?;
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            // Skip is applied only at the top level — depth-1 entries
            // matching `skip` are dropped, deeper entries are always copied.
            if skip.iter().any(|s| **s == *name_str) {
                continue;
            }
            let src_path = entry.path();
            let dst_path = dst.join(&name);
            let ftype = entry.file_type().await?;
            if ftype.is_dir() {
                copy_dir_all(&src_path, &dst_path, &[]).await?;
            } else if ftype.is_file() {
                tokio::fs::copy(&src_path, &dst_path).await?;
            }
            // Symlinks and other types are skipped silently — templates
            // shouldn't contain them.
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn copy_dir_all_copies_recursively() {
        let src = TempDir::new().unwrap();
        let dst = TempDir::new().unwrap();
        tokio::fs::write(src.path().join("a.yaml"), "a").await.unwrap();
        tokio::fs::create_dir(src.path().join("sub")).await.unwrap();
        tokio::fs::write(src.path().join("sub").join("b.yaml"), "b").await.unwrap();
        tokio::fs::write(src.path().join("template.yaml"), "skip me").await.unwrap();
        copy_dir_all(src.path(), dst.path(), &["template.yaml"]).await.unwrap();
        assert!(dst.path().join("a.yaml").exists());
        assert!(dst.path().join("sub").join("b.yaml").exists());
        assert!(!dst.path().join("template.yaml").exists());
    }
}
