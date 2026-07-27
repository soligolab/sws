//! Telegram Bot API notification channel.
//!
//! Sends plain-text messages to one or more chat IDs via
//! `https://api.telegram.org/bot<token>/sendMessage`. Used as an alarm channel
//! (from `NotificationSupervisor`), by the `send_telegram(text)` script binding
//! (drained here), and by the `POST /api/notifications/test-telegram` endpoint.
//!
//! `sws-pyscript` stays HTTP-free: it only receives an `UnboundedSender<String>`
//! and pushes text; the actual HTTP lives here, in `sws-web`.
//!
//! The sender holds its config in a `RwLock` so a notifications-config save can
//! hot-swap it (`set_config`) without invalidating the channel `tx` already
//! handed to the script engine — scripts keep working across config changes.

use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
use sws_core::TelegramConfig;

use crate::router::AppState;

/// Send `text` to every chat in `chat_ids`. Returns an error on the first
/// failed request/response so callers (e.g. the test endpoint) can surface it.
/// Fire-and-forget callers (drainer / alarms) just log the error.
pub async fn send_message(
    client: &reqwest::Client,
    token: &str,
    chat_ids: &[String],
    text: &str,
) -> anyhow::Result<()> {
    if token.trim().is_empty() {
        anyhow::bail!("bot token vuoto");
    }
    if chat_ids.is_empty() {
        anyhow::bail!("nessuna chat_id configurata");
    }
    let url = format!("https://api.telegram.org/bot{token}/sendMessage");
    for chat in chat_ids {
        let resp = client
            .post(&url)
            .json(&serde_json::json!({ "chat_id": chat, "text": text }))
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("richiesta a {chat} fallita: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Telegram ha risposto {status} per {chat}: {body}");
        }
    }
    Ok(())
}

/// Owns a background task that drains an unbounded channel of text messages and
/// sends each to the currently-configured chats. Cloneable `sender()` handles
/// are shared by the alarm supervisor and the script engine; both just push text.
pub struct TelegramSender {
    tx: mpsc::UnboundedSender<String>,
    cfg: Arc<RwLock<Option<TelegramConfig>>>,
    cancel: CancellationToken,
}

impl TelegramSender {
    /// Start the drainer with `initial` config (may be `None`: messages are then
    /// dropped with a warning until `set_config` supplies a config).
    pub fn start(initial: Option<TelegramConfig>) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let cfg = Arc::new(RwLock::new(initial));
        let cancel = CancellationToken::new();
        let cfg_task = Arc::clone(&cfg);
        let cancel_task = cancel.clone();
        tokio::spawn(async move {
            let client = reqwest::Client::new();
            loop {
                tokio::select! {
                    msg = rx.recv() => match msg {
                        Some(text) => {
                            let snapshot = cfg_task.read().await.clone();
                            match snapshot {
                                Some(c) => {
                                    if let Err(e) = send_message(&client, &c.bot_token, &c.chat_ids, &text).await {
                                        warn!("telegram send failed: {e:#}");
                                    } else {
                                        info!("telegram message sent to {} chat(s)", c.chat_ids.len());
                                    }
                                }
                                None => warn!("telegram message dropped: channel not configured"),
                            }
                        }
                        None => break,
                    },
                    _ = cancel_task.cancelled() => break,
                }
            }
        });
        Self { tx, cfg, cancel }
    }

    /// A cloneable sender handle. Pushing text is non-blocking.
    pub fn sender(&self) -> mpsc::UnboundedSender<String> {
        self.tx.clone()
    }

    /// Hot-swap the config without invalidating the channel `tx`.
    pub async fn set_config(&self, cfg: Option<TelegramConfig>) {
        *self.cfg.write().await = cfg;
    }

    pub fn stop(self) {
        self.cancel.cancel();
    }
}

/// Stop and drop the Telegram sender stored in `s` (project close / stop).
pub async fn stop_sender(s: &AppState) {
    if let Some(old) = s.telegram_sender.write().await.take() {
        old.stop();
    }
}

/// Ensure a `TelegramSender` exists in `s` and carries `telegram` as its config,
/// returning a cloneable sink shared by the alarm supervisor and the script
/// `send_telegram` binding. If a sender already exists its config is hot-swapped
/// (the `tx` stays valid); otherwise a fresh one is started. The sink is always
/// returned (even when `telegram` is `None`) so scripts hold a stable handle and
/// start working the moment Telegram is (re)configured via a notifications save.
pub async fn restart_sender(
    s: &AppState,
    telegram: Option<TelegramConfig>,
) -> Option<mpsc::UnboundedSender<String>> {
    let telegram = telegram.filter(|t| !t.bot_token.trim().is_empty() && !t.chat_ids.is_empty());
    let mut guard = s.telegram_sender.write().await;
    if let Some(existing) = guard.as_ref() {
        existing.set_config(telegram).await;
        return Some(existing.sender());
    }
    let sender = TelegramSender::start(telegram);
    let tx = sender.sender();
    *guard = Some(sender);
    Some(tx)
}
