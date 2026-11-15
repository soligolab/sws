//! The AI keys of the user who is writing in the chat, asked to the gateway
//! for one session (seed `docs/plans/2026-11-12-chiavi-ia-nel-profilo-utente.md`;
//! decisions of the maintainer, 15-11-2026).
//!
//! The order is fixed: **the project's key first**, then the user's. A project
//! with a key of its own (the file in its configuration, or the environment) is
//! used as it always was, and the gateway is not even asked. Only for a provider
//! the project has no key for, and only when this container is behind the
//! gateway, the key of whoever is writing is asked to the gateway
//! (`ai_keys.rs`, `GET /api/internal/ai-key/:provider`), with the container's
//! return key.
//!
//! What comes back lives in memory, for the session: it is not written to disk,
//! not logged, not sent to the browser. The next session asks again, so a key
//! the user took away stops working at the next chat.

use crate::ai::client::Fornitore;
use crate::router::AppState;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use std::collections::BTreeMap;
use std::sync::Arc;

/// The keys of the user, by provider name. Empty (the default) = none, and the
/// chat works as before.
#[derive(Clone, Default)]
pub struct UserKeys(Arc<BTreeMap<&'static str, String>>);

// Never printed, not even by accident in a debug line.
impl std::fmt::Debug for UserKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "UserKeys({} keys)", self.0.len())
    }
}

impl UserKeys {
    pub fn from_pairs(pairs: impl IntoIterator<Item = (Fornitore, String)>) -> Self {
        UserKeys(Arc::new(
            pairs.into_iter().map(|(f, k)| (f.nome(), k)).collect(),
        ))
    }

    pub fn get(&self, f: Fornitore) -> Option<&str> {
        self.0.get(f.nome()).map(String::as_str)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// The address the container calls on the gateway.
pub fn url_for(origin: &str, provider: &str, email: &str) -> String {
    format!(
        "{}/api/internal/ai-key/{provider}?user={}",
        origin.trim_end_matches('/'),
        utf8_percent_encode(email, NON_ALPHANUMERIC)
    )
}

/// The key of `email` for each provider in `missing`, asked to the gateway.
/// Empty when this container is not behind the gateway, or the person has none.
pub async fn fetch(s: &AppState, email: &str, missing: &[Fornitore]) -> UserKeys {
    let Some(origin) = s.ritorno.origine_se_dietro_al_gateway() else {
        return UserKeys::default();
    };
    if email.is_empty() || missing.is_empty() {
        return UserKeys::default();
    }
    let mut found = Vec::new();
    for &f in missing {
        let url = url_for(&origin, f.nome(), email);
        // The client adds the container's return key to this call (and to no
        // other address: `gateway/ritorno.rs`, `va_aggiunta`).
        let Ok(client) = crate::remote::costruisci_client(s, &url, 10) else {
            continue;
        };
        match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => {
                if let Some(key) = r
                    .json::<serde_json::Value>()
                    .await
                    .ok()
                    .and_then(|v| v.get("key")?.as_str().map(str::to_string))
                {
                    found.push((f, key));
                }
            }
            // The person has no key for this provider, or is not there: normal.
            Ok(r) if r.status() == reqwest::StatusCode::NOT_FOUND => {}
            Ok(r) => tracing::warn!(
                target: "sws_ai",
                provider = f.nome(),
                status = %r.status(),
                "the gateway did not give the user's AI key"
            ),
            Err(e) => tracing::warn!(
                target: "sws_ai",
                provider = f.nome(),
                "cannot ask the gateway for the user's AI key: {e}"
            ),
        }
    }
    UserKeys::from_pairs(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_address_carries_the_email_and_nothing_else_odd() {
        assert_eq!(
            url_for("https://sws.soligo.net/", "kimi", "m+a@soligo.net"),
            "https://sws.soligo.net/api/internal/ai-key/kimi?user=m%2Ba%40soligo%2Enet"
        );
        // Whatever is in the email stays in the value of `user`.
        let u = url_for("https://x", "kimi", "a&provider=b#c d");
        assert!(
            !u.contains(' ') && !u.contains('#') && u.matches('?').count() == 1,
            "{u}"
        );
        assert_eq!(u.matches('&').count(), 0, "{u}");
    }

    #[test]
    fn the_keys_are_found_by_provider_and_never_printed() {
        let k = UserKeys::from_pairs([(Fornitore::Kimi, "sk-kimi-segretissima".to_string())]);
        assert_eq!(k.get(Fornitore::Kimi), Some("sk-kimi-segretissima"));
        assert_eq!(k.get(Fornitore::Anthropic), None);
        assert!(!k.is_empty() && UserKeys::default().is_empty());
        assert!(!format!("{k:?}").contains("segretissima"));
    }
}
