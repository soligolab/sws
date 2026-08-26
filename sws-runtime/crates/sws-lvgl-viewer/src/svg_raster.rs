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
            let rgb565: u16 =
                ((r as u16 & 0xF8) << 8) | ((g as u16 & 0xFC) << 3) | (b as u16 >> 3);
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

/// Rasterizza `svg` a `w`×`h` pixel.
///
/// `None` quando l'SVG non si interpreta o le dimensioni chieste sono fuori
/// scala: chi chiama disegna il proprio segnaposto, come già fa per un simbolo
/// sconosciuto. Un'icona mancante è un difetto visibile; un runtime che muore
/// per una bitmap assurda no.
pub fn rasterize(svg: &[u8], w: u32, h: u32) -> Option<Raster> {
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
    let transform = resvg::tiny_skia::Transform::from_translate(dx, dy)
        .pre_scale(scale, scale);
    resvg::render(&tree, transform, &mut pixmap.as_mut());

    Some(Raster { width: w, height: h, pixels: pixmap.take() })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CERCHIO: &[u8] = br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="#ff0000"/></svg>"##;

    #[test]
    fn rasterizza_un_svg_semplice() {
        let r = rasterize(CERCHIO, 64, 64).expect("un cerchio deve rasterizzarsi");
        assert_eq!((r.width, r.height), (64, 64));
        assert_eq!(r.bytes(), 64 * 64 * 4);
        // il centro deve essere rosso: se fosse trasparente avremmo prodotto
        // una bitmap vuota senza accorgercene, che è il modo in cui un
        // rasterizzatore "funziona" e non disegna niente.
        let c = (32 * 64 + 32) * 4;
        assert!(r.pixels[c] > 200 && r.pixels[c + 3] > 200,
                "il centro dovrebbe essere rosso opaco, invece è {:?}", &r.pixels[c..c + 4]);
    }

    #[test]
    fn un_svg_malformato_non_fa_esplodere_niente() {
        assert!(rasterize(b"non sono un svg", 32, 32).is_none());
        assert!(rasterize(b"", 32, 32).is_none());
    }

    /// Il limite esiste perché un SVG può dichiarare qualunque dimensione, e
    /// una bitmap enorme su questo hardware non è un'icona brutta: è il runtime
    /// ucciso dal kernel.
    #[test]
    fn le_dimensioni_assurde_vengono_rifiutate() {
        assert!(rasterize(CERCHIO, 0, 32).is_none());
        assert!(rasterize(CERCHIO, 32, 0).is_none());
        assert!(rasterize(CERCHIO, MAX_SIDE + 1, 32).is_none());
        assert!(rasterize(CERCHIO, 32, MAX_SIDE + 1).is_none());
        assert!(rasterize(CERCHIO, MAX_SIDE, MAX_SIDE).is_some(), "il limite stesso deve passare");
    }

    /// Le proporzioni si mantengono: un quadrato in un rettangolo largo resta
    /// quadrato e centrato, non stirato.
    #[test]
    fn le_proporzioni_si_mantengono() {
        let r = rasterize(CERCHIO, 128, 64).expect("deve rasterizzarsi");
        // Colonna al bordo sinistro: fuori dal cerchio centrato, quindi vuota.
        let bordo = (32 * 128 + 2) * 4;
        assert_eq!(r.pixels[bordo + 3], 0, "il margine laterale dovrebbe restare trasparente");
        // Centro: dentro il cerchio.
        let centro = (32 * 128 + 64) * 4;
        assert!(r.pixels[centro + 3] > 200, "il centro dovrebbe essere pieno");
    }

    #[test]
    fn la_conversione_per_lvgl_usa_tre_byte_per_pixel() {
        let r = rasterize(CERCHIO, 16, 16).expect("deve rasterizzarsi");
        let buf = r.to_lvgl_true_color_alpha();
        assert_eq!(buf.len(), 16 * 16 * 3, "LV_IMG_CF_TRUE_COLOR_ALPHA a 16 bit = 3 byte/pixel");
        // Centro rosso: RGB565 di #ff0000 è 0xF800, little-endian 00 F8, alfa piena.
        let c = (8 * 16 + 8) * 3;
        assert_eq!(&buf[c..c + 3], &[0x00, 0xF8, 0xFF], "il centro dovrebbe essere rosso opaco");
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
        assert_eq!(buf[1] & 0xF8, 0xF8, "il rosso deve tornare pieno, non dimezzato: {buf:?}");
        assert_eq!(buf[2], 128, "l'alfa deve restare quella di partenza");
    }

    /// I simboli vendored veri, non un SVG di comodo.
    ///
    /// Arrivano da librerie esterne (Material Design Icons, Equinor) e nessuno
    /// li ha scritti per noi: possono usare costrutti che questa build di
    /// `resvg` — senza feature testo, per non tirarsi dietro fontdb — non
    /// gestisce. Il modo in cui fallirebbero è il peggiore possibile: l'SVG si
    /// interpreta, la bitmap esce **vuota**, e sul pannello compare un
    /// rettangolo trasparente che sembra un simbolo dimenticato.
    ///
    /// Quindi non basta che `rasterize` restituisca `Some`: si conta quanti
    /// pixel hanno davvero dell'inchiostro.
    #[test]
    fn i_simboli_vendored_veri_si_disegnano() {
        let radice = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../sws-editor/public/symbols");
        let mut visti = 0;
        for (id, path) in crate::svg_assets::VENDORED {
            let file = radice.join(path.trim_start_matches("/symbols/"));
            let svg = std::fs::read(&file)
                .unwrap_or_else(|e| panic!("{id}: {} non leggibile: {e}", file.display()));
            let r = rasterize(&svg, 96, 96)
                .unwrap_or_else(|| panic!("{id}: resvg non lo interpreta"));
            let pieni = r.pixels.chunks_exact(4).filter(|p| p[3] > 16).count();
            // Soglia al 10%: misurato il 2026-08-26, gli undici stanno fra il
            // 23% (transmission_tower) e il 55% (reactor). Il 10% lascia
            // margine a un simbolo più esile senza lasciar passare una bitmap
            // vuota o quasi.
            assert!(
                pieni > 96 * 96 / 10,
                "{id}: rasterizzato ma quasi vuoto ({pieni} pixel su {}) — sul pannello sarebbe un buco",
                96 * 96
            );
            visti += 1;
        }
        assert_eq!(visti, crate::svg_assets::VENDORED.len());
        assert!(visti >= 11, "attesi almeno gli 11 simboli noti, trovati {visti}");
    }
}
