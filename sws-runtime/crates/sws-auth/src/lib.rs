//! Auth scaffolding for the PoC.
//!
//! Scope:
//! - Argon2id password hash + verify (`hash_password`, `verify_password`).
//! - Single admin user, credentials seeded at startup from
//!   `SWS_ADMIN_USER` / `SWS_ADMIN_PASSWORD` env vars in the runtime.
//! - In-memory session map: UUID v4 tokens → username. No persistence,
//!   no TTL, no refresh — sessions live until the runtime restarts or
//!   the user explicitly logs out.
//!
//! Out of scope (Phase 2 polish):
//! - Multi-user / role-based access control (RBAC) / per-zone ABAC.
//! - Session expiry, refresh, rate-limited login.
//! - LDAP / OAuth2 plugins.

pub mod session;

use std::{collections::HashMap, sync::Arc};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{info, warn};

#[derive(Debug, Clone, Deserialize)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoginOk {
    pub token: String,
    pub username: String,
}

/// Hash a clear-text password with Argon2id and a fresh random salt.
/// Output is a PHC-formatted string suitable for `verify_password`.
pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("argon2 hash: {e}"))?;
    Ok(hash.to_string())
}

/// Verify `password` against a PHC-formatted Argon2id hash.
/// Returns false on any error (malformed hash, wrong password, etc.).
pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else { return false };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// In-memory auth state: one admin user + a session token registry.
pub struct AuthState {
    admin_user: String,
    admin_hash: String,
    sessions: RwLock<HashMap<String, String>>, // token → username
}

impl AuthState {
    /// Seed the admin user. `password` is hashed once with Argon2id.
    /// Refuses an empty password — the runtime should require this via env.
    pub fn new(admin_user: String, admin_password: &str) -> anyhow::Result<Arc<Self>> {
        if admin_password.is_empty() {
            anyhow::bail!("admin password must not be empty");
        }
        let admin_hash = hash_password(admin_password)?;
        info!(user = %admin_user, "auth: admin credentials seeded");
        Ok(Arc::new(Self {
            admin_user,
            admin_hash,
            sessions: RwLock::new(HashMap::new()),
        }))
    }

    /// Verify credentials and mint a session token on success.
    pub async fn login(&self, creds: &Credentials) -> Option<LoginOk> {
        if creds.username != self.admin_user {
            warn!(user = %creds.username, "login: unknown user");
            return None;
        }
        if !verify_password(&creds.password, &self.admin_hash) {
            warn!(user = %creds.username, "login: bad password");
            return None;
        }
        let token = uuid::Uuid::new_v4().to_string();
        self.sessions.write().await.insert(token.clone(), creds.username.clone());
        info!(user = %creds.username, "login: session issued");
        Some(LoginOk { token, username: creds.username.clone() })
    }

    /// Returns the username if the token is valid.
    pub async fn validate(&self, token: &str) -> Option<String> {
        self.sessions.read().await.get(token).cloned()
    }

    /// Revoke a session token. Idempotent.
    pub async fn logout(&self, token: &str) -> bool {
        self.sessions.write().await.remove(token).is_some()
    }

    /// How many sessions are currently active.
    pub async fn session_count(&self) -> usize {
        self.sessions.read().await.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_and_verify_roundtrip() {
        let h = hash_password("hunter2").unwrap();
        assert!(verify_password("hunter2", &h));
        assert!(!verify_password("hunter3", &h));
    }

    #[test]
    fn verify_rejects_malformed_hash() {
        assert!(!verify_password("anything", "not-a-phc-string"));
    }

    #[tokio::test]
    async fn login_validate_logout_flow() {
        let auth = AuthState::new("admin".into(), "s3cret").unwrap();

        // Wrong password
        assert!(auth.login(&Credentials { username: "admin".into(), password: "nope".into() }).await.is_none());
        // Wrong user
        assert!(auth.login(&Credentials { username: "root".into(), password: "s3cret".into() }).await.is_none());

        // Right creds
        let ok = auth.login(&Credentials { username: "admin".into(), password: "s3cret".into() }).await.unwrap();
        assert_eq!(ok.username, "admin");
        assert!(!ok.token.is_empty());

        // Token validates
        assert_eq!(auth.validate(&ok.token).await.as_deref(), Some("admin"));

        // Logout invalidates
        assert!(auth.logout(&ok.token).await);
        assert!(auth.validate(&ok.token).await.is_none());
    }

    #[test]
    fn empty_password_rejected() {
        assert!(AuthState::new("admin".into(), "").is_err());
    }
}
