//! Rasterizzazione SVG per il motore LVGL (Q15 residuo + Q16).
//!
//! LVGL 8.x non ha un renderer SVG. Senza questo modulo restano muti i 12
//! simboli "vendored", i simboli custom disegnati dall'utente e tutto il widget
//! `image`, il cui catalogo bundlato è fatto di `.svg`. I 17 simboli builtin
//! non passano di qui: sono ridisegnati a mano con primitive LVGL (Q15 opzione
//! B, decisa l'11 agosto) e ricolorati per stato, cosa che una bitmap non
//! saprebbe fare senza rasterizzare una variante per colore.
//!
//! ## Perché la bitmap la possiede Rust
//!
//! Il buffer resta in un `Vec<u8>` nostro e a LVGL si passa un puntatore. Non
//! è un dettaglio: `LV_MEM_SIZE` è 1 MB, e una sola icona 128×128 in RGBA ne
//! occupa 64 KB — poche icone su una pagina esaurirebbero il pool e i guasti da
//! pool esaurito in LVGL sono silenziosi (`new_points_alloc` di Q22 insegna).
//! Tenendola fuori, la memoria è quella del processo, dove esaurirla dà un
//! errore che si legge.
//!
//! È lo stesso schema già usato da `LiveKind::Symbol`, che si porta dietro il
//! proprio `buf: Vec<u8>` per il canvas.

/// Bitmap pronta per `lv_img`/`lv_canvas`: pixel e dimensioni.
pub struct Raster {
    /// RGBA premoltiplicato, 4 byte per pixel, righe contigue.
    pub pixels: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

impl Raster {
    /// Byte occupati dalla bitmap, in formato RGBA di partenza.
    ///
    /// Il costo *vero* di una pagina lo somma `lvgl_render::svg_bitmap_bytes`
    /// sul formato convertito (3 byte/pixel invece di 4): questo serve ai test,
    /// per verificare che la bitmap abbia la taglia attesa.
    #[cfg(test)]
    pub fn bytes(&self) -> usize {
        self.pixels.len()
    }

    /// Converte nel formato che `lv_canvas` sa disegnare con questa
    /// configurazione: `LV_IMG_CF_TRUE_COLOR_ALPHA` a `LV_COLOR_DEPTH=16`,
    /// cioè **3 byte per pixel** — RGB565 little-endian più un byte di alfa.
    /// È lo stesso formato che già usano `render_symbol` e `render_pie_chart`.
    ///
    /// Non è solo un adattamento: dimezza la memoria rispetto a RGBA8888
    /// (48 KB invece di 64 KB per un simbolo 128x128), e su un pannello con
    /// una pagina piena di simboli la differenza si sente.
    ///
    /// tiny-skia produce RGBA **premoltiplicato**; LVGL si aspetta il colore
    /// non premoltiplicato con l'alfa a parte. Senza dividere per l'alfa i
    /// bordi antialiasati verrebbero scuri — l'errore tipico è invisibile al
    /// centro di una forma piena e visibile solo sui contorni, cioè
    /// esattamente dove è più facile scambiarlo per "l'SVG è fatto così".
    pub fn to_lvgl_true_color_alpha(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.pixels.len() / 4 * 3);
        for px in self.pixels.chunks_exact(4) {
            let (r, g, b, a) = (px[0], px[1], px[2], px[3]);
            let (r, g, b) = if a == 0 || a == 255 {
                (r, g, b)
            } else {
                let un = |c: u8| ((c as u16 * 255) / a as u16).min(255) as u8;
                (un(r), un(g), un(b))
            };
            let rgb565: u16 = ((r as u16 & 0xF8) << 8) | ((g as u16 & 0xFC) << 3) | (b as u16 >> 3);
            out.push((rgb565 & 0xFF) as u8);
            out.push((rgb565 >> 8) as u8);
            out.push(a);
        }
        out
    }
}

/// Dimensione massima accettata, per lato.
///
/// Un SVG dichiara le proprie dimensioni, e niente impedisce che dichiari
/// 4000×4000: sarebbero 64 MB di bitmap per una sola icona, su un pannello che
/// di RAM ne ha poca. Il limite non è prudenza generica — è la differenza fra
/// un'icona che non si vede e un runtime che viene ucciso dal kernel.
pub const MAX_SIDE: u32 = 512;

/// Il tetto per uno **sfondo di pagina** (27-10-2026).
///
/// Più alto perché lì la misura non la dichiara l'SVG: la dichiara la pagina,
/// e una pagina è grande quanto lo schermo. 512 andava bene per un'icona e
/// tagliava via ogni sfondo.
///
/// **Non è il tetto dell'immagine caricata**, che può essere grande quanto
/// vuole: una fotografia 4K messa su una pagina 1920×1080 la rimpicciolisce
/// resvg mentre disegna, perché l'involucro SVG è grande quanto la pagina e
/// l'immagine ci sta dentro con «copri». Il tetto riguarda il **riquadro
/// disegnato**, cioè la pagina.
///
/// 4096 e non 2048: il più largo dei formati che l'editor offre è
/// 21:9 UltraWide, **2560**×1080 (`pageLayout.ts`), e con 2048 quello sfondo
/// sarebbe sparito in silenzio. 4096 copre anche una pagina 4K
/// (3840×2160), che è dove la gente sta andando. Il prezzo in memoria si
/// legge: a 1280×800 sono 3 MB, a 1920×1080 6,2, a 3840×2160 **24,9** —
/// bitmap RGB565 più alfa, una per pagina. Chi disegna una pagina 4K ha uno
/// schermo 4K, e un pannello così ha la RAM per reggerla.
pub const MAX_SIDE_SFONDO: u32 = 4096;

/// `base` con lo specchio applicato **dopo**, attorno al riquadro `w`×`h`.
///
/// # Perché lo specchio sta qui e non sui pixel
///
/// `flip_h`/`flip_v` erano nel modello del viewer e nessuno li leggeva: un
/// simbolo specchiato nell'editor arrivava dritto sul pannello (seme del
/// 26-09-2026). LVGL 8.3 non ha uno specchio di stile — `transform_zoom` non
/// accetta valori negativi — quindi la via è un'altra per ogni famiglia di
/// oggetti; per i simboli e le immagini, che passano da qui, è questa.
///
/// Si specchia **mentre il disegno è ancora vettoriale**, non ribaltando i
/// pixel già rasterizzati (scelta del maintainer, 02-10-2026): a dimensioni
/// normali il risultato è lo stesso, ma su un pannello grande o un simbolo
/// ingrandito un ribaltamento di pixel perde quello che il vettoriale
/// conserva. E non costa un passaggio in più: è la stessa `Transform` che
/// `resvg::render` riceve comunque.
///
/// Lo specchio va **dopo** la scala e la centratura: `pre_concat` applica
/// `base` per prima, e il ribaltamento poi lavora sul riquadro di
/// destinazione, dove `w` e `h` sono quelli veri.
fn specchia(
    base: resvg::tiny_skia::Transform,
    w: u32,
    h: u32,
    flip_h: bool,
    flip_v: bool,
) -> resvg::tiny_skia::Transform {
    if !flip_h && !flip_v {
        return base;
    }
    let (sx, tx) = if flip_h { (-1.0, w as f32) } else { (1.0, 0.0) };
    let (sy, ty) = if flip_v { (-1.0, h as f32) } else { (1.0, 0.0) };
    resvg::tiny_skia::Transform::from_row(sx, 0.0, 0.0, sy, tx, ty).pre_concat(base)
}

/// Rasterizza `svg` a `w`×`h` pixel.
///
/// `None` quando l'SVG non si interpreta o le dimensioni chieste sono fuori
/// scala: chi chiama disegna il proprio segnaposto, come già fa per un simbolo
/// sconosciuto. Un'icona mancante è un difetto visibile; un runtime che muore
/// per una bitmap assurda no.
/// Come [`rasterize_entro`] col tetto delle icone, per le **prove**: ripetere
/// `MAX_SIDE` a ogni riga di test non aggiungerebbe niente.
///
/// Nel codice vero il tetto lo dichiara sempre chi chiama, e non è pedanteria:
/// il 27-10-2026 lo sfondo di una pagina spariva in silenzio perché ereditava
/// il tetto di un'icona, 512 px, senza che nessuna riga lo dicesse.
#[cfg(test)]
pub fn rasterize(svg: &[u8], w: u32, h: u32, flip_h: bool, flip_v: bool) -> Option<Raster> {
    rasterize_entro(svg, w, h, flip_h, flip_v, MAX_SIDE)
}

/// Come [`rasterize`], ma col tetto dichiarato da chi chiama: serve allo
/// sfondo di una pagina, dove la misura è la pagina e non una scelta dell'SVG.
pub fn rasterize_entro(svg: &[u8], w: u32, h: u32, flip_h: bool, flip_v: bool, tetto: u32) -> Option<Raster> {
    if w == 0 || h == 0 || w > tetto || h > tetto {
        return None;
    }
    let opt = resvg::usvg::Options::default();
    let tree = resvg::usvg::Tree::from_data(svg, &opt).ok()?;

    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h)?;
    // Si scala l'SVG dentro il riquadro richiesto mantenendo le proporzioni:
    // deformare un simbolo di impianto per riempire un rettangolo è peggio che
    // lasciarlo più piccolo, perché una valvola schiacciata sembra un'altra
    // valvola.
    let size = tree.size();
    let transform = trasformazione((size.width(), size.height()), w, h, flip_h, flip_v);
    resvg::render(&tree, transform, &mut pixmap.as_mut());

    Some(Raster {
        width: w,
        height: h,
        pixels: pixmap.take(),
    })
}

/// Un riquadro in pixel dentro il riquadro `w`×`h` di un oggetto.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ritaglio {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// La trasformazione di [`rasterize`]: l'SVG di dimensioni `size` contenuto e
/// centrato in `w`×`h`, con lo specchio. Esposta per i simboli di libreria, che
/// disegnano uno strato alla volta e devono mettere ogni strato **esattamente**
/// dove `rasterize` metterebbe il disegno intero.
pub fn trasformazione(size: (f32, f32), w: u32, h: u32, flip_h: bool, flip_v: bool) -> resvg::tiny_skia::Transform {
    let scale = (w as f32 / size.0).min(h as f32 / size.1);
    let dx = (w as f32 - size.0 * scale) / 2.0;
    let dy = (h as f32 - size.1 * scale) / 2.0;
    specchia(
        resvg::tiny_skia::Transform::from_translate(dx, dy).pre_scale(scale, scale),
        w,
        h,
        flip_h,
        flip_v,
    )
}

/// Il riquadro in pixel che il disegno di `svg` occupa dentro `w`×`h`, bordi
/// compresi e arrotondato verso l'esterno di un pixel. `None` se non disegna niente.
pub fn ingombro(svg: &[u8], w: u32, h: u32, flip_h: bool, flip_v: bool) -> Option<Ritaglio> {
    let tree = resvg::usvg::Tree::from_data(svg, &resvg::usvg::Options::default()).ok()?;
    let b = tree.root().abs_stroke_bounding_box();
    if b.width() <= 0.0 || b.height() <= 0.0 {
        return None;
    }
    let t = trasformazione((tree.size().width(), tree.size().height()), w, h, flip_h, flip_v);
    let mut pts = [
        resvg::tiny_skia::Point::from_xy(b.left(), b.top()),
        resvg::tiny_skia::Point::from_xy(b.right(), b.top()),
        resvg::tiny_skia::Point::from_xy(b.left(), b.bottom()),
        resvg::tiny_skia::Point::from_xy(b.right(), b.bottom()),
    ];
    t.map_points(&mut pts);
    ritaglio_di(&pts, w, h)
}

/// Il riquadro, dentro `w`×`h`, che contiene i punti dati (già in pixel).
pub fn ritaglio_di(pts: &[resvg::tiny_skia::Point], w: u32, h: u32) -> Option<Ritaglio> {
    let x0 = pts.iter().map(|p| p.x).fold(f32::INFINITY, f32::min).floor() - 1.0;
    let y0 = pts.iter().map(|p| p.y).fold(f32::INFINITY, f32::min).floor() - 1.0;
    let x1 = pts.iter().map(|p| p.x).fold(f32::NEG_INFINITY, f32::max).ceil() + 1.0;
    let y1 = pts.iter().map(|p| p.y).fold(f32::NEG_INFINITY, f32::max).ceil() + 1.0;
    let (x0, y0) = (x0.max(0.0) as u32, y0.max(0.0) as u32);
    let (x1, y1) = ((x1.max(0.0) as u32).min(w), (y1.max(0.0) as u32).min(h));
    (x1 > x0 && y1 > y0).then_some(Ritaglio { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
}

/// Rasterizza solo il riquadro `r` di quello che [`rasterize`] disegnerebbe a
/// `w`×`h`: stessa scala, stessa centratura, stesso specchio.
pub fn rasterize_ritaglio(svg: &[u8], w: u32, h: u32, flip_h: bool, flip_v: bool, r: Ritaglio) -> Option<Raster> {
    if w == 0 || h == 0 || w > MAX_SIDE || h > MAX_SIDE || r.w == 0 || r.h == 0 {
        return None;
    }
    let tree = resvg::usvg::Tree::from_data(svg, &resvg::usvg::Options::default()).ok()?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(r.w, r.h)?;
    let t = resvg::tiny_skia::Transform::from_translate(-(r.x as f32), -(r.y as f32))
        .pre_concat(trasformazione((tree.size().width(), tree.size().height()), w, h, flip_h, flip_v));
    resvg::render(&tree, t, &mut pixmap.as_mut());
    Some(Raster { width: r.w, height: r.h, pixels: pixmap.take() })
}

/// Rasterizza `svg` **stirato** a `w`×`h`, senza tenere le proporzioni: è lo
/// sfondo del trend, che sul web è `drawImage(img, 0, 0, w, h)`. Il limite per
/// lato è più largo di [`MAX_SIDE`] perché un trend può occupare lo schermo.
pub fn rasterize_stretch(svg: &[u8], w: u32, h: u32) -> Option<resvg::tiny_skia::Pixmap> {
    if w == 0 || h == 0 || w > 2048 || h > 2048 {
        return None;
    }
    let tree = resvg::usvg::Tree::from_data(svg, &resvg::usvg::Options::default()).ok()?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h)?;
    let size = tree.size();
    let t = resvg::tiny_skia::Transform::from_scale(w as f32 / size.width(), h as f32 / size.height());
    resvg::render(&tree, t, &mut pixmap.as_mut());
    Some(pixmap)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CERCHIO: &[u8] = br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="#ff0000"/></svg>"##;

    /// Una forma **asimmetrica**: un triangolo che punta a destra e sta nella
    /// metà alta. Un cerchio non servirebbe a provare lo specchio — specchiato
    /// è identico a sé stesso, ed è proprio per questo che `rect`, `ellipse` e
    /// `led` non hanno bisogno di niente.
    const FRECCIA: &[u8] = br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <polygon points="10,10 90,30 10,45" fill="#ff0000"/></svg>"##;

    /// Dove sta il rosso: quanti pixel accesi nella metà sinistra e in quella alta.
    fn peso(r: &Raster) -> (usize, usize) {
        let (mut sinistra, mut alto) = (0, 0);
        for y in 0..r.height as usize {
            for x in 0..r.width as usize {
                let i = (y * r.width as usize + x) * 4;
                if r.pixels[i + 3] > 128 {
                    if x < r.width as usize / 2 { sinistra += 1; }
                    if y < r.height as usize / 2 { alto += 1; }
                }
            }
        }
        (sinistra, alto)
    }

    #[test]
    fn lo_specchio_orizzontale_sposta_la_forma_dall_altra_parte() {
        // Il difetto del seme: `flip_h` era nel modello e il rasterizzatore
        // non lo guardava, così un simbolo specchiato nell'editor arrivava
        // dritto sul pannello.
        let dritto = rasterize(FRECCIA, 64, 64, false, false).unwrap();
        let girato = rasterize(FRECCIA, 64, 64, true, false).unwrap();
        let (s_dritto, _) = peso(&dritto);
        let (s_girato, _) = peso(&girato);
        assert!(s_dritto > s_girato, "la freccia punta a destra: dritta pesa di più a sinistra ({s_dritto} contro {s_girato})");
        // E lo specchio non perde né aggiunge inchiostro: è la stessa forma.
        let acceso = |r: &Raster| r.pixels.chunks_exact(4).filter(|p| p[3] > 128).count();
        assert_eq!(acceso(&dritto), acceso(&girato), "lo specchio non deve cambiare l'area disegnata");
    }

    #[test]
    fn lo_specchio_verticale_lavora_sull_altro_asse() {
        let dritto = rasterize(FRECCIA, 64, 64, false, false).unwrap();
        let girato = rasterize(FRECCIA, 64, 64, false, true).unwrap();
        let (_, a_dritto) = peso(&dritto);
        let (_, a_girato) = peso(&girato);
        assert!(a_dritto > a_girato, "la freccia sta in alto: dritta pesa di più in alto ({a_dritto} contro {a_girato})");
    }

    #[test]
    fn i_due_specchi_insieme_sono_una_rotazione_di_mezzo_giro() {
        // h+v equivale a 180°: la forma finisce nell'angolo opposto.
        let dritto = rasterize(FRECCIA, 64, 64, false, false).unwrap();
        let doppio = rasterize(FRECCIA, 64, 64, true, true).unwrap();
        let (s_d, a_d) = peso(&dritto);
        let (s_x, a_x) = peso(&doppio);
        assert!(s_d > s_x && a_d > a_x, "con tutti e due gli specchi la forma passa nell'angolo opposto");
    }

    #[test]
    fn senza_specchio_la_trasformazione_e_quella_di_prima() {
        // `specchia` deve restituire `base` identica: è ciò che garantisce
        // che i tipi che non specchiano disegnino esattamente come ieri.
        let base = resvg::tiny_skia::Transform::from_translate(3.0, 5.0).pre_scale(2.0, 2.0);
        assert_eq!(specchia(base, 64, 64, false, false), base);
    }

    #[test]
    fn rasterizza_un_svg_semplice() {
        let r = rasterize(CERCHIO, 64, 64, false, false).expect("un cerchio deve rasterizzarsi");
        assert_eq!((r.width, r.height), (64, 64));
        assert_eq!(r.bytes(), 64 * 64 * 4);
        // il centro deve essere rosso: se fosse trasparente avremmo prodotto
        // una bitmap vuota senza accorgercene, che è il modo in cui un
        // rasterizzatore "funziona" e non disegna niente.
        let c = (32 * 64 + 32) * 4;
        assert!(
            r.pixels[c] > 200 && r.pixels[c + 3] > 200,
            "il centro dovrebbe essere rosso opaco, invece è {:?}",
            &r.pixels[c..c + 4]
        );
    }

    #[test]
    fn un_svg_malformato_non_fa_esplodere_niente() {
        assert!(rasterize(b"non sono un svg", 32, 32, false, false).is_none());
        assert!(rasterize(b"", 32, 32, false, false).is_none());
    }

    /// Il limite esiste perché un SVG può dichiarare qualunque dimensione, e
    /// una bitmap enorme su questo hardware non è un'icona brutta: è il runtime
    /// ucciso dal kernel.
    #[test]
    fn le_dimensioni_assurde_vengono_rifiutate() {
        assert!(rasterize(CERCHIO, 0, 32, false, false).is_none());
        assert!(rasterize(CERCHIO, 32, 0, false, false).is_none());
        assert!(rasterize(CERCHIO, MAX_SIDE + 1, 32, false, false).is_none());
        assert!(rasterize(CERCHIO, 32, MAX_SIDE + 1, false, false).is_none());
        assert!(
            rasterize(CERCHIO, MAX_SIDE, MAX_SIDE, false, false).is_some(),
            "il limite stesso deve passare"
        );
    }

    /// Le proporzioni si mantengono: un quadrato in un rettangolo largo resta
    /// quadrato e centrato, non stirato.
    #[test]
    fn le_proporzioni_si_mantengono() {
        let r = rasterize(CERCHIO, 128, 64, false, false).expect("deve rasterizzarsi");
        // Colonna al bordo sinistro: fuori dal cerchio centrato, quindi vuota.
        let bordo = (32 * 128 + 2) * 4;
        assert_eq!(
            r.pixels[bordo + 3],
            0,
            "il margine laterale dovrebbe restare trasparente"
        );
        // Centro: dentro il cerchio.
        let centro = (32 * 128 + 64) * 4;
        assert!(
            r.pixels[centro + 3] > 200,
            "il centro dovrebbe essere pieno"
        );
    }

    #[test]
    fn la_conversione_per_lvgl_usa_tre_byte_per_pixel() {
        let r = rasterize(CERCHIO, 16, 16, false, false).expect("deve rasterizzarsi");
        let buf = r.to_lvgl_true_color_alpha();
        assert_eq!(
            buf.len(),
            16 * 16 * 3,
            "LV_IMG_CF_TRUE_COLOR_ALPHA a 16 bit = 3 byte/pixel"
        );
        // Centro rosso: RGB565 di #ff0000 è 0xF800, little-endian 00 F8, alfa piena.
        let c = (8 * 16 + 8) * 3;
        assert_eq!(
            &buf[c..c + 3],
            &[0x00, 0xF8, 0xFF],
            "il centro dovrebbe essere rosso opaco"
        );
        // Angolo fuori dal cerchio: trasparente.
        assert_eq!(buf[2], 0, "l'angolo dovrebbe avere alfa 0");
    }

    /// tiny-skia premoltiplica. Se non si divide per l'alfa, un pixel a metà
    /// copertura esce a metà luminosità e i bordi antialiasati diventano
    /// scuri — un difetto che si vede solo sui contorni e che è facile
    /// scambiare per "l'SVG è disegnato così".
    #[test]
    fn la_premoltiplicazione_viene_annullata() {
        let r = Raster {
            // rosso pieno a metà copertura: premoltiplicato è (128, 0, 0, 128)
            pixels: vec![128, 0, 0, 128],
            width: 1,
            height: 1,
        };
        let buf = r.to_lvgl_true_color_alpha();
        assert_eq!(
            buf[1] & 0xF8,
            0xF8,
            "il rosso deve tornare pieno, non dimezzato: {buf:?}"
        );
        assert_eq!(buf[2], 128, "l'alfa deve restare quella di partenza");
    }

    /// Tutti i disegni della libreria, interi: si interpretano e lasciano
    /// inchiostro. Il modo in cui un SVG fallirebbe qui è il peggiore: si
    /// interpreta, la bitmap esce **vuota**, e sul pannello compare un buco che
    /// sembra un simbolo dimenticato. Prende il posto del test sui vendored,
    /// che dal 13-09-2026 girava su una tabella vuota.
    #[test]
    fn i_simboli_della_libreria_si_disegnano() {
        let radice = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../sws-editor/public/symbols/lib");
        let m: sws_core::simboli_lib::ManifestLib =
            serde_json::from_slice(&std::fs::read(radice.join("manifest.json")).unwrap()).unwrap();
        assert!(m.symbols.len() >= 40);
        for s in &m.symbols {
            let svg = std::fs::read(radice.join(&s.file)).unwrap_or_else(|e| panic!("{}: {e}", s.id));
            let r = rasterize(&svg, 96, 96, false, false).unwrap_or_else(|| panic!("{}: resvg non lo interpreta", s.id));
            let pieni = r.pixels.chunks_exact(4).filter(|p| p[3] > 16).count();
            // Un disegno sottile (il traliccio, la curva) sta sopra il 5 %.
            assert!(pieni > 96 * 96 / 20, "{}: quasi vuoto ({pieni} pixel su {})", s.id, 96 * 96);
        }
    }
}

#[cfg(test)]
mod prove_raster_q16 {
    /// La prova che la meta' raster della Q16 e' davvero accesa (27-10-2026).
    ///
    /// Non controlla un numero di pixel: controlla che un **JPEG vero**, dopo
    /// essere stato avvolto in un SVG, esca come immagine e non come nulla. Se
    /// la feature `raster-images` di resvg si spegnesse — un `default-features`
    /// rimesso, un aggiornamento che cambia i nomi delle feature — `usvg`
    /// lascerebbe l'`<image>` vuoto e la pagina tornerebbe senza sfondo, in
    /// silenzio. E' successo esattamente cosi' per mesi, solo che allora la
    /// feature non c'era mai stata.
    /// Il formato più largo che l'editor offre è 21:9 UltraWide, 2560×1080
    /// (`pageLayout.ts`). Con un tetto a 2048 il suo sfondo sarebbe sparito
    /// senza che niente lo dicesse: è il genere di difetto che si scopre un
    /// mese dopo, su un pannello di un cliente.
    #[test]
    fn il_tetto_dello_sfondo_copre_i_formati_che_offriamo() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#123456"/></svg>"##;
        for (w, h, cosa) in [
            (1280u32, 800u32, "16:10, i pannelli"),
            (1920, 1080, "Full HD"),
            (2560, 1080, "21:9 UltraWide"),
            (3840, 2160, "una pagina 4K"),
        ] {
            assert!(
                super::rasterize_entro(svg, w, h, false, false, super::MAX_SIDE_SFONDO).is_some(),
                "{cosa} ({w}×{h}) non passa il tetto dello sfondo"
            );
        }
        // Il tetto però esiste: oltre, si rinuncia invece di allocare a caso.
        assert!(super::rasterize_entro(svg, 5000, 100, false, false, super::MAX_SIDE_SFONDO).is_none());
    }

    #[test]
    fn un_jpeg_avvolto_in_un_svg_si_disegna() {
        let jpeg = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../catalogo/dispositivi/pixsys/atr244.jpg");
        let byte = match std::fs::read(&jpeg) {
            Ok(b) => b,
            // Il catalogo potrebbe non esserci in un albero ridotto: meglio
            // saltare che inventare un fallimento.
            Err(_) => return,
        };
        let svg = crate::svg_assets::svg_attorno_al_raster(&byte, "image/jpeg", 64, 48);
        let r = super::rasterize(&svg, 64, 48, false, false).expect("il JPEG non si e' rasterizzato");
        assert_eq!((r.width, r.height), (64, 48));
        let opachi = r.pixels.chunks_exact(4).filter(|px| px[3] > 0).count();
        assert!(
            opachi > 64 * 48 / 2,
            "«copri» riempie il riquadro: solo {opachi} pixel su {} sono opachi — la feature raster di resvg e' spenta?",
            64 * 48
        );
    }
}
