//! Geometria del foglio: il rettangolo di un oggetto sinottico e la domanda
//! «sta fuori dalla pagina?».
//!
//! # Perché sta in `sws-core`
//!
//! La risposta serve in tre posti che non si conoscono fra loro — il motore
//! LVGL (che non crea il widget), il validatore (che non ne segnala i difetti)
//! e, in TypeScript, il canvas del browser — e una definizione ripetuta tre
//! volte diventa tre definizioni diverse nel giro di qualche mese. `sws-core`
//! è già la casa di `PageLayoutConfig`/`PageSizeMode` e i due crate che
//! servono ne dipendono entrambi.
//!
//! # Perché la firma è numerica
//!
//! `bbox_of` prende numeri e non una struct: `sws-web::synoptic` e
//! `sws-lvgl-viewer::model` sono due **mirror** dello stesso tipo TypeScript,
//! tenuti apposta indipendenti (ADR 0002), e non sono nemmeno uguali fra loro —
//! nel web `x`/`y` sono `f64` nudi e `points` un `serde_json::Value` opaco, in
//! LVGL sono `Option<f64>` e `Option<Vec<PipePoint>>`. Accoppiarli qui, con un
//! tratto o una struct condivisa, significherebbe che un campo aggiunto da una
//! parte deve esistere anche dall'altra. Ogni crate porta il suo adattatore
//! sottile.
//!
//! # Il gemello in TypeScript
//!
//! `isOffPage` in `sws-editor/src/pageLayout.ts` dice **la stessa cosa**, e la
//! tabella `CASI_FUORI_PAGINA` qui sotto esiste identica là.
//! `scripts/check_off_page.sh` le confronta a ogni giro: è l'unico modo perché
//! due implementazioni restino una definizione sola.

/// Il rettangolo di un oggetto in coordinate pagina, allineato agli assi.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BBox {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

/// Il rettangolo di un oggetto sinottico.
///
/// Le linee usano il min/max dei due estremi (si disegnano anche da destra a
/// sinistra), le pipe l'inviluppo dei waypoint, tutto il resto x/y + w/h.
///
/// **La rotazione non c'entra**: il box è sempre allineato agli assi sulle
/// coordinate nominali, come nel gemello TypeScript.
///
/// Nota su `w`/`h` assenti, che è una divergenza dichiarata e non un difetto:
/// qui il chiamante passa `unwrap_or(0.0)`, mentre il render disegna 100/50 di
/// default. Un oggetto senza larghezza a x = -60 risulta quindi «fuori» pur
/// essendo disegnato a metà in editor. Editor e runtime restano d'accordo fra
/// loro; la divergenza è solo con l'occhio.
pub fn bbox_of(
    obj_type: &str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    x2: Option<f64>,
    y2: Option<f64>,
    points: &[(f64, f64)],
) -> BBox {
    if obj_type == "line" {
        let lx2 = x2.unwrap_or(x);
        let ly2 = y2.unwrap_or(y);
        return BBox {
            x1: x.min(lx2),
            y1: y.min(ly2),
            x2: x.max(lx2),
            y2: y.max(ly2),
        };
    }
    if obj_type == "pipe" && !points.is_empty() {
        let mut bb = BBox { x1: f64::MAX, y1: f64::MAX, x2: f64::MIN, y2: f64::MIN };
        for (px, py) in points {
            bb.x1 = bb.x1.min(*px);
            bb.y1 = bb.y1.min(*py);
            bb.x2 = bb.x2.max(*px);
            bb.y2 = bb.y2.max(*py);
        }
        return bb;
    }
    BBox { x1: x, y1: y, x2: x + w, y2: y + h }
}

/// «Fuori pagina»: la bbox non tocca **affatto** il rettangolo pagina.
///
/// Un oggetto a cavallo del bordo resta attivo — si spegne solo ciò che è stato
/// portato via del tutto.
///
/// Le quattro disuguaglianze **sono** la definizione, e sono le stesse di
/// `isOffPage` in `sws-editor/src/pageLayout.ts`. Sono **larghe** (`<`, non
/// `<=`) di proposito: a intervalli aperti una bbox di area zero — una linea
/// verticale su x=0, un oggetto senza larghezza — risulterebbe fuori e il
/// runtime la cancellerebbe. «A filo del bordo» resta dentro, che è anche la
/// lettura conservativa giusta quando si decide se far sparire qualcosa dal
/// sinottico di qualcun altro.
///
/// Pagina senza dimensioni (modalità fluida) ⇒ nessun bordo ⇒ niente è fuori.
///
/// TODO(open-question): Q35 — questo stato è implicito nelle coordinate; il
/// campo `disabled` esplicito è l'alternativa, non ancora decisa.
pub fn is_off_page(bb: &BBox, page_w: Option<f64>, page_h: Option<f64>) -> bool {
    let (Some(pw), Some(ph)) = (page_w, page_h) else { return false };
    if pw <= 0.0 || ph <= 0.0 {
        return false;
    }
    bb.x2 < 0.0 || bb.y2 < 0.0 || bb.x1 > pw || bb.y1 > ph
}

/// La tabella di verità del fuori pagina, **duplicata in TypeScript** in
/// `sws-editor/src/pageLayout.ts` e tenuta allineata da
/// `scripts/check_off_page.sh`.
///
/// È dichiarata come dato estraibile — non come una lista di `assert!` — perché
/// una guardia possa leggerla senza interpretare il linguaggio, come già fanno
/// `check_lvgl_symbols.sh` e `check_lvgl_types.sh` con le loro tabelle.
///
/// Campi: nome, tipo, x, y, w, h, larghezza pagina, altezza pagina, atteso.
pub const CASI_FUORI_PAGINA: &[(&str, &str, f64, f64, f64, f64, f64, f64, bool)] = &[
    ("dentro",                    "rect", 100.0,  100.0, 120.0,  80.0, 1280.0, 800.0, false),
    ("a filo del bordo destro",   "rect", 1160.0, 100.0, 120.0,  80.0, 1280.0, 800.0, false),
    ("a cavallo del bordo destro","rect", 1200.0, 100.0, 120.0,  80.0, 1280.0, 800.0, false),
    ("esattamente sul bordo",     "rect", 1280.0, 100.0, 120.0,  80.0, 1280.0, 800.0, false),
    ("un pixel oltre il bordo",   "rect", 1281.0, 100.0, 120.0,  80.0, 1280.0, 800.0, true),
    ("oltre il bordo destro",     "rect", 1400.0, 100.0, 120.0,  80.0, 1280.0, 800.0, true),
    ("oltre il bordo inferiore",  "rect", 100.0,  900.0, 120.0,  80.0, 1280.0, 800.0, true),
    ("tutto a sinistra",          "rect", -300.0, 100.0, 120.0,  80.0, 1280.0, 800.0, true),
    ("a cavallo del bordo sinistro","rect", -60.0, 100.0, 120.0,  80.0, 1280.0, 800.0, false),
    ("area zero sul bordo",       "rect", 0.0,    0.0,    0.0,   0.0, 1280.0, 800.0, false),
    ("area zero fuori",           "rect", -10.0,  0.0,    0.0,   0.0, 1280.0, 800.0, true),
    ("piu grande della pagina",   "rect", -100.0, -100.0, 2000.0, 1200.0, 1280.0, 800.0, false),
    ("pagina fluida",             "rect", 5000.0, 5000.0, 120.0,  80.0,    0.0,   0.0, false),
];

#[cfg(test)]
mod tests {
    use super::*;

    /// La stessa tabella che percorre `it.each` in
    /// `sws-editor/tests/pageLayout.test.ts`. Se qui si aggiunge un caso e là
    /// no, `scripts/check_off_page.sh` lo dice.
    #[test]
    fn tabella_di_verita() {
        for (nome, tipo, x, y, w, h, pw, ph, atteso) in CASI_FUORI_PAGINA {
            let bb = bbox_of(tipo, *x, *y, *w, *h, None, None, &[]);
            let page_w = if *pw > 0.0 { Some(*pw) } else { None };
            let page_h = if *ph > 0.0 { Some(*ph) } else { None };
            assert_eq!(is_off_page(&bb, page_w, page_h), *atteso, "caso «{nome}»");
        }
    }

    #[test]
    fn linee_sui_due_estremi() {
        // Disegnata da destra a sinistra: il box è comunque il min/max.
        let bb = bbox_of("line", 300.0, 200.0, 0.0, 0.0, Some(100.0), Some(50.0), &[]);
        assert_eq!(bb, BBox { x1: 100.0, y1: 50.0, x2: 300.0, y2: 200.0 });
        // Parte dentro e finisce lontano: resta dentro.
        let bb = bbox_of("line", 1200.0, 100.0, 0.0, 0.0, Some(2000.0), Some(100.0), &[]);
        assert!(!is_off_page(&bb, Some(1280.0), Some(800.0)));
        // Interamente oltre il bordo: fuori.
        let bb = bbox_of("line", 1400.0, 100.0, 0.0, 0.0, Some(2000.0), Some(100.0), &[]);
        assert!(is_off_page(&bb, Some(1280.0), Some(800.0)));
    }

    #[test]
    fn pipe_sull_inviluppo_dei_waypoint() {
        let bb = bbox_of("pipe", 0.0, 0.0, 0.0, 0.0, None, None,
                         &[(50.0, 400.0), (50.0, 100.0), (250.0, 100.0)]);
        assert_eq!(bb, BBox { x1: 50.0, y1: 100.0, x2: 250.0, y2: 400.0 });
        // Senza waypoint si ricade su x/y + w/h invece di restituire un box
        // degenere con f64::MAX dentro.
        let bb = bbox_of("pipe", 10.0, 20.0, 30.0, 40.0, None, None, &[]);
        assert_eq!(bb, BBox { x1: 10.0, y1: 20.0, x2: 40.0, y2: 60.0 });
    }

    /// La pagina fluida è la regola unica dei tre punti di T-52: nessun bordo
    /// ⇒ nessun limite, in nessuno dei tre.
    #[test]
    fn pagina_senza_dimensioni_non_ha_un_fuori() {
        let bb = bbox_of("rect", 9000.0, 9000.0, 10.0, 10.0, None, None, &[]);
        assert!(!is_off_page(&bb, None, None));
        assert!(!is_off_page(&bb, Some(1280.0), None));
        assert!(!is_off_page(&bb, None, Some(800.0)));
        assert!(!is_off_page(&bb, Some(0.0), Some(0.0)));
    }
}
