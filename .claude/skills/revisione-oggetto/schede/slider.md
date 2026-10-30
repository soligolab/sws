# Scheda: slider

Scritta il 22-10-2026, prima revisione. I fatti qui sotto sono stati misurati quel giorno:
**riverificali al passo 1** e correggi la scheda, con la data, se qualcosa è cambiato.

## Cosa vuole il maintainer

Da `docs/plans/Appunti.txt`:

> LVGL & WEB : L'oggetto slider va impreziosito, servono più stili e modi di funzionamento, è un oggetto

La frase nel file era **troncata**. Il 30-10-2026 il maintainer l'ha completata:

> … è un oggetto molto importante che si deve adattare a vari stili grafici, disegni di impianti, scada di
> domotica e simili, per questo motivo l'aspetto grafico SVG deve permettere di scegliere molteplici stili oltre ad
> avere le impostazioni delle tacche di divisione, delle tacche marcate, prevedere l'effetto di ritorno in
> posizione stile molla di ritenuta.

**Decisioni del 30-10-2026** (prima revisione, tavola in `sws/tmp/revisione-slider/tavola.html`):
- uso: domotica e impianti, **priorità alla domotica**;
- web: **disegno SVG proprio**, puntatore e tastiera gestiti a mano (via l'input nativo);
- lo stile «classico» è **uno solo per i due motori, quello LVGL di oggi** (sul web la traccia si ispessisce);
- stili: classico, pillola, piastra (domotica), ISA-101;
- modi: bipolare, valore misurato (PV), bande e tacche, **ritorno a molla** (scrive mentre si tiene, al rilascio
  torna al riposo e scrive il riposo); l'intervallo a due cursori va in Appunti;
- tacche **per passo nelle unità del valore**;
- i difetti misurati sono la **prima fase** del piano, non un ramo a parte.
- icone della piastra: **8 fisse** (lampadina, tapparella, termometro, ventola, presa, volume, goccia, sole);
- riposo della molla, se non scritto: **l'origine se bipolare, altrimenti il minimo**.
- **immagine di sfondo** dietro tutto il riquadro (`bg_image`, già universale; LVGL la deve leggere anche sullo
  slider) con un'opacità da regolare: `bg_image_opacity` nuovo e **universale**, più `slider_track_opacity` per la
  parte vuota della traccia o della piastra.

In più, dal 22-10-2026: lo stile ISA-101 è **uno degli stili** dello slider, non l'unico
(vedi i principi in `SKILL.md`).

## File da leggere

Indicati per nome di funzione o di blocco, non per riga: le righe cambiano.

| Dove | Cosa cercare |
|---|---|
| `sws-editor/src/canvas/SvgCanvas.tsx` | il ramo `obj.type === "slider"`; `sliderDraft`, `commitSlider`, `releaseSlider`; `guardedWrite`; il wrapper di pagina (qualità, stale, allarme, ruolo) |
| `sws-editor/src/editor/EditorShell.tsx` | il blocco `obj.type === "slider"` nella sezione Parametri |
| `sws-editor/src/editor/oggettiNuovi.ts` | i valori di un nuovo slider dalla palette |
| `sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs` | `render_slider`, `init_bar_like` (condiviso con `progress_bar`), `sws_slider_changed_cb`, `formato_valore_barra`, il salto dei widget premuti nel ciclo di aggiornamento |
| `sws-runtime/crates/sws-web/src/synoptic.rs`, `sws-lvgl-viewer/src/model.rs` | i campi |
| `sws-runtime/crates/sws-web/src/validate.rs` | `INTERATTIVI` e le regole sullo slider |
| `sws-runtime/crates/sws-web/src/synoptic_schema.rs` | `TYPE_USAGE` dello slider: i campi che i template usano davvero |
| `tests/fixtures/colori-predefiniti.json`, `predefiniti-campi.json` | i default |
| `docs/manual/05_widget_reference.md` | la voce «Slider» |
| `examples/templates/demo-items-{web,lvgl}/synoptics/Base e comandi.yaml` | `o_slider` |
| `examples/templates/homeassistant-demo/`, `grid-playground/` | slider con step frazionario (0.5, 0.05) |

Storia utile, in `docs/archive/`:
- `2026-08-21-scada-widgets.md`: F3.4 tastierino touch (mai fatto per lo slider), F3.6 scrittura
  al rilascio / deadband / throttle (throttle mai fatto), F3.7 stato in attesa / ok / errore
  (fatto solo come toast);
- `2026-08-23-editor-coerente.md`: lo slider resta dentro il box dichiarato, etichetta compresa
  (guardia `check_wysiwyg.sh`);
- `2026-09-30-predefiniti-espliciti.md`: etichetta, colore di indicatore e cursore su LVGL.

E in `docs/plans/2026-10-19-chiusura-dei-residui.md`: `label_font_size`, e la nota che il valore
esce dalla traccia quando il font cresce.

## Campi di oggi

Lo stesso tag è letto e scritto: non c'è un tag di ritorno separato.

| Campo | Default | Note |
|---|---|---|
| `tag` | – | letto e scritto |
| `min` / `max` | 0 / 100 (scritti nel file) | sul web, se mancano, `range_lo`/`range_hi` della TagDef |
| `step` | 1 | |
| `orientation` | `horizontal` | `vertical` ruota l'input nativo di −90° |
| `label` | nessuna | testo sopra la traccia, colore tenue `#94a3b8` |
| `font_size` / `label_font_size` | 12 / 11 | valore / etichetta |
| `unit` | – | sul web anche dalla TagDef |
| `decimals` | 2 se step < 1, altrimenti 0 | |
| `show_value` | mostrato, se non è `false` | |
| `read_only` | false | |
| `write_on_release` | true | scrive solo al rilascio |
| `write_deadband` | – | non scrive se la variazione è più piccola |
| `fill` | `#3b82f6` | web: `accentColor`; LVGL: indicatore e cursore |
| `bg_color` / `bg_image` | nessuno | sfondo universale |
| sicurezza | – | `require_confirm`, `confirm_message`, `critical`, `require_reason`, `min_role`, `min_role_effect` |
| effetti generici | – | blink, `show_alarm_state`, `bad_value_style`, `stale_after_s`, `quality_dot`, ecc., dal wrapper di pagina |

**Non ci sono:** stile separato di traccia / indicatore / cursore, tacche e scala, bande di
limite, formato del valore, marker del valore di processo.

## Fatti noti al 22-10-2026, da riverificare

> **Riverificati il 30-10-2026** sul codice (punta di `feat/registrazione-e-pin`). Sono ancora veri tutti, tranne
> due cambiati il 27-10-2026 (commit `262dfa21`, collaudo sul WP630):
> - **LVGL legge `orientation`**: `geometria_traccia_slider`, traccia di 16 px (`SPESSORE_TRACCIA`) in verticale,
>   riempimento dal basso; nel verticale il valore va **sotto** la traccia, centrato, come sul web. Nell'orizzontale
>   resta **sopra il box, a sinistra** (web: sotto la traccia, centrato).
> - **Web**: `touch-action: none` sugli `input[type=range]` e `overscroll-behavior: none` sulla radice, perché su un
>   pannello touch il trascinamento orizzontale diventava «pagina precedente» di Chromium.
>
> Confermati, fra gli altri: la casella «Mostra valore» con `!!obj.show_value` (uguale in gauge e progress_bar);
> `unit` e `decimals` assenti dal pannello; il salto indietro dopo la scrittura (`setSliderDraft(null)`); su LVGL
> range intero, scrittura `TagValue::Int` a ogni `VALUE_CHANGED`, `read_only`/`write_on_release`/deadband/conferma
> ignorati; bordo allarme con larghezza di ripiego 100; validatore senza regole sullo slider; manuale con cinque
> campi; `o_slider` dei gemelli col minimo.

**Pannello proprietà**
- La casella «Mostra valore» legge `!!obj.show_value`, ma i due motori mostrano il valore se il
  campo non è `false`. Un nuovo slider non scrive `show_value`: la casella è spenta e il valore
  si vede. Lo stesso schema c'è nei blocchi di `gauge` e `progress_bar`: controlla se anche lì
  il default dei motori è «mostrato».
- Nel pannello mancano `unit` e `decimals`, che i motori usano.

**Web**
- È un `<input type="range">` nativo dentro un `foreignObject`.
- Dopo la scrittura, `sliderDraft` torna `null` e il cursore salta al valore vecchio finché il
  tag non arriva aggiornato.
- Con `require_confirm` e `write_on_release: false` chiede conferma a ogni movimento.
- Un valore non numerico stampa `NaN`. La qualità del tag non cambia niente nello slider.
- Il bordo allarme del wrapper usa la larghezza di default 100, mentre lo slider è largo 200.
- Con `min_role_effect: disable` il wrapper mette `pointerEvents: "none"`, che non toglie il
  focus da tastiera: lo slider si può forse ancora muovere con Tab e le frecce. Da provare.

**LVGL**
- Ignora `orientation` (sempre orizzontale), `read_only`, `write_on_release`, `write_deadband`,
  `require_confirm` e `critical`, `bg_color` / `bg_image`, i default dalla TagDef.
- Il range è intero (`lv_bar_set_range` con `min`/`max` arrotondati): uno slider 0..1 con step
  0.05 non funziona.
- Scrive a ogni `LV_EVENT_VALUE_CHANGED`, cioè di continuo durante il trascinamento, e sempre come
  intero.
- La traccia è fissa a 16 px. L'area di tocco copre il box con `ext_click_area`.
- Il valore sta **sopra il box dichiarato**, allineato a sinistra. Sul web sta **sotto la
  traccia**, centrato. Il manuale dice «sopra il cursore».

**Altro**
- Il validatore non controlla `min < max`, lo step, la deadband.
- La voce del manuale non cita `write_on_release`, `write_deadband`, `label_font_size`.
- Il gemello demo `o_slider` non usa etichetta, orientamento, sola lettura, scrittura al rilascio,
  colore, sicurezza o effetti.
- CasaDomotica usava uno slider al 16-10-2026. Il progetto sta sul VPS, non nel repo: chiedi al
  maintainer come vederlo.

## La domanda tecnica centrale

Sul web lo slider è un input nativo, e l'unico stile che accetta è `accentColor`. Traccia
spessa, cursore a forma scelta, bande, tacche, marker PV: **niente di questo si fa con l'input
nativo.** Serve un disegno SVG proprio, con la gestione del puntatore (mouse e touch) e della
tastiera fatta a mano.

È la scelta da cui dipende tutto il resto: va portata al maintainer **per prima**, con il costo.
Tieni conto che oggi sul canvas web non ci sono gestori pointer/touch: sarebbe il primo oggetto
ad averne, e lo stesso schema servirebbe poi al bottone.

## Anatomia obiettivo

Dal prompt originale, legata ai pezzi che SWS ha già. Ogni parte si propone con il suo campo.

1. **Traccia**: spessore (4-16 px) e raggio. Oggi su LVGL è fissa a 16 px, sul web la decide il
   browser.
2. **Riempimento**: dal minimo, oppure dallo zero centrale (bipolare).
3. **Cursore**: cerchio, rettangolo o «pill». **Area di tocco di almeno 44-48 px** anche se la
   parte visibile è più piccola: su LVGL c'è già `ext_click_area`, sul web va fatta.
4. **Marker del valore di processo (PV)**, distinto dal cursore del setpoint (SP). Oggi c'è un
   tag solo, letto e scritto. Serve una decisione: un tag di ritorno separato? Guarda come lo
   fa il `setpoint`.
5. **Bande di limite** (LL, L, H, HH e zona ottimale). Il `progress_bar` ha già `warn_low`,
   `warn_high`, `alarm_low`, `alarm_high` e `thresholdColor()`: si riusano gli stessi campi,
   con lo stesso significato. Visibilità: sempre, solo in allarme, mai.
6. **Scala**: tacche maggiori e minori, etichette, unità. Su LVGL con `lv_meter` o con linee ed
   etichette.
7. **Valore**: SP (modificabile), PV, unità. Posizione: in testa, in coda, sopra il cursore
   durante il trascinamento, nascosto. Va deciso **dove sta**, e uguale sui due motori.
8. **Etichetta**: c'è già (`label`, `label_font_size`).
9. **Icone di stato**: il pallino qualità è già generico. Lucchetto per `read_only` e per ruolo
   insufficiente.

## Varianti da valutare

- Orientamento orizzontale / verticale: oggi solo sul web.
- Modo: valore singolo, intervallo (due cursori min/max), bipolare.
- Densità: compatto (sola lettura), standard, grande per il tocco con i guanti.
- Scala lineare o logaritmica; step con aggancio visibile alle tacche, oppure continuo.
- Ad arco: valuta prima se non sia il `gauge` che impara a scrivere.

## Stati specifici dello slider

Oltre agli stati della lista di controllo in `SKILL.md`:
- **trascinamento**: cursore più grande del 10-15% o con bordo marcato, valore sopra il cursore;
- **dopo il rilascio**: il cursore resta dove l'ha lasciato l'operatore finché il tag non
  risponde. Oggi salta indietro sul web;
- **sola lettura**: cursore assente o ridotto a marker, nessun segno di interazione;
- **qualità Bad / stale**: il valore non deve sembrare buono. Oggi lo slider ignora la qualità.

## Oggetti vicini

- **`progress_bar`**: su LVGL condivide `init_bar_like` e `formato_valore_barra`. Sul web ha
  codice suo, con soglie colorate, marker e traccia `bg_color`. Uno slider «in sola lettura» e
  una barra si somigliano: chiarisci il confine.
- **`setpoint`**: stesso percorso di scrittura. Il piano archiviato
  `docs/archive/2026-10-22-setpoint-i-due-motori-non-combaciano.md` racconta i problemi di
  parità di un oggetto simile.
- **`button`** in modalità incremento/decremento: usa `step`, `min`, `max`.
- **`gauge`**: stesso significato di `min`, `max`, `unit`, `decimals`.
