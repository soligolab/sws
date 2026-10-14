# Libreria di simboli SCADA 2.5D, e il motore che li anima

> **Seme — decisioni prese il 14-10-2026, nessun codice scritto.** Lo stile grafico è approvato
> («mi piace molto»). Le decisioni qui sotto vengono da 21 domande a risposta multipla, una alla
> volta, più la revisione finale che le ha confrontate con la tavola dei campioni.
>
> **Quando questo lavoro comincia, il primo passo è una sessione plan dedicata e approfondita sul
> motore** (le parti vive legate ai tag, su web e LVGL, e lo stile del progetto). Va fatta prima di
> disegnare il resto della libreria, perché è il motore a dettare come si scrive un SVG. Il
> maintainer ha scelto «prima il motore, poi i disegni». Questo file fissa *cosa* si vuole; il
> *come* lo decide quella sessione, rimisurando il codice di allora.

**Origine**: richiesta del maintainer del 12-10-2026: «ho bisogno che mi ricrei una collezione di
immagini per SCADA organizzate per tipologia, ispirate a
<https://aggregate.digital/products/scada-hmi/symbol-library.html>». Da AggreGate si prende la
tassonomia e lo spirito 2.5D. **I disegni sono tutti originali**: i loro sono proprietari.

**Prototipo** in [`2026-10-14-libreria-simboli-scada/`](2026-10-14-libreria-simboli-scada/):
- `gen.py` genera i 16 campioni (uno per tipologia) in `svg/`;
- `build_page.py` e `page_template.html` costruiscono la tavola di confronto, con la ricolorazione
  di `body`, i tre fondi e il confronto browser/resvg.

La tavola è pubblicata come artifact privato del maintainer:
<https://claude.ai/artifact/BjDtv35fbe69bpBWyBBvkn>.

I campioni sono **prima della revisione**: nomi in italiano e acciaio con le sfumature
incorporate. Vanno rigenerati con le regole qui sotto, vedi «Cosa cambia rispetto alla tavola».

## Decisioni del maintainer (14-10-2026)

| # | Domanda | Scelta |
|---|---|---|
| — | Cosa sono | dapprima «immagini pronte per gli stati», poi superata dalla 11: **simboli** |
| — | Stile | **2.5D industriale**: sfumature metalliche, luce dall'alto a sinistra |
| — | Famiglie | Processo e fluidi · Elettrico ed energia · Macchine e movimentazione, più **Edificio e HVAC** (vedi 16) |
| 1 | Organizzazione | **un gruppo per famiglia** (pensato per il catalogo immagini, ora vale per la palette dei simboli) |
| 2 | Nomi | **file in inglese, etichette tradotte** it/en |
| 3 | Varianti di forma come file | **annullata in revisione**: le posizioni le dà il tag (10), un file per oggetto |
| 4 | Colore dei corpi | **per famiglia** (pompe blu, motori grigi, armadi RAL 7035, serbatoi inox, mezzi gialli) |
| 5 | Scala | **nessuna dimensione standard**: sono vettori, il viewBox è solo l'unità di disegno |
| 6 | Orientamento | **un verso canonico** (flusso da sinistra a destra) **+ lo specchio dell'editor** |
| 7 | Contorno | **scala con l'immagine** (niente `non-scaling-stroke`: resvg non lo applica) |
| 8 | Fondo | **disegnati per fondo chiaro o grigio**; per il fondo scuro c'è il contorno nello stile del progetto (17) |
| 9 | Riempimento | **dinamico, legato a un tag** → **prima il motore, poi i disegni** |
| 10 | Parti vive | **tutte**: livello, colore di stato, rotazione, spie e posizioni (leve, lancette, coltelli) |
| 11 | Nel sinottico | **un oggetto `symbol`** (`symbol_id` tipo `lib:<famiglia>/<slug>`), con la sezione proprietà che i builtin hanno già |
| 12 | Pannello LVGL | **parità completa** col web, rotazione compresa |
| 13 | Distribuzione | **nel prodotto, versionata con SWS**: il progetto salva solo il riferimento |
| 14 | Sorgente | **generatore nel repo**: palette, gradienti e convenzioni in un punto solo |
| 15 | Licenza | **AGPL-3.0-only** come il resto; niente scheda in `third-party/` |
| 16 | I 40 builtin | **la libreria li sostituisce** (migrazione), con una quarta famiglia «Edificio e HVAC» per i sette che restavano fuori |
| 17 | Stile del progetto | **tutti e quattro i gruppi**: colori di stato, colori dei materiali, resa (volume e contorno), animazioni |
| 18 | Precedenza | **progetto, con eccezione per oggetto**: come i colori «auto», valore effettivo mostrato «da progetto», toccarlo lo rende esplicito |
| 19 | Lista dei simboli | **scritta qui sotto, il maintainer la corregge in questo file** |

## Specifiche grafiche (dopo la revisione)

- **Vista** ortogonale, frontale o laterale, senza prospettiva. **Luce** dall'alto a sinistra. Niente
  ombre portate: il volume lo fanno le sfumature.
- **Unità di disegno**: viewBox in multipli di 10, e proporzioni coerenti tra gli oggetti (una valvola
  è più piccola di una pompa). Non è una dimensione a schermo. L'unico limite è quello del pannello,
  che rasterizza fino a 512 px per lato (`svg_raster.rs:80`).
- **Attacchi**: l'asse di ogni bocchello sta su un multiplo di 10 ed è a filo del bordo, in
  proporzione al tubo standard dell'editor (8 unità): bocchello 10, flangia 14–16 × 4. Ingresso a
  sinistra, uscita a destra o in alto.
- **Contorno**: `#1c2329`, 1 unità, giunti arrotondati, scala con l'immagine. I dettagli (saldature,
  alette, fasci tubieri) usano lo stesso tratto semitrasparente. Colore e spessore relativo si possono
  cambiare dallo stile del progetto.
- **Materiali: colore piatto più velo, ovunque.** È il cambiamento principale rispetto alla tavola,
  vedi sotto. Ogni parte ha un colore piatto preso da un materiale con nome (acciaio, acciaio scuro,
  inox, gomma, vetro, liquido, più il colore del corpo di famiglia). Il volume è un velo sovrapposto
  di bianchi e neri trasparenti. Così lo stile del progetto può ritingere un materiale e regolare il
  volume da 0 (flat, stile ISA-101) a 100 su **tutta** la figura.
- **Struttura SVG**:
  - `<g id="body">` col fill ereditato dai figli. Non è mai auto-chiuso, perché `applyStateColor` in
    `customSvg.ts:138` riscrive il tag di apertura.
  - Le parti vive hanno id fissi e dichiarano la loro geometria. Il formato lo decide la sessione sul
    motore. Le parti sono `level` (finestra del contenuto, clip per silos e tramogge), `rotor` (centro),
    `needle` (perno e arco, per esempio 225° → −45°), `lever` e i coltelli (perno e due posizioni),
    `lamp-*` e `led`.
  - Gli id dei gradienti hanno come prefisso il nome del file, così più simboli inline nella stessa
    pagina non collidono.
- **Vietato**:
  - `<text>`, perché il pannello non ha font;
  - `<style>` e `animate*`, che il sanitizer di `customSvg.ts` toglie;
  - filtri e raster incorporati, che resvg salta in silenzio, lasciando un'immagine trasparente;
  - metadati di Inkscape.

  Sono ammessi solo attributi di presentazione, gradienti e `<use href="#…">` interni.
- **Nomi**: `kebab-case` in inglese (`centrifugal-pump.svg`). L'etichetta va in `it.json`/`en.json`.

## Cosa cambia rispetto alla tavola (revisione del 14-10)

1. **Simboli, non immagini del catalogo**: `gen-catalog.js`, `fetch-image-catalog.sh` e `third-party/`
   non c'entrano più. I gruppi per famiglia diventano gruppi nella palette dei simboli.
2. **Nomi in inglese**: i 16 file del prototipo vanno rinominati.
3. **Niente «taglie»**: nella tavola le dimensioni del viewBox sono presentate come taglie, e non lo sono.
4. **Le parti vive dichiarano la geometria**: nella tavola livello (60%) e lancetta sono valori fissi.
5. **Acciaio, basamenti, gomma e vetro passano a colore piatto più velo.** Nel prototipo hanno
   sfumature con colori incorporati (`steel-v`, `dark-v`, `rubber-r`…), che né la tinta né il volume
   del progetto potrebbero toccare. L'aspetto deve restare quello approvato: è la prima verifica
   quando si rigenera.
6. **Le varianti di forma non si fanno** (domanda 3 annullata).
7. **Quarta famiglia «Edificio e HVAC»**, perché la sostituzione dei builtin sia completa.

## Misurato nel codice il 12–14-10-2026

- **Immagine**: `SvgCanvas.tsx:6384` disegna un `<image href>` chiuso, quindi niente stato. Su LVGL,
  `svg_assets.rs` + `svg_raster.rs` rasterizzano tutto il file con resvg 0.45 senza feature
  (`sws-lvgl-viewer/Cargo.toml`), sempre in modalità *contain*, e ignorano `image_fit`.
- **Builtin**: i 40 di `SYMBOLS` (`library.tsx:807`), in JSX su viewBox 0..100, sono ridisegnati a mano
  su LVGL in `draw_symbol` (`lvgl_render.rs:8937`). Stati: `state_tag`, `alarm_tag`, `symbol_states`
  (N stati), `fill_level`/`fill_level_tag`/`fill_level_scale` (solo tank e silo), `symbol_spin*`.
- **Custom**: `applyStateColor` (`customSvg.ts:138`) ricolora gli id in `colorable_ids`, ma **solo sul
  web**. LVGL rasterizza senza colore e mostra lo stato solo col bordo di allarme.
- **Colori**: oggi non esiste uno stile di progetto. C'è una tabella unica di predefiniti per tipo
  (`coloriPredefiniti.ts`, fonte `tests/fixtures/colori-predefiniti.json`, confrontata anche da
  LVGL), il colore esplicito per oggetto e, dall'11-10, le variabili `color` legabili a `fill` e allo
  sfondo della pagina ([piano](2026-10-11-colore-e-assegnazioni.md)). Lo stile del progetto (17, 18) è
  un livello nuovo fra la tabella e l'oggetto.
- **Prova resvg**: i 16 campioni rasterizzati con un programmino su resvg 0.45.1 senza feature (lo
  stesso del viewer) si disegnano tutti, con gradienti, `<use>` e opacità. È servito a confermare
  che la tecnica regge sul pannello.

## Per la sessione sul motore — le domande da sviscerare

Le domande vengono già con quello che è stato visto, non con le risposte:

- **Composizione su LVGL con parità completa (12).** Strato statico rasterizzato una volta e parti
  vive rasterizzate a parte: il rotore come immagine ruotata da LVGL, il livello come rettangolo
  ritagliato o ri-rasterizzato a scatti. Sono da misurare sui PX30 il costo della rotazione continua
  e la memoria di uno strato per parte.
- **Dove si dichiara la geometria delle parti**: attributi `data-*` dentro l'SVG (il sanitizer li
  lascia passare) o un manifesto JSON accanto, prodotto dal generatore.
- **Lo stile del progetto in `project.yaml`**: struttura dei quattro gruppi, rapporto con
  `colori-predefiniti.json` e con le variabili `color` (un materiale legabile a una variabile?), dove
  si modifica nell'IDE. Le regole UI dell'editor valgono anche qui: WYSIWYG e una sezione per dato.
- **Migrazione dei 40 builtin (16)**:
  - alias dal vecchio `symbol_id` al nuovo `lib:…`;
  - proporzioni diverse dal vecchio quadrato 0..100: gli oggetti esistenti hanno `width`/`height`
    fissati, quindi *contain* o adattamento;
  - aspetto che cambia su tutti i sinottici in campo, e come lo si annuncia (`NOVITA.yaml`);
  - eliminazione del disegno a mano in `draw_symbol` e delle guardie collegate
    (`check_lvgl_symbols.sh`, `check_simboli_lvgl.sh`).
- **Distribuzione (13)**: come il pannello riceve la libreria (nell'immagine del runtime, servita come
  oggi gli SVG del viewer) e cosa fa un pannello più vecchio davanti a un `lib:` che non conosce.
- **Animazioni sul web** senza `animate*` (vietato dal sanitizer): trasformazioni CSS come già fa
  `symbol_spin`, e la stessa curva per livello e lancetta.
- **Le guardie nuove** per `check_static.sh`: gli SVG committati corrispondono al generatore (14);
  ogni simbolo ha `body` e le parti dichiarate; nessun costrutto vietato; ogni simbolo si disegna su
  LVGL nel tempo massimo.

## La lista dei simboli (domanda 19 — da correggere qui)

★ = sostituisce un builtin esistente, col suo id tra parentesi. Sono 40 su 40. Etichette in italiano
per leggibilità: il file avrà lo slug inglese.

### Processo e fluidi (68)

- **Pompe (9)**:
  - ★ `centrifugal-pump` (pump)
  - `inline-pump`, `submersible-pump`, `gear-pump`, `screw-pump`, `diaphragm-pump`,
    `peristaltic-pump`, `dosing-pump`, `piston-pump`
- **Valvole (13)**:
  - ★ `ball-valve` (valve), ★ `check-valve` (check_valve), ★ `three-way-valve` (valve_3way),
    ★ `relief-valve` (relief_valve), ★ `motorized-valve` (valve_motorized),
    ★ `pneumatic-valve` (valve_pneumatic)
  - `butterfly-valve`, `gate-valve`, `globe-valve`, `pressure-reducing-valve`, `needle-valve`,
    `solenoid-valve`, `handwheel-valve`
- **Serbatoi e reattori (13)**:
  - ★ `vertical-tank` (tank), ★ `silo` (silo), ★ `mixing-tank` (mixer), ★ `agitator` (agitator),
    ★ `jacketed-reactor` (reactor)
  - `horizontal-tank`, `tank-on-legs`, `conical-tank`, `hopper`, `open-basin`, `drum`, `ibc-tote`,
    `gas-cylinder`
- **Scambio termico (7)**:
  - ★ `shell-tube-exchanger` (heat_exchanger), ★ `boiler` (boiler), ★ `furnace` (furnace),
    ★ `cooling-tower` (cooling_tower)
  - `plate-exchanger`, `coil-exchanger`, `air-cooled-condenser`
- **Filtri e separatori (7)**:
  - ★ `cartridge-filter` (filter), ★ `y-strainer` (strainer), ★ `cyclone` (cyclone),
    ★ `separator` (separator), ★ `column` (column)
  - `bag-filter`, `centrifuge`
- **Strumenti (10)**:
  - ★ `pressure-gauge` (pressure_indicator), ★ `thermometer` (temperature_sensor),
    ★ `magnetic-flowmeter` (flow_meter), ★ `radar-level-sensor` (level_sensor)
  - `turbine-flowmeter`, `coriolis-flowmeter`, `rotameter`, `pressure-transmitter`,
    `float-switch`, `ph-analyzer`
- **Tubi e raccordi (9)**: `pipe-straight`, `elbow-90`, `elbow-45`, `tee`, `cross`, `reducer`,
  `blind-flange`, `coupling`, `flexible-hose`

### Elettrico ed energia (26)

- **Motori (5)**:
  - ★ `electric-motor` (motor)
  - `electric-motor-front`, `gear-motor`, `servo-motor`, `dc-motor`
- **Quadri e automazione (7)**:
  - ★ `circuit-breaker` (breaker)
  - `electrical-cabinet`, `electrical-cabinet-open`, `push-button-station`, `plc`, `vfd`,
    `hmi-panel`
- **Distribuzione (7)**:
  - ★ `transmission-tower` (transmission_tower)
  - `transformer`, `substation`, `utility-pole`, `mv-switchgear`, `distribution-board`,
    `energy-meter`
- **Generazione e accumulo (7)**:
  - ★ `solar-panel` (solar_panel), ★ `battery-rack` (battery)
  - `pv-inverter`, `wind-turbine`, `generator-set`, `ups`, `ev-charger`

### Macchine e movimentazione (34)

- **Nastri (6)**:
  - ★ `belt-conveyor` (conveyor)
  - `roller-conveyor`, `screw-conveyor`, `bucket-elevator`, `chain-conveyor`, `curved-conveyor`
- **Movimentazione (8)**: `forklift`, `pallet-jack`, `agv`, `overhead-crane`, `hoist`,
  `industrial-robot`, `pallet`, `parcel`
- **Macchine e aria (10)**:
  - ★ `axial-fan` (fan), ★ `blower` (blower), ★ `screw-compressor` (compressor)
  - `centrifugal-fan`, `piston-compressor`, `air-receiver`, `press`, `cnc-machine`, `extruder`,
    `mill`
- **Sensori (6)**: `photoelectric-sensor`, `inductive-sensor`, `limit-switch`, `light-curtain`,
  `encoder`, `load-cell`
- **Segnalazione (4)**: `stack-light`, `siren`, `beacon`, `emergency-stop`

### Edificio e HVAC (10)

- ★ `heat-pump` (heat_pump), ★ `chiller` (chiller), ★ `ceiling-light` (home_lightning),
  ★ `garage-door` (garage), ★ `window` (window_open), ★ `roller-shutter` (roller_shade)
- `air-handling-unit`, `fan-coil`, `radiator`, `thermostat`

**Totale: 138 simboli**, di cui 40 sostituiscono i builtin.

## Ordine dopo il motore

1. Rigenerare i 16 campioni con le regole riviste (inglese, materiali piatti più velo, geometria
   delle parti dichiarata), e far confermare al maintainer che l'aspetto non è cambiato.
2. I 40 che sostituiscono i builtin, perché sbloccano la migrazione.
3. Il resto della lista, a lotti per famiglia, uno per sessione.
