# Il bottone: non più un rettangolo, ma la cosa vera

> **Seme — decisione.** Quando questo lavoro comincerà, la prima cosa è una **sessione di plan
> approfondita** per sviscerarne tutti i dettagli. Qui c'è l'idea del maintainer e quello che si è
> misurato nel codice il 14-10-2026.

## L'idea del maintainer (14-10-2026)

> «ora l'oggetto bottone è un rettangolo e basta. Negli SCADA il bottone esiste sia in questa
> versione sia come oggetto che rispecchi la realtà, interruttori a levetta, pulsanti etc…
> andrebbe esteso ampiamente questo oggetto per soddisfare tutte le reali necessità con una
> libreria ampia di opzioni tra cui scegliere.»

## Misurato il 14-10-2026: il comportamento c'è già, manca l'aspetto

**Il bottone sa già fare quasi tutto quello che deve fare.** `button_mode`
(`sws-editor/src/types/index.ts:395`) ha **sette modalità** — `write`, `momentary`, `toggle`,
`set`, `reset`, `increment`, `decrement` — e dall'11-10 ci sono anche le **assegnazioni
multiple**: un tocco scrive più variabili in ordine.

**Quello che non sa fare è assomigliare a qualcosa.** Il disegno
(`sws-editor/src/canvas/SvgCanvas.tsx:4134`) usa in tutto: `bg_color`, `color`, `corner_radius`,
`fill`, `stroke_width`, `label` e `bg_image`. Cioè **un rettangolo con angoli, un bordo,
un'etichetta e al massimo un'immagine di sfondo**. Non esiste nessuna nozione di *forma fisica*,
e nemmeno di **stato visivo**: il premuto e il rilasciato non hanno due disegni, hanno al massimo
due colori.

`bg_image` è oggi l'unica via per far sembrare il bottone un interruttore — e non basta, perché
è una immagine sola: non cambia con lo stato.

## La domanda che decide tutto il resto

**C'è un motore che fa già metà del lavoro, ed è un altro oggetto.** Il
[motore dei simboli di libreria](2026-10-14-motore-simboli-lib.md), deciso lo stesso giorno, ha
fra le sue **parti vive** proprio `lever` — la levetta — oltre a `body`, `lamp-*`, `needle`, e
gestisce gli stati `off`/`on`/`alarm` più una tavolozza a N stati.

Ma i due oggetti stanno su due lati opposti dello stesso vetro:

| | legge dai tag | scrive sui tag |
|---|---|---|
| **simbolo** | sì, si anima | **no** — verificato: nel disegno del simbolo non c'è nessuna scrittura |
| **bottone** | quasi no | sì, in sette modi |

Quindi la domanda da sciogliere nella sessione di plan non è «che forme disegniamo», è:

**si estende il bottone con una libreria di aspetti, oppure si rende il simbolo capace di
scrivere?**

Le due strade portano allo stesso risultato per chi usa l'IDE e a due programmi molto diversi:

- **estendere il bottone** vuol dire dargli un catalogo di aspetti con i propri stati, cioè
  ricostruire accanto al motore dei simboli qualcosa che gli somiglia molto;
- **rendere interattivo il simbolo** vuol dire portare le sette modalità di comando dove già
  vivono le parti animate — e allora «bottone» e «interruttore a levetta» diventano lo stesso
  oggetto con due aspetti, non due oggetti.

C'è anche una terza strada, che va nominata per poterla scartare consapevolmente: **lasciare due
oggetti** e accettare che un interruttore disegnato bene non si possa premere, o che un bottone
premibile non possa sembrare un interruttore.

## Da misurare quando si comincia

- **La parità web/LVGL.** Il bottone è già fra i `TIPI_RUOTABILI` del viewer LVGL
  (`sws-runtime/crates/sws-lvgl-viewer/src/lvgl_render.rs:2152`) e ha i suoi predefiniti lì
  (`:2702`). Qualunque aspetto nuovo va disegnato **due volte**, o su LVGL si vede un rettangolo
  dove sul web c'è un interruttore. È la classe di difetto che il repo ha già incontrato più
  volte.
- **Quanti aspetti servono davvero.** «Una libreria ampia» va tradotta in un elenco, e l'elenco va
  fatto con un impianto vero davanti: pulsante a fungo, selettore a due e tre posizioni,
  interruttore a levetta, pulsante luminoso, chiave, pulsante a pedale… ognuno con i suoi stati.
- **Se la scelta dell'aspetto è un campo o un tipo.** Un campo (`button_look`) tiene un oggetto
  solo e non tocca `PALETTE_GROUPS`; tipi separati riempiono la palette — che è già sotto accusa
  per [un altro motivo](2026-10-14-menu-strumenti-e-icone.md).
- **Cosa succede ai bottoni che esistono.** Qualunque strada, un progetto di oggi deve continuare
  a disegnarsi come si disegna oggi.
