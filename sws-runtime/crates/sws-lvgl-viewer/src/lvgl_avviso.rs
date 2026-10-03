//! L'avviso di aggiornamento **disegnato** sul pannello: il gemello LVGL di
//! `AvvisoAggiornamento.tsx`.
//!
//! Qui c'è solo il disegno. *Quando* mostrare qualcosa, cosa ricordare e come
//! si parla col runtime stanno in [`crate::aggiornamento`], che è testabile
//! senza uno schermo — e in questo crate uno schermo nei test non c'è.
//!
//! # Perché sul layer superiore
//!
//! Nel viewer ci sono due modi di sovrapporre qualcosa alla pagina, e non
//! sono equivalenti:
//!
//! - `lv_msgbox_create(NULL)` sta sul layer superiore e **sopravvive al
//!   cambio pagina**, ma è una finestra con una `lv_btnmatrix`: testo e
//!   pulsanti li decide lei;
//! - l'overlay di login (`render_auth_widget`) è figlio dello *screen*, ha
//!   libertà di layout, ma la navigazione ricostruisce lo screen e va
//!   **ridisegnato a ogni pagina**.
//!
//! Qui servono tre pulsanti, un testo scorrevole e la sopravvivenza alla
//! navigazione: quindi un overlay costruito a mano come quello di login, ma
//! agganciato al layer superiore (`lv_disp_get_layer_top`). Chi naviga se lo
//! ritrova davanti, che è il punto — un avviso che sparisce cambiando pagina
//! non è un avviso.
//!
//! # Le due trappole già pagate
//!
//! 1. **La mappa dei pulsanti di una `lv_btnmatrix` deve essere `static`**
//!    (vedi `BOTTONI_CONFERMA` in `lvgl_render.rs`): LVGL ne conserva il
//!    puntatore. Qui il problema non si pone perché i pulsanti sono
//!    `lv_btn` separati, ognuno con la sua etichetta — che è anche il motivo
//!    per cui si possono scrivere in cinque lingue senza toccare una mappa.
//! 2. **LVGL tiene i puntatori, non copie.** I contesti delle callback vivono
//!    in `contesti`, e si liberano **dopo** `lv_obj_del` della radice, mai
//!    prima: l'ordine è la sicurezza.

use std::ffi::c_void;

use lvgl::style::Style;
use lvgl::Color;

use crate::aggiornamento::{self, Avviso, SharedAvviso};
use crate::client::EsitoAggiornamento;
use crate::lvgl_render::text_cstring;
use crate::session::SharedSession;
use sws_core::testi_sistema::{testo, testo_con, Testo};

/// Cosa fa un pulsante. Nessuna di queste azioni tocca LVGL o la rete in
/// modo bloccante: scrivono uno stato condiviso e, per l'avvio, accodano al
/// thread di rete — il minimo che si possa fare dentro una callback FFI
/// sincrona.
enum Azione {
    Aggiorna,
    PiuTardi,
    /// La configurazione del servizio (02-10-2026).
    AggiornaQuadlet,
    PiuTardiQuadlet,
    /// Dopo un aggiornamento (03-10-2026): la risposta che va al runtime
    /// (`pulisci`, `dopo_riavvio`, `piu_tardi`, `ritorna`)…
    Conferma(&'static str),
    /// …e il passo intermedio del ritorno, avanti e indietro.
    ChiediRitorno(bool),
    Ignora(String),
    ChiudiEsito(i64),
}

struct CtxAvviso {
    stato: SharedAvviso,
    base_url: String,
    sessione: SharedSession,
    azione: Azione,
}

unsafe extern "C" fn sws_avviso_cb(e: *mut lvgl_sys::lv_event_t) {
    let user_data = unsafe { lvgl_sys::lv_event_get_user_data(e) };
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const CtxAvviso) };
    match &ctx.azione {
        Azione::Aggiorna => {
            let token = ctx
                .sessione
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .token
                .clone();
            aggiornamento::avvia(&ctx.stato, &ctx.base_url, token);
        }
        Azione::PiuTardi => aggiornamento::rimanda(&ctx.stato),
        Azione::AggiornaQuadlet => {
            let token = ctx.sessione.lock().unwrap_or_else(|e| e.into_inner()).token.clone();
            aggiornamento::aggiorna_quadlet(&ctx.stato, &ctx.base_url, token);
        }
        Azione::PiuTardiQuadlet => aggiornamento::rimanda_quadlet(&ctx.stato),
        Azione::Conferma(scelta) => {
            let token = ctx.sessione.lock().unwrap_or_else(|e| e.into_inner()).token.clone();
            aggiornamento::rispondi_conferma(&ctx.stato, &ctx.base_url, token, scelta);
        }
        Azione::ChiediRitorno(si) => aggiornamento::chiedi_ritorno(&ctx.stato, *si),
        Azione::Ignora(v) => aggiornamento::ignora(&ctx.stato, v),
        Azione::ChiudiEsito(id) => aggiornamento::chiudi_esito(&ctx.stato, *id),
    }
    // Il ridisegno lo fa il loop al giro dopo, vedendo la generazione
    // cambiata: distruggere qui l'oggetto che ha appena generato l'evento
    // vorrebbe dire cancellarlo da dentro la sua stessa callback.
}

/// L'overlay, con quel che gli serve per non essere ricostruito a ogni frame.
#[derive(Default)]
pub struct Overlay {
    radice: Option<*mut lvgl_sys::lv_obj_t>,
    /// La generazione di [`crate::aggiornamento::StatoAvviso`] già disegnata.
    disegnata: Option<u64>,
    /// Vivi quanto la radice: LVGL ne tiene i puntatori.
    contesti: Vec<Box<CtxAvviso>>,
    stili: Vec<Box<Style>>,
}

impl Overlay {
    pub fn new() -> Overlay {
        Overlay::default()
    }

    /// Da chiamare a ogni giro del loop di rendering, dopo `task_handler()`.
    /// Non fa niente finché lo stato non cambia — un `lock` e un confronto di
    /// interi per frame.
    pub fn sincronizza(
        &mut self,
        stato: &SharedAvviso,
        lingua: &str,
        base_url: &str,
        sessione: &SharedSession,
        hor_res: u32,
        ver_res: u32,
    ) {
        let (generazione, avviso, avvio_chiesto) = {
            let g = stato.lock().unwrap_or_else(|e| e.into_inner());
            (g.generazione, g.avviso(), g.avvio_chiesto)
        };
        if self.disegnata == Some(generazione) {
            return;
        }
        self.disegnata = Some(generazione);
        self.distruggi();
        if avviso == Avviso::Niente {
            return;
        }
        if let Err(e) = self.costruisci(
            &avviso,
            avvio_chiesto,
            stato,
            lingua,
            base_url,
            sessione,
            hor_res,
            ver_res,
        ) {
            eprintln!("[aggiornamento] avviso non disegnato: {e}");
            self.distruggi();
        }
    }

    fn distruggi(&mut self) {
        if let Some(r) = self.radice.take() {
            unsafe { lvgl_sys::lv_obj_del(r) };
        }
        // **Dopo** la distruzione degli oggetti, mai prima.
        self.contesti.clear();
        self.stili.clear();
    }

    #[allow(clippy::too_many_arguments)]
    fn costruisci(
        &mut self,
        avviso: &Avviso,
        avvio_chiesto: bool,
        stato: &SharedAvviso,
        lingua: &str,
        base_url: &str,
        sessione: &SharedSession,
        hor_res: u32,
        ver_res: u32,
    ) -> anyhow::Result<()> {
        let top = unsafe { lvgl_sys::lv_disp_get_layer_top(core::ptr::null_mut()) };
        if top.is_null() {
            anyhow::bail!("il layer superiore non c'è");
        }
        let radice = unsafe { lvgl_sys::lv_obj_create(top) };
        if radice.is_null() {
            anyhow::bail!("lv_obj_create della radice ha restituito null");
        }
        self.radice = Some(radice);
        unsafe {
            lvgl_sys::lv_obj_set_pos(radice, 0, 0);
            lvgl_sys::lv_obj_set_size(radice, hor_res as i16, ver_res as i16);
            lvgl_sys::lv_obj_set_style_bg_color(radice, colore(2, 6, 23), 0);
            // Non del tutto opaco: sotto si intravede la pagina, così è chiaro
            // che l'impianto sta ancora funzionando e questo è solo un avviso.
            lvgl_sys::lv_obj_set_style_bg_opa(radice, 220, 0);
            lvgl_sys::lv_obj_set_style_border_width(radice, 0, 0);
            lvgl_sys::lv_obj_set_style_radius(radice, 0, 0);
            pad(radice, 0);
            lvgl_sys::lv_obj_clear_flag(radice, lvgl_sys::LV_OBJ_FLAG_SCROLLABLE);
        }

        let card_w = (hor_res as i16 - 32).min(560).max(200);
        let card_h = (ver_res as i16 - 24).min(340).max(150);
        let rosso = matches!(
            avviso,
            Avviso::Esito { evento, .. } if evento.esito == EsitoAggiornamento::NonRiuscito
        );
        let card = unsafe { lvgl_sys::lv_obj_create(radice) };
        if card.is_null() {
            anyhow::bail!("lv_obj_create della finestra ha restituito null");
        }
        unsafe {
            lvgl_sys::lv_obj_set_size(card, card_w, card_h);
            lvgl_sys::lv_obj_align(card, lvgl_sys::LV_ALIGN_CENTER as lvgl_sys::lv_align_t, 0, 0);
            lvgl_sys::lv_obj_set_style_bg_color(card, colore(30, 41, 59), 0);
            lvgl_sys::lv_obj_set_style_bg_opa(card, lvgl_sys::LV_OPA_COVER as u8, 0);
            lvgl_sys::lv_obj_set_style_radius(card, 8, 0);
            lvgl_sys::lv_obj_set_style_border_width(card, 1, 0);
            lvgl_sys::lv_obj_set_style_border_color(
                card,
                if rosso {
                    colore(239, 68, 68)
                } else {
                    colore(51, 65, 85)
                },
                0,
            );
            pad(card, 12);
            lvgl_sys::lv_obj_clear_flag(card, lvgl_sys::LV_OBJ_FLAG_SCROLLABLE);
        }
        let interna = card_w - 24;

        let Contenuto {
            titolo,
            sotto,
            compatibilita,
            corpo,
            pulsanti,
        } = self.contenuto(avviso, lingua, avvio_chiesto);

        etichetta(
            card,
            &titolo,
            0,
            0,
            interna,
            16,
            if rosso {
                colore(252, 165, 165)
            } else {
                colore(226, 232, 240)
            },
        )?;
        etichetta(card, &sotto, 0, 24, interna, 12, colore(148, 163, 184))?;

        // Il corpo scorre: le Novità di più versioni non stanno su un pannello
        // da 272 pixel, e tagliarle in silenzio sarebbe peggio che non averle.
        //
        // L'area si crea sempre alta il massimo e **poi** si rimpicciolisce a
        // quel che serve davvero: LVGL sa dire quanto è alta un'etichetta a
        // capo solo dopo averla disposta (`lv_obj_update_layout`), quindi
        // l'altezza giusta si può solo misurare, non prevedere. Senza questo,
        // «Aggiornamento non riuscito» — tre righe in tutto — apriva una
        // finestra alta 340 pixel con due terzi di vuoto.
        let alto_max = card_h - 24 - 44 - 52;
        let mut alto_usato = 0i16;
        if alto_max > 24 && (!compatibilita.is_empty() || !corpo.is_empty()) {
            let area = unsafe { lvgl_sys::lv_obj_create(card) };
            if area.is_null() {
                anyhow::bail!("lv_obj_create dell'area novità ha restituito null");
            }
            unsafe {
                lvgl_sys::lv_obj_set_pos(area, 0, 44);
                lvgl_sys::lv_obj_set_size(area, interna, alto_max);
                lvgl_sys::lv_obj_set_style_bg_opa(area, 0, 0);
                lvgl_sys::lv_obj_set_style_border_width(area, 0, 0);
                pad(area, 0);
                lvgl_sys::lv_obj_set_scroll_dir(area, lvgl_sys::LV_DIR_VER as u8);
            }
            let largo_testo = interna - 8;
            // Gli avvisi di compatibilità in rosso e in cima, come nel web:
            // sono l'unica parte per cui vale la pena fermarsi, e scritti del
            // colore di tutto il resto non lo direbbero a nessuno.
            let mut y = 0i16;
            if !compatibilita.is_empty() {
                let l = etichetta(
                    area,
                    &compatibilita,
                    0,
                    0,
                    largo_testo,
                    12,
                    colore(252, 165, 165),
                )?;
                y = misura(card, l) + 8;
            }
            if !corpo.is_empty() {
                let l = etichetta(area, &corpo, 0, y, largo_testo, 12, colore(148, 163, 184))?;
                y += misura(card, l);
            }
            alto_usato = y.min(alto_max);
            unsafe { lvgl_sys::lv_obj_set_height(area, alto_usato) };
        }

        // La finestra si stringe su quel che ha davvero dentro.
        let card_h = (44 + alto_usato + 8 + 44 + 24).min(card_h);
        unsafe {
            lvgl_sys::lv_obj_set_height(card, card_h);
            lvgl_sys::lv_obj_align(card, lvgl_sys::LV_ALIGN_CENTER as lvgl_sys::lv_align_t, 0, 0);
        }

        // I pulsanti in fondo, a larghezza uguale: su un touch la fila è il
        // posto dove il dito va a cercarli, e uno più largo degli altri
        // suggerirebbe una scelta preferita che qui non c'è.
        let n = pulsanti.len() as i16;
        let largo = (interna - 8 * (n - 1)) / n;
        for (i, (testo_pulsante, azione, evidenziato)) in pulsanti.into_iter().enumerate() {
            let x = (largo + 8) * i as i16;
            let b = unsafe { lvgl_sys::lv_btn_create(card) };
            if b.is_null() {
                anyhow::bail!("lv_btn_create ha restituito null");
            }
            unsafe {
                lvgl_sys::lv_obj_set_pos(b, x, card_h - 24 - 44);
                lvgl_sys::lv_obj_set_size(b, largo, 44);
                lvgl_sys::lv_obj_set_style_bg_color(
                    b,
                    if evidenziato {
                        colore(29, 78, 216)
                    } else {
                        colore(51, 65, 85)
                    },
                    0,
                );
                lvgl_sys::lv_obj_set_style_radius(b, 5, 0);
                pad(b, 2);
            }
            etichetta_centrata(b, &testo_pulsante, largo - 6, 11)?;
            // Un pulsante che non fa niente non si mostra attivo: ad avvio
            // chiesto il runtime sta già per essere sostituito.
            if avvio_chiesto {
                unsafe { lvgl_sys::lv_obj_clear_flag(b, lvgl_sys::LV_OBJ_FLAG_CLICKABLE) };
                continue;
            }
            let ctx = Box::new(CtxAvviso {
                stato: stato.clone(),
                base_url: base_url.to_string(),
                sessione: sessione.clone(),
                azione,
            });
            let p = &*ctx as *const CtxAvviso as *mut c_void;
            self.contesti.push(ctx);
            unsafe {
                lvgl_sys::lv_obj_add_event_cb(
                    b,
                    Some(sws_avviso_cb),
                    lvgl_sys::lv_event_code_t_LV_EVENT_CLICKED,
                    p,
                );
            }
        }
        Ok(())
    }

    /// Titolo, sottotitolo, avvisi di compatibilità, corpo scorrevole e
    /// pulsanti, nella lingua dei contenuti. Le parole vengono dalla tabella
    /// condivisa col web (`sws_core::testi_sistema`), il **contenuto** delle
    /// Novità arriva già bilingue dall'API.
    fn contenuto(&self, avviso: &Avviso, lingua: &str, avvio_chiesto: bool) -> Contenuto {
        match avviso {
            Avviso::Niente => Contenuto::default(),
            Avviso::Esito { evento, novita } => {
                let ok = evento.esito == EsitoAggiornamento::Riuscito;
                let a = evento.a.clone().unwrap_or_else(|| "?".into());
                // Il titolo dice in due parole **cosa è successo**, le versioni
                // stanno nella riga sotto. Fino al 30-09-2026 erano tutte
                // insieme nel titolo — «Updated from X to Y» — e il maintainer,
                // leggendolo sul WP630 con un solo pulsante «Chiudi», ha capito
                // che gli si annunciasse un aggiornamento *disponibile*. Un
                // messaggio che va decifrato alla prima lettura è un messaggio
                // sbagliato, anche quando ogni parola è vera.
                let titolo = format!(
                    "{} {}",
                    if ok { "✅" } else { "⚠" },
                    testo(
                        if ok {
                            Testo::EsitoTitoloOk
                        } else {
                            Testo::EsitoTitoloKo
                        },
                        lingua,
                    )
                );
                let (sotto, compatibilita, corpo) = if ok {
                    let n = novita
                        .as_ref()
                        .map(|n| aggiornamento::novita_nella_lingua(n, lingua))
                        .unwrap_or_default();
                    (
                        testo_con(Testo::EsitoVersioni, lingua, &[("da", &evento.da), ("a", &a)]),
                        if n.1.is_empty() {
                            String::new()
                        } else {
                            format!("⚠ {}", n.1)
                        },
                        n.0,
                    )
                } else {
                    // Il «non riuscito» non ha Novità da dare: la versione nuova
                    // non è mai partita. Al loro posto la spiegazione, che nomina
                    // tutte e due le versioni e quindi si regge da sola.
                    (
                        String::new(),
                        String::new(),
                        testo_con(Testo::EsitoSpiega, lingua, &[("da", &evento.da), ("a", &a)]),
                    )
                };
                Contenuto {
                    titolo,
                    sotto,
                    compatibilita,
                    corpo,
                    pulsanti: vec![(
                        testo(Testo::EsitoChiudi, lingua).to_string(),
                        Azione::ChiudiEsito(evento.id),
                        true,
                    )],
                }
            }
            Avviso::Quadlet { da, a } => Contenuto {
                titolo: format!("⚙ {}", testo(Testo::QuadletTitolo, lingua)),
                sotto: String::new(),
                compatibilita: String::new(),
                corpo: testo_con(Testo::QuadletSpiega, lingua, &[("da", da), ("a", a)]),
                pulsanti: vec![
                    (testo(Testo::AggPiuTardi, lingua).to_string(), Azione::PiuTardiQuadlet, false),
                    (
                        testo(if avvio_chiesto { Testo::AggInCorso } else { Testo::AggAggiorna }, lingua).to_string(),
                        Azione::AggiornaQuadlet,
                        true,
                    ),
                ],
            },
            Avviso::Conferma { da, a, istantanea, ritorno_chiesto } => {
                let v = [("da", da.as_str()), ("a", a.as_str())];
                let corpo = if *istantanea {
                    format!("{}\n\n{}", testo_con(Testo::ConfSpiega, lingua, &v), testo(Testo::ConfDati, lingua))
                } else {
                    testo_con(Testo::ConfSpiega, lingua, &v)
                };
                let pulsanti = if *ritorno_chiesto {
                    vec![
                        (testo(Testo::ConfAnnulla, lingua).to_string(), Azione::ChiediRitorno(false), false),
                        (
                            if avvio_chiesto { testo(Testo::AggInCorso, lingua).to_string() } else { testo_con(Testo::ConfRitorna, lingua, &v) },
                            Azione::Conferma("ritorna"),
                            true,
                        ),
                    ]
                } else {
                    vec![
                        (testo_con(Testo::ConfRitorna, lingua, &v), Azione::ChiediRitorno(true), false),
                        (testo(Testo::AggPiuTardi, lingua).to_string(), Azione::Conferma("piu_tardi"), false),
                        (testo(Testo::ConfDopoRiavvio, lingua).to_string(), Azione::Conferma("dopo_riavvio"), false),
                        (testo(Testo::ConfPulisci, lingua).to_string(), Azione::Conferma("pulisci"), true),
                    ]
                };
                Contenuto {
                    titolo: testo(Testo::ConfTitolo, lingua).to_string(),
                    // Il secondo passo del ritorno lo dice in rosso, dove stanno
                    // gli avvisi di compatibilità.
                    sotto: String::new(),
                    compatibilita: if *ritorno_chiesto { format!("⚠ {}", testo_con(Testo::ConfRitornaSicuro, lingua, &v)) } else { String::new() },
                    corpo,
                    pulsanti,
                }
            }
            Avviso::VersioneNuova { da, a, novita } => {
                let mut compatibilita = String::new();
                let mut corpo = String::new();
                for n in novita {
                    let (t, compat) = aggiornamento::novita_nella_lingua(n, lingua);
                    if !compat.is_empty() {
                        if !compatibilita.is_empty() {
                            compatibilita.push('\n');
                        }
                        compatibilita.push_str(&format!("⚠ {compat}"));
                    }
                    corpo.push_str(&format!("{}\n{}\n\n", n.versione, t));
                }
                Contenuto {
                    titolo: testo_con(Testo::AggTitolo, lingua, &[("a", a)]),
                    sotto: testo_con(Testo::AggDa, lingua, &[("da", da)]),
                    compatibilita,
                    corpo: corpo.trim_end().to_string(),
                    pulsanti: vec![
                        (
                            testo(Testo::AggIgnora, lingua).to_string(),
                            Azione::Ignora(a.clone()),
                            false,
                        ),
                        (
                            testo(Testo::AggPiuTardi, lingua).to_string(),
                            Azione::PiuTardi,
                            false,
                        ),
                        (
                            testo(
                                if avvio_chiesto {
                                    Testo::AggInCorso
                                } else {
                                    Testo::AggAggiorna
                                },
                                lingua,
                            )
                            .to_string(),
                            Azione::Aggiorna,
                            true,
                        ),
                    ],
                }
            }
        }
    }
}

/// Quel che va scritto nella finestra. Una struct e non una tupla di cinque
/// pezzi: tre dei cinque sono `String` e scambiarne due sarebbe un difetto
/// che compila.
#[derive(Default)]
struct Contenuto {
    titolo: String,
    sotto: String,
    /// Gli avvisi di compatibilità, già con il loro ⚠: vanno in rosso e in
    /// cima, separati dal resto.
    compatibilita: String,
    corpo: String,
    pulsanti: Vec<(String, Azione, bool)>,
}

/// L'altezza vera di un'etichetta a capo. LVGL la sa solo dopo aver disposto
/// il ramo: `lv_obj_update_layout` sul contenitore, poi la si legge.
fn misura(contenitore: *mut lvgl_sys::lv_obj_t, obj: *mut lvgl_sys::lv_obj_t) -> i16 {
    unsafe {
        lvgl_sys::lv_obj_update_layout(contenitore);
        lvgl_sys::lv_obj_get_height(obj)
    }
}

impl Drop for Overlay {
    fn drop(&mut self) {
        self.distruggi();
    }
}

fn colore(r: u8, g: u8, b: u8) -> lvgl_sys::lv_color_t {
    Color::from_rgb((r, g, b)).into()
}

/// `lv_obj_set_style_pad_all` è una macro inline di LVGL e non arriva nei
/// binding: i quattro lati a mano.
fn pad(obj: *mut lvgl_sys::lv_obj_t, v: i16) {
    unsafe {
        lvgl_sys::lv_obj_set_style_pad_left(obj, v, 0);
        lvgl_sys::lv_obj_set_style_pad_right(obj, v, 0);
        lvgl_sys::lv_obj_set_style_pad_top(obj, v, 0);
        lvgl_sys::lv_obj_set_style_pad_bottom(obj, v, 0);
    }
}

fn etichetta(
    parent: *mut lvgl_sys::lv_obj_t,
    testo: &str,
    x: i16,
    y: i16,
    larghezza: i16,
    font_px: u16,
    colore: lvgl_sys::lv_color_t,
) -> anyhow::Result<*mut lvgl_sys::lv_obj_t> {
    let l = unsafe { lvgl_sys::lv_label_create(parent) };
    if l.is_null() {
        anyhow::bail!("lv_label_create ha restituito null");
    }
    let c = text_cstring(testo);
    unsafe {
        lvgl_sys::lv_label_set_long_mode(l, lvgl_sys::LV_LABEL_LONG_WRAP as u8);
        lvgl_sys::lv_obj_set_width(l, larghezza);
        lvgl_sys::lv_obj_set_pos(l, x, y);
        lvgl_sys::lv_label_set_text(l, c.as_ptr());
        lvgl_sys::lv_obj_set_style_text_color(l, colore, 0);
        if let Some(f) = crate::lvgl_font::at_size(font_px) {
            lvgl_sys::lv_obj_set_style_text_font(l, f, 0);
        }
    }
    Ok(l)
}

/// L'etichetta di un pulsante: a capo se serve, centrata sul pulsante — su
/// 480×272 «Ignora questa versione» su un terzo di schermo non ci sta in una
/// riga sola, e troncarla lascerebbe «Ignora questa…», che vuol dire un'altra
/// cosa.
fn etichetta_centrata(
    parent: *mut lvgl_sys::lv_obj_t,
    testo: &str,
    larghezza: i16,
    font_px: u16,
) -> anyhow::Result<()> {
    let l = etichetta(parent, testo, 0, 0, larghezza, font_px, colore(226, 232, 240))?;
    unsafe {
        lvgl_sys::lv_obj_set_style_text_align(l, lvgl_sys::LV_TEXT_ALIGN_CENTER as u8, 0);
        lvgl_sys::lv_obj_align(l, lvgl_sys::LV_ALIGN_CENTER as lvgl_sys::lv_align_t, 0, 0);
    }
    Ok(())
}
