//! Archiviare un progetto (18-10-2026, gruppo 4 del programma delle funzioni
//! utente; seme `2026-10-15-archivio-dei-progetti`).
//!
//! Decisione del maintainer: il progetto **resta al suo posto**, con un segno
//! `.archiviato` nella cartella. Sparisce dall'elenco normale, non si apre per
//! sbaglio (`open_project` rifiuta), non occupa il tetto dei progetti aperti
//! perché non si apre; ma **conta nella quota di spazio**, che misura le cartelle
//! (`spazio_di_azienda`). Storico, backup e git restano intatti, e si ripristina
//! togliendo il segno. Archiviare e ripristinare è da Admin, e finisce nell'audit.

use std::path::Path;

use axum::{
    extract::{Path as UrlPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};

use crate::router::{AppState, AuthUser};

/// Il nome del segno: comincia col punto, come gli altri file di servizio della
/// cartella, così non è mai scambiato per un pezzo del progetto.
pub const SEGNO: &str = ".archiviato";

/// Quando e da chi è stato archiviato.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct Archiviato {
    pub quando_ms: u64,
    #[serde(default)]
    pub da: String,
}

/// Il segno di una cartella di progetto, se c'è. Un segno illeggibile vale
/// comunque «archiviato»: chi l'ha messo voleva il progetto fuori dai piedi.
pub fn leggi(dir: &Path) -> Option<Archiviato> {
    let testo = std::fs::read_to_string(dir.join(SEGNO)).ok()?;
    Some(serde_json::from_str(&testo).unwrap_or(Archiviato { quando_ms: 0, da: String::new() }))
}

pub fn e_archiviato(dir: &Path) -> bool {
    dir.join(SEGNO).exists()
}

async fn archivia_o_ripristina(s: &AppState, user: &AuthUser, azienda: &str, nome: &str, archivia: bool) -> Response {
    let _switch = s.project_switch_lock.lock().await;
    let p = match crate::projects::risolvi_progetto(s, Some(user), azienda, nome).await {
        Ok(p) => p,
        Err(r) => return r,
    };
    if !tokio::fs::metadata(&p.dir).await.map(|m| m.is_dir()).unwrap_or(false) {
        return (StatusCode::NOT_FOUND, "progetto non trovato").into_response();
    }
    if archivia {
        if let Ok(attivo) = crate::router::active_dir(s).await {
            if attivo == p.dir {
                return (StatusCode::CONFLICT, "il progetto è aperto: chiudilo prima di archiviarlo").into_response();
            }
        }
        let segno = Archiviato { quando_ms: sws_core::now_ms(), da: user.username.clone() };
        let testo = serde_json::to_string_pretty(&segno).unwrap_or_default();
        if let Err(e) = tokio::fs::write(p.dir.join(SEGNO), testo).await {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("non archiviato: {e}")).into_response();
        }
        s.audit.log("project.archive", Some(user.username.clone()), serde_json::json!({ "progetto": p.chiave }));
        Json(serde_json::json!({ "archiviato": segno })).into_response()
    } else {
        match tokio::fs::remove_file(p.dir.join(SEGNO)).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("non ripristinato: {e}")).into_response(),
        }
        s.audit.log("project.unarchive", Some(user.username.clone()), serde_json::json!({ "progetto": p.chiave }));
        Json(serde_json::json!({ "archiviato": null })).into_response()
    }
}

/// `POST /api/projects/:azienda/:nome/archive`
pub async fn archivia(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    UrlPath((azienda, nome)): UrlPath<(String, String)>,
) -> Response {
    archivia_o_ripristina(&s, &user, &azienda, &nome, true).await
}

/// `POST /api/projects/:azienda/:nome/unarchive`
pub async fn ripristina(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    UrlPath((azienda, nome)): UrlPath<(String, String)>,
) -> Response {
    archivia_o_ripristina(&s, &user, &azienda, &nome, false).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn il_segno_si_legge_anche_rovinato() {
        let d = std::env::temp_dir().join(format!("sws-archivio-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        assert!(leggi(&d).is_none() && !e_archiviato(&d));
        std::fs::write(d.join(SEGNO), r#"{"quando_ms":5,"da":"mauro"}"#).unwrap();
        assert_eq!(leggi(&d), Some(Archiviato { quando_ms: 5, da: "mauro".into() }));
        std::fs::write(d.join(SEGNO), "rovinato").unwrap();
        assert!(e_archiviato(&d) && leggi(&d).is_some());
        std::fs::remove_dir_all(&d).ok();
    }
}
