# Il setpoint: far combaciare i due motori, e poi il corpo del testo

**Stato: piano d'esecuzione, decisioni prese.** Nato come seme il 22-10-2026 dentro il secondo
giro di `font_size` (`docs/plans/2026-10-19-chiusura-dei-residui.md`, ramo 5); diventato piano lo
stesso giorno, dopo la sessione di decisioni col maintainer.

Il setpoint è l'unico tipo rimasto fuori dal secondo giro di `font_size`, e non per dimenticanza.
L'ordine era già deciso — **«prima si allinea, poi il corpo»** — ma allineare il setpoint non è
una questione di corpi: i due motori mostrano **oggetti diversi, con interazioni diverse**.

## Cosa c'è oggi, misurato il 22-10-2026

**Sul web** (`sws-editor/src/canvas/SvgCanvas.tsx`, ramo `obj.type === "setpoint"`) il riquadro
contiene tre righe e due pulsanti, cinque testi di dimensione diversa:

| cosa | corpo |
|---|---|
| etichetta | 11 |
| riga «Attuale: *valore*» | 10 |
| campo numerico modificabile | 12 |
| pulsante ✓ (conferma) | 12 |
| pulsante ⌨ (tastierino) | 13 |

**Su LVGL** (`lvgl_render.rs`, `render_setpoint`) ce ne sono **due**: l'etichetta (corpo 11,
l'unico numero che i due motori hanno già uguale) e il valore corrente, che non ha font e quindi
eredita i 14 dello schermo. Niente riga «Attuale:», niente campo modificabile nel riquadro,
niente ✓: si tocca il valore e si apre un **overlay a schermo intero** con area di testo e
tastierino.

C'è un commento nel codice che è una decisione presa, e questo piano **la ribalta in modo
esplicito**: *«infilarne tre in 48 pixel non riesce a nessuno dei due motori, ma due ci stanno, e
il valore è la riga che conta»*. Resta vero che tre righe in 48 px non ci stanno — per questo c'è
la decisione 4.

## Le decisioni del maintainer (22-10-2026)

1. **Il pannello si allinea al web.** LVGL guadagna la riga «Attuale:», il campo modificabile e il
   ✓. Le altre due strade erano «un disegno solo, quello del pannello» (etichetta + valore grande
   toccabile, da cinque testi a due) e «restano diversi, si allineano solo i corpi». Vince la
   parità col browser: il web è il riferimento WYSIWYG, e un setpoint deve mostrare la stessa cosa
   ovunque lo si guardi.
2. **Si digita toccando il campo, e si apre il tastierino a pieno schermo** che il pannello ha
   già. Il campo si *disegna* come sul web — riquadro col numero dentro — ma non è un'area di
   testo con una tastiera LVGL sotto: su un riquadro di pochi pixel il campo sarebbe minuscolo e
   la tastiera coprirebbe mezzo schermo lo stesso. Il ✓ accanto conferma. **Non** si fa il campo
   di sola lettura col solo ⌨ a digitare: chi arriva dal browser tocca il numero, e non succedere
   niente è esattamente il difetto che stiamo correggendo altrove.
3. **Tre campi per il corpo del testo**, non cinque e non due:

   | campo | governa |
   |---|---|
   | `label_font_size` | l'etichetta (11) |
   | `font_size` | la riga «Attuale:» e il campo del valore (10 e 12 oggi) |
   | `button_font_size` | i due pulsanti ✓ e ⌨ (12 e 13 oggi) |

   Cinque voci numeriche per un oggetto che è un numero e un'etichetta non le userebbe nessuno, e
   due farebbero crescere i pulsanti insieme al valore — un ⌨ grande quanto il numero si mangia il
   riquadro. **I corpi di oggi restano i predefiniti**, quindi nessun progetto cambia aspetto per
   colpa di questa decisione.
4. **Il riquadro ha un'altezza minima e si allarga** quando chi disegna gliene dà meno. Le altre
   due strade erano «cade la riga meno importante» e «il testo si stringe» — e stringere
   contraddirebbe il lavoro appena finito, dove il corpo del testo è diventato una scelta
   esplicita.
5. **L'altezza minima vale in tutti e due i motori, dalla stessa funzione.** Si calcola dai corpi,
   in `geometria_testo` — la gemella che i due motori già condividono. Se valesse solo sul
   pannello, l'editor smetterebbe di dire la verità sull'ingombro (regola WYSIWYG) e l'oggetto si
   sposterebbe le cose intorno solo sul vetro, dove te ne accorgi tardi.
6. **«Attuale:» entra nella tabella dei testi di sistema**, per tutti e due i motori. Oggi il web
   la prende da `viewer.currentValue` di `it.json`/`en.json`: **due lingue, e la lingua dell'IDE**
   invece di quella dei contenuti — un operatore tedesco legge «Current:». È lo stesso difetto che
   la tabella dei testi di sistema esiste per chiudere, ed è comunque la strada obbligata per
   farla comparire su LVGL.

## La conseguenza scomoda della decisione 4, da guardare in faccia

**I setpoint che esistono oggi si allargheranno.** Il predefinito è 56 px e con tre righe e i
corpi di oggi il minimo sarà più alto (da misurare, intorno ai 64). Su un sinottico denso,
un oggetto che cresce può finire sopra quello sotto.

Non è una scoperta da fare in produzione: va **misurato prima** su `demo-items-*` e su
`~/sws_projects`, e il numero va scritto qui. Se i progetti toccati sono pochi, si procede; se
sono tanti, è il momento di dirlo al maintainer invece di allargare in silenzio.

## Il lavoro

### 1. Il testo di sistema «Attuale:»

Quattro posti e cinque lingue, come ogni voce di quella tabella:
`sws-core/src/testi_sistema.rs`, `sws-editor/src/i18n/testiSistema.ts`,
`sws-lvgl-viewer/src/testi_sistema.rs` e la fixture condivisa `tests/fixtures/testi-sistema.json`.
La guardia `check_testi_sistema.sh` verifica che la parola compaia tale e quale nelle due
implementazioni.

Poi il web smette di usare `t("viewer.currentValue")` e passa da `testoSistema`, come già fanno
le intestazioni delle tabelle e i messaggi del trend. La chiave vecchia resta o si toglie a
seconda di chi altro la usa — da controllare con un grep, non a memoria.

### 2. L'altezza minima, condivisa

Una funzione in `sws-core/src/geometria_testo.rs` e la gemella in
`sws-editor/src/canvas/geometriaTesto.ts`, con i casi nella fixture `tests/fixtures/geometria-testo.json`
come le altre quattro. Prende i tre corpi e dice l'altezza che il riquadro deve avere.

**Il vincolo di sempre**: coi corpi di oggi deve uscire il numero di oggi — cioè l'altezza che il
setpoint predefinito occupa davvero adesso, misurata e non supposta.

### 3. Il campo nuovo `button_font_size`

Un campo nuovo tocca **quattro posti, e due si dimenticano** — lezione del giro appena finito:
il tipo TS, il modello del viewer, **`sws-web/src/synoptic.rs`** (senza, la GET di un sinottico lo
perde al primo round-trip) e lo schema dell'assistente IA, che si **rigenera** con
`./scripts/gen_synoptic_schema.py` e non si scrive a mano. Più `CAMPI_SCALATI`, perché è pixel.

E la voce nella tabella dei predefiniti (`tests/fixtures/predefiniti-campi.json` e lo specchio
`predefinitiCampi.ts`) coi letterali di oggi.

### 4. Il web: dai letterali ai tre campi

Cinque `fontSize` cablati nel ramo `setpoint` di `SvgCanvas.tsx` diventano i tre campi. E le
altezze delle righe derivano dai corpi, non più dal flex: è la stessa scelta «le misure derivano
dal corpo» del giro precedente.

### 5. LVGL: le tre righe e i due pulsanti

`render_setpoint` oggi disegna etichetta e valore. Deve disegnare:

- l'etichetta, com'è (corpo da `label_font_size`);
- la riga «Attuale: *valore*», **viva**: va in `LiveBinding` come il valore, o mostrerà il numero
  del momento in cui la pagina è stata aperta;
- il campo col valore, disegnato come un riquadro con bordo — e **cliccabile**, che apre l'overlay
  del tastierino che c'è già;
- il ✓, che conferma;
- il ⌨, che apre lo stesso overlay.

**La trappola del contenitore**, già pagata una volta e scritta nel codice: `set_pos_size` va
chiamato **dopo** `lv_obj_remove_style(NULL, ANY)`, perché in LVGL 8 posizione e dimensione sono
stili locali e `remove_style` se li porta via — il contenitore collassa a zero e sparisce con
tutto il suo contenuto. Il commento è a `render_setpoint`, e vale per ogni riga nuova che si
aggiunge lì dentro.

### 6. L'altezza minima applicata

Nei due motori: il web la usa per il riquadro disegnato e per l'ingombro mostrato nell'editor, il
pannello per il contenitore. Stessa funzione, stesso numero.

## Verifica

- `cargo check`, `pnpm build`, `check_static.sh`, `cargo test`, `pnpm exec vitest run`.
- **Istantanee**, che qui costano niente: la pagina col setpoint prima e dopo, e — con
  `--tocca x,y` — il tastierino che si apre toccando il campo, non solo il ⌨. Il viewer stampa
  anche quale comando il tocco ha prodotto, quindi «si apre la finestra giusta ma scrive il valore
  sbagliato» non passa per buono.
- **Il confronto browser/pannello sulla stessa pagina**: è il senso di tutto il piano, e
  `demo-items-web` e `demo-items-lvgl` sono gemelli apposta.
- Il numero dei setpoint che si allargano, misurato (vedi sopra).
- **Conferma del maintainer**, sul vetro: il gesto di digitare un valore deve restare quello che
  conosce.

## Cosa è già pronto

- Le misure derivate dal corpo, provate su una fixture comune: `passo_riga`,
  `altezza_etichetta`, `altezza_valore`, `corpo_secondario`.
- `label_font_size` esiste in tutti e quattro i posti che servono ed è in `CAMPI_SCALATI`.
- La voce `setpoint` nella tabella dei predefiniti c'è già, con `label`, `decimals` e `step`.
- Il tastierino a pieno schermo su LVGL esiste e funziona: è quello che si apre oggi toccando il
  valore.
