//! L'esito di un aggiornamento del runtime (piano
//! `docs/plans/2026-09-27-aggiornamento-runtime-e-bus-utente.md`, Fase 3,
//! decisioni 52-54).
//!
//! Il maintainer, il 28-09-2026, dopo che il pilota automatico aveva aggiornato
//! il TC620: «sul pannello non vedo nessuna segnalazione di aggiornamento
//! avvenuto». Qui si decide se un aggiornamento è riuscito, e lo si dice sul
//! pannello, nell'IDE e sui canali del progetto.
//!
//! # Come si capisce l'esito, visto che chi aggiorna viene sostituito
//!
//! Prima di chiedere a systemd di aggiornare, il runtime scrive `in_corso` (da,
//! a, quando) in `aggiornamento.yaml`. Poi il processo viene sostituito, e
//! l'esito lo decide **chi si ritrova in funzione dopo**:
//!
//! - gira una versione diversa da `da` → la nuova è partita. Ma può ancora non
//!   diventare *healthy* ed essere sostituita dal ritorno indietro: l'esito
//!   «riuscito» si scrive solo dopo [`CONFERMA_S`] secondi di vita;
//! - gira ancora `da`, e `in_corso` è di poco fa → la nuova non ha retto e
//!   podman è tornato indietro: «non riuscito». Si guarda **la versione che gira
//!   davvero**, non il codice d'uscita di podman, che il 28-09 diceva «rollback
//!   failed» a un rollback riuscito.
//!
//! Se `podman auto-update` non trova niente da installare, nessuno riavvia:
//! il processo che ha chiesto se ne accorge da sé dopo [`SCADENZA_S`] secondi e
//! chiude `in_corso` senza un esito.

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::aggiornamento_finestra::{carica, salva};

/// Secondi di vita dopo i quali una versione nuova si considera riuscita:
/// oltre l'attesa di systemd per *healthy* (90 s nel quadlet).
pub const CONFERMA_S: u64 = 120;
/// Un `in_corso` più vecchio di così, trovato dalla stessa versione di prima,
/// non è un ritorno indietro: è una richiesta che non ha portato a niente.
pub const SCADENZA_S: u64 = 600;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InCorso {
    pub da: String,
    /// La versione attesa, se la si conosceva (il pilota non la fissa).
    #[serde(default)]
    pub a: Option<String>,
    pub quando_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Esito {
    Riuscito,
    NonRiuscito,
}

/// L'ultimo aggiornamento concluso, come lo mostrano pannello e IDE.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Evento {
    /// Identifica l'evento per «Chiudi» (chiuso una volta, non ricompare).
    pub id: i64,
    pub da: String,
    /// Per «non riuscito», la versione che si era provato a installare.
    pub a: Option<String>,
    pub esito: Esito,
}

/// Cosa decide un runtime che si ritrova in funzione con un `in_corso`.
#[derive(Debug, Clone, PartialEq)]
pub enum Decisione {
    /// La versione nuova è partita: confermare dopo `CONFERMA_S`.
    ConfermaDopo,
    /// È tornata la versione di prima: ritorno indietro.
    NonRiuscito,
    /// Troppo vecchio: niente esito, si chiude.
    Scaduto,
}

pub fn decidi(ic: &InCorso, versione_adesso: &str, adesso_ms: i64) -> Decisione {
    if versione_adesso != ic.da {
        return Decisione::ConfermaDopo;
    }
    if adesso_ms - ic.quando_ms > (SCADENZA_S as i64) * 1000 {
        Decisione::Scaduto
    } else {
        Decisione::NonRiuscito
    }
}

/// Il testo per i canali del progetto (Telegram).
pub fn messaggio(host: &str, e: &Evento) -> String {
    match e.esito {
        Esito::Riuscito => format!("✅ {host}: runtime aggiornato dalla {} alla {}", e.da, e.a.as_deref().unwrap_or("?")),
        Esito::NonRiuscito => format!(
            "⚠️ {host}: aggiornamento {}non riuscito — il pannello è tornato alla {}",
            e.a.as_deref().map(|a| format!("alla {a} ")).unwrap_or_default(),
            e.da
        ),
    }
}

/// Scrive `in_corso` prima di chiedere l'aggiornamento.
pub async fn segna_in_corso(config_dir: &Path, da: &str, a: Option<String>) {
    let mut p = carica(config_dir).await;
    p.in_corso = Some(InCorso { da: da.to_string(), a, quando_ms: chrono::Utc::now().timestamp_millis() });
    if let Err(e) = salva(config_dir, &p).await {
        tracing::warn!("aggiornamento: in_corso non salvato: {e}");
    }
    // Se non succede niente (nessuna versione nuova da installare), questo
    // processo resta vivo e deve chiudere da sé la richiesta.
    let dir = config_dir.to_path_buf();
    let quando = p.in_corso.as_ref().map(|i| i.quando_ms);
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(SCADENZA_S)).await;
        let mut p = carica(&dir).await;
        if p.in_corso.as_ref().map(|i| i.quando_ms) == quando {
            p.in_corso = None;
            let _ = salva(&dir, &p).await;
            tracing::info!("aggiornamento: nessun riavvio dopo la richiesta, niente da installare");
        }
    });
}

/// All'avvio di un runtime su un dispositivo: se c'era un aggiornamento in
/// corso, ne decide l'esito, lo scrive e lo manda sui canali del progetto.
pub async fn all_avvio(s: crate::router::AppState) {
    let dir = s.config_dir.as_ref().clone();
    let Some(ic) = carica(&dir).await.in_corso else { return };
    let versione = crate::aggiornamento::VERSIONE;
    let esito = match decidi(&ic, versione, chrono::Utc::now().timestamp_millis()) {
        Decisione::Scaduto => {
            let mut p = carica(&dir).await;
            p.in_corso = None;
            let _ = salva(&dir, &p).await;
            return;
        }
        Decisione::NonRiuscito => {
            // Un momento, perché le notifiche del progetto partano.
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            Evento { id: ic.quando_ms, da: ic.da.clone(), a: ic.a.clone(), esito: Esito::NonRiuscito }
        }
        Decisione::ConfermaDopo => {
            // Se in questo tempo la versione nuova viene sostituita dal ritorno
            // indietro, questo task muore con lei, e l'esito lo scrive la vecchia.
            tokio::time::sleep(std::time::Duration::from_secs(CONFERMA_S)).await;
            Evento { id: ic.quando_ms, da: ic.da.clone(), a: Some(versione.to_string()), esito: Esito::Riuscito }
        }
    };
    let mut p = carica(&dir).await;
    p.in_corso = None;
    p.evento = Some(esito.clone());
    if let Err(e) = salva(&dir, &p).await {
        tracing::warn!("aggiornamento: esito non salvato: {e}");
    }
    let host = hostname();
    let testo = messaggio(&host, &esito);
    tracing::info!(esito = ?esito.esito, "{testo}");
    if let Some(t) = s.telegram_sender.read().await.as_ref() {
        let _ = t.message_sender().send(crate::telegram::TelegramMessage::global(testo));
    }
}

fn hostname() -> String {
    std::fs::read_to_string("/etc/hostname").map(|h| h.trim().to_string()).unwrap_or_else(|_| "pannello".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ic(da: &str, quando_ms: i64) -> InCorso {
        InCorso { da: da.into(), a: Some("2.12.0-rc.9".into()), quando_ms }
    }

    #[test]
    fn l_esito_lo_decide_la_versione_che_gira_davvero() {
        // Gira la nuova: si conferma dopo un po', se nessuno la sostituisce.
        assert_eq!(decidi(&ic("2.12.0-rc.8", 0), "2.12.0-rc.9", 10_000), Decisione::ConfermaDopo);
        // Il pilota non fissa la versione: basta che sia diversa da prima.
        assert_eq!(decidi(&InCorso { a: None, ..ic("2.12.0-rc.8", 0) }, "2.12.0-rc.10", 10_000), Decisione::ConfermaDopo);
        // Gira ancora la vecchia poco dopo: ritorno indietro.
        assert_eq!(decidi(&ic("2.12.0-rc.8", 0), "2.12.0-rc.8", 150_000), Decisione::NonRiuscito);
        // Gira la vecchia molto dopo: la richiesta non ha portato a niente.
        assert_eq!(decidi(&ic("2.12.0-rc.8", 0), "2.12.0-rc.8", (SCADENZA_S as i64 + 1) * 1000), Decisione::Scaduto);
    }

    #[test]
    fn i_messaggi_dicono_da_dove_a_dove() {
        let ok = Evento { id: 1, da: "2.12.0-rc.8".into(), a: Some("2.12.0-rc.9".into()), esito: Esito::Riuscito };
        assert_eq!(messaggio("tc620", &ok), "✅ tc620: runtime aggiornato dalla 2.12.0-rc.8 alla 2.12.0-rc.9");
        let ko = Evento { esito: Esito::NonRiuscito, ..ok };
        assert!(messaggio("tc620", &ko).contains("non riuscito") && messaggio("tc620", &ko).contains("tornato alla 2.12.0-rc.8"));
    }
}
