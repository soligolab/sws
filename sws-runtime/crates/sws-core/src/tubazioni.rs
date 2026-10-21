//! Le tubazioni: dove si aggancia un capo, e che strada fa (15-10-2026, piano
//! `docs/archive/2026-10-15-tubazioni-bocche-e-stili.md`, ramo A).
//!
//! Gemello: `sws-editor/src/canvas/tubazioni.ts`. I casi stanno in
//! `tests/fixtures/tubazioni.json` e li verificano tutti e due: è la prova che il
//! browser e il pannello mettono il tubo nello stesso punto.
//!
//! Prima di questo modulo un capo agganciato andava al centro di un lato del
//! **riquadro** dell'oggetto, senza rotazione né specchiatura, e `orthogonal` e
//! `diagonal` si disegnavano come una spezzata dritta fra i punti dell'utente.

use crate::simboli_lib::PortaLib;

/// Un punto della pagina.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Punto {
    pub x: f64,
    pub y: f64,
}

/// Il riquadro di un oggetto con le sue trasformazioni, come le applica
/// `applyTransform` sul web: prima la specchiatura attorno al centro, poi la
/// rotazione (gradi, verso orario sullo schermo) attorno al centro.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Riquadro {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rotazione: f64,
    pub flip_h: bool,
    pub flip_v: bool,
}

/// Dove sta un capo agganciato, e verso dove esce il tubo (`dx, dy` unitario;
/// `0, 0` per il centro, che non ha una direzione).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Aggancio {
    pub x: f64,
    pub y: f64,
    pub dx: f64,
    pub dy: f64,
}

fn direzione(lato: &str) -> (f64, f64) {
    match lato {
        "left" => (-1.0, 0.0),
        "right" => (1.0, 0.0),
        "top" => (0.0, -1.0),
        "bottom" => (0.0, 1.0),
        _ => (0.0, 0.0),
    }
}

/// Le cifre oltre il centesimo sono rumore della trigonometria: arrotondare tiene
/// identici i risultati dei due motori e le fixture leggibili.
fn tondo(v: f64) -> f64 {
    let r = (v * 100.0).round() / 100.0;
    if r == 0.0 { 0.0 } else { r }
}

/// Applica specchiatura e rotazione del riquadro a un punto e alla sua direzione.
fn trasforma(r: &Riquadro, x: f64, y: f64, dx: f64, dy: f64) -> Aggancio {
    let (cx, cy) = (r.x + r.w / 2.0, r.y + r.h / 2.0);
    let (mut x, mut y, mut dx, mut dy) = (x, y, dx, dy);
    if r.flip_h {
        x = 2.0 * cx - x;
        dx = -dx;
    }
    if r.flip_v {
        y = 2.0 * cy - y;
        dy = -dy;
    }
    let (s, c) = r.rotazione.to_radians().sin_cos();
    let (rx, ry) = (x - cx, y - cy);
    Aggancio {
        x: tondo(cx + rx * c - ry * s),
        y: tondo(cy + rx * s + ry * c),
        dx: tondo(dx * c - dy * s),
        dy: tondo(dx * s + dy * c),
    }
}

/// Una bocca del simbolo sulla pagina. Il disegno sta nel riquadro con
/// `preserveAspectRatio="xMidYMid meet"`: scala uniforme, centrato.
pub fn aggancio_bocca(view_box: [f64; 2], porta: &PortaLib, r: &Riquadro) -> Aggancio {
    let [vw, vh] = view_box;
    let s = (r.w / vw).min(r.h / vh);
    let ox = r.x + (r.w - vw * s) / 2.0;
    let oy = r.y + (r.h - vh * s) / 2.0;
    let (dx, dy) = direzione(&porta.side);
    trasforma(r, ox + porta.x * s, oy + porta.y * s, dx, dy)
}

/// Il diametro della bocca sulla pagina: quello del disegno, scalato col simbolo.
pub fn diametro_bocca(view_box: [f64; 2], porta: &PortaLib, r: &Riquadro) -> f64 {
    tondo(porta.d * (r.w / view_box[0]).min(r.h / view_box[1]))
}

/// Uno dei cinque punti del riquadro (`top`, `bottom`, `left`, `right`,
/// `center`; un nome sconosciuto vale `center`). `trasformato` dice se seguire
/// rotazione e specchiatura: sì per i simboli, no per gli altri tipi, che sul
/// web non passano tutti da `applyTransform` — cambiarli adesso sposterebbe i
/// tubi dei progetti esistenti senza una ragione.
pub fn aggancio_riquadro(lato: &str, r: &Riquadro, trasformato: bool) -> Aggancio {
    let (x, y) = match lato {
        "top" => (r.x + r.w / 2.0, r.y),
        "bottom" => (r.x + r.w / 2.0, r.y + r.h),
        "left" => (r.x, r.y + r.h / 2.0),
        "right" => (r.x + r.w, r.y + r.h / 2.0),
        _ => (r.x + r.w / 2.0, r.y + r.h / 2.0),
    };
    let (dx, dy) = direzione(lato);
    if trasformato {
        trasforma(r, x, y, dx, dy)
    } else {
        Aggancio { x: tondo(x), y: tondo(y), dx, dy }
    }
}

/// Quanto il tubo esce dritto da una bocca prima di girare: abbastanza da far
/// vedere la flangia, poco abbastanza da non uscire dallo schermo.
pub const TRATTO_DI_USCITA: f64 = 16.0;

/// Un capo del percorso: il punto, e la direzione d'uscita se è una bocca o un lato.
///
/// `dritto` vale solo sul capo d'**arrivo**: l'ultimo tratto ci va dritto
/// invece che a gomito. Vedi [`Tappa`].
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Capo {
    pub punto: Punto,
    pub dir: Option<(f64, f64)>,
    pub dritto: bool,
}

/// Una tappa del percorso: un punto, e se il tratto che ci **arriva** va dritto.
///
/// Il flag sta sulla tappa d'arrivo e non sul tratto perché è così che lo posa
/// chi disegna: tenendo Shift mentre mette il punto, cioè dicendo «il pezzo che
/// ho appena tirato è dritto» (20-10-2026). Sul primo punto non ha senso — lì
/// non arriva niente — e viene ignorato.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Tappa {
    pub punto: Punto,
    pub dritto: bool,
}

impl From<Punto> for Tappa {
    fn from(punto: Punto) -> Self {
        Tappa { punto, dritto: false }
    }
}

impl From<Aggancio> for Capo {
    fn from(a: Aggancio) -> Self {
        Capo {
            punto: Punto { x: a.x, y: a.y },
            dir: (a.dx != 0.0 || a.dy != 0.0).then_some((a.dx, a.dy)),
            dritto: false,
        }
    }
}

/// Il percorso a 90° (`orthogonal`) o a 45° (`diagonal`) fra due capi,
/// passando per i punti intermedi dell'utente. Ai capi con una direzione il
/// tubo esce ed entra dritto per `TRATTO_DI_USCITA`. Fra un punto e il
/// successivo: dritto se allineati, altrimenti un gomito — e il gomito
/// prosegue nella direzione in cui si stava andando, se non torna indietro.
pub fn instrada(da: Capo, a: Capo, intermedi: &[Tappa], diagonale: bool) -> Vec<Punto> {
    let fuori = |c: &Capo| match c.dir {
        Some((dx, dy)) => Punto { x: c.punto.x + dx * TRATTO_DI_USCITA, y: c.punto.y + dy * TRATTO_DI_USCITA },
        None => c.punto,
    };
    let mut tappe = vec![Tappa { punto: fuori(&da), dritto: false }];
    tappe.extend_from_slice(intermedi);
    tappe.push(Tappa { punto: fuori(&a), dritto: a.dritto });

    let mut out = vec![da.punto];
    if da.dir.is_some() {
        out.push(tappe[0].punto);
    }
    // La direzione in cui si sta andando: (asse orizzontale?, verso).
    let mut andatura: Option<(bool, f64)> = da.dir.map(|(dx, dy)| if dx != 0.0 { (true, dx.signum()) } else { (false, dy.signum()) });
    for (i, w) in tappe.windows(2).enumerate() {
        let (p, q) = (w[0].punto, w[1].punto);
        let (ddx, ddy) = (q.x - p.x, q.y - p.y);
        // Tratto dritto chiesto da chi ha disegnato: nessun gomito, e l'andatura
        // riparte da zero — una diagonale non ha un verso d'asse da ereditare.
        if w[1].dritto && (ddx != 0.0 || ddy != 0.0) {
            out.push(q);
            andatura = None;
            continue;
        }
        if ddx == 0.0 || ddy == 0.0 {
            out.push(q);
            andatura = Some(if ddx != 0.0 { (true, ddx.signum()) } else { (false, ddy.signum()) });
            continue;
        }
        if diagonale {
            // 45° per il tratto comune, poi dritto per il resto.
            let m = ddx.abs().min(ddy.abs());
            let gomito = Punto { x: p.x + m * ddx.signum(), y: p.y + m * ddy.signum() };
            out.push(gomito);
            out.push(q);
            andatura = Some(if ddx.abs() > ddy.abs() { (true, ddx.signum()) } else { (false, ddy.signum()) });
            continue;
        }
        // Prosegui sull'asse corrente se il verso è quello giusto; altrimenti gira subito.
        let mut prima_orizzontale = match andatura {
            Some((true, verso)) => verso * ddx > 0.0,
            Some((false, verso)) => verso * ddy <= 0.0,
            None => ddx.abs() >= ddy.abs(),
        };
        // Nell'ultimo tratto non si arriva muovendosi nel verso d'uscita della
        // bocca d'arrivo: sarebbe un'inversione a U che attraversa l'oggetto
        // (il tubo che sale dentro un serbatoio per entrare dalla bocca in alto).
        if let (true, Some((adx, ady))) = (i + 2 == tappe.len(), a.dir) {
            let arrivo = if prima_orizzontale { (0.0, ddy.signum()) } else { (ddx.signum(), 0.0) };
            if arrivo == (adx, ady) {
                prima_orizzontale = !prima_orizzontale;
            }
        }
        let gomito = if prima_orizzontale { Punto { x: q.x, y: p.y } } else { Punto { x: p.x, y: q.y } };
        out.push(gomito);
        out.push(q);
        andatura = Some(if prima_orizzontale { (false, ddy.signum()) } else { (true, ddx.signum()) });
    }
    if a.dir.is_some() {
        out.push(a.punto);
    }
    pulisci(out)
}

/// Toglie i doppioni e i punti in mezzo a un tratto dritto.
fn pulisci(punti: Vec<Punto>) -> Vec<Punto> {
    let mut out: Vec<Punto> = Vec::with_capacity(punti.len());
    for p in punti {
        let p = Punto { x: tondo(p.x), y: tondo(p.y) };
        if out.last() == Some(&p) {
            continue;
        }
        if out.len() >= 2 {
            let (a, b) = (out[out.len() - 2], out[out.len() - 1]);
            let allineati = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x) == 0.0;
            let stesso_verso = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) > 0.0;
            if allineati && stesso_verso {
                out.pop();
            }
        }
        out.push(p);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Fixture {
        bocche: Vec<CasoBocca>,
        riquadro: Vec<CasoRiquadro>,
        percorsi: Vec<CasoPercorso>,
    }
    #[derive(Deserialize)]
    struct Rq {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        #[serde(default)]
        rotation: f64,
        #[serde(default)]
        flip_h: bool,
        #[serde(default)]
        flip_v: bool,
    }
    impl Rq {
        fn r(&self) -> Riquadro {
            Riquadro { x: self.x, y: self.y, w: self.w, h: self.h, rotazione: self.rotation, flip_h: self.flip_h, flip_v: self.flip_v }
        }
    }
    #[derive(Deserialize)]
    struct CasoBocca {
        nome: String,
        #[serde(rename = "viewBox")]
        view_box: [f64; 2],
        porta: PortaLib,
        oggetto: Rq,
        atteso: [f64; 4],
        diametro: f64,
    }
    #[derive(Deserialize)]
    struct CasoRiquadro {
        nome: String,
        lato: String,
        oggetto: Rq,
        trasformato: bool,
        atteso: [f64; 4],
    }
    #[derive(Deserialize)]
    struct C {
        x: f64,
        y: f64,
        #[serde(default)]
        dir: Option<[f64; 2]>,
        #[serde(default)]
        dritto: bool,
    }
    /// Una tappa nella fixture: `[x, y]` come sempre, oppure `{x, y, dritto}`
    /// per i casi nuovi. Le due forme convivono così i sette casi scritti prima
    /// del 20-10-2026 restano scritti com'erano.
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum TappaFix {
        Coppia([f64; 2]),
        Con { x: f64, y: f64, #[serde(default)] dritto: bool },
    }
    impl From<&TappaFix> for Tappa {
        fn from(t: &TappaFix) -> Self {
            match *t {
                TappaFix::Coppia([x, y]) => Tappa { punto: Punto { x, y }, dritto: false },
                TappaFix::Con { x, y, dritto } => Tappa { punto: Punto { x, y }, dritto },
            }
        }
    }
    #[derive(Deserialize)]
    struct CasoPercorso {
        nome: String,
        da: C,
        a: C,
        #[serde(default)]
        intermedi: Vec<TappaFix>,
        #[serde(default)]
        diagonale: bool,
        atteso: Vec<[f64; 2]>,
    }
    fn capo(c: &C) -> Capo {
        Capo { punto: Punto { x: c.x, y: c.y }, dir: c.dir.map(|[a, b]| (a, b)), dritto: c.dritto }
    }

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!("../../../../tests/fixtures/tubazioni.json")).unwrap()
    }

    #[test]
    fn le_bocche_come_nella_fixture() {
        for c in fixture().bocche {
            let a = aggancio_bocca(c.view_box, &c.porta, &c.oggetto.r());
            assert_eq!([a.x, a.y, a.dx, a.dy], c.atteso, "{}", c.nome);
            assert_eq!(diametro_bocca(c.view_box, &c.porta, &c.oggetto.r()), c.diametro, "{}", c.nome);
        }
    }

    #[test]
    fn i_lati_del_riquadro_come_nella_fixture() {
        for c in fixture().riquadro {
            let a = aggancio_riquadro(&c.lato, &c.oggetto.r(), c.trasformato);
            assert_eq!([a.x, a.y, a.dx, a.dy], c.atteso, "{}", c.nome);
        }
    }

    #[test]
    fn i_percorsi_come_nella_fixture() {
        for c in fixture().percorsi {
            let inter: Vec<Tappa> = c.intermedi.iter().map(Tappa::from).collect();
            let p: Vec<[f64; 2]> = instrada(capo(&c.da), capo(&c.a), &inter, c.diagonale).iter().map(|p| [p.x, p.y]).collect();
            assert_eq!(p, c.atteso, "{}", c.nome);
        }
    }

    #[test]
    fn un_percorso_ortogonale_ha_solo_tratti_a_90_gradi() {
        let da = Capo { punto: Punto { x: 50.0, y: 100.0 }, dir: Some((0.0, -1.0)), dritto: false };
        let a = Capo { punto: Punto { x: 300.0, y: 40.0 }, dir: Some((-1.0, 0.0)), dritto: false };
        let p = instrada(da, a, &[], false);
        for w in p.windows(2) {
            assert!(w[0].x == w[1].x || w[0].y == w[1].y, "{p:?}");
        }
        assert_eq!(p.first(), Some(&da.punto));
        assert_eq!(p.last(), Some(&a.punto));
    }
}
