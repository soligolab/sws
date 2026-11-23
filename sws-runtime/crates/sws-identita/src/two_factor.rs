//! Two-factor authentication of the accounts (plan `docs/plans/2026-11-21-p6-2fa-e-ldap.md`).
//!
//! Decisions of the maintainer (21-11-2026): for the **accounts of the IDE and
//! the cloud** (this database), not for the users of a project; **optional,
//! and imposable** by whoever administers a company (for its members) or the
//! platform (for everyone).
//!
//! - **TOTP** (RFC 6238): HMAC-SHA1, 30-second steps, six digits, one step of
//!   tolerance either side — what every authenticator app speaks. HMAC from
//!   `ring`, base32 written here: no new crate.
//! - The **secret** is encrypted at rest like the AI keys (`ai_keys.rs`, the
//!   master key file next to the database). After a restore without that file
//!   it doesn't decrypt: the recovery codes still let the person in, and an
//!   administrator can reset it.
//! - **Ten recovery codes**, shown once, kept as fingerprints; each works once.
//! - A code already used is refused (the last step accepted is kept): a code
//!   read over someone's shoulder can't be used again in the same half minute.
//! - **The challenge.** A right password (or e-mail PIN) with the second factor
//!   on gives no session: it gives a challenge, valid five minutes, that the
//!   code turns into one. The same when 2FA is required and not set up yet:
//!   the challenge then lets the person set it up, and only that.
//!   Wrong codes count with the wrong passwords, per e-mail.

use super::*;
use argon2::password_hash::rand_core::RngCore;
use ring::hmac;

const STEP_SECS: u64 = 30;
const DIGITS: u32 = 6;
/// Steps accepted either side of now: a phone half a minute off still works.
const WINDOW: i64 = 1;
const SECRET_LEN: usize = 20;
pub const RECOVERY_CODES: usize = 10;
/// How long a challenge lasts.
pub const CHALLENGE_TTL: Duration = Duration::from_secs(300);
/// The issuer shown by the authenticator app.
const ISSUER: &str = "SWS";

/// Two-factor tables and columns (schema 9).
pub(crate) const TABLES_V9: &str = r#"
CREATE TABLE IF NOT EXISTS recovery_codes (
    user_id     INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
    fingerprint TEXT    NOT NULL,
    used_ms     INTEGER,
    PRIMARY KEY (user_id, fingerprint)
);
CREATE TABLE IF NOT EXISTS platform_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

pub(crate) const COLUMNS_V9: &[(&str, &str)] = &[
    ("utenti", "ALTER TABLE utenti ADD COLUMN totp_nonce BLOB"),
    (
        "utenti",
        "ALTER TABLE utenti ADD COLUMN totp_last_step INTEGER",
    ),
    (
        "aziende",
        "ALTER TABLE aziende ADD COLUMN require_2fa INTEGER NOT NULL DEFAULT 0",
    ),
];

// ── base32 and TOTP ────────────────────────────────────────────────────────

const B32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// RFC 4648 base32, without padding: what an authenticator app wants.
pub fn base32_encode(bytes: &[u8]) -> String {
    let mut out = String::new();
    let (mut buf, mut bits) = (0u32, 0u32);
    for &b in bytes {
        buf = (buf << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            out.push(B32[((buf >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(B32[((buf << (5 - bits)) & 31) as usize] as char);
    }
    out
}

/// The inverse; spaces, dashes and padding ignored, case too.
pub fn base32_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let (mut buf, mut bits) = (0u32, 0u32);
    for c in s.chars().filter(|c| !matches!(c, ' ' | '-' | '=')) {
        let v = B32
            .iter()
            .position(|&x| x as char == c.to_ascii_uppercase())? as u32;
        buf = (buf << 5) | v;
        bits += 5;
        if bits >= 8 {
            out.push((buf >> (bits - 8)) as u8);
            bits -= 8;
        }
    }
    Some(out)
}

/// The code of `step` (RFC 4226 on the step counter).
pub fn totp_code(secret: &[u8], step: u64) -> u32 {
    let key = hmac::Key::new(hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY, secret);
    let tag = hmac::sign(&key, &step.to_be_bytes());
    let h = tag.as_ref();
    let off = (h[h.len() - 1] & 0x0f) as usize;
    let bin = u32::from_be_bytes([h[off] & 0x7f, h[off + 1], h[off + 2], h[off + 3]]);
    bin % 10u32.pow(DIGITS)
}

/// The step `code` matches around `now_ms`, if it is after `last_step`.
pub fn totp_match(secret: &[u8], code: &str, now_ms: u64, last_step: Option<i64>) -> Option<i64> {
    let code = code.trim().replace(' ', "");
    if code.len() != DIGITS as usize || !code.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let want: u32 = code.parse().ok()?;
    let now = (now_ms / 1000 / STEP_SECS) as i64;
    (now - WINDOW..=now + WINDOW)
        .filter(|s| *s >= 0 && last_step.is_none_or(|l| *s > l))
        .find(|s| totp_code(secret, *s as u64) == want)
}

/// The `otpauth://` address the QR code carries.
pub fn otpauth_uri(email: &str, secret_b32: &str) -> String {
    let enc = |s: &str| -> String {
        s.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                    (b as char).to_string()
                }
                _ => format!("%{b:02X}"),
            })
            .collect()
    };
    format!(
        "otpauth://totp/{}:{}?secret={secret_b32}&issuer={}&algorithm=SHA1&digits={DIGITS}&period={STEP_SECS}",
        enc(ISSUER),
        enc(email),
        enc(ISSUER)
    )
}

/// A recovery code: eight Crockford symbols in two groups, `ABCD-EFGH`.
fn new_recovery_code() -> String {
    const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let mut b = [0u8; 8];
    OsRng.fill_bytes(&mut b);
    let s: String = b
        .iter()
        .map(|x| CROCKFORD[(*x & 31) as usize] as char)
        .collect();
    format!("{}-{}", &s[..4], &s[4..])
}

/// A recovery code as kept: its fingerprint, written as typed or not.
fn recovery_fingerprint(code: &str) -> String {
    let norm: String = code
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        })
        .collect();
    impronta(&format!("recovery:{norm}"))
}

fn aad(user_id: i64) -> Vec<u8> {
    format!("totp:{user_id}").into_bytes()
}

// ── the challenge ──────────────────────────────────────────────────────────

/// What a challenge is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChallengeKind {
    /// The code of the app, or a recovery code.
    Code,
    /// 2FA is required and not set up yet: set it up, then in.
    Setup,
}

#[derive(Debug, Clone)]
pub(crate) struct Challenge {
    user_id: i64,
    email: String,
    lasts: Option<Duration>,
    kind: ChallengeKind,
    born: Instant,
}

/// The state of 2FA for one account.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TwoFactorStatus {
    pub enabled: bool,
    /// Recovery codes not used yet.
    pub recovery_left: usize,
    /// A company of theirs, or the platform, requires it.
    pub required: bool,
}

/// A secret to put in the app: what the QR code shows, and the same as text.
#[derive(Debug, Clone, Serialize)]
pub struct TwoFactorSetup {
    pub secret: String,
    pub uri: String,
}

impl Identita {
    /// After a right password or PIN: the session, or the challenge the
    /// second factor answers. **Every way in passes here.**
    pub(crate) async fn complete_login(
        &self,
        user_id: i64,
        email: &str,
        lasts: Option<Duration>,
    ) -> Result<Accesso, Rifiuto> {
        let status = self
            .two_factor_status(user_id)
            .await
            .map_err(|_| Rifiuto::CredenzialiErrate)?;
        let kind = if status.enabled {
            ChallengeKind::Code
        } else if status.required {
            ChallengeKind::Setup
        } else {
            return self
                .emetti_accesso(user_id, lasts)
                .await
                .map_err(|_| Rifiuto::CredenzialiErrate);
        };
        let token = uuid::Uuid::new_v4().to_string();
        let mut map = self.sfide.lock().unwrap();
        map.retain(|_, c| c.born.elapsed() < CHALLENGE_TTL);
        map.insert(
            token.clone(),
            Challenge {
                user_id,
                email: email.trim().to_lowercase(),
                lasts,
                kind,
                born: Instant::now(),
            },
        );
        Err(Rifiuto::SecondFactor {
            challenge: token,
            kind,
        })
    }

    fn challenge(&self, token: &str, kind: ChallengeKind) -> Result<Challenge, Rifiuto> {
        let map = self.sfide.lock().unwrap();
        match map.get(token) {
            Some(c) if c.kind == kind && c.born.elapsed() < CHALLENGE_TTL => {
                if let Some(wait) = self.blocco_residuo(&c.email) {
                    return Err(Rifiuto::Bloccato { riprova_fra: wait });
                }
                Ok(c.clone())
            }
            _ => Err(Rifiuto::CredenzialiErrate),
        }
    }

    /// The code (or a recovery code) for a challenge: the session. The second
    /// value says a recovery code was used.
    pub async fn second_factor(&self, token: &str, code: &str) -> Result<(Accesso, bool), Rifiuto> {
        let c = self.challenge(token, ChallengeKind::Code)?;
        match self.check_second_factor(c.user_id, code).await {
            Some(recovery) => {
                self.sfide.lock().unwrap().remove(token);
                self.fallimenti.lock().unwrap().remove(&c.email);
                let a = self
                    .emetti_accesso(c.user_id, c.lasts)
                    .await
                    .map_err(|_| Rifiuto::CredenzialiErrate)?;
                Ok((a, recovery))
            }
            None => {
                self.segna_fallimento(&c.email);
                Err(Rifiuto::CredenzialiErrate)
            }
        }
    }

    /// 2FA required and not set up: the secret for the app, from the challenge.
    pub async fn second_factor_setup(&self, token: &str) -> Result<TwoFactorSetup, Rifiuto> {
        let c = self.challenge(token, ChallengeKind::Setup)?;
        self.two_factor_start(c.user_id)
            .await
            .map_err(|_| Rifiuto::CredenzialiErrate)
    }

    /// … and its first code: 2FA on, the recovery codes, the session.
    pub async fn second_factor_setup_confirm(
        &self,
        token: &str,
        code: &str,
    ) -> Result<(Accesso, Vec<String>), Rifiuto> {
        let c = self.challenge(token, ChallengeKind::Setup)?;
        match self.two_factor_confirm(c.user_id, code).await {
            Ok(codes) => {
                self.sfide.lock().unwrap().remove(token);
                let a = self
                    .emetti_accesso(c.user_id, c.lasts)
                    .await
                    .map_err(|_| Rifiuto::CredenzialiErrate)?;
                Ok((a, codes))
            }
            Err(_) => {
                self.segna_fallimento(&c.email);
                Err(Rifiuto::CredenzialiErrate)
            }
        }
    }

    // ── the account's own 2FA ─────────────────────────────────────────────────

    pub async fn two_factor_status(&self, user_id: i64) -> anyhow::Result<TwoFactorStatus> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<TwoFactorStatus> {
            let c = conn.lock().unwrap();
            let enabled: bool = c
                .query_row(
                    "SELECT totp_attivo FROM utenti WHERE id = ?1",
                    params![user_id],
                    |r| r.get::<_, i64>(0),
                )
                .optional()?
                .is_some_and(|v| v != 0);
            let left: i64 = c.query_row(
                "SELECT COUNT(*) FROM recovery_codes WHERE user_id = ?1 AND used_ms IS NULL",
                params![user_id],
                |r| r.get(0),
            )?;
            let platform: bool = c
                .query_row(
                    "SELECT value FROM platform_settings WHERE key = 'require_2fa'",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .optional()?
                .is_some_and(|v| v == "1");
            let company: i64 = c.query_row(
                "SELECT COUNT(*) FROM membri m JOIN aziende a ON a.id = m.azienda_id
                 WHERE m.utente_id = ?1 AND a.require_2fa = 1",
                params![user_id],
                |r| r.get(0),
            )?;
            Ok(TwoFactorStatus {
                enabled,
                recovery_left: left as usize,
                required: platform || company > 0,
            })
        })
        .await?
    }

    /// A new secret, not active until its first code is confirmed. Refused
    /// while 2FA is on: switching phone goes through «disable» or a reset.
    pub async fn two_factor_start(&self, user_id: i64) -> anyhow::Result<TwoFactorSetup> {
        let (conn, master_path) = (self.conn.clone(), self.master_path());
        task::spawn_blocking(move || -> anyhow::Result<TwoFactorSetup> {
            let c = conn.lock().unwrap();
            let (email, on): (String, i64) = c.query_row(
                "SELECT email, totp_attivo FROM utenti WHERE id = ?1",
                params![user_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            anyhow::ensure!(on == 0, "two-factor authentication is already on");
            let mut secret = [0u8; SECRET_LEN];
            OsRng.fill_bytes(&mut secret);
            let b32 = base32_encode(&secret);
            let master = ai_keys::load_or_create_master(&master_path)?;
            let (nonce, ct) = ai_keys::encrypt(&master, &aad(user_id), &b32)?;
            c.execute(
                "UPDATE utenti SET totp_segreto = ?1, totp_nonce = ?2, totp_last_step = NULL WHERE id = ?3",
                params![hex(&ct), nonce.to_vec(), user_id],
            )?;
            Ok(TwoFactorSetup {
                uri: otpauth_uri(&email, &b32),
                secret: b32,
            })
        })
        .await?
    }

    /// The secret of `user_id`, decrypted, and the last step used.
    fn secret_of(
        c: &Connection,
        master_path: &Path,
        user_id: i64,
    ) -> Option<(Vec<u8>, Option<i64>)> {
        let (ct, nonce, last): (Option<String>, Option<Vec<u8>>, Option<i64>) = c
            .query_row(
                "SELECT totp_segreto, totp_nonce, totp_last_step FROM utenti WHERE id = ?1",
                params![user_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok()?;
        let master = ai_keys::load_or_create_master(master_path).ok()?;
        let b32 = ai_keys::decrypt(&master, &aad(user_id), &nonce?, &unhex(&ct?)?)?;
        Some((base32_decode(&b32)?, last))
    }

    /// The first code from the app: 2FA on, and ten new recovery codes.
    pub async fn two_factor_confirm(
        &self,
        user_id: i64,
        code: &str,
    ) -> anyhow::Result<Vec<String>> {
        let (conn, master_path) = (self.conn.clone(), self.master_path());
        let code = code.to_string();
        task::spawn_blocking(move || -> anyhow::Result<Vec<String>> {
            let mut c = conn.lock().unwrap();
            let (secret, last) = Self::secret_of(&c, &master_path, user_id)
                .ok_or_else(|| anyhow::anyhow!("no secret to confirm: start again"))?;
            let step = totp_match(&secret, &code, ora_ms(), last)
                .ok_or_else(|| anyhow::anyhow!("the code is wrong"))?;
            let t = c.transaction()?;
            t.execute(
                "UPDATE utenti SET totp_attivo = 1, totp_last_step = ?1, aggiornato_ms = ?2 WHERE id = ?3",
                params![step, ora_ms() as i64, user_id],
            )?;
            let codes = Self::write_recovery_codes(&t, user_id)?;
            t.commit()?;
            Ok(codes)
        })
        .await?
    }

    fn write_recovery_codes(c: &Connection, user_id: i64) -> anyhow::Result<Vec<String>> {
        c.execute(
            "DELETE FROM recovery_codes WHERE user_id = ?1",
            params![user_id],
        )?;
        let codes: Vec<String> = (0..RECOVERY_CODES).map(|_| new_recovery_code()).collect();
        for code in &codes {
            c.execute(
                "INSERT OR IGNORE INTO recovery_codes (user_id, fingerprint) VALUES (?1, ?2)",
                params![user_id, recovery_fingerprint(code)],
            )?;
        }
        Ok(codes)
    }

    /// The code of the app or an unused recovery code; `Some(true)` = it was
    /// a recovery code (now used), `None` = wrong.
    pub(crate) async fn check_second_factor(&self, user_id: i64, code: &str) -> Option<bool> {
        let (conn, master_path) = (self.conn.clone(), self.master_path());
        let code = code.to_string();
        task::spawn_blocking(move || -> Option<bool> {
            let c = conn.lock().unwrap();
            let on: i64 = c
                .query_row(
                    "SELECT totp_attivo FROM utenti WHERE id = ?1",
                    params![user_id],
                    |r| r.get(0),
                )
                .ok()?;
            if on == 0 {
                return None;
            }
            if let Some((secret, last)) = Self::secret_of(&c, &master_path, user_id) {
                if let Some(step) = totp_match(&secret, &code, ora_ms(), last) {
                    c.execute(
                        "UPDATE utenti SET totp_last_step = ?1 WHERE id = ?2",
                        params![step, user_id],
                    )
                    .ok()?;
                    return Some(false);
                }
            }
            let used = c
                .execute(
                    "UPDATE recovery_codes SET used_ms = ?1
                     WHERE user_id = ?2 AND fingerprint = ?3 AND used_ms IS NULL",
                    params![ora_ms() as i64, user_id, recovery_fingerprint(&code)],
                )
                .ok()?;
            (used == 1).then_some(true)
        })
        .await
        .ok()
        .flatten()
    }

    /// Off, by the person: their password and a code. Refused while a company
    /// of theirs or the platform requires it.
    pub async fn two_factor_disable(
        &self,
        user_id: i64,
        password: &str,
        code: &str,
    ) -> anyhow::Result<()> {
        let status = self.two_factor_status(user_id).await?;
        anyhow::ensure!(
            !status.required,
            "two-factor authentication is required for this account"
        );
        anyhow::ensure!(
            self.password_ok(user_id, password).await,
            "the password is wrong"
        );
        anyhow::ensure!(
            self.check_second_factor(user_id, code).await.is_some(),
            "the code is wrong"
        );
        self.two_factor_reset(user_id).await
    }

    /// Ten new recovery codes (the old ones stop working), with a code.
    pub async fn two_factor_new_codes(
        &self,
        user_id: i64,
        code: &str,
    ) -> anyhow::Result<Vec<String>> {
        anyhow::ensure!(
            self.check_second_factor(user_id, code).await.is_some(),
            "the code is wrong"
        );
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<Vec<String>> {
            let c = conn.lock().unwrap();
            Self::write_recovery_codes(&c, user_id)
        })
        .await?
    }

    /// Off, with everything it had: by the person (after `disable`'s checks)
    /// or by an administrator (a phone lost). The sessions stay.
    pub async fn two_factor_reset(&self, user_id: i64) -> anyhow::Result<()> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            c.execute(
                "UPDATE utenti SET totp_attivo = 0, totp_segreto = NULL, totp_nonce = NULL,
                        totp_last_step = NULL, aggiornato_ms = ?1 WHERE id = ?2",
                params![ora_ms() as i64, user_id],
            )?;
            c.execute(
                "DELETE FROM recovery_codes WHERE user_id = ?1",
                params![user_id],
            )?;
            Ok(())
        })
        .await?
    }

    async fn password_ok(&self, user_id: i64, password: &str) -> bool {
        let conn = self.conn.clone();
        let hash = task::spawn_blocking(move || -> Option<String> {
            let c = conn.lock().unwrap();
            c.query_row(
                "SELECT hash_password FROM utenti WHERE id = ?1",
                params![user_id],
                |r| r.get(0),
            )
            .ok()
        })
        .await
        .ok()
        .flatten();
        hash.is_some_and(|h| verifica_password(password, &h))
    }

    // ── requiring it ──────────────────────────────────────────────────────────

    /// A company requires 2FA of its members. Switching it on closes the
    /// sessions of the members without it: at their next login they set it up.
    pub async fn set_company_require_2fa(&self, company_id: i64, on: bool) -> anyhow::Result<()> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            c.execute(
                "UPDATE aziende SET require_2fa = ?1 WHERE id = ?2",
                params![on as i64, company_id],
            )?;
            if on {
                c.execute(
                    "DELETE FROM sessioni WHERE utente_id IN (
                        SELECT m.utente_id FROM membri m JOIN utenti u ON u.id = m.utente_id
                        WHERE m.azienda_id = ?1 AND u.totp_attivo = 0)",
                    params![company_id],
                )?;
            }
            Ok(())
        })
        .await?
    }

    pub async fn company_requires_2fa(&self, company_id: i64) -> anyhow::Result<bool> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<bool> {
            let c = conn.lock().unwrap();
            Ok(c.query_row(
                "SELECT require_2fa FROM aziende WHERE id = ?1",
                params![company_id],
                |r| r.get::<_, i64>(0),
            )? != 0)
        })
        .await?
    }

    /// The platform requires 2FA of every account. Switching it on closes the
    /// sessions of the accounts without it.
    pub async fn set_platform_require_2fa(&self, on: bool) -> anyhow::Result<()> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let c = conn.lock().unwrap();
            c.execute(
                "INSERT INTO platform_settings (key, value) VALUES ('require_2fa', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![if on { "1" } else { "0" }],
            )?;
            if on {
                c.execute(
                    "DELETE FROM sessioni WHERE utente_id IN (SELECT id FROM utenti WHERE totp_attivo = 0)",
                    [],
                )?;
            }
            Ok(())
        })
        .await?
    }

    pub async fn platform_requires_2fa(&self) -> anyhow::Result<bool> {
        let conn = self.conn.clone();
        task::spawn_blocking(move || -> anyhow::Result<bool> {
            let c = conn.lock().unwrap();
            Ok(c.query_row(
                "SELECT value FROM platform_settings WHERE key = 'require_2fa'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .is_some_and(|v| v == "1"))
        })
        .await?
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 6238, appendix B, the SHA-1 rows (secret "12345678901234567890",
    /// eight digits there, the last six here).
    #[test]
    fn the_codes_of_rfc_6238() {
        let secret = b"12345678901234567890";
        for (t, eight) in [
            (59u64, 94287082u32),
            (1111111109, 7081804),
            (1111111111, 14050471),
            (1234567890, 89005924),
            (2000000000, 69279037),
        ] {
            assert_eq!(totp_code(secret, t / 30), eight % 1_000_000, "t = {t}");
        }
    }

    #[test]
    fn base32_both_ways() {
        assert_eq!(base32_encode(b"foobar"), "MZXW6YTBOI");
        assert_eq!(base32_decode("mzxw6ytboi======").unwrap(), b"foobar");
        let r = [7u8; 20];
        assert_eq!(base32_decode(&base32_encode(&r)).unwrap(), r);
        assert!(base32_decode("not base32!").is_none());
    }

    #[test]
    fn a_code_is_accepted_once_and_half_a_minute_either_side() {
        let s = b"12345678901234567890";
        let now = 1_111_111_111_000u64;
        let step = (now / 1000 / 30) as i64;
        let code = |st: i64| format!("{:06}", totp_code(s, st as u64));
        assert_eq!(totp_match(s, &code(step), now, None), Some(step));
        assert_eq!(totp_match(s, &code(step - 1), now, None), Some(step - 1));
        assert_eq!(totp_match(s, &code(step + 2), now, None), None);
        assert_eq!(
            totp_match(s, &code(step), now, Some(step)),
            None,
            "already used"
        );
        assert_eq!(totp_match(s, "12345", now, None), None);
        assert_eq!(totp_match(s, "abcdef", now, None), None);
    }

    #[test]
    fn the_uri_for_the_app() {
        assert_eq!(
            otpauth_uri("m@x.it", "ABC"),
            "otpauth://totp/SWS:m%40x.it?secret=ABC&issuer=SWS&algorithm=SHA1&digits=6&period=30"
        );
    }

    async fn store() -> (Identita, tempfile::TempDir, i64) {
        let dir = tempfile::tempdir().unwrap();
        let id = Identita::apri(dir.path().join("identita.db"))
            .await
            .unwrap();
        let u = id
            .crea_utente("m@x.it", "M", "password-lunga", Ruolo::Sviluppatore, false)
            .await
            .unwrap();
        (id, dir, u.id)
    }

    fn code_now(secret_b32: &str) -> String {
        let s = base32_decode(secret_b32).unwrap();
        format!("{:06}", totp_code(&s, ora_ms() / 1000 / STEP_SECS))
    }

    /// The whole way: on, a login that asks the code, a code used twice,
    /// a recovery code, off.
    #[tokio::test]
    async fn on_login_code_recovery_off() {
        let (id, _d, uid) = store().await;
        assert!(
            id.accedi_per("m@x.it", "password-lunga", None)
                .await
                .is_ok(),
            "no 2FA yet"
        );
        let setup = id.two_factor_start(uid).await.unwrap();
        let first = code_now(&setup.secret);
        if first != "000000" {
            assert!(id.two_factor_confirm(uid, "000000").await.is_err());
        }
        let codes = id.two_factor_confirm(uid, &first).await.unwrap();
        assert_eq!(codes.len(), RECOVERY_CODES);
        assert!(id.two_factor_start(uid).await.is_err(), "already on");
        let st = id.two_factor_status(uid).await.unwrap();
        assert_eq!(
            (st.enabled, st.recovery_left, st.required),
            (true, 10, false)
        );

        // The password alone gives a challenge, not a session.
        let Err(Rifiuto::SecondFactor { challenge, kind }) =
            id.accedi_per("m@x.it", "password-lunga", None).await
        else {
            panic!("a challenge");
        };
        assert_eq!(kind, ChallengeKind::Code);
        // The code confirmed a moment ago is spent: the next one is a recovery code.
        assert!(id.second_factor(&challenge, &first).await.is_err());
        let (a, recovery) = id
            .second_factor(&challenge, &codes[0].to_lowercase())
            .await
            .unwrap();
        assert!(recovery);
        assert!(id.valida(&a.token).await.is_some());
        assert!(
            id.second_factor(&challenge, &codes[1]).await.is_err(),
            "a challenge works once"
        );
        let Err(Rifiuto::SecondFactor { challenge, .. }) =
            id.accedi_per("m@x.it", "password-lunga", None).await
        else {
            panic!()
        };
        assert!(
            id.second_factor(&challenge, &codes[0]).await.is_err(),
            "a recovery code works once"
        );
        assert_eq!(id.two_factor_status(uid).await.unwrap().recovery_left, 9);

        // Off needs the password and a code.
        assert!(id
            .two_factor_disable(uid, "sbagliata", &codes[2])
            .await
            .is_err());
        id.two_factor_disable(uid, "password-lunga", &codes[2])
            .await
            .unwrap();
        assert!(id
            .accedi_per("m@x.it", "password-lunga", None)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn wrong_codes_count_with_wrong_passwords() {
        let (id, _d, uid) = store().await;
        let setup = id.two_factor_start(uid).await.unwrap();
        id.two_factor_confirm(uid, &code_now(&setup.secret))
            .await
            .unwrap();
        let Err(Rifiuto::SecondFactor { challenge, .. }) =
            id.accedi_per("m@x.it", "password-lunga", None).await
        else {
            panic!()
        };
        for _ in 0..5 {
            let _ = id.second_factor(&challenge, "999999").await;
        }
        assert!(matches!(
            id.second_factor(&challenge, "999999").await,
            Err(Rifiuto::Bloccato { .. })
        ));
    }

    /// Required by the company: the login gives a setup challenge; setting it
    /// up gives the session and the codes; it can't be switched off.
    #[tokio::test]
    async fn required_by_the_company() {
        let (id, _d, uid) = store().await;
        let acme = id.crea_azienda("Acme").await.unwrap();
        id.iscrivi(acme.id, uid, Ruolo::Sviluppatore).await.unwrap();
        let a = id
            .accedi_per("m@x.it", "password-lunga", None)
            .await
            .unwrap();
        id.set_company_require_2fa(acme.id, true).await.unwrap();
        assert!(
            id.valida(&a.token).await.is_none(),
            "the session without 2FA is closed"
        );
        assert!(id.company_requires_2fa(acme.id).await.unwrap());
        let Err(Rifiuto::SecondFactor { challenge, kind }) =
            id.accedi_per("m@x.it", "password-lunga", None).await
        else {
            panic!()
        };
        assert_eq!(kind, ChallengeKind::Setup);
        assert!(
            id.second_factor(&challenge, "123456").await.is_err(),
            "not a code challenge"
        );
        let setup = id.second_factor_setup(&challenge).await.unwrap();
        let (a, codes) = id
            .second_factor_setup_confirm(&challenge, &code_now(&setup.secret))
            .await
            .unwrap();
        assert!(id.valida(&a.token).await.is_some());
        assert_eq!(codes.len(), RECOVERY_CODES);
        assert!(id
            .two_factor_disable(uid, "password-lunga", &codes[0])
            .await
            .is_err());
        // An administrator resets it (a phone lost): the next login sets it up again.
        id.two_factor_reset(uid).await.unwrap();
        assert!(matches!(
            id.accedi_per("m@x.it", "password-lunga", None).await,
            Err(Rifiuto::SecondFactor {
                kind: ChallengeKind::Setup,
                ..
            })
        ));
        // The platform's switch, for everyone.
        id.set_company_require_2fa(acme.id, false).await.unwrap();
        assert!(id
            .accedi_per("m@x.it", "password-lunga", None)
            .await
            .is_ok());
        id.set_platform_require_2fa(true).await.unwrap();
        assert!(id.platform_requires_2fa().await.unwrap());
        assert!(id
            .accedi_per("m@x.it", "password-lunga", None)
            .await
            .is_err());
    }

    #[test]
    fn recovery_codes_read_as_typed() {
        assert_eq!(
            recovery_fingerprint("ABCD-EF01"),
            recovery_fingerprint("abcdef0l")
        );
        assert_eq!(
            recovery_fingerprint("O0O0-1111"),
            recovery_fingerprint("0000 IIII")
        );
        let c = new_recovery_code();
        assert_eq!(c.len(), 9);
        assert_eq!(&c[4..5], "-");
    }
}
