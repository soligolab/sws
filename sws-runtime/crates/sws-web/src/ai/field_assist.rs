//! The AI on a single IDE field (plan `docs/plans/2026-11-20-ia-sui-campi.md`).
//!
//! A small icon next to a field that is hard to write — a tag's expression, a
//! display format — opens a pop-up: the person says what they want («convert
//! to MB with two decimals»), the model of the `fields` purpose proposes the
//! new value of the field and, when the request needs them, of the fields next
//! to it (unit, decimals). The IDE shows them as before → after and applies
//! them all or none. When the request is ambiguous (kB or KiB?) the model asks
//! one question first, as the interview of the symbol editor does.
//!
//! Nothing is saved here: the answer is a proposal, the IDE writes it into the
//! form, and the person saves as usual.

use serde::Deserialize;
use serde_json::{json, Value};

use super::{client, price_list, scopi, spending, strumenti_scopi::estrai_json};
use crate::router::AppState;

const REQUEST_MAX_CHARS: usize = 2000;
const VALUE_MAX_CHARS: usize = 4000;
const ENTITY_MAX_BYTES: usize = 16 * 1024;
const MAX_ROUNDS: usize = 3;
const MAX_TAG_NAMES: usize = 400;

/// What the pop-up sends.
#[derive(Debug, Deserialize)]
pub struct FieldRequest {
    /// Which kind of field: `tag_expression` or `format` (the prompt explains
    /// each one to the model).
    pub kind: String,
    /// The field the icon is on, e.g. `expression`.
    pub field: String,
    /// Its value now.
    #[serde(default)]
    pub value: String,
    /// The whole thing the field belongs to: the tag, the page object.
    #[serde(default)]
    pub entity: Value,
    /// The live value of the tag, when there is one.
    #[serde(default)]
    pub live_value: Option<Value>,
    /// The fields the model may change (the field itself and its neighbours).
    #[serde(default)]
    pub allowed: Vec<String>,
    /// The names of the project's tags, for an expression that reads others.
    #[serde(default)]
    pub tags: Vec<String>,
    /// What the person asked.
    pub request: String,
    /// Questions already answered, in order.
    #[serde(default)]
    pub rounds: Vec<Round>,
}

#[derive(Debug, Deserialize)]
pub struct Round {
    pub question: String,
    #[serde(default)]
    pub answer: String,
}

const SYSTEM: &str = "You help fill ONE field of SWS, an HMI/SCADA editor. You get the field, its current value, \
the whole entity it belongs to (JSON), sometimes the live value, the fields you may change, and the request.

Field kinds:
- tag_expression: the `expression` of a CALCULATED tag. It is a Python subset evaluated in a sandbox whenever a tag \
it reads changes; the result is the tag's value. Other tags are read as tags[\"name\"] (names from the list given). \
Allowed: numbers, strings, operators, f-strings, tags[\"…\"], assignments, if/else expressions, and the builtins \
round, min, max, abs, int, float, str, len, sum, format. NOT allowed: import, loops, functions, lambda, \
comprehensions, +=, range, pow, str.format, names starting with _. A tag with an expression has no source of its \
own: it cannot transform its own raw value, only read other tags. If the entity is a tag fed by a source (it has \
`source`), say so in the note and propose the expression for a new calculated tag that reads it, without changing \
fields. The neighbours `unit` (display unit, e.g. \"MB\") and `decimals` (integer 0-6, display only) are separate \
fields: set them when the request implies them.
- format: the display format of a page object. Text with ONE placeholder: {value}, {value:.1f}, {value:.2f}, \
{value:.0f}, {value:+.1f}, {value:.2e}, {value:.1%}, durations in ms {value:hms} {value:hm} {value:dhms}, instants \
in ms {value:date} {value:time} {value:datetime}; the text around is kept (\"{value:.1f} °C\"). A format does NO \
arithmetic: a unit conversion needs a calculated tag, say so in the note.

When the request leaves something important open (kB or KiB, °C or °F, which tag), ask ONE short question with 2 to \
4 likely choices instead of guessing. Otherwise propose. Change only the fields you may change; a change's value is \
always a string (\"2\" for decimals, \"\" to clear). Write the question and the note in the language of the request.

Answer ONLY with JSON, one of:
{\"kind\": \"proposal\", \"changes\": [{\"field\": \"…\", \"value\": \"…\"}], \"note\": \"…\"}
{\"kind\": \"question\", \"question\": \"…\", \"choices\": [\"…\"]}";

/// The shape a local model is held to (`client::ask_shaped`).
fn schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["kind"],
        "properties": {
            "kind": { "type": "string", "enum": ["proposal", "question"] },
            "changes": { "type": "array", "maxItems": 6, "items": {
                "type": "object", "additionalProperties": false, "required": ["field", "value"],
                "properties": { "field": { "type": "string" }, "value": { "type": "string" } } } },
            "note": { "type": "string" },
            "question": { "type": "string" },
            "choices": { "type": "array", "maxItems": 4, "items": { "type": "string" } }
        }
    })
}

fn refused(code: &str, message: impl Into<String>) -> Value {
    json!({ "ok": false, "code": code, "message": message.into() })
}

fn check(req: &FieldRequest) -> Result<(), String> {
    if !matches!(req.kind.as_str(), "tag_expression" | "format") {
        return Err(format!("unknown field kind {}", req.kind));
    }
    if req.request.trim().is_empty() {
        return Err("nothing asked".into());
    }
    if req.request.chars().count() > REQUEST_MAX_CHARS
        || req.value.chars().count() > VALUE_MAX_CHARS
        || req.rounds.len() > MAX_ROUNDS
        || req.allowed.len() > 8
    {
        return Err("request too long".into());
    }
    if serde_json::to_vec(&req.entity)
        .map(|v| v.len())
        .unwrap_or(0)
        > ENTITY_MAX_BYTES
    {
        return Err("entity too big".into());
    }
    if !req.allowed.iter().any(|f| f == &req.field) {
        return Err("the field itself must be allowed".into());
    }
    Ok(())
}

/// What the model is asked: the context, then the request, then each round.
fn messages(req: &FieldRequest) -> Vec<Value> {
    let tags: Vec<&str> = req
        .tags
        .iter()
        .take(MAX_TAG_NAMES)
        .map(String::as_str)
        .collect();
    let mut text = format!(
        "Field kind: {}\nField: {}\nCurrent value: {}\nYou may change: {}\nEntity: {}\n",
        req.kind,
        req.field,
        if req.value.is_empty() {
            "(empty)"
        } else {
            &req.value
        },
        req.allowed.join(", "),
        req.entity,
    );
    if let Some(v) = &req.live_value {
        text.push_str(&format!("Live value now: {v}\n"));
    }
    if req.kind == "tag_expression" && !tags.is_empty() {
        text.push_str(&format!("Project tags: {}\n", tags.join(", ")));
    }
    text.push_str(&format!("\nRequest: {}", req.request.trim()));
    let mut out = vec![json!({ "role": "user", "content": text })];
    for r in &req.rounds {
        out.push(json!({ "role": "assistant", "content":
            json!({ "kind": "question", "question": r.question }).to_string() }));
        let a = if r.answer.trim().is_empty() {
            "Decide yourself."
        } else {
            r.answer.trim()
        };
        out.push(json!({ "role": "user", "content": a }));
    }
    if req.rounds.len() >= MAX_ROUNDS {
        out.push(json!({ "role": "user", "content": "No more questions: propose now." }));
    }
    out
}

/// The answer, cleaned: a proposal limited to the allowed fields, or one
/// question with at most four choices. `None` when it does not read.
fn clean(v: &Value, allowed: &[String], may_ask: bool) -> Option<Value> {
    match v.get("kind").and_then(Value::as_str)? {
        "question" if may_ask => {
            let q = v.get("question").and_then(Value::as_str)?.trim();
            if q.is_empty() {
                return None;
            }
            let choices: Vec<&str> = v
                .get("choices")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).take(4).collect())
                .unwrap_or_default();
            Some(json!({ "kind": "question", "question": q, "choices": choices }))
        }
        "proposal" => {
            let changes: Vec<Value> = v
                .get("changes")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|c| {
                            let field = c.get("field").and_then(Value::as_str)?;
                            let value = match c.get("value")? {
                                Value::String(s) => s.clone(),
                                Value::Null => String::new(),
                                other => other.to_string(),
                            };
                            allowed
                                .iter()
                                .any(|f| f == field)
                                .then(|| json!({ "field": field, "value": value }))
                        })
                        .collect()
                })
                .unwrap_or_default();
            let note = v.get("note").and_then(Value::as_str).unwrap_or("").trim();
            if changes.is_empty() && note.is_empty() {
                return None;
            }
            Some(json!({ "kind": "proposal", "changes": changes, "note": note }))
        }
        _ => None,
    }
}

/// One round: a proposal or a question. Codes: `no_model`, `bad_request`,
/// `cap_reached`, `provider`, `invalid` (the answer did not read twice).
pub(crate) async fn assist(
    s: &AppState,
    choice: Option<client::Scelta>,
    http: &reqwest::Client,
    req: FieldRequest,
) -> Value {
    let Some(choice) = choice else {
        return refused("no_model", "no AI model is configured");
    };
    if let Err(e) = check(&req) {
        return refused("bad_request", e);
    }
    let may_ask = req.rounds.len() < MAX_ROUNDS;
    let mut msgs = messages(&req);
    let shape = schema();
    let mut spent = 0.0_f64;
    let mut out = refused("invalid", "the answer did not read");
    for _ in 0..2 {
        if spent >= choice.tetto_usd {
            out = refused(
                "cap_reached",
                format!("{spent:.2} $ of {:.2} $", choice.tetto_usd),
            );
            break;
        }
        let (answer, usage) =
            match client::ask_shaped(http, &choice, SYSTEM, &msgs, 1500, Some(&shape)).await {
                Ok(a) => a,
                Err(e) => {
                    out = refused("provider", format!("{e:#}"));
                    break;
                }
            };
        let cost = price_list::cost_usd(
            &s.config_dir,
            choice.fornitore,
            &choice.modello,
            &usage,
            s.in_cloud(),
        );
        spending::add(
            &s.config_dir,
            scopi::Scopo::Fields.nome(),
            choice.fornitore.nome(),
            cost,
        );
        spent += cost;
        let read = serde_json::from_str::<Value>(estrai_json(&answer)).ok();
        if let Some(mut good) = read.as_ref().and_then(|v| clean(v, &req.allowed, may_ask)) {
            good["ok"] = json!(true);
            out = good;
            break;
        }
        tracing::info!(answer = %answer.chars().take(500).collect::<String>(), "field assist unreadable");
        msgs.push(json!({ "role": "assistant", "content": answer }));
        msgs.push(json!({ "role": "user", "content":
            "That is not the JSON asked: answer only {\"kind\": \"proposal\", …} or {\"kind\": \"question\", …}." }));
    }
    out["cost_usd"] = json!(spent);
    out["model"] = json!(choice.modello);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    type Seen = Arc<Mutex<Vec<Value>>>;

    /// A local model on localhost that answers with the next text of
    /// `answers`, and keeps the bodies it received.
    async fn fake_model(answers: Vec<String>) -> (String, Seen) {
        let seen: Seen = Default::default();
        let queue = Arc::new(Mutex::new(answers.into_iter()));
        let seen2 = seen.clone();
        let app = axum::Router::new().route(
            "/v1/chat/completions",
            axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
                let (seen, queue) = (seen2.clone(), queue.clone());
                async move {
                    seen.lock().unwrap().push(body);
                    let text = queue.lock().unwrap().next().unwrap_or_default();
                    axum::Json(json!({
                        "choices": [{ "index": 0, "finish_reason": "stop",
                                      "message": { "role": "assistant", "content": text } }],
                        "usage": { "prompt_tokens": 300, "completion_tokens": 60 },
                    }))
                }
            }),
        );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        (format!("http://{addr}/v1/chat/completions"), seen)
    }

    fn local(url: &str) -> client::Scelta {
        client::Scelta {
            fornitore: client::Fornitore::Local,
            chiave: "local".into(),
            source: client::KeySource::Project,
            modello: "qwen3.5:9b".into(),
            tetto_usd: 1.0,
            endpoint: Some(url.into()),
            sees_images: false,
        }
    }

    fn ram(rounds: Value) -> FieldRequest {
        serde_json::from_value(json!({
            "kind": "tag_expression", "field": "expression", "value": "",
            "entity": { "id": "host.ram_mb", "data_type": "f64" },
            "live_value": 55044.44921875,
            "allowed": ["expression", "unit", "decimals"],
            "tags": ["host.ram"],
            "request": "converti la RAM in MB con due decimali",
            "rounds": rounds,
        }))
        .unwrap()
    }

    async fn ask(answers: Vec<&str>, req: FieldRequest) -> (Value, Seen) {
        let (url, seen) = fake_model(answers.into_iter().map(String::from).collect()).await;
        let dir = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(dir.path()).await;
        let out = assist(&s, Some(local(&url)), &reqwest::Client::new(), req).await;
        (out, seen)
    }

    #[tokio::test]
    async fn an_ambiguous_request_gets_a_question_then_the_proposal() {
        let q = r#"{"kind":"question","question":"kB o KiB?","choices":["kB (÷1000)","KiB (÷1024)","x","y","z"]}"#;
        let (out, _) = ask(vec![q], ram(json!([]))).await;
        assert_eq!(out["ok"], true);
        assert_eq!(out["kind"], "question");
        assert_eq!(out["choices"].as_array().unwrap().len(), 4);

        let p = r#"{"kind":"proposal","changes":[{"field":"expression","value":"tags[\"host.ram\"] / 1000"},{"field":"unit","value":"MB"},{"field":"decimals","value":"2"}],"note":"÷1000"}"#;
        let (out, seen) = ask(
            vec![p],
            ram(json!([{ "question": "kB o KiB?", "answer": "kB" }])),
        )
        .await;
        assert_eq!(out["kind"], "proposal");
        assert_eq!(out["changes"].as_array().unwrap().len(), 3);
        // The model saw the live value, the tags and the answered round.
        let body = seen.lock().unwrap()[0].to_string();
        assert!(
            body.contains("55044.44921875")
                && body.contains("host.ram")
                && body.contains("kB o KiB?")
        );
    }

    #[tokio::test]
    async fn changes_outside_the_allowed_fields_are_dropped() {
        let p = r#"{"kind":"proposal","changes":[{"field":"expression","value":"1"},{"field":"source","value":"x"},{"field":"decimals","value":2}]}"#;
        let (out, _) = ask(vec![p], ram(json!([]))).await;
        let fields: Vec<&str> = out["changes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["field"].as_str().unwrap())
            .collect();
        assert_eq!(fields, ["expression", "decimals"]);
        // A number from a cloud model becomes a string.
        assert_eq!(out["changes"][1]["value"], "2");
    }

    #[tokio::test]
    async fn an_unreadable_answer_is_asked_again_once() {
        let p = r#"{"kind":"proposal","changes":[{"field":"expression","value":"1"}]}"#;
        let (out, seen) = ask(vec!["sure! here it is", p], ram(json!([]))).await;
        assert_eq!(out["kind"], "proposal");
        assert_eq!(seen.lock().unwrap().len(), 2);
        let (out, _) = ask(vec!["no", "still no"], ram(json!([]))).await;
        assert_eq!(out["code"], "invalid");
    }

    #[tokio::test]
    async fn after_the_last_round_a_question_does_not_count() {
        let rounds = json!([{ "question": "a?" }, { "question": "b?" }, { "question": "c?" }]);
        let q = r#"{"kind":"question","question":"d?"}"#;
        let (out, _) = ask(vec![q, q], ram(rounds)).await;
        assert_eq!(out["code"], "invalid");
    }

    #[tokio::test]
    async fn bad_requests_are_refused_before_paying() {
        let mut r = ram(json!([]));
        r.kind = "script".into();
        let (out, seen) = ask(vec![], r).await;
        assert_eq!(out["code"], "bad_request");
        assert!(seen.lock().unwrap().is_empty());
        let mut r = ram(json!([]));
        r.allowed = vec!["unit".into()];
        assert_eq!(ask(vec![], r).await.0["code"], "bad_request");
        let dir = tempfile::tempdir().unwrap();
        let s = crate::router::stato_di_prova(dir.path()).await;
        let out = assist(&s, None, &reqwest::Client::new(), ram(json!([]))).await;
        assert_eq!(out["code"], "no_model");
    }
}
