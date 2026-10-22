/** Le misure che dipendono dal corpo del testo (21-10-2026, ramo 5 della
 *  chiusura dei residui).
 *
 *  Scelta del maintainer: «le misure derivano dal corpo». Prima erano
 *  letterali — il passo fra le opzioni di un `radio` era 28 px qui e `28.0` in
 *  `lvgl_render.rs` — e alzando il corpo le opzioni si sovrapponevano sui due
 *  motori senza che niente lo dicesse.
 *
 *  **Il vincolo che rende il cambiamento invisibile**: col corpo di oggi queste
 *  funzioni restituiscono i numeri di oggi. `passoRiga(13) === 28` e
 *  `altezzaEtichetta(11) === 20` non sono valori scelti adesso: sono i due
 *  letterali che c'erano.
 *
 *  Gemella di `sws-core/src/geometria_testo.rs`; i casi condivisi stanno in
 *  `tests/fixtures/geometria-testo.json`, che leggono tutti e due.
 */

/** L'altezza di una riga che contiene testo di `corpo` px — il passo fra le
 *  opzioni di un `radio`, per esempio. Non scende sotto 28: una riga più
 *  stretta non ospita il cerchietto di una scelta, alto 16 coi suoi margini. */
export function passoRiga(corpo: number): number {
  return Math.max(28, Math.round(corpo * 2.15));
}

/** Lo spazio che si prende l'etichetta di un oggetto: il testo più il respiro
 *  sotto (9 px) prima di ciò che segue. */
export function altezzaEtichetta(corpo: number): number {
  return Math.round(corpo) + 9;
}

/** L'altezza di una riga compatta: il valore di uno slider, e la sua etichetta
 *  quando le due stanno incolonnate nello stesso riquadro — sul web oggi sono
 *  tutte e due 18 px, col valore a 12 e l'etichetta a 11. Non si stringe sotto
 *  i 18 di prima: sotto, il numero tocca la traccia. */
export function altezzaValore(corpo: number): number {
  return Math.max(18, Math.round(corpo * 1.5));
}

/** Il corpo del testo **secondario** di un grafico — i numeri delle tacche, la
 *  legenda — quando il corpo principale e' `corpo`. Un punto meno, e mai sotto
 *  i 6: sotto non ci sono font.
 *
 *  Esiste perche' un grafico ha un campo solo (scelta del maintainer del
 *  21-10-2026: «si unifica tutto su `font_size`»), ma due misure dentro: col
 *  10 di oggi restituisce i 9 di oggi. */
export function corpoSecondario(corpo: number): number {
  return Math.max(6, corpo - 1);
}
