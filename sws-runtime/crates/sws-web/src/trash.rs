//! The project trash (13-11-2026, plan `docs/archive/2026-11-13-cestino-dei-progetti.md`).
//!
//! The X on a project card no longer deletes: it leaves a `.cestino` mark in the
//! project folder, like the archive leaves `.archiviato` (`archivio.rs`). A
//! trashed project is hidden from the list, cannot be opened, and is deleted for
//! good [`RETENTION_DAYS`] days later by [`start`]. Until then it can be restored
//! (an archived project stays archived) or deleted at once with the usual
//! `DELETE`, which stays a real delete because remote deploy uses it on panels.

use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::{
    extract::{Path as UrlPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use tracing::{info, warn};

use crate::router::{AppState, AuthUser};

/// The mark's file name; a dot file, like the other service files of a project.
pub const MARK: &str = ".cestino";

/// How long a project stays in the trash.
pub const RETENTION_DAYS: u64 = 30;
const RETENTION_MS: u64 = RETENTION_DAYS * 24 * 3600 * 1000;

/// When and by whom a project was trashed, and when it goes for good.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct Trashed {
    pub quando_ms: u64,
    #[serde(default)]
    pub da: String,
    /// Computed when read, so the 30 days live in one place only.
    #[serde(default)]
    pub scade_ms: u64,
}

/// The mark of a project folder, if any. An unreadable mark still counts as
/// trashed, dated 0: whoever wrote it wanted the project gone.
pub fn read(dir: &Path) -> Option<Trashed> {
    let text = std::fs::read_to_string(dir.join(MARK)).ok()?;
    let mut t: Trashed = serde_json::from_str(&text).unwrap_or(Trashed {
        quando_ms: 0,
        da: String::new(),
        scade_ms: 0,
    });
    t.scade_ms = t.quando_ms + RETENTION_MS;
    Some(t)
}

pub fn is_trashed(dir: &Path) -> bool {
    dir.join(MARK).exists()
}

async fn trash_or_restore(
    s: &AppState,
    user: Option<&AuthUser>,
    azienda: &str,
    nome: &str,
    to_trash: bool,
) -> Response {
    let _switch = s.project_switch_lock.lock().await;
    let who = user.map(|u| u.username.clone());
    let p = match crate::projects::risolvi_progetto(s, user, azienda, nome).await {
        Ok(p) => p,
        Err(r) => return r,
    };
    if !tokio::fs::metadata(&p.dir)
        .await
        .map(|m| m.is_dir())
        .unwrap_or(false)
    {
        return (StatusCode::NOT_FOUND, "project not found").into_response();
    }
    if !to_trash {
        match tokio::fs::remove_file(p.dir.join(MARK)).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("not restored: {e}"),
                )
                    .into_response()
            }
        }
        s.audit.log(
            "project.untrash",
            who,
            serde_json::json!({ "progetto": p.chiave }),
        );
        return Json(serde_json::json!({ "cestino": null })).into_response();
    }
    if let Ok(active) = crate::router::active_dir(s).await {
        if active == p.dir {
            return (
                StatusCode::CONFLICT,
                "the project is open: close it before trashing it",
            )
                .into_response();
        }
    }
    let mark = Trashed {
        quando_ms: sws_core::now_ms(),
        da: who.clone().unwrap_or_default(),
        scade_ms: 0,
    };
    let text = serde_json::json!({ "quando_ms": mark.quando_ms, "da": mark.da }).to_string();
    if let Err(e) = tokio::fs::write(p.dir.join(MARK), text).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("not trashed: {e}"),
        )
            .into_response();
    }
    s.audit.log(
        "project.trash",
        who,
        serde_json::json!({ "progetto": p.chiave }),
    );
    Json(serde_json::json!({ "cestino": read(&p.dir) })).into_response()
}

/// `POST /api/projects/:azienda/:nome/trash` — the same permissions as deleting.
pub async fn trash(
    State(s): State<AppState>,
    who: Option<Extension<AuthUser>>,
    UrlPath((azienda, nome)): UrlPath<(String, String)>,
) -> Response {
    trash_or_restore(&s, who.as_ref().map(|e| &e.0), &azienda, &nome, true).await
}

/// `POST /api/projects/:azienda/:nome/untrash`
pub async fn untrash(
    State(s): State<AppState>,
    who: Option<Extension<AuthUser>>,
    UrlPath((azienda, nome)): UrlPath<(String, String)>,
) -> Response {
    trash_or_restore(&s, who.as_ref().map(|e| &e.0), &azienda, &nome, false).await
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// The purge, every hour; the first one a few minutes after start, when the
/// process is up. Only where there is a project list (IDE and gateway).
pub fn start(s: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(180)).await;
        let mut t = tokio::time::interval(Duration::from_secs(3600));
        loop {
            t.tick().await;
            purge(&s, now_ms()).await;
        }
    });
}

/// Trashed projects under the projects root: `<root>/<name>` (the implicit
/// company) and `<root>/<company>/<name>`, each with its registry key.
fn trashed_under(root: &Path) -> Vec<(String, PathBuf)> {
    let mut found = Vec::new();
    let Ok(level1) = std::fs::read_dir(root) else {
        return found;
    };
    for e in level1.flatten() {
        let dir = e.path();
        let Some(name) = dir.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };
        if name.starts_with('.') || !dir.is_dir() {
            continue;
        }
        if dir.join("project.yaml").exists() {
            if is_trashed(&dir) {
                let key = crate::project_registry::riferimento(
                    crate::project_registry::AZIENDA_IMPLICITA,
                    &name,
                );
                found.push((key, dir));
            }
            continue;
        }
        let Ok(level2) = std::fs::read_dir(&dir) else {
            continue;
        };
        for p in level2.flatten() {
            let pdir = p.path();
            let Some(pname) = pdir.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if pname.starts_with('.') || !pdir.join("project.yaml").exists() {
                continue;
            }
            if is_trashed(&pdir) {
                found.push((crate::project_registry::riferimento(&name, pname), pdir));
            }
        }
    }
    found
}

/// One purge pass, with the time coming from outside (tests).
pub async fn purge(s: &AppState, now_ms: u64) {
    for (key, dir) in trashed_under(&s.projects_root) {
        let Some(t) = read(&dir) else { continue };
        if t.scade_ms > now_ms {
            continue;
        }
        let _switch = s.project_switch_lock.lock().await;
        if crate::router::active_dir(s).await.ok().as_deref() == Some(dir.as_path()) {
            continue;
        }
        match crate::projects::remove_project_dir(s, &key, &dir).await {
            Ok(()) => {
                info!(progetto = %key, "trashed project deleted after {RETENTION_DAYS} days");
                s.audit.log(
                    "project.purge",
                    None,
                    serde_json::json!({ "progetto": key, "nel_cestino_da_ms": t.quando_ms }),
                );
            }
            Err(e) => warn!(progetto = %key, "trashed project not deleted: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mark_is_read_even_when_damaged() {
        let d = std::env::temp_dir().join(format!("sws-trash-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        assert!(read(&d).is_none() && !is_trashed(&d));
        std::fs::write(d.join(MARK), r#"{"quando_ms":5,"da":"mauro"}"#).unwrap();
        assert_eq!(
            read(&d),
            Some(Trashed {
                quando_ms: 5,
                da: "mauro".into(),
                scade_ms: 5 + RETENTION_MS
            })
        );
        std::fs::write(d.join(MARK), "damaged").unwrap();
        assert!(is_trashed(&d) && read(&d).is_some());
        std::fs::remove_dir_all(&d).ok();
    }

    #[tokio::test]
    async fn the_purge_deletes_only_what_expired() {
        let dir = std::env::temp_dir().join(format!("sws-trash-purge-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let s = crate::router::stato_di_prova(&dir).await;
        let root = s.projects_root.clone();
        let make = |p: PathBuf, trashed_ms: Option<u64>| {
            std::fs::create_dir_all(&p).unwrap();
            std::fs::write(p.join("project.yaml"), "name: x\n").unwrap();
            if let Some(ms) = trashed_ms {
                std::fs::write(p.join(MARK), format!(r#"{{"quando_ms":{ms}}}"#)).unwrap();
            }
            p
        };
        let now = 100 * 24 * 3600 * 1000;
        let old = make(root.join("vecchio"), Some(now - RETENTION_MS - 1));
        let young = make(root.join("acme").join("recente"), Some(now - 1000));
        let old_company = make(root.join("acme").join("scaduto"), Some(0));
        let alive = make(root.join("vivo"), None);
        purge(&s, now).await;
        assert!(!old.exists() && !old_company.exists(), "expired: gone");
        assert!(young.exists(), "not yet 30 days");
        assert!(alive.exists(), "not in the trash");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
