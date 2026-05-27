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
use tokio::sync::{broadcast, RwLock};
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

fn alarm_email_body(state: &AlarmState, kind: &str) -> String {
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
    pub fn start(
        alarm_db: Arc<AlarmDb>,
        config: NotificationConfig,
    ) -> Self {
        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();
        let config = Arc::new(config);

        tokio::spawn(async move {
            let smtp = match &config.smtp {
                Some(s) => Arc::new(s.clone()),
                None => {
                    // No SMTP config — still run escalation timer (no-op) so the task
                    // structure is consistent. Skips all sends.
                    loop {
                        tokio::select! {
                            _ = tokio::time::sleep(std::time::Duration::from_secs(60)) => {}
                            _ = cancel_clone.cancelled() => break,
                        }
                    }
                    return;
                }
            };

            // Task A: subscribe to alarm broadcasts, send email on activation.
            let mut alarm_rx = alarm_db.subscribe();
            let smtp_a = Arc::clone(&smtp);
            let cancel_a = cancel_clone.clone();
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        res = alarm_rx.recv() => {
                            match res {
                                Ok(state) => {
                                    if state.isa_state != IsaState::ActiveUnacked { continue; }
                                    let to = match &state.def.notify_email {
                                        Some(v) if !v.is_empty() => v.clone(),
                                        _ => continue,
                                    };
                                    let subject = format!("[SWS ALARM] {} — {}", state.def.id, state.def.message);
                                    let body    = alarm_email_body(&state, "ALLARME ATTIVO");
                                    let smtp    = Arc::clone(&smtp_a);
                                    tokio::spawn(async move {
                                        let smtp  = smtp;
                                        let to    = to;
                                        match tokio::task::spawn_blocking(move || send_email_sync(&smtp, &to, &subject, &body)).await {
                                            Ok(Ok(())) => info!(alarm = %state.def.id, "alarm email sent"),
                                            Ok(Err(e)) => warn!(alarm = %state.def.id, "alarm email failed: {e}"),
                                            Err(e)     => warn!("alarm email task panicked: {e}"),
                                        }
                                    });
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

            // Task B: escalation checker — runs every 60 s.
            // Tracks which (alarm_id, activated_at_ms) pairs were already escalated
            // to avoid duplicate emails.
            let smtp_b = Arc::clone(&smtp);
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
                    let delay_s = match state.def.escalate_after_s { Some(d) if d > 0.0 => d, _ => continue };
                    let to = match &state.def.escalate_to { Some(v) if !v.is_empty() => v.clone(), _ => continue };
                    let act_ms = match state.activated_at_ms { Some(ms) => ms, None => continue };
                    if now < act_ms + (delay_s * 1000.0) as u64 { continue; }
                    let key = (state.def.id.clone(), act_ms);
                    if guard.contains(&key) { continue; }
                    guard.insert(key);
                    let subject = format!("[SWS ESCALATION] {} — {}", state.def.id, state.def.message);
                    let body    = alarm_email_body(state, "ESCALATION: allarme non riconosciuto");
                    let smtp    = Arc::clone(&smtp_b);
                    let state   = state.clone();
                    tokio::spawn(async move {
                        let smtp  = smtp;
                        let to    = to;
                        match tokio::task::spawn_blocking(move || send_email_sync(&smtp, &to, &subject, &body)).await {
                            Ok(Ok(())) => info!(alarm = %state.def.id, "escalation email sent"),
                            Ok(Err(e)) => warn!(alarm = %state.def.id, "escalation email failed: {e}"),
                            Err(e)     => warn!("escalation task panicked: {e}"),
                        }
                    });
                }
            }
        });

        Self { cancel }
    }

    pub fn stop(self) {
        self.cancel.cancel();
    }
}
