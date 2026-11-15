//! The AI keys of the user, over HTTP (seed
//! `docs/plans/2026-11-12-chiavi-ia-nel-profilo-utente.md`; decisions of
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

/// The provider names the assistant knows (`ai/client.rs`).
fn provider_known(provider: &str) -> bool {
    crate::ai::client::Fornitore::da_nome(provider).is_some()
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

/// `GET /api/identity/ai-keys` → `[{provider, last4, readable}]`.
pub async fn list(State(s): State<AppState>, req: Request) -> Response {
    let user = match user_of(&s, username_of(&req)).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    let id = s.identita.as_ref().expect("checked by user_of");
    match id.list_ai_keys(user.id).await {
        Ok(keys) => Json(keys).into_response(),
        Err(e) => {
            tracing::error!("AI keys: cannot list: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
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
    match id.ai_key(user.id, &provider).await {
        Ok(Some(key)) => {
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
            (
                [(header::CACHE_CONTROL, "no-store")],
                Json(json!({ "key": key })),
            )
                .into_response()
        }
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            tracing::error!("AI keys: cannot read the key: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
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
            put_("openai", r#"{"key":"k"}"#).await.status(),
            StatusCode::BAD_REQUEST
        );
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
                Query(ForContainerQuery { user: user.into() }),
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
        assert_eq!(body, r#"{"key":"sk-kimi-del-container-7777"}"#);
        // A provider the person has no key for: no key.
        let r = for_container(
            State(s.clone()),
            Path("anthropic".into()),
            Query(ForContainerQuery {
                user: "m@soligo.net".into(),
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
}
