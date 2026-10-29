//! La miniatura della pagina iniziale di un progetto (29-10-2026, ramo D del
//! piano `docs/plans/2026-10-26-aprire-sws-soligo-net.md`).
//!
//! La disegna **l'IDE**, al salvataggio, con la stessa catena delle pagine di
//! boot (`sws-editor/src/progetto/anteprima.ts`): il runtime non sa disegnare
//! una pagina web, e un PNG fatto da un altro motore non sarebbe la pagina che
//! si vede. Qui la si riceve, la si conserva e la si dà all'elenco dei progetti.
//!
//! Le tre decisioni del maintainer (29-10-2026):
//!
//! - **sta nel progetto**, come `anteprima.png` nella sua cartella: segue da
//!   sola rinomina, duplica, archivio e backup, e nel cloud è l'unico posto in
//!   cui il container del progetto può scrivere e il gateway può leggere. Non va
//!   in git (`.gitignore` del progetto) né al pannello (non è nel pacchetto del
//!   deploy, che elenca le sue cartelle);
//! - **400 pixel di larghezza, al massimo 256 KB**: un sinottico ha colori
//!   pieni e in PNG resta molto sotto; oltre il tetto non si scrive, e
//!   l'elenco mostra l'icona;
//! - **la pagina iniziale**, con la sua cornice.

use axum::{
    body::{Body, Bytes},
    extract::{Path as UrlPath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Extension,
};
use std::path::Path;
use tracing::warn;

use crate::router::{active_dir, AppState, AuthUser};

/// Il file della miniatura, nella cartella del progetto.
pub const NOME_FILE: &str = "anteprima.png";

/// Il tetto: gemello di `MAX_ANTEPRIMA_BYTES` in `sws-editor/src/progetto/anteprima.ts`.
pub const MAX_BYTES: usize = 256 * 1024;

const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// Perché una miniatura non va bene, o `None` se va bene.
pub fn motivo_rifiuto(bytes: &[u8]) -> Option<(StatusCode, String)> {
    if bytes.is_empty() {
        return Some((StatusCode::BAD_REQUEST, "file vuoto".into()));
    }
    if bytes.len() > MAX_BYTES {
        return Some((
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("miniatura troppo grande ({} KB, max {} KB)", bytes.len() / 1024, MAX_BYTES / 1024),
        ));
    }
    if bytes.len() < PNG_MAGIC.len() || bytes[..PNG_MAGIC.len()] != PNG_MAGIC {
        return Some((StatusCode::BAD_REQUEST, "il corpo non è un file PNG".into()));
    }
    None
}

/// Quando è stata scritta la miniatura di un progetto, in millisecondi: va
/// nell'elenco dei progetti, così l'IDE sa se ce n'è una e quando richiederla.
pub fn scritta_ms(dir: &Path) -> Option<u64> {
    let m = std::fs::metadata(dir.join(NOME_FILE)).ok()?.modified().ok()?;
    m.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

/// `PUT /api/project/anteprima` — la miniatura del progetto **aperto**, corpo
/// PNG grezzo. Non segnala un cambio del progetto: è un derivato, e chi la
/// scrive è proprio l'IDE che ha appena salvato.
pub async fn scrivi(State(s): State<AppState>, body: Bytes) -> Response {
    let dir = match active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    if let Some((codice, motivo)) = motivo_rifiuto(&body) {
        return (codice, motivo).into_response();
    }
    match crate::router::scrivi_atomico(&dir.join(NOME_FILE), &body).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => {
            warn!("anteprima: scrittura in {}: {e}", dir.display());
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// `GET /api/projects/:azienda/:nome/anteprima` — passa dal risolutore, come
/// ogni rotta su un progetto per nome: chi non vede il progetto non vede
/// nemmeno la sua miniatura (404, non 403).
pub async fn leggi(
    State(s): State<AppState>,
    chi: Option<Extension<AuthUser>>,
    UrlPath((azienda, nome)): UrlPath<(String, String)>,
) -> Response {
    let p = match crate::projects::risolvi_progetto(&s, chi.as_ref().map(|e| &e.0), &azienda, &nome).await {
        Ok(p) => p,
        Err(r) => return r,
    };
    match tokio::fs::read(p.dir.join(NOME_FILE)).await {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/png")
            // L'elenco la chiede con `?v=<scritta_ms>`: una nuova si vede
            // subito, la stessa la tiene il browser.
            .header(header::CACHE_CONTROL, "private, max-age=86400")
            .body(Body::from(bytes))
            .unwrap(),
        Err(_) => (StatusCode::NOT_FOUND, "nessuna miniatura").into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn si_accetta_solo_un_png_piccolo() {
        let mut png = PNG_MAGIC.to_vec();
        png.extend_from_slice(&[0u8; 100]);
        assert!(motivo_rifiuto(&png).is_none());
        assert_eq!(motivo_rifiuto(&[]).map(|m| m.0), Some(StatusCode::BAD_REQUEST));
        assert_eq!(motivo_rifiuto(b"<svg/>").map(|m| m.0), Some(StatusCode::BAD_REQUEST));
        let mut grande = PNG_MAGIC.to_vec();
        grande.resize(MAX_BYTES + 1, 0);
        assert_eq!(motivo_rifiuto(&grande).map(|m| m.0), Some(StatusCode::PAYLOAD_TOO_LARGE));
    }

    #[test]
    fn senza_file_non_c_e_data() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(scritta_ms(tmp.path()), None);
        std::fs::write(tmp.path().join(NOME_FILE), PNG_MAGIC).unwrap();
        assert!(scritta_ms(tmp.path()).is_some());
    }
}
