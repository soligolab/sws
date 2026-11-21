//! I simboli disegnati nel progetto (`prj:<slug>`), sulle rotte.
//!
//! Piano: `docs/archive/2026-11-03-assistente-genera-simboli-e-sinottici.md` (F2).
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

use std::sync::OnceLock;

use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde_json::{json, Value};
use sws_core::simboli_prj::{self, Descrizione};
use sws_core::Project;

use crate::router::{
    active_dir, patch_project_se, signal_project_changed, versione_attesa, AppState, AuthUser,
};

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
            [
                (header::CONTENT_TYPE, "image/svg+xml"),
                (header::CACHE_CONTROL, "max-age=60"),
            ],
            c.svg,
        )
            .into_response(),
        Err(e) => (StatusCode::UNPROCESSABLE_ENTITY, e.join("\n")).into_response(),
    }
}

/// Una descrizione compilata per chi la guarda: l'SVG e la voce, o perché no.
pub fn esito(v: &Value) -> Value {
    esito_con(v, false)
}

/// [`esito`], optionally with the trace the symbol editor selects with
/// (`data-op` on every drawn element; `simboli_prj::compila_con_traccia`).
pub fn esito_con(v: &Value, trace: bool) -> Value {
    let d: Descrizione = match serde_json::from_value(v.clone()) {
        Ok(d) => d,
        Err(e) => {
            return json!({ "slug": v.get("slug"), "ok": false,
                           "errori": [format!("la descrizione non si legge: {e}")] })
        }
    };
    match simboli_prj::compila_e_controlla(&d) {
        Ok(c) => {
            let svg = if trace {
                simboli_prj::compila_con_traccia(&d)
                    .map(|t| t.svg)
                    .unwrap_or(c.svg)
            } else {
                c.svg
            };
            json!({ "slug": d.slug, "ok": true, "svg": svg, "voce": c.voce, "errori": [] })
        }
        Err(e) => json!({ "slug": d.slug, "ok": false, "errori": e }),
    }
}

/// `POST /api/simboli/compila` — `[descrizione…]` → `[{slug, ok, svg, voce, errori}]`.
/// Non tocca il disco: è quello che usa l'editor per i simboli che ha in
/// memoria (una proposta applicata e non ancora salvata, un annulla).
#[derive(serde::Deserialize, Default)]
pub struct CompileQuery {
    #[serde(default)]
    trace: bool,
}

pub async fn compila(
    Query(q): Query<CompileQuery>,
    Json(descrizioni): Json<Vec<Value>>,
) -> Response {
    if descrizioni.len() > 200 {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            "al più 200 simboli per volta",
        )
            .into_response();
    }
    Json(
        descrizioni
            .iter()
            .map(|v| esito_con(v, q.trace))
            .collect::<Vec<_>>(),
    )
    .into_response()
}

/// The descriptions of the whole library, as `genera.py --descrizioni`
/// writes them (`tests/fixtures/simboli-descrizioni.json`, kept equal to the
/// drawings by `compila_come_genera_py`). Only the runtime carries them: the
/// panel viewer never needs them.
fn library_descriptions() -> &'static [Descrizione] {
    static ALL: OnceLock<Vec<Descrizione>> = OnceLock::new();
    ALL.get_or_init(|| {
        #[derive(serde::Deserialize)]
        struct File {
            simboli: Vec<Descrizione>,
        }
        serde_json::from_str::<File>(include_str!(
            "../../../../tests/fixtures/simboli-descrizioni.json"
        ))
        .map(|f| f.simboli)
        .unwrap_or_default()
    })
}

/// The old builtin alias (`pump`) of a library symbol id, if it has one.
pub fn library_alias(lib_id: &str) -> Option<String> {
    library_descriptions()
        .iter()
        .find(|d| d.id() == lib_id)
        .and_then(|d| d.replaces.clone())
}

/// The library description for a library id, ready to be a variant (tests).
#[cfg(test)]
pub fn library_variant(lib_id: &str) -> Option<Descrizione> {
    library_descriptions()
        .iter()
        .find(|d| d.id() == lib_id)
        .map(as_project_symbol)
}

/// A library symbol turned into a project symbol to edit: no family, no
/// builtin alias, `overrides` pointing at the original, and the few things the
/// library is allowed and a project symbol is not made right (`regole`: a shape
/// a few tenths outside the drawing, two lamps with the same id).
pub fn as_project_symbol(lib: &Descrizione) -> Descrizione {
    let mut d = lib.clone();
    d.overrides = Some(lib.id());
    d.family = None;
    d.replaces = None;
    let (w, h) = (d.w as f64, d.h as f64);
    let mut seen: Vec<String> = Vec::new();
    for op in d.ops.iter_mut() {
        // A rectangle past the edge (the feet of the magnetic flowmeter, two
        // units below its 60): the drawing clips it anyway, so cutting it at
        // the edge changes nothing on screen.
        if let simboli_prj::Op::Forma { tag, geo, .. } = op {
            if tag == "rect" {
                clamp_rect(&mut geo.0, w, h);
            }
        }
        if let simboli_prj::Op::Parte { id, .. } = op {
            let mut nuovo = id.clone();
            let mut n = 2;
            while seen.contains(&nuovo) {
                nuovo = format!("{id}-{n}");
                n += 1;
            }
            *id = nuovo.clone();
            seen.push(nuovo);
        }
    }
    d
}

fn clamp_rect(geo: &mut [(String, simboli_prj::Valore)], w: f64, h: f64) {
    use simboli_prj::Valore::Num;
    let get = |geo: &[(String, simboli_prj::Valore)], k: &str| {
        geo.iter().find_map(|(n, v)| match v {
            Num(x) if n == k => Some(*x),
            _ => None,
        })
    };
    let (Some(x), Some(y), Some(rw), Some(rh)) = (
        get(geo, "x"),
        get(geo, "y"),
        get(geo, "width"),
        get(geo, "height"),
    ) else {
        return;
    };
    let (x0, y0) = (x.max(0.0), y.max(0.0));
    let (x1, y1) = ((x + rw).min(w), (y + rh).min(h));
    if x1 <= x0 || y1 <= y0 {
        return;
    }
    for (n, v) in geo.iter_mut() {
        match n.as_str() {
            "x" => *v = Num(x0),
            "y" => *v = Num(y0),
            "width" => *v = Num(x1 - x0),
            "height" => *v = Num(y1 - y0),
            _ => {}
        }
    }
}

/// `GET /api/symbols/library/:family/:slug` — the description of a library
/// symbol, ready to be edited as a project variant.
pub async fn library_description(Path((family, slug)): Path<(String, String)>) -> Response {
    match library_descriptions()
        .iter()
        .find(|d| d.family.as_deref() == Some(family.as_str()) && d.slug == slug)
    {
        Some(d) => Json(as_project_symbol(d)).into_response(),
        None => (StatusCode::NOT_FOUND, "library symbol not found").into_response(),
    }
}

/// `POST /api/symbols/explicit-ports` — the description with its pipe ports
/// written out as `bocca` operations with the ids the compiler gave them
/// (`simboli_prj::explicit_ports`). The symbol editor asks for it when it
/// opens a symbol, so the ports can be moved one by one without renaming the
/// others, and the pipes already attached stay attached.
pub async fn explicit_ports(Json(v): Json<Value>) -> Response {
    let d: Descrizione = match serde_json::from_value(v) {
        Ok(d) => d,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("descrizione non valida: {e}"),
            )
                .into_response()
        }
    };
    match simboli_prj::explicit_ports(&d) {
        Ok(e) => Json(e).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

/// The model of the «Simboli» purpose for this user, and the HTTP client to
/// reach it: an address the customer chose gets its own, guarded client.
async fn symbol_model(
    s: &AppState,
    user: &AuthUser,
) -> Result<(Option<crate::ai::client::Scelta>, reqwest::Client), Response> {
    purpose_model(s, user, crate::ai::scopi::Scopo::Simboli).await
}

/// [`symbol_model`] for any text purpose: the AI on the fields uses it too.
pub(crate) async fn purpose_model(
    s: &AppState,
    user: &AuthUser,
    purpose: crate::ai::scopi::Scopo,
) -> Result<(Option<crate::ai::client::Scelta>, reqwest::Client), Response> {
    use crate::ai::{local_http, scopi, user_keys};
    if !s.ide_only {
        return Err((
            StatusCode::NOT_FOUND,
            "the AI on symbols and fields runs on the IDE instance only",
        )
            .into_response());
    }
    let keys = user_keys::fetch_all(s, &user.username).await;
    let choice = scopi::carica_per_con(&s.config_dir, purpose, &keys);
    let base = || {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(local_http::REQUEST_TIMEOUT)
    };
    let http = match &choice {
        Some(sc) if sc.endpoint.is_some() => match local_http::client_for(sc, s.in_cloud(), base())
        {
            Ok(c) => c,
            Err(e) => {
                return Err(
                    Json(json!({ "ok": false, "code": "provider", "message": e })).into_response(),
                )
            }
        },
        _ => base().build().unwrap_or_default(),
    };
    Ok((choice, http))
}

/// `POST /api/symbols/ai` — the AI tab of the symbol editor: the model of the
/// «Simboli» purpose draws a symbol, new or changed from the open one, also
/// from a photo (`ai::symbol_draw::editor`). Nothing is saved: the editor
/// shows the proposal, and «Accetta» makes it a step of its history. IDE only,
/// like the translation: drawing is design, and a panel in the field is often
/// without Internet.
pub async fn ai(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<crate::ai::symbol_draw::EditorRequest>,
) -> Response {
    match symbol_model(&s, &user).await {
        Ok((choice, http)) => {
            Json(crate::ai::symbol_draw::editor(&s, choice, &http, req).await).into_response()
        }
        Err(r) => r,
    }
}

/// `POST /api/symbols/ai/interview` — before the drawing, the model asks what
/// the request leaves open, then writes the brief the drawing starts from
/// (`symbol_draw::interview`). IDE only, like `ai`.
pub async fn ai_interview(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<crate::ai::symbol_draw::InterviewRequest>,
) -> Response {
    match symbol_model(&s, &user).await {
        Ok((choice, http)) => {
            Json(crate::ai::symbol_draw::interview(&s, choice, &http, req).await).into_response()
        }
        Err(r) => r,
    }
}

/// What «Genera foto» asks (plan `2026-11-21-simboli-fase-3-foto`): what to
/// photograph, and the size of the symbol, whose proportions the photo takes.
#[derive(serde::Deserialize)]
pub struct PhotoRequest {
    pub description: String,
    pub w: u32,
    pub h: u32,
}

/// The long side asked to the provider: a symbol is at most 512 units, and a
/// photo twice as large stays sharp on a panel that enlarges it.
const PHOTO_SIDE: u32 = 1024;

/// The size of the photo for a symbol `w × h`: its proportions, the long side
/// [`PHOTO_SIDE`].
pub fn photo_size(w: u32, h: u32) -> (u32, u32) {
    let (w, h) = (w.max(1) as f64, h.max(1) as f64);
    let k = PHOTO_SIDE as f64 / w.max(h);
    (((w * k).round() as u32).max(64), ((h * k).round() as u32).max(64))
}

/// The name of a generated photo: from its content, so the same bytes are
/// one file.
pub fn photo_name(bytes: &[u8], ext: &str) -> String {
    use sha2::{Digest, Sha256};
    let hex: String = Sha256::digest(bytes)
        .iter()
        .take(6)
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("ai-photo-{hex}.{ext}")
}

/// `POST /api/symbols/ai/photo` — «Genera foto» in the symbol editor: the
/// image model of the «Sfondi» purpose photographs one object, and the photo
/// is saved at once in the project's `images/` (it was paid for). IDE only,
/// like the rest of the AI on symbols.
pub async fn ai_photo(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<PhotoRequest>,
) -> Response {
    use crate::ai::{bfl, scopi, strumenti_scopi, user_keys};
    if !s.ide_only {
        return (StatusCode::NOT_FOUND, "the AI on symbols runs on the IDE instance only")
            .into_response();
    }
    let description = req.description.trim();
    if description.is_empty() || description.chars().count() > 2000 {
        return Json(json!({ "ok": false, "code": "bad_request" })).into_response();
    }
    let keys = user_keys::fetch_all(&s, &user.username).await;
    let Some(sc) = scopi::carica_sfondi_con(&s.config_dir, &keys) else {
        return Json(json!({ "ok": false, "code": "no_model" })).into_response();
    };
    let http = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(240))
        .build()
        .unwrap_or_default();
    let size = photo_size(req.w, req.h);
    let (bytes, cost) = match strumenti_scopi::symbol_photo(
        &s,
        &sc,
        &http,
        &bfl::Endpoint::default(),
        description,
        size,
    )
    .await
    {
        Ok(x) => x,
        Err(message) => {
            return Json(json!({ "ok": false, "code": "provider", "message": message }))
                .into_response()
        }
    };
    let ext = match image::guess_format(&bytes) {
        Ok(image::ImageFormat::Png) => "png",
        Ok(image::ImageFormat::Jpeg) => "jpg",
        Ok(image::ImageFormat::WebP) => "webp",
        _ => {
            return Json(json!({ "ok": false, "code": "provider", "message": "not an image" }))
                .into_response()
        }
    };
    let (width, height) = image::load_from_memory(&bytes)
        .map(|i| (i.width(), i.height()))
        .unwrap_or(size);
    let dir = match active_dir(&s).await {
        Ok(d) => crate::router::images_dir_at(&d),
        Err(c) => return c.into_response(),
    };
    let name = photo_name(&bytes, ext);
    let written = tokio::task::spawn_blocking({
        let path = dir.join(&name);
        move || std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(path, &bytes))
    })
    .await;
    if !matches!(written, Ok(Ok(()))) {
        return (StatusCode::INTERNAL_SERVER_ERROR, "the photo could not be saved").into_response();
    }
    Json(json!({
        "ok": true, "name": name, "width": width, "height": height, "cost_usd": cost,
        "transparent": ext == "png",
    }))
    .into_response()
}

/// `POST /api/ai/field` — the AI on one IDE field (plan
/// `docs/plans/2026-11-20-ia-sui-campi.md`): the model of the `fields` purpose
/// proposes the field's value and its neighbours', or asks one question.
/// Nothing is saved. IDE only, like the AI on symbols.
pub async fn ai_field(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<crate::ai::field_assist::FieldRequest>,
) -> Response {
    match purpose_model(&s, &user, crate::ai::scopi::Scopo::Fields).await {
        Ok((choice, http)) => {
            Json(crate::ai::field_assist::assist(&s, choice, &http, req).await).into_response()
        }
        Err(r) => r,
    }
}

/// `GET /api/symbols/catalog` — what a description may use, for the symbol
/// editor: materials with their colours, veils, shapes, part kinds, limits.
/// The tables are the compiler's own (`simboli_prj`), so they cannot drift.
pub async fn catalog() -> Response {
    let materials: Vec<Value> = simboli_prj::MATERIALI
        .iter()
        .map(|(n, c)| json!({ "name": n, "color": c }))
        .collect();
    let veils: Vec<Value> = simboli_prj::VELI
        .iter()
        .map(|v| json!({ "name": v.nome, "type": v.tipo }))
        .collect();
    Json(json!({
        "materials": materials,
        "veils": veils,
        "shapes": simboli_prj::FORME,
        "part_kinds": simboli_prj::TIPI_PARTE,
        "max_ops": simboli_prj::MAX_OPERAZIONI,
        "max_side": simboli_prj::MAX_LATO,
    }))
    .into_response()
}

/// I problemi di un elenco di simboli: ognuno deve compilare, e gli slug sono unici.
pub fn problemi(simboli: &[Descrizione]) -> Vec<String> {
    let mut male = Vec::new();
    for (i, d) in simboli.iter().enumerate() {
        if d.family.is_some() {
            male.push(format!(
                "{}: un simbolo del progetto non ha famiglia",
                d.slug
            ));
        }
        if simboli[..i].iter().any(|x| x.slug == d.slug) {
            male.push(format!("{}: slug ripetuto", d.slug));
        }
        if d.overrides.is_some() && simboli[..i].iter().any(|x| x.overrides == d.overrides) {
            male.push(format!(
                "{}: a second variant of {}",
                d.slug,
                d.overrides.as_deref().unwrap_or("")
            ));
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
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": male.join("\n"), "errori": male })),
        )
            .into_response();
    }
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let n = simboli.len();
    let res = patch_project_se(
        &s.project_write_lock,
        &dir,
        versione_attesa(&headers),
        |p| p.simboli = simboli,
    )
    .await;
    if res.status() == StatusCode::NO_CONTENT {
        s.audit.log(
            "project.change",
            Some(user.username),
            json!({ "what": "simboli", "n": n }),
        );
        // I viewer aperti devono rileggere il manifesto dei simboli.
        signal_project_changed(&s, "simboli");
    }
    res
}

#[cfg(test)]
mod photo_tests {
    use super::*;

    #[test]
    fn a_photo_takes_the_proportions_of_its_symbol() {
        assert_eq!(photo_size(100, 120), (853, 1024));
        assert_eq!(photo_size(200, 100), (1024, 512));
        assert_eq!(photo_size(512, 10), (1024, 64), "never thinner than 64");
        let n = photo_name(b"abc", "png");
        assert!(sws_core::simboli_prj::image_name_ok(&n), "{n}");
        assert_eq!(n, photo_name(b"abc", "png"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gabbia() -> Descrizione {
        serde_json::from_str(include_str!(
            "../../../../tests/fixtures/simboli-prj/gabbia-laminazione.json"
        ))
        .unwrap()
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

    /// Every library symbol becomes a project symbol that compiles and passes
    /// the stricter rules of the project: «duplicate from the library» never
    /// starts from a broken drawing.
    #[test]
    fn every_library_symbol_becomes_a_valid_variant() {
        let all = library_descriptions();
        assert!(all.len() >= 190, "{}", all.len());
        let mut bad = Vec::new();
        for d in all {
            let v = as_project_symbol(d);
            assert_eq!(v.overrides.as_deref(), Some(d.id().as_str()));
            if let Err(e) = simboli_prj::compila_e_controlla(&v) {
                bad.push(format!("{}: {e:?}", d.slug));
            }
        }
        assert!(bad.is_empty(), "{bad:#?}");
    }

    /// A library symbol opened in the editor: variant first, then explicit
    /// ports. It must still be a valid project symbol, with the library's ports.
    #[test]
    fn every_library_variant_with_explicit_ports_is_valid() {
        for lib in library_descriptions() {
            let v = as_project_symbol(lib);
            let e = simboli_prj::explicit_ports(&v).unwrap();
            let before = simboli_prj::compila(&v).unwrap();
            let c = simboli_prj::compila_e_controlla(&e)
                .unwrap_or_else(|err| panic!("{}: {err:?}", lib.slug));
            assert_eq!(
                before.voce.get("ports"),
                c.voce.get("ports"),
                "{}",
                lib.slug
            );
        }
    }

    #[test]
    fn the_trace_marks_every_drawn_element_with_its_operation() {
        let d = gabbia();
        let e = esito_con(&serde_json::to_value(&d).unwrap(), true);
        let svg = e["svg"].as_str().unwrap();
        assert!(svg.contains("data-op=\"0\""), "{svg}");
        // Without the trace, the bytes of the saved drawing.
        let e = esito(&serde_json::to_value(&d).unwrap());
        assert!(!e["svg"].as_str().unwrap().contains("data-op"));
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
