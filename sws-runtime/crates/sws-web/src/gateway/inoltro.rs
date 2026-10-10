//! L'inoltro: il gateway sta in mezzo fra il browser e il container.
//!
//! Il browser parla **solo** col gateway, su un indirizzo del tipo
//! `/p/<azienda>/<progetto>/…`. Il container del progetto non è raggiungibile
//! da fuori: non ha una porta pubblica, e in produzione nemmeno un indirizzo
//! che esca dalla rete di podman. Tutto quello che arriva al prefisso viene
//! rigirato dentro, e la risposta torna indietro.
//!
//! **L'identità la mette il gateway, non il browser.** Al figlio si aggiungono
//! due intestazioni: `X-SWS-Gateway` col segreto concordato e `X-SWS-Utente`
//! con l'email. Il figlio (`--auth-delegata`) crede alla seconda solo se la
//! prima è giusta — vedi `utente_dal_gateway` in `router.rs`. Per questo le
//! stesse due intestazioni, se arrivano dal browser, **si buttano via prima**:
//! senza quella pulizia chiunque potrebbe presentarsi come chi vuole, e il
//! segreto non servirebbe a niente, perché basterebbe che la nostra copia
//! arrivasse *dopo* quella falsa o *prima*, a seconda di come il figlio legge
//! un'intestazione ripetuta. Non si tenta di indovinare quel comportamento: si
//! toglie il dubbio.

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message as TMsg;

/// Il prefisso sotto cui vivono i progetti.
pub const PREFISSO: &str = "/p/";

/// Le intestazioni che non si inoltrano mai, in nessuna delle due direzioni.
///
/// Sono quelle che descrivono **questo** salto e non il messaggio (RFC 9110
/// §7.6.1): rigirarle al salto successivo vuol dire descrivergli una
/// connessione che non è la sua. `host` ce la rimette il client HTTP, e
/// `content-length`/`transfer-encoding` le rimette chi scrive il corpo: qui il
/// corpo passa in streaming e la lunghezza la ricalcola hyper.
const SALTO_PER_SALTO: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
];

/// Le intestazioni che il browser non ha il diritto di scrivere.
///
/// Le prime due sono l'identità delegata (vedi sopra). `accept-encoding` non è
/// una questione di sicurezza ma di contabilità: se il figlio comprimesse, il
/// client HTTP del gateway decomprimerebbe, e a quel punto `content-encoding`
/// descriverebbe un corpo che non esiste più. Verso un container sulla stessa
/// macchina comprimere non guadagna niente, quindi si chiede identity e il
/// problema non si pone.
const DA_TOGLIERE_ANDANDO: &[&str] =
    &["x-sws-gateway", "x-sws-utente", "x-sws-origine", "x-sws-figlio", "accept-encoding"];

/// Spezza `/p/<azienda>/<progetto>/<resto>` nelle sue tre parti.
///
/// Restituisce `None` se il percorso non è sotto il prefisso o se non ha
/// almeno azienda e progetto. Il resto comincia sempre con `/`: `/p/a/n` e
/// `/p/a/n/` danno tutti e due `/`, perché per il figlio sono la stessa cosa —
/// la radice dell'IDE.
pub fn separa_prefisso(percorso: &str) -> Option<(String, String, String)> {
    let dopo = percorso.strip_prefix(PREFISSO)?;
    let mut pezzi = dopo.splitn(3, '/');
    let azienda = pezzi.next().filter(|s| !s.is_empty())?;
    let progetto = pezzi.next().filter(|s| !s.is_empty())?;
    let resto = match pezzi.next() {
        None | Some("") => "/".to_string(),
        Some(r) => format!("/{r}"),
    };
    Some((azienda.to_string(), progetto.to_string(), resto))
}

/// `true` se questa richiesta è un tentativo di passare a WebSocket.
///
/// Si guarda `upgrade`, non `connection`: i proxy di mezzo riscrivono la
/// seconda, e axum stesso accetta l'upgrade basandosi sulla prima.
pub fn e_websocket(h: &HeaderMap) -> bool {
    h.get("upgrade")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("websocket"))
}

/// Le due intestazioni dell'identità delegata, pronte da aggiungere.
fn identita(segreto: &str, utente: &str) -> Option<[(HeaderName, HeaderValue); 2]> {
    Some([
        (
            HeaderName::from_static("x-sws-gateway"),
            HeaderValue::from_str(segreto).ok()?,
        ),
        (
            HeaderName::from_static("x-sws-utente"),
            HeaderValue::from_str(utente).ok()?,
        ),
    ])
}

fn da_saltare(nome: &str, andando: bool) -> bool {
    SALTO_PER_SALTO.iter().any(|x| nome.eq_ignore_ascii_case(x))
        || (andando && DA_TOGLIERE_ANDANDO.iter().any(|x| nome.eq_ignore_ascii_case(x)))
}

/// Inoltra una richiesta HTTP al container e restituisce la sua risposta.
///
/// `indirizzo` è l'origine del figlio (`http://127.0.0.1:34567` oppure
/// `http://sws-p-acme-impianto:8444`), `resto` il percorso già ripulito dal
/// prefisso.
pub async fn inoltra_http(
    cliente: &reqwest::Client,
    indirizzo: &str,
    segreto: &str,
    utente: &str,
    resto: &str,
    req: Request<Body>,
) -> Response {
    let (parti, corpo) = req.into_parts();
    let query = parti.uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    let url = format!("{indirizzo}{resto}{query}");

    let mut verso = cliente.request(parti.method.clone(), &url);
    // L'origine pubblica da cui arriva il lavoro (`https://sws.soligo.net`): il
    // container ci manderà la sua chiave di ritorno, e solo lì (`ritorno.rs`).
    if let Some(o) = crate::gateway::ritorno::origine_della_richiesta(&parti.headers) {
        verso = verso.header("x-sws-origine", o);
    }
    for (nome, valore) in parti.headers.iter() {
        if !da_saltare(nome.as_str(), true) {
            verso = verso.header(nome.clone(), valore.clone());
        }
    }
    let Some(nostre) = identita(segreto, utente) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "identita non rappresentabile in un'intestazione",
        )
            .into_response();
    };
    for (nome, valore) in nostre {
        verso = verso.header(nome, valore);
    }

    // Il corpo passa senza essere raccolto in memoria: fra le richieste che
    // arrivano qui c'è l'importazione di un progetto, che è un file.
    let flusso = corpo.into_data_stream();
    let risposta = match verso.body(reqwest::Body::wrap_stream(flusso)).send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(%url, "inoltro fallito: {e}");
            return (StatusCode::BAD_GATEWAY, format!("il progetto non risponde: {e}"))
                .into_response();
        }
    };

    let mut fuori = Response::builder().status(risposta.status());
    for (nome, valore) in risposta.headers().iter() {
        if !da_saltare(nome.as_str(), false) {
            fuori = fuori.header(nome.clone(), valore.clone());
        }
    }
    let indietro = risposta.bytes_stream();
    fuori
        .body(Body::from_stream(indietro))
        .unwrap_or_else(|e| {
            tracing::error!("risposta del progetto non ricostruibile: {e}");
            StatusCode::BAD_GATEWAY.into_response()
        })
}

/// Inoltra un WebSocket al container.
///
/// Il browser non può scrivere intestazioni nella stretta di mano, quindi il
/// token della sessione viaggia in `?token=…` fino a qui e si ferma qui: verso
/// il figlio l'identità sono le due intestazioni, che un client WebSocket vero
/// — a differenza del browser — può scrivere.
/// `al_termine` si chiama quando il socket si chiude, comunque si chiuda — ed
/// è così che il gateway sa che una finestra se n'è andata. Non c'è un altro
/// momento in cui accorgersene: una scheda chiusa non manda niente.
pub fn inoltra_ws(
    ws: WebSocketUpgrade,
    indirizzo: &str,
    segreto: &str,
    utente: &str,
    resto: &str,
    query: Option<&str>,
    al_termine: impl FnOnce() + Send + 'static,
) -> Response {
    let url = format!(
        "{}{resto}{}",
        indirizzo.replacen("http", "ws", 1),
        query.map(|q| format!("?{q}")).unwrap_or_default()
    );
    let segreto = segreto.to_string();
    let utente = utente.to_string();
    ws.on_upgrade(move |locale| async move {
        pompa(locale, url, segreto, utente).await;
        al_termine();
    })
}

async fn pompa(locale: WebSocket, url: String, segreto: String, utente: String) {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    let mut richiesta = match url.as_str().into_client_request() {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(%url, "ws verso il progetto: indirizzo non valido: {e}");
            return;
        }
    };
    let Some(nostre) = identita(&segreto, &utente) else {
        return;
    };
    for (nome, valore) in nostre {
        richiesta.headers_mut().insert(nome, valore);
    }

    let figlio = match tokio_tungstenite::connect_async(richiesta).await {
        Ok((ws, _)) => ws,
        Err(e) => {
            tracing::warn!(%url, "ws verso il progetto non aperto: {e}");
            return;
        }
    };

    let (mut loc_tx, mut loc_rx) = locale.split();
    let (mut fig_tx, mut fig_rx) = figlio.split();

    let in_giu = async {
        while let Some(Ok(m)) = fig_rx.next().await {
            let Some(m) = tung_in_axum(m) else { continue };
            if loc_tx.send(m).await.is_err() {
                break;
            }
        }
    };
    let in_su = async {
        while let Some(Ok(m)) = loc_rx.next().await {
            let Some(m) = axum_in_tung(m) else { continue };
            if fig_tx.send(m).await.is_err() {
                break;
            }
        }
    };
    tokio::select! { _ = in_giu => {}, _ = in_su => {} }
}

fn tung_in_axum(m: TMsg) -> Option<Message> {
    match m {
        TMsg::Text(t) => Some(Message::Text(t)),
        TMsg::Binary(b) => Some(Message::Binary(b)),
        TMsg::Ping(p) => Some(Message::Ping(p)),
        TMsg::Pong(p) => Some(Message::Pong(p)),
        TMsg::Close(_) | TMsg::Frame(_) => None,
    }
}

fn axum_in_tung(m: Message) -> Option<TMsg> {
    match m {
        Message::Text(t) => Some(TMsg::Text(t)),
        Message::Binary(b) => Some(TMsg::Binary(b)),
        Message::Ping(p) => Some(TMsg::Ping(p)),
        Message::Pong(p) => Some(TMsg::Pong(p)),
        Message::Close(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn separa_le_tre_parti() {
        assert_eq!(
            separa_prefisso("/p/acme/impianto/api/project"),
            Some(("acme".into(), "impianto".into(), "/api/project".into()))
        );
    }

    #[test]
    fn la_radice_del_progetto_e_una_barra_sola() {
        // Le due scritture che il browser produce davvero: il link senza barra
        // finale e quello con. Per il figlio sono la stessa pagina.
        for p in ["/p/acme/impianto", "/p/acme/impianto/"] {
            let (_, _, resto) = separa_prefisso(p).expect(p);
            assert_eq!(resto, "/", "{p}");
        }
    }

    #[test]
    fn fuori_dal_prefisso_non_e_affare_nostro() {
        assert!(separa_prefisso("/api/identita/utenti").is_none());
        assert!(separa_prefisso("/assets/index.js").is_none());
        // Prefisso senza progetto: l'azienda da sola non apre niente.
        assert!(separa_prefisso("/p/acme").is_none());
        assert!(separa_prefisso("/p//impianto").is_none());
    }

    #[test]
    fn il_resto_tiene_le_barre_di_dentro() {
        let (_, _, resto) = separa_prefisso("/p/a/n/api/synoptics/x/y").unwrap();
        assert_eq!(resto, "/api/synoptics/x/y");
    }

    #[test]
    fn lidentita_del_browser_non_passa() {
        // Il punto di tutto il modulo: queste due intestazioni le scrive solo
        // il gateway. Se un giorno sparissero da questa lista, il segreto
        // diventerebbe decorativo.
        assert!(da_saltare("X-SWS-Utente", true));
        assert!(da_saltare("x-sws-gateway", true));
        // Tornando indietro non c'è niente da togliere: le scrive il figlio e
        // non le scrive mai.
        assert!(!da_saltare("x-sws-utente", false));
    }

    #[test]
    fn le_intestazioni_del_salto_non_passano_mai() {
        for h in ["Connection", "upgrade", "Transfer-Encoding", "host", "content-length"] {
            assert!(da_saltare(h, true), "{h} andando");
            assert!(da_saltare(h, false), "{h} tornando");
        }
        assert!(!da_saltare("content-type", true));
        assert!(!da_saltare("authorization", true));
    }

    #[test]
    fn websocket_si_riconosce_dallintestazione_upgrade() {
        let mut h = HeaderMap::new();
        assert!(!e_websocket(&h));
        h.insert("upgrade", HeaderValue::from_static("WebSocket"));
        assert!(e_websocket(&h));
    }
}
