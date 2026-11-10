# I viewer dopo il viewer leggero: animazioni, disegno e protocollo dei tag (seme)

> Nato il 10-11-2026 da `Appunti.txt` (punti del 27-10, 28-10 e 09-11-2026), quando il maintainer
> ha chiesto di trasformare gli appunti in semi e piani e di eliminare il file.

**Stato: seme — decisione.** Quando questo lavoro comincerà, il primo passo è una sessione di plan
approfondita e dedicata, per sviscerarne tutti i dettagli. Quello che segue è il materiale raccolto
(misure, righe di codice, strade possibili), non un progetto.

## Da dove viene

Sono le code di prestazioni e di protocollo rimaste fuori dal piano
[viewer leggero](../2026-11-09-viewer-leggero.md) (§7 «Se non basta: l'iscrizione per oggetto» e
§13 «Fuori ambito»), più due misure sul WP630 del 27-10-2026 fatte col piano archiviato
[dove se ne va il tempo](../../archive/2026-10-26-dove-se-ne-va-il-tempo.md), e un conteggio mai
rifatto dal piano archiviato
[cosa sta succedendo nell'IDE](../../archive/2026-10-28-cosa-sta-succedendo-nell-ide.md).

Tutti i punti hanno una cosa in comune: il lavoro facile è già stato fatto, e quello che resta
cambia l'aspetto (animazioni, resa dei tubi), la piattaforma (DRM o SDL) o il protocollo WebSocket
dei tag (server, due viewer, relay, IDE). Per questo è un seme e non un piano.

## La regola d'ingaggio (decisa dal maintainer il 09-11-2026)

**Per la 2.26.0-rc.10 si accetta così.** Il profilo del ramo B del viewer leggero (copia a 10 Hz,
CPU ×6) dice che il nostro codice ora pesa poco — script 4,3 s ogni 30 s, React al 6% — e che il
resto, circa il 40% del thread, è pittura e layout del browser a ~20 fotogrammi al secondo:
l'animazione dei tubi e i valori a 10 Hz.

Si riprende **quando sarà un problema vero**, e allora **con un occhio a tutte le animazioni**
(flusso dei tubi, lampeggio, moto lungo un percorso, dissolvenze delle foto, barre), non solo ai
tubi. Parole del maintainer: «vorrei analizzare la cosa quando sarà un vero problema e in quel caso
con un occhio a tutte le animazioni».

Cosa vuol dire «problema vero», preso dal §7 del piano viewer leggero: la copia a 10 Hz resta al
25% o più a ×6; l'IDE su CasaDomotica resta lento quando si trascina o si scrive; una pagina con
centinaia di oggetti mostra il ciclo della radice nel profilo. Oppure, per la regola di `CLAUDE.md`
del 09-11-2026, qualcosa che chi sta davanti al pannello vede: un pannello che smette di
rispondere, un dato vecchio mostrato come buono.

## A. Viewer web — animazioni e ciclo di disegno

### A1. Il flusso dei tubi costa 59 ricalcoli di stile al secondo per tubo (09-11-2026, banco del ramo A)

Sul template Montagna a 1 Hz, CPU ×6, una finestra di giorno arriva al 25,3% contro il 25% del §9
del piano viewer leggero. Quasi tutto è fuori dallo script: è l'animazione `sws-flow`
(`stroke-dashoffset` in CSS, `sws-editor/src/canvas/SvgCanvas.tsx`, il ramo `pipe_flow`; il
10-11-2026 i `@keyframes sws-flow` e `sws-flow-rev` sono a :1999-2000 e il ramo `pipe_flow` a
:4522-4539, con `animation: ... 0.8s linear infinite`). Non si compone sulla GPU: ricalcola stile e
pittura a ogni fotogramma, solo quando FV e inverter producono.

Strade viste:
- una `steps(8)` nell'animazione: 10 aggiornamenti al secondo invece di 60, più a scatti;
- un tratteggio che si muove con un `transform`, che si compone sulla GPU.

È una scelta d'aspetto, quindi del maintainer. Il viewer LVGL anima il flusso a modo suo e non è
toccato da questa scelta.

### A2. Il ciclo della radice di `SvgCanvas` resta O(oggetti) a ogni messaggio (09-11-2026, revisione del ramo B)

Per ogni oggetto gira `stesseDipendenze` (`sws-editor/src/canvas/SvgCanvas.tsx`, il 10-11-2026 a
:3675, usata dal memo a :3641), e ogni `<g>` involucro riceve uno `style` e un `onPress` nuovi (il
ciclo `ordinati.map`, l'appunto diceva «intorno a :2060-2200», il 10-11-2026 comincia a :2065).
Quindi React aggiorna sempre il DOM anche quando il memo salta l'oggetto. Nel profilo con 300
oggetti e React di produzione: `updateProperties` 385 ms e `commitHostUpdate` 227 ms.

I costi facili sono stati tolti il 09-11-2026: elenco fisso delle prop, lucchetto in cache, ordine
in `useMemo`. Il resto è il §7 del piano viewer leggero — un involucro per oggetto, iscritto da solo
allo store con `useSyncExternalStore` sulle sue dipendenze — e si apre solo se una pagina con
centinaia di oggetti lo mostra nel profilo. Il banco del ramo B dice che il collo di bottiglia ora è
la pittura del browser (punto A1), non il nostro JavaScript.

## B. Viewer LVGL sul WP630 — rasterizzazione dei tubi e copia sullo schermo (misure del 27-10-2026)

### B1. Il corpo del tubo si rasterizza da un SVG a ogni passo del moto: 12 ms per ridisegno

Misurati il 27-10-2026 sul WP630 con la pagina Prestazioni aperta mentre la pompa scorreva: 24
ridisegni su 58 fotogrammi, cioè 4,9 ms per fotogramma su 35 totali, e l'84% della fase «tag e
collegamenti». Il maintainer ha guardato il movimento sul pannello e ha detto che visivamente va
bene: non è un problema oggi, si annota per quando lo diventerà.

Il codice è `CorpoSvg::disegna` in `sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs`.
L'appunto diceva «intorno a riga 10200»; il 10-11-2026 `pub struct CorpoSvg` è a :12640,
`impl CorpoSvg` a :12702 e `fn disegna` a :12805. Costruisce una stringa SVG, la fa analizzare da
`usvg` e la rasterizza con `resvg` (pixmap `tiny_skia`) dentro `update_bindings` (:16642).

Il rimedio sarebbe disegnare il corpo con le primitive di LVGL invece che con un SVG. Vale al
massimo 4,9 ms su 35, cioè da 28 a circa 33 fotogrammi al secondo. Il prezzo da valutare allora: gli
stili ricchi (materiali, volume, contorno) con le primitive non si rifanno uguali, quindi o si
accetta una resa diversa sul pannello, o si tiene l'SVG per quegli stili e le primitive per i
semplici. Decisione del maintainer.

**Non vale la pena toccare i bocchettoni** (`ExtraTubo`, stesso file, il 10-11-2026 a :12470): nella
stessa misura non compaiono affatto, cioè in quei secondi non sono stati rifatti.

### B2. La copia sullo schermo si mangia il fotogramma del pannello: 23 ms su 35, a ogni fotogramma

Misurati sul WP630 il 27-10-2026. Da sola tiene il pannello sotto i 43 fotogrammi al secondo anche
se tutto il resto fosse gratis: è il tetto vero, sopra qualunque ottimizzazione del disegno
(compresa B1).

Sul WP630 il viewer passa da SDL con `SDL_VIDEODRIVER=x11` — il Wayland nativo di SDL2 va in
SIGSEGV su questo hardware, vedi Q14 in [`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md) — dentro un
container. La fase misura quindi `Surface::from_data` + blit + `SDL_UpdateWindowSurface`, cioè uno
`ShmPutImage` di 1280x800 in software.

Da guardare quando servirà più fluidità:
- il percorso DRM diretto, che oggi non si usa perché non convive con weston;
- capire se il blit può saltare la copia intermedia.

Sul percorso DRM c'è un secondo sospetto, già scritto nel piano archiviato
[dove se ne va il tempo](../../archive/2026-10-26-dove-se-ne-va-il-tempo.md):
`DrmDisplay::flush_rgb888` (`sws-runtime/crates/sws-lvgl-viewer/src/drm_display.rs`, il 10-11-2026 a
:321) riscrive il buffer un byte alla volta — ~1 milione di pixel × 4 scritture, dopo una copia da
3 MB (1280×800×3) che `copy_frame_rgb888` (`sws-runtime/crates/sws-lvgl-viewer/src/lvgl_display.rs`,
il 10-11-2026 a :99) fa a ogni giro anche a schermo fermo.

## C. Il protocollo WebSocket dei tag

Questi due punti cambiano il protocollo `/ws/tags`, che hanno in comune il server, il viewer web,
il viewer LVGL, il relay remoto e l'IDE. Non si fanno uno per volta: una sessione di plan deve
decidere il formato una volta sola.

### C1. Un socket dei tag vivo ma muto non si vede (09-11-2026, revisione del ramo A del viewer leggero)

Con il cavo del pannello staccato la connessione TCP resta aperta per minuti. Il server (`handle_ws`
in `sws-runtime/crates/sws-web/src/router.rs`, il 10-11-2026 a :9212) non manda ping, e il batcher
manda solo quando ha voci. Il viewer web (`sws-editor/src/ws/tagStream.ts`) reagisce solo a `close`
(:123). Il viewer LVGL (`spawn_tag_subscription` in `sws-runtime/crates/sws-lvgl-viewer/src/client.rs`,
il 10-11-2026 da :1611 a :1752) non ha un tempo massimo di silenzio.

Per tutti e due è un «impianto fermo col socket vivo», e la fascia «Dati in ritardo» non si accende.

Servirebbe un battito: un frame leggero dal server ogni 2 s anche senza voci
(`{"type":"tick","ts":…}`), e nei due client il socket vale giù dopo 5 s di silenzio. Cambia il
protocollo WS: prima una sessione di plan. Intanto il collaudo prova la fascia fermando il runtime
(piano viewer leggero, §10).

### C2. Il server manda tutti i delta finché non arriva un subscribe (09-11-2026, revisione del ramo B)

Il filtro nasce vuoto, cioè «tutti» (`sub_cell` in `sws-runtime/crates/sws-web/src/router.rs`;
l'appunto diceva :9311-9312, il 10-11-2026 è a :9317), e un subscribe `[]` vale lo stesso «tutti»
(l'appunto diceva :9475; il 10-11-2026 è a :9478-9485: `tags.is_empty() || tags.iter().any(|t| t ==
"*")` → `None // all tags`).

Quindi all'avvio il viewer riceve tutti i tag finché non arrivano le pagine (`getProject`,
`listSynoptics`, N `getPaginaComposta`), e una pagina senza tag non può chiedere «niente».

Il rimedio è un default «niente finché non chiedi», o un subscribe che voglia dire «nessuno». Tocca:
- il protocollo;
- il relay remoto (`/ws/remote/*`);
- l'IDE, che manda già `["*"]` a ogni apertura;
- il viewer LVGL, che non manda mai subscribe (`client.rs`, l'appunto diceva :1630-1760, oggi la
  funzione è :1611-1752).

Dal lato client resta fatto quel che si poteva: la lista della pagina si rimanda a ogni apertura e
una lista uguale non si rimanda (`sws-editor/src/ws/tagStream.ts`). Il §13 del piano viewer leggero
lo annotava solo per la pagina senza tag.

## D. Le richieste `/api/history` dal cloud — da ricontare (rimedio del 28-10-2026, mai misurato dopo)

La misura di partenza c'è: ~17 richieste al secondo da una sola scheda del browser sul progetto
aperto in `sws.soligo.net`, alcune da 24 ore di storico ogni due secondi, per sempre, viste nella
scheda Network mentre si guardava altro.

Il rimedio è in `periodoPolling()` dentro `sws-editor/src/canvas/TrendCanvas.tsx` (il 10-11-2026 a
:46, usata a :517): i trend non ricaricano più spesso di quanto si muova un pixel del grafico (tetto
a un minuto), e a scheda nascosta non chiedono niente. Sulla carta 24 ore su 600 px passano da una
richiesta ogni 2 s a una al minuto, cioè settantadue volte meno. Nessuno però ha riaperto la scheda
Network per vederlo.

Serve farlo, perché quelle raffiche si mangiavano le sei connessioni per host di Chrome ed erano un
sospetto per i WebSocket che faticavano nel cloud. Il piano archiviato
[cosa sta succedendo nell'IDE](../../archive/2026-10-28-cosa-sta-succedendo-nell-ide.md), punto 5,
dice nella sua «Verifica» che riaprire Network e contare le `/api/history` è l'unica misura che
chiude il punto.

Se dopo la misura il flusso resta pesante, i due rimedi veri vogliono il backend:
- chiedere solo i campioni nuovi invece di rileggere la finestra intera;
- una richiesta sola per più tag invece di una per tag.

## E. Le altre code del §13 del piano «viewer leggero» (09-11-2026)

Il §13 del [piano](../2026-11-09-viewer-leggero.md) elencava le cose viste nelle revisioni dei rami A e B e lasciate
fuori. Tre sono già sopra (il battito, il subscribe `[]` che vale «tutti», LVGL che non manda mai `subscribe` e clona la
mappa a ogni fotogramma — C1 e C2) e una è entrata nel ramo A (la crescita delle mini tendenze LVGL, §5-bis). Le altre
non erano mai arrivate in `Appunti.txt`: stanno qui dal 10-11-2026, così il piano si può archiviare senza perderle. I
numeri di riga sono quelli del 09-11-2026.

- Il viewer web ignora `project_changed` (`sws-runtime/crates/sws-web/src/router.rs:9333-9339`) e chiede l'impronta del
  progetto ogni 3 s (`sws-editor/src/…/projectWatcher.ts:107`).
- `ReconnectingWs` smette di ritentare dopo circa 61 s (`reconnectingWs.ts:40`, :100-108) e non avvisa nessuno
  (`singletonWs.ts:38`).
- `KpiDelta` fa 2 richieste ogni 30 s per riquadro: basterebbe una sola `getHistoryBuckets` a due secchielli.
- `XyPlotCanvas` ha un intervallo da 200 ms per oggetto, anche a impianto fermo (`XyPlotCanvas.tsx:126-144`).
- Le miniature del `LeftPanel` (:393-399) montano kpi vive, che chiedono storico e statistiche.
- In edit i figli di griglie e faceplate girano con `isEditMode=false` (`SvgCanvas.tsx:6787`, :6965); `data_log` in edit
  mostra un segnaposto (:6178-6182). Sono divergenze dalla regola UI 1 di `CLAUDE.md` (WYSIWYG).
- Un faceplate dentro una cella di griglia non riceve `faceplates` (`SvgCanvas.tsx:6781-6791`).
- Nell'IDE `TagsTab` (:254) e `AlberoTagLive` (:54) si ridisegnano a ogni messaggio del socket.

## Le opzioni già visibili, in breve

| Punto | Costo misurato | Strada | Chi decide |
|---|---|---|---|
| A1 flusso dei tubi (web) | 59 ricalcoli/s per tubo; finestra di giorno 25,3% a ×6 | `steps(8)` o tratteggio con `transform` | maintainer (aspetto) |
| A2 ciclo della radice (web) | `updateProperties` 385 ms + `commitHostUpdate` 227 ms su 300 oggetti | involucro per oggetto (§7 viewer leggero) | profilo, solo se compare |
| B1 corpo del tubo (LVGL) | 12 ms per ridisegno, 4,9 ms/fotogramma su 35 | primitive LVGL, o miste SVG+primitive | maintainer (resa) |
| B2 copia sullo schermo (LVGL) | 23 ms su 35, ogni fotogramma, tetto ~43 fps | DRM diretto, o blit senza copia; `flush_rgb888` | piattaforma |
| C1 battito del socket | cavo staccato: minuti senza avviso | `tick` ogni 2 s, giù dopo 5 s | protocollo |
| C2 default «tutti» | tutti i tag all'avvio e per le pagine senza tag | default «niente», o subscribe «nessuno» | protocollo |
| D `/api/history` | ~17 richieste/s prima; previsto 72 volte meno | ricontare; poi campioni nuovi e richiesta per più tag | misura, poi backend |

## Perché serve la sessione di plan

- C1 e C2 cambiano il formato dei messaggi di `/ws/tags`: ogni consumatore (viewer web, viewer
  LVGL, relay `/ws/remote/*`, IDE) va aggiornato nello stesso giro, e un battito e un default
  diverso si disegnano insieme, non in due rami separati.
- A1 e B1 sono scelte d'aspetto: come si vede il flusso, come si vede un tubo «ricco» sul pannello.
  Vanno mostrate al maintainer prima di scrivere codice, come per le revisioni degli oggetti.
- B2 è una scelta di piattaforma (DRM contro SDL/x11 sotto weston) e dipende dall'hardware del
  pannello.
- La regola del 09-11 chiede di guardare **tutte** le animazioni insieme, non un tipo alla volta.

**Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita e dedicata,
per sviscerarne tutti i dettagli.**
