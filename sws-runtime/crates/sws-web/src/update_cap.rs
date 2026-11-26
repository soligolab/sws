//! The version cap set by the platform (26-11-2026, plan
//! `docs/plans/2026-11-26-versione-fissata-e-blocco.md`).
//!
//! The platform administrator sets a **ceiling** for a panel from the
//! gateway console: «not above 2.31.0». The cap never updates and never
//! restarts anything. It only says how high the panel can go: «available»
//! does not go above it, «Update now», the window and the autopilot refuse a
//! channel head above it, a channel switch waits, and a pinned version cannot
//! go above it. A panel already above the cap stays where it is.
//!
//! Only the gateway writes it, through the tunnel, with its signature
//! (`POST /api/update/cap`, like `schermo::dal_gateway`): without the
//! signature the route does not exist (404).

use crate::aggiornamento::Versione;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// The cap, in the config folder.
pub const FILE: &str = "update_cap.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Cap {
    /// The highest version the panel can go to.
    pub max: String,
    /// Who set it on the platform, if the gateway said so.
    #[serde(default)]
    pub by: Option<String>,
    pub since_ms: i64,
}

/// The cap in `config_dir`, if there is one that can be read.
pub async fn read(config_dir: &Path) -> Option<Cap> {
    let text = tokio::fs::read_to_string(config_dir.join(FILE))
        .await
        .ok()?;
    let cap = serde_json::from_str::<Cap>(&text).ok()?;
    Versione::leggi(&cap.max).is_some().then_some(cap)
}

/// The cap as a version.
pub async fn read_max(config_dir: &Path) -> Option<Versione> {
    read(config_dir).await.and_then(|c| Versione::leggi(&c.max))
}

/// The cap of this runtime, from the config folder of the process.
pub async fn current() -> Option<Versione> {
    let dir = crate::istantanea_dati::config_dir()?;
    read_max(&dir).await
}

/// Writes the cap (atomic: a temporary file, then a rename).
pub async fn write(config_dir: &Path, cap: &Cap) -> Result<(), String> {
    let text = serde_json::to_string_pretty(cap).map_err(|e| e.to_string())?;
    let tmp = config_dir.join(format!("{FILE}.tmp"));
    tokio::fs::write(&tmp, text)
        .await
        .map_err(|e| format!("{}: {e}", tmp.display()))?;
    tokio::fs::rename(&tmp, config_dir.join(FILE))
        .await
        .map_err(|e| format!("{FILE}: {e}"))
}

/// Removes the cap.
pub async fn clear(config_dir: &Path) {
    let _ = tokio::fs::remove_file(config_dir.join(FILE)).await;
}

/// The cap lets the panel go to `v`. No cap: every version.
pub fn allows(cap: Option<&Versione>, v: &Versione) -> bool {
    cap.is_none_or(|c| v <= c)
}

/// The text of a refusal because of the cap (shown in the IDE).
pub fn refusal(version: &str, cap: &Versione) -> String {
    format!(
        "La {version} è oltre il blocco di versione della piattaforma (al massimo la {}): \
         l'aggiornamento non parte.",
        crate::aggiornamento::formatta(cap)
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapBody {
    /// `None` removes the cap.
    max: Option<String>,
    /// Who set it on the platform.
    #[serde(default)]
    by: Option<String>,
}

/// `POST /api/update/cap` — the cap sent by the gateway. Without the
/// gateway's signature: 404, as for a route that does not exist. The same cap
/// again (the gateway sends it at every tunnel open) changes nothing and
/// writes no audit line.
pub async fn from_gateway(
    State(s): State<crate::router::AppState>,
    headers: HeaderMap,
    Json(b): Json<CapBody>,
) -> Response {
    if !s.abbinamento.firma_valida(&headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    apply(&s, b).await
}

async fn apply(s: &crate::router::AppState, b: CapBody) -> Response {
    let dir = s.config_dir.as_ref();
    let previous = read(dir).await;
    match b.max.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        None => {
            if previous.is_none() {
                return StatusCode::NO_CONTENT.into_response();
            }
            clear(dir).await;
            s.audit.log(
                "update.cap",
                b.by.clone(),
                serde_json::json!({ "max": null, "was": previous.map(|p| p.max) }),
            );
            tracing::info!("version cap removed by the platform");
            StatusCode::NO_CONTENT.into_response()
        }
        Some(max) => {
            let Some(v) = Versione::leggi(max) else {
                return (StatusCode::BAD_REQUEST, "versione non valida").into_response();
            };
            let max = crate::aggiornamento::formatta(&v);
            if previous.as_ref().is_some_and(|p| p.max == max) {
                return StatusCode::NO_CONTENT.into_response();
            }
            let cap = Cap {
                max: max.clone(),
                by: b.by.clone(),
                since_ms: chrono::Utc::now().timestamp_millis(),
            };
            if let Err(e) = write(dir, &cap).await {
                return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response();
            }
            s.audit.log(
                "update.cap",
                b.by.clone(),
                serde_json::json!({ "max": max, "was": previous.map(|p| p.max) }),
            );
            tracing::info!(%max, "version cap set by the platform");
            StatusCode::NO_CONTENT.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Versione {
        Versione::leggi(s).unwrap()
    }

    #[test]
    fn the_cap_lets_through_only_what_is_not_above_it() {
        let cap = v("2.31.0");
        assert!(allows(None, &v("9.0.0")));
        assert!(allows(Some(&cap), &v("2.31.0")));
        assert!(allows(Some(&cap), &v("2.31.0-rc.4")));
        assert!(!allows(Some(&cap), &v("2.31.1-dev.1")));
        assert!(!allows(Some(&cap), &v("2.32.0")));
    }

    #[tokio::test]
    async fn the_cap_file_is_written_read_and_removed() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(dir.path()).await, None);
        let cap = Cap {
            max: "2.31.0".into(),
            by: Some("admin".into()),
            since_ms: 1,
        };
        write(dir.path(), &cap).await.unwrap();
        assert_eq!(read(dir.path()).await, Some(cap));
        assert_eq!(read_max(dir.path()).await, Some(v("2.31.0")));
        clear(dir.path()).await;
        assert_eq!(read_max(dir.path()).await, None);
        // A file with a version that cannot be read is no cap.
        tokio::fs::write(dir.path().join(FILE), r#"{"max":"latest","since_ms":1}"#)
            .await
            .unwrap();
        assert_eq!(read(dir.path()).await, None);
    }

    #[tokio::test]
    async fn without_the_gateway_signature_the_route_does_not_exist() {
        let dir = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(dir.path()).await;
        let body = CapBody {
            max: Some("2.31.0".into()),
            by: None,
        };
        let r = from_gateway(State(s.clone()), HeaderMap::new(), Json(body)).await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
        assert_eq!(read(dir.path()).await, None, "nothing is written");
        // A wrong signature is the same.
        let mut h = HeaderMap::new();
        h.insert(
            crate::abbinamento::INTESTAZIONE_GATEWAY,
            "0000".parse().unwrap(),
        );
        let body = CapBody {
            max: Some("2.31.0".into()),
            by: None,
        };
        let r = from_gateway(State(s), h, Json(body)).await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn the_cap_is_set_once_and_removed_with_null() {
        let dir = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(dir.path()).await;
        let r = apply(
            &s,
            CapBody {
                max: Some("2.31.0".into()),
                by: Some("admin".into()),
            },
        )
        .await;
        assert_eq!(r.status(), StatusCode::NO_CONTENT);
        assert_eq!(read_max(dir.path()).await, Some(v("2.31.0")));
        let r = apply(
            &s,
            CapBody {
                max: Some("latest".into()),
                by: None,
            },
        )
        .await;
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        assert_eq!(read_max(dir.path()).await, Some(v("2.31.0")));
        let r = apply(
            &s,
            CapBody {
                max: None,
                by: None,
            },
        )
        .await;
        assert_eq!(r.status(), StatusCode::NO_CONTENT);
        assert_eq!(read(dir.path()).await, None);
    }
}
