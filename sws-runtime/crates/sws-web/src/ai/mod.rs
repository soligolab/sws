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
pub mod prompt;
pub mod tools;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::router::{active_dir, calcola_impronta, AppState};
use crate::synoptic_schema as sch;

/// Quanti giri strumento→risultato prima di fermarsi. Un tetto serve: un
/// modello che gira a vuoto brucia contesto e denaro senza dirlo.
const MAX_GIRI: usize = 14;
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

/// `GET /ws/ai` — Admin.
pub async fn ws_ai_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| sessione(socket, s))
}

async fn sessione(socket: WebSocket, s: AppState) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Un inoltratore separato: il ciclo manda eventi da dentro una closure
    // sincrona, che non può await sul socket.
    let inoltro = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            if ws_tx.send(Message::Text(m)).await.is_err() {
                break;
            }
        }
    });

    let finto = std::env::var("SWS_AI_FAKE").ok();
    let scelta = client::carica(&s.config_dir);
    invia(&tx, json!({
        "t": "pronto",
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
    }));

    // La conversazione vive quanto il socket.
    let mut messaggi: Vec<Value> = Vec::new();

    while let Some(Ok(msg)) = ws_rx.next().await {
        let Message::Text(testo) = msg else { continue };
        let Ok(v): Result<Value, _> = serde_json::from_str(&testo) else {
            invia(&tx, json!({ "t": "errore", "messaggio": "messaggio non JSON" }));
            continue;
        };
        if v.get("t").and_then(Value::as_str) != Some("chiedi") {
            continue;
        }
        let domanda = v.get("testo").and_then(Value::as_str).unwrap_or("").to_string();
        if domanda.trim().is_empty() {
            continue;
        }

        messaggi.push(json!({ "role": "user", "content": domanda }));

        let esito = match &finto {
            Some(f) => finto_giro(&s, &tx, f).await,
            None => match &scelta {
                Some(sc) => vero_giro(&s, &tx, sc, &mut messaggi).await,
                None => Err("nessuna chiave API configurata".to_string()),
            },
        };
        if let Err(e) = esito {
            invia(&tx, json!({ "t": "errore", "messaggio": e }));
        }
        invia(&tx, json!({ "t": "fine" }));
    }

    drop(tx);
    let _ = inoltro.await;
}

fn invia(tx: &mpsc::UnboundedSender<String>, v: Value) {
    let _ = tx.send(v.to_string());
}

async fn impronta(s: &AppState) -> Option<String> {
    let dir = active_dir(s).await.ok()?;
    tokio::task::spawn_blocking(move || calcola_impronta(&dir)).await.ok()?.ok()
}

// ─────────────────────────────────────────────────────────────────────────────
// Il ciclo vero
// ─────────────────────────────────────────────────────────────────────────────

async fn vero_giro(
    s: &AppState,
    tx: &mpsc::UnboundedSender<String>,
    scelta: &client::Scelta,
    messaggi: &mut Vec<Value>,
) -> Result<(), String> {
    let cliente = client::Cliente::new(scelta.clone());
    let strumenti = tools::definizioni();
    let sistema = prompt::sistema();
    let impronta_iniziale = impronta(s).await;
    let mut correzioni = 0usize;

    for giro in 0..MAX_GIRI {
        let tx2 = tx.clone();
        let risposta = cliente.turno(sistema.clone(), messaggi, &strumenti, move |e| {
            match e {
                client::Evento::Testo(t) => invia(&tx2, json!({ "t": "testo", "delta": t })),
                client::Evento::Pensiero(t) => invia(&tx2, json!({ "t": "pensiero", "delta": t })),
                client::Evento::StrumentoInizio { nome } =>
                    invia(&tx2, json!({ "t": "strumento", "nome": nome, "stato": "inizio" })),
            }
        }).await.map_err(|e| format!("{e:#}"))?;

        // Il costo del turno nel registro, mai il contenuto.
        tracing::info!(giro, usage = %risposta.usage, stop = %risposta.stop_reason,
                       "turno assistente");

        messaggi.push(json!({ "role": "assistant", "content": risposta.content }));

        let usi = risposta.tool_uses();
        if usi.is_empty() {
            return Ok(());
        }

        // Tutti i risultati in UN solo messaggio utente: spezzarli insegna al
        // modello a non chiamare più strumenti in parallelo.
        let mut risultati: Vec<Value> = Vec::new();
        for (id, nome, input) in usi {
            if nome == "proponi_modifica" {
                match proponi(s, tx, input, impronta_iniziale.as_deref(), correzioni).await {
                    Proposta::Inviata => return Ok(()),
                    Proposta::Correggi(rilievi) => {
                        correzioni += 1;
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
                invia(tx, json!({ "t": "strumento", "nome": nome, "stato": "eseguo" }));
                match istantanea_per_il_modello(s, input).await {
                    Ok(blocchi) => {
                        invia(tx, json!({ "t": "strumento", "nome": nome, "stato": "fatto" }));
                        risultati.push(json!({
                            "type": "tool_result", "tool_use_id": id, "content": blocchi,
                        }));
                    }
                    Err(e) => {
                        invia(tx, json!({ "t": "strumento", "nome": nome, "stato": "errore",
                                          "messaggio": e }));
                        risultati.push(risultato(id, &json!({ "errore": e }), true));
                    }
                }
                continue;
            }
            invia(tx, json!({ "t": "strumento", "nome": nome, "stato": "eseguo" }));
            match tools::esegui(s, nome, input).await {
                Ok(v) => {
                    invia(tx, json!({ "t": "strumento", "nome": nome, "stato": "fatto" }));
                    risultati.push(risultato(id, &v, false));
                }
                Err(e) => {
                    invia(tx, json!({ "t": "strumento", "nome": nome, "stato": "errore",
                                      "messaggio": e }));
                    risultati.push(risultato(id, &json!({ "errore": e }), true));
                }
            }
        }
        messaggi.push(json!({ "role": "user", "content": risultati }));
    }

    Err(format!("l'assistente ha fatto {MAX_GIRI} giri senza concludere: la richiesta \
                 probabilmente va spezzata in due"))
}

/// Scatta e impacchetta per il modello: il blocco immagine più una riga di
/// testo con le dimensioni e quello che il viewer ha detto.
///
/// Il testo accanto all'immagine non è decorazione: un pulsante che apre la
/// finestra giusta e poi scrive il valore sbagliato, **in una fotografia,
/// sembrerebbe funzionare**. Le righe «comando prodotto: …» del viewer sono
/// l'unica prova di cosa il tocco ha fatto davvero.
async fn istantanea_per_il_modello(s: &AppState, input: &Value) -> Result<Value, String> {
    let dir = crate::router::active_dir(s)
        .await
        .map_err(|_| "nessun progetto aperto: non c'è niente da fotografare".to_string())?;
    let scatto = crate::istantanea::scatta(crate::istantanea::Richiesta {
        progetto: dir,
        pagina: input.get("nome").and_then(Value::as_str).map(str::to_string),
        tocca: input.get("tocca").and_then(Value::as_str).map(str::to_string),
        ms: input.get("ms").and_then(Value::as_u64),
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

    let mut testo = format!("Istantanea LVGL: {}x{} px.", scatto.larghezza, scatto.altezza);
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
) -> Proposta {
    // `valida_interna` e non `valida`: quello che si spedisce al browser deve
    // essere il progetto **ricomposto**, cioè quello che è stato davvero
    // validato. Con il grezzo, una proposta che ometteva `functions` passava la
    // validazione e arrivava all'editor senza funzioni: il Salva le cancellava.
    let (giudizio, normalizzato) = tools::valida_interna(s, input).await
        .unwrap_or_else(|e| (json!({ "ok": false, "errori_nuovi": 1,
                                     "rilievi": [{ "severity": "error", "path": "proposta",
                                                   "message": e }] }), None));
    let ok = giudizio.get("ok").and_then(Value::as_bool).unwrap_or(false);

    if !ok && correzioni < MAX_CORREZIONI {
        return Proposta::Correggi(json!({
            "inviata": false,
            "motivo": "la proposta ha errori: correggili e richiama proponi_modifica",
            "giudizio": giudizio,
        }));
    }

    invia(tx, json!({
        "t": "proposta",
        "id": uuid_breve(),
        "motivo": input.get("motivo").and_then(Value::as_str).unwrap_or("modifica"),
        "project": normalizzato.as_ref().or_else(|| input.get("project")),
        "pages": input.get("pages"),
        "impronta": impronta_iniziale,
        "giudizio": giudizio,
    }));
    Proposta::Inviata
}

fn uuid_breve() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
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
) -> Result<(), String> {
    let testo = std::fs::read_to_string(percorso)
        .map_err(|e| format!("copione {percorso}: {e}"))?;
    let copione: Value = serde_json::from_str(&testo)
        .map_err(|e| format!("copione {percorso} non è JSON: {e}"))?;
    let turni = copione.get("turni").and_then(Value::as_array)
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
        for st in turno.get("strumenti").and_then(Value::as_array).into_iter().flatten() {
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
                match proponi(s, tx, &input, impronta_iniziale.as_deref(), MAX_CORREZIONI).await {
                    Proposta::Inviata => return Ok(()),
                    Proposta::Correggi(v) => {
                        return Err(format!("il copione propone una modifica non valida: {v}"))
                    }
                }
            }
            invia(tx, json!({ "t": "strumento", "nome": nome, "stato": "eseguo" }));
            match tools::esegui(s, nome, &input).await {
                Ok(_) => invia(tx, json!({ "t": "strumento", "nome": nome, "stato": "fatto" })),
                Err(e) => {
                    invia(tx, json!({ "t": "strumento", "nome": nome, "stato": "errore",
                                      "messaggio": e.clone() }));
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
/// (`{pagina, oggetto}`). Non è un motore di patch generale e non deve
/// diventarlo: se un copione ha bisogno di più di così, il caso è da provare
/// col modello vero.
async fn componi_da_patch(s: &AppState, input: &Value, patch: &Value) -> Result<Value, String> {
    use sws_core::Project;
    let dir = active_dir(s).await.map_err(|_| "nessun progetto aperto".to_string())?;
    let mut progetto = serde_json::to_value(
        Project::load(&dir).map_err(|e| format!("progetto: {e:#}"))?
    ).map_err(|e| e.to_string())?;

    if let Some(nuove) = patch.get("sorgenti_aggiunte").and_then(Value::as_array) {
        let elenco = progetto["sources"].as_array_mut()
            .ok_or("il progetto non ha `sources`")?;
        elenco.extend(nuove.iter().cloned());
    }
    if let Some(nuovi) = patch.get("tag_aggiunti").and_then(Value::as_array) {
        let elenco = progetto["tags"].as_array_mut().ok_or("il progetto non ha `tags`")?;
        elenco.extend(nuovi.iter().cloned());
    }

    let mut pagine_toccate: Vec<Value> = Vec::new();
    if let Some(agg) = patch.get("oggetti_aggiunti").and_then(Value::as_array) {
        let tutte = tools::carica_pagine(s).await?;
        for voce in agg {
            let nome = voce.get("pagina").and_then(Value::as_str)
                .ok_or("ogni voce di `oggetti_aggiunti` vuole `pagina`")?;
            let oggetto = voce.get("oggetto").cloned()
                .ok_or("ogni voce di `oggetti_aggiunti` vuole `oggetto`")?;
            // Se la pagina è già fra quelle toccate si continua su quella, così
            // due oggetti sulla stessa pagina non si cancellano a vicenda.
            let gia = pagine_toccate.iter().position(|p|
                p.get("name").and_then(Value::as_str) == Some(nome));
            let mut pagina = match gia {
                Some(i) => pagine_toccate.remove(i),
                None => {
                    let p = tutte.iter().find(|p| p.name == nome)
                        .ok_or_else(|| format!("la pagina `{nome}` non esiste"))?;
                    serde_json::to_value(p).map_err(|e| e.to_string())?
                }
            };
            pagina["objects"].as_array_mut()
                .ok_or("la pagina non ha `objects`")?
                .push(oggetto);
            pagine_toccate.push(pagina);
        }
    }

    let mut out = json!({ "motivo": input.get("motivo").cloned().unwrap_or(json!("modifica")) });
    out["project"] = progetto;
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
        let tornati = base64::engine::general_purpose::STANDARD.decode(dati).unwrap();
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
}
