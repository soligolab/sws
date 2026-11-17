//! The AI price list (plan `2026-11-17-ia-a-scelta-del-cliente`, F2).
//!
//! The prices used to live only in the code (`client::prezzi`,
//! `immagini::costo_stimato`, `bfl::prices`): they could not be corrected
//! without a release. Now three layers, merged by **whoever writes the file**:
//!
//! 1. the manual rows, `ai-prices-manual.json`, written from the platform
//!    console (cloud only);
//! 2. models.dev, downloaded once a day: no provider gives its prices through
//!    an API, and models.dev is the one source right for all three (checked on
//!    17-11-2026: OpenRouter resells Kimi, LiteLLM has an old Mistral Large);
//! 3. the built-in table.
//!
//! The result is `ai-prices.json`, already resolved, with each row's origin. In
//! the cloud the gateway writes it and pushes it into the project containers,
//! which never merge anything: they read the file and, for a model it lacks,
//! their own built-in table. So the console and the containers cannot show two
//! different prices. On a panel and on a local IDE the instance refreshes its
//! own file and nobody edits it.
//!
//! The file is read **at every cost lookup**, without a cache: once per turn
//! costs nothing, and a file pushed by the gateway counts from the next turn. A
//! broken or missing file means the built-in table.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{info, warn};

use crate::ai::bfl;
use crate::ai::client::{self, Fornitore, Prezzi};

/// The resolved price list: what every cost lookup reads.
pub const FILE: &str = "ai-prices.json";
/// The manual rows, as the platform admin wrote them (gateway only).
pub const MANUAL_FILE: &str = "ai-prices-manual.json";
/// The last good download, kept apart so that removing a manual row brings
/// back the models.dev price at once instead of the built-in one until the
/// next download.
const FETCHED_FILE: &str = "ai-prices-models-dev.json";

pub const MODELS_DEV_URL: &str = "https://models.dev/api.json";
/// About 6.7 MB on 17-11-2026, uncompressed (reqwest is built without gzip).
const MAX_DOWNLOAD_BYTES: usize = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);
/// A download younger than this is not repeated: the loop starts five minutes
/// after every boot, and a restart must not download again.
const FRESH_FOR_MS: u64 = 20 * 3600 * 1000;
/// A downloaded price this many times away from the built-in one is a mistake
/// upstream, not a new price list: it would turn into a wrong spending cap.
const SANITY_FACTOR: f64 = 5.0;
/// The lowest input or output price taken for a paid model, in dollars per
/// million tokens. The cheapest real ones are about 0.04 (Ministral 3B); a
/// price under this is a unit mistake upstream (dollars per token, not per
/// million), and on a model the table does not know it would count as free
/// and switch the spending cap off.
const MIN_PAID_PRICE: f64 = 0.01;
const VERSION: u32 = 1;

/// The paid text providers whose rows the list holds, by `Fornitore::nome`.
const TEXT_PROVIDERS: [&str; 3] = ["anthropic", "kimi", "mistral"];
const OPENAI_QUALITIES: [&str; 3] = ["low", "medium", "high"];

// ── The file ─────────────────────────────────────────────────────────────────

/// Dollars per million tokens.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rates {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

impl From<Prezzi> for Rates {
    fn from(p: Prezzi) -> Self {
        Rates {
            input: p.ingresso,
            output: p.uscita,
            cache_read: p.cache_lettura,
            cache_write: p.cache_scrittura,
        }
    }
}

impl From<Rates> for Prezzi {
    fn from(r: Rates) -> Self {
        Prezzi {
            ingresso: r.input,
            uscita: r.output,
            cache_lettura: r.cache_read,
            cache_scrittura: r.cache_write,
        }
    }
}

/// The dearer prices of a long request: above `above_tokens` of input (plain,
/// cache read and cache write together) they apply to all four items. A model
/// may have several, one above the other: the highest one passed counts.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Tier {
    pub above_tokens: u64,
    #[serde(flatten)]
    pub rates: Rates,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Origin {
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "models.dev")]
    ModelsDev,
    #[serde(rename = "builtin")]
    Builtin,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelPrice {
    #[serde(flatten)]
    pub rates: Rates,
    /// By threshold, lowest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tiers: Vec<Tier>,
    pub origin: Origin,
}

/// FLUX bills by megapixel: the first generated, each further one, each one of
/// the reference image of an edit.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BflPrice {
    pub first: f64,
    pub next: f64,
    pub input: f64,
}

/// No source covers images: they are the built-in table plus the manual rows.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImagePrices {
    /// Quality (`low`, `medium`, `high`) → dollars per image.
    #[serde(default)]
    pub openai: BTreeMap<String, f64>,
    #[serde(default)]
    pub bfl: BTreeMap<String, BflPrice>,
}

/// `ai-prices.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PriceList {
    pub version: u32,
    /// When models.dev was last downloaded successfully; `None` = never.
    pub at_ms: Option<u64>,
    pub source: String,
    /// Why the last download failed, if it did: the prices stayed as they were.
    pub last_error: Option<String>,
    /// Provider (`Fornitore::nome`) → model id → prices.
    pub models: BTreeMap<String, BTreeMap<String, ModelPrice>>,
    pub images: ImagePrices,
}

/// The last good download of models.dev, already filled and checked.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Fetched {
    at_ms: Option<u64>,
    last_error: Option<String>,
    models: BTreeMap<String, BTreeMap<String, ModelPrice>>,
}

// ── Lookup (every instance, containers included) ─────────────────────────────

/// The resolved list of this instance, or `None` when the file is missing or
/// broken: then the built-in table counts.
pub fn load(config_dir: &Path) -> Option<PriceList> {
    let text = std::fs::read_to_string(config_dir.join(FILE)).ok()?;
    match serde_json::from_str(&text) {
        Ok(l) => Some(l),
        Err(e) => {
            tracing::debug!("{FILE} unreadable, using the built-in prices: {e}");
            None
        }
    }
}

/// The prices of a model of a provider, and whether they are known.
#[derive(Debug, Clone, PartialEq)]
pub struct Lookup {
    pub prices: Prezzi,
    /// Threshold → prices, lowest first.
    pub tiers: Vec<(u64, Prezzi)>,
    pub known: bool,
}

/// The file first, then the built-in table. A local model is free and known
/// whatever the file says, except in the cloud: there it can only be a public
/// endpoint, often a paid one (maintainer, 17-11-2026), so it counts at the
/// table's price for that id, the Opus fallback for an unknown one, always as
/// an estimate, and the spending cap stays on.
pub fn lookup(config_dir: &Path, provider: Fornitore, model: &str, in_cloud: bool) -> Lookup {
    if provider == Fornitore::Local && in_cloud {
        return Lookup {
            prices: client::prezzi(model).0,
            tiers: client::builtin_tier(model).into_iter().collect(),
            known: false,
        };
    }
    if provider != Fornitore::Local {
        let id = model.trim().to_ascii_lowercase();
        if let Some(row) = load(config_dir)
            .as_ref()
            .and_then(|l| l.models.get(provider.nome()))
            .and_then(|m| m.get(&id))
        {
            return Lookup {
                prices: row.rates.into(),
                tiers: row
                    .tiers
                    .iter()
                    .map(|t| (t.above_tokens, t.rates.into()))
                    .collect(),
                known: true,
            };
        }
    }
    let (prices, known) = client::prezzi_per(provider, model);
    let tiers = match provider {
        Fornitore::Local => Vec::new(),
        _ => client::builtin_tier(model).into_iter().collect(),
    };
    Lookup {
        prices,
        tiers,
        known,
    }
}

/// The tier a request reaches: the highest threshold its input passes. The
/// input is counted as `client::cost_of` counts it.
fn tier_reached(tiers: &[(u64, Prezzi)], usage: &Value) -> Option<(u64, Prezzi)> {
    let tok = |c: &str| usage.get(c).and_then(Value::as_u64).unwrap_or(0);
    let input =
        tok("input_tokens") + tok("cache_read_input_tokens") + tok("cache_creation_input_tokens");
    tiers
        .iter()
        .filter(|(above, _)| input > *above)
        .max_by_key(|(above, _)| *above)
        .copied()
}

/// What one turn cost, at the prices of this instance.
pub fn cost_usd(
    config_dir: &Path,
    provider: Fornitore,
    model: &str,
    usage: &Value,
    in_cloud: bool,
) -> f64 {
    let l = lookup(config_dir, provider, model, in_cloud);
    client::cost_of(l.prices, tier_reached(&l.tiers, usage), usage)
}

/// Whether the price of a model is known or estimated (the "≈" of the chat).
pub fn known(config_dir: &Path, provider: Fornitore, model: &str, in_cloud: bool) -> bool {
    lookup(config_dir, provider, model, in_cloud).known
}

/// The price of one OpenAI image of `quality`. An unknown quality counts as
/// medium, as in `immagini::costo_stimato`.
pub fn openai_image_usd(config_dir: &Path, quality: &str) -> f64 {
    let q = if OPENAI_QUALITIES.contains(&quality) {
        quality
    } else {
        "medium"
    };
    load(config_dir)
        .and_then(|l| l.images.openai.get(q).copied())
        .unwrap_or_else(|| crate::ai::immagini::costo_stimato(q))
}

/// The megapixel prices of a FLUX model.
pub(crate) fn bfl_prices(config_dir: &Path, model: &str) -> bfl::Prices {
    load(config_dir)
        .and_then(|l| l.images.bfl.get(model.trim()).copied())
        .map(|p| bfl::Prices {
            first: p.first,
            next: p.next,
            input: p.input,
        })
        .unwrap_or_else(|| bfl::prices(model))
}

// ── models.dev ───────────────────────────────────────────────────────────────

/// Only the three providers are read: serde skips the other hundred without
/// building them, so 6.7 MB do not become a tree of `Value`s on a panel.
#[derive(Deserialize)]
struct Dev {
    anthropic: Option<DevProvider>,
    moonshotai: Option<DevProvider>,
    mistral: Option<DevProvider>,
}

#[derive(Deserialize)]
struct DevProvider {
    #[serde(default)]
    models: BTreeMap<String, DevModel>,
}

#[derive(Deserialize)]
struct DevModel {
    /// Kept loose: one model with an odd field must cost that model, not the
    /// whole download.
    #[serde(default)]
    cost: Option<Value>,
}

#[derive(Deserialize)]
struct DevCost {
    input: Option<f64>,
    output: Option<f64>,
    cache_read: Option<f64>,
    cache_write: Option<f64>,
    #[serde(default)]
    tiers: Vec<DevTier>,
}

#[derive(Deserialize)]
struct DevTier {
    input: Option<f64>,
    output: Option<f64>,
    cache_read: Option<f64>,
    cache_write: Option<f64>,
    tier: Option<DevTierKind>,
}

#[derive(Deserialize)]
struct DevTierKind {
    #[serde(rename = "type")]
    kind: String,
    size: Option<u64>,
}

fn positive(v: Option<f64>) -> Option<f64> {
    v.filter(|x| x.is_finite() && *x > 0.0)
}

/// An input or output price of a paid model: at least [`MIN_PAID_PRICE`].
fn paid(v: Option<f64>) -> Option<f64> {
    v.filter(|x| x.is_finite() && *x >= MIN_PAID_PRICE)
}

/// The prices a source left out, with the rules of the built-in table: cache
/// write at 1.25 times the input (Anthropic, Mistral) or at the input (Kimi),
/// cache read at a tenth of the input.
fn fill(
    provider: &str,
    input: f64,
    output: f64,
    cache_read: Option<f64>,
    cache_write: Option<f64>,
) -> Rates {
    let write_factor = if provider == "kimi" { 1.0 } else { 1.25 };
    Rates {
        input,
        output,
        cache_read: positive(cache_read).unwrap_or(input / 10.0),
        cache_write: positive(cache_write).unwrap_or(input * write_factor),
    }
}

/// models.dev → provider → model → prices, rows without a usable price left
/// out. A price of 0 for a paid provider is never taken, nor one so close to
/// it that it is a unit mistake ([`MIN_PAID_PRICE`]): it would switch the
/// spending cap off.
fn parse_models_dev(
    bytes: &[u8],
) -> Result<BTreeMap<String, BTreeMap<String, ModelPrice>>, String> {
    let dev: Dev = serde_json::from_slice(bytes).map_err(|e| format!("models.dev: {e}"))?;
    let mut out = BTreeMap::new();
    for (name, p) in [
        ("anthropic", dev.anthropic),
        ("kimi", dev.moonshotai),
        ("mistral", dev.mistral),
    ] {
        let Some(p) = p else { continue };
        let mut rows = BTreeMap::new();
        for (id, m) in p.models {
            let Some(cost) = m
                .cost
                .and_then(|c| serde_json::from_value::<DevCost>(c).ok())
            else {
                continue;
            };
            let (Some(input), Some(output)) = (paid(cost.input), paid(cost.output)) else {
                continue;
            };
            let mut tiers: Vec<Tier> = cost
                .tiers
                .iter()
                .filter_map(|t| {
                    let k = t.tier.as_ref()?;
                    let size = k.size.filter(|s| k.kind == "context" && *s > 0)?;
                    Some(Tier {
                        above_tokens: size,
                        rates: fill(
                            name,
                            paid(t.input)?,
                            paid(t.output)?,
                            t.cache_read,
                            t.cache_write,
                        ),
                    })
                })
                .collect();
            tiers.sort_by_key(|t| t.above_tokens);
            tiers.dedup_by_key(|t| t.above_tokens);
            rows.insert(
                id.trim().to_ascii_lowercase(),
                ModelPrice {
                    rates: fill(name, input, output, cost.cache_read, cost.cache_write),
                    tiers,
                    origin: Origin::ModelsDev,
                },
            );
        }
        out.insert(name.to_string(), rows);
    }
    Ok(out)
}

fn far_apart(a: Rates, b: Rates) -> bool {
    [
        (a.input, b.input),
        (a.output, b.output),
        (a.cache_read, b.cache_read),
        (a.cache_write, b.cache_write),
    ]
    .into_iter()
    .any(|(x, y)| x.max(y) > SANITY_FACTOR * x.min(y))
}

/// Drops the downloaded rows more than ×5 away from the built-in table, once,
/// at the download. Only for a model the table **knows**: for any other id
/// the table answers with the Opus fallback (or a Mistral family estimate),
/// and a new cheap model would be thrown away for being cheap.
fn sanity_check(models: &mut BTreeMap<String, BTreeMap<String, ModelPrice>>) {
    for (provider, rows) in models.iter_mut() {
        rows.retain(|id, row| {
            let (base, known) = client::prezzi(id);
            if !known {
                return true;
            }
            if far_apart(row.rates, base.into()) {
                warn!(provider = %provider, model = %id, "models.dev price more than 5 times away from the built-in one: ignored");
                return false;
            }
            // The tier at the threshold of the table's; the others it cannot judge.
            let builtin = client::builtin_tier(id);
            let same = |t: &&Tier| builtin.is_some_and(|(above, _)| t.above_tokens == above);
            if let (Some(t), Some((_, bt))) = (row.tiers.iter().find(same), builtin) {
                if far_apart(t.rates, bt.into()) {
                    warn!(provider = %provider, model = %id, "models.dev tier price more than 5 times away from the built-in one: ignored");
                    return false;
                }
            }
            true
        });
    }
}

// ── The manual rows ──────────────────────────────────────────────────────────

/// `ai-prices-manual.json`. Typos are refused (`deny_unknown_fields`): a price
/// under a misspelt key would silently not apply.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManualRows {
    #[serde(default)]
    pub models: BTreeMap<String, BTreeMap<String, ManualModel>>,
    #[serde(default)]
    pub images: ImagePrices,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManualModel {
    pub input: f64,
    pub output: f64,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
    pub tier: Option<ManualTier>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManualTier {
    pub above_tokens: u64,
    pub input: f64,
    pub output: f64,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
}

/// Every number finite and above zero: all the providers of the list are paid,
/// and a 0 typed by mistake would switch the spending cap off. Input and output
/// of a model at least [`MIN_PAID_PRICE`], as for models.dev.
fn validate(m: &ManualRows) -> Result<(), String> {
    let price = |what: &str, v: f64| {
        if v.is_finite() && v > 0.0 {
            Ok(())
        } else {
            Err(format!("{what}: {v} is not a price above zero"))
        }
    };
    let rate = |what: &str, v: f64| {
        price(what, v)?;
        if v < MIN_PAID_PRICE {
            return Err(format!(
                "{what}: {v} $ per million tokens is below {MIN_PAID_PRICE}: \
                 a price per token instead of per million?"
            ));
        }
        Ok(())
    };
    let opt = |what: &str, v: Option<f64>| v.map_or(Ok(()), |v| price(what, v));
    for (provider, rows) in &m.models {
        if !TEXT_PROVIDERS.contains(&provider.as_str()) {
            return Err(format!(
                "unknown provider {provider:?}: expected one of {TEXT_PROVIDERS:?}"
            ));
        }
        for (id, r) in rows {
            if id.trim().is_empty() {
                return Err(format!("{provider}: empty model id"));
            }
            let at = |f: &str| format!("{provider}/{id}.{f}");
            rate(&at("input"), r.input)?;
            rate(&at("output"), r.output)?;
            opt(&at("cache_read"), r.cache_read)?;
            opt(&at("cache_write"), r.cache_write)?;
            if let Some(t) = &r.tier {
                if t.above_tokens == 0 {
                    return Err(format!("{}: must be above zero", at("tier.above_tokens")));
                }
                rate(&at("tier.input"), t.input)?;
                rate(&at("tier.output"), t.output)?;
                opt(&at("tier.cache_read"), t.cache_read)?;
                opt(&at("tier.cache_write"), t.cache_write)?;
            }
        }
    }
    for (q, v) in &m.images.openai {
        if !OPENAI_QUALITIES.contains(&q.as_str()) {
            return Err(format!(
                "images.openai: unknown quality {q:?}, expected one of {OPENAI_QUALITIES:?}"
            ));
        }
        price(&format!("images.openai.{q}"), *v)?;
    }
    for (model, p) in &m.images.bfl {
        if model.trim().is_empty() {
            return Err("images.bfl: empty model id".into());
        }
        price(&format!("images.bfl.{model}.first"), p.first)?;
        price(&format!("images.bfl.{model}.next"), p.next)?;
        price(&format!("images.bfl.{model}.input"), p.input)?;
    }
    Ok(())
}

fn load_manual(config_dir: &Path) -> ManualRows {
    let Ok(text) = std::fs::read_to_string(config_dir.join(MANUAL_FILE)) else {
        return ManualRows::default();
    };
    match serde_json::from_str::<ManualRows>(&text) {
        Ok(m) if validate(&m).is_ok() => m,
        _ => {
            warn!("{MANUAL_FILE} unreadable or invalid: manual prices ignored");
            ManualRows::default()
        }
    }
}

/// The manual rows as they were written, for the console to edit them.
pub fn manual_as_written(config_dir: &Path) -> Value {
    std::fs::read_to_string(config_dir.join(MANUAL_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

// ── Resolving and writing (gateway, panel, local IDE) ────────────────────────

fn load_fetched(config_dir: &Path) -> Fetched {
    std::fs::read_to_string(config_dir.join(FETCHED_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// The three layers merged: manual over models.dev over the built-in table.
fn resolve(manual: &ManualRows, fetched: &Fetched) -> PriceList {
    let mut models: BTreeMap<String, BTreeMap<String, ModelPrice>> = BTreeMap::new();
    for (provider, id, p) in client::builtin_rows() {
        models
            .entry(provider.nome().to_string())
            .or_default()
            .insert(
                id.to_string(),
                ModelPrice {
                    rates: p.into(),
                    tiers: client::builtin_tier(id)
                        .map(|(above, t)| Tier {
                            above_tokens: above,
                            rates: t.into(),
                        })
                        .into_iter()
                        .collect(),
                    origin: Origin::Builtin,
                },
            );
    }
    // A row that says nothing of tiers keeps those of the layer below: a base
    // price corrected by hand, or a models.dev row without `tiers`, must not
    // drop Haiku's dearer prices above 100k and count long requests at a
    // fifth of their cost.
    fn put(into: &mut BTreeMap<String, ModelPrice>, id: String, mut row: ModelPrice) {
        if row.tiers.is_empty() {
            if let Some(below) = into.get(&id) {
                row.tiers = below.tiers.clone();
            }
        }
        into.insert(id, row);
    }
    for (provider, rows) in &fetched.models {
        let into = models.entry(provider.clone()).or_default();
        for (id, row) in rows {
            put(into, id.clone(), row.clone());
        }
    }
    for (provider, rows) in &manual.models {
        let into = models.entry(provider.clone()).or_default();
        for (id, r) in rows {
            put(
                into,
                id.trim().to_ascii_lowercase(),
                ModelPrice {
                    rates: fill(provider, r.input, r.output, r.cache_read, r.cache_write),
                    tiers: r
                        .tier
                        .as_ref()
                        .map(|t| Tier {
                            above_tokens: t.above_tokens,
                            rates: fill(provider, t.input, t.output, t.cache_read, t.cache_write),
                        })
                        .into_iter()
                        .collect(),
                    origin: Origin::Manual,
                },
            );
        }
    }

    let mut images = ImagePrices::default();
    for q in OPENAI_QUALITIES {
        images
            .openai
            .insert(q.to_string(), crate::ai::immagini::costo_stimato(q));
    }
    for m in bfl::LISTED_MODELS {
        let p = bfl::prices(m);
        images.bfl.insert(
            m.to_string(),
            BflPrice {
                first: p.first,
                next: p.next,
                input: p.input,
            },
        );
    }
    images.openai.extend(manual.images.openai.clone());
    images.bfl.extend(
        manual
            .images
            .bfl
            .iter()
            .map(|(k, v)| (k.trim().to_string(), *v)),
    );

    PriceList {
        version: VERSION,
        at_ms: fetched.at_ms,
        source: MODELS_DEV_URL.to_string(),
        last_error: fetched.last_error.clone(),
        models,
        images,
    }
}

/// Temporary file and rename: a container reading mid-write would otherwise
/// see half a file, that is the built-in table for one turn.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension(format!("json.tmp-{}", std::process::id()));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

fn write_json(path: &Path, v: &impl Serialize) -> std::io::Result<()> {
    let bytes = serde_json::to_vec_pretty(v).map_err(std::io::Error::other)?;
    write_atomic(path, &bytes)
}

/// Writes `ai-prices.json` again from the three layers. Cheap: no download.
pub fn rebuild(config_dir: &Path) -> std::io::Result<PriceList> {
    let list = resolve(&load_manual(config_dir), &load_fetched(config_dir));
    write_json(&config_dir.join(FILE), &list)?;
    Ok(list)
}

/// The resolved list the console shows: the file, or what it would be.
pub fn current(config_dir: &Path) -> PriceList {
    load(config_dir).unwrap_or_else(|| resolve(&load_manual(config_dir), &load_fetched(config_dir)))
}

/// Saves the manual rows sent by the console and rebuilds the file. The text
/// is kept as written, so the console shows it back unchanged.
pub fn save_manual(config_dir: &Path, body: &Value) -> Result<PriceList, String> {
    let rows: ManualRows = serde_json::from_value(body.clone()).map_err(|e| e.to_string())?;
    validate(&rows)?;
    write_json(&config_dir.join(MANUAL_FILE), body).map_err(|e| e.to_string())?;
    rebuild(config_dir).map_err(|e| e.to_string())
}

/// Whether the last good download is younger than 20 hours.
pub fn is_fresh(config_dir: &Path, now_ms: u64) -> bool {
    load_fetched(config_dir)
        .at_ms
        .is_some_and(|at| now_ms.saturating_sub(at) < FRESH_FOR_MS)
}

async fn download(http: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let mut r = http
        .get(url)
        .timeout(DOWNLOAD_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("{url} unreachable: {e}"))?;
    if !r.status().is_success() {
        return Err(format!("{url} answered {}", r.status()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = r
        .chunk()
        .await
        .map_err(|e| format!("{url} interrupted: {e}"))?
    {
        if body.len() + chunk.len() > MAX_DOWNLOAD_BYTES {
            return Err(format!("{url} is larger than {MAX_DOWNLOAD_BYTES} bytes"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Downloads models.dev and rebuilds the file. An error leaves the prices as
/// they were and is written in `last_error`, for the console to show.
pub async fn refresh(
    config_dir: &Path,
    http: &reqwest::Client,
    url: &str,
    now_ms: u64,
) -> Result<PriceList, String> {
    let mut fetched = load_fetched(config_dir);
    let outcome = match download(http, url).await {
        Ok(bytes) => parse_models_dev(&bytes),
        Err(e) => Err(e),
    };
    let result = match outcome {
        Ok(mut models) => {
            sanity_check(&mut models);
            let n: usize = models.values().map(BTreeMap::len).sum();
            info!("AI price list downloaded from models.dev: {n} models");
            fetched = Fetched {
                at_ms: Some(now_ms),
                last_error: None,
                models,
            };
            Ok(())
        }
        Err(e) => {
            warn!("AI price list not updated: {e}");
            fetched.last_error = Some(e.clone());
            Err(e)
        }
    };
    write_json(&config_dir.join(FETCHED_FILE), &fetched).map_err(|e| e.to_string())?;
    let list = rebuild(config_dir).map_err(|e| e.to_string())?;
    result.map(|()| list)
}

/// After a change, the gateway hands the file to the open containers.
pub async fn push(s: &crate::router::AppState) {
    if let Some(regia) = &s.regia {
        regia.update_prices().await;
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Where this instance keeps its list.
pub fn path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE)
}

/// The daily loop: on the gateway and on the instances without a gateway (a
/// panel, a local IDE). Never in a project container behind the gateway, which
/// gets the gateway's file instead: told by the static secret, not by the
/// origin of the forwarded requests, which stays unknown until the first one.
pub fn start(s: crate::router::AppState) {
    if s.segreto_gateway.is_some() {
        return;
    }
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(300)).await;
        let http = reqwest::Client::new();
        let mut t = tokio::time::interval(Duration::from_secs(24 * 3600));
        loop {
            t.tick().await;
            round(&s, &http, now_ms()).await;
        }
    });
}

async fn round(s: &crate::router::AppState, http: &reqwest::Client, now_ms: u64) {
    let dir = s.config_dir.as_ref();
    if is_fresh(dir, now_ms) {
        // A new binary may carry a corrected built-in table: rebuild anyway.
        if let Err(e) = rebuild(dir) {
            warn!("{FILE} not written: {e}");
        }
    } else {
        let _ = refresh(dir, http, MODELS_DEV_URL, now_ms).await;
    }
    push(s).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const FIXTURE: &str = include_str!("../../tests/ai/models-dev-excerpt.json");

    fn fixture() -> BTreeMap<String, BTreeMap<String, ModelPrice>> {
        parse_models_dev(FIXTURE.as_bytes()).unwrap()
    }

    fn rates(input: f64, output: f64, cache_read: f64, cache_write: f64) -> Rates {
        Rates {
            input,
            output,
            cache_read,
            cache_write,
        }
    }

    /// A real excerpt of models.dev (17-11-2026): the three providers under
    /// our names, the others skipped, the Haiku tier read.
    #[test]
    fn a_real_excerpt_of_models_dev_is_read() {
        let m = fixture();
        assert_eq!(
            m.keys().collect::<Vec<_>>(),
            ["anthropic", "kimi", "mistral"]
        );
        let opus = &m["anthropic"]["claude-opus-5-5"];
        assert_eq!(opus.rates, rates(4.0, 20.0, 0.2, 5.0));
        assert_eq!(opus.origin, Origin::ModelsDev);
        assert!(opus.tiers.is_empty());
        assert_eq!(m["anthropic"]["claude-sonnet-5-5"].rates.cache_read, 0.1);
        let haiku = &m["anthropic"]["claude-haiku-5-5"];
        let [tier] = haiku.tiers[..] else {
            panic!("Haiku 5.5 has one tier: {:?}", haiku.tiers)
        };
        assert_eq!(tier.above_tokens, 100_000);
        assert_eq!(tier.rates, rates(0.5, 2.5, 0.05, 0.625));
        assert_eq!(m["kimi"]["kimi-k3.1-pro"].rates, rates(2.0, 10.0, 0.2, 2.0));
        assert_eq!(m["mistral"]["mistral-large-latest"].rates.input, 0.7);
    }

    /// The built-in table agrees with models.dev on every model of the
    /// excerpt it knows: Sonnet 5.5 reads its cache at 0.10, Haiku 5.5 has its
    /// tier (both wrong until 17-11-2026).
    #[test]
    fn the_builtin_table_agrees_with_models_dev() {
        let mut checked = 0;
        for rows in fixture().values() {
            for (id, row) in rows {
                let (base, known) = client::prezzi(id);
                if !known {
                    continue;
                }
                checked += 1;
                assert_eq!(Rates::from(base), row.rates, "{id}");
                let tier: Vec<Tier> = client::builtin_tier(id)
                    .map(|(above, t)| Tier {
                        above_tokens: above,
                        rates: t.into(),
                    })
                    .into_iter()
                    .collect();
                assert_eq!(tier, row.tiers, "{id}");
            }
        }
        assert_eq!(checked, 8);
    }

    /// The prices models.dev leaves out follow the rules of the built-in
    /// table, and a row free of charge or without a cost is not taken.
    #[test]
    fn missing_prices_follow_the_rules_of_the_table() {
        let m = fixture();
        // Mistral has no cache write: 1.25 times the input.
        let large = m["mistral"]["mistral-large-latest"].rates;
        assert!((large.cache_write - 0.875).abs() < 1e-9);
        // Devstral has no cache read either: a tenth of the input.
        let dev = m["mistral"]["devstral-2512"].rates;
        assert!((dev.cache_read - 0.04).abs() < 1e-9);
        assert!((dev.cache_write - 0.5).abs() < 1e-9);
        // Kimi writes its cache at the input price.
        assert_eq!(m["kimi"]["kimi-k2.6"].rates.cache_write, 0.95);
        // 0 $ (a free lab model) would switch the cap off; null is no price.
        assert!(!m["mistral"].contains_key("labs-leanstral-1-5-1"));
        assert!(!m["mistral"].contains_key("voxtral-mini-latest"));
    }

    /// ×5 from the built-in table throws a row away, but only for a model the
    /// table knows: a new cheap model is not compared with the Opus fallback.
    #[test]
    fn the_sanity_check_applies_to_known_models_only() {
        let mut m = fixture();
        let a = m.get_mut("anthropic").unwrap();
        a.get_mut("claude-opus-5-5").unwrap().rates.input = 40.0;
        a.insert(
            "claude-tiny-9".into(),
            ModelPrice {
                rates: rates(0.01, 0.05, 0.001, 0.0125),
                tiers: Vec::new(),
                origin: Origin::ModelsDev,
            },
        );
        sanity_check(&mut m);
        let a = &m["anthropic"];
        assert!(
            !a.contains_key("claude-opus-5-5"),
            "40 against 4 is a mistake"
        );
        assert!(a.contains_key("claude-tiny-9"), "unknown: taken unchecked");
        // The Haiku tier (0.5) is ×5 the Haiku base, but it is compared with
        // the built-in tier, not with the base.
        assert!(a.contains_key("claude-haiku-5-5"));
        assert!(a.contains_key("claude-sonnet-5-5"));
    }

    /// The tier counts all the input of the request, cache included, and
    /// above it prices every item.
    #[test]
    fn the_tier_is_measured_on_the_whole_input() {
        let dir = tempfile::tempdir().unwrap();
        // 60k plain + 50k cache read: 110k, above Haiku's 100k.
        let u = json!({"input_tokens": 60_000, "cache_read_input_tokens": 50_000,
                       "output_tokens": 1_000_000});
        let c = cost_usd(
            dir.path(),
            Fornitore::Anthropic,
            "claude-haiku-5-5",
            &u,
            false,
        );
        let expected = (60_000.0 * 0.5 + 50_000.0 * 0.05 + 1_000_000.0 * 2.5) / 1e6;
        assert!((c - expected).abs() < 1e-9, "{c} != {expected}");
        // 60k alone stays at the base prices.
        let u = json!({"input_tokens": 60_000, "output_tokens": 1_000_000});
        let c = cost_usd(
            dir.path(),
            Fornitore::Anthropic,
            "claude-haiku-5-5",
            &u,
            false,
        );
        assert!((c - (60_000.0 * 0.1 + 1_000_000.0 * 0.5) / 1e6).abs() < 1e-9);
    }

    /// The file wins over the table; a broken file means the table.
    #[test]
    fn a_broken_file_means_the_builtin_table() {
        let dir = tempfile::tempdir().unwrap();
        let u = json!({"input_tokens": 1_000_000});
        let builtin = client::costo_usd(Fornitore::Anthropic, "claude-opus-5-5", &u);
        assert_eq!(
            cost_usd(
                dir.path(),
                Fornitore::Anthropic,
                "claude-opus-5-5",
                &u,
                false
            ),
            builtin
        );

        let mut list = resolve(&ManualRows::default(), &Fetched::default());
        list.models
            .get_mut("anthropic")
            .unwrap()
            .get_mut("claude-opus-5-5")
            .unwrap()
            .rates
            .input = 3.0;
        write_json(&dir.path().join(FILE), &list).unwrap();
        assert_eq!(
            cost_usd(
                dir.path(),
                Fornitore::Anthropic,
                "claude-opus-5-5",
                &u,
                false
            ),
            3.0
        );
        // A model the file does not hold: the table, estimate included.
        assert!(!known(
            dir.path(),
            Fornitore::Anthropic,
            "claude-unknown",
            false
        ));

        std::fs::write(dir.path().join(FILE), "{ not json").unwrap();
        assert_eq!(
            cost_usd(
                dir.path(),
                Fornitore::Anthropic,
                "claude-opus-5-5",
                &u,
                false
            ),
            builtin
        );
    }

    /// A local model is free and its price known, whatever the file says.
    #[test]
    fn local_is_zero_and_known() {
        let dir = tempfile::tempdir().unwrap();
        let mut list = resolve(&ManualRows::default(), &Fetched::default());
        list.models.entry("local".into()).or_default().insert(
            "qwen3:32b".into(),
            ModelPrice {
                rates: rates(5.0, 25.0, 0.5, 6.25),
                tiers: Vec::new(),
                origin: Origin::Manual,
            },
        );
        write_json(&dir.path().join(FILE), &list).unwrap();
        let u = json!({"input_tokens": 1_000_000, "output_tokens": 1_000_000});
        assert_eq!(
            cost_usd(dir.path(), Fornitore::Local, "qwen3:32b", &u, false),
            0.0
        );
        assert!(known(dir.path(), Fornitore::Local, "qwen3:32b", false));
    }

    /// In the cloud a "local" model is a public endpoint, maybe a paid one: it
    /// counts as an estimate at the Opus fallback, and the cap stays on
    /// (maintainer, 17-11-2026).
    #[test]
    fn in_the_cloud_a_local_model_is_an_estimate() {
        let dir = tempfile::tempdir().unwrap();
        let u = json!({"input_tokens": 1_000_000, "output_tokens": 1_000_000});
        let opus = cost_usd(dir.path(), Fornitore::Anthropic, "claude-opus-5", &u, false);
        assert!(opus > 0.0);
        assert_eq!(
            cost_usd(dir.path(), Fornitore::Local, "qwen3:32b", &u, true),
            opus
        );
        assert!(!known(dir.path(), Fornitore::Local, "qwen3:32b", true));
        // An id the table knows counts at its price, still as an estimate.
        assert_eq!(
            cost_usd(
                dir.path(),
                Fornitore::Local,
                "mistral-small-latest",
                &u,
                true
            ),
            cost_usd(
                dir.path(),
                Fornitore::Mistral,
                "mistral-small-latest",
                &u,
                false
            )
        );
        assert!(!known(
            dir.path(),
            Fornitore::Local,
            "mistral-small-latest",
            true
        ));
    }

    /// Manual over models.dev over the table, each row saying where it comes
    /// from; images from the table plus the manual rows.
    #[test]
    fn manual_rows_win_and_say_so() {
        let dir = tempfile::tempdir().unwrap();
        let fetched = Fetched {
            at_ms: Some(1),
            last_error: None,
            models: fixture(),
        };
        write_json(&dir.path().join(FETCHED_FILE), &fetched).unwrap();
        let list = save_manual(
            dir.path(),
            &json!({
                "models": {"mistral": {"Mistral-Large-Latest": {"input": 0.8, "output": 2.4}}},
                "images": {"openai": {"high": 0.3}, "bfl": {"flux-2-max": {"first": 0.07, "next": 0.03, "input": 0.03}}}
            }),
        )
        .unwrap();
        let large = &list.models["mistral"]["mistral-large-latest"];
        assert_eq!(large.origin, Origin::Manual);
        assert_eq!(large.rates, rates(0.8, 2.4, 0.08, 1.0));
        assert_eq!(
            list.models["anthropic"]["claude-opus-5-5"].origin,
            Origin::ModelsDev
        );
        assert_eq!(list.models["kimi"]["kimi-k3"].origin, Origin::ModelsDev);
        // Not on models.dev's excerpt: from the table.
        assert_eq!(
            list.models["anthropic"]["claude-opus-4-8"].origin,
            Origin::Builtin
        );
        assert_eq!(list.images.openai["high"], 0.3);
        assert_eq!(list.images.openai["low"], 0.02);
        assert!(list.images.bfl.contains_key("flux-2-pro"));

        // And the lookups read it.
        assert_eq!(openai_image_usd(dir.path(), "high"), 0.3);
        assert_eq!(bfl_prices(dir.path(), "flux-2-max").first, 0.07);
        assert_eq!(
            manual_as_written(dir.path())["models"]["mistral"]["Mistral-Large-Latest"]["input"],
            0.8
        );
    }

    /// A zero, a negative, a typo or a provider that is not paid are refused.
    #[test]
    fn invalid_manual_rows_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        for bad in [
            json!({"models": {"anthropic": {"claude-opus-5-5": {"input": 0, "output": 25}}}}),
            json!({"models": {"anthropic": {"claude-opus-5-5": {"input": 5, "output": -1}}}}),
            json!({"models": {"anthropic": {"claude-opus-5-5": {"input": 5, "output": 25, "cache_reed": 1}}}}),
            json!({"models": {"local": {"qwen3": {"input": 1, "output": 1}}}}),
            json!({"images": {"openai": {"ultra": 1.0}}}),
            json!({"images": {"bfl": {"flux-2-pro": {"first": 0.03, "next": 0, "input": 0.01}}}}),
            json!({"prices": {}}),
            // Dollars per token instead of per million (review of 17-11-2026).
            json!({"models": {"anthropic": {"claude-opus-6": {"input": 0.000005, "output": 0.000025}}}}),
        ] {
            assert!(save_manual(dir.path(), &bad).is_err(), "{bad}");
        }
        assert!(!dir.path().join(MANUAL_FILE).exists());
    }

    /// Review of 17-11-2026: a price per token instead of per million, on a
    /// model the table does not know, passed unchecked and counted as free.
    #[test]
    fn a_price_close_to_zero_is_not_taken_from_models_dev() {
        let dev = json!({ "anthropic": { "models": {
            "claude-opus-6": { "cost": { "input": 0.000005, "output": 0.000025 } },
            "claude-new-cheap": { "cost": { "input": 0.04, "output": 0.1 } } } } });
        let m = parse_models_dev(dev.to_string().as_bytes()).unwrap();
        assert!(!m["anthropic"].contains_key("claude-opus-6"));
        assert!(m["anthropic"].contains_key("claude-new-cheap"));
    }

    /// Review of 17-11-2026: a row that says nothing of tiers replaced the
    /// row below whole, and Haiku 5.5 above 100k counted at a fifth.
    #[test]
    fn a_row_without_tiers_keeps_those_below() {
        let mut models = fixture();
        models
            .get_mut("anthropic")
            .unwrap()
            .get_mut("claude-haiku-5-5")
            .unwrap()
            .tiers
            .clear();
        let fetched = Fetched {
            at_ms: Some(1),
            last_error: None,
            models,
        };
        // models.dev without `tiers`: the table's tier stays.
        let list = resolve(&ManualRows::default(), &fetched);
        let haiku = &list.models["anthropic"]["claude-haiku-5-5"];
        assert_eq!(haiku.tiers.len(), 1);
        assert_eq!(haiku.tiers[0].above_tokens, 100_000);
        // A base price corrected by hand: the tier stays too.
        let manual: ManualRows = serde_json::from_value(json!({ "models": { "anthropic": {
            "claude-haiku-5-5": { "input": 0.12, "output": 0.6 } } } }))
        .unwrap();
        let list = resolve(&manual, &fetched);
        let haiku = &list.models["anthropic"]["claude-haiku-5-5"];
        assert_eq!(haiku.origin, Origin::Manual);
        assert_eq!(haiku.rates.input, 0.12);
        assert_eq!(haiku.tiers[0].rates.input, 0.5);
    }

    /// Review of 17-11-2026: of several tiers only the lowest was kept, and a
    /// request above the highest counted at the prices of the first.
    #[test]
    fn the_highest_tier_passed_counts() {
        let dev = json!({ "anthropic": { "models": { "claude-long-1": { "cost": {
            "input": 1.0, "output": 5.0,
            "tiers": [
                { "input": 4.0, "output": 20.0, "tier": { "type": "context", "size": 1_000_000 } },
                { "input": 2.0, "output": 10.0, "tier": { "type": "context", "size": 200_000 } } ] } } } } });
        let models = parse_models_dev(dev.to_string().as_bytes()).unwrap();
        let row = &models["anthropic"]["claude-long-1"];
        assert_eq!(
            row.tiers.iter().map(|t| t.above_tokens).collect::<Vec<_>>(),
            [200_000, 1_000_000]
        );
        let dir = tempfile::tempdir().unwrap();
        let fetched = Fetched {
            at_ms: Some(1),
            last_error: None,
            models,
        };
        write_json(
            &dir.path().join(FILE),
            &resolve(&ManualRows::default(), &fetched),
        )
        .unwrap();
        let cost = |input: u64| {
            cost_usd(
                dir.path(),
                Fornitore::Anthropic,
                "claude-long-1",
                &json!({ "input_tokens": input }),
                false,
            )
        };
        assert!((cost(100_000) - 0.1).abs() < 1e-9);
        assert!((cost(500_000) - 1.0).abs() < 1e-9);
        assert!((cost(1_500_000) - 6.0).abs() < 1e-9);
    }

    /// The download through a fake models.dev: the file is written with the
    /// date, and a failure keeps the prices and says why.
    #[tokio::test]
    async fn refresh_writes_the_file_and_keeps_it_on_errors() {
        use axum::routing::get;
        let app = axum::Router::new()
            .route("/api.json", get(|| async { FIXTURE }))
            .route(
                "/broken.json",
                get(|| async { (axum::http::StatusCode::BAD_GATEWAY, "no") }),
            );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        let dir = tempfile::tempdir().unwrap();
        let http = reqwest::Client::new();

        assert!(!is_fresh(dir.path(), 10));
        let list = refresh(
            dir.path(),
            &http,
            &format!("http://127.0.0.1:{port}/api.json"),
            1_000,
        )
        .await
        .unwrap();
        assert_eq!(list.at_ms, Some(1_000));
        assert_eq!(load(dir.path()).unwrap(), list);
        assert!(is_fresh(dir.path(), 1_000 + FRESH_FOR_MS - 1));
        assert!(!is_fresh(dir.path(), 1_000 + FRESH_FOR_MS));

        let e = refresh(
            dir.path(),
            &http,
            &format!("http://127.0.0.1:{port}/broken.json"),
            2_000,
        )
        .await
        .unwrap_err();
        let after = load(dir.path()).unwrap();
        assert_eq!(after.last_error.as_deref(), Some(e.as_str()));
        assert_eq!(after.at_ms, Some(1_000));
        assert_eq!(after.models, list.models, "the prices stay as they were");
    }
}
