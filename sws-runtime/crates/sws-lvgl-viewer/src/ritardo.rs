//! «Dati in ritardo» sul pannello (09-11-2026, piano
//! `docs/plans/2026-11-09-viewer-leggero.md` §5-bis).
//!
//! La regola è quella del viewer web, decisa dal maintainer per tutti e due i
//! motori: quando i valori a schermo sono vecchi di più di **5 s** compare in
//! alto la fascia «Dati in ritardo di N s» e gli oggetti prendono lo stile «non
//! aggiornato»; quando l'età torna sotto, tutto sparisce da sé.
//!
//! Qui c'è solo il *quando*, senza LVGL: si prova con `cargo test` su qualunque
//! macchina. Il disegno sta in `lvgl_ritardo.rs`.
//!
//! # Cosa si misura
//!
//! L'età dei valori **quando il disegno li applica**: `adesso − ts` della voce,
//! meno lo scarto fra l'orologio del server e quello del pannello. È lì che si
//! vede una coda, sia quella del server che non riesce a spedire sia quella del
//! ciclo di disegno che non riesce a stare dietro.
//!
//! - **Lo scarto** è il minimo `adesso − ts` visto sulla connessione. Un
//!   orologio sfasato di un minuto non deve accendere niente: la voce più
//!   fresca che sia mai arrivata dice quanto i due orologi sono lontani.
//!   Riparte quando il socket si apre ([`Misura::aperto`]), non a ogni
//!   snapshot: uno snapshot a metà connessione non spegne un ritardo vero.
//! - **Un salto dell'orologio del pannello** (NTP, l'ora cambiata a mano) fa
//!   ripartire la stima dello scarto ([`Misura::orologio`]). Senza, un salto
//!   indietro di 20 s con un valore in volo lasciava lo scarto 20 s più basso,
//!   e la fascia accesa con «20 s» fino alla riconnessione. Il salto si vede
//!   confrontando l'ora con un orologio monotono, che non salta mai; il lotto
//!   di quel momento non si misura, perché può avere il `ts` del vecchio
//!   orologio.
//! - **Di ogni lotto conta la voce più recente.** Una foglia scritta fa
//!   arrivare tutta la sua radice, e le foglie sorelle portano il loro `ts`
//!   vecchio (`espandi_foglie`, `sws-core/src/tag.rs:486-519`): contare la più
//!   vecchia accenderebbe la fascia a ogni scrittura su una struttura.
//! - **Lo snapshot non dà un'età.** Porta lo stato di tutti i tag, anche di
//!   quelli fermi da ore: è attuale per definizione. Aiuta solo a stimare lo
//!   scarto, perché nessuna voce ha un `ts` nel futuro del server; e lo si
//!   conta quando il disegno lo applica, come i delta.
//! - **Il socket giù conta.** Chiuso o in riconnessione, i valori a schermo
//!   invecchiano da quando è caduto.
//! - **Un impianto fermo non è in ritardo.** Col socket vivo e nessun delta
//!   per 5 s, l'ultima misura non vale più: i valori a schermo sono quelli di
//!   adesso. Senza questa scadenza, un ritardo seguito da un impianto fermo
//!   (CasaDomotica di notte) lasciava fascia e grigio accesi per ore.
//!
//! È la stessa regola del viewer web (`sws-editor/src/ws/coalescenza.ts`),
//! punto per punto: chi ne cambia una cambi anche l'altra.
//!
//! Lo scarto serve anche alle mini tendenze ([`ora_del_server`]): un orologio
//! solo per tutto il pannello.
//!
//! Un limite noto, lo stesso del web: se fin dal primo lotto della connessione
//! tutto arriva in ritardo, lo scarto se lo prende e la fascia non si accende
//! finché non arriva una voce più fresca. Per questo lo snapshot conta nella
//! stima: di solito ha almeno un tag scritto da poco.

use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use sws_core::testi_sistema::{testo_con, Testo};

/// Oltre questa età i valori a schermo si dicono in ritardo. «Più di 5 s»:
/// a 5 000 ms esatti la fascia non c'è ancora.
pub const SOGLIA_MS: u64 = 5_000;

/// Oltre questo spostamento fra l'ora e l'orologio monotono l'orologio del
/// pannello è saltato. Un orologio corretto piano da NTP si sposta di qualche
/// millisecondo all'ora.
pub const SALTO_OROLOGIO_MS: i64 = 1_000;

/// La misura di una connessione. Pura: chi la usa le passa l'ora.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Misura {
    /// Il `ts` più recente fra i delta arrivati e non ancora applicati.
    in_attesa: Option<u64>,
    /// Il `ts` più recente fra gli snapshot arrivati e non ancora applicati:
    /// servono solo allo scarto.
    snapshot_in_attesa: Option<u64>,
    /// Il minimo `adesso − ts` visto su questa connessione.
    scarto: Option<i64>,
    /// Vero dopo il primo delta misurato: prima lo scarto viene solo dallo
    /// snapshot, che può avere solo tag fermi da ore.
    delta_visto: bool,
    /// L'età dell'ultimo delta applicato, scarto tolto, e quando lo si è
    /// applicato.
    eta_ms: u64,
    misurato_il: u64,
    /// Da quando il socket è giù, se lo è, e l'età che i valori avevano in
    /// quel momento.
    giu_da: Option<u64>,
    eta_alla_caduta: u64,
    /// `adesso − monotono` all'ultima misura: se cambia, l'orologio è saltato.
    riferimento: Option<i64>,
    /// Lo scarto delle mini tendenze: quello della connessione, dal suo primo
    /// delta. Fra una connessione e l'altra resta quello di prima, che di
    /// solito è ancora giusto. Un salto dell'orologio lo azzera.
    scarto_orologio: Option<i64>,
    /// Cresce a ogni salto dell'orologio.
    epoca: u64,
}

impl Misura {
    pub const NUOVA: Misura = Misura {
        in_attesa: None,
        snapshot_in_attesa: None,
        scarto: None,
        delta_visto: false,
        eta_ms: 0,
        misurato_il: 0,
        giu_da: None,
        eta_alla_caduta: 0,
        riferimento: None,
        scarto_orologio: None,
        epoca: 0,
    };

    /// Il socket si è appena aperto: una connessione nuova, con un suo
    /// scarto. L'orologio delle mini tendenze resta quello di prima.
    pub fn aperto(&mut self) {
        *self = Misura {
            scarto_orologio: self.scarto_orologio,
            epoca: self.epoca,
            ..Misura::NUOVA
        };
    }

    /// Uno snapshot: serve solo alla stima dello scarto. `ts_max` è il `ts`
    /// più recente fra le sue voci (0 se nessuna lo porta).
    pub fn snapshot(&mut self, ts_max: u64) {
        if ts_max == 0 {
            return;
        }
        self.snapshot_in_attesa = Some(self.snapshot_in_attesa.map_or(ts_max, |t| t.max(ts_max)));
    }

    /// Un delta ricevuto: conta la sua voce più recente. Un server che non
    /// manda il `ts` dà 0, che non dice niente e non si conta.
    pub fn delta(&mut self, ts_max: u64) {
        if ts_max == 0 {
            return;
        }
        self.in_attesa = Some(self.in_attesa.map_or(ts_max, |t| t.max(ts_max)));
    }

    /// Il socket è caduto. Vale il primo istante: i tentativi di
    /// riconnessione che falliscono non lo spostano in avanti.
    pub fn giu(&mut self, adesso: u64) {
        if self.giu_da.is_none() {
            self.eta_alla_caduta = self.eta_viva(adesso);
            self.giu_da = Some(adesso);
        }
    }

    /// Il disegno sta per applicare i valori: prima si guarda se l'orologio
    /// del pannello è saltato, confrontando l'ora con un orologio monotono
    /// (`monotono`, in millisecondi da un istante qualunque). Se è saltato,
    /// lo scarto di prima è dell'orologio di prima: la stima riparte dal
    /// lotto dopo, perché quello in mano può avere voci scritte prima del
    /// salto.
    pub fn orologio(&mut self, adesso: u64, monotono: u64) {
        let rif = adesso as i64 - monotono as i64;
        let saltato = self
            .riferimento
            .is_some_and(|r| (rif - r).abs() > SALTO_OROLOGIO_MS);
        self.riferimento = Some(rif);
        if saltato {
            self.in_attesa = None;
            self.snapshot_in_attesa = None;
            self.scarto = None;
            self.delta_visto = false;
            self.eta_ms = 0;
            self.misurato_il = 0;
            self.scarto_orologio = None;
            self.epoca = self.epoca.wrapping_add(1);
        }
    }

    /// Il disegno applica i valori: restituisce la loro età, in millisecondi.
    pub fn applica(&mut self, adesso: u64) -> u64 {
        if let Some(ts) = self.snapshot_in_attesa.take() {
            self.conta_scarto(adesso as i64 - ts as i64);
        }
        if let Some(ts) = self.in_attesa.take() {
            let grezza = adesso as i64 - ts as i64;
            let scarto = self.conta_scarto(grezza);
            self.eta_ms = (grezza - scarto) as u64;
            self.misurato_il = adesso;
            self.delta_visto = true;
        }
        if self.delta_visto {
            self.scarto_orologio = self.scarto;
        }
        match self.giu_da {
            Some(t) => self
                .eta_alla_caduta
                .saturating_add(adesso.saturating_sub(t)),
            None => self.eta_viva(adesso),
        }
    }

    fn conta_scarto(&mut self, grezza: i64) -> i64 {
        let scarto = self.scarto.map_or(grezza, |s| s.min(grezza));
        self.scarto = Some(scarto);
        scarto
    }

    /// L'età dell'ultimo delta, se è di meno di 5 s fa; altrimenti 0: senza
    /// delta i valori a schermo sono gli ultimi che il server ha.
    fn eta_viva(&self, adesso: u64) -> u64 {
        if adesso.saturating_sub(self.misurato_il) > SOGLIA_MS {
            0
        } else {
            self.eta_ms
        }
    }
}

/// I valori sono in ritardo?
pub fn in_ritardo(eta_ms: u64) -> bool {
    eta_ms > SOGLIA_MS
}

/// Il testo della fascia, nella lingua dei contenuti; `None` se la fascia non
/// va mostrata. I secondi si arrotondano, come sul web.
pub fn testo_fascia(eta_ms: u64, lingua: &str) -> Option<String> {
    if !in_ritardo(eta_ms) {
        return None;
    }
    let n = eta_ms.saturating_add(500) / 1000;
    Some(testo_con(
        Testo::DatiInRitardo,
        lingua,
        &[("n", &n.to_string())],
    ))
}

// ── lo stato del processo ───────────────────────────────────────────────────
//
// Lo scrive il task WS (su tokio), lo legge il ciclo di disegno: una statica,
// come `net_worker::RIFIUTO`. Passarla per argomento avrebbe voluto un terzo
// valore di ritorno da `spawn_tag_subscription` e quattro firme in più, per una
// misura che di connessioni ne ha una sola.

static MISURA: Mutex<Misura> = Mutex::new(Misura::NUOVA);

/// Vero mentre la fascia è accesa: lo legge `update_effects`, a ogni oggetto
/// con effetti, quindi un atomico e non un lock.
static ATTIVO: AtomicBool = AtomicBool::new(false);

/// L'orologio delle mini tendenze, copiato a ogni fotogramma: lo leggono
/// una dozzina di sparkline per giro, senza prendere il lock del task WS.
/// `i64::MIN` = ancora sconosciuto.
static SCARTO_OROLOGIO: AtomicI64 = AtomicI64::new(i64::MIN);
static EPOCA: AtomicU64 = AtomicU64::new(0);

/// `--ritardo-di-prova`, in millisecondi; 0 = niente.
static PROVA_MS: AtomicU64 = AtomicU64::new(0);

fn misura() -> std::sync::MutexGuard<'static, Misura> {
    MISURA.lock().unwrap_or_else(|e| e.into_inner())
}

/// I millisecondi dell'orologio monotono, da un istante qualunque.
fn monotono() -> u64 {
    static AVVIO: OnceLock<Instant> = OnceLock::new();
    AVVIO.get_or_init(Instant::now).elapsed().as_millis() as u64
}

/// Dal task WS: il socket si è appena aperto.
pub fn socket_aperto() {
    misura().aperto();
}

/// Dal task WS: è arrivato uno snapshot.
pub fn snapshot_arrivato(ts_max: u64) {
    misura().snapshot(ts_max);
}

/// Dal task WS: è arrivato un delta, e i suoi valori sono già nella mappa.
pub fn delta_arrivato(ts_max: u64) {
    misura().delta(ts_max);
}

/// Dal task WS: il socket è caduto.
pub fn socket_giu() {
    misura().giu(crate::client::now_unix_ms());
}

/// Dal ciclo di disegno, **prima** di `update_bindings`: l'età dei valori che
/// sta per applicare. Accende o spegne lo stile «non aggiornato» per gli
/// oggetti con effetti, che lo leggono in quello stesso giro.
pub fn al_fotogramma(adesso: u64) -> u64 {
    let eta = {
        let mut m = misura();
        m.orologio(adesso, monotono());
        let eta = m.applica(adesso);
        SCARTO_OROLOGIO.store(m.scarto_orologio.unwrap_or(i64::MIN), Ordering::Relaxed);
        EPOCA.store(m.epoca, Ordering::Relaxed);
        eta
    }
    .max(PROVA_MS.load(Ordering::Relaxed));
    ATTIVO.store(in_ritardo(eta), Ordering::Relaxed);
    eta
}

/// L'ora del server, stimata con lo scarto della connessione: la usano le
/// mini tendenze, al posto dell'ora del pannello. Senza un delta vale
/// `adesso`: lo snapshot da solo può avere tutti tag fermi da ore. Lo scarto
/// è un minimo, quindi quest'ora non va mai oltre quella vera.
pub fn ora_del_server(adesso: u64) -> u64 {
    con_scarto(adesso, SCARTO_OROLOGIO.load(Ordering::Relaxed))
}

fn con_scarto(adesso: u64, scarto: i64) -> u64 {
    match scarto {
        i64::MIN => adesso,
        s => (adesso as i64 - s).max(0) as u64,
    }
}

/// Cambia quando l'orologio del pannello salta: chi ha costruito qualcosa
/// sull'ora di prima (le mini tendenze) lo rifà.
pub fn epoca_orologio() -> u64 {
    EPOCA.load(Ordering::Relaxed)
}

/// La fascia è accesa?
pub fn attivo() -> bool {
    ATTIVO.load(Ordering::Relaxed)
}

/// `--ritardo-di-prova`: un ritardo finto, per vedere la fascia senza staccare
/// la rete del pannello. Vince sulla misura vera solo se è più grande.
pub fn di_prova(secondi: u64) {
    PROVA_MS.store(secondi.saturating_mul(1000), Ordering::Relaxed);
}

#[cfg(test)]
mod prove {
    use super::*;

    const ADESSO: u64 = 1_800_000_000_000;

    /// Una connessione appena aperta, con uno snapshot che ha almeno un tag
    /// scritto adesso.
    fn connessa() -> Misura {
        let mut m = Misura::NUOVA;
        m.aperto();
        m.snapshot(ADESSO);
        m
    }

    #[test]
    fn voci_vecchie_di_8_s_accendono_la_fascia() {
        let mut m = connessa();
        m.delta(ADESSO - 8_000);
        let eta = m.applica(ADESSO);
        assert_eq!(eta, 8_000);
        assert_eq!(
            testo_fascia(eta, "it").as_deref(),
            Some("Dati in ritardo di 8 s")
        );
        assert_eq!(
            testo_fascia(eta, "en").as_deref(),
            Some("Data delayed by 8 s")
        );
    }

    #[test]
    fn la_fascia_si_spegne_quando_arriva_un_valore_fresco() {
        let mut m = connessa();
        m.delta(ADESSO - 8_000);
        assert!(in_ritardo(m.applica(ADESSO)));
        m.delta(ADESSO + 1_000);
        assert_eq!(m.applica(ADESSO + 1_000), 0);
        assert_eq!(testo_fascia(0, "it"), None);
    }

    #[test]
    fn un_orologio_sfasato_di_un_minuto_non_accende_niente() {
        // Il server indietro di 60 s: ogni voce sembra vecchia di un minuto.
        let mut m = Misura::NUOVA;
        m.snapshot(ADESSO - 60_000);
        m.delta(ADESSO + 1_000 - 60_000);
        assert_eq!(m.applica(ADESSO + 1_000), 0);
        // E il server avanti di 60 s: ogni voce arriva dal futuro.
        let mut m = Misura::NUOVA;
        m.snapshot(ADESSO + 60_000);
        m.delta(ADESSO + 1_000 + 60_000);
        assert_eq!(m.applica(ADESSO + 1_000), 0);
        // Lo scarto tolto, un ritardo vero si vede lo stesso.
        m.delta(ADESSO + 2_000 + 60_000 - 8_000);
        assert_eq!(m.applica(ADESSO + 2_000), 8_000);
    }

    #[test]
    fn lo_scarto_si_stima_anche_senza_snapshot() {
        // Il primo delta fa da riferimento, quelli dopo si misurano su di lui.
        let mut m = Misura::NUOVA;
        m.delta(ADESSO - 60_000);
        assert_eq!(m.applica(ADESSO), 0);
        m.delta(ADESSO + 1_000 - 60_000 - 7_000);
        assert_eq!(m.applica(ADESSO + 1_000), 7_000);
    }

    #[test]
    fn il_socket_giu_da_6_s_accende_la_fascia() {
        let mut m = connessa();
        m.giu(ADESSO);
        assert!(!in_ritardo(m.applica(ADESSO + 4_000)), "4 s non bastano");
        assert!(!in_ritardo(m.applica(ADESSO + 5_000)), "5 s esatti nemmeno");
        let eta = m.applica(ADESSO + 6_000);
        assert_eq!(
            testo_fascia(eta, "it").as_deref(),
            Some("Dati in ritardo di 6 s")
        );
    }

    #[test]
    fn i_tentativi_falliti_non_spostano_la_caduta() {
        let mut m = connessa();
        m.giu(ADESSO);
        m.giu(ADESSO + 3_000);
        assert_eq!(m.applica(ADESSO + 6_000), 6_000);
    }

    #[test]
    fn la_riconnessione_riparte_da_capo() {
        let mut m = connessa();
        m.giu(ADESSO);
        assert!(in_ritardo(m.applica(ADESSO + 10_000)));
        // Il socket si riapre: è una connessione nuova, e la fascia si spegne
        // subito, prima ancora dello snapshot.
        m.aperto();
        assert_eq!(m.applica(ADESSO + 10_000), 0);
        m.snapshot(ADESSO + 10_000);
        assert_eq!(m.applica(ADESSO + 10_000), 0);
    }

    #[test]
    fn un_impianto_fermo_col_socket_vivo_non_e_in_ritardo() {
        let mut m = connessa();
        m.delta(ADESSO);
        assert_eq!(m.applica(ADESSO), 0);
        // Dieci minuti senza un messaggio: i valori a schermo sono quelli di adesso.
        assert_eq!(m.applica(ADESSO + 600_000), 0);
    }

    #[test]
    fn dopo_un_ritardo_l_impianto_fermo_spegne_la_fascia() {
        // Un delta applicato con 8 s di coda, poi più niente (CasaDomotica di
        // notte): 5 s dopo l'ultimo delta i valori a schermo sono quelli di
        // adesso. Prima la fascia restava accesa fino al delta successivo.
        let mut m = connessa();
        m.delta(ADESSO - 8_000);
        assert_eq!(m.applica(ADESSO), 8_000);
        assert_eq!(m.applica(ADESSO + 5_000), 8_000);
        assert_eq!(m.applica(ADESSO + 5_001), 0);
    }

    #[test]
    fn la_caduta_dopo_un_impianto_fermo_parte_da_zero() {
        let mut m = connessa();
        m.delta(ADESSO - 8_000);
        assert_eq!(m.applica(ADESSO), 8_000);
        // Dieci minuti fermi, poi il socket cade: i valori avevano età zero.
        m.giu(ADESSO + 600_000);
        assert!(!in_ritardo(m.applica(ADESSO + 604_000)), "prima dava 12 s");
        assert_eq!(m.applica(ADESSO + 606_000), 6_000);
    }

    #[test]
    fn uno_snapshot_a_meta_connessione_non_spegne_il_ritardo() {
        // Lo scarto riparte quando il socket si apre, non a ogni snapshot: un
        // riallineamento mandato proprio perché i dati sono in ritardo non
        // deve spegnere la fascia.
        let mut m = connessa();
        assert_eq!(m.applica(ADESSO), 0);
        m.delta(ADESSO - 8_000);
        assert_eq!(m.applica(ADESSO), 8_000);
        m.snapshot(ADESSO);
        assert_eq!(m.applica(ADESSO), 8_000);
        // E il prossimo delta in ritardo si misura con lo scarto di prima.
        m.delta(ADESSO + 1_000 - 9_000);
        assert_eq!(m.applica(ADESSO + 1_000), 9_000);
    }

    #[test]
    fn un_salto_indietro_dell_orologio_con_un_valore_in_volo_non_blocca_la_fascia() {
        // Il WP630: runtime e viewer sullo stesso orologio, che NTP porta
        // indietro di 20 s mentre un delta scritto prima del salto è in volo.
        let mut m = connessa();
        m.orologio(ADESSO, 0);
        m.delta(ADESSO);
        assert_eq!(m.applica(ADESSO), 0);
        let indietro = ADESSO + 2_000 - 20_000;
        m.delta(ADESSO + 1_900);
        m.orologio(indietro, 2_000);
        assert!(!in_ritardo(m.applica(indietro)));
        // Dieci secondi di valori freschi, col nuovo orologio. Prima: «Dati
        // in ritardo di 20 s», fino alla riconnessione.
        for s in 1..=10u64 {
            let adesso = indietro + s * 1_000;
            m.delta(adesso - 30);
            m.orologio(adesso, 2_000 + s * 1_000);
            let eta = m.applica(adesso);
            assert!(!in_ritardo(eta), "dopo {s} s: {eta} ms");
        }
    }

    #[test]
    fn l_orologio_del_pannello_che_salta_avanti_non_blocca_la_fascia() {
        // Un pannello remoto: il suo orologio salta avanti di 30 s, quello del
        // server no.
        let mut m = connessa();
        m.orologio(ADESSO, 0);
        m.delta(ADESSO);
        assert_eq!(m.applica(ADESSO), 0);
        for s in 1..=5u64 {
            let adesso = ADESSO + 30_000 + s * 1_000;
            m.delta(adesso - 30_000 - 30);
            m.orologio(adesso, s * 1_000);
            assert!(!in_ritardo(m.applica(adesso)), "dopo {s} s");
        }
        // Il ritardo vero si vede ancora.
        let adesso = ADESSO + 30_000 + 6_000;
        m.delta(adesso - 30_000 - 8_000);
        m.orologio(adesso, 6_000);
        assert_eq!(m.applica(adesso), 7_970);
    }

    impl Misura {
        fn ora_del_server(&self, adesso: u64) -> u64 {
            con_scarto(adesso, self.scarto_orologio.unwrap_or(i64::MIN))
        }
    }

    #[test]
    fn l_ora_del_server_per_le_mini_tendenze() {
        let mut m = Misura::NUOVA;
        m.aperto();
        assert_eq!(m.ora_del_server(ADESSO), ADESSO);
        // Lo snapshot da solo non sposta l'ora: può avere tag fermi da ore.
        m.snapshot(ADESSO - 3_600_000);
        m.applica(ADESSO);
        assert_eq!(m.ora_del_server(ADESSO), ADESSO);
        // Il server 60 s avanti: lo dice il primo delta.
        m.delta(ADESSO + 60_000);
        m.applica(ADESSO);
        assert_eq!(m.ora_del_server(ADESSO + 500), ADESSO + 60_500);
        // Una riconnessione la tiene, un salto dell'orologio no.
        let epoca = m.epoca;
        m.aperto();
        assert_eq!(m.ora_del_server(ADESSO), ADESSO + 60_000);
        m.orologio(ADESSO, 0);
        m.orologio(ADESSO + 10_000, 1_000);
        assert_eq!(m.ora_del_server(ADESSO), ADESSO);
        assert_ne!(m.epoca, epoca);
    }

    #[test]
    fn lo_snapshot_di_tag_fermi_da_ore_non_e_un_ritardo() {
        let mut m = Misura::NUOVA;
        m.snapshot(ADESSO - 3 * 3_600_000);
        assert_eq!(m.applica(ADESSO), 0);
    }

    #[test]
    fn di_piu_lotti_fra_due_giri_conta_il_piu_recente() {
        let mut m = connessa();
        m.delta(ADESSO - 9_000);
        m.delta(ADESSO - 200);
        m.delta(ADESSO - 6_000);
        assert_eq!(m.applica(ADESSO), 200);
    }

    #[test]
    fn un_server_senza_ts_non_accende_niente() {
        let mut m = connessa();
        m.delta(0);
        assert_eq!(m.applica(ADESSO + 60_000), 0);
    }

    #[test]
    fn i_secondi_si_arrotondano() {
        assert_eq!(
            testo_fascia(7_499, "it").as_deref(),
            Some("Dati in ritardo di 7 s")
        );
        assert_eq!(
            testo_fascia(7_500, "it").as_deref(),
            Some("Dati in ritardo di 8 s")
        );
        assert_eq!(testo_fascia(SOGLIA_MS, "it"), None);
    }
}
