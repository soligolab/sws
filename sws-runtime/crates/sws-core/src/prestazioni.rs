//! Dove se ne va il tempo (piano `docs/archive/2026-10-26-dove-se-ne-va-il-tempo.md`).
//!
//! Un accumulatore di durate per **lavoro** — una fase del fotogramma del
//! viewer, il giro di una sorgente del runtime — che si riempie sempre e si
//! svuota quando qualcuno chiede il riassunto. Sta qui perché lo usano tutti e
//! due i processi, e la pagina dell'IDE legge lo stesso formato dai due lati.
//!
//! Registrare costa un confronto con otto soglie e quattro somme: niente
//! allocazioni dopo la prima volta che un lavoro compare.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Le soglie dei secchi, in millisecondi. L'ultimo secchio è «oltre 66»:
/// 16 e 33 sono un fotogramma a 60 e a 30 al secondo, il resto raddoppia.
pub const SOGLIE_MS: [f64; 7] = [1.0, 2.0, 4.0, 8.0, 16.0, 33.0, 66.0];

/// Un lavoro, accumulato.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Voce {
    pub nome: String,
    /// Quante volte è stato misurato.
    pub n: u64,
    /// Il tempo totale, in millisecondi.
    pub somma_ms: f64,
    pub max_ms: f64,
    /// Un conteggio per secchio: `SOGLIE_MS.len() + 1` valori.
    pub secchi: Vec<u64>,
}

impl Voce {
    pub fn media_ms(&self) -> f64 {
        if self.n == 0 {
            0.0
        } else {
            self.somma_ms / self.n as f64
        }
    }

    /// Il 95° percentile, **per eccesso**: la soglia del secchio che lo
    /// contiene (il massimo, se cade nell'ultimo). Coi secchi non si sa di
    /// più, e per dire «sta sotto un fotogramma o no» basta.
    pub fn p95_ms(&self) -> f64 {
        if self.n == 0 {
            return 0.0;
        }
        let soglia = (self.n as f64 * 0.95).ceil() as u64;
        let mut visti = 0;
        for (i, c) in self.secchi.iter().enumerate() {
            visti += c;
            if visti >= soglia {
                return SOGLIE_MS.get(i).copied().unwrap_or(self.max_ms).min(self.max_ms);
            }
        }
        self.max_ms
    }
}

/// Quello che esce: le voci di un intervallo.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Riassunto {
    /// Quanto è durato l'intervallo misurato, in secondi.
    pub intervallo_s: f64,
    /// Ordinate per tempo totale, la più pesante in cima.
    pub voci: Vec<Voce>,
}

impl Riassunto {
    pub fn voce(&self, nome: &str) -> Option<&Voce> {
        self.voci.iter().find(|v| v.nome == nome)
    }
}

#[derive(Default)]
struct Grezza {
    n: u64,
    somma_us: u64,
    max_us: u64,
    secchi: [u64; SOGLIE_MS.len() + 1],
}

/// L'accumulatore. Le chiavi sono `&'static str` perché i lavori del viewer
/// sono fissi; quelli del runtime con un nome composto (`sorgente.modbus.plc1`)
/// passano da [`Accumulatore::registra_nome`].
#[derive(Default)]
pub struct Accumulatore {
    voci: BTreeMap<String, Grezza>,
    da: Option<std::time::Instant>,
}

impl Accumulatore {
    pub fn registra(&mut self, nome: &'static str, d: Duration) {
        self.da.get_or_insert_with(std::time::Instant::now);
        let g = match self.voci.get_mut(nome) {
            Some(g) => g,
            None => self.voci.entry(nome.to_string()).or_default(),
        };
        aggiungi(g, d);
    }

    pub fn registra_nome(&mut self, nome: &str, d: Duration) {
        self.da.get_or_insert_with(std::time::Instant::now);
        let g = match self.voci.get_mut(nome) {
            Some(g) => g,
            None => self.voci.entry(nome.to_string()).or_default(),
        };
        aggiungi(g, d);
    }

    /// Il riassunto da quando si è cominciato (o dall'ultimo azzeramento).
    pub fn riassunto(&self) -> Riassunto {
        let intervallo_s = self.da.map(|t| t.elapsed().as_secs_f64()).unwrap_or(0.0);
        let mut voci: Vec<Voce> = self
            .voci
            .iter()
            .map(|(nome, g)| Voce {
                nome: nome.clone(),
                n: g.n,
                somma_ms: g.somma_us as f64 / 1000.0,
                max_ms: g.max_us as f64 / 1000.0,
                secchi: g.secchi.to_vec(),
            })
            .collect();
        voci.sort_by(|a, b| b.somma_ms.total_cmp(&a.somma_ms));
        Riassunto { intervallo_s, voci }
    }

    /// Il riassunto, e si riparte da zero.
    pub fn riassunto_e_azzera(&mut self) -> Riassunto {
        let r = self.riassunto();
        self.voci.clear();
        self.da = None;
        r
    }
}

/// Il registro del processo: una **finestra** che chi guarda svuota, e un
/// **totale** che non si azzera mai, per `/metrics` (Prometheus vuole
/// contatori che crescono). Lo usano le sorgenti, lo storico, gli allarmi,
/// gli script — chiunque abbia un lavoro che vale la pena di contare.
static GLOBALE: std::sync::Mutex<Option<(Accumulatore, Accumulatore)>> = std::sync::Mutex::new(None);

/// Registra `d` sotto `nome` nel registro del processo.
pub fn registra(nome: &str, d: Duration) {
    let mut g = GLOBALE.lock().unwrap_or_else(|e| e.into_inner());
    let (finestra, totale) = g.get_or_insert_with(Default::default);
    finestra.registra_nome(nome, d);
    totale.registra_nome(nome, d);
}

/// Misura il blocco in cui vive: registra quando esce, da qualunque strada
/// (anche un `?` o un `continue`). Serve nei giri delle sorgenti, dove il
/// corpo è lungo e ha molte uscite.
pub struct Misura {
    nome: String,
    da: std::time::Instant,
}

impl Misura {
    pub fn nuova(nome: impl Into<String>) -> Self {
        Self { nome: nome.into(), da: std::time::Instant::now() }
    }
}

impl Drop for Misura {
    fn drop(&mut self) {
        registra(&self.nome, self.da.elapsed());
    }
}

/// La finestra del registro del processo, e la si azzera.
pub fn finestra_e_azzera() -> Riassunto {
    let mut g = GLOBALE.lock().unwrap_or_else(|e| e.into_inner());
    g.get_or_insert_with(Default::default).0.riassunto_e_azzera()
}

/// Il totale del registro del processo, dall'avvio.
pub fn totale() -> Riassunto {
    let mut g = GLOBALE.lock().unwrap_or_else(|e| e.into_inner());
    g.get_or_insert_with(Default::default).1.riassunto()
}

fn aggiungi(g: &mut Grezza, d: Duration) {
    let us = d.as_micros() as u64;
    g.n += 1;
    g.somma_us += us;
    g.max_us = g.max_us.max(us);
    let ms = us as f64 / 1000.0;
    let i = SOGLIE_MS.iter().position(|s| ms <= *s).unwrap_or(SOGLIE_MS.len());
    g.secchi[i] += 1;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secchi_media_massimo_e_percentile() {
        let mut a = Accumulatore::default();
        for _ in 0..95 {
            a.registra("display", Duration::from_micros(1500));
        }
        for _ in 0..5 {
            a.registra("display", Duration::from_millis(40));
        }
        a.registra("lvgl", Duration::from_millis(3));
        let r = a.riassunto_e_azzera();
        let d = r.voce("display").unwrap();
        assert_eq!(d.n, 100);
        assert_eq!(d.secchi[1], 95, "1,5 ms sta nel secchio fino a 2");
        assert_eq!(d.secchi[6], 5, "40 ms sta nel secchio fino a 66");
        assert!((d.max_ms - 40.0).abs() < 1e-9);
        assert!((d.media_ms() - (95.0 * 1.5 + 5.0 * 40.0) / 100.0).abs() < 1e-9);
        assert_eq!(d.p95_ms(), 2.0, "il 95° cade ancora fra i veloci");
        assert_eq!(r.voci[0].nome, "display", "la più pesante in cima");
    }

    #[test]
    fn oltre_l_ultima_soglia_il_percentile_e_il_massimo() {
        let mut a = Accumulatore::default();
        a.registra("giro", Duration::from_millis(90));
        let r = a.riassunto_e_azzera();
        let v = r.voce("giro").unwrap();
        assert_eq!(v.secchi[SOGLIE_MS.len()], 1);
        assert_eq!(v.p95_ms(), 90.0);
    }

    #[test]
    fn azzerare_riparte_da_zero() {
        let mut a = Accumulatore::default();
        a.registra_nome("sorgente.modbus.plc1", Duration::from_millis(1));
        assert_eq!(a.riassunto_e_azzera().voci.len(), 1);
        let vuoto = a.riassunto_e_azzera();
        assert!(vuoto.voci.is_empty());
        assert_eq!(vuoto.intervallo_s, 0.0);
    }

    #[test]
    fn il_totale_non_si_azzera_con_la_finestra() {
        registra("prova.globale", Duration::from_millis(2));
        let f = finestra_e_azzera();
        assert!(f.voce("prova.globale").is_some());
        assert!(finestra_e_azzera().voce("prova.globale").is_none());
        assert!(totale().voce("prova.globale").is_some_and(|v| v.n >= 1));
    }

    #[test]
    fn il_riassunto_attraversa_json() {
        let mut a = Accumulatore::default();
        a.registra("tag", Duration::from_micros(250));
        let r = a.riassunto_e_azzera();
        let j = serde_json::to_string(&r).unwrap();
        assert_eq!(serde_json::from_str::<Riassunto>(&j).unwrap(), r);
    }
}
