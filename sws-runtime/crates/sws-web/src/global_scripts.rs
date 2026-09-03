//! Supervisor for global Python scripts defined in `project.yaml`.
//!
//! Each enabled `GlobalScriptDef` gets a dedicated tokio task whose lifecycle
//! is tied to a `CancellationToken`. `GlobalScriptSupervisor::stop()` cancels
//! all tasks (fire-and-forget — tasks will terminate asynchronously).
//!
//! The supervisor is wrapped in `Arc` so it is cheaply cloneable alongside
//! the rest of `AppState`.

use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

use sws_core::{GlobalScriptDef, ScriptTrigger, TagDb, TagValue, TagWriteBus};
use sws_pyscript::Engine as PyEngine;

/// Cheap clone handle for the running script supervisor.
#[derive(Clone)]
pub struct GlobalScriptSupervisor {
    cancel: CancellationToken,
}

impl GlobalScriptSupervisor {
    /// Spawn tasks for all enabled scripts in `scripts`. `telegram_tx`, when
    /// present, backs the `send_telegram(text)` binding inside each script.
    pub fn start(
        scripts: Vec<GlobalScriptDef>,
        db: Arc<TagDb>,
        bus: Arc<TagWriteBus>,
        telegram_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    ) -> Self {
        let cancel = CancellationToken::new();

        for script in scripts {
            if !script.enabled {
                debug!(id = %script.id, "global script disabled, skipping");
                continue;
            }
            let cancel_child = cancel.child_token();
            let py = PyEngine::new(db.clone(), bus.clone());
            py.set_telegram_sink(telegram_tx.clone());
            let db_clone = db.clone();

            let id = script.id.clone();
            let trigger = script.trigger.clone();
            let code = script.code.clone();

            tokio::spawn(async move {
                info!(id = %id, ?trigger, "global script task starting");
                run_script_task(id, trigger, code, py, db_clone, cancel_child).await;
            });
        }

        Self { cancel }
    }

    /// Cancel all script tasks (non-blocking; tasks stop asynchronously).
    pub fn stop(&self) {
        self.cancel.cancel();
    }
}

async fn run_script_task(
    id: String,
    trigger: ScriptTrigger,
    code: String,
    py: PyEngine,
    db: Arc<TagDb>,
    cancel: CancellationToken,
) {
    // Vive quanto il task, cioè quanto lo script: è lì che si accumulano i
    // fallimenti consecutivi da strozzare.
    let mut throttle = FailureThrottle::default();
    match trigger {
        ScriptTrigger::Startup => {
            exec_once(&id, &code, &py, &mut throttle).await;
        }

        ScriptTrigger::Interval { interval_s } => {
            let dur = Duration::from_secs(interval_s.max(1));
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = sleep(dur) => {
                        exec_once(&id, &code, &py, &mut throttle).await;
                    }
                }
            }
        }

        ScriptTrigger::Cron { schedule } => {
            // Q34: l'espressione si legge **una volta**, prima del ciclo, e se
            // non si capisce il task finisce qui con un errore a log. Prima il
            // parser scartava in silenzio ciò che non sapeva leggere: il campo
            // diventava un insieme vuoto, nessun istante combaciava, e il task
            // restava in piedi a ricontrollare ogni ora per sempre — script
            // schedulato, task vivo, e mai una riga che dicesse perché non
            // partiva.
            let (cron, problemi) = crate::cron::analizza(&schedule);
            for p in &problemi {
                match p.gravita {
                    crate::cron::Gravita::Errore => error!(
                        script = %id, schedule = %schedule, campo = p.campo,
                        "cron non valido: {} — {}", p.messaggio, p.suggerimento
                    ),
                    crate::cron::Gravita::Avviso => warn!(
                        script = %id, schedule = %schedule, campo = p.campo,
                        "cron sospetto: {} — {}", p.messaggio, p.suggerimento
                    ),
                }
            }
            let Some(cron) = cron else {
                error!(script = %id, schedule = %schedule,
                    "lo script NON viene schedulato: l'espressione cron non è utilizzabile");
                return;
            };

            loop {
                // `None` = nessun istante nelle prossime 24 ore. È legittimo
                // (`0 0 29 2 *` esiste), quindi si ricontrolla fra un'ora
                // invece di rinunciare — ma qui è una scelta, non il residuo di
                // un insieme vuoto.
                let attesa = match cron.secondi_al_prossimo(adesso_unix()) {
                    Some(s) => s,
                    None => {
                        debug!(script = %id, schedule = %schedule,
                            "nessuna occorrenza nelle prossime 24 ore, ricontrollo fra un'ora");
                        3600
                    }
                };
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = sleep(Duration::from_secs(attesa)) => {
                        exec_once(&id, &code, &py, &mut throttle).await;
                    }
                }
            }
        }

        ScriptTrigger::TagChange { tag, edge } => {
            let mut rx = db.subscribe();
            let mut last_val: Option<TagValue> = db.get(&tag).await.map(|s| s.value);

            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    result = rx.recv() => {
                        match result {
                            Ok(update) if update.id == tag => {
                                let new_val = update.state.value.clone();
                                let fire = should_fire_on_edge(&edge, &last_val, &new_val);
                                last_val = Some(new_val);
                                if fire {
                                    exec_once(&id, &code, &py, &mut throttle).await;
                                }
                            }
                            Ok(_) => {}
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                                warn!(id = %id, lagged = n, "global script missed tag updates");
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                error!(id = %id, "tag broadcast channel closed; stopping script");
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    info!(id = %id, "global script task stopped");
}

/// Quante volte di fila uno script ha fallito, e con quale errore.
///
/// Serve perché uno script rotto su un intervallo di 1 s produce **172.800
/// righe al giorno** — due per tick, un WARN dal motore Python e un ERROR da
/// qui — tutte identiche. È successo davvero: un progetto con un `import` che
/// la sandbox del dispositivo blocca riempiva il pannello di log dell'IDE al
/// punto da nascondere tutto il resto (2026-08-28).
///
/// Un errore ripetuto all'infinito non è più informazione del primo: dice la
/// stessa cosa, e sommergendo le altre righe ne toglie.
#[derive(Default)]
pub(crate) struct FailureThrottle {
    consecutivi: u64,
    ultimo: String,
}

impl FailureThrottle {
    /// `Some(n)` se questo fallimento va registrato, col numero d'ordine.
    ///
    /// Un errore **diverso** si stampa sempre: è una notizia nuova, e tacerla
    /// perché il conteggio è "in mezzo" a una progressione nasconderebbe
    /// proprio il cambiamento che interessa.
    fn da_registrare(&mut self, errore: &str) -> Option<u64> {
        if errore != self.ultimo {
            self.ultimo = errore.to_string();
            self.consecutivi = 1;
            return Some(1);
        }
        self.consecutivi += 1;
        // Potenze di due: 10.000 fallimenti costano 14 righe invece di 10.000,
        // e ognuna dice a che punto siamo. Stessa regola di `lvgl_log.rs`.
        self.consecutivi.is_power_of_two().then_some(self.consecutivi)
    }

    /// Quanti fallimenti si erano accumulati prima che tornasse a funzionare.
    fn azzera(&mut self) -> u64 {
        let n = std::mem::take(&mut self.consecutivi);
        self.ultimo.clear();
        n
    }
}

async fn exec_once(id: &str, code: &str, py: &PyEngine, throttle: &mut FailureThrottle) {
    match py.execute(code.to_owned()).await {
        Ok(out) => {
            // La guarigione va detta: con i fallimenti strozzati, senza questa
            // riga non ci sarebbe modo di sapere che lo script è tornato a
            // funzionare — si vedrebbe solo il log smettere di lamentarsi, che
            // somiglia troppo a "ho smesso di guardare".
            let falliti = throttle.azzera();
            if falliti > 0 {
                info!(id = %id, falliti, "lo script è tornato a funzionare");
            }
            if !out.stdout.is_empty() {
                info!(id = %id, stdout = %out.stdout.trim_end(), "global script output");
            }
            if !out.stderr.is_empty() {
                warn!(id = %id, stderr = %out.stderr.trim_end(), "global script stderr");
            }
        }
        Err(e) => {
            if let Some(n) = throttle.da_registrare(&e) {
                if n == 1 {
                    error!(id = %id, error = %e, "global script execution failed");
                } else {
                    error!(id = %id, error = %e, consecutivi = n,
                           "global script execution failed (le occorrenze intermedie non sono registrate)");
                }
            }
        }
    }
}

/// Returns true when an edge condition is met.
fn should_fire_on_edge(edge: &str, prev: &Option<TagValue>, curr: &TagValue) -> bool {
    match edge {
        "any" => true,
        "rising" => {
            let was_false = prev.as_ref().map(is_falsy).unwrap_or(true);
            was_false && !is_falsy(curr)
        }
        "falling" => {
            let was_true = prev.as_ref().map(|v| !is_falsy(v)).unwrap_or(false);
            was_true && is_falsy(curr)
        }
        other => {
            warn!(edge = %other, "unknown edge type for global script; defaulting to 'any'");
            true
        }
    }
}

fn is_falsy(v: &TagValue) -> bool {
    match v {
        TagValue::Bool(b)  => !b,
        TagValue::Int(i)   => *i == 0,
        TagValue::Float(f) => *f == 0.0,
        TagValue::Str(s)   => s.is_empty() || s == "0" || s.eq_ignore_ascii_case("false"),
    }
}

// ── Il cron sta in `crate::cron` ──────────────────────────────────────────────
//
// Qui c'erano `parse_field`, `parse_cron`, `matches_cron`, `seconds_until_next`
// e `days_to_ymd`. Sono andati in `cron.rs` perché le stesse regole erano
// scritte **anche** in `validate.rs` (`cron_rilievi`), e due elenchi che devono
// andare d'accordo prima o poi non ci vanno: fino al 2026-09-03 il validatore
// diceva «questo cron non capisce `*/n`», vero allora e falso appena il parser
// li ha imparati. Ora la sintassi è definita in un posto solo.

/// L'istante di adesso in secondi dall'epoca. Isolato perché è l'unico pezzo
/// non deterministico del ciclo cron, e nei test del parser non serve.
fn adesso_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ─────────────────────────────────────────────────────────────────────────────

impl std::fmt::Debug for GlobalScriptSupervisor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "GlobalScriptSupervisor")
    }
}
