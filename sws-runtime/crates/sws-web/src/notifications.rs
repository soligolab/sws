//! Email notification + escalation for alarm activation.
//!
//! `NotificationSupervisor` subscribes to the AlarmDb broadcast channel and:
//!   1. Sends email to `def.notify_email` recipients on transition to ActiveUnacked.
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
use sws_core::{AlarmDb, AlarmState, IsaState, NotificationConfig, SmtpConfig};

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

fn alarm_body(state: &AlarmState, kind: &str) -> String {
    format!(
        "{kind}\n\nAllarme:   {}\nMessaggio: {}\nSeverità:  {:?}\nTag:       {}\nValore:    {}\nAttivato:  {} ms\n",
        state.def.id,
        state.def.message,
        state.def.severity,
        state.def.tag,
        state.last_value.as_ref().map(|v| format!("{v:?}")).unwrap_or_else(|| "—".into()),
        state.activated_at_ms.unwrap_or(0),
    )
}

pub struct NotificationSupervisor {
    cancel: CancellationToken,
}

impl NotificationSupervisor {
    /// `telegram_tx` is a handle onto the shared `TelegramSender` channel
    /// (created once per open project). When present, every alarm activation
    /// (and escalation) is also pushed to the global Telegram chats.
    pub fn start(
        alarm_db: Arc<AlarmDb>,
        config: NotificationConfig,
        telegram_tx: Option<mpsc::UnboundedSender<String>>,
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
                                    // Telegram (global chats — every activation).
                                    if let Some(tx) = &tg_a {
                                        let _ = tx.send(body);
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
                    // Telegram escalation (global chats).
                    if let Some(tx) = &tg_b {
                        let _ = tx.send(body);
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
