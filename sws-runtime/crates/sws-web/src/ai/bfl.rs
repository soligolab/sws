//! Black Forest Labs (FLUX.2) for the page backgrounds, next to gpt-image-2
//! (phase G5 of `docs/archive/2026-11-10-assistente-secondo-giro.md`).
//!
//! # The API, as documented on 16-11-2026 (docs.bfl.ai)
//!
//! Asynchronous, unlike OpenAI's:
//!
//! 1. `POST https://api.bfl.ai/v1/<model>` (`flux-2-pro`) with the key in the
//!    `x-key` header and `{prompt, width, height, output_format, input_image?}`
//!    → `{id, polling_url, cost?}`;
//! 2. `GET <polling_url>` (same `x-key`; the guide says the returned URL **must**
//!    be used, not a fixed host) until `status` is `Ready`; meanwhile `Pending`,
//!    `Reasoning` or `Generating`. `Request Moderated`, `Content Moderated`,
//!    `No Card Generated`, `Error`, `Task not found` are final failures;
//! 3. `result.sample` is a signed URL of the image on a `delivery.*.bfl.ai`
//!    host, valid for 10 minutes: it is downloaded at once, without the key.
//!
//! `cost` (in the submit answer and in the settled result) is in **credits**,
//! 1 credit = 0.01 $. When it is there it is what the spending history records;
//! otherwise the estimate of [`estimated_usd`].
//!
//! # A request that fails after BFL accepted it is still counted
//!
//! Once the submit is answered BFL has taken the task and has said its cost.
//! Whatever goes wrong afterwards (the task outlives the time limit, a poll is
//! refused, the image cannot be downloaded) the error says so with a
//! [`Charge`], and the caller counts it in the caps and in the history like an
//! image that arrived. Otherwise a slow BFL would let the assistant open one
//! paid task after another with the cap of the purpose still at zero. When the
//! failure is BFL's own final status and its answer carries the settled cost,
//! that one is believed, zero included.
//!
//! # The key never leaves BFL
//!
//! The key travels in `x-key`, a header of BFL's own: reqwest strips
//! `Authorization` and `Cookie` when a redirect changes host, not this one. So
//! every call goes through [`client`], which follows a redirect only to an
//! address that passes [`is_bfl`]; any other redirect is an error.
//!
//! # What is not verified
//!
//! Nothing here has met the real service (no key, maintainer decision of
//! 16-11-2026): the tests answer with a fake BFL built from the reference
//! (the guide, and `https://api.bfl.ai/openapi.json` for the parameters of each
//! model). One point is a reading of it and not a quote: the edit sends the base as
//! **base64** in `input_image`. The FLUX.2 editing guide shows only image URLs
//! ("simplest"), the reference says "the input image"; base64 is what the
//! FLUX.1 Kontext endpoint of the same API took. The first real background is
//! an item of `docs/COLLAUDI_IN_SOSPESO.md`.

use std::time::{Duration, Instant};

use base64::Engine as _;
use serde_json::{json, Value};

pub const DEFAULT_MODEL: &str = "flux-2-pro";

/// The price of a megapixel, in dollars: the first one generated, each further
/// one, each one of a reference image (the base of an edit).
struct Prices {
    first: f64,
    next: f64,
    input: f64,
}

/// The price list of bfl.ai/pricing, read on 16-11-2026. A megapixel is
/// 1024×1024 and the size is rounded up to the next one, separately for the
/// reference and for the output. A model the list does not know is counted as
/// FLUX.2 [max], the dearest: a cap that trips early rather than never.
fn prices(model: &str) -> Prices {
    let p = |first, next, input| Prices { first, next, input };
    match model.trim() {
        "flux-2-pro" | "flux-2-pro-preview" => p(0.03, 0.015, 0.015),
        "flux-2-flex" => p(0.05, 0.05, 0.05),
        "flux-2-klein-9b" | "flux-2-klein-9b-preview" => p(0.015, 0.002, 0.002),
        "flux-2-klein-4b" => p(0.014, 0.001, 0.001),
        _ => p(0.07, 0.03, 0.03),
    }
}

/// The largest image accepted from the delivery URL.
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

/// The time limit of one request: the submit of an edit uploads the base, the
/// download brings back a few megabytes.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

/// The time limit of one poll: a poll that hangs must not outlive
/// `give_up_after` by minutes.
const POLL_TIMEOUT: Duration = Duration::from_secs(30);

/// The time limit of «Test the key».
const KEY_TEST_TIMEOUT: Duration = Duration::from_secs(10);

/// How many redirects inside BFL are followed.
const MAX_REDIRECTS: usize = 5;

fn megapixels(w: u32, h: u32) -> f64 {
    ((w as f64 * h as f64) / (1024.0 * 1024.0)).ceil().max(1.0)
}

/// The estimate of one image of `model` at `w`×`h`; `edit` adds the input
/// image, of the same size. It is what the cap counts before the call; after
/// it, the cost BFL settled wins.
pub fn estimated_usd(model: &str, w: u32, h: u32, edit: bool) -> f64 {
    let p = prices(model);
    let mp = megapixels(w, h);
    let out = p.first + p.next * (mp - 1.0);
    if edit {
        out + p.input * mp
    } else {
        out
    }
}

/// Where BFL is, and how patiently it is polled. The tests point it at a fake.
#[derive(Clone, Debug)]
pub struct Endpoint {
    pub base: String,
    pub poll_every: Duration,
    pub give_up_after: Duration,
}

impl Default for Endpoint {
    fn default() -> Self {
        Endpoint {
            base: "https://api.bfl.ai/v1".into(),
            poll_every: Duration::from_millis(1500),
            give_up_after: Duration::from_secs(240),
        }
    }
}

/// One image from FLUX, and what BFL said it cost (if it said).
#[derive(Debug)]
pub struct Image {
    pub jpg: Vec<u8>,
    pub settled_usd: Option<f64>,
}

/// What a request that failed cost all the same.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Charge {
    /// BFL never accepted it: nothing to pay.
    None,
    /// Accepted, and BFL said the cost, in dollars: at the submit, or settled
    /// in the result.
    Declared(f64),
    /// Accepted, and no cost was said: the caller counts its own estimate.
    Unknown,
}

/// Why there is no image, and what it cost all the same.
#[derive(Debug)]
pub struct Failure {
    pub message: String,
    pub charge: Charge,
}

impl Failure {
    /// A failure before BFL accepted anything.
    fn free(message: impl Into<String>) -> Self {
        Failure {
            message: message.into(),
            charge: Charge::None,
        }
    }
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// How an edit keeps the fixed prompt as written, per model
/// (`api.bfl.ai/openapi.json`, 16-11-2026): FLUX.2 [pro] and [max] rewrite the
/// prompt unless `disable_pup` is true; [flex] has `prompt_upsampling`, true by
/// default; [klein] rewrites nothing and has neither field. A model the list
/// does not know is treated like [pro], the default.
fn keep_prompt_field(model: &str) -> Option<(&'static str, bool)> {
    if model.starts_with("flux-2-flex") {
        Some(("prompt_upsampling", false))
    } else if model.starts_with("flux-2-klein") {
        None
    } else {
        Some(("disable_pup", true))
    }
}

/// The HTTP client of every call to BFL: see «The key never leaves BFL» in the
/// module. A redirect to an address that is not BFL's is not followed: the 3xx
/// answer comes back as it is, and the callers report it as an error.
fn client(base: &str) -> Result<reqwest::Client, String> {
    let base = base.to_string();
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("too many redirects")
            } else if is_bfl(attempt.url().as_str(), &base) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| format!("cannot build the HTTP client for Black Forest Labs: {e}"))
}

/// The model goes into the path: letters, digits, `.` and `-` only.
fn model_ok(m: &str) -> bool {
    !m.is_empty()
        && m.len() <= 64
        && m.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.')
}

/// Is `url` at Black Forest Labs? Both addresses come from the answers: the
/// polling URL gets the key, the image is downloaded by this process. Only
/// `https://*.bfl.ai` (the regional and the delivery hosts too, as the guide
/// says to allow) or the very host of `base`, which is how the tests' fake
/// passes.
fn is_bfl(url: &str, base: &str) -> bool {
    let (Ok(u), Ok(b)) = (reqwest::Url::parse(url), reqwest::Url::parse(base)) else {
        return false;
    };
    let host = u.host_str().unwrap_or("");
    (u.scheme() == "https" && (host == "bfl.ai" || host.ends_with(".bfl.ai")))
        || (u.scheme() == b.scheme() && u.host_str() == b.host_str() && u.port() == b.port())
}

fn credits_to_usd(v: &Value) -> Option<f64> {
    v.get("cost")
        .and_then(Value::as_f64)
        .filter(|c| c.is_finite() && *c >= 0.0)
        .map(|c| c / 100.0)
}

/// A new image (`input_jpg = None`) or an edit of `input_jpg`.
pub async fn generate(
    ep: &Endpoint,
    key: &str,
    model: &str,
    prompt: &str,
    input_jpg: Option<&[u8]>,
    width: u32,
    height: u32,
) -> Result<Image, Failure> {
    if !model_ok(model) {
        return Err(Failure::free(format!(
            "FLUX model `{model}` is not a valid name"
        )));
    }
    let mut body = json!({
        "prompt": prompt, "width": width, "height": height, "output_format": "jpeg",
    });
    if let Some(jpg) = input_jpg {
        body["input_image"] = json!(base64::engine::general_purpose::STANDARD.encode(jpg));
        // An edit must keep the scene: no rewriting of the fixed prompt.
        if let Some((field, value)) = keep_prompt_field(model) {
            body[field] = json!(value);
        }
    }
    let base = ep.base.trim_end_matches('/');
    let http = client(base).map_err(Failure::free)?;
    let r = http
        .post(format!("{base}/{model}"))
        .header("x-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| Failure::free(format!("Black Forest Labs is not reachable: {e}")))?;
    let status = r.status();
    let v: Value = r.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(Failure::free(match status.as_u16() {
            402 => "Black Forest Labs: the credits are finished (add some at bfl.ai)".to_string(),
            401 | 403 => "Black Forest Labs does not accept the key".to_string(),
            code if status.is_redirection() => {
                format!("Black Forest Labs answered with a redirect to another site ({code})")
            }
            code => format!("Black Forest Labs refused ({code}): {}", error_text(&v)),
        }));
    }
    // From here on BFL has the task: every failure carries what it costs.
    let submitted_usd = credits_to_usd(&v);
    let charge_of = |settled: Option<f64>| match settled.or(submitted_usd) {
        Some(usd) => Charge::Declared(usd),
        None => Charge::Unknown,
    };
    let failed = |message: String, settled: Option<f64>| Failure {
        message,
        charge: charge_of(settled),
    };
    let Some(id) = v.get("id").and_then(Value::as_str).map(str::to_string) else {
        return Err(failed("Black Forest Labs gave no task id".into(), None));
    };
    let polling_url = v
        .get("polling_url")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("{base}/get_result?id={id}"));
    if !is_bfl(&polling_url, base) {
        return Err(failed(
            format!("unexpected polling address from Black Forest Labs: {polling_url}"),
            None,
        ));
    }

    let started = Instant::now();
    loop {
        if started.elapsed() >= ep.give_up_after {
            return Err(failed(
                format!(
                    "FLUX did not finish within {} s (task {id})",
                    ep.give_up_after.as_secs()
                ),
                None,
            ));
        }
        tokio::time::sleep(ep.poll_every).await;
        let poll = http
            .get(&polling_url)
            .header("x-key", key)
            .timeout(POLL_TIMEOUT)
            .send();
        let r = match poll.await {
            Ok(r) => r,
            // A dropped poll is not a failed image: try again until the limit.
            Err(e) => {
                tracing::warn!(target: "sws_ai", "FLUX poll failed, retrying: {e}");
                continue;
            }
        };
        let status = r.status();
        if status.as_u16() == 429 || status.is_server_error() {
            continue;
        }
        if status.is_redirection() {
            return Err(failed(
                format!(
                    "Black Forest Labs redirected the poll to another site ({}): not followed",
                    status.as_u16()
                ),
                None,
            ));
        }
        let v: Value = r.json().await.unwrap_or_default();
        if !status.is_success() {
            return Err(failed(
                format!(
                    "Black Forest Labs refused the poll ({}): {}",
                    status.as_u16(),
                    error_text(&v)
                ),
                None,
            ));
        }
        // The settled cost of the answer, when it has one: for a final status
        // of BFL it wins over the cost of the submit, zero included.
        let settled = credits_to_usd(&v);
        match v.get("status").and_then(Value::as_str).unwrap_or("") {
            "Ready" => {
                let Some(url) = v.pointer("/result/sample").and_then(Value::as_str) else {
                    return Err(failed("FLUX is ready but gave no image".into(), settled));
                };
                let jpg = download(&http, url, base, MAX_IMAGE_BYTES)
                    .await
                    .map_err(|e| failed(e, settled))?;
                return Ok(Image {
                    jpg,
                    settled_usd: settled.or(submitted_usd),
                });
            }
            "Pending" | "Reasoning" | "Generating" => continue,
            "Request Moderated" | "Content Moderated" => {
                return Err(failed(
                    "Black Forest Labs' content filter refused the image: describe the \
                     scene differently"
                        .into(),
                    settled,
                ))
            }
            other => {
                return Err(failed(
                    format!(
                        "FLUX failed ({}): {}",
                        if other.is_empty() { "no status" } else { other },
                        error_text(&v)
                    ),
                    settled,
                ))
            }
        }
    }
}

/// Downloads the image, without the key. `max_bytes` protects the memory of
/// the process, so it is checked before and while reading: a declared length
/// over the limit is refused at once, and a body with no declared length is
/// dropped as soon as it passes it.
async fn download(
    http: &reqwest::Client,
    url: &str,
    base: &str,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    if !is_bfl(url, base) {
        return Err(format!(
            "unexpected image address from Black Forest Labs: {url}"
        ));
    }
    let mut r = http
        .get(url)
        .send()
        .await
        .map_err(|e| format!("the FLUX image cannot be downloaded: {e}"))?;
    if !r.status().is_success() {
        return Err(format!(
            "the FLUX image cannot be downloaded: HTTP {}",
            r.status().as_u16()
        ));
    }
    let too_large = || format!("the FLUX image is too large (over {max_bytes} bytes)");
    if r.content_length().is_some_and(|n| n > max_bytes as u64) {
        return Err(too_large());
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = r
        .chunk()
        .await
        .map_err(|e| format!("the FLUX image cannot be downloaded: {e}"))?
    {
        if bytes.len() + chunk.len() > max_bytes {
            return Err(too_large());
        }
        bytes.extend_from_slice(&chunk);
    }
    if !bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Err("FLUX did not return a JPEG".into());
    }
    Ok(bytes)
}

fn error_text(v: &Value) -> String {
    if let Some(s) = v.get("detail").and_then(Value::as_str) {
        return s.to_string();
    }
    if let Some(a) = v.get("detail").and_then(Value::as_array) {
        return a
            .iter()
            .filter_map(|d| d.get("msg").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("; ");
    }
    v.pointer("/details")
        .or_else(|| v.get("error"))
        .map(|d| d.to_string())
        .unwrap_or_default()
}

/// «Test the key»: BFL has no list of models, but `GET /v1/credits` is free and
/// needs a valid key. Returns the balance in dollars.
pub async fn credits_usd(ep: &Endpoint, key: &str) -> Result<f64, String> {
    let base = ep.base.trim_end_matches('/');
    let r = client(base)?
        .get(format!("{base}/credits"))
        .header("x-key", key)
        .timeout(KEY_TEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("Black Forest Labs is not reachable: {e}"))?;
    let status = r.status();
    if status.is_redirection() {
        return Err(format!(
            "Black Forest Labs answered with a redirect to another site ({}): not followed",
            status.as_u16()
        ));
    }
    let v: Value = r.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), error_text(&v)));
    }
    v.get("credits")
        .and_then(Value::as_f64)
        .map(|c| c / 100.0)
        .ok_or_else(|| "Black Forest Labs gave no balance".into())
}

/// A fake Black Forest Labs, built from the reference: the tests of this module
/// and of the background tools (`strumenti_scopi.rs`) answer with it.
#[cfg(test)]
pub(crate) mod fake {
    use super::*;
    use axum::{
        extract::{Path, Query, State},
        http::{header, HeaderMap, StatusCode},
        response::IntoResponse,
        routing::{get, post},
        Json, Router,
    };
    use futures_util::StreamExt as _;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    pub const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 0xFF, 0xD9];

    /// The size of one chunk of `/stream.jpg`, and how many it would send.
    pub const STREAM_CHUNK: usize = 64 * 1024;
    pub const STREAM_CHUNKS: usize = 2000;

    /// How the fake BFL answers.
    #[derive(Clone, Copy, PartialEq)]
    pub enum Script {
        ReadyAfter(usize),
        FailsAfter(usize),
        /// The task fails and the answer settles its cost at zero.
        FailsSettledAtZero,
        Moderated,
        NeverReady,
        /// As `NeverReady`, and the submit says no cost.
        NeverReadyNoCost,
        /// The submit itself is refused with this HTTP status.
        Refused(u16),
        /// The polling address redirects to another address of the same BFL.
        PollMovedInside,
        /// The polling address redirects to another site.
        PollMovedAway,
    }

    #[derive(Clone)]
    pub struct Fake {
        pub script: Script,
        pub polls: Arc<AtomicUsize>,
        pub origin: Arc<Mutex<String>>,
        /// The origin of the other site, the one that is not BFL.
        pub elsewhere: Arc<Mutex<String>>,
        /// The `x-key` of every request that reached the other site.
        pub elsewhere_keys: Arc<Mutex<Vec<String>>>,
        pub submitted: Arc<Mutex<Option<Value>>>,
        pub submits: Arc<AtomicUsize>,
        pub keys_seen: Arc<Mutex<Vec<String>>>,
        pub stream_chunks_sent: Arc<AtomicUsize>,
    }

    fn key_of(headers: &HeaderMap) -> String {
        headers
            .get("x-key")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string()
    }

    fn moved_to(url: String) -> axum::response::Response {
        (StatusCode::FOUND, [(header::LOCATION, url)]).into_response()
    }

    async fn submit(
        State(f): State<Fake>,
        Path(model): Path<String>,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> (StatusCode, Json<Value>) {
        f.keys_seen.lock().unwrap().push(key_of(&headers));
        f.submits.fetch_add(1, Ordering::SeqCst);
        *f.submitted.lock().unwrap() = Some(json!({ "model": model, "body": body }));
        if let Script::Refused(code) = f.script {
            return (
                StatusCode::from_u16(code).unwrap(),
                Json(json!({ "detail": "no" })),
            );
        }
        let o = f.origin.lock().unwrap().clone();
        let polling_url = match f.script {
            Script::PollMovedInside => format!("{o}/v1/moved"),
            Script::PollMovedAway => format!("{o}/v1/away"),
            _ => format!("{o}/v1/get_result?id=t-1"),
        };
        let mut answer = json!({ "id": "t-1", "polling_url": polling_url });
        if f.script != Script::NeverReadyNoCost {
            answer["cost"] = json!(4.5);
        }
        (StatusCode::OK, Json(answer))
    }

    async fn poll(State(f): State<Fake>, Query(q): Query<HashMap<String, String>>) -> Json<Value> {
        assert_eq!(q.get("id").map(String::as_str), Some("t-1"));
        let n = f.polls.fetch_add(1, Ordering::SeqCst) + 1;
        let o = f.origin.lock().unwrap().clone();
        let ready = json!({ "id": "t-1", "status": "Ready",
            "result": { "sample": format!("{o}/sample.jpg") }, "cost": 4.5 });
        Json(match f.script {
            Script::ReadyAfter(k) if n >= k => ready,
            Script::PollMovedInside => ready,
            Script::FailsAfter(k) if n >= k => json!({ "id": "t-1", "status": "Error",
                "details": { "reason": "internal" } }),
            Script::FailsSettledAtZero => json!({ "id": "t-1", "status": "Error",
                "details": { "reason": "internal" }, "cost": 0.0 }),
            Script::Moderated => json!({ "id": "t-1", "status": "Content Moderated" }),
            _ => {
                json!({ "id": "t-1", "status": if n % 2 == 0 { "Generating" } else { "Pending" } })
            }
        })
    }

    async fn credits(State(f): State<Fake>, headers: HeaderMap) -> axum::response::Response {
        match key_of(&headers).as_str() {
            "bad" => (
                StatusCode::FORBIDDEN,
                Json(json!({ "detail": "Not authenticated" })),
            )
                .into_response(),
            "moved" => moved_to(format!("{}/v1/credits", f.elsewhere.lock().unwrap())),
            _ => Json(json!({ "credits": 1234.0 })).into_response(),
        }
    }

    /// A body with no declared length that would go on for 128 MB.
    async fn endless_image(State(f): State<Fake>) -> axum::body::Body {
        let sent = f.stream_chunks_sent.clone();
        let chunks = futures_util::stream::iter(0..STREAM_CHUNKS).map(move |i| {
            sent.fetch_add(1, Ordering::SeqCst);
            let mut chunk = vec![0u8; STREAM_CHUNK];
            if i == 0 {
                chunk[..3].copy_from_slice(&[0xFF, 0xD8, 0xFF]);
            }
            Ok::<_, std::io::Error>(chunk)
        });
        axum::body::Body::from_stream(chunks)
    }

    async fn listen(app: Router) -> String {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", l.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        origin
    }

    pub async fn start(script: Script) -> (Endpoint, Fake) {
        let f = Fake {
            script,
            polls: Arc::default(),
            origin: Arc::default(),
            elsewhere: Arc::default(),
            elsewhere_keys: Arc::default(),
            submitted: Arc::default(),
            submits: Arc::default(),
            keys_seen: Arc::default(),
            stream_chunks_sent: Arc::default(),
        };
        // The other site answers everything, and remembers the key it was given.
        let seen = f.elsewhere_keys.clone();
        let elsewhere = listen(Router::new().fallback(move |headers: HeaderMap| {
            let seen = seen.clone();
            async move {
                seen.lock().unwrap().push(key_of(&headers));
                Json(json!({ "id": "t-1", "status": "Ready", "credits": 1.0 }))
            }
        }))
        .await;
        *f.elsewhere.lock().unwrap() = elsewhere;

        let app = Router::new()
            .route("/v1/:model", post(submit))
            .route("/v1/get_result", get(poll))
            .route(
                "/v1/moved",
                get(|State(f): State<Fake>| async move {
                    moved_to(format!("{}/v1/get_result?id=t-1", f.origin.lock().unwrap()))
                }),
            )
            .route(
                "/v1/away",
                get(|State(f): State<Fake>| async move {
                    moved_to(format!(
                        "{}/v1/get_result?id=t-1",
                        f.elsewhere.lock().unwrap()
                    ))
                }),
            )
            .route("/v1/credits", get(credits))
            .route("/sample.jpg", get(|| async { JPEG.to_vec() }))
            .route(
                "/big.jpg",
                get(|| async {
                    let mut big = vec![0u8; 4096];
                    big[..3].copy_from_slice(&[0xFF, 0xD8, 0xFF]);
                    big
                }),
            )
            .route("/stream.jpg", get(endless_image))
            .route("/not-a-jpeg", get(|| async { "<html>" }))
            .with_state(f.clone());
        let origin = listen(app).await;
        *f.origin.lock().unwrap() = origin.clone();
        let ep = Endpoint {
            base: format!("{origin}/v1"),
            poll_every: Duration::from_millis(5),
            give_up_after: Duration::from_millis(400),
        };
        (ep, f)
    }
}

#[cfg(test)]
mod tests {
    use super::fake::{self, Script, JPEG};
    use super::*;
    use std::sync::atomic::Ordering;

    async fn new_image(ep: &Endpoint, model: &str) -> Result<Image, Failure> {
        generate(ep, "bfl-key", model, "a lake", None, 1536, 1024).await
    }

    #[tokio::test]
    async fn submit_poll_and_ready() {
        let (ep, f) = fake::start(Script::ReadyAfter(3)).await;
        let img = new_image(&ep, "flux-2-pro").await.unwrap();
        assert_eq!(img.jpg, JPEG);
        assert_eq!(img.settled_usd, Some(0.045));
        assert_eq!(f.polls.load(Ordering::SeqCst), 3);
        let sent = f.submitted.lock().unwrap().clone().unwrap();
        assert_eq!(sent["model"], "flux-2-pro");
        assert_eq!(sent["body"]["width"], 1536);
        assert_eq!(sent["body"]["output_format"], "jpeg");
        assert!(sent["body"].get("input_image").is_none());
        // A new image is described freely: BFL may rewrite the prompt.
        assert!(sent["body"].get("disable_pup").is_none());
        assert_eq!(f.keys_seen.lock().unwrap().as_slice(), ["bfl-key"]);
    }

    #[tokio::test]
    async fn an_edit_sends_the_base_and_keeps_the_prompt() {
        // Each family has its own way to say «do not rewrite the prompt».
        for (model, field) in [
            ("flux-2-pro", Some(("disable_pup", true))),
            ("flux-2-max", Some(("disable_pup", true))),
            ("flux-2-flex", Some(("prompt_upsampling", false))),
            ("flux-2-klein-9b", None),
        ] {
            let (ep, f) = fake::start(Script::ReadyAfter(1)).await;
            generate(&ep, "k", model, "dusk", Some(JPEG), 1536, 1024)
                .await
                .unwrap();
            let sent = f.submitted.lock().unwrap().clone().unwrap();
            let body = &sent["body"];
            let b64 = body["input_image"].as_str().unwrap();
            assert_eq!(
                base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .unwrap(),
                JPEG
            );
            for name in ["disable_pup", "prompt_upsampling"] {
                let expected = field.filter(|(n, _)| *n == name).map(|(_, v)| json!(v));
                assert_eq!(body.get(name).cloned(), expected, "{model}: {name}");
            }
        }
    }

    #[test]
    fn the_prompt_field_follows_the_model_family() {
        assert_eq!(keep_prompt_field("flux-2-pro"), Some(("disable_pup", true)));
        assert_eq!(
            keep_prompt_field("flux-2-pro-preview"),
            Some(("disable_pup", true))
        );
        assert_eq!(
            keep_prompt_field("flux-2-flex"),
            Some(("prompt_upsampling", false))
        );
        assert_eq!(keep_prompt_field("flux-2-klein-4b"), None);
        assert_eq!(keep_prompt_field("flux-2-klein-9b-preview"), None);
        // A model the list does not know is treated like [pro].
        assert_eq!(keep_prompt_field("flux-9-new"), Some(("disable_pup", true)));
    }

    #[tokio::test]
    async fn a_failure_is_reported_with_what_it_cost() {
        // BFL accepted the task and said 4.5 credits: the failure carries them.
        let (ep, _) = fake::start(Script::FailsAfter(2)).await;
        let e = new_image(&ep, "flux-2-pro").await.unwrap_err();
        assert!(
            e.message.contains("FLUX failed (Error)") && e.message.contains("internal"),
            "{e}"
        );
        assert_eq!(e.charge, Charge::Declared(0.045));

        let (ep, _) = fake::start(Script::Moderated).await;
        let e = new_image(&ep, "flux-2-pro").await.unwrap_err();
        assert!(e.message.contains("content filter"), "{e}");
        assert_eq!(e.charge, Charge::Declared(0.045));

        // When the final answer settles the cost, that one is believed.
        let (ep, _) = fake::start(Script::FailsSettledAtZero).await;
        let e = new_image(&ep, "flux-2-pro").await.unwrap_err();
        assert_eq!(e.charge, Charge::Declared(0.0));
    }

    #[tokio::test]
    async fn a_refused_submit_says_why_never_polls_and_costs_nothing() {
        for (code, word) in [
            (401, "does not accept the key"),
            (402, "credits are finished"),
            (422, "refused (422): no"),
        ] {
            let (ep, f) = fake::start(Script::Refused(code)).await;
            let e = new_image(&ep, "flux-2-pro").await.unwrap_err();
            assert!(e.message.contains(word), "{code}: {e}");
            assert_eq!(e.charge, Charge::None);
            assert_eq!(f.polls.load(Ordering::SeqCst), 0);
        }
    }

    #[tokio::test]
    async fn a_task_that_never_ends_times_out_and_is_still_charged() {
        let (ep, f) = fake::start(Script::NeverReady).await;
        let e = new_image(&ep, "flux-2-pro").await.unwrap_err();
        assert!(e.message.contains("did not finish"), "{e}");
        assert_eq!(e.charge, Charge::Declared(0.045));
        assert!(f.polls.load(Ordering::SeqCst) >= 2);

        // No cost in the submit: the caller will count its estimate.
        let (ep, _) = fake::start(Script::NeverReadyNoCost).await;
        let e = new_image(&ep, "flux-2-pro").await.unwrap_err();
        assert_eq!(e.charge, Charge::Unknown);
    }

    #[tokio::test]
    async fn a_bad_model_name_never_leaves() {
        let (ep, f) = fake::start(Script::ReadyAfter(1)).await;
        let e = new_image(&ep, "../credits").await.unwrap_err();
        assert!(e.message.contains("not a valid name"), "{e}");
        assert_eq!(e.charge, Charge::None);
        assert!(f.submitted.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn the_key_test_reads_the_credits() {
        let (ep, _) = fake::start(Script::ReadyAfter(1)).await;
        let usd = credits_usd(&ep, "k").await.unwrap();
        assert!((usd - 12.34).abs() < 1e-9);
        let e = credits_usd(&ep, "bad").await.unwrap_err();
        assert!(e.contains("403") && e.contains("Not authenticated"), "{e}");
    }

    /// `x-key` is not a header reqwest strips when a redirect changes host:
    /// a redirect out of BFL must not be followed at all.
    #[tokio::test]
    async fn the_key_does_not_follow_a_redirect_to_another_site() {
        let (ep, f) = fake::start(Script::PollMovedAway).await;
        let e = new_image(&ep, "flux-2-pro").await.unwrap_err();
        assert!(e.message.contains("redirected the poll"), "{e}");
        // The task was accepted before the redirect: it is charged.
        assert_eq!(e.charge, Charge::Declared(0.045));

        let e = credits_usd(&ep, "moved").await.unwrap_err();
        assert!(e.contains("redirect"), "{e}");

        assert!(
            f.elsewhere_keys.lock().unwrap().is_empty(),
            "nothing may reach the other site, with or without the key: {:?}",
            f.elsewhere_keys.lock().unwrap()
        );
    }

    #[tokio::test]
    async fn a_redirect_inside_bfl_is_followed() {
        let (ep, f) = fake::start(Script::PollMovedInside).await;
        let img = new_image(&ep, "flux-2-pro").await.unwrap();
        assert_eq!(img.jpg, JPEG);
        assert_eq!(f.polls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn the_download_stops_at_the_size_limit() {
        let (ep, f) = fake::start(Script::ReadyAfter(1)).await;
        let origin = f.origin.lock().unwrap().clone();
        let http = client(&ep.base).unwrap();
        let get = |path: &str, max: usize| {
            let (http, url, base) = (http.clone(), format!("{origin}{path}"), ep.base.clone());
            async move { download(&http, &url, &base, max).await }
        };
        assert_eq!(get("/sample.jpg", 1024).await.unwrap(), JPEG);
        // Exactly at the limit is fine, one byte over is not.
        assert_eq!(get("/big.jpg", 4096).await.unwrap().len(), 4096);
        let e = get("/big.jpg", 4095).await.unwrap_err();
        assert!(e.contains("too large"), "{e}");
        // A body with no declared length is dropped while it arrives: most of
        // its 128 MB are never sent, let alone kept.
        let e = get("/stream.jpg", 4 * fake::STREAM_CHUNK)
            .await
            .unwrap_err();
        assert!(e.contains("too large"), "{e}");
        let sent = f.stream_chunks_sent.load(Ordering::SeqCst);
        assert!(sent < fake::STREAM_CHUNKS / 2, "{sent} chunks were sent");

        let e = get("/not-a-jpeg", 1024).await.unwrap_err();
        assert!(e.contains("did not return a JPEG"), "{e}");
        let e = download(&http, "https://evil.example/x.jpg", &ep.base, 1024)
            .await
            .unwrap_err();
        assert!(e.contains("unexpected image address"), "{e}");
    }

    #[test]
    fn only_bfl_addresses_are_followed() {
        let base = "https://api.bfl.ai/v1";
        assert!(is_bfl("https://api.eu1.bfl.ai/v1/get_result?id=1", base));
        assert!(is_bfl("https://api.bfl.ai/v1/get_result?id=1", base));
        assert!(!is_bfl("https://evil.example/v1/get_result", base));
        assert!(!is_bfl("http://api.bfl.ai/v1/get_result", base));
        assert!(!is_bfl("https://bfl.ai.evil.example/", base));
    }

    #[test]
    fn the_estimate_follows_the_megapixels() {
        let pro = |w, h, edit| estimated_usd("flux-2-pro", w, h, edit);
        assert!((pro(1024, 1024, false) - 0.03).abs() < 1e-9);
        // 1536×1024 is 1.5 MP, billed as 2.
        assert!((pro(1536, 1024, false) - 0.045).abs() < 1e-9);
        assert!((pro(1536, 1024, true) - 0.075).abs() < 1e-9);
        assert!((estimated_usd("flux-2-flex", 1536, 1024, true) - 0.20).abs() < 1e-9);
        // An unknown model is counted as the dearest one.
        assert_eq!(
            estimated_usd("flux-9-new", 1536, 1024, false),
            estimated_usd("flux-2-max", 1536, 1024, false)
        );
        assert!(estimated_usd("flux-2-max", 1536, 1024, false) > pro(1536, 1024, false));
    }
}
