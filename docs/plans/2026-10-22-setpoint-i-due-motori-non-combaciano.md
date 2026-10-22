# Seme — il setpoint: i due motori non mostrano la stessa cosa

**Stato: seme — decisione.** Nato il 22-10-2026 dentro il secondo giro di `font_size`
(`docs/plans/2026-10-19-chiusura-dei-residui.md`, ramo 5).

**Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita, in Plan
mode, per sviscerarne tutti i dettagli.** Quello che segue è il materiale di oggi, non un piano
d'esecuzione: fra la domanda e il lavoro passa troppo tempo perché un progetto scritto adesso
resti vero.

## L'idea

Il setpoint è l'unico tipo rimasto fuori dal secondo giro di `font_size`, e non per dimenticanza.
Il maintainer ha già deciso l'ordine — **«prima si allinea, poi il corpo»** — ma allineare il
setpoint non è una questione di corpi del testo: i due motori mostrano oggetti diversi, con
interazioni diverse, e il corpo è l'ultima delle cose da decidere.

## Cosa c'è oggi, misurato il 22-10-2026

**Sul web** (`sws-editor/src/canvas/SvgCanvas.tsx`, ramo `obj.type === "setpoint"`) il riquadro
contiene **tre righe e due pulsanti**, cinque testi di dimensione diversa:

| cosa | corpo |
|---|---|
| etichetta | 11 |
| riga «Attuale: *valore*» | 10 |
| campo numerico modificabile | 12 |
| pulsante ✓ (conferma) | 12 |
| pulsante ⌨ (tastierino) | 13 |

**Su LVGL** (`sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs`, `render_setpoint`) ce ne
sono **due**: l'etichetta (corpo 11, l'unico numero che i due motori hanno già uguale) e il
valore corrente, che non ha font e quindi eredita i 14 dello schermo. Non c'è una riga
«Attuale:», non c'è un campo modificabile nel riquadro, non c'è il ✓: si tocca il valore e si
apre un **overlay a schermo intero** con area di testo e tastierino.

C'è anche un commento nel codice che è una decisione presa e va rispettata o ribaltata in modo
esplicito: *«infilarne tre in 48 pixel non riesce a nessuno dei due motori, ma due ci stanno, e
il valore è la riga che conta»*.

## Perché non si è fatto adesso

Il resto del secondo giro è stato possibile perché ogni testo del web aveva un gemello su LVGL e
bastava far leggere a tutti e due lo stesso numero. Qui no: alla riga «Attuale:» del web non
corrisponde niente, e al campo modificabile corrisponde un overlay. Dare un `font_size` al
setpoint oggi vorrebbe dire scegliere **a quale dei due disegni** si applica — e quella non è una
scelta sul corpo del testo, è una scelta su cosa vede l'operatore davanti all'impianto.

## Le domande da sciogliere, quando si comincia

1. **Chi si allinea a chi.** La regola WYSIWYG dice che il riferimento è il web; ma il valore
   grande e il tastierino a pieno schermo di LVGL sono fatti per un dito su un vetro da 7", e
   rimpicciolirli per somigliare al browser peggiora il pannello. Potrebbe essere il web a
   doversi muovere.
2. **La riga «Attuale:» su LVGL**, se si decide che ci va: è una stringa di sistema nuova e
   quindi tocca quattro posti e cinque lingue — `sws-core/src/testi_sistema.rs`,
   `sws-editor/src/i18n/testiSistema.ts`, `sws-lvgl-viewer/src/testi_sistema.rs` e
   `tests/fixtures/testi-sistema.json`. Oggi il web la prende da `viewer.currentValue` di
   `it.json`/`en.json`, cioè **due lingue e la lingua dell'IDE**: è lo stesso difetto che la
   tabella dei testi di sistema esiste per chiudere, e vale la pena sistemarlo comunque, anche se
   su LVGL la riga non arrivasse mai.
3. **Cosa succede quando il riquadro è basso.** Tre righe in 48 px non ci stanno: si lascia cadere
   una riga, si stringe, o si dichiara un'altezza minima per il tipo?
4. **Quanti campi, alla fine.** Con cinque testi sul web, «un campo per testo» farebbe cinque
   voci nel pannello. Probabilmente ne bastano due o tre (etichetta, valore, pulsanti), ma lo si
   decide dopo aver deciso il disegno, non prima.

## Cosa è già pronto quando si comincia

- Le funzioni condivise delle misure derivate dal corpo esistono e sono provate su una fixture
  comune: `sws-core/src/geometria_testo.rs` e `sws-editor/src/canvas/geometriaTesto.ts`
  (`passo_riga`, `altezza_etichetta`, `altezza_valore`, `corpo_secondario`).
- Il campo `label_font_size` esiste già, in tutti e quattro i posti che servono (tipo TS, modello
  del viewer, `sws-web/synoptic.rs` e lo schema dell'assistente IA), ed è classificato come
  pixel in `CAMPI_SCALATI`.
- La voce `setpoint` nella tabella dei predefiniti c'è: ha `label`, `decimals` e `step`, e i corpi
  si aggiungono lì con i letterali del disegno che verrà scelto.
