//! Il lato gateway: accetta i tunnel e manda le richieste dentro.
//!
//! Due rotte e un registro.
//!
//! `GET /tunnel/v1` è dove i pannelli chiamano. Chi si presenta con un token
//! valido entra nel registro col proprio nome, e ci resta finché la
//! connessione regge.
//!
//! `/dev/<pannello>/…` è dove l'IDE parla col pannello. Ogni richiesta diventa
//! uno stream nuovo dentro il tunnel di quel pannello, e dentro lo stream si
//! parla HTTP/1.1 — lo stesso che l'IDE manderebbe a un pannello sulla
//! propria rete. **Lo strato remoto non sa che esiste un tunnel**: compone
//! `{base}/api/…` come ha sempre fatto, e `base` adesso è questo indirizzo.

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use http_body_util::BodyExt as _;
use std::sync::Arc;
use tokio_util::compat::FuturesAsyncReadCompatExt as _;

use super::filo::Filo;
use super::multiplex::{avvia, Maniglia, Registro, Verso};

/// Un pannello dichiarato sul gateway.
#[derive(Clone, serde::Deserialize)]
pub struct Dichiarato {
    pub token: String,
    /// **La cartella dell'azienda a cui appartiene.**
    ///
    /// Non è un'etichetta: è ciò che decide chi può parlargli. Un pannello sta
    /// in un impianto di un cliente, e senza questo legame chiunque sia
    /// entrato nel gateway lo raggiungerebbe — di qualunque azienda. Si usa la
    /// **cartella** e non il nome perché è la stessa chiave con cui si
    /// indirizzano i progetti (`/p/<azienda>/…`), e due chiavi diverse per la
    /// stessa cosa prima o poi divergono.
    pub azienda: String,
}

/// Chi può entrare nel tunnel: nome del pannello → token e azienda.
///
/// Prima fetta: si legge dalla configurazione del gateway e non cambia finché
/// non si riavvia. L'abbinamento col codice mostrato dal pannello — che è ciò
/// che userà un cliente — è la fetta dopo, e sostituirà questa mappa senza
/// toccare niente di quello che sta sotto.
#[derive(Default, Clone)]
pub struct Ammessi(pub std::collections::HashMap<String, Dichiarato>);

impl Ammessi {
    /// Legge `<config>/pannelli.yaml`:
    ///
    /// ```yaml
    /// tc620-reparto-nord:
    ///   token: un-token-lungo-almeno-sedici-caratteri
    ///   azienda: acme
    /// ```
    pub fn da_file(percorso: &std::path::Path) -> Self {
        let Ok(testo) = std::fs::read_to_string(percorso) else {
            return Self::default();
        };
        match serde_yaml::from_str::<std::collections::HashMap<String, Dichiarato>>(&testo) {
            Ok(m) => {
                // Un token corto non protegge niente, e un file con dentro
                // `token: 1234` darebbe l'impressione di aver configurato
                // qualcosa. Un pannello senza azienda non si sa a chi
                // mostrarlo, e «a tutti» non è una risposta. Si scartano
                // dicendolo.
                let (buoni, scartati): (Vec<_>, Vec<_>) = m
                    .into_iter()
                    .partition(|(_, d)| d.token.len() >= 16 && !d.azienda.trim().is_empty());
                for (nome, d) in &scartati {
                    let perche = if d.token.len() < 16 {
                        "token più corto di 16 caratteri"
                    } else {
                        "nessuna azienda"
                    };
                    tracing::error!(pannello = %nome, "{perche}: pannello ignorato");
                }
                Self(buoni.into_iter().collect())
            }
            Err(e) => {
                tracing::error!(?percorso, "pannelli.yaml illeggibile: {e}");
                Self::default()
            }
        }
    }

    /// L'azienda di quel pannello, se è dichiarato.
    pub fn azienda_di(&self, pannello: &str) -> Option<&str> {
        self.0.get(pannello).map(|d| d.azienda.as_str())
    }

    /// Il nome del pannello, se le credenziali tornano.
    ///
    /// Il confronto del token è a tempo costante, per lo stesso motivo del
    /// segreto del gateway: su un valore che decide chi sei, un confronto che
    /// esce al primo byte diverso si può misurare.
    pub fn riconosci(&self, intestazioni: &HeaderMap) -> Option<String> {
        let nome = intestazioni.get("x-sws-pannello")?.to_str().ok()?.trim();
        let dato = intestazioni
            .get("authorization")?
            .to_str()
            .ok()?
            .strip_prefix("Bearer ")?;
        let atteso = &self.0.get(nome)?.token;
        crate::router::confronto_costante(dato.as_bytes(), atteso.as_bytes())
            .then(|| nome.to_string())
    }
}

/// `GET /tunnel/v1` — un pannello che chiama.
pub async fn accetta(
    State(s): State<crate::router::AppState>,
    ws: axum::extract::ws::WebSocketUpgrade,
    intestazioni: HeaderMap,
) -> Response {
    let (Some(ammessi), Some(registro)) = (s.pannelli_ammessi.as_ref(), s.tunnel.as_ref()) else {
        return (StatusCode::NOT_FOUND, "questo processo non accetta tunnel").into_response();
    };
    let Some(nome) = ammessi.riconosci(&intestazioni) else {
        // Nessun dettaglio: chi sbaglia il token non deve imparare se ha
        // sbagliato il nome o il segreto.
        return (StatusCode::UNAUTHORIZED, "non riconosciuto").into_response();
    };
    let registro = registro.clone();
    ws.on_upgrade(move |socket| async move {
        tracing::info!(pannello = %nome, "tunnel aperto");
        let filo = Filo::nuovo(socket);
        // `Chiama`: è il gateway ad aprire gli stream, perché è lui ad avere
        // qualcosa da consegnare. Gli stream in arrivo non li aspetta nessuno
        // e il ricevitore si lascia cadere apposta.
        let (maniglia, in_arrivo) = avvia(filo, Verso::Chiama);
        drop(in_arrivo);
        registro.entra(&nome, maniglia.clone()).await;
        // Si resta qui finché il compito che guida yamux non finisce: è
        // quello il momento in cui il pannello è davvero scollegato.
        while maniglia.vivo() {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        registro.esce(&nome).await;
        tracing::info!(pannello = %nome, "tunnel chiuso");
    })
}

/// Chi guarda può parlare con quel pannello?
///
/// Si appoggia alle **stesse** appartenenze che filtrano i progetti, e di
/// proposito: scrivere qui una seconda regola vorrebbe dire due regole da
/// tenere d'accordo, e una delle due resterebbe indietro.
async fn puo_parlargli(
    s: &crate::router::AppState,
    chi: Option<&crate::router::AuthUser>,
    pannello: &str,
) -> bool {
    let Some(ammessi) = s.pannelli_ammessi.as_ref() else {
        return false;
    };
    let Some(azienda) = ammessi.azienda_di(pannello) else {
        return false;
    };
    let app = crate::projects::appartenenze_di(s, chi).await;
    if app.fuori_dal_modello {
        // Nessun modello di identità qui dentro (admin sintetico, dispositivo):
        // è lo stesso «non si filtra e non si nega» dell'elenco dei progetti.
        return true;
    }
    // **La stessa funzione dei progetti**, con la chiave che serve qui. Il `-`
    // è l'azienda implicita, cioè la radice: scritto a mano, `cartelle` non lo
    // conterrebbe mai e un pannello lì dentro sarebbe invisibile a tutti
    // tranne che alla piattaforma — una porta murata invece che chiusa.
    let segmento = (azienda != crate::project_registry::AZIENDA_IMPLICITA).then_some(azienda);
    crate::projects::visibilita(
        segmento,
        &app.cartelle,
        app.implicita,
        chi.is_some_and(|c| c.amministratore_piattaforma),
    )
    .is_some()
}

/// `GET /api/pannelli` — chi è collegato adesso.
pub async fn collegati(State(s): State<crate::router::AppState>, req: Request<Body>) -> Response {
    let Some(r) = s.tunnel.as_ref() else {
        return axum::Json(Vec::<String>::new()).into_response();
    };
    let chi = req.extensions().get::<crate::router::AuthUser>().cloned();
    let figlio = req.extensions().get::<crate::gateway::ritorno::Chiamante>().cloned();
    // L'elenco mostra solo i propri, con lo stesso criterio con cui
    // l'inoltro li lascia passare: un elenco che dice più di quanto si può
    // toccare è un elenco che insegna i nomi degli altri.
    let mut miei = Vec::new();
    for p in r.collegati().await {
        let ok = match &figlio {
            Some(f) => s.pannelli_ammessi.as_ref().and_then(|a| a.azienda_di(&p)).is_some_and(|az| az == f.azienda),
            None => puo_parlargli(&s, chi.as_ref(), &p).await,
        };
        if ok {
            miei.push(p);
        }
    }
    axum::Json(miei).into_response()
}

/// `/dev/:pannello/*resto` — una richiesta dell'IDE, dentro il tunnel.
pub async fn inoltra(
    State(s): State<crate::router::AppState>,
    Path((pannello, _resto)): Path<(String, String)>,
    req: Request<Body>,
) -> Response {
    let Some(registro) = s.tunnel.as_ref() else {
        return (StatusCode::NOT_FOUND, "questo processo non ha tunnel").into_response();
    };

    // **Il pannello di un'altra azienda non esiste.** 404 e non 403, per la
    // stessa ragione di `risolvi_progetto`: un 403 confermerebbe che quel
    // pannello c'è, che è precisamente la cosa da non far sapere. La stessa
    // risposta vale per un pannello mai dichiarato, e va bene così: chi prova
    // nomi a caso non deve imparare quali esistono.
    // Un container di progetto (chiave di ritorno, `gateway/ritorno.rs`) parla
    // coi pannelli della **sua** azienda, e basta. Una persona passa dalle
    // appartenenze, come per i progetti.
    let consentito = match req.extensions().get::<crate::gateway::ritorno::Chiamante>() {
        Some(figlio) => s
            .pannelli_ammessi
            .as_ref()
            .and_then(|a| a.azienda_di(&pannello))
            .is_some_and(|az| az == figlio.azienda),
        None => {
            let chi = req.extensions().get::<crate::router::AuthUser>().cloned();
            puo_parlargli(&s, chi.as_ref(), &pannello).await
        }
    };
    if !consentito {
        return (StatusCode::NOT_FOUND, "pannello non trovato").into_response();
    }

    let Some(maniglia) = registro.di(&pannello).await else {
        // 503 e non 404: il pannello esiste, non è collegato adesso. Sono due
        // cose che chi chiama risolve in modi diversi — una si aspetta, l'altra
        // no.
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            format!("il pannello «{pannello}» non è collegato"),
        )
            .into_response();
    };

    let percorso = req.uri().path();
    let dentro = percorso
        .strip_prefix("/dev/")
        .and_then(|r| r.split_once('/'))
        .map(|(_, resto)| format!("/{resto}"))
        .unwrap_or_else(|| "/".to_string());
    let query = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();

    match attraverso(&maniglia, &dentro, &query, req).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(%pannello, "richiesta nel tunnel fallita: {e}");
            (StatusCode::BAD_GATEWAY, format!("il pannello non risponde: {e}")).into_response()
        }
    }
}

/// Apre uno stream, ci parla HTTP, e torna la risposta.
async fn attraverso(
    maniglia: &Maniglia,
    percorso: &str,
    query: &str,
    req: Request<Body>,
) -> anyhow::Result<Response> {
    let stream = maniglia.apri().await.map_err(|e| anyhow::anyhow!(e))?;
    let io = hyper_util::rt::TokioIo::new(stream.compat());
    let (mut mittente, connessione) = hyper::client::conn::http1::handshake(io).await?;
    // La connessione va fatta girare, o `send_request` resta appesa. Muore da
    // sé quando `mittente` cade, cioè alla fine di questa funzione.
    // `with_upgrades`: dopo un 101 la socket passa a chi l'ha chiesta invece
    // di chiudersi (websocket, vedi sotto).
    tokio::spawn(async move {
        let _ = connessione.with_upgrades().await;
    });

    let (mut parti, corpo) = req.into_parts();
    // **I websocket nel tunnel (10-10-2026).** Senza questo, il pannello
    // rispondeva 101 e il 101 arrivava a chi chiamava, ma i due lati non
    // venivano mai collegati: i tag dal vivo dell'IDE nel cloud
    // (`/ws/remote/tags` → `/dev/<pannello>/ws/tags`) restavano fermi senza un
    // errore da nessuna parte. Si tiene la metà «client» dell'upgrade, e se il
    // pannello accetta si cuciono le due socket.
    let upgrade_dal_client = parti
        .headers
        .contains_key(hyper::header::UPGRADE)
        .then(|| parti.extensions.remove::<hyper::upgrade::OnUpgrade>())
        .flatten();
    let mut dentro = hyper::Request::builder()
        .method(parti.method)
        // `Host` non significa niente qui dentro — dall'altra parte c'è una
        // socket sola — ma HTTP/1.1 lo pretende.
        .uri(format!("http://pannello{percorso}{query}"))
        .header(hyper::header::HOST, "pannello");
    for (nome, valore) in parti.headers.iter() {
        let n = nome.as_str();
        if n.eq_ignore_ascii_case("host") || n.eq_ignore_ascii_case("content-length") {
            continue;
        }
        dentro = dentro.header(nome.clone(), valore.clone());
    }
    let dentro = dentro.body(corpo)?;

    let mut risposta = mittente.send_request(dentro).await?;
    if risposta.status() == StatusCode::SWITCHING_PROTOCOLS {
        if let Some(lato_client) = upgrade_dal_client {
            let lato_pannello = hyper::upgrade::on(&mut risposta);
            tokio::spawn(async move {
                match tokio::try_join!(lato_client, lato_pannello) {
                    Ok((c, p)) => {
                        let mut c = hyper_util::rt::TokioIo::new(c);
                        let mut p = hyper_util::rt::TokioIo::new(p);
                        let _ = tokio::io::copy_bidirectional(&mut c, &mut p).await;
                    }
                    Err(e) => tracing::warn!("websocket nel tunnel non cucito: {e}"),
                }
                drop(mittente);
            });
        }
    }
    let (parti, corpo) = risposta.into_parts();
    let mut fuori = Response::builder().status(parti.status);
    for (nome, valore) in parti.headers.iter() {
        if nome.as_str().eq_ignore_ascii_case("content-length") {
            continue;
        }
        fuori = fuori.header(nome.clone(), valore.clone());
    }
    Ok(fuori.body(Body::new(corpo.map_err(axum::Error::new)))?)
}

/// Il registro vuoto da mettere in `AppState` quando il gateway è acceso.
pub fn registro_nuovo() -> Arc<Registro> {
    Registro::nuovo()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un websocket attraversa il tunnel per davvero: IDE → gateway → yamux →
    /// pannello (eco) e ritorno. È quello che mancava il 10-10-2026: i tag dal
    /// vivo dell'IDE nel cloud restavano fermi.
    #[tokio::test]
    async fn un_websocket_attraversa_il_tunnel() {
        use axum::extract::ws::{Message, WebSocketUpgrade};
        use futures_util::{SinkExt as _, StreamExt as _};
        use tokio_util::compat::TokioAsyncReadCompatExt as _;

        // Il «pannello»: un'eco websocket su una porta locale.
        let eco = axum::Router::new().route(
            "/ws/eco",
            axum::routing::get(|ws: WebSocketUpgrade| async move {
                ws.on_upgrade(|mut s| async move {
                    while let Some(Ok(Message::Text(t))) = s.recv().await {
                        let _ = s.send(Message::Text(format!("eco: {t}"))).await;
                    }
                })
            }),
        );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let porta_pannello = l.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(l, eco).await.unwrap() });

        // Il tunnel, in memoria.
        let (a, b) = tokio::io::duplex(256 * 1024);
        let (maniglia, _) = avvia(a.compat(), Verso::Chiama);
        let (_tieni, mut in_arrivo) = avvia(b.compat(), Verso::Risponde);
        tokio::spawn(async move {
            while let Some(st) = in_arrivo.recv().await {
                tokio::spawn(super::super::pannello::gira_alla_porta(st, porta_pannello));
            }
        });

        // Il «gateway»: inoltra tutto nel tunnel.
        let gw = axum::Router::new().fallback(move |req: Request<Body>| {
            let m = maniglia.clone();
            async move {
                let q = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
                let p = req.uri().path().to_string();
                attraverso(&m, &p, &q, req).await.unwrap()
            }
        });
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let porta_gw = l.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(l, gw).await.unwrap() });

        let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{porta_gw}/ws/eco"))
            .await
            .expect("upgrade attraverso il tunnel");
        use tokio_tungstenite::tungstenite::Message as T;
        ws.send(T::Text("ciao".into())).await.unwrap();
        let r = tokio::time::timeout(std::time::Duration::from_secs(5), ws.next())
            .await
            .expect("risposta entro 5 s")
            .unwrap()
            .unwrap();
        assert_eq!(r.into_text().unwrap(), "eco: ciao");
    }

    fn intestazioni(nome: &str, token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("x-sws-pannello", nome.parse().unwrap());
        h.insert("authorization", format!("Bearer {token}").parse().unwrap());
        h
    }

    fn ammessi() -> Ammessi {
        Ammessi(
            [(
                "tc620".to_string(),
                Dichiarato {
                    token: "un-token-lungo-abbastanza".to_string(),
                    azienda: "acme".to_string(),
                },
            )]
            .into_iter()
            .collect(),
        )
    }

    #[test]
    fn entra_chi_ha_il_token_giusto() {
        let a = ammessi();
        assert_eq!(
            a.riconosci(&intestazioni("tc620", "un-token-lungo-abbastanza")),
            Some("tc620".to_string())
        );
    }

    #[test]
    fn non_entra_nessun_altro() {
        let a = ammessi();
        assert_eq!(a.riconosci(&intestazioni("tc620", "sbagliato")), None);
        assert_eq!(a.riconosci(&intestazioni("altro", "un-token-lungo-abbastanza")), None);
        assert_eq!(a.riconosci(&HeaderMap::new()), None);
        // Senza il prefisso `Bearer ` non si passa: un token nudo
        // nell'intestazione e' un client che non sa cosa sta facendo.
        let mut h = HeaderMap::new();
        h.insert("x-sws-pannello", "tc620".parse().unwrap());
        h.insert("authorization", "un-token-lungo-abbastanza".parse().unwrap());
        assert_eq!(a.riconosci(&h), None);
    }

    #[test]
    fn un_token_corto_o_senza_azienda_non_abilita_niente() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("pannelli.yaml");
        std::fs::write(
            &f,
            "serio:\n  token: un-token-lungo-abbastanza\n  azienda: acme\n\
             sciocco:\n  token: '1234'\n  azienda: acme\n\
             orfano:\n  token: un-altro-token-lungo-cosi\n  azienda: ''\n",
        )
        .unwrap();
        let a = Ammessi::da_file(&f);
        assert!(a.0.contains_key("serio"));
        assert!(!a.0.contains_key("sciocco"), "un token di quattro caratteri non e' un token");
        assert!(
            !a.0.contains_key("orfano"),
            "un pannello senza azienda non si sa a chi mostrarlo, e «a tutti» non e' una risposta"
        );
    }

    #[test]
    fn lazienda_implicita_non_e_un_caso_a_parte() {
        use crate::project_registry::AZIENDA_IMPLICITA;
        use crate::projects::visibilita;
        // Un pannello dichiarato con `-` sta nella radice, come i progetti
        // della radice. Chi fa parte dell'azienda implicita lo vede; chi no,
        // no. Senza questo passaggio `cartelle` non conterrebbe mai `-` e il
        // pannello sarebbe invisibile a tutti tranne che alla piattaforma.
        let segmento = (AZIENDA_IMPLICITA != AZIENDA_IMPLICITA).then_some(AZIENDA_IMPLICITA);
        assert!(visibilita(segmento, &[], true, false).is_some(), "membro della radice");
        assert!(visibilita(segmento, &[], false, false).is_none(), "estraneo alla radice");
        assert!(visibilita(segmento, &[], false, true).is_some(), "piattaforma");
    }

    #[test]
    fn lazienda_del_pannello_si_sa() {
        assert_eq!(ammessi().azienda_di("tc620"), Some("acme"));
        assert_eq!(ammessi().azienda_di("mai-visto"), None);
    }

    #[test]
    fn senza_file_non_entra_nessuno() {
        let a = Ammessi::da_file(std::path::Path::new("/non/esiste/pannelli.yaml"));
        assert!(a.0.is_empty());
        assert_eq!(a.riconosci(&intestazioni("tc620", "qualunque")), None);
    }
}
