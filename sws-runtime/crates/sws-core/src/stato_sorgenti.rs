//! Lo stato delle sorgenti e dei loro dispositivi (04-10-2026): risponde, non
//! risponde, mai collegato. Lo tiene il supervisore, lo scrivono i plugin
//! **ai cambi** (non a ogni giro), lo legge l'IDE per il pallino nell'albero
//! della Configurazione.
//!
//! Generico per sorgente: oggi solo Modbus riempie il livello dei dispositivi;
//! gli altri protocolli possono riempire quello del bus quando toccherà a loro.

use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Collegamento {
    #[default]
    MaiConnesso,
    Ok,
    NonRisponde,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Stato {
    pub stato: Collegamento,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errore: Option<String>,
    /// Da quando (ms dall'epoca) è in questo stato.
    pub da_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct StatoSorgente {
    #[serde(flatten)]
    pub bus: Stato,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub dispositivi: BTreeMap<u8, Stato>,
}

#[derive(Debug, Default)]
pub struct StatoSorgenti {
    inner: RwLock<HashMap<String, StatoSorgente>>,
}

fn adesso_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Cambia `s` se lo stato o l'errore sono diversi; vero se è cambiato.
fn aggiorna(s: &mut Stato, stato: Collegamento, errore: Option<String>) -> bool {
    if s.stato == stato && s.errore == errore {
        return false;
    }
    if s.stato != stato {
        s.da_ms = adesso_ms();
    }
    s.stato = stato;
    s.errore = errore;
    true
}

impl StatoSorgenti {
    pub fn new() -> Self {
        Self::default()
    }

    /// Una sorgente che parte: il bus e i dispositivi dichiarati, mai collegati.
    pub fn registra(&self, sorgente: &str, dispositivi: impl IntoIterator<Item = u8>) {
        let da_ms = adesso_ms();
        let nuovo = Stato { stato: Collegamento::MaiConnesso, errore: None, da_ms };
        let s = StatoSorgente {
            bus: nuovo.clone(),
            dispositivi: dispositivi.into_iter().map(|u| (u, nuovo.clone())).collect(),
        };
        self.inner.write().unwrap_or_else(|e| e.into_inner()).insert(sorgente.to_string(), s);
    }

    /// Lo stato del bus (la connessione). Vero se è cambiato.
    pub fn bus(&self, sorgente: &str, stato: Collegamento, errore: Option<String>) -> bool {
        let mut m = self.inner.write().unwrap_or_else(|e| e.into_inner());
        aggiorna(&mut m.entry(sorgente.to_string()).or_default().bus, stato, errore)
    }

    /// Lo stato di un dispositivo del bus. Vero se è cambiato.
    pub fn dispositivo(&self, sorgente: &str, unita: u8, stato: Collegamento, errore: Option<String>) -> bool {
        let mut m = self.inner.write().unwrap_or_else(|e| e.into_inner());
        let s = m.entry(sorgente.to_string()).or_default();
        aggiorna(s.dispositivi.entry(unita).or_default(), stato, errore)
    }

    /// Il bus caduto: lui e tutti i suoi dispositivi non rispondono.
    pub fn caduta(&self, sorgente: &str, errore: String) {
        let mut m = self.inner.write().unwrap_or_else(|e| e.into_inner());
        let s = m.entry(sorgente.to_string()).or_default();
        aggiorna(&mut s.bus, Collegamento::NonRisponde, Some(errore.clone()));
        for d in s.dispositivi.values_mut() {
            if d.stato == Collegamento::Ok {
                aggiorna(d, Collegamento::NonRisponde, Some(errore.clone()));
            }
        }
    }

    pub fn rimuovi(&self, sorgente: &str) {
        self.inner.write().unwrap_or_else(|e| e.into_inner()).remove(sorgente);
    }

    pub fn istantanea(&self) -> BTreeMap<String, StatoSorgente> {
        self.inner.read().unwrap_or_else(|e| e.into_inner()).iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cambia_solo_ai_cambi_e_la_caduta_spegne_i_dispositivi_vivi() {
        let s = StatoSorgenti::new();
        s.registra("linea", [1, 2]);
        assert!(s.bus("linea", Collegamento::Ok, None));
        assert!(!s.bus("linea", Collegamento::Ok, None), "stesso stato: nessun cambio");
        assert!(s.dispositivo("linea", 1, Collegamento::Ok, None));
        s.caduta("linea", "porta chiusa".into());
        let i = s.istantanea();
        let l = &i["linea"];
        assert_eq!(l.bus.stato, Collegamento::NonRisponde);
        assert_eq!(l.dispositivi[&1].stato, Collegamento::NonRisponde);
        assert_eq!(l.dispositivi[&2].stato, Collegamento::MaiConnesso, "mai collegato resta tale");
        let j = serde_json::to_value(l).unwrap();
        assert_eq!(j["stato"], "non_risponde");
        assert_eq!(j["dispositivi"]["1"]["errore"], "porta chiusa");
        s.rimuovi("linea");
        assert!(s.istantanea().is_empty());
    }
}
