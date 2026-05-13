//! Auth scaffolding for the PoC.
//!
//! Scope:
//! - Argon2id password hash + verify (`hash_password`, `verify_password`).
//! - Up to four built-in users (admin / supervisor / operator / viewer)
//!   seeded from env vars. Each has a fixed `Role`; the runtime exposes
//!   `Role::can(action)` helpers for downstream middleware.
//! - In-memory session map keyed by UUID token. Sessions have a TTL
//!   (default 8 h, override via `SWS_SESSION_TTL_SECS`) which slides on
//!   every successful `validate` (rolling refresh).
//! - Login rate-limit (default 5 failures per 60 s per username; override
//!   via `SWS_LOGIN_RATE_LIMIT` / `SWS_LOGIN_RATE_WINDOW_SECS`).
//!
//! Out of scope: refresh tokens, OAuth/LDAP, per-zone ABAC, persistence
//! across restarts.

pub mod session;

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
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

/// User role. Ordered weakest → strongest so `>=` compares correctly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Role {
    Viewer,
    Operator,
    Supervisor,
    Admin,
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Viewer     => "Viewer",
            Role::Operator   => "Operator",
            Role::Supervisor => "Supervisor",
            Role::Admin      => "Admin",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LoginOk {
    pub token: String,
    pub username: String,
    pub role: Role,
    /// Unix timestamp (ms) at which the session expires unless refreshed.
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone)]
struct Account {
    username: String,
    role: Role,
    hash: String,
}

#[derive(Debug, Clone)]
struct Session {
    username: String,
    role: Role,
    expires_at: Instant,
}

#[derive(Debug, Default)]
struct LoginFailures {
    window_start: Option<Instant>,
    count: u32,
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

/// In-memory auth state: a small set of accounts + a session token registry.
pub struct AuthState {
    accounts: HashMap<String, Account>,
    sessions: RwLock<HashMap<String, Session>>,
    /// Per-username login failure counter for rate limiting.
    failures: RwLock<HashMap<String, LoginFailures>>,
    /// Time-to-live for a freshly-issued or refreshed session.
    ttl: Duration,
    /// Failures permitted in `rate_window` before login is locked out.
    rate_limit:  u32,
    rate_window: Duration,
}

#[derive(Debug, Clone, Copy)]
pub enum LoginError {
    BadCredentials,
    RateLimited,
}

impl AuthState {
    /// Seed accounts from a list of (username, role, password). At least one
    /// non-empty password is required.
    pub fn new(
        accounts: Vec<(String, Role, String)>,
        ttl: Duration,
        rate_limit: u32,
        rate_window: Duration,
    ) -> anyhow::Result<Arc<Self>> {
        let usable: Vec<_> = accounts.into_iter()
            .filter(|(_, _, p)| !p.is_empty())
            .collect();
        if usable.is_empty() {
            anyhow::bail!("at least one account password is required (set SWS_ADMIN_PASSWORD)");
        }
        let mut map: HashMap<String, Account> = HashMap::new();
        for (user, role, pwd) in usable {
            let hash = hash_password(&pwd)?;
            info!(user = %user, role = role.as_str(), "auth: account seeded");
            map.insert(user.clone(), Account { username: user, role, hash });
        }
        Ok(Arc::new(Self {
            accounts: map,
            sessions: RwLock::new(HashMap::new()),
            failures: RwLock::new(HashMap::new()),
            ttl,
            rate_limit,
            rate_window,
        }))
    }

    /// Verify credentials and mint a session token on success.
    /// Returns `RateLimited` if the username has exceeded `rate_limit`
    /// failures within `rate_window`.
    pub async fn login(&self, creds: &Credentials) -> Result<LoginOk, LoginError> {
        // Rate-limit check FIRST so a guessing attacker also slows down.
        if self.is_rate_limited(&creds.username).await {
            warn!(user = %creds.username, "login: rate limited");
            return Err(LoginError::RateLimited);
        }

        let account = self.accounts.get(&creds.username).cloned();
        let ok = match &account {
            Some(a) => verify_password(&creds.password, &a.hash),
            None    => false,
        };

        if !ok {
            self.record_failure(&creds.username).await;
            warn!(user = %creds.username, "login: bad credentials");
            return Err(LoginError::BadCredentials);
        }
        let account = account.expect("checked above");

        let token = uuid::Uuid::new_v4().to_string();
        let expires_at = Instant::now() + self.ttl;
        self.sessions.write().await.insert(token.clone(), Session {
            username: account.username.clone(),
            role: account.role,
            expires_at,
        });
        self.failures.write().await.remove(&creds.username);
        info!(user = %account.username, role = account.role.as_str(), "login: session issued");
        Ok(LoginOk {
            token,
            username: account.username,
            role: account.role,
            expires_at_ms: now_unix_ms() + self.ttl.as_millis() as u64,
        })
    }

    /// Returns the (username, role) if the token is valid AND not expired.
    /// Slides the TTL on success (rolling refresh).
    pub async fn validate(&self, token: &str) -> Option<(String, Role)> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(token)?;
        if Instant::now() >= session.expires_at {
            sessions.remove(token);
            return None;
        }
        session.expires_at = Instant::now() + self.ttl;
        Some((session.username.clone(), session.role))
    }

    /// Revoke a session token. Idempotent.
    pub async fn logout(&self, token: &str) -> bool {
        self.sessions.write().await.remove(token).is_some()
    }

    pub async fn session_count(&self) -> usize {
        self.sessions.read().await.len()
    }

    async fn record_failure(&self, username: &str) {
        let mut map = self.failures.write().await;
        let entry = map.entry(username.to_string()).or_default();
        let now = Instant::now();
        match entry.window_start {
            Some(t) if now.duration_since(t) <= self.rate_window => {
                entry.count += 1;
            }
            _ => {
                entry.window_start = Some(now);
                entry.count = 1;
            }
        }
    }

    async fn is_rate_limited(&self, username: &str) -> bool {
        let map = self.failures.read().await;
        let Some(entry) = map.get(username) else { return false };
        let Some(start) = entry.window_start else { return false };
        Instant::now().duration_since(start) <= self.rate_window
            && entry.count >= self.rate_limit
    }
}

fn now_unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn admin_only(pwd: &str) -> Arc<AuthState> {
        AuthState::new(
            vec![("admin".into(), Role::Admin, pwd.into())],
            Duration::from_secs(60),
            5,
            Duration::from_secs(60),
        ).unwrap()
    }

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
        let auth = admin_only("s3cret");

        assert!(matches!(auth.login(&Credentials { username: "admin".into(), password: "nope".into() }).await,
            Err(LoginError::BadCredentials)));
        assert!(matches!(auth.login(&Credentials { username: "root".into(),  password: "s3cret".into() }).await,
            Err(LoginError::BadCredentials)));

        let ok = auth.login(&Credentials { username: "admin".into(), password: "s3cret".into() }).await.unwrap();
        assert_eq!(ok.username, "admin");
        assert_eq!(ok.role, Role::Admin);
        assert!(ok.expires_at_ms > 0);

        let (user, role) = auth.validate(&ok.token).await.unwrap();
        assert_eq!(user, "admin");
        assert_eq!(role, Role::Admin);

        assert!(auth.logout(&ok.token).await);
        assert!(auth.validate(&ok.token).await.is_none());
    }

    #[test]
    fn empty_accounts_rejected() {
        let r = AuthState::new(vec![], Duration::from_secs(60), 5, Duration::from_secs(60));
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn session_ttl_expires() {
        let auth = AuthState::new(
            vec![("admin".into(), Role::Admin, "x".into())],
            Duration::from_millis(50),
            10, Duration::from_secs(60),
        ).unwrap();
        let ok = auth.login(&Credentials { username: "admin".into(), password: "x".into() }).await.unwrap();
        assert!(auth.validate(&ok.token).await.is_some());
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert!(auth.validate(&ok.token).await.is_none(), "session should have expired");
    }

    #[tokio::test]
    async fn login_rate_limit() {
        let auth = AuthState::new(
            vec![("admin".into(), Role::Admin, "x".into())],
            Duration::from_secs(60),
            3, Duration::from_secs(60),
        ).unwrap();
        for _ in 0..3 {
            assert!(matches!(
                auth.login(&Credentials { username: "admin".into(), password: "bad".into() }).await,
                Err(LoginError::BadCredentials)
            ));
        }
        // 4th attempt should be rate-limited regardless of password.
        assert!(matches!(
            auth.login(&Credentials { username: "admin".into(), password: "x".into() }).await,
            Err(LoginError::RateLimited)
        ));
    }

    #[tokio::test]
    async fn role_ordering() {
        assert!(Role::Admin > Role::Supervisor);
        assert!(Role::Supervisor > Role::Operator);
        assert!(Role::Operator > Role::Viewer);
    }
}
