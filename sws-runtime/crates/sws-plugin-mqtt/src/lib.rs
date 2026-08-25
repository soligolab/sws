// Statically linked for the PoC. Dynamic .so loading is deferred until
// third-party plugin support is needed.
//
// PoC scope (per docs/CONTEXT.md §7):
//   - happy-path subscribe with exact-topic matching (no MQTT wildcards)
//   - reconnect on session error with 5 s backoff
//   - publish on tag-write for any TopicMapping with `publish_topic: Some(...)`
//   - Sparkplug B encoding is Phase 3, not handled here

use std::{sync::Arc, time::Duration};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use sws_core::{MqttConfig, TagDb, TagQuality, TagValue, TagWriteBus, WriteRequest};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

mod sparkplug;

/// Verifica del certificato del broker **disattivata**, per `insecure_skip_verify`.
///
/// Perché esiste: i broker di collaudo hanno quasi sempre un certificato
/// auto-firmato, e senza questa via d'uscita l'unica alternativa è procurarsi la
/// CA e depositarla sul dispositivo prima ancora di sapere se il collegamento
/// funziona. È lo stesso problema che l'applicazione già affronta per i propri
/// runtime (il client HTTP verso i dispositivi usa
/// `danger_accept_invalid_certs`).
///
/// Cosa comporta davvero: la connessione resta **cifrata**, ma non si sa più con
/// chi. Chiunque sia in mezzo può presentare un certificato qualsiasi e leggere
/// o alterare il traffico. Va usata su una rete di cui ci si fida, non su
/// Internet.
///
/// Perché la rustls di rumqttc e non quella del workspace: rumqttc 0.24 passa
/// per tokio-rustls 0.25 → rustls **0.22**, mentre il workspace usa la 0.23.
/// Sono due crate distinte per il compilatore, e un `ClientConfig` della 0.23
/// non entra in `TlsConfiguration::Rustls`. `rumqttc::tokio_rustls` è
/// riesportato apposta: si usa quello, e non serve nessuna dipendenza nuova.
#[derive(Debug)]
struct NoCertVerification {
    /// Gli algoritmi di firma restano quelli veri: si salta l'identità del
    /// peer, non la crittografia dell'handshake. Rispondere "va bene tutto"
    /// anche alle firme spezzerebbe l'handshake invece di renderlo permissivo.
    provider: Arc<rumqttc::tokio_rustls::rustls::crypto::CryptoProvider>,
}

impl rumqttc::tokio_rustls::rustls::client::danger::ServerCertVerifier for NoCertVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rumqttc::tokio_rustls::rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rumqttc::tokio_rustls::rustls::pki_types::CertificateDer<'_>],
        _server_name: &rumqttc::tokio_rustls::rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rumqttc::tokio_rustls::rustls::pki_types::UnixTime,
    ) -> Result<
        rumqttc::tokio_rustls::rustls::client::danger::ServerCertVerified,
        rumqttc::tokio_rustls::rustls::Error,
    > {
        Ok(rumqttc::tokio_rustls::rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rumqttc::tokio_rustls::rustls::pki_types::CertificateDer<'_>,
        dss: &rumqttc::tokio_rustls::rustls::DigitallySignedStruct,
    ) -> Result<
        rumqttc::tokio_rustls::rustls::client::danger::HandshakeSignatureValid,
        rumqttc::tokio_rustls::rustls::Error,
    > {
        rumqttc::tokio_rustls::rustls::crypto::verify_tls12_signature(
            message, cert, dss, &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rumqttc::tokio_rustls::rustls::pki_types::CertificateDer<'_>,
        dss: &rumqttc::tokio_rustls::rustls::DigitallySignedStruct,
    ) -> Result<
        rumqttc::tokio_rustls::rustls::client::danger::HandshakeSignatureValid,
        rumqttc::tokio_rustls::rustls::Error,
    > {
        rumqttc::tokio_rustls::rustls::crypto::verify_tls13_signature(
            message, cert, dss, &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rumqttc::tokio_rustls::rustls::SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

/// Trasporto TLS che non verifica l'identità del broker.
///
/// Separata dal punto d'uso perché la chiamano sia il loop di sottoscrizione sia
/// quello Sparkplug, e una copia sola evita che una delle due resti indietro.
pub(crate) fn insecure_tls_transport(source_id: &str) -> rumqttc::Transport {
    warn!(
        source = %source_id,
        "TLS: verifica del certificato DISATTIVATA (insecure_skip_verify). \
         Il traffico è cifrato ma l'identità del broker non è verificata: \
         chiunque sia in mezzo può presentarsi al suo posto. Usare solo su reti fidate."
    );
    let provider = Arc::new(rumqttc::tokio_rustls::rustls::crypto::ring::default_provider());
    let cfg = rumqttc::tokio_rustls::rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoCertVerification { provider }))
        .with_no_client_auth();
    rumqttc::Transport::Tls(rumqttc::TlsConfiguration::Rustls(Arc::new(cfg)))
}

/// Limite dimensione pacchetto MQTT in/out. Il default di rumqttc (10 KB) è
/// troppo basso per payload realistici (JSON di telemetria, discovery Home
/// Assistant, birth certificate Sparkplug): un messaggio più grande fa
/// ritornare `Err` a `eventloop.poll()` e rompe la connessione. Alziamo a 5 MB
/// come guardia anti-OOM ragionevole, applicata a tutti i client del crate.
pub(crate) const MAX_PACKET_SIZE_BYTES: usize = 5 * 1024 * 1024;

/// Runs the MQTT subscription + publish loop until `cancel` fires,
/// reconnecting on any error. Tags with a `publish_topic` set in their
/// TopicMapping register on the write bus and forward writes as MQTT
/// publishes (raw string payload).
///
/// When `cfg.sparkplug` is set, delegates to the Sparkplug B handler instead.
pub async fn run(cfg: MqttConfig, db: Arc<TagDb>, bus: Arc<TagWriteBus>, cancel: CancellationToken) {
    // Sparkplug B mode: fully different subscription + protobuf decode path.
    if let Some(spb) = cfg.sparkplug.clone() {
        sparkplug::run_sparkplug(cfg, spb, db, bus, cancel).await;
        return;
    }
    // Pre-build a (tag → publish_topic) lookup for the writable subset.
    let writers: Vec<(String, String)> = cfg.topics.iter()
        .filter_map(|t| t.publish_topic.as_ref().map(|pt| (t.tag.clone(), pt.clone())))
        .collect();

    loop {
        match run_session(&cfg, &db, &bus, &writers, cancel.clone()).await {
            Ok(()) => break,
            Err(e) => {
                if cancel.is_cancelled() { break; }
                warn!(source = %cfg.id, "MQTT session ended: {e:#} — retry in 5s");
                for topic in &cfg.topics {
                    db.ingest(topic.tag.clone(), TagValue::Float(0.0), TagQuality::Bad).await;
                }
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                }
            }
        }
    }
}

async fn run_session(
    cfg: &MqttConfig,
    db: &TagDb,
    bus: &Arc<TagWriteBus>,
    writers: &[(String, String)],
    cancel: CancellationToken,
) -> anyhow::Result<()> {
    let mut opts = MqttOptions::new(&cfg.client_id, &cfg.host, cfg.port);
    opts.set_max_packet_size(MAX_PACKET_SIZE_BYTES, MAX_PACKET_SIZE_BYTES);
    opts.set_keep_alive(Duration::from_secs(u64::from(cfg.keep_alive_secs.unwrap_or(10))));
    if let Some(clean) = cfg.clean_session {
        opts.set_clean_session(clean);
    }

    // Credentials: an explicit `password_env` wins (so secrets don't have to
    // sit in project.yaml). If the env var is unset we fall through to the
    // plain `password` field and finally log a warning if neither is present
    // alongside a non-empty username.
    if let Some(user) = cfg.username.clone() {
        let password = cfg.password_env
            .as_deref()
            .and_then(|name| match std::env::var(name) {
                Ok(v)  => Some(v),
                Err(_) => {
                    warn!(source = %cfg.id, env = %name,
                          "MQTT password_env not set in process environment");
                    None
                }
            })
            .or_else(|| cfg.password.clone());
        match password {
            Some(p) => opts.set_credentials(user, p),
            None    => {
                warn!(source = %cfg.id, %user, "MQTT username set without password — broker may reject");
                opts.set_credentials(user, "")
            }
        };
    }

    // TLS — when enabled, attach a Transport::Tls with the CA bytes the
    // operator provides. We deliberately don't fall back to a default trust
    // store: the PoC keeps the security boundary explicit, and rumqttc 0.24
    // has no built-in "native trust store" variant anyway.
    if let Some(tls) = &cfg.tls {
        if tls.enabled {
            // Saltando la verifica, una CA non serve: pretenderla qui
            // rifiuterebbe la connessione proprio nel caso in cui la spunta
            // esiste per evitare di doverla procurare.
            if tls.insecure_skip_verify {
                opts.set_transport(insecure_tls_transport(&cfg.id));
            } else {
                let path = tls.ca_cert_path.as_ref().ok_or_else(|| anyhow::anyhow!(
                    "MQTT TLS enabled but ca_cert_path is empty — provide a PEM-encoded \
                     CA file to trust"
                ))?;
                let ca = std::fs::read(path)
                    .map_err(|e| anyhow::anyhow!("read CA cert {path}: {e}"))?;
                opts.set_transport(rumqttc::Transport::Tls(rumqttc::TlsConfiguration::Simple {
                    ca,
                    alpn: None,
                    client_auth: None,
                }));
            }
        }
    }

    // Last will: published by the broker on ungraceful disconnect.
    if let Some(lw) = &cfg.last_will {
        opts.set_last_will(rumqttc::LastWill::new(
            &lw.topic,
            lw.payload.clone(),
            qos_from_u8(lw.qos),
            lw.retain,
        ));
    }

    let (client, mut eventloop) = AsyncClient::new(opts, 32);

    // Subscribe with per-topic QoS, falling back to the source-level QoS,
    // then to 0.
    let source_qos = qos_from_u8(cfg.qos.unwrap_or(0));
    for topic in &cfg.topics {
        let qos = topic.qos.map(qos_from_u8).unwrap_or(source_qos);
        client
            .subscribe(&topic.topic, qos)
            .await
            .map_err(|e| anyhow::anyhow!("subscribe '{}': {e}", topic.topic))?;
    }

    // Per-tag publish_qos lookup so we don't iterate cfg.topics on every write.
    let pub_qos: std::collections::HashMap<String, QoS> = cfg.topics.iter()
        .filter_map(|t| t.publish_topic.as_ref().map(|_| {
            (t.tag.clone(), t.qos.map(qos_from_u8).unwrap_or(source_qos))
        }))
        .collect();

    // Register the writable tags on the bus. We use ONE mpsc channel for all
    // writers from this source; the receiver is select'd against the
    // eventloop poll below so an inbound publish doesn't starve outbound writes.
    let (write_tx, mut write_rx) = mpsc::channel::<WriteRequest>(32);
    if !writers.is_empty() {
        for (tag, _) in writers {
            bus.register(tag.clone(), write_tx.clone()).await;
        }
    }
    drop(write_tx);

    info!(
        source = %cfg.id,
        host = %cfg.host, port = cfg.port,
        client_id = %cfg.client_id,
        topics = cfg.topics.len(),
        writers = writers.len(),
        "MQTT subscribing"
    );

    // `eventloop.poll()` reacting with an `Err` is already handled by the
    // retry loop in `run` — but a poll() that never resolves at all (neither
    // Ok nor Err) bypasses that entirely, since `run_session` simply never
    // returns. Observed for real: after a burst of rapid reconnects the
    // session went silent forever with no error and no auto-recovery.
    // rumqttc's own keep-alive should surface a dead connection as an Err
    // within ~2x keep_alive_secs; this timeout is a generous multiple of
    // that as a backstop against poll() hanging for whatever reason, not a
    // replacement for it.
    let poll_timeout = Duration::from_secs(
        u64::from(cfg.keep_alive_secs.unwrap_or(10)).saturating_mul(3).max(30)
    );

    loop {
        tokio::select! {
            _ = cancel.cancelled() => return Ok(()),

            // Outbound: a tag write came in via the bus → publish to the mapped topic.
            Some((tag, value)) = write_rx.recv() => {
                let Some((_, pt)) = writers.iter().find(|(t, _)| t == &tag) else { continue };
                let qos = pub_qos.get(&tag).copied().unwrap_or(source_qos);
                let payload = stringify(&value);
                if let Err(e) = client.publish(pt, qos, false, payload.clone()).await {
                    warn!(source = %cfg.id, %tag, %pt, "MQTT publish failed: {e}");
                } else {
                    // Echo back into TagDb so the UI updates immediately, before
                    // any return-trip on the subscribe topic.
                    db.ingest(tag.clone(), value, TagQuality::Good).await;
                    info!(source = %cfg.id, %tag, %pt, payload, "MQTT publish");
                }
            }

            // Inbound: poll the eventloop for incoming packets.
            res = tokio::time::timeout(poll_timeout, eventloop.poll()) => {
                let event = match res {
                    Err(_) => return Err(anyhow::anyhow!(
                        "eventloop.poll() sospeso da oltre {poll_timeout:?} — tratteremo come sessione morta"
                    )),
                    Ok(inner) => inner.map_err(|e| anyhow::anyhow!("eventloop: {e}"))?,
                };
                if let Event::Incoming(Packet::Publish(p)) = event {
                    let mut matched = false;
                    for topic in &cfg.topics {
                        if topic.topic == p.topic {
                            let value = decode_payload(&p.payload, topic.json_path.as_deref());
                            debug!(
                                source = %cfg.id,
                                tag = %topic.tag,
                                topic = %p.topic,
                                value = %stringify(&value),
                                "MQTT recv",
                            );
                            db.ingest(topic.tag.clone(), value, TagQuality::Good).await;
                            matched = true;
                        }
                    }
                    if !matched {
                        // Unsubscribed topic — quiet by default, useful with RUST_LOG=trace.
                        tracing::trace!(
                            source = %cfg.id,
                            topic = %p.topic,
                            "MQTT recv (no mapping)",
                        );
                    }
                }
            }
        }
    }
}

/// Render a TagValue as the raw string payload for MQTT publish.
/// Bool: "true"/"false". Numbers: plain decimal. Strings: as-is.
fn stringify(v: &TagValue) -> String {
    match v {
        TagValue::Bool(b)  => if *b { "true".into() } else { "false".into() },
        TagValue::Int(i)   => i.to_string(),
        TagValue::Float(f) => f.to_string(),
        TagValue::Str(s)   => s.clone(),
    }
}

/// Decode an MQTT payload into a TagValue.
/// With `json_path`: parse JSON, navigate dot-separated path, convert leaf.
/// Without: try bool → number → fallback to string.
fn decode_payload(bytes: &[u8], json_path: Option<&str>) -> TagValue {
    if let Some(path) = json_path {
        if let Ok(root) = serde_json::from_slice::<serde_json::Value>(bytes) {
            let leaf = navigate(&root, path);
            return tagvalue_from_json(leaf);
        }
    }
    let text = std::str::from_utf8(bytes).unwrap_or("").trim();
    if let Ok(b) = text.parse::<bool>() { return TagValue::Bool(b); }
    if let Ok(i) = text.parse::<i64>()  { return TagValue::Int(i); }
    if let Ok(f) = text.parse::<f64>()  { return TagValue::Float(f); }
    TagValue::Str(text.to_string())
}

fn navigate<'a>(root: &'a serde_json::Value, path: &str) -> &'a serde_json::Value {
    let mut cur = root;
    for part in path.split('.').filter(|p| !p.is_empty()) {
        cur = cur.get(part).unwrap_or(&serde_json::Value::Null);
    }
    cur
}

fn tagvalue_from_json(v: &serde_json::Value) -> TagValue {
    match v {
        serde_json::Value::Bool(b) => TagValue::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() { TagValue::Int(i) }
            else if let Some(f) = n.as_f64() { TagValue::Float(f) }
            else { TagValue::Str(n.to_string()) }
        }
        serde_json::Value::String(s) => TagValue::Str(s.clone()),
        _ => TagValue::Str(v.to_string()),
    }
}

/// QoS conversion. MQTT defines only 0 / 1 / 2; anything else falls back to 0
/// rather than fail — broker-side rejection on bad QoS is just noise here.
fn qos_from_u8(v: u8) -> QoS {
    match v {
        1 => QoS::AtLeastOnce,
        2 => QoS::ExactlyOnce,
        _ => QoS::AtMostOnce,
    }
}

// ── Broker browse ─────────────────────────────────────────────────────────────

/// Parameters for a one-shot broker browse session.
pub struct BrowseParams {
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub tls_enabled: bool,
    /// Stessa semantica della sorgente: senza questo, spuntare "salta la
    /// verifica" faceva collegare la sorgente ma non lo sfoglia-topic
    /// dell'editor, che falliva sullo stesso broker.
    pub insecure_skip_verify: bool,
    pub ca_cert_path: Option<String>,
    /// How long to listen for incoming publishes. Capped to 120 s by the caller.
    pub duration_secs: u8,
}

/// A topic seen during a browse session plus its last raw payload.
pub struct BrowsedTopic {
    pub topic: String,
    pub sample_payload: String,
}

/// Connect to the broker, subscribe to `#`, collect messages for
/// `params.duration_secs` seconds, then disconnect and return the
/// unique topics observed (sorted alphabetically).
pub async fn browse(params: BrowseParams) -> Vec<BrowsedTopic> {
    let cid = format!("{}-browse", params.client_id);
    let mut opts = MqttOptions::new(&cid, &params.host, params.port);
    opts.set_max_packet_size(MAX_PACKET_SIZE_BYTES, MAX_PACKET_SIZE_BYTES);
    opts.set_keep_alive(Duration::from_secs(10));
    opts.set_clean_session(true);

    if let (Some(user), Some(pass)) = (params.username, params.password) {
        opts.set_credentials(user, pass);
    }

    if params.tls_enabled {
        if params.insecure_skip_verify {
            opts.set_transport(insecure_tls_transport("browse"));
        } else if let Some(path) = params.ca_cert_path {
            match std::fs::read(&path) {
                Ok(ca) => {
                    opts.set_transport(rumqttc::Transport::Tls(
                        rumqttc::TlsConfiguration::Simple {
                            ca,
                            alpn: None,
                            client_auth: None,
                        },
                    ));
                }
                Err(e) => {
                    warn!("browse: cannot read CA cert {path}: {e}");
                    return vec![];
                }
            }
        } else {
            // TLS chiesto, ma né una CA né la spunta "non verificare": prima si
            // usciva da questo `if` senza impostare alcun trasporto, cioè si
            // parlava IN CHIARO a una porta TLS. Il broker chiudeva, lo
            // sfoglia-topic restituiva un elenco vuoto e nessuno diceva perché
            // — sembrava un broker senza messaggi. Trovato il 2026-08-24
            // provando proprio questo ramo.
            warn!(
                "browse: TLS richiesto ma manca sia il certificato CA sia la spunta \
                 \"non verificare il certificato\" — impossibile stabilire una \
                 connessione cifrata, nessun topic letto"
            );
            return vec![];
        }
    }

    let (client, mut eventloop) = AsyncClient::new(opts, 64);
    let mut map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let deadline = tokio::time::sleep(Duration::from_secs(u64::from(params.duration_secs)));
    tokio::pin!(deadline);

    // Subscribe after the first ConnAck arrives.
    let mut subscribed = false;

    loop {
        tokio::select! {
            biased;
            _ = &mut deadline => break,
            res = eventloop.poll() => {
                match res {
                    Ok(Event::Incoming(Packet::ConnAck(_))) if !subscribed => {
                        if let Err(e) = client.subscribe("#", QoS::AtMostOnce).await {
                            warn!("browse: subscribe '#' failed: {e}");
                            break;
                        }
                        subscribed = true;
                    }
                    Ok(Event::Incoming(Packet::Publish(p))) => {
                        let payload = String::from_utf8_lossy(&p.payload).into_owned();
                        map.insert(p.topic.clone(), payload);
                    }
                    Err(e) => {
                        warn!("browse: eventloop error: {e}");
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    let _ = client.disconnect().await;

    let mut result: Vec<BrowsedTopic> = map
        .into_iter()
        .map(|(topic, sample_payload)| BrowsedTopic { topic, sample_payload })
        .collect();
    result.sort_by(|a, b| a.topic.cmp(&b.topic));
    result
}
