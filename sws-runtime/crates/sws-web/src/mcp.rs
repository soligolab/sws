//! Il progetto SWS come **server MCP in sola lettura**, su stdio.
//!
//! # Cos'è, e cosa non è
//!
//! Espone a un assistente esterno (`claude` da terminale, o qualunque altro
//! client MCP) gli **undici strumenti di lettura** che la chat dell'IDE usa già:
//! le pagine, il progetto, i tag, gli schemi, il validatore, gli script Python.
//! Niente di più. `tools::SOLA_LETTURA` dice quali sono, e un test tiene
//! quell'elenco allineato a `tools::definizioni()`.
//!
//! **Non scrive.** I due strumenti che restano fuori sono esattamente quelli
//! che fuori dal browser non hanno dove andare — `tools::FUORI_DA_ESEGUI` dice
//! perché, uno per uno. In particolare `proponi_modifica`: tutto il meccanismo
//! di approvazione — il confronto, Applica/Scarta, il controllo dell'impronta,
//! il passo unico di annullamento, le sezioni che aspettano il Salva — vive in
//! TypeScript dentro l'editor. In un terminale non c'è niente di tutto questo,
//! e un canale che scrive senza quella finestra sarebbe un secondo autore del
//! progetto senza nessuno che guarda. Quella è una decisione del maintainer,
//! non una cosa da aggiungere perché il protocollo la permette.
//!
//! # Perché è una modalità del runtime e non un binario a sé
//!
//! `tools::esegui` vuole un `AppState`, e `AppState` nasce da
//! `router::build(...)` con trentacinque argomenti — un `TagDb`, un motore
//! Python vivo, i supervisori delle sorgenti, il progetto aperto. Un secondo
//! binario che se lo costruisse da solo sarebbe una seconda copia di tutto
//! l'avvio, destinata a divergere. `sws-runtime --mcp` invece **avvia
//! esattamente com'è sempre**, apre il progetto come sempre, e al posto dei
//! listener HTTP parla MCP su stdio.
//!
//! # La regola di stdout
//!
//! Su stdio il protocollo **è** stdout: una riga JSON per messaggio. Qualunque
//! altra cosa stampata lì dentro rompe il client. Per questo `--mcp` sposta su
//! stderr lo strato di log di `tracing`, che altrimenti scrive JSON su stdout —
//! e i due JSON sulla stessa riga non si distinguono.

use serde_json::{json, Value};

use crate::ai::tools;
use crate::router::AppState;

/// Le versioni del protocollo che questo server sa parlare. La più recente è
/// la prima: è quella che si risponde a un client che ne chiede una che non
/// conosciamo, come dice la specifica.
const VERSIONI: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

/// Legge richieste da stdin e scrive risposte su stdout, una riga per
/// messaggio, finché stdin non si chiude.
pub async fn servi_stdio(s: AppState) -> anyhow::Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    tracing::info!("server MCP in sola lettura su stdio: {} strumenti", tools::SOLA_LETTURA.len());
    let mut righe = BufReader::new(tokio::io::stdin()).lines();
    let mut out = tokio::io::stdout();
    while let Some(riga) = righe.next_line().await? {
        if riga.trim().is_empty() {
            continue;
        }
        let Some(risposta) = rispondi(&s, &riga).await else {
            continue; // una notifica non vuole risposta
        };
        let mut buf = serde_json::to_vec(&risposta)?;
        buf.push(b'\n');
        out.write_all(&buf).await?;
        out.flush().await?;
    }
    tracing::info!("stdin chiuso: il server MCP esce");
    Ok(())
}

async fn rispondi(s: &AppState, riga: &str) -> Option<Value> {
    let msg: Value = match serde_json::from_str(riga) {
        Ok(v) => v,
        // Senza `id` non si può rispondere a nessuno in particolare: la
        // specifica vuole `id: null`.
        Err(e) => return Some(errore(Value::Null, -32700, &format!("JSON non valido: {e}"))),
    };
    let metodo = msg.get("method").and_then(Value::as_str).unwrap_or("").to_string();
    // Una notifica non ha `id` e non vuole risposta: `notifications/initialized`
    // arriva subito dopo l'handshake, e rispondergli è un errore di protocollo.
    let id = msg.get("id").cloned()?;
    if metodo == "tools/call" {
        return Some(chiama(s, id, msg.get("params")).await);
    }
    Some(senza_stato(&metodo, id, msg.get("params")))
}

/// Tutto ciò a cui si risponde senza toccare il progetto. Separato apposta:
/// è la parte che si può provare senza costruire un `AppState`.
fn senza_stato(metodo: &str, id: Value, params: Option<&Value>) -> Value {
    match metodo {
        "initialize" => {
            let chiesta = params
                .and_then(|p| p.get("protocolVersion"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let versione = if VERSIONI.contains(&chiesta) { chiesta } else { VERSIONI[0] };
            esito(
                id,
                json!({
                    "protocolVersion": versione,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "sws", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Il progetto SWS aperto su questo runtime, in sola lettura. \
                                     Comincia da `elenca_pagine`. Nessuno strumento scrive: per \
                                     cambiare il progetto si passa dalla chat dell'IDE, che ha il \
                                     confronto e l'annullamento."
                }),
            )
        }
        "ping" => esito(id, json!({})),
        "tools/list" => esito(id, json!({ "tools": elenco() })),
        altro => errore(id, -32601, &format!("metodo sconosciuto: `{altro}`")),
    }
}

/// Le definizioni di sola lettura nella forma che MCP vuole.
///
/// L'unica differenza con quelle che si danno al modello dentro l'IDE è il nome
/// del campo dello schema: `input_schema` per l'API dei messaggi di Anthropic,
/// `inputSchema` per MCP. Lo schema dentro è lo stesso JSON Schema.
fn elenco() -> Vec<Value> {
    tools::definizioni_sola_lettura()
        .into_iter()
        .map(|mut d| {
            let schema = d
                .as_object_mut()
                .and_then(|o| o.remove("input_schema"))
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
            if let Some(o) = d.as_object_mut() {
                o.insert("inputSchema".into(), schema);
            }
            d
        })
        .collect()
}

async fn chiama(s: &AppState, id: Value, params: Option<&Value>) -> Value {
    let nome = params.and_then(|p| p.get("name")).and_then(Value::as_str).unwrap_or("");
    if !tools::SOLA_LETTURA.contains(&nome) {
        // Nome sconosciuto o strumento non esposto: è un errore di protocollo
        // (parametri sbagliati), non il risultato di uno strumento.
        return errore(id, -32602, &motivo_non_esposto(nome));
    }
    let input = params
        .and_then(|p| p.get("arguments"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    // Un errore dello strumento NON è un errore JSON-RPC: torna nel risultato
    // con `isError`, così il modello lo legge e può correggersi — la stessa
    // scelta che `Esito` fa già verso il modello dentro l'IDE.
    match tools::esegui(s, nome, &input).await {
        Ok(v) => esito(id, contenuto(&testo(&v), false)),
        Err(e) => esito(id, contenuto(&e, true)),
    }
}

/// Perché quel nome non si può chiamare. Uno strumento che esiste ma sta fuori
/// apposta merita di dirlo, invece di farsi passare per un errore di battitura.
fn motivo_non_esposto(nome: &str) -> String {
    if tools::FUORI_DA_ESEGUI.contains(&nome) {
        format!(
            "`{nome}` esiste ma questo server non lo espone: è in sola lettura, e quello strumento \
             vive solo dentro l'editor. Gli strumenti disponibili sono in `tools/list`."
        )
    } else {
        format!("strumento sconosciuto: `{nome}`")
    }
}

fn contenuto(testo: &str, male: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": testo }], "isError": male })
}

/// Il risultato di uno strumento come testo. JSON indentato: è quello che il
/// client mostra, e un oggetto su una riga sola non si legge.
fn testo(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        altro => serde_json::to_string_pretty(altro).unwrap_or_else(|_| altro.to_string()),
    }
}

fn esito(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn errore(id: Value, codice: i32, messaggio: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": codice, "message": messaggio } })
}

#[cfg(test)]
mod prove {
    use super::*;

    #[test]
    fn lhandshake_risponde_con_la_versione_chiesta_se_la_conosce() {
        let r = senza_stato("initialize", json!(1), Some(&json!({ "protocolVersion": "2024-11-05" })));
        assert_eq!(r["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(r["id"], 1);
        assert!(r["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn a_una_versione_che_non_conosce_risponde_con_la_sua() {
        let r = senza_stato("initialize", json!(1), Some(&json!({ "protocolVersion": "1999-01-01" })));
        assert_eq!(r["result"]["protocolVersion"], VERSIONI[0]);
        // E anche se il client non la dichiara affatto.
        let r = senza_stato("initialize", json!(1), None);
        assert_eq!(r["result"]["protocolVersion"], VERSIONI[0]);
    }

    #[test]
    fn lelenco_usa_inputschema_e_non_porta_fuori_gli_strumenti_esclusi() {
        let r = senza_stato("tools/list", json!(2), None);
        let t = r["result"]["tools"].as_array().unwrap();
        assert_eq!(t.len(), tools::SOLA_LETTURA.len());
        for s in t {
            assert!(s.get("inputSchema").is_some(), "{} senza inputSchema", s["name"]);
            assert!(s.get("input_schema").is_none(), "{} ha ancora il nome vecchio", s["name"]);
            assert_eq!(s["inputSchema"]["type"], "object");
            let n = s["name"].as_str().unwrap();
            assert!(!tools::FUORI_DA_ESEGUI.contains(&n), "{n} non doveva uscire");
        }
    }

    #[test]
    fn un_metodo_sconosciuto_e_un_errore_di_protocollo() {
        let r = senza_stato("resources/list", json!(3), None);
        assert_eq!(r["error"]["code"], -32601);
        assert!(r.get("result").is_none());
    }

    /// Uno strumento che esiste ma non è esposto lo dice, invece di passare per
    /// un errore di battitura: chi legge deve capire che è una scelta.
    #[test]
    fn chi_e_escluso_apposta_lo_dichiara() {
        let m = motivo_non_esposto("proponi_modifica");
        assert!(m.contains("sola lettura"), "{m}");
        assert!(m.contains("editor"), "{m}");
        assert_eq!(motivo_non_esposto("pippo"), "strumento sconosciuto: `pippo`");
    }

    #[tokio::test]
    async fn una_notifica_non_riceve_risposta() {
        // `rispondi` vuole uno `AppState`, ma una notifica esce prima di
        // toccarlo: il percorso si prova sulla sola analisi del messaggio.
        let msg: Value = serde_json::from_str(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).unwrap();
        assert!(msg.get("id").is_none(), "una notifica non ha id, ed è l'unica cosa che conta qui");
    }

    #[test]
    fn un_json_rotto_risponde_con_id_nullo() {
        let r = errore(Value::Null, -32700, "JSON non valido: x");
        assert!(r["id"].is_null());
        assert_eq!(r["error"]["code"], -32700);
    }

    #[test]
    fn il_testo_di_un_risultato_e_json_leggibile() {
        assert_eq!(testo(&json!("ciao")), "ciao");
        let t = testo(&json!({ "a": 1 }));
        assert!(t.contains('\n'), "un oggetto su una riga sola non si legge: {t}");
    }
}
