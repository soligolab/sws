//! Le planimetrie del progetto (29-10-2026, ramo 1 del piano
//! `docs/archive/2026-10-25-planimetrie-3d.md`).
//!
//! Una planimetria è una pianta disegnata nell'IDE — muri, aperture, aree,
//! blocchi — da cui l'IDE genera **una volta** l'immagine 3D che diventa lo
//! sfondo di una pagina. Il server la **archivia e non la interpreta**: la
//! struttura vive in TypeScript (`src/planimetrie/modello.ts`), qui ci sono solo
//! `id` e `nome` più il resto così com'è, come il passthrough di `FaceplateDef`.
//! Né il viewer web né quello LVGL sanno che esistono: consumano il PNG.
//!
//! Le rotte ricalcano le cornici: `planimetrie/<id>.yaml` nel progetto,
//! versione Q30 sull'intestazione, scrittura atomica.

use std::collections::BTreeMap;
use std::path::{Path as FsPath, PathBuf};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::router::{active_dir, con_versione, conflitto_di_versione, scrivi_atomico, signal_project_changed, versione_attesa, AppState};
use crate::synoptic::safe_filename;

/// Il nome della cartella dentro il progetto.
pub const CARTELLA: &str = "planimetrie";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Planimetria {
    pub id: String,
    #[serde(default)]
    pub nome: String,
    /// Muri, aperture, aree, blocchi, camera… — tutto quello che l'IDE ci mette.
    #[serde(flatten)]
    pub resto: BTreeMap<String, serde_yaml::Value>,
}

pub fn cartella_di(project_dir: &FsPath) -> PathBuf {
    project_dir.join(CARTELLA)
}

fn percorso(project_dir: &FsPath, id: &str) -> PathBuf {
    cartella_di(project_dir).join(format!("{}.yaml", safe_filename(id)))
}

/// `GET /api/planimetrie` — `[{id, nome}]`, in ordine di id.
pub async fn elenco(State(s): State<AppState>) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let mut out = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(cartella_di(&dir)).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            let Ok(text) = tokio::fs::read_to_string(&p).await else { continue };
            match serde_yaml::from_str::<Planimetria>(&text) {
                Ok(pl) => out.push(serde_json::json!({ "id": pl.id, "nome": pl.nome })),
                Err(e) => warn!("planimetria {} illeggibile: {e}", p.display()),
            }
        }
    }
    out.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    Json(out).into_response()
}

/// `GET /api/planimetrie/:id`
pub async fn leggi(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let Ok(text) = tokio::fs::read_to_string(percorso(&dir, &id)).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match serde_yaml::from_str::<Planimetria>(&text) {
        Ok(pl) => con_versione(Json(pl).into_response(), &text),
        Err(e) => {
            warn!("planimetria {id} illeggibile: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// `PUT /api/planimetrie/:id`
pub async fn scrivi(
    State(s): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(mut pl): Json<Planimetria>,
) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    if let Err(e) = tokio::fs::create_dir_all(cartella_di(&dir)).await {
        warn!("cannot create planimetrie dir: {e}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    pl.id = id.clone();
    let path = percorso(&dir, &id);
    let su_disco = tokio::fs::read_to_string(&path).await.ok();
    if let Some(r) = conflitto_di_versione(versione_attesa(&headers).as_deref(), su_disco.as_deref(), "Questa planimetria") {
        return r;
    }
    let yaml = match serde_yaml::to_string(&pl) {
        Ok(y) => y,
        Err(e) => {
            warn!("cannot serialize planimetria {id}: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    match scrivi_atomico(&path, yaml.as_bytes()).await {
        Ok(()) => {
            // Un IDE su un'altra macchina deve vederla cambiare (impronta).
            signal_project_changed(&s, "planimetria");
            con_versione(StatusCode::NO_CONTENT.into_response(), &yaml)
        }
        Err(e) => {
            warn!("cannot write planimetria {id}: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// `DELETE /api/planimetrie/:id` — l'immagine generata in `images/` resta: può
/// essere lo sfondo di una pagina, e toglierla lascerebbe la pagina senza.
pub async fn elimina(State(s): State<AppState>, Path(id): Path<String>) -> StatusCode {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c,
    };
    match tokio::fs::remove_file(percorso(&dir, &id)).await {
        Ok(()) => {
            signal_project_changed(&s, "planimetria");
            StatusCode::NO_CONTENT
        }
        Err(_) => StatusCode::NOT_FOUND,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Il server non interpreta: quello che l'IDE manda torna uguale, e il
    /// YAML resta leggibile a mano.
    #[test]
    fn il_resto_attraversa_yaml_e_json_senza_perdere_niente() {
        let json = serde_json::json!({
            "id": "casa-pt",
            "nome": "Casa — piano terra",
            "unita_px_m": 50,
            "muri": [{ "id": "m1", "punti": [[0, 0], [10, 0]], "spessore": 0.2, "altezza": 2.7 }],
            "aperture": [{ "id": "a1", "muro": "m1", "t": 0.3, "larghezza": 0.9, "tipo": "porta" }],
            "camera": { "pos": [12, 9, 10], "target": [5, 0, 4], "fov": 45 },
        });
        let pl: Planimetria = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(pl.nome, "Casa — piano terra");
        let yaml = serde_yaml::to_string(&pl).unwrap();
        assert!(yaml.contains("muri:"), "il YAML porta i muri in chiaro:\n{yaml}");
        let di_nuovo: Planimetria = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(di_nuovo, pl);
        assert_eq!(serde_json::to_value(&di_nuovo).unwrap(), json);
    }

    #[test]
    fn un_nome_che_manca_non_e_un_errore() {
        let pl: Planimetria = serde_yaml::from_str("id: x\n").unwrap();
        assert_eq!(pl.nome, "");
        assert!(pl.resto.is_empty());
    }
}
