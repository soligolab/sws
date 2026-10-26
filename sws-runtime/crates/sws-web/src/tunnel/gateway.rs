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

    // **Un pannello in attesa di abbinamento** (11-10-2026): si presenta col
    // codice e l'identità hardware. Entra in una sala d'attesa in memoria, per
    // codice, da cui nessuna rotta lo raggiunge finché qualcuno non lo abbina.
    if let Some(codice) = intestazioni.get("x-sws-attesa").and_then(|v| v.to_str().ok()) {
        return accetta_in_attesa(&s, ws, codice, &intestazioni).await;
    }

    // Prima i dichiarati a mano (`pannelli.yaml`), poi gli abbinati col codice.
    let nome = match ammessi.riconosci(&intestazioni) {
        Some(n) => n,
        None => match riconosci_abbinato(&s, &intestazioni) {
            Ok(n) => n,
            Err(crate::tunnel::abbinati::Rifiuto::NonAmmesso) => {
                return (StatusCode::FORBIDDEN, "pannello sospeso o bandito").into_response();
            }
            // Nessun dettaglio: chi sbaglia il token non deve imparare se ha
            // sbagliato il nome o il segreto.
            Err(_) => return (StatusCode::UNAUTHORIZED, "non riconosciuto").into_response(),
        },
    };
    let registro = registro.clone();
    ws.on_upgrade(move |socket| async move {
        tracing::info!(pannello = %nome, "tunnel aperto");
        let filo = Filo::nuovo(socket);
        // `Chiama`: è il gateway ad aprire gli stream, perché è lui ad avere
        // qualcosa da consegnare. Gli stream che arrivano dal pannello sono i
        // suoi battiti (un byte `\0`) e l'annuncio dello spegnimento (`S`).
        let (maniglia, mut in_arrivo) = avvia(filo, Verso::Chiama);
        registro.entra(&nome, maniglia.clone()).await;
        let annunciato = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut sentito: Option<std::time::Instant> = None;
        let mut passo = tokio::time::interval(std::time::Duration::from_secs(2));
        // Si resta qui finché il compito che guida yamux non finisce, o finché
        // il pannello non tace troppo a lungo (ramo 7 dei residui, 26-10-2026).
        loop {
            tokio::select! {
                arrivato = in_arrivo.recv() => {
                    let Some(stream) = arrivato else { break };
                    sentito = Some(std::time::Instant::now());
                    let annunciato = annunciato.clone();
                    tokio::spawn(async move {
                        use futures_util::io::AsyncReadExt as _;
                        let mut s = stream;
                        let mut byte = [0u8; 1];
                        let letto = tokio::time::timeout(std::time::Duration::from_secs(5), s.read_exact(&mut byte)).await;
                        if matches!(letto, Ok(Ok(()))) && byte[0] == b'S' {
                            annunciato.store(true, std::sync::atomic::Ordering::Relaxed);
                        }
                    });
                }
                _ = passo.tick() => {
                    if !maniglia.vivo() {
                        break;
                    }
                    if muto(sentito, std::time::Instant::now()) {
                        tracing::warn!(pannello = %nome, "tunnel muto da oltre {}s, lo chiudo", SILENZIO_MASSIMO.as_secs());
                        maniglia.chiudi();
                        break;
                    }
                }
            }
        }
        registro.esce(&nome, &maniglia).await;
        if annunciato.load(std::sync::atomic::Ordering::Relaxed) {
            registro.spento(&nome, crate::tunnel::abbinati::ora_ms());
            tracing::info!(pannello = %nome, "tunnel chiuso: spegnimento annunciato");
        } else {
            tracing::info!(pannello = %nome, "tunnel chiuso");
        }
    })
}

/// Dopo quanto silenzio un tunnel si dà per morto: tre battiti del pannello
/// (uno ogni 30 s) più margine. È il buco che il ramo 7 dei residui chiudeva:
/// su una half-open — il NAT che dimentica la connessione senza dire niente —
/// yamux non si accorge di nulla, e il pallino della console restava verde
/// finché qualcuno non provava a inoltrare una richiesta.
const SILENZIO_MASSIMO: std::time::Duration = std::time::Duration::from_secs(95);

/// Il pannello tace da troppo. **Solo se ha battuto almeno una volta**: un
/// pannello di prima del 16-10-2026 non batte, e chiudergli il tunnel ogni
/// minuto e mezzo sarebbe peggio della malattia — per lui vale ancora la sola
/// caduta della connessione.
fn muto(sentito: Option<std::time::Instant>, adesso: std::time::Instant) -> bool {
    sentito.is_some_and(|t| adesso.duration_since(t) > SILENZIO_MASSIMO)
}

#[cfg(test)]
mod prove_silenzio {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn muto_solo_dopo_il_silenzio_e_solo_chi_ha_battuto() {
        let t = Instant::now();
        assert!(!muto(None, t + Duration::from_secs(3600)), "chi non ha mai battuto non è muto");
        assert!(!muto(Some(t), t + Duration::from_secs(60)), "un battito saltato non basta");
        assert!(muto(Some(t), t + SILENZIO_MASSIMO + Duration::from_secs(1)));
        assert!(SILENZIO_MASSIMO > 3 * Duration::from_secs(30), "almeno tre battiti del pannello");
    }
}

/// Un pannello abbinato col codice: nome e token nelle stesse intestazioni dei
/// dichiarati, il token ricalcolato dal segreto.
fn riconosci_abbinato(
    s: &crate::router::AppState,
    intestazioni: &HeaderMap,
) -> Result<String, crate::tunnel::abbinati::Rifiuto> {
    use crate::tunnel::abbinati::Rifiuto;
    let abbinati = s.pannelli_abbinati.as_ref().ok_or(Rifiuto::NonRiconosciuto)?;
    let segreto = s.regia.as_ref().map(|r| r.segreto().to_string()).ok_or(Rifiuto::NonRiconosciuto)?;
    let nome = intestazioni
        .get("x-sws-pannello")
        .and_then(|v| v.to_str().ok())
        .ok_or(Rifiuto::NonRiconosciuto)?
        .trim();
    let token = intestazioni
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(Rifiuto::NonRiconosciuto)?;
    let p = abbinati.riconosci(&segreto, nome, token)?;
    abbinati.visto(&p.nome);
    Ok(p.nome)
}

async fn accetta_in_attesa(
    s: &crate::router::AppState,
    ws: axum::extract::ws::WebSocketUpgrade,
    codice: &str,
    intestazioni: &HeaderMap,
) -> Response {
    let (Some(attesa), Some(abbinati)) = (s.pannelli_in_attesa.clone(), s.pannelli_abbinati.clone()) else {
        return (StatusCode::NOT_FOUND, "questo processo non abbina pannelli").into_response();
    };
    let Some(codice) = crate::abbinamento::normalizza(codice) else {
        return (StatusCode::BAD_REQUEST, "codice non valido").into_response();
    };
    let testo = |n: &str| {
        intestazioni
            .get(n)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.trim().chars().take(200).collect::<String>())
            .filter(|v| !v.is_empty())
    };
    let Some(hw) = testo("x-sws-hw") else {
        return (StatusCode::BAD_REQUEST, "manca l'identità hardware").into_response();
    };
    if abbinati.bandito(&hw) {
        return (StatusCode::FORBIDDEN, "pannello bandito").into_response();
    }
    let nome_proposto = testo("x-sws-nome").unwrap_or_else(|| "pannello".into());
    ws.on_upgrade(move |socket| async move {
        let filo = Filo::nuovo(socket);
        let (maniglia, in_arrivo) = avvia(filo, Verso::Chiama);
        drop(in_arrivo);
        let voce = crate::tunnel::abbinati::Attesa { maniglia: maniglia.clone(), hw: hw.clone(), nome_proposto };
        if !attesa.entra(&codice, voce).await {
            tracing::warn!("troppi pannelli in attesa: rifiuto");
            return;
        }
        tracing::info!(%hw, "pannello in attesa di abbinamento collegato");
        while maniglia.vivo() {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        attesa.esce(&codice, &hw).await;
    })
}

/// L'azienda di un pannello: dichiarato a mano o abbinato col codice.
pub fn azienda_del_pannello(s: &crate::router::AppState, pannello: &str) -> Option<String> {
    if let Some(a) = s.pannelli_ammessi.as_ref().and_then(|a| a.azienda_di(pannello)) {
        return Some(a.to_string());
    }
    s.pannelli_abbinati.as_ref().and_then(|a| a.azienda_di(pannello))
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
    let Some(azienda) = azienda_del_pannello(s, pannello) else {
        return false;
    };
    let azienda = azienda.as_str();
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
            Some(f) => azienda_del_pannello(&s, &p).is_some_and(|az| az == f.azienda),
            None => puo_parlargli(&s, chi.as_ref(), &p).await,
        };
        if ok {
            miei.push(p);
        }
    }
    axum::Json(miei).into_response()
}

/// `POST /telefono/:pannello/:tipo` — Twilio che richiama un pannello (P4,
/// 26-10-2026): il tasto premuto in una chiamata (`voce`) o la risposta a un
/// SMS (`sms`). **Senza sessione**, perché Twilio non ne ha una: il gateway
/// inoltra solo quei due percorsi e aggiunge l'URL pubblico chiamato, che il
/// pannello usa per verificare la firma di Twilio. La firma del gateway non
/// passa: questa strada non porta nessuna fiducia del gateway.
pub async fn inoltra_telefono(
    State(s): State<crate::router::AppState>,
    Path((pannello, tipo)): Path<(String, String)>,
    mut req: Request<Body>,
) -> Response {
    req.headers_mut().remove(crate::abbinamento::INTESTAZIONE_GATEWAY);
    if tipo != "voce" && tipo != "sms" {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(registro) = s.tunnel.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(maniglia) = registro.di(&pannello).await else {
        return (StatusCode::SERVICE_UNAVAILABLE, "pannello non collegato").into_response();
    };
    let h = req.headers();
    let host = h.get("x-forwarded-host").or_else(|| h.get("host")).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let proto = h.get("x-forwarded-proto").and_then(|v| v.to_str().ok()).filter(|p| *p == "http" || *p == "https").unwrap_or("https").to_string();
    let query = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
    let pubblico = format!("{proto}://{host}{}{query}", req.uri().path());
    if let Ok(v) = pubblico.parse() {
        req.headers_mut().insert(crate::telefono::INTESTAZIONE_URL, v);
    }
    match attraverso(&maniglia, &format!("/api/telefono/{tipo}"), &query, req).await {
        Ok(r) => r,
        Err(e) => (StatusCode::BAD_GATEWAY, format!("il pannello non risponde: {e}")).into_response(),
    }
}

/// `/dev/:pannello/*resto` — una richiesta dell'IDE, dentro il tunnel.
pub async fn inoltra(
    State(s): State<crate::router::AppState>,
    Path((pannello, _resto)): Path<(String, String)>,
    mut req: Request<Body>,
) -> Response {
    // **La firma del gateway** (fetta E, 11-10-2026): chi chiama non deve
    // poterla portare da fuori — si toglie sempre, e si rimette sotto, solo
    // verso un pannello abbinato e solo dopo i controlli di sempre.
    req.headers_mut().remove(crate::abbinamento::INTESTAZIONE_GATEWAY);
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
        Some(figlio) => azienda_del_pannello(&s, &pannello).is_some_and(|az| az == figlio.azienda),
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

    if let Some(firma) = firma_per(&s, &pannello) {
        if let Ok(v) = firma.parse() {
            req.headers_mut().insert(crate::abbinamento::INTESTAZIONE_GATEWAY, v);
        }
    }

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

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Abbina {
    codice: String,
    #[serde(default)]
    nome: Option<String>,
    /// Il primo amministratore del pannello, se è nuovo; un Admin esistente,
    /// se il pannello ha già utenti. Il pannello decide quale dei due.
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
    /// Solo per chi amministra la piattaforma: a quale azienda va il pannello.
    #[serde(default)]
    azienda: Option<String>,
}

/// `POST /api/pannelli/abbina` — abbina al gateway il pannello in attesa con
/// quel codice (11-10-2026, fetta D).
///
/// Chi chiama: il container di un progetto con la sua chiave di ritorno (il
/// pannello va all'azienda del progetto), o chi amministra la piattaforma
/// (azienda nel corpo, `-` se manca). Il gateway prepara nome e token, li
/// manda al pannello **attraverso il suo tunnel in attesa** insieme al codice
/// e alle credenziali, e salva la riga solo se il pannello accetta: il
/// pannello si tiene token e nome e si ricollega da abbinato.
pub async fn abbina(State(s): State<crate::router::AppState>, req: Request<Body>) -> Response {
    let errore = |stato: StatusCode, testo: &str| {
        (stato, axum::Json(serde_json::json!({ "error": "abbinamento", "detail": testo }))).into_response()
    };
    let (Some(abbinati), Some(attesa), Some(registro)) =
        (s.pannelli_abbinati.clone(), s.pannelli_in_attesa.clone(), s.tunnel.clone())
    else {
        return errore(StatusCode::NOT_FOUND, "questo processo non abbina pannelli");
    };
    let segreto = s.regia.as_ref().map(|r| r.segreto().to_string()).unwrap_or_default();
    let figlio = req.extensions().get::<crate::gateway::ritorno::Chiamante>().cloned();
    let chi = req.extensions().get::<crate::router::AuthUser>().cloned();
    let origine = crate::gateway::ritorno::origine_della_richiesta(req.headers());
    let corpo = match axum::body::to_bytes(req.into_body(), 16 * 1024).await {
        Ok(b) => b,
        Err(_) => return errore(StatusCode::BAD_REQUEST, "corpo illeggibile"),
    };
    let r: Abbina = match serde_json::from_slice(&corpo) {
        Ok(r) => r,
        Err(e) => return errore(StatusCode::BAD_REQUEST, &format!("json: {e}")),
    };
    let azienda = match (figlio, chi) {
        (Some(f), _) => f.azienda,
        (None, Some(u)) if u.amministratore_piattaforma => r
            .azienda
            .clone()
            .unwrap_or_else(|| crate::project_registry::AZIENDA_IMPLICITA.to_string()),
        _ => {
            return errore(
                StatusCode::FORBIDDEN,
                "un pannello si abbina dall'IDE di un progetto, che lo lega alla sua azienda",
            )
        }
    };
    let Some(codice) = crate::abbinamento::normalizza(&r.codice) else {
        return errore(StatusCode::BAD_REQUEST, "il codice ha la forma XXXX-XXXX-XXXX-XXXX");
    };
    let Some(in_attesa) = attesa.di(&codice).await else {
        return errore(
            StatusCode::NOT_FOUND,
            "nessun pannello in attesa con questo codice: è acceso, collegato a internet, e il codice è quello che mostra adesso?",
        );
    };
    let mut occupati: Vec<String> = registro.collegati().await;
    if let Some(a) = s.pannelli_ammessi.as_ref() {
        occupati.extend(a.0.keys().cloned());
    }
    let (pannello, token) = match abbinati.prepara(
        &segreto,
        &in_attesa.hw,
        &azienda,
        r.nome.as_deref(),
        &in_attesa.nome_proposto,
        &occupati,
    ) {
        Ok(x) => x,
        Err(crate::tunnel::abbinati::ErroreAbbina::Bandito) => {
            return errore(StatusCode::FORBIDDEN, "questo pannello è bandito")
        }
        Err(crate::tunnel::abbinati::ErroreAbbina::DiUnAltraAzienda) => {
            return errore(
                StatusCode::CONFLICT,
                "questo pannello è già abbinato a un'altra azienda: lo può spostare solo chi amministra la piattaforma",
            )
        }
        Err(crate::tunnel::abbinati::ErroreAbbina::NomeNonValido) => {
            return errore(StatusCode::BAD_REQUEST, "nome non valido: lettere, cifre e trattini")
        }
    };

    // Al pannello, attraverso il suo tunnel in attesa.
    let mut verso = serde_json::json!({
        "codice": codice,
        "tunnel": { "nome": pannello.nome, "token": token },
    });
    // Utente e password solo se ci sono: dal cloud di norma non ci sono (fetta
    // E, gli utenti arrivano col primo progetto).
    if let Some(u) = r.username.as_deref().filter(|u| !u.trim().is_empty()) {
        verso["username"] = serde_json::Value::String(u.to_string());
    }
    if let Some(p) = r.password.as_deref().filter(|p| !p.is_empty()) {
        verso["password"] = serde_json::Value::String(p.to_string());
    }
    let richiesta = match Request::builder()
        .method("POST")
        .uri("/api/abbinamento/rivendica")
        .header("content-type", "application/json")
        .body(Body::from(verso.to_string()))
    {
        Ok(q) => q,
        Err(e) => return errore(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    let risposta = match attraverso(&in_attesa.maniglia, "/api/abbinamento/rivendica", "", richiesta).await {
        Ok(x) => x,
        Err(e) => return errore(StatusCode::BAD_GATEWAY, &format!("il pannello non risponde: {e}")),
    };
    let stato = risposta.status();
    let dal_pannello: serde_json::Value = match axum::body::to_bytes(risposta.into_body(), 64 * 1024).await {
        Ok(b) => serde_json::from_slice(&b).unwrap_or_default(),
        Err(_) => serde_json::Value::Null,
    };
    if !stato.is_success() {
        let motivo = dal_pannello
            .get("detail")
            .and_then(|d| d.as_str())
            .unwrap_or("il pannello ha rifiutato l'abbinamento");
        return errore(stato, motivo);
    }
    let nome = pannello.nome.clone();
    if let Err(e) = abbinati.salva(pannello) {
        return errore(StatusCode::INTERNAL_SERVER_ERROR, &format!("pannello abbinato ma non salvato: {e}"));
    }
    s.audit.log(
        "pannello.abbinato",
        None,
        serde_json::json!({ "pannello": nome, "azienda": azienda, "hw": in_attesa.hw }),
    );
    tracing::info!(pannello = %nome, %azienda, "pannello abbinato col codice");
    axum::Json(serde_json::json!({
        "nome": nome,
        "azienda": azienda,
        "url": origine.map(|o| format!("{o}/dev/{nome}")),
        "sessione": dal_pannello,
    }))
    .into_response()
}

/// `GET /api/amministrazione/pannelli` — i pannelli del gateway, per chi
/// amministra la piattaforma: abbinati (con stato), dichiarati a mano,
/// collegati adesso, e quanti aspettano un abbinamento.
pub async fn elenco_amministrazione(State(s): State<crate::router::AppState>) -> Response {
    let collegati = match s.tunnel.as_ref() {
        Some(r) => r.collegati().await,
        None => vec![],
    };
    // Spento annunciato: il pannello ha detto «mi spengo» prima di chiudere.
    let spento_il = |n: &str| s.tunnel.as_ref().and_then(|r| r.spento_il(n));
    let abbinati: Vec<_> = s
        .pannelli_abbinati
        .as_ref()
        .map(|a| a.elenco())
        .unwrap_or_default()
        .into_iter()
        .map(|p| {
            let c = collegati.contains(&p.nome);
            let mut v = serde_json::to_value(&p).unwrap_or_default();
            v["collegato"] = serde_json::Value::Bool(c);
            if let Some(ms) = spento_il(&p.nome).filter(|_| !c) {
                v["spento_ms"] = ms.into();
            }
            v
        })
        .collect();
    let dichiarati: Vec<_> = s
        .pannelli_ammessi
        .as_ref()
        .map(|a| {
            let mut v: Vec<_> = a
                .0
                .iter()
                .map(|(n, d)| {
                    let c = collegati.contains(n);
                    let mut v = serde_json::json!({ "nome": n, "azienda": d.azienda, "collegato": c });
                    if let Some(ms) = spento_il(n).filter(|_| !c) {
                        v["spento_ms"] = ms.into();
                    }
                    v
                })
                .collect();
            v.sort_by(|x, y| x["nome"].as_str().cmp(&y["nome"].as_str()));
            v
        })
        .unwrap_or_default();
    let in_attesa = match s.pannelli_in_attesa.as_ref() {
        Some(a) => a.quanti().await,
        None => 0,
    };
    axum::Json(serde_json::json!({ "abbinati": abbinati, "dichiarati": dichiarati, "in_attesa": in_attesa }))
        .into_response()
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NuovoStato {
    stato: crate::tunnel::abbinati::StatoPannello,
}

/// `POST /api/amministrazione/pannelli/:nome/stato` — attivo, sospeso o
/// bandito. Un pannello sospeso o bandito collegato adesso viene staccato.
pub async fn imposta_stato(
    State(s): State<crate::router::AppState>,
    Path(nome): Path<String>,
    axum::Json(n): axum::Json<NuovoStato>,
) -> Response {
    let Some(a) = s.pannelli_abbinati.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match a.imposta_stato(&nome, n.stato) {
        Ok(true) => {
            if n.stato != crate::tunnel::abbinati::StatoPannello::Attivo {
                if let Some(r) = s.tunnel.as_ref() {
                    r.stacca(&nome).await;
                }
            }
            s.audit.log("pannello.stato", None, serde_json::json!({ "pannello": nome, "stato": n.stato }));
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NuovaAzienda {
    /// Il segmento del gateway: la cartella dell'azienda, `-` per la radice.
    azienda: String,
}

/// `POST /api/amministrazione/pannelli/:nome/azienda` — sposta un pannello a
/// un'altra azienda. Solo chi amministra la piattaforma.
///
/// È la strada che il messaggio d'errore di `prepara` prometteva dall'11-10-2026
/// («lo può spostare solo chi amministra la piattaforma») senza che esistesse:
/// l'unico modo di spostare un pannello era sospenderlo e lasciare che l'altra
/// azienda lo rivendicasse, cosa che dal 21-10 non si può più fare.
///
/// **Il tunnel si stacca.** Il pannello si ricollega da sé in pochi secondi, ma
/// gli stream aperti adesso sono stati autorizzati per l'azienda di prima: se
/// restassero in piedi, chi non possiede più il pannello continuerebbe a
/// parlarci finché non chiude la pagina.
pub async fn sposta_azienda(
    State(s): State<crate::router::AppState>,
    Path(nome): Path<String>,
    axum::Json(n): axum::Json<NuovaAzienda>,
) -> Response {
    let Some(a) = s.pannelli_abbinati.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    // L'azienda deve esistere davvero: un segmento scritto a mano e sbagliato
    // renderebbe il pannello irraggiungibile da chiunque, senza un errore.
    let segmento = n.azienda.trim().to_string();
    if segmento != crate::project_registry::AZIENDA_IMPLICITA {
        let nota = match s.identita.as_ref() {
            Some(id) => id.elenca_aziende().await.unwrap_or_default(),
            None => vec![],
        };
        let esiste = nota.iter().any(|x| {
            let seg = if x.implicita { crate::project_registry::AZIENDA_IMPLICITA } else { x.cartella.as_str() };
            seg == segmento
        });
        if !esiste {
            return (StatusCode::BAD_REQUEST, "nessuna azienda con questo segmento").into_response();
        }
    }
    match a.sposta(&nome, &segmento) {
        Ok(true) => {
            if let Some(r) = s.tunnel.as_ref() {
                r.stacca(&nome).await;
            }
            s.audit.log(
                "pannello.azienda",
                None,
                serde_json::json!({ "pannello": nome, "azienda": segmento }),
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// La firma del gateway per un pannello abbinato col codice: `None` per i
/// dichiarati a mano, che non la conoscono.
fn firma_per(s: &crate::router::AppState, pannello: &str) -> Option<String> {
    let p = s.pannelli_abbinati.as_ref()?.per_nome(pannello)?;
    let segreto = s.regia.as_ref()?.segreto().to_string();
    let token = crate::tunnel::abbinati::token_per(&segreto, &p.hw);
    Some(crate::abbinamento::firma_gateway(&token))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rinomina {
    nuovo: String,
}

/// `POST /api/pannelli/:nome/rinomina` — cambia il nome nel tunnel di un
/// pannello abbinato (fetta E): prima sul pannello, attraverso il suo tunnel e
/// con la firma, poi la riga. Il token non cambia: dipende dall'hardware.
///
/// Chi può: il container di un progetto della **stessa azienda** del pannello,
/// o chi amministra la piattaforma.
pub async fn rinomina(
    State(s): State<crate::router::AppState>,
    Path(nome): Path<String>,
    req: Request<Body>,
) -> Response {
    let errore = |stato: StatusCode, testo: &str| {
        (stato, axum::Json(serde_json::json!({ "error": "rinomina", "detail": testo }))).into_response()
    };
    let (Some(abbinati), Some(registro)) = (s.pannelli_abbinati.clone(), s.tunnel.clone()) else {
        return errore(StatusCode::NOT_FOUND, "questo processo non ha pannelli");
    };
    let Some(riga) = abbinati.per_nome(&nome) else {
        return errore(StatusCode::NOT_FOUND, "pannello non trovato");
    };
    let figlio = req.extensions().get::<crate::gateway::ritorno::Chiamante>().cloned();
    let chi = req.extensions().get::<crate::router::AuthUser>().cloned();
    let ammesso = match (&figlio, &chi) {
        (Some(f), _) => f.azienda == riga.azienda,
        (None, Some(u)) => u.amministratore_piattaforma,
        _ => false,
    };
    if !ammesso {
        return errore(StatusCode::NOT_FOUND, "pannello non trovato");
    }
    let corpo = match axum::body::to_bytes(req.into_body(), 4096).await {
        Ok(b) => b,
        Err(_) => return errore(StatusCode::BAD_REQUEST, "corpo illeggibile"),
    };
    let r: Rinomina = match serde_json::from_slice(&corpo) {
        Ok(r) => r,
        Err(e) => return errore(StatusCode::BAD_REQUEST, &format!("json: {e}")),
    };
    let Some(nuovo) = crate::tunnel::abbinati::normalizza_nome(&r.nuovo) else {
        return errore(StatusCode::BAD_REQUEST, "nome non valido: lettere, cifre e trattini");
    };
    if nuovo == nome {
        return axum::Json(serde_json::json!({ "nome": nome })).into_response();
    }
    let occupato = registro.collegati().await.contains(&nuovo)
        || s.pannelli_ammessi.as_ref().is_some_and(|a| a.0.contains_key(&nuovo))
        || abbinati.per_nome(&nuovo).is_some();
    if occupato {
        return errore(StatusCode::CONFLICT, &format!("il nome «{nuovo}» è già usato da un altro pannello"));
    }
    let Some(maniglia) = registro.di(&nome).await else {
        return errore(
            StatusCode::SERVICE_UNAVAILABLE,
            "il pannello non è collegato adesso: il nome si cambia sul pannello, che deve essere acceso",
        );
    };
    let Some(firma) = firma_per(&s, &nome) else {
        return errore(StatusCode::INTERNAL_SERVER_ERROR, "firma del gateway non disponibile");
    };
    let richiesta = match Request::builder()
        .method("POST")
        .uri("/api/abbinamento/nome")
        .header("content-type", "application/json")
        .header(crate::abbinamento::INTESTAZIONE_GATEWAY, firma)
        .body(Body::from(serde_json::json!({ "nome": nuovo }).to_string()))
    {
        Ok(q) => q,
        Err(e) => return errore(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };
    match attraverso(&maniglia, "/api/abbinamento/nome", "", richiesta).await {
        Ok(r) if r.status().is_success() => {}
        Ok(r) => return errore(StatusCode::BAD_GATEWAY, &format!("il pannello ha rifiutato ({})", r.status())),
        Err(e) => return errore(StatusCode::BAD_GATEWAY, &format!("il pannello non risponde: {e}")),
    }
    if let Err(e) = abbinati.rinomina(&nome, &nuovo) {
        return errore(StatusCode::INTERNAL_SERVER_ERROR, &format!("pannello rinominato ma riga non salvata: {e}"));
    }
    s.audit.log("pannello.rinominato", None, serde_json::json!({ "da": nome, "a": nuovo }));
    tracing::info!(da = %nome, a = %nuovo, "pannello rinominato");
    axum::Json(serde_json::json!({ "nome": nuovo })).into_response()
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
                tokio::spawn(super::super::pannello::gira_alla_porta(st, porta_pannello, false));
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

    /// Un PUT con un corpo JSON arriva al pannello intero, com'è partito
    /// (15-10-2026: l'autopilota salvato dal cloud non arrivava al tc620-garage).
    #[tokio::test]
    async fn un_put_con_corpo_attraversa_il_tunnel() {
        use tokio_util::compat::TokioAsyncReadCompatExt as _;

        let pannello = axum::Router::new().route(
            "/api/update/schedule",
            axum::routing::put(|axum::Json(v): axum::Json<serde_json::Value>| async move { axum::Json(v) }),
        );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let porta_pannello = l.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(l, pannello).await.unwrap() });

        let (a, b) = tokio::io::duplex(256 * 1024);
        let (maniglia, _) = avvia(a.compat(), Verso::Chiama);
        let (_tieni, mut in_arrivo) = avvia(b.compat(), Verso::Risponde);
        tokio::spawn(async move {
            while let Some(st) = in_arrivo.recv().await {
                tokio::spawn(super::super::pannello::gira_alla_porta(st, porta_pannello, false));
            }
        });
        let gw = axum::Router::new().fallback(move |req: Request<Body>| {
            let m = maniglia.clone();
            async move {
                let p = req.uri().path().to_string();
                match attraverso(&m, &p, "", req).await {
                    Ok(r) => r,
                    Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
                }
            }
        });
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let porta_gw = l.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(l, gw).await.unwrap() });

        let corpo = serde_json::json!({ "approvazione": null, "pilota": { "giorni": [1, 2], "ora": "23:30" } });
        let r = reqwest::Client::new()
            .put(format!("http://127.0.0.1:{porta_gw}/api/update/schedule"))
            .json(&corpo)
            .send()
            .await
            .unwrap();
        let codice = r.status();
        let testo = r.text().await.unwrap();
        assert_eq!(codice, StatusCode::OK, "{testo}");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&testo).unwrap(), corpo);
    }

    /// Il pannello in TLS (24-10-2026): dalla 2.20.0 la porta di gestione di un
    /// pannello parla TLS, e il tunnel che ci girava HTTP in chiaro dava 502 su
    /// tutto. Qui la porta del «pannello» è TLS con un autofirmato, e una GET
    /// deve attraversare il tunnel lo stesso.
    #[tokio::test]
    async fn una_get_arriva_al_pannello_in_tls() {
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
        use tokio_util::compat::TokioAsyncReadCompatExt as _;

        let cert = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let chiave = rustls::pki_types::PrivateKeyDer::Pkcs8(cert.key_pair.serialize_der().into());
        let cfg = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![cert.cert.der().clone()], chiave)
            .unwrap();
        let accettore = tokio_rustls::TlsAcceptor::from(Arc::new(cfg));
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let porta_pannello = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((tcp, _)) = l.accept().await {
                let accettore = accettore.clone();
                tokio::spawn(async move {
                    // Se l'handshake fallisce (HTTP in chiaro), il pannello chiude:
                    // è quello che faceva il runtime vero.
                    let Ok(mut s) = accettore.accept(tcp).await else { return };
                    let mut buf = Vec::new();
                    let mut pezzo = [0u8; 1024];
                    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                        let n = s.read(&mut pezzo).await.unwrap();
                        if n == 0 { return; }
                        buf.extend_from_slice(&pezzo[..n]);
                    }
                    let _ = s.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok").await;
                    let _ = s.shutdown().await;
                });
            }
        });

        let (a, b) = tokio::io::duplex(256 * 1024);
        let (maniglia, _) = avvia(a.compat(), Verso::Chiama);
        let (_tieni, mut in_arrivo) = avvia(b.compat(), Verso::Risponde);
        tokio::spawn(async move {
            while let Some(st) = in_arrivo.recv().await {
                tokio::spawn(super::super::pannello::gira_alla_porta(st, porta_pannello, true));
            }
        });
        let gw = axum::Router::new().fallback(move |req: Request<Body>| {
            let m = maniglia.clone();
            async move {
                let p = req.uri().path().to_string();
                match attraverso(&m, &p, "", req).await {
                    Ok(r) => r,
                    Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
                }
            }
        });
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let porta_gw = l.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(l, gw).await.unwrap() });

        let r = reqwest::get(format!("http://127.0.0.1:{porta_gw}/health")).await.unwrap();
        let codice = r.status();
        let testo = r.text().await.unwrap();
        assert_eq!(codice, StatusCode::OK, "{testo}");
        assert_eq!(testo, "ok");
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
