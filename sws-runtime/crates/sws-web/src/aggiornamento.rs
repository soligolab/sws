//! Aggiornamento del runtime (piano `docs/plans/2026-09-27-aggiornamento-runtime-e-bus-utente.md`, Fase 1).
//!
//! Il runtime sa **che versione è** (compilata dentro) e, dalla variabile
//! `SWS_IMAGE` che l'installer scrive nel quadlet, **che immagine esegue**. Il
//! tag dell'immagine è il **canale**: `latest-<arch>` è lo stabile, `rc-<arch>`
//! la prova. Il registry elenca i tag senza credenziali, quindi il runtime può
//! dire se nel suo canale c'è una versione più nuova.
//!
//! Aggiornare non lo fa lui: un container non può riavviare se stesso. Avvia
//! `podman-auto-update.service` attraverso il **bus utente** di systemd (montato
//! nel container, provato sul TC620 il 27-09-2026); podman scarica l'immagine
//! nuova dietro lo stesso tag, riavvia il servizio e — con `Notify=healthy` nel
//! quadlet — torna alla precedente se la nuova non diventa *healthy*.

use serde::Serialize;
use std::cmp::Ordering;

/// La versione di questo runtime.
pub const VERSIONE: &str = env!("CARGO_PKG_VERSION");

/// Da dove viene l'immagine che gira, e quindi come si aggiorna.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Canale {
    /// `latest-<arch>`: le release.
    Stabile,
    /// `rc-<arch>`: le release e le immagini di prova `-rc`.
    Prova,
    /// Un tag di versione preciso (`2.11.0-arm64`): non segue niente.
    Fissata,
    /// `localhost/…`: installata da archivio, si aggiorna dall'IDE con un archivio.
    Archivio,
    /// `SWS_IMAGE` assente: un PC di sviluppo, un'installazione nativa, un quadlet vecchio.
    Sconosciuto,
}

/// Il riferimento a un'immagine, scomposto: `ghcr.io/soligolab/sws-runtime:latest-arm64`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Riferimento {
    pub host: String,
    pub repo: String,
    pub tag: String,
}

pub fn scomponi(rif: &str) -> Option<Riferimento> {
    let (nome, tag) = rif.rsplit_once(':')?;
    if tag.contains('/') {
        return None; // era la porta di un host, non un tag
    }
    let (host, repo) = nome.split_once('/')?;
    Some(Riferimento { host: host.into(), repo: repo.into(), tag: tag.into() })
}

/// Canale e architettura (il suffisso dei tag: `arm64`, `amd64`, `arm64-generic`).
pub fn canale(rif: Option<&str>) -> (Canale, Option<String>) {
    let Some(r) = rif.and_then(scomponi) else {
        return (Canale::Sconosciuto, None);
    };
    if r.host == "localhost" {
        return (Canale::Archivio, None);
    }
    if let Some(arch) = r.tag.strip_prefix("latest-") {
        return (Canale::Stabile, Some(arch.into()));
    }
    if let Some(arch) = r.tag.strip_prefix("rc-") {
        return (Canale::Prova, Some(arch.into()));
    }
    (Canale::Fissata, None)
}

/// `X.Y.Z` con una pre-release facoltativa (`-rc.N`, `-dev.N`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Versione {
    pub numeri: (u64, u64, u64),
    /// `None` per una release; `Some(("rc", 2))` per `-rc.2`.
    pub pre: Option<(String, u64)>,
}

impl Versione {
    pub fn leggi(s: &str) -> Option<Self> {
        let (base, pre) = match s.split_once('-') {
            Some((b, p)) => (b, Some(p)),
            None => (s, None),
        };
        let mut n = base.split('.').map(|x| x.parse::<u64>().ok());
        let numeri = (n.next()??, n.next()??, n.next()??);
        if n.next().is_some() {
            return None;
        }
        let pre = match pre {
            None => None,
            Some(p) => {
                let (nome, num) = p.split_once('.')?;
                if !nome.chars().all(|c| c.is_ascii_lowercase()) {
                    return None;
                }
                Some((nome.to_string(), num.parse().ok()?))
            }
        };
        Some(Versione { numeri, pre })
    }
}

impl Ord for Versione {
    /// Semver: a parità di numeri una release viene **dopo** ogni sua
    /// pre-release, e `dev` < `rc` (quindi `2.12.0-dev.5` < `2.12.0-rc.1`).
    fn cmp(&self, o: &Self) -> Ordering {
        self.numeri.cmp(&o.numeri).then_with(|| match (&self.pre, &o.pre) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (Some(a), Some(b)) => a.cmp(b),
        })
    }
}
impl PartialOrd for Versione {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

/// La versione più alta, fra i tag del registry, che il canale ammette per
/// quell'architettura: lo stabile solo release, la prova release e `-rc`.
pub fn migliore_nel_canale(tags: &[String], canale: &Canale, arch: &str) -> Option<Versione> {
    let suffisso = format!("-{arch}");
    tags.iter()
        .filter_map(|t| t.strip_suffix(&suffisso))
        .filter_map(Versione::leggi)
        .filter(|v| match (&v.pre, canale) {
            (None, Canale::Stabile | Canale::Prova) => true,
            (Some((p, _)), Canale::Prova) => p == "rc",
            _ => false,
        })
        .max()
}

/// Lo stato per l'IDE.
#[derive(Debug, Clone, Serialize)]
pub struct StatoAggiornamento {
    pub versione: String,
    pub immagine: Option<String>,
    pub canale: Canale,
    /// La versione più nuova del canale, se è più nuova di questa.
    pub disponibile: Option<String>,
    /// Perché `disponibile` non si è potuto sapere (registry irraggiungibile…).
    pub errore: Option<String>,
}

fn formatta(v: &Versione) -> String {
    let (a, b, c) = v.numeri;
    match &v.pre {
        None => format!("{a}.{b}.{c}"),
        Some((p, n)) => format!("{a}.{b}.{c}-{p}.{n}"),
    }
}

/// Elenca i tag dal registry (API v2), prendendo un token anonimo se il
/// registry lo chiede — come fa ghcr.io per le immagini pubbliche.
async fn tag_del_registry(r: &Riferimento) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://{}/v2/{}/tags/list?n=1000", r.host, r.repo);
    let mut risposta = client.get(&url).send().await.map_err(|e| format!("registry non raggiungibile: {e}"))?;
    if risposta.status() == reqwest::StatusCode::UNAUTHORIZED {
        let sfida = risposta
            .headers()
            .get("www-authenticate")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let campo = |k: &str| {
            sfida
                .split(|c| c == ',' || c == ' ')
                .find_map(|p| p.strip_prefix(&format!("{k}=")))
                .map(|v| v.trim_matches('"').to_string())
        };
        let realm = campo("realm").ok_or("il registry chiede un token ma non dice dove")?;
        let mut q = vec![("scope", format!("repository:{}:pull", r.repo))];
        if let Some(s) = campo("service") {
            q.push(("service", s));
        }
        let token: serde_json::Value = client
            .get(&realm)
            .query(&q)
            .send()
            .await
            .map_err(|e| format!("token del registry: {e}"))?
            .json()
            .await
            .map_err(|e| format!("token del registry: {e}"))?;
        let token = token["token"].as_str().or(token["access_token"].as_str()).unwrap_or_default().to_string();
        risposta = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("registry non raggiungibile: {e}"))?;
    }
    if !risposta.status().is_success() {
        return Err(format!("il registry ha risposto {}", risposta.status()));
    }
    let corpo: serde_json::Value = risposta.json().await.map_err(|e| e.to_string())?;
    Ok(corpo["tags"]
        .as_array()
        .map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect())
        .unwrap_or_default())
}

pub async fn stato() -> StatoAggiornamento {
    let immagine = std::env::var("SWS_IMAGE").ok().filter(|s| !s.is_empty());
    let (canale, arch) = canale(immagine.as_deref());
    let mut st = StatoAggiornamento {
        versione: VERSIONE.to_string(),
        immagine: immagine.clone(),
        canale: canale.clone(),
        disponibile: None,
        errore: None,
    };
    let (Some(arch), Some(r)) = (arch, immagine.as_deref().and_then(scomponi)) else {
        return st;
    };
    match tag_del_registry(&r).await {
        Ok(tags) => {
            let questa = Versione::leggi(VERSIONE);
            if let Some(m) = migliore_nel_canale(&tags, &canale, &arch) {
                if questa.map(|q| m > q).unwrap_or(true) {
                    st.disponibile = Some(formatta(&m));
                }
            }
        }
        Err(e) => st.errore = Some(e),
    }
    st
}

/// Avvia `podman-auto-update.service` sul bus utente. Il chiamante deve aver
/// **già risposto**: se l'aggiornamento c'è, questo processo verrà fermato.
pub async fn avvia() -> Result<(), String> {
    let conn = zbus::Connection::session()
        .await
        .map_err(|e| format!("bus utente non raggiungibile (manca il mount nel quadlet?): {e}"))?;
    conn.call_method(
        Some("org.freedesktop.systemd1"),
        "/org/freedesktop/systemd1",
        Some("org.freedesktop.systemd1.Manager"),
        "StartUnit",
        &("podman-auto-update.service", "replace"),
    )
    .await
    .map_err(|e| format!("StartUnit: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Versione {
        Versione::leggi(s).unwrap()
    }

    #[test]
    fn le_versioni_si_ordinano_come_semver() {
        assert!(v("2.12.0") > v("2.12.0-rc.9"));
        assert!(v("2.12.0-rc.1") > v("2.12.0-dev.5"), "rc viene dopo dev: si riparte da rc.1");
        assert!(v("2.12.0-rc.10") > v("2.12.0-rc.9"), "numerico, non alfabetico");
        assert!(v("2.12.1-rc.1") > v("2.12.0"));
        assert!(v("2.10.0") > v("2.9.9"), "numerico anche nei numeri di versione");
        assert_eq!(Versione::leggi("latest"), None);
        assert_eq!(Versione::leggi("2.12"), None);
        assert_eq!(Versione::leggi("a360500"), None);
    }

    #[test]
    fn il_canale_viene_dal_tag() {
        let c = |s: &str| canale(Some(s));
        assert_eq!(c("ghcr.io/soligolab/sws-runtime:latest-arm64"), (Canale::Stabile, Some("arm64".into())));
        assert_eq!(c("ghcr.io/soligolab/sws-runtime:rc-amd64"), (Canale::Prova, Some("amd64".into())));
        assert_eq!(c("ghcr.io/soligolab/sws-runtime:2.11.0-arm64").0, Canale::Fissata);
        assert_eq!(c("localhost/sws-runtime:2.12.0-dev.5-arm64").0, Canale::Archivio);
        assert_eq!(canale(None).0, Canale::Sconosciuto);
        // Un host con la porta non va scambiato per un tag.
        assert_eq!(scomponi("registro:5000/sws-runtime"), None);
        assert_eq!(scomponi("registro:5000/sws-runtime:rc-arm64").unwrap().host, "registro:5000");
    }

    #[test]
    fn ogni_canale_prende_solo_cio_che_gli_spetta() {
        let tags: Vec<String> = [
            "2.11.0-arm64", "2.12.0-rc.2-arm64", "2.12.0-rc.2-amd64", "2.13.0-dev.1-arm64",
            "2.11.0-arm64-generic", "latest-arm64", "rc-arm64", "a360500-arm64", "2.12.0-rc.1-arm64",
        ]
        .map(String::from)
        .to_vec();
        assert_eq!(migliore_nel_canale(&tags, &Canale::Stabile, "arm64"), Some(v("2.11.0")));
        // La prova vede le rc, non le vecchie dev.
        assert_eq!(migliore_nel_canale(&tags, &Canale::Prova, "arm64"), Some(v("2.12.0-rc.2")));
        assert_eq!(migliore_nel_canale(&tags, &Canale::Archivio, "arm64"), None);
        // L'architettura conta: niente amd64 per un pannello arm64.
        assert_eq!(migliore_nel_canale(&tags, &Canale::Stabile, "amd64"), None);
    }

    /// Contro ghcr.io vero: `cargo test -p sws-web --lib aggiornamento -- --ignored`.
    #[tokio::test]
    #[ignore = "richiede la rete"]
    async fn il_registry_pubblico_elenca_i_tag_senza_credenziali() {
        let r = scomponi("ghcr.io/soligolab/sws-runtime:latest-arm64").unwrap();
        let tags = tag_del_registry(&r).await.unwrap();
        assert!(tags.len() > 100, "con ?n=1000 non ci si ferma a 100: {}", tags.len());
        assert!(migliore_nel_canale(&tags, &Canale::Stabile, "arm64").is_some());
    }
}
