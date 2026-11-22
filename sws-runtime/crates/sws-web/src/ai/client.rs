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

pub use crate::ai::user_keys::UserKeys;

use crate::ai::local_http;

/// Il modello di riferimento. Opus 5.5 (03-11-2026, era Opus 5): contesto da 1M,
/// pensiero sempre acceso, e costa meno (4 $ e 20 $ per Mtok contro 5 e 25). Il
/// suo `effort` di default è `medium`: qui lo si manda sempre esplicito, `high`.
pub const MODEL: &str = "claude-opus-5-5";
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
    /// Mistral AI (France): the first provider of the second protocol, OpenAI-
    /// style chat completions (plan `2026-11-10-assistente-secondo-giro`, G4).
    Mistral,
    /// A model the customer serves themselves (Ollama, vLLM, LM Studio,
    /// llama.cpp) behind an OpenAI-compatible endpoint: its address comes from
    /// [`Scelta::endpoint`], never from here.
    Local,
}

/// How a provider is spoken to. The rest of the assistant only knows the
/// Messages format: [`Protocol::ChatCompletions`] is translated at the border,
/// in `ai/chat_completions.rs`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Protocol {
    Messages,
    ChatCompletions(&'static crate::ai::chat_completions::Dialect),
}

impl Fornitore {
    pub fn nome(self) -> &'static str {
        match self {
            Fornitore::Anthropic => "anthropic",
            Fornitore::Kimi => "kimi",
            Fornitore::Mistral => "mistral",
            Fornitore::Local => "local",
        }
    }

    pub fn protocol(self) -> Protocol {
        match self {
            Fornitore::Anthropic | Fornitore::Kimi => Protocol::Messages,
            Fornitore::Mistral => Protocol::ChatCompletions(&crate::ai::chat_completions::MISTRAL),
            Fornitore::Local => Protocol::ChatCompletions(&crate::ai::chat_completions::LOCAL),
        }
    }

    fn endpoint(self) -> &'static str {
        match self {
            Fornitore::Anthropic => "https://api.anthropic.com/v1/messages",
            Fornitore::Kimi => "https://api.moonshot.ai/anthropic/v1/messages",
            Fornitore::Mistral => crate::ai::chat_completions::MISTRAL.endpoint,
            Fornitore::Local => crate::ai::chat_completions::LOCAL.endpoint,
        }
    }

    pub fn modello_default(self) -> &'static str {
        match self {
            Fornitore::Anthropic => MODEL,
            Fornitore::Kimi => "kimi-k3",
            // The alias of their flagship: on 16-11-2026 it is Mistral Large 4
            // (out on 05-11-2026; Large 3, `mistral-large-2512`, is deprecated
            // since 31-10-2026). The alias moves with the releases, and the
            // price table knows it by this name.
            Fornitore::Mistral => "mistral-large-latest",
            // No default: the customer's server serves what it serves.
            Fornitore::Local => "",
        }
    }

    /// La variabile d'ambiente da cui si prende la chiave. Per Kimi sono due:
    /// `MOONSHOT_API_KEY` è quella dei loro esempi, `KIMI_API_KEY` quella che
    /// chiunque proverebbe per prima.
    fn env_chiave(self) -> &'static [&'static str] {
        match self {
            Fornitore::Anthropic => &["ANTHROPIC_API_KEY"],
            Fornitore::Kimi => &["MOONSHOT_API_KEY", "KIMI_API_KEY"],
            Fornitore::Mistral => &["MISTRAL_API_KEY"],
            Fornitore::Local => &[],
        }
    }

    pub fn file_chiave(self) -> &'static str {
        match self {
            Fornitore::Anthropic => "anthropic.key",
            Fornitore::Kimi => "kimi.key",
            Fornitore::Mistral => "mistral.key",
            Fornitore::Local => "local.key",
        }
    }

    /// Dove chiedere il saldo dell'account, per chi lo espone (Q41).
    /// Anthropic NON lo espone con la chiave d'uso — l'Admin API ha solo
    /// report di costo, con una chiave diversa — quindi qui è `None` e la
    /// voce «credito» semplicemente non esiste per quel fornitore: una
    /// casella vuota per metà degli utenti è peggio che non averla (scheda).
    pub fn url_saldo(self) -> Option<&'static str> {
        match self {
            Fornitore::Anthropic | Fornitore::Mistral | Fornitore::Local => None,
            Fornitore::Kimi => Some("https://api.moonshot.ai/v1/users/me/balance"),
        }
    }

    /// Anthropic vuole `x-api-key` + `anthropic-version`; Kimi vuole
    /// `Authorization: Bearer` e **rifiuta** di aver bisogno degli altri due.
    fn bearer(self) -> bool {
        matches!(
            self,
            Fornitore::Kimi | Fornitore::Mistral | Fornitore::Local
        )
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
            "mistral" | "mistralai" => Some(Fornitore::Mistral),
            "local" => Some(Fornitore::Local),
            _ => None,
        }
    }
}

/// Con chi si parla e con che chiave. `modello` è già risolto: il default del
/// fornitore, o quello che ha imposto `SWS_AI_MODELLO`.
/// Il saldo disponibile sull'account del fornitore, se il fornitore lo
/// espone (Q41). Forma Moonshot: `{"data": {"available_balance": …}}`.
/// Ogni errore diventa `None`: il saldo è un'informazione di cortesia e non
/// deve mai bloccare o sporcare la chat.
pub async fn saldo(scelta: &Scelta) -> Option<f64> {
    let url = scelta.fornitore.url_saldo()?;
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;
    let v: Value = http
        .get(url)
        .header("Authorization", format!("Bearer {}", scelta.chiave))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;
    v.get("data")?.get("available_balance")?.as_f64()
}

/// Where the key in use comes from: the project's own (file or environment, as
/// it always was) or the user's, asked to the gateway (15-11-2026).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeySource {
    Project,
    User,
}

impl KeySource {
    pub fn name(self) -> &'static str {
        match self {
            KeySource::Project => "project",
            KeySource::User => "user",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Scelta {
    pub fornitore: Fornitore,
    pub chiave: String,
    pub source: KeySource,
    pub modello: String,
    /// Quanto può spendere una conversazione, in dollari, prima che il giro
    /// successivo si rifiuti di partire. Vedi [`tetto_usd`].
    pub tetto_usd: f64,
    /// The chat-completions URL chosen by the customer (the local model).
    /// `None` = the provider's own, fixed one: see [`chat_url`].
    pub endpoint: Option<String>,
    /// The model accepts images. Always true for the cloud providers; a local
    /// model may be text-only, and then the images of the history are replaced
    /// by a line of text before the request leaves.
    pub sees_images: bool,
}

/// Where a chat-completions request goes: the customer's address if the choice
/// has one, the dialect's otherwise (the fake providers of the tests pass
/// their own dialect, and must keep working).
pub(crate) fn chat_url<'a>(
    scelta: &'a Scelta,
    d: &'a crate::ai::chat_completions::Dialect,
) -> &'a str {
    scelta.endpoint.as_deref().unwrap_or(d.endpoint)
}

/// Il tetto di default di una conversazione. Una pagina intera generata con i
/// suoi simboli è stimata fra 3 e 6 $; 10 lascia il margine per una correzione
/// e ferma un modello che gira a vuoto prima che costi davvero.
pub const TETTO_DEFAULT_USD: f64 = 10.0;

/// Il tetto effettivo: `SWS_AI_TETTO_USD`, poi `ai.yaml`, poi il default.
/// Un valore non positivo o illeggibile vale come assente: un tetto a zero
/// spegnerebbe la chat senza dire perché.
pub fn tetto_usd(salvato: Option<f64>) -> f64 {
    std::env::var("SWS_AI_TETTO_USD")
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .or(salvato)
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(TETTO_DEFAULT_USD)
}

/// Prezzi in dollari per milione di token: ingresso, uscita, lettura e
/// scrittura della cache (5 minuti).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Prezzi {
    pub ingresso: f64,
    pub uscita: f64,
    pub cache_lettura: f64,
    pub cache_scrittura: f64,
}

/// The built-in price list: the models it knows by exact id, with their
/// provider. [`prezzi`] reads it, and the price list file
/// (`crate::ai::price_list`) lists it as the last of its layers.
pub(crate) fn builtin_rows() -> Vec<(Fornitore, &'static str, Prezzi)> {
    let p = |i: f64, u: f64, l: f64| Prezzi {
        ingresso: i,
        uscita: u,
        cache_lettura: l,
        cache_scrittura: i * 1.25,
    };
    let kimi = |i: f64, u: f64, l: f64| Prezzi {
        cache_scrittura: i,
        ..p(i, u, l)
    };
    let mut rows = vec![(Fornitore::Anthropic, "claude-opus-5-5", p(4.0, 20.0, 0.20))];
    for id in [
        "claude-opus-5",
        "claude-opus-4-8",
        "claude-opus-4-7",
        "claude-opus-4-6",
    ] {
        rows.push((Fornitore::Anthropic, id, p(5.0, 25.0, 0.50)));
    }
    rows.extend([
        // Sonnet 5.5 reads its cache at 0.05 times the input, Sonnet 5 at 0.1
        // (Anthropic's list and models.dev, 17-11-2026).
        (
            Fornitore::Anthropic,
            "claude-sonnet-5-5",
            p(2.0, 10.0, 0.10),
        ),
        (Fornitore::Anthropic, "claude-sonnet-5", p(2.0, 10.0, 0.20)),
        (
            Fornitore::Anthropic,
            "claude-fable-5-1",
            p(10.0, 50.0, 0.25),
        ),
        (Fornitore::Anthropic, "claude-fable-5", p(10.0, 50.0, 0.25)),
        // Its dearer tier above 100k tokens is in `builtin_tier`.
        (
            Fornitore::Anthropic,
            "claude-haiku-5-5",
            p(0.10, 0.50, 0.01),
        ),
        // Kimi, from Moonshot's list (platform.kimi.ai/docs/pricing/chat, read
        // on 16-11-2026): input, output, cached input per MTok. Unlike
        // Anthropic, writing the cache with the default 5-minute TTL costs
        // the plain input price, not 1.25 times it.
        (Fornitore::Kimi, "kimi-k3", kimi(3.0, 15.0, 0.30)),
        (Fornitore::Kimi, "kimi-k3.1-pro", kimi(2.0, 10.0, 0.20)),
        (
            Fornitore::Kimi,
            "kimi-k3.1-pro-highspeed",
            kimi(4.0, 20.0, 0.20),
        ),
        // Mistral (docs.mistral.ai/inference/pricing, 16-11-2026). Large 4:
        // 0.7 $ and 2.1 $, cached input 0.07 $. Small 4: 0.15 $ and 0.6 $,
        // cached 0.015 $. Large 3 (deprecated, retired on 30-04-2027): 0.5 $
        // and 1.5 $, its cache at a tenth like the others.
        (
            Fornitore::Mistral,
            "mistral-large-latest",
            p(0.7, 2.1, 0.07),
        ),
        (
            Fornitore::Mistral,
            "mistral-small-latest",
            p(0.15, 0.6, 0.015),
        ),
        (Fornitore::Mistral, "mistral-large-2512", p(0.5, 1.5, 0.05)),
    ]);
    rows
}

/// The dearer tier of a built-in model: from how many input tokens (input,
/// cache read and cache write of one request) and at which prices, all four
/// of them. Haiku 5.5 above 100k tokens, from models.dev on 17-11-2026.
pub fn builtin_tier(model: &str) -> Option<(u64, Prezzi)> {
    match model.trim().to_ascii_lowercase().as_str() {
        "claude-haiku-5-5" => Some((
            100_000,
            Prezzi {
                ingresso: 0.5,
                uscita: 2.5,
                cache_lettura: 0.05,
                cache_scrittura: 0.625,
            },
        )),
        _ => None,
    }
}

/// I prezzi di un modello, e se sono noti o stimati. Un modello che la tabella
/// non conosce si conta ai prezzi di Opus 5: meglio un tetto che scatta un po'
/// prima che uno che non scatta mai.
///
/// One exception: an unlisted id of a Mistral family with a published price
/// counts at the price of that family, still as an estimate.
pub fn prezzi(modello: &str) -> (Prezzi, bool) {
    let p = |i: f64, u: f64, l: f64| Prezzi {
        ingresso: i,
        uscita: u,
        cache_lettura: l,
        cache_scrittura: i * 1.25,
    };
    let m = modello.trim().to_ascii_lowercase();
    if let Some((_, _, x)) = builtin_rows().into_iter().find(|(_, id, _)| *id == m) {
        return (x, true);
    }
    // Mistral lists many more ids than the three above (dated ids, the small
    // families), and the account can pick any of them: one of a family whose
    // price is published counts at that price, said to be an estimate. At the
    // prices of Opus 5 the chat would show about ten times the real cost and
    // the cap would stop the conversation after a tenth of it.
    let family = [
        ("mistral-large-", p(0.7, 2.1, 0.07)),
        ("mistral-small-", p(0.15, 0.6, 0.015)),
        ("codestral-", p(0.3, 0.9, 0.03)),
        // Ministral 3 comes in three sizes: the dearest one (14B).
        ("ministral-", p(0.2, 0.2, 0.02)),
    ]
    .into_iter()
    .find(|(prefix, _)| m.starts_with(prefix));
    match family {
        Some((_, x)) => (x, false),
        // Anything else, Mistral's unpriced families included (Medium,
        // Magistral, Devstral, Pixtral: deprecated, no price on the page).
        None => (p(5.0, 25.0, 0.50), false),
    }
}

/// The prices of a model **of a provider**, and whether they are known. The
/// table of [`prezzi`] knows models by name only, and would charge an unknown
/// local model (`qwen3:32b`) at the prices of Opus: a free model would then
/// show a false cost and stop at the spending cap. A local model costs nothing,
/// and that is known.
pub fn prezzi_per(fornitore: Fornitore, modello: &str) -> (Prezzi, bool) {
    match fornitore {
        Fornitore::Local => (
            Prezzi {
                ingresso: 0.0,
                uscita: 0.0,
                cache_lettura: 0.0,
                cache_scrittura: 0.0,
            },
            true,
        ),
        _ => prezzi(modello),
    }
}

/// Quanto è costato un turno, dall'`usage` della risposta. I token di cache
/// hanno il loro prezzo: contarli come ingresso pieno gonfierebbe il costo di
/// dieci volte proprio quando la cache funziona.
///
/// This is the built-in table only; the runtime charges through
/// `crate::ai::price_list::cost_usd`, which reads the price list file first.
pub fn costo_usd(fornitore: Fornitore, modello: &str, usage: &Value) -> f64 {
    let (p, _) = prezzi_per(fornitore, modello);
    let tier = match fornitore {
        Fornitore::Local => None,
        _ => builtin_tier(modello),
    };
    cost_of(p, tier, usage)
}

/// The cost of one request at `base` prices, or at the tier's when the request
/// reaches it. The threshold counts all the input of the request (plain, cache
/// read, cache write), and above it the tier prices every item, output too:
/// that is how the providers bill a long context.
pub fn cost_of(base: Prezzi, tier: Option<(u64, Prezzi)>, usage: &Value) -> f64 {
    let tok = |c: &str| usage.get(c).and_then(Value::as_u64).unwrap_or(0);
    let input =
        tok("input_tokens") + tok("cache_read_input_tokens") + tok("cache_creation_input_tokens");
    let p = match tier {
        Some((above, t)) if input > above => t,
        _ => base,
    };
    let tok = |c: &str| tok(c) as f64;
    (tok("input_tokens") * p.ingresso
        + tok("output_tokens") * p.uscita
        + tok("cache_read_input_tokens") * p.cache_lettura
        + tok("cache_creation_input_tokens") * p.cache_scrittura)
        / 1_000_000.0
}

/// Una domanda sola, senza streaming e senza strumenti.
///
/// Esiste perché la traduzione automatica (`crate::traduttore`) ha bisogno di
/// parlare col fornitore configurato, e duplicare lì la scelta
/// endpoint/intestazioni vorrebbe dire due punti che sanno come ci si
/// autentica — cioè due punti che un giorno divergono. Qui c'è già tutto:
/// `endpoint()` e `bearer()` restano privati.
pub async fn chiedi_una_volta(
    client: &reqwest::Client,
    scelta: &Scelta,
    istruzioni: &str,
    domanda: &str,
    max_tokens: u32,
) -> anyhow::Result<String> {
    let messaggi = [serde_json::json!({ "role": "user", "content": domanda })];
    chiedi_con_uso(client, scelta, istruzioni, &messaggi, max_tokens)
        .await
        .map(|(testo, _)| testo)
}

/// Come [`chiedi_una_volta`], con una conversazione intera e l'`usage` della
/// risposta: serve a chi deve contare quanto costa (il disegno dei simboli col
/// suo modello, 04-11-2026, entra nel tetto della conversazione).
pub async fn chiedi_con_uso(
    client: &reqwest::Client,
    scelta: &Scelta,
    istruzioni: &str,
    messaggi: &[serde_json::Value],
    max_tokens: u32,
) -> anyhow::Result<(String, serde_json::Value)> {
    ask_shaped(client, scelta, istruzioni, messaggi, max_tokens, None).await
}

/// [`chiedi_con_uso`] with the answer held to a JSON schema where that holds:
/// a local server (Ollama, llama.cpp, vLLM) turns the schema into a grammar,
/// and the model cannot write anything else. On 20-11-2026 qwen3.5:9b wrote a
/// readable symbol 0 times in 8 without it, 8 in 8 with it. A cloud model is
/// not sent the schema: the instructions say the format, and it follows them.
pub async fn ask_shaped(
    client: &reqwest::Client,
    scelta: &Scelta,
    istruzioni: &str,
    messaggi: &[serde_json::Value],
    max_tokens: u32,
    shape: Option<&Value>,
) -> anyhow::Result<(String, serde_json::Value)> {
    if let Protocol::ChatCompletions(d) = scelta.fornitore.protocol() {
        return ask_chat_once(client, scelta, d, istruzioni, messaggi, max_tokens, shape).await;
    }
    let corpo = serde_json::json!({
        "model": scelta.modello,
        "max_tokens": max_tokens,
        "system": istruzioni,
        "messages": messaggi,
    });
    let mut req = client.post(scelta.fornitore.endpoint()).json(&corpo);
    req = if scelta.fornitore.bearer() {
        req.header("Authorization", format!("Bearer {}", scelta.chiave))
    } else {
        req.header("x-api-key", &scelta.chiave)
            .header("anthropic-version", VERSIONE)
    };
    let resp = req
        .send()
        .await
        .map_err(|e| errore_di_invio(scelta, &e))?;
    let stato = resp.status();
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("risposta {stato} in un formato ignoto: {e}"))?;
    if let Some(err) = v
        .get("error")
        .and_then(|e| e.get("message"))
        .and_then(|m| m.as_str())
    {
        anyhow::bail!("{} ha rifiutato ({stato}): {err}", scelta.fornitore.nome());
    }
    let testo = v
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|a| {
            a.iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                .find_map(|b| b.get("text"))
                .and_then(|t| t.as_str())
        })
        .map(|s| s.trim().to_string())
        .ok_or_else(|| senza_testo(scelta, max_tokens, &v))?;
    Ok((testo, v.get("usage").cloned().unwrap_or_default()))
}

/// The error of a request that did not get its answer (collaudo of 2.26.0-rc.23,
/// anomaly 8): a deadline said «Kimi non raggiungibile», which was false — the
/// provider was there, and was still thinking. reqwest keeps the cause in the
/// chain, not in its `Display`.
fn errore_di_invio(scelta: &Scelta, e: &reqwest::Error) -> anyhow::Error {
    let nome = scelta.fornitore.nome();
    if e.is_timeout() {
        tracing::warn!(fornitore = nome, modello = %scelta.modello, "AI request: deadline reached");
        anyhow::anyhow!(
            "{nome} ({}) non ha finito in tempo: la risposta richiede più del tempo concesso — riprova, o scegli un modello più rapido per questo scopo",
            scelta.modello
        )
    } else {
        anyhow::anyhow!("{nome} non raggiungibile: {e}")
    }
}

/// The error for an answer with no text block, saying why (22-11-2026): Kimi,
/// drawing a stove at the third attempt, answered with no text and the editor
/// said only «nessun testo nella risposta di kimi» — not why, and nothing in
/// the log. Usually a reasoning model that spent every token thinking
/// (`stop_reason: max_tokens` with only `thinking` blocks).
fn senza_testo(scelta: &Scelta, max_tokens: u32, v: &Value) -> anyhow::Error {
    let stop = v.get("stop_reason").and_then(Value::as_str).unwrap_or("?");
    let blocchi: Vec<&str> = v
        .get("content")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|b| b.get("type").and_then(Value::as_str)).collect())
        .unwrap_or_default();
    tracing::warn!(
        fornitore = scelta.fornitore.nome(),
        modello = %scelta.modello,
        stop_reason = stop,
        blocchi = ?blocchi,
        usage = %v.get("usage").cloned().unwrap_or_default(),
        "AI answer without text"
    );
    let nome = scelta.fornitore.nome();
    if stop == "max_tokens" {
        anyhow::anyhow!(
            "{nome} ({}) ha finito i token ({max_tokens}) prima di scrivere la risposta{}",
            scelta.modello,
            if blocchi.contains(&"thinking") { ", ragionando" } else { "" }
        )
    } else {
        anyhow::anyhow!(
            "nessun testo nella risposta di {nome} ({}): stop_reason «{stop}», blocchi {blocchi:?}",
            scelta.modello
        )
    }
}

/// [`chiedi_con_uso`] for the chat-completions providers: same question, same
/// answer shape (the usage in the Messages format).
async fn ask_chat_once(
    client: &reqwest::Client,
    scelta: &Scelta,
    d: &crate::ai::chat_completions::Dialect,
    instructions: &str,
    messages: &[Value],
    max_tokens: u32,
    shape: Option<&Value>,
) -> Result<(String, Value)> {
    use crate::ai::chat_completions as cc;
    let system = [json!({ "type": "text", "text": instructions })];
    let messages = cc::images_for(scelta.sees_images, messages);
    let mut body = cc::request_body(
        d,
        &scelta.modello,
        &system,
        &messages,
        &[],
        false,
        max_tokens,
    );
    // A local model that reasons (qwen3, deepseek-r1…) spends the budget of a
    // single answer thinking, and the answer comes back empty: on 20-11-2026
    // qwen3.5:9b asked for a symbol thought for 8192 tokens, three minutes,
    // and wrote nothing. Here nobody sees the reasoning, so it is not asked
    // for; a server that does not know the value refuses it (vLLM), and the
    // question leaves again without it.
    let mut no_reasoning = scelta.fornitore == Fornitore::Local;
    if no_reasoning {
        body["reasoning_effort"] = json!("none");
    }
    let mut shaped = false;
    if let (Fornitore::Local, Some(schema)) = (scelta.fornitore, shape) {
        shaped = true;
        body["response_format"] = json!({ "type": "json_schema", "json_schema": {
            "name": "answer", "strict": true, "schema": schema } });
    }
    let name = scelta.fornitore.nome();
    let url = chat_url(scelta, d);
    // The local model only: a cloud provider says when a request is too long.
    let (needed, check_after) = match scelta.fornitore {
        Fornitore::Local => {
            let needed = local_http::needed_tokens(
                system.iter().chain(messages.iter()),
                max_tokens.min(d.max_output_tokens),
            );
            let after = local_http::context_before(client, url, &scelta.modello, needed).await?;
            (needed, after)
        }
        _ => (0, false),
    };
    let v = loop {
        let resp = client
            .post(url)
            .header("Authorization", format!("Bearer {}", scelta.chiave))
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("{name} unreachable: {e}"))?;
        let status = resp.status();
        let v: Value = resp
            .json()
            .await
            .map_err(|e| anyhow::anyhow!("answer {status} in an unknown format: {e}"))?;
        if status.is_success() {
            break v;
        }
        let msg = cc::error_message(&v).unwrap_or_default();
        if no_reasoning && status == reqwest::StatusCode::BAD_REQUEST && msg.contains("reasoning") {
            no_reasoning = false;
            if let Some(o) = body.as_object_mut() {
                o.remove("reasoning_effort");
            }
            continue;
        }
        // A server without structured answers: the question again, held by
        // the instructions only.
        if shaped
            && status == reqwest::StatusCode::BAD_REQUEST
            && ["response_format", "json_schema", "grammar"]
                .iter()
                .any(|w| msg.contains(w))
        {
            shaped = false;
            if let Some(o) = body.as_object_mut() {
                o.remove("response_format");
            }
            continue;
        }
        bail!("{name} refused ({status}): {msg}");
    };
    if check_after {
        local_http::context_after(client, url, &scelta.modello, needed).await?;
    }
    cc::parse_single(&v).with_context(|| format!("answer of {name}"))
}

/// Quanto può scrivere il modello in un turno. Alto perché una proposta con
/// una pagina intera, i suoi simboli e il pensiero è lunga: a 16000 una pagina
/// da sessanta oggetti si troncava. Con lo streaming non rischia il timeout HTTP.
const MAX_TOKENS: u32 = 64000;

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
        v.push(
            PathBuf::from(home)
                .join(".config/sws")
                .join(f.file_chiave()),
        );
    }
    v
}

/// Tutti i percorsi, di tutti i fornitori: è l'elenco che il pannello mostra
/// quando la chat è spenta, e deve dire *tutte* le strade, non una.
///
/// Not `local.key`: a key alone does not turn the local model on (it wants an
/// address and a model, in the AI menu), and listing it would say otherwise.
pub fn percorsi_chiave(config_dir: &Path) -> Vec<PathBuf> {
    let mut v = percorsi_chiave_di(config_dir, Fornitore::Anthropic);
    v.extend(percorsi_chiave_di(config_dir, Fornitore::Kimi));
    v.extend(percorsi_chiave_di(config_dir, Fornitore::Mistral));
    v
}

pub(crate) fn chiave_di(config_dir: &Path, f: Fornitore) -> Option<String> {
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
        if let Some(k) = crate::segreti::leggi_chiave(&p) {
            tracing::info!(fornitore = f.nome(), path = %p.display(), "chiave caricata");
            return Some(k);
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
    let p = crate::segreti::scrivi_chiave(config_dir, f.file_chiave(), chiave)?;
    tracing::info!(fornitore = f.nome(), path = %p.display(), "chiave salvata");
    Ok(())
}

/// Cancella la chiave di un fornitore. `Ok(false)` = non c'era, che non è un
/// errore: cancellare due volte deve poter succedere senza spaventare nessuno.
pub fn cancella_chiave(config_dir: &Path, f: Fornitore) -> std::io::Result<bool> {
    let cera = crate::segreti::cancella_chiave(config_dir, f.file_chiave())?;
    if cera {
        tracing::info!(fornitore = f.nome(), "chiave cancellata");
    }
    Ok(cera)
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
    carica_con(config_dir, &UserKeys::default())
}

/// The key of a provider: the project's first, then the user's. `None` if
/// neither has one.
pub(crate) fn resolve_key(
    config_dir: &Path,
    f: Fornitore,
    user: &UserKeys,
) -> Option<(String, KeySource)> {
    // The local model exists only with its address and model: a `local.key`
    // alone must not turn it on, or the request would go to an empty URL. Its
    // key is optional, and never the account's (the account cannot reach a
    // model on the customer's network): without one, any word, because
    // Ollama wants a Bearer even if it reads none.
    if f == Fornitore::Local {
        local_cfg(config_dir)?;
        let key = chiave_di(config_dir, f).unwrap_or_else(|| "local".to_string());
        return Some((key, KeySource::Project));
    }
    chiave_di(config_dir, f)
        .map(|k| (k, KeySource::Project))
        .or_else(|| user.get(f).map(|k| (k.to_string(), KeySource::User)))
}

/// [`carica`] with the keys of the user who is writing, if the project has none
/// of its own for a provider. The project's key always wins.
pub fn carica_con(config_dir: &Path, user: &UserKeys) -> Option<Scelta> {
    let salvata = Impostazioni::carica(config_dir).assistente();

    // L'ambiente vince sul file, e la UI lo dice quando trova una variabile
    // impostata: senza quell'avviso, si configura dall'IDE, non cambia niente,
    // e non si capisce perché. La precedenza è questa e non l'inversa perché
    // una variabile d'ambiente è un'intenzione di chi ha avviato il processo —
    // uno script, un servizio systemd — e non va scavalcata da un file.
    let modello_env = std::env::var("SWS_AI_MODELLO")
        .ok()
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());
    // A model saved in `ai.yaml` belongs to the saved provider (Anthropic, the
    // first of the fixed order, when none is saved), as for the backgrounds:
    // the account's preference, or a provider reached because the saved one
    // has no key, must not get a model name of another provider. The local
    // model least of all: the customer's server would not know it.
    let fornitore_salvato = salvata.fornitore.as_deref().and_then(Fornitore::da_nome);
    let modello_salvato_per = |f: Fornitore| {
        salvata
            .modello
            .clone()
            .filter(|_| fornitore_salvato.unwrap_or(Fornitore::Anthropic) == f)
    };

    let da_ambiente = std::env::var("SWS_AI_FORNITORE")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let candidati: Vec<Fornitore> = match da_ambiente {
        Some(v) => match Fornitore::da_nome(&v) {
            Some(f) => vec![f],
            None => {
                tracing::warn!(value = %v, "SWS_AI_FORNITORE not recognised: \
                                            valid values `anthropic`, `kimi`, `mistral` or `local`");
                return None;
            }
        },
        None => match fornitore_salvato {
            Some(f) => vec![f],
            // Nessuna preferenza da nessuna parte: si prova Anthropic e poi
            // Kimi, così una macchina con due chiavi si comporta in modo
            // prevedibile invece di dipendere dall'ordine di lettura dei file.
            // Mistral after them: it is the newest, measured only on recorded
            // answers so far (G4). The local model last: it is there only
            // when someone configured it, and a key of the account must not
            // lose to a model nobody chose for this purpose.
            //
            // The provider the user prefers in their account goes first
            // (17-11-2026): environment > `ai.yaml` > account > fixed order.
            // Without a key it is just skipped, like any other here. Never the
            // local model: the account does not have it.
            None => {
                let preferito = user
                    .preferred_text()
                    .and_then(Fornitore::da_nome)
                    .filter(|f| *f != Fornitore::Local);
                preferito
                    .into_iter()
                    .chain(
                        [
                            Fornitore::Anthropic,
                            Fornitore::Kimi,
                            Fornitore::Mistral,
                            Fornitore::Local,
                        ]
                        .into_iter()
                        .filter(|f| Some(*f) != preferito),
                    )
                    .collect()
            }
        },
    };

    for f in candidati {
        if let Some((chiave, source)) = resolve_key(config_dir, f, user) {
            // The project's (or the environment's) model, then the one the
            // user prefers in their account, then the provider's default
            // (for the local model, the one saved with its address).
            let modello = modello_env
                .clone()
                .or_else(|| modello_salvato_per(f))
                .or_else(|| user.model_of(f.nome()).map(str::to_string))
                .unwrap_or_else(|| default_model_of(config_dir, f));
            let (endpoint, sees_images) = address_of(config_dir, f);
            return Some(Scelta {
                fornitore: f,
                chiave,
                source,
                modello,
                tetto_usd: tetto_usd(salvata.tetto_usd),
                endpoint,
                sees_images,
            });
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
    /// Il formato di prima del 04-11-2026: un fornitore solo, quello
    /// dell'assistente. Si legge ancora (è la configurazione di
    /// un'installazione, e chi ce l'ha non deve rifarla); si scrive sempre
    /// sotto `scopi`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fornitore: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modello: Option<String>,
    /// Il tetto di spesa per conversazione, in dollari. Assente = il default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tetto_usd: Option<f64>,
    /// Uno per scopo: `assistente`, `simboli`, `traduzione`, `sfondi`
    /// (`ai/scopi.rs`). Uno scopo assente ricade sull'assistente.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub scopi: std::collections::BTreeMap<String, crate::ai::scopi::ScopoCfg>,
    /// The model the customer serves themselves (plan
    /// `2026-11-17-ia-a-scelta-del-cliente`, F3). Here and not in `ScopoCfg`,
    /// whose `deny_unknown_fields` would make an older runtime drop the whole
    /// file after a downgrade. Its optional key is in `local.key`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local: Option<LocalCfg>,
}

/// Where the local model is and what it is: `url` is the base of the
/// OpenAI-compatible API (`http://localhost:11434/v1`), to which
/// `/chat/completions` and `/models` are added.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct LocalCfg {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub model: String,
    /// The model reads images: the page snapshot is offered. Off by default,
    /// since most local models are text-only and a refused image costs a turn.
    #[serde(default)]
    pub sees_images: bool,
}

impl LocalCfg {
    /// The base without a trailing slash; a whole chat URL pasted by mistake
    /// is brought back to its base.
    pub fn base(&self) -> &str {
        let u = self.url.trim().trim_end_matches('/');
        u.strip_suffix("/chat/completions").unwrap_or(u)
    }

    pub fn chat_url(&self) -> String {
        format!("{}/chat/completions", self.base())
    }

    /// Usable only with both: without an address there is nowhere to go, and
    /// without a model the server cannot know which one to run.
    pub fn usable(&self) -> bool {
        !self.base().is_empty() && !self.model.trim().is_empty()
    }
}

/// The local model, if it is configured with address and model.
pub fn local_cfg(config_dir: &Path) -> Option<LocalCfg> {
    Impostazioni::carica(config_dir)
        .local
        .filter(LocalCfg::usable)
}

/// The model of `f` when nobody chose one: the provider's default, or for the
/// local model the one saved with its address.
pub(crate) fn default_model_of(config_dir: &Path, f: Fornitore) -> String {
    match f {
        Fornitore::Local => local_cfg(config_dir)
            .map(|c| c.model.trim().to_string())
            .unwrap_or_default(),
        _ => f.modello_default().to_string(),
    }
}

/// The address and the eyes of a choice: the customer's for the local model,
/// the provider's own (and images seen) for the others.
pub(crate) fn address_of(config_dir: &Path, f: Fornitore) -> (Option<String>, bool) {
    match (f, local_cfg(config_dir)) {
        (Fornitore::Local, Some(c)) => (Some(c.chat_url()), c.sees_images),
        _ => (None, true),
    }
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
        self.content
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use"))
            .filter_map(|b| {
                Some((
                    b.get("id")?.as_str()?,
                    b.get("name")?.as_str()?,
                    b.get("input")?,
                ))
            })
            .collect()
    }

    /// Il testo visibile, concatenato.
    pub fn testo(&self) -> String {
        self.content
            .iter()
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
    StrumentoInizio {
        nome: String,
    },
    /// Un altro pezzo dell'input di quella chiamata: quanto è lungo finora.
    /// Una proposta su sei pagine sono minuti di input, e senza questo la chat
    /// restava ferma su «… valida» come se fosse morta (11-11-2026).
    StrumentoScrive {
        byte: usize,
    },
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
        // La cache automatica della conversazione: il punto di cache segue
        // l'ultimo blocco e avanza col dialogo. Senza, solo il prompt di
        // sistema era in cache e ogni giro pagava per intero tutto quello che
        // c'era prima — su una pagina da venticinque giri, la voce più cara.
        // Solo Anthropic: Kimi non lo dichiara.
        b["cache_control"] = json!({ "type": "ephemeral" });
    }
    b
}

/// Nessun timeout complessivo: un turno con pensiero adattivo può durare
/// minuti, e tagliarlo a metà è peggio che aspettarlo. Il timeout di
/// connessione resta, così un broker irraggiungibile non appende la chat per
/// sempre.
fn chat_http() -> reqwest::ClientBuilder {
    reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(15))
}

impl Cliente {
    pub fn new(scelta: Scelta) -> Self {
        Cliente {
            scelta,
            http: chat_http().build().expect("client HTTP"),
        }
    }

    /// The client of a running instance: an address chosen by the customer
    /// goes through [`crate::ai::local_http`], which in the cloud refuses the
    /// private ones. `in_cloud` = this is a container behind the gateway.
    pub fn for_instance(scelta: Scelta, in_cloud: bool) -> Result<Self, String> {
        let http = crate::ai::local_http::client_for(&scelta, in_cloud, chat_http())?;
        Ok(Cliente { scelta, http })
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
        let f = self.scelta.fornitore;
        if let Protocol::ChatCompletions(d) = f.protocol() {
            return self
                .chat_turn(d, &system, messages, tools, &mut on_event)
                .await;
        }
        let body = corpo_richiesta(&self.scelta, system, messages, tools);

        let mut req = self
            .http
            .post(f.endpoint())
            .header("content-type", "application/json");
        req = if f.bearer() {
            req.header("authorization", format!("Bearer {}", self.scelta.chiave))
        } else {
            req.header("x-api-key", &self.scelta.chiave)
                .header("anthropic-version", VERSIONE)
        };

        let resp = req
            .json(&body)
            .send()
            .await
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

    /// A turn with a chat-completions provider: the request translated out,
    /// the stream translated back. What comes out is the same [`Risposta`].
    async fn chat_turn(
        &self,
        d: &'static crate::ai::chat_completions::Dialect,
        system: &[Value],
        messages: &[Value],
        tools: &[Value],
        on_event: &mut impl FnMut(Evento),
    ) -> Result<Risposta> {
        use crate::ai::chat_completions as cc;
        let f = self.scelta.fornitore;
        let messages = cc::images_for(self.scelta.sees_images, messages);
        let body = cc::request_body(
            d,
            &self.scelta.modello,
            system,
            &messages,
            tools,
            true,
            MAX_TOKENS,
        );
        let url = chat_url(&self.scelta, d);
        // The local model only: a cloud provider says when a request is too
        // long. The tools count: their schemas are a good part of the prompt.
        let (needed, check_after) = match f {
            Fornitore::Local => {
                let needed = local_http::needed_tokens(
                    system.iter().chain(messages.iter()).chain(tools.iter()),
                    MAX_TOKENS.min(d.max_output_tokens),
                );
                let after =
                    local_http::context_before(&self.http, url, &self.scelta.modello, needed)
                        .await?;
                (needed, after)
            }
            _ => (0, false),
        };
        let resp = self
            .http
            .post(url)
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", self.scelta.chiave))
            .json(&body)
            .send()
            .await
            .with_context(|| format!("the request to {url} did not start"))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            // As for the other protocol: the code and the message, not the
            // whole body (it may echo the prompt).
            let short: String = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| cc::error_message(&v))
                .unwrap_or(text)
                .chars()
                .take(500)
                .collect();
            bail!("{} answered {status}: {short}", f.nome());
        }
        // The server answers once the model is loaded and the prompt read:
        // the stream is dropped here, before a word of an answer written on a
        // cut prompt reaches the chat.
        if check_after {
            local_http::context_after(&self.http, url, &self.scelta.modello, needed).await?;
        }
        cc::read_sse(resp, on_event).await
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
                let Some(dati) = grezzo
                    .lines()
                    .find_map(|l| l.strip_prefix("data:").map(str::trim))
                else {
                    continue;
                };
                if dati == "[DONE]" {
                    continue;
                }
                let Ok(ev): Result<Value, _> = serde_json::from_str(dati) else {
                    continue;
                };
                applica_evento(
                    &ev,
                    &mut blocchi,
                    &mut parziali,
                    &mut stop_reason,
                    &mut stop_details,
                    &mut usage,
                    on_event,
                );
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
                    serde_json::from_str(&testo).with_context(|| {
                        format!("argomenti dello strumento illeggibili: {testo}")
                    })?
                };
                b["input"] = parsed;
            }
        }

        if stop_reason == "refusal" {
            let categoria = stop_details
                .as_ref()
                .and_then(|d| d.get("category"))
                .and_then(Value::as_str)
                .unwrap_or("non specificata");
            bail!("il modello ha rifiutato la richiesta (categoria: {categoria})");
        }

        Ok(Risposta {
            content: blocchi,
            stop_reason,
            stop_details,
            usage,
        })
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
            let Some(blocco) = ev.get("content_block") else {
                return;
            };
            while blocchi.len() <= idx {
                blocchi.push(json!({}));
            }
            blocchi[idx] = blocco.clone();
            if blocco.get("type").and_then(Value::as_str) == Some("tool_use") {
                parziali.insert(idx, String::new());
                if let Some(nome) = blocco.get("name").and_then(Value::as_str) {
                    on_event(Evento::StrumentoInizio {
                        nome: nome.to_string(),
                    });
                }
            }
        }
        "content_block_delta" => {
            let Some(delta) = ev.get("delta") else { return };
            let Some(b) = blocchi.get_mut(idx) else {
                return;
            };
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
                        let parziale = parziali.entry(idx).or_default();
                        parziale.push_str(t);
                        on_event(Evento::StrumentoScrive {
                            byte: parziale.len(),
                        });
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
mod answer_without_text_tests {
    use super::*;

    fn kimi() -> Scelta {
        Scelta {
            fornitore: Fornitore::Kimi,
            chiave: "k".into(),
            source: KeySource::Project,
            modello: "kimi-k2.7-code".into(),
            tetto_usd: 1.0,
            endpoint: None,
            sees_images: false,
        }
    }

    #[test]
    fn an_answer_without_text_says_why() {
        let e = senza_testo(&kimi(), 16000, &serde_json::json!({
            "stop_reason": "max_tokens", "content": [{ "type": "thinking", "thinking": "…" }]
        }));
        let m = e.to_string();
        assert!(m.contains("finito i token (16000)") && m.contains("ragionando") && m.contains("kimi-k2.7-code"), "{m}");
        let m = senza_testo(&kimi(), 16000, &serde_json::json!({ "stop_reason": "end_turn", "content": [] })).to_string();
        assert!(m.contains("end_turn"), "{m}");
    }
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
            applica_evento(
                &ev,
                &mut blocchi,
                &mut parziali,
                &mut sr,
                &mut sd,
                &mut us,
                &mut on,
            );
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
            applica_evento(
                &ev,
                &mut blocchi,
                &mut parziali,
                &mut sr,
                &mut sd,
                &mut us,
                &mut on,
            );
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
        let b = corpo_richiesta(
            &scelta(Fornitore::Anthropic),
            prompt_finto(),
            &[json!({"role":"user","content":"ciao"})],
            &[json!({"name":"x"})],
        );

        assert_eq!(b["model"], "claude-opus-5-5");
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

    /// E la conversazione: senza la cache automatica ogni giro ripagava per
    /// intero tutto il dialogo precedente. A Kimi non si manda, perché non la
    /// dichiara.
    #[test]
    fn la_conversazione_e_in_cache_solo_su_anthropic() {
        let a = corpo_richiesta(&scelta(Fornitore::Anthropic), prompt_finto(), &[], &[]);
        assert_eq!(a["cache_control"]["type"], "ephemeral");
        let k = corpo_richiesta(&scelta(Fornitore::Kimi), prompt_finto(), &[], &[]);
        assert!(k.get("cache_control").is_none(), "corpo: {k}");
    }

    /// Il costo di un turno conta la cache al suo prezzo, non come ingresso
    /// pieno: è la differenza fra un tetto che scatta al momento giusto e uno
    /// che scatta dieci volte prima.
    #[test]
    fn il_costo_conta_la_cache_al_suo_prezzo() {
        let u = json!({ "input_tokens": 1_000_000, "output_tokens": 100_000,
                        "cache_read_input_tokens": 2_000_000,
                        "cache_creation_input_tokens": 400_000 });
        // Opus 5.5: 4 + 2 (uscita) + 0,4 (lettura) + 2 (scrittura a 1,25×).
        let c = costo_usd(Fornitore::Anthropic, "claude-opus-5-5", &u);
        assert!((c - 8.4).abs() < 1e-9, "costo {c}");
        // Un modello sconosciuto si conta come Opus 5, e lo si dice.
        let (p, noto) = prezzi("modello-del-futuro");
        assert!(!noto);
        assert_eq!(p, prezzi("claude-opus-5").0);
        assert!(prezzi("claude-opus-5").1);
    }

    /// The key test and the account's menu offer every chat model Mistral
    /// lists, not only the three in the table: an id of a priced family counts
    /// at the price of its family (as an estimate), not at those of Opus 5.
    #[test]
    fn an_unlisted_mistral_model_counts_at_the_price_of_its_family() {
        let large = prezzi("mistral-large-latest").0;
        let small = prezzi("mistral-small-latest").0;
        for (id, family) in [
            ("mistral-large-2610", large),
            ("Mistral-Large-4", large),
            ("mistral-small-2603", small),
        ] {
            let (p, known) = prezzi(id);
            assert_eq!(p, family, "{id}");
            assert!(!known, "{id}: a family price is an estimate");
        }
        // The exact entries still win over their family: Large 3 has its own price.
        let (p, known) = prezzi("mistral-large-2512");
        assert!(known);
        assert!(p.ingresso < large.ingresso);
        for id in ["codestral-latest", "codestral-2508", "ministral-8b-latest"] {
            let (p, known) = prezzi(id);
            assert!(!known, "{id}");
            assert!(p.ingresso <= 0.3 && p.uscita <= 0.9, "{id}: {p:?}");
        }
        // A million tokens in and a hundred thousand out on a dated Large: cents,
        // not the 7.5 $ of the Opus 5 fallback.
        let u = json!({ "input_tokens": 1_000_000, "output_tokens": 100_000 });
        let c = costo_usd(Fornitore::Mistral, "mistral-large-2610", &u);
        assert!((c - 0.91).abs() < 1e-9, "cost {c}");
        // A family with no published price keeps the cautious fallback, and so
        // does a name that only looks like one.
        for id in [
            "mistral-medium-latest",
            "magistral-medium-2509",
            "mistral-largest",
        ] {
            assert_eq!(prezzi(id), prezzi("modello-del-futuro"), "{id}");
        }
    }

    /// Kimi's prices are the list's, no longer Opus 5's by default: counted at
    /// 5 $ and 25 $, a conversation with `kimi-k3.1-pro` hit its cap when the
    /// real spending was 40 % of it.
    #[test]
    fn kimi_prices_come_from_the_list() {
        let (p, known) = prezzi("kimi-k3.1-pro");
        assert!(known);
        assert_eq!((p.ingresso, p.uscita, p.cache_lettura), (2.0, 10.0, 0.20));
        // A 5-minute cache write costs the plain input price.
        assert_eq!(p.cache_scrittura, 2.0);
        assert_eq!(prezzi("kimi-k3").0.cache_scrittura, 3.0);
        let u = json!({ "input_tokens": 1_000_000, "output_tokens": 100_000,
                        "cache_read_input_tokens": 1_000_000 });
        assert!((costo_usd(Fornitore::Kimi, "kimi-k3.1-pro", &u) - 3.2).abs() < 1e-9);
    }

    /// Il tetto: l'ambiente vince sul file, e un valore assurdo vale come
    /// assente invece di spegnere la chat.
    #[test]
    fn il_tetto_viene_dal_file_o_dal_default() {
        // Un test solo tocca SWS_AI_TETTO_USD, quindi nessuna gara fra test.
        std::env::remove_var("SWS_AI_TETTO_USD");
        assert_eq!(tetto_usd(None), TETTO_DEFAULT_USD);
        assert_eq!(tetto_usd(Some(3.0)), 3.0);
        assert_eq!(tetto_usd(Some(0.0)), TETTO_DEFAULT_USD);
        assert_eq!(tetto_usd(Some(-2.0)), TETTO_DEFAULT_USD);
        std::env::set_var("SWS_AI_TETTO_USD", "25");
        assert_eq!(tetto_usd(Some(3.0)), 25.0);
        std::env::remove_var("SWS_AI_TETTO_USD");
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
        assert!(
            i.fornitore.is_none(),
            "un file rotto non deve inventare un fornitore"
        );

        // E il giro completo.
        let i = Impostazioni {
            fornitore: Some("kimi".into()),
            modello: Some("kimi-k3".into()),
            tetto_usd: Some(4.5),
            ..Default::default()
        };
        i.salva(d.path()).unwrap();
        let letta = Impostazioni::carica(d.path());
        assert_eq!(letta.fornitore.as_deref(), Some("kimi"));
        assert_eq!(letta.modello.as_deref(), Some("kimi-k3"));
        assert_eq!(letta.tetto_usd, Some(4.5));
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
        assert_eq!(
            modo, 0o600,
            "permessi {modo:o}: la chiave sarebbe leggibile da altri"
        );
        // Gli spazi intorno si tolgono: una chiave copiata da un terminale ne
        // porta spesso uno, e il fornitore rifiuterebbe l'intestazione.
        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            "unachiaveabbastanzalunga"
        );
        assert!(ha_chiave(d.path(), Fornitore::Kimi));
        // E non finisce nel file dell'altro fornitore.
        assert!(!ha_chiave(d.path(), Fornitore::Anthropic));
    }

    /// Cancellare due volte deve poter succedere senza spaventare nessuno.
    #[test]
    fn cancellare_una_chiave_che_non_c_e_non_e_un_errore() {
        let d = tempfile::tempdir().unwrap();
        assert!(
            !cancella_chiave(d.path(), Fornitore::Kimi).unwrap(),
            "non c'era: false"
        );
        salva_chiave(d.path(), Fornitore::Kimi, "unachiaveabbastanzalunga").unwrap();
        assert!(
            cancella_chiave(d.path(), Fornitore::Kimi).unwrap(),
            "c'era: true"
        );
        assert!(
            !cancella_chiave(d.path(), Fornitore::Kimi).unwrap(),
            "e ora non più"
        );
    }

    #[test]
    fn the_projects_key_wins_and_the_users_fills_the_gap() {
        let d = tempfile::tempdir().unwrap();
        // The machine of the one who runs the tests may have keys of its own
        // (environment, `~/.config/sws`): then there is nothing to prove here.
        if chiave_di(d.path(), Fornitore::Kimi).is_some()
            || chiave_di(d.path(), Fornitore::Anthropic).is_some()
            || std::env::var_os("SWS_AI_FORNITORE").is_some()
        {
            return;
        }
        let user = UserKeys::from_pairs([
            (Fornitore::Kimi, "sk-user-kimi".to_string()),
            (Fornitore::Anthropic, "sk-user-ant".to_string()),
        ]);
        // The project has none: the user's.
        assert_eq!(
            resolve_key(d.path(), Fornitore::Kimi, &user),
            Some(("sk-user-kimi".into(), KeySource::User))
        );
        // The project writes its own for Kimi: it wins, Anthropic stays the user's.
        salva_chiave(d.path(), Fornitore::Kimi, "sk-project-kimi").unwrap();
        assert_eq!(
            resolve_key(d.path(), Fornitore::Kimi, &user),
            Some(("sk-project-kimi".into(), KeySource::Project))
        );
        assert_eq!(
            resolve_key(d.path(), Fornitore::Anthropic, &user),
            Some(("sk-user-ant".into(), KeySource::User))
        );
        // Without the user, as before: the project's, or nothing.
        let none = UserKeys::default();
        assert_eq!(
            resolve_key(d.path(), Fornitore::Kimi, &none),
            Some(("sk-project-kimi".into(), KeySource::Project))
        );
        assert_eq!(resolve_key(d.path(), Fornitore::Anthropic, &none), None);
        // No preference anywhere: Anthropic first, and here it is the user's.
        let choice = carica_con(d.path(), &user).unwrap();
        assert_eq!(
            (choice.fornitore, choice.source),
            (Fornitore::Anthropic, KeySource::User)
        );
        // And with no user: Kimi, the project's.
        let choice = carica(d.path()).unwrap();
        assert_eq!(
            (choice.fornitore, choice.source),
            (Fornitore::Kimi, KeySource::Project)
        );
    }

    /// The provider preferred in the account (17-11-2026): it beats the fixed
    /// order, loses to `ai.yaml`, is skipped without a key, and does not get a
    /// model the project saved for another provider.
    #[test]
    fn the_account_preference_beats_the_fixed_order_and_loses_to_the_project() {
        let d = tempfile::tempdir().unwrap();
        if std::env::var_os("SWS_AI_FORNITORE").is_some()
            || std::env::var_os("SWS_AI_MODELLO").is_some()
            || [Fornitore::Anthropic, Fornitore::Kimi, Fornitore::Mistral]
                .iter()
                .any(|f| chiave_di(d.path(), *f).is_some())
        {
            return;
        }
        let keys = || {
            UserKeys::from_pairs([
                (Fornitore::Anthropic, "sk-user-ant".to_string()),
                (Fornitore::Mistral, "sk-user-mistral".to_string()),
            ])
        };
        let mistral_first = keys().with_preferences(Some("mistral".into()), None);
        // No choice of the project: the preference, not Anthropic.
        let sc = carica_con(d.path(), &mistral_first).unwrap();
        assert_eq!(
            (sc.fornitore, sc.chiave.as_str(), sc.modello.as_str()),
            (
                Fornitore::Mistral,
                "sk-user-mistral",
                Fornitore::Mistral.modello_default()
            )
        );
        // A model saved without a provider belongs to the first of the fixed
        // order: the preference does not get it.
        std::fs::write(
            Impostazioni::percorso(d.path()),
            "modello: claude-opus-5-5\n",
        )
        .unwrap();
        let sc = carica_con(d.path(), &mistral_first).unwrap();
        assert_eq!(
            (sc.fornitore, sc.modello.as_str()),
            (Fornitore::Mistral, Fornitore::Mistral.modello_default())
        );
        assert_eq!(
            carica_con(d.path(), &keys()).unwrap().modello,
            "claude-opus-5-5"
        );
        // The project's choice wins over the preference.
        std::fs::write(
            Impostazioni::percorso(d.path()),
            "scopi:\n  assistente: {fornitore: anthropic}\n",
        )
        .unwrap();
        assert_eq!(
            carica_con(d.path(), &mistral_first).unwrap().fornitore,
            Fornitore::Anthropic
        );
        // A preference without a key: the next of the fixed order that has one.
        std::fs::remove_file(Impostazioni::percorso(d.path())).unwrap();
        let kimi_first = keys().with_preferences(Some("kimi".into()), None);
        assert_eq!(
            carica_con(d.path(), &kimi_first).unwrap().fornitore,
            Fornitore::Anthropic
        );
        // Symbols and translation without a choice of their own follow it too.
        let t = crate::ai::scopi::carica_per_con(
            d.path(),
            crate::ai::scopi::Scopo::Traduzione,
            &mistral_first,
        )
        .unwrap();
        assert_eq!(t.fornitore, Fornitore::Mistral);
        // The local model is never a preference of the account.
        let local = keys().with_preferences(Some("local".into()), None);
        assert_eq!(
            carica_con(d.path(), &local).unwrap().fornitore,
            Fornitore::Anthropic
        );
    }

    fn scelta(f: Fornitore) -> Scelta {
        Scelta {
            fornitore: f,
            chiave: "k".into(),
            source: KeySource::Project,
            modello: f.modello_default().into(),
            tetto_usd: TETTO_DEFAULT_USD,
            endpoint: None,
            sees_images: true,
        }
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
            assert_eq!(
                k[campo], a[campo],
                "il campo `{campo}` non dovrebbe dipendere dal fornitore"
            );
        }
    }

    /// I due fornitori si autenticano in modo diverso, e sbagliarlo dà un 401
    /// che sembra «chiave sbagliata» invece di «header sbagliato».
    #[test]
    fn ognuno_ha_il_suo_header() {
        assert!(!Fornitore::Anthropic.bearer(), "Anthropic vuole x-api-key");
        assert!(Fornitore::Kimi.bearer(), "Kimi vuole Authorization: Bearer");
        assert!(
            Fornitore::Kimi
                .endpoint()
                .ends_with("/anthropic/v1/messages"),
            "l'endpoint compatibile di Kimi non è /v1/messages: {}",
            Fornitore::Kimi.endpoint()
        );
    }

    #[test]
    fn i_nomi_dei_fornitori_si_leggono_come_li_scriverebbe_una_persona() {
        assert_eq!(Fornitore::da_nome("kimi"), Some(Fornitore::Kimi));
        assert_eq!(Fornitore::da_nome("MOONSHOT"), Some(Fornitore::Kimi));
        assert_eq!(Fornitore::da_nome("claude"), Some(Fornitore::Anthropic));
        assert_eq!(
            Fornitore::da_nome(" Anthropic "),
            Some(Fornitore::Anthropic)
        );
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

    /// Mistral (G4): its own key file and variable, Bearer, the second
    /// protocol, and a price the cap can count on.
    #[test]
    fn mistral_is_a_provider_of_the_second_protocol() {
        assert_eq!(Fornitore::da_nome("Mistral"), Some(Fornitore::Mistral));
        assert_eq!(Fornitore::da_nome("mistralai"), Some(Fornitore::Mistral));
        assert_eq!(Fornitore::Mistral.nome(), "mistral");
        assert_eq!(Fornitore::Mistral.file_chiave(), "mistral.key");
        assert_eq!(Fornitore::Mistral.env_chiave(), &["MISTRAL_API_KEY"]);
        assert!(Fornitore::Mistral.bearer());
        assert!(Fornitore::Mistral.url_saldo().is_none());
        assert!(Fornitore::Mistral
            .endpoint()
            .ends_with("/v1/chat/completions"));
        assert!(matches!(
            Fornitore::Mistral.protocol(),
            Protocol::ChatCompletions(_)
        ));
        assert_eq!(Fornitore::Kimi.protocol(), Protocol::Messages);
        assert_eq!(Fornitore::Anthropic.protocol(), Protocol::Messages);
        let (p, known) = prezzi(Fornitore::Mistral.modello_default());
        assert!(known);
        assert!(p.ingresso < 1.0, "{p:?}");
        let d = std::path::Path::new("/tmp/conf");
        assert!(percorsi_chiave_di(d, Fornitore::Mistral)
            .iter()
            .all(|p| p.ends_with("mistral.key")));
        assert!(percorsi_chiave(d)
            .iter()
            .any(|p| p.ends_with("mistral.key")));
    }

    // ── The second protocol against a fake provider on localhost ──────────
    //
    // No key and no paid call: a local server answers in Mistral's shape, and
    // the turn goes through the real HTTP client, headers and stream reader.

    /// What the fake provider does with a request.
    #[derive(Clone, Copy)]
    enum Fake {
        /// The whole stream, in the pieces given.
        Stream(&'static [&'static str]),
        /// The pieces, then the connection drops.
        Dropped(&'static [&'static str]),
        /// An HTTP error with this JSON body.
        Refuse(u16, &'static str),
        /// A whole answer, not streamed.
        Single(&'static str),
    }

    type Seen = std::sync::Arc<std::sync::Mutex<Vec<(String, Value)>>>;

    /// Starts the fake provider; gives a dialect that points to it and what it
    /// received (the `authorization` header and the body of each request).
    async fn fake_provider(fake: Fake) -> (&'static crate::ai::chat_completions::Dialect, Seen) {
        use axum::body::Body;
        use axum::http::{header, HeaderMap, StatusCode};
        use axum::response::IntoResponse;
        let seen: Seen = Default::default();
        let seen2 = seen.clone();
        let app = axum::Router::new().route(
            "/v1/chat/completions",
            axum::routing::post(
                move |headers: HeaderMap, axum::Json(body): axum::Json<Value>| {
                    let seen = seen2.clone();
                    async move {
                        let auth = headers
                            .get(header::AUTHORIZATION)
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or_default()
                            .to_string();
                        seen.lock().unwrap().push((auth, body));
                        let sse = |pieces: &'static [&'static str], dropped: bool| {
                            let whole = futures_util::stream::iter(
                                pieces.iter().map(|p| std::io::Result::Ok(*p)),
                            );
                            // The drop comes a moment later: what was sent has
                            // the time to leave, as on a real line.
                            let end = futures_util::stream::once(async move {
                                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                                Err(std::io::Error::other("gone"))
                            })
                            .filter(move |_| std::future::ready(dropped));
                            (
                                [(header::CONTENT_TYPE, "text/event-stream")],
                                Body::from_stream(whole.chain(end)),
                            )
                                .into_response()
                        };
                        match fake {
                            Fake::Stream(p) => sse(p, false),
                            Fake::Dropped(p) => sse(p, true),
                            Fake::Refuse(code, body) => (
                                StatusCode::from_u16(code).unwrap(),
                                [(header::CONTENT_TYPE, "application/json")],
                                body,
                            )
                                .into_response(),
                            Fake::Single(body) => {
                                ([(header::CONTENT_TYPE, "application/json")], body).into_response()
                            }
                        }
                    }
                },
            ),
        );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        let d = crate::ai::chat_completions::Dialect {
            endpoint: Box::leak(format!("http://{addr}/v1/chat/completions").into_boxed_str()),
            ..crate::ai::chat_completions::MISTRAL
        };
        (Box::leak(Box::new(d)), seen)
    }

    /// A turn as Mistral streams it: text in two pieces, two tool calls (the
    /// arguments of the first split in the middle of a string, over three
    /// events and two network pieces), the usage on the last chunk, `[DONE]`.
    const MISTRAL_TURN: &[&str] = &[
        "data: {\"id\":\"c1\",\"object\":\"chat.completion.chunk\",\"model\":\"mistral-large-latest\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Leggo la pagina \"},\"finish_reason\":null}]}\n\ndata: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"e cerco la pompa.\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"aB3dE5gH7\",\"type\":\"function\",\"function\":{\"name\":\"leggi_pagina\",\"arguments\":\"{\\\"no\"}}]},\"finish_reason\":null}]}\n\ndata: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"argum",
        "ents\":\"me\\\": \\\"Indi\"}}]},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"catori\\\"}\"}},{\"index\":1,\"id\":\"zY9xW8vU7\",\"type\":\"function\",\"function\":{\"name\":\"cerca_simboli\",\"arguments\":\"{\\\"testo\\\": \\\"pompa\\\"}\"}}]},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"\"},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":9120,\"completion_tokens\":64,\"total_tokens\":9184}}\n\n",
        "data: [DONE]\n\n",
    ];

    #[tokio::test]
    async fn a_mistral_turn_through_the_real_reader() {
        let (d, seen) = fake_provider(Fake::Stream(MISTRAL_TURN)).await;
        let cliente = Cliente::new(Scelta {
            chiave: "sk-fake-mistral".into(),
            ..scelta(Fornitore::Mistral)
        });
        let messages = [json!({ "role": "user", "content": "Dov'è la pompa?" })];
        let tools = [json!({ "name": "leggi_pagina", "description": "d",
                             "input_schema": { "type": "object", "properties": {} } })];
        let mut events = Vec::new();
        let r = cliente
            .chat_turn(d, &prompt_finto(), &messages, &tools, &mut |e| {
                events.push(format!("{e:?}"))
            })
            .await
            .unwrap();

        assert_eq!(r.testo(), "Leggo la pagina e cerco la pompa.");
        assert_eq!(r.stop_reason, "tool_use");
        let uses = r.tool_uses();
        assert_eq!(uses.len(), 2);
        assert_eq!(
            (uses[0].0, uses[0].1, uses[0].2),
            (
                "aB3dE5gH7",
                "leggi_pagina",
                &json!({ "nome": "Indicatori" })
            )
        );
        assert_eq!(
            (uses[1].0, uses[1].1, uses[1].2),
            ("zY9xW8vU7", "cerca_simboli", &json!({ "testo": "pompa" }))
        );
        // The usage in the names the cost and the cap read.
        assert_eq!(r.usage["input_tokens"], 9120);
        assert_eq!(r.usage["output_tokens"], 64);
        assert!(costo_usd(Fornitore::Mistral, "mistral-large-latest", &r.usage) > 0.0);
        assert_eq!(
            events
                .iter()
                .filter(|e| e.starts_with("StrumentoInizio"))
                .count(),
            2
        );

        // What went out: Bearer, the model, the stream, and no field of the
        // Messages protocol.
        let seen = seen.lock().unwrap();
        let (auth, body) = &seen[0];
        assert_eq!(auth, "Bearer sk-fake-mistral");
        assert_eq!(body["model"], "mistral-large-latest");
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["tools"][0]["function"]["name"], "leggi_pagina");
        for f in ["system", "thinking", "output_config", "cache_control"] {
            assert!(body.get(f).is_none(), "`{f}` was sent");
        }
    }

    /// The model the account prefers (commit of 16-11-2026) reaches the request
    /// for Mistral as for the others: the key and the model of the user, with
    /// no key and no choice in the project.
    #[tokio::test]
    async fn the_account_model_and_key_reach_a_mistral_request() {
        let dir = tempfile::tempdir().unwrap();
        let user = UserKeys::from_entries([(
            "mistral",
            Some("sk-account-mistral".to_string()),
            Some("mistral-small-latest".to_string()),
        )]);
        // On a machine with keys or choices of its own (the environment, the
        // files in the home) another provider wins, rightly: there the choice
        // is not this test's case, the request still is.
        let own = ["SWS_AI_FORNITORE", "SWS_AI_MODELLO"]
            .iter()
            .any(|v| std::env::var(v).is_ok())
            || [Fornitore::Anthropic, Fornitore::Kimi, Fornitore::Mistral]
                .iter()
                .any(|f| chiave_di(dir.path(), *f).is_some());
        let sc = if own {
            Scelta {
                chiave: "sk-account-mistral".into(),
                source: KeySource::User,
                modello: "mistral-small-latest".into(),
                ..scelta(Fornitore::Mistral)
            }
        } else {
            carica_con(dir.path(), &user).expect("the user's key is enough")
        };
        assert_eq!(sc.fornitore, Fornitore::Mistral);
        assert_eq!(sc.source, KeySource::User);
        assert_eq!(sc.modello, "mistral-small-latest");
        assert!(prezzi(&sc.modello).1, "the cap knows its price");

        let (d, seen) = fake_provider(Fake::Stream(MISTRAL_TURN)).await;
        Cliente::new(sc)
            .chat_turn(
                d,
                &[],
                &[json!({ "role": "user", "content": "ciao" })],
                &[],
                &mut |_| {},
            )
            .await
            .unwrap();
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].0, "Bearer sk-account-mistral");
        assert_eq!(seen[0].1["model"], "mistral-small-latest");
    }

    const SOME_TEXT: &str = "data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Leggo la pagina \"},\"finish_reason\":null}]}\n\n";

    async fn mistral_turn(fake: Fake) -> Result<Risposta> {
        let (d, _) = fake_provider(fake).await;
        let messages = [json!({ "role": "user", "content": "ciao" })];
        Cliente::new(scelta(Fornitore::Mistral))
            .chat_turn(d, &[], &messages, &[], &mut |_| {})
            .await
    }

    #[tokio::test]
    async fn a_mistral_stream_that_stops_half_way_is_an_error() {
        // The connection drops in the middle of the arguments.
        const HALF_A_CALL: &[&str] = &[MISTRAL_TURN[0], MISTRAL_TURN[1], MISTRAL_TURN[2]];
        let e = mistral_turn(Fake::Dropped(HALF_A_CALL)).await.unwrap_err();
        assert!(format!("{e:#}").contains("interrupted"), "{e:#}");
        // The server closes cleanly, but the turn never ended: text only, and
        // it would pass for a whole answer.
        let e = mistral_turn(Fake::Stream(&[SOME_TEXT])).await.unwrap_err();
        assert!(format!("{e:#}").contains("before the end"), "{e:#}");
        // An error event after the first words.
        let e = mistral_turn(Fake::Stream(&[
            SOME_TEXT,
            "data: {\"object\":\"error\",\"message\":\"Service tier capacity exceeded for this model.\",\"type\":\"service_tier_capacity_exceeded\",\"code\":\"3505\"}\n\n",
            "data: [DONE]\n\n",
        ]))
        .await
        .unwrap_err();
        assert!(format!("{e:#}").contains("capacity exceeded"), "{e:#}");
        // A last event with no blank line after it is still read.
        let r = mistral_turn(Fake::Stream(&[
            SOME_TEXT,
            "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]",
        ]))
        .await
        .unwrap();
        assert_eq!(r.stop_reason, "end_turn");
        assert_eq!(r.testo(), "Leggo la pagina ");
    }

    /// A refused key: the message of the provider (Mistral's own shape), not
    /// the whole body and not an empty line.
    #[tokio::test]
    async fn a_refused_mistral_request_says_why() {
        let (d, _) = fake_provider(Fake::Refuse(
            401,
            r#"{"message":"Unauthorized","request_id":"abc"}"#,
        ))
        .await;
        let sc = scelta(Fornitore::Mistral);
        let e = Cliente::new(sc.clone())
            .chat_turn(
                d,
                &[],
                &[json!({ "role": "user", "content": "ciao" })],
                &[],
                &mut |_| {},
            )
            .await
            .unwrap_err();
        let e = format!("{e:#}");
        assert!(
            e.contains("mistral") && e.contains("401") && e.contains("Unauthorized"),
            "{e}"
        );
        assert!(!e.contains("request_id"), "{e}");
        // The single question (translator, symbol model) says it the same way.
        let e = ask_chat_once(
            &reqwest::Client::new(),
            &sc,
            d,
            "istruzioni",
            &[],
            100,
            None,
        )
        .await
        .unwrap_err();
        assert!(format!("{e:#}").contains("Unauthorized"), "{e:#}");
    }

    /// The single question of the translator and of the symbol model.
    #[tokio::test]
    async fn a_single_question_to_mistral() {
        let (d, seen) = fake_provider(Fake::Single(
            r#"{"id":"c2","object":"chat.completion","model":"mistral-large-latest",
                "choices":[{"index":0,"message":{"role":"assistant","content":"Pump running"},"finish_reason":"stop"}],
                "usage":{"prompt_tokens":40,"completion_tokens":3,"total_tokens":43}}"#,
        ))
        .await;
        let sc = scelta(Fornitore::Mistral);
        let messages = [json!({ "role": "user", "content": "Pompa in marcia" })];
        let (text, usage) = ask_chat_once(
            &reqwest::Client::new(),
            &sc,
            d,
            "Traduci in inglese",
            &messages,
            100,
            None,
        )
        .await
        .unwrap();
        assert_eq!(text, "Pump running");
        assert_eq!(usage["input_tokens"], 40);
        assert_eq!(usage["output_tokens"], 3);
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].0, "Bearer k");
        assert_eq!(seen[0].1["stream"], false);
        assert_eq!(seen[0].1["max_tokens"], 100);
        assert!(
            seen[0].1.get("reasoning_effort").is_none(),
            "only a local model"
        );
        assert_eq!(
            seen[0].1["messages"][0],
            json!({ "role": "system", "content": "Traduci in inglese" })
        );
        assert!(seen[0].1.get("tools").is_none());
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
            stop_reason: "tool_use".into(),
            stop_details: None,
            usage: json!({}),
        };
        assert_eq!(r.testo(), "ecco");
        let usi = r.tool_uses();
        assert_eq!(usi.len(), 1);
        assert_eq!(usi[0].1, "valida");
    }

    // ── The local model (plan 2026-11-17-ia-a-scelta-del-cliente, F1) ──────

    #[test]
    fn local_is_a_provider_of_the_second_protocol_with_no_fixed_address() {
        assert_eq!(Fornitore::da_nome(" Local "), Some(Fornitore::Local));
        assert_eq!(Fornitore::Local.nome(), "local");
        assert_eq!(Fornitore::Local.file_chiave(), "local.key");
        assert!(Fornitore::Local.env_chiave().is_empty());
        assert_eq!(Fornitore::Local.modello_default(), "");
        assert!(Fornitore::Local.bearer());
        assert!(!Fornitore::Local.pensiero_anthropic());
        assert!(Fornitore::Local.url_saldo().is_none());
        assert_eq!(
            Fornitore::Local.protocol(),
            Protocol::ChatCompletions(&crate::ai::chat_completions::LOCAL)
        );
        // The address is the customer's: the choice's, else the dialect's.
        let d = &crate::ai::chat_completions::LOCAL;
        let mut sc = scelta(Fornitore::Local);
        assert_eq!(chat_url(&sc, d), "");
        sc.endpoint = Some("http://192.168.1.20:11434/v1/chat/completions".into());
        assert_eq!(
            chat_url(&sc, d),
            "http://192.168.1.20:11434/v1/chat/completions"
        );
    }

    /// A `local.key` alone does not turn it on, nor an address without a
    /// model: the chat would send its requests to an empty address, or ask
    /// the server for no model. With both, the key is optional.
    #[test]
    fn the_local_model_needs_address_and_model() {
        let d = tempfile::tempdir().unwrap();
        let none = UserKeys::default();
        std::fs::write(d.path().join("local.key"), "token-abc").unwrap();
        assert_eq!(resolve_key(d.path(), Fornitore::Local, &none), None);
        let write = |yaml: &str| std::fs::write(Impostazioni::percorso(d.path()), yaml).unwrap();
        write("local: {url: 'http://192.168.1.20:11434/v1'}\n");
        assert_eq!(resolve_key(d.path(), Fornitore::Local, &none), None);
        write("local: {model: 'qwen3:1.7b'}\n");
        assert_eq!(resolve_key(d.path(), Fornitore::Local, &none), None);
        write("local: {url: 'http://192.168.1.20:11434/v1/', model: 'qwen3:1.7b'}\n");
        assert_eq!(
            resolve_key(d.path(), Fornitore::Local, &none),
            Some(("token-abc".into(), KeySource::Project))
        );
        // Without a key, a word: Ollama wants a Bearer, whatever it says.
        std::fs::remove_file(d.path().join("local.key")).unwrap();
        if chiave_di(d.path(), Fornitore::Local).is_none() {
            assert_eq!(
                resolve_key(d.path(), Fornitore::Local, &none),
                Some(("local".into(), KeySource::Project))
            );
        }
        // The account never gives a key to the local model.
        let user = UserKeys::from_entries([("local", Some("sk-account".to_string()), None)]);
        assert_ne!(
            resolve_key(d.path(), Fornitore::Local, &user).map(|(k, _)| k),
            Some("sk-account".to_string())
        );
        // The address: the base, a slash or a whole chat URL brought back to it.
        let c = local_cfg(d.path()).unwrap();
        assert_eq!(
            c.chat_url(),
            "http://192.168.1.20:11434/v1/chat/completions"
        );
        let pasted = LocalCfg {
            url: "http://h:8000/v1/chat/completions".into(),
            ..c
        };
        assert_eq!(pasted.base(), "http://h:8000/v1");
    }

    /// Nothing chosen, no cloud key: the local model is the last of the fixed
    /// order, with its address, its model and its eyes. A model saved for no
    /// provider (the old format) is not a name the local server knows.
    #[test]
    fn the_local_model_is_the_last_of_the_fixed_order() {
        let d = tempfile::tempdir().unwrap();
        let own = std::env::var_os("SWS_AI_FORNITORE").is_some()
            || std::env::var_os("SWS_AI_MODELLO").is_some()
            || [Fornitore::Anthropic, Fornitore::Kimi, Fornitore::Mistral]
                .iter()
                .any(|f| chiave_di(d.path(), *f).is_some());
        if own {
            return;
        }
        std::fs::write(
            Impostazioni::percorso(d.path()),
            "modello: claude-opus-5-5\n\
             local: {url: 'http://127.0.0.1:11434/v1', model: 'qwen3:1.7b'}\n",
        )
        .unwrap();
        let sc = carica(d.path()).unwrap();
        assert_eq!(sc.fornitore, Fornitore::Local);
        assert_eq!(sc.modello, "qwen3:1.7b");
        assert_eq!(
            sc.endpoint.as_deref(),
            Some("http://127.0.0.1:11434/v1/chat/completions")
        );
        assert!(!sc.sees_images);
        // A cloud key wins over it.
        let user = UserKeys::from_pairs([(Fornitore::Mistral, "sk-user-mistral".to_string())]);
        let sc = carica_con(d.path(), &user).unwrap();
        assert_eq!((sc.fornitore, sc.endpoint), (Fornitore::Mistral, None));
        // Chosen for the assistant, with a model of its own and images.
        std::fs::write(
            Impostazioni::percorso(d.path()),
            "scopi:\n  assistente: {fornitore: local, modello: 'llama3.3'}\n\
             local: {url: 'http://127.0.0.1:11434/v1', model: 'qwen3:1.7b', sees_images: true}\n",
        )
        .unwrap();
        let sc = carica_con(d.path(), &user).unwrap();
        assert_eq!(
            (sc.fornitore, sc.modello.as_str(), sc.sees_images),
            (Fornitore::Local, "llama3.3", true)
        );
    }

    /// A local model costs nothing, and that is known: by name alone an
    /// unknown model counts at the prices of Opus, and a free one would show a
    /// false cost and hit the cap.
    #[test]
    fn a_local_model_costs_zero_and_the_price_is_known() {
        let u = json!({ "input_tokens": 1_000_000, "output_tokens": 1_000_000,
                        "cache_read_input_tokens": 1_000_000 });
        for m in ["qwen3:32b", "claude-opus-5-5", ""] {
            let (p, known) = prezzi_per(Fornitore::Local, m);
            assert!(known, "{m}");
            assert_eq!(
                (p.ingresso, p.uscita, p.cache_lettura, p.cache_scrittura),
                (0.0, 0.0, 0.0, 0.0)
            );
            assert_eq!(costo_usd(Fornitore::Local, m, &u), 0.0);
        }
        // The others still read the table, by model.
        assert_eq!(
            prezzi_per(Fornitore::Mistral, "qwen3:32b"),
            prezzi("qwen3:32b")
        );
        assert!(!prezzi_per(Fornitore::Anthropic, "qwen3:32b").1);
    }

    /// A local turn as Ollama or vLLM streams it: reasoning beside the
    /// content, one tool call, the usage only because it was asked.
    const LOCAL_TURN: &[&str] = &[
        "data: {\"id\":\"l1\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"reasoning_content\":\"La pagina \"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"l1\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning\":\"prima.\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"l1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Leggo.\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"l1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_q1\",\"type\":\"function\",\"function\":{\"name\":\"leggi_pagina\",\"arguments\":\"{\\\"nome\\\": \\\"Indicatori\\\"}\"}}]},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"l1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n",
        "data: {\"id\":\"l1\",\"choices\":[],\"usage\":{\"prompt_tokens\":5000,\"completion_tokens\":40,\"total_tokens\":5040}}\n\n",
        "data: [DONE]\n\n",
    ];

    /// A whole turn with tools against a fake local server, through `turno`:
    /// the address comes from the choice, the dialect is `LOCAL`, the images
    /// of a resumed conversation do not leave for a model that does not see
    /// them, and the reasoning is shown.
    #[tokio::test]
    async fn a_local_turn_goes_to_the_address_of_the_choice() {
        let (d, seen) = fake_provider(Fake::Stream(LOCAL_TURN)).await;
        let sc = Scelta {
            chiave: "local".into(),
            modello: "qwen3:1.7b".into(),
            endpoint: Some(d.endpoint.to_string()),
            sees_images: false,
            ..scelta(Fornitore::Local)
        };
        let cliente = Cliente::for_instance(sc, false).unwrap();
        let png = json!({ "type": "image", "source": { "type": "base64",
                          "media_type": "image/png", "data": "iVBORw0KGgo=" } });
        let messages = [
            json!({ "role": "user", "content": "Com'è la pagina?" }),
            json!({ "role": "assistant", "content": [
                { "type": "tool_use", "id": "toolu_1", "name": "istantanea_pagina", "input": {} } ] }),
            json!({ "role": "user", "content": [
                { "type": "tool_result", "tool_use_id": "toolu_1", "content": [png.clone()] },
                png,
                { "type": "text", "text": "E ora?" } ] }),
        ];
        let tools = [json!({ "name": "leggi_pagina", "description": "d",
                             "input_schema": { "type": "object", "properties": {} } })];
        let mut events = Vec::new();
        let r = cliente
            .turno(prompt_finto(), &messages, &tools, |e| {
                events.push(format!("{e:?}"))
            })
            .await
            .unwrap();
        assert_eq!(r.testo(), "Leggo.");
        let uses = r.tool_uses();
        assert_eq!(uses.len(), 1);
        assert_eq!(
            (uses[0].0, uses[0].1, uses[0].2),
            ("call_q1", "leggi_pagina", &json!({ "nome": "Indicatori" }))
        );
        assert_eq!(r.usage["input_tokens"], 5000);
        assert!(events.iter().any(|e| e.contains("La pagina")));
        assert!(events.iter().any(|e| e.contains("prima.")));

        let seen = seen.lock().unwrap();
        let (auth, body) = &seen[0];
        assert_eq!(auth, "Bearer local");
        assert_eq!(body["model"], "qwen3:1.7b");
        assert_eq!(body["max_tokens"], 8192);
        assert_eq!(body["stream_options"]["include_usage"], true);
        // Ids pass unchanged: no Mistral mapping.
        assert_eq!(body["messages"][2]["tool_calls"][0]["id"], "toolu_1");
        let sent = body.to_string();
        assert!(!sent.contains("image_url"), "{sent}");
        assert!(!sent.contains("iVBORw0KGgo"), "{sent}");
        assert!(
            sent.contains(crate::ai::chat_completions::IMAGE_OMITTED),
            "{sent}"
        );
    }

    /// The single question (symbols, translation) goes to the same address.
    #[tokio::test]
    async fn a_single_question_to_a_local_model() {
        let (d, seen) = fake_provider(Fake::Single(
            r#"{"choices":[{"index":0,"message":{"role":"assistant","content":"Pump running"},"finish_reason":"stop"}],
                "usage":{"prompt_tokens":40,"completion_tokens":3}}"#,
        ))
        .await;
        let sc = Scelta {
            endpoint: Some(d.endpoint.to_string()),
            modello: "llama3.3".into(),
            ..scelta(Fornitore::Local)
        };
        let http =
            crate::ai::local_http::client_for(&sc, false, reqwest::Client::builder()).unwrap();
        let messages = [json!({ "role": "user", "content": "Pompa in marcia" })];
        let (text, usage) = chiedi_con_uso(&http, &sc, "Traduci", &messages, 100)
            .await
            .unwrap();
        assert_eq!(text, "Pump running");
        assert_eq!(costo_usd(sc.fornitore, &sc.modello, &usage), 0.0);
        assert_eq!(seen.lock().unwrap()[0].1["model"], "llama3.3");
        // Nobody sees the reasoning of a single answer: it is not asked for.
        assert_eq!(seen.lock().unwrap()[0].1["reasoning_effort"], "none");
    }

    /// A server that does not know `reasoning_effort: "none"` (vLLM accepts
    /// only low, medium, high) gets the question again without it.
    #[tokio::test]
    async fn a_local_server_that_refuses_no_reasoning_is_asked_again() {
        use axum::http::StatusCode;
        use axum::response::IntoResponse;
        let seen: std::sync::Arc<std::sync::Mutex<Vec<Value>>> = Default::default();
        let seen2 = seen.clone();
        let app = axum::Router::new().route(
            "/v1/chat/completions",
            axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
                let seen = seen2.clone();
                async move {
                    seen.lock().unwrap().push(body.clone());
                    if body.get("reasoning_effort").is_some() {
                        return (
                            StatusCode::BAD_REQUEST,
                            axum::Json(json!({ "error": { "message":
                                "reasoning_effort: Input should be 'low', 'medium' or 'high'" } })),
                        )
                            .into_response();
                    }
                    axum::Json(json!({ "choices": [{ "index": 0, "finish_reason": "stop",
                        "message": { "role": "assistant", "content": "ok" } }] }))
                    .into_response()
                }
            }),
        );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        let sc = local_at(&format!("http://{addr}/v1/chat/completions"));
        let messages = [json!({ "role": "user", "content": "x" })];
        let (text, _) = chiedi_con_uso(&reqwest::Client::new(), &sc, "s", &messages, 100)
            .await
            .unwrap();
        assert_eq!(text, "ok");
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert!(seen[1].get("reasoning_effort").is_none());
    }

    /// A schema holds the answer of a local model (a grammar on the server),
    /// and a server that does not know `response_format` is asked again
    /// without; a cloud provider never gets it.
    #[tokio::test]
    async fn a_shape_goes_to_a_local_server_only_and_is_dropped_if_refused() {
        use axum::http::StatusCode;
        use axum::response::IntoResponse;
        let seen: std::sync::Arc<std::sync::Mutex<Vec<Value>>> = Default::default();
        let seen2 = seen.clone();
        let app = axum::Router::new().route(
            "/v1/chat/completions",
            axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
                let seen = seen2.clone();
                async move {
                    seen.lock().unwrap().push(body.clone());
                    if seen.lock().unwrap().len() == 2 && body.get("response_format").is_some() {
                        return (
                            StatusCode::BAD_REQUEST,
                            axum::Json(
                                json!({ "error": { "message": "unknown field response_format" } }),
                            ),
                        )
                            .into_response();
                    }
                    axum::Json(json!({ "choices": [{ "index": 0, "finish_reason": "stop",
                        "message": { "role": "assistant", "content": "{}" } }] }))
                    .into_response()
                }
            }),
        );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        let sc = local_at(&format!("http://{addr}/v1/chat/completions"));
        let messages = [json!({ "role": "user", "content": "x" })];
        let schema = json!({ "type": "object" });
        let http = reqwest::Client::new();
        ask_shaped(&http, &sc, "s", &messages, 100, Some(&schema))
            .await
            .unwrap();
        ask_shaped(&http, &sc, "s", &messages, 100, Some(&schema))
            .await
            .unwrap();
        {
            let seen = seen.lock().unwrap();
            assert_eq!(seen[0]["response_format"]["type"], "json_schema");
            assert_eq!(seen[0]["response_format"]["json_schema"]["schema"], schema);
            // The second question was refused with it, and went again without.
            assert_eq!(seen.len(), 3);
            assert!(seen[2].get("response_format").is_none());
        }
        // Without a shape, nothing.
        chiedi_con_uso(&http, &sc, "s", &messages, 100)
            .await
            .unwrap();
        assert!(seen.lock().unwrap()[3].get("response_format").is_none());
        // A cloud provider: never.
        let (d, seen_cloud) = fake_provider(Fake::Single(
            r#"{"choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"ok"}}]}"#,
        ))
        .await;
        let cloud = scelta(Fornitore::Mistral);
        let _ = ask_chat_once(&http, &cloud, d, "s", &messages, 100, Some(&schema)).await;
        let cloud_seen = seen_cloud.lock().unwrap();
        assert_eq!(cloud_seen.len(), 1);
        assert!(cloud_seen[0].1.get("response_format").is_none());
    }

    // ── The context the local server loaded (F3) ───────────────────────────

    /// A fake Ollama: the chat route, and `/api/ps` saying the context of
    /// `qwen3:1.7b`, `None` = not loaded. `loads` = the first chat request
    /// loads it with that context, as Ollama does.
    async fn fake_ollama(fake: Fake, ctx: Option<u64>, loads: Option<u64>) -> (String, Seen) {
        use axum::http::header;
        use axum::response::IntoResponse;
        let seen: Seen = Default::default();
        let loaded = std::sync::Arc::new(std::sync::Mutex::new(ctx));
        let (seen2, loaded2) = (seen.clone(), loaded.clone());
        let app = axum::Router::new()
            .route(
                "/v1/chat/completions",
                axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
                    let (seen, loaded) = (seen2.clone(), loaded2.clone());
                    async move {
                        seen.lock().unwrap().push((String::new(), body));
                        if let Some(n) = loads {
                            *loaded.lock().unwrap() = Some(n);
                        }
                        match fake {
                            Fake::Stream(p) => {
                                ([(header::CONTENT_TYPE, "text/event-stream")], p.concat())
                                    .into_response()
                            }
                            Fake::Single(b) => {
                                ([(header::CONTENT_TYPE, "application/json")], b).into_response()
                            }
                            _ => unreachable!(),
                        }
                    }
                }),
            )
            .route(
                "/api/ps",
                axum::routing::get(move || {
                    let loaded = loaded.clone();
                    async move {
                        let models = match *loaded.lock().unwrap() {
                            None => json!([]),
                            Some(n) => json!([{ "name": "qwen3:1.7b", "model": "qwen3:1.7b",
                                                "context_length": n }]),
                        };
                        axum::Json(json!({ "models": models }))
                    }
                }),
            );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        (format!("http://{addr}/v1/chat/completions"), seen)
    }

    fn local_at(url: &str) -> Scelta {
        Scelta {
            chiave: "local".into(),
            modello: "qwen3:1.7b".into(),
            endpoint: Some(url.to_string()),
            sees_images: false,
            ..scelta(Fornitore::Local)
        }
    }

    /// A system prompt of about 10k tokens, as the assistant's is several times.
    fn long_prompt() -> Vec<Value> {
        vec![json!({ "type": "text", "text": "x".repeat(40_000) })]
    }

    /// Ollama loaded 4k: the request does not leave, and the error says how
    /// big the context is and what to do.
    #[tokio::test]
    async fn a_request_bigger_than_the_loaded_context_does_not_leave() {
        let (url, seen) = fake_ollama(Fake::Stream(LOCAL_TURN), Some(4096), None).await;
        let cliente = Cliente::for_instance(local_at(&url), false).unwrap();
        let messages = [json!({ "role": "user", "content": "ciao" })];
        let e = cliente
            .turno(long_prompt(), &messages, &[], |_| {})
            .await
            .unwrap_err();
        let e = format!("{e:#}");
        assert!(e.contains("4096") && e.contains("64k"), "{e}");
        assert!(seen.lock().unwrap().is_empty(), "the request left");
        // The single question (symbols, translation) the same.
        let http =
            crate::ai::local_http::client_for(&local_at(&url), false, reqwest::Client::builder())
                .unwrap();
        let e = chiedi_con_uso(&http, &local_at(&url), &"x".repeat(40_000), &messages, 100)
            .await
            .unwrap_err();
        assert!(format!("{e:#}").contains("4096"), "{e:#}");
        assert!(seen.lock().unwrap().is_empty());
    }

    /// With the context raised the same request goes. With 4k a short
    /// question with a short answer (a translation) goes too, but not a turn
    /// of the chat, which keeps 8192 tokens of room for its answer.
    #[tokio::test]
    async fn a_request_that_fits_goes() {
        let (url, seen) = fake_ollama(Fake::Stream(LOCAL_TURN), Some(65536), None).await;
        let messages = [json!({ "role": "user", "content": "ciao" })];
        let r = Cliente::for_instance(local_at(&url), false)
            .unwrap()
            .turno(long_prompt(), &messages, &[], |_| {})
            .await
            .unwrap();
        assert_eq!(r.testo(), "Leggo.");
        assert_eq!(seen.lock().unwrap().len(), 1);
        let (url, seen) = fake_ollama(
            Fake::Single(
                r#"{"choices":[{"index":0,"message":{"role":"assistant","content":"Pump"},"finish_reason":"stop"}]}"#,
            ),
            Some(4096),
            None,
        )
        .await;
        let http =
            crate::ai::local_http::client_for(&local_at(&url), false, reqwest::Client::builder())
                .unwrap();
        let (text, _) = chiedi_con_uso(&http, &local_at(&url), "Translate", &messages, 1024)
            .await
            .unwrap();
        assert_eq!(text, "Pump");
        let e = Cliente::for_instance(local_at(&url), false)
            .unwrap()
            .turno(prompt_finto(), &messages, &[], |_| {})
            .await
            .unwrap_err();
        let too_small = e
            .downcast_ref::<crate::ai::local_http::ContextTooSmall>()
            .expect("a typed error, for the chat to send its code");
        assert_eq!(too_small.loaded, 4096);
        assert!(too_small.needed > 8192, "{too_small:?}");
        assert_eq!(seen.lock().unwrap().len(), 1, "only the translation left");
    }

    /// A model not loaded yet is loaded by the first request, and only then
    /// tells its context: an answer written on a cut prompt is discarded,
    /// before a word of it reaches the chat.
    #[tokio::test]
    async fn the_first_answer_of_a_model_loaded_too_small_is_discarded() {
        let (url, seen) = fake_ollama(Fake::Stream(LOCAL_TURN), None, Some(4096)).await;
        let messages = [json!({ "role": "user", "content": "ciao" })];
        let mut events = Vec::new();
        let e = Cliente::for_instance(local_at(&url), false)
            .unwrap()
            .turno(long_prompt(), &messages, &[], |e| {
                events.push(format!("{e:?}"))
            })
            .await
            .unwrap_err();
        assert!(format!("{e:#}").contains("4096"), "{e:#}");
        assert_eq!(seen.lock().unwrap().len(), 1, "it was sent once");
        assert!(events.is_empty(), "{events:?}");
        // The single question: its answer is not returned.
        let (url, _) = fake_ollama(
            Fake::Single(
                r#"{"choices":[{"index":0,"message":{"role":"assistant","content":"Pump"},"finish_reason":"stop"}]}"#,
            ),
            None,
            Some(4096),
        )
        .await;
        let http =
            crate::ai::local_http::client_for(&local_at(&url), false, reqwest::Client::builder())
                .unwrap();
        let e = chiedi_con_uso(&http, &local_at(&url), &"x".repeat(40_000), &messages, 100)
            .await
            .unwrap_err();
        assert!(format!("{e:#}").contains("4096"), "{e:#}");
        // Loaded big enough: the answer stays.
        let (url, _) = fake_ollama(Fake::Stream(LOCAL_TURN), None, Some(65536)).await;
        assert!(Cliente::for_instance(local_at(&url), false)
            .unwrap()
            .turno(long_prompt(), &messages, &[], |_| {})
            .await
            .is_ok());
    }

    /// The local model with nothing but its configuration: the address of
    /// `ai.yaml`, no key, and a `Bearer local` on the request.
    #[tokio::test]
    async fn a_configured_local_model_answers_with_bearer_local() {
        let (d, seen) = fake_provider(Fake::Stream(LOCAL_TURN)).await;
        let dir = tempfile::tempdir().unwrap();
        let base = d.endpoint.trim_end_matches("/chat/completions");
        std::fs::write(
            Impostazioni::percorso(dir.path()),
            format!(
                "scopi:\n  assistente: {{fornitore: local}}\n\
                 local: {{url: '{base}', model: 'qwen3:1.7b'}}\n"
            ),
        )
        .unwrap();
        if std::env::var_os("SWS_AI_FORNITORE").is_some()
            || std::env::var_os("SWS_AI_MODELLO").is_some()
            || chiave_di(dir.path(), Fornitore::Local).is_some()
        {
            return;
        }
        let sc = carica(dir.path()).unwrap();
        assert_eq!(sc.chiave, "local");
        let tools = [json!({ "name": "leggi_pagina", "description": "d",
                             "input_schema": { "type": "object", "properties": {} } })];
        let r = Cliente::for_instance(sc, false)
            .unwrap()
            .turno(
                prompt_finto(),
                &[json!({ "role": "user", "content": "ciao" })],
                &tools,
                |_| {},
            )
            .await
            .unwrap();
        assert_eq!(r.tool_uses()[0].1, "leggi_pagina");
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].0, "Bearer local");
        assert_eq!(seen[0].1["model"], "qwen3:1.7b");
    }
}
