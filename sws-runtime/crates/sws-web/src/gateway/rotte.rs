//! Le rotte del gateway: `/p/<azienda>/<progetto>/…`.
//!
//! Tre cose succedono qui, e conviene tenerle distinte.
//!
//! **La pagina la serve il gateway.** La richiesta del documento HTML arriva
//! da una navigazione del browser, e una navigazione non porta nessun token:
//! quello vive in `localStorage` e lo aggiunge il codice della pagina, che
//! però non è ancora stato caricato. Quindi il guscio — `index-admin.html` e i
//! file in `/assets/` — è pubblico e lo serve il gateway, esattamente come la
//! console. Dentro non c'è niente di privato: è la SPA, uguale per tutti.
//!
//! **I dati li serve il container.** Tutto quello che sta sotto il prefisso e
//! non è il guscio viene rigirato al progetto, e lì il token serve e c'è,
//! perché a chiamare è la SPA.
//!
//! **Il container si accende quando serve.** Se il progetto non è aperto, la
//! prima chiamata lo apre e aspetta. L'alternativa — rispondere «chiuso,
//! riaprilo dalla console» — farebbe fallire ogni ricarica di pagina dopo i
//! venti minuti di fermo, cioè nel caso più normale che ci sia.

use axum::body::Body;
use axum::extract::{ws::WebSocketUpgrade, State};
use axum::http::{Request, StatusCode};
use axum::response::{IntoResponse, Response};
use std::sync::OnceLock;

use super::inoltro;
use super::progetti::{Apertura, Aperto};
use crate::router::{AppState, AuthUser};

/// Il client HTTP verso i container, uno solo per tutto il processo.
///
/// Uno per richiesta vorrebbe dire una connessione TCP nuova ogni volta e il
/// pool buttato via; e `reqwest::Client` è già fatto per essere condiviso.
/// Niente redirezioni automatiche: un 302 del figlio è una risposta che
/// riguarda il browser, non noi, e seguirlo qui la nasconderebbe.
fn cliente() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("client HTTP del gateway")
    })
}

/// `true` se questo percorso, sotto il prefisso, è il guscio della SPA.
///
/// Solo la radice del progetto: `/p/<azienda>/<progetto>` e la stessa con la
/// barra. Un file dentro — `/api/…`, `/ws/…` — non lo è mai.
pub fn e_il_guscio(resto: &str) -> bool {
    resto == "/" || resto.is_empty()
}

/// Il documento HTML dell'IDE, preso dalla cartella `--www` del gateway.
async fn guscio(s: &AppState) -> Response {
    let Some(dir) = s.www_dir.as_ref() else {
        return (StatusCode::NOT_FOUND, "nessuna SPA servita da questo processo").into_response();
    };
    let file = dir.join("index-admin.html");
    match tokio::fs::read(&file).await {
        Ok(b) => (
            [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
            b,
        )
            .into_response(),
        Err(e) => {
            tracing::error!(?file, "guscio dell'IDE non leggibile: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "IDE non disponibile").into_response()
        }
    }
}

/// Apre il progetto se non lo è già, con il tetto dell'azienda.
///
/// Il tetto si legge **adesso** e non alla creazione dell'azienda: cambiarlo
/// dalla console deve valere alla prossima apertura, non al prossimo riavvio.
async fn assicura_aperto(s: &AppState, azienda: &str, progetto: &str) -> Result<Aperto, Response> {
    let regia = s.regia.as_ref().expect("chiamata solo con il gateway acceso");

    // `cartella` vuota = azienda implicita, cioè i progetti in radice.
    let (cartella, tetto) = if azienda == crate::project_registry::AZIENDA_IMPLICITA {
        (String::new(), None)
    } else {
        let aziende = match s.identita.as_ref() {
            Some(i) => i.elenca_aziende().await.unwrap_or_default(),
            None => vec![],
        };
        match aziende.into_iter().find(|a| a.cartella == azienda) {
            Some(a) => (a.cartella.clone(), a.max_progetti_aperti),
            // L'azienda non c'è più ma la cartella sì: non si inventa un
            // tetto, si rifiuta. Aprire un container per un'azienda che non
            // esiste vuol dire un container che nessuna quota conta.
            None => {
                return Err((StatusCode::NOT_FOUND, "azienda sconosciuta").into_response());
            }
        }
    };

    match regia.apri(azienda, progetto, &cartella, tetto).await {
        Ok(a) => Ok(a),
        // Il messaggio del tetto si legge: dice quanti sono e quanti ne
        // spettano, perché chi lo riceve deve sapere cosa chiudere.
        Err(e @ Apertura::TettoPieno { .. }) => {
            Err((StatusCode::CONFLICT, e.to_string()).into_response())
        }
        Err(Apertura::NonTrovato) => {
            Err((StatusCode::NOT_FOUND, "progetto non trovato").into_response())
        }
        Err(Apertura::Podman(m)) => {
            tracing::error!("apertura del progetto {azienda}/{progetto} fallita: {m}");
            Err((StatusCode::BAD_GATEWAY, "il progetto non si apre").into_response())
        }
    }
}

/// `GET|POST|… /p/:azienda/:progetto/*resto`
pub async fn inoltra_al_progetto(
    State(s): State<AppState>,
    ws: Option<WebSocketUpgrade>,
    req: Request<Body>,
) -> Response {
    let percorso = req.uri().path().to_string();
    let Some((azienda, progetto, resto)) = inoltro::separa_prefisso(&percorso) else {
        return (StatusCode::NOT_FOUND, "indirizzo di progetto non valido").into_response();
    };

    if e_il_guscio(&resto) {
        return guscio(&s).await;
    }

    if s.regia.is_none() {
        return (StatusCode::NOT_FOUND, "questo processo non è un gateway").into_response();
    }

    // Chi sei lo ha già deciso `require_auth`, che sta davanti a questa rotta.
    let chi = req.extensions().get::<AuthUser>().cloned();
    let Some(utente) = chi.as_ref().map(|c| c.username.clone()) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };

    // L'autorizzazione è la **stessa** del resto dell'IDE: un progetto di
    // un'altra azienda non esiste (404, non 403). Scrivere qui una seconda
    // regola vorrebbe dire due regole da tenere d'accordo.
    if let Err(r) = crate::projects::risolvi_progetto(&s, chi.as_ref(), &azienda, &progetto).await {
        return r;
    }

    let aperto = match assicura_aperto(&s, &azienda, &progetto).await {
        Ok(a) => a,
        Err(r) => return r,
    };
    let regia = s.regia.as_ref().expect("verificata sopra");
    let segreto = regia.segreto().to_string();

    if let Some(ws) = ws {
        // Una finestra in più collegata: è questo che tiene acceso il
        // container, e lo scollegamento fa ripartire il timer dei venti
        // minuti. Il WebSocket dei tag resta aperto per tutta la sessione di
        // lavoro, quindi è il segnale giusto — una richiesta HTTP no, perché
        // una pagina ferma non ne fa.
        regia.collegato(&aperto.riferimento).await;
        let poi = s.regia.clone().expect("verificata sopra");
        let riferimento = aperto.riferimento.clone();
        return inoltro::inoltra_ws(
            ws,
            &aperto.indirizzo,
            &segreto,
            &utente,
            &resto,
            req.uri().query(),
            move || {
                tokio::spawn(async move { poi.scollegato(&riferimento).await });
            },
        );
    }

    inoltro::inoltra_http(cliente(), &aperto.indirizzo, &segreto, &utente, &resto, req).await
}

#[cfg(test)]
mod tests {
    use super::e_il_guscio;

    #[test]
    fn il_guscio_e_solo_la_radice() {
        assert!(e_il_guscio("/"));
        assert!(e_il_guscio(""));
        assert!(!e_il_guscio("/api/project"));
        assert!(!e_il_guscio("/ws/tags"));
        // Il documento si serve solo alla radice: un .html più in fondo
        // sarebbe un file del progetto, e quello lo serve il container.
        assert!(!e_il_guscio("/index-admin.html"));
    }
}
