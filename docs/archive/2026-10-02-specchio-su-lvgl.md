# Lo specchio (`flip_h` / `flip_v`) sul pannello LVGL

> Scritto il 02-10-2026 nella sessione di plan che il seme
> [`2026-09-26-specchio-su-lvgl.md`](2026-09-26-specchio-su-lvgl.md) chiedeva prima di
> toccare qualunque cosa. Quel seme è ora in archivio: questo piano lo apre e lo chiude.

## Contesto

`flip_h` e `flip_v` stanno nel modello del viewer LVGL da sempre, ma quasi nessuno li legge: un
oggetto specchiato nell'editor arriva dritto sul pannello. È lo stesso difetto che la rotazione
aveva fino al 26-09-2026, con la differenza che LVGL 8.3 **non ha uno specchio di stile** —
`transform_zoom` non accetta valori negativi — quindi non esiste una via unica come
`apply_rotation_from`.

Dal seme a oggi il quadro è cambiato in meglio: polilinee e poligoni **specchiano già** (lo fanno i
vertici, `sws_core::geometry::vertici_poligono`), e nel frattempo trend, barre, tabella e tubo sono
stati rifatti su canvas. Restano scoperti i tipi dove lo specchio si vede davvero.

I tipi si dividono in quattro famiglie, e ciascuna vuole la sua tecnica. **Decisioni del maintainer
(02-10-2026)** riportate qui sotto.

## Cosa si fa

### 1. Simboli e immagini — lo specchio sta nell'SVG, non nei pixel

`symbol` e `image` passano dalla stessa strada (`svg_assets::source_for_project` →
`svg_raster::rasterize*`), e lì `resvg::render` riceve già una `Transform`. Lo specchio diventa
**parte di quella trasformazione**: scala negativa più traslazione, applicata mentre il disegno è
ancora vettoriale.

Scelta del maintainer, contro lo specchiare il pixmap già disegnato: il risultato è identico a
dimensioni normali, ma su un pannello grande o un simbolo ingrandito lo specchio vettoriale non
perde nulla. Costa una `Transform` diversa, non un passaggio in più.

Le due funzioni (`rasterize`, `rasterize_stretch`) prendono i due flag; i chiamanti che non
specchiano passano `false` e ottengono esattamente la trasformazione di oggi.

### 2. Gauge — angoli specchiati, non pixel

`render_gauge` usa un `lv_meter` nativo: niente pixel da ribaltare, ma un arco descritto da
`angoli_gauge(inizio, fine) -> (ampiezza, rotazione)`, che è già una **funzione pura**. Lo specchio
è una riflessione degli angoli prima di quel calcolo — orizzontale `θ → 180° − θ`, verticale
`θ → −θ` — e si prova con un test di aritmetica, senza schermo.

L'effetto è quello giusto: l'arco e la lancetta vanno dall'altra parte. I numeri delle tacche
restano leggibili, come deciso al punto 4.

### 3. Barra di avanzamento — il verso del riempimento

`render_progress_bar` usa `lv_bar`. Lo specchio orizzontale è il verso in cui la barra si riempie,
e LVGL lo sa fare da sé: `lv_obj_set_style_base_dir(..., LV_BASE_DIR_RTL)`. Su una barra
orizzontale `flip_v` non cambia nulla, e viceversa — va dichiarato nel commento, non lasciato
intendere.

### 4. Testi, tabelle, pulsanti — non si specchiano, e lo si dichiara

`text`, `table`, `button`, `navbutton`, `lang_button`, `lang_selector`, `page_navigator` ignorano
`flip` sul pannello. È una **divergenza voluta** dal web, non una dimenticanza, e va scritta dove
qualcuno la cercherà: accanto all'elenco dei tipi e nel manuale.

La ragione è un costo che non si vede da fuori: anche i widget già «su canvas» (tabella, trend,
barre) disegnano su canvas solo la geometria — il testo lo mettono sopra con etichette LVGL vere
(`scrivi_testi`). Specchiare i glifi vorrebbe dire una **seconda pipeline tipografica** nel
pannello, un rasterizzatore di font per tiny-skia accanto a quello di LVGL, con il rischio che i
testi del pannello smettano di somigliarsi fra loro.

`rect`, `ellipse` e `led` non hanno bisogno di niente: specchiati sono identici a sé stessi.

## Come si verifica

- **Test puri** sugli angoli del gauge (riflessione orizzontale, verticale, entrambe, nessuna) e
  sulla `Transform` dello specchio: `cargo test -p sws-lvgl-viewer`. Da provare rossi.
- **Guardia fotografica**, estendendo `scripts/check_forme_lvgl.sh`, che già fa questo mestiere e
  già verifica la rotazione: una pagina con un simbolo asimmetrico dritto e specchiato, un gauge
  specchiato, una barra specchiata; si confrontano i pixel ai due lati dell'asse. Provata rossa
  togliendo lo specchio.
- **A schermo**, dall'IDE in modalità Pixsys (già allineato su 8460) e poi sul pannello alla
  prossima immagine: un simbolo valvola specchiato deve puntare dall'altra parte, in editor e sul
  vetro allo stesso modo.

## File

| file | cosa |
|---|---|
| `sws-runtime/crates/sws-lvgl-viewer/src/svg_raster.rs` | `rasterize`/`rasterize_stretch` prendono i flag e li mettono nella `Transform` |
| `sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs` | i chiamanti di `symbol`/`image` passano i flag; `angoli_gauge` riflessa; `base_dir` sulla barra; l'elenco dei tipi che **non** specchiano, con il perché |
| `scripts/check_forme_lvgl.sh` | la guardia fotografica estesa allo specchio |
| `docs/manual/05_widget_reference.md` | i tipi che su LVGL non specchiano |
| `CHANGELOG.md`, `NOVITA.yaml` | una riga: gli oggetti specchiati si vedono specchiati anche sul pannello |

## Quello che questo piano **non** fa

- Non tocca polilinee e poligoni: specchiano già nei vertici, e farlo due volte li raddrizzerebbe.
- Non introduce il rendering di testo su canvas (vedi punto 4): se un giorno servisse — per il
  destra-sinistra vero, non per lo specchio — sarà un lavoro suo, con la sua sessione di plan.
