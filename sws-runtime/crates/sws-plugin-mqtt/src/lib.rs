// Statically linked for the PoC. Dynamic .so loading is deferred until
// third-party plugin support is needed.
//
// PoC scope (per docs/CONTEXT.md §7):
//   - happy-path subscribe with exact-topic matching (no MQTT wildcards)
//   - reconnect on session error with 5 s backoff
//   - Sparkplug B encoding is Phase 3, not handled here

use std::{sync::Arc, time::Duration};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use sws_core::{MqttConfig, TagDb, TagQuality, TagValue};
use tracing::{info, warn};

/// Runs the MQTT subscription loop forever, reconnecting on any error.
/// Designed to be spawned as a detached Tokio task.
pub async fn run(cfg: MqttConfig, db: Arc<TagDb>) {
    loop {
        if let Err(e) = run_session(&cfg, &db).await {
            warn!(source = %cfg.id, "MQTT session ended: {e:#} — retry in 5 s");
            for topic in &cfg.topics {
                db.set(topic.tag.clone(), TagValue::Float(0.0), TagQuality::Bad).await;
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }
}

async fn run_session(cfg: &MqttConfig, db: &TagDb) -> anyhow::Result<()> {
    let mut opts = MqttOptions::new(&cfg.client_id, &cfg.host, cfg.port);
    opts.set_keep_alive(Duration::from_secs(10));
    let (client, mut eventloop) = AsyncClient::new(opts, 32);

    for topic in &cfg.topics {
        client
            .subscribe(&topic.topic, QoS::AtMostOnce)
            .await
            .map_err(|e| anyhow::anyhow!("subscribe '{}': {e}", topic.topic))?;
    }
    info!(
        source = %cfg.id,
        host = %cfg.host, port = cfg.port,
        topics = cfg.topics.len(),
        "MQTT subscribing"
    );

    loop {
        let event = eventloop
            .poll()
            .await
            .map_err(|e| anyhow::anyhow!("eventloop: {e}"))?;

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
