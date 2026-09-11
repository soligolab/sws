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

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
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

/// Legge `users.yaml` dal disco: assente o vuoto vale «nessun utente», non un
/// errore. Estratta perché la stessa lettura viveva in due punti (avvio e
/// cambio di store al cambio progetto) e una correzione andava fatta due volte.
fn carica_users_file(path: &std::path::Path) -> anyhow::Result<UserFile> {
    if !path.exists() {
        return Ok(UserFile::default());
    }
    let text =
        std::fs::read_to_string(path).map_err(|e| anyhow::anyhow!("read users.yaml: {e}"))?;
    if text.trim().is_empty() {
        return Ok(UserFile::default());
    }
    serde_yaml::from_str::<UserFile>(&text).map_err(|e| anyhow::anyhow!("parse users.yaml: {e}"))
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Viewer => "Viewer",
            Role::Operator => "Operator",
            Role::Supervisor => "Supervisor",
            Role::Admin => "Admin",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LoginOk {
    pub token: String,
    pub username: String,
    pub role: Role,
    /// Unix timestamp (ms) at which the session expires unless refreshed.
    /// `null` means the session never expires (per-user override).
    pub expires_at_ms: Option<u64>,
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
    /// Per-user session TTL override.
    /// `None` = use the global system default.
    /// `Some(0)` = session never expires.
    /// `Some(n)` = session TTL is n seconds (sliding window).
    pub session_ttl_secs: Option<u64>,
    /// Zones this user can access. Empty = all zones.
    pub allowed_zones: Vec<String>,
}

/// Patch shape for `PUT /api/auth/users/:username`. Every field is optional;
/// a missing field means "leave unchanged". `password` resets the hash and
/// (implicitly) sets `must_change_password=true` so the operator knows the
/// next login requires a new password.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
pub struct UserPatch {
    pub role: Option<Role>,
    pub password: Option<String>,
    pub must_change_password: Option<bool>,
    /// Replace the user's allowed_zones list. None = leave unchanged.
    pub allowed_zones: Option<Vec<String>>,
    /// Set the per-user session TTL override.
    /// Absent = leave unchanged.
    /// `null` = reset to global default.
    /// `0` = never expires.
    /// `n` = n seconds.
    #[serde(default)]
    pub session_ttl_secs: Option<Option<u64>>,
}

/// Payload for `POST /api/auth/users`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
pub struct CreateUser {
    pub username: String,
    pub password: String,
    pub role: Role,
    #[serde(default = "yes")]
    pub must_change_password: bool,
    #[serde(default)]
    pub allowed_zones: Vec<String>,
}
fn yes() -> bool {
    true
}

/// Payload for `POST /api/auth/change-password`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)] // Q9: payload solo-API, campi ignoti = 400
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
    /// Per-user session TTL override persisted in users.yaml.
    /// None = use system default; Some(0) = never expires; Some(n) = n seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session_ttl_secs: Option<u64>,
    /// Zones this user is allowed to access. Empty = all zones (backwards compatible).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    allowed_zones: Vec<String>,
}

impl StoredUser {
    fn to_summary(&self) -> UserSummary {
        UserSummary {
            username: self.username.clone(),
            role: self.role,
            must_change_password: self.must_change_password,
            created_at_ms: self.created_at_ms,
            updated_at_ms: self.updated_at_ms,
            session_ttl_secs: self.session_ttl_secs,
            allowed_zones: self.allowed_zones.clone(),
        }
    }

    /// Compute the effective session Duration for a new login.
    /// Returns `None` when the session should never expire.
    fn effective_ttl(&self, global: Duration) -> Option<Duration> {
        match self.session_ttl_secs {
            None => Some(global), // use system default
            Some(0) => None,      // never expires
            Some(secs) => Some(Duration::from_secs(secs)),
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
    /// None = never expires; Some(t) = hard expiry at t.
    expires_at: Option<Instant>,
    /// None = infinite; Some(d) = sliding window duration.
    effective_ttl: Option<Duration>,
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
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
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
    rate_limit: u32,
    rate_window: Duration,
}

#[derive(Debug, Clone)]
pub enum LoginError {
    BadCredentials,
    /// Account temporarily locked. `retry_after_secs` is the remaining lockout.
    RateLimited {
        retry_after_secs: u64,
    },
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
            UserError::NotFound => write!(f, "user not found"),
            UserError::AlreadyExists => write!(f, "user already exists"),
            UserError::LastAdmin => write!(f, "cannot remove the last admin"),
            UserError::InvalidPassword => write!(f, "current password is wrong"),
            UserError::StorageError(s) => write!(f, "storage error: {s}"),
        }
    }
}

/// Applica il seed da variabili d'ambiente come **recupero**, non come aggiunta.
///
/// Fino all'11-09-2026 il seed entrava a ogni avvio e a ogni apertura di
/// progetto, per ogni account il cui nome mancasse. Due conseguenze, entrambe
/// contro la regola «gli utenti appartengono al progetto»: un progetto da cui
/// `admin` era stato tolto apposta se lo vedeva tornare, e un deploy che porta
/// gli utenti del progetto veniva silenziosamente contraddetto dall'ambiente
/// del dispositivo — che su un'installazione nativa è `admin`/`admin`
/// (`deploy/yocto/install.sh`).
///
/// Ora entra **solo se il risultato sarebbe zero utenti**, cioè quando è l'unica
/// cosa che tiene il pannello raggiungibile. Senza seed, zero utenti significa
/// no-auth: tutto aperto.
///
/// Ritorna `true` se ha aggiunto qualcosa — solo allora il file va riscritto.
fn applica_seed_di_recupero(
    users: &mut HashMap<String, StoredUser>,
    seed: Vec<(String, Role, String)>,
) -> anyhow::Result<bool> {
    if !users.is_empty() {
        return Ok(false);
    }
    let now = now_unix_ms();
    let mut aggiunti = false;
    for (name, role, pwd) in seed.into_iter().filter(|(_, _, p)| !p.is_empty()) {
        let hash = hash_password(&pwd)?;
        warn!(
            user = %name, role = role.as_str(),
            "auth: nessun utente nel progetto — account di recupero creato dalle variabili d'ambiente"
        );
        users.insert(
            name.clone(),
            StoredUser {
                username: name,
                password_hash: hash,
                role,
                must_change_password: false,
                created_at_ms: now,
                updated_at_ms: now,
                session_ttl_secs: None,
                allowed_zones: vec![],
            },
        );
        aggiunti = true;
    }
    Ok(aggiunti)
}

/// Scrive `users.yaml`, creando la cartella se manca.
fn scrivi_users_file(
    store_path: &std::path::Path,
    users: &HashMap<String, StoredUser>,
) -> anyhow::Result<()> {
    if let Some(parent) = store_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let to_write = UserFile {
        users: users.values().cloned().collect(),
    };
    let yaml = serde_yaml::to_string(&to_write)
        .map_err(|e| anyhow::anyhow!("serialise users.yaml: {e}"))?;
    std::fs::write(store_path, yaml).map_err(|e| anyhow::anyhow!("write users.yaml: {e}"))
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
        let on_disk = carica_users_file(&store_path)?;

        let mut users: HashMap<String, StoredUser> = on_disk
            .users
            .into_iter()
            .map(|u| (u.username.clone(), u))
            .collect();

        let seminati = applica_seed_di_recupero(&mut users, seed)?;

        if users.is_empty() {
            info!("no users defined — starting in no-auth mode (all routes open)");
        } else if seminati {
            // Si scrive SOLO se il seed ha aggiunto qualcosa. Prima si riscriveva
            // a ogni avvio anche senza cambiamenti: `users` è una HashMap, quindi
            // l'ordine degli account nel file cambiava da solo a ogni giro.
            scrivi_users_file(&store_path, &users)?;
        }

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
        let usable: Vec<_> = accounts
            .into_iter()
            .filter(|(_, _, p)| !p.is_empty())
            .collect();
        if usable.is_empty() {
            anyhow::bail!("at least one account password is required (set SWS_ADMIN_PASSWORD)");
        }
        let now = now_unix_ms();
        let mut users: HashMap<String, StoredUser> = HashMap::new();
        for (user, role, pwd) in usable {
            let hash = hash_password(&pwd)?;
            users.insert(
                user.clone(),
                StoredUser {
                    username: user,
                    password_hash: hash,
                    role,
                    must_change_password: false,
                    created_at_ms: now,
                    updated_at_ms: now,
                    session_ttl_secs: None,
                    allowed_zones: vec![],
                },
            );
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
        let on_disk = carica_users_file(&new_path)?;

        let mut new_users: HashMap<String, StoredUser> = on_disk
            .users
            .into_iter()
            .map(|u| (u.username.clone(), u))
            .collect();
        let seminati = applica_seed_di_recupero(&mut new_users, seed)?;
        if new_users.is_empty() {
            info!("no users defined — starting in no-auth mode (all routes open)");
        } else if seminati {
            // Come in `new_persistent`: si scrive solo se il seed ha aggiunto
            // qualcosa. Un progetto appena arrivato col deploy non si vede
            // riscrivere `users.yaml` (e riordinare) alla prima apertura.
            scrivi_users_file(&new_path, &new_users)?;
        }

        *self.users.write().await = new_users;
        self.sessions.write().await.clear();
        self.failures.write().await.clear();
        *self.store_path.write().await = Some(new_path);
        Ok(())
    }

    /// True when at least one user is defined. When false, `require_auth`
    /// passes all requests through (no-auth / open mode).
    pub async fn has_users(&self) -> bool {
        !self.users.read().await.is_empty()
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
            None => false,
        };

        if !ok {
            self.record_failure(&creds.username).await;
            warn!(user = %creds.username, "login: bad credentials");
            return Err(LoginError::BadCredentials);
        }
        let user = user.expect("checked above");

        let effective_ttl = user.effective_ttl(self.ttl);
        let token = uuid::Uuid::new_v4().to_string();
        let expires_at = effective_ttl.map(|d| Instant::now() + d);
        let expires_at_ms = effective_ttl.map(|d| now_unix_ms() + d.as_millis() as u64);
        self.sessions.write().await.insert(
            token.clone(),
            Session {
                username: user.username.clone(),
                role: user.role,
                expires_at,
                effective_ttl,
            },
        );
        self.failures.write().await.remove(&creds.username);
        info!(user = %user.username, role = user.role.as_str(), "login: session issued");
        Ok(LoginOk {
            token,
            username: user.username,
            role: user.role,
            expires_at_ms,
            must_change_password: user.must_change_password,
        })
    }

    /// Re-verifica la password dell'utente SENZA emettere una sessione nuova
    /// (F3.3, comandi critici: "sei ancora tu?"). Condivide il lockout del
    /// login: anche qui i tentativi falliti contano e bloccano.
    pub async fn verify_user_password(&self, username: &str, password: &str) -> bool {
        if self.check_lockout(username).await.is_some() {
            return false;
        }
        let ok = match self.users.read().await.get(username) {
            Some(u) => verify_password(password, &u.password_hash),
            None => false,
        };
        if ok {
            self.failures.write().await.remove(username);
        } else {
            self.record_failure(username).await;
        }
        ok
    }

    /// Returns the session info if the token is valid AND not expired.
    /// Slides the TTL on success (rolling refresh).
    pub async fn validate(&self, token: &str) -> Option<SessionInfo> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(token)?;
        // Check expiry (None = never expires)
        if let Some(exp) = session.expires_at {
            if Instant::now() >= exp {
                sessions.remove(token);
                return None;
            }
            // Slide the window
            if let Some(ttl) = session.effective_ttl {
                session.expires_at = Some(Instant::now() + ttl);
            }
        }
        let username = session.username.clone();
        let role = session.role;
        drop(sessions);

        let (must_change, allowed_zones) = {
            let users = self.users.read().await;
            let u = users.get(&username);
            (
                u.map(|u| u.must_change_password).unwrap_or(false),
                u.map(|u| u.allowed_zones.clone()).unwrap_or_default(),
            )
        };
        Some(SessionInfo {
            username,
            role,
            must_change_password: must_change,
            allowed_zones,
        })
    }

    pub async fn logout(&self, token: &str) -> bool {
        self.sessions.write().await.remove(token).is_some()
    }

    /// Slide the TTL for an active session and return the new expiry timestamp
    /// (milliseconds since Unix epoch).
    /// Returns `None` when the token is expired or not found (→ 401).
    /// Returns `Some(None)` when the session never expires.
    /// Returns `Some(Some(ms))` with the new expiry timestamp otherwise.
    pub async fn touch(&self, token: &str) -> Option<Option<u64>> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(token)?;
        if let Some(exp) = session.expires_at {
            if Instant::now() >= exp {
                sessions.remove(token);
                return None;
            }
            if let Some(ttl) = session.effective_ttl {
                session.expires_at = Some(Instant::now() + ttl);
                return Some(Some(now_unix_ms() + ttl.as_millis() as u64));
            }
        }
        // Never-expires session: token is valid, no expiry to report
        Some(None)
    }

    pub async fn session_count(&self) -> usize {
        self.sessions.read().await.len()
    }

    // ── User CRUD ─────────────────────────────────────────────────────

    pub async fn list_users(&self) -> Vec<UserSummary> {
        let mut v: Vec<UserSummary> = self
            .users
            .read()
            .await
            .values()
            .map(|u| u.to_summary())
            .collect();
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
        let hash =
            hash_password(&p.password).map_err(|e| UserError::StorageError(e.to_string()))?;
        let now = now_unix_ms();
        let u = StoredUser {
            username: p.username.clone(),
            password_hash: hash,
            role: p.role,
            must_change_password: p.must_change_password,
            created_at_ms: now,
            updated_at_ms: now,
            session_ttl_secs: None,
            allowed_zones: p.allowed_zones,
        };
        users.insert(p.username.clone(), u.clone());
        self.flush_locked(&users).await?;
        info!(user = %p.username, role = p.role.as_str(), "auth: user created");
        Ok(u.to_summary())
    }

    pub async fn update_user(
        &self,
        username: &str,
        patch: UserPatch,
    ) -> Result<UserSummary, UserError> {
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
            user.password_hash =
                hash_password(pwd).map_err(|e| UserError::StorageError(e.to_string()))?;
            // Admin-driven password reset → force a change on next login,
            // unless the patch explicitly overrides.
            user.must_change_password = patch.must_change_password.unwrap_or(true);
        } else if let Some(flag) = patch.must_change_password {
            user.must_change_password = flag;
        }
        // session_ttl_secs: outer None = unchanged; outer Some(inner) = set (None resets to global)
        if let Some(ttl_override) = patch.session_ttl_secs {
            user.session_ttl_secs = ttl_override;
        }
        if let Some(zones) = patch.allowed_zones {
            user.allowed_zones = zones;
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
        user.password_hash =
            hash_password(&cp.new_password).map_err(|e| UserError::StorageError(e.to_string()))?;
        user.must_change_password = false;
        user.updated_at_ms = now_unix_ms();
        self.flush_locked(&users).await?;
        info!(user = %username, "auth: password changed");
        Ok(())
    }

    async fn flush_locked(&self, users: &HashMap<String, StoredUser>) -> Result<(), UserError> {
        let path_guard = self.store_path.read().await;
        let Some(path) = path_guard.as_ref() else {
            return Ok(());
        };
        let file = UserFile {
            users: users.values().cloned().collect(),
        };
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
            _ => {
                entry.window_start = Some(now);
                entry.count = 1;
            }
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
    pub allowed_zones: Vec<String>,
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Seed da variabili d'ambiente: di solo recupero (2026-09-11) ──────────
    //
    // «Gli utenti appartengono al progetto»: l'ambiente del dispositivo non
    // aggiunge più account a un progetto che ne ha già. Entra solo quando
    // altrimenti non resterebbe nessuno, cioè quando è l'unica cosa che tiene
    // il pannello raggiungibile.

    fn seed_admin() -> Vec<(String, Role, String)> {
        vec![("admin".into(), Role::Admin, "segreta".into())]
    }

    /// Scrive un `users.yaml` con un solo account, con un hash vero.
    fn users_yaml_con(dir: &std::path::Path, username: &str) -> PathBuf {
        let p = dir.join("users.yaml");
        let u = StoredUser {
            username: username.into(),
            password_hash: hash_password("x").unwrap(),
            role: Role::Operator,
            must_change_password: false,
            created_at_ms: 1,
            updated_at_ms: 1,
            session_ttl_secs: None,
            allowed_zones: vec![],
        };
        let f = UserFile { users: vec![u] };
        std::fs::write(&p, serde_yaml::to_string(&f).unwrap()).unwrap();
        p
    }

    fn stato(path: PathBuf, seed: Vec<(String, Role, String)>) -> Arc<AuthState> {
        AuthState::new_persistent(
            path,
            seed,
            Duration::from_secs(60),
            5,
            Duration::from_secs(60),
        )
        .unwrap()
    }

    /// Il progetto ha i suoi utenti: l'ambiente non ne aggiunge. Prima di oggi
    /// qui ce ne sarebbero stati due.
    #[tokio::test]
    async fn il_seed_non_entra_se_il_file_ha_utenti() {
        let d = tempfile::tempdir().unwrap();
        let p = users_yaml_con(d.path(), "operatore");
        let a = stato(p, seed_admin());
        let nomi: Vec<String> = a.users.read().await.keys().cloned().collect();
        assert_eq!(
            nomi,
            vec!["operatore".to_string()],
            "l'admin da env non deve entrare"
        );
    }

    /// Nessun utente da nessuna parte: il seed è la rete di sicurezza e scatta.
    #[tokio::test]
    async fn il_seed_entra_se_non_resterebbe_nessuno() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("users.yaml");
        let a = stato(p.clone(), seed_admin());
        assert!(a.has_users().await);
        assert!(a.users.read().await.contains_key("admin"));
        // E viene scritto su disco, così il riavvio lo ritrova.
        assert!(p.exists());
    }

    /// Senza seed e senza file si resta in no-auth: è lo stato di un pannello
    /// appena installato, e deve restare riconoscibile.
    #[tokio::test]
    async fn senza_seed_e_senza_file_si_resta_in_no_auth() {
        let d = tempfile::tempdir().unwrap();
        let a = stato(
            d.path().join("users.yaml"),
            vec![("admin".into(), Role::Admin, String::new())],
        );
        assert!(!a.has_users().await);
    }

    /// Cambiare progetto non reintroduce l'admin che il progetto nuovo non ha:
    /// è il caso che si presenta a ogni deploy, perché `open_project` chiama
    /// `swap_store` col seed letto dall'ambiente del dispositivo.
    #[tokio::test]
    async fn swap_store_non_reintroduce_l_admin_tolto_dal_progetto() {
        let d = tempfile::tempdir().unwrap();
        let a_dir = d.path().join("a");
        let b_dir = d.path().join("b");
        std::fs::create_dir_all(&a_dir).unwrap();
        std::fs::create_dir_all(&b_dir).unwrap();
        let pa = users_yaml_con(&a_dir, "admin");
        let pb = users_yaml_con(&b_dir, "operatore");
        let a = stato(pa, seed_admin());
        a.swap_store(pb, seed_admin()).await.unwrap();
        let nomi: Vec<String> = a.users.read().await.keys().cloned().collect();
        assert_eq!(nomi, vec!["operatore".to_string()]);
    }

    /// Senza il seed non c'è niente da scrivere, e il file non si tocca. Prima
    /// veniva riscritto a ogni apertura: `users` è una HashMap, quindi l'ordine
    /// degli account cambiava da solo e il file "risultava modificato" senza
    /// che nessuno l'avesse modificato.
    #[tokio::test]
    async fn il_file_non_viene_riscritto_se_non_cambia_nulla() {
        let d = tempfile::tempdir().unwrap();
        let p = users_yaml_con(d.path(), "operatore");
        let prima = std::fs::read(&p).unwrap();
        let _ = stato(p.clone(), seed_admin());
        assert_eq!(
            prima,
            std::fs::read(&p).unwrap(),
            "users.yaml riscritto senza motivo"
        );
    }

    fn admin_only(pwd: &str) -> Arc<AuthState> {
        AuthState::new(
            vec![("admin".into(), Role::Admin, pwd.into())],
            Duration::from_secs(60),
            5,
            Duration::from_secs(60),
        )
        .unwrap()
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
        assert!(matches!(
            auth.login(&Credentials {
                username: "admin".into(),
                password: "nope".into()
            })
            .await,
            Err(LoginError::BadCredentials)
        ));
        let ok = auth
            .login(&Credentials {
                username: "admin".into(),
                password: "s3cret".into(),
            })
            .await
            .unwrap();
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
            10,
            Duration::from_secs(60),
        )
        .unwrap();
        let ok = auth
            .login(&Credentials {
                username: "admin".into(),
                password: "x".into(),
            })
            .await
            .unwrap();
        assert!(auth.validate(&ok.token).await.is_some());
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert!(
            auth.validate(&ok.token).await.is_none(),
            "session should have expired"
        );
    }

    #[tokio::test]
    async fn login_rate_limit() {
        let auth = AuthState::new(
            vec![("admin".into(), Role::Admin, "x".into())],
            Duration::from_secs(60),
            3,
            Duration::from_secs(60),
        )
        .unwrap();
        for _ in 0..3 {
            assert!(matches!(
                auth.login(&Credentials {
                    username: "admin".into(),
                    password: "bad".into()
                })
                .await,
                Err(LoginError::BadCredentials)
            ));
        }
        assert!(matches!(
            auth.login(&Credentials {
                username: "admin".into(),
                password: "x".into()
            })
            .await,
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

        let s = auth
            .create_user(CreateUser {
                username: "alice".into(),
                password: "p4ss".into(),
                role: Role::Operator,
                must_change_password: true,
                allowed_zones: vec![],
            })
            .await
            .unwrap();
        assert_eq!(s.username, "alice");
        assert!(s.must_change_password);

        // Duplicate refused
        assert!(matches!(
            auth.create_user(CreateUser {
                username: "alice".into(),
                password: "x".into(),
                role: Role::Operator,
                must_change_password: true,
                allowed_zones: vec![],
            })
            .await,
            Err(UserError::AlreadyExists)
        ));

        // Update role
        let s = auth
            .update_user(
                "alice",
                UserPatch {
                    role: Some(Role::Supervisor),
                    password: None,
                    must_change_password: None,
                    session_ttl_secs: None,
                    allowed_zones: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(s.role, Role::Supervisor);

        // Delete
        auth.delete_user("alice").await.unwrap();
        assert!(auth
            .list_users()
            .await
            .iter()
            .all(|u| u.username != "alice"));
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
            auth.update_user(
                "admin",
                UserPatch {
                    role: Some(Role::Viewer),
                    password: None,
                    must_change_password: None,
                    session_ttl_secs: None,
                    allowed_zones: None,
                }
            )
            .await,
            Err(UserError::LastAdmin)
        ));
    }

    #[tokio::test]
    async fn change_password_clears_flag() {
        let auth = admin_only("admin");
        auth.create_user(CreateUser {
            username: "bob".into(),
            password: "init".into(),
            role: Role::Viewer,
            must_change_password: true,
            allowed_zones: vec![],
        })
        .await
        .unwrap();

        // Wrong old password is refused
        assert!(matches!(
            auth.change_password(
                "bob",
                ChangePassword {
                    old_password: "nope".into(),
                    new_password: "new".into(),
                }
            )
            .await,
            Err(UserError::InvalidPassword)
        ));

        auth.change_password(
            "bob",
            ChangePassword {
                old_password: "init".into(),
                new_password: "new".into(),
            },
        )
        .await
        .unwrap();

        let ok = auth
            .login(&Credentials {
                username: "bob".into(),
                password: "new".into(),
            })
            .await
            .unwrap();
        assert!(!ok.must_change_password);
    }
}
