//! Auth scaffolding for the PoC.
//!
//! Scope:
//! - Argon2id password hash + verify.
//! - **Persistent** user store keyed by username, stored as `users.yaml`
//!   inside the project directory. Bootstrap from `SWS_ADMIN_PASSWORD`
//!   env when the file is missing or empty.
//! - In-memory session map keyed by UUID token with a sliding TTL.
//! - Login rate-limit per username.
//! - First-login flow via `must_change_password`: the API gates every
//!   non-self-service call until the user changes their password.
//!
//! Out of scope: refresh tokens, OAuth/LDAP, per-zone ABAC, audit trail
//! of user mutations (the existing audit-log v1 covers it).

pub mod session;

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
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
    /// True if the user has to change their password before any other API
    /// call will succeed. The login itself plus self-service endpoints
    /// (whoami / change-password / logout) still work.
    pub must_change_password: bool,
}

/// Public projection of a user — never carries the password hash.
#[derive(Debug, Clone, Serialize)]
pub struct UserSummary {
    pub username: String,
    pub role: Role,
    pub must_change_password: bool,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

/// Patch shape for `PUT /api/auth/users/:username`. Every field is optional;
/// a missing field means "leave unchanged". `password` resets the hash and
/// (implicitly) sets `must_change_password=true` so the operator knows the
/// next login requires a new password.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct UserPatch {
    pub role: Option<Role>,
    pub password: Option<String>,
    pub must_change_password: Option<bool>,
}

/// Payload for `POST /api/auth/users`.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateUser {
    pub username: String,
    pub password: String,
    pub role: Role,
    #[serde(default = "yes")]
    pub must_change_password: bool,
}
fn yes() -> bool { true }

/// Payload for `POST /api/auth/change-password`.
#[derive(Debug, Clone, Deserialize)]
pub struct ChangePassword {
    pub old_password: String,
    pub new_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredUser {
    username: String,
    password_hash: String,
    role: Role,
    #[serde(default)]
    must_change_password: bool,
    #[serde(default)]
    created_at_ms: u64,
    #[serde(default)]
    updated_at_ms: u64,
}

impl StoredUser {
    fn to_summary(&self) -> UserSummary {
        UserSummary {
            username: self.username.clone(),
            role: self.role,
            must_change_password: self.must_change_password,
            created_at_ms: self.created_at_ms,
            updated_at_ms: self.updated_at_ms,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct UserFile {
    #[serde(default)]
    users: Vec<StoredUser>,
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
    /// Set when count reaches rate_limit. Further attempts extend this.
    locked_until: Option<Instant>,
}

/// Hash a clear-text password with Argon2id and a fresh random salt.
pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("argon2 hash: {e}"))?;
    Ok(hash.to_string())
}

/// Verify `password` against a PHC-formatted Argon2id hash.
pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else { return false };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// In-memory auth state backed by a YAML file on disk.
pub struct AuthState {
    /// Path to `users.yaml`. None → in-memory only (tests or "no active
    /// project"). Wrapped in RwLock so `swap_store()` can switch it when
    /// a different project is opened, without rebuilding `Arc<AuthState>`.
    store_path: RwLock<Option<PathBuf>>,
    users: RwLock<HashMap<String, StoredUser>>,
    sessions: RwLock<HashMap<String, Session>>,
    failures: RwLock<HashMap<String, LoginFailures>>,
    ttl: Duration,
    rate_limit:  u32,
    rate_window: Duration,
}

#[derive(Debug, Clone)]
pub enum LoginError {
    BadCredentials,
    /// Account temporarily locked. `retry_after_secs` is the remaining lockout.
    RateLimited { retry_after_secs: u64 },
}

#[derive(Debug, Clone)]
pub enum UserError {
    NotFound,
    AlreadyExists,
    LastAdmin,
    InvalidPassword,
    StorageError(String),
}

impl std::fmt::Display for UserError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UserError::NotFound        => write!(f, "user not found"),
            UserError::AlreadyExists   => write!(f, "user already exists"),
            UserError::LastAdmin       => write!(f, "cannot remove the last admin"),
            UserError::InvalidPassword => write!(f, "current password is wrong"),
            UserError::StorageError(s) => write!(f, "storage error: {s}"),
        }
    }
}

impl AuthState {
    /// Bootstrap from `users.yaml` at `store_path`. When the file is missing
    /// or empty, fall back to the legacy `(username, role, password)` seed
    /// — typically `(admin, Admin, $SWS_ADMIN_PASSWORD)`. The seed users
    /// get `must_change_password=false` so the first run isn't blocked,
    /// and they are flushed to disk so subsequent restarts go straight to
    /// the file path.
    pub fn new_persistent(
        store_path: PathBuf,
        seed: Vec<(String, Role, String)>,
        ttl: Duration,
        rate_limit: u32,
        rate_window: Duration,
    ) -> anyhow::Result<Arc<Self>> {
        let on_disk = if store_path.exists() {
            let text = std::fs::read_to_string(&store_path)
                .map_err(|e| anyhow::anyhow!("read users.yaml: {e}"))?;
            if text.trim().is_empty() {
                UserFile::default()
            } else {
                serde_yaml::from_str::<UserFile>(&text)
                    .map_err(|e| anyhow::anyhow!("parse users.yaml: {e}"))?
            }
        } else {
            UserFile::default()
        };

        let mut users: HashMap<String, StoredUser> = on_disk.users
            .into_iter()
            .map(|u| (u.username.clone(), u))
            .collect();

        // Seed any account that isn't already present on disk (idempotent
        // restart, useful when the env vars are reset across deployments).
        let now = now_unix_ms();
        for (name, role, pwd) in seed.into_iter().filter(|(_, _, p)| !p.is_empty()) {
            if !users.contains_key(&name) {
                let hash = hash_password(&pwd)?;
                info!(user = %name, role = role.as_str(), "auth: seeded account from env");
                users.insert(name.clone(), StoredUser {
                    username: name,
                    password_hash: hash,
                    role,
                    must_change_password: false,
                    created_at_ms: now,
                    updated_at_ms: now,
                });
            }
        }

        if users.is_empty() {
            anyhow::bail!("no users available — set SWS_ADMIN_PASSWORD or populate users.yaml");
        }

        // Flush the seeded set so subsequent restarts find them on disk.
        let to_write = UserFile { users: users.values().cloned().collect() };
        if let Some(parent) = store_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let yaml = serde_yaml::to_string(&to_write)
            .map_err(|e| anyhow::anyhow!("serialise users.yaml: {e}"))?;
        std::fs::write(&store_path, yaml)
            .map_err(|e| anyhow::anyhow!("write users.yaml: {e}"))?;

        Ok(Arc::new(Self {
            store_path: RwLock::new(Some(store_path)),
            users: RwLock::new(users),
            sessions: RwLock::new(HashMap::new()),
            failures: RwLock::new(HashMap::new()),
            ttl,
            rate_limit,
            rate_window,
        }))
    }

    /// Test-only in-memory constructor — same shape as the old `new` so
    /// existing unit tests keep working without disk access.
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
        let now = now_unix_ms();
        let mut users: HashMap<String, StoredUser> = HashMap::new();
        for (user, role, pwd) in usable {
            let hash = hash_password(&pwd)?;
            users.insert(user.clone(), StoredUser {
                username: user,
                password_hash: hash,
                role,
                must_change_password: false,
                created_at_ms: now,
                updated_at_ms: now,
            });
        }
        Ok(Arc::new(Self {
            store_path: RwLock::new(None),
            users: RwLock::new(users),
            sessions: RwLock::new(HashMap::new()),
            failures: RwLock::new(HashMap::new()),
            ttl,
            rate_limit,
            rate_window,
        }))
    }

    /// Empty in-memory auth state — used when no project is active.
    /// Login is impossible (no users); existing tokens are invalid.
    pub fn empty(ttl: Duration, rate_limit: u32, rate_window: Duration) -> Arc<Self> {
        Arc::new(Self {
            store_path: RwLock::new(None),
            users: RwLock::new(HashMap::new()),
            sessions: RwLock::new(HashMap::new()),
            failures: RwLock::new(HashMap::new()),
            ttl,
            rate_limit,
            rate_window,
        })
    }

    /// Switch the backing `users.yaml` to a different project's path,
    /// dropping all current sessions/failures and reloading users from
    /// the new path (or from `seed` if the file is missing/empty).
    /// Used by `POST /api/projects/:name/open` to retarget authentication
    /// without rebuilding the Arc.
    pub async fn swap_store(
        &self,
        new_path: PathBuf,
        seed: Vec<(String, Role, String)>,
    ) -> anyhow::Result<()> {
        let on_disk = if new_path.exists() {
            let text = std::fs::read_to_string(&new_path)
                .map_err(|e| anyhow::anyhow!("read users.yaml: {e}"))?;
            if text.trim().is_empty() {
                UserFile::default()
            } else {
                serde_yaml::from_str::<UserFile>(&text)
                    .map_err(|e| anyhow::anyhow!("parse users.yaml: {e}"))?
            }
        } else {
            UserFile::default()
        };

        let mut new_users: HashMap<String, StoredUser> = on_disk
            .users
            .into_iter()
            .map(|u| (u.username.clone(), u))
            .collect();
        let now = now_unix_ms();
        for (name, role, pwd) in seed.into_iter().filter(|(_, _, p)| !p.is_empty()) {
            if !new_users.contains_key(&name) {
                let hash = hash_password(&pwd)?;
                info!(user = %name, role = role.as_str(), "auth: seeded account from env");
                new_users.insert(name.clone(), StoredUser {
                    username: name,
                    password_hash: hash,
                    role,
                    must_change_password: false,
                    created_at_ms: now,
                    updated_at_ms: now,
                });
            }
        }
        if new_users.is_empty() {
            anyhow::bail!("no users available — set SWS_ADMIN_PASSWORD or populate users.yaml");
        }

        if let Some(parent) = new_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let to_write = UserFile { users: new_users.values().cloned().collect() };
        let yaml = serde_yaml::to_string(&to_write)
            .map_err(|e| anyhow::anyhow!("serialise users.yaml: {e}"))?;
        std::fs::write(&new_path, yaml)
            .map_err(|e| anyhow::anyhow!("write users.yaml: {e}"))?;

        *self.users.write().await = new_users;
        self.sessions.write().await.clear();
        self.failures.write().await.clear();
        *self.store_path.write().await = Some(new_path);
        Ok(())
    }

    /// Drop every user/session/failure — moves the AuthState to a no-project
    /// state. Tokens become invalid; login is impossible until `swap_store`
    /// is called again.
    pub async fn clear(&self) {
        self.users.write().await.clear();
        self.sessions.write().await.clear();
        self.failures.write().await.clear();
        *self.store_path.write().await = None;
    }

    /// Verify credentials and mint a session token on success.
    pub async fn login(&self, creds: &Credentials) -> Result<LoginOk, LoginError> {
        if let Some(retry_after_secs) = self.check_lockout(&creds.username).await {
            warn!(user = %creds.username, retry_after_secs, "login: account locked");
            return Err(LoginError::RateLimited { retry_after_secs });
        }

        let user = self.users.read().await.get(&creds.username).cloned();
        let ok = match &user {
            Some(u) => verify_password(&creds.password, &u.password_hash),
            None    => false,
        };

        if !ok {
            self.record_failure(&creds.username).await;
            warn!(user = %creds.username, "login: bad credentials");
            return Err(LoginError::BadCredentials);
        }
        let user = user.expect("checked above");

        let token = uuid::Uuid::new_v4().to_string();
        let expires_at = Instant::now() + self.ttl;
        self.sessions.write().await.insert(token.clone(), Session {
            username: user.username.clone(),
            role: user.role,
            expires_at,
        });
        self.failures.write().await.remove(&creds.username);
        info!(user = %user.username, role = user.role.as_str(), "login: session issued");
        Ok(LoginOk {
            token,
            username: user.username,
            role: user.role,
            expires_at_ms: now_unix_ms() + self.ttl.as_millis() as u64,
            must_change_password: user.must_change_password,
        })
    }

    /// Returns the session info if the token is valid AND not expired.
    /// Slides the TTL on success (rolling refresh).
    pub async fn validate(&self, token: &str) -> Option<SessionInfo> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(token)?;
        if Instant::now() >= session.expires_at {
            sessions.remove(token);
            return None;
        }
        session.expires_at = Instant::now() + self.ttl;
        let username = session.username.clone();
        let role     = session.role;
        drop(sessions);

        let must_change = self.users.read().await
            .get(&username)
            .map(|u| u.must_change_password)
            .unwrap_or(false);
        Some(SessionInfo { username, role, must_change_password: must_change })
    }

    pub async fn logout(&self, token: &str) -> bool {
        self.sessions.write().await.remove(token).is_some()
    }

    /// Slide the TTL for an active session and return the new expiry timestamp
    /// (milliseconds since Unix epoch). Returns `None` when the token is
    /// expired or not found, which signals the caller to return 401.
    pub async fn touch(&self, token: &str) -> Option<u64> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(token)?;
        if Instant::now() >= session.expires_at {
            sessions.remove(token);
            return None;
        }
        session.expires_at = Instant::now() + self.ttl;
        Some(now_unix_ms() + self.ttl.as_millis() as u64)
    }

    pub async fn session_count(&self) -> usize {
        self.sessions.read().await.len()
    }

    // ── User CRUD ─────────────────────────────────────────────────────

    pub async fn list_users(&self) -> Vec<UserSummary> {
        let mut v: Vec<UserSummary> = self.users.read().await.values()
            .map(|u| u.to_summary()).collect();
        v.sort_by(|a, b| a.username.cmp(&b.username));
        v
    }

    pub async fn create_user(&self, p: CreateUser) -> Result<UserSummary, UserError> {
        if p.password.is_empty() {
            return Err(UserError::InvalidPassword);
        }
        let mut users = self.users.write().await;
        if users.contains_key(&p.username) {
            return Err(UserError::AlreadyExists);
        }
        let hash = hash_password(&p.password)
            .map_err(|e| UserError::StorageError(e.to_string()))?;
        let now = now_unix_ms();
        let u = StoredUser {
            username: p.username.clone(),
            password_hash: hash,
            role: p.role,
            must_change_password: p.must_change_password,
            created_at_ms: now,
            updated_at_ms: now,
        };
        users.insert(p.username.clone(), u.clone());
        self.flush_locked(&users).await?;
        info!(user = %p.username, role = p.role.as_str(), "auth: user created");
        Ok(u.to_summary())
    }

    pub async fn update_user(&self, username: &str, patch: UserPatch) -> Result<UserSummary, UserError> {
        let mut users = self.users.write().await;
        let was_admin_count = users.values().filter(|u| u.role == Role::Admin).count();

        let user = users.get_mut(username).ok_or(UserError::NotFound)?;
        if let Some(role) = patch.role {
            // Refuse to demote the last admin.
            if user.role == Role::Admin && role != Role::Admin && was_admin_count <= 1 {
                return Err(UserError::LastAdmin);
            }
            user.role = role;
        }
        if let Some(pwd) = patch.password.as_ref() {
            if pwd.is_empty() {
                return Err(UserError::InvalidPassword);
            }
            user.password_hash = hash_password(pwd)
                .map_err(|e| UserError::StorageError(e.to_string()))?;
            // Admin-driven password reset → force a change on next login,
            // unless the patch explicitly overrides.
            user.must_change_password = patch.must_change_password.unwrap_or(true);
        } else if let Some(flag) = patch.must_change_password {
            user.must_change_password = flag;
        }
        user.updated_at_ms = now_unix_ms();
        let summary = user.to_summary();
        self.flush_locked(&users).await?;
        info!(user = %username, "auth: user updated");
        Ok(summary)
    }

    pub async fn delete_user(&self, username: &str) -> Result<(), UserError> {
        let mut users = self.users.write().await;
        let target = users.get(username).ok_or(UserError::NotFound)?;
        if target.role == Role::Admin {
            let admin_count = users.values().filter(|u| u.role == Role::Admin).count();
            if admin_count <= 1 {
                return Err(UserError::LastAdmin);
            }
        }
        users.remove(username);
        self.flush_locked(&users).await?;

        // Drop any active sessions for the deleted user too.
        let mut sessions = self.sessions.write().await;
        sessions.retain(|_, s| s.username != username);
        info!(user = %username, "auth: user deleted");
        Ok(())
    }

    /// Self-service password change. Requires the OLD password to match.
    /// Clears the `must_change_password` flag on success.
    pub async fn change_password(
        &self,
        username: &str,
        cp: ChangePassword,
    ) -> Result<(), UserError> {
        if cp.new_password.is_empty() {
            return Err(UserError::InvalidPassword);
        }
        let mut users = self.users.write().await;
        let user = users.get_mut(username).ok_or(UserError::NotFound)?;
        if !verify_password(&cp.old_password, &user.password_hash) {
            return Err(UserError::InvalidPassword);
        }
        user.password_hash = hash_password(&cp.new_password)
            .map_err(|e| UserError::StorageError(e.to_string()))?;
        user.must_change_password = false;
        user.updated_at_ms = now_unix_ms();
        self.flush_locked(&users).await?;
        info!(user = %username, "auth: password changed");
        Ok(())
    }

    async fn flush_locked(&self, users: &HashMap<String, StoredUser>) -> Result<(), UserError> {
        let path_guard = self.store_path.read().await;
        let Some(path) = path_guard.as_ref() else { return Ok(()); };
        let file = UserFile { users: users.values().cloned().collect() };
        let yaml = serde_yaml::to_string(&file)
            .map_err(|e| UserError::StorageError(format!("serialise: {e}")))?;
        std::fs::write(path, yaml)
            .map_err(|e| UserError::StorageError(format!("write {}: {e}", path.display())))?;
        Ok(())
    }

    // ── Rate-limit / lockout helpers ─────────────────────────────────

    async fn record_failure(&self, username: &str) {
        let mut map = self.failures.write().await;
        let entry = map.entry(username.to_string()).or_default();
        let now = Instant::now();

        // While already locked: extend lockout on every new attempt.
        if entry.locked_until.map(|t| t > now).unwrap_or(false) {
            entry.locked_until = Some(now + self.rate_window);
            return;
        }
        // Clear a stale (expired) lockout before accumulating.
        if entry.locked_until.is_some() {
            *entry = LoginFailures::default();
        }

        // Accumulate within the sliding window.
        match entry.window_start {
            Some(t) if now.duration_since(t) <= self.rate_window => entry.count += 1,
            _ => { entry.window_start = Some(now); entry.count = 1; }
        }

        // Trigger lockout when the failure budget is exhausted.
        if entry.count >= self.rate_limit {
            entry.locked_until = Some(now + self.rate_window);
            entry.count = 0;
            entry.window_start = None;
        }
    }

    /// Returns `Some(remaining_secs)` when the account is currently locked,
    /// `None` when a login attempt is permitted.
    async fn check_lockout(&self, username: &str) -> Option<u64> {
        let map = self.failures.read().await;
        let locked_until = map.get(username)?.locked_until?;
        let now = Instant::now();
        if locked_until > now {
            Some(locked_until.duration_since(now).as_secs().max(1))
        } else {
            None
        }
    }
}

/// What `validate` reports back to a request handler.
#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub username: String,
    pub role: Role,
    pub must_change_password: bool,
}

fn now_unix_ms() -> u64 {
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
        let ok = auth.login(&Credentials { username: "admin".into(), password: "s3cret".into() }).await.unwrap();
        assert_eq!(ok.username, "admin");
        assert_eq!(ok.role, Role::Admin);
        assert!(!ok.must_change_password);

        let info = auth.validate(&ok.token).await.unwrap();
        assert_eq!(info.username, "admin");
        assert_eq!(info.role, Role::Admin);

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
        assert!(matches!(
            auth.login(&Credentials { username: "admin".into(), password: "x".into() }).await,
            Err(LoginError::RateLimited { .. })
        ));
    }

    #[tokio::test]
    async fn role_ordering() {
        assert!(Role::Admin > Role::Supervisor);
        assert!(Role::Supervisor > Role::Operator);
        assert!(Role::Operator > Role::Viewer);
    }

    #[tokio::test]
    async fn create_update_delete_user() {
        let auth = admin_only("admin");

        let s = auth.create_user(CreateUser {
            username: "alice".into(), password: "p4ss".into(),
            role: Role::Operator, must_change_password: true,
        }).await.unwrap();
        assert_eq!(s.username, "alice");
        assert!(s.must_change_password);

        // Duplicate refused
        assert!(matches!(
            auth.create_user(CreateUser {
                username: "alice".into(), password: "x".into(),
                role: Role::Operator, must_change_password: true,
            }).await,
            Err(UserError::AlreadyExists)
        ));

        // Update role
        let s = auth.update_user("alice", UserPatch {
            role: Some(Role::Supervisor), password: None, must_change_password: None,
        }).await.unwrap();
        assert_eq!(s.role, Role::Supervisor);

        // Delete
        auth.delete_user("alice").await.unwrap();
        assert!(auth.list_users().await.iter().all(|u| u.username != "alice"));
    }

    #[tokio::test]
    async fn cant_delete_last_admin() {
        let auth = admin_only("admin");
        assert!(matches!(
            auth.delete_user("admin").await,
            Err(UserError::LastAdmin)
        ));
    }

    #[tokio::test]
    async fn cant_demote_last_admin() {
        let auth = admin_only("admin");
        assert!(matches!(
            auth.update_user("admin", UserPatch {
                role: Some(Role::Viewer), password: None, must_change_password: None,
            }).await,
            Err(UserError::LastAdmin)
        ));
    }

    #[tokio::test]
    async fn change_password_clears_flag() {
        let auth = admin_only("admin");
        auth.create_user(CreateUser {
            username: "bob".into(), password: "init".into(),
            role: Role::Viewer, must_change_password: true,
        }).await.unwrap();

        // Wrong old password is refused
        assert!(matches!(
            auth.change_password("bob", ChangePassword {
                old_password: "nope".into(), new_password: "new".into(),
            }).await,
            Err(UserError::InvalidPassword)
        ));

        auth.change_password("bob", ChangePassword {
            old_password: "init".into(), new_password: "new".into(),
        }).await.unwrap();

        let ok = auth.login(&Credentials {
            username: "bob".into(), password: "new".into(),
        }).await.unwrap();
        assert!(!ok.must_change_password);
    }
}
