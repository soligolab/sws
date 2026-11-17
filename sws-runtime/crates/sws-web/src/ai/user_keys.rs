//! The AI keys of the user who is writing in the chat, asked to the gateway
//! for one session (seed `docs/archive/2026-11-12-chiavi-ia-nel-profilo-utente.md`;
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
//!
//! Since 16-11-2026 the gateway also gives the model the user prefers for each
//! provider, and OpenAI (backgrounds) is one of them. The model is asked for
//! every provider, the key only for those the project has none of.
//!
//! Since 17-11-2026 also the provider the user prefers, one for text and one
//! for images (`GET /api/internal/ai-preferences`): it counts only where the
//! project chose none (`client::carica_con`, `scopi::carica_sfondi_con`).

use crate::ai::client::Fornitore;
use crate::router::AppState;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use std::collections::BTreeMap;
use std::sync::Arc;

/// The providers the gateway is asked about: those of the AI menu (Black
/// Forest Labs for the backgrounds since G5, 16-11-2026).
pub const PROVIDERS: [&str; 5] = ["anthropic", "kimi", "mistral", "openai", "bfl"];

#[derive(Clone, Default)]
struct Entry {
    key: Option<String>,
    model: Option<String>,
}

/// The keys and preferred models of the user, by provider name, and their
/// preferred providers. Empty (the default) = none, and the chat works as
/// before.
#[derive(Clone, Default)]
pub struct UserKeys {
    entries: Arc<BTreeMap<String, Entry>>,
    preferred_text: Option<String>,
    preferred_images: Option<String>,
}

// Never printed, not even by accident in a debug line.
impl std::fmt::Debug for UserKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let keys = self.entries.values().filter(|e| e.key.is_some()).count();
        write!(f, "UserKeys({keys} keys)")
    }
}

impl UserKeys {
    pub fn from_pairs(pairs: impl IntoIterator<Item = (Fornitore, String)>) -> Self {
        Self::from_entries(pairs.into_iter().map(|(f, k)| (f.nome(), Some(k), None)))
    }

    /// `(provider, key, model)`.
    pub fn from_entries<'a>(
        entries: impl IntoIterator<Item = (&'a str, Option<String>, Option<String>)>,
    ) -> Self {
        UserKeys {
            entries: Arc::new(
                entries
                    .into_iter()
                    .map(|(p, key, model)| (p.to_string(), Entry { key, model }))
                    .collect(),
            ),
            ..Default::default()
        }
    }

    /// The same, with the providers the user prefers for text and images.
    pub fn with_preferences(mut self, text: Option<String>, images: Option<String>) -> Self {
        self.preferred_text = text;
        self.preferred_images = images;
        self
    }

    /// The provider the user prefers for the text purposes, if any.
    pub fn preferred_text(&self) -> Option<&str> {
        self.preferred_text.as_deref()
    }

    /// The provider the user prefers for the backgrounds, if any.
    pub fn preferred_images(&self) -> Option<&str> {
        self.preferred_images.as_deref()
    }

    pub fn get(&self, f: Fornitore) -> Option<&str> {
        self.key_of(f.nome())
    }

    /// The key by provider name: `openai` too.
    pub fn key_of(&self, provider: &str) -> Option<&str> {
        self.entries.get(provider)?.key.as_deref()
    }

    /// The model the user prefers for `provider`, if any.
    pub fn model_of(&self, provider: &str) -> Option<&str> {
        self.entries.get(provider)?.model.as_deref()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty() && self.preferred_text.is_none() && self.preferred_images.is_none()
    }
}

/// The address the container calls on the gateway. `key = false`: only the
/// preferred model, the project has a key of its own.
pub fn url_for(origin: &str, provider: &str, email: &str, key: bool) -> String {
    format!(
        "{}/api/internal/ai-key/{provider}?user={}{}",
        origin.trim_end_matches('/'),
        utf8_percent_encode(email, NON_ALPHANUMERIC),
        if key { "" } else { "&key=0" }
    )
}

/// The address of the user's preferred providers on the gateway.
pub fn preferences_url(origin: &str, email: &str) -> String {
    format!(
        "{}/api/internal/ai-preferences?user={}",
        origin.trim_end_matches('/'),
        utf8_percent_encode(email, NON_ALPHANUMERIC),
    )
}

/// Whether the project has a key of its own for `provider`.
pub fn project_has_key(config_dir: &std::path::Path, provider: &str) -> bool {
    crate::ai::scopi::ha_chiave(config_dir, provider)
}

/// The preferred model of `email` for every provider, and the key for those the
/// project has none of, asked to the gateway; then, with one more call, the
/// providers the person prefers. Empty when this container is not behind the
/// gateway, or the person has nothing there.
pub async fn fetch_all(s: &AppState, email: &str) -> UserKeys {
    let Some(origin) = s.ritorno.origine_se_dietro_al_gateway() else {
        return UserKeys::default();
    };
    if email.is_empty() {
        return UserKeys::default();
    }
    let mut found = Vec::new();
    for p in PROVIDERS {
        let want_key = !project_has_key(&s.config_dir, p);
        let url = url_for(&origin, p, email, want_key);
        // The client adds the container's return key to this call (and to no
        // other address: `gateway/ritorno.rs`, `va_aggiunta`).
        let Ok(client) = crate::remote::costruisci_client(s, &url, 10) else {
            continue;
        };
        match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => {
                let v = r.json::<serde_json::Value>().await.unwrap_or_default();
                let text = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
                let key = text("key").filter(|_| want_key);
                let model = text("model");
                if key.is_some() || model.is_some() {
                    found.push((p, key, model));
                }
            }
            // The person has no key for this provider, or is not there: normal.
            Ok(r) if r.status() == reqwest::StatusCode::NOT_FOUND => {}
            Ok(r) => tracing::warn!(
                target: "sws_ai",
                provider = p,
                status = %r.status(),
                "the gateway did not give the user's AI key"
            ),
            Err(e) => tracing::warn!(
                target: "sws_ai",
                provider = p,
                "cannot ask the gateway for the user's AI key: {e}"
            ),
        }
    }
    let (text, images) = fetch_preferences(s, &origin, email).await;
    UserKeys::from_entries(found).with_preferences(text, images)
}

/// The providers `email` prefers for text and images. Nothing on any error:
/// without a preference the fixed order holds, as before.
async fn fetch_preferences(
    s: &AppState,
    origin: &str,
    email: &str,
) -> (Option<String>, Option<String>) {
    let url = preferences_url(origin, email);
    let Ok(client) = crate::remote::costruisci_client(s, &url, 10) else {
        return (None, None);
    };
    match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => {
            let v = r.json::<serde_json::Value>().await.unwrap_or_default();
            let text = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
            (text("text"), text("images"))
        }
        // The person is not there, as far as the gateway knows: normal.
        Ok(r) if r.status() == reqwest::StatusCode::NOT_FOUND => (None, None),
        Ok(r) => {
            tracing::warn!(
                target: "sws_ai",
                status = %r.status(),
                "the gateway did not give the user's preferred AI providers"
            );
            (None, None)
        }
        Err(e) => {
            tracing::warn!(
                target: "sws_ai",
                "cannot ask the gateway for the user's preferred AI providers: {e}"
            );
            (None, None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The container asks the gateway about the providers of the AI menu, all
    /// of them but the local model: a provider added there and forgotten here
    /// would have account keys that no chat ever uses. The local model is not
    /// in the account (the cloud does not reach the customer's network).
    #[test]
    fn the_providers_asked_are_those_of_the_menu() {
        let menu: Vec<&str> = crate::ai::scopi::FORNITORI
            .iter()
            .map(|(id, _, _)| *id)
            .filter(|id| *id != "local")
            .collect();
        assert_eq!(PROVIDERS.to_vec(), menu);
        assert!(PROVIDERS.contains(&"mistral"));
        assert!(!PROVIDERS.contains(&"local"));
    }

    #[test]
    fn the_address_carries_the_email_and_nothing_else_odd() {
        assert_eq!(
            url_for("https://sws.soligo.net/", "kimi", "m+a@soligo.net", true),
            "https://sws.soligo.net/api/internal/ai-key/kimi?user=m%2Ba%40soligo%2Enet"
        );
        assert!(url_for("https://x", "openai", "m@x", false).ends_with("&key=0"));
        // Whatever is in the email stays in the value of `user`.
        let u = url_for("https://x", "kimi", "a&provider=b#c d", true);
        assert!(
            !u.contains(' ') && !u.contains('#') && u.matches('?').count() == 1,
            "{u}"
        );
        assert_eq!(u.matches('&').count(), 0, "{u}");
    }

    #[test]
    fn the_preferences_address_carries_only_the_email() {
        assert_eq!(
            preferences_url("https://sws.soligo.net/", "m+a@soligo.net"),
            "https://sws.soligo.net/api/internal/ai-preferences?user=m%2Ba%40soligo%2Enet"
        );
        // It is one the container's return key is added to, and only there.
        assert!(crate::gateway::ritorno::va_aggiunta(
            &preferences_url("https://sws.soligo.net", "a&text=b"),
            "https://sws.soligo.net"
        ));
    }

    #[test]
    fn a_preference_alone_is_not_empty() {
        let k = UserKeys::default().with_preferences(Some("mistral".into()), None);
        assert!(!k.is_empty());
        assert_eq!(
            (k.preferred_text(), k.preferred_images()),
            (Some("mistral"), None)
        );
        assert_eq!(k.key_of("mistral"), None);
    }

    #[test]
    fn the_keys_are_found_by_provider_and_never_printed() {
        let k = UserKeys::from_pairs([(Fornitore::Kimi, "sk-kimi-segretissima".to_string())]);
        assert_eq!(k.get(Fornitore::Kimi), Some("sk-kimi-segretissima"));
        assert_eq!(k.get(Fornitore::Anthropic), None);
        assert!(!k.is_empty() && UserKeys::default().is_empty());
        assert!(!format!("{k:?}").contains("segretissima"));
    }

    #[test]
    fn a_model_without_a_key_and_openai_are_kept() {
        let k = UserKeys::from_entries([
            ("anthropic", None, Some("claude-x".to_string())),
            ("openai", Some("sk-oa".to_string()), None),
        ]);
        assert_eq!(k.get(Fornitore::Anthropic), None);
        assert_eq!(k.model_of("anthropic"), Some("claude-x"));
        assert_eq!(k.key_of("openai"), Some("sk-oa"));
    }
}
