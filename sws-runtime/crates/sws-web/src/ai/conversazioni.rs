//! Le conversazioni della chat, legate al loro id e non al socket (10-11-2026).
//!
//! # Il difetto che l'ha fatta nascere
//!
//! Fino al 10-11-2026 storia, misure e banco (basi e varianti degli sfondi,
//! bozze di simboli, spese dei tetti) nascevano a ogni connessione di `/ws/ai`.
//! Il collaudo su sws.soligo.net (Montagna, chat staccata): due basi generate,
//! «Usa come base» su `sfondo-d09e24`, mezz'ora fuori dalla finestra. Il socket
//! si era ricollegato, il banco era vuoto, e `varia_sfondo` rispondeva «la base
//! non c'è». Immagini già pagate da rigenerare, e lavoro perso; il container non
//! si era mai riavviato.
//!
//! # Come si lega
//!
//! Il browser apre il socket con `?conv=<uuid>`, lo stesso a ogni
//! riconnessione; «Svuota la conversazione» ne sceglie uno nuovo. La chiave qui
//! è progetto + id, così due progetti nello stesso processo non si mischiano.
//! Senza id (un client vecchio) la conversazione vive quanto il socket, come
//! prima.
//!
//! # Quanto dura, e quanta memoria
//!
//! Ventiquattro ore dall'ultimo uso, al massimo [`MAX_CONVERSAZIONI`] e
//! [`MAX_BYTE`] in tutto: le più vecchie escono per prime. Gli sfondi sono
//! JPEG di qualche centinaio di kB e la storia porta le istantanee in base64,
//! quindi il tetto sulla memoria conta quanto quello sul numero.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::{Banco, Misure};

/// Quanto resta una conversazione senza che nessuno la usi.
pub(crate) const DURATA: Duration = Duration::from_secs(24 * 3600);
/// Quante conversazioni al massimo. Un tetto prudente: oltre, le più vecchie.
pub(crate) const MAX_CONVERSAZIONI: usize = 20;
/// Quanta memoria, stimata, per tutte insieme.
pub(crate) const MAX_BYTE: usize = 128 * 1024 * 1024;

/// Tutto quello che una conversazione accumula: la storia che il modello
/// rilegge, quanto è costata (per il tetto), e il banco.
pub(crate) struct Conversazione {
    pub messaggi: Vec<Value>,
    pub misure: Misure,
    pub banco: Banco,
}

impl Conversazione {
    pub fn nuova() -> Self {
        Conversazione {
            messaggi: Vec::new(),
            misure: Misure::nuove(),
            banco: Banco::default(),
        }
    }

    /// Niente detto, niente speso, niente sul banco.
    pub fn vuota(&self) -> bool {
        self.messaggi.is_empty()
            && self.misure.costo_usd == 0.0
            && self.banco.simboli.is_empty()
            && self.banco.sfondi.is_empty()
    }

    /// Una stima dei byte: le immagini e la storia sono quasi tutto.
    pub fn peso(&self) -> usize {
        let storia: usize = self.messaggi.iter().map(|m| m.to_string().len()).sum();
        let sfondi: usize = self.banco.sfondi.iter().map(|s| s.jpg.len()).sum();
        let simboli: usize = self
            .banco
            .simboli
            .iter()
            .map(|d| serde_json::to_vec(d).map(|v| v.len()).unwrap_or(0))
            .sum();
        storia + sfondi + simboli
    }
}

/// La conversazione condivisa fra i socket che portano lo stesso id. Il
/// lucchetto è di tokio perché un turno lo tiene per tutta la sua durata: se un
/// socket fantasma (chiuso dal browser, non ancora visto dal server) è a metà
/// di un turno, quello nuovo aspetta che finisca invece di scriverci sopra.
pub(crate) type Condivisa = Arc<tokio::sync::Mutex<Conversazione>>;

struct Voce {
    conv: Condivisa,
    ultimo_uso: Instant,
    byte: usize,
}

/// L'elenco delle conversazioni vive. I tempi entrano da fuori (`ora`) così i
/// test provano la scadenza senza aspettare un giorno.
pub(crate) struct Conversazioni {
    voci: HashMap<String, Voce>,
    durata: Duration,
    max_voci: usize,
    max_byte: usize,
}

impl Conversazioni {
    pub fn nuove(durata: Duration, max_voci: usize, max_byte: usize) -> Self {
        Conversazioni {
            voci: HashMap::new(),
            durata,
            max_voci,
            max_byte,
        }
    }

    /// La conversazione con questa chiave, o una vuota se non c'è (o è
    /// scaduta). Il secondo valore dice se c'era già.
    pub fn prendi(&mut self, chiave: &str, ora: Instant) -> (Condivisa, bool) {
        self.scadute(ora);
        let trovata = self.voci.contains_key(chiave);
        let voce = self.voci.entry(chiave.to_string()).or_insert_with(|| Voce {
            conv: Arc::new(tokio::sync::Mutex::new(Conversazione::nuova())),
            ultimo_uso: ora,
            byte: 0,
        });
        voce.ultimo_uso = ora;
        let conv = voce.conv.clone();
        self.sfoltisci(chiave);
        (conv, trovata)
    }

    /// Dopo un turno: la conversazione è stata usata adesso e pesa `byte`.
    /// Una conversazione già uscita (troppe, o troppo grandi) non rientra: il
    /// socket che la tiene continua a lavorarci, ma una riconnessione no.
    pub fn tocca(&mut self, chiave: &str, ora: Instant, byte: usize) {
        if let Some(v) = self.voci.get_mut(chiave) {
            v.ultimo_uso = ora;
            v.byte = byte;
        }
        self.scadute(ora);
        self.sfoltisci(chiave);
    }

    fn scadute(&mut self, ora: Instant) {
        let durata = self.durata;
        self.voci
            .retain(|_, v| ora.saturating_duration_since(v.ultimo_uso) <= durata);
    }

    /// Fuori le più vecchie finché numero e memoria stanno nei tetti. Quella
    /// in uso (`tieni`) resta sempre: è la sola che qualcuno sta guardando.
    fn sfoltisci(&mut self, tieni: &str) {
        loop {
            let byte: usize = self.voci.values().map(|v| v.byte).sum();
            if self.voci.len() <= self.max_voci && byte <= self.max_byte {
                return;
            }
            let Some(vecchia) = self
                .voci
                .iter()
                .filter(|(k, _)| k.as_str() != tieni)
                .min_by_key(|(_, v)| v.ultimo_uso)
                .map(|(k, _)| k.clone())
            else {
                return;
            };
            self.voci.remove(&vecchia);
        }
    }

    #[cfg(test)]
    pub fn quante(&self) -> usize {
        self.voci.len()
    }
}

/// Quelle del processo.
pub(crate) fn tutte() -> &'static Mutex<Conversazioni> {
    static TUTTE: OnceLock<Mutex<Conversazioni>> = OnceLock::new();
    TUTTE.get_or_init(|| Mutex::new(Conversazioni::nuove(DURATA, MAX_CONVERSAZIONI, MAX_BYTE)))
}

/// La chiave di una conversazione: progetto + id. `None` se l'id manca o non è
/// un id (lettere, cifre, `-` e `_`, al più 64): si torna al comportamento di
/// prima, una conversazione per socket.
pub(crate) fn chiave(id: Option<&str>, progetto: Option<&Path>) -> Option<String> {
    let id = id?.trim();
    let valido = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valido {
        return None;
    }
    let progetto = progetto
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    Some(format!("{progetto}\u{0}{id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sfondo(id: &str, byte: usize) -> super::super::immagini::Sfondo {
        super::super::immagini::Sfondo {
            id: id.into(),
            jpg: vec![0; byte],
            da: None,
            luce: None,
            approvata: true,
        }
    }

    /// Il caso del collaudo: la base approvata e la spesa ci sono ancora
    /// quando lo stesso id si ricollega.
    #[tokio::test]
    async fn stesso_id_ritrova_il_banco() {
        let mut cc = Conversazioni::nuove(DURATA, MAX_CONVERSAZIONI, MAX_BYTE);
        let t0 = Instant::now();
        let (a, trovata) = cc.prendi("prj\u{0}c1", t0);
        assert!(!trovata);
        {
            let mut g = a.lock().await;
            g.banco.sfondi.push(sfondo("sfondo-d09e24", 10));
            g.banco.spesa_sfondi = 0.08;
            g.misure.costo_usd = 1.5;
        }
        drop(a);
        let (b, trovata) = cc.prendi("prj\u{0}c1", t0 + Duration::from_secs(1800));
        assert!(trovata);
        let g = b.lock().await;
        assert_eq!(g.banco.sfondi[0].id, "sfondo-d09e24");
        assert!(g.banco.sfondi[0].approvata);
        // Il tetto della conversazione conta anche la spesa di prima.
        assert_eq!(g.misure.costo_usd, 1.5);
        assert_eq!(g.banco.spesa_sfondi, 0.08);
    }

    /// Un id nuovo («Svuota la conversazione») parte vuoto, e così un altro
    /// progetto con lo stesso id.
    #[tokio::test]
    async fn id_nuovo_parte_vuoto() {
        let mut cc = Conversazioni::nuove(DURATA, MAX_CONVERSAZIONI, MAX_BYTE);
        let t0 = Instant::now();
        let (a, _) = cc.prendi("prj\u{0}c1", t0);
        a.lock().await.banco.sfondi.push(sfondo("sfondo-1", 10));
        let (b, trovata) = cc.prendi("prj\u{0}c2", t0);
        assert!(!trovata);
        assert!(b.lock().await.vuota());
        let k1 = chiave(Some("c1"), Some(Path::new("/p/montagna"))).unwrap();
        let k2 = chiave(Some("c1"), Some(Path::new("/p/casa"))).unwrap();
        assert_ne!(k1, k2);
    }

    /// Dopo 24 ore senza uso la conversazione non c'è più; un uso a metà
    /// sposta la scadenza.
    #[tokio::test]
    async fn scade_dopo_un_giorno_dall_ultimo_uso() {
        let mut cc = Conversazioni::nuove(DURATA, MAX_CONVERSAZIONI, MAX_BYTE);
        let t0 = Instant::now();
        let (a, _) = cc.prendi("k", t0);
        a.lock().await.banco.sfondi.push(sfondo("sfondo-1", 10));
        drop(a);
        cc.tocca("k", t0 + Duration::from_secs(20 * 3600), 10);
        let (_, trovata) = cc.prendi("k", t0 + Duration::from_secs(40 * 3600));
        assert!(trovata, "toccata a 20 h: a 40 h è ancora viva");
        let (b, trovata) = cc.prendi("k", t0 + Duration::from_secs(65 * 3600));
        assert!(!trovata);
        assert!(b.lock().await.vuota());
    }

    /// Oltre il numero massimo esce la meno usata, mai quella appena presa.
    #[test]
    fn tetto_sul_numero() {
        let mut cc = Conversazioni::nuove(DURATA, 3, MAX_BYTE);
        let t0 = Instant::now();
        for i in 0..5u64 {
            cc.prendi(&format!("c{i}"), t0 + Duration::from_secs(i));
        }
        assert_eq!(cc.quante(), 3);
        assert!(!cc.voci.contains_key("c0"));
        assert!(!cc.voci.contains_key("c1"));
        assert!(cc.voci.contains_key("c4"));
    }

    /// Oltre la memoria escono le più vecchie; quella in uso resta anche se da
    /// sola supera il tetto.
    #[test]
    fn tetto_sulla_memoria() {
        let mut cc = Conversazioni::nuove(DURATA, 20, 1000);
        let t0 = Instant::now();
        cc.prendi("a", t0);
        cc.tocca("a", t0, 600);
        cc.prendi("b", t0 + Duration::from_secs(1));
        cc.tocca("b", t0 + Duration::from_secs(1), 600);
        assert!(!cc.voci.contains_key("a"));
        assert!(cc.voci.contains_key("b"));
        cc.tocca("b", t0 + Duration::from_secs(2), 5000);
        assert!(cc.voci.contains_key("b"));
    }

    /// Senza id, o con un id che non è un id, nessuna chiave: una
    /// conversazione per socket, come prima.
    #[test]
    fn chiave_solo_con_un_id_valido() {
        let p = Some(Path::new("/p/x"));
        assert!(chiave(None, p).is_none());
        assert!(chiave(Some(""), p).is_none());
        assert!(chiave(Some("a/b"), p).is_none());
        assert!(chiave(Some(&"x".repeat(65)), p).is_none());
        assert!(chiave(Some("0b6f1c2e-9d1a-4c47-a7e3-5f0e8f3a1b2c"), p).is_some());
    }

    /// Il peso conta le immagini del banco.
    #[test]
    fn il_peso_conta_gli_sfondi() {
        let mut c = Conversazione::nuova();
        assert!(c.vuota());
        c.banco.sfondi.push(sfondo("s", 4000));
        assert!(c.peso() >= 4000);
        assert!(!c.vuota());
    }
}
