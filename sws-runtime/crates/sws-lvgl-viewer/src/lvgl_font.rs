//! Il font del pannello, letto da un TTF vero (Q24).
//!
//! ## Perché
//!
//! I font Montserrat inclusi in LVGL coprono solo l'ASCII, e ciò che manca
//! **non viene disegnato affatto**: non un rettangolo, non un punto
//! interrogativo — niente, più un avviso nel log. Su un'interfaccia italiana
//! questo significa che "più", "però", "perché" si vedono mutilate.
//!
//! Il difetto è subdolo nel modo peggiore: chi scrive il testo nell'IDE lo vede
//! giusto, perché il browser il font ce l'ha. Il testo si rompe solo sul
//! pannello, cioè dove nessuno lo sta guardando mentre lo scrive.
//!
//! FreeType legge un TTF di sistema e copre tutto l'Unicode che quel file
//! contiene. Il costo è dichiarato: libfreetype nell'immagine e un file di font
//! sul dispositivo.
//!
//! ## Se il font non c'è
//!
//! Si torna a Montserrat e si scrive **una riga chiara** nel log. Un viewer che
//! non parte perché manca un file di font sarebbe una reazione sproporzionata:
//! con Montserrat le pagine si vedono, solo con gli accenti mutilati — che è
//! esattamente com'era prima di questo modulo.

use std::ffi::CString;

/// Dove cercare un font, in ordine.
///
/// Non un percorso solo: il dispositivo Pixsys tiene i DejaVu in
/// `/usr/share/fonts/truetype/`, Ubuntu (l'immagine del container) li mette in
/// una sottocartella `dejavu/`. Elencarli entrambi evita di dover sapere in
/// anticipo dove si sta girando.
///
/// DejaVu Sans e non un font più elegante: è quello che c'è già sui pannelli
/// Pixsys, copre il latino esteso e il greco, ed è sotto una licenza che non
/// pone problemi di ridistribuzione.
const CANDIDATI: &[&str] = &[
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
];

/// Il primo font esistente fra i candidati, o quello imposto dall'ambiente.
///
/// `SWS_LVGL_FONT` ha la precedenza: serve a chi ha un font suo, e a provare
/// senza ricompilare.
pub fn find_font(exists: impl Fn(&str) -> bool) -> Option<String> {
    if let Some(esplicito) = std::env::var("SWS_LVGL_FONT").ok().filter(|s| !s.trim().is_empty()) {
        // Un percorso esplicito che non esiste è un errore di chi l'ha scritto,
        // e va detto: ripiegare in silenzio su un altro font gli farebbe
        // credere che il suo sia stato usato.
        if exists(&esplicito) {
            return Some(esplicito);
        }
        eprintln!("[font] SWS_LVGL_FONT punta a '{esplicito}', che non esiste: cerco fra i soliti percorsi");
    }
    CANDIDATI.iter().find(|p| exists(p)).map(|p| p.to_string())
}

/// Carica il font e lo restituisce a LVGL.
///
/// `None` significa "resta su Montserrat": chi chiama non deve fare altro.
///
/// # Safety
///
/// Il puntatore restituito vive quanto il processo. LVGL lo tiene negli stili e
/// lo rilegge a ogni ridisegno: liberarlo darebbe un carattere disegnato da
/// memoria liberata, cioè un guasto che si manifesta a caso e altrove.
pub fn load(size_px: u16) -> Option<*const lvgl_sys::lv_font_t> {
    let path = find_font(|p| std::path::Path::new(p).exists())?;

    // 8 facce e 8 corpi. Non un numero tondo a caso: la sola demo usa già
    // 12, 14, 19 e 22 px, e un progetto appena più ricco supererebbe il 4 che
    // sembrava generoso — con LVGL che smette di aprire corpi nuovi senza
    // dirlo. 32 KB di cache in proporzione.
    if !unsafe { lvgl_sys::lv_freetype_init(8, 8, 32 * 1024) } {
        eprintln!("[font] lv_freetype_init fallita: resto su Montserrat (solo ASCII)");
        return None;
    }

    // Il `CString` deve sopravvivere alla chiamata **e** oltre: LVGL conserva
    // il puntatore al nome dentro la face. `Box::leak` è deliberato — vive
    // quanto il processo, come il font stesso.
    let c_path = CString::new(path.clone()).ok()?;
    let c_path: &'static CString = Box::leak(Box::new(c_path));

    let mut info = lvgl_sys::lv_ft_info_t {
        name: c_path.as_ptr(),
        mem: std::ptr::null(),
        mem_size: 0,
        font: std::ptr::null_mut(),
        weight: size_px,
        style: lvgl_sys::LV_FT_FONT_STYLE_FT_FONT_STYLE_NORMAL as u16,
    };

    if !unsafe { lvgl_sys::lv_ft_font_init(&mut info) } || info.font.is_null() {
        eprintln!("[font] '{path}' non caricabile: resto su Montserrat (solo ASCII)");
        return None;
    }
    eprintln!("[font] '{path}' a {size_px}px — le lettere accentate si vedono");
    Some(info.font as *const lvgl_sys::lv_font_t)
}

/// Corpo del carattere predefinito, in pixel.
///
/// 14 come il Montserrat che sostituisce (`LV_FONT_DEFAULT` in lv_conf.h): il
/// font cambia, la dimensione no, così le pagine già disegnate non si
/// riposizionano da sole sotto gli occhi di chi le aveva sistemate.
pub(crate) const CORPO_PX: u16 = 14;

/// Il font caricato, una volta per processo.
///
/// L'indirizzo si conserva come `usize` perché un puntatore grezzo non è
/// `Send`/`Sync` e non può stare in una `OnceLock`. È sicuro: il font vive
/// quanto il processo (vedi `load`), quindi l'indirizzo non diventa mai stantio.
static FONT: std::sync::OnceLock<Option<usize>> = std::sync::OnceLock::new();

/// I font già aperti, per corpo in pixel.
///
/// Una face FreeType per dimensione: LVGL non scala un font, ne apre uno nuovo.
/// La cache evita di riaprire lo stesso corpo per ognuna delle decine di
/// etichette che lo usano — nella demo, 33 didascalie condividono il 12px.
static PER_CORPO: std::sync::Mutex<Option<std::collections::HashMap<u16, usize>>> =
    std::sync::Mutex::new(None);

/// Il font a un corpo dato, aprendolo se serve.
///
/// `None` quando FreeType non è disponibile o il corpo è assurdo: chi chiama
/// lascia il font ereditato, che è sempre leggibile.
pub fn at_size(px: u16) -> Option<*const lvgl_sys::lv_font_t> {
    // Fuori da questo intervallo non è una scelta tipografica, è un errore nel
    // progetto: sotto i 6px non si legge, sopra i 200 una sola etichetta
    // riempirebbe lo schermo e la cache di FreeType.
    if !(6..=200).contains(&px) {
        return None;
    }
    // Il font predefinito va caricato per primo: è lui che inizializza
    // FreeType. Senza, `lv_ft_font_init` qui sotto fallirebbe.
    FONT.get_or_init(|| load(CORPO_PX).map(|p| p as usize));

    let mut guard = PER_CORPO.lock().unwrap_or_else(|e| e.into_inner());
    let cache = guard.get_or_insert_with(Default::default);
    if let Some(&addr) = cache.get(&px) {
        return Some(addr as *const lvgl_sys::lv_font_t);
    }
    let path = find_font(|p| std::path::Path::new(p).exists())?;
    let c_path: &'static CString = Box::leak(Box::new(CString::new(path).ok()?));
    let mut info = lvgl_sys::lv_ft_info_t {
        name: c_path.as_ptr(),
        mem: std::ptr::null(),
        mem_size: 0,
        font: std::ptr::null_mut(),
        weight: px,
        style: lvgl_sys::LV_FT_FONT_STYLE_FT_FONT_STYLE_NORMAL as u16,
    };
    if !unsafe { lvgl_sys::lv_ft_font_init(&mut info) } || info.font.is_null() {
        eprintln!("[font] corpo {px}px non apribile: resta quello ereditato");
        return None;
    }
    cache.insert(px, info.font as usize);
    // Una riga per corpo, non per etichetta: la cache fa sì che 33 didascalie
    // a 12px ne stampino una sola. Serve a vedere quanti corpi una pagina apre
    // davvero — è il numero che decide se il limite di 8 basta.
    eprintln!("[font] corpo {px}px aperto ({} in tutto)", cache.len());
    Some(info.font as *const lvgl_sys::lv_font_t)
}

/// Applica il font a uno schermo appena creato.
///
/// Va fatto per **ogni** schermo, non una volta sola: `render_page_objects` ne
/// crea uno nuovo a ogni pagina, e uno stile impostato su quello vecchio non
/// segue. `text_font` è ereditabile in LVGL, quindi impostarlo sullo schermo
/// basta per tutti i widget che ci finiranno dentro.
///
/// Se il font non c'è, non fa nulla: resta il Montserrat compilato.
pub fn apply_to(screen: *mut lvgl_sys::lv_obj_t) {
    let Some(addr) = *FONT.get_or_init(|| load(CORPO_PX).map(|p| p as usize)) else {
        return;
    };
    unsafe {
        lvgl_sys::lv_obj_set_style_text_font(screen, addr as *const lvgl_sys::lv_font_t, 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prende_il_primo_candidato_che_esiste() {
        let trovato = find_font(|p| p == "/usr/share/fonts/truetype/DejaVuSans.ttf");
        assert_eq!(trovato.as_deref(), Some("/usr/share/fonts/truetype/DejaVuSans.ttf"));
    }

    /// L'ordine conta: dove ci sono entrambi si prende il primo dell'elenco,
    /// non uno a caso.
    #[test]
    fn con_piu_candidati_vince_il_primo() {
        let trovato = find_font(|_| true);
        assert_eq!(trovato.as_deref(), Some(CANDIDATI[0]));
    }

    /// Nessun font: `None`, che per chi chiama vuol dire "resta su Montserrat".
    /// Non un panic — un pannello senza font di sistema deve comunque mostrare
    /// le pagine, sia pure con gli accenti mutilati.
    #[test]
    fn senza_nessun_font_si_ripiega() {
        assert_eq!(find_font(|_| false), None);
    }

    /// I percorsi coprono sia il dispositivo Pixsys (`truetype/DejaVuSans.ttf`)
    /// sia l'immagine Ubuntu (`truetype/dejavu/DejaVuSans.ttf`), che mettono lo
    /// stesso font in due posti diversi.
    #[test]
    fn i_candidati_coprono_dispositivo_e_immagine() {
        assert!(CANDIDATI.contains(&"/usr/share/fonts/truetype/DejaVuSans.ttf"), "percorso del pannello Pixsys");
        assert!(CANDIDATI.contains(&"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), "percorso Ubuntu");
    }
}
