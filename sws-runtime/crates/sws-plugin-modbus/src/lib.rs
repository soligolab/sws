// Statically linked for the PoC. Dynamic .so loading via the C ABI in
// sws-plugin-api is deferred until third-party plugin support is needed.

use std::{collections::HashMap, sync::Arc, time::Duration};
use sws_core::{ModbusRtuConfig, ModbusTcpConfig, TagDb, TagQuality, TagValue, TagWriteBus, WriteRequest};
use tokio::sync::mpsc;
use tokio_modbus::prelude::*;
use tokio_serial::{DataBits, Parity, SerialPortBuilderExt, StopBits};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

/// Runs the Modbus TCP polling loop until `cancel` fires, reconnecting on any
/// error. Each tag in `cfg.registers` is registered with the write bus so a
/// `PUT /api/tags/:id` is forwarded as `write_single_register` (raw_u16 =
/// value / scale, clamped).
pub async fn run(cfg: ModbusTcpConfig, db: Arc<TagDb>, bus: Arc<TagWriteBus>, cancel: CancellationToken) {
    // One mpsc channel feeds all write requests for the tags this source owns.
    let (write_tx, mut write_rx) = mpsc::channel::<WriteRequest>(32);
    for reg in &cfg.registers {
        bus.register(reg.tag.clone(), write_tx.clone()).await;
    }
    drop(write_tx); // we keep the receiver; bus entries hold their own clones

    // Build an address+scale lookup for the write path (tag → register).
    let routes: HashMap<String, (u16, f64)> = cfg.registers.iter()
        .map(|r| (r.tag.clone(), (r.address, r.scale)))
        .collect();

    loop {
        if cancel.is_cancelled() {
            info!(source = %cfg.id, "Modbus task cancelled");
            return;
        }
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                info!(source = %cfg.id, "Modbus task cancelled");
                return;
            }
            res = session(&cfg, &db, &routes, &mut write_rx, cancel.clone()) => match res {
                Ok(()) => return, // clean exit (cancellation)
                Err(e) => {
                    warn!(source = %cfg.id, "Modbus error: {e:#} — marking tags Bad, retry in 5 s");
                    for reg in &cfg.registers {
                        db.set(reg.tag.clone(), TagValue::Float(0.0), TagQuality::Bad).await;
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

async fn session(
    cfg: &ModbusTcpConfig,
    db: &TagDb,
    routes: &HashMap<String, (u16, f64)>,
    write_rx: &mut mpsc::Receiver<WriteRequest>,
    cancel: CancellationToken,
) -> anyhow::Result<()> {
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
        tokio::select! {
            // Stop quickly when the supervisor cancels us — don't wait for the
            // next tick or a write request.
            _ = cancel.cancelled() => return Ok(()),

            // Periodic read — every register, in declaration order.
            _ = ticker.tick() => {
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

            // Write request from the bus (PUT /api/tags/:id → TagWriteBus → here).
            Some((tag, value)) = write_rx.recv() => {
                let Some(&(address, scale)) = routes.get(&tag) else { continue };
                let Some(raw) = tagvalue_to_register(&value, scale) else {
                    warn!(source = %cfg.id, %tag, ?value, "write rejected: value out of range / unsupported type");
                    continue;
                };
                match ctx.write_single_register(address, raw).await {
                    Ok(_) => {
                        // Echo the value back into the TagDb so the UI updates immediately,
                        // without waiting for the next poll cycle.
                        db.set(tag.clone(), TagValue::Float(raw as f64 * scale), TagQuality::Good).await;
                        info!(source = %cfg.id, %tag, address, raw, "Modbus write OK");
                    }
                    Err(e) => {
                        db.set(tag.clone(), TagValue::Float(0.0), TagQuality::Bad).await;
                        return Err(anyhow::anyhow!("write register {address} for tag {tag}: {e}"));
                    }
                }
            }
        }
    }
}

/// Convert a `TagValue` into the raw `u16` to write into a holding register.
/// Applies the inverse scale; rejects non-finite, out-of-range, or non-numeric.
fn tagvalue_to_register(value: &TagValue, scale: f64) -> Option<u16> {
    let f: f64 = match value {
        TagValue::Bool(b)  => if *b { 1.0 } else { 0.0 },
        TagValue::Int(i)   => *i as f64,
        TagValue::Float(f) => *f,
        TagValue::Str(s)   => s.trim().parse().ok()?,
    };
    let raw = (f / scale).round();
    if raw.is_finite() && raw >= 0.0 && raw <= u16::MAX as f64 {
        Some(raw as u16)
    } else {
        None
    }
}

/// Runs the Modbus RTU (serial) polling loop until `cancel` fires, reconnecting
/// on any error. Same structure as `run()` but uses `rtu::connect_slave` with a
/// `tokio_serial::SerialStream` as transport.
pub async fn run_rtu(cfg: ModbusRtuConfig, db: Arc<TagDb>, bus: Arc<TagWriteBus>, cancel: CancellationToken) {
    let (write_tx, mut write_rx) = mpsc::channel::<WriteRequest>(32);
    for reg in &cfg.registers {
        bus.register(reg.tag.clone(), write_tx.clone()).await;
    }
    drop(write_tx);

    let routes: HashMap<String, (u16, f64)> = cfg.registers.iter()
        .map(|r| (r.tag.clone(), (r.address, r.scale)))
        .collect();

    loop {
        if cancel.is_cancelled() {
            info!(source = %cfg.id, "Modbus RTU task cancelled");
            return;
        }
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                info!(source = %cfg.id, "Modbus RTU task cancelled");
                return;
            }
            res = session_rtu(&cfg, &db, &routes, &mut write_rx, cancel.clone()) => match res {
                Ok(()) => return,
                Err(e) => {
                    warn!(source = %cfg.id, "Modbus RTU error: {e:#} — marking tags Bad, retry in 5 s");
                    for reg in &cfg.registers {
                        db.set(reg.tag.clone(), TagValue::Float(0.0), TagQuality::Bad).await;
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

async fn session_rtu(
    cfg: &ModbusRtuConfig,
    db: &TagDb,
    routes: &HashMap<String, (u16, f64)>,
    write_rx: &mut mpsc::Receiver<WriteRequest>,
    cancel: CancellationToken,
) -> anyhow::Result<()> {
    let parity = match cfg.parity.to_ascii_uppercase().as_str() {
        "E" => Parity::Even,
        "O" => Parity::Odd,
        _   => Parity::None,
    };
    let data_bits = match cfg.data_bits {
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    };
    let stop_bits = match cfg.stop_bits {
        2 => StopBits::Two,
        _ => StopBits::One,
    };

    info!(source = %cfg.id, device = %cfg.device, baud = cfg.baud_rate,
          unit_id = cfg.unit_id, "Modbus RTU connecting");

    let stream = tokio_serial::new(&cfg.device, cfg.baud_rate)
        .parity(parity)
        .data_bits(data_bits)
        .stop_bits(stop_bits)
        .open_native_async()
        .map_err(|e| anyhow::anyhow!("open serial {}: {e}", cfg.device))?;

    let mut ctx = rtu::connect_slave(stream, Slave(cfg.unit_id))
        .await
        .map_err(|e| anyhow::anyhow!("connect RTU {}: {e}", cfg.device))?;

    info!(source = %cfg.id, "Modbus RTU connected");

    let mut ticker = tokio::time::interval(Duration::from_millis(cfg.poll_interval_ms));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = cancel.cancelled() => return Ok(()),

            _ = ticker.tick() => {
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

            Some((tag, value)) = write_rx.recv() => {
                let Some(&(address, scale)) = routes.get(&tag) else { continue };
                let Some(raw) = tagvalue_to_register(&value, scale) else {
                    warn!(source = %cfg.id, %tag, ?value, "write rejected: value out of range / unsupported type");
                    continue;
                };
                match ctx.write_single_register(address, raw).await {
                    Ok(_) => {
                        db.set(tag.clone(), TagValue::Float(raw as f64 * scale), TagQuality::Good).await;
                        info!(source = %cfg.id, %tag, address, raw, "Modbus RTU write OK");
                    }
                    Err(e) => {
                        db.set(tag.clone(), TagValue::Float(0.0), TagQuality::Bad).await;
                        return Err(anyhow::anyhow!("write register {address} for tag {tag}: {e}"));
                    }
                }
            }
        }
    }
}
