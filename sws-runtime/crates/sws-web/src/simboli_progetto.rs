//! I simboli disegnati nel progetto (`prj:<slug>`), sulle rotte.
//!
//! Piano: `docs/plans/2026-11-03-assistente-genera-simboli-e-sinottici.md` (F2).
//!
//! Il progetto tiene solo le **descrizioni** (`Project.simboli`); SVG e manifesto
//! si compilano a ogni richiesta con `sws_core::simboli_prj`, e hanno la stessa
//! forma della libreria (`/symbols/lib/manifest.json`, `/symbols/lib/<file>`):
//! così i due motori li leggono con lo stesso codice, scegliendo l'indirizzo dal
//! prefisso dell'id.
//!
//! - `GET  /api/project/simboli/manifest.json` — il manifesto, anche al viewer;
//! - `GET  /api/project/simboli/<slug>.svg` — il disegno, anche al viewer
//!   (una rotta sola, [`file`], per non far litigare un segmento fisso e uno
//!   variabile sullo stesso livello);
//! - `POST /api/simboli/compila` — compila senza salvare (anteprima, undo);
//! - `PUT  /api/project/simboli` — l'elenco intero, con la versione Q30.

use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde_json::{json, Value};
use sws_core::simboli_prj::{self, Descrizione};
use sws_core::Project;

use crate::router::{active_dir, patch_project_se, signal_project_changed, versione_attesa, AppState, AuthUser};

async fn simboli_su_disco(s: &AppState) -> Result<Vec<Descrizione>, Response> {
    let dir = active_dir(s).await.map_err(IntoResponse::into_response)?;
    let p = tokio::task::spawn_blocking(move || Project::load(&dir))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}")).into_response())?;
    Ok(p.simboli)
}

/// `GET /api/project/simboli/:file` — il manifesto o un disegno.
pub async fn file(state: State<AppState>, Path(file): Path<String>) -> Response {
    if file == "manifest.json" {
        manifesto(state).await
    } else {
        svg(state, file).await
    }
}

/// `GET /api/project/simboli/manifest.json` da sola, per la porta di gestione
/// del pannello: lì serve solo a dire al deploy che la funzione c'è.
pub async fn solo_manifesto(state: State<AppState>) -> Response {
    manifesto(state).await
}

async fn manifesto(State(s): State<AppState>) -> Response {
    let simboli = match simboli_su_disco(&s).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let (m, _) = simboli_prj::manifesto(&simboli);
    // Il manifesto cambia quando cambia un disegno: niente cache, i file invece
    // portano `?v=` e possono restare.
    ([(header::CACHE_CONTROL, "no-cache")], Json(m)).into_response()
}

async fn svg(State(s): State<AppState>, file: String) -> Response {
    let Some(slug) = file.strip_suffix(".svg") else {
        return (StatusCode::BAD_REQUEST, "si servono solo file .svg").into_response();
    };
    let simboli = match simboli_su_disco(&s).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(d) = simboli.iter().find(|d| d.slug == slug) else {
        return (StatusCode::NOT_FOUND, "simbolo del progetto non trovato").into_response();
    };
    match simboli_prj::compila_e_controlla(d) {
        Ok(c) => (
            [(header::CONTENT_TYPE, "image/svg+xml"), (header::CACHE_CONTROL, "max-age=60")],
            c.svg,
        )
            .into_response(),
        Err(e) => (StatusCode::UNPROCESSABLE_ENTITY, e.join("\n")).into_response(),
    }
}

/// Una descrizione compilata per chi la guarda: l'SVG e la voce, o perché no.
pub fn esito(v: &Value) -> Value {
    let d: Descrizione = match serde_json::from_value(v.clone()) {
        Ok(d) => d,
        Err(e) => {
            return json!({ "slug": v.get("slug"), "ok": false,
                           "errori": [format!("la descrizione non si legge: {e}")] })
        }
    };
    match simboli_prj::compila_e_controlla(&d) {
        Ok(c) => json!({ "slug": d.slug, "ok": true, "svg": c.svg, "voce": c.voce, "errori": [] }),
        Err(e) => json!({ "slug": d.slug, "ok": false, "errori": e }),
    }
}

/// `POST /api/simboli/compila` — `[descrizione…]` → `[{slug, ok, svg, voce, errori}]`.
/// Non tocca il disco: è quello che usa l'editor per i simboli che ha in
/// memoria (una proposta applicata e non ancora salvata, un annulla).
pub async fn compila(Json(descrizioni): Json<Vec<Value>>) -> Response {
    if descrizioni.len() > 200 {
        return (StatusCode::PAYLOAD_TOO_LARGE, "al più 200 simboli per volta").into_response();
    }
    Json(descrizioni.iter().map(esito).collect::<Vec<_>>()).into_response()
}

/// I problemi di un elenco di simboli: ognuno deve compilare, e gli slug sono unici.
pub fn problemi(simboli: &[Descrizione]) -> Vec<String> {
    let mut male = Vec::new();
    for (i, d) in simboli.iter().enumerate() {
        if d.family.is_some() {
            male.push(format!("{}: un simbolo del progetto non ha famiglia", d.slug));
        }
        if simboli[..i].iter().any(|x| x.slug == d.slug) {
            male.push(format!("{}: slug ripetuto", d.slug));
        }
        if let Err(e) = simboli_prj::compila_e_controlla(d) {
            male.extend(e.into_iter().map(|m| format!("{}: {m}", d.slug)));
        }
    }
    male
}

/// `PUT /api/project/simboli` — l'elenco intero. Un simbolo che non compila è un
/// 400: meglio dirlo qui che scoprire un segnaposto sul pannello.
pub async fn salva(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    headers: axum::http::HeaderMap,
    Json(simboli): Json<Vec<Descrizione>>,
) -> Response {
    let male = problemi(&simboli);
    if !male.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": male.join("\n"), "errori": male }))).into_response();
    }
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let n = simboli.len();
    let res = patch_project_se(&s.project_write_lock, &dir, versione_attesa(&headers), |p| p.simboli = simboli).await;
    if res.status() == StatusCode::NO_CONTENT {
        s.audit.log("project.change", Some(user.username), json!({ "what": "simboli", "n": n }));
        // I viewer aperti devono rileggere il manifesto dei simboli.
        signal_project_changed(&s, "simboli");
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gabbia() -> Descrizione {
        serde_json::from_str(include_str!("../../../../tests/fixtures/simboli-prj/gabbia-laminazione.json")).unwrap()
    }

    #[test]
    fn un_elenco_buono_passa_e_i_doppioni_no() {
        assert!(problemi(&[gabbia()]).is_empty());
        let male = problemi(&[gabbia(), gabbia()]);
        assert!(male.iter().any(|m| m.contains("ripetuto")), "{male:?}");
        // Una famiglia la dà solo la libreria: un `lib:` scritto nel progetto
        // si confonderebbe con quelli veri.
        let mut finta = gabbia();
        finta.family = Some("process".into());
        assert!(!problemi(&[finta]).is_empty());
    }

    #[test]
    fn l_esito_dice_perche_non_compila() {
        let mut v = serde_json::to_value(gabbia()).unwrap();
        v["body"] = json!("oro");
        let e = esito(&v);
        assert_eq!(e["ok"], false);
        assert!(e["errori"][0].as_str().unwrap().contains("oro"), "{e}");
        let e = esito(&json!({ "slug": "x" }));
        assert_eq!(e["ok"], false);
        let e = esito(&serde_json::to_value(gabbia()).unwrap());
        assert_eq!(e["ok"], true);
        assert!(e["svg"].as_str().unwrap().starts_with("<svg"));
        assert_eq!(e["voce"]["id"], "prj:gabbia-laminazione");
    }
}
