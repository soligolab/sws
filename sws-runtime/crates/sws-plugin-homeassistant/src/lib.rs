// HomeAssistant protocol plugin.
//
// Connects to a HA instance via REST (initial state fetch) + WebSocket
// (live state_changed events + call_service write-back).  Reconnects with 5 s
// backoff on any error — same pattern as the MQTT plugin.
//
// Only ws:// / http:// URLs are supported (no TLS).  For wss:// add
// tokio-tungstenite's "rustls-tls-webpki-roots" feature.

use std::{collections::HashMap, sync::Arc, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value as Json};
use sws_core::{EntityMapping, HomeAssistantConfig, TagDb, TagQuality, TagValue, TagWriteBus};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

pub async fn run(
    cfg: HomeAssistantConfig,
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    cancel: CancellationToken,
) {
    let entity_map: HashMap<String, EntityMapping> = cfg.entities.iter()
        .map(|e| (e.entity_id.clone(), e.clone()))
        .collect();

    // Validate config before entering the retry loop — permanent errors (missing
    // token, empty URL) must not spam the log with repeated retries.
    if let Err(e) = effective_token(&cfg) {
        error!(source = %cfg.id, "HomeAssistant source misconfigured: {e:#} — fix the config and reopen the project");
        for m in &cfg.entities {
            db.ingest(m.tag.clone(), TagValue::Bool(false), TagQuality::Bad).await;
        }
        return;
    }

    if let Err(e) = run_session(&cfg, &db, &bus, &entity_map, cancel).await {
        warn!(source = %cfg.id, "HomeAssistant session ended: {e:#} — stopped (save config to retry)");
        for m in &cfg.entities {
            db.ingest(m.tag.clone(), TagValue::Bool(false), TagQuality::Bad).await;
        }
    }
}

async fn run_session(
    cfg: &HomeAssistantConfig,
    db: &Arc<TagDb>,
    bus: &Arc<TagWriteBus>,
    entity_map: &HashMap<String, EntityMapping>,
    cancel: CancellationToken,
) -> anyhow::Result<()> {
    let token = effective_token(cfg)?;

    // Initial REST fetch — populate all mapped tags before the WS connects.
    let client = reqwest::Client::new();
    let states_url = format!("{}/api/states", cfg.url.trim_end_matches('/'));
    match client
        .get(&states_url)
        .header("Authorization", format!("Bearer {token}"))
        .timeout(Duration::from_secs(10))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<Vec<HaState>>().await {
                Ok(states) => {
                    for state in states {
                        if let Some(mapping) = entity_map.get(&state.entity_id) {
                            if let Some(val) = parse_ha_state(&state.state, &state.attributes, mapping) {
                                db.ingest(mapping.tag.clone(), val, TagQuality::Good).await;
                            }
                        }
                    }
                }
                Err(e) => warn!(source = %cfg.id, "HA REST parse error: {e}"),
            }
        }
        Ok(resp) => warn!(source = %cfg.id, status = %resp.status(), "HA REST /api/states error"),
        Err(e)   => warn!(source = %cfg.id, "HA REST /api/states failed: {e}"),
    }

    // Build WebSocket URL (http→ws, https→wss).
    let ws_endpoint = cfg.url
        .trim_end_matches('/')
        .replace("https://", "wss://")
        .replace("http://", "ws://");
    let ws_endpoint = format!("{ws_endpoint}/api/websocket");

    info!(source = %cfg.id, endpoint = %ws_endpoint, "connecting to HomeAssistant WebSocket");
    let (ws_stream, _) = connect_async(&ws_endpoint).await
        .map_err(|e| anyhow::anyhow!("WS connect failed: {e}"))?;
    let (mut write, mut read) = ws_stream.split();

    // HA sends {"type":"auth_required"} immediately on connect.
    let first = read.next().await
        .ok_or_else(|| anyhow::anyhow!("WS closed before auth_required"))??;
    let first_json: Json = serde_json::from_str(first.to_text()
        .map_err(|e| anyhow::anyhow!("WS non-text frame: {e}"))?)?;
    if first_json["type"] != "auth_required" {
        anyhow::bail!("expected auth_required, got: {}", first_json["type"]);
    }

    write.send(Message::Text(
        json!({ "type": "auth", "access_token": token }).to_string(),
    )).await?;

    let auth_resp = read.next().await
        .ok_or_else(|| anyhow::anyhow!("WS closed during auth"))??;
    let auth_json: Json = serde_json::from_str(auth_resp.to_text()
        .map_err(|e| anyhow::anyhow!("WS non-text frame: {e}"))?)?;
    if auth_json["type"] != "auth_ok" {
        let msg = auth_json["message"].as_str().unwrap_or("unknown");
        anyhow::bail!("HA auth failed: {msg}");
    }
    info!(source = %cfg.id, "authenticated with HomeAssistant");

    write.send(Message::Text(
        json!({ "id": 1, "type": "subscribe_events", "event_type": "state_changed" })
            .to_string(),
    )).await?;

    // Register writable tags on the bus.
    let writable: Vec<(String, EntityMapping)> = cfg.entities.iter()
        .filter(|e| e.write_service.is_some())
        .map(|e| (e.tag.clone(), e.clone()))
        .collect();

    let (write_tx, mut write_rx) = mpsc::channel::<(String, TagValue)>(64);
    for (tag, _) in &writable {
        bus.register(tag.clone(), write_tx.clone()).await;
    }
    let tag_to_entity: HashMap<String, EntityMapping> =
        writable.into_iter().collect();

    let mut msg_id = 2u64;

    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => return Ok(()),

            Some((tag, value)) = write_rx.recv() => {
                if let Some(mapping) = tag_to_entity.get(&tag) {
                    if let Some((domain, service, data)) = build_service_call(mapping, &value) {
                        let payload = json!({
                            "id": msg_id,
                            "type": "call_service",
                            "domain": domain,
                            "service": service,
                            "target": { "entity_id": mapping.entity_id },
                            "service_data": data,
                        });
                        msg_id += 1;
                        write.send(Message::Text(payload.to_string())).await?;
                        db.ingest(tag, value, TagQuality::Good).await;
                    }
                }
            }

            msg = read.next() => {
                match msg {
                    None              => anyhow::bail!("WebSocket closed"),
                    Some(Err(e))      => anyhow::bail!("WebSocket error: {e}"),
                    Some(Ok(Message::Text(text))) => {
                        handle_event(text.as_str(), db, entity_map).await;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        write.send(Message::Pong(data)).await?;
                    }
                    Some(Ok(_)) => {}
                }
            }
        }
    }
}

async fn handle_event(text: &str, db: &Arc<TagDb>, entity_map: &HashMap<String, EntityMapping>) {
    let Ok(msg) = serde_json::from_str::<Json>(text) else { return };
    if msg["type"] != "event" { return; }
    let event = &msg["event"];
    if event["event_type"] != "state_changed" { return; }

    let data = &event["data"];
    let Some(entity_id) = data["entity_id"].as_str() else { return };
    let Some(mapping) = entity_map.get(entity_id) else { return };

    let new_state = &data["new_state"];
    let Some(state_str) = new_state["state"].as_str() else { return };
    let attributes = &new_state["attributes"];

    if let Some(val) = parse_ha_state(state_str, attributes, mapping) {
        debug!(tag = %mapping.tag, entity = %entity_id, "HA state_changed");
        db.ingest(mapping.tag.clone(), val, TagQuality::Good).await;
    }
}

fn parse_ha_state(state: &str, attributes: &Json, mapping: &EntityMapping) -> Option<TagValue> {
    let raw: String = if let Some(attr) = &mapping.attribute {
        // Attribute values in JSON may be strings or numbers.
        let v = attributes.get(attr)?;
        match v {
            Json::String(s) => s.clone(),
            Json::Number(n) => n.to_string(),
            Json::Bool(b)   => b.to_string(),
            _               => return None,
        }
    } else {
        state.to_string()
    };

    if raw == "unavailable" || raw == "unknown" { return None; }

    if raw == "on" || raw == "true" || raw == "home" || raw == "open"
        { return Some(TagValue::Bool(true));  }
    if raw == "off" || raw == "false" || raw == "not_home" || raw == "closed"
        { return Some(TagValue::Bool(false)); }

    if let Ok(f) = raw.parse::<f64>() { return Some(TagValue::Float(f)); }

    Some(TagValue::Str(raw))
}

fn build_service_call(mapping: &EntityMapping, value: &TagValue) -> Option<(String, String, Json)> {
    let domain = mapping.write_domain.as_ref()?.clone();
    let svc_base = mapping.write_service.as_ref()?.clone();

    let (service, data) = match value {
        TagValue::Bool(true)  => (svc_base, json!({})),
        TagValue::Bool(false) => {
            let svc = match svc_base.as_str() {
                "turn_on"     => "turn_off".into(),
                "open_cover"  => "close_cover".into(),
                "close_cover" => "open_cover".into(),
                _             => svc_base,
            };
            (svc, json!({}))
        }
        TagValue::Float(f) => (svc_base, json!({ "value": f })),
        TagValue::Int(i)   => (svc_base, json!({ "value": i })),
        TagValue::Str(s)   => (svc_base, json!({ "value": s })),
    };

    Some((domain, service, data))
}

fn effective_token(cfg: &HomeAssistantConfig) -> anyhow::Result<String> {
    if let Some(env_var) = &cfg.token_env {
        std::env::var(env_var)
            .map_err(|_| anyhow::anyhow!("env var '{}' not set", env_var))
    } else if let Some(t) = &cfg.token {
        Ok(t.clone())
    } else {
        anyhow::bail!("HA source '{}': neither 'token' nor 'token_env' is configured", cfg.id)
    }
}

#[derive(Deserialize)]
struct HaState {
    entity_id: String,
    state: String,
    #[serde(default)]
    attributes: Json,
}
