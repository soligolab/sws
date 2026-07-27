//! Hash-chain entry hashing and HMAC-SHA256 signing.
//!
//! Each audit entry's `hash` is the SHA-256 over a canonical concatenation of
//! its fields (including the predecessor's hash), making the log tamper-evident:
//! altering any past entry breaks every subsequent `hash`. When a key is
//! configured, `sig = HMAC-SHA256(key, hash)` makes it tamper-*resistant* too
//! (an attacker without the key can't recompute a valid chain).

use sha2::{Digest, Sha256};
use hmac::{Hmac, Mac};

type HmacSha256 = Hmac<Sha256>;

fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// SHA-256 over the canonical byte concatenation of the entry fields.
/// `detail.to_string()` is deterministic (serde_json `Map` is ordered), so the
/// hash is stable across runs. NUL separators avoid field-boundary ambiguity.
pub fn entry_hash(
    seq: u64,
    ts_ms: u64,
    actor: Option<&str>,
    action: &str,
    detail: &serde_json::Value,
    prev_hash: &str,
) -> String {
    let mut h = Sha256::new();
    h.update(seq.to_be_bytes());
    h.update(ts_ms.to_be_bytes());
    h.update(actor.unwrap_or("").as_bytes());
    h.update([0u8]);
    h.update(action.as_bytes());
    h.update([0u8]);
    h.update(detail.to_string().as_bytes());
    h.update([0u8]);
    h.update(prev_hash.as_bytes());
    to_hex(&h.finalize())
}

/// HMAC-SHA256(key, hash_hex) → hex.
pub fn hmac_sign(key: &[u8], hash_hex: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts a key of any length");
    mac.update(hash_hex.as_bytes());
    to_hex(&mac.finalize().into_bytes())
}
