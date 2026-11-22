//! The panel's users from an LDAP / Active Directory server (plan
//! `docs/plans/2026-11-21-p6-2fa-e-ldap.md`).
//!
//! Decision of the maintainer (21-11-2026): for the **users of the panel** (the
//! project's): an operator signs in with the domain account, the role comes
//! from the group, the local users of `users.yaml` stay as the fallback.
//!
//! The order at login: a local user (project, then device) with that name
//! wins — LDAP is asked only for a name neither has, so a domain account can
//! never shadow a local one. Then: search the user (with the service account,
//! or anonymously), bind **as the user** with the password typed, read
//! `memberOf`, take the highest role among the groups configured. In no group
//! configured → refused. Server unreachable → refused, and said in the
//! register: the local users still get in.
//!
//! Two traps closed here: an **empty password** is refused before anything
//! (a simple bind with an empty password is an anonymous bind, and succeeds),
//! and the name typed is **escaped** into the filter (RFC 4515).

use std::time::Duration;

use ldap3::{LdapConnAsync, LdapConnSettings, Scope, SearchEntry};
use sws_auth::Role;
use sws_core::project::{LdapConfig, LdapGroup};

/// How a sign-in through the directory went.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// `name`: the name pages show (`displayName`, else `givenName`, or the
    /// attribute the configuration names), when the directory has one.
    In { role: Role, zones: Vec<String>, name: Option<String> },
    /// Wrong password, unknown user, or in no group configured.
    Refused,
    /// The server didn't answer (or the service account was refused).
    Unreachable(String),
}

pub fn role_of(name: &str) -> Option<Role> {
    match name.to_ascii_lowercase().as_str() {
        "viewer" => Some(Role::Viewer),
        "operator" => Some(Role::Operator),
        "supervisor" => Some(Role::Supervisor),
        "admin" => Some(Role::Admin),
        _ => None,
    }
}

/// The filter with the user's name in it, escaped.
pub fn user_filter(template: &str, user: &str) -> String {
    template.replace("{user}", &ldap3::ldap_escape(user))
}

/// DNs compared as the directory does: case and spaces after commas don't count.
fn same_dn(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        s.split(',')
            .map(|p| p.trim().to_ascii_lowercase())
            .collect::<Vec<_>>()
            .join(",")
    };
    norm(a) == norm(b)
}

/// The highest role among the groups the user is in, and the zones: all if
/// any of those groups gives all (no zones listed), otherwise their union.
pub fn role_for(groups: &[LdapGroup], member_of: &[String]) -> Option<(Role, Vec<String>)> {
    let mine: Vec<(&LdapGroup, Role)> = groups
        .iter()
        .filter(|g| member_of.iter().any(|m| same_dn(m, &g.dn)))
        .filter_map(|g| Some((g, role_of(&g.role)?)))
        .collect();
    let role = mine.iter().map(|(_, r)| *r).max()?;
    let zones = if mine.iter().any(|(g, _)| g.zones.is_empty()) {
        Vec::new()
    } else {
        let mut z: Vec<String> = mine.iter().flat_map(|(g, _)| g.zones.clone()).collect();
        z.sort();
        z.dedup();
        z
    };
    Some((role, zones))
}

/// The service account's password: its environment variable, or the one in
/// the project's secrets.
fn bind_password(cfg: &LdapConfig) -> Option<String> {
    cfg.password_env
        .as_deref()
        .and_then(|v| std::env::var(v).ok())
        .or_else(|| cfg.bind_password.clone())
}

async fn connect(cfg: &LdapConfig) -> Result<ldap3::Ldap, String> {
    let timeout = Duration::from_millis(cfg.timeout_ms.clamp(500, 60_000));
    let settings = LdapConnSettings::new()
        .set_conn_timeout(timeout)
        .set_starttls(cfg.starttls);
    let (conn, mut ldap) = LdapConnAsync::with_settings(settings, &cfg.url)
        .await
        .map_err(|e| format!("{}: {e}", cfg.url))?;
    ldap3::drive!(conn);
    ldap.with_timeout(timeout);
    Ok(ldap)
}

/// The attributes that give the name to show, in order of preference.
fn name_attributes(cfg: &LdapConfig) -> Vec<String> {
    match cfg.name_attribute.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        Some(a) => vec![a.to_string()],
        None => vec!["displayName".into(), "givenName".into()],
    }
}

/// Finds `user` with the service account: its DN, its groups and its name.
async fn find(cfg: &LdapConfig, user: &str) -> Result<Option<(String, Vec<String>, Option<String>)>, String> {
    let mut ldap = connect(cfg).await?;
    if let Some(dn) = cfg.bind_dn.as_deref().filter(|d| !d.is_empty()) {
        ldap.simple_bind(dn, &bind_password(cfg).unwrap_or_default())
            .await
            .and_then(|r| r.success())
            .map_err(|e| format!("service account: {e}"))?;
    }
    let (entries, _) = ldap
        .search(
            &cfg.user_base,
            Scope::Subtree,
            &user_filter(&cfg.user_filter, user),
            std::iter::once("memberOf".to_string())
                .chain(name_attributes(cfg))
                .collect::<Vec<_>>(),
        )
        .await
        .and_then(|r| r.success())
        .map_err(|e| format!("search: {e}"))?;
    let _ = ldap.unbind().await;
    // One user, or none: two entries for one name is a filter that is too
    // wide, and picking one would be guessing.
    if entries.len() != 1 {
        return Ok(None);
    }
    let e = SearchEntry::construct(entries.into_iter().next().expect("one"));
    let groups = e
        .attrs
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("memberOf"))
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    let name = name_attributes(cfg).iter().find_map(|a| {
        e.attrs
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(a))
            .and_then(|(_, v)| v.first())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    });
    Ok(Some((e.dn, groups, name)))
}

/// Signs `user` in through the directory.
pub async fn authenticate(cfg: &LdapConfig, user: &str, password: &str) -> Outcome {
    if !cfg.enabled || user.trim().is_empty() || password.is_empty() {
        return Outcome::Refused;
    }
    let (dn, groups, name) = match find(cfg, user.trim()).await {
        Ok(Some(x)) => x,
        Ok(None) => return Outcome::Refused,
        Err(e) => return Outcome::Unreachable(e),
    };
    let mut ldap = match connect(cfg).await {
        Ok(l) => l,
        Err(e) => return Outcome::Unreachable(e),
    };
    let bound = ldap
        .simple_bind(&dn, password)
        .await
        .and_then(|r| r.success())
        .is_ok();
    let _ = ldap.unbind().await;
    if !bound {
        return Outcome::Refused;
    }
    match role_for(&cfg.groups, &groups) {
        Some((role, zones)) => Outcome::In { role, zones, name },
        None => Outcome::Refused,
    }
}

/// «Prova connessione» of the IDE: the server answers and the service account
/// binds; with a user and a password, also what that user would get.
pub async fn test(cfg: &LdapConfig, user: Option<&str>, password: Option<&str>) -> serde_json::Value {
    use serde_json::json;
    match (user.filter(|u| !u.trim().is_empty()), password) {
        (Some(u), Some(p)) => match authenticate(cfg, u, p).await {
            Outcome::In { role, zones, name } => json!({ "ok": true, "role": role.as_str(), "zones": zones, "name": name }),
            Outcome::Refused => json!({ "ok": false, "code": "refused" }),
            Outcome::Unreachable(m) => json!({ "ok": false, "code": "unreachable", "message": m }),
        },
        _ => match find(cfg, "\u{0}probe").await {
            Ok(_) => json!({ "ok": true }),
            Err(m) => json!({ "ok": false, "code": "unreachable", "message": m }),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn g(dn: &str, role: &str, zones: &[&str]) -> LdapGroup {
        LdapGroup {
            dn: dn.into(),
            role: role.into(),
            zones: zones.iter().map(|z| z.to_string()).collect(),
        }
    }

    #[test]
    fn the_highest_role_and_the_zones_of_the_groups() {
        let groups = [
            g("CN=Operatori,OU=G,DC=x", "operator", &["caldaia"]),
            g("CN=Turnisti,OU=G,DC=x", "operator", &["forno"]),
            g("CN=Capi,OU=G,DC=x", "supervisor", &[]),
            g("CN=Strano,OU=G,DC=x", "boss", &[]),
        ];
        let of = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            role_for(&groups, &of(&["cn=operatori, ou=g, dc=x", "CN=Turnisti,OU=G,DC=x"])),
            Some((Role::Operator, vec!["caldaia".into(), "forno".into()]))
        );
        assert_eq!(
            role_for(&groups, &of(&["CN=Operatori,OU=G,DC=x", "CN=Capi,OU=G,DC=x"])),
            Some((Role::Supervisor, vec![])),
            "a group with all zones gives all"
        );
        assert_eq!(role_for(&groups, &of(&["CN=Altri,DC=x"])), None);
        assert_eq!(role_for(&groups, &of(&["CN=Strano,OU=G,DC=x"])), None, "an unknown role gives nothing");
    }

    #[test]
    fn the_name_is_escaped_into_the_filter() {
        assert_eq!(user_filter("(sAMAccountName={user})", "mario"), "(sAMAccountName=mario)");
        assert_eq!(
            user_filter("(sAMAccountName={user})", "*)(uid=*"),
            "(sAMAccountName=\\2a\\29\\28uid=\\2a)"
        );
    }

    /// Against a real directory: an OpenLDAP in a container, as
    /// `docs/plans/2026-11-21-p6-2fa-e-ldap.md` describes it.
    /// `SWS_LDAP_TEST_URL=ldap://127.0.0.1:13389 cargo test -p sws-web ldap_auth -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn a_real_directory() {
        let url = std::env::var("SWS_LDAP_TEST_URL").expect("SWS_LDAP_TEST_URL");
        let cfg: LdapConfig = serde_yaml::from_str(&format!(
            "url: {url}\nuser_base: ou=people,dc=example,dc=org\nuser_filter: '(uid={{user}})'\n\
             bind_dn: cn=admin,dc=example,dc=org\nbind_password: adminpw\n\
             groups: [{{dn: 'cn=operatori,ou=groups,dc=example,dc=org', role: operator, zones: [caldaia]}}]\n"
        ))
        .unwrap();
        assert_eq!(
            authenticate(&cfg, "mario", "mariopw").await,
            Outcome::In { role: Role::Operator, zones: vec!["caldaia".into()], name: None }
        );
        assert_eq!(authenticate(&cfg, "mario", "sbagliata").await, Outcome::Refused);
        assert_eq!(authenticate(&cfg, "nessuno", "x").await, Outcome::Refused);
        assert_eq!(authenticate(&cfg, "*", "mariopw").await, Outcome::Refused, "a wildcard finds nobody");
        // In no group configured: refused even with the right password.
        let other = LdapConfig { groups: vec![g("cn=altri,dc=example,dc=org", "admin", &[])], ..cfg.clone() };
        assert_eq!(authenticate(&other, "mario", "mariopw").await, Outcome::Refused);
        // The service account with a wrong password: the server is «unreachable».
        let bad = LdapConfig { bind_password: Some("no".into()), ..cfg.clone() };
        assert!(matches!(authenticate(&bad, "mario", "mariopw").await, Outcome::Unreachable(_)));
        assert_eq!(test(&cfg, None, None).await["ok"], true);
    }

    #[tokio::test]
    async fn an_empty_password_never_reaches_the_server() {
        let cfg: LdapConfig = serde_yaml::from_str(
            "url: ldap://127.0.0.1:1\nuser_base: DC=x\ngroups: [{dn: CN=G, role: admin}]\n",
        )
        .unwrap();
        assert_eq!(authenticate(&cfg, "mario", "").await, Outcome::Refused);
        assert_eq!(cfg.user_filter, "(sAMAccountName={user})");
        assert_eq!(cfg.timeout_ms, 5000);
        // A server that isn't there: unreachable, not refused.
        let cfg = LdapConfig { timeout_ms: 500, ..cfg };
        assert!(matches!(authenticate(&cfg, "mario", "pw").await, Outcome::Unreachable(_)));
    }
}

// ── the routes and the login ───────────────────────────────────────────────

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};

use crate::router::{AppState, AuthUser, MASKED_PASSWORD};

/// The project's directory configuration with its password (from the
/// project's secrets).
async fn saved(s: &AppState) -> Option<LdapConfig> {
    let dir = crate::router::active_dir(s).await.ok()?;
    tokio::task::spawn_blocking(move || sws_core::segreti::carica_progetto(&dir).ok()?.ldap)
        .await
        .ok()
        .flatten()
}

/// The password shown as the placeholder means «keep the saved one».
fn with_saved_password(mut cfg: LdapConfig, saved: Option<&LdapConfig>) -> LdapConfig {
    if cfg.bind_password.as_deref() == Some(MASKED_PASSWORD) {
        cfg.bind_password = saved.and_then(|s| s.bind_password.clone());
    }
    cfg
}

/// `PUT /api/project/ldap` — the section of `project.yaml` (`null` removes
/// it); the password goes to `secrets.yaml` with the others.
pub async fn save(
    State(s): State<AppState>,
    Extension(user): Extension<AuthUser>,
    headers: axum::http::HeaderMap,
    Json(cfg): Json<Option<LdapConfig>>,
) -> Response {
    if let Some(c) = &cfg {
        if let Some(bad) = c.groups.iter().find(|g| role_of(&g.role).is_none()) {
            return (StatusCode::UNPROCESSABLE_ENTITY, format!("group {}: unknown role «{}»", bad.dn, bad.role))
                .into_response();
        }
        if !(c.url.starts_with("ldap://") || c.url.starts_with("ldaps://")) {
            return (StatusCode::UNPROCESSABLE_ENTITY, "the address starts with ldap:// or ldaps://").into_response();
        }
    }
    let dir = match crate::router::active_dir(&s).await {
        Ok(d) => d,
        Err(c) => return c.into_response(),
    };
    let before = saved(&s).await;
    let cfg = cfg.map(|c| with_saved_password(c, before.as_ref()));
    s.audit.log(
        "project.change",
        Some(user.username),
        serde_json::json!({ "what": "ldap", "enabled": cfg.as_ref().is_some_and(|c| c.enabled) }),
    );
    crate::router::patch_project_se(
        &s.project_write_lock,
        &dir,
        crate::router::versione_attesa(&headers),
        |p| p.ldap = cfg,
    )
    .await
}

#[derive(serde::Deserialize)]
pub struct TestBody {
    /// The configuration being edited; none = the saved one.
    #[serde(default)]
    pub config: Option<LdapConfig>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

/// `POST /api/auth/ldap/test` — «Prova connessione».
pub async fn test_route(State(s): State<AppState>, Json(b): Json<TestBody>) -> Response {
    let before = saved(&s).await;
    let Some(cfg) = b.config.map(|c| with_saved_password(c, before.as_ref())).or(before) else {
        return (StatusCode::NOT_FOUND, "no directory configured").into_response();
    };
    Json(test(&cfg, b.username.as_deref(), b.password.as_deref()).await).into_response()
}

/// After the project's and the device's users said no: the directory, for a
/// name neither has. A session, or `None`.
pub(crate) async fn login_via_ldap(s: &AppState, username: &str, password: &str) -> Option<sws_auth::LoginOk> {
    if s.auth.has_user(username).await || s.auth_dispositivo.has_user(username).await {
        return None;
    }
    if s.auth.locked_out(username).await.is_some() {
        return None;
    }
    let cfg = saved(s).await.filter(|c| c.enabled)?;
    match authenticate(&cfg, username, password).await {
        Outcome::In { role, zones, name } => {
            let ok = s.auth.issue_external_session(username, role, zones.clone(), name).await?;
            s.audit.log(
                "auth.login",
                Some(username.to_string()),
                serde_json::json!({ "role": role, "via": "ldap", "zones": zones }),
            );
            Some(ok)
        }
        Outcome::Refused => {
            s.auth.note_failure(username).await;
            None
        }
        Outcome::Unreachable(m) => {
            tracing::warn!(error = %m, "ldap: server unreachable, only the local users sign in");
            s.audit.log(
                "auth.ldap_unreachable",
                Some(username.to_string()),
                serde_json::json!({ "error": m }),
            );
            None
        }
    }
}
