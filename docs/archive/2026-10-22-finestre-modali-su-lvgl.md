# Le finestre modali sul pannello LVGL

**Stato: piano d'esecuzione, decisioni prese.** Nato il 22-10-2026 da un difetto trovato dal
maintainer sul WP630 provando «CasaDomotica (WP630_LVGL)»: il bottone «Chiudi finestra» (caso
`button-b_48`) non fa niente.

## Non è il bottone: la finestra non esiste

`close_popup` **non compare da nessuna parte** nel crate `sws-lvgl-viewer`. L'unica occorrenza in
Rust è una fixture di prova in `sws-web/src/validate.rs:2615`. Il bottone si disegna, si clicca, e
nessuno lo ascolta.

Il perché sta nel ripiego dell'altra metà. Su LVGL le finestre non ci sono mai state, e
`open_popup` è tradotto in **naviga alla pagina a schermo pieno, senza parametri** —
`pagina_della_finestra`, `lvgl_render.rs:3529`, ripiego scelto dal maintainer il 17-10-2026 quando
le finestre sono nate sul web (piano in `docs/archive/2026-10-17-finestre-popup.md`). Se aprire è
navigare, chiudere dovrebbe essere tornare; e il ritorno non c'è, perché la navigazione del viewer
è un `nav_tx: Sender<String>` che porta un id di pagina e basta (`main.rs:1437`), senza storia.

**Terzo pezzo mancante, dalla stessa radice**: anche `open_faceplate` non è gestito. Un bottone
«Apri faceplate» sul pannello non fa niente.

## Cos'è una finestra sul web, misurato il 22-10-2026

`sws-editor/src/runtime-view/PaginaFinestra.tsx`:

| pezzo | com'è |
|---|---|
| contenitore | `position: fixed`, centrato, largo quanto la pagina, `zIndex: 9400` |
| barra del titolo | titolo (`titoloFinestra`, coi parametri) e un **✕** a destra |
| sfondo | se modale: un velo `rgba(0,0,0,0.6)` a `zIndex: 9300` |
| modi di chiudere | il ✕; `Escape`; il clic sul velo (solo modale); un bottone `close_popup` dentro la pagina |
| non modale | niente velo, la pagina sotto resta usabile, e la finestra **si trascina** per la barra |
| parametri | `oggettiFinestra(pagina, params)` sostituisce `{nome}` in tutti i campi |
| navigare da dentro | chiude la finestra e va alla pagina |
| quante alla volta | **una**: una seconda apertura sostituisce la prima |

Una cosa che invece **funziona già** anche sul pannello: le pagine-finestra sono escluse dai
navigatori, perché le filtra il server in `GET /api/pages/nav` (`router.rs:6767`). Non c'è niente
da fare da quel lato.

## Le decisioni del maintainer (22-10-2026)

1. **Finestra vera modale.** Contenitore sul layer superiore, velo scuro dietro, barra del titolo,
   e la pagina sotto **resta viva** e ricompare chiudendo. È la parità col web, ed è la più cara
   delle tre strade proposte: le altre due erano «schermo pieno con barra e ✕» e «naviga e torna».
2. **Si chiude in due modi**: il bottone `close_popup` che chi disegna il sinottico mette nella
   pagina, e un **✕ nella barra del titolo** disegnato dal motore — perché senza, una finestra di
   cui l'autore ha dimenticato il bottone resta prigioniera sullo schermo. **Il tocco fuori dalla
   finestra NON chiude**, scelta esplicita: su un touch si chiuderebbe per sbaglio con un dito
   appoggiato male, e su un impianto è un fastidio vero.
3. **I parametri si sostituiscono**, come sul web. Senza, il gesto «tocco sulla pompa → finestra di
   *quella* pompa» non funziona e la funzione resta mezza rotta.
4. **`open_faceplate` entra nello stesso giro.** È lo stesso meccanismo — un contenitore modale con
   dentro oggetti e parametri — e il faceplate su LVGL esiste già come oggetto in pagina, coi suoi
   parametri: manca solo l'aprirlo come finestra. Farlo dopo vorrebbe dire rileggere lo stesso
   codice una seconda volta.

5. **Una pagina dichiarata `modale: false` si apre modale lo stesso.** La variante non modale del
   web esiste per lavorare *con* la finestra aperta, usando il mouse sulla pagina sotto; su un
   vetro da 7" la finestra copre quasi tutto e la pagina sotto non la raggiungi comunque. Le due
   alternative erano «niente velo ma pagina inerte» — che fa sembrare toccabile ciò che non lo è —
   e «niente velo e pagina viva», che su un touch vuol dire far partire una pompa con un dito
   appoggiato fuori dalla finestra. **Conseguenza da scrivere nel manuale**: `modale: false` è una
   proprietà che il pannello ignora, ed è l'unica di questo giro.
6. **Una finestra più grande dello schermo si taglia**, non si rimpicciolisce. Succede davvero —
   una pagina disegnata 1280×800 su un vetro 800×480 — e rimpicciolire contraddirebbe il lavoro
   appena finito, dove il corpo del testo è diventato una scelta esplicita: scalarla gliela
   toglierebbe di mano. È anche l'unica delle tre che LVGL fa da sé, perché non sa scalare un
   albero di widget. Il difetto resta visibile a chi disegna invece di nascondersi in una
   riduzione.

**La non modale trascinabile del web non si fa**: non è stata chiesta, e trascinare una finestra
con un dito su un vetro da 7" non è il gesto per cui quella variante esiste. Se servirà, è un
seme a parte.

## Il lavoro

### 1. Il modello della pagina, lato viewer

`sws-lvgl-viewer/src/model.rs` non conosce `finestra` né `finestra_parametri`: la struttura della
pagina li butta via leggendo il JSON. Vanno aggiunti, con `serde(default)`.

**La trappola del `serde(default)` è documentata e vale anche qui**: un campo nuovo senza default
rende illeggibile l'INTERO documento a un binario più vecchio. Qui il documento è la pagina, e
una pagina illeggibile è uno schermo nero.

### 2. La sostituzione dei parametri, estratta

Esiste già, ma è una **chiusura dentro `render_faceplate`** (`lvgl_render.rs:11033`), applicata a
mano campo per campo. Va estratta in una funzione sola, usata da tutti e tre i casi (faceplate in
pagina, faceplate come finestra, pagina-finestra). Porta `s.replace(/\{(\w+)\}/g, …)` del web: un
segnaposto senza valore resta testuale, e quel comportamento non si cambia.

Serve anche l'equivalente di `parametriFinestra`: i valori passati dal bottone **più i default
dichiarati nella pagina** (`finestra_parametri`), nello stesso ordine di precedenza del web.

### 3. Disegnare dentro un contenitore invece che dentro lo schermo

`render_page_objects` (`lvgl_render.rs:11182`) fa tre cose insieme: ridimensiona il display, crea
uno schermo nuovo, e cicla sugli oggetti. Per la finestra serve **solo la terza**, con un genitore
diverso.

Va estratto il ciclo (`for obj in sort_by_z(&page.objects)`, da `:11312`) in una funzione che
prende il genitore. Le coordinate degli oggetti sono relative all'origine della pagina, e in LVGL
le coordinate di un figlio sono relative al genitore: mettendo il contenitore alla misura della
pagina-finestra, gli oggetti cadono al posto giusto senza traslazioni.

**Due controlli nel ciclo sono per-pagina e vanno guardati**: `obj.is_off_page(page)` e
`resolve_resolution(page)`. Per la finestra «la pagina» è la pagina-finestra, non quella sotto.

### 4. Il contenitore, il velo e la barra

Sul layer superiore (`lv_layer_top()`), come fa già la finestra di conferma, che non a caso passa
`NULL` come genitore a `lv_msgbox_create` col commento «sul livello superiore: modale, copre la
pagina» (`lvgl_render.rs:811`).

- **velo**: un oggetto a tutto schermo, nero a ~60 % di opacità, **cliccabile** — assorbe i tocchi
  diretti alla pagina sotto, che è ciò che «modale» vuol dire. Non ha callback: toccarlo non
  chiude (decisione 2). C'è **sempre**, anche per una pagina `modale: false` (decisione 5).
- **contenitore**: centrato, largo e alto quanto la pagina-finestra **più la barra**, e
  **tagliato** alla misura del display quando la pagina è più grande (decisione 6): LVGL ritaglia
  da sé i figli che escono dal genitore, quindi non serve altro che non dargli una misura più
  grande dello schermo.
- **barra**: titolo da `finestra.titolo` coi parametri sostituiti, altrimenti il nome della pagina
  (`titoloFinestra` del web); ✕ a destra, che manda la chiusura.

### 5. Aprire e chiudere: un canale, non una chiamata

Le callback dei widget LVGL non possono fare I/O di rete né toccare lo stato del ciclo: è la
regola per cui esistono `tag_tx`, `nav_tx` e `ack_tx`, e c'è un **blocco permanente documentato**
a `lvgl_render.rs:7207-7224` sul non trasformare un `block_on` in `spawn` dentro una callback.

Quindi un canale nuovo, `finestra_tx`, con un messaggio a due facce: apri (id pagina o id
faceplate, più i parametri) e chiudi. Il ciclo principale lo legge come già legge `nav_rx`
(`main.rs:1437`), **al più uno per frame**.

### 6. I collegamenti vivi della finestra

`update_bindings(live_bindings, …)` gira una volta per frame su una fetta sola (`main.rs:861`).
La finestra ha i suoi, e devono: aggiornarsi mentre è aperta, e **morire con lei**. Un secondo
`Vec<LiveBinding>` accanto al primo, aggiornato quando c'è e svuotato alla chiusura.

**La trappola, e la scelta fatta**: i contesti delle callback sono *leakati* apposta
(`leak_ctx`), perché LVGL li rilegge a ogni evento. Aprire e chiudere una finestra cento volte non
deve lasciare cento contesti in memoria su un pannello che ne ha poca, quindi **si liberano**, con
un ordine che non è negoziabile: **prima si distruggono i widget, poi si liberano i contesti**.
Al contrario sarebbe una lettura di memoria già liberata al primo evento in coda — un guasto che
si manifesta a caso e altrove, esattamente come dice il commento di `lvgl_font::load` sul
puntatore del font. E va **misurato**, non supposto: cento aperture e chiusure, e si guarda la
memoria del processo.

### 7. Le tre azioni, finalmente collegate

- `open_popup` → apri la finestra (e **non** naviga più: `pagina_della_finestra` sparisce, col suo
  test a `lvgl_render.rs:12918`);
- `open_faceplate` → stessa finestra, col faceplate dentro (`fetch_faceplate` esiste già);
- `close_popup` → chiudi.

E i due comportamenti di contorno del web: una seconda apertura **sostituisce** la prima, e
navigare da dentro la finestra la chiude.

## Verifica

- `cargo check`, `pnpm build`, `check_static.sh`, `cargo test`, `pnpm exec vitest run`.
- **Istantanee, che qui costano niente**: `sws-lvgl-viewer --istantanea` disegna una pagina senza
  dispositivo, e `--tocca x,y` tocca prima di scattare, stampando quale comando il tocco ha
  prodotto. Si fotografa: la pagina, la pagina col bottone toccato (finestra aperta), e la pagina
  dopo aver toccato il ✕ (finestra chiusa, pagina di prima intatta). È la prova che il ripristino
  funziona, e nessun test unitario la può dare.
- Un template di collaudo con una pagina-finestra e un faceplate-finestra, perché
  `demo-items-lvgl` oggi non ne ha.
- **Conferma del maintainer sul WP630**, col caso vero: `button-b_48` di «CasaDomotica
  (WP630_LVGL)».

## La misura della memoria, fatta (22-10-2026)

Il piano imponeva di **misurare, non supporre**. Misurato su `theobroma` con
`tmp/misura-memoria.sh` — picco `VmHWM` da `/proc/<pid>/status`, campionato ogni 200 ms:

| cicli apri+chiudi | picco |
|---|---|
| 10 | 30 304 kB |
| 25 | 31 336 kB |
| 50 | 31 400 kB |

**Nessuna perdita lineare**: fra 25 e 50 cicli il picco cresce di **64 kB**, cioè 2,6 kB per
ciclo — rumore dell'allocatore. Il megabyte fra 10 e 25 cicli è una tantum: sono le facce
FreeType che ogni corpo nuovo apre al primo uso e che restano per sempre **di proposito** (il
puntatore del font vive quanto il processo, vedi il commento di `lvgl_font::load`).

**Quello che la misura non prova, e va detto.** Un `NavClickCtx` pesa un centinaio di byte:
cinquanta cicli ne farebbero cinque kB, *sotto il rumore dello strumento*. Quindi dimostra che
non c'è una perdita grossa, non che la `drop(Box::from_raw(…))` di `FinestraViva::chiudi`
funziona. Quella resta garantita dal codice e dal suo ordine.

**Una trappola del metodo, per chi rifà la misura**: ogni tocco vuole pressione e rilascio a due
fotogrammi di distanza, e `--tocca` li distribuisce nei due terzi finali. Per 2N tocchi servono
almeno 9N giri da 16 ms — col primo tentativo da 8 secondi, su cento cicli ne partiva **uno**, e
la misura sembrava perfetta proprio perché non stava misurando niente.

## Fuori da questo giro

- La finestra **non modale** trascinabile del web.
- `Escape`: su un pannello non c'è tastiera.
- Il **tocco fuori per chiudere**: decisione 2, esplicitamente escluso.
