//! Lo schermo del pannello dal cloud (29-10-2026, piano
//! `docs/plans/2026-10-29-schermo-remoto.md`).
//!
//! Dall'IDE su sws.soligo.net il tasto Viewer apre in una scheda la **pagina
//! operatore del pannello**, coi suoi valori, attraverso il tunnel: un'anteprima
//! dell'accesso remoto, al posto di VNC. Si entra come chi sta davanti allo
//! schermo, senza login del pannello; il login, se serve, è quello del pannello.
//!
//! Due lati in questo file.
//!
//! **Il gateway** dà un *biglietto* monouso a chi può parlare col pannello
//! (`POST /api/pannelli/:nome/schermo`), e lo scambia con un **cookie tecnico**
//! ristretto a `/schermo/<pannello>/`. Serve perché nel cloud la sessione è un
//! gettone `Bearer`, e una scheda nuova o un websocket non lo possono mandare.
//! Il cookie si toglie prima di entrare nel tunnel: il pannello non vede mai le
//! credenziali del cloud. `Authorization` invece passa com'è: è il login del
//! pannello, se l'utente lo fa.
//!
//! **Il pannello** risponde a `/schermo/*` sulla porta di gestione girando la
//! richiesta alla propria pagina operatore, **solo con la firma del gateway**:
//! la porta di gestione è raggiungibile in rete locale, e non deve diventare una
//! seconda porta della pagina operatore.

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::abbinamento::INTESTAZIONE_GATEWAY;
use crate::router::{AppState, AuthUser};

/// Il cookie dello schermo: uno per pannello, ristretto al suo percorso.
pub const NOME_COOKIE: &str = "sws_schermo";
/// Quanto vale un biglietto: il tempo di aprire la scheda.
const DURATA_BIGLIETTO: Duration = Duration::from_secs(60);
/// Quanto vale lo schermo aperto: come una sessione dell'IDE.
const DURATA_SESSIONE: Duration = Duration::from_secs(8 * 3600);

// ── Il pannello ──────────────────────────────────────────────────────────────

/// La pagina operatore di questo processo: porta e TLS. La imposta `main` quando
/// lega la porta del viewer; un runtime senza pagina operatore non la imposta.
static PAGINA: OnceLock<(u16, bool)> = OnceLock::new();

pub fn imposta_pagina_operatore(porta: u16, tls: bool) {
    let _ = PAGINA.set((porta, tls));
}

/// Il percorso della pagina operatore dentro `/schermo…`.
pub fn percorso_della_pagina(percorso: &str) -> String {
    match percorso.strip_prefix("/schermo") {
        Some("") => "/".to_string(),
        Some(resto) if resto.starts_with('/') => resto.to_string(),
        _ => "/".to_string(),
    }
}

/// `/schermo` e `/schermo/*` sulla porta di gestione del pannello.
pub async fn dal_gateway(State(s): State<AppState>, mut req: Request<Body>) -> Response {
    // Senza la firma del gateway non esiste: 404 come per una rotta che non c'è.
    if !s.abbinamento.firma_valida(req.headers()) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(&(porta, tls)) = PAGINA.get() else {
        return (StatusCode::NOT_FOUND, "questo runtime non ha una pagina operatore").into_response();
    };
    req.headers_mut().remove(INTESTAZIONE_GATEWAY);
    req.headers_mut().remove(header::COOKIE);
    let percorso = percorso_della_pagina(req.uri().path());
    let query = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
    match verso_la_pagina(porta, tls, &percorso, &query, req).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("schermo remoto: la pagina operatore non risponde: {e}");
            (StatusCode::BAD_GATEWAY, format!("la pagina operatore non risponde: {e}")).into_response()
        }
    }
}

async fn verso_la_pagina(porta: u16, tls: bool, percorso: &str, query: &str, req: Request<Body>) -> anyhow::Result<Response> {
    let tcp = tokio::net::TcpStream::connect(("127.0.0.1", porta)).await?;
    if tls {
        let nome = rustls::pki_types::ServerName::IpAddress(std::net::Ipv4Addr::LOCALHOST.into());
        let sicura = tokio_rustls::TlsConnector::from(crate::tunnel::pannello::config_loopback())
            .connect(nome, tcp)
            .await?;
        crate::tunnel::http::http_su(sicura, percorso, query, req).await
    } else {
        crate::tunnel::http::http_su(tcp, percorso, query, req).await
    }
}

// ── Il gateway ───────────────────────────────────────────────────────────────

struct Voce {
    pannello: String,
    utente: String,
    /// Il gettone della sessione cloud di chi l'ha aperto: lo schermo vale
    /// finché vale lei. `None` solo su un gateway senza autenticazione.
    gettone: Option<String>,
    scade: Instant,
}

/// Chi ha aperto uno schermo: il nome per il registro, il gettone per
/// ricontrollare a ogni richiesta che possa ancora farlo.
pub type Apertura = (String, Option<String>);

static BIGLIETTI: Mutex<Option<HashMap<String, Voce>>> = Mutex::new(None);
static SESSIONI: Mutex<Option<HashMap<String, Voce>>> = Mutex::new(None);

fn casuale() -> String {
    // `/dev/urandom`, come i gettoni del telefono: niente crate in più.
    let mut b = [0u8; 32];
    {
        use std::io::Read as _;
        let _ = std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut b));
    }
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn metti(dove: &Mutex<Option<HashMap<String, Voce>>>, pannello: &str, (utente, gettone): Apertura, durata: Duration) -> String {
    let codice = casuale();
    let mut g = dove.lock().unwrap_or_else(|e| e.into_inner());
    let m = g.get_or_insert_with(HashMap::new);
    let adesso = Instant::now();
    m.retain(|_, v| v.scade > adesso);
    m.insert(codice.clone(), Voce { pannello: pannello.to_string(), utente, gettone, scade: adesso + durata });
    codice
}

/// Un biglietto per lo schermo di `pannello`, a nome di chi lo chiede.
pub fn emetti_biglietto(pannello: &str, chi: Apertura) -> String {
    metti(&BIGLIETTI, pannello, chi, DURATA_BIGLIETTO)
}

/// Il biglietto si usa una volta sola, e solo per il suo pannello.
pub fn consuma_biglietto(codice: &str, pannello: &str) -> Option<Apertura> {
    let mut g = BIGLIETTI.lock().unwrap_or_else(|e| e.into_inner());
    let v = g.as_mut()?.remove(codice)?;
    (v.pannello == pannello && v.scade > Instant::now()).then_some((v.utente, v.gettone))
}

pub fn apri_sessione(pannello: &str, chi: Apertura) -> String {
    metti(&SESSIONI, pannello, chi, DURATA_SESSIONE)
}

/// Chi ha aperto lo schermo con questo cookie, se vale per questo pannello.
pub fn sessione(id: &str, pannello: &str) -> Option<Apertura> {
    let g = SESSIONI.lock().unwrap_or_else(|e| e.into_inner());
    let v = g.as_ref()?.get(id)?;
    (v.pannello == pannello && v.scade > Instant::now()).then(|| (v.utente.clone(), v.gettone.clone()))
}

/// Chi apre lo schermo **adesso**: la sessione cloud del gettone, se vale ancora.
/// Così lo schermo si chiude con lei (logout, scadenza), e chi esce
/// dall'azienda o vede il pannello spostato altrove smette di vederlo subito.
async fn chi_adesso(s: &AppState, gettone: Option<&str>) -> Option<AuthUser> {
    let fonte = crate::router::fonte_auth_corrente(s).await;
    match gettone {
        Some(g) => crate::router::utente_del_gettone(s, fonte, g).await,
        None if fonte == crate::router::FonteAutenticazione::Nessuna => Some(crate::router::admin_sintetico()),
        None => None,
    }
}

/// Il valore del cookie dello schermo, se la richiesta lo porta.
pub fn cookie_di(intestazioni: &HeaderMap) -> Option<String> {
    intestazioni
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|c| c.trim().split_once('='))
        .find(|(n, _)| *n == NOME_COOKIE)
        .map(|(_, v)| v.to_string())
}

/// L'intestazione che posa il cookie: solo HTTPS, invisibile agli script, solo
/// dallo stesso sito, e solo sotto lo schermo di quel pannello.
pub fn posa_cookie(pannello: &str, id: &str) -> String {
    format!(
        "{NOME_COOKIE}={id}; Path=/schermo/{pannello}/; Max-Age={}; HttpOnly; Secure; SameSite=Strict",
        DURATA_SESSIONE.as_secs()
    )
}

/// Il biglietto nella query, se c'è.
fn biglietto_nella_query(query: Option<&str>) -> Option<String> {
    query?
        .split('&')
        .filter_map(|c| c.split_once('='))
        .find(|(n, _)| *n == "biglietto")
        .map(|(_, v)| v.to_string())
}

/// `POST /api/pannelli/:nome/schermo` — il biglietto per aprire lo schermo.
///
/// Solo una **persona**: il container di un progetto parla coi pannelli della
/// sua azienda, ma uno schermo lo apre qualcuno, e il registro deve dire chi.
pub async fn biglietto(State(s): State<AppState>, Path(nome): Path<String>, req: Request<Body>) -> Response {
    let gettone = crate::router::token_della_richiesta(&req);
    let Some(chi) = req.extensions().get::<AuthUser>().cloned() else {
        return (StatusCode::FORBIDDEN, "lo schermo lo apre una persona, dall'IDE o dalla console").into_response();
    };
    if !crate::tunnel::gateway::puo_parlargli(&s, Some(&chi), &nome).await {
        return (StatusCode::NOT_FOUND, "pannello non trovato").into_response();
    }
    let Some(abbinati) = s.pannelli_abbinati.as_ref() else {
        return (StatusCode::NOT_FOUND, "pannello non trovato").into_response();
    };
    if abbinati.per_nome(&nome).is_none() {
        // I pannelli dichiarati a mano non conoscono la firma del gateway.
        return (StatusCode::CONFLICT, "lo schermo remoto c'è solo per i pannelli abbinati col codice").into_response();
    }
    if !abbinati.schermo_acceso(&nome) {
        return (StatusCode::FORBIDDEN, "lo schermo remoto di questo pannello è spento (console → Pannelli)").into_response();
    }
    let collegato = match s.tunnel.as_ref() {
        Some(r) => r.di(&nome).await.is_some(),
        None => false,
    };
    if !collegato {
        return (StatusCode::SERVICE_UNAVAILABLE, format!("il pannello «{nome}» non è collegato")).into_response();
    }
    let codice = emetti_biglietto(&nome, (chi.username.clone(), gettone));
    s.audit.log("pannello.schermo", Some(chi.username.clone()), serde_json::json!({ "pannello": nome }));
    axum::Json(serde_json::json!({ "url": format!("/schermo/{nome}/?biglietto={codice}") })).into_response()
}

fn non_valido() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        "Lo schermo del pannello si apre dall'IDE o dalla console (tasto Viewer): questa sessione è scaduta o non è valida.\n\
         Open the panel screen from the IDE or the console (Viewer button): this session has expired or is not valid.\n",
    )
        .into_response()
}

/// `/schermo/:pannello` e `/schermo/:pannello/*` sul gateway.
pub async fn schermo(State(s): State<AppState>, mut req: Request<Body>) -> Response {
    let percorso = req.uri().path().to_string();
    let Some(resto) = percorso.strip_prefix("/schermo/") else { return StatusCode::NOT_FOUND.into_response() };
    let (pannello, dentro) = match resto.split_once('/') {
        Some((p, d)) => (p.to_string(), format!("/{d}")),
        None => {
            // Senza la barra finale gli indirizzi relativi della pagina
            // salirebbero di un livello: si rimanda alla forma giusta.
            let query = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
            return (StatusCode::PERMANENT_REDIRECT, [(header::LOCATION, format!("/schermo/{resto}/{query}"))]).into_response();
        }
    };

    // Il biglietto si scambia col cookie, e si torna alla pagina senza.
    if let Some(codice) = biglietto_nella_query(req.uri().query()) {
        let Some(chi) = consuma_biglietto(&codice, &pannello) else { return non_valido() };
        let id = apri_sessione(&pannello, chi);
        return (
            StatusCode::SEE_OTHER,
            [(header::SET_COOKIE, posa_cookie(&pannello, &id)), (header::LOCATION, format!("/schermo/{pannello}/"))],
        )
            .into_response();
    }

    let Some(id) = cookie_di(req.headers()) else { return non_valido() };
    let Some((_, gettone)) = sessione(&id, &pannello) else { return non_valido() };
    let Some(chi) = chi_adesso(&s, gettone.as_deref()).await else { return non_valido() };
    // Come il tunnel: un pannello che non è della tua azienda non esiste.
    if !crate::tunnel::gateway::puo_parlargli(&s, Some(&chi), &pannello).await {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Spento dalla console mentre era aperto: si chiude subito.
    if !s.pannelli_abbinati.as_ref().is_some_and(|a| a.schermo_acceso(&pannello)) {
        return (StatusCode::FORBIDDEN, "lo schermo remoto di questo pannello è spento").into_response();
    }
    let Some(maniglia) = (match s.tunnel.as_ref() {
        Some(r) => r.di(&pannello).await,
        None => None,
    }) else {
        return (StatusCode::SERVICE_UNAVAILABLE, format!("il pannello «{pannello}» non è collegato")).into_response();
    };

    // Le credenziali del cloud non entrano nel tunnel; la firma sì.
    req.headers_mut().remove(header::COOKIE);
    req.headers_mut().remove(INTESTAZIONE_GATEWAY);
    if let Some(firma) = crate::tunnel::gateway::firma_per(&s, &pannello) {
        if let Ok(v) = firma.parse() {
            req.headers_mut().insert(INTESTAZIONE_GATEWAY, v);
        }
    }
    let query = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
    match crate::tunnel::gateway::attraverso(&maniglia, &format!("/schermo{dentro}"), &query, req).await {
        // Un pannello di una versione che non conosce lo schermo risponde 404
        // alla radice: lo si dice, invece di una pagina bianca.
        Ok(r) if r.status() == StatusCode::NOT_FOUND && dentro == "/" => (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            "Questo pannello non sa ancora mostrare lo schermo remoto: va aggiornato.\n\
             This panel can't show the remote screen yet: it needs an update.\n",
        )
            .into_response(),
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(%pannello, "schermo remoto: richiesta nel tunnel fallita: {e}");
            (StatusCode::BAD_GATEWAY, format!("il pannello non risponde: {e}")).into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn il_percorso_della_pagina_toglie_il_prefisso() {
        assert_eq!(percorso_della_pagina("/schermo"), "/");
        assert_eq!(percorso_della_pagina("/schermo/"), "/");
        assert_eq!(percorso_della_pagina("/schermo/assets/main.js"), "/assets/main.js");
        assert_eq!(percorso_della_pagina("/schermo/ws/tags"), "/ws/tags");
        assert_eq!(percorso_della_pagina("/schermofuori"), "/", "non è sotto /schermo");
    }

    #[test]
    fn il_biglietto_vale_una_volta_e_solo_per_il_suo_pannello() {
        let chi = || ("mauro@example.com".to_string(), Some("gettone".to_string()));
        let b = emetti_biglietto("tc620-garage", chi());
        assert_eq!(consuma_biglietto(&b, "altro-pannello"), None, "per un altro pannello no");
        assert_eq!(consuma_biglietto(&b, "tc620-garage"), None, "consumato anche dal tentativo sbagliato");
        let b = emetti_biglietto("tc620-garage", chi());
        assert_eq!(consuma_biglietto(&b, "tc620-garage"), Some(chi()), "chi e il suo gettone passano alla sessione");
        assert_eq!(consuma_biglietto(&b, "tc620-garage"), None, "una volta sola");
    }

    #[test]
    fn la_sessione_vale_solo_per_il_suo_pannello() {
        let id = apri_sessione("tc620-garage", ("mauro@example.com".to_string(), None));
        assert_eq!(sessione(&id, "tc620-garage").map(|(u, _)| u).as_deref(), Some("mauro@example.com"));
        assert_eq!(sessione(&id, "wp630"), None);
        assert_eq!(sessione("inventato", "tc620-garage"), None);
    }

    #[test]
    fn il_cookie_si_legge_fra_gli_altri_e_si_posa_ristretto() {
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, "altro=1; sws_schermo=abc123; terzo=x".parse().unwrap());
        assert_eq!(cookie_di(&h).as_deref(), Some("abc123"));
        assert_eq!(cookie_di(&HeaderMap::new()), None);
        let c = posa_cookie("tc620-garage", "abc");
        for pezzo in ["sws_schermo=abc", "Path=/schermo/tc620-garage/", "HttpOnly", "Secure", "SameSite=Strict"] {
            assert!(c.contains(pezzo), "{c} senza {pezzo}");
        }
    }

    /// Il pannello gira alla propria pagina operatore una GET e un websocket:
    /// i tag dal vivo dello schermo remoto passano di qui.
    #[tokio::test]
    async fn la_pagina_operatore_risponde_attraverso_il_giro() {
        use axum::extract::ws::{Message, WebSocketUpgrade};
        use futures_util::{SinkExt as _, StreamExt as _};

        // La «pagina operatore»: una pagina e un'eco websocket.
        let pagina = axum::Router::new()
            .route("/", axum::routing::get(|| async { "pagina operatore" }))
            .route(
                "/ws/tags",
                axum::routing::get(|ws: WebSocketUpgrade| async move {
                    ws.on_upgrade(|mut s| async move {
                        while let Some(Ok(Message::Text(t))) = s.recv().await {
                            let _ = s.send(Message::Text(format!("tag: {t}"))).await;
                        }
                    })
                }),
            );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let porta_pagina = l.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(l, pagina).await.unwrap() });

        // Il giro del pannello, senza la firma (la verifica `dal_gateway`).
        let giro = axum::Router::new().fallback(move |req: Request<Body>| async move {
            let p = percorso_della_pagina(req.uri().path());
            verso_la_pagina(porta_pagina, false, &p, "", req).await.unwrap()
        });
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let porta_giro = l.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(l, giro).await.unwrap() });

        let testo = reqwest::get(format!("http://127.0.0.1:{porta_giro}/schermo/")).await.unwrap().text().await.unwrap();
        assert_eq!(testo, "pagina operatore");

        let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{porta_giro}/schermo/ws/tags"))
            .await
            .expect("upgrade attraverso il giro");
        use tokio_tungstenite::tungstenite::Message as T;
        ws.send(T::Text("caldaia".into())).await.unwrap();
        let r = tokio::time::timeout(Duration::from_secs(5), ws.next()).await.expect("entro 5 s").unwrap().unwrap();
        assert_eq!(r.into_text().unwrap(), "tag: caldaia");
    }

    #[test]
    fn il_biglietto_si_trova_nella_query() {
        assert_eq!(biglietto_nella_query(Some("biglietto=xyz")).as_deref(), Some("xyz"));
        assert_eq!(biglietto_nella_query(Some("a=1&biglietto=xyz")).as_deref(), Some("xyz"));
        assert_eq!(biglietto_nella_query(Some("a=1")), None);
        assert_eq!(biglietto_nella_query(None), None);
    }
}
