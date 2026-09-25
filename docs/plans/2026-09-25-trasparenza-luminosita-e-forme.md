# Trasparenza, luminosità e forme nuove — seme

> Nato il 25-09-2026 da un tentativo vero del maintainer: «volevo agganciare un tag con una
> waveform a un campo per modificare la trasparenza o la luminosità di un oggetto, ma mi sono reso
> conto che non esistono queste proprietà. L'idea è mostrare led, grafica e testi con un effetto
> lampeggio *fade*. Rivediamo tutti gli oggetti grafici per aggiungere le proprietà di trasparenza
> e luminosità. Aggiungere poi in *shapes* anche l'oggetto polilinea e un generatore di forme tipo
> esagono, dodecagono ecc.»
>
> **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita, in plan
> mode e senza scrivere codice, per sviscerarne ogni dettaglio.** Tocca il modello degli oggetti,
> due motori di rendering e il pannello proprietà: un disegno abbozzato adesso mentirebbe.

## Le due cose, che sono separate

### 1. Trasparenza e luminosità, legabili a un tag

Oggi il lampeggio esiste (`blink_mode`: sempre / su tag / su allarme) ma è **acceso/spento**: non
c'è un valore continuo da pilotare. Un tag che oscilla — una waveform — non ha un campo a cui
attaccarsi, e l'effetto *fade* non si può fare.

Da decidere quando si comincia:

- **Quali proprietà**: un `opacity` 0-1 basta per la trasparenza; la «luminosità» può essere un
  filtro (`brightness()`) o una modulazione del colore. Sono due cose diverse e vanno separate:
  su un LED la luminosità è il colore che cambia, su un'immagine è un filtro.
- **Come si lega a un tag**: il pannello ha già il binding per campo, ma un valore continuo che
  cambia a ogni frame non è lo stesso di una proprietà che cambia raramente. Va guardato cosa
  costa in ridisegni, sul web e soprattutto **su LVGL**, dove non c'è CSS.
- **La parità LVGL**: `lv_obj_set_style_opa` esiste, i filtri di luminosità no. Se un effetto si
  può fare solo sul web, va detto nel pannello — è la stessa regola dei tipi non supportati.
- **Quanti oggetti**: «tutti gli oggetti grafici» sono i 36 tipi della palette. Se le due proprietà
  stanno nel blocco comune, la tabella dei campi cresce di 2×36; se stanno solo dove hanno senso,
  serve dire dove.

### 2. Forme nuove in «Shapes»

- **Polilinea**: oggi c'è `line`, che ha due estremi. Una polilinea vuole un elenco di punti nel
  modello, un modo di inserirli sul canvas (clic multipli, doppio clic per chiudere) e un
  rendering su entrambi i motori.
- **Generatore di poligoni**: esagono, dodecagono, stella… Un tipo solo con «numero di lati» più
  eventuale rotazione, invece di un tipo per forma. Su LVGL i poligoni non sono primitivi: o si
  disegnano per punti, o si rasterizzano come già si fa per gli SVG dei simboli.

## Perché non è un lavoro piccolo

Ogni campo nuovo tocca: il modello TS e la sua copia Rust, il canvas SVG, il renderer LVGL,
il pannello proprietà, l'inventario dei campi (`campiPannelloProprieta.json`) e lo schema che
l'IA legge. La guardia dell'inventario è quella che garantisce che le due metà restino allineate,
ed è anche quella che dirà quanto il lavoro è grande davvero.
