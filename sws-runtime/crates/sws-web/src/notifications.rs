//! Email notification + escalation for alarm activation.
//!
//! `NotificationSupervisor` subscribes to the AlarmDb broadcast channel and:
//!   1. Sends email to `def.notify_email` recipients on transition to ActiveUnacked.
//!   1b. Sends a Telegram message per `def.telegram_routing()` — global chats
//!       (the default, and what alarms did before the setting existed), the
//!       alarm's own chats, or nothing.
//!   2. Every 60 s, scans for ActiveUnacked alarms past `escalate_after_s` and
//!      sends escalation email to `def.escalate_to` recipients (once per activation).
//!
//! The supervisor is started by `open_project` and stopped on `close_project`.
//! SMTP credentials are read from `NotificationConfig.smtp`.

use std::{
    collections::HashSet,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use lettre::{
    Message, SmtpTransport, Transport,
    message::header::ContentType,
    transport::smtp::authentication::Credentials,
};
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
use sws_core::{AlarmDb, AlarmState, IsaState, NotificationConfig, SmtpConfig, TagValue, TelegramRouting};
use crate::telegram::TelegramMessage;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

/// Build a lettre `SmtpTransport` from the project's `SmtpConfig`.
fn build_transport(cfg: &SmtpConfig) -> anyhow::Result<SmtpTransport> {
    let port = cfg.port.unwrap_or(587);
    let use_starttls = cfg.starttls.unwrap_or(true);

    let builder = if use_starttls {
        SmtpTransport::starttls_relay(&cfg.host)
            .map_err(|e| anyhow::anyhow!("SMTP STARTTLS: {e}"))?
            .port(port)
    } else {
        SmtpTransport::relay(&cfg.host)
            .map_err(|e| anyhow::anyhow!("SMTP relay: {e}"))?
            .port(port)
    };

    let transport = if let (Some(user), Some(pass)) = (&cfg.username, &cfg.password) {
        builder.credentials(Credentials::new(user.clone(), pass.clone())).build()
    } else {
        builder.build()
    };
    Ok(transport)
}

/// Send a single email synchronously (lettre sync transport).
/// Called from `spawn_blocking` to avoid blocking the async runtime.
fn send_email_sync(
    cfg: &SmtpConfig,
    to: &[String],
    subject: &str,
    body: &str,
) -> anyhow::Result<()> {
    if to.is_empty() { return Ok(()); }
    let transport = build_transport(cfg)?;
    for addr in to {
        let msg = Message::builder()
            .from(cfg.from.parse().map_err(|e| anyhow::anyhow!("invalid From: {e}"))?)
            .to(addr.parse().map_err(|e| anyhow::anyhow!("invalid To {addr}: {e}"))?)
            .subject(subject)
            .header(ContentType::TEXT_PLAIN)
            .body(body.to_string())
            .map_err(|e| anyhow::anyhow!("build message: {e}"))?;
        transport.send(&msg).map_err(|e| anyhow::anyhow!("send to {addr}: {e}"))?;
    }
    Ok(())
}

/// Render a `TagValue` as plain text for a human, not the `{:?}` derive
/// (which would show e.g. `Float(230.6)` instead of `230.6`).
fn fmt_value(v: &TagValue) -> String {
    match v {
        TagValue::Bool(b)  => if *b { "true".into() } else { "false".into() },
        TagValue::Int(i)   => i.to_string(),
        TagValue::Float(f) => f.to_string(),
        TagValue::Str(s)   => s.clone(),
    }
}

/// `dd/mm/yyyy hh:mm:ss UTC` — the `time` crate is built with only the
/// `std` feature here (no `formatting`/`local-offset`), so this hand-rolls
/// the same accessor-based pattern already used in `log_file.rs`/`backups.rs`
/// instead of pulling in more of the crate. UTC, not local time, for the
/// same reason: no `local-offset` feature enabled.
fn fmt_activated_at(ms: Option<u64>) -> String {
    match ms.and_then(|ms| time::OffsetDateTime::from_unix_timestamp((ms / 1000) as i64).ok()) {
        Some(dt) => format!(
            "{:02}/{:02}/{:04} {:02}:{:02}:{:02} UTC",
            dt.day(), u8::from(dt.month()), dt.year(), dt.hour(), dt.minute(), dt.second(),
        ),
        None => "—".into(),
    }
}

fn alarm_body(state: &AlarmState, kind: &str) -> String {
    format!(
        "{kind}\n\nAllarme:   {}\nMessaggio: {}\nSeverità:  {:?}\nTag:       {}\nValore:    {}\nAttivato:  {}\n",
        state.def.id,
        state.def.message,
        state.def.severity,
        state.def.tag,
        state.last_value.as_ref().map(fmt_value).unwrap_or_else(|| "—".into()),
        fmt_activated_at(state.activated_at_ms),
    )
}

/// Queue `body` for Telegram according to the alarm's own routing.
///
/// The empty-`Chats` case is reported, not silently patched: it means the user
/// picked "specific chats" and hasn't listed any, and either alternative —
/// dropping without a word, or falling back to every chat — hides a
/// half-finished setting behind behaviour they didn't ask for.
fn send_telegram(
    tx: &mpsc::UnboundedSender<TelegramMessage>,
    state: &AlarmState,
    body: String,
) {
    match state.def.telegram_routing() {
        TelegramRouting::Skip => {}
        TelegramRouting::GlobalChats => {
            let _ = tx.send(TelegramMessage::global(body));
        }
        TelegramRouting::Chats(chats) if chats.is_empty() => {
            warn!(
                alarm = %state.def.id,
                "telegram: modo 'chat specifiche' senza nessuna chat — nessun messaggio inviato",
            );
        }
        TelegramRouting::Chats(chats) => {
            let _ = tx.send(TelegramMessage::to_chats(body, chats));
        }
    }
}

pub struct NotificationSupervisor {
    cancel: CancellationToken,
}

impl NotificationSupervisor {
    /// `telegram_tx` is a handle onto the shared `TelegramSender` channel
    /// (created once per open project). When present, each alarm activation and
    /// escalation is routed by `AlarmDef::telegram_routing()`.
    pub fn start(
        alarm_db: Arc<AlarmDb>,
        config: NotificationConfig,
        telegram_tx: Option<mpsc::UnboundedSender<TelegramMessage>>,
    ) -> Self {
        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();
        let smtp: Option<Arc<SmtpConfig>> = config.smtp.map(Arc::new);
        let telegram = telegram_tx;

        // No channel configured at all → run a cancellable no-op so lifecycle
        // (stop) stays uniform.
        if smtp.is_none() && telegram.is_none() {
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_secs(60)) => {}
                        _ = cancel_clone.cancelled() => break,
                    }
                }
            });
            return Self { cancel };
        }

        tokio::spawn(async move {
            // Task A: subscribe to alarm broadcasts, notify on activation.
            let mut alarm_rx = alarm_db.subscribe();
            let smtp_a = smtp.clone();
            let tg_a = telegram.clone();
            let cancel_a = cancel_clone.clone();
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        res = alarm_rx.recv() => {
                            match res {
                                Ok(state) => {
                                    if state.isa_state != IsaState::ActiveUnacked { continue; }
                                    let body = alarm_body(&state, "🔴 ALLARME ATTIVO");
                                    // Email (opt-in per-alarm via notify_email).
                                    if let Some(smtp) = &smtp_a {
                                        if let Some(to) = state.def.notify_email.clone().filter(|v| !v.is_empty()) {
                                            let subject = format!("[SWS ALARM] {} — {}", state.def.id, state.def.message);
                                            let body = body.clone();
                                            let smtp = Arc::clone(smtp);
                                            let id = state.def.id.clone();
                                            tokio::spawn(async move {
                                                match tokio::task::spawn_blocking(move || send_email_sync(&smtp, &to, &subject, &body)).await {
                                                    Ok(Ok(())) => info!(alarm = %id, "alarm email sent"),
                                                    Ok(Err(e)) => warn!(alarm = %id, "alarm email failed: {e}"),
                                                    Err(e)     => warn!("alarm email task panicked: {e}"),
                                                }
                                            });
                                        }
                                    }
                                    // Telegram, instradato dal singolo allarme.
                                    if let Some(tx) = &tg_a {
                                        send_telegram(tx, &state, body);
                                    }
                                }
                                Err(broadcast::error::RecvError::Lagged(n)) => {
                                    warn!("notification alarm subscriber lagged by {n}");
                                }
                                Err(broadcast::error::RecvError::Closed) => break,
                            }
                        }
                        _ = cancel_a.cancelled() => break,
                    }
                }
            });

            // Task B: escalation checker — runs every 60 s. Fires once per
            // activation when past `escalate_after_s`.
            let smtp_b = smtp.clone();
            let tg_b = telegram.clone();
            let escalated: Arc<RwLock<HashSet<(String, u64)>>> = Arc::new(RwLock::new(HashSet::new()));
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_secs(60)) => {}
                    _ = cancel_clone.cancelled() => break,
                }
                let now = now_ms();
                let snapshot = alarm_db.snapshot().await;
                let mut guard = escalated.write().await;
                for state in &snapshot {
                    if state.isa_state != IsaState::ActiveUnacked { continue; }
                    // Timing gate: escalation only makes sense with a delay set.
                    let delay_s = match state.def.escalate_after_s { Some(d) if d > 0.0 => d, _ => continue };
                    let act_ms = match state.activated_at_ms { Some(ms) => ms, None => continue };
                    if now < act_ms + (delay_s * 1000.0) as u64 { continue; }
                    let key = (state.def.id.clone(), act_ms);
                    if guard.contains(&key) { continue; }
                    guard.insert(key);
                    let body = alarm_body(state, "⏫ ESCALATION: allarme non riconosciuto");
                    // Email escalation (only if escalate_to recipients set).
                    if let Some(smtp) = &smtp_b {
                        if let Some(to) = state.def.escalate_to.clone().filter(|v| !v.is_empty()) {
                            let subject = format!("[SWS ESCALATION] {} — {}", state.def.id, state.def.message);
                            let body = body.clone();
                            let smtp = Arc::clone(smtp);
                            let id = state.def.id.clone();
                            tokio::spawn(async move {
                                match tokio::task::spawn_blocking(move || send_email_sync(&smtp, &to, &subject, &body)).await {
                                    Ok(Ok(())) => info!(alarm = %id, "escalation email sent"),
                                    Ok(Err(e)) => warn!(alarm = %id, "escalation email failed: {e}"),
                                    Err(e)     => warn!("escalation task panicked: {e}"),
                                }
                            });
                        }
                    }
                    // Telegram escalation, con lo stesso instradamento.
                    if let Some(tx) = &tg_b {
                        send_telegram(tx, state, body);
                    }
                }
            }
        });

        Self { cancel }
    }

    pub fn stop(self) {
        self.cancel.cancel();
    }
}
