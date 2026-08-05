//! Sparkplug B support for sws-plugin-mqtt.
//!
//! Sparkplug B is an MQTT-based IIoT payload specification (Eclipse Foundation).
//! Payloads are protobuf-encoded; topics follow:
//!   spBv1.0/{group_id}/{msg_type}/{edge_node_id}[/{device_id}]
//!
//! This module handles:
//!   - SCADA Host STATE birth (online/offline)
//!   - NBIRTH / NDATA / DBIRTH / DDATA → tag updates
//!   - NDEATH / DDEATH → Bad quality on mapped tags
//!   - NCMD write-back for writable metrics
//!
//! Protobuf structs are hand-written (no protoc/build.rs needed — the schema
//! is small and stable).

use std::{collections::HashMap, sync::Arc, time::Duration};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};
use prost::Message as ProstMessage;

use sws_core::{MqttConfig, SparkplugConfig, TagDb, TagQuality, TagValue, TagWriteBus, WriteRequest};

// ── Sparkplug B protobuf structs (hand-written, matching sparkplug_b.proto v1.0) ──

#[derive(Clone, PartialEq, prost::Message)]
pub struct Payload {
    #[prost(uint64, optional, tag = "1")]
    pub timestamp: Option<u64>,
    #[prost(message, repeated, tag = "2")]
    pub metrics: Vec<Metric>,
    #[prost(uint64, optional, tag = "3")]
    pub seq: Option<u64>,
    #[prost(string, optional, tag = "4")]
    pub uuid: Option<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Metric {
    #[prost(string, optional, tag = "1")]
    pub name: Option<String>,
    #[prost(uint64, optional, tag = "3")]
    pub timestamp: Option<u64>,
    /// Sparkplug B datatype: 1=Int8 … 8=UInt64, 9=Float, 10=Double, 11=Boolean, 12=String
    #[prost(uint32, optional, tag = "4")]
    pub datatype: Option<u32>,
    #[prost(oneof = "MetricValue", tags = "7, 8, 9, 10, 11, 12")]
    pub value: Option<MetricValue>,
}

#[derive(Clone, PartialEq, prost::Oneof)]
pub enum MetricValue {
    #[prost(uint32, tag = "7")]
    IntValue(u32),
    #[prost(uint64, tag = "8")]
    LongValue(u64),
    #[prost(float, tag = "9")]
    FloatValue(f32),
    #[prost(double, tag = "10")]
    DoubleValue(f64),
    #[prost(bool, tag = "11")]
    BooleanValue(bool),
    #[prost(string, tag = "12")]
    StringValue(String),
}

// ── Entry point ───────────────────────────────────────────────────────────────

/// Run a Sparkplug B session until `cancel`. Reconnects on error with backoff.
pub async fn run_sparkplug(
    cfg: MqttConfig,
    spb: SparkplugConfig,
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    cancel: CancellationToken,
) {
    loop {
        match session(&cfg, &spb, &db, &bus, cancel.clone()).await {
            Ok(()) => break,
            Err(e) => {
                if cancel.is_cancelled() { break; }
                warn!(source = %cfg.id, "Sparkplug B session error: {e:#} — retry in 5s");
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                }
            }
        }
    }
    // Mark all mapped tags Bad on exit.
    for m in &spb.metrics {
        db.set(m.tag.clone(), TagValue::Float(0.0), TagQuality::Bad).await;
    }
}

async fn session(
    cfg: &MqttConfig,
    spb: &SparkplugConfig,
    db: &Arc<TagDb>,
    bus: &Arc<TagWriteBus>,
    cancel: CancellationToken,
) -> anyhow::Result<()> {
    let mut opts = MqttOptions::new(&cfg.client_id, &cfg.host, cfg.port);
    opts.set_max_packet_size(crate::MAX_PACKET_SIZE_BYTES, crate::MAX_PACKET_SIZE_BYTES);
    opts.set_keep_alive(Duration::from_secs(u64::from(cfg.keep_alive_secs.unwrap_or(10))));
    if let Some(clean) = cfg.clean_session { opts.set_clean_session(clean); }

    if let Some(user) = cfg.username.clone() {
        let pw = cfg.password_env.as_deref()
            .and_then(|n| std::env::var(n).ok())
            .or_else(|| cfg.password.clone())
            .unwrap_or_default();
        opts.set_credentials(user, pw);
    }

    // SCADA Host STATE: last-will = offline, birth = online.
    let state_topic = format!("spBv1.0/STATE/{}", spb.host_id);
    opts.set_last_will(rumqttc::LastWill::new(
        &state_topic,
        "OFFLINE",
        QoS::AtLeastOnce,
        true,
    ));

    let (client, mut eventloop) = AsyncClient::new(opts, 64);

    // Subscribe to the entire group namespace.
    let group_topic = format!("spBv1.0/{}/#", spb.group_id);
    client.subscribe(&group_topic, QoS::AtLeastOnce).await
        .map_err(|e| anyhow::anyhow!("subscribe '{group_topic}': {e}"))?;

    // Publish SCADA Host online STATE.
    client.publish(&state_topic, QoS::AtLeastOnce, true, "ONLINE").await
        .map_err(|e| anyhow::anyhow!("publish STATE ONLINE: {e}"))?;

    info!(source = %cfg.id, group = %spb.group_id, host = %spb.host_id,
          client_id = %cfg.client_id, "Sparkplug B connected");

    // Build metric-name → index lookup for fast dispatch.
    let metric_idx: HashMap<String, usize> = spb.metrics.iter().enumerate()
        .map(|(i, m)| (m.metric_name.clone(), i))
        .collect();

    // Register writable metrics on the write bus.
    let (write_tx, mut write_rx) = mpsc::channel::<WriteRequest>(32);
    for m in spb.metrics.iter().filter(|m| m.writable) {
        bus.register(m.tag.clone(), write_tx.clone()).await;
    }
    drop(write_tx);

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = client.publish(&state_topic, QoS::AtLeastOnce, true, "OFFLINE").await;
                return Ok(());
            }

            Some((tag, value)) = write_rx.recv() => {
                // Find the metric mapping for this tag.
                let Some(m) = spb.metrics.iter().find(|m| m.tag == tag) else { continue };

                // Build NCMD payload with one metric.
                let payload_bytes = build_cmd_payload(&m.metric_name, &value);

                // Send to the first edge node we know about. In a PoC, we
                // use the group id; a full implementation would track NBIRTH
                // node IDs per group. Use a wildcard-free topic to keep
                // the broker simple: `spBv1.0/{group}/NCMD/{host_id}`.
                let ncmd_topic = format!("spBv1.0/{}/NCMD/{}", spb.group_id, spb.host_id);
                if let Err(e) = client.publish(&ncmd_topic, QoS::AtLeastOnce, false, payload_bytes).await {
                    warn!(source = %cfg.id, tag, "Sparkplug NCMD publish failed: {e}");
                } else {
                    db.set(tag, value, TagQuality::Good).await;
                }
            }

            res = eventloop.poll() => {
                let event = res.map_err(|e| anyhow::anyhow!("eventloop: {e}"))?;
                if let Event::Incoming(Packet::Publish(p)) = event {
                    handle_message(&p.topic, &p.payload, db, spb, &metric_idx).await;
                }
            }
        }
    }
}

async fn handle_message(
    topic: &str,
    payload: &[u8],
    db: &TagDb,
    spb: &SparkplugConfig,
    metric_idx: &HashMap<String, usize>,
) {
    // Topic format: spBv1.0/{group}/{msg_type}/{edge_node}[/{device}]
    let parts: Vec<&str> = topic.splitn(6, '/').collect();
    if parts.len() < 4 { return; }
    let msg_type = parts[2];

    match msg_type {
        "NBIRTH" | "NDATA" | "DBIRTH" | "DDATA" => {
            match Payload::decode(payload) {
                Ok(pl) => {
                    for metric in &pl.metrics {
                        let Some(name) = metric.name.as_deref() else { continue };
                        let Some(&idx) = metric_idx.get(name) else {
                            debug!(topic, metric = name, "Sparkplug metric not mapped");
                            continue;
                        };
                        let tag = &spb.metrics[idx].tag;
                        let value = metric_to_tagvalue(metric);
                        db.set(tag.clone(), value, TagQuality::Good).await;
                    }
                }
                Err(e) => warn!(topic, "Sparkplug proto decode error: {e}"),
            }
        }
        "NDEATH" | "DDEATH" => {
            for m in &spb.metrics {
                db.set(m.tag.clone(), TagValue::Float(0.0), TagQuality::Bad).await;
            }
        }
        _ => {}
    }
}

fn metric_to_tagvalue(m: &Metric) -> TagValue {
    match &m.value {
        Some(MetricValue::BooleanValue(b)) => TagValue::Bool(*b),
        Some(MetricValue::IntValue(i))     => TagValue::Int(*i as i64),
        Some(MetricValue::LongValue(l))    => TagValue::Int(*l as i64),
        Some(MetricValue::FloatValue(f))   => TagValue::Float(*f as f64),
        Some(MetricValue::DoubleValue(d))  => TagValue::Float(*d),
        Some(MetricValue::StringValue(s))  => TagValue::Str(s.clone()),
        None => {
            // Datatype-only (e.g. in BIRTH with null value) — default to 0.
            match m.datatype.unwrap_or(0) {
                11 => TagValue::Bool(false),
                12 => TagValue::Str(String::new()),
                _  => TagValue::Float(0.0),
            }
        }
    }
}

/// Build a minimal Sparkplug B payload with a single metric command value.
fn build_cmd_payload(metric_name: &str, value: &TagValue) -> Vec<u8> {
    let metric_value = match value {
        TagValue::Bool(b)  => Some(MetricValue::BooleanValue(*b)),
        TagValue::Int(i)   => Some(MetricValue::LongValue(*i as u64)),
        TagValue::Float(f) => Some(MetricValue::DoubleValue(*f)),
        TagValue::Str(s)   => Some(MetricValue::StringValue(s.clone())),
    };
    let payload = Payload {
        timestamp: None,
        seq: None,
        uuid: None,
        metrics: vec![Metric {
            name: Some(metric_name.to_string()),
            timestamp: None,
            datatype: None,
            value: metric_value,
        }],
    };
    payload.encode_to_vec()
}
