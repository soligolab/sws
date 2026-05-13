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
use tracing::{info, warn};

/// Runs the MQTT subscription + publish loop until `cancel` fires,
/// reconnecting on any error. Tags with a `publish_topic` set in their
/// TopicMapping register on the write bus and forward writes as MQTT
/// publishes (raw string payload).
pub async fn run(cfg: MqttConfig, db: Arc<TagDb>, bus: Arc<TagWriteBus>, cancel: CancellationToken) {
    // Pre-build a (tag → publish_topic) lookup for the writable subset.
    let writers: Vec<(String, String)> = cfg.topics.iter()
        .filter_map(|t| t.publish_topic.as_ref().map(|pt| (t.tag.clone(), pt.clone())))
        .collect();

    loop {
        if cancel.is_cancelled() {
            info!(source = %cfg.id, "MQTT task cancelled");
            return;
        }
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                info!(source = %cfg.id, "MQTT task cancelled");
                return;
            }
            res = run_session(&cfg, &db, &bus, &writers, cancel.clone()) => {
                if let Err(e) = res {
                    warn!(source = %cfg.id, "MQTT session ended: {e:#} — retry in 5 s");
                    for topic in &cfg.topics {
                        db.set(topic.tag.clone(), TagValue::Float(0.0), TagQuality::Bad).await;
                    }
                    tokio::select! {
                        _ = cancel.cancelled() => return,
                        _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                    }
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
            if tls.insecure_skip_verify {
                warn!(source = %cfg.id,
                    "MQTT TLS insecure_skip_verify=true is not yet implemented; \
                     proceeding with full chain validation");
            }
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
        topics = cfg.topics.len(),
        writers = writers.len(),
        "MQTT subscribing"
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
                    db.set(tag.clone(), value, TagQuality::Good).await;
                    info!(source = %cfg.id, %tag, %pt, payload, "MQTT publish");
                }
            }

            // Inbound: poll the eventloop for incoming packets.
            res = eventloop.poll() => {
                let event = res.map_err(|e| anyhow::anyhow!("eventloop: {e}"))?;
                if let Event::Incoming(Packet::Publish(p)) = event {
                    for topic in &cfg.topics {
                        if topic.topic == p.topic {
                            let value = decode_payload(&p.payload, topic.json_path.as_deref());
                            db.set(topic.tag.clone(), value, TagQuality::Good).await;
                        }
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
