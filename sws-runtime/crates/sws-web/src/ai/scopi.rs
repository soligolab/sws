//! Un modello per ogni scopo (piano `docs/archive/2026-11-04-un-modello-per-ogni-scopo.md`).
//!
//! # Perché gli scopi
//!
//! Fino al 04-11-2026 l'IDE aveva **un** modello: quello dell'assistente. La
//! traduzione `Ia` lo riusava, e gli sfondi non c'erano. Ma gli scopi chiedono
//! modelli diversi: comporre una pagina vuole il modello più forte, tradurre
//! un'etichetta il più economico, uno sfondo un modello che fa immagini — che
//! Claude e Kimi non sono.
//!
//! # Dove sta cosa
//!
//! Tutto nell'installazione, in `config_dir/ai.yaml` sotto `scopi:`; le chiavi
//! nei loro file (`anthropic.key`, `kimi.key`, `openai.key`), mai nel progetto.
//! Le regole di contesto invece stanno **nel progetto** (`project.ai`): viaggiano
//! con lui, le chiavi no.
//!
//! # Le ricadute
//!
//! - `assistente`: quello di sempre, con le variabili `SWS_AI_*` che vincono sul
//!   file (`client::carica`).
//! - `simboli` e `traduzione`: se non hanno un fornitore loro, sono l'assistente.
//! - `sfondi`: solo OpenAI, solo se c'è la sua chiave.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::ai::client::{self, Fornitore, Impostazioni, Scelta};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Scopo {
    Assistente,
    Simboli,
    Traduzione,
    Sfondi,
}

impl Scopo {
    pub const TUTTI: [Scopo; 4] = [
        Scopo::Assistente,
        Scopo::Simboli,
        Scopo::Traduzione,
        Scopo::Sfondi,
    ];

    pub fn nome(self) -> &'static str {
        match self {
            Scopo::Assistente => "assistente",
            Scopo::Simboli => "simboli",
            Scopo::Traduzione => "traduzione",
            Scopo::Sfondi => "sfondi",
        }
    }

    pub fn da_nome(s: &str) -> Option<Self> {
        Self::TUTTI.into_iter().find(|x| x.nome() == s.trim())
    }

    /// Lo scopo vuole un modello di testo (Anthropic, Kimi) o di immagini (OpenAI)?
    pub fn immagini(self) -> bool {
        matches!(self, Scopo::Sfondi)
    }
}

/// La scelta salvata per uno scopo. Tutto facoltativo: un campo assente è
/// «come l'assistente» (o il default del fornitore).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScopoCfg {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fornitore: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modello: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tetto_usd: Option<f64>,
    /// Solo per gli sfondi: `low`, `medium`, `high` (gpt-image-2).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qualita: Option<String>,
}

impl Impostazioni {
    /// La scelta dell'assistente: sotto `scopi`, o nel formato di prima.
    pub fn assistente(&self) -> ScopoCfg {
        self.scopi
            .get(Scopo::Assistente.nome())
            .cloned()
            .unwrap_or_else(|| ScopoCfg {
                fornitore: self.fornitore.clone(),
                modello: self.modello.clone(),
                tetto_usd: self.tetto_usd,
                qualita: None,
            })
    }

    /// La scelta salvata di uno scopo, così com'è (`None` = non configurato).
    pub fn scopo(&self, s: Scopo) -> Option<ScopoCfg> {
        match s {
            Scopo::Assistente => Some(self.assistente()).filter(|c| *c != ScopoCfg::default()),
            _ => self.scopi.get(s.nome()).cloned(),
        }
    }

    /// Scrive la scelta di uno scopo; `None` la toglie. L'assistente, scritto
    /// una volta qui, smette di leggersi dal formato vecchio.
    pub fn imposta(&mut self, s: Scopo, cfg: Option<ScopoCfg>) {
        if s == Scopo::Assistente {
            self.fornitore = None;
            self.modello = None;
            self.tetto_usd = None;
        }
        match cfg.filter(|c| *c != ScopoCfg::default()) {
            Some(c) => {
                self.scopi.insert(s.nome().to_string(), c);
            }
            None => {
                self.scopi.remove(s.nome());
            }
        }
    }
}

/// Con chi parla uno scopo di testo. `simboli` e `traduzione` senza un fornitore
/// loro (o con un fornitore senza chiave) sono l'assistente: meglio un modello
/// più caro che uno strumento spento senza dire perché.
pub fn carica_per(config_dir: &Path, s: Scopo) -> Option<Scelta> {
    let assistente = client::carica(config_dir);
    if s == Scopo::Assistente || s.immagini() {
        return assistente;
    }
    let imp = Impostazioni::carica(config_dir);
    let Some(cfg) = imp.scopi.get(s.nome()) else {
        return assistente;
    };
    let Some(f) = cfg.fornitore.as_deref().and_then(Fornitore::da_nome) else {
        return assistente;
    };
    let Some(chiave) = client::chiave_di(config_dir, f) else {
        tracing::warn!(
            scopo = s.nome(),
            fornitore = f.nome(),
            "lo scopo ha un fornitore senza chiave: uso quello dell'assistente"
        );
        return assistente;
    };
    Some(Scelta {
        fornitore: f,
        chiave,
        modello: cfg
            .modello
            .clone()
            .filter(|m| !m.trim().is_empty())
            .unwrap_or_else(|| f.modello_default().to_string()),
        tetto_usd: cfg
            .tetto_usd
            .filter(|t| t.is_finite() && *t > 0.0)
            .or_else(|| assistente.as_ref().map(|a| a.tetto_usd))
            .unwrap_or(client::TETTO_DEFAULT_USD),
    })
}

/// Lo scopo ha una scelta **sua**, diversa dall'assistente? Serve a decidere se
/// la conversazione riceve `disegna_simbolo` (un modello a parte) o
/// `bozza_simbolo` (il modello della conversazione disegna da sé).
pub fn ha_scelta_propria(config_dir: &Path, s: Scopo) -> bool {
    match (carica_per(config_dir, s), client::carica(config_dir)) {
        (Some(a), Some(b)) => a.fornitore != b.fornitore || a.modello != b.modello,
        _ => false,
    }
}

// ── Le immagini ────────────────────────────────────────────────────────────

pub const FILE_CHIAVE_OPENAI: &str = "openai.key";
pub const MODELLO_SFONDI: &str = "gpt-image-2";
pub const TETTO_SFONDI_USD: f64 = 1.0;

/// Con chi si fanno gli sfondi.
#[derive(Clone, Debug)]
pub struct SceltaImmagini {
    pub chiave: String,
    pub modello: String,
    pub qualita: String,
    pub tetto_usd: f64,
}

pub fn chiave_openai(config_dir: &Path) -> Option<String> {
    if let Ok(k) = std::env::var("OPENAI_API_KEY") {
        let k = k.trim().to_string();
        if !k.is_empty() {
            return Some(k);
        }
    }
    crate::segreti::leggi_chiave(&config_dir.join(FILE_CHIAVE_OPENAI))
}

pub fn carica_sfondi(config_dir: &Path) -> Option<SceltaImmagini> {
    let chiave = chiave_openai(config_dir)?;
    let cfg = Impostazioni::carica(config_dir)
        .scopi
        .get(Scopo::Sfondi.nome())
        .cloned()
        .unwrap_or_default();
    Some(SceltaImmagini {
        chiave,
        modello: cfg
            .modello
            .filter(|m| !m.trim().is_empty())
            .unwrap_or_else(|| MODELLO_SFONDI.to_string()),
        qualita: cfg
            .qualita
            .filter(|q| matches!(q.as_str(), "low" | "medium" | "high"))
            .unwrap_or_else(|| "medium".to_string()),
        tetto_usd: cfg
            .tetto_usd
            .filter(|t| t.is_finite() && *t > 0.0)
            .unwrap_or(TETTO_SFONDI_USD),
    })
}

// ── I fornitori, per il menù ───────────────────────────────────────────────

/// I fornitori che il menù IA conosce: id, nome da mostrare, cosa sanno fare.
pub const FORNITORI: [(&str, &str, &[&str]); 3] = [
    (
        "anthropic",
        "Anthropic (Claude)",
        &["assistente", "simboli", "traduzione"],
    ),
    (
        "kimi",
        "Moonshot (Kimi)",
        &["assistente", "simboli", "traduzione"],
    ),
    ("openai", "OpenAI (immagini)", &["sfondi"]),
];

pub fn ha_chiave(config_dir: &Path, fornitore: &str) -> bool {
    match fornitore {
        "openai" => chiave_openai(config_dir).is_some(),
        f => Fornitore::da_nome(f).is_some_and(|f| client::ha_chiave(config_dir, f)),
    }
}

pub fn file_chiave(fornitore: &str) -> Option<&'static str> {
    match fornitore {
        "openai" => Some(FILE_CHIAVE_OPENAI),
        f => Fornitore::da_nome(f).map(|f| f.file_chiave()),
    }
}

/// «Prova la chiave»: una chiamata gratuita, l'elenco dei modelli. Torna gli id
/// dei modelli (utili come proposte nel menù) o l'errore del fornitore.
pub async fn prova_chiave(config_dir: &Path, fornitore: &str) -> Result<Vec<String>, String> {
    let (url, chiave) = match fornitore {
        "openai" => (
            "https://api.openai.com/v1/models",
            chiave_openai(config_dir),
        ),
        "anthropic" => (
            "https://api.anthropic.com/v1/models",
            client::chiave_di(config_dir, Fornitore::Anthropic),
        ),
        "kimi" => (
            "https://api.moonshot.ai/v1/models",
            client::chiave_di(config_dir, Fornitore::Kimi),
        ),
        _ => return Err(format!("fornitore `{fornitore}` sconosciuto")),
    };
    let chiave = chiave.ok_or_else(|| "nessuna chiave salvata".to_string())?;
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = http.get(url);
    req = if fornitore == "anthropic" {
        req.header("x-api-key", &chiave)
            .header("anthropic-version", "2023-06-01")
    } else {
        req.header("Authorization", format!("Bearer {chiave}"))
    };
    let r = req
        .send()
        .await
        .map_err(|e| format!("il fornitore non risponde: {e}"))?;
    let stato = r.status();
    let corpo: serde_json::Value = r.json().await.unwrap_or_default();
    if !stato.is_success() {
        let msg = corpo
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .unwrap_or("");
        return Err(format!("HTTP {}: {msg}", stato.as_u16()));
    }
    let mut ids: Vec<String> = corpo
        .get("data")
        .and_then(|d| d.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scrivi(dir: &Path, yaml: &str) {
        std::fs::write(dir.join("ai.yaml"), yaml).unwrap();
    }

    #[test]
    fn il_formato_vecchio_e_l_assistente() {
        let d = tempfile::tempdir().unwrap();
        scrivi(
            d.path(),
            "fornitore: kimi\nmodello: kimi-k3\ntetto_usd: 4\n",
        );
        let imp = Impostazioni::carica(d.path());
        let a = imp.assistente();
        assert_eq!(a.fornitore.as_deref(), Some("kimi"));
        assert_eq!(a.modello.as_deref(), Some("kimi-k3"));
        assert_eq!(a.tetto_usd, Some(4.0));
    }

    #[test]
    fn scrivere_l_assistente_migra_il_formato_vecchio() {
        let d = tempfile::tempdir().unwrap();
        scrivi(d.path(), "fornitore: kimi\nmodello: kimi-k3\n");
        let mut imp = Impostazioni::carica(d.path());
        imp.imposta(
            Scopo::Assistente,
            Some(ScopoCfg {
                fornitore: Some("anthropic".into()),
                ..Default::default()
            }),
        );
        imp.salva(d.path()).unwrap();
        let testo = std::fs::read_to_string(d.path().join("ai.yaml")).unwrap();
        assert!(
            !testo.contains("kimi"),
            "il formato vecchio non deve restare: {testo}"
        );
        assert!(testo.contains("scopi:") && testo.contains("anthropic"));
    }

    #[test]
    fn togliere_uno_scopo_lo_fa_ricadere() {
        let mut imp = Impostazioni::default();
        imp.imposta(
            Scopo::Traduzione,
            Some(ScopoCfg {
                fornitore: Some("anthropic".into()),
                modello: Some("claude-haiku-5-5".into()),
                ..Default::default()
            }),
        );
        assert!(imp.scopo(Scopo::Traduzione).is_some());
        imp.imposta(Scopo::Traduzione, None);
        assert!(imp.scopo(Scopo::Traduzione).is_none());
        // Una scelta vuota è come nessuna scelta.
        imp.imposta(Scopo::Simboli, Some(ScopoCfg::default()));
        assert!(imp.scopi.is_empty());
    }

    #[test]
    fn un_campo_sconosciuto_in_uno_scopo_non_passa() {
        let e = serde_yaml::from_str::<ScopoCfg>("fornitore: kimi\nchiave: segreta\n");
        assert!(e.is_err(), "la chiave non deve poter finire in ai.yaml");
    }

    #[test]
    fn i_nomi_degli_scopi_vanno_e_tornano() {
        for s in Scopo::TUTTI {
            assert_eq!(Scopo::da_nome(s.nome()), Some(s));
        }
        assert_eq!(Scopo::da_nome("immagini"), None);
        assert!(Scopo::Sfondi.immagini() && !Scopo::Traduzione.immagini());
    }

    #[test]
    fn gli_sfondi_vogliono_la_chiave_openai() {
        let d = tempfile::tempdir().unwrap();
        // Se l'ambiente di chi lancia i test ha OPENAI_API_KEY, il caso «senza
        // chiave» non si può provare qui.
        if std::env::var_os("OPENAI_API_KEY").is_none() {
            assert!(carica_sfondi(d.path()).is_none());
        }
        std::fs::write(
            d.path().join(FILE_CHIAVE_OPENAI),
            "sk-prova-0123456789abcdef",
        )
        .unwrap();
        scrivi(
            d.path(),
            "scopi:\n  sfondi: {qualita: altissima, tetto_usd: 2}\n",
        );
        let s = carica_sfondi(d.path()).unwrap();
        assert_eq!(s.modello, MODELLO_SFONDI);
        assert_eq!(
            s.qualita, "medium",
            "una qualità che non esiste torna al default"
        );
        assert_eq!(s.tetto_usd, 2.0);
    }
}
