//! La mini tendenza di `sparkline` e del `kpi_tile`, a secchi: al massimo
//! quattro punti per colonna di pixel, e un costo che non cresce col tempo.
//!
//! È la `MiniSerie` del web (`sws-editor/src/canvas/miniSerie.ts`, piano
//! 2026-11-09 «viewer leggero»), portata riga per riga: una colonna è un
//! secchio di tempo, e per ogni secchio bastano primo valore, minimo, massimo
//! e ultimo valore, più l'ordine fra minimo e massimo (il metodo «M4»).
//! Disegnati in quest'ordine danno la stessa immagine di tutti i campioni,
//! picchi compresi.
//!
//! Come sul web, lo storico si chiede **una volta**, a secchi (il seme), e da
//! lì entrano i valori vivi del socket negli stessi secchi; la linea scorre
//! al confine di ogni secchio anche a valore fermo ([`Viva`]). Fino al 09-11
//! il pannello chiedeva tutta la finestra ogni 2 s, per ogni mini tendenza:
//! sulla pagina iniziale di Montagna erano 6 richieste al secondo, e il
//! server rileggeva e aggregava un'ora di campioni a ogni richiesta, sulla
//! stessa CPU del pannello.
//!
//! Logica pura, senza LVGL: si prova con `cargo test` su qualunque macchina.

use std::sync::{Arc, Mutex};

use crate::client::HistoryBucket;

/// L'asse Y del grafico va da 0 a qui: i valori si riportano in questa scala.
/// LVGL tiene i punti in `i16`. Prima ci finiva il valore vero arrotondato:
/// una pressione in Pa (101.325) si schiacciava sul tetto di 32.767, e un
/// valore fra 0 e 1 diventava 0 o 1.
pub const SCALA_Y: i16 = 1000;

/// Il secchio più corto: sotto, una finestra breve su un oggetto largo farebbe
/// un secchio per messaggio.
pub const SECCHIO_MINIMO_MS: u64 = 100;

/// Sotto questo cambio della stima dell'orologio la serie non si rifà: un
/// errore di un secondo non sposta niente di visibile.
const SCARTO_TOLLERATO_MS: u64 = 1_000;

/// Il margine del disegno su ogni lato, quello del web (`MARGINE` in
/// `MiniTendenza.tsx`).
pub const MARGINE: i16 = 2;

/// Le colonne di una mini tendenza larga `larghezza`: i pixel fra i due
/// margini, come sul web. Fino al 09-11 qui c'era la larghezza intera, e
/// sulla kpi di Montagna il secchio veniva 24,3 s invece dei 25 del web.
pub fn colonne(larghezza: f64) -> u32 {
    (larghezza - 2.0 * MARGINE as f64).floor().max(1.0) as u32
}

/// Il secchio in millisecondi: una colonna di pixel, mai sotto i 100 ms.
/// La stessa formula del web, `max(100, round(finestraMs / colonne))`.
pub fn secchio_ms(finestra_ms: u64, colonne: u32) -> u64 {
    let c = colonne.max(1) as f64;
    ((finestra_ms as f64 / c).round() as u64).max(SECCHIO_MINIMO_MS)
}

/// Quello che il grafico deve mostrare.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Disegno {
    /// `x` in terzi di colonna dall'inizio della finestra, `y` in
    /// `0..=SCALA_Y`. Come sul web: il primo valore di un secchio sta
    /// all'inizio della sua colonna, i due estremi a un terzo e a due terzi,
    /// l'ultimo all'inizio della colonna dopo.
    pub punti: Vec<(i16, i16)>,
    /// L'asse X va da 0 a qui: tre per colonna.
    pub ultima_x: i16,
    /// L'ultimo valore noto, per `spark_show_last`.
    pub ultimo: Option<f64>,
}

/// La serie a secchi. Vedi `MiniSerie` in `miniSerie.ts`: gli stessi metodi,
/// la stessa geometria.
#[derive(Debug, Clone)]
pub struct MiniSerie {
    pub secchio_ms: u64,
    /// I secchi in finestra: uno per colonna, meno se il secchio è al minimo.
    pub n: usize,
    /// Cresce ogni volta che il disegno cambia, anche quando scorre la testa.
    pub versione: u64,
    /// Il secchio di «adesso», come indice assoluto: `ts / secchio`, cioè
    /// l'allineamento del server (`ts - ts % secchio`, `aggregate_samples`).
    testa: Option<i64>,
    // L'anello: il secchio `k` sta nel posto `k mod n`. `chiave` dice quale
    // secchio c'è davvero, così un posto rimasto da un giro prima vale vuoto
    // senza doverlo pulire.
    chiave: Vec<Option<i64>>,
    primo: Vec<f64>,
    minimo: Vec<f64>,
    massimo: Vec<f64>,
    ultimo: Vec<f64>,
    /// Vero se il minimo viene prima del massimo.
    min_prima: Vec<bool>,
    /// Vero se nel secchio è entrato il dato vivo.
    vivo: Vec<bool>,
    /// L'ultimo valore di prima della finestra, col suo secchio: la linea
    /// parte da lì, come fa `ancora` sul server.
    prima: Option<(i64, f64)>,
}

impl MiniSerie {
    pub fn nuova(finestra_ms: u64, colonne: u32) -> Self {
        let secchio = secchio_ms(finestra_ms, colonne);
        let n = (colonne.max(1) as u64)
            .min(finestra_ms.div_ceil(secchio))
            .max(1) as usize;
        MiniSerie {
            secchio_ms: secchio,
            n,
            versione: 0,
            testa: None,
            chiave: vec![None; n],
            primo: vec![0.0; n],
            minimo: vec![0.0; n],
            massimo: vec![0.0; n],
            ultimo: vec![0.0; n],
            min_prima: vec![false; n],
            vivo: vec![false; n],
            prima: None,
        }
    }

    fn k(&self, ts: u64) -> i64 {
        (ts / self.secchio_ms) as i64
    }

    fn posto(&self, k: i64) -> usize {
        k.rem_euclid(self.n as i64) as usize
    }

    /// L'inizio del primo secchio in finestra, per un dato «adesso»: il
    /// `from` da chiedere al server per il seme.
    pub fn inizio_finestra(&self, adesso: u64) -> u64 {
        let k = self.k(adesso) - self.n as i64 + 1;
        (k.max(0) as u64) * self.secchio_ms
    }

    /// Il prossimo confine di secchio dopo `adesso`: lì la linea scorre.
    pub fn prossimo_confine(&self, adesso: u64) -> u64 {
        (adesso / self.secchio_ms + 1) * self.secchio_ms
    }

    /// Sposta la testa ad `adesso`. Non torna mai indietro.
    pub fn avanza(&mut self, adesso: u64) {
        let k = self.k(adesso);
        if self.testa.is_none_or(|t| k > t) {
            self.sposta(k);
        }
    }

    /// Un campione vivo, col tempo del server. O(1).
    pub fn aggiungi(&mut self, ts: u64, v: f64) {
        if !v.is_finite() {
            return;
        }
        let k = self.k(ts);
        if self.testa.is_none_or(|t| k > t) {
            self.sposta(k);
        }
        let testa = self.testa.unwrap_or(k);
        if k <= testa - self.n as i64 {
            self.ricorda_prima(k, v);
            return;
        }
        let i = self.posto(k);
        if self.chiave[i] != Some(k) {
            self.chiave[i] = Some(k);
            self.primo[i] = v;
            self.minimo[i] = v;
            self.massimo[i] = v;
            self.ultimo[i] = v;
            self.min_prima[i] = true;
            self.vivo[i] = true;
            self.versione += 1;
            return;
        }
        let mut cambiato = false;
        // L'estremo appena superato è il più recente dei due.
        if v < self.minimo[i] {
            self.minimo[i] = v;
            self.min_prima[i] = false;
            cambiato = true;
        }
        if v > self.massimo[i] {
            self.massimo[i] = v;
            self.min_prima[i] = true;
            cambiato = true;
        }
        if self.ultimo[i] != v {
            self.ultimo[i] = v;
            cambiato = true;
        }
        self.vivo[i] = true;
        if cambiato {
            self.versione += 1;
        }
    }

    /// I secchi dello storico (il seme). La fusione col dato vivo è
    /// idempotente: seme e vivo possono sovrapporsi senza doppioni, e un seme
    /// chiesto due volte non cambia niente.
    pub fn semina(&mut self, secchi: &[HistoryBucket]) {
        for b in secchi {
            if ![b.first, b.min, b.max, b.last]
                .iter()
                .all(|v| v.is_finite())
            {
                continue;
            }
            let k = self.k(b.ts_ms);
            if self.testa.is_none_or(|t| k > t) {
                self.sposta(k);
            }
            let testa = self.testa.unwrap_or(k);
            if k <= testa - self.n as i64 {
                self.ricorda_prima(k, b.last);
                continue;
            }
            let i = self.posto(k);
            // Il server non dice se il minimo viene prima del massimo: si
            // ricava dall'andamento fra primo e ultimo valore.
            let salita = b.last >= b.first;
            if self.chiave[i] != Some(k) || !self.vivo[i] {
                // Vuoto, o da un seme di prima: il seme nuovo copre almeno lo
                // stesso.
                self.chiave[i] = Some(k);
                self.primo[i] = b.first;
                self.minimo[i] = b.min;
                self.massimo[i] = b.max;
                self.ultimo[i] = b.last;
                self.min_prima[i] = salita;
                self.vivo[i] = false;
                self.versione += 1;
                continue;
            }
            // C'è già il dato vivo. Il seme comincia dall'inizio del secchio,
            // quindi il primo valore è suo; il vivo arriva fino ad adesso,
            // quindi l'ultimo resta del vivo. Un estremo che porta solo il
            // seme viene prima del vivo.
            let nuovo_min = b.min < self.minimo[i];
            let nuovo_max = b.max > self.massimo[i];
            if nuovo_min && nuovo_max {
                self.min_prima[i] = salita;
            } else if nuovo_min {
                self.min_prima[i] = true;
            } else if nuovo_max {
                self.min_prima[i] = false;
            }
            if nuovo_min {
                self.minimo[i] = b.min;
            }
            if nuovo_max {
                self.massimo[i] = b.max;
            }
            if nuovo_min || nuovo_max || self.primo[i] != b.first {
                self.primo[i] = b.first;
                self.versione += 1;
            }
        }
    }

    /// I secchi di un'altra serie uguale che cadono nella finestra di questa.
    /// Serve quando la serie si rifà perché la stima dell'orologio è cambiata:
    /// i secchi hanno il tempo del server e restano giusti, e così la linea non
    /// si svuota mentre arriva il seme nuovo. Quelli oltre la testa di questa
    /// serie si lasciano: sarebbero nel suo futuro.
    pub fn ricopia(&mut self, da: &MiniSerie) {
        if da.secchio_ms != self.secchio_ms || da.n != self.n {
            return;
        }
        let Some(testa) = self.testa else {
            return;
        };
        for j in 0..da.n {
            let Some(k) = da.chiave[j] else {
                continue;
            };
            if k > testa || k <= testa - self.n as i64 {
                continue;
            }
            let i = self.posto(k);
            self.chiave[i] = Some(k);
            self.primo[i] = da.primo[j];
            self.minimo[i] = da.minimo[j];
            self.massimo[i] = da.massimo[j];
            self.ultimo[i] = da.ultimo[j];
            self.min_prima[i] = da.min_prima[j];
            self.vivo[i] = da.vivo[j];
        }
        if let Some((pk, pv)) = da.prima {
            self.ricorda_prima(pk.min(testa - self.n as i64), pv);
        }
        self.versione += 1;
    }

    /// I punti del grafico, in O(colonne). La linea arriva fino ad «adesso»
    /// con l'ultimo valore, come lo storico con `ancora`. `y_min`/`y_max`
    /// fissano la scala; senza, segue i valori in finestra. Un valore fermo
    /// sta a metà altezza, come la sparkline LVGL ha sempre fatto.
    pub fn disegno(&self, y_min: Option<f64>, y_max: Option<f64>) -> Disegno {
        let n = self.n as i64;
        let ultima_x = (3 * n).min(i16::MAX as i64) as i16;
        let vuoto = Disegno {
            punti: Vec::new(),
            ultima_x,
            ultimo: None,
        };
        let Some(testa) = self.testa else {
            return vuoto;
        };
        let sinistra = testa - n + 1;
        // Prima passata: la scala e l'ultimo valore.
        let mut lo = f64::INFINITY;
        let mut hi = f64::NEG_INFINITY;
        let mut ultimo: Option<f64> = None;
        for c in 0..n {
            let i = self.posto(sinistra + c);
            if self.chiave[i] != Some(sinistra + c) {
                continue;
            }
            lo = lo.min(self.minimo[i]);
            hi = hi.max(self.massimo[i]);
            ultimo = Some(self.ultimo[i]);
        }
        let colonna_zero_vuota = self.chiave[self.posto(sinistra)] != Some(sinistra);
        let prima = self.prima.filter(|_| colonna_zero_vuota).map(|(_, v)| v);
        if let Some(p) = prima {
            lo = lo.min(p);
            hi = hi.max(p);
            ultimo = ultimo.or(Some(p));
        }
        let Some(ultimo) = ultimo else {
            return vuoto;
        };
        let lo = y_min.unwrap_or(lo);
        let hi = y_max.unwrap_or(hi);
        let y = |v: f64| -> i16 {
            if hi > lo {
                ((v - lo) / (hi - lo) * SCALA_Y as f64)
                    .round()
                    .clamp(i16::MIN as f64, i16::MAX as f64) as i16
            } else {
                SCALA_Y / 2
            }
        };
        let x = |terzi: i64| terzi.min(i16::MAX as i64) as i16;

        let mut punti: Vec<(i16, i16)> = Vec::with_capacity(4 * self.n + 2);
        let mut valori: Vec<f64> = Vec::with_capacity(4 * self.n + 2);
        // Lo stesso punto due volte (l'ultimo di un secchio e il primo del
        // successivo, uguali) non aggiunge niente.
        let mut metti = |px: i16, v: f64, punti: &mut Vec<(i16, i16)>| {
            if punti.last().map(|p| p.0) == Some(px) && valori.last() == Some(&v) {
                return;
            }
            punti.push((px, y(v)));
            valori.push(v);
        };
        if let Some(p) = prima {
            metti(0, p, &mut punti);
        }
        for c in 0..n {
            let k = sinistra + c;
            let i = self.posto(k);
            if self.chiave[i] != Some(k) {
                continue;
            }
            metti(x(3 * c), self.primo[i], &mut punti);
            let mut ultimo_messo = self.primo[i];
            if self.minimo[i] == self.massimo[i] {
                continue;
            }
            let (a, b) = if self.min_prima[i] {
                (self.minimo[i], self.massimo[i])
            } else {
                (self.massimo[i], self.minimo[i])
            };
            // Dentro il secchio si salta il valore uguale al precedente.
            for (terzo, v) in [(1, a), (2, b), (3, self.ultimo[i])] {
                if v != ultimo_messo {
                    metti(x(3 * c + terzo), v, &mut punti);
                    ultimo_messo = v;
                }
            }
        }
        // Fino ad «adesso», cioè al bordo destro, con l'ultimo valore.
        metti(ultima_x, ultimo, &mut punti);
        Disegno {
            punti,
            ultima_x,
            ultimo: Some(ultimo),
        }
    }

    fn sposta(&mut self, k: i64) {
        // I secchi che escono dalla finestra: il più recente con dati diventa
        // il valore di prima. Al più `n` giri, e solo quando la testa si muove.
        if let Some(t) = self.testa {
            let n = self.n as i64;
            for j in ((t - n + 1)..=t.min(k - n)).rev() {
                let i = self.posto(j);
                if self.chiave[i] == Some(j) {
                    let v = self.ultimo[i];
                    self.ricorda_prima(j, v);
                    break;
                }
            }
        }
        self.testa = Some(k);
        self.versione += 1;
    }

    fn ricorda_prima(&mut self, k: i64, v: f64) {
        if let Some((pk, pv)) = self.prima {
            if k < pk {
                return;
            }
            if pv == v {
                self.prima = Some((k, v));
                return;
            }
        }
        self.versione += 1;
        self.prima = Some((k, v));
    }
}

/// Il seme che arriva dal task di rete: `None` finché la risposta non c'è.
/// Una richiesta che fallisce porta una lista vuota, e si parte dal dato vivo.
pub type SharedSeme = Arc<Mutex<Option<Vec<HistoryBucket>>>>;

/// L'ora a un giro del ciclo di disegno: quella del pannello, quella del
/// server stimata dalla connessione (`ritardo::ora_del_server`), e l'epoca
/// dell'orologio, che cambia quando l'orologio del pannello salta.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ora {
    pub pannello: u64,
    pub server: u64,
    pub epoca: u64,
}

impl Ora {
    /// L'ora di adesso, dal processo.
    pub fn adesso() -> Self {
        let pannello = crate::client::now_unix_ms();
        Ora {
            pannello,
            server: crate::ritardo::ora_del_server(pannello),
            epoca: crate::ritardo::epoca_orologio(),
        }
    }

    fn sfasamento(&self) -> i64 {
        self.server as i64 - self.pannello as i64
    }
}

/// La mini tendenza viva: la serie, il seme in arrivo e l'orologio proprio.
/// È `MiniTendenza.tsx` senza React: il seme una volta, il dato vivo negli
/// stessi secchi, la linea che scorre al confine di ogni secchio.
pub struct Viva {
    pub serie: MiniSerie,
    finestra_ms: u64,
    colonne: u32,
    seme: Option<SharedSeme>,
    /// Il `ts` dell'ultimo valore vivo entrato: uno nuovo è una scrittura.
    ultimo_ts: u64,
    /// Il prossimo confine di secchio, nell'ora del server.
    confine: u64,
    disegnata: Option<u64>,
    /// L'orologio con cui la serie è nata: sfasamento ed epoca.
    nata_con: (i64, u64),
}

impl Viva {
    /// Una mini tendenza nuova: chiede subito il seme. `chiedi(da, a,
    /// secchio)` fa partire la richiesta e restituisce dove arriverà.
    pub fn nuova(
        finestra_ms: u64,
        colonne: u32,
        ora: Ora,
        chiedi: &mut impl FnMut(u64, u64, u64) -> SharedSeme,
    ) -> Self {
        let mut serie = MiniSerie::nuova(finestra_ms, colonne);
        serie.avanza(ora.server);
        let seme = chiedi(
            serie.inizio_finestra(ora.server),
            ora.server,
            serie.secchio_ms,
        );
        Viva {
            serie,
            finestra_ms,
            colonne,
            seme: Some(seme),
            ultimo_ts: 0,
            confine: 0,
            disegnata: None,
            nata_con: (ora.sfasamento(), ora.epoca),
        }
    }

    /// Un giro del ciclo di disegno. `valore` è il valore vivo del tag, col
    /// suo `ts` del server. Vero se il disegno è cambiato e va rifatto.
    pub fn giro(
        &mut self,
        ora: Ora,
        valore: Option<(u64, f64)>,
        chiedi: &mut impl FnMut(u64, u64, u64) -> SharedSeme,
    ) -> bool {
        // La stima dell'orologio è cambiata di più di un secchio e di un
        // secondo, o l'orologio del pannello è saltato: finestra e seme sono
        // nel posto sbagliato. Si rifà la serie, col suo seme; con lo stesso
        // orologio i secchi di prima restano giusti e si ricopiano.
        let sf = ora.sfasamento();
        let tolleranza = SCARTO_TOLLERATO_MS.max(self.serie.secchio_ms) as i64;
        if ora.epoca != self.nata_con.1 || (sf - self.nata_con.0).abs() > tolleranza {
            let mut nuova = MiniSerie::nuova(self.finestra_ms, self.colonne);
            nuova.avanza(ora.server);
            if ora.epoca == self.nata_con.1 {
                nuova.ricopia(&self.serie);
            }
            self.seme = Some(chiedi(
                nuova.inizio_finestra(ora.server),
                ora.server,
                nuova.secchio_ms,
            ));
            self.serie = nuova;
            self.nata_con = (sf, ora.epoca);
            self.ultimo_ts = 0;
            self.confine = 0;
            self.disegnata = None;
        }
        if let Some(seme) = &self.seme {
            let arrivato = seme.lock().unwrap_or_else(|e| e.into_inner()).take();
            if let Some(secchi) = arrivato {
                self.serie.avanza(ora.server);
                self.serie.semina(&secchi);
                self.seme = None;
            }
        }
        if let Some((ts, v)) = valore {
            if ts != self.ultimo_ts {
                self.ultimo_ts = ts;
                self.serie.avanza(ora.server);
                self.serie.aggiungi(ts, v);
            }
        }
        // L'orologio proprio: al confine del secchio la testa scorre, anche
        // a valore fermo. Un confronto per giro.
        if ora.server >= self.confine {
            self.serie.avanza(ora.server);
            self.confine = self.serie.prossimo_confine(ora.server);
        }
        let cambiato = self.disegnata != Some(self.serie.versione);
        self.disegnata = Some(self.serie.versione);
        cambiato
    }
}

#[cfg(test)]
mod prove {
    use super::*;

    /// Un'ora esatta di secchi da 25 s: l'inizio è allineato.
    const T0: u64 = 1_700_000_000_000;

    /// L'aggregazione del server (`sws_historian::aggregate_samples`).
    fn dal_server(campioni: &[(u64, f64)], secchio: u64) -> Vec<HistoryBucket> {
        let mut out: Vec<HistoryBucket> = Vec::new();
        for &(ts, v) in campioni {
            let t = ts - ts % secchio;
            match out.last_mut() {
                Some(b) if b.ts_ms == t => {
                    b.min = b.min.min(v);
                    b.max = b.max.max(v);
                    b.last = v;
                }
                _ => out.push(HistoryBucket {
                    ts_ms: t,
                    min: v,
                    max: v,
                    avg: v,
                    first: v,
                    last: v,
                }),
            }
        }
        out
    }

    fn per_colonna(d: &Disegno) -> usize {
        let mut conta = std::collections::HashMap::new();
        for (x, _) in &d.punti {
            *conta.entry(*x / 3).or_insert(0usize) += 1;
        }
        conta.into_values().max().unwrap_or(0)
    }

    #[test]
    fn le_colonne_sono_quelle_del_web() {
        // La kpi di Montagna è larga 160: la sua mini tendenza 148, e le
        // colonne 144, come sul web (`w - 12`, poi i due margini).
        assert_eq!(colonne(148.0), 144);
        assert_eq!(secchio_ms(3_600_000, colonne(148.0)), 25_000);
        assert_eq!(colonne(120.0), 116);
        assert_eq!(colonne(3.0), 1);
    }

    #[test]
    fn il_secchio_e_quello_del_web() {
        // Le kpi di Montagna sul web: 144 colonne, un'ora, 25 s.
        assert_eq!(secchio_ms(3_600_000, 144), 25_000);
        assert_eq!(secchio_ms(60_000, 116), 517);
        // Mai sotto i 100 ms, e niente divisione per zero.
        assert_eq!(secchio_ms(5_000, 116), 100);
        assert_eq!(secchio_ms(60_000, 0), 60_000);
    }

    /// I numeri di `miniSerie.test.ts`: 36.000 campioni a 10 Hz su un'ora e
    /// 144 colonne danno al massimo 4·144+2 punti.
    #[test]
    fn un_ora_a_10_hz_non_supera_4_punti_per_colonna() {
        let mut s = MiniSerie::nuova(3_600_000, 144);
        for i in 0..36_000u64 {
            s.aggiungi(
                T0 + i * 100,
                (i as f64 / 7.0).sin() * 50.0 + (i % 13) as f64,
            );
        }
        s.avanza(T0 + 3_599_900);
        let d = s.disegno(None, None);
        assert!(d.punti.len() <= 4 * 144 + 2, "{}", d.punti.len());
        assert!(d.punti.len() > 3 * 144, "{}", d.punti.len());
        assert!(per_colonna(&d) <= 5, "{}", per_colonna(&d));
        assert_eq!(d.ultima_x, 3 * 144);
    }

    #[test]
    fn i_punti_non_crescono_col_tempo() {
        let mut s = MiniSerie::nuova(3_600_000, 144);
        for i in 0..72_000u64 {
            s.aggiungi(
                T0 + i * 100,
                (i as f64 / 7.0).sin() * 50.0 + (i % 13) as f64,
            );
        }
        s.avanza(T0 + 7_199_900);
        assert!(s.disegno(None, None).punti.len() <= 4 * 144 + 2);
    }

    /// Seme e dato vivo sovrapposti danno lo stesso disegno del solo dato
    /// vivo, come sul web: una sparkline di 60 s larga 120, secchi da 517 ms.
    #[test]
    fn seme_e_vivo_sovrapposti_danno_lo_stesso_disegno_del_solo_vivo() {
        let finestra = 60_000;
        let colonne = 116;
        let b = secchio_ms(finestra, colonne);
        let inizio = T0 - T0 % b;
        let campioni: Vec<(u64, f64)> = (0..5_000u64)
            .map(|i| {
                let ts = inizio + i * 10;
                let k = ts / b;
                let frazione = (ts % b) as f64 / b as f64;
                let base = ((k * 7) % 11) as f64;
                (
                    ts,
                    if k % 2 == 1 {
                        base + frazione
                    } else {
                        base - frazione
                    },
                )
            })
            .collect();
        let fine = campioni.last().unwrap().0;
        let solo_vivo = {
            let mut s = MiniSerie::nuova(finestra, colonne);
            for &(ts, v) in &campioni {
                s.aggiungi(ts, v);
            }
            s.avanza(fine);
            s.disegno(None, None)
        };
        // Prima un po' di vivo, poi il seme, poi il resto del vivo.
        for i in (3_000..3_104).step_by(13) {
            let mut s = MiniSerie::nuova(finestra, colonne);
            let (j, m) = (i + 400, i + 600);
            for &(ts, v) in &campioni[i..m] {
                s.aggiungi(ts, v);
            }
            s.semina(&dal_server(&campioni[..=j], b));
            for &(ts, v) in &campioni[m..] {
                s.aggiungi(ts, v);
            }
            s.avanza(fine);
            assert_eq!(s.disegno(None, None), solo_vivo, "vivo da {i}");
        }
        // Lo stesso seme due volte non cambia niente.
        let mut s = MiniSerie::nuova(finestra, colonne);
        let seme = dal_server(&campioni[..3_401], b);
        s.semina(&seme);
        for &(ts, v) in &campioni[3_000..3_600] {
            s.aggiungi(ts, v);
        }
        s.semina(&seme);
        for &(ts, v) in &campioni[3_600..] {
            s.aggiungi(ts, v);
        }
        s.avanza(fine);
        assert_eq!(s.disegno(None, None), solo_vivo);
    }

    /// Un picco di un solo campione resta nel disegno: è il massimo della sua
    /// colonna.
    #[test]
    fn un_picco_di_un_solo_campione_resta() {
        let mut s = MiniSerie::nuova(3_600_000, 144);
        for i in 0..36_000u64 {
            s.aggiungi(T0 + i * 100, if i == 17_777 { 90.0 } else { 10.0 });
        }
        s.avanza(T0 + 3_599_900);
        let d = s.disegno(Some(0.0), Some(100.0));
        assert!(d.punti.iter().any(|p| p.1 == 900), "{:?}", d.punti);
    }

    #[test]
    fn avanza_di_un_ora_svuota_tutto_e_resta_l_ultimo_valore() {
        let mut s = MiniSerie::nuova(3_600_000, 144);
        for i in 0..36_000u64 {
            s.aggiungi(T0 + i * 100, (i as f64 / 7.0).sin() * 50.0);
        }
        let v0 = s.versione;
        s.avanza(T0 + 7_200_000);
        assert!(s.versione > v0);
        let d = s.disegno(None, None);
        assert_eq!(d.punti.len(), 2);
        assert_eq!(d.punti[0].1, d.punti[1].1);
        assert_eq!(d.ultimo, Some((35_999f64 / 7.0).sin() * 50.0));
    }

    /// Un valore oltre i 32.767 dell'`i16` conserva la sua forma.
    #[test]
    fn un_valore_grande_non_si_schiaccia_sul_tetto() {
        let mut s = MiniSerie::nuova(60_000, 116);
        for i in 0..600u64 {
            s.aggiungi(T0 + i * 100, 101_300.0 + (i % 50) as f64);
        }
        let ys: Vec<i16> = s.disegno(None, None).punti.iter().map(|p| p.1).collect();
        assert_eq!(ys.iter().min(), Some(&0));
        assert_eq!(ys.iter().max(), Some(&SCALA_Y));
    }

    /// Un valore fermo sta a metà altezza, e l'ultimo valore c'è.
    #[test]
    fn un_valore_fermo_sta_a_meta() {
        let mut s = MiniSerie::nuova(60_000, 116);
        for i in 0..600u64 {
            s.aggiungi(T0 + i * 100, 7.5);
        }
        let d = s.disegno(None, None);
        assert!(d.punti.iter().all(|p| p.1 == SCALA_Y / 2));
        assert_eq!(d.ultimo, Some(7.5));
    }

    /// In un secchio del seme che scende il massimo viene prima del minimo.
    #[test]
    fn l_ordine_fra_minimo_e_massimo_del_seme_segue_l_andamento() {
        let b = |first: f64, last: f64| HistoryBucket {
            ts_ms: T0,
            min: 0.0,
            max: 10.0,
            avg: 5.0,
            first,
            last,
        };
        let ys = |first, last| {
            let mut s = MiniSerie::nuova(60_000, 116);
            s.semina(&[b(first, last)]);
            let d = s.disegno(Some(0.0), Some(10.0));
            d.punti.iter().map(|p| p.1).collect::<Vec<_>>()
        };
        assert_eq!(ys(2.0, 8.0), vec![200, 0, 1000, 800]);
        assert_eq!(ys(8.0, 2.0), vec![800, 1000, 0, 200]);
    }

    #[test]
    fn senza_dati_non_ci_sono_punti() {
        let mut s = MiniSerie::nuova(60_000, 120);
        assert_eq!(s.disegno(None, None).punti, vec![]);
        s.avanza(T0);
        let d = s.disegno(None, None);
        assert!(d.punti.is_empty());
        assert_eq!(d.ultimo, None);
    }

    // ── la mini tendenza viva ───────────────────────────────────────────────

    /// Un pannello e un server sullo stesso orologio.
    fn ora(t: u64) -> Ora {
        Ora {
            pannello: t,
            server: t,
            epoca: 0,
        }
    }

    /// Chi chiede il seme: conta le richieste e risponde subito con lo
    /// storico che gli si dà.
    struct Server {
        richieste: Vec<(u64, u64, u64)>,
        storico: Vec<(u64, f64)>,
    }

    impl Server {
        fn chiedi(&mut self) -> impl FnMut(u64, u64, u64) -> SharedSeme + '_ {
            |da, a, secchio| {
                self.richieste.push((da, a, secchio));
                let dentro: Vec<(u64, f64)> = self
                    .storico
                    .iter()
                    .copied()
                    .filter(|&(ts, _)| ts >= da && ts <= a)
                    .collect();
                Arc::new(Mutex::new(Some(dal_server(&dentro, secchio))))
            }
        }
    }

    /// Prima ogni mini tendenza chiedeva l'ora intera ogni 2 s. Tre secondi di
    /// giri a 60 fotogrammi al secondo, con un valore nuovo a ogni decimo:
    /// una richiesta sola.
    #[test]
    fn il_seme_si_chiede_una_volta() {
        let mut server = Server {
            richieste: vec![],
            storico: (0..600)
                .map(|i| (T0 - 60_000 + i * 100, i as f64))
                .collect(),
        };
        let mut v = Viva::nuova(3_600_000, 144, ora(T0), &mut server.chiedi());
        for f in 0..180u64 {
            let t = T0 + f * 1_000 / 60;
            v.giro(
                ora(t),
                Some((t - t % 100, (f % 7) as f64)),
                &mut server.chiedi(),
            );
        }
        assert_eq!(server.richieste.len(), 1);
        assert_eq!(server.richieste[0].2, 25_000);
        assert!(v.serie.disegno(None, None).punti.len() > 2);
    }

    /// Senza valori nuovi la linea scorre lo stesso, al confine del secchio.
    #[test]
    fn senza_valori_nuovi_la_linea_scorre() {
        let mut server = Server {
            richieste: vec![],
            storico: (0..300)
                .map(|i| (T0 - 30_000 + i * 100, i as f64))
                .collect(),
        };
        let mut v = Viva::nuova(60_000, 116, ora(T0), &mut server.chiedi());
        assert!(v.giro(ora(T0), Some((T0, 300.0)), &mut server.chiedi()));
        let prima = v.serie.disegno(None, None);
        // Nello stesso secchio non cambia niente, e non si ridisegna.
        assert!(!v.giro(ora(T0 + 1), Some((T0, 300.0)), &mut server.chiedi()));
        let b = v.serie.secchio_ms;
        let mut ridisegni = 0;
        for f in 1..=(3 * b / 16) {
            if v.giro(ora(T0 + f * 16), Some((T0, 300.0)), &mut server.chiedi()) {
                ridisegni += 1;
            }
        }
        assert!((3..=4).contains(&ridisegni), "{ridisegni} ridisegni");
        assert_ne!(v.serie.disegno(None, None), prima);
        assert_eq!(server.richieste.len(), 1);
    }

    /// La stima dell'orologio del server cambia di un minuto (il primo delta
    /// di un pannello remoto): la serie si rifà e chiede il seme di nuovo,
    /// una volta, e intanto la linea non si svuota.
    #[test]
    fn un_orologio_nuovo_rifa_la_serie_una_volta() {
        let avanti = 60_000;
        let mut server = Server {
            richieste: vec![],
            storico: (0..600)
                .map(|i| (T0 + avanti - 60_000 + i * 100, (i % 13) as f64))
                .collect(),
        };
        let mut v = Viva::nuova(60_000, 116, ora(T0), &mut server.chiedi());
        v.giro(ora(T0), None, &mut server.chiedi());
        let o = Ora {
            pannello: T0 + 100,
            server: T0 + 100 + avanti,
            epoca: 0,
        };
        v.giro(o, Some((o.server, 2.0)), &mut server.chiedi());
        assert_eq!(server.richieste.len(), 2);
        assert!(v.serie.disegno(None, None).punti.len() > 2);
        for f in 1..100u64 {
            let o = Ora {
                pannello: T0 + 100 + f * 16,
                server: T0 + 100 + f * 16 + avanti,
                epoca: 0,
            };
            v.giro(o, None, &mut server.chiedi());
        }
        assert_eq!(server.richieste.len(), 2);
    }

    /// L'orologio del pannello salta indietro di 20 s (NTP): la serie si rifà,
    /// e l'ultimo valore è quello nuovo, non quello di prima del salto.
    #[test]
    fn un_salto_dell_orologio_rifa_la_serie() {
        let mut server = Server {
            richieste: vec![],
            storico: vec![],
        };
        let mut v = Viva::nuova(60_000, 116, ora(T0), &mut server.chiedi());
        for i in 1..=20u64 {
            let t = T0 + i * 100;
            v.giro(ora(t), Some((t, i as f64)), &mut server.chiedi());
        }
        let t = T0 + 2_100 - 20_000;
        let o = Ora {
            pannello: t,
            server: t,
            epoca: 1,
        };
        v.giro(o, Some((t, 999.0)), &mut server.chiedi());
        assert_eq!(v.serie.disegno(None, None).ultimo, Some(999.0));
        assert_eq!(server.richieste.len(), 2);
    }
}
