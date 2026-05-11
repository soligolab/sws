// Statically linked for the PoC. Dynamic .so loading via the C ABI in
// sws-plugin-api is deferred until third-party plugin support is needed.

use std::{sync::Arc, time::Duration};
use sws_core::{ModbusTcpConfig, TagDb, TagQuality, TagValue};
use tokio_modbus::prelude::*;
use tracing::{info, warn};

/// Runs the Modbus TCP polling loop forever, reconnecting on any error.
/// Designed to be spawned as a detached Tokio task.
pub async fn run(cfg: ModbusTcpConfig, db: Arc<TagDb>) {
    loop {
        match poll_loop(&cfg, &db).await {
            Ok(()) => break, // clean exit — shouldn't happen in normal operation
            Err(e) => {
                warn!(source = %cfg.id, "Modbus error: {e:#} — marking tags Bad, retry in 5 s");
                for reg in &cfg.registers {
                    db.set(reg.tag.clone(), TagValue::Float(0.0), TagQuality::Bad).await;
                }
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

async fn poll_loop(cfg: &ModbusTcpConfig, db: &TagDb) -> anyhow::Result<()> {
    let addr: std::net::SocketAddr = format!("{}:{}", cfg.host, cfg.port)
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid host:port '{}:{}': {e}", cfg.host, cfg.port))?;

    info!(source = %cfg.id, %addr, unit_id = cfg.unit_id, "Modbus TCP connecting");

    let mut ctx = tcp::connect_slave(addr, Slave(cfg.unit_id))
        .await
        .map_err(|e| anyhow::anyhow!("connect {addr}: {e}"))?;

    info!(source = %cfg.id, "Modbus TCP connected");

    let mut ticker = tokio::time::interval(Duration::from_millis(cfg.poll_interval_ms));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        ticker.tick().await;

        for reg in &cfg.registers {
            match ctx.read_holding_registers(reg.address, 1).await {
                Ok(words) => {
                    let raw = words.first().copied().unwrap_or(0) as f64;
                    db.set(reg.tag.clone(), TagValue::Float(raw * reg.scale), TagQuality::Good).await;
                }
                Err(e) => {
                    db.set(reg.tag.clone(), TagValue::Float(0.0), TagQuality::Bad).await;
                    return Err(anyhow::anyhow!("read register {}: {e}", reg.address));
                }
            }
        }
    }
}
