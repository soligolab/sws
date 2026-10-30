//! Append-only, tamper-evident audit log (OPEN_QUESTIONS Q8 / CRA).
//!
//! One JSON object per line (JSONL). Each entry chains to its predecessor via
//! SHA-256 (`chain::entry_hash`) and is optionally HMAC-signed. `verify` re-reads
//! the file and checks the whole chain. Suitable as a base for FDA 21 CFR Part 11.

pub mod chain;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::warn;

/// Predecessor hash of the very first entry.
const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub seq: u64,
    pub ts_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    pub action: String,
    #[serde(default)]
    pub detail: serde_json::Value,
    pub prev_hash: String,
    pub hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sig: Option<String>,
}

struct State {
    seq: u64,
    last_hash: String,
}

/// A running audit log. Appends are serialized through an async mutex so the
/// hash chain stays correct even under concurrent callers.
pub struct AuditLog {
    path: PathBuf,
    key: Option<Vec<u8>>,
    state: Mutex<State>,
}

impl AuditLog {
    /// Open (or start) the log at `path`, recovering `seq`/`last_hash` from the
    /// last valid line of an existing file. `key` enables HMAC signing.
    pub fn open(path: PathBuf, key: Option<Vec<u8>>) -> Self {
        let (seq, last_hash) = read_tail(&path).unwrap_or((0, GENESIS_HASH.to_string()));
        AuditLog {
            path,
            key,
            state: Mutex::new(State { seq, last_hash }),
        }
    }

    /// Fire-and-forget append. Never blocks the caller beyond spawning a task;
    /// failures are logged, never propagated (audit must not break the request).
    pub fn log(
        self: &Arc<Self>,
        action: impl Into<String>,
        actor: Option<String>,
        detail: serde_json::Value,
    ) {
        let this = Arc::clone(self);
        let action = action.into();
        tokio::spawn(async move {
            if let Err(e) = this.append(action, actor, detail).await {
                warn!("audit append failed: {e:#}");
            }
        });
    }

    async fn append(
        &self,
        action: String,
        actor: Option<String>,
        detail: serde_json::Value,
    ) -> anyhow::Result<()> {
        use tokio::io::AsyncWriteExt;
        let mut st = self.state.lock().await;
        let seq = st.seq + 1;
        let ts_ms = now_ms();
        let prev_hash = st.last_hash.clone();
        let hash = chain::entry_hash(seq, ts_ms, actor.as_deref(), &action, &detail, &prev_hash);
        let sig = self.key.as_ref().map(|k| chain::hmac_sign(k, &hash));
        let entry = AuditEntry {
            seq,
            ts_ms,
            actor,
            action,
            detail,
            prev_hash,
            hash: hash.clone(),
            sig,
        };
        let line = serde_json::to_string(&entry)? + "\n";
        let mut f = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .await?;
        f.write_all(line.as_bytes()).await?;
        f.flush().await?;
        st.seq = seq;
        st.last_hash = hash;
        Ok(())
    }

    /// Most-recent `limit` entries (oldest first within the window).
    pub async fn tail(&self, limit: usize) -> Vec<AuditEntry> {
        let content = tokio::fs::read_to_string(&self.path)
            .await
            .unwrap_or_default();
        let mut all: Vec<AuditEntry> = content
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect();
        let n = all.len();
        if n > limit {
            all.drain(0..n - limit);
        }
        all
    }

    /// Toglie le voci più vecchie di `prima_di_ms` (rotazione del registro, 30-10-2026: l'informativa
    /// del gateway promette 12 mesi, `docs/legale/LEGGIMI.md`). Restituisce quante ne ha tolte.
    ///
    /// La catena resta verificabile: le voci rimaste non si toccano, e [`verify`] accetta che la
    /// prima non parta dalla genesi — la prende come ancora e lo dice (`dal_seq`). L'ultima voce
    /// resta sempre, anche se vecchia, perché da lei riparte la numerazione. Il file si riscrive in
    /// una copia e si rinomina, così un'interruzione a metà non lo tronca.
    pub async fn pota(&self, prima_di_ms: u64) -> anyhow::Result<usize> {
        let st = self.state.lock().await;
        let content = match tokio::fs::read_to_string(&self.path).await {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(e.into()),
        };
        let righe: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
        let vecchia = |l: &str| {
            serde_json::from_str::<AuditEntry>(l).map(|e| e.ts_ms < prima_di_ms).unwrap_or(false)
        };
        // Solo le voci in testa: quello che viene dopo la prima recente resta comunque, perché
        // un buco in mezzo spezzerebbe la catena.
        let tolte = righe.iter().take(righe.len().saturating_sub(1)).take_while(|l| vecchia(l)).count();
        if tolte == 0 {
            return Ok(0);
        }
        let resto = righe[tolte..].join("\n") + "\n";
        let tmp = self.path.with_extension("jsonl.potatura");
        tokio::fs::write(&tmp, resto).await?;
        tokio::fs::rename(&tmp, &self.path).await?;
        drop(st);
        Ok(tolte)
    }

    /// Verify the whole on-disk chain (+ HMAC if a key is configured).
    pub async fn verify_self(&self) -> VerifyReport {
        verify(&self.path, self.key.as_deref())
    }
}

#[derive(Debug, Serialize)]
pub struct VerifyReport {
    pub ok: bool,
    pub entries: u64,
    /// Il registro è stato potato ([`AuditLog::pota`]): la verifica parte da questa voce, presa
    /// per buona, invece che dalla genesi.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dal_seq: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub broken_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Re-read `path` and verify the hash chain: consecutive `seq`, linked
/// `prev_hash`, recomputed `hash`, and HMAC `sig` when `key` is given.
pub fn verify(path: &Path, key: Option<&[u8]>) -> VerifyReport {
    let content = std::fs::read_to_string(path).unwrap_or_default();
    let mut prev = GENESIS_HASH.to_string();
    let mut expected_seq = 1u64;
    let mut count = 0u64;
    let mut dal_seq = None;
    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let e: AuditEntry = match serde_json::from_str(line) {
            Ok(e) => e,
            Err(err) => return broken(count, expected_seq, &format!("parse: {err}")),
        };
        // La prima voce di un registro potato: si parte da lei.
        if count == 0 && e.seq != 1 {
            dal_seq = Some(e.seq);
            expected_seq = e.seq;
            prev = e.prev_hash.clone();
        }
        if e.seq != expected_seq {
            return broken(count, e.seq, "seq non consecutivo");
        }
        if e.prev_hash != prev {
            return broken(count, e.seq, "prev_hash non concatenato");
        }
        let h = chain::entry_hash(
            e.seq,
            e.ts_ms,
            e.actor.as_deref(),
            &e.action,
            &e.detail,
            &e.prev_hash,
        );
        if h != e.hash {
            return broken(count, e.seq, "hash non valido (entry alterata)");
        }
        if let Some(k) = key {
            if e.sig.as_deref() != Some(chain::hmac_sign(k, &e.hash).as_str()) {
                return broken(count, e.seq, "firma HMAC non valida");
            }
        }
        prev = e.hash;
        expected_seq += 1;
        count += 1;
    }
    VerifyReport {
        ok: true,
        entries: count,
        dal_seq,
        broken_at: None,
        reason: None,
    }
}

fn broken(count: u64, seq: u64, reason: &str) -> VerifyReport {
    VerifyReport {
        ok: false,
        entries: count,
        dal_seq: None,
        broken_at: Some(seq),
        reason: Some(reason.to_string()),
    }
}

fn read_tail(path: &Path) -> Option<(u64, String)> {
    let content = std::fs::read_to_string(path).ok()?;
    let last = content.lines().rev().find(|l| !l.trim().is_empty())?;
    let e: AuditEntry = serde_json::from_str(last).ok()?;
    Some((e.seq, e.hash))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn append_and_verify_roundtrip() {
        let dir = std::env::temp_dir().join(format!("sws-audit-test-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("audit.jsonl");
        let log = Arc::new(AuditLog::open(path.clone(), Some(b"secret".to_vec())));

        // Append 3 entries directly (await, not fire-and-forget, for determinism).
        log.append(
            "auth.login".into(),
            Some("mauro".into()),
            json!({"role":"Admin"}),
        )
        .await
        .unwrap();
        log.append(
            "project.change".into(),
            Some("mauro".into()),
            json!({"what":"tags"}),
        )
        .await
        .unwrap();
        log.append("script.exec".into(), None, json!({"bytes":42}))
            .await
            .unwrap();

        let rep = verify(&path, Some(b"secret"));
        assert!(rep.ok, "expected ok, got {rep:?}");
        assert_eq!(rep.entries, 3);

        // Tamper with the second line → verify must flag broken_at == 2.
        let content = std::fs::read_to_string(&path).unwrap();
        let mut lines: Vec<String> = content.lines().map(String::from).collect();
        lines[1] = lines[1].replace("tags", "alarms");
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();
        let rep2 = verify(&path, Some(b"secret"));
        assert!(!rep2.ok);
        assert_eq!(rep2.broken_at, Some(2));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn la_potatura_toglie_le_vecchie_e_la_catena_regge() {
        let dir = std::env::temp_dir().join(format!("sws-audit-pota-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("audit.jsonl");
        let log = Arc::new(AuditLog::open(path.clone(), Some(b"k".to_vec())));
        for i in 0..4 {
            log.append(format!("a{i}"), None, json!({})).await.unwrap();
        }
        // Le date a mano: le prime due «vecchie». Riscritte con la catena rifatta.
        let mut prev = GENESIS_HASH.to_string();
        let righe: Vec<String> = std::fs::read_to_string(&path).unwrap().lines().enumerate().map(|(i, l)| {
            let mut e: AuditEntry = serde_json::from_str(l).unwrap();
            e.ts_ms = if i < 2 { 1_000 } else { 5_000 };
            e.prev_hash = prev.clone();
            e.hash = chain::entry_hash(e.seq, e.ts_ms, e.actor.as_deref(), &e.action, &e.detail, &e.prev_hash);
            e.sig = Some(chain::hmac_sign(b"k", &e.hash));
            prev = e.hash.clone();
            serde_json::to_string(&e).unwrap()
        }).collect();
        std::fs::write(&path, righe.join("\n") + "\n").unwrap();
        // Riaperto: la catena riscritta a mano non è quella che il log ha in memoria.
        let log = Arc::new(AuditLog::open(path.clone(), Some(b"k".to_vec())));

        assert_eq!(log.pota(2_000).await.unwrap(), 2);
        let rep = verify(&path, Some(b"k"));
        assert!(rep.ok, "{rep:?}");
        assert_eq!((rep.entries, rep.dal_seq), (2, Some(3)));
        // Niente da togliere la seconda volta; e l'ultima voce resta anche se vecchia.
        assert_eq!(log.pota(2_000).await.unwrap(), 0);
        assert_eq!(log.pota(u64::MAX).await.unwrap(), 1);
        assert_eq!(verify(&path, Some(b"k")).entries, 1);
        // Si continua a scrivere sulla catena di prima.
        log.append("dopo".into(), None, json!({})).await.unwrap();
        assert!(verify(&path, Some(b"k")).ok);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
