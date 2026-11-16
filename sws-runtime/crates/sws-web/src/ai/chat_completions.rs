//! The second text protocol: OpenAI-style «chat completions» (plan
//! `docs/archive/2026-11-10-assistente-secondo-giro.md`, G4). Mistral speaks it
//! first; OpenAI text, and the European endpoints serving open models
//! (Scaleway, OVH), speak the same thing with small differences, collected in a
//! [`Dialect`].
//!
//! # A translator, not a second agent
//!
//! The whole assistant — the agent loop in `ai/mod.rs`, the saved
//! conversations, the bench, the symbol model, the translator — keeps speaking
//! the **Messages** format: content blocks, `tool_use`, `tool_result` in a user
//! message, `usage` with `input_tokens`/`output_tokens`. This module translates
//! at the border and nowhere else:
//!
//! - **out**: `system` blocks, Messages-style `messages` and `tools` become a
//!   chat-completions request ([`request_body`]);
//! - **back**: the SSE chunks (`choices[0].delta`, `tool_calls` with arguments
//!   arriving as a JSON string in pieces, `usage` on the last chunk) become a
//!   [`Risposta`] with Messages-style blocks and usage ([`StreamState`]).
//!
//! So a conversation can even change provider half-way: what is stored is
//! always the same format.
//!
//! # What does not translate one to one
//!
//! 1. **Tool results** are a `tool` message each, with a string content. Images
//!    in a tool result (the snapshots of the page) cannot go there: they go in
//!    a user message right after the tool messages.
//! 2. **Thinking blocks** of the Messages format have no counterpart and are
//!    dropped when going out; a provider that streams its own reasoning
//!    (Magistral: `content` as an array with `thinking` parts) is shown in the
//!    chat as thinking but not kept.
//! 3. **Tool-call ids**: Mistral only accepts `[a-zA-Z0-9]{9}`. Ids written by
//!    another provider (`toolu_…`) are mapped to a stable 9-character id, the
//!    same for the call and its result.
//! 4. **The order of the roles**: Mistral refuses a `user` message right after
//!    a `tool` message («Unexpected role 'user' after role 'tool'», code 3230):
//!    after a tool result it wants the assistant. Ours come in that order all
//!    the time — the next question after a proposal (`domanda_dopo` in
//!    `ai/mod.rs`), the image of a snapshot — so a one-word assistant message
//!    goes in between ([`Dialect::assistant_after_tool`]). It also refuses an
//!    assistant message with neither text nor calls: those are left out.

use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};

use super::client::{Evento, Risposta};

/// The differences between the providers that speak chat completions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dialect {
    pub endpoint: &'static str,
    /// `image_url` as a plain string (Mistral's documented form) instead of
    /// `{ "url": … }` (OpenAI's).
    pub image_url_as_string: bool,
    /// Tool-call ids must be exactly nine letters or digits (Mistral).
    pub tool_ids_alnum9: bool,
    /// `stream_options.include_usage` must be asked for, or the stream carries
    /// no usage at all (OpenAI). Mistral sends it on the last chunk anyway, and
    /// a field it does not declare is a 422 waiting to happen.
    pub ask_stream_usage: bool,
    /// The ceiling of `max_tokens`: the Messages turn asks 64000, more than
    /// some of these models accept as output.
    pub max_output_tokens: u32,
    /// A `user` message cannot follow a `tool` message (Mistral): a short
    /// assistant message is put between the two.
    pub assistant_after_tool: bool,
}

pub const MISTRAL: Dialect = Dialect {
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    image_url_as_string: true,
    tool_ids_alnum9: true,
    ask_stream_usage: false,
    max_output_tokens: 32768,
    assistant_after_tool: true,
};

/// What the assistant «says» between a tool result and a user message, where
/// the dialect wants a turn of the assistant there. Not empty: an assistant
/// message without text and without calls is refused too.
const BRIDGE: &str = "OK.";

// ── Out: the request ────────────────────────────────────────────────────────

/// The request body. `system` and `messages` are in the Messages format, as the
/// rest of the assistant writes them.
pub fn request_body(
    d: &Dialect,
    model: &str,
    system: &[Value],
    messages: &[Value],
    tools: &[Value],
    stream: bool,
    max_tokens: u32,
) -> Value {
    let mut chat = Vec::new();
    let sys = system_text(system);
    if !sys.is_empty() {
        chat.push(json!({ "role": "system", "content": sys }));
    }
    chat.extend(to_chat_messages(d, messages));
    let mut b = json!({
        "model": model,
        "messages": chat,
        "stream": stream,
        "max_tokens": max_tokens.min(d.max_output_tokens),
    });
    if !tools.is_empty() {
        b["tools"] = Value::Array(tools.iter().map(to_chat_tool).collect());
        b["tool_choice"] = json!("auto");
        b["parallel_tool_calls"] = json!(true);
    }
    if stream && d.ask_stream_usage {
        b["stream_options"] = json!({ "include_usage": true });
    }
    b
}

/// The system prompt as one string. The Messages format allows blocks (with
/// `cache_control`, which here means nothing); chat completions wants text.
fn system_text(system: &[Value]) -> String {
    system
        .iter()
        .filter_map(|b| match b {
            Value::String(s) => Some(s.as_str()),
            _ => b.get("text").and_then(Value::as_str),
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// `{name, description, input_schema}` → `{type: function, function: {…}}`.
pub fn to_chat_tool(t: &Value) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": t.get("name").cloned().unwrap_or(Value::Null),
            "description": t.get("description").cloned().unwrap_or(json!("")),
            "parameters": t.get("input_schema").cloned()
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
        }
    })
}

/// A tool-call id the dialect accepts. Ids that already fit pass unchanged, so
/// a conversation held entirely with this provider sends back what it received.
fn tool_id(d: &Dialect, id: &str) -> String {
    if !d.tool_ids_alnum9 || (id.len() == 9 && id.chars().all(|c| c.is_ascii_alphanumeric())) {
        return id.to_string();
    }
    // FNV-1a, 64 bits, written in base 62: stable across runs and machines
    // (std's hasher is not), and nine characters are 53 bits of it.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in id.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    (0..9)
        .map(|_| {
            let c = ALPHABET[(h % 62) as usize] as char;
            h /= 62;
            c
        })
        .collect()
}

fn image_part(d: &Dialect, block: &Value) -> Option<Value> {
    let src = block.get("source")?;
    let url = match src.get("type").and_then(Value::as_str) {
        Some("base64") => format!(
            "data:{};base64,{}",
            src.get("media_type")
                .and_then(Value::as_str)
                .unwrap_or("image/png"),
            src.get("data").and_then(Value::as_str)?
        ),
        Some("url") => src.get("url").and_then(Value::as_str)?.to_string(),
        _ => return None,
    };
    Some(if d.image_url_as_string {
        json!({ "type": "image_url", "image_url": url })
    } else {
        json!({ "type": "image_url", "image_url": { "url": url } })
    })
}

/// The Messages conversation as chat-completions messages.
pub fn to_chat_messages(d: &Dialect, messages: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    // The name of each tool call by its id: Mistral's examples repeat it in
    // the `tool` message that answers the call.
    let mut names: std::collections::HashMap<String, String> = Default::default();
    // A user message, after a tool message if the dialect allows it.
    let push_user = |out: &mut Vec<Value>, content: Value| {
        if d.assistant_after_tool && out.last().is_some_and(|m| m["role"] == "tool") {
            out.push(json!({ "role": "assistant", "content": BRIDGE }));
        }
        out.push(json!({ "role": "user", "content": content }));
    };
    for m in messages {
        let role = m.get("role").and_then(Value::as_str).unwrap_or("user");
        let content = m.get("content").cloned().unwrap_or(Value::Null);
        let blocks: Vec<Value> = match content {
            Value::String(s) if role == "assistant" => {
                if !s.is_empty() {
                    out.push(json!({ "role": "assistant", "content": s }));
                }
                continue;
            }
            Value::String(s) => {
                push_user(&mut out, Value::String(s));
                continue;
            }
            Value::Array(a) => a,
            _ => continue,
        };
        if role == "assistant" {
            let text: String = blocks
                .iter()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|b| b.get("text").and_then(Value::as_str))
                .collect();
            let calls: Vec<Value> = blocks
                .iter()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use"))
                .map(|b| {
                    let id = tool_id(d, b.get("id").and_then(Value::as_str).unwrap_or(""));
                    let name = b.get("name").and_then(Value::as_str).unwrap_or("");
                    names.insert(id.clone(), name.to_string());
                    json!({
                        "id": id,
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": b.get("input").cloned()
                                .unwrap_or_else(|| json!({})).to_string(),
                        }
                    })
                })
                .collect();
            // Only thinking, or nothing at all: no message (see the module
            // notes, point 4).
            if text.is_empty() && calls.is_empty() {
                continue;
            }
            let mut msg = json!({ "role": "assistant", "content": text });
            if !calls.is_empty() {
                msg["tool_calls"] = Value::Array(calls);
            }
            out.push(msg);
            continue;
        }
        // A user message: tool results first (each its own `tool` message, in
        // order), then whatever the person wrote, with the images of the tool
        // results that could not travel in a `tool` message.
        let mut parts: Vec<Value> = Vec::new();
        let mut tool_images = 0usize;
        for b in &blocks {
            match b.get("type").and_then(Value::as_str) {
                Some("tool_result") => {
                    let id = tool_id(
                        d,
                        b.get("tool_use_id").and_then(Value::as_str).unwrap_or(""),
                    );
                    let (text, images) = match b.get("content") {
                        Some(Value::String(s)) => (s.clone(), Vec::new()),
                        Some(Value::Array(a)) => (
                            a.iter()
                                .filter_map(|x| x.get("text").and_then(Value::as_str))
                                .collect::<Vec<_>>()
                                .join("\n"),
                            a.iter()
                                .filter(|x| x.get("type").and_then(Value::as_str) == Some("image"))
                                .filter_map(|x| image_part(d, x))
                                .collect(),
                        ),
                        _ => (String::new(), Vec::new()),
                    };
                    let mut text = if text.is_empty() && !images.is_empty() {
                        "(image below)".to_string()
                    } else {
                        text
                    };
                    if b.get("is_error").and_then(Value::as_bool) == Some(true) {
                        text = format!("ERROR: {text}");
                    }
                    let mut msg = json!({ "role": "tool", "tool_call_id": id, "content": text });
                    if let Some(n) = names.get(&id).filter(|n| !n.is_empty()) {
                        msg["name"] = json!(n);
                    }
                    out.push(msg);
                    tool_images += images.len();
                    parts.extend(images);
                }
                Some("text") => {
                    if let Some(t) = b.get("text").and_then(Value::as_str) {
                        parts.push(json!({ "type": "text", "text": t }));
                    }
                }
                Some("image") => parts.extend(image_part(d, b)),
                _ => {}
            }
        }
        if parts.is_empty() {
            continue;
        }
        // Text only: a plain string, the form every provider accepts.
        if parts.iter().all(|p| p["type"] == "text") {
            let t: Vec<&str> = parts.iter().filter_map(|p| p["text"].as_str()).collect();
            push_user(&mut out, Value::String(t.join("\n\n")));
        } else {
            // Images of tool results with no word of the person: say what they
            // are, a user message of images alone reads as a new request.
            if tool_images > 0 && parts.iter().all(|p| p["type"] != "text") {
                parts.push(json!({ "type": "text",
                                   "text": "(the images returned by the tools above)" }));
            }
            push_user(&mut out, Value::Array(parts));
        }
    }
    out
}

// ── Back: the stream ────────────────────────────────────────────────────────

/// `prompt_tokens`/`completion_tokens` as the Messages format names them, so
/// `client::costo_usd` and the bench measures read them unchanged. Cached
/// prompt tokens (OpenAI's `prompt_tokens_details.cached_tokens`) are counted
/// at the cache price, and not twice.
pub fn usage_to_messages(u: &Value) -> Value {
    let tok = |p: &str| u.pointer(p).and_then(Value::as_u64).unwrap_or(0);
    let cached = tok("/prompt_tokens_details/cached_tokens");
    json!({
        "input_tokens": tok("/prompt_tokens").saturating_sub(cached),
        "output_tokens": tok("/completion_tokens"),
        "cache_read_input_tokens": cached,
        "cache_creation_input_tokens": 0,
    })
}

#[derive(Default)]
struct ToolCall {
    id: String,
    name: String,
    arguments: String,
    /// The chat was told this call has begun (once, when its name is known).
    announced: bool,
}

/// The pieces of one turn, as the chunks arrive.
#[derive(Default)]
pub struct StreamState {
    text: String,
    /// By the `index` the provider gives each call: the pieces of the same call
    /// share it, and two calls in the same chunk differ in it.
    calls: std::collections::BTreeMap<u64, ToolCall>,
    finish_reason: Option<String>,
    /// The `[DONE]` that closes the stream was seen.
    done: bool,
    usage: Value,
    error: Option<String>,
}

impl StreamState {
    /// The payload of one SSE event: a chunk, or the `[DONE]` at the end. A
    /// payload that is not JSON is skipped, as the Messages reader does.
    pub fn feed(&mut self, data: &str, on_event: &mut impl FnMut(Evento)) {
        if data == "[DONE]" {
            self.done = true;
        } else if let Ok(v) = serde_json::from_str::<Value>(data) {
            self.apply(&v, on_event);
        }
    }

    /// One chunk (the JSON after `data:`).
    pub fn apply(&mut self, chunk: &Value, on_event: &mut impl FnMut(Evento)) {
        // Some compatible servers send `"error": null` in every chunk: only a
        // value is an error.
        if let Some(e) = chunk.get("error").filter(|e| !e.is_null()) {
            let msg = e
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| e.to_string());
            self.error = Some(msg);
            return;
        }
        // Mistral reports some failures as `{"object": "error", "message": …}`.
        if chunk.get("object").and_then(Value::as_str) == Some("error") {
            self.error = Some(
                chunk
                    .get("message")
                    .map(|m| {
                        m.as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| m.to_string())
                    })
                    .unwrap_or_else(|| chunk.to_string()),
            );
            return;
        }
        if let Some(u) = chunk.get("usage").filter(|u| !u.is_null()) {
            self.usage = u.clone();
        }
        let Some(choice) = chunk.pointer("/choices/0") else {
            return;
        };
        if let Some(fr) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish_reason = Some(fr.to_string());
        }
        let Some(delta) = choice.get("delta") else {
            return;
        };
        match delta.get("content") {
            Some(Value::String(t)) if !t.is_empty() => {
                self.text.push_str(t);
                on_event(Evento::Testo(t.clone()));
            }
            // Content as parts: text, and the reasoning of the models that
            // stream it (Magistral), shown as thinking and not kept.
            Some(Value::Array(parts)) => {
                for p in parts {
                    match p.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            if let Some(t) = p.get("text").and_then(Value::as_str) {
                                self.text.push_str(t);
                                on_event(Evento::Testo(t.to_string()));
                            }
                        }
                        Some("thinking") => {
                            let t = thinking_text(p.get("thinking"));
                            if !t.is_empty() {
                                on_event(Evento::Pensiero(t));
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
        for (pos, c) in delta
            .get("tool_calls")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            // Without `index` (some providers send each call whole) the
            // position in this chunk after those already seen.
            let idx = c
                .get("index")
                .and_then(Value::as_u64)
                .unwrap_or(self.calls.len() as u64 + pos as u64);
            let call = self.calls.entry(idx).or_default();
            if let Some(id) = c
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                call.id = id.to_string();
            }
            let f = c.get("function");
            if let Some(n) = f
                .and_then(|f| f.get("name"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                call.name = n.to_string();
            }
            if !call.announced && !call.name.is_empty() {
                call.announced = true;
                on_event(Evento::StrumentoInizio {
                    nome: call.name.clone(),
                });
            }
            match f.and_then(|f| f.get("arguments")) {
                Some(Value::String(a)) if !a.is_empty() => {
                    call.arguments.push_str(a);
                    on_event(Evento::StrumentoScrive {
                        byte: call.arguments.len(),
                    });
                }
                // Already an object: whole, in one piece.
                Some(v @ Value::Object(_)) => call.arguments = v.to_string(),
                _ => {}
            }
        }
    }

    /// The turn, in the Messages format.
    pub fn finish(self) -> Result<Risposta> {
        if let Some(e) = self.error {
            bail!("the provider reported an error in the stream: {e}");
        }
        // Neither a finish reason nor `[DONE]`: the connection closed half-way.
        // What arrived is not an answer, however complete it may look.
        if self.finish_reason.is_none() && !self.done {
            bail!("the stream ended before the end of the turn");
        }
        let cut = matches!(
            self.finish_reason.as_deref(),
            Some("length") | Some("model_length")
        );
        let mut content = Vec::new();
        if !self.text.is_empty() {
            content.push(json!({ "type": "text", "text": self.text }));
        }
        let has_calls = !self.calls.is_empty();
        for (i, (_, c)) in self.calls.into_iter().enumerate() {
            let input: Value = if c.arguments.trim().is_empty() {
                json!({})
            } else {
                match serde_json::from_str(&c.arguments) {
                    Ok(v) => v,
                    Err(_) if cut => bail!(
                        "the answer reached the output limit while writing the arguments \
                         of `{}` ({} bytes): the request is too big for one turn",
                        c.name,
                        c.arguments.len()
                    ),
                    Err(e) => {
                        // The beginning is enough to recognise it: a whole
                        // page does not belong in an error message.
                        let head: String = c.arguments.chars().take(200).collect();
                        bail!("unreadable arguments for `{}` ({e}): {head}", c.name)
                    }
                }
            };
            let id = if c.id.is_empty() {
                format!("call{i:05}")
            } else {
                c.id
            };
            content.push(json!({ "type": "tool_use", "id": id, "name": c.name, "input": input }));
        }
        let stop_reason = match self.finish_reason.as_deref() {
            Some("tool_calls") => "tool_use",
            Some("length") | Some("model_length") => "max_tokens",
            Some("content_filter") => {
                bail!("the model refused the request (content filter)")
            }
            Some("error") => bail!("the provider ended the turn with an error"),
            // No finish reason but calls: a provider that does not say it.
            _ if has_calls => "tool_use",
            _ => "end_turn",
        };
        Ok(Risposta {
            content,
            stop_reason: stop_reason.to_string(),
            stop_details: None,
            usage: usage_to_messages(&self.usage),
        })
    }
}

fn thinking_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|x| x.get("text").and_then(Value::as_str))
            .collect(),
        _ => String::new(),
    }
}

/// Moves the complete characters of `pending` into `buf`. A network chunk can
/// end in the middle of an «è»: those bytes wait for the next chunk instead of
/// becoming a replacement character in the middle of a tool's arguments.
fn push_utf8(buf: &mut String, pending: &mut Vec<u8>) {
    let valid = match std::str::from_utf8(pending) {
        Ok(s) => s.len(),
        // `error_len() == None`: an incomplete character at the end, wait.
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        // Really invalid bytes: decode them lossily and move on.
        Err(_) => {
            buf.push_str(&String::from_utf8_lossy(pending));
            pending.clear();
            return;
        }
    };
    buf.push_str(std::str::from_utf8(&pending[..valid]).unwrap_or_default());
    pending.drain(..valid);
}

/// The `data:` payloads of complete SSE events in `buf`, removed from it. What
/// follows the last blank line is an event in half and stays in the buffer.
pub fn drain_events(buf: &mut String) -> Vec<String> {
    let mut out = Vec::new();
    // Some servers end lines with CRLF.
    if buf.contains('\r') {
        *buf = buf.replace("\r\n", "\n");
    }
    while let Some(end) = buf.find("\n\n") {
        let raw: String = buf.drain(..end + 2).collect();
        let data: Vec<&str> = raw
            .lines()
            .filter_map(|l| l.strip_prefix("data:").map(str::trim))
            .collect();
        if !data.is_empty() {
            out.push(data.join("\n"));
        }
    }
    out
}

/// Reads the whole SSE stream of one turn.
pub async fn read_sse(
    resp: reqwest::Response,
    on_event: &mut impl FnMut(Evento),
) -> Result<Risposta> {
    let mut state = StreamState::default();
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut pending: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("the SSE connection was interrupted")?;
        pending.extend_from_slice(&chunk);
        push_utf8(&mut buf, &mut pending);
        for data in drain_events(&mut buf) {
            state.feed(&data, on_event);
        }
    }
    // A last event without the blank line after it (a server that closes right
    // after `[DONE]`): complete it, so it is read like the others.
    if !buf.trim().is_empty() {
        buf.push_str("\n\n");
        for data in drain_events(&mut buf) {
            state.feed(&data, on_event);
        }
    }
    state.finish()
}

/// The text and the usage (Messages-style) of a non-streaming answer.
pub fn parse_single(v: &Value) -> Result<(String, Value)> {
    let msg = v
        .pointer("/choices/0/message/content")
        .context("no message in the answer")?;
    let text = match msg {
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect(),
        _ => String::new(),
    };
    let text = text.trim().to_string();
    if text.is_empty() {
        bail!("no text in the answer");
    }
    Ok((
        text,
        usage_to_messages(v.get("usage").unwrap_or(&Value::Null)),
    ))
}

/// The error message of a provider's error body, in either of the two shapes
/// seen (`{"error": {"message"}}` and Mistral's `{"message": …}`).
pub fn error_message(v: &Value) -> Option<String> {
    v.pointer("/error/message")
        .or_else(|| v.get("message"))
        .or_else(|| v.get("detail"))
        .map(|m| {
            m.as_str()
                .map(str::to_string)
                .unwrap_or_else(|| m.to_string())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds a recorded stream (the raw SSE text) through the same code path as
    /// the network, split in awkward places.
    fn play(sse: &str, cut: usize) -> (Result<Risposta>, Vec<String>) {
        let mut state = StreamState::default();
        let mut seen = Vec::new();
        let mut on = |e: Evento| seen.push(format!("{e:?}"));
        let (mut buf, mut pending) = (String::new(), Vec::new());
        for piece in sse.as_bytes().chunks(cut.max(1)) {
            pending.extend_from_slice(piece);
            push_utf8(&mut buf, &mut pending);
            for data in drain_events(&mut buf) {
                state.feed(&data, &mut on);
            }
        }
        (state.finish(), seen)
    }

    fn sse(chunks: &[Value]) -> String {
        let mut s: String = chunks.iter().map(|c| format!("data: {c}\n\n")).collect();
        s.push_str("data: [DONE]\n\n");
        s
    }

    fn delta(d: Value) -> Value {
        json!({ "id": "cmpl", "object": "chat.completion.chunk", "model": "mistral-large-latest",
                "choices": [{ "index": 0, "delta": d, "finish_reason": null }] })
    }

    fn end(reason: &str, usage: Value) -> Value {
        json!({ "id": "cmpl", "choices": [{ "index": 0, "delta": {}, "finish_reason": reason }],
                "usage": usage })
    }

    #[test]
    fn text_deltas_become_one_text_block() {
        let s = sse(&[
            delta(json!({ "role": "assistant", "content": "" })),
            delta(json!({ "content": "Aggiungo " })),
            delta(json!({ "content": "il bottone." })),
            end(
                "stop",
                json!({ "prompt_tokens": 1200, "completion_tokens": 30, "total_tokens": 1230 }),
            ),
        ]);
        // Cut every 7 bytes: events split across network chunks.
        let (r, seen) = play(&s, 7);
        let r = r.unwrap();
        assert_eq!(r.testo(), "Aggiungo il bottone.");
        assert_eq!(r.stop_reason, "end_turn");
        assert!(r.tool_uses().is_empty());
        assert_eq!(r.usage["input_tokens"], 1200);
        assert_eq!(r.usage["output_tokens"], 30);
        assert_eq!(seen.iter().filter(|e| e.starts_with("Testo")).count(), 2);
    }

    #[test]
    fn a_tool_call_split_over_several_chunks() {
        let s = sse(&[
            delta(json!({ "content": "Leggo la pagina." })),
            delta(
                json!({ "tool_calls": [{ "index": 0, "id": "aB3dE5gH7", "type": "function",
                "function": { "name": "leggi_pagina", "arguments": "" } }] }),
            ),
            delta(json!({ "tool_calls": [{ "index": 0, "function": { "arguments": "{\"no" } }] })),
            delta(
                json!({ "tool_calls": [{ "index": 0, "function": { "arguments": "me\": \"Indi" } }] }),
            ),
            delta(
                json!({ "tool_calls": [{ "index": 0, "function": { "arguments": "catori\"}" } }] }),
            ),
            end(
                "tool_calls",
                json!({ "prompt_tokens": 10, "completion_tokens": 5 }),
            ),
        ]);
        let (r, seen) = play(&s, 13);
        let r = r.unwrap();
        assert_eq!(r.stop_reason, "tool_use");
        let uses = r.tool_uses();
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].0, "aB3dE5gH7");
        assert_eq!(uses[0].1, "leggi_pagina");
        assert_eq!(uses[0].2["nome"], "Indicatori");
        assert_eq!(
            seen.iter()
                .filter(|e| e.starts_with("StrumentoInizio"))
                .count(),
            1
        );
        assert!(
            seen.iter()
                .filter(|e| e.starts_with("StrumentoScrive"))
                .count()
                >= 3
        );
        // The text block comes first, then the call: the order of the turn.
        assert_eq!(r.content[0]["type"], "text");
    }

    #[test]
    fn several_tool_calls_interleaved_and_whole() {
        let s = sse(&[
            delta(json!({ "tool_calls": [
                { "index": 0, "id": "call00001", "function": { "name": "cerca_simboli", "arguments": "{\"testo\":" } },
                { "index": 1, "id": "call00002", "function": { "name": "leggi_pagina", "arguments": "" } } ] })),
            delta(
                json!({ "tool_calls": [{ "index": 1, "function": { "arguments": "{\"nome\":\"p1\"}" } }] }),
            ),
            delta(
                json!({ "tool_calls": [{ "index": 0, "function": { "arguments": "\"pompa\"}" } }] }),
            ),
            // Mistral's habit: a third call whole, arguments already complete.
            delta(json!({ "tool_calls": [{ "index": 2, "id": "call00003",
                "function": { "name": "valida", "arguments": "{}" } }] })),
            end(
                "tool_calls",
                json!({ "prompt_tokens": 1, "completion_tokens": 1 }),
            ),
        ]);
        let (r, _) = play(&s, 64);
        let uses = r
            .unwrap()
            .tool_uses()
            .into_iter()
            .map(|(id, n, i)| (id.to_string(), n.to_string(), i.clone()))
            .collect::<Vec<_>>();
        assert_eq!(uses.len(), 3);
        assert_eq!(
            uses[0],
            (
                "call00001".into(),
                "cerca_simboli".into(),
                json!({ "testo": "pompa" })
            )
        );
        assert_eq!(
            uses[1],
            (
                "call00002".into(),
                "leggi_pagina".into(),
                json!({ "nome": "p1" })
            )
        );
        assert_eq!(uses[2].1, "valida");
    }

    #[test]
    fn usage_counts_cached_tokens_once_at_their_price() {
        let u = usage_to_messages(&json!({ "prompt_tokens": 1000, "completion_tokens": 50,
            "prompt_tokens_details": { "cached_tokens": 800 } }));
        assert_eq!(u["input_tokens"], 200);
        assert_eq!(u["cache_read_input_tokens"], 800);
        assert_eq!(u["output_tokens"], 50);
        // And the cost reads them as for any other provider.
        let c = super::super::client::costo_usd(
            "mistral-large-latest",
            &json!({
            "input_tokens": 1_000_000, "output_tokens": 1_000_000 }),
        );
        assert!((c - 2.8).abs() < 1e-9, "cost {c}");
        // Mistral writes no cache: `prezzi` charges 1.25 times the input for
        // a cache write, and that field must stay at zero.
        assert_eq!(u["cache_creation_input_tokens"], 0);
    }

    #[test]
    fn an_error_event_fails_the_turn() {
        let s = sse(&[
            delta(json!({ "content": "Inizio" })),
            json!({ "error": { "message": "Service tier capacity exceeded", "type": "rate_limit" } }),
        ]);
        let e = play(&s, 32).0.unwrap_err();
        assert!(format!("{e:#}").contains("capacity exceeded"), "{e:#}");
        // Mistral's own shape.
        let s = sse(&[
            json!({ "object": "error", "message": "Invalid model", "type": "invalid_request" }),
        ]);
        assert!(format!("{:#}", play(&s, 32).0.unwrap_err()).contains("Invalid model"));
        // And a refusal by filter is not an empty answer.
        let s = sse(&[end("content_filter", json!({}))]);
        assert!(play(&s, 32).0.is_err());
    }

    /// A null `error` in a normal chunk (some OpenAI-compatible servers send it
    /// every time) is not an error: the answer is whole.
    #[test]
    fn a_null_error_field_is_not_an_error() {
        let with_null = |mut c: Value| {
            c["error"] = Value::Null;
            c
        };
        let s = sse(&[
            with_null(delta(json!({ "role": "assistant", "content": "Fatto" }))),
            with_null(delta(json!({ "content": "." }))),
            with_null(end(
                "stop",
                json!({ "prompt_tokens": 10, "completion_tokens": 2 }),
            )),
        ]);
        let r = play(&s, 32).0.unwrap();
        assert_eq!(r.testo(), "Fatto.");
        assert_eq!(r.stop_reason, "end_turn");
        assert_eq!(r.usage["output_tokens"], 2);
    }

    #[test]
    fn a_truncated_argument_string_is_an_error_not_an_empty_input() {
        let s = sse(&[
            delta(json!({ "tool_calls": [{ "index": 0, "id": "x12345678",
                "function": { "name": "proponi_modifica", "arguments": "{\"pages\": [" } }] })),
            end("length", json!({})),
        ]);
        let e = format!("{:#}", play(&s, 32).0.unwrap_err());
        assert!(
            e.contains("output limit") && e.contains("proponi_modifica"),
            "{e}"
        );
        // Text cut at the limit is still text: the caller sees `max_tokens`.
        let s = sse(&[
            delta(json!({ "content": "Una lunga spiegazione che" })),
            end("length", json!({})),
        ]);
        assert_eq!(play(&s, 32).0.unwrap().stop_reason, "max_tokens");
        // Broken arguments with a normal end: an error, with the name and the
        // beginning only.
        let s = sse(&[
            delta(json!({ "tool_calls": [{ "index": 0, "id": "x12345678",
                "function": { "name": "valida", "arguments": "{\"a\": tru" } }] })),
            end("tool_calls", json!({})),
        ]);
        let e = format!("{:#}", play(&s, 32).0.unwrap_err());
        assert!(e.contains("unreadable arguments for `valida`"), "{e}");
    }

    #[test]
    fn reasoning_parts_are_shown_and_not_kept() {
        let s = sse(&[
            delta(
                json!({ "content": [{ "type": "thinking", "thinking": [{ "type": "text", "text": "rifletto" }] }] }),
            ),
            delta(json!({ "content": [{ "type": "text", "text": "Fatto." }] })),
            end("stop", json!({})),
        ]);
        let (r, seen) = play(&s, 32);
        let r = r.unwrap();
        assert_eq!(r.testo(), "Fatto.");
        assert_eq!(r.content.len(), 1);
        assert!(seen.iter().any(|e| e.contains("rifletto")));
    }

    #[test]
    fn a_character_cut_between_two_network_chunks_stays_whole() {
        let s = sse(&[
            delta(json!({ "content": "più già" })),
            end("stop", json!({})),
        ]);
        let bytes = s.as_bytes();
        let cut = s.find('ù').unwrap() + 1; // inside the two bytes of «ù»
        let (mut buf, mut pending, mut state) = (String::new(), Vec::new(), StreamState::default());
        for part in [&bytes[..cut], &bytes[cut..]] {
            pending.extend_from_slice(part);
            push_utf8(&mut buf, &mut pending);
            for d in drain_events(&mut buf) {
                state.feed(&d, &mut |_| {});
            }
        }
        assert_eq!(state.finish().unwrap().testo(), "più già");
    }

    #[test]
    fn crlf_line_ends_are_read_too() {
        let s = sse(&[delta(json!({ "content": "ciao" })), end("stop", json!({}))])
            .replace('\n', "\r\n");
        assert_eq!(play(&s, 5).0.unwrap().testo(), "ciao");
    }

    #[test]
    fn the_request_translates_the_messages_conversation() {
        let system = vec![json!({ "type": "text", "text": "istruzioni",
                                  "cache_control": { "type": "ephemeral" } })];
        let png = json!({ "type": "image", "source": { "type": "base64",
                          "media_type": "image/png", "data": "AAAA" } });
        let messages = vec![
            json!({ "role": "user", "content": "Disegna la linea" }),
            json!({ "role": "assistant", "content": [
                { "type": "thinking", "thinking": "…", "signature": "s" },
                { "type": "text", "text": "Guardo." },
                { "type": "tool_use", "id": "toolu_01ABCDEF", "name": "istantanea_pagina", "input": {} },
                { "type": "tool_use", "id": "aB3dE5gH7", "name": "valida", "input": { "a": 1 } } ] }),
            json!({ "role": "user", "content": [
                { "type": "tool_result", "tool_use_id": "toolu_01ABCDEF",
                  "content": [png, { "type": "text", "text": "Istantanea 1280x800" }] },
                { "type": "tool_result", "tool_use_id": "aB3dE5gH7", "content": "{\"ok\":false}", "is_error": true },
                { "type": "text", "text": "procedi" } ] }),
        ];
        let tools = vec![json!({ "name": "valida", "description": "d",
                                 "input_schema": { "type": "object", "properties": {} } })];
        let b = request_body(
            &MISTRAL,
            "mistral-large-latest",
            &system,
            &messages,
            &tools,
            true,
            64000,
        );

        assert_eq!(b["stream"], true);
        assert_eq!(b["max_tokens"], MISTRAL.max_output_tokens);
        // Fields of the other protocol never leak: a 422 on an unknown field.
        for f in [
            "system",
            "thinking",
            "output_config",
            "cache_control",
            "stream_options",
        ] {
            assert!(b.get(f).is_none(), "`{f}` in {b}");
        }
        assert_eq!(b["tools"][0]["type"], "function");
        assert_eq!(b["tools"][0]["function"]["parameters"]["type"], "object");

        let m = b["messages"].as_array().unwrap();
        let roles: Vec<&str> = m.iter().map(|x| x["role"].as_str().unwrap()).collect();
        // Mistral wants the assistant between a tool result and the user.
        assert_eq!(
            roles,
            [
                "system",
                "user",
                "assistant",
                "tool",
                "tool",
                "assistant",
                "user"
            ]
        );
        assert_eq!(m[5]["content"], BRIDGE);
        assert!(m[5].get("tool_calls").is_none());
        assert_eq!(m[0]["content"], "istruzioni");
        // Thinking is dropped, text and calls kept; arguments are a JSON string.
        assert_eq!(m[2]["content"], "Guardo.");
        let calls = m[2]["tool_calls"].as_array().unwrap();
        assert_eq!(
            calls[1]["id"], "aB3dE5gH7",
            "an id that fits passes unchanged"
        );
        assert_eq!(calls[1]["function"]["arguments"], "{\"a\":1}");
        // A foreign id is mapped, the same way for the call and its result.
        let mapped = calls[0]["id"].as_str().unwrap();
        assert_eq!(mapped.len(), 9);
        assert!(mapped.chars().all(|c| c.is_ascii_alphanumeric()));
        assert_eq!(m[3]["tool_call_id"], mapped);
        assert_eq!(m[3]["content"], "Istantanea 1280x800");
        assert_eq!(m[3]["name"], "istantanea_pagina");
        assert!(m[4]["content"].as_str().unwrap().starts_with("ERROR:"));
        assert_eq!(m[4]["name"], "valida");
        // The snapshot travels in the user message after the tool results.
        let parts = m[6]["content"].as_array().unwrap();
        assert_eq!(parts[0]["type"], "image_url");
        assert_eq!(parts[0]["image_url"], "data:image/png;base64,AAAA");
        assert_eq!(parts[1]["text"], "procedi");
    }

    #[test]
    fn the_openai_form_of_images_and_usage_is_one_flag_away() {
        let openai = Dialect {
            endpoint: "https://api.openai.com/v1/chat/completions",
            image_url_as_string: false,
            tool_ids_alnum9: false,
            ask_stream_usage: true,
            max_output_tokens: 64000,
            assistant_after_tool: false,
        };
        // Where the order is free, nothing is added between a result and the
        // next question.
        let roles: Vec<String> = to_chat_messages(&openai, &after_a_proposal())
            .iter()
            .map(|m| m["role"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(roles, ["user", "assistant", "tool", "user"]);
        let msgs = vec![json!({ "role": "user", "content": [
            { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "B" } },
            { "type": "text", "text": "cosa vedi?" } ] })];
        let b = request_body(&openai, "gpt-x", &[], &msgs, &[], true, 64000);
        assert_eq!(
            b["messages"][0]["content"][0]["image_url"]["url"],
            "data:image/jpeg;base64,B"
        );
        assert_eq!(b["stream_options"]["include_usage"], true);
        assert!(b.get("tools").is_none());
        assert_eq!(tool_id(&openai, "toolu_01"), "toolu_01");
    }

    /// The conversation as `domanda_dopo` (`ai/mod.rs`) leaves it: the proposal
    /// went to the person, and the next question carries its result.
    fn after_a_proposal() -> Vec<Value> {
        vec![
            json!({ "role": "user", "content": "Aggiungi un bottone" }),
            json!({ "role": "assistant", "content": [
                { "type": "tool_use", "id": "prop00001", "name": "proponi_modifica", "input": { "pages": [] } } ] }),
            json!({ "role": "user", "content": [
                { "type": "tool_result", "tool_use_id": "prop00001", "content": "La proposta è andata alla persona." },
                { "type": "text", "text": "Ora spostalo a destra" } ] }),
        ]
    }

    /// The next question after a proposal is the most common shape of all, and
    /// Mistral refuses it as it is («Unexpected role 'user' after role 'tool'»).
    #[test]
    fn mistral_gets_an_assistant_turn_between_a_tool_result_and_the_user() {
        let m = to_chat_messages(&MISTRAL, &after_a_proposal());
        let roles: Vec<&str> = m.iter().map(|x| x["role"].as_str().unwrap()).collect();
        assert_eq!(roles, ["user", "assistant", "tool", "assistant", "user"]);
        assert_eq!(m[4]["content"], "Ora spostalo a destra");
        // The rule of the roles, on every pair: after `tool` only `tool` or
        // `assistant`; and no assistant message is empty.
        let png = json!({ "type": "image", "source": { "type": "base64",
                          "media_type": "image/png", "data": "AAAA" } });
        let mut long = after_a_proposal();
        long.extend([
            // A turn of thinking alone: nothing to send.
            json!({ "role": "assistant", "content": [{ "type": "thinking", "thinking": "…" }] }),
            json!({ "role": "assistant", "content": "" }),
            json!({ "role": "assistant", "content": [
                { "type": "tool_use", "id": "snap00001", "name": "istantanea_pagina", "input": {} } ] }),
            // A snapshot: the image cannot stay in the `tool` message.
            json!({ "role": "user", "content": [
                { "type": "tool_result", "tool_use_id": "snap00001", "content": [png] } ] }),
            json!({ "role": "assistant", "content": [{ "type": "text", "text": "Fatto." }] }),
            json!({ "role": "user", "content": "grazie" }),
        ]);
        let m = to_chat_messages(&MISTRAL, &long);
        for pair in m.windows(2) {
            if pair[0]["role"] == "tool" {
                assert_ne!(pair[1]["role"], "user", "{m:#?}");
            }
        }
        for a in m.iter().filter(|x| x["role"] == "assistant") {
            let has_text = a["content"].as_str().is_some_and(|t| !t.is_empty());
            assert!(has_text || a.get("tool_calls").is_some(), "{a}");
        }
        // The image is still there, with a word that says what it is.
        let with_image = m
            .iter()
            .find(|x| x["content"].is_array())
            .expect("the snapshot");
        assert_eq!(with_image["role"], "user");
        assert_eq!(with_image["content"][0]["type"], "image_url");
        assert_eq!(with_image["content"][1]["type"], "text");
    }

    /// The connection closes half-way: no finish reason, no `[DONE]`. The text
    /// that arrived looks like an answer and is not one.
    #[test]
    fn a_stream_cut_short_is_an_error() {
        let whole = sse(&[
            delta(json!({ "content": "Aggiungo il bottone e poi" })),
            delta(json!({ "tool_calls": [{ "index": 0, "id": "x12345678",
                "function": { "name": "proponi_modifica", "arguments": "{\"pages\": [" } }] })),
            end("tool_calls", json!({})),
        ]);
        // Cut after the first event, and in the middle of the second.
        let first = whole.find("\n\n").unwrap() + 2;
        for cut in [first, first + 40] {
            let e = play(&whole[..cut], 16).0.unwrap_err();
            assert!(format!("{e:#}").contains("before the end"), "{e:#}");
        }
        // `[DONE]` alone closes a turn whose provider gives no finish reason.
        let s = sse(&[delta(json!({ "content": "ciao" }))]);
        assert_eq!(play(&s, 16).0.unwrap().stop_reason, "end_turn");
    }

    /// The name of a call can come after its first piece: the chat is told once,
    /// when it is known.
    #[test]
    fn a_call_is_announced_once_when_its_name_arrives() {
        let s = sse(&[
            delta(
                json!({ "tool_calls": [{ "index": 0, "id": "x12345678", "function": { "arguments": "" } }] }),
            ),
            delta(
                json!({ "tool_calls": [{ "index": 0, "function": { "name": "valida", "arguments": "{" } }] }),
            ),
            delta(json!({ "tool_calls": [{ "index": 0, "function": { "arguments": "}" } }] })),
            end("tool_calls", json!({})),
        ]);
        let (r, seen) = play(&s, 50);
        assert_eq!(r.unwrap().tool_uses()[0].1, "valida");
        assert_eq!(
            seen.iter()
                .filter(|e| e.starts_with("StrumentoInizio"))
                .count(),
            1
        );
    }

    #[test]
    fn mapped_ids_are_stable() {
        assert_eq!(
            tool_id(&MISTRAL, "toolu_01XYZ"),
            tool_id(&MISTRAL, "toolu_01XYZ")
        );
        assert_ne!(
            tool_id(&MISTRAL, "toolu_01XYZ"),
            tool_id(&MISTRAL, "toolu_01XYW")
        );
    }

    #[test]
    fn a_single_answer_gives_text_and_usage() {
        let v = json!({ "choices": [{ "message": { "role": "assistant", "content": " Ciao " } }],
                        "usage": { "prompt_tokens": 3, "completion_tokens": 2 } });
        let (t, u) = parse_single(&v).unwrap();
        assert_eq!(t, "Ciao");
        assert_eq!(u["output_tokens"], 2);
        assert!(parse_single(&json!({ "choices": [] })).is_err());
        assert_eq!(
            error_message(&json!({ "message": "Unauthorized" })).as_deref(),
            Some("Unauthorized")
        );
    }

    /// Every tool of the assistant survives the translation: a schema that is
    /// not an object, or a name missing, is a 422 at the first turn.
    #[test]
    fn every_tool_of_the_assistant_translates() {
        let all = super::super::tools::definizioni_per(super::super::tools::Opzioni {
            disegna_simboli: true,
            sfondi: true,
        });
        assert!(!all.is_empty());
        for t in &all {
            let c = to_chat_tool(t);
            assert!(
                c["function"]["name"]
                    .as_str()
                    .is_some_and(|n| !n.is_empty()),
                "{t}"
            );
            assert_eq!(c["function"]["parameters"]["type"], "object", "{t}");
        }
    }
}
