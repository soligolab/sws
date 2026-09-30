//! La finestra dell'aggiornamento del runtime (piano
//! `docs/archive/2026-09-27-aggiornamento-runtime-e-bus-utente.md`, Fase 2).
//!
//! Due forme, entrambe del **dispositivo** e non del progetto (decisione 39), in
//! `<config_dir>/aggiornamento.yaml`:
//!
//! - **approvazione una tantum** — «aggiorna alla 2.12.1 domenica alle 3»: quella
//!   versione, quella volta;
//! - **pilota automatico** — «ogni domenica alle 3 installa ciò che c'è di nuovo».
//!
//! L'ora è quella **locale del pannello** (decisione 47): il quadlet dà al
//! container il fuso dell'host con `Timezone=local`, e `chrono::Local` converte
//! giorno + ora in un istante, cambio d'ora compreso.
//!
//! # Perché un'approvazione può annullarsi da sola
//!
//! `podman auto-update` installa la **testa del canale**, non una versione scelta.
//! Se l'Admin approva la 2.12.1 e prima della finestra esce la 2.12.2, aggiornare
//! vorrebbe dire installare una versione che nessuno ha letto. Allora non si
//! aggiorna: l'approvazione cade e l'esito lo dice.

use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const FILE: &str = "aggiornamento.yaml";
/// Una finestra mancata da più di così (pannello spento, runtime fermo) non si
/// recupera: installare alle 11 del mattino un aggiornamento pensato per le 3
/// di notte è proprio la sorpresa che la finestra esiste per evitare.
pub const TOLLERANZA_MS: i64 = 60 * 60 * 1000;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Programma {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approvazione: Option<Approvazione>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pilota: Option<Pilota>,
    /// Com'è andata l'ultima volta che la finestra è scattata (o perché no).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ultimo_esito: Option<String>,
    /// Un aggiornamento chiesto e non ancora concluso (Fase 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_corso: Option<crate::aggiornamento_esito::InCorso>,
    /// L'ultimo aggiornamento concluso, riuscito o no (Fase 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evento: Option<crate::aggiornamento_esito::Evento>,
    /// L'ultima versione nuova già notificata sui canali (29-09-2026: «una volta
    /// per versione», non a ogni avvio).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub versione_notificata: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Approvazione {
    pub versione: String,
    /// L'istante, in millisecondi UTC.
    pub quando_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pilota {
    /// Giorni della settimana, 0 = domenica … 6 = sabato. Vuoto = ogni giorno.
    #[serde(default)]
    pub giorni: Vec<u8>,
    /// `HH:MM`, ora locale del pannello.
    pub ora: String,
}

/// Il giorno come lo sceglie chi programma (decisione 48).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Giorno {
    Nome(GiornoRelativo),
    /// 0 = domenica … 6 = sabato: il prossimo giorno con quel nome.
    Settimana(u8),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GiornoRelativo {
    Oggi,
    Domani,
}

pub fn leggi_ora(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s.trim(), "%H:%M").ok()
}

/// La prima volta, a partire da `adesso`, in cui nel fuso `tz` è `ora` di un
/// giorno che `ammesso` accetta. Cerca otto giorni: una settimana intera più
/// oggi. Un'ora che il cambio d'ora salta (le 2:30 di fine marzo) si prende
/// alla prima ora valida dopo; un'ora doppia (fine ottobre), la prima delle due.
pub fn prossimo<T: TimeZone>(
    adesso: &DateTime<T>,
    ora: NaiveTime,
    ammesso: impl Fn(u8) -> bool,
) -> Option<DateTime<Utc>> {
    let tz = adesso.timezone();
    let oggi = adesso.date_naive();
    for giorni in 0..8 {
        let data = oggi + Duration::days(giorni);
        let settimana = data.weekday().num_days_from_sunday() as u8;
        if !ammesso(settimana) {
            continue;
        }
        let locale = data.and_time(ora);
        let istante = match tz.from_local_datetime(&locale) {
            chrono::LocalResult::Single(t) => t,
            chrono::LocalResult::Ambiguous(prima, _) => prima,
            chrono::LocalResult::None => {
                // Ora saltata dal cambio d'ora: la prima che esiste dopo.
                match tz.from_local_datetime(&(locale + Duration::hours(1))) {
                    chrono::LocalResult::Single(t) | chrono::LocalResult::Ambiguous(t, _) => t,
                    chrono::LocalResult::None => continue,
                }
            }
        };
        if istante > *adesso {
            return Some(istante.with_timezone(&Utc));
        }
    }
    None
}

/// Giorno + ora scelti nell'IDE → l'istante UTC dell'approvazione.
pub fn risolvi<T: TimeZone>(adesso: &DateTime<T>, giorno: Giorno, ora: NaiveTime) -> Option<DateTime<Utc>> {
    let oggi = adesso.date_naive().weekday().num_days_from_sunday() as u8;
    match giorno {
        // «oggi alle 3» quando sono già le 10 non è la settimana prossima: è un errore.
        Giorno::Nome(GiornoRelativo::Oggi) => prossimo(adesso, ora, |g| g == oggi)
            .filter(|t| *t - adesso.with_timezone(&Utc) < Duration::days(1)),
        Giorno::Nome(GiornoRelativo::Domani) => prossimo(adesso, ora, |g| g == (oggi + 1) % 7),
        Giorno::Settimana(n) if n < 7 => prossimo(adesso, ora, |g| g == n),
        Giorno::Settimana(_) => None,
    }
}

/// Il prossimo scatto del pilota automatico.
pub fn prossimo_pilota<T: TimeZone>(adesso: &DateTime<T>, p: &Pilota) -> Option<DateTime<Utc>> {
    let ora = leggi_ora(&p.ora)?;
    prossimo(adesso, ora, |g| p.giorni.is_empty() || p.giorni.contains(&g))
}

/// Cosa fare quando una finestra scatta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Azione {
    Aggiorna,
    /// Non si aggiorna, e il motivo va scritto in `ultimo_esito`.
    Niente(String),
}

/// L'approvazione è scaduta adesso: il canale offre ancora quella versione?
pub fn decidi_approvazione(a: &Approvazione, disponibile: Option<&str>, adesso_ms: i64) -> Azione {
    if adesso_ms - a.quando_ms > TOLLERANZA_MS {
        return Azione::Niente(format!(
            "finestra per la {} mancata (il runtime non era attivo): approvazione annullata",
            a.versione
        ));
    }
    match disponibile {
        Some(v) if v == a.versione => Azione::Aggiorna,
        Some(v) => Azione::Niente(format!(
            "approvata la {}, ma il canale ora offre la {}: nessuno l'ha letta, non aggiorno; approvazione annullata",
            a.versione, v
        )),
        None => Azione::Niente(format!(
            "la {} non è più disponibile nel canale: approvazione annullata",
            a.versione
        )),
    }
}

pub fn percorso(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE)
}

pub async fn carica(config_dir: &Path) -> Programma {
    match tokio::fs::read_to_string(percorso(config_dir)).await {
        Ok(t) => serde_yaml::from_str(&t).unwrap_or_default(),
        Err(_) => Programma::default(),
    }
}

pub async fn salva(config_dir: &Path, p: &Programma) -> std::io::Result<()> {
    let testo = serde_yaml::to_string(p).map_err(std::io::Error::other)?;
    crate::router::scrivi_atomico(&percorso(config_dir), testo.as_bytes()).await
}

/// L'orologio del pannello, per l'IDE (decisione 47: locale **e** UTC).
#[derive(Debug, Clone, Serialize)]
pub struct Orologio {
    pub locale: String,
    pub utc: String,
    /// Lo scostamento da UTC adesso, `+02:00`.
    pub scostamento: String,
}

pub fn orologio() -> Orologio {
    let l = Local::now();
    Orologio {
        locale: l.format("%Y-%m-%d %H:%M").to_string(),
        utc: l.with_timezone(&Utc).format("%Y-%m-%d %H:%M").to_string(),
        scostamento: l.format("%:z").to_string(),
    }
}

/// Un istante UTC mostrato come l'orologio: locale del pannello e UTC.
pub fn come_orologio(ms: i64) -> Option<Orologio> {
    let u = Utc.timestamp_millis_opt(ms).single()?;
    let l = u.with_timezone(&Local);
    Some(Orologio {
        locale: l.format("%Y-%m-%d %H:%M").to_string(),
        utc: u.format("%Y-%m-%d %H:%M").to_string(),
        scostamento: l.format("%:z").to_string(),
    })
}

/// Sveglia il task quando la programmazione cambia (richiesta 51, 28-09-2026):
/// prima dormiva fino al vecchio evento, fino a un'ora, e un pilota appena
/// spostato a fra un minuto sul TC620 non sarebbe scattato.
static RISVEGLIO: tokio::sync::Notify = tokio::sync::Notify::const_new();

/// Da chiamare dopo aver salvato una programmazione nuova.
pub fn sveglia() {
    RISVEGLIO.notify_one();
}

/// Il task che fa scattare le finestre. Dorme fino al prossimo evento, ma mai
/// più di un'ora (l'orologio può cambiare), e si sveglia subito se la
/// programmazione cambia.
pub async fn esegui(config_dir: PathBuf) {
    loop {
        let p = carica(&config_dir).await;
        let adesso = Local::now();
        let ms = adesso.timestamp_millis();
        let prossimo_pilota = p.pilota.as_ref().and_then(|pl| prossimo_pilota(&adesso, pl));
        let scadenze = [
            p.approvazione.as_ref().map(|a| a.quando_ms),
            prossimo_pilota.map(|t| t.timestamp_millis()),
        ];
        let prima = scadenze.iter().flatten().min().copied();

        // Un'approvazione già scaduta (anche da poco) si decide subito.
        if let Some(a) = p.approvazione.clone().filter(|a| a.quando_ms <= ms) {
            scatta_approvazione(&config_dir, p.clone(), a).await;
            continue;
        }

        let attesa_ms = prima.map(|t| (t - ms).max(1_000)).unwrap_or(3_600_000).min(3_600_000);
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(attesa_ms as u64)) => {}
            // Programmazione cambiata: si ricomincia dal giro, con quella nuova.
            _ = RISVEGLIO.notified() => continue,
        }

        // Il pilota: è scattato se il suo istante è passato durante l'attesa.
        if let Some(t) = prossimo_pilota {
            if Local::now().timestamp_millis() >= t.timestamp_millis() {
                scatta_pilota(&config_dir).await;
            }
        }
    }
}

async fn scatta_approvazione(config_dir: &Path, mut p: Programma, a: Approvazione) {
    let st = crate::aggiornamento::stato().await;
    let azione = decidi_approvazione(&a, st.disponibile.as_deref(), Local::now().timestamp_millis());
    // L'approvazione si consuma **prima** di aggiornare: se l'aggiornamento
    // riesce, questo processo viene sostituito e non tornerebbe a toglierla.
    p.approvazione = None;
    p.ultimo_esito = Some(match &azione {
        Azione::Aggiorna => format!("{}: finestra scattata, aggiornamento alla {} avviato", ora_breve(), a.versione),
        Azione::Niente(m) => format!("{}: {m}", ora_breve()),
    });
    if let Err(e) = salva(config_dir, &p).await {
        tracing::warn!("finestra dell'aggiornamento: non riesco a salvare lo stato: {e}");
    }
    tracing::info!(esito = ?p.ultimo_esito, "finestra dell'aggiornamento (approvazione)");
    if azione == Azione::Aggiorna {
        crate::aggiornamento_esito::segna_in_corso(config_dir, &st.versione, Some(a.versione.clone())).await;
        if let Err(e) = crate::aggiornamento::avvia().await {
            tracing::warn!("finestra dell'aggiornamento: avvio non riuscito: {e}");
        }
    }
}

async fn scatta_pilota(config_dir: &Path) {
    let st = crate::aggiornamento::stato().await;
    let mut p = carica(config_dir).await;
    let esito = match (&st.disponibile, &st.errore) {
        (Some(v), _) => format!("{}: pilota automatico, aggiornamento alla {v} avviato", ora_breve()),
        (None, Some(e)) => format!("{}: pilota automatico, registry non raggiungibile: {e}", ora_breve()),
        (None, None) => format!("{}: pilota automatico, nessuna versione nuova", ora_breve()),
    };
    p.ultimo_esito = Some(esito);
    let _ = salva(config_dir, &p).await;
    tracing::info!(esito = ?p.ultimo_esito, "finestra dell'aggiornamento (pilota)");
    if st.disponibile.is_some() {
        crate::aggiornamento_esito::segna_in_corso(config_dir, &st.versione, st.disponibile.clone()).await;
        if let Err(e) = crate::aggiornamento::avvia().await {
            tracing::warn!("pilota automatico: avvio non riuscito: {e}");
        }
    }
}

fn ora_breve() -> String {
    let l = Local::now();
    format!("{} ({} UTC)", l.format("%Y-%m-%d %H:%M"), l.with_timezone(&Utc).format("%H:%M"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    fn roma_estate() -> FixedOffset {
        FixedOffset::east_opt(2 * 3600).unwrap()
    }
    fn t(s: &str) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(s).unwrap()
    }
    fn ora(s: &str) -> NaiveTime {
        leggi_ora(s).unwrap()
    }

    #[test]
    fn domenica_alle_tre_ora_del_pannello() {
        // Lunedì 28-09-2026, 19:33 a Roma (estate, +02:00).
        let adesso = t("2026-09-28T19:33:00+02:00");
        let _ = roma_estate();
        let dom = risolvi(&adesso, Giorno::Settimana(0), ora("03:00")).unwrap();
        // Domenica 04-10 alle 03:00 locali = 01:00 UTC.
        assert_eq!(dom.to_rfc3339(), "2026-10-04T01:00:00+00:00");
        let domani = risolvi(&adesso, Giorno::Nome(GiornoRelativo::Domani), ora("03:00")).unwrap();
        assert_eq!(domani.to_rfc3339(), "2026-09-29T01:00:00+00:00");
        let stasera = risolvi(&adesso, Giorno::Nome(GiornoRelativo::Oggi), ora("23:00")).unwrap();
        assert_eq!(stasera.to_rfc3339(), "2026-09-28T21:00:00+00:00");
    }

    #[test]
    fn oggi_a_un_ora_gia_passata_non_diventa_la_settimana_prossima() {
        let adesso = t("2026-09-28T19:33:00+02:00");
        assert_eq!(risolvi(&adesso, Giorno::Nome(GiornoRelativo::Oggi), ora("03:00")), None);
        // Lo stesso giorno della settimana a un'ora passata è invece la settimana prossima.
        let lun = risolvi(&adesso, Giorno::Settimana(1), ora("03:00")).unwrap();
        assert_eq!(lun.to_rfc3339(), "2026-10-05T01:00:00+00:00");
        assert_eq!(risolvi(&adesso, Giorno::Settimana(7), ora("03:00")), None);
    }

    #[test]
    fn il_pilota_scatta_nel_primo_giorno_ammesso() {
        let adesso = t("2026-09-28T19:33:00+02:00"); // lunedì
        let ogni_giorno = Pilota { giorni: vec![], ora: "03:00".into() };
        assert_eq!(prossimo_pilota(&adesso, &ogni_giorno).unwrap().to_rfc3339(), "2026-09-29T01:00:00+00:00");
        let sab_dom = Pilota { giorni: vec![6, 0], ora: "03:00".into() };
        assert_eq!(prossimo_pilota(&adesso, &sab_dom).unwrap().to_rfc3339(), "2026-10-03T01:00:00+00:00");
        assert_eq!(prossimo_pilota(&adesso, &Pilota { giorni: vec![], ora: "25:00".into() }), None);
    }

    /// Il punto delicato: podman installa la testa del canale, non una versione.
    #[test]
    fn un_approvazione_non_installa_una_versione_che_nessuno_ha_letto() {
        let a = Approvazione { versione: "2.12.1".into(), quando_ms: 1_000 };
        assert_eq!(decidi_approvazione(&a, Some("2.12.1"), 2_000), Azione::Aggiorna);
        assert!(matches!(decidi_approvazione(&a, Some("2.12.2"), 2_000), Azione::Niente(m) if m.contains("2.12.2")));
        assert!(matches!(decidi_approvazione(&a, None, 2_000), Azione::Niente(_)));
        // Finestra mancata di più di un'ora (pannello spento): non si recupera.
        let tardi = 1_000 + TOLLERANZA_MS + 1;
        assert!(matches!(decidi_approvazione(&a, Some("2.12.1"), tardi), Azione::Niente(m) if m.contains("mancata")));
    }

    #[test]
    fn il_programma_si_salva_e_si_rilegge() {
        let p = Programma {
            approvazione: Some(Approvazione { versione: "2.12.1".into(), quando_ms: 42 }),
            pilota: Some(Pilota { giorni: vec![0], ora: "03:00".into() }),
            ..Default::default()
        };
        let y = serde_yaml::to_string(&p).unwrap();
        assert_eq!(serde_yaml::from_str::<Programma>(&y).unwrap(), p);
        // Il giorno arriva dall'IDE come "oggi"/"domani" o come numero.
        assert_eq!(serde_json::from_str::<Giorno>("\"domani\"").unwrap(), Giorno::Nome(GiornoRelativo::Domani));
        assert_eq!(serde_json::from_str::<Giorno>("0").unwrap(), Giorno::Settimana(0));
    }
}

/// Il corpo di `PUT /api/update/schedule`: lo stato voluto, per intero.
#[derive(Debug, Clone, Deserialize)]
pub struct Richiesta {
    pub approvazione: Option<ApprovazioneRichiesta>,
    pub pilota: Option<Pilota>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ApprovazioneRichiesta {
    /// Nuova: giorno + ora del pannello.
    Nuova { versione: String, giorno: Giorno, ora: String },
    /// Già programmata, rimandata com'era.
    Esistente(Approvazione),
}

/// Quello che l'IDE mostra.
#[derive(Debug, Clone, Serialize)]
pub struct Vista {
    pub programma: Programma,
    pub orologio: Orologio,
    /// Quando scatta l'approvazione, come orologio del pannello.
    pub approvazione_alle: Option<Orologio>,
    /// Il prossimo scatto del pilota automatico.
    pub pilota_alle: Option<Orologio>,
}

pub async fn vista(config_dir: &Path) -> Vista {
    let programma = carica(config_dir).await;
    let adesso = Local::now();
    Vista {
        approvazione_alle: programma.approvazione.as_ref().and_then(|a| come_orologio(a.quando_ms)),
        pilota_alle: programma
            .pilota
            .as_ref()
            .and_then(|p| prossimo_pilota(&adesso, p))
            .and_then(|t| come_orologio(t.timestamp_millis())),
        programma,
        orologio: orologio(),
    }
}

/// Applica una richiesta. `disponibile` è la versione che il canale offre
/// adesso: si può approvare solo quella, cioè quella che l'Admin ha letto.
pub fn applica<T: TimeZone>(
    attuale: &Programma,
    r: Richiesta,
    disponibile: Option<&str>,
    adesso: &DateTime<T>,
) -> Result<Programma, String> {
    let mut p = attuale.clone();
    p.approvazione = match r.approvazione {
        None => None,
        Some(ApprovazioneRichiesta::Esistente(a)) => Some(a),
        Some(ApprovazioneRichiesta::Nuova { versione, giorno, ora }) => {
            if disponibile != Some(versione.as_str()) {
                return Err(format!(
                    "si può programmare solo la versione offerta dal canale adesso ({}), non la {versione}",
                    disponibile.unwrap_or("nessuna")
                ));
            }
            let ora = leggi_ora(&ora).ok_or("ora non valida: serve HH:MM")?;
            let quando = risolvi(adesso, giorno, ora)
                .ok_or("quel giorno a quell'ora è già passato")?;
            Some(Approvazione { versione, quando_ms: quando.timestamp_millis() })
        }
    };
    if let Some(pl) = &r.pilota {
        if leggi_ora(&pl.ora).is_none() || pl.giorni.iter().any(|g| *g > 6) {
            return Err("pilota automatico: giorni 0-6 e ora HH:MM".into());
        }
    }
    p.pilota = r.pilota;
    Ok(p)
}

#[cfg(test)]
mod risveglio {
    /// Il task deve accorgersi subito di una programmazione nuova, non dopo
    /// il sonno che aveva calcolato per quella vecchia (fino a un'ora).
    #[tokio::test]
    async fn una_programmazione_nuova_sveglia_il_task() {
        let inizio = std::time::Instant::now();
        let attesa = tokio::spawn(async {
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(3600)) => false,
                _ = super::RISVEGLIO.notified() => true,
            }
        });
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        super::sveglia();
        assert!(attesa.await.unwrap(), "non si è svegliato");
        assert!(inizio.elapsed() < std::time::Duration::from_secs(2));
    }
}

#[cfg(test)]
mod richieste {
    use super::*;

    #[test]
    fn si_approva_solo_la_versione_che_il_canale_offre() {
        let adesso = DateTime::parse_from_rfc3339("2026-09-28T19:33:00+02:00").unwrap();
        let r = |v: &str| Richiesta {
            approvazione: Some(ApprovazioneRichiesta::Nuova {
                versione: v.into(),
                giorno: Giorno::Settimana(0),
                ora: "03:00".into(),
            }),
            pilota: None,
        };
        let ok = applica(&Programma::default(), r("2.12.1"), Some("2.12.1"), &adesso).unwrap();
        assert_eq!(ok.approvazione.unwrap().versione, "2.12.1");
        assert!(applica(&Programma::default(), r("2.12.1"), Some("2.12.2"), &adesso).is_err());
        assert!(applica(&Programma::default(), r("2.12.1"), None, &adesso).is_err());
        // Annullare: approvazione assente nella richiesta.
        let vuota = Richiesta { approvazione: None, pilota: None };
        assert_eq!(applica(&ok_programma(), vuota, None, &adesso).unwrap().approvazione, None);
    }

    fn ok_programma() -> Programma {
        Programma {
            approvazione: Some(Approvazione { versione: "2.12.1".into(), quando_ms: 1 }),
            ..Default::default()
        }
    }

    #[test]
    fn un_pilota_sbagliato_e_rifiutato() {
        let adesso = DateTime::parse_from_rfc3339("2026-09-28T19:33:00+02:00").unwrap();
        let r = Richiesta { approvazione: None, pilota: Some(Pilota { giorni: vec![7], ora: "03:00".into() }) };
        assert!(applica(&Programma::default(), r, None, &adesso).is_err());
    }
}
