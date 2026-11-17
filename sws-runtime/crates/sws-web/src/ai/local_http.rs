//! The HTTP client for an address the customer chose: the local model of plan
//! `docs/archive/2026-11-17-ia-a-scelta-del-cliente.md` (F1).
//!
//! On a panel or a local IDE any address is fine: the model sits on the
//! customer's network, and `http://192.168.1.20:11434/v1` is the normal case.
//! In the cloud the same address would be a door into the platform's own
//! network (the gateway, the other containers, the metadata of the host), so
//! there only public addresses are reached. Three holes, three locks:
//!
//! - **a name that resolves to a private address**: the resolver of the client
//!   drops those addresses, at connection time. Checking the name first and
//!   connecting after would let a second resolution answer differently (DNS
//!   rebinding);
//! - **an address written as an IP**: reqwest does not ask the resolver for it,
//!   so it is checked in the URL;
//! - **a redirect** from a public address to a private one: not followed.
//!
//! A public address can still be the platform itself: the public IP of the
//! host (which a rootless container reaches without leaving the machine, past
//! the provider's firewall) or the gateway's own name. Those are refused too:
//! the addresses of this machine's interfaces, and the host of the gateway's
//! origin once a forwarded request has told it.
//!
//! One client for the four callers (chat, symbols, translation, the test of
//! the provider), so the rule cannot be forgotten in one of them.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use super::client::Scelta;

/// How long one request to a model at an address the customer chose may take.
/// A local server loads the model at its first request (tens of seconds), and
/// on a CPU even a short answer takes minutes: the 20 seconds that suit a
/// cloud translation fail every string there.
pub const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// The client that reaches `scelta`. A provider with a fixed address (the
/// cloud ones) gets `base` as it is; an address chosen by the customer goes
/// through [`client`]. `base` carries the caller's timeouts.
pub fn client_for(
    scelta: &Scelta,
    in_cloud: bool,
    base: reqwest::ClientBuilder,
) -> Result<reqwest::Client, String> {
    match scelta.endpoint.as_deref() {
        Some(url) => client(url, in_cloud, base),
        None => base
            .build()
            .map_err(|e| format!("cannot build the HTTP client: {e}")),
    }
}

/// The client for `url`, an address the customer chose. Out of the cloud it is
/// `base`; in the cloud, an address that is not public is refused, now or when
/// the name resolves, and redirects are not followed.
pub fn client(
    url: &str,
    in_cloud: bool,
    base: reqwest::ClientBuilder,
) -> Result<reqwest::Client, String> {
    check_url(url, in_cloud).map_err(|e| e.to_string())?;
    let b = if in_cloud {
        base.dns_resolver(Arc::new(PublicOnly))
            .redirect(reqwest::redirect::Policy::none())
            // Through a proxy the resolver would see the proxy's name, not
            // the model's.
            .no_proxy()
    } else {
        base
    };
    b.build()
        .map_err(|e| format!("cannot build the HTTP client: {e}"))
}

/// Why an address the customer chose is refused. The menu shows the two the
/// customer can fix in its own language, by their code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddressError {
    /// Not a URL, not http or https, or without a host.
    Invalid(String),
    /// A user or a password in the address.
    Credentials,
    /// In the cloud: a private address, or the platform itself.
    NotPublic(String),
}

impl std::fmt::Display for AddressError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AddressError::Invalid(why) => write!(f, "invalid address: {why}"),
            AddressError::Credentials => write!(
                f,
                "the address carries a user or a password: put the key in its own field"
            ),
            AddressError::NotPublic(host) => write!(
                f,
                "address {host} is not public: from the cloud only public addresses are reached"
            ),
        }
    }
}

impl AddressError {
    /// The code the IDE translates, with its values; `None` = the message is
    /// all there is to say.
    pub fn code(&self) -> Option<serde_json::Value> {
        match self {
            AddressError::Invalid(_) => None,
            AddressError::Credentials => {
                Some(serde_json::json!({ "id": "local_address_has_credentials" }))
            }
            AddressError::NotPublic(host) => {
                Some(serde_json::json!({ "id": "local_address_not_public", "host": host }))
            }
        }
    }
}

/// The URL is http or https without a user or a password, and in the cloud
/// its host is not a non-public IP nor the platform itself. A name is left to
/// the resolver.
///
/// A user and a password in the address are refused everywhere: the address
/// travels back to the menu, into error messages and logs, where a key never
/// goes. The key has its own field.
pub fn check_url(url: &str, in_cloud: bool) -> Result<(), AddressError> {
    let u = reqwest::Url::parse(url).map_err(|e| AddressError::Invalid(e.to_string()))?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err(AddressError::Invalid(format!(
            "«{url}»: only http and https"
        )));
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err(AddressError::Credentials);
    }
    let host = u
        .host_str()
        .ok_or_else(|| AddressError::Invalid(format!("«{url}»: no host")))?;
    if in_cloud {
        // The parser has already normalised the odd spellings of an IPv4
        // (`0x7f000001`, `127.1`); an IPv6 comes between brackets.
        let ip = host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<IpAddr>()
            .ok();
        if let Some(ip) = ip.filter(|ip| !is_public(*ip) || own_addresses().contains(ip)) {
            return Err(AddressError::NotPublic(ip.to_string()));
        }
        if platform_host().is_some_and(|p| p.eq_ignore_ascii_case(host)) {
            return Err(AddressError::NotPublic(host.to_string()));
        }
    }
    Ok(())
}

/// Same scheme, host and port. The saved key of the local model goes only to
/// the server it was saved for: a new address typed in the menu, by someone
/// who never saw the key, must not receive it.
pub fn same_origin(a: &str, b: &str) -> bool {
    match (reqwest::Url::parse(a.trim()), reqwest::Url::parse(b.trim())) {
        (Ok(a), Ok(b)) => {
            let (a, b) = (a.origin(), b.origin());
            a.is_tuple() && a == b
        }
        _ => false,
    }
}

/// The host of the gateway's public origin, once a forwarded request has told
/// it (`gateway::ritorno`).
fn platform_host_cell() -> &'static std::sync::RwLock<Option<String>> {
    static H: std::sync::OnceLock<std::sync::RwLock<Option<String>>> = std::sync::OnceLock::new();
    H.get_or_init(Default::default)
}

fn platform_host() -> Option<String> {
    platform_host_cell()
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

/// The gateway's origin (`https://sws.example.com`): its host is the platform,
/// whatever its address is.
pub fn remember_platform_origin(origin: &str) {
    let host = reqwest::Url::parse(origin)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()));
    if let Some(h) = host {
        *platform_host_cell()
            .write()
            .unwrap_or_else(|e| e.into_inner()) = Some(h);
    }
}

/// The addresses of this machine's interfaces. In a rootless container (pasta)
/// they include the host's public one, which reaches the host's own services.
/// Read every time: an address can change, and the call is cheap next to a
/// request to a model.
fn own_addresses() -> Vec<IpAddr> {
    if_addrs::get_if_addrs()
        .map(|v| v.into_iter().map(|i| i.ip()).collect())
        .unwrap_or_default()
}

/// Can the cloud connect to it? Not loopback, private networks, link-local,
/// CGNAT, ULA, the unspecified address (on Linux `0.0.0.0` is the machine
/// itself), multicast and broadcast, nor the other ranges reserved by IANA;
/// an IPv6 address carrying an IPv4 one is judged by the IPv4 inside.
pub fn is_public(ip: IpAddr) -> bool {
    let ip = embedded_v4(ip).map(IpAddr::V4).unwrap_or(ip);
    if crate::limiti::privato(ip) {
        return false;
    }
    match ip {
        IpAddr::V4(v) => {
            let [a, b, c, _] = v.octets();
            !(v.is_unspecified()
                || v.is_multicast()
                // 0.0.0.0/8, «this network».
                || a == 0
                // 100.64.0.0/10, the carrier-grade NAT.
                || (a == 100 && (b & 0xc0) == 64)
                // 192.0.0.0/24, IETF protocol assignments.
                || (a == 192 && b == 0 && c == 0)
                // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24: documentation.
                || (a == 192 && b == 0 && c == 2)
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113)
                // 198.18.0.0/15, benchmarking.
                || (a == 198 && (b & 0xfe) == 18)
                // 240.0.0.0/4, reserved, broadcast included.
                || a >= 240)
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            !(v.is_unspecified()
                || v.is_multicast()
                // fe80::/10, link-local; fec0::/10, the old site-local.
                || (s[0] & 0xffc0) == 0xfe80
                || (s[0] & 0xffc0) == 0xfec0
                // 64:ff9b:1::/48, the NAT64 of a local network.
                || (s[0] == 0x64 && s[1] == 0xff9b && s[2] == 1)
                // 100::/64, discard.
                || (s[0] == 0x100 && s[1..4] == [0, 0, 0])
                // 2001:db8::/32, documentation.
                || (s[0] == 0x2001 && s[1] == 0xdb8))
        }
    }
}

/// The IPv4 address inside an IPv6 one: mapped (`::ffff:a.b.c.d`), compatible
/// (`::a.b.c.d`), NAT64 (`64:ff9b::/96`) and 6to4 (`2002:aabb:ccdd::/48`).
fn embedded_v4(ip: IpAddr) -> Option<Ipv4Addr> {
    let IpAddr::V6(v) = ip else { return None };
    if v.is_loopback() || v.is_unspecified() {
        return None;
    }
    let s = v.segments();
    let last =
        |hi: u16, lo: u16| Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8);
    if let Some(v4) = v.to_ipv4() {
        return Some(v4);
    }
    if s[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
        return Some(last(s[6], s[7]));
    }
    if s[0] == 0x2002 {
        return Some(last(s[1], s[2]));
    }
    None
}

// ── The context the server loaded ─────────────────────────────────────────
//
// Ollama under 24 GiB of VRAM loads a model with 4k tokens of context, and a
// longer prompt is cut **in silence**: the server drops the beginning of the
// system prompt and answers 200. Counting the tokens of the usage is not
// enough, since with the prefix cache Ollama reports small numbers even with
// no cut. So the server is asked what it loaded (Ollama `/api/ps`, LM Studio
// `/api/v0/models`) and a request that does not fit does not leave. vLLM and
// llama.cpp refuse such a request with a 400 of their own, which passes as it
// is; a server that says nothing is not checked.

/// What a local server says of the context it loaded for a model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoadedContext {
    Tokens(u64),
    /// The server tells, but the model is not loaded yet: it will be by the
    /// first request, and only then can it be checked.
    NotLoaded,
    /// The server does not tell.
    Unknown,
}

/// How long an answer of the server is believed: a turn asks once, not at
/// every request of a busy conversation.
const MEMO_SECS: u64 = 60;

type Memo = std::sync::Mutex<
    std::collections::HashMap<(String, String), (std::time::Instant, LoadedContext)>,
>;

fn memo() -> &'static Memo {
    static M: std::sync::OnceLock<Memo> = std::sync::OnceLock::new();
    M.get_or_init(Default::default)
}

/// The root of the server from its chat URL: `http://h:11434/v1/chat/completions`
/// → `http://h:11434`, where Ollama and LM Studio keep their own API.
fn server_root(chat_url: &str) -> &str {
    let u = chat_url.trim_end_matches('/');
    let u = u.strip_suffix("/chat/completions").unwrap_or(u);
    u.strip_suffix("/v1").unwrap_or(u)
}

/// The context loaded for `model` by the server of `chat_url`. `fresh` skips
/// the memo: after the first request of a model that was not loaded.
pub async fn loaded_context(
    http: &reqwest::Client,
    chat_url: &str,
    model: &str,
    fresh: bool,
) -> LoadedContext {
    let root = server_root(chat_url).to_string();
    let key = (root.clone(), model.to_string());
    if !fresh {
        let m = memo().lock().unwrap_or_else(|e| e.into_inner());
        if let Some((at, c)) = m.get(&key) {
            if at.elapsed().as_secs() < MEMO_SECS {
                return *c;
            }
        }
    }
    let c = ask_server(http, &root, model).await;
    // A model not loaded yet will be in a moment: that answer is not kept.
    if c != LoadedContext::NotLoaded {
        memo()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(key, (std::time::Instant::now(), c));
    }
    c
}

async fn ask_server(http: &reqwest::Client, root: &str, model: &str) -> LoadedContext {
    let get = |path: &str| {
        http.get(format!("{root}{path}"))
            .timeout(std::time::Duration::from_secs(5))
            .send()
    };
    let json_of = |r: reqwest::Response| async move {
        if r.status().is_success() {
            r.json::<serde_json::Value>().await.ok()
        } else {
            None
        }
    };
    if let Ok(r) = get("/api/ps").await {
        if let Some(c) = json_of(r).await.and_then(|v| ollama_context(&v, model)) {
            return c;
        }
    }
    if let Ok(r) = get("/api/v0/models").await {
        if let Some(c) = json_of(r).await.and_then(|v| lm_studio_context(&v, model)) {
            return c;
        }
    }
    LoadedContext::Unknown
}

/// Ollama's `/api/ps`: the loaded models, each with `context_length`. A name
/// without a tag is `:latest` to Ollama. `None` = not Ollama's shape.
fn ollama_context(v: &serde_json::Value, model: &str) -> Option<LoadedContext> {
    let models = v.get("models")?.as_array()?;
    let latest = format!("{model}:latest");
    let m = models.iter().find(|m| {
        ["name", "model"]
            .iter()
            .filter_map(|k| m.get(*k).and_then(|x| x.as_str()))
            .any(|n| n == model || n == latest)
    });
    Some(match m {
        None => LoadedContext::NotLoaded,
        Some(m) => match m.get("context_length").and_then(|c| c.as_u64()) {
            Some(n) => LoadedContext::Tokens(n),
            // An older Ollama, which does not say.
            None => LoadedContext::Unknown,
        },
    })
}

/// LM Studio's `/api/v0/models`: every model, with `state` and, when loaded,
/// `loaded_context_length`. `None` = not LM Studio's shape.
fn lm_studio_context(v: &serde_json::Value, model: &str) -> Option<LoadedContext> {
    let data = v.get("data")?.as_array()?;
    // Its own fields, or this is the plain OpenAI list of another server.
    if !data.iter().any(|m| m.get("state").is_some()) {
        return None;
    }
    let m = data
        .iter()
        .find(|m| m.get("id").and_then(|x| x.as_str()) == Some(model));
    Some(
        match m
            .filter(|m| m.get("state").and_then(|s| s.as_str()) == Some("loaded"))
            .and_then(|m| m.get("loaded_context_length"))
            .and_then(|c| c.as_u64())
        {
            Some(n) => LoadedContext::Tokens(n),
            None => LoadedContext::NotLoaded,
        },
    )
}

/// What one image is counted for, when the model sees it. Vision models give
/// a picture from a few hundred tokens (Gemma 3, LLaVA) to over a thousand
/// (Qwen-VL on a page snapshot): the high end, since a guess too low lets a
/// request through to be cut.
const IMAGE_TOKENS: u64 = 1500;

/// About how many tokens a prompt is: its characters divided by three, plus a
/// flat amount per image. Three and not four, because JSON and Italian run at
/// about three characters a token, and an estimate too low is the one that
/// does harm here. An image counts for [`IMAGE_TOKENS`], not for its base64:
/// hundreds of thousands of characters the server does not read as text. The
/// images of a model that does not see them are already text by now
/// (`chat_completions::images_for`).
pub fn estimate_tokens<'a>(parts: impl IntoIterator<Item = &'a serde_json::Value>) -> u64 {
    fn walk(v: &serde_json::Value, chars: &mut usize, images: &mut u64) {
        use serde_json::Value as V;
        match v {
            V::String(s) => *chars += s.chars().count(),
            V::Array(a) => a.iter().for_each(|x| walk(x, chars, images)),
            V::Object(o) => {
                let kind = o.get("type").and_then(V::as_str);
                if matches!(kind, Some("image" | "image_url")) {
                    *images += 1;
                    return;
                }
                for (k, v) in o {
                    *chars += k.chars().count();
                    walk(v, chars, images);
                }
            }
            _ => {}
        }
    }
    let (mut chars, mut images) = (0usize, 0u64);
    for p in parts {
        walk(p, &mut chars, &mut images);
    }
    (chars / 3) as u64 + images * IMAGE_TOKENS
}

/// The tokens a request needs in the context: its prompt, and room for the
/// answer it may write (`max_output`, as capped for the server). A prompt
/// that fits with no room left is cut all the same, while the model writes.
pub fn needed_tokens<'a>(
    parts: impl IntoIterator<Item = &'a serde_json::Value>,
    max_output: u32,
) -> u64 {
    estimate_tokens(parts) + u64::from(max_output)
}

/// A request that does not fit in the context the local server loaded. Typed,
/// so that the chat can hand the IDE a code to translate
/// (`local_context_too_small`) instead of this English text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContextTooSmall {
    pub loaded: u64,
    pub needed: u64,
}

impl std::fmt::Display for ContextTooSmall {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "the context of the local model is {} tokens and the request needs about \
             {}: the server would cut it in silence. Raise it to at least 64k (HOWTO, \
             «Un modello in casa»)",
            self.loaded, self.needed
        )
    }
}

impl std::error::Error for ContextTooSmall {}

impl ContextTooSmall {
    /// What the chat sends the IDE along with the message.
    pub fn code(&self) -> serde_json::Value {
        serde_json::json!({
            "id": "local_context_too_small",
            "loaded": self.loaded,
            "needed": self.needed,
        })
    }
}

/// Before a request: refuses one that does not fit. `Ok(true)` = the model is
/// not loaded yet, and the check is to be made again by [`context_after`]
/// once the server has answered. `needed` comes from [`needed_tokens`].
pub async fn context_before(
    http: &reqwest::Client,
    chat_url: &str,
    model: &str,
    needed: u64,
) -> Result<bool, ContextTooSmall> {
    match loaded_context(http, chat_url, model, false).await {
        LoadedContext::Tokens(loaded) if loaded < needed => Err(ContextTooSmall { loaded, needed }),
        LoadedContext::NotLoaded => Ok(true),
        _ => Ok(false),
    }
}

/// After the first request of a model that was not loaded: if what was
/// loaded is too small, the answer (computed on a cut prompt) is discarded.
pub async fn context_after(
    http: &reqwest::Client,
    chat_url: &str,
    model: &str,
    needed: u64,
) -> Result<(), ContextTooSmall> {
    match loaded_context(http, chat_url, model, true).await {
        LoadedContext::Tokens(loaded) if loaded < needed => Err(ContextTooSmall { loaded, needed }),
        _ => Ok(()),
    }
}

/// The resolver of the cloud: the system's, without the addresses that are not
/// public. A name with only those fails as a name that does not resolve.
struct PublicOnly;

impl reqwest::dns::Resolve for PublicOnly {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let all: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            // The platform's own addresses: this machine's, and those of the
            // gateway's name (the VPS's public IP, under another name).
            let mut own = own_addresses();
            if let Some(p) = platform_host() {
                if let Ok(a) = tokio::net::lookup_host((p.as_str(), 0)).await {
                    own.extend(a.map(|a| a.ip()));
                }
            }
            let public: Vec<SocketAddr> = all
                .into_iter()
                .filter(|a| is_public(a.ip()) && !own.contains(&a.ip()))
                .collect();
            if public.is_empty() {
                return Err(format!(
                    "{host} has no public address: from the cloud only public addresses are reached"
                )
                .into());
            }
            Ok(Box::new(public.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::client::{Fornitore, KeySource};

    fn local(url: &str) -> Scelta {
        Scelta {
            fornitore: Fornitore::Local,
            chiave: "local".into(),
            source: KeySource::Project,
            modello: "qwen3:1.7b".into(),
            tetto_usd: 10.0,
            endpoint: Some(url.into()),
            sees_images: false,
        }
    }

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn what_the_cloud_does_not_reach() {
        for a in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.20",
            "169.254.169.254",
            "100.64.0.1",
            "100.127.255.254",
            "0.0.0.0",
            "0.1.2.3",
            "255.255.255.255",
            "224.0.0.1",
            "::1",
            "::",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:169.254.169.254",
            "::10.0.0.1",
            "64:ff9b::192.168.0.1",
            "2002:c0a8:0101::1",
            // Reserved by IANA (review of 17-11-2026).
            "192.0.0.8",
            "192.0.2.1",
            "198.18.0.1",
            "198.19.255.254",
            "198.51.100.7",
            "203.0.113.9",
            "240.0.0.1",
            "64:ff9b:1::a00:1",
            "fec0::1",
            "100::1",
            "2001:db8::1",
        ] {
            assert!(!is_public(ip(a)), "{a} counted as public");
        }
        for a in [
            "8.8.8.8",
            "100.128.0.1",
            "100.63.255.255",
            "2a00:1450:4002::1",
            "::ffff:8.8.8.8",
            "64:ff9b::808:808",
            "192.0.1.1",
            "198.20.0.1",
            "223.255.255.254",
        ] {
            assert!(is_public(ip(a)), "{a} counted as not public");
        }
    }

    #[test]
    fn a_private_ip_in_the_url_is_refused_in_the_cloud_only() {
        for url in [
            "http://192.168.1.20:11434/v1/chat/completions",
            "http://[::1]:8000/v1/chat/completions",
            "http://169.254.169.254/latest",
        ] {
            assert!(
                client_for(&local(url), true, reqwest::Client::builder()).is_err(),
                "{url} accepted in the cloud"
            );
            assert!(
                client_for(&local(url), false, reqwest::Client::builder()).is_ok(),
                "{url} refused out of the cloud"
            );
        }
        // The odd spellings of loopback.
        for url in [
            "http://0x7f000001/v1",
            "http://127.1/v1",
            "http://[::ffff:7f00:1]/v1",
        ] {
            assert!(
                client_for(&local(url), true, reqwest::Client::builder()).is_err(),
                "{url} accepted in the cloud"
            );
        }
        // Not http: refused everywhere.
        assert!(client_for(
            &local("file:///etc/passwd"),
            false,
            reqwest::Client::builder()
        )
        .is_err());
        // A name is left to the resolver.
        assert!(client_for(
            &local("https://llm.example.com/v1"),
            true,
            reqwest::Client::builder()
        )
        .is_ok());
    }

    /// Review of 17-11-2026: a public address can be the platform itself.
    /// This machine's addresses and the gateway's name are refused in the
    /// cloud; a user and a password in the address everywhere.
    #[test]
    fn the_platform_and_a_password_are_refused() {
        let own = own_addresses()
            .into_iter()
            .find(|a| matches!(a, IpAddr::V4(_)))
            .expect("this machine has an IPv4 address");
        let url = format!("http://{own}:9000/v1");
        assert!(
            check_url(&url, true).is_err(),
            "{url} accepted in the cloud"
        );
        assert!(check_url(&url, false).is_ok());

        remember_platform_origin("https://GW.platform-test.example/");
        let e = check_url("https://gw.platform-test.example/v1", true).unwrap_err();
        assert_eq!(
            e.code().unwrap(),
            serde_json::json!({ "id": "local_address_not_public", "host": "gw.platform-test.example" })
        );
        assert!(check_url("https://gw.platform-test.example/v1", false).is_ok());

        for url in [
            "http://u:secret@llm.example.com/v1",
            "http://u@llm.example.com/v1",
        ] {
            for cloud in [true, false] {
                let e = check_url(url, cloud).unwrap_err();
                assert_eq!(e, AddressError::Credentials);
                assert!(!e.to_string().contains("secret"), "{e}");
            }
        }
    }

    #[test]
    fn same_origin_is_scheme_host_and_port() {
        assert!(same_origin("http://h:8000/v1", "http://h:8000/openai/v1/"));
        assert!(same_origin("https://h/v1", "https://h:443/x"));
        assert!(!same_origin("http://h:8000/v1", "https://h:8000/v1"));
        assert!(!same_origin("http://h:8000/v1", "http://h:8001/v1"));
        assert!(!same_origin("http://h/v1", "http://evil.example/v1"));
        assert!(!same_origin("", "http://h/v1"));
    }

    #[tokio::test]
    async fn a_name_resolving_to_a_private_address_fails_in_the_cloud() {
        // `localhost` resolves to loopback and nothing else.
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let app =
                axum::Router::new().route("/v1/models", axum::routing::get(|| async { "{}" }));
            axum::serve(l, app).await.unwrap()
        });
        let url = format!("http://localhost:{port}/v1/models");
        let cloud = client_for(&local(&url), true, reqwest::Client::builder()).unwrap();
        let e = cloud.get(&url).send().await.unwrap_err();
        assert!(format!("{e:?}").contains("no public address"), "{e:?}");
        let home = client_for(&local(&url), false, reqwest::Client::builder()).unwrap();
        assert!(home.get(&url).send().await.unwrap().status().is_success());
    }

    #[tokio::test]
    async fn a_redirect_is_not_followed_in_the_cloud() {
        use axum::response::Redirect;
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            let app = axum::Router::new()
                .route(
                    "/go",
                    axum::routing::get(|| async { Redirect::temporary("/there") }),
                )
                .route("/there", axum::routing::get(|| async { "arrived" }));
            axum::serve(l, app).await.unwrap()
        });
        // The address is loopback, which the cloud refuses outright: the
        // redirect policy is read from a client built for the cloud with a
        // public name, then pointed at the test server by `resolve`.
        let url = format!("http://model.example.com:{}/go", addr.port());
        let b = reqwest::Client::builder().resolve("model.example.com", addr);
        let cloud = client(&url, true, b).unwrap();
        let r = cloud.get(&url).send().await.unwrap();
        assert_eq!(r.status(), reqwest::StatusCode::TEMPORARY_REDIRECT);
        let home = client(
            &url,
            false,
            reqwest::Client::builder().resolve("model.example.com", addr),
        )
        .unwrap();
        assert_eq!(
            home.get(&url).send().await.unwrap().text().await.unwrap(),
            "arrived"
        );
    }

    #[test]
    fn a_cloud_provider_gets_the_plain_client() {
        let s = Scelta {
            endpoint: None,
            fornitore: Fornitore::Mistral,
            ..local("")
        };
        assert!(client_for(&s, true, reqwest::Client::builder()).is_ok());
    }

    /// What Ollama and LM Studio say of the context, in their shapes; the
    /// plain list of another server is not mistaken for LM Studio's.
    #[test]
    fn the_loaded_context_in_the_shapes_of_the_servers() {
        use serde_json::json;
        let ps = json!({ "models": [
            { "name": "qwen3:latest", "model": "qwen3:latest", "context_length": 4096 },
            { "name": "llama3.3:70b", "model": "llama3.3:70b" } ] });
        assert_eq!(
            ollama_context(&ps, "qwen3"),
            Some(LoadedContext::Tokens(4096))
        );
        assert_eq!(
            ollama_context(&ps, "qwen3:latest"),
            Some(LoadedContext::Tokens(4096))
        );
        assert_eq!(
            ollama_context(&ps, "llama3.3:70b"),
            Some(LoadedContext::Unknown)
        );
        assert_eq!(
            ollama_context(&ps, "mistral"),
            Some(LoadedContext::NotLoaded)
        );
        assert_eq!(ollama_context(&json!({ "data": [] }), "qwen3"), None);

        let lms = json!({ "object": "list", "data": [
            { "id": "qwen3-8b", "state": "loaded", "loaded_context_length": 4096,
              "max_context_length": 262144 },
            { "id": "gemma-3", "state": "not-loaded", "max_context_length": 131072 } ] });
        assert_eq!(
            lm_studio_context(&lms, "qwen3-8b"),
            Some(LoadedContext::Tokens(4096))
        );
        assert_eq!(
            lm_studio_context(&lms, "gemma-3"),
            Some(LoadedContext::NotLoaded)
        );
        let openai = json!({ "data": [{ "id": "qwen3-8b", "object": "model" }] });
        assert_eq!(lm_studio_context(&openai, "qwen3-8b"), None);

        assert_eq!(
            server_root("http://h:11434/v1/chat/completions"),
            "http://h:11434"
        );
        assert_eq!(
            server_root("http://h:1234/chat/completions"),
            "http://h:1234"
        );
    }

    /// The estimate counts an image for a flat amount, not for its base64: a
    /// snapshot is hundreds of thousands of characters the server does not
    /// read as text, but it does take room in the context.
    #[test]
    fn the_estimate_counts_text_and_a_flat_amount_per_image() {
        use serde_json::json;
        let text = json!({ "role": "user", "content": "x".repeat(3000) });
        let image = json!({ "role": "user", "content": [
            { "type": "image", "source": { "data": "A".repeat(400_000) } },
            { "type": "image_url", "image_url": { "url": "data:image/png;base64,AAAA" } } ] });
        let n = estimate_tokens([&text]);
        // Three characters a token: the cautious side for JSON and Italian.
        assert!((1000..1010).contains(&n), "{n}");
        let with = estimate_tokens([&text, &image]);
        assert!(
            (n + 2 * IMAGE_TOKENS..n + 2 * IMAGE_TOKENS + 10).contains(&with),
            "{with}"
        );
    }

    /// Review of 17-11-2026: a 60k prompt on a 64k context passed, and the
    /// server cut it while writing the answer. The room for the answer counts.
    #[tokio::test]
    async fn a_prompt_that_leaves_no_room_for_the_answer_does_not_leave() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let app = axum::Router::new().route(
                "/api/ps",
                axum::routing::get(|| async {
                    axum::Json(serde_json::json!({ "models": [
                        { "name": "roomy:latest", "context_length": 65536 } ] }))
                }),
            );
            axum::serve(l, app).await.unwrap()
        });
        let url = format!("http://127.0.0.1:{port}/v1/chat/completions");
        let http = reqwest::Client::new();
        let prompt = serde_json::json!({ "role": "user", "content": "x".repeat(60_000 * 3) });
        assert!((60_000..60_010).contains(&estimate_tokens([&prompt])));
        // The prompt alone fits; with the 8192 tokens of the answer it does not.
        assert_eq!(
            context_before(&http, &url, "roomy", estimate_tokens([&prompt])).await,
            Ok(false)
        );
        let needed = needed_tokens([&prompt], 8192);
        let e = context_before(&http, &url, "roomy", needed)
            .await
            .unwrap_err();
        assert_eq!(
            e,
            ContextTooSmall {
                loaded: 65536,
                needed
            }
        );
        assert_eq!(e.code()["id"], "local_context_too_small");
    }
}
