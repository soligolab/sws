use crate::router::AppState;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
/// WebSocket relay: proxies `/ws/remote/{tags,alarms,logs}` on the local IDE
/// runtime to the corresponding `/ws/{path}?token=…` endpoint on the connected
/// remote runtime.
///
/// Why relay instead of direct browser ↔ remote WS?
/// - The browser only trusts localhost — no CORS issues, no self-signed cert
///   rejection on a cross-origin WS upgrade.
/// - The remote token stays inside the local process; it never touches the
///   browser's devtools / localStorage.
/// - A single relay task handles reconnection transparently.
///
/// Limitation (PoC): the relay for `wss://` targets uses a custom TLS verifier
/// that accepts any certificate — appropriate only on a trusted LAN.
use std::sync::Arc;
use tokio_tungstenite::tungstenite::Message as TMsg;

// ── TLS verifier that accepts any cert (PoC only — trusted LAN) ──────────────

// ── Handler ───────────────────────────────────────────────────────────────────

/// `GET /ws/remote/:sub` where `sub` ∈ `{tags, alarms, logs}`.
///
/// Requires Admin auth (mounted in `system_ctrl_routes`). If no remote target
/// is currently connected, responds 404.
pub async fn ws_relay_handler(
    ws: WebSocketUpgrade,
    State(s): State<AppState>,
    Path(sub): Path<String>,
    axum::extract::Query(q): axum::extract::Query<std::collections::HashMap<String, String>>,
    chi: Option<axum::Extension<crate::router::AuthUser>>,
) -> Response {
    // Il DEBUG del dispositivo (18-10-2026, decisione del maintainer): solo per
    // l'amministratore di piattaforma. Il controllo sta qui, nel relay, perché è
    // qui che si sa chi chiede; il dispositivo vede solo l'IDE, che è suo Admin.
    let debug = sub == "logs"
        && q.get("livello").is_some_and(|l| l.eq_ignore_ascii_case("debug"))
        && chi.as_ref().is_some_and(|c| c.0.amministratore_piattaforma);
    // Tre e solo tre: sono i canali che mostrano lo stato **del dispositivo**.
    //
    // `ai` non c'è, e **non va aggiunto** (Q31). La tentazione è forte, perché
    // per un periodo la chat dell'IDE con un runtime remoto collegato riceveva
    // proprio un 404 da qui — ma la causa era dall'altra parte: `buildWsUrl`
    // dirottava ogni canale nel relay. Corretto lì, escludendo `/ws/ai`.
    //
    // La ragione non è tecnica. Con un remoto collegato il progetto che l'utente
    // modifica resta **quello locale**: `remote_deploy` esporta il progetto
    // locale attivo e lo carica sul device, il pull fa il verso opposto
    // importandolo in locale. L'assistente propone modifiche a quel progetto,
    // quindi deve leggere il locale. Relayare `ai` lo farebbe leggere la copia
    // sul dispositivo — che nessuno sta editando — e girare l'agente dentro il
    // runtime di un impianto in servizio, cosa che il piano di T-50 esclude.
    if !matches!(sub.as_str(), "tags" | "alarms" | "logs") {
        return StatusCode::NOT_FOUND.into_response();
    }
    let target = match s.remote_target.read().await.clone() {
        Some(t) => t,
        None => {
            tracing::debug!("ws/remote/{sub}: no remote target connected");
            return StatusCode::NOT_FOUND.into_response();
        }
    };
    let certificati = s.certificati.clone();
    let chiave = s.ritorno.per(&target.url);
    ws.on_upgrade(move |local| run_relay(local, s, target, sub, certificati, chiave, debug))
}

/// Codice di chiusura per «il remoto ha risposto, ma quella rotta non c'è».
///
/// Sta nell'intervallo privato 4000-4999 di RFC 6455 e serve a distinguere un
/// guasto **definitivo** da uno di rete: il client si riconnette da solo dopo un
/// cavo staccato, ma su un 404 ritentare non lo fa diventare 200. Senza questa
/// distinzione, il 2026-09-08 il relay ha riempito il registro di ottanta righe
/// identiche in un minuto, due al secondo su due URL, perché il socket *locale*
/// si apriva — e quell'apertura azzerava l'attesa crescente del client — mentre
/// quello verso il pannello moriva subito.
const CHIUSURA_ROTTA_ASSENTE: u16 = 4404;
/// Q49: l'impronta del certificato del dispositivo non è quella memorizzata.
const CHIUSURA_CERTIFICATO_CAMBIATO: u16 = 4495;

/// Chiude il socket locale dicendo **perché**, invece di lasciarlo cadere.
///
/// Un socket che si chiude senza motivo è indistinguibile da una rete che va e
/// viene, ed è esattamente per questo che il client ritentava all'infinito.
async fn chiudi_spiegando(mut local: WebSocket, code: u16, motivo: String) {
    use axum::extract::ws::{CloseFrame, Message};
    let _ = local
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: motivo.into(),
        })))
        .await;
    // Chiusura ORDINATA, non semplice caduta del socket: lasciando morire la
    // connessione subito dopo aver messo in coda il frame, il browser può
    // vedere 1006 («chiusa in modo anomalo») al posto del codice appena
    // scritto — e allora la spiegazione si perde proprio nel momento in cui
    // serve. `close()` chiude il sink dopo aver spinto fuori quanto c'è.
    let _ = local.close().await;
}

/// Cosa fare quando il collegamento verso il pannello non si apre.
///
/// Una risposta **HTTP** dice che il pannello c'è e ha rifiutato: è definitivo,
/// e il client non deve ritentare. Un errore di trasporto (host irraggiungibile,
/// connessione rifiutata) è transitorio: chiusura normale, e il client riprova
/// con l'attesa crescente.
/// Un frame di chiusura WebSocket è un frame **di controllo**: RFC 6455 §5.5 lo
/// limita a 125 byte in tutto, di cui 2 se ne va il codice. Restano **123 byte**
/// per il motivo.
///
/// Non è un dettaglio da manuale: il 2026-09-08 il motivo scritto qui era di 142
/// byte, il frame usciva invalido, e il browser riportava `1006` — «chiusa in
/// modo anomalo» — buttando via proprio il codice 4404 che doveva dirgli di non
/// ritentare. Il client si fermava lo stesso, ma solo dopo sei tentativi grazie
/// al conteggio, invece che dopo uno.
const MAX_MOTIVO_BYTE: usize = 123;

/// Che cosa dire quando il pannello risponde con uno stato HTTP.
///
/// Tre cose, perché servono in tre posti diversi:
/// - `guasto`: `true` = è un difetto (WARN), `false` = comportamento previsto (INFO);
/// - `breve`: quello che entra nel frame di chiusura, sotto i 123 byte;
/// - `lungo`: quello che va nel registro, dove lo spazio non manca.
///
/// Funzione pura perché la scelta del messaggio è la parte che si sbaglia: la
/// prima stesura diceva «probabile versione più vecchia dell'editor» a chiunque
/// prendesse un 404, e il caso più frequente — `/ws/logs`, che su un dispositivo
/// non c'è per scelta — si è visto raccontare una falsità al primo collaudo.
/// L'indirizzo del canale sul dispositivo. `debug` aggiunge `livello=debug`, che
/// il dispositivo rispetta solo su `/ws/logs`.
fn url_remoto(ws_scheme: &str, host_path: &str, sub: &str, token: &str, debug: bool) -> String {
    let mut q: Vec<String> = Vec::new();
    if !token.is_empty() {
        q.push(format!("token={token}"));
    }
    if debug {
        q.push("livello=debug".to_string());
    }
    if q.is_empty() {
        format!("{ws_scheme}://{host_path}/ws/{sub}")
    } else {
        format!("{ws_scheme}://{host_path}/ws/{sub}?{}", q.join("&"))
    }
}

fn motivo_rifiuto(sub: &str, stato: u16) -> (bool, String, String) {
    // Dal 18-10-2026 il dispositivo espone `/ws/logs` (solo Admin): un 404 è un
    // pannello con una versione di prima, e il rimedio è aggiornarlo.
    if stato == 404 && sub == "logs" {
        return (
            false,
            "il pannello non manda i suoi log: va aggiornato".to_string(),
            "il pannello ha una versione che non espone i log da remoto (prima del \
             18-10-2026): aggiornalo per vederli qui."
                .to_string(),
        );
    }
    // **La sessione scaduta non è un guasto del pannello.** Si arriva qui solo
    // dopo che il rientro automatico ha fallito (vedi `run_relay`), quindi il
    // messaggio dice l'unica cosa che resta da fare.
    if stato == 401 {
        return (
            true,
            "sessione scaduta sul pannello: rifai «Connetti»".to_string(),
            "il pannello ha rifiutato la sessione (401) e non si è potuto rientrare con le \
             credenziali del «Connetti»: rifai «Connetti» con utente e password di un Admin del \
             pannello. Succede quando il pannello si riavvia o la sessione scade."
                .to_string(),
        );
    }
    if stato == 404 {
        return (
            true,
            format!("rotta /ws/{sub} assente sul runtime remoto"),
            format!(
                "il runtime remoto non ha la rotta /ws/{sub}: probabile versione più \
                     vecchia dell'editor, oppure l'indirizzo non è un runtime SWS"
            ),
        );
    }
    let m = format!("il runtime remoto ha rifiutato il collegamento: {stato}");
    (true, m.clone(), m)
}

/// Taglia il motivo a `MAX_MOTIVO_BYTE` **sul confine di un carattere**.
///
/// Rete di sicurezza per i messaggi costruiti con `format!`: `sub` arriva
/// dall'URL, e un giorno potrebbe essere più lungo di quanto ci si aspetta.
/// Tagliare a metà di una sequenza UTF-8 produrrebbe un frame invalido esattamente
/// come essere troppo lunghi.
fn accorcia(mut m: String) -> String {
    if m.len() <= MAX_MOTIVO_BYTE {
        return m;
    }
    let mut n = MAX_MOTIVO_BYTE;
    while n > 0 && !m.is_char_boundary(n) {
        n -= 1;
    }
    m.truncate(n);
    m
}

async fn fallito(
    local: WebSocket,
    sub: &str,
    remote_url: &str,
    e: tokio_tungstenite::tungstenite::Error,
) {
    use tokio_tungstenite::tungstenite::Error as TErr;
    if let TErr::Http(resp) = &e {
        let st = resp.status().as_u16();
        let (guasto, breve, lungo) = motivo_rifiuto(sub, st);
        if guasto {
            tracing::warn!(url = %remote_url, stato = st,
                "ws relay: collegamento rifiutato, non ritento — {lungo}");
        } else {
            tracing::info!(url = %remote_url, stato = st,
                "ws relay: canale non disponibile su questo runtime — {lungo}");
        }
        // In entrambi i casi il client non deve ritentare: né un guasto di
        // versione né una scelta di progetto cambiano riprovando fra un secondo.
        // Nel frame va il motivo BREVE: sopra i 123 byte il frame è invalido e
        // il codice non arriva affatto.
        chiudi_spiegando(local, CHIUSURA_ROTTA_ASSENTE, accorcia(breve)).await;
        return;
    }
    // Q49: impronta del certificato diversa da quella memorizzata. Definitivo
    // come un 404: riprovare fra un secondo non cambia il certificato; serve
    // il gesto umano di «Connetti» → «dimentica il certificato».
    if crate::certificati::e_certificato_cambiato(&format!("{e:?}")) {
        tracing::warn!(url = %remote_url,
            "ws relay: certificato del dispositivo cambiato, non ritento — usa «dimentica il certificato» in Connetti");
        chiudi_spiegando(
            local,
            CHIUSURA_CERTIFICATO_CAMBIATO,
            "certificato del dispositivo cambiato: dimenticalo da Connetti e ricollega".to_string(),
        )
        .await;
        return;
    }
    tracing::warn!(url = %remote_url, "ws relay: collegamento fallito (riprovo): {e}");
    // Chiusura normale: per il client è un guasto passeggero e ritenta.
    chiudi_spiegando(local, 1011, accorcia(format!("{e}"))).await;
}

/// Il canale verso il pannello, aperto una volta.
type Remoto = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

/// Apre il canale verso il pannello. Estratta da `run_relay` il 28-10-2026
/// perché ora si chiama **due volte**: la seconda col token rinnovato.
async fn apri_verso_il_pannello(
    remote_url: &str,
    target_url: &str,
    host_path: &str,
    ws_scheme: &str,
    chiave_ritorno: Option<&str>,
    certificati: &Arc<crate::certificati::ImprontaStore>,
) -> Result<Remoto, tokio_tungstenite::tungstenite::Error> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    // La chiave di ritorno, quando il remoto è un pannello dietro il gateway da
    // cui arriva il lavoro (`gateway/ritorno.rs`).
    let mut richiesta = remote_url.into_client_request()?;
    if let Some(v) = chiave_ritorno.and_then(|c| c.parse().ok()) {
        richiesta.headers_mut().insert(crate::gateway::ritorno::INTESTAZIONE, v);
    }
    // Q49: per wss:// la fiducia è per impronta, la stessa che ha memorizzato
    // «Connetti» — non «accetta tutto» come fino al 2026-09-09.
    if ws_scheme == "wss" {
        let host_port = crate::certificati::host_port_da_url(target_url)
            .unwrap_or_else(|| host_path.to_string());
        let tls = Arc::new(crate::certificati::client_config_pinnato(
            &host_port,
            certificati.clone(),
        ));
        let connector = tokio_tungstenite::Connector::Rustls(tls);
        let (ws, _) = tokio_tungstenite::connect_async_tls_with_config(
            richiesta,
            None,
            false,
            Some(connector),
        )
        .await?;
        Ok(ws)
    } else {
        let (ws, _) = tokio_tungstenite::connect_async(richiesta).await?;
        Ok(ws)
    }
}

/// Lo stato HTTP con cui il pannello ha rifiutato, se ha rifiutato così.
fn stato_http(e: &tokio_tungstenite::tungstenite::Error) -> Option<u16> {
    match e {
        tokio_tungstenite::tungstenite::Error::Http(r) => Some(r.status().as_u16()),
        _ => None,
    }
}

async fn run_relay(
    local: WebSocket,
    s: crate::router::AppState,
    target: crate::remote::RemoteTarget,
    sub: String,
    certificati: Arc<crate::certificati::ImprontaStore>,
    chiave_ritorno: Option<String>,
    debug: bool,
) {
    // Build the remote WS URL. Tokens are UUID strings (hex + hyphens) — no
    // percent-encoding needed. If the token is empty the remote is in no-auth
    // mode and we omit the ?token= parameter.
    let ws_scheme = if target.url.starts_with("https://") {
        "wss"
    } else {
        "ws"
    };
    let host_path = target
        .url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let mut remote_url = url_remoto(ws_scheme, host_path, &sub, &target.token, debug);

    let apri = |url: String| {
        let certificati = certificati.clone();
        let chiave = chiave_ritorno.clone();
        let target_url = target.url.clone();
        let host_path = host_path.to_string();
        async move {
            apri_verso_il_pannello(
                &url,
                &target_url,
                &host_path,
                ws_scheme,
                chiave.as_deref(),
                &certificati,
            )
            .await
        }
    };

    let mut esito = apri(remote_url.clone()).await;

    // **Il 401 non è un guasto: è un token da rinnovare** (28-10-2026).
    //
    // Fino a oggi il rientro automatico lo faceva solo il deploy. Il relay
    // prendeva il 401, chiudeva con «non ritentare» e l'IDE restava muto col
    // pallino verde — e `/ws/tags` non è solo il canale che legge, è anche
    // quello che **scrive**: niente dati live e nessun comando. Il caso non è
    // raro, è tutte le mattine: il WP630 si spegne la sera, e al riavvio il
    // token del giorno prima non vale più.
    // Piano: docs/archive/2026-10-28-cosa-sta-succedendo-nell-ide.md
    if esito.as_ref().err().and_then(stato_http) == Some(401) {
        tracing::warn!(url = %remote_url, canale = %sub,
            "ws relay: il pannello ha rifiutato la sessione, provo a rientrare");
        // Tre canali si aprono insieme (tags, alarms, logs) e prendono lo
        // stesso 401: se un altro ha già rinnovato, il token nello stato è
        // diverso da quello che abbiamo usato e basta riprovare con quello,
        // senza un secondo login.
        let gia_rinnovato = s
            .remote_target
            .read()
            .await
            .as_ref()
            .map(|t| t.token.clone())
            .filter(|t| *t != target.token);
        let nuovo = match gia_rinnovato {
            Some(t) => Some(t),
            None => crate::remote::rinnova_sessione(&s).await,
        };
        if let Some(token) = nuovo {
            remote_url = url_remoto(ws_scheme, host_path, &sub, &token, debug);
            esito = apri(remote_url.clone()).await;
            if esito.is_ok() {
                tracing::info!(canale = %sub,
                    "ws relay: sessione rinnovata da sola, il canale è aperto");
            }
        }
    }

    let remote = match esito {
        Ok(ws) => ws,
        Err(e) => return fallito(local, &sub, &remote_url, e).await,
    };

    tracing::debug!(url = %remote_url, "ws relay established");

    let (mut local_tx, mut local_rx) = local.split();
    let (mut remote_tx, mut remote_rx) = remote.split();

    // Remote → local: tag deltas, alarm events, log lines
    let r2l = async {
        while let Some(item) = remote_rx.next().await {
            match item {
                Ok(msg) => {
                    if let Some(axum_msg) = tung_to_axum(msg) {
                        if local_tx.send(axum_msg).await.is_err() {
                            break;
                        }
                    }
                }
                Err(e) => {
                    tracing::debug!("ws relay remote→local: {e}");
                    break;
                }
            }
        }
    };

    // Local → remote: Subscribe / Write messages from the IDE browser
    let l2r = async {
        while let Some(item) = local_rx.next().await {
            match item {
                Ok(msg) => {
                    if let Some(tung_msg) = axum_to_tung(msg) {
                        if remote_tx.send(tung_msg).await.is_err() {
                            break;
                        }
                    }
                }
                Err(e) => {
                    tracing::debug!("ws relay local→remote: {e}");
                    break;
                }
            }
        }
    };

    tokio::select! { _ = r2l => {}, _ = l2r => {} }
    tracing::debug!(url = %remote_url, "ws relay closed");
}

// ── Message format conversions ────────────────────────────────────────────────

fn tung_to_axum(msg: TMsg) -> Option<Message> {
    match msg {
        TMsg::Text(t) => Some(Message::Text(t)),
        TMsg::Binary(b) => Some(Message::Binary(b)),
        TMsg::Ping(p) => Some(Message::Ping(p)),
        TMsg::Pong(p) => Some(Message::Pong(p)),
        TMsg::Close(_) | TMsg::Frame(_) => None,
    }
}

fn axum_to_tung(msg: Message) -> Option<TMsg> {
    match msg {
        Message::Text(t) => Some(TMsg::Text(t)),
        Message::Binary(b) => Some(TMsg::Binary(b)),
        Message::Ping(p) => Some(TMsg::Ping(p)),
        Message::Pong(p) => Some(TMsg::Pong(p)),
        Message::Close(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{accorcia, motivo_rifiuto, url_remoto, MAX_MOTIVO_BYTE};

    #[test]
    fn l_indirizzo_porta_il_debug_solo_se_chiesto() {
        assert_eq!(url_remoto("ws", "h:1", "logs", "", false), "ws://h:1/ws/logs");
        assert_eq!(url_remoto("ws", "h:1", "logs", "t", true), "ws://h:1/ws/logs?token=t&livello=debug");
        assert_eq!(url_remoto("wss", "h:1", "tags", "t", false), "wss://h:1/ws/tags?token=t");
    }

    #[test]
    fn i_log_assenti_non_sono_un_guasto() {
        let (guasto, _breve, lungo) = motivo_rifiuto("logs", 404);
        assert!(!guasto, "un pannello vecchio non è un guasto: non deve essere un WARN");
        // Dal 18-10-2026 il dispositivo i log li manda: un 404 è un pannello da aggiornare.
        assert!(lungo.contains("aggiornalo"), "{lungo}");
    }

    #[test]
    fn i_tag_assenti_sono_un_guasto_e_nominano_la_rotta() {
        for sub in ["tags", "alarms"] {
            let (guasto, breve, lungo) = motivo_rifiuto(sub, 404);
            assert!(guasto, "{sub}: un 404 qui è un guasto vero");
            assert!(
                lungo.contains(&format!("/ws/{sub}")),
                "il registro deve dire QUALE rotta manca: {lungo}"
            );
            assert!(
                breve.contains(&format!("/ws/{sub}")),
                "anche il motivo breve deve nominarla: {breve}"
            );
            assert!(lungo.contains("versione"), "{lungo}");
        }
    }

    #[test]
    fn gli_altri_stati_non_parlano_di_rotte() {
        let (guasto, _breve, lungo) = motivo_rifiuto("tags", 401);
        assert!(guasto);
        assert!(lungo.contains("401"), "{lungo}");
        assert!(
            !lungo.contains("non ha la rotta"),
            "401 è autenticazione, non rotta assente: {lungo}"
        );
    }

    /// Il difetto misurato sul WP630 il 2026-09-08: il motivo era di 142 byte,
    /// il frame di chiusura ne ammette 123, e il browser vedeva 1006 invece del
    /// codice che gli diceva di non ritentare.
    #[test]
    fn ogni_motivo_breve_entra_in_un_frame_di_controllo() {
        for sub in [
            "logs",
            "tags",
            "alarms",
            "qualcosa-di-molto-molto-piu-lungo",
        ] {
            for stato in [404u16, 401, 500, 503] {
                let (_, breve, _) = motivo_rifiuto(sub, stato);
                // SENZA `accorcia`: i messaggi devono nascere corti. Misurarli
                // dopo il taglio renderebbe questo test una tautologia — passerebbe
                // sempre, e non si accorgerebbe di un messaggio scritto troppo
                // lungo, che è esattamente il difetto da sorvegliare. `accorcia`
                // è la rete di sicurezza, provata a parte.
                let n = breve.len();
                assert!(
                    n <= MAX_MOTIVO_BYTE,
                    "sub={sub} stato={stato}: {n} byte, il frame ne ammette {MAX_MOTIVO_BYTE} — \
                     sopra il limite il frame è invalido e il codice di chiusura non arriva"
                );
            }
        }
    }

    #[test]
    fn accorcia_non_spezza_un_carattere_a_meta() {
        // Accenti ovunque: tagliare a byte fisso produrrebbe UTF-8 invalido, e
        // un frame invalido è indistinguibile da uno troppo lungo.
        let lungo = "è".repeat(200);
        let corto = accorcia(lungo);
        assert!(corto.len() <= MAX_MOTIVO_BYTE);
        assert!(std::str::from_utf8(corto.as_bytes()).is_ok());
        assert!(corto.chars().all(|c| c == 'è'));
    }

    #[test]
    fn accorcia_lascia_stare_quelli_che_ci_stanno() {
        let m = "corto".to_string();
        assert_eq!(accorcia(m.clone()), m);
    }

    /// Il 401 dice **cosa fare**, non «il runtime remoto ha rifiutato: 401».
    ///
    /// Si arriva a questo messaggio solo dopo che il rientro automatico ha
    /// fallito: prima del 28-10-2026 il rientro non c'era affatto, e il 401
    /// cadeva nel ramo generico, che non nomina nessun rimedio.
    #[test]
    fn il_401_nomina_il_rimedio() {
        let (guasto, breve, lungo) = motivo_rifiuto("tags", 401);
        assert!(guasto, "una sessione morta è un difetto da segnalare, non un INFO");
        assert!(breve.contains("Connetti"), "il frame deve dire cosa fare: {breve}");
        assert!(lungo.contains("401"));
        assert!(
            !breve.contains("rotta"),
            "il 401 non è una rotta assente: {breve}"
        );
    }

    /// Il token nuovo finisce nell'indirizzo del secondo tentativo. Banale, ed
    /// è il punto in cui il rientro si rompe in silenzio se un giorno qualcuno
    /// ricostruisse l'URL dalla copia vecchia del bersaglio.
    #[test]
    fn il_rientro_cambia_il_token_nell_indirizzo() {
        let vecchio = url_remoto("wss", "sws.soligo.net/dev/wp630", "tags", "morto", false);
        let nuovo = url_remoto("wss", "sws.soligo.net/dev/wp630", "tags", "vivo", false);
        assert!(vecchio.ends_with("?token=morto"));
        assert!(nuovo.ends_with("?token=vivo"));
        assert_ne!(vecchio, nuovo);
    }

    /// `stato_http` distingue «il pannello ha risposto e ha rifiutato» da «non
    /// si è arrivati al pannello»: è la condizione che decide se rientrare.
    #[test]
    fn solo_una_risposta_http_ha_uno_stato() {
        use tokio_tungstenite::tungstenite::Error as TErr;
        let risposta = axum::http::Response::builder()
            .status(401)
            .body(None)
            .expect("risposta di prova");
        assert_eq!(super::stato_http(&TErr::Http(risposta)), Some(401));
        assert_eq!(
            super::stato_http(&TErr::ConnectionClosed),
            None,
            "una connessione caduta non è un rifiuto: lì non c'è niente da rinnovare"
        );
    }
}
