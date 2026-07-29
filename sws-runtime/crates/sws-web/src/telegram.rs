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
//!
//! Two channels feed the same drainer, on purpose:
//!   - `TelegramMessage`, which can name its own chats — used by alarms, whose
//!     routing is per-alarm (`AlarmDef::telegram_routing`);
//!   - plain `String`, which always goes to the configured chats — that is the
//!     type `sws-pyscript` holds for `send_telegram(text)`, and keeping it
//!     avoids threading a `sws-web` type into the script crate.

use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
use sws_core::TelegramConfig;

use crate::router::AppState;

/// A queued Telegram message.
#[derive(Debug, Clone)]
pub struct TelegramMessage {
    pub text: String,
    /// Chats to send to. `None` → the chats configured in Notifications.
    pub chat_ids: Option<Vec<String>>,
}

impl TelegramMessage {
    /// To the globally configured chats.
    pub fn global(text: String) -> Self {
        Self { text, chat_ids: None }
    }
    /// To specific chats only.
    pub fn to_chats(text: String, chat_ids: Vec<String>) -> Self {
        Self { text, chat_ids: Some(chat_ids) }
    }
}

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
    tx: mpsc::UnboundedSender<TelegramMessage>,
    text_tx: mpsc::UnboundedSender<String>,
    cfg: Arc<RwLock<Option<TelegramConfig>>>,
    cancel: CancellationToken,
}

impl TelegramSender {
    /// Start the drainer with `initial` config (may be `None`: messages are then
    /// dropped with a warning until `set_config` supplies a config).
    pub fn start(initial: Option<TelegramConfig>) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<TelegramMessage>();
        let (text_tx, mut text_rx) = mpsc::unbounded_channel::<String>();
        let cfg = Arc::new(RwLock::new(initial));
        let cancel = CancellationToken::new();
        let cfg_task = Arc::clone(&cfg);
        let cancel_task = cancel.clone();
        tokio::spawn(async move {
            let client = reqwest::Client::new();
            loop {
                let msg = tokio::select! {
                    m = rx.recv() => match m { Some(m) => m, None => break },
                    // Gli script mandano solo testo: destinatari globali.
                    t = text_rx.recv() => match t { Some(t) => TelegramMessage::global(t), None => break },
                    _ = cancel_task.cancelled() => break,
                };
                let snapshot = cfg_task.read().await.clone();
                let Some(c) = snapshot else {
                    warn!("telegram message dropped: channel not configured");
                    continue;
                };
                // Chat mirate (allarme con `telegram_mode: chats`) o quelle globali.
                let chats = msg.chat_ids.as_deref().unwrap_or(&c.chat_ids);
                if let Err(e) = send_message(&client, &c.bot_token, chats, &msg.text).await {
                    warn!("telegram send failed: {e:#}");
                } else {
                    info!("telegram message sent to {} chat(s)", chats.len());
                }
            }
        });
        Self { tx, text_tx, cfg, cancel }
    }

    /// Cloneable handle for text-only senders (scripts): always the configured
    /// chats. Pushing is non-blocking.
    pub fn text_sender(&self) -> mpsc::UnboundedSender<String> {
        self.text_tx.clone()
    }

    /// Cloneable handle for senders that choose their own chats (alarms).
    pub fn message_sender(&self) -> mpsc::UnboundedSender<TelegramMessage> {
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

/// The two sinks onto a running `TelegramSender`, handed out together because
/// every start site wires both: scripts push text, alarms push messages.
#[derive(Clone)]
pub struct TelegramSinks {
    /// `send_telegram(text)` from scripts → configured chats.
    pub text: mpsc::UnboundedSender<String>,
    /// Alarms → configured chats or the alarm's own.
    pub messages: mpsc::UnboundedSender<TelegramMessage>,
}

impl TelegramSinks {
    fn of(sender: &TelegramSender) -> Self {
        Self { text: sender.text_sender(), messages: sender.message_sender() }
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
) -> Option<TelegramSinks> {
    // Si filtra solo sul token: un progetto può non avere chat globali e avere
    // solo allarmi con chat proprie (`telegram_mode: chats`). Scartando la
    // configurazione per `chat_ids` vuoto quei messaggi finirebbero cestinati
    // con "channel not configured", che non è il problema reale.
    let telegram = telegram.filter(|t| !t.bot_token.trim().is_empty());
    let mut guard = s.telegram_sender.write().await;
    if let Some(existing) = guard.as_ref() {
        existing.set_config(telegram).await;
        return Some(TelegramSinks::of(existing));
    }
    let sender = TelegramSender::start(telegram);
    let sinks = TelegramSinks::of(&sender);
    *guard = Some(sender);
    Some(sinks)
}
