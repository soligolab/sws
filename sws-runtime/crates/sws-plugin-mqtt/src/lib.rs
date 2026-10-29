// Statically linked for the PoC. Dynamic .so loading is deferred until
// third-party plugin support is needed.
//
// PoC scope (per docs/CONTEXT.md §7):
//   - happy-path subscribe with exact-topic matching (no MQTT wildcards)
//   - reconnect on session error with 5 s backoff
//   - publish on tag-write for any TopicMapping with `publish_topic: Some(...)`
//   - Sparkplug B encoding is Phase 3, not handled here

use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use std::{sync::Arc, time::Duration};
use sws_core::stato_sorgenti::{Collegamento, StatoSorgenti};
use sws_core::{MqttConfig, TagDb, TagQuality, TagValue, TagWriteBus, WriteRequest};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

// ── Righe di `topics` utilizzabili ──────────────────────────────────────────
//
// Trovato il 2026-09-07 su Sandokan, e costato una serata di caccia al broker:
// una riga con il **topic vuoto**, lasciata dallo sfoglia-broker, faceva
// mandare una SUBSCRIBE con un filtro a lunghezza zero. MQTT 3.1.1 §4.7.3
// pretende almeno un carattere, e mosquitto tratta il filtro vuoto come errore
// di protocollo: chiude la connessione appena la riceve. Nei log si vedeva solo
// «Broken pipe» 2 ms dopo il subscribe, ogni 5 secondi per sempre — un
// messaggio che manda a cercare la rete, il broker o il container.
//
// Il danno non è la riga persa: è che muore la SORGENTE INTERA, tutti gli altri
// topic compresi. Per questo qui si salta la riga e si continua, invece di
// lasciar cadere la sessione.

/// Una riga si può sottoscrivere solo con un filtro non vuoto.
fn sottoscrivibile(topic: &str) -> bool {
    !topic.trim().is_empty()
}

/// Una riga senza tag riceve e non ha dove mettere: ingerirla creerebbe un tag
/// con **id vuoto** nel TagDb — succedeva davvero a ogni ciclo di retry, che
/// marca Bad tutte le righe della sorgente.
/// Le richieste di stato da pubblicare al collegamento (25-10-2026): una per
/// coppia topic/payload, nell'ordine delle righe. Si scartano quelle con un
/// topic vuoto o con caratteri jolly: un PUBLISH su `+`/`#` è un errore di
/// protocollo, e il broker chiuderebbe la connessione dell'intera sorgente —
/// lo stesso guasto della riga senza topic qui sopra.
fn richieste_di_stato(topics: &[sws_core::TopicMapping]) -> Vec<sws_core::RichiestaStato> {
    let mut viste = std::collections::HashSet::new();
    topics
        .iter()
        .filter_map(|t| t.richiesta_stato.as_ref())
        .filter(|r| pubblicabile(&r.topic))
        .filter(|r| viste.insert((*r).clone()))
        .cloned()
        .collect()
}

/// Un topic su cui si può pubblicare: non vuoto e senza caratteri jolly.
pub fn pubblicabile(topic: &str) -> bool {
    !topic.trim().is_empty() && !topic.contains(['+', '#'])
}

fn mappata(tag: &str) -> bool {
    !tag.trim().is_empty()
}

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
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
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
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rumqttc::tokio_rustls::rustls::SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
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

/// Trasporto TLS pinnato sull'impronta del broker (Q49, TOFU) — il percorso
/// di mezzo fra "nessuna verifica" e "una CA vera": niente da procurarsi in
/// anticipo, ma un'identità che dopo il primo contatto non può più cambiare
/// in silenzio. Stessa logica di `sws_web::certificati`, condivisa via
/// `sws_core::pin_tls` da quando rumqttc 0.25 ha allineato la sua rustls
/// (0.23) a quella del resto del workspace — prima erano due crate diverse
/// per il compilatore e serviva un verificatore a parte.
pub(crate) fn pinned_tls_transport(
    host_port: &str,
    certificati: &Arc<sws_core::pin_tls::ImprontaStore>,
) -> rumqttc::Transport {
    let cfg = sws_core::pin_tls::client_config_pinnato(host_port, certificati.clone());
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
pub async fn run(
    cfg: MqttConfig,
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    cancel: CancellationToken,
    certificati: Arc<sws_core::pin_tls::ImprontaStore>,
    stato: Arc<StatoSorgenti>,
) {
    // Sparkplug B mode: fully different subscription + protobuf decode path.
    // Non scrive lo stato della sorgente: niente tag di disponibilità, invece
    // di uno che direbbe «mai collegato» per sempre.
    if let Some(spb) = cfg.sparkplug.clone() {
        sparkplug::run_sparkplug(cfg, spb, db, bus, cancel).await;
        return;
    }
    // Il «risponde / non risponde» della sorgente (28-10-2026, piano «chi sta
    // dall'altra parte»): da qui nasce il tag `<id>.disponibile`.
    stato.registra(&cfg.id, []);
    // Pre-build a (tag → publish_topic) lookup for the writable subset.
    let writers: Vec<(String, String)> = cfg
        .topics
        .iter()
        .filter(|t| mappata(&t.tag))
        .filter_map(|t| {
            t.publish_topic
                .as_ref()
                .map(|pt| (t.tag.clone(), pt.clone()))
        })
        .collect();

    // Attesa che cresce, e un registro che non si autodistrugge.
    //
    // Il 16-09-2026 aprire un progetto creato da un template ha prodotto **1950
    // righe su 2000** di «subscribing»/«connection refused» in pochi minuti: il
    // template portava le sorgenti della casa in cui era nato, il broker non
    // c'era, e il ciclo ritentava ogni 5 secondi scrivendo due righe ogni volta.
    // Il file di log ha una capienza: quelle righe hanno spinto fuori tutto il
    // resto, cioè hanno cancellato la diagnostica proprio mentre serviva.
    //
    // Due correzioni, entrambe sul sintomo giusto:
    //  * l'attesa sale 5 → 10 → 20 → 40 → 60 s e si ferma lì. Un broker assente
    //    resta assente; martellarlo ogni 5 secondi non lo fa tornare, e chi
    //    lo riaccende aspetta al massimo un minuto.
    //  * il motivo si scrive **la prima volta e poi ogni dieci**, con il conto
    //    dei tentativi. Un guasto va detto; ripeterlo 968 volte è nasconderlo
    //    dentro il proprio rumore.
    const ATTESE_S: [u64; 5] = [5, 10, 20, 40, 60];
    let mut tentativi: u32 = 0;
    loop {
        match run_session(
            tentativi,
            &cfg,
            &db,
            &bus,
            &writers,
            cancel.clone(),
            &certificati,
            &stato,
        )
        .await
        {
            Ok(()) => break,
            Err(e) => {
                if cancel.is_cancelled() {
                    break;
                }
                let attesa = ATTESE_S[(tentativi as usize).min(ATTESE_S.len() - 1)];
                tentativi += 1;
                if tentativi == 1 || tentativi.is_multiple_of(10) {
                    warn!(
                        source = %cfg.id,
                        tentativi,
                        "MQTT session ended: {e:#} — riprovo fra {attesa}s"
                    );
                }
                stato.caduta(&cfg.id, format!("{e:#}"));
                for topic in cfg.topics.iter().filter(|t| mappata(&t.tag)) {
                    db.marca_qualita(&topic.tag, TagQuality::Bad).await;
                }
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(attesa)) => {}
                }
            }
        }
    }
}

async fn run_session(
    // Quanti tentativi falliti ci sono già stati: serve solo a decidere se
    // scrivere la riga di avvio. Il «subscribing» sta dentro questa funzione,
    // quindi senza questo si ripeteva a ogni ritentativo — 978 volte nel log
    // del 16-09-2026.
    tentativi: u32,
    cfg: &MqttConfig,
    db: &TagDb,
    bus: &Arc<TagWriteBus>,
    writers: &[(String, String)],
    cancel: CancellationToken,
    certificati: &Arc<sws_core::pin_tls::ImprontaStore>,
    stato: &StatoSorgenti,
) -> anyhow::Result<()> {
    let mut opts = MqttOptions::new(&cfg.client_id, &cfg.host, cfg.port);
    opts.set_max_packet_size(MAX_PACKET_SIZE_BYTES, MAX_PACKET_SIZE_BYTES);
    opts.set_keep_alive(Duration::from_secs(u64::from(
        cfg.keep_alive_secs.unwrap_or(10),
    )));
    if let Some(clean) = cfg.clean_session {
        opts.set_clean_session(clean);
    }

    // Credentials: an explicit `password_env` wins (so secrets don't have to
    // sit in project.yaml). If the env var is unset we fall through to the
    // plain `password` field and finally log a warning if neither is present
    // alongside a non-empty username.
    if let Some(user) = cfg.username.clone() {
        let password = cfg
            .password_env
            .as_deref()
            .and_then(|name| match std::env::var(name) {
                Ok(v) => Some(v),
                Err(_) => {
                    warn!(source = %cfg.id, env = %name,
                          "MQTT password_env not set in process environment");
                    None
                }
            })
            .or_else(|| cfg.password.clone());
        match password {
            Some(p) => opts.set_credentials(user, p),
            None => {
                warn!(source = %cfg.id, %user, "MQTT username set without password — broker may reject");
                opts.set_credentials(user, "")
            }
        };
    }

    // TLS — when enabled, attach a Transport::Tls. Three paths, in order of
    // preference: a real CA (`ca_cert_path`, verifica vera), l'impronta del
    // broker via TOFU (Q49, default quando non c'è una CA — non più un
    // errore fisso come prima del 13-09-2026), e `insecure_skip_verify` come
    // via d'uscita esplicita per chi proprio non vuole nessuna delle due.
    if let Some(tls) = &cfg.tls {
        if tls.enabled {
            // Saltando la verifica, una CA non serve: pretenderla qui
            // rifiuterebbe la connessione proprio nel caso in cui la spunta
            // esiste per evitare di doverla procurare.
            if tls.insecure_skip_verify {
                opts.set_transport(insecure_tls_transport(&cfg.id));
            } else if let Some(path) = tls.ca_cert_path.as_ref() {
                let ca =
                    std::fs::read(path).map_err(|e| anyhow::anyhow!("read CA cert {path}: {e}"))?;
                opts.set_transport(rumqttc::Transport::Tls(rumqttc::TlsConfiguration::Simple {
                    ca,
                    alpn: None,
                    client_auth: None,
                }));
            } else {
                let host_port = format!("{}:{}", cfg.host, cfg.port);
                opts.set_transport(pinned_tls_transport(&host_port, certificati));
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
    let senza_filtro = cfg
        .topics
        .iter()
        .filter(|t| !sottoscrivibile(&t.topic))
        .count();
    if senza_filtro > 0 {
        warn!(
            source = %cfg.id, righe = senza_filtro,
            "MQTT: {senza_filtro} riga/e senza topic, ignorate. Sottoscriverle farebbe \
             chiudere la connessione al broker (filtro a lunghezza zero: errore di \
             protocollo) e morirebbe l'intera sorgente. Toglile in Configurazione → Sorgenti."
        );
    }
    for topic in cfg.topics.iter().filter(|t| sottoscrivibile(&t.topic)) {
        let qos = topic.qos.map(qos_from_u8).unwrap_or(source_qos);
        client
            .subscribe(&topic.topic, qos)
            .await
            .map_err(|e| anyhow::anyhow!("subscribe '{}': {e}", topic.topic))?;
    }

    // Chi sta dall'altra parte (28-10-2026): il topic di disponibilità si
    // sottoscrive come gli altri. Finché non dice «vivo» la sorgente non
    // risponde — il testamento di Zigbee2MQTT e dei suoi simili è conservato,
    // quindi arriva subito dopo la SUBSCRIBE.
    if let Some(d) = cfg.disponibilita.as_ref().filter(|d| sottoscrivibile(&d.topic)) {
        client
            .subscribe(&d.topic, source_qos)
            .await
            .map_err(|e| anyhow::anyhow!("subscribe '{}': {e}", d.topic))?;
        stato.bus(&cfg.id, Collegamento::NonRisponde, Some(format!("nessun messaggio su «{}»", d.topic)));
    } else {
        stato.bus(&cfg.id, Collegamento::Ok, None);
    }
    // Vero finché l'altro capo non dice il contrario. Senza topic di
    // disponibilità resta vero: c'è solo il broker da guardare.
    let mut altro_capo_vivo = cfg.disponibilita.is_none();

    // Lo stato iniziale (25-10-2026): un broker senza `retain` non ha niente da
    // consegnare alla sottoscrizione, e il tag resterebbe senza valore finché lo
    // stato non cambia. Le richieste partono dopo le SUBSCRIBE, nella stessa coda
    // del client: il broker le tratta in ordine, quindi la risposta trova la
    // sottoscrizione già attiva. A ogni sessione, cioè anche dopo un ricollegamento.
    for r in richieste_di_stato(&cfg.topics) {
        client
            .publish(&r.topic, source_qos, false, r.payload.clone().into_bytes())
            .await
            .map_err(|e| anyhow::anyhow!("richiesta di stato su '{}': {e}", r.topic))?;
    }

    // Per-tag publish_qos lookup so we don't iterate cfg.topics on every write.
    let pub_qos: std::collections::HashMap<String, QoS> = cfg
        .topics
        .iter()
        .filter_map(|t| {
            t.publish_topic
                .as_ref()
                .map(|_| (t.tag.clone(), t.qos.map(qos_from_u8).unwrap_or(source_qos)))
        })
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

    if tentativi == 0 || tentativi.is_multiple_of(10) {
        info!(
            source = %cfg.id,
            host = %cfg.host, port = cfg.port,
            client_id = %cfg.client_id,
            topics = cfg.topics.len(),
            writers = writers.len(),
            "MQTT subscribing"
        );
    }

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
        u64::from(cfg.keep_alive_secs.unwrap_or(10))
            .saturating_mul(3)
            .max(30),
    );

    loop {
        tokio::select! {
            _ = cancel.cancelled() => return Ok(()),

            // Outbound: a tag write came in via the bus → publish to the mapped topic.
            Some((tag, percorso, value)) = write_rx.recv() => {
                // Fase 1d: una scrittura su una FOGLIA di una radice che
                // questo plugin possiede. Nessun protocollo sa ancora
                // scrivere dentro un blocco (arriva con le Fasi 3-4): meglio
                // dirlo che scrivere la cosa sbagliata.
                if let Some(p) = &percorso {
                    warn!(tag = %tag, percorso = %p, "scrittura su una foglia: non ancora supportata da questa sorgente");
                    continue;
                }
                let Some((_, pt)) = writers.iter().find(|(t, _)| t == &tag) else { continue };
                let qos = pub_qos.get(&tag).copied().unwrap_or(source_qos);
                let payload = stringify(&value);
                if let Err(e) = client.publish(pt, qos, false, payload.clone()).await {
                    warn!(source = %cfg.id, %tag, %pt, "MQTT publish failed: {e}");
                } else {
                    // Echo back into TagDb so the UI updates immediately, before
                    // any return-trip on the subscribe topic. **Non con l'altro
                    // capo morto** (28-10-2026): il comando parte lo stesso, ma
                    // scrivere `Good` il valore mandato direbbe che è stato
                    // eseguito, e nessuno lo ha ricevuto.
                    if altro_capo_vivo {
                        db.ingest(tag.clone(), value, TagQuality::Good).await;
                    }
                    info!(source = %cfg.id, %tag, %pt, payload, vivo = altro_capo_vivo, "MQTT publish");
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
                    let _messaggio = sws_core::prestazioni::Misura::nuova(format!("sorgente.mqtt.{}", cfg.id));
                    let mut matched = false;
                    if let Some(d) = cfg.disponibilita.as_ref().filter(|d| d.topic == p.topic) {
                        matched = true;
                        let vivo = d.e_vivo(&p.payload);
                        if vivo != altro_capo_vivo || !vivo {
                            if vivo {
                                stato.bus(&cfg.id, Collegamento::Ok, None);
                                info!(source = %cfg.id, topic = %p.topic, "MQTT: l'altro capo è di nuovo vivo");
                            } else {
                                let detto = String::from_utf8_lossy(&p.payload).chars().take(120).collect::<String>();
                                if stato.bus(&cfg.id, Collegamento::NonRisponde, Some(format!("«{}» dice {detto}", p.topic))) {
                                    warn!(source = %cfg.id, topic = %p.topic, payload = %detto, "MQTT: l'altro capo non c'è — i tag passano a Bad");
                                }
                                // I valori restano, ma nessuno può più dire che
                                // siano veri: tornano `Good` col primo valore vero.
                                for topic in cfg.topics.iter().filter(|t| mappata(&t.tag)) {
                                    db.marca_qualita(&topic.tag, TagQuality::Bad).await;
                                }
                            }
                        }
                        altro_capo_vivo = vivo;
                    }
                    for topic in &cfg.topics {
                        if topic.topic == p.topic {
                            matched = true;
                            // Sottoscritta ma senza tag: si è ricevuto davvero
                            // (matched sopra), solo non c'è dove mettere.
                            if !mappata(&topic.tag) { continue; }
                            let value = decode_payload(&p.payload, topic.json_path.as_deref());
                            debug!(
                                source = %cfg.id,
                                tag = %topic.tag,
                                topic = %p.topic,
                                value = %stringify(&value),
                                "MQTT recv",
                            );
                            db.ingest(topic.tag.clone(), value, TagQuality::Good).await;
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
        TagValue::Bool(b) => {
            if *b {
                "true".into()
            } else {
                "false".into()
            }
        }
        TagValue::Int(i) => i.to_string(),
        TagValue::Float(f) => f.to_string(),
        TagValue::Str(s) => s.clone(),
        // Fase 1b: un array o una struttura si pubblica come JSON — è la
        // forma in cui un broker MQTT se l'aspetta, ed è quella che
        // `decode_payload` rilegge.
        v @ (TagValue::Array(_) | TagValue::Struct(_)) => {
            serde_json::to_string(v).unwrap_or_default()
        }
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
    if let Ok(b) = text.parse::<bool>() {
        return TagValue::Bool(b);
    }
    if let Ok(i) = text.parse::<i64>() {
        return TagValue::Int(i);
    }
    if let Ok(f) = text.parse::<f64>() {
        return TagValue::Float(f);
    }
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
            if let Some(i) = n.as_i64() {
                TagValue::Int(i)
            } else if let Some(f) = n.as_f64() {
                TagValue::Float(f)
            } else {
                TagValue::Str(n.to_string())
            }
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
    /// Q49 — impronte TLS note, per il pinning TOFU quando non c'è né una CA
    /// né `insecure_skip_verify`. Stesso archivio usato dalle sorgenti vere
    /// (`SourceSupervisor::mqtt_certificati`): sfogliare un broker e poi
    /// tenerlo come sorgente non deve chiedere fiducia due volte.
    pub certificati: Arc<sws_core::pin_tls::ImprontaStore>,
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
    let t0 = std::time::Instant::now();
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
            // TLS chiesto, né una CA né "non verificare": pinning TOFU (Q49),
            // come per le sorgenti vere. Prima del 13-09-2026 questo ramo non
            // impostava alcun trasporto — parlava IN CHIARO a una porta TLS,
            // il broker chiudeva, e lo sfoglia-topic tornava un elenco vuoto
            // senza dire perché (sembrava un broker senza messaggi, trovato
            // il 2026-08-24 provando proprio questo caso).
            let host_port = format!("{}:{}", params.host, params.port);
            opts.set_transport(pinned_tls_transport(&host_port, &params.certificati));
        }
    }

    let (client, mut eventloop) = AsyncClient::new(opts, 64);
    // Il percorso buono parla (28-10-2026). Prima c'era un `warn!` sull'errore
    // e nient'altro: uno sfoglia che torna vuoto era indistinguibile da uno
    // che non e' mai partito, e per saperlo e' servita un'ora e riprodurre la
    // funzione a mano su un'altra macchina.
    info!(host = %params.host, port = params.port, client_id = %cid, secondi = params.duration_secs, "sfoglia broker: mi collego");

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
                        info!(host = %params.host, "sfoglia broker: collegato, mi iscrivo a #");
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
    info!(host = %params.host, topic = map.len(), durata_s = t0.elapsed().as_secs_f32(), "sfoglia broker: finito");

    let mut result: Vec<BrowsedTopic> = map
        .into_iter()
        .map(|(topic, sample_payload)| BrowsedTopic {
            topic,
            sample_payload,
        })
        .collect();
    result.sort_by(|a, b| a.topic.cmp(&b.topic));
    result
}

#[cfg(test)]
mod tests_righe {
    use super::{mappata, pubblicabile, richieste_di_stato, sottoscrivibile};
    use sws_core::{RichiestaStato, TopicMapping};

    /// Il caso vero, dal progetto Sandokan del 2026-09-07: la prima riga della
    /// sorgente `mqtt-casa` aveva `topic: ''` (28 righe in tutto). Sottoscriverla
    /// faceva chiudere la connessione al broker 2 ms dopo la SUBSCRIBE, in loop
    /// ogni 5 s, portandosi dietro gli altri 27 topic.
    #[test]
    fn una_riga_senza_topic_non_si_sottoscrive() {
        assert!(
            !sottoscrivibile(""),
            "il filtro a lunghezza zero è un errore di protocollo"
        );
        assert!(
            !sottoscrivibile("   "),
            "solo spazi: idem, e il broker chiude"
        );
        assert!(sottoscrivibile("zigbee2mqtt/presa.sandokan"));
        assert!(sottoscrivibile("homeassistant/binary_sensor/x/config"));
        // I caratteri jolly restano legittimi: qui si scarta il vuoto, non si
        // giudica la forma del filtro.
        assert!(sottoscrivibile("casa/+/stato"));
        assert!(sottoscrivibile("#"));
    }

    /// Una riga senza tag riceveva e finiva in `db.ingest("")`, creando un tag
    /// con id vuoto — a ogni retry, per ogni riga della sorgente.
    #[test]
    fn una_riga_senza_tag_non_crea_un_tag_vuoto() {
        assert!(!mappata(""));
        assert!(!mappata("  "));
        assert!(mappata("sandokan.power"));
    }

    fn riga(topic: &str, richiesta: Option<(&str, &str)>) -> TopicMapping {
        TopicMapping {
            tag: "t".into(),
            topic: topic.into(),
            json_path: None,
            publish_topic: None,
            qos: None,
            richiesta_stato: richiesta.map(|(t, p)| RichiestaStato { topic: t.into(), payload: p.into() }),
        }
    }

    /// Lo switch a tre vie del garage (25-10-2026): tre righe sullo stesso
    /// topic di stato, tre richieste diverse sullo stesso `…/get`. Partono tutte
    /// e tre; una riga copiata due volte ne manda una sola; una senza
    /// richiesta non ne manda; un topic con caratteri jolly non parte, perché
    /// il broker chiuderebbe la connessione.
    #[test]
    fn le_richieste_di_stato_del_garage() {
        let righe = vec![
            riga("zigbee2mqtt/garage", Some(("zigbee2mqtt/garage/get", r#"{"state_l1":""}"#))),
            riga("zigbee2mqtt/garage", Some(("zigbee2mqtt/garage/get", r#"{"state_l2":""}"#))),
            riga("zigbee2mqtt/garage", Some(("zigbee2mqtt/garage/get", r#"{"state_l3":""}"#))),
            riga("zigbee2mqtt/garage", Some(("zigbee2mqtt/garage/get", r#"{"state_l3":""}"#))),
            riga("casa/luce", None),
            riga("casa/x", Some(("casa/+/get", ""))),
            riga("casa/y", Some(("  ", "{}"))),
        ];
        let r = richieste_di_stato(&righe);
        assert_eq!(r.len(), 3, "{r:?}");
        assert_eq!(r[0].payload, r#"{"state_l1":""}"#);
        assert_eq!(r[2].payload, r#"{"state_l3":""}"#);
        assert!(!pubblicabile("casa/#"));
        assert!(pubblicabile("zigbee2mqtt/garage/get"));
    }
}

#[cfg(test)]
mod prova_sfoglia_dal_vivo {
    /// Lo «Sfoglia broker» contro un broker **vero**, per vedere da dentro cosa
    /// fa (28-10-2026). `#[ignore]` perche' vuole un broker in ascolto: si
    /// lancia a mano, e l'indirizzo si cambia con `SWS_BROKER_PROVA`.
    ///
    ///   SWS_BROKER_PROVA=192.168.0.203 cargo test -p sws-plugin-mqtt sfoglia_dal_vivo -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn sfoglia_dal_vivo() {
        let host = std::env::var("SWS_BROKER_PROVA").unwrap_or_else(|_| "127.0.0.1".into());
        let t0 = std::time::Instant::now();
        let topics = super::browse(super::BrowseParams {
            host: host.clone(),
            port: 1883,
            client_id: "sws-banco-wp630".into(),
            username: None,
            password: None,
            tls_enabled: false,
            insecure_skip_verify: false,
            ca_cert_path: None,
            duration_secs: 10,
            certificati: std::sync::Arc::new(sws_core::pin_tls::ImprontaStore::new(std::env::temp_dir().join("sws-prova-impronte.json"))),
        })
        .await;
        println!("--- {host}: {} topic in {:?} ---", topics.len(), t0.elapsed());
        for t in &topics {
            println!("    {}  =  {}", t.topic, t.sample_payload);
        }
    }
}
