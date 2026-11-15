//! The AI provider keys (Anthropic, Kimi) **of the user**, kept encrypted at
//! rest (seed `docs/plans/2026-11-12-chiavi-ia-nel-profilo-utente.md`,
//! decisions of the maintainer, 15-11-2026).
//!
//! Someone working on several projects in the cloud puts their key here once,
//! and the assistant works on every project they open. The project's own key,
//! if there is one, wins: this store gives the user's key only to whoever finds
//! none in the project (`sws-web`, `ai/client.rs`).
//!
//! # How they are kept
//!
//! - **Encrypted with AES-256-GCM** (`ring::aead`), a random 12-byte nonce per
//!   row. What is authenticated along with the message is `<user>:<provider>`:
//!   a row copied onto another user or provider does not decrypt.
//! - **The master key is a file of its own**, `chiave_segreti`, next to the
//!   database, mode 0600. It is not in the database: whoever has a copy of the
//!   database alone does not have the keys. The file is created on first use and
//!   **is not in the backup** (`deploy/vps/backup-dati.sh` leaves it out): after
//!   a restore the rows are there but do not decrypt, and `ai_key` answers
//!   «none» instead of an error, so the user writes them again.
//! - **They are never shown again**: the list gives the provider and the last
//!   four letters, and whether the key still reads.

use super::*;
use argon2::password_hash::rand_core::RngCore;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};

/// The master key file, next to the database.
pub const MASTER_KEY_FILE: &str = "chiave_segreti";
const MASTER_LEN: usize = 32;
/// A provider key is about fifty characters: more than this is a wrong paste.
const MAX_KEY: usize = 512;
const MAX_PROVIDER: usize = 32;

/// A key in the list: never the value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AiKeyInfo {
    pub provider: String,
    /// The last four letters, to recognise it.
    pub last4: String,
    /// `false` after a restore without the master key: the row is there but
    /// does not decrypt, and has to be written again.
    pub readable: bool,
}

fn valid_provider(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= MAX_PROVIDER
        && p.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn valid_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= MAX_KEY && !k.chars().any(|c| c.is_control() || c.is_whitespace())
}

fn last4(k: &str) -> String {
    let n = k.chars().count();
    k.chars().skip(n.saturating_sub(4)).collect()
}

/// The text authenticated together with the message.
fn aad(user_id: i64, provider: &str) -> Vec<u8> {
    format!("{user_id}:{provider}").into_bytes()
}

/// Reads the master key, or creates it if the file is not there. A file that is
/// there but does not read is **not** rewritten: the keys already encrypted
/// would become unreadable, silently.
fn load_or_create_master(path: &Path) -> anyhow::Result<[u8; MASTER_LEN]> {
    match std::fs::read_to_string(path) {
        Ok(text) => {
            let hex = text.trim();
            let mut master = [0u8; MASTER_LEN];
            anyhow::ensure!(
                hex.len() == MASTER_LEN * 2
                    && hex.is_ascii()
                    && (0..MASTER_LEN).all(|i| {
                        u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
                            .map(|b| master[i] = b)
                            .is_ok()
                    }),
                "{} is not a valid master key: not rewriting it, the keys already encrypted \
                 would become unreadable",
                path.display()
            );
            Ok(master)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let mut master = [0u8; MASTER_LEN];
            OsRng.fill_bytes(&mut master);
            let hex: String = master.iter().map(|b| format!("{b:02x}")).collect();
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            // Never visible to others, not even for an instant: mode 0600 from the start.
            #[cfg(unix)]
            {
                use std::io::Write;
                use std::os::unix::fs::OpenOptionsExt;
                let mut f = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(path)?;
                f.write_all(hex.as_bytes())?;
            }
            #[cfg(not(unix))]
            std::fs::write(path, hex)?;
            info!(path = %path.display(), "master key of the AI keys created");
            Ok(master)
        }
        Err(e) => Err(e.into()),
    }
}

fn encrypt(
    master: &[u8; MASTER_LEN],
    aad_: &[u8],
    plain: &str,
) -> anyhow::Result<([u8; NONCE_LEN], Vec<u8>)> {
    let key = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, master).map_err(|_| anyhow::anyhow!("invalid master key"))?,
    );
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let mut bytes = plain.as_bytes().to_vec();
    key.seal_in_place_append_tag(
        Nonce::assume_unique_for_key(nonce),
        Aad::from(aad_),
        &mut bytes,
    )
    .map_err(|_| anyhow::anyhow!("encryption failed"))?;
    Ok((nonce, bytes))
}

/// `None` if it does not decrypt: another master key, a copied row, damaged data.
fn decrypt(
    master: &[u8; MASTER_LEN],
    aad_: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
) -> Option<String> {
    let nonce: [u8; NONCE_LEN] = nonce.try_into().ok()?;
    let key = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, master).ok()?);
    let mut bytes = ciphertext.to_vec();
    let plain = key
        .open_in_place(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(aad_),
            &mut bytes,
        )
        .ok()?;
    String::from_utf8(plain.to_vec()).ok()
}

impl Identita {
    fn master_path(&self) -> PathBuf {
        self.percorso
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(MASTER_KEY_FILE)
    }

    /// Sets (or replaces) the key of `provider` for `user_id`.
    pub async fn set_ai_key(&self, user_id: i64, provider: &str, key: &str) -> anyhow::Result<()> {
        let key = key.trim().to_string();
        anyhow::ensure!(valid_provider(provider), "invalid provider");
        anyhow::ensure!(
            valid_key(&key),
            "the key is empty, too long or has spaces in it"
        );
        let (conn, master_path) = (self.conn.clone(), self.master_path());
        let provider = provider.to_string();
        task::spawn_blocking(move || -> anyhow::Result<()> {
            let master = load_or_create_master(&master_path)?;
            let (nonce, ciphertext) = encrypt(&master, &aad(user_id, &provider), &key)?;
            let c = conn.lock().unwrap_or_else(|e| e.into_inner());
            let exists: bool = c
                .query_row(
                    "SELECT 1 FROM utenti WHERE id = ?1",
                    params![user_id],
                    |_| Ok(true),
                )
                .optional()?
                .unwrap_or(false);
            anyhow::ensure!(exists, "no such user");
            c.execute(
                "INSERT OR REPLACE INTO ai_keys
                 (user_id, provider, nonce, ciphertext, last4, created_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    user_id,
                    provider,
                    nonce.to_vec(),
                    ciphertext,
                    last4(&key),
                    ora_ms() as i64
                ],
            )?;
            Ok(())
        })
        .await?
    }

    /// The key in the clear, for whoever has to use it and nothing else. `None`
    /// if there is none, or there is one that does not decrypt (after a restore
    /// without the master key).
    pub async fn ai_key(&self, user_id: i64, provider: &str) -> anyhow::Result<Option<String>> {
        anyhow::ensure!(valid_provider(provider), "invalid provider");
        let (conn, master_path) = (self.conn.clone(), self.master_path());
        let provider = provider.to_string();
        task::spawn_blocking(move || -> anyhow::Result<Option<String>> {
            let row: Option<(Vec<u8>, Vec<u8>)> = {
                let c = conn.lock().unwrap_or_else(|e| e.into_inner());
                c.query_row(
                    "SELECT nonce, ciphertext FROM ai_keys WHERE user_id = ?1 AND provider = ?2",
                    params![user_id, provider],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?
            };
            let Some((nonce, ciphertext)) = row else {
                return Ok(None);
            };
            // Without the master key file a new one is not made here: with a
            // new one no row from before would read, and a file must not be born
            // from a read.
            if !master_path.exists() {
                warn!(
                    user_id,
                    provider, "AI key without a master key: it has to be written again"
                );
                return Ok(None);
            }
            let master = load_or_create_master(&master_path)?;
            let plain = decrypt(&master, &aad(user_id, &provider), &nonce, &ciphertext);
            if plain.is_none() {
                warn!(
                    user_id,
                    provider, "AI key that does not decrypt: it has to be written again"
                );
            }
            Ok(plain)
        })
        .await?
    }

    /// The keys of a user, without the values.
    pub async fn list_ai_keys(&self, user_id: i64) -> anyhow::Result<Vec<AiKeyInfo>> {
        let (conn, master_path) = (self.conn.clone(), self.master_path());
        task::spawn_blocking(move || -> anyhow::Result<Vec<AiKeyInfo>> {
            let rows: Vec<(String, String, Vec<u8>, Vec<u8>)> = {
                let c = conn.lock().unwrap_or_else(|e| e.into_inner());
                let mut q = c.prepare(
                    "SELECT provider, last4, nonce, ciphertext FROM ai_keys
                     WHERE user_id = ?1 ORDER BY provider",
                )?;
                let v = q
                    .query_map(params![user_id], |r| {
                        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                    })?
                    .collect::<Result<_, _>>()?;
                v
            };
            let master = if rows.is_empty() || !master_path.exists() {
                None
            } else {
                load_or_create_master(&master_path).ok()
            };
            Ok(rows
                .into_iter()
                .map(|(provider, last4, nonce, ciphertext)| {
                    let readable = master
                        .as_ref()
                        .and_then(|m| decrypt(m, &aad(user_id, &provider), &nonce, &ciphertext))
                        .is_some();
                    AiKeyInfo {
                        provider,
                        last4,
                        readable,
                    }
                })
                .collect())
        })
        .await?
    }

    /// Removes the key. `false` if there was none: removing it twice is no error.
    pub async fn remove_ai_key(&self, user_id: i64, provider: &str) -> anyhow::Result<bool> {
        anyhow::ensure!(valid_provider(provider), "invalid provider");
        let conn = self.conn.clone();
        let provider = provider.to_string();
        task::spawn_blocking(move || -> anyhow::Result<bool> {
            let c = conn.lock().unwrap_or_else(|e| e.into_inner());
            let n = c.execute(
                "DELETE FROM ai_keys WHERE user_id = ?1 AND provider = ?2",
                params![user_id, provider],
            )?;
            Ok(n > 0)
        })
        .await?
    }
}

#[cfg(test)]
mod test {
    use super::*;

    async fn store() -> (Identita, tempfile::TempDir, i64) {
        let dir = tempfile::tempdir().unwrap();
        let id = Identita::apri(dir.path().join("identita.db"))
            .await
            .unwrap();
        let u = id
            .crea_utente(
                "m@soligo.net",
                "Mauro",
                "unapassword",
                Ruolo::Sviluppatore,
                false,
            )
            .await
            .unwrap();
        (id, dir, u.id)
    }

    #[tokio::test]
    async fn a_key_goes_and_comes_back_and_is_not_in_the_clear_on_disk() {
        let (id, d, u) = store().await;
        assert_eq!(id.ai_key(u, "anthropic").await.unwrap(), None);
        id.set_ai_key(u, "anthropic", "  sk-ant-segretissima-1234  ")
            .await
            .unwrap();
        assert_eq!(
            id.ai_key(u, "anthropic").await.unwrap().as_deref(),
            Some("sk-ant-segretissima-1234")
        );
        // Neither in the database nor in its journal: only encrypted.
        for f in ["identita.db", "identita.db-wal"] {
            if let Ok(bytes) = std::fs::read(d.path().join(f)) {
                let text = String::from_utf8_lossy(&bytes);
                assert!(
                    !text.contains("segretissima"),
                    "{f} holds the key in the clear"
                );
            }
        }
        // The list gives the last four letters, never the value.
        assert_eq!(
            id.list_ai_keys(u).await.unwrap(),
            vec![AiKeyInfo {
                provider: "anthropic".into(),
                last4: "1234".into(),
                readable: true
            }]
        );
        // Replaced, removed, and removing it twice is no error.
        id.set_ai_key(u, "anthropic", "sk-ant-nuova-9999")
            .await
            .unwrap();
        assert_eq!(
            id.ai_key(u, "anthropic").await.unwrap().as_deref(),
            Some("sk-ant-nuova-9999")
        );
        assert!(id.remove_ai_key(u, "anthropic").await.unwrap());
        assert!(!id.remove_ai_key(u, "anthropic").await.unwrap());
        assert_eq!(id.ai_key(u, "anthropic").await.unwrap(), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_master_key_is_private_and_a_read_does_not_make_it() {
        use std::os::unix::fs::PermissionsExt;
        let (id, d, u) = store().await;
        id.ai_key(u, "kimi").await.unwrap();
        assert!(!d.path().join(MASTER_KEY_FILE).exists());
        id.set_ai_key(u, "kimi", "sk-kimi-1").await.unwrap();
        let m = std::fs::metadata(d.path().join(MASTER_KEY_FILE)).unwrap();
        assert_eq!(m.permissions().mode() & 0o777, 0o600);
    }

    #[tokio::test]
    async fn each_user_has_their_own_and_a_copied_row_does_not_decrypt() {
        let (id, d, u1) = store().await;
        let u2 = id
            .crea_utente(
                "b@soligo.net",
                "Bea",
                "unapassword",
                Ruolo::Sviluppatore,
                false,
            )
            .await
            .unwrap()
            .id;
        id.set_ai_key(u1, "anthropic", "sk-di-mauro-1111")
            .await
            .unwrap();
        assert_eq!(id.ai_key(u2, "anthropic").await.unwrap(), None);
        // Mauro's row copied onto Bea's user: the authenticated text does not
        // match, and it does not read.
        {
            let c = rusqlite::Connection::open(d.path().join("identita.db")).unwrap();
            c.execute(
                "INSERT INTO ai_keys (user_id, provider, nonce, ciphertext, last4, created_ms)
                 SELECT ?1, provider, nonce, ciphertext, last4, created_ms
                 FROM ai_keys WHERE user_id = ?2",
                params![u2, u1],
            )
            .unwrap();
        }
        assert_eq!(id.ai_key(u2, "anthropic").await.unwrap(), None);
        assert!(!id.list_ai_keys(u2).await.unwrap()[0].readable);
        // And Mauro's stays his.
        assert_eq!(
            id.ai_key(u1, "anthropic").await.unwrap().as_deref(),
            Some("sk-di-mauro-1111")
        );
    }

    #[tokio::test]
    async fn after_a_restore_without_the_master_key_it_does_not_read_and_can_be_written_again() {
        let (id, d, u) = store().await;
        id.set_ai_key(u, "anthropic", "sk-ant-prima-0001")
            .await
            .unwrap();
        // The restore from backup brings the database and not the master key.
        std::fs::remove_file(d.path().join(MASTER_KEY_FILE)).unwrap();
        assert_eq!(id.ai_key(u, "anthropic").await.unwrap(), None);
        // A read does not make a new one (the old rows would stay unreadable anyway).
        assert!(!d.path().join(MASTER_KEY_FILE).exists());
        let list = id.list_ai_keys(u).await.unwrap();
        assert_eq!((list[0].last4.as_str(), list[0].readable), ("0001", false));
        // Writing it again works, with the new master key.
        id.set_ai_key(u, "anthropic", "sk-ant-dopo-0002")
            .await
            .unwrap();
        assert_eq!(
            id.ai_key(u, "anthropic").await.unwrap().as_deref(),
            Some("sk-ant-dopo-0002")
        );
        assert!(id.list_ai_keys(u).await.unwrap()[0].readable);
    }

    #[tokio::test]
    async fn a_damaged_master_key_is_not_rewritten() {
        let (id, d, u) = store().await;
        id.set_ai_key(u, "kimi", "sk-kimi-bella-5555")
            .await
            .unwrap();
        std::fs::write(d.path().join(MASTER_KEY_FILE), "non-e-esadecimale").unwrap();
        // Writing is an error, and the file stays as it is: replacing it would
        // make all the keys already encrypted unreadable, silently.
        assert!(id
            .set_ai_key(u, "kimi", "sk-kimi-nuova-6666")
            .await
            .is_err());
        assert_eq!(
            std::fs::read_to_string(d.path().join(MASTER_KEY_FILE)).unwrap(),
            "non-e-esadecimale"
        );
    }

    #[tokio::test]
    async fn odd_values_are_refused_and_without_a_user_nothing_is_written() {
        let (id, _d, u) = store().await;
        for (p, k) in [
            ("", "k"),
            ("Anthropic", "k"),
            ("a b", "k"),
            ("kimi", ""),
            ("kimi", "due parole"),
        ] {
            assert!(id.set_ai_key(u, p, k).await.is_err(), "{p:?} {k:?}");
        }
        assert!(id.set_ai_key(u, "kimi", &"x".repeat(600)).await.is_err());
        assert!(id.set_ai_key(9999, "kimi", "sk-kimi-1").await.is_err());
        // A user who goes takes their keys with them (ON DELETE CASCADE).
        id.set_ai_key(u, "kimi", "sk-kimi-1").await.unwrap();
        {
            let c = id.conn.lock().unwrap();
            c.execute("DELETE FROM utenti WHERE id = ?1", params![u])
                .unwrap();
        }
        assert!(id.list_ai_keys(u).await.unwrap().is_empty());
    }
}
