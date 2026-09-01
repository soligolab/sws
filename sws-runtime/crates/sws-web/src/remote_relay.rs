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
use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use tokio_tungstenite::tungstenite::Message as TMsg;
use crate::router::AppState;

// ── TLS verifier that accepts any cert (PoC only — trusted LAN) ──────────────

#[derive(Debug)]
struct AcceptAnyCert;

impl ServerCertVerifier for AcceptAnyCert {
    fn verify_server_cert(
        &self,
        _end: &CertificateDer<'_>,
        _chain: &[CertificateDer<'_>],
        _name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _msg: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _msg: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::ECDSA_NISTP521_SHA512,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
        ]
    }
}

fn make_tls_config() -> Arc<rustls::ClientConfig> {
    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAnyCert))
        .with_no_client_auth();
    Arc::new(config)
}

// ── Handler ───────────────────────────────────────────────────────────────────

/// `GET /ws/remote/:sub` where `sub` ∈ `{tags, alarms, logs}`.
///
/// Requires Admin auth (mounted in `system_ctrl_routes`). If no remote target
/// is currently connected, responds 404.
pub async fn ws_relay_handler(
    ws: WebSocketUpgrade,
    State(s): State<AppState>,
    Path(sub): Path<String>,
) -> Response {
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
    ws.on_upgrade(move |local| run_relay(local, target, sub))
}

async fn run_relay(
    local: WebSocket,
    target: crate::remote::RemoteTarget,
    sub: String,
) {
    // Build the remote WS URL. Tokens are UUID strings (hex + hyphens) — no
    // percent-encoding needed. If the token is empty the remote is in no-auth
    // mode and we omit the ?token= parameter.
    let ws_scheme = if target.url.starts_with("https://") { "wss" } else { "ws" };
    let host_path = target.url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let remote_url = if target.token.is_empty() {
        format!("{ws_scheme}://{host_path}/ws/{sub}")
    } else {
        format!("{ws_scheme}://{host_path}/ws/{sub}?token={}", target.token)
    };

    // For wss:// targets use the accept-any-cert TLS connector (PoC / trusted LAN).
    let remote = if ws_scheme == "wss" {
        let tls = make_tls_config();
        let connector = tokio_tungstenite::Connector::Rustls(tls);
        match tokio_tungstenite::connect_async_tls_with_config(
            &remote_url,
            None,
            false,
            Some(connector),
        ).await {
            Ok((ws, _)) => ws,
            Err(e) => {
                tracing::warn!(url = %remote_url, "ws relay: connect failed: {e}");
                return;
            }
        }
    } else {
        match tokio_tungstenite::connect_async(&remote_url).await {
            Ok((ws, _)) => ws,
            Err(e) => {
                tracing::warn!(url = %remote_url, "ws relay: connect failed: {e}");
                return;
            }
        }
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
                        if local_tx.send(axum_msg).await.is_err() { break; }
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
                        if remote_tx.send(tung_msg).await.is_err() { break; }
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
        TMsg::Text(t)   => Some(Message::Text(t)),
        TMsg::Binary(b) => Some(Message::Binary(b)),
        TMsg::Ping(p)   => Some(Message::Ping(p)),
        TMsg::Pong(p)   => Some(Message::Pong(p)),
        TMsg::Close(_) | TMsg::Frame(_) => None,
    }
}

fn axum_to_tung(msg: Message) -> Option<TMsg> {
    match msg {
        Message::Text(t)   => Some(TMsg::Text(t)),
        Message::Binary(b) => Some(TMsg::Binary(b)),
        Message::Ping(p)   => Some(TMsg::Ping(p)),
        Message::Pong(p)   => Some(TMsg::Pong(p)),
        Message::Close(_)  => None,
    }
}
