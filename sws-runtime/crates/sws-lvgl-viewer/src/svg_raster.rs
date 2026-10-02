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
pub fn rasterize(svg: &[u8], w: u32, h: u32, flip_h: bool, flip_v: bool) -> Option<Raster> {
    if w == 0 || h == 0 || w > MAX_SIDE || h > MAX_SIDE {
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
    let scale = (w as f32 / size.width()).min(h as f32 / size.height());
    let dx = (w as f32 - size.width() * scale) / 2.0;
    let dy = (h as f32 - size.height() * scale) / 2.0;
    let transform = specchia(
        resvg::tiny_skia::Transform::from_translate(dx, dy).pre_scale(scale, scale),
        w,
        h,
        flip_h,
        flip_v,
    );
    resvg::render(&tree, transform, &mut pixmap.as_mut());

    Some(Raster {
        width: w,
        height: h,
        pixels: pixmap.take(),
    })
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

    /// I simboli vendored veri, non un SVG di comodo — per quando
    /// `VENDORED` (`svg_assets.rs`) tornerà a non essere vuota.
    ///
    /// Arrivano da librerie esterne (Material Design Icons, Equinor) e nessuno
    /// li ha scritti per noi: possono usare costrutti che questa build di
    /// `resvg` — senza feature testo, per non tirarsi dietro fontdb — non
    /// gestisce. Il modo in cui fallirebbero è il peggiore possibile: l'SVG si
    /// interpreta, la bitmap esce **vuota**, e sul pannello compare un
    /// rettangolo trasparente che sembra un simbolo dimenticato.
    ///
    /// Quindi non basta che `rasterize` restituisca `Some`: si conta quanti
    /// pixel hanno davvero dell'inchiostro. **Dal 13-09-2026 (Q40) questo
    /// test non esercita niente**: gli ultimi 7 vendored sono diventati
    /// builtin, `VENDORED` è vuota, il ciclo sotto gira zero volte. Resta qui
    /// apposta — non cancellato — perché torni a valere da solo il giorno in
    /// cui un simbolo vendored nuovo arriva in quella tabella, senza che
    /// serva riscriverlo.
    #[test]
    fn i_simboli_vendored_veri_si_disegnano() {
        let radice = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../sws-editor/public/symbols");
        let mut visti = 0;
        for (id, path) in crate::svg_assets::VENDORED {
            let file = radice.join(path.trim_start_matches("/symbols/"));
            let svg = std::fs::read(&file)
                .unwrap_or_else(|e| panic!("{id}: {} non leggibile: {e}", file.display()));
            let r =
                rasterize(&svg, 96, 96, false, false).unwrap_or_else(|| panic!("{id}: resvg non lo interpreta"));
            let pieni = r.pixels.chunks_exact(4).filter(|p| p[3] > 16).count();
            // Soglia al 10%, misurata il 2026-08-26 sugli undici vendored di
            // allora (dal 23% al 55% di pixel pieni): lascia margine a un
            // simbolo più esile senza lasciar passare una bitmap vuota.
            assert!(
                pieni > 96 * 96 / 10,
                "{id}: rasterizzato ma quasi vuoto ({pieni} pixel su {}) — sul pannello sarebbe un buco",
                96 * 96
            );
            visti += 1;
        }
        assert_eq!(visti, crate::svg_assets::VENDORED.len());
    }
}
