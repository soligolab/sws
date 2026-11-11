# Oggetti e template: i difetti del pannello LVGL, la parità col web e i residui dei template

> Nato il 10-11-2026 da `Appunti.txt` (punti del 30-10, 04-11, 05-11, 08-11 e 09-11-2026), quando il
> maintainer ha chiesto di trasformare gli appunti in semi e piani e di eliminare il file.

**Stato: piano — pronto, scelte prese l'11-11-2026 (vedi «Decise l'11-11-2026»)** (la mini tendenza ferma, il
momentaneo critico, il nebulizzatore e il suo «Stato:» — vedi «Da decidere col maintainer»).

## Da dove viene

Da `Appunti.txt`, 10-11-2026. I punti sono di cinque date:

- **30-10-2026** — la revisione dello slider ([piano archiviato](../archive/2026-10-30-revisione-slider.md))
  ha lasciato fuori lo slider a intervallo.
- **04-11-2026, sessioni T1 e T2** (le regole dei template R6–R8, i sedici template rivisti): gli agenti
  hanno confrontato le istantanee dei due motori, web e LVGL, sui template. Hanno trovato difetti del
  pannello LVGL **tutti preesistenti**, e dubbi sul contenuto dei template che solo il maintainer può
  sciogliere.
- **05-11-2026, sessione F3** della [Finestra di avviso](../archive/2026-11-04-finestra-di-avviso.md): la
  decisione 2 (password anche su LVGL) è rimasta fuori.
- **08-11-2026, sessione L1** della [Logica unificata](../archive/2026-11-04-logica-unificata.md), decisione del
  maintainer: il viewer LVGL non esegue le funzioni dei bottoni.
- **09-11-2026, revisione del ramo A** del [viewer leggero](2026-11-09-viewer-leggero.md)
  (`fix/mini-tendenze-leggere`, in `main` con la 2.26.0-rc.10): due differenze fra le mini tendenze dei
  due motori e un velo mancante.

Il filo comune: **lo stesso progetto deve disegnarsi e comportarsi allo stesso modo sul viewer web e sul
pannello LVGL**, e dove il pannello non può (tastiera, sessione, script) deve dirlo. Tutte le misure
seguenti sono del giorno indicato; le righe di codice vanno ricontrollate quando si comincia.

## 1. Difetti di disegno del pannello LVGL visti nelle istantanee dei template (T1 e T2, 04-11-2026)

### 1.1 Il testo senza riquadro: sul web `y` è la linea di base, su LVGL è il bordo alto

È il difetto da prendere per primo, perché **cambia la posizione di ogni testo libero di ogni progetto
LVGL**.

- **Misura** (agenti della sessione T1, 04-11-2026, su sei template): lo scarto è circa un corpo, cioè
  22 px per un titolo a 22. Il titolo della cornice a `y` 36 usciva dalla testata sul pannello.
- **Il rimedio messo il 04-11**, che aggira il difetto senza correggerlo: nei template di T1 e nel modello
  di cornice dell'IDE (`sws-editor/src/cornici/modello.ts`, il titolo della testata) i testi stanno in un
  riquadro con `text_wrap` e `text_valign: middle`, che i due motori disegnano uguali.
- **La correzione vera** sta nel motore LVGL (`sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs`):
  per un `text` senza riquadro sottrarre l'ascesa del font, così `y` torna a essere la linea di base
  come sul web. Si prova con le istantanee dei due motori sugli stessi template.
- **Il caso da riprodurre**: il titolo «Lago alpino» (`lago_titolo`, `y` 26, corpo 28, senza `text_wrap`)
  della pagina Lago di `montagna-rinnovabile` al commit `3822170c` (04-11-2026, file
  `synoptics/Lago — sfondi in due passi.yaml`, riga 46 in quel commit). Sul web stava a cavallo del
  bordo del pannello scuro, su LVGL dentro. Oggi quel titolo non c'è più: lo dà la cornice. Per la prova
  si riprende la pagina da quel commit.
- **Attenzione**: i template e le cornici che il 04-11 hanno messo i testi in un riquadro non cambiano;
  i progetti dei clienti con testi liberi posizionati a occhio sul pannello sì. Va detto in
  `NOVITA.yaml`.

### 1.2 Gli altri difetti di disegno, tutti preesistenti

Dalle istantanee di T1:

- **Griglia**: il figlio di una cella va nell'angolo dello slot più `x`/`y` (`render_grid_slot` in
  `lvgl_render.rs`: `positioned.x = x + child.x`, `positioned.y = y + child.y`); il web lo **centra** nello
  slot e ignora `x`/`y`. Il template `grid-playground` mette in `x`/`y` lo scarto che centra (per esempio
  `x: 43`, `213`, `384`, `555`, `725` in `synoptics/Page 2 - Controlli.yaml`): **se si corregge LVGL,
  quegli scarti vanno azzerati** nello stesso ramo, altrimenti il template si rompe sul pannello.
- **Celle con `bg_color`**: prendono il bordo chiaro arrotondato del tema di `lv_obj`.
- **Rettangoli ed ellissi bassi** (sotto ~40 px): mostrano una barra di scorrimento grigia (padding del
  tema).
- **`faceplate_scale`** non c'è su LVGL (il campo esiste in `sws-lvgl-viewer/src/model.rs`, ma il motore
  non lo usa); il web scala i figli al riquadro dell'istanza (`scaleTf` in
  `sws-editor/src/canvas/SvgCanvas.tsx`).
- **`kpi_tile` senza `color`**: valore scuro su fondo scuro; il web usa `#e2e8f0`.
- **Allarmi**: la campanella copre la sua scritta; «Allarmi» e «Nessun allarme attivo» restano in
  italiano qualunque sia la lingua.
- **`lang_selector`**: la freccia è un quadratino.
- **Slider verticale al minimo**: il cursore copre l'etichetta «0 %».
- **`bg_image` di uno slider classico** disegnata solo al centro del riquadro (template `demo-slider`,
  oggetto `s_img2` in `synoptics/5 In casa.yaml`).

Dalle foto dei template di T2:

- **`recipe_panel`**: i nomi delle ricette scuri su fondo scuro; i bottoni «Applica» tagliati a destra.
- **`kpi_tile`**: il valore quasi invisibile (stesso difetto del `color` mancante, visto da un altro
  template).
- **`led` senza dato**: quasi nero anche con `off_color`.
- **`gauge` senza arco**: si vede solo la lancetta.
- **Faceplate di sistema** `motor_basic` e `tank_level` (`sws-runtime/assets/faceplates/motor_basic.yaml`,
  `tank_level.yaml`): scritte in inglese fisse («Speed:», «Fault:»; l'etichetta «Tank Level»), che la
  tabella lingue non vede. Vanno portate su chiavi di traduzione, o almeno dichiarate.

**Come si lavora**: un ramo solo per i difetti di disegno, con le istantanee dei due motori prima e
dopo sui gemelli `demo-items-web`/`demo-items-lvgl` (coprono i 39 tipi, guardia
`scripts/check_demo_templates.sh`) e sui template nominati. I file di confronto in `sws/tmp/`, mai in
`/tmp`.

## 2. Comportamenti che il pannello LVGL non ha

### 2.1 `on_press_fn` / `on_release_fn` (08-11-2026, sessione L1, decisione del maintainer)

- **Oggi**: il viewer LVGL non esegue `on_press_fn`/`on_release_fn` (`lvgl_render.rs`, il ramo dei
  bottoni; il commento sopra `render_grid` lo dichiara come «semplificazione dichiarata», e vale anche
  per `button`/`navbutton`). Un bottone che chiama una funzione Python funziona solo nel viewer web.
  Da L1 l'editor lo dice sotto la scelta della funzione, quando il progetto è LVGL.
- **Da fare**: il viewer LVGL chiama `POST /api/script/run/<nome>` coi parametri del bottone (la rotta è
  in `sws-runtime/crates/sws-web/src/router.rs`, `run_function`). Il viewer ha già un client HTTP verso il
  runtime per le scritture: si riusa quello.
- **Da decidere**: cosa mostra il pannello se la funzione fallisce (un avviso LVGL? solo il registro?).
  Oggi gli errori di scrittura su LVGL si vedono solo come 401/403, il resto va su stderr (vedi il seme
  [in attesa per tutte le scritture](semi/2026-10-30-in-attesa-per-tutte-le-scritture.md)).

### 2.2 La password sui comandi critici (05-11-2026, sessione F3)

- **Oggi**: un comando `critical` su LVGL chiede una **conferma**; sul web chiede la **password**. La
  decisione 2 di F3 proponeva la password su tutti e due: sul web c'era già, su LVGL manca una tastiera
  e una sessione autenticata nel viewer. Lo dice il commento di `regola_conferma` in `lvgl_render.rs`:
  non copre `require_reason` né la ri-autenticazione di `critical`, e chi ha bisogno del motivo
  nell'audit deve usare il pannello web.
- **Da fare**: la password e il motivo anche su LVGL. È **lavoro vero**: serve la tastiera (quella del
  login LVGL esiste già) e una sessione autenticata nel viewer da cui verificare la password.

### 2.3 Il momentaneo critico (05-11-2026, sessione F3)

- **Oggi sul web** un momentaneo critico è un impulso: la password alla pressione, poi pressione e
  rilascio scritti insieme (`comando` in `sws-editor/src/canvas/SvgCanvas.tsx`). **Sul pannello LVGL** il
  momentaneo non chiede niente, nemmeno se critico.
- **Da decidere col maintainer** se un momentaneo critico debba esistere. Se sì, i due motori devono
  fare la stessa cosa; se no, l'editor lo impedisce.

## 3. Mini tendenze e sparkline (09-11-2026, revisione del ramo A)

### 3.1 Una mini tendenza ferma sta in basso sul web e a metà su LVGL

- **Misura**: con un valore fermo per tutta la finestra (`lo = hi`) il web disegna la linea sul fondo
  (`const range = hi - lo || 1` nel metodo `disegno` di `sws-editor/src/canvas/miniSerie.ts`, com'era già
  nel vecchio `SparklineWidget`), e sembra uno zero. LVGL la disegna a metà altezza (`SCALA_Y / 2` nel
  ramo `hi <= lo` di `disegno` in `sws-runtime/crates/sws-lvgl-viewer/src/mini_serie.rs`), come il
  segnaposto del web con meno di due punti.
- **È una scelta d'aspetto**: chiederla al maintainer, poi scriverla **una volta sola** nei due
  `disegno`. Vale solo con la scala automatica: con `y_min`/`y_max` dati la posizione è quella vera.

### 3.2 La sparkline LVGL non riempie l'area sotto la linea

- `spark_fill` e `spark_fill_opacity` esistono nel modello (`sws-lvgl-viewer/src/model.rs`,
  `sws-web/src/synoptic.rs`) e la kpi sul web li usa, riempiendo al 15 %. Su LVGL no: `lv_chart` 8.3 non
  riempie lo scatter (lo dice il commento sopra `render_sparkline` in `lvgl_render.rs`). Va disegnato con
  un evento di disegno (`LV_EVENT_DRAW_*`). Se arriva prima il passaggio a LVGL 9.3
  ([seme](semi/2026-11-03-lvgl-9-3.md)), ricontrollare: potrebbe non servire più.

### 3.3 Il velo «Dati in ritardo» non entra nelle finestre LVGL

- **Misura**: con la fascia «Dati in ritardo» accesa gli oggetti di una finestra LVGL aperta sono grigi ma
  **pieni**, perché il velo sta sotto le finestre (`effects.rs`: il velo si abbassa sopra la pagina, una
  volta per tutti). Sul web gli stessi oggetti sono al 55 %.
- **Da fare**: un secondo velo dentro l'area della finestra, **agganciato alla distruzione della finestra
  con `LV_EVENT_DELETE`**: altrimenti resta un puntatore a un oggetto già cancellato.

## 4. La finestra che mostra i segnaposto (04-11-2026, sessione T2)

- **Misura**: nei gemelli `demo-items-*` la «Finestra pompa» si apre col titolo `{{t0105}}` non tradotto e
  il testo «Dettaglio di {nome}». Il predefinito di `finestra_parametri` non si applica, **sul web e su
  LVGL**. I pezzi: `examples/templates/demo-items-web/synoptics/Finestra pompa.yaml` (`titolo: "{{t0105}}"`,
  `finestra_parametri:`) e `project.yaml` (la chiave `t0105` = «Finestra pompa», il testo «Dettaglio di
  {nome}»).
- **Da misurare prima di correggere**: aprirla dal bottone, coi parametri passati e senza, e vedere in
  quale dei due casi il predefinito e la traduzione si perdono. Riguarda i faceplate e le pagine-finestra.

## 5. I dubbi dei template, da decidere col maintainer (04-11-2026, sessione T1)

Tutti preesistenti. Nessuno è un difetto del motore: è il contenuto del template.

- **`homeassistant-demo`**: il «Delta» calcola soggiorno − studio ma i testi dicono interno − esterno
  (`synoptics/Page 3 - Storico.yaml`, oggetti `ha3_delta_*`, tag `clima.delta_interno_esterno`); e
  `energia.potenza_w` vale kW mentre le pagine dicono W (gauge 0–5000). O si cambia il calcolo e il tag,
  o si cambiano i testi.
- **`homeassistant-pro`**: restano gli entity_id `person.mauro2` e `switch.lampada_cancelletto_mauro`
  (`project.yaml` e `SETUP.md`). Sono di casa del maintainer: vanno sostituiti con nomi neutri, o
  dichiarati come esempio.
- **`demo-slider`**: il tag `s.rampa` ha `write_min_role: Viewer` (`project.yaml`) solo perché la guardia
  `scripts/check_templates.sh` contava anche gli slider `read_only`. La guardia è stata corretta il
  04-11-2026 (salta gli oggetti `read_only`): **il ruolo si può togliere**.

## 6. Lo slider a intervallo (30-10-2026)

- **Cos'è**: uno slider con due cursori (minimo e massimo) su due tag.
- **Perché non c'è**: escluso dal piano della revisione dello slider il 30-10-2026
  ([archivio](../archive/2026-10-30-revisione-slider.md)), perché è il modo più costoso (L) e la priorità
  è la domotica.
- **A cosa serve**: fasce orarie, finestre di temperatura, soglie min/max.
- **Come farlo**: riusare il componente SVG della fase 2 di quel piano. Due cursori, due scritture, e la
  regola che i due cursori non si incrocino. Su LVGL va fatto il gemello, come per gli altri modi dello
  slider.

## Da decidere col maintainer

Le tre scelte d'aspetto, da chiedere **prima** di aprire il ramo:

1. **La mini tendenza ferma** (§3.1): linea in basso (web di oggi), a metà (LVGL di oggi), o altro.
2. **Il momentaneo critico** (§2.3): deve esistere? E se sì, password alla pressione come sul web, su
   tutti e due i motori.
3. **`nebulizzatore-sandokan`** (T2, 04-11-2026): il template non ha comandi, anche se la sorgente MQTT sa
   scrivere lo stato della presa — un bottone accendi/spegni? E «Stato:» (`project.yaml`) resta vuoto
   finché non arriva un dato — un testo d'attesa?

Poi le scelte di contenuto dei template (§5) e queste tre di prodotto:

4. **Il testo senza riquadro** (§1.1): accettare che la correzione sposti i testi liberi dei progetti LVGL
   esistenti, con l'avviso in `NOVITA.yaml`.
5. **La password su LVGL** (§2.2): farla in questo piano o lasciarla come lavoro a sé, data la tastiera e la
   sessione da costruire.
6. **Cosa mostra il pannello** quando una funzione chiamata da un bottone fallisce (§2.1).

### Decise l'11-11-2026 (maintainer, dal TC620 con la rc.13)

1. **Mini tendenza ferma**: la linea **a metà**, su tutti e due i motori (si cambia il `disegno` del web in
   `miniSerie.ts`; LVGL è già così).
2. **Momentaneo critico**: **esiste**, con la password alla pressione come sul web (poi pressione e rilascio
   scritti insieme), e su LVGL quando c'è la password (punto 5).
3. **`nebulizzatore-sandokan`**: proposta di Claude, non contestata: un bottone accendi/spegni sulla presa, e
   «Stato:» mostra «—» finché non arriva un dato. Da riconfermare guardando il template.
4. **Testo senza riquadro**: **si corregge LVGL** perché `y` sia la linea di base come sul web, con l'avviso in
   `NOVITA.yaml`; CasaDomotica e i progetti con testi liberi vanno ricontrollati dopo.
5. **Password e motivo su LVGL**: **in questo piano, per ultima**, come ramo a sé dopo i difetti di disegno e
   `on_press_fn`.
6. **Funzione di un bottone che fallisce su LVGL**: proposta di Claude, non contestata: un breve avviso a
   schermo («Comando non eseguito») più la riga nel registro.

## Ordine proposto

1. §1.1 e §1.2 insieme, un ramo: i difetti di disegno, con le istantanee prima/dopo.
2. §3 e §4: mini tendenze, velo nelle finestre, segnaposto della finestra.
3. §2.1: le funzioni dei bottoni sul pannello.
4. §5 e la scelta 3: i template, una volta decisi.
5. §2.2, §2.3 e §6 sono lavoro più grosso: ciascuno il suo ramo, quando il maintainer lo mette in fila.

Ogni ramo rispetta la regola «una funzione visibile in `main` va anche in CasaDomotica» (`CLAUDE.md`).

## Collaudo

- **Istantanee dei due motori** sui gemelli `demo-items-web`/`demo-items-lvgl` e sui template citati
  (`grid-playground`, `demo-slider`, `homeassistant-demo`, `homeassistant-pro`, `montagna-rinnovabile` al
  commit `3822170c` per il titolo «Lago alpino», `nebulizzatore-sandokan`): web e LVGL devono dare la
  stessa immagine, testi compresi. Le immagini in `sws/tmp/`.
- **Sul pannello** (WP630 o TC620): un `text` libero a `y` noto misurato col righello contro il web; una
  griglia di `grid-playground` con gli scarti azzerati; una `kpi_tile` senza `color`; un `led` senza dato;
  un `gauge` con l'arco; il `recipe_panel` con «Applica» intero; la campanella; il `lang_selector`; lo
  slider verticale a 0 %; `s_img2`.
- **Mini tendenze**: una kpi con valore fermo per tutta la finestra, sui due motori, nel punto deciso;
  la sparkline LVGL riempita; una finestra aperta con la fascia «Dati in ritardo» accesa, poi chiusa e
  riaperta dieci volte (il velo non deve far cadere il viewer).
- **Finestra pompa** dai gemelli: titolo tradotto e «Dettaglio di <nome>» col nome vero, con e senza
  parametri, web e LVGL.
- **Bottone con funzione** su LVGL: la funzione gira (si vede nel registro del runtime) e l'esito
  negativo si vede come deciso.
- **Guardie**: `scripts/check_templates.sh` e `scripts/check_demo_templates.sh` a zero; `cargo test` e
  `vitest` verdi (i test di `mini_serie.rs` che fissano `SCALA_Y / 2` vanno aggiornati con la scelta).
