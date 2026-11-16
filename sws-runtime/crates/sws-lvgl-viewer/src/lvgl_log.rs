//! Il log di LVGL, senza che una riga sola ne cancelli tutte le altre (Q24).
//!
//! ## Il problema, misurato
//!
//! Il font predefinito di LVGL (Montserrat) copre solo l'ASCII, e per ogni
//! carattere che non ha emette un avviso. Non una volta per testo: **a ogni
//! ridisegno**. Sul WP630, il 2026-08-27, il viewer produceva **10.284 righe in
//! 44 secondi** sulla pagina degli allarmi, di cui oltre il 90%
//! `glyph dsc. not found`.
//!
//! Il danno non è il rumore. È che le righe d'avvio — quante pagine caricate,
//! quanti oggetti creati, quali scartati — **sparivano entro pochi secondi**,
//! spinte fuori dal buffer. Mi è successo mentre stavo diagnosticando proprio
//! quel viewer: cercavo la riga "pagina caricata" e non c'era più.
//!
//! Un difetto tipografico che nasconde le diagnosi è peggio del difetto
//! tipografico.
//!
//! ## Come si strozza
//!
//! Non "stampa una volta e poi mai più": un messaggio che si ripete può essere
//! un problema che *sta peggiorando*, e zittirlo del tutto lo renderebbe
//! invisibile quanto lo è adesso il resto.
//!
//! Si stampano le occorrenze 1, 2, 4, 8, 16… — potenze di due. Un messaggio
//! occasionale si vede tutto; uno che esplode costa 14 righe per 10.000
//! occorrenze invece di 10.000, e ogni riga dice a quante è arrivato. Il costo
//! cresce col logaritmo del problema, non col problema.

use std::collections::HashMap;
use std::ffi::CStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Quante volte si è già visto ogni messaggio.
///
/// La chiave è il testo del messaggio così com'è: due codepoint diversi
/// (`U+2014` e `U+00F9`) restano messaggi distinti, ed è giusto così — dicono
/// due cose diverse su cosa manca nel font.
static VISTI: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);

/// Registra il filtro come destinazione dei log di LVGL.
///
/// Da chiamare **prima** di `lv_init()`: gli avvisi cominciano da lì.
///
/// Richiede `LV_LOG_PRINTF 0` in `lv_conf.h`. Con `LV_LOG_PRINTF 1` LVGL stampa
/// da sé con `printf` e non consulta nessun callback — il filtro verrebbe
/// registrato, non fallirebbe niente, e il log continuerebbe a inondare
/// esattamente come prima. È il modo silenzioso in cui questo modulo può
/// smettere di funzionare, e per questo sta scritto qui.
pub fn install() {
    VERBOSE.store(verbose_from_env(), Ordering::Relaxed);
    unsafe { lvgl_sys::lv_log_register_print_cb(Some(print_cb)) };
}

/// Whether LVGL's `[Info]` and `[Trace]` lines are printed too.
///
/// Off by default: with the control panel open, LVGL's `[Info] flex_update`
/// alone was 175-513 lines a minute in the journal of the TY570 (16-11-2026),
/// for nothing an operator or a diagnosis needs. The build keeps
/// `LV_LOG_LEVEL_INFO`, so that `SWS_LVGL_LOG=info` (in `/etc/sws/viewer.env`
/// on a Tiny TY) brings them back without a new binary.
static VERBOSE: AtomicBool = AtomicBool::new(false);

fn verbose_from_env() -> bool {
    std::env::var("SWS_LVGL_LOG").is_ok_and(|v| v.eq_ignore_ascii_case("info"))
}

/// Whether a line of this level is printed: warnings, errors and `[User]`
/// always, `[Info]` and `[Trace]` only in verbose mode.
fn level_printed(msg: &str, verbose: bool) -> bool {
    verbose || !(msg.starts_with("[Info]") || msg.starts_with("[Trace]"))
}

/// Il messaggio senza le parti che cambiano a ogni occorrenza.
///
/// LVGL antepone un tempo: `[Warn]\t(21.568, +0)\t lv_draw_sw_letter: …`.
/// Contando i messaggi interi, **due occorrenze dello stesso avviso sono
/// stringhe diverse** e la strozzatura non morde: misurato, 2.864 righe in
/// 30 s invece di ~7.000, cioè quasi nessun guadagno. Era il modo silenzioso
/// in cui questo filtro poteva sembrare installato e non fare quasi niente.
fn signature(msg: &str) -> String {
    strip_addresses(&strip_time(msg))
}

/// Object addresses out of the signature: `update 0xdcaa00 container` and
/// `update 0xdcc19c container` are the same message. A panel rebuilt at every
/// touch gives a new address each time, and with the address in the key the
/// throttling did not bite and the table grew for as long as the viewer ran
/// (TY570, 16-11-2026).
fn strip_addresses(msg: &str) -> String {
    let mut out = String::with_capacity(msg.len());
    let mut rest = msg;
    while let Some(i) = rest.find("0x") {
        let digits = rest[i + 2..]
            .bytes()
            .take_while(u8::is_ascii_hexdigit)
            .count();
        out.push_str(&rest[..i]);
        if digits == 0 {
            out.push_str("0x");
        } else {
            out.push_str("0x…");
        }
        rest = &rest[i + 2 + digits..];
    }
    out.push_str(rest);
    out
}

fn strip_time(msg: &str) -> String {
    // Si toglie la prima parentesi tonda, che è il tempo. Non una regex: è una
    // sola forma, sempre la stessa, e cercarla a mano rende evidente cosa si
    // sta togliendo.
    match (msg.find('('), msg.find(')')) {
        // `a + 1`: il contenuto fra le parentesi, non la parentesi aperta —
        // che non è una cifra e faceva fallire il controllo sempre.
        (Some(a), Some(b))
            if b > a + 1
                && msg[a + 1..b]
                    .chars()
                    .all(|c| c.is_ascii_digit() || ".,+- ".contains(c)) =>
        {
            let mut s = String::with_capacity(msg.len());
            s.push_str(&msg[..a]);
            s.push_str(&msg[b + 1..]);
            s
        }
        _ => msg.to_string(),
    }
}

/// Decide se questa occorrenza va stampata.
///
/// Pura e separata dalla FFI per poterla provare: la callback vera riceve un
/// puntatore C e scrive su stderr, cose che un test non può ispezionare.
///
/// Restituisce `Some(n)` con il numero d'ordine dell'occorrenza da stampare,
/// `None` per quelle da tacere.
fn should_print(seen: &mut HashMap<String, u64>, msg: &str) -> Option<u64> {
    let n = seen.entry(signature(msg)).or_insert(0);
    *n += 1;
    // `is_power_of_two` copre anche 1, che è la prima occorrenza.
    if n.is_power_of_two() {
        Some(*n)
    } else {
        None
    }
}

unsafe extern "C" fn print_cb(buf: *const std::os::raw::c_char) {
    if buf.is_null() {
        return;
    }
    // `to_string_lossy`: i messaggi di LVGL sono ASCII, ma un puntatore
    // malformato non deve poter far cadere il viewer da dentro una callback C,
    // dove un panic sarebbe comportamento indefinito.
    let msg = CStr::from_ptr(buf).to_string_lossy();
    let msg = msg.trim_end_matches(['\n', '\r']);
    if !level_printed(msg, VERBOSE.load(Ordering::Relaxed)) {
        return;
    }

    let mut guard = VISTI.lock().unwrap_or_else(|e| e.into_inner());
    let seen = guard.get_or_insert_with(HashMap::new);
    match should_print(seen, msg) {
        // La prima: come sempre, senza decorazioni.
        Some(1) => eprintln!("{msg}"),
        // Le successive: col conteggio, perché la riga da sola sembrerebbe
        // identica alla precedente e non si capirebbe che nel mezzo ce ne sono
        // state altre taciute.
        Some(n) => eprintln!("{msg}   [occorrenza {n}; le intermedie non sono stampate]"),
        None => {}
    }
}

/// Un riepilogo di ciò che è stato taciuto.
///
/// Serve a chiudere il cerchio: senza, "non vedo l'avviso" e "l'avviso è stato
/// taciuto 9.000 volte" si somigliano troppo. Si stampa all'uscita del viewer.
pub fn summary() -> Vec<(String, u64)> {
    let guard = VISTI.lock().unwrap_or_else(|e| e.into_inner());
    let Some(seen) = guard.as_ref() else {
        return Vec::new();
    };
    let mut soppressi: Vec<(String, u64)> = seen
        .iter()
        .filter(|(_, &n)| n > 1)
        .map(|(m, &n)| (m.clone(), n))
        .collect();
    soppressi.sort_by(|a, b| b.1.cmp(&a.1));
    soppressi
}

/// Stampa il riepilogo, se c'è qualcosa da riepilogare.
pub fn print_summary() {
    let s = summary();
    if s.is_empty() {
        return;
    }
    eprintln!("[log] messaggi ripetuti di LVGL (stampati solo alle potenze di due):");
    for (msg, n) in s.iter().take(10) {
        eprintln!("[log]   {n:>7} × {msg}");
    }
    if s.len() > 10 {
        eprintln!("[log]   … e altri {} messaggi distinti", s.len() - 10);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Il difetto che rendeva il filtro quasi inutile: col tempo dentro la
    /// firma, due occorrenze dello stesso avviso sono stringhe diverse.
    /// Misurato sul WP630 prima di questa correzione: 2.864 righe in 30 s.
    #[test]
    fn il_tempo_non_entra_nella_firma() {
        let a = "[Warn]\t(21.568, +0)\t lv_draw_sw_letter: glyph dsc. not found for U+2014";
        let b = "[Warn]\t(99.001, +32)\t lv_draw_sw_letter: glyph dsc. not found for U+2014";
        assert_eq!(signature(a), signature(b), "stesso avviso, firme diverse");

        let mut seen = HashMap::new();
        assert_eq!(should_print(&mut seen, a), Some(1));
        assert_eq!(
            should_print(&mut seen, b),
            Some(2),
            "la seconda deve contare come ripetizione"
        );
    }

    /// Non si tocca ciò che parentesi tonde le ha per conto suo: un messaggio
    /// che contiene `(in lv_obj.c line #206)` deve restare distinguibile da uno
    /// che cita un altro file.
    #[test]
    fn le_parentesi_che_non_sono_il_tempo_restano() {
        let a = "lv_obj_create: begin \t(in lv_obj.c line #206)";
        let b = "lv_obj_create: begin \t(in lv_label.c line #206)";
        assert_ne!(signature(a), signature(b), "file diversi, messaggi diversi");
    }

    #[test]
    fn addresses_do_not_enter_the_signature() {
        let a = "[Info]\t(1098.442, +0)\t flex_update: update 0xdcaa00 container \t(in lv_flex.c line #211)";
        let b = "[Info]\t(1099.001, +3)\t flex_update: update 0xdcc19c container \t(in lv_flex.c line #211)";
        assert_eq!(signature(a), signature(b));
        assert_eq!(strip_addresses("a 0x b 0xZ"), "a 0x b 0xZ");
        assert_eq!(strip_addresses("p=0xAbC1,q"), "p=0x…,q");
    }

    #[test]
    fn info_and_trace_only_when_verbose() {
        assert!(!level_printed("[Info]\t(1.0, +0)\t flex_update", false));
        assert!(!level_printed("[Trace]\t(1.0, +0)\t x", false));
        assert!(level_printed("[Warn]\t(1.0, +0)\t glyph", false));
        assert!(level_printed("[Error]\t(1.0, +0)\t x", false));
        assert!(level_printed("[User]\t(1.0, +0)\t x", false));
        assert!(level_printed("[Info]\t(1.0, +0)\t flex_update", true));
    }

    #[test]
    fn la_prima_occorrenza_si_stampa_sempre() {
        let mut seen = HashMap::new();
        assert_eq!(should_print(&mut seen, "qualcosa"), Some(1));
    }

    /// Il cuore della strozzatura: 10.000 occorrenze costano 14 righe, non
    /// 10.000, e ogni riga dice a che punto siamo.
    #[test]
    fn diecimila_occorrenze_costano_quattordici_righe() {
        let mut seen = HashMap::new();
        let stampate: Vec<u64> = (0..10_000)
            .filter_map(|_| should_print(&mut seen, "glyph dsc. not found for U+2014"))
            .collect();
        assert_eq!(
            stampate,
            vec![1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192]
        );
    }

    /// Messaggi diversi si contano separatamente: `U+2014` e `U+00F9` dicono
    /// due cose diverse su cosa manca nel font, e accorparli ne nasconderebbe
    /// una.
    #[test]
    fn messaggi_diversi_non_si_mescolano() {
        let mut seen = HashMap::new();
        assert_eq!(should_print(&mut seen, "manca U+2014"), Some(1));
        assert_eq!(should_print(&mut seen, "manca U+00F9"), Some(1));
        assert_eq!(should_print(&mut seen, "manca U+2014"), Some(2));
        assert_eq!(should_print(&mut seen, "manca U+00F9"), Some(2));
    }

    /// Un messaggio che compare una volta sola non deve finire nel riepilogo:
    /// non è stato taciuto niente, e elencarlo suggerirebbe il contrario.
    #[test]
    fn il_riepilogo_elenca_solo_cio_che_si_ripete() {
        let mut seen = HashMap::new();
        should_print(&mut seen, "una volta sola");
        for _ in 0..5 {
            should_print(&mut seen, "ripetuto");
        }
        let ripetuti: Vec<_> = seen
            .iter()
            .filter(|(_, &n)| n > 1)
            .map(|(m, _)| m.clone())
            .collect();
        assert_eq!(ripetuti, vec!["ripetuto".to_string()]);
    }
}
