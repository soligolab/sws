# L'impostazione iniziale di un progetto nuovo — piano d'esecuzione

> **Stato: piano d'esecuzione, sessioni I1–I2 della [serie coordinata](README.md#-la-serie-coordinata-del-04-11-2026--lordine-delle-sessioni).**
> Nato come seme il 04-11-2026 da una richiesta del maintainer: «quando inizio un progetto vuoto l'area di lavoro è vuota
> e la pagina non configurata, l'impatto è dispersivo. Servirebbe una finestra [la Finestra di avviso] che chieda di
> definire gli aspetti di progetto di default per tutte le pagine tra cui "Page size", "Background (light)" e
> "Background (dark)", "Rendering engine", "Full-screen viewer" e le poche altre info di setup iniziale del progetto da
> valutare assieme». Diventato piano lo stesso giorno, con la misura del codice (`tmp/piani-misure/impostazione-progetto.md`,
> solo su theobroma). **Dipende da** [la Finestra di avviso](2026-11-04-finestra-di-avviso.md) (il `modulo`, sessione F1)
> e conviene dopo F2, che tocca gli stessi punti di `EditorShell.tsx`.

## Decisioni del maintainer (04-11-2026)

- La finestra **compare da sola solo per un progetto vuoto appena creato**, e **si riapre quando si vuole** (Progetto →
  Impostazioni). Per un template o uno ZIP non compare: le scelte le ha già fatte chi l'ha scritto.

## Decisioni dell'08-11-2026, all'inizio di I1

Il maintainer, chiedendo la rc.5: «inizia e fammi le domande che ti servono».
- **Il preset si ricorda**: `page_layout.dispositivo` (l'etichetta del preset); vince sugli altri con la stessa misura.
- **Uno sfondo predefinito solo, `#0f172a`**: `SFONDO_PREDEFINITO` in `pageLayout.ts` (= `BOOT_SFONDO`), usato da editor
  e canvas al posto di `#1a1a2e`.
- **`framebuffer_device` esce anche dal modello**: i progetti che lo portano si leggono uguale, la `PUT
  /api/project/target` lo accetta e lo butta (un IDE di prima non prende un 400).
- **La cornice predefinita si sceglie solo nella finestra** (campo Cornice: nessuna, una esistente, una nuova da
  modello): via `PropostaCornice` e la spunta «predefinita» nelle proprietà della cornice, che ora dicono com'è e aprono
  la finestra. Regola UI n. 2.
- **Lingue e tipo di impianto per l'IA restano fuori dalla finestra**, del tutto: hanno già la loro scheda, e la
  finestra sarebbe stato un secondo scrittore dello stesso dato. Il progetto nasce già con la lingua dell'IDE.
- Il resto come le proposte del piano: chi non è Admin non apre la finestra; «Pagina 1» e il boot nella lingua
  principale (italiano, inglese per le altre); ZIP e azienda e l'anteprima del nome corretti qui.

## La misura (04-11-2026)

- «Nuovo progetto» (`components/benvenuto/NuovoProgetto.tsx`) chiede nome, azienda, **motore**, dispositivo framebuffer,
  cartella. Della pagina niente.
- Un progetto vuoto nasce con `page_layout` assente e due pagine diverse: il boot 1280×800 su `#0f172a`, «Page 1» senza
  misure né sfondo (`projects.rs:1161-1212`, `boot.rs`).
- Le impostazioni di progetto stanno nella colonna Proprietà senza selezione, mescolate a quelle della pagina, e salvano
  in **quattro modi diversi**; `ProjectPageLayoutSettings` legge i suoi valori al montaggio e non segue le modifiche
  (`EditorShell.tsx:2596-2599`).
- **Lo stesso dato in due posti**: il motore (in `NuovoProgetto` «Target», nel pannello «Motore di rendering», con nomi e
  suggerimenti diversi); la misura predefinita (tre scrittori); la cornice predefinita (due).
- `framebuffer_device` si chiede alla creazione e **non lo legge nessuno** (`project.rs:2343`, `router.rs:11583-11590`), e
  si perde cambiando motore.
- Sul gateway aprire il progetto ricarica la pagina: il segnale «appena creato» deve stare **su disco**. Il precedente è
  `sorgenti_da_rivedere` (`project.rs:2260`, acceso in `projects.rs:1151`, letto in `ProtocolsTab.tsx:285`, spento in
  `router.rs:6399`).
- Quattro e2e creano progetti vuoti via API (`import-tags`, `bugcheck`, `lang-table`, `chat-ai`): se il segnale si
  accendesse per ogni progetto vuoto, la finestra li bloccherebbe.
- Tre pop-up nativi nel percorso (motore, lingue, cornice predefinita): li toglie la Finestra di avviso.
- Incongruenze trovate: lo ZIP ignora l'azienda scelta; l'anteprima del nome mostra un nome che il server rifiuta;
  `welcome.targetHint` dice che LVGL ha cinque tipi (oggi 40); due commenti del Rust in contrasto sul motore.

## Il disegno

**La finestra** (`modulo`), con i campi che valgono per tutte le pagine:

| Campo | Dato | Note |
|---|---|---|
| Dispositivo o misura | `page_layout.default_width/height` | i preset raggruppati (Pixsys WP/TC dal marchio, generici), «Personalizzato…» |
| Sfondo chiaro e scuro | `default_background`, `default_background_dark` | |
| Motore di rendering | `target.kind` | **esce da `NuovoProgetto`**, insieme a `framebuffer_device` |
| Visualizzatore a tutto schermo | `hide_viewer_chrome` | |
| Cornice | i tre modelli di `PropostaCornice` o «nessuna» | applicata **dopo** la misura; coerente con R6 dei template |
| Lingua principale (e altre) | `languages` | al posto del `prompt` del codice lingua |
| Tipo di impianto per l'IA | `ai.impianto` | solo con l'IA configurata e per un Admin |

Fuori: modalità di dimensionamento (resta `fixed`), pagina iniziale, stile dei simboli (non ci sono preset), utenti.

**Il segnale**: un campo in `project.yaml` acceso **solo quando lo chiede `NuovoProgetto`** (così gli e2e che creano
progetti via API non lo vedono), spento alla conferma o alla chiusura della finestra.

**Le scritture**, con le `PUT` esistenti già versionate, in quest'ordine: motore → `page_layout` → applicazione alle pagine
(«Page 1» e il boot) → cornice → lingue → IA.

## Anticipata il 05-11-2026: il pannello della pagina e la finestra (parte di I2)

Il maintainer, collaudando la 2.25.1 nello stile VS Code: «il menù a destra per gli oggetti della voce PAGES (PAGES,
FRAMES, FACEPLATES e BOOT IMAGES) è un menù unico e ingarbugliato, non si capisce nemmeno cosa è relativo alla pagina e
cosa generale per il progetto, rivediamolo subito». Due decisioni, lo stesso giorno:

- **Le impostazioni del progetto in una finestra «Impostazioni progetto»** (un `modulo` della Finestra di avviso,
  `apriImpostazioniProgetto`): motore, formato predefinito, dimensionamento, pagina iniziale, tutto schermo. Nel pannello
  resta una riga di riepilogo con il bottone che la apre; ogni campo si salva subito e la finestra lo dice (la
  proposta I2.2). Il dimensionamento non tiene più una copia presa al montaggio né un bottone suo: legge dal negozio e
  scrive il `page_layout` intero partendo da quello attuale.
- **I campi della pagina, una voce per gruppo nella barra di destra**: Pagina (nome, misura, navigazione, boot),
  Sfondo (colori, immagine), Come finestra, Cornice (la scelta, o le fasce di una cornice), Faceplate. Nello stile
  classico sono i rami a fisarmonica, come per gli oggetti (`GRUPPI_PAGINA` in `EditorShell.tsx`).

Strada facendo: la coda della Finestra di avviso mette **sopra** un modulo la richiesta aperta da dentro di lui (la
conferma del passaggio a LVGL), e il modulo resta montato sotto. Ramo `feat/pannello-pagina`, annidato su
`feat/finestra-avviso` (F1, che dà il `modulo`).

Restano per I2: il secondo ingresso (la foglia Progetto → Impostazioni), una funzione sola per tutti gli scrittori di
`page_layout` (oggi la usa la finestra; gli altri cinque no), `PropostaCornice` sostituita dal campo Cornice della
finestra. I1 resta com'è (la finestra che si apre da sola per un progetto vuoto).

## Le sessioni

**I1 — `feat/impostazione-iniziale`.**
- Il campo del segnale (`sws-core/src/project.rs`, `projects.rs`: `CreateProjectRequest` e il ramo vuoto), la finestra coi
  campi sopra, le scritture in ordine; via motore e `framebuffer_device` da `NuovoProgetto`; `welcome.targetHint`.
- Test: `tests/nuovoProgettoDestinazione.test.tsx` aggiornato; uno nuovo sul segnale (si accende solo da `NuovoProgetto`).
- Prova del maintainer: progetto vuoto → finestra → «Page 1» e il boot nascono con misura, sfondi, motore e cornice
  giusti; anche nel cloud (dove la pagina si ricarica).
- CasaDomotica: non si applica (esiste già); annotato.

*Fatta l'08-11-2026 sul ramo `feat/impostazione-iniziale`*: il segnale `impostazione_iniziale` (acceso da
`NuovoProgetto`, spento da `DELETE /api/project/impostazione-iniziale` alla chiusura della finestra), le pagine
`semina_impostata`, la chiusura `chiudiImpostazioneIniziale` (formato su «Pagina 1» e sul boot, Salva, segnale spento),
il campo Cornice, lo ZIP che rispetta l'azienda (`UploadQuery::azienda_id`), `erroreNomeProgetto`. Provato dal vivo
via API su un runtime di prova; la prova nell'IDE è del maintainer.

**I2 — `feat/impostazioni-progetto`.**
- Nel pannello Proprietà restano i soli campi della **pagina**; al posto di «Formato predefinito» e «Impostazioni
  progetto» una riga di riepilogo («1280×800 · web · cornice: testata») con **«Impostazioni progetto…»**, che apre la
  stessa finestra. Un secondo ingresso da Progetto → Impostazioni (foglia in `config/schede.ts`).
- Sparisce lo `useState` che non segue le modifiche; i testi non tradotti di quella sezione; se possibile una funzione
  sola che unisce le modifiche a `page_layout` (oggi sei scrittori, e il server lo sostituisce intero,
  `router.rs:11389-11394`).
- Il piano si archivia.

*Fatta l'08-11-2026 sul ramo `feat/impostazioni-progetto`, annidato su I1*: la foglia Configurazione → Progetto →
Impostazioni (`ImpostazioniProgettoTab`: il riepilogo e il bottone che apre la finestra; nello stile VS Code sotto la
voce Progetto); **una coda sola per le scritture di `page_layout`** (`layoutInCoda.ts`: `salvaLayout`, la prima
impostazione di una pagina, il boot abilitato, la cornice predefinita e l'albero delle pagine nel Salva; il test
`scrittoriLayout.test.ts` vieta un `updatePageLayout` fuori coda). `PropostaCornice` era già uscita con I1. Il piano si
archivia dopo il collaudo del maintainer.

## Da decidere all'inizio di ogni sessione

La proposta vale se il maintainer non dice altro.

**I1**
1. Il preset scelto si ricorda? Oggi un WP630 riaperto diventa «Full HD 16:9» (`EditorShell.tsx:448`). *Proposta: sì, un
   campo `dispositivo` in `page_layout`.*
2. Lo sfondo predefinito: `#1a1a2e` (`EditorShell.tsx:1364`) o `#0f172a` (`boot.rs:220`)? *Proposta: `#0f172a`, uno solo.*
3. «Page 1» e «Immagine di boot» hanno nomi fissi nel Rust: *proposta: nella lingua principale scelta.*
4. Chi non è Admin (nel cloud con utenti, le `PUT /api/project/*` sono `require_admin`): *proposta: la finestra non si apre;
   il riepilogo nel pannello dice chi la può cambiare.*
5. Lo ZIP che ignora l'azienda e l'anteprima del nome: *proposta: si correggono qui, sono nello stesso file.*
6. `framebuffer_device` si toglie anche dal modello? *Proposta: sì, con lettura tollerante dei progetti vecchi.*

**I2**
1. Il secondo ingresso: *proposta: la foglia Progetto → Impostazioni e il bottone nel pannello; niente voce nel menu ☰.*
2. Il salvataggio: la finestra scrive subito (le `PUT`) o passa dal Salva unico? *Proposta: scrive subito, come oggi i campi
   di progetto, e lo dice.*
3. «Cambia risoluzione…» e `PropostaCornice` entrano nella finestra? *Proposta: «Cambia risoluzione…» resta un bottone a
   parte (sposta e ridimensiona oggetti); `PropostaCornice` sparisce, la sostituisce il campo Cornice della finestra.*

## Rischi

- Il motore spostato: lo schermo del pannello commuta via D-Bus (`display_target::publish`); lo controlla
  `check_target_progetto` (con lo stack, da lanciare a mano).
- Un campo nuovo in `project.yaml` viaggia col deploy e va dichiarato a `check_versione_progetto` e `PATH_VERSIONATI`.
- Manuale: T02:45-94, 04:431-460, 04:514, 04:532-548, 05:224-229, T08:26-30 e le schermate T02-02…05, T08-01 (M5).
