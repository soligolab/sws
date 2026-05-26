//! EtherNet/IP (CIP) plugin for SWS.
//!
//! Connects to Allen-Bradley ControlLogix, CompactLogix, and Micro820 PLCs
//! via EtherNet/IP port 44818. Uses the `rseip` crate (pure Rust, async).
//!
//! Tags are read by PLC symbolic name (e.g. "Motor_Speed", "Pump1.Running").
//! Supported CIP types: BOOL, SINT, INT, DINT, LINT, REAL, LREAL.
//! Write-back: per-tag `writable: true` forwards `PUT /api/tags/:id` to PLC.

use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use rseip::client::ab_eip::{AbEipClient, TagValue, TagType};
use rseip::precludes::*;

use sws_core::{EnIpConfig, EnIpDataType, EnIpTagMapping, TagDb, TagQuality, TagValue as SwsTagValue, TagWriteBus, WriteRequest};

/// Entry point: run the EtherNet/IP polling loop for `cfg` until `cancel`.
pub async fn run(
    cfg: EnIpConfig,
    db: Arc<TagDb>,
    bus: Arc<TagWriteBus>,
    cancel: CancellationToken,
) {
    let (write_tx, mut write_rx) = mpsc::channel::<WriteRequest>(32);
    for tm in cfg.tags.iter().filter(|t| t.writable) {
        bus.register(tm.tag.clone(), write_tx.clone()).await;
    }
    drop(write_tx);

    if let Err(e) = session(&cfg, &db, &mut write_rx, cancel).await {
        warn!(source = %cfg.id, "EtherNet/IP error: {e:#} — stopped (save config to retry)");
        for tm in &cfg.tags {
            db.set(tm.tag.clone(), SwsTagValue::Float(0.0), TagQuality::Bad).await;
        }
    }
}

async fn session(
    cfg: &EnIpConfig,
    db: &TagDb,
    write_rx: &mut mpsc::Receiver<WriteRequest>,
    cancel: CancellationToken,
) -> anyhow::Result<()> {
    // rseip expects "host:port" — default EtherNet/IP port is 44818.
    let host = format!("{}:44818", cfg.ip);
    info!(source = %cfg.id, host = %host, slot = cfg.slot, "EtherNet/IP connecting");

    let mut client = AbEipClient::new_host_lookup(&host)
        .await
        .map_err(|e| anyhow::anyhow!("EtherNet/IP connect {host}: {e}"))?
        .with_connection_path(PortSegment::default());

    info!(source = %cfg.id, "EtherNet/IP connected");

    // Build writable-tag lookup: SWS tag id → index in cfg.tags.
    let write_map: HashMap<String, usize> = cfg.tags.iter().enumerate()
        .filter(|(_, t)| t.writable)
        .map(|(i, t)| (t.tag.clone(), i))
        .collect();

    let poll_dur = Duration::from_millis(cfg.poll_interval_ms);
    let mut ticker = tokio::time::interval(poll_dur);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = client.close().await;
                return Ok(());
            }

            _ = ticker.tick() => {
                for tm in &cfg.tags {
                    match read_one(&mut client, tm).await {
                        Ok(val) => { db.set(tm.tag.clone(), val, TagQuality::Good).await; }
                        Err(e) => {
                            warn!(source = %cfg.id, tag = %tm.tag, "read error: {e}");
                            db.set(tm.tag.clone(), SwsTagValue::Float(0.0), TagQuality::Bad).await;
                            // Re-connect on next tick rather than bailing completely.
                        }
                    }
                }
            }

            Some((tag, value)) = write_rx.recv() => {
                if let Some(&idx) = write_map.get(&tag) {
                    let tm = &cfg.tags[idx];
                    if let Err(e) = write_one(&mut client, tm, &value).await {
                        warn!(source = %cfg.id, tag = %tag, "write error: {e}");
                    } else {
                        db.set(tag, value, TagQuality::Good).await;
                    }
                }
            }
        }
    }
}

// ── Per-tag read ──────────────────────────────────────────────────────────────

async fn read_one(client: &mut AbEipClient, tm: &EnIpTagMapping) -> anyhow::Result<SwsTagValue> {
    let tag = EPath::from_symbol(tm.plc_tag.as_str());

    let val = match tm.data_type {
        EnIpDataType::Bool => {
            let tv: TagValue<u8> = client.read_tag(tag).await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
            SwsTagValue::Bool(tv.value != 0)
        }
        EnIpDataType::Sint => {
            let tv: TagValue<i8> = client.read_tag(tag).await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
            SwsTagValue::Int(tv.value as i64)
        }
        EnIpDataType::Int => {
            let tv: TagValue<i16> = client.read_tag(tag).await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
            SwsTagValue::Int(tv.value as i64)
        }
        EnIpDataType::Dint => {
            let tv: TagValue<i32> = client.read_tag(tag).await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
            SwsTagValue::Int(tv.value as i64)
        }
        EnIpDataType::Lint => {
            let tv: TagValue<i64> = client.read_tag(tag).await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
            SwsTagValue::Int(tv.value)
        }
        EnIpDataType::Real => {
            let tv: TagValue<f32> = client.read_tag(tag).await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
            SwsTagValue::Float(tv.value as f64)
        }
    };

    Ok(val)
}

// ── Per-tag write ─────────────────────────────────────────────────────────────

async fn write_one(
    client: &mut AbEipClient,
    tm: &EnIpTagMapping,
    val: &SwsTagValue,
) -> anyhow::Result<()> {
    let tag = EPath::from_symbol(tm.plc_tag.as_str());

    match tm.data_type {
        EnIpDataType::Bool => {
            let v: u8 = match val {
                SwsTagValue::Bool(b)  => if *b { 255 } else { 0 },
                SwsTagValue::Int(i)   => if *i != 0 { 255 } else { 0 },
                SwsTagValue::Float(f) => if *f != 0.0 { 255 } else { 0 },
                SwsTagValue::Str(s)   => if !s.is_empty() && s != "0" { 255 } else { 0 },
            };
            client.write_tag(tag, TagValue { tag_type: TagType::Bool, value: v }).await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
        }
        EnIpDataType::Sint => {
            let v = coerce_to_i64(val) as i8;
            client.write_tag(tag, TagValue { tag_type: TagType::Sint, value: v }).await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
        }
        EnIpDataType::Int => {
            let v = coerce_to_i64(val) as i16;
            client.write_tag(tag, TagValue { tag_type: TagType::Int, value: v }).await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
        }
        EnIpDataType::Dint => {
            let v = coerce_to_i64(val) as i32;
            client.write_tag(tag, TagValue { tag_type: TagType::Dint, value: v }).await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
        }
        EnIpDataType::Lint => {
            let v = coerce_to_i64(val);
            client.write_tag(tag, TagValue { tag_type: TagType::Lint, value: v }).await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
        }
        EnIpDataType::Real => {
            let v = coerce_to_f64(val) as f32;
            client.write_tag(tag, TagValue { tag_type: TagType::Real, value: v }).await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
        }
    }

    Ok(())
}

fn coerce_to_i64(v: &SwsTagValue) -> i64 {
    match v {
        SwsTagValue::Int(i)   => *i,
        SwsTagValue::Float(f) => *f as i64,
        SwsTagValue::Bool(b)  => if *b { 1 } else { 0 },
        SwsTagValue::Str(s)   => s.trim().parse().unwrap_or(0),
    }
}

fn coerce_to_f64(v: &SwsTagValue) -> f64 {
    match v {
        SwsTagValue::Float(f) => *f,
        SwsTagValue::Int(i)   => *i as f64,
        SwsTagValue::Bool(b)  => if *b { 1.0 } else { 0.0 },
        SwsTagValue::Str(s)   => s.trim().parse().unwrap_or(0.0),
    }
}
