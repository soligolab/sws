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

/// Il corpo di un testo che **accompagna** un valore, due punti sotto: la riga
/// «Attuale: 20.0» di un setpoint (22-10-2026).
///
/// Due e non uno — che è `corpo_secondario` — perché i due letterali del web
/// sono 12 per il valore e **10** per questa riga: col corpo di oggi devono
/// uscire tutti e due i numeri di oggi, e un punto solo ne darebbe 11.
pub fn corpo_annotazione(corpo: f64) -> f64 {
    (corpo - 2.0).max(6.0)
}

/// L'altezza di una riga di testo: il corpo per l'interlinea normale di un
/// browser (1,2).
fn riga(corpo: f64) -> f64 {
    (corpo * 1.2).round()
}

/// L'altezza **minima** di un setpoint, dai suoi tre corpi (22-10-2026).
///
/// Il setpoint mostra tre righe — etichetta, «Attuale: …», e il campo col
/// valore e i due pulsanti — e il predefinito di oggi è 56 px, in cui non ci
/// stanno. Scelta del maintainer: **il riquadro si allarga**, invece di far
/// cadere una riga o di stringere il testo (che contraddirebbe il lavoro
/// appena fatto, dove il corpo è diventato una scelta esplicita).
///
/// Vale in **tutti e due i motori**, da qui: se valesse solo sul pannello,
/// l'editor smetterebbe di dire la verità sull'ingombro e l'oggetto
/// sposterebbe le cose intorno solo sul vetro, dove ci si accorge tardi.
///
/// Gli 8 sono il padding sopra e sotto, i 3 i due stacchi fra le righe, gli
/// altri 8 il bordo e il padding del campo — i numeri del `<div>` del web.
pub fn altezza_minima_setpoint(
    corpo_etichetta: f64,
    corpo: f64,
    corpo_pulsanti: f64,
    con_etichetta: bool,
) -> f64 {
    let testata = if con_etichetta { riga(corpo_etichetta) + 3.0 } else { 0.0 };
    let attuale = riga(corpo_annotazione(corpo)) + 3.0;
    let campo = riga(corpo.max(corpo_pulsanti)) + 8.0;
    8.0 + testata + attuale + campo
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
        corpo_annotazione: Vec<Caso>,
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
        for c in &f.corpo_annotazione {
            assert_eq!(corpo_annotazione(c.corpo), c.atteso, "corpo_annotazione({})", c.corpo);
        }
    }

    /// Il vincolo dichiarato: col corpo di prima, i numeri di prima.
    #[test]
    fn col_corpo_di_oggi_niente_si_muove() {
        assert_eq!(passo_riga(13.0), 28.0, "il passo fra le opzioni di un radio");
        assert_eq!(altezza_etichetta(11.0), 20.0, "lo spazio dell'etichetta");
        assert_eq!(altezza_valore(12.0), 18.0, "la riga del valore di uno slider");
        assert_eq!(corpo_secondario(10.0), 9.0, "le tacche di un grafico a barre");
        assert_eq!(corpo_annotazione(12.0), 10.0, "la riga «Attuale:» di un setpoint");
        // Il setpoint predefinito (etichetta 11, testo 12, pulsanti 12) chiede
        // 61 px e oggi ne ha 56: e' l'allargamento che il maintainer ha scelto
        // sapendo che succede. Misurati il 22-10-2026: i sette setpoint che
        // esistono fra template e progetti veri stanno tutti a 48 e crescono
        // tutti di 13.
        assert_eq!(altezza_minima_setpoint(11.0, 12.0, 12.0, true), 61.0);
        assert_eq!(altezza_minima_setpoint(11.0, 12.0, 12.0, false), 45.0, "senza etichetta");
    }
}
