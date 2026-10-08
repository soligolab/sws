//! I **marchi**: stili grafici e predefiniti dell'IDE, configurabili dalla
//! console (decisione 45, 06-10-2026).
//!
//! # Dove vivono, e perché in due posti
//!
//! Come il catalogo dei dispositivi (`catalogo.rs`): quelli **del prodotto**
//! stanno nell'immagine (`<www>/branding/`), quelli **dell'installazione** in
//! `<config>/branding/`, e **a parità di identificativo vince l'utente**. Così
//! i marchi che si spediscono restano al loro posto e quelli creati dal
//! maintainer sopravvivono a un aggiornamento dell'immagine, che la riscrive
//! per intero.
//!
//! # Perché i file li serve questo modulo e non `ServeDir`
//!
//! Il logo si può caricare, SVG compreso. Un SVG può contenere script — ma
//! **non vengono eseguiti quando l'SVG è caricato con `<img src=…>`**, che è
//! come lo disegna l'editor (`BrandLogo.tsx:15`). Girano solo se il file viene
//! aperto **come documento**: navigandoci sopra, o dentro un `iframe`.
//!
//! Quella strada si chiude qui, con due intestazioni:
//!
//! - `Content-Security-Policy: default-src 'none'; sandbox` — niente script,
//!   niente richieste, nemmeno a chi ci naviga sopra apposta;
//! - `X-Content-Type-Options: nosniff` — il browser non prova a indovinare un
//!   tipo diverso da quello dichiarato.
//!
//! Costa due intestazioni invece di un sanificatore di SVG, che sarebbe stato
//! un lavoro a sé con una superficie d'errore sua.
//!
//! # La rotta dei file è pre-auth, e deve esserlo
//!
//! La schermata di accesso mostra il logo **prima** che un token esista. È
//! quindi nella lista bianca di `check_rotte_preauth.sh`, ed è l'unica rotta
//! aperta che serve file scrivibili da fuori: è su questa che l'elenco delle
//! estensioni ammesse e il limite di dimensione contano davvero.

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use std::path::PathBuf;
use tracing::info;

use crate::router::AppState;

/// Quanto può pesare un file di marchio. Un logo è qualche decina di KB; un
/// megabyte è già generoso e tiene fuori sia gli errori sia gli abusi.
const LIMITE_FILE: usize = 1024 * 1024;

/// Le estensioni ammesse, con il tipo che dichiariamo al browser.
///
/// Elenco chiuso, non «tutto tranne»: un elenco di cose vietate dimentica
/// sempre qualcosa, e qui la cosa dimenticata sarebbe servita dalla nostra
/// origine.
const TIPI: &[(&str, &str)] = &[
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("webp", "image/webp"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("ico", "image/x-icon"),
    ("json", "application/json"),
];

/// Un nome di cartella o di file accettabile: niente separatori, niente punti
/// iniziali, niente risalite. Stessa regola di `catalogo.rs::nome_sicuro`.
fn nome_sicuro(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('.')
        && !s.contains("..")
        && !s.contains(['/', '\\', '\0'])
}

fn tipo_di(nome: &str) -> Option<&'static str> {
    let ext = nome.rsplit('.').next()?.to_ascii_lowercase();
    TIPI.iter().find(|(e, _)| *e == ext).map(|(_, t)| *t)
}

/// Le due radici: l'utente vince.
fn radici(s: &AppState) -> (PathBuf, Option<PathBuf>) {
    let utente = s.config_dir.join("branding");
    let prodotto = s.www_dir.as_ref().map(|w| w.join("branding"));
    (utente, prodotto)
}

// ── Servire i file (pre-auth) ────────────────────────────────────────────────

/// `GET /branding/:marchio/:file` — il logo, la favicon, il `brand.json`.
///
/// Sostituisce `ServeDir` per questo percorso: oltre a guardare in due radici,
/// è il punto in cui si applicano le intestazioni che rendono inerte un SVG
/// caricato da terzi.
pub async fn file_marchio(
    State(s): State<AppState>,
    Path((marchio, file)): Path<(String, String)>,
) -> Response {
    if !nome_sicuro(&marchio) || !nome_sicuro(&file) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Some(tipo) = tipo_di(&file) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let (utente, prodotto) = radici(&s);
    let mut percorso = utente.join(&marchio).join(&file);
    if !percorso.is_file() {
        match prodotto {
            Some(p) if p.join(&marchio).join(&file).is_file() => {
                percorso = p.join(&marchio).join(&file)
            }
            _ => return StatusCode::NOT_FOUND.into_response(),
        }
    }
    let Ok(dati) = tokio::fs::read(&percorso).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    (
        [
            (header::CONTENT_TYPE, tipo),
            // Vedi la nota in testa al modulo: è questo che rende inerte uno
            // script dentro un SVG anche a chi apre il file come documento.
            (
                header::CONTENT_SECURITY_POLICY,
                "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            ),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        dati,
    )
        .into_response()
}

// ── Amministrare i marchi (dietro la console) ────────────────────────────────

/// `GET /api/amministrazione/marchi` — l'elenco, con l'origine di ciascuno.
pub async fn elenca(
    State(s): State<AppState>,
    axum::Extension(chi): axum::Extension<crate::router::AuthUser>,
) -> Response {
    let (utente, prodotto) = radici(&s);
    let mut trovati: Vec<serde_json::Value> = Vec::new();
    let mut visti: Vec<String> = Vec::new();

    for (radice, proprio) in [(Some(utente), true), (prodotto, false)] {
        let Some(radice) = radice else { continue };
        let Ok(mut rd) = tokio::fs::read_dir(&radice).await else {
            continue;
        };
        while let Ok(Some(e)) = rd.next_entry().await {
            if !e.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let id = e.file_name().to_string_lossy().to_string();
            // L'utente vince: se c'è già, quello del prodotto si salta.
            if visti.contains(&id) {
                continue;
            }
            let Ok(testo) = tokio::fs::read_to_string(e.path().join("brand.json")).await else {
                continue;
            };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&testo) else {
                continue;
            };
            visti.push(id.clone());
            trovati.push(serde_json::json!({
                "id": id,
                "nome": v.get("name").and_then(|n| n.as_str()).unwrap_or(&id),
                // Quanti pannelli porta con sé: un marchio non è solo aspetto,
                // contiene anche il catalogo dei dispositivi (decisione 43).
                "dispositivi": v.get("device_presets").and_then(|d| d.as_array()).map(|a| a.len()).unwrap_or(0),
                // Chi può modificarlo: quelli del prodotto no, li riscrive
                // l'aggiornamento dell'immagine. Si duplicano invece.
                "proprio": proprio,
                "contenuto": v,
            }));
        }
    }
    trovati.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));

    // **Chi amministra un'azienda vede il suo marchio, non il catalogo.**
    //
    // Il marchio lo sceglie la piattaforma (decisione del maintainer,
    // 08-10-2026): a chi non lo sceglie, il catalogo non serve — e nel cloud
    // i marchi delle altre aziende sono marchi di clienti diversi, cioè
    // l'elenco direbbe a ciascuno chi sono gli altri. Segnalato dal
    // maintainer provando la console come amministratore di una sola azienda.
    //
    // Resta visibile il **suo**, perché sapere con che faccia si presenta il
    // proprio pannello è cosa sua.
    if let Some(mie) = crate::amministrazione::confine_pubblico(&s, &chi).await {
        let aziende = match s.identita.as_ref() {
            Some(id) => id.elenca_aziende().await.unwrap_or_default(),
            None => Vec::new(),
        };
        let suoi: Vec<String> = aziende
            .iter()
            .filter(|a| mie.contains(&a.id))
            .filter_map(|a| a.marchio.clone())
            .collect();
        trovati.retain(|m| m["id"].as_str().is_some_and(|id| suoi.iter().any(|x| x == id)));
    }
    Json(trovati).into_response()
}

/// `PUT /api/amministrazione/marchi/:id` — scrive `brand.json` dell'utente.
///
/// Scrive **sempre** in `<config>/branding/`, anche quando l'identificativo è
/// quello di un marchio del prodotto: così «modificare Pixsys» significa
/// crearne una versione propria che lo copre, e l'originale resta intatto
/// sotto, pronto a tornare se la copia si cancella.
pub async fn salva(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(contenuto): Json<serde_json::Value>,
) -> Response {
    if !nome_sicuro(&id) {
        return (StatusCode::BAD_REQUEST, "identificativo non valido").into_response();
    }
    if !contenuto.is_object() {
        return (StatusCode::BAD_REQUEST, "il marchio dev'essere un oggetto").into_response();
    }
    let (utente, _) = radici(&s);
    let dir = utente.join(&id);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
    }
    let testo = match serde_json::to_string_pretty(&contenuto) {
        Ok(t) => t,
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };
    if let Err(e) = tokio::fs::write(dir.join("brand.json"), testo).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
    }
    info!(marchio = %id, "marchio salvato dalla console");
    s.audit.log(
        "amministrazione.marchio_salvato",
        None,
        serde_json::json!({"id": id}),
    );
    StatusCode::NO_CONTENT.into_response()
}

/// `PUT /api/amministrazione/marchi/:id/file/:nome` — carica logo o favicon.
///
/// Il corpo sono i byte del file. Niente multipart: un file solo per
/// richiesta, e il nome sta nel percorso — meno pezzi da sbagliare.
pub async fn carica_file(
    State(s): State<AppState>,
    Path((id, nome)): Path<(String, String)>,
    corpo: Bytes,
) -> Response {
    if !nome_sicuro(&id) || !nome_sicuro(&nome) {
        return (StatusCode::BAD_REQUEST, "nome non valido").into_response();
    }
    if tipo_di(&nome).is_none() {
        return (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "estensione non ammessa: svg, png, webp, jpg, ico",
        )
            .into_response();
    }
    if corpo.len() > LIMITE_FILE {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("il file supera {} KB", LIMITE_FILE / 1024),
        )
            .into_response();
    }
    let (utente, _) = radici(&s);
    let dir = utente.join(&id);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
    }
    if let Err(e) = tokio::fs::write(dir.join(&nome), &corpo).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
    }
    info!(marchio = %id, file = %nome, byte = corpo.len(), "file di marchio caricato");
    s.audit.log(
        "amministrazione.marchio_file",
        None,
        serde_json::json!({"id": id, "file": nome, "byte": corpo.len()}),
    );
    StatusCode::NO_CONTENT.into_response()
}

/// `DELETE /api/amministrazione/marchi/:id` — toglie la versione dell'utente.
///
/// Se copriva un marchio del prodotto, quello **ritorna**: è il modo di
/// annullare una modifica senza doverla disfare a mano.
pub async fn elimina(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    if !nome_sicuro(&id) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let (utente, _) = radici(&s);
    let dir = utente.join(&id);
    if !dir.is_dir() {
        return (
            StatusCode::NOT_FOUND,
            "nessun marchio dell'installazione con questo identificativo",
        )
            .into_response();
    }
    if let Err(e) = tokio::fs::remove_dir_all(&dir).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
    }
    s.audit.log(
        "amministrazione.marchio_eliminato",
        None,
        serde_json::json!({"id": id}),
    );
    StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn i_nomi_pericolosi_sono_rifiutati() {
        assert!(nome_sicuro("pixsys"));
        assert!(nome_sicuro("logo.svg"));
        assert!(!nome_sicuro("../etc"), "risalita accettata");
        assert!(!nome_sicuro("a/b"), "separatore accettato");
        assert!(!nome_sicuro(".nascosto"));
        assert!(!nome_sicuro(""));
    }

    #[test]
    fn solo_le_estensioni_dell_elenco() {
        assert_eq!(tipo_di("logo.svg"), Some("image/svg+xml"));
        assert_eq!(tipo_di("logo.PNG"), Some("image/png"));
        // Un elenco chiuso: ciò che non c'è non si serve, invece di elencare
        // ciò che si vieta e dimenticarne uno.
        assert_eq!(tipo_di("script.js"), None);
        assert_eq!(tipo_di("pagina.html"), None);
        assert_eq!(tipo_di("senza-estensione"), None);
    }
}
