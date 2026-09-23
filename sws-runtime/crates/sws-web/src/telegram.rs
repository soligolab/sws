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
use sws_core::LanguageTable;
use sws_core::TelegramConfig;
use tokio::sync::{mpsc, RwLock};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

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
        Self {
            text,
            chat_ids: None,
        }
    }
    /// To specific chats only.
    pub fn to_chats(text: String, chat_ids: Vec<String>) -> Self {
        Self {
            text,
            chat_ids: Some(chat_ids),
        }
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
            .map_err(|e| anyhow::anyhow!("richiesta a {chat} fallita: {}", redigi(e)))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Telegram ha risposto {status} per {chat}: {body}");
        }
    }
    Ok(())
}

/// Il token di un bot Telegram sta **nell'URL** (`/bot<token>/sendMessage`), e
/// `reqwest::Error` nel suo `Display` porta l'URL della richiesta fallita: un
/// broker irraggiungibile o un DNS che non risolve bastavano a stampare la
/// credenziale nei log e a rimandarla al browser dentro il messaggio d'errore
/// (misurato il 21-09-2026, Passo 2 del piano di stabilizzazione).
///
/// `without_url()` è il rimedio della libreria e toglie l'URL alla radice;
/// [`redigi_token_nell_url`] passa poi sul testo che resta, perché l'URL può
/// essere ricomparso da una sorgente annidata o da un messaggio composto a
/// mano — una redazione che dipende da un solo punto è una redazione che prima
/// o poi si scavalca.
pub(crate) fn redigi(e: reqwest::Error) -> String {
    redigi_token_nell_url(&e.without_url().to_string())
}

/// Sostituisce il token in ogni `…/bot<token>…` del testo. Il confine è il `/`
/// successivo o la fine della parola: è la forma che l'URL di Telegram ha
/// sempre, e non tocca niente che non le somigli.
pub(crate) fn redigi_token_nell_url(testo: &str) -> String {
    const MARCA: &str = "/bot";
    let mut out = String::with_capacity(testo.len());
    let mut resto = testo;
    while let Some(i) = resto.find(MARCA) {
        let (prima, dopo) = resto.split_at(i + MARCA.len());
        out.push_str(prima);
        let fine = dopo
            .find(|c: char| c == '/' || c.is_whitespace() || c == '"' || c == ')')
            .unwrap_or(dopo.len());
        if fine == 0 {
            // `/bot` seguito subito da un confine: non è un token, si prosegue.
            resto = dopo;
            continue;
        }
        out.push_str("********");
        resto = &dopo[fine..];
    }
    out.push_str(resto);
    out
}

#[cfg(test)]
mod prove_redazione {
    use super::redigi_token_nell_url;

    #[test]
    fn il_token_sparisce_dall_url() {
        let t = redigi_token_nell_url(
            "error sending request for url (https://api.telegram.org/bot123456:AAH-segretissimo/sendMessage)",
        );
        assert!(!t.contains("AAH-segretissimo"), "{t}");
        assert!(t.contains("/bot********/sendMessage"), "{t}");
    }

    #[test]
    fn due_occorrenze_spariscono_tutte_e_due() {
        let t = redigi_token_nell_url("a /bot111:xxx/getUpdates b /bot222:yyy/sendMessage");
        assert_eq!(t, "a /bot********/getUpdates b /bot********/sendMessage");
    }

    #[test]
    fn un_testo_senza_token_resta_identico() {
        let t = "impossibile raggiungere Telegram: connessione rifiutata";
        assert_eq!(redigi_token_nell_url(t), t);
    }
}

/// Owns a background task that drains an unbounded channel of text messages and
/// sends each to the currently-configured chats. Cloneable `sender()` handles
/// are shared by the alarm supervisor and the script engine; both just push text.
pub struct TelegramSender {
    tx: mpsc::UnboundedSender<TelegramMessage>,
    text_tx: mpsc::UnboundedSender<String>,
    cfg: Arc<RwLock<Option<TelegramConfig>>>,
    lingua: Arc<RwLock<(LanguageTable, String)>>,
    cancel: CancellationToken,
}

impl TelegramSender {
    /// Start the drainer with `initial` config (may be `None`: messages are then
    /// dropped with a warning until `set_config` supplies a config).
    pub fn start(initial: Option<TelegramConfig>) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<TelegramMessage>();
        let (text_tx, mut text_rx) = mpsc::unbounded_channel::<String>();
        let cfg = Arc::new(RwLock::new(initial));
        // La tabella lingue e la lingua delle notifiche, per risolvere i token
        // `{{chiave}}` prima di spedire. Serve da quando gli script hanno
        // `tr()`: quello restituisce un RIFERIMENTO e non una traduzione,
        // perché uno script non sa chi leggerà — ma un messaggio Telegram un
        // lettore ce l'ha, e senza questo gli arriverebbe `{{t0007}}`.
        //
        // Interior-mutable come `cfg`, e aggiornata dallo stesso punto:
        // il canale sopravvive al cambio progetto.
        let lingua: Arc<RwLock<(LanguageTable, String)>> =
            Arc::new(RwLock::new((LanguageTable::default(), String::new())));
        let cancel = CancellationToken::new();
        let cfg_task = Arc::clone(&cfg);
        let lingua_task = Arc::clone(&lingua);
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
                let (tabella, codice) = lingua_task.read().await.clone();
                let testo = sws_core::project::resolve_msg(&msg.text, &codice, &tabella);
                if let Err(e) = send_message(&client, &c.bot_token, chats, &testo).await {
                    warn!("telegram send failed: {e:#}");
                } else {
                    info!("telegram message sent to {} chat(s)", chats.len());
                }
            }
        });
        Self {
            tx,
            text_tx,
            cfg,
            lingua,
            cancel,
        }
    }

    /// La tabella lingue e la lingua delle notifiche del progetto aperto.
    /// Si richiama all'apertura, come si fa già per la configurazione.
    pub async fn set_lingua(&self, tabella: LanguageTable, codice: String) {
        *self.lingua.write().await = (tabella, codice);
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
        Self {
            text: sender.text_sender(),
            messages: sender.message_sender(),
        }
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
    // La tabella lingue del progetto che si sta aprendo, e la lingua delle
    // notifiche. Servono a risolvere i token prima di spedire: da quando gli
    // script hanno `tr()`, un messaggio può contenerne uno.
    lingua: (LanguageTable, String),
) -> Option<TelegramSinks> {
    // Si filtra solo sul token: un progetto può non avere chat globali e avere
    // solo allarmi con chat proprie (`telegram_mode: chats`). Scartando la
    // configurazione per `chat_ids` vuoto quei messaggi finirebbero cestinati
    // con "channel not configured", che non è il problema reale.
    let telegram = telegram.filter(|t| !t.bot_token.trim().is_empty());
    let mut guard = s.telegram_sender.write().await;
    if let Some(existing) = guard.as_ref() {
        existing.set_config(telegram).await;
        existing.set_lingua(lingua.0, lingua.1).await;
        return Some(TelegramSinks::of(existing));
    }
    let sender = TelegramSender::start(telegram);
    sender.set_lingua(lingua.0, lingua.1).await;
    let sinks = TelegramSinks::of(&sender);
    *guard = Some(sender);
    Some(sinks)
}
