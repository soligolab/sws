//! The company's symbol library (plan
//! `docs/plans/2026-11-21-simboli-fase-7-libreria-aziendale.md`).
//!
//! Symbols drawn once and used in every project of a company: a pump in the
//! company's style, a variant of a SWS library symbol. Decisions of the
//! maintainer (21-11-2026): the library belongs to the **company** (whoever
//! signs up alone has a personal one; the local IDE has the implicit one),
//! **every member** writes, a symbol used is **copied** into the project — the
//! panel never depends on the library — and the IDE says when the library has
//! a newer version.
//!
//! On disk, next to the company's projects, in the folder that is already
//! hidden from the list of projects:
//! `<projects root>/<company folder>/.ambiente/symbols/<slug>/symbol.json`
//! (the envelope of a `.swsym` file) and `images/<name>` for its photos.
//!
//! Served by the gateway in the cloud, by the IDE itself locally — never by a
//! project's container, which sees only its project and knows nothing of the
//! company (decision 25 of 05-10-2026).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use axum::extract::{Path as UrlPath, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sws_core::simboli_prj::{self, Descrizione};

use crate::router::{AppState, AuthUser};

/// The format written in `symbol.json`: the one of a `.swsym` file.
pub const FORMAT: &str = "sws-symbol";
/// One photo, as the project's upload takes them.
pub const MAX_PHOTO_BYTES: usize = 5 * 1024 * 1024;
/// A `PUT` with eight photos in base64.
pub const MAX_BODY_BYTES: usize = 8 * MAX_PHOTO_BYTES * 4 / 3 + 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
struct Envelope {
    format: String,
    version: u32,
    symbol: Descrizione,
    #[serde(default)]
    updated_by: String,
    #[serde(default)]
    updated_ms: u64,
}

/// An entry as the IDE lists it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Entry {
    pub slug: String,
    /// The fingerprint of the symbol and its photos: a copy in a project
    /// that has another one is out of date.
    pub version: String,
    pub updated_by: String,
    pub updated_ms: u64,
    pub images: Vec<String>,
    pub symbol: Descrizione,
}

/// The library of the company whose projects are in `<root>/<folder>`.
pub fn library_dir(projects_root: &Path, company_folder: &str) -> PathBuf {
    let base = if company_folder.is_empty() {
        projects_root.to_path_buf()
    } else {
        projects_root.join(company_folder)
    };
    base.join(".ambiente").join("symbols")
}

fn slug_ok(slug: &str) -> bool {
    simboli_prj::nome_ammesso(slug, 3, 40)
}

/// The photos a symbol uses, from its compiled manifest entry.
fn photos_of(d: &Descrizione) -> Vec<String> {
    simboli_prj::compila(d)
        .ok()
        .and_then(|c| serde_json::from_value(c.voce["images"].clone()).ok())
        .unwrap_or_default()
}

fn fingerprint(json: &[u8], images: &[(String, Vec<u8>)]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(json);
    for (name, bytes) in images {
        h.update(name.as_bytes());
        h.update((bytes.len() as u64).to_le_bytes());
        h.update(bytes);
    }
    h.finalize()
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// One entry, read from disk.
pub fn read(dir: &Path, slug: &str) -> Option<Entry> {
    if !slug_ok(slug) {
        return None;
    }
    let at = dir.join(slug);
    let json = std::fs::read(at.join("symbol.json")).ok()?;
    let env: Envelope = serde_json::from_slice(&json).ok()?;
    if env.format != FORMAT {
        return None;
    }
    let names = photos_of(&env.symbol);
    let images: Vec<(String, Vec<u8>)> = names
        .iter()
        .filter_map(|n| Some((n.clone(), std::fs::read(at.join("images").join(n)).ok()?)))
        .collect();
    Some(Entry {
        slug: slug.to_string(),
        version: fingerprint(&json, &images),
        updated_by: env.updated_by,
        updated_ms: env.updated_ms,
        images: images.into_iter().map(|(n, _)| n).collect(),
        symbol: env.symbol,
    })
}

/// Every entry, by slug.
pub fn list(dir: &Path) -> Vec<Entry> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<Entry> = rd
        .flatten()
        .filter_map(|e| read(dir, e.file_name().to_str()?))
        .collect();
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    out
}

/// A photo of an entry.
pub fn image(dir: &Path, slug: &str, name: &str) -> Option<Vec<u8>> {
    (slug_ok(slug) && simboli_prj::image_name_ok(name))
        .then(|| std::fs::read(dir.join(slug).join("images").join(name)).ok())
        .flatten()
}

/// Writes (or replaces) an entry: the symbol must compile and pass the rules,
/// and carry every photo it names — and only those. Written next to the old
/// one and then swapped, so a reader never sees half of it.
pub fn write(
    dir: &Path,
    slug: &str,
    mut symbol: Descrizione,
    images: BTreeMap<String, Vec<u8>>,
    by: &str,
    now_ms: u64,
) -> Result<Entry, String> {
    if !slug_ok(slug) {
        return Err(format!("«{slug}»: 3 to 40 characters among a-z, 0-9 and «-»"));
    }
    // The library's own record of where a copy came from has no meaning here.
    symbol.library = None;
    simboli_prj::compila_e_controlla(&symbol).map_err(|e| e.join("; "))?;
    let names = photos_of(&symbol);
    for n in &names {
        let b = images
            .get(n)
            .ok_or_else(|| format!("the photo «{n}» is missing"))?;
        if b.len() > MAX_PHOTO_BYTES {
            return Err(format!("the photo «{n}» is larger than 5 MB"));
        }
    }
    let json = serde_json::to_vec_pretty(&Envelope {
        format: FORMAT.into(),
        version: 1,
        symbol,
        updated_by: by.to_string(),
        updated_ms: now_ms,
    })
    .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".{slug}.new"));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(tmp.join("images")).map_err(|e| e.to_string())?;
    std::fs::write(tmp.join("symbol.json"), &json).map_err(|e| e.to_string())?;
    for n in &names {
        std::fs::write(tmp.join("images").join(n), &images[n]).map_err(|e| e.to_string())?;
    }
    let at = dir.join(slug);
    let old = dir.join(format!(".{slug}.old"));
    let _ = std::fs::remove_dir_all(&old);
    if at.exists() {
        std::fs::rename(&at, &old).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &at).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&old);
    read(dir, slug).ok_or_else(|| "written but not readable".into())
}

pub fn delete(dir: &Path, slug: &str) -> bool {
    slug_ok(slug) && std::fs::remove_dir_all(dir.join(slug)).is_ok()
}

// ── the routes ─────────────────────────────────────────────────────────────

/// The library folder of `company` (its folder in the URL, `-` for the
/// implicit one), if `user` may use it: a member of the company, or whoever
/// administers the platform. On a local IDE (no gateway) the implicit
/// company is the installation's, and every user of it may.
async fn company_dir(s: &AppState, user: &AuthUser, company: &str) -> Result<PathBuf, Response> {
    let Some(id) = s.identita.as_ref() else {
        return Err((StatusCode::NOT_FOUND, "no company library on this instance").into_response());
    };
    let not_yours = || (StatusCode::FORBIDDEN, "not a member of this company").into_response();
    let companies = id.elenca_aziende().await.unwrap_or_default();
    let implicit = company == crate::project_registry::AZIENDA_IMPLICITA;
    let Some(a) = companies
        .iter()
        .find(|a| if implicit { a.implicita } else { !a.implicita && a.cartella == company })
    else {
        // A local IDE whose database has no implicit company yet: still the
        // installation's library.
        if implicit && s.regia.is_none() {
            return Ok(library_dir(&s.projects_root, ""));
        }
        return Err((StatusCode::NOT_FOUND, "unknown company").into_response());
    };
    let dir = library_dir(&s.projects_root, &a.cartella);
    if user.amministratore_piattaforma || (implicit && s.regia.is_none()) {
        return Ok(dir);
    }
    let users = id.elenca().await.unwrap_or_default();
    let Some(u) = users.iter().find(|u| u.email == user.username) else {
        return Err(not_yours());
    };
    let member = id
        .aziende_di(u.id)
        .await
        .unwrap_or_default()
        .iter()
        .any(|(aid, _)| *aid == a.id);
    if member {
        Ok(dir)
    } else {
        Err(not_yours())
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// `GET /api/library/:company/symbols`
pub async fn get_list(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    UrlPath(company): UrlPath<String>,
) -> Response {
    match company_dir(&s, &user, &company).await {
        Ok(dir) => Json(tokio::task::spawn_blocking(move || list(&dir)).await.unwrap_or_default())
            .into_response(),
        Err(r) => r,
    }
}

/// `GET /api/library/:company/symbols/:slug`
pub async fn get_one(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    UrlPath((company, slug)): UrlPath<(String, String)>,
) -> Response {
    let dir = match company_dir(&s, &user, &company).await {
        Ok(d) => d,
        Err(r) => return r,
    };
    match tokio::task::spawn_blocking(move || read(&dir, &slug)).await {
        Ok(Some(e)) => Json(e).into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `GET /api/library/:company/symbols/:slug/images/:name`
pub async fn get_image(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    UrlPath((company, slug, name)): UrlPath<(String, String, String)>,
) -> Response {
    let dir = match company_dir(&s, &user, &company).await {
        Ok(d) => d,
        Err(r) => return r,
    };
    let ctype = match name.rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    };
    match tokio::task::spawn_blocking(move || image(&dir, &slug, &name)).await {
        Ok(Some(b)) => ([(header::CONTENT_TYPE, ctype)], b).into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// What «Salva in libreria» sends: the symbol and its photos in base64.
#[derive(Deserialize)]
pub struct PutBody {
    pub symbol: Descrizione,
    #[serde(default)]
    pub images: BTreeMap<String, String>,
}

/// `PUT /api/library/:company/symbols/:slug` — every member writes.
pub async fn put_one(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    UrlPath((company, slug)): UrlPath<(String, String)>,
    Json(body): Json<PutBody>,
) -> Response {
    let dir = match company_dir(&s, &user, &company).await {
        Ok(d) => d,
        Err(r) => return r,
    };
    let mut images = BTreeMap::new();
    for (name, b64) in body.images {
        if !simboli_prj::image_name_ok(&name) {
            return (StatusCode::BAD_REQUEST, format!("photo name «{name}»")).into_response();
        }
        match base64::engine::general_purpose::STANDARD.decode(b64.trim()) {
            Ok(b) => images.insert(name, b),
            Err(_) => return (StatusCode::BAD_REQUEST, format!("photo «{name}»: not base64")).into_response(),
        };
    }
    let by = user.username.clone();
    let done = tokio::task::spawn_blocking(move || write(&dir, &slug, body.symbol, images, &by, now_ms())).await;
    match done {
        Ok(Ok(e)) => {
            s.audit.log(
                "symbol_library.saved",
                Some(user.username.clone()),
                json!({ "company": company, "slug": e.slug }),
            );
            Json(e).into_response()
        }
        Ok(Err(m)) => (StatusCode::UNPROCESSABLE_ENTITY, m).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// `DELETE /api/library/:company/symbols/:slug` — the copies in the projects
/// stay: they never depended on it.
pub async fn delete_one(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    UrlPath((company, slug)): UrlPath<(String, String)>,
) -> Response {
    let dir = match company_dir(&s, &user, &company).await {
        Ok(d) => d,
        Err(r) => return r,
    };
    let slug2 = slug.clone();
    match tokio::task::spawn_blocking(move || delete(&dir, &slug2)).await {
        Ok(true) => {
            s.audit.log(
                "symbol_library.deleted",
                Some(user.username.clone()),
                json!({ "company": company, "slug": slug }),
            );
            StatusCode::NO_CONTENT.into_response()
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boiler() -> Descrizione {
        serde_json::from_str(include_str!(
            "../../../../tests/fixtures/simboli-prj/photo-boiler.json"
        ))
        .unwrap()
    }

    fn photos() -> BTreeMap<String, Vec<u8>> {
        ["boiler.jpg", "fan-cutout.png", "flame-off.png", "flame-low.png", "flame-high.png"]
            .iter()
            .enumerate()
            .map(|(i, n)| (n.to_string(), vec![i as u8; 10]))
            .collect()
    }

    fn user(email: &str, platform: bool) -> AuthUser {
        AuthUser {
            username: email.into(),
            role: sws_auth::Role::Admin,
            must_change_password: false,
            allowed_zones: vec![],
            amministratore_piattaforma: platform,
        }
    }

    /// Only a member of the company (or whoever administers the platform)
    /// gets its library; the implicit company of a local IDE is everyone's.
    #[tokio::test]
    async fn the_library_is_the_members_own() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = crate::router::stato_di_prova(dir.path()).await;
        let id = sws_identita::Identita::apri(dir.path().join("identita.db")).await.unwrap();
        let u = id
            .crea_utente("m@x.it", "M", "unapassword", sws_identita::Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        let acme = id.crea_azienda("Acme").await.unwrap();
        s.identita = Some(id.clone());
        let status = |r: Response| r.status();
        let ask = |who: AuthUser, company: &str| {
            get_list(State(s.clone()), Extension(who), UrlPath(company.to_string()))
        };
        assert_eq!(status(ask(user("m@x.it", false), &acme.cartella).await), StatusCode::FORBIDDEN);
        assert_eq!(status(ask(user("m@x.it", true), &acme.cartella).await), StatusCode::OK);
        assert_eq!(status(ask(user("m@x.it", false), "nessuna").await), StatusCode::NOT_FOUND);
        assert_eq!(status(ask(user("m@x.it", false), "-").await), StatusCode::OK, "local IDE");
        id.iscrivi(acme.id, u.id, sws_identita::Ruolo::Sviluppatore).await.unwrap();
        assert_eq!(status(ask(user("m@x.it", false), &acme.cartella).await), StatusCode::OK);
        // A member writes, and the entry lands next to the company's projects.
        let body = PutBody { symbol: serde_json::from_value(serde_json::json!({
            "slug": "box", "w": 40, "h": 40, "body": "body-pump", "it": "Scatola", "en": "Box",
            "ops": [{ "op": "corpo" }, { "op": "forma", "tag": "rect", "geo": { "x": 4, "y": 4, "width": 32, "height": 32 } }]
        })).unwrap(), images: BTreeMap::new() };
        let r = put_one(
            State(s.clone()),
            Extension(user("m@x.it", false)),
            UrlPath((acme.cartella.clone(), "box".into())),
            Json(body),
        )
        .await;
        assert_eq!(r.status(), StatusCode::OK);
        assert!(library_dir(&s.projects_root, &acme.cartella).join("box/symbol.json").exists());
    }

    #[test]
    fn the_folder_is_next_to_the_companys_projects() {
        let r = Path::new("/srv/progetti");
        assert_eq!(library_dir(r, ""), Path::new("/srv/progetti/.ambiente/symbols"));
        assert_eq!(library_dir(r, "pixsys"), Path::new("/srv/progetti/pixsys/.ambiente/symbols"));
    }

    #[test]
    fn an_entry_goes_in_and_comes_back_with_its_photos_and_a_version() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("lib");
        let mut sym = boiler();
        sym.library = Some(simboli_prj::LibraryRef { slug: "x".into(), version: "y".into() });
        let e = write(&dir, "caldaia", sym, photos(), "mario@x.it", 42).unwrap();
        assert_eq!(e.images.len(), 5);
        assert_eq!(e.updated_by, "mario@x.it");
        assert!(e.symbol.library.is_none(), "the library doesn't keep a copy's record");
        assert_eq!(image(&dir, "caldaia", "boiler.jpg"), Some(vec![0; 10]));
        let listed = list(&dir);
        assert_eq!(listed, vec![e.clone()]);
        // The same content, the same version; a changed photo, another one.
        let again = write(&dir, "caldaia", boiler(), photos(), "mario@x.it", 42).unwrap();
        assert_eq!(again.version, e.version);
        let mut p = photos();
        p.insert("boiler.jpg".into(), vec![9; 10]);
        let changed = write(&dir, "caldaia", boiler(), p, "mario@x.it", 42).unwrap();
        assert_ne!(changed.version, e.version);
        assert!(delete(&dir, "caldaia"));
        assert!(list(&dir).is_empty());
    }

    #[test]
    fn what_cannot_go_in() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("lib");
        let mut missing = photos();
        missing.remove("flame-high.png");
        assert!(write(&dir, "caldaia", boiler(), missing, "a", 0).unwrap_err().contains("flame-high.png"));
        assert!(write(&dir, "../x", boiler(), photos(), "a", 0).is_err());
        let mut bad = boiler();
        bad.body = "unobtainium".into();
        assert!(write(&dir, "caldaia", bad, photos(), "a", 0).is_err());
        assert!(image(&dir, "caldaia", "../../etc/passwd").is_none());
        assert!(list(&dir).is_empty());
    }
}
