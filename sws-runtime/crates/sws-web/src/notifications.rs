//! Email notification + escalation for alarm activation.
//!
//! `NotificationSupervisor` subscribes to the AlarmDb broadcast channel and:
//! 1. Sends email to `def.notify_email` recipients on transition to ActiveUnacked.
//! 2. Sends a Telegram message per `def.telegram_routing()` — global chats
//!    (the default, and what alarms did before the setting existed), the
//!    alarm's own chats, or nothing.
//! 3. Every 60 s, scans for ActiveUnacked alarms past `escalate_after_s` and
//!    sends escalation email to `def.escalate_to` recipients (once per activation).
//!
//! The supervisor is started by `open_project` and stopped on `close_project`.
//! SMTP credentials are read from `NotificationConfig.smtp`.

use crate::telegram::TelegramMessage;
use lettre::{
    message::header::ContentType, transport::smtp::authentication::Credentials, Message,
    SmtpTransport, Transport,
};
use std::{collections::HashSet, sync::Arc};
use sws_core::now_ms;
use sws_core::{
    AlarmDb, AlarmState, IsaState, LanguageTable, NotificationConfig, SmtpConfig, TagValue,
    TelegramRouting,
};
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

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
        builder
            .credentials(Credentials::new(user.clone(), pass.clone()))
            .build()
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
    if to.is_empty() {
        return Ok(());
    }
    let transport = build_transport(cfg)?;
    for addr in to {
        let msg = Message::builder()
            .from(
                cfg.from
                    .parse()
                    .map_err(|e| anyhow::anyhow!("invalid From: {e}"))?,
            )
            .to(addr
                .parse()
                .map_err(|e| anyhow::anyhow!("invalid To {addr}: {e}"))?)
            .subject(subject)
            .header(ContentType::TEXT_PLAIN)
            .body(body.to_string())
            .map_err(|e| anyhow::anyhow!("build message: {e}"))?;
        transport
            .send(&msg)
            .map_err(|e| anyhow::anyhow!("send to {addr}: {e}"))?;
    }
    Ok(())
}

/// Render a `TagValue` as plain text for a human, not the `{:?}` derive
/// (which would show e.g. `Float(230.6)` instead of `230.6`).
fn fmt_value(v: &TagValue) -> String {
    match v {
        TagValue::Bool(b) => {
            if *b {
                "true".into()
            } else {
                "false".into()
            }
        }
        TagValue::Int(i) => i.to_string(),
        TagValue::Float(f) => f.to_string(),
        TagValue::Str(s) => s.clone(),
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
            dt.day(),
            u8::from(dt.month()),
            dt.year(),
            dt.hour(),
            dt.minute(),
            dt.second(),
        ),
        None => "—".into(),
    }
}

/// Le etichette del corpo di una notifica.
///
/// **Non** sono contenuto di progetto: un progetto non deve poter rompere il
/// formato di una notifica. E non sono nemmeno l'i18n dell'editor, che vive nel
/// browser e qui non arriva. Sono una terza categoria — testo di sistema del
/// runtime — e stanno qui, in chiaro, invece che in una tabella: sono sei
/// parole, e un meccanismo per sei parole costa più di quanto renda.
///
/// Fino al 15-09-2026 erano **italiano cablato** dentro la `format!`, quindi un
/// impianto tedesco riceveva «Severità:» comunque. Le lingue non elencate
/// ripiegano sull'inglese, che è la scelta onesta per un destinatario ignoto —
/// e non sull'italiano, che era italiano solo perché lo era chi ha scritto il
/// codice.
struct EtichetteNotifica {
    allarme: &'static str,
    messaggio: &'static str,
    severita: &'static str,
    tag: &'static str,
    valore: &'static str,
    attivato: &'static str,
}

fn etichette(lingua: &str) -> EtichetteNotifica {
    match lingua {
        "it" => EtichetteNotifica {
            allarme: "Allarme",
            messaggio: "Messaggio",
            severita: "Severità",
            tag: "Tag",
            valore: "Valore",
            attivato: "Attivato",
        },
        "de" => EtichetteNotifica {
            allarme: "Alarm",
            messaggio: "Meldung",
            severita: "Schweregrad",
            tag: "Tag",
            valore: "Wert",
            attivato: "Ausgelöst",
        },
        "fr" => EtichetteNotifica {
            allarme: "Alarme",
            messaggio: "Message",
            severita: "Gravité",
            tag: "Tag",
            valore: "Valeur",
            attivato: "Déclenché",
        },
        "es" => EtichetteNotifica {
            allarme: "Alarma",
            messaggio: "Mensaje",
            severita: "Severidad",
            tag: "Tag",
            valore: "Valor",
            attivato: "Activado",
        },
        _ => EtichetteNotifica {
            allarme: "Alarm",
            messaggio: "Message",
            severita: "Severity",
            tag: "Tag",
            valore: "Value",
            attivato: "Triggered",
        },
    }
}

/// `lingua`/`table`: il messaggio dell'allarme è testo d'autore e può essere un
/// token `{{chiave}}`. Fino al 15-09-2026 partiva **grezzo** verso Telegram e
/// per email — un progetto tradotto bene mandava letteralmente
/// `{{allarme_pressione}}` al telefono di chi era di turno.
fn alarm_body(state: &AlarmState, kind: &str, lingua: &str, table: &LanguageTable) -> String {
    let e = etichette(lingua);
    format!(
        "{kind}\n\n{}:   {}\n{}: {}\n{}:  {:?}\n{}:       {}\n{}:    {}\n{}:  {}\n",
        e.allarme,
        state.def.id,
        e.messaggio,
        sws_core::project::resolve_msg(&state.def.message, lingua, table),
        e.severita,
        state.def.severity,
        e.tag,
        state.def.tag,
        e.valore,
        state
            .last_value
            .as_ref()
            .map(fmt_value)
            .unwrap_or_else(|| "—".into()),
        e.attivato,
        fmt_activated_at(state.activated_at_ms),
    )
}

/// Queue `body` for Telegram according to the alarm's own routing.
///
/// The empty-`Chats` case is reported, not silently patched: it means the user
/// picked "specific chats" and hasn't listed any, and either alternative —
/// dropping without a word, or falling back to every chat — hides a
/// half-finished setting behind behaviour they didn't ask for.
fn send_telegram(tx: &mpsc::UnboundedSender<TelegramMessage>, state: &AlarmState, body: String) {
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
    /// `languages`: fotografata all'apertura del progetto, come `config`. Le
    /// notifiche partono da qui e non da uno schermo, quindi la lingua è quella
    /// del progetto (`notifications.notify_lang`, con ripiego sul `default`
    /// della tabella) e non quella scelta da un operatore sul vetro.
    pub fn start(
        alarm_db: Arc<AlarmDb>,
        config: NotificationConfig,
        telegram_tx: Option<mpsc::UnboundedSender<TelegramMessage>>,
        languages: LanguageTable,
    ) -> Self {
        // Due task async distinti (attivazione ed escalation) prendono ognuno
        // la propria copia: sono `move`, e condividerne una sola non
        // compilerebbe.
        let lingua = std::sync::Arc::new(
            config
                .notify_lang
                .clone()
                .unwrap_or_else(|| languages.default.clone()),
        );
        let languages = std::sync::Arc::new(languages);
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
            let lingua_attiva = lingua.clone();
            let lingue_attiva = languages.clone();
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        res = alarm_rx.recv() => {
                            match res {
                                Ok(state) => {
                                    if state.isa_state != IsaState::ActiveUnacked { continue; }
                                    let body = alarm_body(&state, "🔴 ALLARME ATTIVO", &lingua_attiva, &lingue_attiva);
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
            let lingua_esc = lingua.clone();
            let lingue_esc = languages.clone();
            let escalated: Arc<RwLock<HashSet<(String, u64)>>> =
                Arc::new(RwLock::new(HashSet::new()));
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_secs(60)) => {}
                    _ = cancel_clone.cancelled() => break,
                }
                let now = now_ms();
                let snapshot = alarm_db.snapshot().await;
                let mut guard = escalated.write().await;
                for state in &snapshot {
                    if state.isa_state != IsaState::ActiveUnacked {
                        continue;
                    }
                    // Timing gate: escalation only makes sense with a delay set.
                    let delay_s = match state.def.escalate_after_s {
                        Some(d) if d > 0.0 => d,
                        _ => continue,
                    };
                    let act_ms = match state.activated_at_ms {
                        Some(ms) => ms,
                        None => continue,
                    };
                    if now < act_ms + (delay_s * 1000.0) as u64 {
                        continue;
                    }
                    let key = (state.def.id.clone(), act_ms);
                    if guard.contains(&key) {
                        continue;
                    }
                    guard.insert(key);
                    let body = alarm_body(
                        state,
                        "⏫ ESCALATION: allarme non riconosciuto",
                        &lingua_esc,
                        &lingue_esc,
                    );
                    // Email escalation (only if escalate_to recipients set).
                    if let Some(smtp) = &smtp_b {
                        if let Some(to) = state.def.escalate_to.clone().filter(|v| !v.is_empty()) {
                            let subject = format!(
                                "[SWS ESCALATION] {} — {}",
                                state.def.id, state.def.message
                            );
                            let body = body.clone();
                            let smtp = Arc::clone(smtp);
                            let id = state.def.id.clone();
                            tokio::spawn(async move {
                                match tokio::task::spawn_blocking(move || {
                                    send_email_sync(&smtp, &to, &subject, &body)
                                })
                                .await
                                {
                                    Ok(Ok(())) => info!(alarm = %id, "escalation email sent"),
                                    Ok(Err(e)) => {
                                        warn!(alarm = %id, "escalation email failed: {e}")
                                    }
                                    Err(e) => warn!("escalation task panicked: {e}"),
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

/// Il corpo di una notifica d'allarme.
///
/// Due difetti vivevano qui, entrambi invisibili finché qualcuno non riceveva
/// davvero il messaggio: il testo dell'allarme partiva **grezzo** (un progetto
/// tradotto bene mandava `{{allarme_pressione}}` al telefono di chi era di
/// turno) e le etichette erano **italiano cablato**, quindi un impianto tedesco
/// riceveva «Severità:» comunque.
#[cfg(test)]
mod corpo_notifica_tests {
    use super::*;
    use sws_core::{AlarmDef, LangEntry};

    fn tabella() -> LanguageTable {
        LanguageTable {
            default: "it".into(),
            langs: vec!["it".into(), "de".into()],
            entries: vec![LangEntry {
                key: "pressione_alta".into(),
                values: [
                    ("it".to_string(), "Pressione serbatoio alta".to_string()),
                    ("de".to_string(), "Kesseldruck zu hoch".to_string()),
                ]
                .into_iter()
                .collect(),
                auto: Vec::new(),
            }],
        }
    }

    fn stato(messaggio: &str) -> AlarmState {
        let def: AlarmDef = serde_yaml::from_str(&format!(
            "id: A1\ntag: t.pressione\nmessage: \"{messaggio}\"\ncondition:\n  kind: above\n  threshold: 10.0\n"
        ))
        .expect("AlarmDef di prova");
        AlarmState {
            def,
            isa_state: IsaState::Normal,
            active: true,
            acknowledged: false,
            activated_at_ms: Some(1_700_000_000_000),
            ack_at_ms: None,
            normalized_at_ms: None,
            last_value: None,
        }
    }

    #[test]
    fn il_messaggio_dell_allarme_si_traduce() {
        let corpo = alarm_body(&stato("{{pressione_alta}}"), "TEST", "de", &tabella());
        assert!(
            corpo.contains("Kesseldruck zu hoch"),
            "il token non è stato risolto:\n{corpo}"
        );
        assert!(
            !corpo.contains("{{"),
            "nel corpo è rimasto un token grezzo:\n{corpo}"
        );
    }

    #[test]
    fn le_etichette_seguono_la_lingua_scelta() {
        let de = alarm_body(&stato("x"), "TEST", "de", &tabella());
        assert!(de.contains("Schweregrad"), "etichette non tradotte:\n{de}");
        assert!(
            !de.contains("Severità"),
            "l'italiano cablato è ancora lì:\n{de}"
        );
    }

    #[test]
    fn una_lingua_sconosciuta_ripiega_sull_inglese_non_sull_italiano() {
        // L'italiano era italiano solo perché lo era chi ha scritto il codice.
        // Per un destinatario ignoto l'inglese è la scelta onesta.
        let corpo = alarm_body(&stato("x"), "TEST", "sv", &tabella());
        assert!(corpo.contains("Severity"), "atteso inglese:\n{corpo}");
    }

    #[test]
    fn un_messaggio_senza_token_passa_invariato() {
        let corpo = alarm_body(&stato("Pressione alta"), "TEST", "it", &tabella());
        assert!(corpo.contains("Pressione alta"));
    }
}
