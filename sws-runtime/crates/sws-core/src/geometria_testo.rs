//! Le misure che dipendono dal corpo del testo (21-10-2026, ramo 5 della
//! chiusura dei residui).
//!
//! Scelta del maintainer: «le misure derivano dal corpo». Prima erano
//! letterali — il passo fra le opzioni di un `radio` era 28 px scritto a mano
//! in `SvgCanvas.tsx` e `28.0` in `lvgl_render.rs` — e alzando il corpo le
//! opzioni si sovrapponevano sui due motori senza che niente lo dicesse.
//!
//! **Il vincolo che rende il cambiamento invisibile**: col corpo di oggi
//! queste funzioni devono restituire i numeri di oggi. `passo_riga(13) == 28`
//! e `altezza_etichetta(11) == 20` non sono valori scelti adesso: sono i due
//! letterali che c'erano.
//!
//! Gemella di `sws-editor/src/canvas/geometriaTesto.ts`; i casi condivisi
//! stanno in `tests/fixtures/geometria-testo.json`, che leggono tutti e due.

/// L'altezza di una riga che contiene testo di `corpo` px — il passo fra le
/// opzioni di un `radio`, per esempio. Non scende sotto 28: una riga più
/// stretta non ospita il cerchietto di una scelta, che è alto 16 e ha i suoi
/// margini.
pub fn passo_riga(corpo: f64) -> f64 {
    (corpo * 2.15).round().max(28.0)
}

/// Lo spazio che si prende l'etichetta di un oggetto, dal suo corpo: il testo
/// più il respiro sotto (9 px) prima di ciò che segue.
pub fn altezza_etichetta(corpo: f64) -> f64 {
    corpo.round() + 9.0
}

/// L'altezza di una riga compatta: il valore di uno slider, e la sua etichetta
/// quando le due stanno incolonnate nello stesso riquadro — sul web oggi sono
/// tutte e due 18 px, col valore a 12 e l'etichetta a 11. Non si stringe sotto
/// i 18 di prima: sotto, il numero tocca la traccia.
pub fn altezza_valore(corpo: f64) -> f64 {
    (corpo * 1.5).round().max(18.0)
}

/// Il corpo del testo **secondario** di un grafico — i numeri delle tacche, la
/// legenda — quando il corpo principale e' `corpo`. Un punto meno, e mai sotto
/// i 6: sotto non ci sono font.
///
/// Esiste perche' un grafico ha un campo solo (scelta del maintainer del
/// 21-10-2026: «si unifica tutto su `font_size`»), ma due misure dentro: col
/// 10 di oggi restituisce i 9 di oggi.
pub fn corpo_secondario(corpo: f64) -> f64 {
    (corpo - 1.0).max(6.0)
}

#[cfg(test)]
mod prove {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Caso {
        corpo: f64,
        atteso: f64,
    }

    #[derive(Deserialize)]
    struct Fixture {
        passo_riga: Vec<Caso>,
        altezza_etichetta: Vec<Caso>,
        corpo_secondario: Vec<Caso>,
        altezza_valore: Vec<Caso>,
    }

    /// La stessa fixture che legge `geometriaTesto.test.ts`: se le due
    /// implementazioni divergono, i due motori disegnano lo stesso oggetto con
    /// altezze diverse.
    #[test]
    fn le_misure_sono_quelle_del_web() {
        let f: Fixture =
            serde_json::from_str(include_str!("../../../../tests/fixtures/geometria-testo.json"))
                .expect("fixture leggibile");
        for c in &f.passo_riga {
            assert_eq!(passo_riga(c.corpo), c.atteso, "passo_riga({})", c.corpo);
        }
        for c in &f.altezza_etichetta {
            assert_eq!(altezza_etichetta(c.corpo), c.atteso, "altezza_etichetta({})", c.corpo);
        }
        for c in &f.altezza_valore {
            assert_eq!(altezza_valore(c.corpo), c.atteso, "altezza_valore({})", c.corpo);
        }
        for c in &f.corpo_secondario {
            assert_eq!(corpo_secondario(c.corpo), c.atteso, "corpo_secondario({})", c.corpo);
        }
    }

    /// Il vincolo dichiarato: col corpo di prima, i numeri di prima.
    #[test]
    fn col_corpo_di_oggi_niente_si_muove() {
        assert_eq!(passo_riga(13.0), 28.0, "il passo fra le opzioni di un radio");
        assert_eq!(altezza_etichetta(11.0), 20.0, "lo spazio dell'etichetta");
        assert_eq!(altezza_valore(12.0), 18.0, "la riga del valore di uno slider");
        assert_eq!(corpo_secondario(10.0), 9.0, "le tacche di un grafico a barre");
    }
}
