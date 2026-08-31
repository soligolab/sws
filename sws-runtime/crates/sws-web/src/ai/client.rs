//! Il client verso la Messages API di Anthropic, e il ciclo SSE.
//!
//! Non esiste un SDK Rust ufficiale, quindi qui c'è HTTP grezzo — è la scelta
//! che la documentazione stessa indica per i linguaggi senza SDK. Il pezzo che
//! costa è la lettura dell'SSE, ed è anche il pezzo che non si può saltare: con
//! il pensiero adattivo un turno può durare decine di secondi, e senza
//! streaming la chat resterebbe muta per tutto quel tempo.
//!
//! # Le tre cose che si rompono in silenzio
//!
//! 1. **`stop_reason: "refusal"` arriva con HTTP 200.** Va guardato prima del
//!    contenuto, altrimenti la chat mostra una risposta vuota e nessuno capisce.
//! 2. **I blocchi di pensiero vanno rimandati indietro immutati**, firma
//!    compresa. Ricostruirli a mano dal testo li rompe; qui si accumulano i
//!    delta nel blocco così com'è arrivato.
//! 3. **Le chiamate a strumento in parallelo** stanno in un solo messaggio, e i
//!    risultati vanno rispediti **tutti insieme in un solo messaggio utente**.
//!    Spezzarli insegna al modello a non farne più in parallelo, e non si vede:
//!    si vede solo che diventa lento.

use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// Il modello. Opus 5: contesto da 1M, pensiero acceso di default.
pub const MODEL: &str = "claude-opus-5";
const API: &str = "https://api.anthropic.com/v1/messages";
const VERSIONE: &str = "2023-06-01";

/// Quanto può scrivere il modello in un turno. Alto perché una proposta con
/// due pagine intere è lunga; con lo streaming non rischia il timeout HTTP.
const MAX_TOKENS: u32 = 16000;

pub struct Anthropic {
    key: String,
    http: reqwest::Client,
}

/// Dove si cerca la chiave, in ordine. Mai nel progetto: il progetto si
/// esporta, si manda in giro e finisce su un dispositivo.
pub fn percorsi_chiave(config_dir: &Path) -> Vec<PathBuf> {
    let mut v = vec![config_dir.join("anthropic.key")];
    if let Some(home) = std::env::var_os("HOME") {
        v.push(PathBuf::from(home).join(".config/sws/anthropic.key"));
    }
    v
}

/// `ANTHROPIC_API_KEY` dell'ambiente, poi i file. `None` = chat spenta, che è
/// una condizione normale e non un errore: l'IDE funziona lo stesso.
pub fn carica_chiave(config_dir: &Path) -> Option<String> {
    if let Ok(k) = std::env::var("ANTHROPIC_API_KEY") {
        let k = k.trim().to_string();
        if !k.is_empty() {
            return Some(k);
        }
    }
    for p in percorsi_chiave(config_dir) {
        if let Ok(testo) = std::fs::read_to_string(&p) {
            let k = testo.trim().to_string();
            if !k.is_empty() {
                tracing::info!(path = %p.display(), "chiave Anthropic caricata");
                return Some(k);
            }
        }
    }
    None
}

/// Quello che il modello ha prodotto in un turno.
#[derive(Debug, Clone, Serialize)]
pub struct Risposta {
    /// I blocchi di contenuto **così come sono arrivati**: vanno riaccodati ai
    /// messaggi senza toccarli (vedi punto 2 in testa al modulo).
    pub content: Vec<Value>,
    pub stop_reason: String,
    /// Popolato solo quando `stop_reason == "refusal"`.
    pub stop_details: Option<Value>,
    pub usage: Value,
}

impl Risposta {
    /// Le chiamate a strumento di questo turno, nell'ordine.
    pub fn tool_uses(&self) -> Vec<(&str, &str, &Value)> {
        self.content.iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use"))
            .filter_map(|b| Some((
                b.get("id")?.as_str()?,
                b.get("name")?.as_str()?,
                b.get("input")?,
            )))
            .collect()
    }

    /// Il testo visibile, concatenato.
    pub fn testo(&self) -> String {
        self.content.iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("")
    }
}

/// Quello che succede mentre il turno scorre. Va inoltrato al browser: è
/// l'unica cosa che distingue una chat viva da una che sembra bloccata.
#[derive(Debug, Clone)]
pub enum Evento {
    Testo(String),
    /// Riassunto del ragionamento, quando è acceso.
    Pensiero(String),
    /// Il modello ha cominciato a comporre una chiamata a strumento.
    StrumentoInizio { nome: String },
}

/// Il corpo della richiesta. Fuori dal metodo perché è la parte che può
/// sbagliarsi in modo silenzioso — un parametro rimosso dall'API, un campo nel
/// posto sbagliato — e senza chiave non si può provare contro il servizio vero.
/// Almeno la forma la si prova.
fn corpo_richiesta(system: Vec<Value>, messages: &[Value], tools: &[Value]) -> Value {
    json!({
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "stream": true,
        // Su Opus 5 il pensiero è acceso di default e `budget_tokens` è stato
        // **rimosso**: passarlo dà 400. `display: summarized` è un'opt-in — il
        // default è omesso, e senza si vedrebbe solo una lunga pausa prima
        // della risposta.
        "thinking": { "type": "adaptive", "display": "summarized" },
        // `effort` sta dentro `output_config`, non al primo livello.
        "output_config": { "effort": "high" },
        "system": system,
        "messages": messages,
        "tools": tools,
    })
}

impl Anthropic {
    pub fn new(key: String) -> Self {
        Anthropic {
            key,
            // Nessun timeout complessivo: un turno con pensiero adattivo può
            // durare minuti, e tagliarlo a metà è peggio che aspettarlo. Il
            // timeout di connessione resta, così un broker irraggiungibile non
            // appende la chat per sempre.
            http: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("client HTTP"),
        }
    }

    /// Un turno. `system` va messo in cache: è grosso (lo schema) e non cambia
    /// mai fra un turno e l'altro, mentre i messaggi crescono. L'ordine di
    /// resa è tools → system → messages, quindi il prefisso stabile va davanti.
    pub async fn turno(
        &self,
        system: Vec<Value>,
        messages: &[Value],
        tools: &[Value],
        mut on_event: impl FnMut(Evento),
    ) -> Result<Risposta> {
        let body = corpo_richiesta(system, messages, tools);

        let resp = self.http.post(API)
            .header("x-api-key", &self.key)
            .header("anthropic-version", VERSIONE)
            .header("content-type", "application/json")
            .json(&body)
            .send().await
            .context("la richiesta ad api.anthropic.com non è partita")?;

        let stato = resp.status();
        if !stato.is_success() {
            let corpo = resp.text().await.unwrap_or_default();
            // Il corpo dell'errore NON contiene la chiave, ma può contenere il
            // prompt: si registra il codice e il messaggio, non tutto.
            let breve: String = corpo.chars().take(500).collect();
            bail!("Anthropic ha risposto {stato}: {breve}");
        }

        self.leggi_sse(resp, &mut on_event).await
    }

    async fn leggi_sse(
        &self,
        resp: reqwest::Response,
        on_event: &mut impl FnMut(Evento),
    ) -> Result<Risposta> {
        let mut blocchi: Vec<Value> = Vec::new();
        // JSON parziale degli argomenti di uno strumento, per indice di blocco.
        let mut parziali: std::collections::HashMap<usize, String> = Default::default();
        let mut stop_reason = String::new();
        let mut stop_details: Option<Value> = None;
        let mut usage = json!({});

        let mut stream = resp.bytes_stream();
        let mut buf = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("la connessione SSE si è interrotta")?;
            buf.push_str(&String::from_utf8_lossy(&chunk));

            // Un evento SSE finisce con una riga vuota. Tutto ciò che resta
            // dopo l'ultima riga vuota è un evento a metà: resta nel buffer.
            while let Some(fine) = buf.find("\n\n") {
                let grezzo: String = buf.drain(..fine + 2).collect();
                let Some(dati) = grezzo.lines()
                    .find_map(|l| l.strip_prefix("data:").map(str::trim)) else { continue };
                if dati == "[DONE]" {
                    continue;
                }
                let Ok(ev): Result<Value, _> = serde_json::from_str(dati) else { continue };
                applica_evento(&ev, &mut blocchi, &mut parziali, &mut stop_reason,
                               &mut stop_details, &mut usage, on_event);
            }
        }

        // Gli argomenti degli strumenti arrivano come stringa JSON a pezzi:
        // solo alla fine sono un oggetto.
        for (i, testo) in parziali {
            if let Some(b) = blocchi.get_mut(i) {
                let parsed = if testo.trim().is_empty() {
                    json!({})
                } else {
                    // Mai confrontare la stringa grezza: l'escaping varia.
                    serde_json::from_str(&testo)
                        .with_context(|| format!("argomenti dello strumento illeggibili: {testo}"))?
                };
                b["input"] = parsed;
            }
        }

        if stop_reason == "refusal" {
            let categoria = stop_details.as_ref()
                .and_then(|d| d.get("category")).and_then(Value::as_str)
                .unwrap_or("non specificata");
            bail!("il modello ha rifiutato la richiesta (categoria: {categoria})");
        }

        Ok(Risposta { content: blocchi, stop_reason, stop_details, usage })
    }
}

fn applica_evento(
    ev: &Value,
    blocchi: &mut Vec<Value>,
    parziali: &mut std::collections::HashMap<usize, String>,
    stop_reason: &mut String,
    stop_details: &mut Option<Value>,
    usage: &mut Value,
    on_event: &mut impl FnMut(Evento),
) {
    let tipo = ev.get("type").and_then(Value::as_str).unwrap_or("");
    let idx = ev.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;

    match tipo {
        "content_block_start" => {
            let Some(blocco) = ev.get("content_block") else { return };
            while blocchi.len() <= idx {
                blocchi.push(json!({}));
            }
            blocchi[idx] = blocco.clone();
            if blocco.get("type").and_then(Value::as_str) == Some("tool_use") {
                parziali.insert(idx, String::new());
                if let Some(nome) = blocco.get("name").and_then(Value::as_str) {
                    on_event(Evento::StrumentoInizio { nome: nome.to_string() });
                }
            }
        }
        "content_block_delta" => {
            let Some(delta) = ev.get("delta") else { return };
            let Some(b) = blocchi.get_mut(idx) else { return };
            match delta.get("type").and_then(Value::as_str).unwrap_or("") {
                "text_delta" => {
                    if let Some(t) = delta.get("text").and_then(Value::as_str) {
                        appendi(b, "text", t);
                        on_event(Evento::Testo(t.to_string()));
                    }
                }
                "thinking_delta" => {
                    if let Some(t) = delta.get("thinking").and_then(Value::as_str) {
                        appendi(b, "thinking", t);
                        on_event(Evento::Pensiero(t.to_string()));
                    }
                }
                // La firma del blocco di pensiero: senza, rimandarlo indietro
                // non vale e il modello perde il filo.
                "signature_delta" => {
                    if let Some(t) = delta.get("signature").and_then(Value::as_str) {
                        appendi(b, "signature", t);
                    }
                }
                "input_json_delta" => {
                    if let Some(t) = delta.get("partial_json").and_then(Value::as_str) {
                        parziali.entry(idx).or_default().push_str(t);
                    }
                }
                _ => {}
            }
        }
        "message_delta" => {
            if let Some(d) = ev.get("delta") {
                if let Some(sr) = d.get("stop_reason").and_then(Value::as_str) {
                    *stop_reason = sr.to_string();
                }
                if let Some(sd) = d.get("stop_details") {
                    if !sd.is_null() {
                        *stop_details = Some(sd.clone());
                    }
                }
            }
            if let Some(u) = ev.get("usage") {
                *usage = u.clone();
            }
        }
        "error" => {
            tracing::warn!(errore = %ev, "evento di errore dallo stream Anthropic");
        }
        _ => {}
    }
}

fn appendi(blocco: &mut Value, campo: &str, pezzo: &str) {
    let gia = blocco.get(campo).and_then(Value::as_str).unwrap_or("");
    blocco[campo] = Value::String(format!("{gia}{pezzo}"));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ricostruire i blocchi dai delta è la parte che, sbagliata, rompe tutto
    /// in silenzio: il testo arriva a pezzi, gli argomenti degli strumenti sono
    /// una stringa JSON spezzata, e il pensiero porta una firma.
    #[test]
    fn i_delta_ricostruiscono_i_blocchi() {
        let mut blocchi = Vec::new();
        let mut parziali = Default::default();
        let (mut sr, mut sd, mut us) = (String::new(), None, json!({}));
        let mut visti = Vec::new();
        let mut on = |e: Evento| visti.push(format!("{e:?}"));

        for ev in [
            json!({"type":"content_block_start","index":0,
                   "content_block":{"type":"text","text":""}}),
            json!({"type":"content_block_delta","index":0,
                   "delta":{"type":"text_delta","text":"Aggiungo "}}),
            json!({"type":"content_block_delta","index":0,
                   "delta":{"type":"text_delta","text":"il bottone."}}),
            json!({"type":"content_block_start","index":1,
                   "content_block":{"type":"tool_use","id":"tu_1","name":"leggi_pagina","input":{}}}),
            json!({"type":"content_block_delta","index":1,
                   "delta":{"type":"input_json_delta","partial_json":"{\"nome\":"}}),
            json!({"type":"content_block_delta","index":1,
                   "delta":{"type":"input_json_delta","partial_json":"\"Indicatori\"}"}}),
            json!({"type":"message_delta","delta":{"stop_reason":"tool_use"},
                   "usage":{"output_tokens":42}}),
        ] {
            applica_evento(&ev, &mut blocchi, &mut parziali, &mut sr, &mut sd, &mut us, &mut on);
        }

        for (i, testo) in parziali {
            blocchi[i]["input"] = serde_json::from_str(&testo).unwrap();
        }

        assert_eq!(blocchi[0]["text"], "Aggiungo il bottone.");
        assert_eq!(blocchi[1]["input"]["nome"], "Indicatori");
        assert_eq!(sr, "tool_use");
        assert_eq!(us["output_tokens"], 42);
        assert!(visti.iter().any(|e| e.contains("leggi_pagina")));
    }

    #[test]
    fn la_firma_del_pensiero_si_conserva() {
        let mut blocchi = Vec::new();
        let mut parziali = Default::default();
        let (mut sr, mut sd, mut us) = (String::new(), None, json!({}));
        let mut on = |_: Evento| {};
        for ev in [
            json!({"type":"content_block_start","index":0,
                   "content_block":{"type":"thinking","thinking":"","signature":""}}),
            json!({"type":"content_block_delta","index":0,
                   "delta":{"type":"thinking_delta","thinking":"rifletto"}}),
            json!({"type":"content_block_delta","index":0,
                   "delta":{"type":"signature_delta","signature":"abc123"}}),
        ] {
            applica_evento(&ev, &mut blocchi, &mut parziali, &mut sr, &mut sd, &mut us, &mut on);
        }
        assert_eq!(blocchi[0]["thinking"], "rifletto");
        assert_eq!(blocchi[0]["signature"], "abc123");
    }

    /// La forma della richiesta contro le trappole note dell'API.
    ///
    /// Sono cose che cambiano nel tempo e si rompono con un 400 o — peggio —
    /// funzionando male in silenzio. Senza chiave non si può provare il giro
    /// vero, ma il corpo sì.
    #[test]
    fn il_corpo_della_richiesta_non_ha_trappole() {
        let b = corpo_richiesta(prompt_finto(), &[json!({"role":"user","content":"ciao"})],
                                &[json!({"name":"x"})]);

        assert_eq!(b["model"], "claude-opus-5");
        assert_eq!(b["stream"], true);
        assert_eq!(b["thinking"]["type"], "adaptive");
        // `budget_tokens` è rimosso su Opus 5: mandarlo è un 400 secco.
        assert!(b["thinking"].get("budget_tokens").is_none());
        // Senza `display` si vedrebbe solo una lunga pausa: il default è omesso.
        assert_eq!(b["thinking"]["display"], "summarized");
        // `effort` va DENTRO output_config, non al primo livello.
        assert!(b.get("effort").is_none());
        assert_eq!(b["output_config"]["effort"], "high");
        // Sampling rimosso su Opus 5.
        assert!(b.get("temperature").is_none());
        assert!(b.get("top_p").is_none());
        assert!(b["max_tokens"].as_u64().unwrap() >= 8000);
    }

    /// Il prefisso della cache deve essere davvero un prefisso: il blocco di
    /// sistema porta `cache_control`, e quello che cambia sta dopo.
    #[test]
    fn il_prompt_di_sistema_e_in_cache() {
        let b = corpo_richiesta(prompt_finto(), &[], &[]);
        assert_eq!(b["system"][0]["cache_control"]["type"], "ephemeral");
    }

    fn prompt_finto() -> Vec<Value> {
        vec![json!({ "type": "text", "text": "istruzioni",
                     "cache_control": { "type": "ephemeral" } })]
    }

    #[test]
    fn una_risposta_espone_strumenti_e_testo() {
        let r = Risposta {
            content: vec![
                json!({"type":"text","text":"ecco"}),
                json!({"type":"tool_use","id":"t1","name":"valida","input":{"a":1}}),
            ],
            stop_reason: "tool_use".into(), stop_details: None, usage: json!({}),
        };
        assert_eq!(r.testo(), "ecco");
        let usi = r.tool_uses();
        assert_eq!(usi.len(), 1);
        assert_eq!(usi[0].1, "valida");
    }
}
