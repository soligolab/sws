//! Dopo un aggiornamento: confermare, rimandare o tornare indietro (03-10-2026,
//! piano `docs/archive/2026-10-03-pulizia-immagini-dopo-aggiornamento.md`).
//!
//! Dopo [`CONFERMA_S`] secondi di vita il runtime fa girare `immagini.sh stato`
//! sull'host (servizio transitorio sul bus utente): lo script registra
//! l'immagine che gira e, se è cambiata dall'ultima volta, si ricorda la
//! precedente. Se c'è una precedente non ancora confermata, si apre la
//! **domanda**, nell'IDE e sul pannello, con quattro risposte (decisione del
//! maintainer del 03-10-2026):
//!
//! - **pulisci**: toglie le immagini vecchie (tiene la precedente) e
//!   l'istantanea dei dati;
//! - **dopo il prossimo riavvio**: la pulizia parte da sola al prossimo avvio
//!   riuscito — per chi vuole una verifica più sicura;
//! - **più tardi**: la domanda torna al prossimo avvio;
//! - **ritorna**: immagine e dati di prima (`immagini.sh ritorna`). La versione
//!   scartata si ricorda in `aggiornamento.yaml`, e finestra e pilota
//!   automatico non ci tornano da soli.
//!
//! [`CONFERMA_S`]: crate::aggiornamento_esito::CONFERMA_S

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const SCRIPT: &str = "immagini.sh";
const DIR_COPIA: &str = "pulizia";
const FILE_STATO: &str = "conferma-aggiornamento.yaml";
const FILE_JSON: &str = "immagini.json";
const FILE_RITORNO: &str = "ritorno.json";

/// Un'immagine come la descrive lo script.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Immagine {
    pub id: String,
    #[serde(default)]
    pub nomi: String,
    #[serde(default)]
    pub versione: String,
    #[serde(default)]
    pub byte: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Pulizia {
    pub quando_ms: i64,
    #[serde(default)]
    pub tolte: Vec<Immagine>,
    #[serde(default)]
    pub liberati_byte: u64,
    #[serde(default)]
    pub istantanea_tolta: bool,
}

/// `immagini.json`, scritto dallo script.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct StatoImmagini {
    pub quando_ms: i64,
    pub attuale: Option<Immagine>,
    pub precedente: Option<Immagine>,
    /// Quante immagini toglierebbe una pulizia adesso. Non i byte: le immagini
    /// condividono gli strati, e sommarli contava lo stesso spazio più volte.
    #[serde(default)]
    pub da_togliere: u32,
    #[serde(default)]
    pub pulizia: Option<Pulizia>,
}

/// `ritorno.json`, scritto dallo script dopo un ritorno.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Ritorno {
    pub quando_ms: i64,
    pub esito: String,
    #[serde(default)]
    pub scartata: String,
    #[serde(default)]
    pub dati: bool,
    #[serde(default)]
    pub motivo: Option<String>,
}

/// Quello che il runtime ricorda fra un avvio e l'altro.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Memoria {
    /// L'immagine (ID) per cui la domanda ha già avuto risposta.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confermata: Option<String>,
    /// «Dopo il prossimo riavvio»: al prossimo avvio riuscito si pulisce.
    #[serde(default)]
    pub pulisci_al_prossimo_avvio: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ultimo_ritorno: Option<Ritorno>,
    /// Si è appena tornati alla versione di prima: l'immagine che gira vale già
    /// come confermata (03-10-2026, collaudo sul TC620 — senza, la versione a cui
    /// si era tornati chiedeva «confermare l'aggiornamento dalla rc.18 alla
    /// rc.17?», con un «Torna alla rc.18» che riportava proprio dove si era
    /// scelto di non stare).
    #[serde(default)]
    pub appena_tornato: bool,
}

/// La domanda aperta, per l'IDE e per il pannello.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Domanda {
    /// La versione da cui si è arrivati (quella a cui «ritorna» riporta).
    pub da: String,
    pub a: String,
    /// C'è l'istantanea dei dati: il ritorno riporta anche quelli.
    pub istantanea: bool,
    pub istantanea_quando_ms: Option<i64>,
    /// Quante immagini toglierebbe «Conferma e pulisci».
    pub da_togliere: u32,
}

/// Lo stato per `/api/system`.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Stato {
    pub domanda: Option<Domanda>,
    /// Una pulizia è prenotata per il prossimo avvio.
    pub pulizia_al_prossimo_avvio: bool,
    pub ultima_pulizia: Option<Pulizia>,
    pub ultimo_ritorno: Option<Ritorno>,
    /// Un'operazione (pulizia o ritorno) è stata lanciata e non ha ancora risposto.
    pub in_corso: Option<String>,
}

static DOMANDA: Mutex<Option<Domanda>> = Mutex::new(None);
static IN_CORSO: Mutex<Option<String>> = Mutex::new(None);

/// La domanda, senza file né D-Bus: c'è una precedente presente e l'attuale non
/// ha ancora avuto risposta.
pub fn decidi_domanda(s: &StatoImmagini, m: &Memoria, versione: &str, ist: Option<&crate::istantanea_dati::Info>) -> Option<Domanda> {
    let att = s.attuale.as_ref()?;
    let prec = s.precedente.as_ref()?;
    if m.confermata.as_deref() == Some(att.id.as_str()) {
        return None;
    }
    Some(Domanda {
        da: if prec.versione.is_empty() { prec.nomi.clone() } else { prec.versione.clone() },
        a: versione.to_string(),
        // L'istantanea vale solo se è stata presa dalla versione a cui si torna.
        istantanea: ist.is_some_and(|i| i.versione == prec.versione),
        istantanea_quando_ms: ist.filter(|i| i.versione == prec.versione).map(|i| i.quando_ms),
        da_togliere: s.da_togliere,
    })
}

/// Il comando del servizio transitorio, con i percorsi dell'host.
pub fn comando(host_config: &str, azione: &str, extra: Option<&str>) -> Vec<String> {
    let h = host_config.trim_end_matches('/');
    let mut v = vec!["/bin/bash".into(), format!("{h}/{DIR_COPIA}/{SCRIPT}"), azione.into(), h.into()];
    if let Some(x) = extra {
        v.push(x.into());
    }
    v
}

fn host_config() -> Option<String> {
    std::env::var("SWS_HOST_CONFIG_DIR").ok().filter(|s| !s.trim().is_empty())
}

async fn leggi<T: for<'de> Deserialize<'de>>(p: &Path) -> Option<T> {
    let t = tokio::fs::read(p).await.ok()?;
    serde_json::from_slice(&t).ok()
}

async fn memoria(config: &Path) -> Memoria {
    match tokio::fs::read_to_string(config.join(FILE_STATO)).await {
        Ok(t) => serde_yaml::from_str(&t).unwrap_or_default(),
        Err(_) => Memoria::default(),
    }
}

async fn salva_memoria(config: &Path, m: &Memoria) {
    if let Ok(t) = serde_yaml::to_string(m) {
        let _ = tokio::fs::write(config.join(FILE_STATO), t).await;
    }
}

/// Lancia `immagini.sh <azione>` sull'host e, se `attendi`, aspetta che lo
/// script riscriva `immagini.json` (fino a 90 s).
async fn lancia(config: &Path, azione: &str, extra: Option<&str>, attendi: bool) -> Result<Option<StatoImmagini>, String> {
    let host = host_config().ok_or("SWS_HOST_CONFIG_DIR assente")?;
    let copia = config.join(DIR_COPIA);
    tokio::fs::create_dir_all(&copia).await.map_err(|e| format!("{}: {e}", copia.display()))?;
    tokio::fs::copy(Path::new(crate::quadlet::DIR_IMMAGINE).join(SCRIPT), copia.join(SCRIPT))
        .await
        .map_err(|e| format!("copia di {SCRIPT}: {e}"))?;
    let prima = chrono::Utc::now().timestamp_millis();
    let utente = zbus::Connection::session().await.map_err(|e| format!("bus utente: {e}"))?;
    let nome = format!("sws-immagini-{azione}-{}.service", chrono::Utc::now().timestamp());
    let descr = format!("SWS: immagini del runtime ({azione})");
    crate::display_target::bus::avvia_transitorio(&utente, &nome, &descr, &comando(&host, azione, extra)).await?;
    if !attendi {
        return Ok(None);
    }
    for _ in 0..90 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        if let Some(s) = leggi::<StatoImmagini>(&config.join(FILE_JSON)).await {
            if s.quando_ms >= prima - 2_000 {
                return Ok(Some(s));
            }
        }
    }
    Err(format!("{SCRIPT} {azione}: nessuna risposta in 90 s (journalctl --user -u 'sws-immagini-*')"))
}

/// Lo stato per l'IDE e il pannello.
pub async fn stato(config: &Path) -> Stato {
    let m = memoria(config).await;
    let s: Option<StatoImmagini> = leggi(&config.join(FILE_JSON)).await;
    Stato {
        domanda: DOMANDA.lock().ok().and_then(|g| g.clone()),
        pulizia_al_prossimo_avvio: m.pulisci_al_prossimo_avvio,
        ultima_pulizia: s.and_then(|s| s.pulizia),
        ultimo_ritorno: m.ultimo_ritorno,
        in_corso: IN_CORSO.lock().ok().and_then(|g| g.clone()),
    }
}

fn imposta_domanda(d: Option<Domanda>) {
    if let Ok(mut g) = DOMANDA.lock() {
        *g = d;
    }
}

fn imposta_in_corso(v: Option<String>) {
    if let Ok(mut g) = IN_CORSO.lock() {
        *g = v;
    }
}

/// Si può fare da qui: su un dispositivo, con lo script nell'immagine.
pub fn disponibile() -> bool {
    host_config().is_some() && Path::new(crate::quadlet::DIR_IMMAGINE).join(SCRIPT).is_file()
}

/// All'avvio di un dispositivo.
pub async fn all_avvio(config: PathBuf) {
    if !disponibile() {
        return;
    }
    let mut m = memoria(&config).await;
    // Un ritorno appena fatto: lo si ricorda, e la versione scartata non torna da sola.
    if let Some(r) = leggi::<Ritorno>(&config.join(FILE_RITORNO)).await {
        tracing::info!(esito = %r.esito, scartata = %r.scartata, dati = r.dati, "ritorno alla versione precedente");
        if r.esito == "riuscito" && !r.scartata.is_empty() {
            crate::aggiornamento_finestra::scarta_versione(&config, Some(r.scartata.clone())).await;
        }
        m.ultimo_ritorno = Some(r);
        // La domanda su questa immagine non ha senso: ci si è appena tornati.
        // L'ID dell'immagine lo dice lo script, al giro di `stato` qui sotto.
        m.appena_tornato = true;
        m.pulisci_al_prossimo_avvio = false;
        salva_memoria(&config, &m).await;
        let _ = tokio::fs::remove_file(config.join(FILE_RITORNO)).await;
    }
    let pulisci_ora = m.pulisci_al_prossimo_avvio;

    // Prima si vive: un avvio che non arriva qui non conferma niente.
    tokio::time::sleep(std::time::Duration::from_secs(crate::aggiornamento_esito::CONFERMA_S)).await;

    let s = match lancia(&config, "stato", None, true).await {
        Ok(Some(s)) => s,
        Ok(None) => return,
        Err(e) => {
            tracing::warn!("immagini: stato non letto: {e}");
            return;
        }
    };
    let versione = crate::aggiornamento::VERSIONE;
    if m.appena_tornato {
        m.appena_tornato = false;
        m.confermata = s.attuale.as_ref().map(|a| a.id.clone());
        salva_memoria(&config, &m).await;
    }
    // Un'istantanea presa da questa stessa versione viene da un aggiornamento
    // che non è avvenuto (podman è tornato indietro da solo) o da un ritorno già
    // fatto: non riporta a niente.
    if crate::istantanea_dati::info(&config).is_some_and(|i| i.versione == versione) {
        tracing::info!("istantanea dei dati della versione che gira: tolta");
        crate::istantanea_dati::togli(&config);
    }
    if pulisci_ora {
        tracing::info!("pulizia delle immagini prenotata al riavvio: parte");
        m.pulisci_al_prossimo_avvio = false;
        m.confermata = s.attuale.as_ref().map(|a| a.id.clone());
        salva_memoria(&config, &m).await;
        if let Err(e) = lancia(&config, "pulisci", None, true).await {
            tracing::warn!("immagini: pulizia non riuscita: {e}");
        }
        return;
    }
    let d = decidi_domanda(&s, &m, versione, crate::istantanea_dati::info(&config).as_ref());
    if let Some(d) = &d {
        tracing::info!(da = %d.da, a = %d.a, istantanea = d.istantanea, "aggiornamento da confermare");
    }
    imposta_domanda(d);
}

/// La risposta alla domanda.
pub async fn scegli(config: &Path, scelta: &str) -> Result<(), String> {
    let d = DOMANDA.lock().ok().and_then(|g| g.clone()).ok_or("Nessun aggiornamento da confermare.")?;
    let mut m = memoria(config).await;
    let s: Option<StatoImmagini> = leggi(&config.join(FILE_JSON)).await;
    let attuale = s.and_then(|s| s.attuale).map(|a| a.id);
    match scelta {
        "pulisci" => {
            m.confermata = attuale;
            salva_memoria(config, &m).await;
            imposta_domanda(None);
            imposta_in_corso(Some("pulisci".into()));
            let r = lancia(config, "pulisci", None, true).await;
            imposta_in_corso(None);
            r.map(|_| ())
        }
        "dopo_riavvio" => {
            m.confermata = attuale;
            m.pulisci_al_prossimo_avvio = true;
            salva_memoria(config, &m).await;
            imposta_domanda(None);
            Ok(())
        }
        "piu_tardi" => {
            imposta_domanda(None);
            Ok(())
        }
        "ritorna" => {
            imposta_in_corso(Some("ritorna".into()));
            tracing::warn!(da = %d.a, a = %d.da, dati = d.istantanea, "ritorno alla versione precedente chiesto");
            // Lo script ferma anche questo processo: non si aspetta.
            lancia(config, "ritorna", Some(&d.a), false).await.map(|_| ())
        }
        altro => Err(format!("scelta sconosciuta: {altro}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn img(id: &str, v: &str) -> Immagine {
        Immagine { id: id.into(), nomi: format!("localhost/sws-runtime:{v}-arm64"), versione: v.into(), byte: 1 }
    }

    fn st(att: &str, prec: Option<&str>) -> StatoImmagini {
        StatoImmagini {
            quando_ms: 1,
            attuale: Some(img(att, "2.12.0-rc.18")),
            precedente: prec.map(|p| img(p, "2.12.0-rc.17")),
            da_togliere: 3,
            pulizia: None,
        }
    }

    #[test]
    fn la_domanda() {
        let m = Memoria::default();
        // Nessuna precedente: niente da chiedere.
        assert!(decidi_domanda(&st("b", None), &m, "2.12.0-rc.18", None).is_none());
        // Una precedente, senza istantanea.
        let d = decidi_domanda(&st("b", Some("a")), &m, "2.12.0-rc.18", None).unwrap();
        assert_eq!((d.da.as_str(), d.a.as_str(), d.istantanea), ("2.12.0-rc.17", "2.12.0-rc.18", false));
        // Con l'istantanea presa dalla precedente.
        let i = crate::istantanea_dati::Info { versione: "2.12.0-rc.17".into(), quando_ms: 7, byte: 1 };
        let d = decidi_domanda(&st("b", Some("a")), &m, "2.12.0-rc.18", Some(&i)).unwrap();
        assert!(d.istantanea);
        assert_eq!(d.istantanea_quando_ms, Some(7));
        // Un'istantanea di un'altra versione non riporta alla precedente.
        let i2 = crate::istantanea_dati::Info { versione: "2.12.0-rc.16".into(), quando_ms: 7, byte: 1 };
        assert!(!decidi_domanda(&st("b", Some("a")), &m, "2.12.0-rc.18", Some(&i2)).unwrap().istantanea);
        // Già risposta per questa immagine.
        let m2 = Memoria { confermata: Some("b".into()), ..Default::default() };
        assert!(decidi_domanda(&st("b", Some("a")), &m2, "2.12.0-rc.18", None).is_none());
        // Risposta per un'immagine diversa: un aggiornamento nuovo, si chiede di nuovo.
        assert!(decidi_domanda(&st("c", Some("b")), &m2, "2.12.0-rc.19", None).is_some());
    }

    #[test]
    fn il_comando_usa_i_percorsi_dell_host() {
        assert_eq!(
            comando("/data/user/sws/config/", "ritorna", Some("2.12.0-rc.18")),
            vec!["/bin/bash", "/data/user/sws/config/pulizia/immagini.sh", "ritorna", "/data/user/sws/config", "2.12.0-rc.18"]
        );
        assert_eq!(comando("/c", "stato", None).len(), 4);
    }

    #[test]
    fn il_json_dello_script_si_legge() {
        let t = r#"{"quando_ms":1759480000000,"attuale":{"id":"66c7","nomi":"localhost/sws-runtime:2.12.0-rc.16-arm64","versione":"2.12.0-rc.16","byte":480000000},"precedente":null,"da_togliere":7,"pulizia":{"quando_ms":1,"tolte":[{"id":"c937","nomi":"","byte":473000000}],"liberati_byte":473000000,"istantanea_tolta":true}}"#;
        let s: StatoImmagini = serde_json::from_str(t).unwrap();
        assert_eq!(s.attuale.unwrap().versione, "2.12.0-rc.16");
        assert!(s.precedente.is_none());
        assert_eq!(s.pulizia.unwrap().tolte.len(), 1);
        let r: Ritorno = serde_json::from_str(r#"{"quando_ms":1,"esito":"riuscito","scartata":"2.12.0-rc.18","dati":true}"#).unwrap();
        assert!(r.dati);
    }
}
