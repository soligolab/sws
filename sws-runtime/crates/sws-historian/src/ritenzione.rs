//! La ritenzione automatica dei datastore (piano
//! `docs/plans/2026-10-20-ritenzione-automatica.md`, 20-10-2026).
//!
//! Fino a oggi `retention_rows` e `retention_days` si applicavano solo quando un
//! Admin premeva «Pulisci»: un `retention_days: 365` scritto nel progetto, da solo,
//! non cancellava niente (CasaDomotica: 540 MB di storico, mai potato). Qui ci sono
//! le parti pure — il conto di ciò che una pulizia cancellerebbe, e la decisione se
//! il giro notturno è dovuto — con i loro test; il task che le usa sta in
//! `sws-runtime`, lo stato per progetto in `sws-web`.

use serde::{Deserialize, Serialize};

/// Ciò che una pulizia cancellerebbe da un datastore, prima di farla.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Anteprima {
    /// Righe che cadono per età (`retention_days`).
    pub righe_per_eta: u64,
    /// Righe che cadono per numero (`retention_rows`), contate su ciò che resta
    /// dopo la pulizia per età: `purge` fa le due cose in quest'ordine.
    pub righe_per_numero: u64,
    /// Righe in tutto, prima della pulizia.
    pub righe_totali: u64,
    /// Stima dei byte liberati: la quota di righe cancellate sul peso del file.
    /// Assente se il backend non sa dire quanto pesa.
    pub byte_stimati: Option<u64>,
}

impl Anteprima {
    pub fn righe(&self) -> u64 {
        self.righe_per_eta + self.righe_per_numero
    }
}

/// Il conto, da righe per tag: `(righe del tag, righe del tag più vecchie del limite)`.
///
/// Sta qui, e non nelle query dei backend, perché è la parte che deve **coincidere**
/// con quello che `purge` cancella davvero: prima i giorni, poi su ciò che resta le
/// righe oltre `retention_rows` per tag. Una SQL per backend la deve solo riempire.
pub fn conta(per_tag: &[(u64, u64)], retention_rows: Option<u64>, size_bytes: Option<u64>) -> Anteprima {
    let mut a = Anteprima::default();
    for &(totali, vecchie) in per_tag {
        a.righe_totali += totali;
        a.righe_per_eta += vecchie;
        if let Some(max) = retention_rows {
            a.righe_per_numero += (totali - vecchie.min(totali)).saturating_sub(max);
        }
    }
    a.byte_stimati = size_bytes.map(|b| {
        if a.righe_totali == 0 {
            0
        } else {
            ((b as u128 * a.righe() as u128) / a.righe_totali as u128) as u64
        }
    });
    a
}

/// Il limite d'età in millisecondi dall'epoca, per `retention_days` (assente =
/// nessun limite d'età: niente è più vecchio di 0).
pub fn limite_eta_ms(adesso_ms: u64, retention_days: Option<u64>) -> u64 {
    match retention_days {
        Some(d) => adesso_ms.saturating_sub(d.saturating_mul(86_400_000)),
        None => 0,
    }
}

/// Quante righe cancellate rispetto a quelle che c'erano fanno partire il VACUUM.
///
/// Decisione del maintainer (20-10-2026): non dopo ogni pulizia — riscrive il file
/// e blocca le scritture — e non mai, perché su SQLite un `DELETE` non restituisce
/// un byte, e nel cloud la quota dell'azienda si misura sui byte.
pub const SOGLIA_VACUUM: f64 = 0.10;

pub fn serve_vacuum(cancellate: u64, prima: u64) -> bool {
    prima > 0 && cancellate as f64 >= prima as f64 * SOGLIA_VACUUM
}

/// Il giro notturno è dovuto?
///
/// - `minuto_del_giorno`: adesso, in minuti dalla mezzanotte **locale**;
/// - `ora_giro`: l'ora del progetto, in minuti dalla mezzanotte;
/// - `da_ultimo_ms`: quanto è passato dall'ultimo giro, `None` se non ce n'è mai stato.
///
/// Dovuto se l'ora è passata e l'ultimo giro è di più di 20 ore fa: 20 e non 24,
/// così un giro fatto alle 03:05 non rimanda quello del giorno dopo alle 03:05, e un
/// pannello spento di notte recupera al primo minuto utile dopo l'ora. Senza un giro
/// precedente basta l'ora passata: il primo giro, comunque, aspetta la conferma.
pub fn dovuto(minuto_del_giorno: u32, ora_giro: u32, da_ultimo_ms: Option<u64>) -> bool {
    if minuto_del_giorno < ora_giro {
        return false;
    }
    match da_ultimo_ms {
        Some(ms) => ms >= 20 * 3_600_000,
        None => true,
    }
}

/// `"03:00"` → 180. `None` se non è un'ora valida.
pub fn leggi_ora(s: &str) -> Option<u32> {
    let (h, m) = s.trim().split_once(':')?;
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// L'ora predefinita del giro: le 03:00, quando un impianto di solito è più quieto.
pub const ORA_PREDEFINITA: &str = "03:00";

/// Una conferma vale ancora per i valori di adesso?
///
/// Decade quando un limite diventa **più stretto** (meno giorni, meno righe) o
/// compare dove non c'era: un 365 portato a 30 è un altro primo giro, e chi lo
/// conferma deve rivedere i numeri. Un limite allargato o tolto non la fa decadere.
pub fn conferma_vale(
    confermati: (Option<u64>, Option<u64>),
    attuali: (Option<u64>, Option<u64>),
) -> bool {
    fn stretto(prima: Option<u64>, ora: Option<u64>) -> bool {
        match (prima, ora) {
            (_, None) => false,
            (None, Some(_)) => true,
            (Some(p), Some(o)) => o < p,
        }
    }
    !stretto(confermati.0, attuali.0) && !stretto(confermati.1, attuali.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conta_prima_l_eta_poi_il_numero_sul_resto() {
        // Tag A: 100 righe, 30 vecchie → 70 restano, oltre 50 ne cadono 20.
        // Tag B: 40 righe, nessuna vecchia → sotto 50, niente.
        let a = conta(&[(100, 30), (40, 0)], Some(50), Some(1_400));
        assert_eq!(a.righe_per_eta, 30);
        assert_eq!(a.righe_per_numero, 20);
        assert_eq!(a.righe_totali, 140);
        assert_eq!(a.righe(), 50);
        assert_eq!(a.byte_stimati, Some(500));
    }

    #[test]
    fn conta_senza_limiti_e_senza_righe() {
        assert_eq!(conta(&[(10, 0)], None, None).righe(), 0);
        assert_eq!(conta(&[], Some(5), Some(100)).byte_stimati, Some(0));
    }

    #[test]
    fn il_limite_d_eta() {
        assert_eq!(limite_eta_ms(10 * 86_400_000, Some(3)), 7 * 86_400_000);
        assert_eq!(limite_eta_ms(1_000, Some(3)), 0);
        assert_eq!(limite_eta_ms(1_000, None), 0);
    }

    #[test]
    fn il_vacuum_oltre_il_dieci_per_cento() {
        assert!(!serve_vacuum(9, 100));
        assert!(serve_vacuum(10, 100));
        assert!(!serve_vacuum(0, 0));
    }

    #[test]
    fn dovuto_solo_dopo_l_ora() {
        let ora = 180; // 03:00
        assert!(!dovuto(179, ora, None));
        assert!(dovuto(180, ora, None));
        assert!(dovuto(12 * 60, ora, None), "progetto aperto a mezzogiorno senza giri: pulisce");
    }

    #[test]
    fn dovuto_una_volta_al_giorno_e_recupera_il_giorno_spento() {
        let ora = 180;
        let h = 3_600_000;
        // Giro fatto alle 03:05 di oggi: alle 04:00 non è di nuovo dovuto.
        assert!(!dovuto(240, ora, Some(55 * 60_000)));
        // Il giorno dopo alle 03:00 (23 h 55' dopo): dovuto.
        assert!(dovuto(180, ora, Some(23 * h + 55 * 60_000)));
        // Pannello spento di notte, acceso alle 08:00 dopo 29 ore: recupera.
        assert!(dovuto(8 * 60, ora, Some(29 * h)));
        // Orologio tornato indietro (da_ultimo piccolo): non ripete.
        assert!(!dovuto(200, ora, Some(0)));
    }

    #[test]
    fn leggere_l_ora() {
        assert_eq!(leggi_ora("03:00"), Some(180));
        assert_eq!(leggi_ora(" 23:59 "), Some(1439));
        assert_eq!(leggi_ora("24:00"), None);
        assert_eq!(leggi_ora("3"), None);
        assert_eq!(leggi_ora(ORA_PREDEFINITA), Some(180));
    }

    #[test]
    fn la_conferma_decade_solo_se_i_limiti_si_stringono() {
        let c = (Some(1_000_000), Some(365));
        assert!(conferma_vale(c, (Some(1_000_000), Some(365))));
        assert!(conferma_vale(c, (Some(2_000_000), Some(400))), "allargati: vale");
        assert!(conferma_vale(c, (None, Some(365))), "tolto un limite: vale");
        assert!(!conferma_vale(c, (Some(1_000_000), Some(30))), "365 → 30: decade");
        assert!(!conferma_vale((None, Some(365)), (Some(10), Some(365))), "un limite nuovo: decade");
    }
}
