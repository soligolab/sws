//! La fascia «Dati in ritardo» e il velo sulla pagina, disegnati (09-11-2026,
//! piano `docs/plans/2026-11-09-viewer-leggero.md` §5-bis).
//!
//! Il *quando* sta in [`crate::ritardo`], che si prova senza schermo; qui c'è
//! solo il disegno, come per l'avviso di aggiornamento.
//!
//! # Lo stile «non aggiornato» su tutti gli oggetti
//!
//! Sul web lo stale è due cose sul `<g>` dell'oggetto: `opacity: 0.55` e
//! `grayscale(0.9)`. Qui le due metà prendono strade diverse.
//!
//! - **Il grigio** va oggetto per oggetto, perché LVGL 8.3 non ha filtri su un
//!   livello intero. Ai figli dello schermo — e dell'area della finestra aperta
//!   — che un filtro loro non ce l'hanno si mette lo stesso filtro dello stale
//!   (`FiltroLuce::solo_grigio`) e lo stesso ricolore per le immagini
//!   (`effects::recolor_per`). Quelli che il filtro ce l'hanno già sono gli
//!   oggetti con effetti, e il grigio se lo mettono da soli
//!   (`effects::non_aggiornato` in `update_effects`). Nessun altro codice mette
//!   un filtro o un ricolore su un oggetto, quindi toglierli non cancella niente
//!   di nessuno.
//! - **L'opacità** è un velo solo sopra la pagina, del colore del suo sfondo al
//!   45 %. Su uno sfondo uniforme un oggetto al 55 % è `0,55·oggetto +
//!   0,45·sfondo`, che è proprio quello che il velo produce. Un `opa` per
//!   oggetto in LVGL 8.3 disegna ognuno in un livello a parte
//!   (`LV_STYLE_PROP_LAYER_REFR`): farlo su tutta la pagina quando il pannello
//!   è in affanno costerebbe di più proprio nel momento peggiore.
//!
//! # Dove stanno
//!
//! Sul layer superiore, tutti e due: sopravvivono al cambio pagina e non
//! toccano lo schermo, che la navigazione ricostruisce.
//!
//! - Il velo **in fondo** al layer, sotto finestre e avvisi: sbiadisce la
//!   pagina e basta.
//! - La fascia **in cima**, sopra la finestra aperta, perché chi lavora in un
//!   faceplate deve leggerla, e sopra la card «Versione nuova». Passa sotto
//!   solo l'accesso (la raccolta delle credenziali, o la card che ne aspetta
//!   la risposta): lì i campi in alto non vanno coperti. Sono i livelli del
//!   web: fascia 9550, card 9000, login 9600.
//!
//! Una differenza dal web resta, voluta: il velo copre anche lo sfondo della
//! pagina (immagine e cornice), che sul web restano com'erano perché lì il
//! grigio va solo sugli oggetti; e gli oggetti di una finestra aperta sono
//! grigi ma pieni, perché il velo sta sotto le finestre. Un'opacità per
//! oggetto costerebbe un livello per oggetto (vedi sopra).
//!
//! Né il velo né la fascia sono cliccabili: i tocchi passano agli oggetti
//! sotto, come sul web, dove lo stale non toglie niente all'operatore.

use std::ffi::c_void;

use lvgl::Color;

use crate::client::SharedLang;
use crate::lvgl_render::{text_cstring, FiltroLuce};
use crate::ritardo;

/// Alta quanto la barra di una finestra più qualcosa: ci sta una riga a 14 px.
const ALTEZZA: i16 = 28;
const CORPO_PX: u16 = 14;
/// L'ambra del bordo d'allarme Warning (`effects::colore_severita`), col
/// testo scuro delle finestre: si legge anche su un vetro al sole.
const FONDO: (u8, u8, u8) = (234, 179, 8);
const TESTO: (u8, u8, u8) = (15, 23, 42);
/// Il velo lascia passare il 55 % della pagina: `OPA_ATTENUATO` dello stale.
const OPA_VELO: u8 = 255 - crate::effects::OPA_ATTENUATO;

/// La fascia e il velo, con quel che serve a non ricostruirli a ogni giro.
pub struct Fascia {
    velo: Option<*mut lvgl_sys::lv_obj_t>,
    fascia: Option<*mut lvgl_sys::lv_obj_t>,
    etichetta: Option<*mut lvgl_sys::lv_obj_t>,
    /// Il testo già scritto: si riscrive solo quando cambia il secondo.
    scritto: String,
    /// Il colore del velo già messo (`lv_color_t::full`).
    sfondo: Option<u16>,
    /// La misura già data a velo e fascia: il display segue la pagina.
    misura: (u32, u32),
    /// Il grigio dello stale, uno per tutti gli oggetti senza filtro loro.
    /// `'static` perché LVGL ne tiene il puntatore: se la fascia sparisse
    /// prima degli oggetti, il filtro resterebbe valido lo stesso.
    filtro: &'static FiltroLuce,
    /// Il grigio delle immagini, dove il filtro colore non arriva.
    ricolore: ((u8, u8, u8), u8),
}

impl Fascia {
    pub fn new() -> Fascia {
        Fascia {
            velo: None,
            fascia: None,
            etichetta: None,
            scritto: String::new(),
            sfondo: None,
            misura: (0, 0),
            filtro: Box::leak(FiltroLuce::solo_grigio()),
            ricolore: crate::effects::recolor_per(true, 0.0, 1.0)
                .unwrap_or(((128, 128, 128), crate::effects::FILTRO_GRIGIO_OPA)),
        }
    }

    /// Da chiamare a ogni giro, dopo `update_bindings`. `eta_ms` viene da
    /// [`ritardo::al_fotogramma`]; `finestra` è l'area della finestra aperta,
    /// se ce n'è una; `sotto` è l'accesso a schermo, se c'è
    /// (`Overlay::credenziali`): la fascia gli passa sotto. Finché i dati sono
    /// freschi costa un confronto.
    pub fn sincronizza(
        &mut self,
        eta_ms: u64,
        lingua: &SharedLang,
        finestra: Option<*mut lvgl_sys::lv_obj_t>,
        sotto: Option<*mut lvgl_sys::lv_obj_t>,
    ) {
        let testo = if ritardo::in_ritardo(eta_ms) {
            let l = lingua.lock().unwrap_or_else(|e| e.into_inner()).clone();
            ritardo::testo_fascia(eta_ms, &l)
        } else {
            None
        };
        let Some(testo) = testo else {
            if self.velo.is_some() {
                self.spegni(finestra);
            }
            return;
        };
        if self.velo.is_none() {
            if let Err(e) = self.accendi() {
                eprintln!("[ritardo] fascia non disegnata: {e}");
                self.distruggi();
                return;
            }
            eprintln!("[ritardo] {testo}");
        }
        self.aggiorna(&testo, sotto);
        // Anche a fascia già accesa: una pagina nuova, o una finestra appena
        // aperta, ha oggetti che il grigio non l'hanno ancora.
        unsafe {
            let schermo = lvgl_sys::lv_disp_get_scr_act(core::ptr::null_mut());
            ingrigisci_figli(schermo, self.filtro.dsc(), self.ricolore);
            if let Some(a) = finestra {
                ingrigisci_figli(a, self.filtro.dsc(), self.ricolore);
                velo_nella_finestra(a);
            }
        }
    }

    fn accendi(&mut self) -> anyhow::Result<()> {
        let top = unsafe { lvgl_sys::lv_disp_get_layer_top(core::ptr::null_mut()) };
        if top.is_null() {
            anyhow::bail!("il layer superiore non c'è");
        }
        let velo = unsafe { nudo(top)? };
        self.velo = Some(velo);
        let fascia = unsafe { nudo(top)? };
        self.fascia = Some(fascia);
        let etichetta = unsafe { lvgl_sys::lv_label_create(fascia) };
        if etichetta.is_null() {
            anyhow::bail!("lv_label_create della fascia ha restituito null");
        }
        self.etichetta = Some(etichetta);
        unsafe {
            lvgl_sys::lv_obj_set_style_bg_opa(velo, OPA_VELO, 0);
            lvgl_sys::lv_obj_set_style_bg_color(fascia, Color::from_rgb(FONDO).into(), 0);
            lvgl_sys::lv_obj_set_style_bg_opa(fascia, lvgl_sys::LV_OPA_COVER as u8, 0);
            lvgl_sys::lv_obj_set_style_text_color(etichetta, Color::from_rgb(TESTO).into(), 0);
            lvgl_sys::lv_obj_set_style_text_align(
                etichetta,
                lvgl_sys::LV_TEXT_ALIGN_CENTER as u8,
                0,
            );
            lvgl_sys::lv_label_set_long_mode(etichetta, lvgl_sys::LV_LABEL_LONG_DOT as u8);
            if let Some(f) = crate::lvgl_font::at_size(CORPO_PX) {
                lvgl_sys::lv_obj_set_style_text_font(etichetta, f, 0);
            }
        }
        self.scritto.clear();
        self.sfondo = None;
        self.misura = (0, 0);
        Ok(())
    }

    /// Misura, colore del velo, testo e posto nel layer: ognuno si tocca solo
    /// quando cambia, perché ogni scrittura fa ridisegnare.
    fn aggiorna(&mut self, testo: &str, sotto: Option<*mut lvgl_sys::lv_obj_t>) {
        let (Some(velo), Some(fascia), Some(etichetta)) = (self.velo, self.fascia, self.etichetta)
        else {
            return;
        };
        unsafe {
            let (w, h) = crate::lvgl_display::dims();
            if (w, h) != self.misura && w > 0 && h > 0 {
                lvgl_sys::lv_obj_set_pos(velo, 0, 0);
                lvgl_sys::lv_obj_set_size(velo, w as i16, h as i16);
                lvgl_sys::lv_obj_set_pos(fascia, 0, 0);
                lvgl_sys::lv_obj_set_size(fascia, w as i16, ALTEZZA);
                lvgl_sys::lv_obj_set_width(etichetta, w as i16 - 16);
                lvgl_sys::lv_obj_align(
                    etichetta,
                    lvgl_sys::LV_ALIGN_CENTER as lvgl_sys::lv_align_t,
                    0,
                    0,
                );
                self.misura = (w, h);
            }
            // Il velo prende il colore dello sfondo della pagina, che cambia
            // con la navigazione e con uno sfondo legato a una variabile.
            let schermo = lvgl_sys::lv_disp_get_scr_act(core::ptr::null_mut());
            if !schermo.is_null() {
                let c = lvgl_sys::lv_obj_get_style_prop(
                    schermo,
                    lvgl_sys::LV_PART_MAIN,
                    lvgl_sys::lv_style_prop_t_LV_STYLE_BG_COLOR,
                )
                .color;
                if self.sfondo != Some(c.full) {
                    lvgl_sys::lv_obj_set_style_bg_color(velo, c, 0);
                    self.sfondo = Some(c.full);
                }
            }
            if self.scritto != testo {
                let c = text_cstring(testo);
                lvgl_sys::lv_label_set_text(etichetta, c.as_ptr());
                self.scritto = testo.to_string();
            }
            // `lv_obj_move_to_index` non fa niente se l'oggetto è già lì.
            lvgl_sys::lv_obj_move_to_index(velo, 0);
            let top = lvgl_sys::lv_obj_get_parent(fascia);
            let ultimo = lvgl_sys::lv_obj_get_child_cnt(top) as i32 - 1;
            let posto = match sotto.filter(|o| lvgl_sys::lv_obj_get_parent(*o) == top) {
                // Subito sotto l'accesso: al suo posto se la fascia sta sopra
                // (lui sale di uno), un posto prima se sta già sotto.
                Some(o) => {
                    let i = lvgl_sys::lv_obj_get_index(o) as i32;
                    let f = lvgl_sys::lv_obj_get_index(fascia) as i32;
                    if f < i {
                        i - 1
                    } else {
                        i
                    }
                }
                None => ultimo,
            };
            lvgl_sys::lv_obj_move_to_index(fascia, posto);
        }
    }

    /// I dati sono tornati freschi: via il grigio dagli oggetti, poi velo e
    /// fascia.
    fn spegni(&mut self, finestra: Option<*mut lvgl_sys::lv_obj_t>) {
        unsafe {
            let schermo = lvgl_sys::lv_disp_get_scr_act(core::ptr::null_mut());
            rischiara_figli(schermo, self.filtro.dsc());
            if let Some(a) = finestra {
                rischiara_figli(a, self.filtro.dsc());
                if let Some(v) = velo_di(a) {
                    lvgl_sys::lv_obj_del(v);
                }
            }
        }
        eprintln!("[ritardo] dati di nuovo aggiornati");
        self.distruggi();
    }

    fn distruggi(&mut self) {
        // L'etichetta muore con la fascia, che è il suo genitore.
        self.etichetta = None;
        for o in [self.fascia.take(), self.velo.take()].into_iter().flatten() {
            unsafe { lvgl_sys::lv_obj_del(o) };
        }
        self.scritto.clear();
        self.sfondo = None;
        self.misura = (0, 0);
    }
}

impl Default for Fascia {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Fascia {
    fn drop(&mut self) {
        self.distruggi();
    }
}

/// Il segno del velo dentro una finestra, nel suo `user_data`: un indirizzo che
/// nessun altro oggetto può avere.
static SEGNO_VELO: u8 = 0;

/// Il velo dentro la finestra `a`, se c'è (11-11-2026, piano parità LVGL §3.3).
/// Si ritrova cercandolo fra i figli, invece di tenerne il puntatore: chiudere
/// la finestra lo cancella con lei, e un puntatore tenuto qui resterebbe a un
/// oggetto che non esiste più.
///
/// # Safety
/// `a` deve essere un oggetto LVGL vivo.
unsafe fn velo_di(a: *mut lvgl_sys::lv_obj_t) -> Option<*mut lvgl_sys::lv_obj_t> {
    let segno = &SEGNO_VELO as *const u8 as *mut core::ffi::c_void;
    (0..lvgl_sys::lv_obj_get_child_cnt(a))
        .map(|i| lvgl_sys::lv_obj_get_child(a, i as i32))
        .find(|c| !c.is_null() && (**c).user_data == segno)
}

/// Il velo sopra gli oggetti di una finestra aperta: il velo della pagina sta
/// sotto le finestre, e lì gli oggetti restavano grigi ma pieni, mentre sul web
/// sono al 55 %. Il colore è il fondo della finestra; i tocchi passano.
///
/// # Safety
/// `a` deve essere un oggetto LVGL vivo.
unsafe fn velo_nella_finestra(a: *mut lvgl_sys::lv_obj_t) {
    let v = match velo_di(a) {
        Some(v) => v,
        None => {
            let Ok(v) = nudo(a) else {
                return;
            };
            (*v).user_data = &SEGNO_VELO as *const u8 as *mut core::ffi::c_void;
            lvgl_sys::lv_obj_add_flag(v, lvgl_sys::LV_OBJ_FLAG_IGNORE_LAYOUT);
            lvgl_sys::lv_obj_set_style_bg_opa(v, OPA_VELO, 0);
            v
        }
    };
    let c = lvgl_sys::lv_obj_get_style_prop(
        a,
        lvgl_sys::LV_PART_MAIN,
        lvgl_sys::lv_style_prop_t_LV_STYLE_BG_COLOR,
    )
    .color;
    lvgl_sys::lv_obj_set_style_bg_color(v, c, 0);
    lvgl_sys::lv_obj_set_pos(v, 0, 0);
    lvgl_sys::lv_obj_set_size(
        v,
        lvgl_sys::lv_obj_get_content_width(a),
        lvgl_sys::lv_obj_get_content_height(a),
    );
    // Sopra tutti gli oggetti della finestra, anche quelli creati dopo.
    let ultimo = lvgl_sys::lv_obj_get_child_cnt(a) as i32 - 1;
    if lvgl_sys::lv_obj_get_index(v) as i32 != ultimo {
        lvgl_sys::lv_obj_move_to_index(v, ultimo);
    }
}

/// Un oggetto senza gli stili del tema, non cliccabile e non scorrevole.
///
/// # Safety
/// `padre` deve essere un oggetto LVGL vivo.
unsafe fn nudo(padre: *mut lvgl_sys::lv_obj_t) -> anyhow::Result<*mut lvgl_sys::lv_obj_t> {
    let o = lvgl_sys::lv_obj_create(padre);
    if o.is_null() {
        anyhow::bail!("lv_obj_create ha restituito null");
    }
    // Prima via gli stili del tema (bordo, raggio, margini), poi il resto:
    // `remove_style(NULL, ANY)` si porterebbe via anche gli stili locali.
    lvgl_sys::lv_obj_remove_style(
        o,
        core::ptr::null_mut(),
        (lvgl_sys::LV_PART_ANY | lvgl_sys::LV_STATE_ANY) as lvgl_sys::lv_style_selector_t,
    );
    lvgl_sys::lv_obj_clear_flag(o, lvgl_sys::LV_OBJ_FLAG_CLICKABLE);
    lvgl_sys::lv_obj_clear_flag(o, lvgl_sys::LV_OBJ_FLAG_SCROLLABLE);
    Ok(o)
}

/// Il filtro colore locale di un oggetto, se ne ha uno.
///
/// # Safety
/// `o` deve essere un oggetto LVGL vivo.
unsafe fn filtro_locale(o: *mut lvgl_sys::lv_obj_t) -> Option<*const c_void> {
    let mut v = lvgl_sys::lv_style_value_t::default();
    let r = lvgl_sys::lv_obj_get_local_style_prop(
        o,
        lvgl_sys::lv_style_prop_t_LV_STYLE_COLOR_FILTER_DSC,
        &mut v,
        0,
    );
    (r == lvgl_sys::LV_STYLE_RES_FOUND as u8).then_some(v.ptr)
}

/// Il grigio dello stale sui figli di `padre` che un filtro loro non ce
/// l'hanno: gli oggetti con effetti ce l'hanno, e il grigio lo gestiscono da
/// sé.
///
/// # Safety
/// `padre` deve essere nullo o un oggetto LVGL vivo; `dsc` deve vivere quanto
/// gli oggetti.
unsafe fn ingrigisci_figli(
    padre: *mut lvgl_sys::lv_obj_t,
    dsc: *const lvgl_sys::lv_color_filter_dsc_t,
    ((r, g, b), opa): ((u8, u8, u8), u8),
) {
    if padre.is_null() {
        return;
    }
    for i in 0..lvgl_sys::lv_obj_get_child_cnt(padre) {
        let f = lvgl_sys::lv_obj_get_child(padre, i as i32);
        if f.is_null() || filtro_locale(f).is_some() {
            continue;
        }
        lvgl_sys::lv_obj_set_style_color_filter_dsc(f, dsc, 0);
        lvgl_sys::lv_obj_set_style_color_filter_opa(f, 255, 0);
        lvgl_sys::lv_obj_set_style_img_recolor(f, Color::from_rgb((r, g, b)).into(), 0);
        lvgl_sys::lv_obj_set_style_img_recolor_opa(f, opa, 0);
    }
}

/// Toglie il grigio messo da [`ingrigisci_figli`], e solo quello: si
/// riconosce dal descrittore.
///
/// # Safety
/// `padre` deve essere nullo o un oggetto LVGL vivo.
unsafe fn rischiara_figli(
    padre: *mut lvgl_sys::lv_obj_t,
    dsc: *const lvgl_sys::lv_color_filter_dsc_t,
) {
    if padre.is_null() {
        return;
    }
    for i in 0..lvgl_sys::lv_obj_get_child_cnt(padre) {
        let f = lvgl_sys::lv_obj_get_child(padre, i as i32);
        if f.is_null() || filtro_locale(f) != Some(dsc as *const c_void) {
            continue;
        }
        for p in [
            lvgl_sys::lv_style_prop_t_LV_STYLE_COLOR_FILTER_DSC,
            lvgl_sys::lv_style_prop_t_LV_STYLE_COLOR_FILTER_OPA,
            lvgl_sys::lv_style_prop_t_LV_STYLE_IMG_RECOLOR,
            lvgl_sys::lv_style_prop_t_LV_STYLE_IMG_RECOLOR_OPA,
        ] {
            lvgl_sys::lv_obj_remove_local_style_prop(f, p, 0);
        }
    }
}

/// La fascia disegnata davvero, su un display LVGL piccolo (09-11-2026).
///
/// È la sola prova del crate che crea oggetti LVGL: `lv_init` lo fa già il
/// costruttore del crate `lvgl` prima di `main`, ma un display si registra una
/// volta per processo e LVGL non regge due thread. Un'altra prova che
/// disegnasse andrebbe messa qui dentro, non accanto.
#[cfg(test)]
mod prove {
    use super::*;
    use std::sync::{Arc, Mutex};

    unsafe fn figlio(padre: *mut lvgl_sys::lv_obj_t, i: i32) -> *mut lvgl_sys::lv_obj_t {
        lvgl_sys::lv_obj_get_child(padre, i)
    }

    /// Il testo come si vede: prima LVGL dispone l'etichetta, e fino ad allora
    /// la crede larga quanto il testo di partenza e la tronca coi puntini.
    unsafe fn testo_di(etichetta: *mut lvgl_sys::lv_obj_t) -> String {
        lvgl_sys::lv_obj_update_layout(etichetta);
        std::ffi::CStr::from_ptr(lvgl_sys::lv_label_get_text(etichetta))
            .to_string_lossy()
            .into_owned()
    }

    unsafe fn ricolore_opa(o: *mut lvgl_sys::lv_obj_t) -> Option<i32> {
        let mut v = lvgl_sys::lv_style_value_t::default();
        let r = lvgl_sys::lv_obj_get_local_style_prop(
            o,
            lvgl_sys::lv_style_prop_t_LV_STYLE_IMG_RECOLOR_OPA,
            &mut v,
            0,
        );
        (r == lvgl_sys::LV_STYLE_RES_FOUND as u8).then_some(v.num)
    }

    #[test]
    fn la_fascia_si_accende_ingrigisce_la_pagina_e_si_spegne() {
        // Largo come il più stretto dei pannelli: la frase sta su una riga.
        crate::lvgl_display::init_display(480, 120).unwrap();
        let lingua: SharedLang = Arc::new(Mutex::new("it".into()));
        unsafe {
            let schermo = lvgl_sys::lv_disp_get_scr_act(core::ptr::null_mut());
            let top = lvgl_sys::lv_disp_get_layer_top(core::ptr::null_mut());
            // Un oggetto qualunque, e uno con un filtro suo come quelli con
            // effetti: il grigio di quello lo decide `update_effects`.
            let semplice = lvgl_sys::lv_obj_create(schermo);
            let con_effetti = lvgl_sys::lv_obj_create(schermo);
            let suo = FiltroLuce::solo_grigio();
            lvgl_sys::lv_obj_set_style_color_filter_dsc(con_effetti, suo.dsc(), 0);
            // Un avviso già a schermo sul layer superiore.
            let avviso = lvgl_sys::lv_obj_create(top);

            let mut f = Fascia::new();
            f.sincronizza(4_000, &lingua, None, None);
            assert_eq!(lvgl_sys::lv_obj_get_child_cnt(top), 1, "sotto i 5 s niente");
            assert_eq!(filtro_locale(semplice), None);

            f.sincronizza(8_200, &lingua, None, None);
            assert_eq!(lvgl_sys::lv_obj_get_child_cnt(top), 3, "velo e fascia");
            let velo = figlio(top, 0);
            let fascia = figlio(top, 2);
            assert_eq!(Some(velo), f.velo, "il velo in fondo, sotto gli avvisi");
            assert_eq!(Some(fascia), f.fascia, "la fascia in cima");
            assert_eq!(testo_di(figlio(fascia, 0)), "Dati in ritardo di 8 s");
            for o in [velo, fascia] {
                assert!(!lvgl_sys::lv_obj_has_flag(
                    o,
                    lvgl_sys::LV_OBJ_FLAG_CLICKABLE
                ));
            }
            assert_eq!(
                filtro_locale(semplice),
                Some(f.filtro.dsc() as *const c_void),
                "l'oggetto semplice prende il grigio dello stale"
            );
            assert_eq!(
                ricolore_opa(semplice),
                Some(crate::effects::FILTRO_GRIGIO_OPA as i32)
            );
            assert_eq!(
                filtro_locale(con_effetti),
                Some(suo.dsc() as *const c_void),
                "quello con effetti tiene il suo filtro"
            );

            // Un oggetto nato a fascia accesa (una pagina nuova) diventa grigio
            // al giro dopo; il secondo che passa cambia il testo.
            let nuovo = lvgl_sys::lv_obj_create(schermo);
            f.sincronizza(9_400, &lingua, None, None);
            assert_eq!(filtro_locale(nuovo), Some(f.filtro.dsc() as *const c_void));
            assert_eq!(testo_di(figlio(fascia, 0)), "Dati in ritardo di 9 s");

            // Sopra la card «Versione nuova», come sul web (9550 contro 9000).
            assert_eq!(figlio(top, 1), avviso);
            assert_eq!(figlio(top, 2), fascia);
            // Sotto l'accesso: una schermata di credenziali aperta dopo la
            // fascia la scavalca, e la fascia le resta subito sotto, giro
            // dopo giro.
            let credenziali = lvgl_sys::lv_obj_create(top);
            for _ in 0..2 {
                f.sincronizza(9_400, &lingua, None, Some(credenziali));
                assert_eq!(figlio(top, 2), fascia);
                assert_eq!(figlio(top, 3), credenziali);
            }
            // Chiusa l'accesso, la fascia torna in cima.
            lvgl_sys::lv_obj_del(credenziali);
            f.sincronizza(9_400, &lingua, None, None);
            assert_eq!(figlio(top, 2), fascia);

            // Si disegna, filtro compreso, senza cadere.
            lvgl_sys::lv_refr_now(core::ptr::null_mut());

            // Dati di nuovo freschi: via velo, fascia e grigio, e solo il nostro.
            f.sincronizza(300, &lingua, None, None);
            assert_eq!(lvgl_sys::lv_obj_get_child_cnt(top), 1);
            assert_eq!(filtro_locale(semplice), None);
            assert_eq!(ricolore_opa(semplice), None);
            assert_eq!(filtro_locale(nuovo), None);
            assert_eq!(filtro_locale(con_effetti), Some(suo.dsc() as *const c_void));

            for o in [semplice, con_effetti, nuovo, avviso] {
                lvgl_sys::lv_obj_del(o);
            }
        }
    }
}
