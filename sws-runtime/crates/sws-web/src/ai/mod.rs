//! L'assistente di progettazione: il ciclo, il protocollo, l'agente finto.
//!
//! # Dove gira, e perché qui
//!
//! Dentro `sws-runtime`, non in un processo a parte. L'editor ha già
//! `/ws/logs`, `/ws/tags` e `/ws/alarms` con `ReconnectingWs` dall'altra parte:
//! `/ws/ai` non inventa niente. La chiave sta nella config del runtime e non
//! entra mai nel progetto — il progetto si esporta, si manda in giro e finisce
//! su un dispositivo.
//!
//! # Cosa può fare
//!
//! Leggere il progetto (con i segreti mascherati) e **proporre**. Non scrive su
//! disco, non esegue Python, non fa deploy, non tocca il filesystem. La
//! proposta arriva al browser, che mostra il diff; se una persona accetta,
//! l'editor la applica al proprio store — dove c'è Ctrl+Z e da dove niente
//! raggiunge il disco finché nessuno preme Salva.
//!
//! # L'impronta
//!
//! Un turno dura decine di secondi, e in quel tempo la persona può spostare
//! oggetti. La proposta si porta dietro l'impronta del progetto letta all'inizio
//! e il browser rifiuta di applicarla se non corrisponde più. Controllo di
//! concorrenza ottimistico, con il pezzo che già esisteva (`calcola_impronta`).

mod background_size;
mod banco_tubi;
mod bench_house;
pub mod bfl;
pub mod chat_completions;
pub mod client;
pub mod config_api;
mod conversazioni;
pub(crate) mod field_assist;
mod floor_plan_tool;
mod foto_ide;
mod free_symbol_bench;
mod free_symbol_tool;
pub mod immagini;
pub mod local_http;
pub mod price_list;
pub mod prompt;
pub mod scopi;
pub mod spending;
pub(crate) mod strumenti_scopi;
pub(crate) mod symbol_draw;
pub mod tools;
pub mod user_keys;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use futures_util::{FutureExt, SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::router::{active_dir, calcola_impronta, AppState};
use crate::synoptic_schema as sch;

/// Quanti giri strumento→risultato prima di fermarsi. Un tetto serve: un
/// modello che gira a vuoto brucia contesto e denaro senza dirlo.
const MAX_GIRI: usize = 14;
/// Con delle bozze di simbolo sul banco la conversazione sta componendo una
/// pagina intera: piano, simboli, pagina, istantanee e correzioni non stanno in
/// quattordici giri. Il limite vero, lì, è il tetto di spesa.
const MAX_GIRI_CON_BOZZE: usize = 40;
/// Quante volte una proposta può tornare indietro per correzione prima di
/// arrivare comunque all'umano. Meglio una proposta imperfetta guardata da una
/// persona che un ciclo infinito.
const MAX_CORREZIONI: usize = 3;

/// I campi del mapping tag↔device, per `kind`. Vive qui perché lo usano sia lo
/// strumento sia l'endpoint HTTP.
pub fn mapping_di(kind: &str) -> &'static [sch::Field] {
    match kind {
        "mqtt" => sch::SOURCE_MQTT_TOPICMAPPING_FIELDS,
        "modbus_tcp" => sch::SOURCE_MODBUS_TCP_REGISTERMAPPING_FIELDS,
        "modbus_rtu" => sch::SOURCE_MODBUS_RTU_REGISTERMAPPING_FIELDS,
        "opcua_client" => sch::SOURCE_OPCUA_CLIENT_OPCUANODEMAPPING_FIELDS,
        "opcua_server" => sch::SOURCE_OPCUA_SERVER_OPCUASERVERNODEMAPPING_FIELDS,
        "homeassistant" => sch::SOURCE_HOMEASSISTANT_ENTITYMAPPING_FIELDS,
        "s7" => sch::SOURCE_S7_S7TAGMAPPING_FIELDS,
        "enip" => sch::SOURCE_ENIP_ENIPTAGMAPPING_FIELDS,
        "plx800_io" => sch::SOURCE_PLX800_IO_PLX800POINTMAPPING_FIELDS,
        _ => &[],
    }
}

/// `GET /ws/ai?conv=<id>&scope=symbol` — Admin. `scope=symbol` is the
/// symbol editor's conversation (23-11-2026): tools on the open symbol only.
///
/// L'id lega storia, spesa e banco alla conversazione invece che al socket
/// (10-11-2026, vedi `conversazioni`): una finestra che si ricollega ritrova
/// basi, varianti e bozze. Senza id, una conversazione per socket come prima.
pub async fn ws_ai_handler(
    ws: WebSocketUpgrade,
    State(s): State<AppState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    utente: Option<axum::Extension<crate::router::AuthUser>>,
) -> axum::response::Response {
    // The gateway opens no project: a chat there would only be a way to make
    // it call addresses on the platform's network.
    if s.regia.is_some() {
        return axum::http::StatusCode::NOT_FOUND.into_response();
    }
    let id = q.get("conv").cloned();
    let symbol_scope = q.get("scope").map(String::as_str) == Some("symbol");
    // Di chi è la conversazione (`conversazioni`, «Di chi è»): l'utente della
    // sessione, o «nessuno» senza autenticazione — dove c'è solo l'admin
    // sintetico, che non è una persona.
    let di = if crate::router::fonte_auth_corrente(&s).await
        == crate::router::FonteAutenticazione::Nessuna
    {
        conversazioni::NESSUNO.to_string()
    } else {
        utente
            .map(|axum::Extension(u)| u.username)
            .unwrap_or_else(|| conversazioni::NESSUNO.to_string())
    };
    ws.on_upgrade(move |socket| sessione(socket, s, id, di, symbol_scope))
        .into_response()
}

async fn sessione(
    socket: WebSocket,
    s: AppState,
    id_conversazione: Option<String>,
    di: String,
    symbol_scope: bool,
) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Un inoltratore separato: il ciclo manda eventi da dentro una closure
    // sincrona, che non può await sul socket.
    let inoltro = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            traccia("→", &m);
            if ws_tx.send(Message::Text(m)).await.is_err() {
                break;
            }
        }
    });

    let finto = std::env::var("SWS_AI_FAKE").ok();
    // The project's own key wins, as it always did. For a provider it has no key
    // for, and only behind the gateway, the key of whoever is writing is asked
    // to the gateway, for this session and in memory only (`user_keys.rs`).
    let user_keys = user_keys::fetch_all(&s, &di).await;
    let scelta = client::carica_con(&s.config_dir, &user_keys);

    // La conversazione: ritrovata se lo stesso id c'era già (riconnessione),
    // nuova altrimenti. `try_lock` perché un socket fantasma a metà turno non
    // deve far aspettare il «pronto»: in quel caso si dice solo che c'era.
    let chiave = conversazioni::chiave(
        id_conversazione.as_deref(),
        active_dir(&s).await.ok().as_deref(),
        &di,
    );
    let (conv, trovata) = match &chiave {
        Some(k) => {
            let mut tutte = conversazioni::tutte()
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if tutte.di_un_altro(k) {
                // Niente contenuti nel log: solo che è successo.
                tracing::info!(
                    target: "sws_ai",
                    "conversazione di un altro utente con lo stesso id: se ne apre una nuova e vuota"
                );
            }
            tutte.prendi(k, std::time::Instant::now())
        }
        None => (
            std::sync::Arc::new(tokio::sync::Mutex::new(
                conversazioni::Conversazione::nuova(),
            )),
            false,
        ),
    };
    let (ripresa, speso) = match conv.try_lock() {
        Ok(g) => (!g.vuota(), g.misure.costo_usd),
        Err(_) => (trovata, 0.0),
    };
    if ripresa {
        tracing::info!(target: "sws_ai", speso, "conversazione ripresa dopo una riconnessione");
    }

    invia(
        &tx,
        json!({
            "t": "pronto",
            // Il socket è nuovo ma la conversazione no: il pannello non azzera
            // i contatori, e mostra la spesa che il tetto sta già contando.
            "ripresa": ripresa,
            "speso": speso,
            "tetto": scelta.as_ref().map(|sc| sc.tetto_usd),
            "modello": match (&finto, &scelta) {
                (Some(_), _) => "finto".to_string(),
                (None, Some(sc)) => sc.modello.clone(),
                (None, None) => "-".to_string(),
            },
            // Quale fornitore, e non solo quale modello: la stessa chat può parlare
            // con Anthropic o con Kimi, e chi guarda una proposta ha diritto di
            // sapere chi l'ha scritta.
            "fornitore": match (&finto, &scelta) {
                (Some(_), _) => "finto".to_string(),
                (None, Some(sc)) => sc.fornitore.nome().to_string(),
                (None, None) => "-".to_string(),
            },
            // Whose key it is: the project's or the user's (the panel says which).
            "chiave": scelta.as_ref().map(|sc| sc.source.name()),
            // Behind the gateway the user can add their own key in their menu.
            "chiave_utente_possibile": s.ritorno.origine_se_dietro_al_gateway().is_some(),
            // Il pannello deve poter dire «manca la chiave» invece di sembrare rotto.
            "attivo": finto.is_some() || scelta.is_some(),
            "motivo": if finto.is_some() { Value::Null }
                      else if scelta.is_none() {
                          json!(format!("nessuna chiave: metti ANTHROPIC_API_KEY o \
                                         MOONSHOT_API_KEY o MISTRAL_API_KEY nell'ambiente, oppure la chiave in {}; \
                                         oppure un modello in casa, con indirizzo e modello nel menù IA. \
                                         Se ce n'è più d'uno vince Anthropic, poi Kimi, poi Mistral, poi il modello in casa; \
                                         per sceglierne un altro, SWS_AI_FORNITORE=kimi, mistral o local",
                                        client::percorsi_chiave(&s.config_dir).iter()
                                            .map(|p| p.display().to_string())
                                            .collect::<Vec<_>>().join(" o ")))
                      } else { Value::Null },
        }),
    );

    // Q41 — il saldo dell'account, per chi lo espone (oggi solo Kimi: vedi
    // `Fornitore::url_saldo`). Chiesto UNA volta, all'apertura del pannello —
    // a ogni messaggio sarebbe una chiamata in più per risposta (scheda,
    // domanda 4) — e in un task suo: la chat non aspetta il saldo.
    if let Some(sc) = scelta
        .clone()
        .filter(|sc| sc.fornitore.url_saldo().is_some())
    {
        let tx_saldo = tx.clone();
        tokio::spawn(async move {
            if let Some(disponibile) = client::saldo(&sc).await {
                invia(
                    &tx_saldo,
                    json!({ "t": "saldo", "disponibile": disponibile }),
                );
            }
        });
    }

    // Gli scopi configurati decidono gli strumenti in più: una volta, qui, così
    // l'elenco resta lo stesso per tutta la conversazione (la cache regge).
    let mut ctx =
        strumenti_scopi::Contesto::da_con(&s.config_dir, &user_keys, s.in_cloud(), scelta.as_ref());
    ctx.opzioni.simbolo = symbol_scope;

    // Il socket lo legge un compito a parte: la foto di un progetto web
    // (`foto_ide`) torna dal browser mentre il turno è in corso, cioè mentre
    // questo ciclo è fermo dentro `vero_giro`. Tutto il resto passa al ciclo.
    let ide = foto_ide::Ide::nuovo(tx.clone());
    let (in_tx, mut in_rx) = mpsc::unbounded_channel::<String>();
    let lettore_ide = ide.clone();
    tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_rx.next().await {
            let Message::Text(testo) = msg else { continue };
            traccia("←", &testo);
            if !lettore_ide.consegna_se_foto(&testo) && in_tx.send(testo).is_err() {
                break;
            }
        }
        lettore_ide.chiudi();
    });

    while let Some(testo) = in_rx.recv().await {
        let Ok(v): Result<Value, _> = serde_json::from_str(&testo) else {
            invia(
                &tx,
                json!({ "t": "errore", "messaggio": "messaggio non JSON" }),
            );
            continue;
        };
        // «Usa come base» sotto la miniatura di uno sfondo (F6): l'approvazione
        // la dà la persona, e passa da qui, non dal modello.
        if v.get("t").and_then(Value::as_str) == Some("approva_sfondo") {
            let id = v.get("id").and_then(Value::as_str).unwrap_or("");
            let ok = strumenti_scopi::approva(&mut conv.lock().await.banco, id);
            invia(&tx, json!({ "t": "sfondo_approvato", "id": id, "ok": ok }));
            continue;
        }
        if v.get("t").and_then(Value::as_str) != Some("chiedi") {
            continue;
        }
        let domanda = v
            .get("testo")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if domanda.trim().is_empty() {
            continue;
        }

        // Il lucchetto per tutto il turno: storia, spesa e banco cambiano insieme.
        let mut g = conv.lock().await;
        // The symbol editor sends the symbol as it is with every question:
        // `leggi_simbolo` reads the latest. Only in that scope, and not a huge one.
        if symbol_scope {
            if let Some(d) = v.get("simbolo").filter(|d| d.is_object()) {
                if d.to_string().len() <= OPEN_SYMBOL_MAX_BYTES {
                    g.banco.simbolo_aperto = Some(d.clone());
                }
            }
        }
        let conversazioni::Conversazione {
            messaggi,
            misure,
            banco,
        } = &mut *g;
        messaggi.push(domanda_dopo(messaggi, &domanda));

        let esito = match &finto {
            // La foto di un progetto web la chiede l'IDE di QUESTO socket: la
            // conversazione può essere stata ritrovata dopo una riconnessione,
            // ma il browser che risponde è quello collegato adesso.
            Some(f) => foto_ide::IDE
                .scope(ide.clone(), finto_giro(&s, &tx, f, banco))
                .await
                .map_err(TurnError::from),
            None => match &scelta {
                Some(sc) => {
                    let giro = vero_giro(&s, &tx, sc, &ctx, messaggi, misure, banco);
                    // A panic inside a tool must end the turn, not the task:
                    // otherwise «fine» never comes and the chat waits for ever
                    // (17-11-2026, a `project` sent as a JSON string).
                    let r = std::panic::AssertUnwindSafe(foto_ide::IDE.scope(ide.clone(), giro))
                        .catch_unwind()
                        .await
                        .unwrap_or_else(|p| Err(TurnError::from(panic_message(p))));
                    misure.scrivi(&s.config_dir, sc, s.in_cloud());
                    r
                }
                None => Err("nessuna chiave API configurata".to_string().into()),
            },
        };
        if let Some(k) = &chiave {
            let peso = g.peso();
            conversazioni::tutte()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .tocca(k, std::time::Instant::now(), peso);
        }
        drop(g);
        if let Err(e) = esito {
            invia(&tx, e.event());
        }
        invia(&tx, json!({ "t": "fine" }));
    }

    // L'`Ide` tiene un mittente: finché vive, l'inoltratore non finisce.
    drop(ide);
    drop(tx);
    let _ = inoltro.await;
}

/// Quanto costa una conversazione, giro per giro. Serve al tetto sempre, e con
/// `SWS_AI_MISURE=<cartella>` finisce anche in un file: è il resoconto delle
/// prove col modello vero (piano `2026-11-03-assistente-genera-simboli-e-sinottici`),
/// senza il quale «una pagina costa 3–6 $» resterebbe una stima.
pub(crate) struct Misure {
    nome: String,
    inizio: std::time::Instant,
    pub costo_usd: f64,
    giri: Vec<Value>,
    pub strumenti: std::collections::BTreeMap<String, u32>,
    pub correzioni: u32,
}

impl Misure {
    pub fn nuove() -> Self {
        let ora = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
        Misure {
            nome: format!("{ora}-{}", std::process::id()),
            inizio: std::time::Instant::now(),
            costo_usd: 0.0,
            giri: Vec::new(),
            strumenti: Default::default(),
            correzioni: 0,
        }
    }

    pub fn giro(&mut self, usage: &Value, costo: f64, secondi: f64) {
        self.costo_usd += costo;
        self.giri
            .push(json!({ "usage": usage, "costo_usd": costo, "secondi": secondi }));
    }

    pub fn resoconto(
        &self,
        config_dir: &std::path::Path,
        scelta: &client::Scelta,
        in_cloud: bool,
    ) -> Value {
        let somma = |c: &str| -> u64 {
            self.giri
                .iter()
                .filter_map(|g| g["usage"].get(c).and_then(Value::as_u64))
                .sum()
        };
        json!({
            "modello": scelta.modello,
            "fornitore": scelta.fornitore.nome(),
            "prezzi_noti": price_list::known(config_dir, scelta.fornitore, &scelta.modello, in_cloud),
            "tetto_usd": scelta.tetto_usd,
            "costo_usd": self.costo_usd,
            "minuti": self.inizio.elapsed().as_secs_f64() / 60.0,
            "giri": self.giri.len(),
            "token": {
                "ingresso": somma("input_tokens"),
                "uscita": somma("output_tokens"),
                "cache_lettura": somma("cache_read_input_tokens"),
                "cache_scrittura": somma("cache_creation_input_tokens"),
            },
            "strumenti": self.strumenti,
            "correzioni": self.correzioni,
            "per_giro": self.giri,
        })
    }

    /// Scrive il resoconto se `SWS_AI_MISURE` lo chiede. Un errore di
    /// scrittura va nel log e basta: la misura non deve mai rompere la chat.
    pub fn scrivi(&self, config_dir: &std::path::Path, scelta: &client::Scelta, in_cloud: bool) {
        let Some(dir) = std::env::var_os("SWS_AI_MISURE") else {
            return;
        };
        let dir = std::path::PathBuf::from(dir);
        let p = dir.join(format!("{}.json", self.nome));
        let esito = std::fs::create_dir_all(&dir).and_then(|_| {
            std::fs::write(
                &p,
                serde_json::to_string_pretty(&self.resoconto(config_dir, scelta, in_cloud))
                    .unwrap_or_default(),
            )
        });
        if let Err(e) = esito {
            tracing::warn!(path = %p.display(), errore = %e, "resoconto AI non scritto");
        }
    }
}

/// `SWS_AI_DEBUG=1`: una riga di log per ogni messaggio della chat e per ogni
/// strumento, col tipo, i byte e i tempi. Nata dagli sfondi del 05-11-2026: «Usa
/// come base» sembrava non rispondere e non c'era modo di sapere se il clic
/// fosse arrivato, se il turno fosse ancora in corso o dove si fosse fermato.
/// Senza la variabile le stesse righe escono a livello `debug`.
fn debug_ai() -> bool {
    static ACCESO: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ACCESO.get_or_init(|| std::env::var("SWS_AI_DEBUG").is_ok_and(|v| !v.is_empty() && v != "0"))
}

/// Una riga per un messaggio del socket: la direzione, il tipo, i byte. Il
/// contenuto no: dentro ci sono immagini in base64 e testi del progetto.
fn traccia(verso: &str, m: &str) {
    let tipo = serde_json::from_str::<Value>(m)
        .ok()
        .and_then(|v| v.get("t").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_default();
    // I delta di testo sono centinaia per risposta: solo in debug vero.
    if debug_ai() && tipo != "testo" && tipo != "pensiero" {
        tracing::info!(target: "sws_ai", verso, tipo, byte = m.len(), "chat");
    } else {
        tracing::debug!(target: "sws_ai", verso, tipo, byte = m.len(), "chat");
    }
}

fn invia(tx: &mpsc::UnboundedSender<String>, v: Value) {
    let _ = tx.send(v.to_string());
}

async fn impronta(s: &AppState) -> Option<String> {
    let dir = active_dir(s).await.ok()?;
    tokio::task::spawn_blocking(move || calcola_impronta(&dir))
        .await
        .ok()?
        .ok()
}

// ─────────────────────────────────────────────────────────────────────────────
// Il ciclo vero
// ─────────────────────────────────────────────────────────────────────────────

/// Le regole di contesto del progetto aperto per uno scopo (`project.ai`).
pub(crate) async fn regole_del_progetto(s: &AppState, scopo: &str) -> Option<String> {
    let dir = crate::router::active_dir(s).await.ok()?;
    sws_core::Project::load(&dir).ok()?.ai?.per_scopo(scopo)
}

/// Why a turn stopped. The message is what the chat shows; an error the IDE
/// knows how to say in its own language also carries a code with its values
/// (`{"id": "local_context_too_small", "loaded", "needed"}`), and the message
/// stays as the fallback of an IDE that does not know the code.
#[derive(Debug)]
struct TurnError {
    message: String,
    code: Option<Value>,
}

impl From<String> for TurnError {
    fn from(message: String) -> Self {
        TurnError {
            message,
            code: None,
        }
    }
}

impl TurnError {
    fn from_anyhow(e: anyhow::Error) -> Self {
        TurnError {
            code: e
                .downcast_ref::<crate::ai::local_http::ContextTooSmall>()
                .map(|c| c.code()),
            message: format!("{e:#}"),
        }
    }

    fn event(&self) -> Value {
        let mut ev = json!({ "t": "errore", "messaggio": self.message });
        if let Some(c) = &self.code {
            ev["codice"] = c.clone();
        }
        ev
    }
}

/// The text of a panic caught around a turn, for the log and the chat.
fn panic_message(p: Box<dyn std::any::Any + Send>) -> String {
    let what = p
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_default();
    tracing::error!(panic = %what, "the assistant turn panicked");
    format!("errore interno dell'assistente, il turno è stato fermato: {what}")
}

/// What the model is told when it closes a turn with no text and no tool
/// call: model-facing, in Italian like the rest of the prompt.
const SILENT_NUDGE: &str = "Hai chiuso il turno senza scrivere niente per la persona, che non \
     vede il tuo ragionamento. Riprendi da dove eri arrivato con il passo successivo (lo \
     schema dell'oggetto, valida, proponi_modifica), oppure scrivi alla persona una domanda.";

/// What a local model is told when it closes the turn on an announcement
/// («ora propongo…») without the call: model-facing, in Italian.
const ANNOUNCED_NUDGE: &str = "Hai scritto cosa farai, ma il turno si è chiuso senza farlo: la \
     persona non vede ancora niente. Se la modifica è pronta, chiama adesso proponi_modifica \
     (o lo strumento che serve). Se invece hai finito, o ti serve una risposta della persona, \
     scrivilo con una domanda.";

/// The assistant message kept in the history in place of a silent one: the
/// reasoning blocks it had, without blank texts, and a minimal text.
fn silent_assistant(content: &[Value]) -> Value {
    let mut blocchi: Vec<Value> = content
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) != Some("text"))
        .cloned()
        .collect();
    blocchi.push(json!({ "type": "text", "text": "…" }));
    json!({ "role": "assistant", "content": blocchi })
}

async fn vero_giro(
    s: &AppState,
    tx: &mpsc::UnboundedSender<String>,
    scelta: &client::Scelta,
    ctx: &strumenti_scopi::Contesto,
    messaggi: &mut Vec<Value>,
    misure: &mut Misure,
    banco: &mut Banco,
) -> Result<(), TurnError> {
    // In the cloud (`AppState::in_cloud`) the address of a local model must
    // be a public one (`local_http.rs`).
    let cliente = client::Cliente::for_instance(scelta.clone(), s.in_cloud())?;
    let strumenti = tools::definizioni_per(ctx.opzioni);
    let mut sistema = prompt::sistema_con(regole_del_progetto(s, "assistente").await.as_deref());
    // The prompt speaks of the snapshot in several places: one line says it is
    // not there, rather than a second prompt to keep in step with the first.
    if ctx.opzioni.no_snapshot {
        sistema.push(json!({ "type": "text", "text": prompt::NO_SNAPSHOT }));
    }
    // The symbol editor: one more block after the fixed prompt, so the cached
    // prefix stays the same for every conversation.
    if ctx.opzioni.simbolo {
        sistema.push(json!({ "type": "text", "text": prompt::SYMBOL_EDITOR }));
    }
    let impronta_iniziale = impronta(s).await;
    let mut correzioni = 0usize;
    // Dopo una bozza di simbolo il giro si ferma e la persona guarda la tavola
    // (prompt, «Quando ti chiedono un sinottico intero», punto 3). Il prompt lo
    // dice due volte, e il 04-11-2026 kimi-k3.1-pro è arrivato lo stesso alla
    // proposta nello stesso turno, senza mai fermarsi: qui lo strumento lo impone.
    let mut bozze_in_questo_turno = false;
    // Lo stesso per gli sfondi: le candidate le sceglie la persona.
    let mut sfondi_in_questo_turno = false;
    // How many times in this turn the model closed without writing anything.
    let mut silenzi = 0usize;
    // Whether a local model that closed on words, not on a call, was already
    // asked to act in this turn.
    let mut annuncio_sollecitato = false;

    let mut giro = 0usize;
    loop {
        let limite = if !banco.has_symbol_drafts() && banco.floor_plans.is_empty() {
            MAX_GIRI
        } else {
            MAX_GIRI_CON_BOZZE
        };
        if giro >= limite {
            return Err(format!(
                "l'assistente ha fatto {limite} giri senza concludere: la richiesta \
                 probabilmente va spezzata in due"
            )
            .into());
        }
        giro += 1;
        // Il tetto si guarda PRIMA del giro: un giro partito si paga comunque.
        if misure.costo_usd >= scelta.tetto_usd {
            invia(
                tx,
                json!({ "t": "tetto", "speso": misure.costo_usd, "tetto": scelta.tetto_usd }),
            );
            return Err(format!(
                "tetto di spesa raggiunto: questa conversazione è costata {:.2} $ \
                 su {:.2} $. Apri una conversazione nuova, o alza il tetto nelle \
                 preferenze dell'IDE",
                misure.costo_usd, scelta.tetto_usd
            )
            .into());
        }
        let inizio_giro = std::time::Instant::now();
        let tx2 = tx.clone();
        // L'avanzamento dell'input di uno strumento arriva a ogni pezzo: alla
        // chat basta una volta al secondo, col nome e il tempo dall'inizio.
        let mut scrive: Option<(String, std::time::Instant, std::time::Instant)> = None;
        let risposta = cliente
            .turno(sistema.clone(), messaggi, &strumenti, move |e| match e {
                client::Evento::Testo(t) => invia(&tx2, json!({ "t": "testo", "delta": t })),
                client::Evento::Pensiero(t) => invia(&tx2, json!({ "t": "pensiero", "delta": t })),
                client::Evento::StrumentoInizio { nome } => {
                    let ora = std::time::Instant::now();
                    scrive = Some((nome.clone(), ora, ora));
                    invia(
                        &tx2,
                        json!({ "t": "strumento", "nome": nome, "stato": "inizio" }),
                    )
                }
                client::Evento::StrumentoScrive { byte } => {
                    let Some((nome, inizio, ultimo)) = scrive.as_mut() else {
                        return;
                    };
                    if ultimo.elapsed() < std::time::Duration::from_secs(1) {
                        return;
                    }
                    *ultimo = std::time::Instant::now();
                    invia(
                        &tx2,
                        json!({ "t": "strumento", "nome": nome, "stato": "scrivo",
                                "byte": byte, "secondi": inizio.elapsed().as_secs() }),
                    );
                }
            })
            .await
            .map_err(TurnError::from_anyhow)?;

        // Il costo del turno nel registro, mai il contenuto.
        tracing::info!(giro, usage = %risposta.usage, stop = %risposta.stop_reason,
                       "turno assistente");

        // Q41 — il costo del turno anche allo SCHERMO: il pannello somma per
        // conversazione. Il dato è già in mano (usage della risposta), quindi
        // zero chiamate in più. I token di cache viaggiano separati: contarli
        // come ingresso pieno mentirebbe sul costo.
        let tok = |campo: &str| {
            risposta
                .usage
                .get(campo)
                .and_then(Value::as_u64)
                .unwrap_or(0)
        };
        let costo = price_list::cost_usd(
            &s.config_dir,
            scelta.fornitore,
            &scelta.modello,
            &risposta.usage,
            s.in_cloud(),
        );
        misure.giro(&risposta.usage, costo, inizio_giro.elapsed().as_secs_f64());
        spending::add(
            &s.config_dir,
            scopi::Scopo::Assistente.nome(),
            scelta.fornitore.nome(),
            costo,
        );
        if debug_ai() {
            tracing::info!(target: "sws_ai", giro, ms = inizio_giro.elapsed().as_millis() as u64,
                           costo_usd = costo, "risposta del modello");
        }
        invia(
            tx,
            json!({ "t": "risorse",
            "input": tok("input_tokens"), "output": tok("output_tokens"),
            "cache_lettura": tok("cache_read_input_tokens"),
            "cache_scrittura": tok("cache_creation_input_tokens"),
            "costo": costo, "speso": misure.costo_usd, "tetto": scelta.tetto_usd,
            "prezzi_noti": price_list::known(&s.config_dir, scelta.fornitore, &scelta.modello, s.in_cloud()),
            // A local model costs nothing: the panel shows its tokens, not a
            // spending against a cap that cannot be reached.
            "fornitore": scelta.fornitore.nome() }),
        );

        let usi = risposta.tool_uses();
        let silent = usi.is_empty() && risposta.testo().trim().is_empty();
        if silent {
            // A turn closed with nothing for the person: the chat would just
            // stop. Seen on 17-11-2026 with qwen3.5:9b through Ollama: three
            // tools in parallel, then a round of reasoning only, and the
            // maintainer thought the chat was stuck. The history keeps a
            // minimal text in its place, so that no dialect has to drop it
            // (an empty assistant is refused by the Messages API, and two
            // user messages in a row are refused by some providers).
            messaggi.push(silent_assistant(&risposta.content));
            if silenzi >= 1 {
                return Err(TurnError {
                    message: "il modello ha chiuso il turno senza scrivere niente, due volte"
                        .to_string(),
                    code: Some(json!({ "id": "model_silent" })),
                });
            }
            silenzi += 1;
            tracing::info!(
                giro,
                "turn closed without text: the model is asked to go on"
            );
            messaggi.push(json!({ "role": "user", "content": SILENT_NUDGE }));
            continue;
        }
        messaggi.push(json!({ "role": "assistant", "content": risposta.content }));

        if usi.is_empty() {
            // A local model that says what it is about to do, and stops: seen
            // on 17-11-2026 with qwen3.5:9b, «Propongo la pagina completa…»
            // after reading the page, and no call. Once per turn, and only
            // after it has used tools: a question, or an answer that needed
            // none, ends the turn as before. Only for local models: a paid
            // provider would pay a round for a turn that was really over.
            let testo = risposta.testo();
            if scelta.fornitore == client::Fornitore::Local
                && giro > 1
                && !annuncio_sollecitato
                && !testo.trim_end().ends_with('?')
            {
                annuncio_sollecitato = true;
                tracing::info!(
                    giro,
                    "turn closed on an announcement: the model is asked to act"
                );
                messaggi.push(json!({ "role": "user", "content": ANNOUNCED_NUDGE }));
                continue;
            }
            return Ok(());
        }

        // Tutti i risultati in UN solo messaggio utente: spezzarli insegna al
        // modello a non chiamare più strumenti in parallelo.
        let mut risultati: Vec<Value> = Vec::new();
        for (id, nome, input) in usi {
            *misure.strumenti.entry(nome.to_string()).or_insert(0) += 1;
            if nome == "proponi_modifica" && bozze_in_questo_turno {
                risultati.push(risultato(
                    id,
                    &json!({
                        "inviata": false,
                        "motivo": "in questo turno hai disegnato delle bozze di simbolo: fermati. \
                                   Fotografa la tavola delle bozze (istantanea_pagina senza nome), \
                                   chiedi alla persona quali rifare e aspetta che risponda. \
                                   La proposta si manda in un turno successivo.",
                    }),
                    true,
                ));
                rimanda(tx, nome, "rimandata: prima scegli tu i simboli");
                continue;
            }
            if nome == "proponi_modifica" && sfondi_in_questo_turno {
                risultati.push(risultato(
                    id,
                    &json!({
                        "inviata": false,
                        "motivo": "in questo turno hai generato delle basi di sfondo: fermati. La \
                                   persona ne sceglie una col bottone «Usa come base»; la proposta \
                                   si manda in un turno successivo.",
                    }),
                    true,
                ));
                rimanda(tx, nome, "rimandata: prima scegli tu lo sfondo");
                continue;
            }
            // Le basi aspettano la persona: niente istantanee nello stesso turno.
            // Il 05-11-2026 il modello, invece di fermarsi, ha fotografato tre
            // volte (60 s ciascuna), e per tutto quel tempo «Usa come base» non
            // poteva partire.
            // A model that does not read images was not offered the tool, but
            // a prompt that names it, or an old conversation, can still make
            // it call it: the image must not leave all the same.
            if nome == "istantanea_pagina" && ctx.opzioni.no_snapshot {
                risultati.push(risultato(id, &snapshot_refused(), true));
                rimanda(tx, nome, "non disponibile: il modello non vede le immagini");
                continue;
            }
            if nome == "istantanea_pagina" && sfondi_in_questo_turno {
                risultati.push(risultato(
                    id,
                    &json!({
                        "eseguita": false,
                        "motivo": "in questo turno hai generato delle basi di sfondo: fermati e \
                                   lascia scegliere la persona («Usa come base»). La pagina si \
                                   fotografa nel turno delle varianti.",
                    }),
                    true,
                ));
                rimanda(tx, nome, "rimandata: prima scegli tu lo sfondo");
                continue;
            }
            if nome == "proponi_simbolo" {
                if bozze_in_questo_turno {
                    risultati.push(risultato(
                        id,
                        &json!({
                            "inviata": false,
                            "motivo": "in questo turno hai disegnato: fermati. La persona guarda la \
                                       bozza in chat; la proposta si manda nel turno dopo, quando \
                                       la conferma.",
                        }),
                        true,
                    ));
                    rimanda(tx, nome, "rimandata: prima guarda la bozza");
                    continue;
                }
                match proponi_simbolo(tx, input, banco) {
                    Ok(()) => return Ok(()),
                    Err(e) => {
                        risultati.push(risultato(
                            id,
                            &json!({ "inviata": false, "motivo": e }),
                            true,
                        ));
                    }
                }
                continue;
            }
            if nome == "proponi_modifica" {
                match proponi(
                    s,
                    tx,
                    input,
                    impronta_iniziale.as_deref(),
                    correzioni,
                    banco,
                )
                .await
                {
                    Proposta::Inviata => return Ok(()),
                    Proposta::Correggi(rilievi) => {
                        correzioni += 1;
                        misure.correzioni += 1;
                        risultati.push(risultato(id, &rilievi, true));
                    }
                }
                continue;
            }
            // `istantanea_pagina` si intercetta qui, come `proponi_modifica`
            // sopra, e per una ragione simile: non produce un risultato JSON da
            // rimandare al modello ma un **blocco immagine**, che
            // `tools::esegui` — il cui esito è un `Value` — non può
            // rappresentare. Metterla là dentro avrebbe voluto dire cambiare la
            // firma di tutti gli undici strumenti per il caso di uno.
            if nome == "istantanea_pagina" {
                invia(
                    tx,
                    json!({ "t": "strumento", "nome": nome, "stato": "eseguo" }),
                );
                match istantanea_per_il_modello(s, tx, input, banco).await {
                    Ok(blocchi) => {
                        invia(
                            tx,
                            json!({ "t": "strumento", "nome": nome, "stato": "fatto" }),
                        );
                        // Quello che il modello guarda lo guarda anche chi
                        // chatta: senza, la chat diceva solo «✓ istantanea_pagina»
                        // e la persona doveva fidarsi del giudizio del modello.
                        invia(
                            tx,
                            json!({ "t": "immagine", "png": blocchi[0]["source"]["data"],
                                    "testo": blocchi[1]["text"] }),
                        );
                        risultati.push(json!({
                            "type": "tool_result", "tool_use_id": id, "content": blocchi,
                        }));
                    }
                    Err(e) => {
                        invia(
                            tx,
                            json!({ "t": "strumento", "nome": nome, "stato": "errore",
                                          "messaggio": e }),
                        );
                        risultati.push(risultato(id, &json!({ "errore": e }), true));
                    }
                }
                continue;
            }
            invia(
                tx,
                json!({ "t": "strumento", "nome": nome, "stato": "eseguo" }),
            );
            let inizio_strumento = std::time::Instant::now();
            // Le bozze di simbolo vivono qui, nel banco della conversazione:
            // `bozza_simbolo` ci scrive, e `valida` le deve vedere.
            let esito = match nome {
                "leggi_simbolo" => Ok(leggi_simbolo(banco.simbolo_aperto.as_ref())),
                "fai_domande" => tools::domande(input).map(|frame| {
                    invia(tx, frame);
                    json!({ "mostrate": true, "nota": "Le domande sono sullo schermo. FERMATI qui, \
                            senza altri strumenti: le risposte arrivano nel prossimo messaggio." })
                }),
                "bozza_simbolo" => {
                    let e = bozza(tx, banco, input);
                    bozze_in_questo_turno |= e.is_ok();
                    e
                }
                "disegna_simbolo" => {
                    let e = strumenti_scopi::disegna(
                        s,
                        tx,
                        banco,
                        misure,
                        ctx,
                        scelta.tetto_usd,
                        input,
                    )
                    .await;
                    bozze_in_questo_turno |= e.is_ok();
                    e
                }
                "genera_sfondo" => {
                    let e = strumenti_scopi::genera_sfondi(
                        s,
                        tx,
                        banco,
                        misure,
                        ctx,
                        scelta.tetto_usd,
                        input,
                    )
                    .await;
                    sfondi_in_questo_turno |= e.is_ok();
                    e
                }
                "varia_sfondo" => {
                    strumenti_scopi::varia_sfondi(
                        s,
                        tx,
                        banco,
                        misure,
                        ctx,
                        scelta.tetto_usd,
                        input,
                    )
                    .await
                }
                "floor_plan" => floor_plan_tool::run(s, tx, banco, input).await,
                "valida" => {
                    tools::valida_interna(s, input, &banco.simboli, &banco.free_symbols, false)
                        .await
                        .map(|(g, _)| g)
                }
                _ => tools::esegui(s, nome, input).await,
            };
            let ms = inizio_strumento.elapsed().as_millis() as u64;
            if debug_ai() {
                tracing::info!(target: "sws_ai", strumento = nome, ms, ok = esito.is_ok(), "strumento");
            } else {
                tracing::debug!(target: "sws_ai", strumento = nome, ms, ok = esito.is_ok(), "strumento");
            }
            match esito {
                Ok(v) => {
                    invia(
                        tx,
                        json!({ "t": "strumento", "nome": nome, "stato": "fatto" }),
                    );
                    risultati.push(risultato(id, &v, false));
                }
                Err(e) => {
                    invia(
                        tx,
                        json!({ "t": "strumento", "nome": nome, "stato": "errore",
                                      "messaggio": e }),
                    );
                    risultati.push(risultato(id, &json!({ "errore": e }), true));
                }
            }
        }
        messaggi.push(json!({ "role": "user", "content": risultati }));
    }
}

/// Scatta e impacchetta per il modello: il blocco immagine più una riga di
/// testo con le dimensioni e quello che il viewer ha detto.
///
/// Il testo accanto all'immagine non è decorazione: un pulsante che apre la
/// finestra giusta e poi scrive il valore sbagliato, **in una fotografia,
/// sembrerebbe funzionare**. Le righe «comando prodotto: …» del viewer sono
/// l'unica prova di cosa il tocco ha fatto davvero.
async fn istantanea_per_il_modello(
    s: &AppState,
    tx: &mpsc::UnboundedSender<String>,
    input: &Value,
    banco: &Banco,
) -> Result<Value, String> {
    let dir = crate::router::active_dir(s)
        .await
        .map_err(|_| "nessun progetto aperto: non c'è niente da fotografare".to_string())?;
    // Il motore del progetto (10-11-2026): un progetto web lo fotografa il
    // browser dell'IDE, non il viewer LVGL.
    if foto_ide::motore_web(&dir) {
        return foto_ide::istantanea(&dir, input, banco).await;
    }
    // Una pagina in composizione si fotografa al posto di quella col suo nome;
    // senza pagina né nome, con delle bozze, si fotografa la loro tavola.
    let mut nome = input
        .get("nome")
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut pagine = Vec::new();
    if let Some(p) = input.get("pagina").filter(|p| p.is_object()) {
        nome = p.get("name").and_then(Value::as_str).map(str::to_string);
        pagine.push(p.clone());
    } else if nome.is_none() && banco.has_symbol_drafts() {
        let t = tavola_delle_bozze(&banco.simboli, &banco.free_symbols);
        nome = t.get("name").and_then(Value::as_str).map(str::to_string);
        pagine.push(t);
    }
    let scatto = crate::istantanea::scatta(crate::istantanea::Richiesta {
        progetto: dir,
        simboli: banco
            .simboli
            .iter()
            .filter_map(|d| serde_json::to_value(d).ok())
            .collect(),
        custom_symbols: banco
            .free_symbols
            .iter()
            .filter_map(|d| serde_json::to_value(&d.symbol).ok())
            .collect(),
        pagine,
        www: s.www_dir.as_deref().cloned(),
        faceplates: crate::ai::tools::faceplate_proposti(input)?,
        pagina: nome,
        tocca: input
            .get("tocca")
            .and_then(Value::as_str)
            .map(str::to_string),
        ms: input.get("ms").and_then(Value::as_u64),
        immagini: banco
            .sfondi
            .iter()
            .map(|f| (f.file(), f.jpg.clone()))
            .chain(
                banco
                    .floor_plans
                    .iter()
                    .map(|d| (d.file(), d.svg.clone().into_bytes())),
            )
            .collect(),
        avanzamento: Some({
            let tx = tx.clone();
            std::sync::Arc::new(move |riga: &str| {
                let breve: String = riga.chars().take(120).collect();
                invia(
                    &tx,
                    json!({ "t": "strumento", "nome": "istantanea_pagina",
                                   "stato": "eseguo", "messaggio": breve }),
                );
            })
        }),
    })
    .await?;
    Ok(blocchi_istantanea(&scatto))
}

/// I blocchi `tool_result` per uno scatto: l'immagine e la riga di testo.
///
/// Separata da chi la chiama perché è l'unica parte di questo percorso
/// verificabile senza un modello e senza far girare LVGL: se la forma del
/// blocco immagine è sbagliata, il modello riceve un errore dall'API e nessuno
/// capisce perché.
fn blocchi_istantanea(scatto: &crate::istantanea::Scatto) -> Value {
    use base64::Engine as _;

    let mut testo = format!(
        "Istantanea LVGL: {}x{} px.",
        scatto.larghezza, scatto.altezza
    );
    if scatto.note.is_empty() {
        // Dirlo esplicitamente: col silenzio, un modello che ha chiesto dei
        // tocchi non sa se non hanno prodotto comandi o se non li abbiamo
        // riportati.
        testo.push_str(" Il viewer non ha segnalato nulla.");
    } else {
        testo.push_str(" Il viewer ha detto:\n");
        for n in &scatto.note {
            testo.push_str("  ");
            testo.push_str(n);
            testo.push('\n');
        }
    }

    json!([
        { "type": "image", "source": {
            "type": "base64", "media_type": "image/png",
            "data": base64::engine::general_purpose::STANDARD.encode(&scatto.png) } },
        { "type": "text", "text": testo },
    ])
}

/// The answer to a snapshot asked by a model that does not read images. In
/// Italian like the prompt: the model reads it.
fn snapshot_refused() -> Value {
    json!({
        "eseguita": false,
        "motivo": "questo modello non vede le immagini: usa `valida` per controllare la pagina",
    })
}

fn risultato(id: &str, contenuto: &Value, errore: bool) -> Value {
    let mut v = json!({
        "type": "tool_result",
        "tool_use_id": id,
        "content": contenuto.to_string(),
    });
    if errore {
        v["is_error"] = Value::Bool(true);
    }
    v
}

/// Il messaggio della persona, con le risposte agli strumenti rimasti aperti.
///
/// `proponi_modifica` chiude il turno senza un `tool_result`: l'esito lo
/// decide la persona, nel browser. Ma l'API rifiuta una conversazione in cui
/// un `tool_use` resta senza risposta, e la domanda successiva tornava «400
/// Bad Request: tool_call_ids did not have response messages» (collaudo della
/// rc.12, 11-11-2026, chiedendo un'altra modifica dopo aver applicato la
/// prima). Le risposte vanno nello stesso messaggio della domanda, prima del
/// testo: due messaggi `user` di fila non tutti i fornitori li accettano.
fn domanda_dopo(messaggi: &[Value], domanda: &str) -> Value {
    let aperti: Vec<&str> = messaggi
        .last()
        .filter(|m| m.get("role").and_then(Value::as_str) == Some("assistant"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use"))
        .filter_map(|b| b.get("id").and_then(Value::as_str))
        .collect();
    if aperti.is_empty() {
        return json!({ "role": "user", "content": domanda });
    }
    let mut blocchi: Vec<Value> = aperti
        .into_iter()
        .map(|id| {
            json!({
                "type": "tool_result", "tool_use_id": id,
                "content": "La proposta è andata alla persona, che l'ha applicata o scartata. \
                            Il progetto di adesso si rilegge con gli strumenti.",
            })
        })
        .collect();
    blocchi.push(json!({ "type": "text", "text": domanda }));
    json!({ "role": "user", "content": blocchi })
}

enum Proposta {
    Inviata,
    /// La validazione ha trovato errori nuovi: tornano al modello.
    Correggi(Value),
}

/// Valida la proposta e, se regge, la manda al browser.
async fn proponi(
    s: &AppState,
    tx: &mpsc::UnboundedSender<String>,
    input: &Value,
    impronta_iniziale: Option<&str>,
    correzioni: usize,
    banco: &Banco,
) -> Proposta {
    let bozze = banco.simboli.as_slice();
    // `valida_interna` e non `valida`: quello che si spedisce al browser deve
    // essere il progetto **ricomposto**, cioè quello che è stato davvero
    // validato. Con il grezzo, una proposta che ometteva `functions` passava la
    // validazione e arrivava all'editor senza funzioni: il Salva le cancellava.
    let (giudizio, normalizzato) =
        tools::valida_interna(s, input, bozze, &banco.free_symbols, true)
            .await
            .unwrap_or_else(|e| {
                (
                    json!({ "ok": false, "errori_nuovi": 1,
                                     "rilievi": [{ "severity": "error", "path": "proposta",
                                                   "message": e }] }),
                    None,
                )
            });
    let ok = giudizio.get("ok").and_then(Value::as_bool).unwrap_or(false);

    if !ok && correzioni < MAX_CORREZIONI {
        return Proposta::Correggi(json!({
            "inviata": false,
            "motivo": "la proposta ha errori: correggili e richiama proponi_modifica",
            "giudizio": giudizio,
        }));
    }

    if correzioni < MAX_CORREZIONI && tools::changes_nothing(s, input, normalizzato.as_ref()).await
    {
        return Proposta::Correggi(json!({
            "inviata": false,
            "motivo": "la proposta non cambia niente: il progetto che hai mandato è uguale a quello \
                       sul disco, e non ci sono pagine. Le modifiche ai tag vanno DENTRO \
                       `project.tags`, insieme ai tag che ci sono già; quelle alle pagine in \
                       `pages`. Rimandala con la modifica dentro.",
        }));
    }

    // The floor plans whose drawing a proposed page uses: the plans go in
    // `planimetrie/`, the drawings in `images/` next to the generated
    // backgrounds, all at Save.
    let (floor_plans, drawings) = floor_plan_tool::of_proposal(input, &banco.floor_plans);
    let replaced_floor_plans = floor_plan_tool::replaced(s, &floor_plans).await;
    let mut sfondi = strumenti_scopi::sfondi_della_proposta(input, &banco.sfondi);
    if let Some(elenco) = sfondi.as_array_mut() {
        elenco.extend(drawings);
    }
    invia(
        tx,
        json!({
            "t": "proposta",
            "id": uuid_breve(),
            "motivo": input.get("motivo").and_then(Value::as_str).unwrap_or("modifica"),
            "project": normalizzato.as_ref().or_else(|| input.get("project")),
            "pages": input.get("pages"),
            // I faceplate nuovi o cambiati (06-11-2026): il browser li mette fra
            // le pagine-faceplate, e il Salva li scrive in faceplates/.
            "faceplates": input.get("faceplates"),
            "impronta": impronta_iniziale,
            "giudizio": giudizio,
            "simboli": simboli_della_proposta(input, bozze, &banco.free_symbols),
            // Gli sfondi generati che le pagine usano: il browser li scrive in
            // images/ del progetto quando la proposta si applica (F6).
            "sfondi": sfondi,
            "floor_plans": floor_plans,
            // The ones that take the place of a file of the project: the diff
            // marks them as changed, not as new.
            "replaced_floor_plans": replaced_floor_plans,
        }),
    );
    Proposta::Inviata
}

/// The largest open symbol the editor may send with a question: the photos
/// travel as names, so a real one is a few kB.
const OPEN_SYMBOL_MAX_BYTES: usize = 512 * 1024;

/// `leggi_simbolo`: the symbol open in the editor, readable (`geo` as
/// objects), with what the compiler says of it.
fn leggi_simbolo(aperto: Option<&Value>) -> Value {
    let Some(v) = aperto else {
        return json!({ "aperto": false,
                       "motivo": "l'editor non ha mandato il simbolo: chiedi alla persona di riprovare" });
    };
    let d: sws_core::simboli_prj::Descrizione = match serde_json::from_value(v.clone()) {
        Ok(d) => d,
        Err(e) => {
            return json!({ "aperto": true, "simbolo": v, "errori": [format!("descrizione: {e}")] })
        }
    };
    let (errori, parti, bocche) = match sws_core::simboli_prj::compila_e_controlla(&d) {
        Ok(c) => (
            Vec::new(),
            c.voce.get("parts").cloned().unwrap_or(json!([])),
            c.voce.get("ports").cloned().unwrap_or(json!([])),
        ),
        Err(e) => (e, json!([]), json!([])),
    };
    json!({
        "aperto": true,
        "simbolo": symbol_draw::readable(&d),
        "errori": errori,
        "parti": parti,
        "bocche": bocche,
    })
}

/// `proponi_simbolo`: a draft of this conversation, compiled, to the editor
/// with «Apply». An error goes back to the model.
fn proponi_simbolo(
    tx: &mpsc::UnboundedSender<String>,
    input: &Value,
    banco: &Banco,
) -> Result<(), String> {
    let slug = input.get("slug").and_then(Value::as_str).map(str::trim);
    let d = match slug.filter(|s| !s.is_empty()) {
        Some(s) => banco.simboli.iter().find(|d| d.slug == s),
        None => banco.simboli.last(),
    }
    .ok_or("nessuna bozza da proporre: disegnala prima con disegna_simbolo o bozza_simbolo")?;
    let c = sws_core::simboli_prj::compila_e_controlla(d)
        .map_err(|e| format!("la bozza non compila: {}", e.join("; ")))?;
    invia(
        tx,
        json!({
            "t": "proposta_simbolo",
            "id": uuid_breve(),
            "motivo": input.get("motivo").and_then(Value::as_str).unwrap_or("modifica"),
            "simbolo": d,
            "svg": c.svg,
        }),
    );
    Ok(())
}

/// I simboli che la proposta porta nel progetto, compilati: la chat ne mostra
/// la miniatura nel diff senza dover chiedere niente al server.
fn simboli_della_proposta(
    input: &Value,
    bozze: &[sws_core::simboli_prj::Descrizione],
    free: &[free_symbol_tool::FreeSymbolDraft],
) -> Value {
    let pagine: Vec<Value> = input
        .get("pages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let usate = tools::bozze_da_portare(input, &pagine, bozze, true).unwrap_or_default();
    Value::Array(
        usate
            .iter()
            .filter_map(|d| {
                let c = sws_core::simboli_prj::compila_e_controlla(d).ok()?;
                Some(
                    json!({ "slug": d.slug, "it": d.it, "en": d.en, "svg": c.svg, "voce": c.voce }),
                )
            })
            // The ones drawn as free SVG: custom symbols, no manifest entry.
            .chain(free_symbol_tool::of_proposal(input, free))
            .collect(),
    )
}

/// Le bozze di simbolo della conversazione: disegnate con `bozza_simbolo`,
/// viste da `valida` e `istantanea_pagina`, portate nel progetto da
/// `proponi_modifica`. Vivono quanto la conversazione, non quanto il socket
/// (10-11-2026): vedi `conversazioni`.
#[derive(Default)]
pub(crate) struct Banco {
    pub simboli: Vec<sws_core::simboli_prj::Descrizione>,
    /// Gli sfondi generati in questa conversazione, basi e varianti (F6).
    pub sfondi: Vec<immagini::Sfondo>,
    /// Quanto è costata la generazione degli sfondi (stima), per il loro tetto.
    pub spesa_sfondi: f64,
    /// Quanto è costato il modello dei simboli, per il tetto del suo scopo.
    pub spesa_simboli: f64,
    /// The floor plans drawn in this conversation (`floor_plan` tool, G2).
    pub floor_plans: Vec<floor_plan_tool::FloorPlanDraft>,
    /// The symbols drawn as free SVG in this conversation (`bozza_simbolo`
    /// with `svg`, G3): custom symbols with ports, not descriptions.
    pub free_symbols: Vec<free_symbol_tool::FreeSymbolDraft>,
    /// The symbol open in the symbol editor, as the last question brought it
    /// (`scope=symbol`): what `leggi_simbolo` answers and what
    /// `disegna_simbolo` changes with `dal_simbolo_aperto`.
    pub simbolo_aperto: Option<Value>,
}

impl Banco {
    /// Una bozza nuova, o al posto di quella con lo stesso slug.
    pub(crate) fn metti(&mut self, d: sws_core::simboli_prj::Descrizione) {
        // One draft per slug, whatever the way it is drawn: redrawing a free
        // SVG as a description takes the free one away.
        self.free_symbols.retain(|x| x.slug() != d.slug);
        match self.simboli.iter().position(|x| x.slug == d.slug) {
            Some(i) => self.simboli[i] = d,
            None => self.simboli.push(d),
        }
    }

    /// A new free-SVG draft, or in place of the one with the same slug.
    pub(crate) fn put_free_symbol(&mut self, d: free_symbol_tool::FreeSymbolDraft) {
        self.simboli.retain(|x| x.slug != d.slug());
        match self.free_symbols.iter().position(|x| x.slug() == d.slug()) {
            Some(i) => self.free_symbols[i] = d,
            None => self.free_symbols.push(d),
        }
    }

    /// There are symbol drafts, of either kind.
    pub(crate) fn has_symbol_drafts(&self) -> bool {
        !self.simboli.is_empty() || !self.free_symbols.is_empty()
    }
}

/// Chiude la riga di uno strumento che il giro non esegue e rimanda al turno
/// dopo. Senza, la chat lo mostrava per sempre con il pallino vivo e «scrivo ·
/// 13 kB», come se stesse ancora lavorando (banco dei tubi, 12-11-2026).
fn rimanda(tx: &mpsc::UnboundedSender<String>, nome: &str, perche: &str) {
    invia(
        tx,
        json!({ "t": "strumento", "nome": nome, "stato": "fatto", "messaggio": perche }),
    );
}

/// `bozza_simbolo`: compila, mette sul banco, e manda la miniatura alla chat.
fn bozza(
    tx: &mpsc::UnboundedSender<String>,
    banco: &mut Banco,
    input: &Value,
) -> Result<Value, String> {
    // The second way (G3): an SVG with its size and ports, not a description.
    if free_symbol_tool::is_free(input) {
        return match free_symbol_tool::draft(input) {
            Ok(d) => {
                invia(tx, free_symbol_tool::chat_frame(&d));
                let result = free_symbol_tool::result(&d);
                banco.put_free_symbol(d);
                Ok(result)
            }
            Err(errors) => Err(json!({ "ok": false, "errors": errors,
                "note": "fix the SVG and call bozza_simbolo again with the same slug" })
            .to_string()),
        };
    }
    match tools::compila_bozza(input) {
        Ok((d, c)) => {
            invia(
                tx,
                json!({ "t": "simbolo", "slug": d.slug, "it": d.it, "en": d.en, "svg": c.svg }),
            );
            let esito = tools::esito_bozza(&c);
            banco.metti(d);
            Ok(esito)
        }
        Err(errori) => Err(json!({ "ok": false, "errori": errori,
                                   "nota": "correggi e richiama bozza_simbolo con lo stesso slug" })
        .to_string()),
    }
}

/// Una pagina con tutte le bozze in fila, ognuna col suo nome sotto: è quello
/// che `istantanea_pagina` fotografa quando il modello vuole guardare i
/// simboli che ha disegnato.
fn tavola_delle_bozze(
    bozze: &[sws_core::simboli_prj::Descrizione],
    free: &[free_symbol_tool::FreeSymbolDraft],
) -> Value {
    const COLONNE: usize = 5;
    const CELLA_W: f64 = 250.0;
    const CELLA_H: f64 = 230.0;
    const DISEGNO: f64 = 170.0;
    // Every draft: its id in a page, its slug, the size of its drawing. The
    // ones drawn as free SVG come after the compiled ones.
    let drafts: Vec<(String, &str, f64, f64)> = bozze
        .iter()
        .map(|d| {
            (
                format!("prj:{}", d.slug),
                d.slug.as_str(),
                d.w as f64,
                d.h as f64,
            )
        })
        .chain(free.iter().map(|d| {
            let [w, h] = d.symbol.view_box.unwrap_or([100.0, 100.0]);
            (d.symbol.symbol_id(), d.slug(), w, h)
        }))
        .collect();
    let mut oggetti = Vec::new();
    for (i, (symbol_id, slug, dw, dh)) in drafts.iter().enumerate() {
        let (col, riga) = ((i % COLONNE) as f64, (i / COLONNE) as f64);
        let scala = DISEGNO / dw.max(*dh);
        let (w, h) = ((dw * scala).round(), (dh * scala).round());
        let x0 = 15.0 + col * CELLA_W;
        let y0 = 20.0 + riga * CELLA_H;
        oggetti.push(json!({ "id": format!("s{i}"), "type": "symbol", "symbol_id": symbol_id,
            "x": x0 + (CELLA_W - w) / 2.0, "y": y0 + (DISEGNO - h) / 2.0, "width": w, "height": h }));
        oggetti.push(json!({ "id": format!("t{i}"), "type": "text", "text": slug,
            "x": x0, "y": y0 + DISEGNO + 8.0, "width": CELLA_W, "height": 24, "font_size": 15,
            "text_anchor": "middle", "color": "#1e293b" }));
    }
    let righe = drafts.len().div_ceil(COLONNE).max(1) as f64;
    json!({ "id": "tavola-bozze", "name": "Tavola delle bozze", "width": 1280,
            "height": (40.0 + righe * CELLA_H) as i64, "background": "#e2e8f0",
            "cornice": null, "objects": oggetti })
}

pub(crate) fn uuid_breve() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("p{:x}", n & 0xffff_ffff)
}

// ─────────────────────────────────────────────────────────────────────────────
// L'agente finto
// ─────────────────────────────────────────────────────────────────────────────

/// `SWS_AI_FAKE=<file.json>` rigioca una traccia registrata invece di chiamare
/// il modello.
///
/// Non è un ripiego per la mancanza della chiave. Serve perché il pannello, il
/// diff, la transazione e Ctrl+Z vanno provati **deterministicamente**: il
/// modello vero risponde diverso ogni volta, e un test che dipende da lui non
/// è un test. Gli strumenti però sono quelli veri — la traccia dice *cosa*
/// chiamare, non cosa risponde.
async fn finto_giro(
    s: &AppState,
    tx: &mpsc::UnboundedSender<String>,
    percorso: &str,
    banco: &mut Banco,
) -> Result<(), String> {
    let testo =
        std::fs::read_to_string(percorso).map_err(|e| format!("copione {percorso}: {e}"))?;
    let copione: Value =
        serde_json::from_str(&testo).map_err(|e| format!("copione {percorso} non è JSON: {e}"))?;
    let turni = copione
        .get("turni")
        .and_then(Value::as_array)
        .ok_or("il copione deve avere `turni`")?;
    let impronta_iniziale = impronta(s).await;

    for turno in turni {
        if let Some(t) = turno.get("testo").and_then(Value::as_str) {
            // A pezzi, come farebbe lo streaming: il pannello va provato con
            // il comportamento vero, non con una riga sola che appare intera.
            for pezzo in t.split_inclusive(' ') {
                invia(tx, json!({ "t": "testo", "delta": pezzo }));
                tokio::time::sleep(std::time::Duration::from_millis(12)).await;
            }
        }
        for st in turno
            .get("strumenti")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let nome = st.get("nome").and_then(Value::as_str).unwrap_or("");
            let input = st.get("input").cloned().unwrap_or(json!({}));
            // The symbol editor's proposal (23-11-2026): it ends the turn, as
            // in the real round.
            if nome == "proponi_simbolo" {
                return proponi_simbolo(tx, &input, banco)
                    .map_err(|e| format!("il copione propone un simbolo che non va: {e}"));
            }
            if nome == "proponi_modifica" {
                // Il copione descrive la modifica come **toppa**, non come
                // progetto intero: il progetto intero dipende da quale progetto
                // è aperto, e un copione che lo cablasse varrebbe per un
                // progetto solo. La toppa la compone qui il finto, che è
                // esattamente il lavoro che nel giro vero fa il modello.
                let input = match input.get("patch") {
                    Some(patch) => componi_da_patch(s, &input, patch).await?,
                    None => input,
                };
                match proponi(
                    s,
                    tx,
                    &input,
                    impronta_iniziale.as_deref(),
                    MAX_CORREZIONI,
                    banco,
                )
                .await
                {
                    Proposta::Inviata => return Ok(()),
                    Proposta::Correggi(v) => {
                        return Err(format!("il copione propone una modifica non valida: {v}"))
                    }
                }
            }
            invia(
                tx,
                json!({ "t": "strumento", "nome": nome, "stato": "eseguo" }),
            );
            let esito =
                match nome {
                    "fai_domande" => tools::domande(&input).map(|frame| {
                        invia(tx, frame);
                        Value::Null
                    }),
                    "bozza_simbolo" => bozza(tx, banco, &input),
                    "leggi_simbolo" => Ok(leggi_simbolo(banco.simbolo_aperto.as_ref())),
                    // La foto, come nel giro vero: serve all'e2e della chat e a
                    // provare dal vivo la foto dal browser (10-11-2026).
                    "istantanea_pagina" => istantanea_per_il_modello(s, tx, &input, banco)
                        .await
                        .map(|b| {
                            invia(
                                tx,
                                json!({ "t": "immagine", "png": b[0]["source"]["data"],
                                    "testo": b[1]["text"] }),
                            );
                            Value::Null
                        }),
                    "floor_plan" => floor_plan_tool::run(s, tx, banco, &input).await,
                    "valida" => {
                        tools::valida_interna(s, &input, &banco.simboli, &banco.free_symbols, false)
                            .await
                            .map(|(g, _)| g)
                    }
                    _ => tools::esegui(s, nome, &input).await,
                };
            match esito {
                Ok(_) => invia(
                    tx,
                    json!({ "t": "strumento", "nome": nome, "stato": "fatto" }),
                ),
                Err(e) => {
                    invia(
                        tx,
                        json!({ "t": "strumento", "nome": nome, "stato": "errore",
                                      "messaggio": e.clone() }),
                    );
                    return Err(format!("lo strumento `{nome}` del copione è fallito: {e}"));
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        }
    }
    Ok(())
}

/// Compone progetto e pagine interi a partire da una toppa del copione.
///
/// Riconosce tre mosse, che sono quelle del bersaglio di T-50:
/// `sorgenti_aggiunte`, `tag_aggiunti`, `oggetti_aggiunti`
/// (`{pagina, oggetto}`); e dal 03-11-2026 le due del sinottico intero:
/// `tipi_aggiunti` e `pagine_intere` (pagine nuove o rifatte, intere). I
/// simboli no: sono le bozze del banco, che `proponi` porta da sé. Non è un
/// motore di patch generale e non deve diventarlo: se un copione ha bisogno di
/// più di così, il caso è da provare col modello vero.
async fn componi_da_patch(s: &AppState, input: &Value, patch: &Value) -> Result<Value, String> {
    use sws_core::Project;
    let dir = active_dir(s)
        .await
        .map_err(|_| "nessun progetto aperto".to_string())?;
    let mut progetto =
        serde_json::to_value(Project::load(&dir).map_err(|e| format!("progetto: {e:#}"))?)
            .map_err(|e| e.to_string())?;

    if let Some(nuove) = patch.get("sorgenti_aggiunte").and_then(Value::as_array) {
        let elenco = progetto["sources"]
            .as_array_mut()
            .ok_or("il progetto non ha `sources`")?;
        elenco.extend(nuove.iter().cloned());
    }
    if let Some(nuovi) = patch.get("tipi_aggiunti").and_then(Value::as_array) {
        if progetto.get("types").is_none() {
            progetto["types"] = json!([]);
        }
        let elenco = progetto["types"]
            .as_array_mut()
            .ok_or("il progetto ha `types` che non è un elenco")?;
        elenco.extend(nuovi.iter().cloned());
    }
    if let Some(nuovi) = patch.get("tag_aggiunti").and_then(Value::as_array) {
        let elenco = progetto["tags"]
            .as_array_mut()
            .ok_or("il progetto non ha `tags`")?;
        elenco.extend(nuovi.iter().cloned());
    }

    let mut pagine_toccate: Vec<Value> = Vec::new();
    if let Some(agg) = patch.get("oggetti_aggiunti").and_then(Value::as_array) {
        let tutte = tools::carica_pagine(s).await?;
        for voce in agg {
            let nome = voce
                .get("pagina")
                .and_then(Value::as_str)
                .ok_or("ogni voce di `oggetti_aggiunti` vuole `pagina`")?;
            let oggetto = voce
                .get("oggetto")
                .cloned()
                .ok_or("ogni voce di `oggetti_aggiunti` vuole `oggetto`")?;
            // Se la pagina è già fra quelle toccate si continua su quella, così
            // due oggetti sulla stessa pagina non si cancellano a vicenda.
            // Per nome o per id, come `leggi_pagina`: il nome di una pagina dei
            // template è un token (`{{t0069}}`), e il modello usa l'id.
            let gia = pagine_toccate.iter().position(|p| {
                p.get("name").and_then(Value::as_str) == Some(nome)
                    || p.get("id").and_then(Value::as_str) == Some(nome)
            });
            let mut pagina = match gia {
                Some(i) => pagine_toccate.remove(i),
                None => {
                    let p = tutte
                        .iter()
                        .find(|p| p.name == nome)
                        .or_else(|| tutte.iter().find(|p| p.id == nome))
                        .ok_or_else(|| format!("la pagina `{nome}` non esiste"))?;
                    serde_json::to_value(p).map_err(|e| e.to_string())?
                }
            };
            pagina["objects"]
                .as_array_mut()
                .ok_or("la pagina non ha `objects`")?
                .push(oggetto);
            pagine_toccate.push(pagina);
        }
    }

    if let Some(intere) = patch.get("pagine_intere").and_then(Value::as_array) {
        pagine_toccate.extend(intere.iter().cloned());
    }

    let mut out = json!({ "motivo": input.get("motivo").cloned().unwrap_or(json!("modifica")) });
    out["project"] = progetto;
    if let Some(simboli) = input.get("simboli") {
        out["simboli"] = simboli.clone();
    }
    if !pagine_toccate.is_empty() {
        out["pages"] = Value::Array(pagine_toccate);
    }
    Ok(out)
}

/// I blocchi che l'istantanea consegna al modello: l'unica parte di quel
/// percorso provabile senza un modello e senza far girare LVGL.
#[cfg(test)]
mod tests_domanda_dopo {
    use super::*;

    #[test]
    fn dopo_una_proposta_la_domanda_chiude_gli_strumenti_aperti() {
        let messaggi = vec![
            json!({ "role": "user", "content": "trasforma la pagina" }),
            json!({ "role": "assistant", "content": [
                { "type": "text", "text": "Propongo" },
                { "type": "tool_use", "id": "proponi_modifica:10", "name": "proponi_modifica", "input": {} },
            ]}),
        ];
        let m = domanda_dopo(&messaggi, "ora gli sfondi");
        let blocchi = m["content"].as_array().unwrap();
        assert_eq!(blocchi.len(), 2);
        assert_eq!(blocchi[0]["type"], "tool_result");
        assert_eq!(blocchi[0]["tool_use_id"], "proponi_modifica:10");
        assert_eq!(
            blocchi[1],
            json!({ "type": "text", "text": "ora gli sfondi" })
        );
    }

    #[test]
    fn senza_strumenti_aperti_la_domanda_resta_testo() {
        let messaggi =
            vec![json!({ "role": "assistant", "content": [{ "type": "text", "text": "Fatto" }] })];
        assert_eq!(
            domanda_dopo(&messaggi, "ciao"),
            json!({ "role": "user", "content": "ciao" })
        );
        assert_eq!(
            domanda_dopo(&[], "ciao"),
            json!({ "role": "user", "content": "ciao" })
        );
    }
}

#[cfg(test)]
mod tests_istantanea {
    use super::*;

    fn scatto(note: Vec<String>) -> crate::istantanea::Scatto {
        crate::istantanea::Scatto {
            png: vec![0x89, b'P', b'N', b'G', 1, 2, 3, 4],
            larghezza: 480,
            altezza: 272,
            note,
        }
    }

    #[test]
    fn il_blocco_immagine_ha_la_forma_che_l_api_pretende() {
        use base64::Engine as _;
        let b = blocchi_istantanea(&scatto(vec![]));
        let img = &b[0];
        assert_eq!(img["type"], "image");
        assert_eq!(img["source"]["type"], "base64");
        assert_eq!(img["source"]["media_type"], "image/png");
        // Il base64 deve tornare indietro identico: un'immagine che si decodifica
        // in qualcosa d'altro il modello la riceve come rumore.
        let dati = img["source"]["data"].as_str().unwrap();
        let tornati = base64::engine::general_purpose::STANDARD
            .decode(dati)
            .unwrap();
        assert_eq!(tornati, scatto(vec![]).png);
    }

    #[test]
    fn il_testo_dice_le_dimensioni_e_cosa_ha_detto_il_viewer() {
        let b = blocchi_istantanea(&scatto(vec![
            "comando prodotto: scrivere Bool(true) su 'demo.cmd'".into(),
        ]));
        let t = b[1]["text"].as_str().unwrap();
        assert_eq!(b[1]["type"], "text");
        assert!(t.contains("480x272"), "{t}");
        assert!(t.contains("comando prodotto"), "{t}");
    }

    /// Il silenzio va dichiarato: un modello che ha chiesto dei tocchi deve
    /// poter distinguere «non hanno prodotto comandi» da «non te lo diciamo».
    #[test]
    fn senza_note_lo_dice_invece_di_tacere() {
        let b = blocchi_istantanea(&scatto(vec![]));
        let t = b[1]["text"].as_str().unwrap();
        assert!(t.contains("non ha segnalato nulla"), "{t}");
    }

    /// Il motore del progetto decide chi fotografa (10-11-2026): un progetto
    /// web chiede la foto all'IDE, uno LVGL resta sul viewer e all'IDE non
    /// chiede niente.
    #[tokio::test]
    async fn web_chiede_all_ide_lvgl_resta_sul_viewer() {
        for (target, web) in [("", true), ("target:\n  kind: lvgl_wayland\n", false)] {
            let d = tempfile::tempdir().unwrap();
            std::fs::write(
                d.path().join("project.yaml"),
                format!("meta:\n  name: m\n  version: \"1\"\ntags: []\nsources: []\n{target}"),
            )
            .unwrap();
            std::fs::create_dir_all(d.path().join("synoptics")).unwrap();
            std::fs::write(
                d.path().join("synoptics/P.yaml"),
                "id: p\nname: P\nwidth: 320\nheight: 200\nobjects: []\n",
            )
            .unwrap();
            let s = crate::router::stato_di_prova(d.path()).await;
            *s.project_dir.write().await = Some(d.path().to_path_buf());
            let (tx, mut rx) = mpsc::unbounded_channel::<String>();
            let ide = foto_ide::Ide::nuovo(tx.clone());
            // Nessuno risponde: il web scade, il LVGL va per la sua strada
            // (riesce, o fallisce perché il viewer non è compilato).
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(3),
                foto_ide::IDE.scope(
                    ide,
                    istantanea_per_il_modello(&s, &tx, &json!({ "nome": "P" }), &Banco::default()),
                ),
            )
            .await;
            let mut chiesta = false;
            while let Ok(m) = rx.try_recv() {
                chiesta |= m.contains("\"fotografa\"");
            }
            assert_eq!(chiesta, web, "target {target:?}");
        }
    }
}

#[cfg(test)]
mod tests_bozze {
    use serde_json::{json, Value};

    fn bozza_di_prova(slug: &str) -> sws_core::simboli_prj::Descrizione {
        let mut v: Value = serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/simboli-prj/gabbia-laminazione.json"
        ))
        .unwrap();
        v["slug"] = json!(slug);
        serde_json::from_value(v).unwrap()
    }

    /// Ridisegnare una bozza la sostituisce: due «gabbia» sul banco
    /// sarebbero due simboli con lo stesso id.
    #[test]
    fn il_banco_tiene_una_bozza_per_slug() {
        let mut b = super::Banco::default();
        b.metti(bozza_di_prova("gabbia"));
        b.metti(bozza_di_prova("rulliera"));
        let mut nuova = bozza_di_prova("gabbia");
        nuova.it = "Gabbia rifatta".into();
        b.metti(nuova);
        assert_eq!(b.simboli.len(), 2);
        assert_eq!(b.simboli[0].it, "Gabbia rifatta");
    }

    /// `bozza_simbolo` manda la miniatura alla chat e risponde al modello con
    /// l'id da usare; se sbaglia, gli errori tornano a lui e il banco non cambia.
    #[test]
    fn una_bozza_va_sul_banco_e_in_chat() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut b = super::Banco::default();
        let ok = super::bozza(
            &tx,
            &mut b,
            &json!({ "descrizione": bozza_di_prova("gabbia") }),
        )
        .unwrap();
        assert_eq!(ok["symbol_id"], "prj:gabbia");
        let frame: Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
        assert_eq!(frame["t"], "simbolo");
        assert!(frame["svg"].as_str().unwrap().starts_with("<svg"));
        assert_eq!(b.simboli.len(), 1);
        let male =
            super::bozza(&tx, &mut b, &json!({ "descrizione": { "slug": "rotta" } })).unwrap_err();
        assert!(male.contains("errori"), "{male}");
        assert_eq!(b.simboli.len(), 1);
    }

    /// The symbol editor's chat (23-11-2026): `leggi_simbolo` gives the open
    /// symbol readable, with parts and ports; without one it says so.
    #[test]
    fn the_open_symbol_is_read_with_its_parts() {
        let aperto = serde_json::to_value(bozza_di_prova("gabbia")).unwrap();
        let r = super::leggi_simbolo(Some(&aperto));
        assert_eq!(r["aperto"], true);
        assert_eq!(r["simbolo"]["slug"], "gabbia");
        assert!(r["errori"].as_array().unwrap().is_empty());
        assert!(!r["bocche"].as_array().unwrap().is_empty());
        assert_eq!(super::leggi_simbolo(None)["aperto"], false);
    }

    /// `proponi_simbolo` sends the draft to the editor, compiled; with no
    /// draft the model is told to draw first.
    #[test]
    fn a_draft_is_proposed_to_the_symbol_editor() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut b = super::Banco::default();
        let nulla = super::proponi_simbolo(&tx, &json!({ "motivo": "x" }), &b).unwrap_err();
        assert!(nulla.contains("disegnala prima"), "{nulla}");
        b.metti(bozza_di_prova("gabbia"));
        b.metti(bozza_di_prova("rulliera"));
        super::proponi_simbolo(
            &tx,
            &json!({ "motivo": "più grande", "slug": "gabbia" }),
            &b,
        )
        .unwrap();
        let frame: Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
        assert_eq!(frame["t"], "proposta_simbolo");
        assert_eq!(frame["motivo"], "più grande");
        assert_eq!(frame["simbolo"]["slug"], "gabbia");
        assert!(frame["svg"].as_str().unwrap().starts_with("<svg"));
        // No slug: the last one drawn.
        super::proponi_simbolo(&tx, &json!({ "motivo": "y" }), &b).unwrap();
        let frame: Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
        assert_eq!(frame["simbolo"]["slug"], "rulliera");
    }

    /// La tavola delle bozze: un simbolo e il suo nome per bozza, nelle
    /// proporzioni del disegno, dentro la pagina.
    #[test]
    fn la_tavola_mette_ogni_bozza_al_suo_posto() {
        let bozze: Vec<_> = (0..7)
            .map(|i| bozza_di_prova(&format!("bozza-{i}")))
            .collect();
        let t = super::tavola_delle_bozze(&bozze, &[]);
        let oggetti = t["objects"].as_array().unwrap();
        assert_eq!(oggetti.len(), 14);
        let h = t["height"].as_f64().unwrap();
        for o in oggetti.iter().filter(|o| o["type"] == "symbol") {
            let (w, hh) = (o["width"].as_f64().unwrap(), o["height"].as_f64().unwrap());
            assert!(
                (w / hh - 1.2).abs() < 0.02,
                "proporzioni del disegno 120×100: {w}×{hh}"
            );
            assert!(o["x"].as_f64().unwrap() + w <= 1280.0 && o["y"].as_f64().unwrap() + hh <= h);
        }
        assert!(
            t.get("cornice").is_some_and(Value::is_null),
            "senza cornice"
        );
    }
}

#[cfg(test)]
mod tests_no_snapshot {
    use super::*;

    pub(super) type Seen = std::sync::Arc<std::sync::Mutex<Vec<Value>>>;

    /// A local server that answers the first request with a call to
    /// `istantanea_pagina` (a model that read it in the prompt) and the
    /// second with a closing question (a statement would be asked to act,
    /// see `ANNOUNCED_NUDGE`).
    async fn fake_local() -> (String, Seen) {
        const CALL: &str = "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_s1\",\"type\":\"function\",\"function\":{\"name\":\"istantanea_pagina\",\"arguments\":\"{}\"}}]},\"finish_reason\":null}]}\n\n\
             data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5}}\n\n\
             data: [DONE]\n\n";
        const DONE: &str = "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Fatto: altro?\"},\"finish_reason\":null}]}\n\n\
             data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":2}}\n\n\
             data: [DONE]\n\n";
        fake_local_seq(&[CALL, DONE]).await
    }

    /// A local server that gives the answers in order, one per request (the
    /// last one again when they are over), and keeps the requests.
    pub(super) async fn fake_local_seq(answers: &'static [&'static str]) -> (String, Seen) {
        use axum::http::header;
        let seen: Seen = Default::default();
        let seen2 = seen.clone();
        let app = axum::Router::new().route(
            "/v1/chat/completions",
            axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
                let seen = seen2.clone();
                async move {
                    let mut s = seen.lock().unwrap();
                    s.push(body);
                    let answer = answers[(s.len() - 1).min(answers.len() - 1)];
                    ([(header::CONTENT_TYPE, "text/event-stream")], answer)
                }
            }),
        );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        (format!("http://{addr}/v1/chat/completions"), seen)
    }

    /// A model that does not read images: the snapshot is not among its
    /// tools, the prompt says so, and when it calls it all the same the
    /// answer is a text that sends it to `valida`, with no image.
    #[tokio::test]
    async fn a_model_without_images_gets_no_snapshot() {
        let d = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(d.path()).await;
        let (url, seen) = fake_local().await;
        let scelta = client::Scelta {
            fornitore: client::Fornitore::Local,
            chiave: "local".into(),
            source: client::KeySource::Project,
            modello: "qwen3:1.7b".into(),
            tetto_usd: 10.0,
            endpoint: Some(url),
            sees_images: false,
        };
        let ctx = strumenti_scopi::Contesto::da_con(
            d.path(),
            &client::UserKeys::default(),
            false,
            Some(&scelta),
        );
        assert!(ctx.opzioni.no_snapshot);
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut messaggi = vec![json!({ "role": "user", "content": "Com'è la pagina?" })];
        let mut misure = Misure::nuove();
        let mut banco = Banco::default();
        vero_giro(
            &s,
            &tx,
            &scelta,
            &ctx,
            &mut messaggi,
            &mut misure,
            &mut banco,
        )
        .await
        .unwrap();

        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen.len(), 2);
        let tools: Vec<&str> = seen[0]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|t| t["function"]["name"].as_str())
            .collect();
        assert!(tools.contains(&"valida"));
        assert!(!tools.contains(&"istantanea_pagina"), "{tools:?}");
        assert!(seen[0]["messages"][0]["content"]
            .to_string()
            .contains("Niente istantanee"));
        // The answer to the call: a text, no image.
        let tool_msg = seen[1]["messages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["role"] == "tool")
            .expect("the call has its answer")
            .to_string();
        assert!(tool_msg.contains("non vede le immagini"), "{tool_msg}");
        assert!(tool_msg.contains("valida"), "{tool_msg}");
        assert!(!seen[1].to_string().contains("image_url"));
        // The panel hears which provider: a local model shows no cost.
        drop(tx);
        let mut provider = None;
        while let Some(m) = rx.recv().await {
            let v: Value = serde_json::from_str(&m).unwrap();
            if v["t"] == "risorse" {
                provider = Some(v["fornitore"].clone());
            }
        }
        assert_eq!(provider, Some(json!("local")));
    }
}

#[cfg(test)]
mod tests_silent_turn {
    use super::tests_no_snapshot::fake_local_seq;
    use super::*;

    /// Three tools in parallel, as qwen3.5:9b did on 17-11-2026.
    const TOOLS: &str = "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Guardo la pagina.\",\"tool_calls\":[{\"index\":0,\"id\":\"call_a\",\"type\":\"function\",\"function\":{\"name\":\"elenca_pagine\",\"arguments\":\"{}\"}},{\"index\":1,\"id\":\"call_b\",\"type\":\"function\",\"function\":{\"name\":\"elenca_tag\",\"arguments\":\"{}\"}}]},\"finish_reason\":null}]}\n\n\
         data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5}}\n\n\
         data: [DONE]\n\n";
    /// Reasoning only (Ollama's `reasoning`), then the end of the turn.
    const SILENT: &str = "data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning\":\"ora aggiungo il LED\"},\"finish_reason\":null}]}\n\n\
         data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"  \"},\"finish_reason\":null}]}\n\n\
         data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":156}}\n\n\
         data: [DONE]\n\n";
    const TEXT: &str = "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Quale tag uso?\"},\"finish_reason\":null}]}\n\n\
         data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":30,\"completion_tokens\":4}}\n\n\
         data: [DONE]\n\n";

    async fn run(
        answers: &'static [&'static str],
    ) -> (Result<(), TurnError>, Vec<Value>, Vec<Value>, Misure) {
        let d = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(d.path()).await;
        let (url, seen) = fake_local_seq(answers).await;
        let scelta = client::Scelta {
            fornitore: client::Fornitore::Local,
            chiave: "local".into(),
            source: client::KeySource::Project,
            modello: "qwen3.5:9b".into(),
            tetto_usd: 10.0,
            endpoint: Some(url),
            sees_images: false,
        };
        let ctx = strumenti_scopi::Contesto::da_con(
            d.path(),
            &client::UserKeys::default(),
            false,
            Some(&scelta),
        );
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut messaggi = vec![json!({ "role": "user", "content": "Aggiungi un LED" })];
        let mut misure = Misure::nuove();
        let mut banco = Banco::default();
        let r = vero_giro(
            &s,
            &tx,
            &scelta,
            &ctx,
            &mut messaggi,
            &mut misure,
            &mut banco,
        )
        .await;
        let seen = seen.lock().unwrap().clone();
        (r, messaggi, seen, misure)
    }

    /// Tools, a silent end, the nudge, then a text: the turn ends well, the
    /// nudge is in the history, and the extra round is counted.
    #[tokio::test]
    async fn a_silent_end_gets_one_nudge() {
        let (r, messaggi, seen, misure) = run(&[TOOLS, SILENT, TEXT]).await;
        assert!(r.is_ok(), "{:?}", r.err());
        assert_eq!(seen.len(), 3);
        let nudge = messaggi
            .iter()
            .position(|m| m["role"] == "user" && m["content"] == SILENT_NUDGE)
            .expect("the nudge is in the history");
        // The silent answer stays before it, with a text no dialect drops.
        assert_eq!(messaggi[nudge - 1]["role"], "assistant");
        assert_eq!(
            messaggi[nudge - 1]["content"],
            json!([{ "type": "text", "text": "…" }])
        );
        assert_eq!(messaggi.last().unwrap()["role"], "assistant");
        // The provider saw the nudge as the last message of the third request.
        let msgs = seen[2]["messages"].as_array().unwrap();
        let last = msgs.last().unwrap();
        assert_eq!(last["role"], "user");
        assert_eq!(last["content"], SILENT_NUDGE);
        assert_eq!(msgs[msgs.len() - 2]["role"], "assistant");
        assert_eq!(misure.giri.len(), 3);
    }

    /// An announcement after tools («propongo la pagina…») without the call:
    /// asked once to act; a question ends the turn.
    #[tokio::test]
    async fn an_announcement_without_the_call_gets_one_nudge() {
        const ANNOUNCE: &str = "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Propongo la pagina completa.\"},\"finish_reason\":null}]}\n\n\
             data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":5}}\n\n\
             data: [DONE]\n\n";
        let (r, messaggi, seen, _) = run(&[TOOLS, ANNOUNCE, ANNOUNCE, TEXT]).await;
        assert!(r.is_ok(), "{:?}", r.err());
        // Once only: the second announcement ends the turn.
        assert_eq!(seen.len(), 3);
        let nudges = messaggi
            .iter()
            .filter(|m| m["role"] == "user" && m["content"] == ANNOUNCED_NUDGE)
            .count();
        assert_eq!(nudges, 1);
        // A question right after the tools ends the turn at once.
        let (r, _, seen, _) = run(&[TOOLS, TEXT]).await;
        assert!(r.is_ok());
        assert_eq!(seen.len(), 2);
    }

    /// Silent twice in the same turn: a coded error, not a third round.
    #[tokio::test]
    async fn silent_twice_ends_with_a_code() {
        let (r, messaggi, seen, _) = run(&[TOOLS, SILENT, SILENT, TEXT]).await;
        let e = r.expect_err("silent twice is an error");
        let ev = e.event();
        assert_eq!(ev["t"], "errore");
        assert_eq!(ev["codice"]["id"], "model_silent");
        assert_eq!(seen.len(), 3);
        // The history still ends with an assistant: the next question can follow.
        assert_eq!(messaggi.last().unwrap()["role"], "assistant");
    }
}

#[cfg(test)]
mod tests_turn_error {
    use super::*;

    /// Review of 17-11-2026: the chat showed the local model's context error
    /// in English to an Italian IDE. It carries a code now, under any context
    /// the client wrapped it in; the message stays as the fallback.
    #[test]
    fn a_context_too_small_reaches_the_chat_with_its_code() {
        let e = anyhow::Error::new(crate::ai::local_http::ContextTooSmall {
            loaded: 4096,
            needed: 20000,
        })
        .context("answer of local");
        let ev = TurnError::from_anyhow(e).event();
        assert_eq!(ev["t"], "errore");
        assert_eq!(
            ev["codice"],
            json!({ "id": "local_context_too_small", "loaded": 4096, "needed": 20000 })
        );
        assert!(ev["messaggio"].as_str().unwrap().contains("4096"));
        // Any other error: the message alone, as before.
        let ev = TurnError::from("tetto di spesa raggiunto".to_string()).event();
        assert!(ev.get("codice").is_none(), "{ev}");
    }
}
