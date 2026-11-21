//! Un modello per ogni scopo (piano `docs/archive/2026-11-04-un-modello-per-ogni-scopo.md`).
//!
//! # Perché gli scopi
//!
//! Fino al 04-11-2026 l'IDE aveva **un** modello: quello dell'assistente. La
//! traduzione `Ia` lo riusava, e gli sfondi non c'erano. Ma gli scopi chiedono
//! modelli diversi: comporre una pagina vuole il modello più forte, tradurre
//! un'etichetta il più economico, uno sfondo un modello che fa immagini — che
//! Claude e Kimi non sono.
//!
//! # Dove sta cosa
//!
//! Tutto nell'installazione, in `config_dir/ai.yaml` sotto `scopi:`; le chiavi
//! nei loro file (`anthropic.key`, `kimi.key`, `openai.key`, `bfl.key`), mai nel progetto.
//! Le regole di contesto invece stanno **nel progetto** (`project.ai`): viaggiano
//! con lui, le chiavi no.
//!
//! # Le ricadute
//!
//! - `assistente`: quello di sempre, con le variabili `SWS_AI_*` che vincono sul
//!   file (`client::carica`).
//! - `simboli` e `traduzione`: se non hanno un fornitore loro, sono l'assistente.
//! - `sfondi`: OpenAI or Black Forest Labs (FLUX.2, 16-11-2026), whichever has a key.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::ai::client::{self, Fornitore, Impostazioni, LocalCfg, Scelta};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Scopo {
    Assistente,
    Simboli,
    Traduzione,
    Sfondi,
    /// The AI on a single IDE field (plan `docs/plans/2026-11-20-ia-sui-campi.md`).
    Fields,
}

impl Scopo {
    pub const TUTTI: [Scopo; 5] = [
        Scopo::Assistente,
        Scopo::Simboli,
        Scopo::Traduzione,
        Scopo::Sfondi,
        Scopo::Fields,
    ];

    pub fn nome(self) -> &'static str {
        match self {
            Scopo::Assistente => "assistente",
            Scopo::Simboli => "simboli",
            Scopo::Traduzione => "traduzione",
            Scopo::Sfondi => "sfondi",
            Scopo::Fields => "fields",
        }
    }

    pub fn da_nome(s: &str) -> Option<Self> {
        Self::TUTTI.into_iter().find(|x| x.nome() == s.trim())
    }

    /// Lo scopo vuole un modello di testo (Anthropic, Kimi) o di immagini
    /// (OpenAI, Black Forest Labs)?
    pub fn immagini(self) -> bool {
        matches!(self, Scopo::Sfondi)
    }
}

/// La scelta salvata per uno scopo. Tutto facoltativo: un campo assente è
/// «come l'assistente» (o il default del fornitore).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScopoCfg {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fornitore: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modello: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tetto_usd: Option<f64>,
    /// Solo per gli sfondi di OpenAI: `low`, `medium`, `high` (gpt-image-2).
    /// FLUX has no quality setting and ignores it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qualita: Option<String>,
}

impl Impostazioni {
    /// La scelta dell'assistente: sotto `scopi`, o nel formato di prima.
    pub fn assistente(&self) -> ScopoCfg {
        self.scopi
            .get(Scopo::Assistente.nome())
            .cloned()
            .unwrap_or_else(|| ScopoCfg {
                fornitore: self.fornitore.clone(),
                modello: self.modello.clone(),
                tetto_usd: self.tetto_usd,
                qualita: None,
            })
    }

    /// La scelta salvata di uno scopo, così com'è (`None` = non configurato).
    pub fn scopo(&self, s: Scopo) -> Option<ScopoCfg> {
        match s {
            Scopo::Assistente => Some(self.assistente()).filter(|c| *c != ScopoCfg::default()),
            _ => self.scopi.get(s.nome()).cloned(),
        }
    }

    /// Scrive la scelta di uno scopo; `None` la toglie. L'assistente, scritto
    /// una volta qui, smette di leggersi dal formato vecchio.
    pub fn imposta(&mut self, s: Scopo, cfg: Option<ScopoCfg>) {
        if s == Scopo::Assistente {
            self.fornitore = None;
            self.modello = None;
            self.tetto_usd = None;
        }
        match cfg.filter(|c| *c != ScopoCfg::default()) {
            Some(c) => {
                self.scopi.insert(s.nome().to_string(), c);
            }
            None => {
                self.scopi.remove(s.nome());
            }
        }
    }
}

/// Con chi parla uno scopo di testo. `simboli` e `traduzione` senza un fornitore
/// loro (o con un fornitore senza chiave) sono l'assistente: meglio un modello
/// più caro che uno strumento spento senza dire perché.
pub fn carica_per(config_dir: &Path, s: Scopo) -> Option<Scelta> {
    carica_per_con(config_dir, s, &client::UserKeys::default())
}

/// [`carica_per`] with the keys of the user who is writing: for a provider the
/// project has no key for, the user's.
pub fn carica_per_con(config_dir: &Path, s: Scopo, user: &client::UserKeys) -> Option<Scelta> {
    let assistente = client::carica_con(config_dir, user);
    if s == Scopo::Assistente || s.immagini() {
        return assistente;
    }
    let imp = Impostazioni::carica(config_dir);
    let Some(cfg) = imp.scopi.get(s.nome()) else {
        return assistente;
    };
    let Some(f) = cfg.fornitore.as_deref().and_then(Fornitore::da_nome) else {
        return assistente;
    };
    let Some((chiave, source)) = client::resolve_key(config_dir, f, user) else {
        tracing::warn!(
            scopo = s.nome(),
            fornitore = f.nome(),
            "lo scopo ha un fornitore senza chiave: uso quello dell'assistente"
        );
        return assistente;
    };
    // The address of the local model, as for the assistant: without it a
    // symbol or a translation would go to an empty URL.
    let (endpoint, sees_images) = client::address_of(config_dir, f);
    Some(Scelta {
        fornitore: f,
        chiave,
        source,
        modello: cfg
            .modello
            .clone()
            .filter(|m| !m.trim().is_empty())
            .or_else(|| user.model_of(f.nome()).map(str::to_string))
            .unwrap_or_else(|| client::default_model_of(config_dir, f)),
        tetto_usd: cfg
            .tetto_usd
            .filter(|t| t.is_finite() && *t > 0.0)
            .or_else(|| assistente.as_ref().map(|a| a.tetto_usd))
            .unwrap_or(client::TETTO_DEFAULT_USD),
        endpoint,
        sees_images,
    })
}

/// Lo scopo ha una scelta **sua**, diversa dall'assistente? Serve a decidere se
/// la conversazione riceve `disegna_simbolo` (un modello a parte) o
/// `bozza_simbolo` (il modello della conversazione disegna da sé).
pub fn ha_scelta_propria(config_dir: &Path, s: Scopo) -> bool {
    ha_scelta_propria_con(config_dir, s, &client::UserKeys::default())
}

pub fn ha_scelta_propria_con(config_dir: &Path, s: Scopo, user: &client::UserKeys) -> bool {
    match (
        carica_per_con(config_dir, s, user),
        client::carica_con(config_dir, user),
    ) {
        (Some(a), Some(b)) => a.fornitore != b.fornitore || a.modello != b.modello,
        _ => false,
    }
}

// ── Le immagini ────────────────────────────────────────────────────────────

pub const FILE_CHIAVE_OPENAI: &str = "openai.key";
pub const MODELLO_SFONDI: &str = "gpt-image-2";
pub const TETTO_SFONDI_USD: f64 = 1.0;

/// Who makes the backgrounds: OpenAI (gpt-image-2) or Black Forest Labs
/// (FLUX.2, since 16-11-2026, phase G5).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ImageProvider {
    OpenAi,
    Bfl,
}

impl ImageProvider {
    pub const ALL: [ImageProvider; 2] = [ImageProvider::OpenAi, ImageProvider::Bfl];

    pub fn name(self) -> &'static str {
        match self {
            ImageProvider::OpenAi => "openai",
            ImageProvider::Bfl => "bfl",
        }
    }

    pub fn from_name(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.name() == s.trim())
    }

    pub fn key_file(self) -> &'static str {
        match self {
            ImageProvider::OpenAi => FILE_CHIAVE_OPENAI,
            ImageProvider::Bfl => "bfl.key",
        }
    }

    pub fn key_env(self) -> &'static str {
        match self {
            ImageProvider::OpenAi => "OPENAI_API_KEY",
            ImageProvider::Bfl => "BFL_API_KEY",
        }
    }

    pub fn default_model(self) -> &'static str {
        match self {
            ImageProvider::OpenAi => MODELLO_SFONDI,
            ImageProvider::Bfl => crate::ai::bfl::DEFAULT_MODEL,
        }
    }

    /// The project's key: the environment, then `config_dir/<provider>.key`.
    pub fn project_key(self, config_dir: &Path) -> Option<String> {
        if let Ok(k) = std::env::var(self.key_env()) {
            let k = k.trim().to_string();
            if !k.is_empty() {
                return Some(k);
            }
        }
        crate::segreti::leggi_chiave(&config_dir.join(self.key_file()))
    }
}

/// Con chi si fanno gli sfondi.
#[derive(Clone, Debug)]
pub struct SceltaImmagini {
    pub fornitore: ImageProvider,
    pub chiave: String,
    pub modello: String,
    /// OpenAI only: `low`, `medium`, `high`. FLUX has no quality setting.
    pub qualita: String,
    pub tetto_usd: f64,
}

pub fn chiave_openai(config_dir: &Path) -> Option<String> {
    ImageProvider::OpenAi.project_key(config_dir)
}

pub fn carica_sfondi(config_dir: &Path) -> Option<SceltaImmagini> {
    carica_sfondi_con(config_dir, &client::UserKeys::default())
}

/// [`carica_sfondi`] with the user's account: their key when the project has
/// none, their preferred model when the project chose none.
///
/// The provider is the one saved for the purpose; then the one the user
/// prefers in their account (17-11-2026); then OpenAI and Black Forest Labs. A
/// saved provider without a key falls back to the next one, as the text
/// purposes fall back to the assistant: better another image model than a
/// tool switched off without saying why.
pub fn carica_sfondi_con(config_dir: &Path, user: &client::UserKeys) -> Option<SceltaImmagini> {
    let cfg = Impostazioni::carica(config_dir)
        .scopi
        .get(Scopo::Sfondi.nome())
        .cloned()
        .unwrap_or_default();
    let saved = cfg.fornitore.as_deref().and_then(ImageProvider::from_name);
    let preferred = user.preferred_images().and_then(ImageProvider::from_name);
    let mut order: Vec<ImageProvider> = Vec::new();
    for p in saved.into_iter().chain(preferred).chain(ImageProvider::ALL) {
        if !order.contains(&p) {
            order.push(p);
        }
    }
    let (provider, chiave) = order.into_iter().find_map(|p| {
        p.project_key(config_dir)
            .or_else(|| user.key_of(p.name()).map(str::to_string))
            .map(|k| (p, k))
    })?;
    if saved.is_some_and(|s| s != provider) {
        tracing::warn!(
            provider = provider.name(),
            "the saved backgrounds provider has no key: using the other one"
        );
    }
    // A saved model belongs to the saved provider (OpenAI when none is saved).
    let saved_model = cfg
        .modello
        .filter(|m| !m.trim().is_empty())
        .filter(|_| saved.unwrap_or(ImageProvider::OpenAi) == provider);
    Some(SceltaImmagini {
        fornitore: provider,
        chiave,
        modello: saved_model
            .or_else(|| user.model_of(provider.name()).map(str::to_string))
            .unwrap_or_else(|| provider.default_model().to_string()),
        qualita: cfg
            .qualita
            .filter(|q| matches!(q.as_str(), "low" | "medium" | "high"))
            .unwrap_or_else(|| "medium".to_string()),
        tetto_usd: cfg
            .tetto_usd
            .filter(|t| t.is_finite() && *t > 0.0)
            .unwrap_or(TETTO_SFONDI_USD),
    })
}

// ── I fornitori, per il menù ───────────────────────────────────────────────

/// I fornitori che il menù IA conosce: id, nome da mostrare, cosa sanno fare.
///
/// `local` (the model the customer serves, F3 of plan
/// `2026-11-17-ia-a-scelta-del-cliente`) is configured with an address, not
/// only a key, and stays out of the account (`user_keys::PROVIDERS`).
pub const FORNITORI: [(&str, &str, &[&str]); 6] = [
    (
        "anthropic",
        "Anthropic (Claude)",
        &["assistente", "simboli", "traduzione", "fields"],
    ),
    (
        "kimi",
        "Moonshot (Kimi)",
        &["assistente", "simboli", "traduzione", "fields"],
    ),
    (
        "mistral",
        "Mistral AI",
        &["assistente", "simboli", "traduzione", "fields"],
    ),
    (
        "local",
        "Local model (OpenAI-compatible)",
        &["assistente", "simboli", "traduzione", "fields"],
    ),
    ("openai", "OpenAI (immagini)", &["sfondi"]),
    ("bfl", "Black Forest Labs (FLUX)", &["sfondi"]),
];

/// Is the provider ready? For the local model that means address and model,
/// its key being optional.
pub fn ha_chiave(config_dir: &Path, fornitore: &str) -> bool {
    match ImageProvider::from_name(fornitore) {
        Some(p) => p.project_key(config_dir).is_some(),
        None => match Fornitore::da_nome(fornitore) {
            Some(Fornitore::Local) => client::local_cfg(config_dir).is_some(),
            Some(f) => client::ha_chiave(config_dir, f),
            None => false,
        },
    }
}

pub fn file_chiave(fornitore: &str) -> Option<&'static str> {
    match ImageProvider::from_name(fornitore) {
        Some(p) => Some(p.key_file()),
        None => Fornitore::da_nome(fornitore).map(|f| f.file_chiave()),
    }
}

/// «Prova la chiave»: una chiamata gratuita, l'elenco dei modelli. Torna gli id
/// dei modelli (utili come proposte nel menù) o l'errore del fornitore. La
/// chiave del progetto, o quella dell'account di chi chiede (`user`).
///
/// The local model is tested before any key is looked for, since its key is
/// optional: `local` = the address and key typed in the menu (not saved yet),
/// or the saved ones. `in_cloud` = a container behind the gateway, where only
/// public addresses are reached.
pub async fn prova_chiave(
    config_dir: &Path,
    fornitore: &str,
    user: &client::UserKeys,
    local: Option<(&str, Option<&str>)>,
    in_cloud: bool,
) -> Result<Vec<String>, String> {
    if Fornitore::da_nome(fornitore) == Some(Fornitore::Local) {
        let saved = Impostazioni::carica(config_dir).local.unwrap_or_default();
        let saved_key = client::chiave_di(config_dir, Fornitore::Local);
        let (url, key) = match local.filter(|(u, _)| !u.trim().is_empty()) {
            Some((u, k)) => {
                let typed = LocalCfg {
                    url: u.to_string(),
                    ..Default::default()
                };
                // The saved key only for the server it was saved for.
                let saved_key = saved_key
                    .filter(|_| crate::ai::local_http::same_origin(typed.base(), saved.base()));
                (typed, k.map(str::to_string).or(saved_key))
            }
            None => (saved, saved_key),
        };
        if url.base().is_empty() {
            return Err("no address for the local model".to_string());
        }
        return prova_locale(url.base(), key.as_deref(), in_cloud).await;
    }
    let del_progetto = match ImageProvider::from_name(fornitore) {
        Some(p) => p.project_key(config_dir),
        None => match Fornitore::da_nome(fornitore) {
            Some(f) => client::chiave_di(config_dir, f),
            None => return Err(format!("fornitore `{fornitore}` sconosciuto")),
        },
    };
    let chiave = del_progetto
        .or_else(|| user.key_of(fornitore).map(str::to_string))
        .ok_or_else(|| "nessuna chiave salvata".to_string())?;
    prova_questa_chiave(fornitore, &chiave).await
}

/// The FLUX.2 models offered in the menu, in alphabetical order: BFL has no
/// «list models» call, these are the endpoints of its reference (16-11-2026).
pub const BFL_MODELS: [&str; 6] = [
    "flux-2-flex",
    "flux-2-klein-4b",
    "flux-2-klein-9b",
    "flux-2-max",
    "flux-2-pro",
    "flux-2-pro-preview",
];

/// L'elenco dei modelli di `fornitore` con questa chiave, in ordine alfabetico.
///
/// Black Forest Labs has no free «list models» call: its key is tested with
/// `GET /v1/credits` (free, and it needs a valid key), and the models are the
/// known FLUX.2 ones, [`BFL_MODELS`].
pub async fn prova_questa_chiave(fornitore: &str, chiave: &str) -> Result<Vec<String>, String> {
    if fornitore == ImageProvider::Bfl.name() {
        crate::ai::bfl::credits_usd(&crate::ai::bfl::Endpoint::default(), chiave).await?;
        return Ok(BFL_MODELS.iter().map(|m| m.to_string()).collect());
    }
    let url = match fornitore {
        "openai" => "https://api.openai.com/v1/models",
        "anthropic" => "https://api.anthropic.com/v1/models",
        "kimi" => "https://api.moonshot.ai/v1/models",
        "mistral" => "https://api.mistral.ai/v1/models",
        _ => return Err(format!("fornitore `{fornitore}` sconosciuto")),
    };
    // A fixed, public address of a cloud provider: nothing to guard, but the
    // same builder the local model's test will use with its own address.
    let http = crate::ai::local_http::client(
        url,
        false,
        reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)),
    )?;
    let mut req = http.get(url);
    req = if fornitore == "anthropic" {
        req.header("x-api-key", chiave)
            .header("anthropic-version", "2023-06-01")
    } else {
        req.header("Authorization", format!("Bearer {chiave}"))
    };
    let r = req
        .send()
        .await
        .map_err(|e| format!("il fornitore non risponde: {e}"))?;
    let stato = r.status();
    let corpo: serde_json::Value = r.json().await.unwrap_or_default();
    if !stato.is_success() {
        // `{"error": {"message"}}` for most, `{"message"}` for Mistral.
        let msg = crate::ai::chat_completions::error_message(&corpo).unwrap_or_default();
        return Err(format!("HTTP {}: {msg}", stato.as_u16()));
    }
    Ok(model_ids(&corpo))
}

/// The models of a local server: `GET <base>/models`, which Ollama, vLLM, LM
/// Studio and llama.cpp all answer in OpenAI's shape. Through the client of
/// `local_http`, like every request to an address the customer chose. The
/// Bearer goes only with a key: unlike a chat request, a list of models is
/// not refused for a missing one, and an empty header is.
pub async fn prova_locale(
    base: &str,
    key: Option<&str>,
    in_cloud: bool,
) -> Result<Vec<String>, String> {
    let url = format!("{}/models", base.trim_end_matches('/'));
    let http = crate::ai::local_http::client(
        &url,
        in_cloud,
        reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)),
    )?;
    let mut req = http.get(&url);
    if let Some(k) = key.map(str::trim).filter(|k| !k.is_empty()) {
        req = req.header("Authorization", format!("Bearer {k}"));
    }
    let r = req
        .send()
        .await
        .map_err(|e| format!("the local model does not answer at {url}: {e}"))?;
    let status = r.status();
    let body: serde_json::Value = r.json().await.unwrap_or_default();
    if !status.is_success() {
        let msg = crate::ai::chat_completions::error_message(&body).unwrap_or_default();
        return Err(format!("HTTP {}: {msg}", status.as_u16()));
    }
    let ids = model_ids(&body);
    if ids.is_empty() {
        return Err(format!("{url} lists no model"));
    }
    Ok(ids)
}

/// The model ids of a `/v1/models` answer, sorted. Mistral lists everything it
/// serves — embeddings, moderation, OCR — and says what each one does: those
/// that declare they do not chat (`capabilities.completion_chat: false`) are
/// left out, they would be proposals that fail at the first message.
fn model_ids(body: &serde_json::Value) -> Vec<String> {
    let mut ids: Vec<String> = body
        .get("data")
        .and_then(|d| d.as_array())
        .into_iter()
        .flatten()
        .filter(|m| {
            m.pointer("/capabilities/completion_chat")
                .and_then(|c| c.as_bool())
                != Some(false)
        })
        .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(str::to_string))
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The list of models as Mistral gives it (the shape of `GET /v1/models`,
    /// shortened) and as the others do: only what can hold a conversation.
    #[test]
    fn the_models_of_a_key_are_those_that_chat() {
        let mistral = serde_json::json!({ "object": "list", "data": [
            { "id": "mistral-small-latest", "object": "model",
              "capabilities": { "completion_chat": true, "function_calling": true, "vision": true } },
            { "id": "mistral-large-latest", "object": "model",
              "capabilities": { "completion_chat": true, "function_calling": true, "vision": true } },
            { "id": "mistral-embed", "object": "model",
              "capabilities": { "completion_chat": false, "function_calling": false } },
            { "id": "mistral-ocr-latest", "object": "model",
              "capabilities": { "completion_chat": false } },
            { "id": "mistral-large-latest", "object": "model",
              "capabilities": { "completion_chat": true } } ] });
        assert_eq!(
            model_ids(&mistral),
            ["mistral-large-latest", "mistral-small-latest"]
        );
        // No capabilities declared (Anthropic, Kimi, OpenAI): all of them.
        let plain = serde_json::json!({ "data": [{ "id": "b" }, { "id": "a" }] });
        assert_eq!(model_ids(&plain), ["a", "b"]);
        assert!(model_ids(&serde_json::json!({})).is_empty());
        // Mistral is one of the providers of the three text purposes, with its
        // key file.
        let (_, _, purposes) = FORNITORI
            .iter()
            .find(|(id, _, _)| *id == "mistral")
            .unwrap();
        assert_eq!(*purposes, ["assistente", "simboli", "traduzione", "fields"]);
        assert_eq!(file_chiave("mistral"), Some("mistral.key"));
    }

    fn scrivi(dir: &Path, yaml: &str) {
        std::fs::write(dir.join("ai.yaml"), yaml).unwrap();
    }

    #[test]
    fn il_formato_vecchio_e_l_assistente() {
        let d = tempfile::tempdir().unwrap();
        scrivi(
            d.path(),
            "fornitore: kimi\nmodello: kimi-k3\ntetto_usd: 4\n",
        );
        let imp = Impostazioni::carica(d.path());
        let a = imp.assistente();
        assert_eq!(a.fornitore.as_deref(), Some("kimi"));
        assert_eq!(a.modello.as_deref(), Some("kimi-k3"));
        assert_eq!(a.tetto_usd, Some(4.0));
    }

    #[test]
    fn scrivere_l_assistente_migra_il_formato_vecchio() {
        let d = tempfile::tempdir().unwrap();
        scrivi(d.path(), "fornitore: kimi\nmodello: kimi-k3\n");
        let mut imp = Impostazioni::carica(d.path());
        imp.imposta(
            Scopo::Assistente,
            Some(ScopoCfg {
                fornitore: Some("anthropic".into()),
                ..Default::default()
            }),
        );
        imp.salva(d.path()).unwrap();
        let testo = std::fs::read_to_string(d.path().join("ai.yaml")).unwrap();
        assert!(
            !testo.contains("kimi"),
            "il formato vecchio non deve restare: {testo}"
        );
        assert!(testo.contains("scopi:") && testo.contains("anthropic"));
    }

    #[test]
    fn the_account_model_comes_after_the_project_s_and_before_the_default() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("kimi.key"), "sk-kimi-progetto").unwrap();
        let user = client::UserKeys::from_entries([
            ("kimi", None, Some("kimi-dell-account".to_string())),
            (
                "openai",
                Some("sk-oa-account".to_string()),
                Some("img-account".to_string()),
            ),
        ]);
        scrivi(d.path(), "scopi:\n  traduzione:\n    fornitore: kimi\n");
        let t = carica_per_con(d.path(), Scopo::Traduzione, &user).unwrap();
        assert_eq!(t.modello, "kimi-dell-account");
        scrivi(
            d.path(),
            "scopi:\n  traduzione:\n    fornitore: kimi\n    modello: kimi-del-progetto\n",
        );
        let t = carica_per_con(d.path(), Scopo::Traduzione, &user).unwrap();
        assert_eq!(t.modello, "kimi-del-progetto");
        // Backgrounds: the account's OpenAI key and model, the project having none.
        let sf = carica_sfondi_con(d.path(), &user).unwrap();
        assert_eq!(
            (sf.chiave.as_str(), sf.modello.as_str()),
            ("sk-oa-account", "img-account")
        );
        assert!(carica_sfondi(d.path()).is_none());
    }

    #[test]
    fn togliere_uno_scopo_lo_fa_ricadere() {
        let mut imp = Impostazioni::default();
        imp.imposta(
            Scopo::Traduzione,
            Some(ScopoCfg {
                fornitore: Some("anthropic".into()),
                modello: Some("claude-haiku-5-5".into()),
                ..Default::default()
            }),
        );
        assert!(imp.scopo(Scopo::Traduzione).is_some());
        imp.imposta(Scopo::Traduzione, None);
        assert!(imp.scopo(Scopo::Traduzione).is_none());
        // Una scelta vuota è come nessuna scelta.
        imp.imposta(Scopo::Simboli, Some(ScopoCfg::default()));
        assert!(imp.scopi.is_empty());
    }

    #[test]
    fn un_campo_sconosciuto_in_uno_scopo_non_passa() {
        let e = serde_yaml::from_str::<ScopoCfg>("fornitore: kimi\nchiave: segreta\n");
        assert!(e.is_err(), "la chiave non deve poter finire in ai.yaml");
    }

    #[test]
    fn i_nomi_degli_scopi_vanno_e_tornano() {
        for s in Scopo::TUTTI {
            assert_eq!(Scopo::da_nome(s.nome()), Some(s));
        }
        assert_eq!(Scopo::da_nome("immagini"), None);
        assert!(Scopo::Sfondi.immagini() && !Scopo::Traduzione.immagini());
    }

    #[test]
    fn gli_sfondi_vogliono_la_chiave_openai() {
        let d = tempfile::tempdir().unwrap();
        // Se l'ambiente di chi lancia i test ha OPENAI_API_KEY, il caso «senza
        // chiave» non si può provare qui.
        if std::env::var_os("OPENAI_API_KEY").is_none() {
            assert!(carica_sfondi(d.path()).is_none());
        }
        std::fs::write(
            d.path().join(FILE_CHIAVE_OPENAI),
            "sk-prova-0123456789abcdef",
        )
        .unwrap();
        scrivi(
            d.path(),
            "scopi:\n  sfondi: {qualita: altissima, tetto_usd: 2}\n",
        );
        let s = carica_sfondi(d.path()).unwrap();
        assert_eq!(s.modello, MODELLO_SFONDI);
        assert_eq!(
            s.qualita, "medium",
            "una qualità che non esiste torna al default"
        );
        assert_eq!(s.tetto_usd, 2.0);
    }

    #[test]
    fn backgrounds_use_the_saved_provider_or_the_one_with_a_key() {
        // The environment of whoever runs the tests may hold real keys.
        if std::env::var_os("OPENAI_API_KEY").is_some() || std::env::var_os("BFL_API_KEY").is_some()
        {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("bfl.key"), "bfl-prova-0123456789abcdef").unwrap();
        // Only BFL has a key: it is the one, with its default model.
        let s = carica_sfondi(d.path()).unwrap();
        assert_eq!(
            (s.fornitore, s.modello.as_str()),
            (ImageProvider::Bfl, "flux-2-pro")
        );
        // Both have a key: OpenAI unless BFL is saved.
        std::fs::write(
            d.path().join(FILE_CHIAVE_OPENAI),
            "sk-prova-0123456789abcdef",
        )
        .unwrap();
        assert_eq!(
            carica_sfondi(d.path()).unwrap().fornitore,
            ImageProvider::OpenAi
        );
        scrivi(
            d.path(),
            "scopi:\n  sfondi: {fornitore: bfl, modello: flux-2-max}\n",
        );
        let s = carica_sfondi(d.path()).unwrap();
        assert_eq!(
            (s.fornitore, s.modello.as_str()),
            (ImageProvider::Bfl, "flux-2-max")
        );
        // BFL saved but without a key: OpenAI, and not with the FLUX model.
        std::fs::remove_file(d.path().join("bfl.key")).unwrap();
        let s = carica_sfondi(d.path()).unwrap();
        assert_eq!(
            (s.fornitore, s.modello.as_str()),
            (ImageProvider::OpenAi, MODELLO_SFONDI)
        );
        // The account's BFL key when the project has none.
        let user = client::UserKeys::from_entries([("bfl", Some("bfl-account".to_string()), None)]);
        let s = carica_sfondi_con(d.path(), &user).unwrap();
        assert_eq!(
            (s.fornitore, s.chiave.as_str()),
            (ImageProvider::Bfl, "bfl-account")
        );
    }

    #[test]
    fn the_account_preference_for_images_beats_the_fixed_order_and_loses_to_the_project() {
        if std::env::var_os("OPENAI_API_KEY").is_some() || std::env::var_os("BFL_API_KEY").is_some()
        {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let keys = [
            ("openai", Some("sk-oa-account".to_string()), None),
            ("bfl", Some("bfl-account".to_string()), None),
        ];
        let user =
            client::UserKeys::from_entries(keys.clone()).with_preferences(None, Some("bfl".into()));
        // Nothing saved: the preference, not OpenAI first.
        assert_eq!(
            carica_sfondi_con(d.path(), &user).unwrap().fornitore,
            ImageProvider::Bfl
        );
        // A model saved without a provider is OpenAI's: FLUX does not get it.
        scrivi(d.path(), "scopi:\n  sfondi: {modello: gpt-image-1.5}\n");
        let s = carica_sfondi_con(d.path(), &user).unwrap();
        assert_eq!(
            (s.fornitore, s.modello.as_str()),
            (ImageProvider::Bfl, "flux-2-pro")
        );
        // The project's choice wins over the preference.
        scrivi(d.path(), "scopi:\n  sfondi: {fornitore: openai}\n");
        assert_eq!(
            carica_sfondi_con(d.path(), &user).unwrap().fornitore,
            ImageProvider::OpenAi
        );
        // A preference without a key: the next one that has it.
        scrivi(d.path(), "scopi: {}\n");
        let only_openai = client::UserKeys::from_entries([keys[0].clone()])
            .with_preferences(None, Some("bfl".into()));
        assert_eq!(
            carica_sfondi_con(d.path(), &only_openai).unwrap().fornitore,
            ImageProvider::OpenAi
        );
    }

    #[test]
    fn bfl_is_a_backgrounds_provider_everywhere() {
        assert!(FORNITORI
            .iter()
            .any(|(id, _, sa)| *id == "bfl" && *sa == ["sfondi"]));
        assert_eq!(file_chiave("bfl"), Some("bfl.key"));
        assert!(crate::ai::user_keys::PROVIDERS.contains(&"bfl"));
    }

    /// Symbols and translation can use the local model too, and then they get
    /// its address: without it they would go to an empty URL.
    #[test]
    fn the_translation_with_the_local_model_has_its_address() {
        let d = tempfile::tempdir().unwrap();
        let none = client::UserKeys::default();
        scrivi(d.path(), "scopi:\n  traduzione: {fornitore: local}\n");
        assert!(!ha_chiave(d.path(), "local"), "no address, not ready");
        scrivi(
            d.path(),
            "scopi:\n  traduzione: {fornitore: local}\n\
             local: {url: 'http://192.168.1.20:11434/v1', model: 'qwen3:1.7b'}\n",
        );
        assert!(ha_chiave(d.path(), "local"));
        let t = carica_per_con(d.path(), Scopo::Traduzione, &none).unwrap();
        assert_eq!(t.fornitore, Fornitore::Local);
        assert_eq!(t.modello, "qwen3:1.7b");
        assert_eq!(
            t.endpoint.as_deref(),
            Some("http://192.168.1.20:11434/v1/chat/completions")
        );
        assert!(!t.sees_images);
        // A model of the purpose wins over the one saved with the address.
        scrivi(
            d.path(),
            "scopi:\n  simboli: {fornitore: local, modello: 'llama3.3'}\n\
             local: {url: 'http://192.168.1.20:11434/v1', model: 'qwen3:1.7b', sees_images: true}\n",
        );
        let t = carica_per_con(d.path(), Scopo::Simboli, &none).unwrap();
        assert_eq!((t.modello.as_str(), t.sees_images), ("llama3.3", true));
        assert!(t.endpoint.is_some());
    }

    /// «Prova» on the local model: the models of the server, with the address
    /// typed in the menu or the saved one, a Bearer only with a key, and
    /// before any key is looked for.
    #[tokio::test]
    async fn the_test_of_the_local_model_lists_its_models() {
        use axum::http::{header, HeaderMap};
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let seen2 = seen.clone();
        let app = axum::Router::new().route(
            "/v1/models",
            axum::routing::get(move |h: HeaderMap| {
                let seen = seen2.clone();
                async move {
                    let auth = h
                        .get(header::AUTHORIZATION)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("-")
                        .to_string();
                    seen.lock().unwrap().push(auth);
                    axum::Json(serde_json::json!({ "object": "list", "data": [
                        { "id": "qwen3:1.7b", "object": "model" },
                        { "id": "llama3.3", "object": "model" } ] }))
                }
            }),
        );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        let base = format!("http://{addr}/v1");
        let d = tempfile::tempdir().unwrap();
        let none = client::UserKeys::default();

        // Nothing saved, nothing typed.
        let e = prova_chiave(d.path(), "local", &none, None, false)
            .await
            .unwrap_err();
        assert!(e.contains("no address"), "{e}");
        // Typed, not saved.
        let ids = prova_chiave(d.path(), "local", &none, Some((&base, None)), false)
            .await
            .unwrap();
        assert_eq!(ids, ["llama3.3", "qwen3:1.7b"]);
        // Saved, with a short key of its own.
        scrivi(d.path(), &format!("local: {{url: '{base}/'}}\n"));
        std::fs::write(d.path().join("local.key"), "token-abc").unwrap();
        prova_chiave(d.path(), "local", &none, None, false)
            .await
            .unwrap();
        // Typed again, same server: the saved key goes with it.
        prova_chiave(d.path(), "local", &none, Some((&base, None)), false)
            .await
            .unwrap();
        // Review of 17-11-2026: another server typed, no key typed. The saved
        // key is not sent there: it is the key of the saved server.
        let other = format!("http://localhost:{}/v1", addr.port());
        prova_chiave(d.path(), "local", &none, Some((&other, None)), false)
            .await
            .unwrap();
        // In the cloud a loopback address is refused before any request.
        let e = prova_chiave(d.path(), "local", &none, None, true)
            .await
            .unwrap_err();
        assert!(e.contains("not public"), "{e}");
        let seen = seen.lock().unwrap();
        assert_eq!(*seen, ["-", "Bearer token-abc", "Bearer token-abc", "-"]);
    }
}
