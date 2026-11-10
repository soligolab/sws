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

pub mod client;
pub mod config_api;
mod conversazioni;
mod foto_ide;
pub mod immagini;
pub mod prompt;
pub mod scopi;
mod strumenti_scopi;
pub mod tools;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
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
        _ => &[],
    }
}

/// `GET /ws/ai?conv=<id>` — Admin.
///
/// L'id lega storia, spesa e banco alla conversazione invece che al socket
/// (10-11-2026, vedi `conversazioni`): una finestra che si ricollega ritrova
/// basi, varianti e bozze. Senza id, una conversazione per socket come prima.
pub async fn ws_ai_handler(
    ws: WebSocketUpgrade,
    State(s): State<AppState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let id = q.get("conv").cloned();
    ws.on_upgrade(move |socket| sessione(socket, s, id))
}

async fn sessione(socket: WebSocket, s: AppState, id_conversazione: Option<String>) {
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
    let scelta = client::carica(&s.config_dir);

    // La conversazione: ritrovata se lo stesso id c'era già (riconnessione),
    // nuova altrimenti. `try_lock` perché un socket fantasma a metà turno non
    // deve far aspettare il «pronto»: in quel caso si dice solo che c'era.
    let chiave = conversazioni::chiave(
        id_conversazione.as_deref(),
        active_dir(&s).await.ok().as_deref(),
    );
    let (conv, trovata) = match &chiave {
        Some(k) => conversazioni::tutte()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .prendi(k, std::time::Instant::now()),
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
            // Il pannello deve poter dire «manca la chiave» invece di sembrare rotto.
            "attivo": finto.is_some() || scelta.is_some(),
            "motivo": if finto.is_some() { Value::Null }
                      else if scelta.is_none() {
                          json!(format!("nessuna chiave: metti ANTHROPIC_API_KEY o \
                                         MOONSHOT_API_KEY nell'ambiente, oppure la chiave in {}. \
                                         Con due chiavi vince Anthropic; per l'altro, \
                                         SWS_AI_FORNITORE=kimi",
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
    let ctx = strumenti_scopi::Contesto::da(&s.config_dir);

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
        let conversazioni::Conversazione {
            messaggi,
            misure,
            banco,
        } = &mut *g;
        messaggi.push(json!({ "role": "user", "content": domanda }));

        let esito = match &finto {
            // La foto di un progetto web la chiede l'IDE di QUESTO socket: la
            // conversazione può essere stata ritrovata dopo una riconnessione,
            // ma il browser che risponde è quello collegato adesso.
            Some(f) => {
                foto_ide::IDE
                    .scope(ide.clone(), finto_giro(&s, &tx, f, banco))
                    .await
            }
            None => match &scelta {
                Some(sc) => {
                    let giro = vero_giro(&s, &tx, sc, &ctx, messaggi, misure, banco);
                    let r = foto_ide::IDE.scope(ide.clone(), giro).await;
                    misure.scrivi(sc);
                    r
                }
                None => Err("nessuna chiave API configurata".to_string()),
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
            invia(&tx, json!({ "t": "errore", "messaggio": e }));
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

    pub fn resoconto(&self, scelta: &client::Scelta) -> Value {
        let somma = |c: &str| -> u64 {
            self.giri
                .iter()
                .filter_map(|g| g["usage"].get(c).and_then(Value::as_u64))
                .sum()
        };
        json!({
            "modello": scelta.modello,
            "fornitore": scelta.fornitore.nome(),
            "prezzi_noti": client::prezzi(&scelta.modello).1,
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
    pub fn scrivi(&self, scelta: &client::Scelta) {
        let Some(dir) = std::env::var_os("SWS_AI_MISURE") else {
            return;
        };
        let dir = std::path::PathBuf::from(dir);
        let p = dir.join(format!("{}.json", self.nome));
        let esito = std::fs::create_dir_all(&dir).and_then(|_| {
            std::fs::write(
                &p,
                serde_json::to_string_pretty(&self.resoconto(scelta)).unwrap_or_default(),
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

async fn vero_giro(
    s: &AppState,
    tx: &mpsc::UnboundedSender<String>,
    scelta: &client::Scelta,
    ctx: &strumenti_scopi::Contesto,
    messaggi: &mut Vec<Value>,
    misure: &mut Misure,
    banco: &mut Banco,
) -> Result<(), String> {
    let cliente = client::Cliente::new(scelta.clone());
    let strumenti = tools::definizioni_per(ctx.opzioni);
    let sistema = prompt::sistema_con(regole_del_progetto(s, "assistente").await.as_deref());
    let impronta_iniziale = impronta(s).await;
    let mut correzioni = 0usize;
    // Dopo una bozza di simbolo il giro si ferma e la persona guarda la tavola
    // (prompt, «Quando ti chiedono un sinottico intero», punto 3). Il prompt lo
    // dice due volte, e il 04-11-2026 kimi-k3.1-pro è arrivato lo stesso alla
    // proposta nello stesso turno, senza mai fermarsi: qui lo strumento lo impone.
    let mut bozze_in_questo_turno = false;
    // Lo stesso per gli sfondi: le candidate le sceglie la persona.
    let mut sfondi_in_questo_turno = false;

    let mut giro = 0usize;
    loop {
        let limite = if banco.simboli.is_empty() {
            MAX_GIRI
        } else {
            MAX_GIRI_CON_BOZZE
        };
        if giro >= limite {
            return Err(format!(
                "l'assistente ha fatto {limite} giri senza concludere: la richiesta \
                 probabilmente va spezzata in due"
            ));
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
            ));
        }
        let inizio_giro = std::time::Instant::now();
        let tx2 = tx.clone();
        let risposta = cliente
            .turno(sistema.clone(), messaggi, &strumenti, move |e| match e {
                client::Evento::Testo(t) => invia(&tx2, json!({ "t": "testo", "delta": t })),
                client::Evento::Pensiero(t) => invia(&tx2, json!({ "t": "pensiero", "delta": t })),
                client::Evento::StrumentoInizio { nome } => invia(
                    &tx2,
                    json!({ "t": "strumento", "nome": nome, "stato": "inizio" }),
                ),
            })
            .await
            .map_err(|e| format!("{e:#}"))?;

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
        let costo = client::costo_usd(&scelta.modello, &risposta.usage);
        misure.giro(&risposta.usage, costo, inizio_giro.elapsed().as_secs_f64());
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
            "prezzi_noti": client::prezzi(&scelta.modello).1 }),
        );

        messaggi.push(json!({ "role": "assistant", "content": risposta.content }));

        let usi = risposta.tool_uses();
        if usi.is_empty() {
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
                continue;
            }
            // Le basi aspettano la persona: niente istantanee nello stesso turno.
            // Il 05-11-2026 il modello, invece di fermarsi, ha fotografato tre
            // volte (60 s ciascuna), e per tutto quel tempo «Usa come base» non
            // poteva partire.
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
                continue;
            }
            if nome == "proponi_modifica" {
                match proponi(
                    s,
                    tx,
                    input,
                    impronta_iniziale.as_deref(),
                    correzioni,
                    &banco.simboli,
                    &banco.sfondi,
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
                    strumenti_scopi::varia_sfondi(tx, banco, misure, ctx, scelta.tetto_usd, input)
                        .await
                }
                "valida" => tools::valida_interna(s, input, &banco.simboli, false)
                    .await
                    .map(|(g, _)| g),
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
    } else if nome.is_none() && !banco.simboli.is_empty() {
        let t = tavola_delle_bozze(&banco.simboli);
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
    bozze: &[sws_core::simboli_prj::Descrizione],
    sfondi: &[immagini::Sfondo],
) -> Proposta {
    // `valida_interna` e non `valida`: quello che si spedisce al browser deve
    // essere il progetto **ricomposto**, cioè quello che è stato davvero
    // validato. Con il grezzo, una proposta che ometteva `functions` passava la
    // validazione e arrivava all'editor senza funzioni: il Salva le cancellava.
    let (giudizio, normalizzato) = tools::valida_interna(s, input, bozze, true)
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
            "simboli": simboli_della_proposta(input, bozze),
            // Gli sfondi generati che le pagine usano: il browser li scrive in
            // images/ del progetto quando la proposta si applica (F6).
            "sfondi": strumenti_scopi::sfondi_della_proposta(input, sfondi),
        }),
    );
    Proposta::Inviata
}

/// I simboli che la proposta porta nel progetto, compilati: la chat ne mostra
/// la miniatura nel diff senza dover chiedere niente al server.
fn simboli_della_proposta(input: &Value, bozze: &[sws_core::simboli_prj::Descrizione]) -> Value {
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
}

impl Banco {
    /// Una bozza nuova, o al posto di quella con lo stesso slug.
    pub(crate) fn metti(&mut self, d: sws_core::simboli_prj::Descrizione) {
        match self.simboli.iter().position(|x| x.slug == d.slug) {
            Some(i) => self.simboli[i] = d,
            None => self.simboli.push(d),
        }
    }
}

/// `bozza_simbolo`: compila, mette sul banco, e manda la miniatura alla chat.
fn bozza(
    tx: &mpsc::UnboundedSender<String>,
    banco: &mut Banco,
    input: &Value,
) -> Result<Value, String> {
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
fn tavola_delle_bozze(bozze: &[sws_core::simboli_prj::Descrizione]) -> Value {
    const COLONNE: usize = 5;
    const CELLA_W: f64 = 250.0;
    const CELLA_H: f64 = 230.0;
    const DISEGNO: f64 = 170.0;
    let mut oggetti = Vec::new();
    for (i, d) in bozze.iter().enumerate() {
        let (col, riga) = ((i % COLONNE) as f64, (i / COLONNE) as f64);
        let scala = DISEGNO / (d.w.max(d.h) as f64);
        let (w, h) = ((d.w as f64 * scala).round(), (d.h as f64 * scala).round());
        let x0 = 15.0 + col * CELLA_W;
        let y0 = 20.0 + riga * CELLA_H;
        oggetti.push(json!({ "id": format!("s{i}"), "type": "symbol", "symbol_id": format!("prj:{}", d.slug),
            "x": x0 + (CELLA_W - w) / 2.0, "y": y0 + (DISEGNO - h) / 2.0, "width": w, "height": h }));
        oggetti.push(
            json!({ "id": format!("t{i}"), "type": "text", "text": d.slug,
            "x": x0, "y": y0 + DISEGNO + 8.0, "width": CELLA_W, "height": 24, "font_size": 15,
            "text_anchor": "middle", "color": "#1e293b" }),
        );
    }
    let righe = bozze.len().div_ceil(COLONNE).max(1) as f64;
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
                    &banco.simboli,
                    &banco.sfondi,
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
                    "bozza_simbolo" => bozza(tx, banco, &input),
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
                    "valida" => tools::valida_interna(s, &input, &banco.simboli, false)
                        .await
                        .map(|(g, _)| g),
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

    /// La tavola delle bozze: un simbolo e il suo nome per bozza, nelle
    /// proporzioni del disegno, dentro la pagina.
    #[test]
    fn la_tavola_mette_ogni_bozza_al_suo_posto() {
        let bozze: Vec<_> = (0..7)
            .map(|i| bozza_di_prova(&format!("bozza-{i}")))
            .collect();
        let t = super::tavola_delle_bozze(&bozze);
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
