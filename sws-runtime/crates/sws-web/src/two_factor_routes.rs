//! The routes of two-factor authentication (plan `docs/plans/2026-11-21-p6-2fa-e-ldap.md`);
//! the logic is in `sws_identita::two_factor`.
//!
//! - **At login** (pre-auth, like `/api/auth/login`): a right password with
//!   2FA on answers `{second_factor: "code", challenge}`; the code (or a
//!   recovery code) goes to `/api/auth/second-factor`. With 2FA required and
//!   not set up, `{second_factor: "setup", challenge}`: the person sets it up
//!   with `/api/auth/second-factor/setup` and `…/setup/confirm`, and only then
//!   gets a session. Wrong codes count with wrong passwords.
//! - **The account's own** (`/api/identity/2fa…`): status, on, off, new codes.
//! - **The console**: a company requires it of its members, the platform of
//!   everyone; an administrator resets it for someone who lost the phone.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde::Deserialize;
use serde_json::json;
use sws_identita::{ChallengeKind, Identita, Rifiuto};

use crate::router::{AppState, AuthUser};

// `result_large_err`: the error is the HTTP answer already made, as in
// `amministrazione.rs`.
#[allow(clippy::result_large_err)]
fn store(s: &AppState) -> Result<&Identita, Response> {
    s.identita
        .as_ref()
        .ok_or_else(|| StatusCode::NOT_FOUND.into_response())
}

/// What the login answers when the second factor is next.
pub(crate) fn challenge_response(
    s: &AppState,
    email: &str,
    challenge: &str,
    kind: ChallengeKind,
) -> Response {
    s.audit.log(
        "auth.second_factor_asked",
        Some(email.to_string()),
        json!({ "kind": kind }),
    );
    Json(json!({ "second_factor": kind, "challenge": challenge })).into_response()
}

fn refused(r: Rifiuto) -> Response {
    match r {
        Rifiuto::Bloccato { riprova_fra } => (
            StatusCode::TOO_MANY_REQUESTS,
            [(
                axum::http::header::RETRY_AFTER,
                riprova_fra.as_secs().to_string(),
            )],
        )
            .into_response(),
        _ => StatusCode::UNAUTHORIZED.into_response(),
    }
}

#[derive(Deserialize)]
pub struct CodeBody {
    pub challenge: String,
    #[serde(default)]
    pub code: String,
    /// As in the login: the «session expired» window renews the session of
    /// whoever is working, without closing their project.
    #[serde(default)]
    pub riautentica: bool,
}

/// `POST /api/auth/second-factor` — the code for a challenge: the session.
pub async fn second_factor(State(s): State<AppState>, Json(b): Json<CodeBody>) -> Response {
    let id = match store(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    match id.second_factor(&b.challenge, &b.code).await {
        Ok((a, recovery)) => {
            if recovery {
                s.audit.log(
                    "auth.recovery_code_used",
                    Some(a.utente.email.clone()),
                    json!({}),
                );
            }
            crate::router::entra(
                &s,
                a,
                if recovery { "recovery_code" } else { "totp" },
                b.riautentica,
            )
            .await
        }
        Err(r) => {
            s.audit.log("auth.second_factor_failed", None, json!({}));
            refused(r)
        }
    }
}

/// `POST /api/auth/second-factor/setup` — 2FA required, not set up: the
/// secret for the app.
pub async fn setup(State(s): State<AppState>, Json(b): Json<CodeBody>) -> Response {
    let id = match store(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    match id.second_factor_setup(&b.challenge).await {
        Ok(x) => Json(x).into_response(),
        Err(r) => refused(r),
    }
}

/// `POST /api/auth/second-factor/setup/confirm` — its first code: the
/// session, and the recovery codes to keep.
pub async fn setup_confirm(State(s): State<AppState>, Json(b): Json<CodeBody>) -> Response {
    let id = match store(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    match id.second_factor_setup_confirm(&b.challenge, &b.code).await {
        Ok((a, codes)) => {
            s.audit.log(
                "auth.2fa_on",
                Some(a.utente.email.clone()),
                json!({ "at_login": true }),
            );
            crate::router::entra_with(
                &s,
                a,
                "totp",
                b.riautentica,
                Some(json!({ "recovery_codes": codes })),
            )
            .await
        }
        Err(r) => {
            s.audit
                .log("auth.second_factor_failed", None, json!({ "setup": true }));
            refused(r)
        }
    }
}

// ── the account's own ──────────────────────────────────────────────────────

async fn me(s: &AppState, user: &AuthUser) -> Result<(Identita, i64), Response> {
    let id = store(s)?.clone();
    let users = id.elenca().await.unwrap_or_default();
    let u = users
        .iter()
        .find(|u| u.email.eq_ignore_ascii_case(&user.username))
        .ok_or_else(|| StatusCode::NOT_FOUND.into_response())?;
    Ok((id, u.id))
}

fn bad(e: anyhow::Error) -> Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({ "error": e.to_string() })),
    )
        .into_response()
}

/// `GET /api/identity/2fa`
pub async fn status(State(s): State<AppState>, Extension(user): Extension<AuthUser>) -> Response {
    match me(&s, &user).await {
        Ok((id, uid)) => match id.two_factor_status(uid).await {
            Ok(st) => Json(st).into_response(),
            Err(e) => bad(e),
        },
        Err(r) => r,
    }
}

/// `POST /api/identity/2fa/start` — a secret for the app, not active yet.
pub async fn start(State(s): State<AppState>, Extension(user): Extension<AuthUser>) -> Response {
    match me(&s, &user).await {
        Ok((id, uid)) => match id.two_factor_start(uid).await {
            Ok(x) => Json(x).into_response(),
            Err(e) => bad(e),
        },
        Err(r) => r,
    }
}

#[derive(Deserialize)]
pub struct OwnBody {
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub password: String,
}

/// `POST /api/identity/2fa/confirm` — the first code: on, and the recovery codes.
pub async fn confirm(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(b): Json<OwnBody>,
) -> Response {
    match me(&s, &user).await {
        Ok((id, uid)) => match id.two_factor_confirm(uid, &b.code).await {
            Ok(codes) => {
                s.audit
                    .log("auth.2fa_on", Some(user.username.clone()), json!({}));
                Json(json!({ "recovery_codes": codes })).into_response()
            }
            Err(e) => bad(e),
        },
        Err(r) => r,
    }
}

/// `POST /api/identity/2fa/disable` — password and a code.
pub async fn disable(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(b): Json<OwnBody>,
) -> Response {
    match me(&s, &user).await {
        Ok((id, uid)) => match id.two_factor_disable(uid, &b.password, &b.code).await {
            Ok(()) => {
                s.audit
                    .log("auth.2fa_off", Some(user.username.clone()), json!({}));
                StatusCode::NO_CONTENT.into_response()
            }
            Err(e) => bad(e),
        },
        Err(r) => r,
    }
}

/// `POST /api/identity/2fa/recovery-codes` — ten new ones, with a code.
pub async fn new_codes(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(b): Json<OwnBody>,
) -> Response {
    match me(&s, &user).await {
        Ok((id, uid)) => match id.two_factor_new_codes(uid, &b.code).await {
            Ok(codes) => {
                s.audit
                    .log("auth.2fa_new_codes", Some(user.username.clone()), json!({}));
                Json(json!({ "recovery_codes": codes })).into_response()
            }
            Err(e) => bad(e),
        },
        Err(r) => r,
    }
}

// ── the console ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct OnBody {
    pub on: bool,
}

/// `GET /api/amministrazione/aziende/:id/require-2fa`
pub async fn company_get(
    State(s): State<AppState>,
    Extension(chi): Extension<AuthUser>,
    Path(company): Path<i64>,
) -> Response {
    if let Some(mine) = crate::amministrazione::confine_pubblico(&s, &chi).await {
        if !mine.contains(&company) {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    match store(&s) {
        Ok(id) => match id.company_requires_2fa(company).await {
            Ok(on) => Json(json!({ "on": on })).into_response(),
            Err(e) => bad(e),
        },
        Err(r) => r,
    }
}

/// `PUT /api/amministrazione/aziende/:id/require-2fa` — by whoever
/// administers the company (or the platform).
pub async fn company_put(
    State(s): State<AppState>,
    Extension(chi): Extension<AuthUser>,
    Path(company): Path<i64>,
    Json(b): Json<OnBody>,
) -> Response {
    if let Some(mine) = crate::amministrazione::confine_pubblico(&s, &chi).await {
        if !mine.contains(&company) {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    match store(&s) {
        Ok(id) => match id.set_company_require_2fa(company, b.on).await {
            Ok(()) => {
                s.audit.log(
                    "amministrazione.azienda_2fa",
                    Some(chi.username.clone()),
                    json!({ "id": company, "on": b.on }),
                );
                StatusCode::NO_CONTENT.into_response()
            }
            Err(e) => bad(e),
        },
        Err(r) => r,
    }
}

/// `POST /api/amministrazione/utenti/:id/2fa/reset` — a phone lost: by the
/// platform, or by whoever administers a company of that person.
pub async fn user_reset(
    State(s): State<AppState>,
    Extension(chi): Extension<AuthUser>,
    Path(user_id): Path<i64>,
) -> Response {
    let id = match store(&s) {
        Ok(i) => i,
        Err(r) => return r,
    };
    if let Some(mine) = crate::amministrazione::confine_pubblico(&s, &chi).await {
        let theirs = id.aziende_di(user_id).await.unwrap_or_default();
        if !theirs.iter().any(|(a, _)| mine.contains(a)) {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    match id.two_factor_reset(user_id).await {
        Ok(()) => {
            s.audit.log(
                "auth.2fa_reset",
                Some(chi.username.clone()),
                json!({ "user_id": user_id }),
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => bad(e),
    }
}

/// `GET|PUT /api/amministrazione/require-2fa` — the platform's switch.
pub async fn platform_get(State(s): State<AppState>) -> Response {
    match store(&s) {
        Ok(id) => match id.platform_requires_2fa().await {
            Ok(on) => Json(json!({ "on": on })).into_response(),
            Err(e) => bad(e),
        },
        Err(r) => r,
    }
}

pub async fn platform_put(
    State(s): State<AppState>,
    Extension(chi): Extension<AuthUser>,
    Json(b): Json<OnBody>,
) -> Response {
    match store(&s) {
        Ok(id) => match id.set_platform_require_2fa(b.on).await {
            Ok(()) => {
                s.audit.log(
                    "amministrazione.piattaforma_2fa",
                    Some(chi.username.clone()),
                    json!({ "on": b.on }),
                );
                StatusCode::NO_CONTENT.into_response()
            }
            Err(e) => bad(e),
        },
        Err(r) => r,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn body(r: Response) -> (StatusCode, serde_json::Value) {
        let st = r.status();
        let b = axum::body::to_bytes(r.into_body(), 1 << 16).await.unwrap();
        (st, serde_json::from_slice(&b).unwrap_or_default())
    }

    /// The way of an account with 2FA required by its company: the login's
    /// challenge, the secret, the first code — and the session, with the
    /// recovery codes in the same answer.
    #[tokio::test]
    async fn required_2fa_is_set_up_at_login() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = crate::router::stato_di_prova(dir.path()).await;
        let id = Identita::apri(dir.path().join("identita.db"))
            .await
            .unwrap();
        let u = id
            .crea_utente(
                "m@x.it",
                "M",
                "password-lunga",
                sws_identita::Ruolo::Sviluppatore,
                false,
            )
            .await
            .unwrap();
        let acme = id.crea_azienda("Acme").await.unwrap();
        id.iscrivi(acme.id, u.id, sws_identita::Ruolo::Sviluppatore)
            .await
            .unwrap();
        id.set_company_require_2fa(acme.id, true).await.unwrap();
        s.identita = Some(id.clone());

        let Err(Rifiuto::SecondFactor { challenge, kind }) =
            id.accedi_per("m@x.it", "password-lunga", None).await
        else {
            panic!("a challenge")
        };
        let (st, v) = body(challenge_response(&s, "m@x.it", &challenge, kind)).await;
        assert_eq!(
            (st, v["second_factor"].as_str()),
            (StatusCode::OK, Some("setup"))
        );
        assert!(v.get("token").is_none(), "no session yet");

        let cb = |code: &str| CodeBody {
            challenge: challenge.clone(),
            code: code.into(),
            riautentica: false,
        };
        let (st, v) = body(setup(State(s.clone()), Json(cb(""))).await).await;
        assert_eq!(st, StatusCode::OK);
        let secret =
            sws_identita::two_factor::base32_decode(v["secret"].as_str().unwrap()).unwrap();
        assert!(v["uri"]
            .as_str()
            .unwrap()
            .starts_with("otpauth://totp/SWS:"));
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let code = format!(
            "{:06}",
            sws_identita::two_factor::totp_code(&secret, now / 30)
        );
        let (st, v) = body(setup_confirm(State(s.clone()), Json(cb(&code))).await).await;
        assert_eq!(st, StatusCode::OK, "{v}");
        assert!(v["token"].is_string());
        assert_eq!(v["recovery_codes"].as_array().unwrap().len(), 10);
        // The challenge is spent.
        let (st, _) = body(second_factor(State(s.clone()), Json(cb(&code))).await).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
    }
}
