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

/// Il modello di riferimento. Opus 5: contesto da 1M, pensiero acceso di default.
pub const MODEL: &str = "claude-opus-5";
const VERSIONE: &str = "2023-06-01";

/// Chi serve il modello.
///
/// # Perché due, e perché costa poco
///
/// Kimi espone la **Messages API di Anthropic** su un endpoint dedicato, quindi
/// lo streaming, i blocchi di contenuto, gli strumenti e i nomi degli eventi SSE
/// sono gli stessi: `leggi_sse` e `ricomponi_blocchi` non cambiano di una riga.
/// A cambiare sono tre cose sole — l'indirizzo, l'header di autenticazione e il
/// modo di chiedere il pensiero — ed è esattamente quanto questo enum descrive.
///
/// Non è un livello di astrazione «per il futuro»: è la differenza fra 5 $/Mtok
/// in ingresso e 25 in uscita (Opus 5) e 3 $/Mtok e 15 (Kimi K3). Su un PoC in
/// cui ogni prova si paga, quel 40% decide quante prove si fanno.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fornitore {
    Anthropic,
    Kimi,
}

impl Fornitore {
    pub fn nome(self) -> &'static str {
        match self { Fornitore::Anthropic => "anthropic", Fornitore::Kimi => "kimi" }
    }

    fn endpoint(self) -> &'static str {
        match self {
            Fornitore::Anthropic => "https://api.anthropic.com/v1/messages",
            Fornitore::Kimi => "https://api.moonshot.ai/anthropic/v1/messages",
        }
    }

    pub fn modello_default(self) -> &'static str {
        match self { Fornitore::Anthropic => MODEL, Fornitore::Kimi => "kimi-k3" }
    }

    /// La variabile d'ambiente da cui si prende la chiave. Per Kimi sono due:
    /// `MOONSHOT_API_KEY` è quella dei loro esempi, `KIMI_API_KEY` quella che
    /// chiunque proverebbe per prima.
    fn env_chiave(self) -> &'static [&'static str] {
        match self {
            Fornitore::Anthropic => &["ANTHROPIC_API_KEY"],
            Fornitore::Kimi => &["MOONSHOT_API_KEY", "KIMI_API_KEY"],
        }
    }

    pub fn file_chiave(self) -> &'static str {
        match self { Fornitore::Anthropic => "anthropic.key", Fornitore::Kimi => "kimi.key" }
    }

    /// Anthropic vuole `x-api-key` + `anthropic-version`; Kimi vuole
    /// `Authorization: Bearer` e **rifiuta** di aver bisogno degli altri due.
    fn bearer(self) -> bool {
        matches!(self, Fornitore::Kimi)
    }

    /// Su Anthropic il pensiero si chiede col campo `thinking`; su Kimi la
    /// documentazione dice che si governa **solo** con `output_config.effort`.
    /// Mandare `thinking` a chi non lo dichiara è il modo classico di prendere
    /// un 400 su un campo che «funzionava con l'altro».
    fn pensiero_anthropic(self) -> bool {
        matches!(self, Fornitore::Anthropic)
    }

    pub fn da_nome(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "anthropic" | "claude" => Some(Fornitore::Anthropic),
            "kimi" | "moonshot" => Some(Fornitore::Kimi),
            _ => None,
        }
    }
}

/// Con chi si parla e con che chiave. `modello` è già risolto: il default del
/// fornitore, o quello che ha imposto `SWS_AI_MODELLO`.
#[derive(Clone, Debug)]
pub struct Scelta {
    pub fornitore: Fornitore,
    pub chiave: String,
    pub modello: String,
}

/// Quanto può scrivere il modello in un turno. Alto perché una proposta con
/// due pagine intere è lunga; con lo streaming non rischia il timeout HTTP.
const MAX_TOKENS: u32 = 16000;

/// Il cliente verso il fornitore. Si chiamava `Anthropic`: ora che può parlare
/// anche con Kimi, quel nome sarebbe una bugia.
pub struct Cliente {
    scelta: Scelta,
    http: reqwest::Client,
}

/// Dove si cerca la chiave di un fornitore, in ordine. Mai nel progetto: il
/// progetto si esporta, si manda in giro e finisce su un dispositivo.
pub fn percorsi_chiave_di(config_dir: &Path, f: Fornitore) -> Vec<PathBuf> {
    let mut v = vec![config_dir.join(f.file_chiave())];
    if let Some(home) = std::env::var_os("HOME") {
        v.push(PathBuf::from(home).join(".config/sws").join(f.file_chiave()));
    }
    v
}

/// Tutti i percorsi, di tutti i fornitori: è l'elenco che il pannello mostra
/// quando la chat è spenta, e deve dire *tutte* le strade, non una.
pub fn percorsi_chiave(config_dir: &Path) -> Vec<PathBuf> {
    let mut v = percorsi_chiave_di(config_dir, Fornitore::Anthropic);
    v.extend(percorsi_chiave_di(config_dir, Fornitore::Kimi));
    v
}

fn chiave_di(config_dir: &Path, f: Fornitore) -> Option<String> {
    for nome in f.env_chiave() {
        if let Ok(k) = std::env::var(nome) {
            let k = k.trim().to_string();
            if !k.is_empty() {
                tracing::info!(fornitore = f.nome(), env = nome, "chiave dall'ambiente");
                return Some(k);
            }
        }
    }
    for p in percorsi_chiave_di(config_dir, f) {
        if let Ok(testo) = std::fs::read_to_string(&p) {
            let k = testo.trim().to_string();
            if !k.is_empty() {
                tracing::info!(fornitore = f.nome(), path = %p.display(), "chiave caricata");
                return Some(k);
            }
        }
    }
    None
}

/// C'è una chiave per questo fornitore? Non la legge: dice solo se c'è.
pub fn ha_chiave(config_dir: &Path, f: Fornitore) -> bool {
    chiave_di(config_dir, f).is_some()
}

/// Scrive la chiave nel file che `percorsi_chiave_di` cerca **per primo**, con
/// permessi **0600**.
///
/// I permessi espliciti sono una prima volta in questo runtime: `tls.key` finisce
/// a 0644 perché `generate_cert_files` usa `fs::write` e si affida all'umask. Qui
/// non ci si affida, perché una chiave API leggibile da tutti gli utenti della
/// macchina è un difetto che non costa niente evitare. Su piattaforme senza
/// permessi POSIX il file si scrive comunque: meglio senza permessi che senza
/// chiave.
pub fn salva_chiave(config_dir: &Path, f: Fornitore, chiave: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(config_dir)?;
    let p = config_dir.join(f.file_chiave());
    std::fs::write(&p, chiave.trim())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600))?;
    }
    tracing::info!(fornitore = f.nome(), path = %p.display(), "chiave salvata");
    Ok(())
}

/// Cancella la chiave di un fornitore. `Ok(false)` = non c'era, che non è un
/// errore: cancellare due volte deve poter succedere senza spaventare nessuno.
pub fn cancella_chiave(config_dir: &Path, f: Fornitore) -> std::io::Result<bool> {
    let p = config_dir.join(f.file_chiave());
    match std::fs::remove_file(&p) {
        Ok(()) => {
            tracing::info!(fornitore = f.nome(), "chiave cancellata");
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

/// Con chi parlare. `None` = chat spenta, che è una condizione normale e non un
/// errore: l'IDE funziona lo stesso e il pannello lo dice.
///
/// L'ordine non è una preferenza estetica: **chi è chiesto esplicitamente
/// vince**, e se nessuno lo è si prende il primo che ha una chiave, provando
/// Anthropic prima di Kimi. Così una macchina con due chiavi si comporta in
/// modo prevedibile invece di dipendere dall'ordine di lettura dei file, e chi
/// vuole l'altro lo scrive: `SWS_AI_FORNITORE=kimi`.
pub fn carica(config_dir: &Path) -> Option<Scelta> {
    let salvata = Impostazioni::carica(config_dir);

    // L'ambiente vince sul file, e la UI lo dice quando trova una variabile
    // impostata: senza quell'avviso, si configura dall'IDE, non cambia niente,
    // e non si capisce perché. La precedenza è questa e non l'inversa perché
    // una variabile d'ambiente è un'intenzione di chi ha avviato il processo —
    // uno script, un servizio systemd — e non va scavalcata da un file.
    let modello_imposto = std::env::var("SWS_AI_MODELLO").ok()
        .map(|m| m.trim().to_string()).filter(|m| !m.is_empty())
        .or_else(|| salvata.modello.clone());

    let da_ambiente = std::env::var("SWS_AI_FORNITORE").ok()
        .map(|v| v.trim().to_string()).filter(|v| !v.is_empty());

    let candidati: Vec<Fornitore> = match da_ambiente {
        Some(v) => match Fornitore::da_nome(&v) {
            Some(f) => vec![f],
            None => {
                tracing::warn!(valore = %v, "SWS_AI_FORNITORE non riconosciuto: \
                                             valori validi `anthropic` o `kimi`");
                return None;
            }
        },
        None => match salvata.fornitore.as_deref().and_then(Fornitore::da_nome) {
            Some(f) => vec![f],
            // Nessuna preferenza da nessuna parte: si prova Anthropic e poi
            // Kimi, così una macchina con due chiavi si comporta in modo
            // prevedibile invece di dipendere dall'ordine di lettura dei file.
            None => vec![Fornitore::Anthropic, Fornitore::Kimi],
        },
    };

    for f in candidati {
        if let Some(chiave) = chiave_di(config_dir, f) {
            let modello = modello_imposto.clone()
                .unwrap_or_else(|| f.modello_default().to_string());
            return Some(Scelta { fornitore: f, chiave, modello });
        }
    }
    None
}

/// Fornitore e modello scelti dall'IDE, in `config_dir/ai.yaml`.
///
/// # Perché un file e non solo le variabili d'ambiente
///
/// Perché dall'IDE non si impostano variabili d'ambiente. Il precedente esatto
/// è `config_dir/mqtt_client_id_overrides.yaml` (`projects.rs`): un'impostazione
/// **di runtime** e non di progetto, scritta da un endpoint, tenuta fuori dal
/// progetto così un redeploy non la cancella in silenzio.
///
/// La chiave **non** sta qui: sta nel suo file (`<fornitore>.key`), che è quello
/// che `percorsi_chiave_di` già cerca. Tenere il segreto in un file a parte
/// permette di dargli i permessi che merita senza cambiarli a un file di
/// impostazioni che qualcuno potrebbe voler leggere.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct Impostazioni {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fornitore: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modello: Option<String>,
}

impl Impostazioni {
    pub fn percorso(config_dir: &Path) -> PathBuf {
        config_dir.join("ai.yaml")
    }

    /// Un file assente o illeggibile non è un errore: significa «nessuna
    /// preferenza», che è la condizione iniziale di ogni installazione. Un file
    /// **malformato** invece si segnala nel log, perché lì qualcuno ha scritto
    /// qualcosa aspettandosi un effetto.
    pub fn carica(config_dir: &Path) -> Self {
        let p = Self::percorso(config_dir);
        match std::fs::read_to_string(&p) {
            Err(_) => Self::default(),
            Ok(testo) => match serde_yaml::from_str::<Self>(&testo) {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(path = %p.display(), errore = %e,
                                   "ai.yaml non si legge: ignorato");
                    Self::default()
                }
            },
        }
    }

    pub fn salva(&self, config_dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(config_dir)?;
        let testo = serde_yaml::to_string(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(Self::percorso(config_dir), testo)
    }
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
fn corpo_richiesta(
    scelta: &Scelta,
    system: Vec<Value>,
    messages: &[Value],
    tools: &[Value],
) -> Value {
    let mut b = json!({
        "model": scelta.modello,
        "max_tokens": MAX_TOKENS,
        "stream": true,
        // `effort` sta dentro `output_config`, non al primo livello. Lo
        // accettano entrambi i fornitori, e su Kimi è **l'unico** modo di
        // chiedere più ragionamento.
        "output_config": { "effort": "high" },
        "system": system,
        "messages": messages,
        "tools": tools,
    });
    if scelta.fornitore.pensiero_anthropic() {
        // Su Opus 5 il pensiero è acceso di default e `budget_tokens` è stato
        // **rimosso**: passarlo dà 400. `display: summarized` è un'opt-in — il
        // default è omesso, e senza si vedrebbe solo una lunga pausa prima
        // della risposta.
        b["thinking"] = json!({ "type": "adaptive", "display": "summarized" });
    }
    b
}

impl Cliente {
    pub fn new(scelta: Scelta) -> Self {
        Cliente {
            scelta,
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
        let body = corpo_richiesta(&self.scelta, system, messages, tools);
        let f = self.scelta.fornitore;

        let mut req = self.http.post(f.endpoint()).header("content-type", "application/json");
        req = if f.bearer() {
            req.header("authorization", format!("Bearer {}", self.scelta.chiave))
        } else {
            req.header("x-api-key", &self.scelta.chiave)
               .header("anthropic-version", VERSIONE)
        };

        let resp = req.json(&body).send().await
            .with_context(|| format!("la richiesta a {} non è partita", f.endpoint()))?;

        let stato = resp.status();
        if !stato.is_success() {
            let corpo = resp.text().await.unwrap_or_default();
            // Il corpo dell'errore NON contiene la chiave, ma può contenere il
            // prompt: si registra il codice e il messaggio, non tutto.
            let breve: String = corpo.chars().take(500).collect();
            bail!("{} ha risposto {stato}: {breve}", f.nome());
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
        let b = corpo_richiesta(&scelta(Fornitore::Anthropic), prompt_finto(),
                                &[json!({"role":"user","content":"ciao"})],
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
        let b = corpo_richiesta(&scelta(Fornitore::Anthropic), prompt_finto(), &[], &[]);
        assert_eq!(b["system"][0]["cache_control"]["type"], "ephemeral");
    }


    /// Assente e malformato non sono errori: significano «nessuna preferenza»,
    /// che è la condizione iniziale di ogni installazione. Un file malformato
    /// però va segnalato nel log, perché lì qualcuno ha scritto qualcosa
    /// aspettandosi un effetto.
    #[test]
    fn le_impostazioni_assenti_o_rotte_non_fermano_niente() {
        let d = tempfile::tempdir().unwrap();
        // Assente.
        let i = Impostazioni::carica(d.path());
        assert!(i.fornitore.is_none() && i.modello.is_none());

        // Malformato.
        std::fs::write(Impostazioni::percorso(d.path()), "questo: [non\nchiude").unwrap();
        let i = Impostazioni::carica(d.path());
        assert!(i.fornitore.is_none(), "un file rotto non deve inventare un fornitore");

        // E il giro completo.
        let i = Impostazioni { fornitore: Some("kimi".into()), modello: Some("kimi-k3".into()) };
        i.salva(d.path()).unwrap();
        let letta = Impostazioni::carica(d.path());
        assert_eq!(letta.fornitore.as_deref(), Some("kimi"));
        assert_eq!(letta.modello.as_deref(), Some("kimi-k3"));
    }

    /// La chiave si scrive con permessi 0600. È la prima volta in questo runtime
    /// che si impostano i permessi di un file — `tls.key` finisce a 0644 — e la
    /// ragione è che una chiave API leggibile da tutti gli utenti della macchina
    /// è un difetto che non costa niente evitare.
    #[test]
    #[cfg(unix)]
    fn la_chiave_si_scrive_con_permessi_stretti() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        salva_chiave(d.path(), Fornitore::Kimi, "  unachiaveabbastanzalunga  ").unwrap();

        let p = d.path().join("kimi.key");
        let modo = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(modo, 0o600, "permessi {modo:o}: la chiave sarebbe leggibile da altri");
        // Gli spazi intorno si tolgono: una chiave copiata da un terminale ne
        // porta spesso uno, e il fornitore rifiuterebbe l'intestazione.
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "unachiaveabbastanzalunga");
        assert!(ha_chiave(d.path(), Fornitore::Kimi));
        // E non finisce nel file dell'altro fornitore.
        assert!(!ha_chiave(d.path(), Fornitore::Anthropic));
    }

    /// Cancellare due volte deve poter succedere senza spaventare nessuno.
    #[test]
    fn cancellare_una_chiave_che_non_c_e_non_e_un_errore() {
        let d = tempfile::tempdir().unwrap();
        assert!(!cancella_chiave(d.path(), Fornitore::Kimi).unwrap(), "non c'era: false");
        salva_chiave(d.path(), Fornitore::Kimi, "unachiaveabbastanzalunga").unwrap();
        assert!(cancella_chiave(d.path(), Fornitore::Kimi).unwrap(), "c'era: true");
        assert!(!cancella_chiave(d.path(), Fornitore::Kimi).unwrap(), "e ora non più");
    }

    fn scelta(f: Fornitore) -> Scelta {
        Scelta { fornitore: f, chiave: "k".into(), modello: f.modello_default().into() }
    }

    /// A Kimi non si manda `thinking`.
    ///
    /// La sua documentazione dice che il ragionamento si governa **solo** con
    /// `output_config.effort`. Mandare un campo che il fornitore non dichiara è
    /// il modo classico di prendere un 400 su qualcosa che «funzionava con
    /// l'altro» — e con lo streaming l'errore arriva a metà frase.
    #[test]
    fn a_kimi_non_si_manda_il_pensiero_di_anthropic() {
        let k = corpo_richiesta(&scelta(Fornitore::Kimi), prompt_finto(), &[], &[]);
        assert!(k.get("thinking").is_none(), "corpo: {k}");
        // Ma l'effort sì: è l'unica leva che gli resta.
        assert_eq!(k["output_config"]["effort"], "high");
        assert_eq!(k["model"], "kimi-k3");
        // E il resto è identico, che è tutto il senso di usare il loro
        // endpoint compatibile: stream, strumenti, blocchi, system in cache.
        let a = corpo_richiesta(&scelta(Fornitore::Anthropic), prompt_finto(), &[], &[]);
        for campo in ["stream", "max_tokens", "system", "messages", "tools"] {
            assert_eq!(k[campo], a[campo],
                       "il campo `{campo}` non dovrebbe dipendere dal fornitore");
        }
    }

    /// I due fornitori si autenticano in modo diverso, e sbagliarlo dà un 401
    /// che sembra «chiave sbagliata» invece di «header sbagliato».
    #[test]
    fn ognuno_ha_il_suo_header() {
        assert!(!Fornitore::Anthropic.bearer(), "Anthropic vuole x-api-key");
        assert!(Fornitore::Kimi.bearer(), "Kimi vuole Authorization: Bearer");
        assert!(Fornitore::Kimi.endpoint().ends_with("/anthropic/v1/messages"),
                "l'endpoint compatibile di Kimi non è /v1/messages: {}",
                Fornitore::Kimi.endpoint());
    }

    #[test]
    fn i_nomi_dei_fornitori_si_leggono_come_li_scriverebbe_una_persona() {
        assert_eq!(Fornitore::da_nome("kimi"), Some(Fornitore::Kimi));
        assert_eq!(Fornitore::da_nome("MOONSHOT"), Some(Fornitore::Kimi));
        assert_eq!(Fornitore::da_nome("claude"), Some(Fornitore::Anthropic));
        assert_eq!(Fornitore::da_nome(" Anthropic "), Some(Fornitore::Anthropic));
        // E un nome sconosciuto non diventa silenziosamente il default: chi
        // scrive `SWS_AI_FORNITORE=gemini` deve accorgersene.
        assert_eq!(Fornitore::da_nome("gemini"), None);
    }

    /// I file delle chiavi non si mescolano: una chiave di Kimi in
    /// `anthropic.key` non deve finire su api.anthropic.com.
    #[test]
    fn ogni_fornitore_cerca_il_suo_file() {
        let d = std::path::Path::new("/tmp/conf");
        let a = percorsi_chiave_di(d, Fornitore::Anthropic);
        let k = percorsi_chiave_di(d, Fornitore::Kimi);
        assert!(a.iter().all(|p| p.ends_with("anthropic.key")));
        assert!(k.iter().all(|p| p.ends_with("kimi.key")));
        let tutti = percorsi_chiave(d);
        assert!(tutti.len() >= a.len() + k.len());
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
