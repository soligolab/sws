//! The AI keys of the user, over HTTP (seed
//! `docs/archive/2026-11-12-chiavi-ia-nel-profilo-utente.md`; decisions of
//! the maintainer, 15-11-2026). Storage and encryption are in `sws-identita`
//! (`ai_keys.rs`); this is the doors.
//!
//! Two kinds of door, with two kinds of caller:
//!
//! - **The person**, with a session of the gateway: `GET /api/identity/ai-keys`
//!   (provider and last four letters, never the value), `PUT` and `DELETE` on
//!   `/api/identity/ai-keys/:provider`. Any user of the cloud may have keys.
//! - **The container of a project**, with its return key (`gateway/ritorno.rs`):
//!   `GET /api/internal/ai-key/:provider?user=<email>`. The assistant of a
//!   project that has no key of its own asks the gateway for the key of whoever
//!   is writing in the chat, keeps it in memory for the session and never
//!   writes it down.
//!
//! The container may ask only for the key of someone who is **working in that
//! project right now**: the gateway notes each request it forwards (who, to
//! which container) and answers only if the person was forwarded to that
//! container in the last few minutes. So a container cannot collect the keys of
//! the people of its company who are not there, and the gateway is the only
//! place where the person's session and the project meet.

use crate::router::{AppState, AuthUser};
use axum::{
    extract::{Path, Query, Request, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long after a forwarded request the container may still ask for that
/// person's key. A chat session is opened by a request and asks at once; the
/// margin is for a slow start.
pub const FORWARDED_WITHIN: Duration = Duration::from_secs(5 * 60);

/// Who was forwarded to which container, and when. In memory: a restart of the
/// gateway forgets it, and the next request of each person puts them back.
#[derive(Default)]
pub struct Forwarded {
    seen: Mutex<HashMap<(String, String), Instant>>,
}

impl Forwarded {
    /// A request of `email` was forwarded to the container of `project`.
    pub fn note(&self, project: &str, email: &str, now: Instant) {
        let mut seen = self.seen.lock().unwrap_or_else(|e| e.into_inner());
        // The map does not grow without bound: old entries go when it is big.
        if seen.len() > 1024 {
            seen.retain(|_, t| now.saturating_duration_since(*t) < FORWARDED_WITHIN);
        }
        seen.insert((project.to_string(), email.to_lowercase()), now);
    }

    /// Whether `email` was forwarded to `project` within [`FORWARDED_WITHIN`].
    pub fn recent(&self, project: &str, email: &str, now: Instant) -> bool {
        self.seen
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&(project.to_string(), email.to_lowercase()))
            .is_some_and(|t| now.saturating_duration_since(*t) <= FORWARDED_WITHIN)
    }
}

/// The process-wide record: the gateway is one per process.
pub fn forwarded() -> &'static Forwarded {
    static F: std::sync::OnceLock<Forwarded> = std::sync::OnceLock::new();
    F.get_or_init(Forwarded::default)
}

/// The providers of the AI menu (`ai/scopi.rs`): the assistant's, and OpenAI
/// and Black Forest Labs for the backgrounds (16-11-2026).
fn provider_known(provider: &str) -> bool {
    crate::ai::scopi::FORNITORI
        .iter()
        .any(|(id, _, _)| *id == provider)
}

/// The person who is asking, as a user of the installation. Takes the name,
/// not the request: a request held across an `await` makes the handler's future
/// not `Send` (its body is not `Sync`).
async fn user_of(s: &AppState, username: Option<String>) -> Result<sws_identita::Utente, Response> {
    let Some(id) = s.identita.as_ref() else {
        return Err((StatusCode::NOT_FOUND, "no accounts on this installation").into_response());
    };
    let Some(username) = username else {
        return Err(StatusCode::UNAUTHORIZED.into_response());
    };
    match id.user_by_email(&username).await {
        Ok(Some(u)) if u.attivo => Ok(u),
        // A project user or the synthetic admin of a development run has no
        // account of the installation, hence no keys of its own.
        Ok(_) => Err((StatusCode::NOT_FOUND, "no account of the installation").into_response()),
        Err(e) => {
            tracing::error!("AI keys: cannot read the account: {e}");
            Err(StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
    }
}

/// Who the session says is asking.
fn username_of(req: &Request) -> Option<String> {
    req.extensions()
        .get::<AuthUser>()
        .map(|a| a.username.clone())
}

/// `GET /api/identity/ai-keys` → `[{provider, last4, readable, model}]`: one
/// row per provider with a key or a preferred model (`last4` null = no key).
pub async fn list(State(s): State<AppState>, req: Request) -> Response {
    let user = match user_of(&s, username_of(&req)).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    let id = s.identita.as_ref().expect("checked by user_of");
    let (keys, mut models) = match (id.list_ai_keys(user.id).await, id.ai_models(user.id).await) {
        (Ok(k), Ok(m)) => (k, m),
        (Err(e), _) | (_, Err(e)) => {
            tracing::error!("AI keys: cannot list: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let mut rows: Vec<serde_json::Value> = keys
        .into_iter()
        .map(|k| {
            json!({
                "provider": k.provider,
                "last4": k.last4,
                "readable": k.readable,
                "model": models.remove(&k.provider),
            })
        })
        .collect();
    rows.extend(models.into_iter().map(|(provider, model)| {
        json!({ "provider": provider, "last4": null, "readable": false, "model": model })
    }));
    Json(rows).into_response()
}

#[derive(Deserialize)]
pub struct ModelBody {
    model: Option<String>,
}

/// `PUT /api/identity/ai-keys/:provider/model` `{model}` — the model the user
/// prefers for this provider; null or empty = the provider's default.
pub async fn put_model(
    State(s): State<AppState>,
    Path(provider): Path<String>,
    req: Request,
) -> Response {
    let user = match user_of(&s, username_of(&req)).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    if !provider_known(&provider) {
        return (StatusCode::BAD_REQUEST, "unknown provider").into_response();
    }
    let bytes = match axum::body::to_bytes(req.into_body(), 4 * 1024).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "body too large").into_response(),
    };
    let Ok(body) = serde_json::from_slice::<ModelBody>(&bytes) else {
        return (StatusCode::BAD_REQUEST, "expected {\"model\": \"...\"}").into_response();
    };
    let id = s.identita.as_ref().expect("checked by user_of");
    match id
        .set_ai_model(user.id, &provider, body.model.as_deref())
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

/// `POST /api/identity/ai-keys/:provider/test` — «Test the key» with the
/// user's own key: `{ok: true, models}` in alphabetical order, or `{ok: false,
/// error}` with what the provider said. A free call (the list of models).
pub async fn test(
    State(s): State<AppState>,
    Path(provider): Path<String>,
    req: Request,
) -> Response {
    let user = match user_of(&s, username_of(&req)).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    if !provider_known(&provider) {
        return (StatusCode::BAD_REQUEST, "unknown provider").into_response();
    }
    let id = s.identita.as_ref().expect("checked by user_of");
    let key = match id.ai_key(user.id, &provider).await {
        Ok(Some(k)) => k,
        Ok(None) => return Json(json!({ "ok": false, "error": "no key saved" })).into_response(),
        Err(e) => {
            tracing::error!("AI keys: cannot read the key: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    match crate::ai::scopi::prova_questa_chiave(&provider, &key).await {
        Ok(models) => Json(json!({ "ok": true, "models": models })).into_response(),
        Err(e) => Json(json!({ "ok": false, "error": e })).into_response(),
    }
}

#[derive(Deserialize)]
pub struct PutBody {
    key: String,
}

/// `PUT /api/identity/ai-keys/:provider` `{key}`.
pub async fn put(
    State(s): State<AppState>,
    Path(provider): Path<String>,
    req: Request,
) -> Response {
    let user = match user_of(&s, username_of(&req)).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    if !provider_known(&provider) {
        return (StatusCode::BAD_REQUEST, "unknown provider").into_response();
    }
    let bytes = match axum::body::to_bytes(req.into_body(), 4 * 1024).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "body too large").into_response(),
    };
    let Ok(body) = serde_json::from_slice::<PutBody>(&bytes) else {
        return (StatusCode::BAD_REQUEST, "expected {\"key\": \"...\"}").into_response();
    };
    let id = s.identita.as_ref().expect("checked by user_of");
    match id.set_ai_key(user.id, &provider, &body.key).await {
        Ok(()) => {
            // The fact, never the value.
            s.audit.log(
                "ai_key.set",
                Some(user.email),
                json!({ "provider": provider }),
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

/// `DELETE /api/identity/ai-keys/:provider`.
pub async fn remove(
    State(s): State<AppState>,
    Path(provider): Path<String>,
    req: Request,
) -> Response {
    let user = match user_of(&s, username_of(&req)).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    if !provider_known(&provider) {
        return (StatusCode::BAD_REQUEST, "unknown provider").into_response();
    }
    let id = s.identita.as_ref().expect("checked by user_of");
    match id.remove_ai_key(user.id, &provider).await {
        Ok(true) => {
            s.audit.log(
                "ai_key.removed",
                Some(user.email),
                json!({ "provider": provider }),
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("AI keys: cannot remove: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct ForContainerQuery {
    user: String,
    /// `0`: only the preferred model, the project has a key of its own.
    #[serde(default)]
    key: Option<String>,
}

/// `GET /api/internal/ai-key/:provider?user=<email>` — the container of a
/// project asks for the key of whoever is writing in its chat. Only with the
/// container's return key, and only for someone forwarded to that container a
/// moment ago.
pub async fn for_container(
    State(s): State<AppState>,
    Path(provider): Path<String>,
    Query(q): Query<ForContainerQuery>,
    req: Request,
) -> Response {
    // A person's session does not open this door: only a container does.
    let Some(caller) = req
        .extensions()
        .get::<crate::gateway::ritorno::Chiamante>()
        .cloned()
    else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if !provider_known(&provider) {
        return (StatusCode::BAD_REQUEST, "unknown provider").into_response();
    }
    if !forwarded().recent(&caller.riferimento, &q.user, Instant::now()) {
        // Not an error of the caller to be told off about: the person is just
        // not there, as far as the gateway knows.
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(id) = s.identita.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let user = match id.user_by_email(&q.user).await {
        Ok(Some(u)) if u.attivo => u,
        Ok(_) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("AI keys: cannot read the account: {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let model = match id.ai_models(user.id).await {
        Ok(mut m) => m.remove(&provider),
        Err(e) => {
            tracing::error!("AI keys: cannot read the models: {e}");
            None
        }
    };
    // The key only when the project has none: a key that would not be used
    // does not leave the gateway.
    let want_key = q.key.as_deref() != Some("0");
    let key = if want_key {
        match id.ai_key(user.id, &provider).await {
            Ok(k) => k,
            Err(e) => {
                tracing::error!("AI keys: cannot read the key: {e}");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        }
    } else {
        None
    };
    if key.is_none() && model.is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if key.is_some() {
        tracing::info!(
            target: "sws_ai",
            project = %caller.riferimento,
            user_id = user.id,
            provider = %provider,
            "AI key of the user handed to the project's container"
        );
        s.audit.log(
            "ai_key.used",
            Some(user.email),
            json!({ "provider": provider, "project": caller.riferimento }),
        );
    }
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({ "key": key, "model": model })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway::ritorno::Chiamante;
    use axum::body::Body;

    fn caller(project: &str) -> Chiamante {
        Chiamante {
            azienda: project.split('/').next().unwrap().into(),
            riferimento: project.into(),
        }
    }

    fn request(email: Option<&str>, body: Option<&str>) -> Request {
        let mut r = Request::builder()
            .body(Body::from(body.unwrap_or("").to_string()))
            .unwrap();
        if let Some(email) = email {
            r.extensions_mut().insert(AuthUser {
                username: email.into(),
                role: sws_auth::Role::Admin,
                must_change_password: false,
                allowed_zones: vec![],
                amministratore_piattaforma: false,
            });
        }
        r
    }

    async fn state() -> (AppState, tempfile::TempDir, i64) {
        let dir = tempfile::tempdir().unwrap();
        let mut s = crate::router::stato_di_prova(dir.path()).await;
        let id = sws_identita::Identita::apri(dir.path().join("identita.db"))
            .await
            .unwrap();
        let u = id
            .crea_utente(
                "m@soligo.net",
                "Mauro",
                "unapassword",
                sws_identita::Ruolo::Sviluppatore,
                false,
            )
            .await
            .unwrap();
        s.identita = Some(id);
        (s, dir, u.id)
    }

    async fn status_and_text(r: Response) -> (StatusCode, String) {
        let status = r.status();
        let bytes = axum::body::to_bytes(r.into_body(), 1 << 16).await.unwrap();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    #[test]
    fn a_person_is_forwarded_to_a_container_for_a_few_minutes_only() {
        let f = Forwarded::default();
        let t0 = Instant::now();
        assert!(!f.recent("acme/impianto", "m@soligo.net", t0));
        f.note("acme/impianto", "M@Soligo.net", t0);
        // The email is the same whatever its case; the project is the one.
        assert!(f.recent(
            "acme/impianto",
            "m@soligo.net",
            t0 + Duration::from_secs(60)
        ));
        assert!(!f.recent("acme/altro", "m@soligo.net", t0));
        assert!(!f.recent("acme/impianto", "b@soligo.net", t0));
        assert!(!f.recent(
            "acme/impianto",
            "m@soligo.net",
            t0 + FORWARDED_WITHIN + Duration::from_secs(1)
        ));
        // Another request renews it.
        let later = t0 + FORWARDED_WITHIN;
        f.note("acme/impianto", "m@soligo.net", later);
        assert!(f.recent(
            "acme/impianto",
            "m@soligo.net",
            later + Duration::from_secs(200)
        ));
    }

    #[tokio::test]
    async fn a_user_lists_sets_and_removes_their_keys_and_the_value_never_comes_back() {
        let (s, _d, _) = state().await;
        let (st, body) =
            status_and_text(list(State(s.clone()), request(Some("m@soligo.net"), None)).await)
                .await;
        assert_eq!((st, body.as_str()), (StatusCode::OK, "[]"));
        let r = put(
            State(s.clone()),
            Path("anthropic".into()),
            request(
                Some("m@soligo.net"),
                Some(r#"{"key":"sk-ant-segretissima-1234"}"#),
            ),
        )
        .await;
        assert_eq!(r.status(), StatusCode::NO_CONTENT);
        let (st, body) =
            status_and_text(list(State(s.clone()), request(Some("m@soligo.net"), None)).await)
                .await;
        assert_eq!(st, StatusCode::OK);
        assert!(body.contains("\"last4\":\"1234\""), "{body}");
        assert!(!body.contains("segretissima"), "{body}");
        let r = remove(
            State(s.clone()),
            Path("anthropic".into()),
            request(Some("m@soligo.net"), None),
        )
        .await;
        assert_eq!(r.status(), StatusCode::NO_CONTENT);
        let r = remove(
            State(s),
            Path("anthropic".into()),
            request(Some("m@soligo.net"), None),
        )
        .await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn bad_callers_and_bad_values_are_refused() {
        let (s, _d, _) = state().await;
        // No session.
        let r = list(State(s.clone()), request(None, None)).await;
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
        // A project user, with no account of the installation.
        let r = list(State(s.clone()), request(Some("operatore"), None)).await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
        // An unknown provider, a body that is not what is asked, and a bad key.
        let put_ = |p: &str, b: &str| {
            put(
                State(s.clone()),
                Path(p.into()),
                request(Some("m@soligo.net"), Some(b)),
            )
        };
        assert_eq!(
            put_("gemini", r#"{"key":"k"}"#).await.status(),
            StatusCode::BAD_REQUEST
        );
        // Mistral is one of the providers since 16-11-2026 (it was the unknown
        // one of this test until then).
        assert!(provider_known("mistral"));
        assert!(put_("mistral", r#"{"key":"sk-mistral-1234"}"#)
            .await
            .status()
            .is_success());
        assert_eq!(
            put_("kimi", "not json").await.status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            put_("kimi", r#"{"key":"due parole"}"#).await.status(),
            StatusCode::BAD_REQUEST
        );
    }

    #[tokio::test]
    async fn the_container_gets_the_key_only_of_someone_who_is_there() {
        let (s, _d, uid) = state().await;
        s.identita
            .as_ref()
            .unwrap()
            .set_ai_key(uid, "kimi", "sk-kimi-del-container-7777")
            .await
            .unwrap();
        let ask = |who: Option<Chiamante>, user: &str| {
            let mut r = request(None, None);
            if let Some(c) = who {
                r.extensions_mut().insert(c);
            }
            for_container(
                State(s.clone()),
                Path("kimi".into()),
                Query(ForContainerQuery {
                    user: user.into(),
                    key: None,
                }),
                r,
            )
        };
        // A person's session is not a container: no.
        assert_eq!(
            ask(None, "m@soligo.net").await.status(),
            StatusCode::UNAUTHORIZED
        );
        // A container, but the person was never forwarded to it: no.
        assert_eq!(
            ask(Some(caller("acme/impianto")), "m@soligo.net")
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
        // Forwarded to another container: still no.
        forwarded().note("acme/altro", "m@soligo.net", Instant::now());
        assert_eq!(
            ask(Some(caller("acme/impianto")), "m@soligo.net")
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
        // Forwarded to this one: the key, and the answer is not cached.
        forwarded().note("acme/impianto", "m@soligo.net", Instant::now());
        let r = ask(Some(caller("acme/impianto")), "m@soligo.net").await;
        assert_eq!(r.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");
        let (st, body) = status_and_text(r).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(body, r#"{"key":"sk-kimi-del-container-7777","model":null}"#);
        // A provider the person has no key for: no key.
        let r = for_container(
            State(s.clone()),
            Path("anthropic".into()),
            Query(ForContainerQuery {
                user: "m@soligo.net".into(),
                key: None,
            }),
            {
                let mut r = request(None, None);
                r.extensions_mut().insert(caller("acme/impianto"));
                r
            },
        )
        .await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn a_preferred_model_travels_alone_when_the_project_has_the_key() {
        let (s, _d, uid) = state().await;
        let id = s.identita.as_ref().unwrap();
        id.set_ai_key(uid, "openai", "sk-oa-1234").await.unwrap();
        id.set_ai_model(uid, "openai", Some("gpt-image-2"))
            .await
            .unwrap();
        id.set_ai_model(uid, "anthropic", Some("claude-x"))
            .await
            .unwrap();
        forwarded().note("acme/modelli", "m@soligo.net", Instant::now());
        let ask = |provider: &str, key: Option<&str>| {
            let mut r = request(None, None);
            r.extensions_mut().insert(caller("acme/modelli"));
            for_container(
                State(s.clone()),
                Path(provider.into()),
                Query(ForContainerQuery {
                    user: "m@soligo.net".into(),
                    key: key.map(str::to_string),
                }),
                r,
            )
        };
        let (st, body) = status_and_text(ask("openai", Some("0")).await).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(body, r#"{"key":null,"model":"gpt-image-2"}"#);
        let (_, body) = status_and_text(ask("openai", None).await).await;
        assert!(body.contains("sk-oa-1234"), "{body}");
        // A model without a key is still an answer.
        let (st, body) = status_and_text(ask("anthropic", None).await).await;
        assert_eq!(
            (st, body.as_str()),
            (StatusCode::OK, r#"{"key":null,"model":"claude-x"}"#)
        );
        // The list: one row per provider with a key or a model.
        let r = list(State(s.clone()), request(Some("m@soligo.net"), None)).await;
        let (_, body) = status_and_text(r).await;
        assert!(
            body.contains(r#""provider":"anthropic","readable":false,"last4":null"#)
                || body.contains(r#""last4":null"#),
            "{body}"
        );
        assert!(
            body.contains("gpt-image-2") && body.contains("1234"),
            "{body}"
        );
    }
}
