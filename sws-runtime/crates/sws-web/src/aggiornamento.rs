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
        // La vecchia numerazione a calendario (`2026.7.0`, fino a luglio 2026)
        // è ancora nel registry e in semver batterebbe ogni `2.x`: il TC620, il
        // 28-09, dava «disponibile: 2026.7.0» a una 2.12.0-rc.1.
        .filter(|v| v.numeri.0 < 1000)
        .filter(|v| match (&v.pre, canale) {
            (None, Canale::Stabile | Canale::Prova) => true,
            (Some((p, _)), Canale::Prova) => p == "rc",
            _ => false,
        })
        .max()
}

/// Le versioni del canale **più nuove di quella installata**, dalla più
/// vecchia alla più nuova.
///
/// Saltando da una 2.12.0 a una 2.12.3 le novità — e soprattutto gli avvisi di
/// compatibilità — delle due versioni in mezzo sono quelle che nessuno
/// leggerebbe mai, ed è esattamente il caso in cui servono (decisione 42).
pub fn versioni_dopo(tags: &[String], canale: &Canale, arch: &str, questa: Option<&Versione>) -> Vec<Versione> {
    let suffisso = format!("-{arch}");
    let mut v: Vec<Versione> = tags
        .iter()
        .filter_map(|t| t.strip_suffix(&suffisso))
        .filter_map(Versione::leggi)
        .filter(|v| v.numeri.0 < 1000)
        .filter(|v| match (&v.pre, canale) {
            (None, Canale::Stabile | Canale::Prova) => true,
            (Some((p, _)), Canale::Prova) => p == "rc",
            _ => false,
        })
        .filter(|v| questa.map(|q| v > q).unwrap_or(true))
        .collect();
    v.sort();
    v.dedup();
    v
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
    /// Cosa cambia, letto dalle etichette delle versioni da attraversare:
    /// una voce per versione, dalla più vecchia alla più nuova.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub novita: Vec<NovitaVersione>,
}

/// Le novità di una versione, come viaggiano dentro la sua immagine.
#[derive(Debug, Clone, Serialize)]
pub struct NovitaVersione {
    pub versione: String,
    /// La sezione di CHANGELOG di quella versione.
    pub testo: String,
    /// I soli avvisi di compatibilità, che la finestra mette in cima.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub compatibilita: String,
}

fn formatta(v: &Versione) -> String {
    let (a, b, c) = v.numeri;
    match &v.pre {
        None => format!("{a}.{b}.{c}"),
        Some((p, n)) => format!("{a}.{b}.{c}-{p}.{n}"),
    }
}

/// Una GET al registry (API v2), prendendo un token anonimo se il registry lo
/// chiede — come fa ghcr.io per le immagini pubbliche.
///
/// Sta in una funzione sua perché i chiamanti sono due — l'elenco dei tag e le
/// etichette di un'immagine — e la danza del 401 è la parte che si sbaglia:
/// scritta due volte, la seconda copia non riceve le correzioni della prima.
async fn get_registry(r: &Riferimento, percorso: &str, accept: Option<&str>) -> Result<reqwest::Response, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://{}/v2/{}/{}", r.host, r.repo, percorso);
    let con_accept = |b: reqwest::RequestBuilder| match accept {
        Some(a) => b.header(reqwest::header::ACCEPT, a),
        None => b,
    };
    let risposta = con_accept(client.get(&url))
        .send()
        .await
        .map_err(|e| format!("registry non raggiungibile: {e}"))?;
    if risposta.status() != reqwest::StatusCode::UNAUTHORIZED {
        return Ok(risposta);
    }
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
    let token = token["token"]
        .as_str()
        .or(token["access_token"].as_str())
        .unwrap_or_default()
        .to_string();
    con_accept(client.get(&url))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("registry non raggiungibile: {e}"))
}

/// Elenca i tag dal registry.
async fn tag_del_registry(r: &Riferimento) -> Result<Vec<String>, String> {
    let risposta = get_registry(r, "tags/list?n=1000", None).await?;
    if !risposta.status().is_success() {
        return Err(format!("il registry ha risposto {}", risposta.status()));
    }
    let corpo: serde_json::Value = risposta.json().await.map_err(|e| e.to_string())?;
    Ok(corpo["tags"]
        .as_array()
        .map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect())
        .unwrap_or_default())
}

/// I tipi di manifest che ghcr può rispondere. Senza questo `Accept` il
/// registry manda la v1 deprecata, che non ha il config blob dove vivono le
/// etichette.
const ACCETTA_MANIFEST: &str = "application/vnd.oci.image.manifest.v1+json,\
application/vnd.docker.distribution.manifest.v2+json,\
application/vnd.oci.image.index.v1+json,\
application/vnd.docker.distribution.manifest.list.v2+json";

/// Le etichette OCI di un'immagine del registry, **senza scaricarla**.
///
/// Le etichette non stanno nel manifest ma nel *config blob*, che il manifest
/// nomina: due richieste e pochi KB, contro le centinaia di MB di un pull.
/// È così che il runtime legge le novità di una versione prima di installarla
/// (decisione 42, 28-09-2026).
async fn etichette(r: &Riferimento, tag: &str) -> Result<std::collections::HashMap<String, String>, String> {
    let risposta = get_registry(r, &format!("manifests/{tag}"), Some(ACCETTA_MANIFEST)).await?;
    if !risposta.status().is_success() {
        return Err(format!("manifest {tag}: il registry ha risposto {}", risposta.status()));
    }
    let manifest: serde_json::Value = risposta.json().await.map_err(|e| e.to_string())?;
    let digest = manifest["config"]["digest"]
        .as_str()
        .ok_or("il manifest non nomina un config blob")?
        .to_string();
    let blob = get_registry(r, &format!("blobs/{digest}"), None).await?;
    if !blob.status().is_success() {
        return Err(format!("config blob: il registry ha risposto {}", blob.status()));
    }
    let config: serde_json::Value = blob.json().await.map_err(|e| e.to_string())?;
    let mappa = config["config"]["Labels"]
        .as_object()
        .or_else(|| config["config"]["labels"].as_object())
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default();
    Ok(mappa)
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
        novita: Vec::new(),
    };
    let (Some(arch), Some(r)) = (arch, immagine.as_deref().and_then(scomponi)) else {
        return st;
    };
    match tag_del_registry(&r).await {
        Ok(tags) => {
            let questa = Versione::leggi(VERSIONE);
            if let Some(m) = migliore_nel_canale(&tags, &canale, &arch) {
                if questa.as_ref().map(|q| &m > q).unwrap_or(true) {
                    st.disponibile = Some(formatta(&m));
                    st.novita = novita_da_attraversare(&r, &tags, &canale, &arch, questa.as_ref()).await;
                }
            }
        }
        Err(e) => st.errore = Some(e),
    }
    st
}

/// Il massimo di versioni di cui si leggono le etichette in un colpo.
///
/// Ognuna costa due richieste al registry. Un dispositivo rimasto indietro di
/// venti versioni non deve far aspettare mezzo minuto chi apre la scheda: si
/// leggono le più recenti, che sono quelle che descrivono dove si arriva.
const TETTO_NOVITA: usize = 5;

/// Le novità delle versioni da attraversare, dalla più vecchia alla più nuova.
///
/// Un errore su una singola versione non è un errore dell'aggiornamento: si
/// salta quella voce. Meglio mostrare tre novità su quattro che una finestra
/// rossa al posto di tutto.
async fn novita_da_attraversare(
    r: &Riferimento,
    tags: &[String],
    canale: &Canale,
    arch: &str,
    questa: Option<&Versione>,
) -> Vec<NovitaVersione> {
    let mut da_leggere = versioni_dopo(tags, canale, arch, questa);
    if da_leggere.len() > TETTO_NOVITA {
        da_leggere = da_leggere.split_off(da_leggere.len() - TETTO_NOVITA);
    }
    let mut fuori = Vec::new();
    for v in da_leggere {
        let nome = formatta(&v);
        let Ok(e) = etichette(r, &format!("{nome}-{arch}")).await else { continue };
        let testo = e.get("net.soligo.sws.changelog").cloned().unwrap_or_default();
        let compatibilita = e.get("net.soligo.sws.compat").cloned().unwrap_or_default();
        if testo.is_empty() && compatibilita.is_empty() {
            continue; // un'immagine costruita prima della decisione 42
        }
        fuori.push(NovitaVersione { versione: nome, testo, compatibilita });
    }
    fuori
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

    /// Le versioni da attraversare per arrivare all'ultima: servono perché gli
    /// avvisi di compatibilità di una versione **saltata** sono quelli che
    /// nessuno leggerebbe mai (decisione 42, 28-09-2026).
    #[test]
    fn le_versioni_da_attraversare_sono_quelle_in_mezzo() {
        let tags: Vec<String> = ["2.12.0-arm64", "2.12.1-arm64", "2.12.2-arm64",
                                 "2.11.0-arm64", "2.12.1-amd64"]
            .iter().map(|s| s.to_string()).collect();
        let dopo = versioni_dopo(&tags, &Canale::Stabile, "arm64", Some(&v("2.12.0")));
        let nomi: Vec<String> = dopo.iter().map(formatta).collect();
        assert_eq!(nomi, vec!["2.12.1", "2.12.2"], "dalla più vecchia alla più nuova, e senza l'installata");

        // L'architettura sbagliata non entra: `2.12.1-amd64` c'era apposta.
        assert!(!nomi.iter().any(|n| n.contains("amd")));
    }

    #[test]
    fn il_canale_stabile_non_attraversa_le_rc() {
        let tags: Vec<String> = ["2.12.1-rc.1-arm64", "2.12.1-arm64"]
            .iter().map(|s| s.to_string()).collect();
        let stabile = versioni_dopo(&tags, &Canale::Stabile, "arm64", Some(&v("2.12.0")));
        assert_eq!(stabile.iter().map(formatta).collect::<Vec<_>>(), vec!["2.12.1"]);
        let prova = versioni_dopo(&tags, &Canale::Prova, "arm64", Some(&v("2.12.0")));
        assert_eq!(prova.len(), 2, "il canale di prova attraversa anche le rc");
    }

    /// La numerazione a calendario è ancora nel registry e in semver batterebbe
    /// ogni 2.x: la stessa trappola che il 28-09 dava «disponibile: 2026.7.0».
    #[test]
    fn la_numerazione_a_calendario_non_si_attraversa() {
        let tags: Vec<String> = ["2026.7.0-arm64", "2.12.1-arm64"]
            .iter().map(|s| s.to_string()).collect();
        let dopo = versioni_dopo(&tags, &Canale::Stabile, "arm64", Some(&v("2.12.0")));
        assert_eq!(dopo.iter().map(formatta).collect::<Vec<_>>(), vec!["2.12.1"]);
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
        // La numerazione a calendario di luglio non è «più nuova».
        let con_calendario: Vec<String> =
            tags.iter().cloned().chain(["2026.7.0-arm64".to_string()]).collect();
        assert_eq!(migliore_nel_canale(&con_calendario, &Canale::Stabile, "arm64"), Some(v("2.11.0")));
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
