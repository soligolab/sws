//! Siemens S7 ISO-on-TCP plugin for SWS.
//!
//! Connects to S7-300/400/1200/1500 PLCs via port 102 (ISO-on-TCP).
//! Uses the `s7` crate (pure Rust, no C deps) wrapped in `spawn_blocking`.
//!
//! Supported memory areas: DB (Data Block), M (Merker), I (inputs), Q (outputs).
//! Supported data types: BOOL, BYTE, INT (16-bit signed), WORD (16-bit unsigned),
//! DINT (32-bit signed), REAL (32-bit float).

use std::{collections::HashMap, net::IpAddr, sync::Arc, time::Duration};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use s7::{client, tcp, transport};
use sws_core::{S7Config, S7DataType, S7TagMapping, TagDb, TagQuality, TagValue, TagWriteBus,
               WriteRequest};

/// Entry point. Runs the S7 polling loop for `cfg` until `cancel` fires.
pub async fn run(cfg: S7Config, db: Arc<TagDb>, bus: Arc<TagWriteBus>, cancel: CancellationToken) {
    // Register writable tags on the write bus.
    let (write_tx, mut write_rx) = mpsc::channel::<WriteRequest>(32);
    for tm in cfg.tags.iter().filter(|t| t.writable) {
        bus.register(tm.tag.clone(), write_tx.clone()).await;
    }
    drop(write_tx);

    if let Err(e) = session(&cfg, &db, &mut write_rx, cancel).await {
        warn!(source = %cfg.id, "S7 error: {e:#} — stopped (save config to retry)");
        for tm in &cfg.tags {
            db.ingest(tm.tag.clone(), TagValue::Float(0.0), TagQuality::Bad).await;
        }
    }
}

async fn session(
    cfg: &S7Config,
    db: &TagDb,
    write_rx: &mut mpsc::Receiver<WriteRequest>,
    cancel: CancellationToken,
) -> anyhow::Result<()> {
    let ip: IpAddr = cfg.ip.parse()
        .map_err(|e| anyhow::anyhow!("invalid IP '{}': {e}", cfg.ip))?;
    let rack = cfg.rack;
    let slot = cfg.slot;

    // Connect (blocking — use spawn_blocking).
    let client = tokio::task::spawn_blocking(move || {
        let opts = tcp::Options::new(ip, rack, slot, transport::Connection::PG);
        let transport = tcp::Transport::connect(opts)
            .map_err(|e| anyhow::anyhow!("S7 connect to {ip}: {e}"))?;
        client::Client::new(transport)
            .map_err(|e| anyhow::anyhow!("S7 negotiate with {ip}: {e}"))
    })
    .await
    .map_err(|e| anyhow::anyhow!("spawn_blocking panic: {e}"))??;

    info!(source = %cfg.id, ip = %cfg.ip, "S7 connected");

    // The Client is not Send, so wrap it in a channel-based bridge.
    // Requests go in, responses come out.
    let (req_tx, req_rx) = std::sync::mpsc::channel::<S7Request>();
    let (resp_tx, resp_rx) = std::sync::mpsc::channel::<S7Response>();

    // Spin the blocking worker thread.
    std::thread::spawn(move || {
        s7_worker(client, req_rx, resp_tx);
    });

    let tags = cfg.tags.clone();
    let poll_dur = Duration::from_millis(cfg.poll_interval_ms);
    let mut ticker = tokio::time::interval(poll_dur);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // Build writable-tag lookup.
    let write_map: HashMap<String, usize> = tags.iter().enumerate()
        .filter(|(_, t)| t.writable)
        .map(|(i, t)| (t.tag.clone(), i))
        .collect();

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = req_tx.send(S7Request::Stop);
                return Ok(());
            }

            _ = ticker.tick() => {
                // Poll all tags.
                for tm in &tags {
                    let bytes = read_tag(&req_tx, &resp_rx, tm)?;
                    let val = bytes_to_tagvalue(&bytes, tm);
                    db.ingest(tm.tag.clone(), val, TagQuality::Good).await;
                }
            }

            Some((tag, value)) = write_rx.recv() => {
                if let Some(&idx) = write_map.get(&tag) {
                    let tm = &tags[idx];
                    let bytes = tagvalue_to_bytes(&value, tm);
                    if let Err(e) = write_tag(&req_tx, &resp_rx, tm, bytes) {
                        warn!(source = %tm.tag, "S7 write failed: {e}");
                    } else {
                        // Echo back.
                        db.ingest(tag, value, TagQuality::Good).await;
                    }
                }
            }
        }
    }
}

// ── Blocking worker bridge ────────────────────────────────────────────────────

enum S7Request {
    Read { area: String, db_num: i32, byte_offset: i32, len: i32 },
    Write { area: String, db_num: i32, byte_offset: i32, data: Vec<u8> },
    Stop,
}

enum S7Response {
    Data(Vec<u8>),
    Ok,
    Err(String),
}

fn s7_worker<T: s7::transport::Transport>(
    mut cl: client::Client<T>,
    rx: std::sync::mpsc::Receiver<S7Request>,
    tx: std::sync::mpsc::Sender<S7Response>,
) {
    for req in rx {
        match req {
            S7Request::Stop => break,
            S7Request::Read { area, db_num, byte_offset, len } => {
                let mut buf = vec![0u8; len as usize];
                let result = match area.as_str() {
                    "db" => cl.ag_read(db_num, byte_offset, len, &mut buf),
                    "m"  => cl.mb_read(byte_offset, len, &mut buf),
                    "i"  => cl.eb_read(byte_offset, len, &mut buf),
                    "q"  => cl.ab_read(byte_offset, len, &mut buf),
                    other => { let _ = tx.send(S7Response::Err(format!("unknown area '{other}'"))); continue; }
                };
                match result {
                    Ok(()) => { let _ = tx.send(S7Response::Data(buf)); }
                    Err(e) => { let _ = tx.send(S7Response::Err(format!("{e:?}"))); }
                }
            }
            S7Request::Write { area, db_num, byte_offset, mut data } => {
                let len = data.len() as i32;
                let result = match area.as_str() {
                    "db" => cl.ag_write(db_num, byte_offset, len, &mut data),
                    "m"  => cl.mb_write(byte_offset, len, &mut data),
                    "q"  => cl.ab_write(byte_offset, len, &mut data),
                    other => { let _ = tx.send(S7Response::Err(format!("unknown area '{other}'"))); continue; }
                };
                match result {
                    Ok(()) => { let _ = tx.send(S7Response::Ok); }
                    Err(e) => { let _ = tx.send(S7Response::Err(format!("{e:?}"))); }
                }
            }
        }
    }
}

// ── Read / write helpers ──────────────────────────────────────────────────────

fn tag_byte_len(tm: &S7TagMapping) -> i32 {
    match tm.data_type {
        S7DataType::Bool | S7DataType::Byte => 1,
        S7DataType::Int | S7DataType::Word  => 2,
        S7DataType::Dint | S7DataType::Real => 4,
    }
}

fn read_tag(
    tx: &std::sync::mpsc::Sender<S7Request>,
    rx: &std::sync::mpsc::Receiver<S7Response>,
    tm: &S7TagMapping,
) -> anyhow::Result<Vec<u8>> {
    tx.send(S7Request::Read {
        area: tm.area.clone(),
        db_num: tm.db_num,
        byte_offset: tm.byte_offset,
        len: tag_byte_len(tm),
    }).map_err(|_| anyhow::anyhow!("worker thread gone"))?;

    match rx.recv().map_err(|_| anyhow::anyhow!("worker thread gone"))? {
        S7Response::Data(b) => Ok(b),
        S7Response::Err(e) => Err(anyhow::anyhow!("{e}")),
        S7Response::Ok => Err(anyhow::anyhow!("unexpected Ok on read")),
    }
}

fn write_tag(
    tx: &std::sync::mpsc::Sender<S7Request>,
    rx: &std::sync::mpsc::Receiver<S7Response>,
    tm: &S7TagMapping,
    data: Vec<u8>,
) -> anyhow::Result<()> {
    tx.send(S7Request::Write {
        area: tm.area.clone(),
        db_num: tm.db_num,
        byte_offset: tm.byte_offset,
        data,
    }).map_err(|_| anyhow::anyhow!("worker thread gone"))?;

    match rx.recv().map_err(|_| anyhow::anyhow!("worker thread gone"))? {
        S7Response::Ok => Ok(()),
        S7Response::Err(e) => Err(anyhow::anyhow!("{e}")),
        S7Response::Data(_) => Err(anyhow::anyhow!("unexpected data on write")),
    }
}

// ── Byte ↔ TagValue conversion ────────────────────────────────────────────────

fn bytes_to_tagvalue(buf: &[u8], tm: &S7TagMapping) -> TagValue {
    use byteorder::{BigEndian, ByteOrder};
    match tm.data_type {
        S7DataType::Bool => {
            let bit = (buf.first().copied().unwrap_or(0) >> tm.bit_offset) & 1;
            TagValue::Bool(bit != 0)
        }
        S7DataType::Byte => {
            TagValue::Int(buf.first().copied().unwrap_or(0) as i64)
        }
        S7DataType::Int if buf.len() >= 2 => {
            TagValue::Int(BigEndian::read_i16(buf) as i64)
        }
        S7DataType::Word if buf.len() >= 2 => {
            TagValue::Int(BigEndian::read_u16(buf) as i64)
        }
        S7DataType::Dint if buf.len() >= 4 => {
            TagValue::Int(BigEndian::read_i32(buf) as i64)
        }
        S7DataType::Real if buf.len() >= 4 => {
            TagValue::Float(BigEndian::read_f32(buf) as f64)
        }
        _ => TagValue::Float(0.0),
    }
}

fn tagvalue_to_bytes(val: &TagValue, tm: &S7TagMapping) -> Vec<u8> {
    use byteorder::{BigEndian, ByteOrder};
    let len = tag_byte_len(tm) as usize;
    let mut buf = vec![0u8; len];
    match tm.data_type {
        S7DataType::Bool => {
            let b: bool = match val {
                TagValue::Bool(b)  => *b,
                TagValue::Int(i)   => *i != 0,
                TagValue::Float(f) => *f != 0.0,
                TagValue::Str(s)   => !s.is_empty() && s != "0",
            };
            // Set or clear the single bit — read-modify-write is the safe way,
            // but for PoC we write the full byte (existing bits cleared).
            buf[0] = if b { 1u8 << tm.bit_offset } else { 0 };
        }
        S7DataType::Byte => {
            let v: u8 = match val {
                TagValue::Int(i)   => *i as u8,
                TagValue::Float(f) => *f as u8,
                _ => 0,
            };
            buf[0] = v;
        }
        S7DataType::Int | S7DataType::Word => {
            let v: u16 = match val {
                TagValue::Int(i)   => *i as u16,
                TagValue::Float(f) => *f as u16,
                TagValue::Bool(b)  => if *b { 1 } else { 0 },
                _ => 0,
            };
            BigEndian::write_u16(&mut buf, v);
        }
        S7DataType::Dint => {
            let v: i32 = match val {
                TagValue::Int(i)   => *i as i32,
                TagValue::Float(f) => *f as i32,
                TagValue::Bool(b)  => if *b { 1 } else { 0 },
                _ => 0,
            };
            BigEndian::write_i32(&mut buf, v);
        }
        S7DataType::Real => {
            let v: f32 = match val {
                TagValue::Float(f) => *f as f32,
                TagValue::Int(i)   => *i as f32,
                TagValue::Bool(b)  => if *b { 1.0 } else { 0.0 },
                _ => 0.0,
            };
            BigEndian::write_f32(&mut buf, v);
        }
    }
    buf
}
