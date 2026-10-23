# Il tubo che segue gli oggetti mossi da una variabile

> **Era un seme, dal 22-10-2026 è un piano d'esecuzione.** Il seme nasceva il 21-10 dal punto 6
> del ramo B di [tubazioni, bocche e stili](../archive/2026-10-15-tubazioni-bocche-e-stili.md) e
> diceva di sé: «quando questo lavoro comincia, il primo passo è una sessione di plan
> approfondita». Quella sessione è stata fatta il 22-10-2026 **misurando il codice**, con tre
> esplorazioni indipendenti e uno scettico per ciascuna. Quello che segue è il risultato: il
> testo del seme resta in coda, perché è il motivo per cui il lavoro è nato.

## Quello che la misura ha cambiato rispetto al seme

Il seme sbagliava su tre cose, e tutte e tre spostano il lavoro.

**1. «Sul web il percorso usa le posizioni risolte dai binding» — falso.** Le posizioni risolte
esistono (`resolveObject`, `SvgCanvas.tsx:547`), ma vivono **dentro il disegno del singolo
oggetto**, chiamate a `:3504` e `:3535`. Il tubo riceve l'array `objects` **grezzo**
(`SvgCanvas.tsx:2013` → `:4042`), e nel viewer quell'array è `currentPage?.objects ?? []`
(`RuntimeView.tsx:248`), cioè il progetto come sta nel file. La stessa frase sbagliata stava in
`docs/plans/README.md`, ed è il motivo per cui il lavoro sembrava metà di quello che è.

**2. Il difetto non è «il tubo non segue»: il tubo è staccato già al primo fotogramma.** Su LVGL
l'oggetto agganciato viene disegnato alla posizione risolta (`apply_bindings`,
`lvgl_render.rs:11754`) mentre il tubo viene calcolato su `&page.objects` grezzo (`:11764`). Con
un `bindings.x` su una pompa, **il tubo nasce già nel posto sbagliato**, prima che il tag cambi
anche una sola volta. Lo stesso vale sul web. Questo pezzo è un difetto puro, senza nessuna
decisione di prodotto dentro, e si chiude per primo.

**3. Le proprietà che muovono una bocca sono sette, non due.** `Riquadro`
(`sws-core/src/tubazioni.rs:25-35`) porta `x, y, w, h, rotation, flip_h, flip_v`, e tutte e sette
vengono riempite sia da `riquadroDi` (`tubazioni.ts:164-171`) sia da `ancora_di`
(`lvgl_render.rs:2362-2370`). Quindi un `width` o una `rotation` legati a un tag spostano un capo
esattamente come una `x`. Ma su LVGL `GEOM_KEYS` è `["x","y","width","height","visible"]`
(`lvgl_render.rs:1998`): `rotation`, `flip_h` e `flip_v` **non sono vive**, mentre sul web
`resolveObject` applica qualunque chiave. È una disparità che esiste già prima dei tubi.

**E una cosa che il seme dava per difficile e non lo è.** `instrada`, `Tappa` e `Capo` — il
tracciato a punti del 20-10 — sono funzioni **pure**: prendono punti e restituiscono punti,
senza stato, senza cache. Ricalcolarle a posizioni nuove non costa niente e non richiede di
toccarle. Il tracciato a punti non complica il lavoro.

**E una domanda che non va decisa, perché il codice l'ha già decisa.** «Il tubo resta attaccato
alla bocca, o alla posizione in cui la bocca era quando l'hai agganciato?» → **alla bocca**.
L'aggancio è un riferimento vivo (`from_obj_id` + `from_port`, `types/index.ts:719-727`) e il
punto scritto nel file per un capo agganciato viene sovrascritto a ogni disegno
(`tubazioni.ts:214-215`). Non esiste da nessuna parte una coordinata congelata.

## Cosa c'è già, e dove sta

| Pezzo | Dove | Stato |
|---|---|---|
| La matematica del percorso | `sws-editor/src/canvas/tubazioni.ts` (268 righe), `sws-core/src/tubazioni.rs` (384) | gemelli puri, fixture condivisa di 21 casi in `tests/fixtures/tubazioni.json` |
| L'aggancio vivo | `from_obj_id` + `from_port` | già un riferimento, non una coordinata |
| Il movimento continuo su LVGL | `LiveKind::Geometry` (`:544-564`), `LiveKind::Motion` (`:225-243`) | esistono, con il confronto che evita di ridisegnare da fermo |
| Un buffer di punti che cambia nel tempo | `LiveKind::PipeFill` | il modello giusto: `Vec` riusato invece di `Box::leak` |
| Un `LiveBinding` per ogni tubo, che gira a ogni fotogramma | `lvgl_render.rs:9099-9105` | possiede già `CorpoSvg`, `ExtraTubo`, il `Vec` del riempimento e le linee del corpo |

## Cosa manca, misurato

1. **Il collegamento, su tutti e due i motori.** `percorsoTubo` riceve `objects` grezzo;
   `percorso_tubo` riceve `&page.objects` grezzo.
2. **Su LVGL, l'indice di dipendenza.** `LiveBinding` ha un solo campo, `kind`: non porta l'id
   dell'oggetto, quindi non c'è modo di dire «questo tubo dipende da questi due oggetti».
3. **Su LVGL, la possibilità fisica di ridisegnare.** I punti del corpo sono `Box::leak`-ati a
   `:8901` perché «non cambiano mai». E i canvas 2.5D sono **due**, non uno — `CorpoSvg` (`:9284`)
   e `ExtraTubo` (`:9068`, estremità e flusso) — ognuno con il proprio pixmap dimensionato alla
   creazione. Se un capo si sposta fuori dal riquadro, servono canvas e pixmap nuovi.
   **Attenzione a come si racconta il costo**: la rasterizzazione resvg si paga *già oggi*, perché
   la cache di `ExtraTubo` ha per chiave `(colore, flusso)` e `flusso` si muove 25 volte al secondo
   su ogni tubo con `pipe_flow: true`. L'ostacolo non è «ridisegnare costa»: è «la dimensione è
   fissata alla creazione».
4. **Sul web, la posizione di un oggetto in `motion` non esiste in JavaScript.** Il motion è una
   CSS `offset-path` + `offset-distance` con `transition` (`SvgCanvas.tsx:1987-2008`): fra un
   campione e l'altro la posizione la calcola il **browser**. Non c'è nessun gemello TS di
   `punto_a_frazione`.

## Le tre fasi

> **Stato al 22-10-2026: Fase 1 e Fase 2 fatte**, con una guardia ciascuna che è stata provata
> rossa togliendo la correzione. Resta aperta la **Fase 3** (il `motion`), che è una decisione di
> prodotto e non si prende senza il maintainer.

### Fase 1 — il distacco al primo fotogramma — **fatta** *(nessuna decisione di prodotto)*

Il percorso di un tubo si calcola sulle **posizioni risolte** dei suoi capi, su tutti e due i
motori. `percorsoTubo` e `diametriCapi` (web), `percorso_tubo` e `diametri_capi` (LVGL) risolvono
i binding dei soli due oggetti agganciati — un'operazione O(1) per tubo, non una risoluzione
dell'intero array.

`tubazioni.ts` e `tubazioni.rs` restano **puri**: non sanno niente di tag. La risoluzione entra
come funzione passata dal chiamante (web) e come `&TagSnapshot` nelle due funzioni di
`lvgl_render.rs`, che già vive accanto ai tag.

Effetto collaterale previsto e da verificare: **sul web questo basta anche a far seguire il tubo
dal vivo**, perché `SvgObjectCorpo` si ridisegna a ogni cambio di `tagValues`. Se è così, la
Fase 2 resta un lavoro di solo LVGL.

### Fase 2 — su LVGL il tubo segue dal vivo — **fatta**

Il `LiveBinding` del tubo ricalcola il percorso quando cambiano le posizioni dei suoi capi. Serve:

- un indice tubo → oggetti agganciati, e la posizione corrente di quegli oggetti;
- il corpo del tubo da `Box::leak` a un `Vec` posseduto, come fa già `PipeFill`;
- la riallocazione di canvas e pixmap quando il riquadro cambia;
- la stessa soglia di «fermo: non toccare nulla» che usano già `Geometry` e `PipeFill`.

**Com'è venuta.** Il `LiveBinding` di ogni tubo (che c'era già, e gira a ogni fotogramma) porta
ora un `AncoreTubo`: il **pipe originale** — non quello che `interpret_page` ha già ancorato,
perché su un `routing: orthogonal` il ciclo sostituisce `points` con la polilinea completa e
ricalcolare su quella accartoccerebbe il tubo un po' di più a ogni giro — più i soli uno o due
oggetti agganciati e il manifesto. `mosso()` ricalcola `percorso_tubo` (matematica pura, costo
trascurabile) e risponde solo oltre il mezzo pixel.

Il tubo si iscrive **solo se** un suo capo è agganciato a un oggetto con un binding di geometria.
Senza quel filtro, `update_bindings` ricalcolerebbe a ogni fotogramma il percorso di ogni tubo
della pagina per non muovere mai niente.

Tre cose hanno dovuto cambiare sotto:

- i punti del corpo erano `Box::leak`-ati («non cambiano mai»): ora sono un `Vec` posseduto dal
  binding, e dopo ogni modifica si ri-chiama `lv_line_set_points`, perché `clear()` + `extend()`
  possono riallocare;
- i canvas 2.5D sono **due**, non uno — il corpo (`CorpoSvg`) e le estremità col flusso
  (`ExtraTubo`) — e ognuno ha un pixmap con la misura della creazione: se un capo esce dal
  riquadro vanno riallocati, o il tubo si vede tagliato;
- il conto del riquadro era scritto dentro i due costruttori: è uscito in `riquadro_corpo` e
  `riquadro_extra`, che creazione e riposizionamento chiamano **con la stessa riga**. Due copie
  di quel conto divergerebbero in silenzio, e il sintomo sarebbe un tubo giusto appena nato e
  tagliato dopo il primo spostamento.

**Il viewer ha imparato `--cambia-tag`.** Senza, questa fase non era verificabile da nessuna
guardia: il tempo di `--istantanea` è **simulato** (`lvgl::tick_inc`), e 4 secondi di LVGL costano
un decimo di secondo di orologio — un `curl` lanciato da uno script arriva sempre a viewer già
finito (misurato: `--istantanea-ms 60000` dura 0,15 s). L'opzione cambia i tag a metà fotografia,
con la pagina già disegnata, dove il WS li metterebbe. È della stessa famiglia di `--tocca`, e da
oggi **tutto ciò che vive in `update_bindings` è misurabile**, non solo i tubi.

### Fase 3 — il `motion` — **aperta** *(è una decisione di prodotto)*

Far seguire il tubo a un oggetto in moto continuo vuol dire, sul web, scegliere fra tre strade
che si vedono tutte e tre: reimplementare l'interpolazione in TypeScript (e il tubo **scatta**
mentre l'oggetto scivola), rinunciare alla transizione CSS, o leggere la geometria vera dal DOM a
ogni fotogramma. Nessuna delle tre si sceglie senza il maintainer davanti a un disegno.

## Le due decisioni prese senza il maintainer, da ribaltare se sbagliate

Il 22-10-2026 il maintainer ha detto «inizia, torno tra un po'». Queste due erano aperte, e sono
state decise per poter procedere:

1. **Il ricalcolo scatta al cambio di posizione, non per fotogramma.** È il modello che il codice
   usa già in due posti (`lvgl_render.rs:12944`, «fermo: non toccare nulla, o si ridisegna per
   niente»; `:12390`, la soglia percettiva di mezzo punto percentuale di `PipeFill`).
2. **I punti intermedi disegnati a mano restano dove sono**; si muovono solo i capi agganciati.
   `instrada` accetta già una lista di `Tappa` qualsiasi, quindi la scelta opposta costa poco se
   la si preferisce: è una domanda di prodotto («un gomito disegnato a mano trasla con l'oggetto o
   no?»), non un ostacolo tecnico.

## Il caso di prova

Nei gemelli `demo-items-*`, pagina **«Base e comandi»**: `o_ellipse` ha `bindings.x` su
`demo.cmd.slider`, scalato da 340 a 830. Non c'è nessun tubo agganciato a lui. Un tubo con
`from_obj_id: o_ellipse` rende il difetto visibile e la correzione verificabile su tutti e due i
motori, muovendo il cursore della stessa pagina.

In **«Allarmi e composizione»** c'è già `o_motion_path` (un `pipe`) con esattamente i tre punti
del `motion_path` di `o_motion`: è il binario disegnato dell'ellisse in moto. Quando si farà la
Fase 3, il caso di prova è **una riga**, `from_obj_id: o_motion`.

## Verifica — cosa è stato misurato davvero

| Prova | Dove | Provata rossa togliendo la correzione |
|---|---|---|
| Il capo segue i binding (web, da cima a fondo: `SvgObject` renderizzato) | `sws-editor/tests/tuboSegueOggetto.test.tsx` | sì — `M 150 200` invece di `M 550 200` |
| Il capo segue i binding (LVGL, `percorso_tubo` + `diametri_capi`) | `il_capo_agganciato_segue_i_binding_delloggetto` | sì |
| Il tubo fermo non si ridisegna, mezzo pixel non conta | `un_tubo_fermo_non_si_ridisegna` | — (è il cancello, non la correzione) |
| Un `orthogonal` si ricalcola dall'originale, non dal già-instradato | `un_tubo_instradato_si_ricalcola_dall_originale` | — |
| Il riquadro del canvas cresce col percorso | `il_riquadro_del_canvas_segue_il_percorso` | — |
| **Il tubo segue a pagina già aperta, sul motore LVGL vero, sui due disegni** | `scripts/check_tubo_segue_lvgl.sh` | **sì** — la premessa (il blocco si sposta) resta verde, solo i tubi restano indietro |

**Quello che nessuna guardia dice**, e che resta al maintainer: come si vede su un pannello vero.
Il caso è nei gemelli `demo-items-*`, pagina «Base e comandi» — si trascina il cursore e si guarda
il tubo fra il rettangolo e l'ellisse.

---

## Il testo del seme, com'era il 21-10-2026

> Un tubo agganciato alla bocca di un simbolo segue il simbolo quando lo si sposta **nell'editor**.
> Non lo segue quando a spostarlo è una **variabile** a runtime: un carrello su una rotaia, un
> braccio, una paratoia che scorre. Il tubo resta disegnato dov'era e si stacca da ciò che collega.
>
> Cosa diceva il piano del 15-10-2026: «Seguire gli oggetti mossi da una variabile: sul web il
> percorso usa le posizioni risolte dai binding; su LVGL si ricalcola quando cambia la posizione
> di un oggetto agganciato.»
>
> Domande lasciate alla sessione di plan: il ricalcolo è per fotogramma o solo quando la posizione
> cambia davvero? Cosa succede alla calamita? Vale anche per i punti intermedi disegnati a mano?
> Serve la parità web/LVGL dal primo giorno?
