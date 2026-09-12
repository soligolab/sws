# SWS — Open Architectural Questions

> Decisions that came up during development but are **not for Claude Code to settle in a vibecode session**. The maintainer reviews and decides these out-of-band.
>
> When Claude Code encounters one of these, it should: pick the documented PoC default, add a `// TODO(open-question):` comment in code referencing the question number here, and continue.
>
> **Dal 2026-09-06 questo file contiene solo le questioni vive.** Quelle decise, realizzate e
> **verificate sul codice** stanno in [`docs/history/OPEN_QUESTIONS-chiuse.md`](history/OPEN_QUESTIONS-chiuse.md),
> indicizzate in coda a questo file. I numeri **non si riusano mai**: una scheda nuova prende il
> numero successivo all'ultimo assegnato, archivio compreso (`check_documenti.sh` fa i conti).
>
> **Dal 2026-09-12, una scheda ancora viva può avere il testo spostato in un piano** sotto
> `docs/plans/` invece di restare qui per intero — non è una chiusura: la domanda resta aperta,
> il numero resta suo, solo il contenuto integrale vive altrove (il piano lo riporta parola per
> parola, sotto «Testo originale della scheda»). Qui resta il titolo, il rimando e lo stato in
> una riga. Non tutte le schede vive sono così: solo quelle per cui è stato preparato un piano.

---

## Q13 — Come arrivano davvero gli sfondi di boot su un pannello Pixsys reale?

**Context**: emerso il 2026-08-01 preparando lo scaffold per gli export PNG del brief (6 risoluzioni,
`docs/branding/boot-backgrounds/`). Sono pensati per il boot splash **OS-level** del pannello Pixsys,
ma nessun meccanismo del genere esiste oggi in questo repo — verificato con grep su `docs/`,
`deploy/`, `scripts/`, `sws-editor/src/`: nessun riferimento a psplash o equivalente. Il kiosk SWS
(`sws-kiosk`) apre solo una URL fullscreen dopo che il sistema è già partito; non gestisce lo splash
di boot.

**Options**:
1. Consegna manuale al maintainer, che li carica con lo strumento di configurazione Pixsys — nessuna
   integrazione in questo repo, mai.
2. Se Yocto/Pixsys espone una recipe per il boot splash, documentarla in `docs/YOCTO_CROSSCOMPILE.md`
   e versionare gli asset finali lì invece che in `docs/branding/`.

**Default for PoC**: opzione 1 — richiede la conoscenza del maintainer sul tooling Pixsys reale, non
deducibile dal codice.

**Decided**: not yet — il maintainer ha scelto (2026-08-21) di **rimandare**: la domanda resta
aperta finché non avrà il pannello sotto mano per verificare il meccanismo reale.

---

## Q16 — Widget `image` su LVGL: nessun decoder raster compilato, e il catalogo bundle è SVG

Contenuto spostato in [`docs/plans/2026-09-12-q16-decoder-raster-image.md`](plans/2026-09-12-q16-decoder-raster-image.md) il 2026-09-12. **Decided:** parzialmente decisa (metà SVG fatta, metà raster no).

---

## Q23 — Collegare lo SCADA a un robot ROS 2

**Aperta** — segnalata dal maintainer il 2026-08-26, da analizzare più avanti.

Oggi i dati entrano nello SCADA da Modbus, MQTT, OPC UA e dagli script Python. Un robot basato
su **ROS 2** non parla nessuno di questi: parla DDS, con topic tipizzati, servizi e azioni.

Da decidere, e sono due domande distinte che conviene non impastare:

1. **Il driver.** Un *source* ROS 2 accanto agli altri. Le strade plausibili sono almeno tre e
   costano molto diversamente: linkare `rclrs` (client Rust nativo, ancora giovane), appoggiarsi a
   `rosbridge` via WebSocket/JSON (nessuna dipendenza DDS, ma un processo in più da installare sul
   robot), oppure parlare DDS direttamente con un'implementazione Rust. Va tenuto presente che il
   modello dati qui è **tag piatti con un valore scalare**, mentre ROS 2 pubblica messaggi
   strutturati: la mappatura messaggio → tag non è un dettaglio implementativo, è la domanda vera.
2. **Gli oggetti sinottici.** Un robot non si rappresenta con una `gauge`. Servirebbero oggetti
   propri — posa/giunti, stato della missione, pulsanti che lanciano un'*azione* e ne seguono il
   feedback, e un modo di mostrare l'emergenza. Vale anche la pena chiedersi se il comando di un
   robot debba passare per il normale meccanismo di scrittura tag o richieda una strada a parte:
   un'azione ROS 2 ha un ciclo di vita (accettata, in corso, annullabile, conclusa) che un tag
   scalare non sa rappresentare.

**Precisazione del maintainer (2026-08-26): la portata è molto più piccola di così.**

In questa fase allo SCADA serve dialogare con **dati semplici** del robot, non rappresentarlo. In
concreto: una `gauge` agganciata a velocità, direzione o consumi; `led` e `trend` agganciati a dati
di diagnostica dello stesso genere; qualche `button` che manda avvio e arresto. Tutta roba che gli
oggetti esistenti già sanno fare.

**Non è richiesto** rappresentare il robot (nessuna vista posa/giunti) né emulare servizi di
simulazione.

Questo sposta il peso della domanda: il punto 2 qui sopra — gli oggetti sinottici dedicati —
**decade quasi del tutto**, e resta il punto 1, cioè far arrivare quei valori dentro dei tag. Il
che riduce il problema a un *source* in più, che è un lavoro di tutt'altra taglia rispetto a una
famiglia di oggetti nuovi. Anche la questione "e sul pannello LVGL?" si dissolve da sé: gauge, led,
trend e button il motore LVGL li disegna già.

Restano da decidere solo la strada del driver (`rclrs` / `rosbridge` / DDS nativo) e la mappatura
messaggio strutturato → tag scalare.

Da non affrontare prima che il PoC sia stabile.

---

## Q26 — Un server MCP per far editare il progetto all'IA

*Aperta il 2026-08-31, su richiesta del maintainer. Nessuna decisione presa.*

L'idea: esporre il progetto SWS attraverso un **server MCP**, così che l'utente possa usare un
assistente IA per costruire e modificare sinottici, tag, allarmi e script — invece di disegnare
tutto a mano nell'IDE.

Va segnata e non decisa. Quello che segue è il perimetro delle domande, non una risposta.

### Cosa renderebbe l'idea interessante

Il progetto è **già** in una forma che un modello linguistico maneggia bene: YAML dichiarativo,
uno schema unico e autorevole (`sws-web/src/synoptic.rs`, 238 campi), un parser vero
(`Project::load`) e sette guardie che dicono no a un progetto malformato. Un assistente che
scrive YAML ha quindi un giudice, e non deve indovinare se ha fatto bene.

### Le domande da sciogliere, prima di scrivere una riga

1. **Dove gira, e quindi cosa può toccare.** Sul PC di sviluppo accanto all'IDE, o sul
   dispositivo accanto al runtime? Le due cose hanno superfici di rischio molto diverse: la
   seconda significa un canale che scrive nella configurazione di un impianto in servizio.
2. **Sola lettura o anche scrittura.** Un server che *legge* il progetto e risponde a domande
   («quali tag non sono usati da nessuna pagina?») è quasi tutto guadagno. Uno che *scrive* è un
   secondo autore del progetto, e apre le tre domande sotto.
3. **Chi approva.** Nessuna modifica dovrebbe raggiungere un dispositivo senza che una persona
   l'abbia vista. Il posto naturale è il deploy, che già esiste ed è già un gesto esplicito.
4. **Come si torna indietro.** Il progetto è in git nel repo del maintainer, ma sul dispositivo
   no. Serve almeno un ripristino a colpo sicuro prima di dare a un assistente il permesso di
   scrivere.
5. **Che rapporto ha con `write_min_role` e con Q17.** Un canale che scrive nel *progetto* è
   diverso da uno che scrive nei *tag*, ma il confine va disegnato una volta sola, non due.
6. **Il vincolo che il progetto è dell'utente.** I segreti viaggiano col progetto (decisione del
   2026-08-20): password dei driver e token stanno nello YAML in chiaro. Un server MCP che
   esponesse il progetto esporrebbe anche quelli, e a un servizio esterno. È probabilmente il
   punto più affilato di tutti.

### Rapporto con le altre voci

- **Q17** (`/api/recipes/:id/apply` senza controllo per-tag) è il precedente da non ripetere: un
  canale di scrittura nato senza dire chi può usarlo.
- **Q21** (due superfici Python nel progetto) è lo stesso genere di domanda — quante strade
  diverse possono cambiare la stessa cosa — e conviene rispondere insieme.

### Aggiornamento del 2026-08-31 — esiste una proposta, la domanda resta aperta

Il maintainer ha chiesto un piano per una **chat nell'editor collegata a Claude Code**:
`docs/archive/2026-08-31-chat-ai-nelleditor.md`. Il piano risponde a cinque delle sei domande qui
sopra, e va letto prima di decidere. In sintesi:

- **le modifiche dell'assistente non toccano il disco**: vanno nello store dell'editor, che dà
  l'annullamento con Ctrl+Z e non persiste nulla finché una persona non salva. Questo scioglie da
  solo «dove gira», «chi approva» e «come si torna indietro»;
- **il punto sui segreti era sbagliato**: `GET /api/project` li maschera già
  (`mask_project_secrets`, `router.rs:1905`) e il server li ricompone al salvataggio. Chi legge
  dall'API non li vede. Resta vero per `GET /api/project/export`, che per decisione del 2026-07-29
  li spedisce in chiaro;
- il server MCP autonomo — la forma con cui questa domanda era nata — diventa l'**ultima** fase e
  non la prima: gli strumenti servono comunque, e l'involucro MCP costa poco quando ci sono.

**La domanda resta aperta**: il piano propone, non decide. Le cinque scelte che spettano al
maintainer sono nel §9 del piano.

---

## Q28 — Il grafico a barre usa due scale diverse nei due motori

Contenuto spostato in [`docs/plans/2026-09-12-q28-scala-bar-chart.md`](plans/2026-09-12-q28-scala-bar-chart.md) il 2026-09-12. **Decided:** not yet.

---

## Q29 — Un tag può servire due direzioni con due tipi diversi?

Contenuto spostato in [`docs/plans/2026-09-12-q29-tag-due-tipi.md`](plans/2026-09-12-q29-tag-due-tipi.md) il 2026-09-12. **Decided:** not yet.

---

## Q31 — La chat non funziona quando l'IDE è collegato a un runtime remoto, e non è chiaro cosa dovrebbe fare

Contenuto spostato in [`docs/plans/2026-09-12-q31-verifica-chat-remota.md`](plans/2026-09-12-q31-verifica-chat-remota.md) il 2026-09-12. **Decided:** risolta nel codice, manca la conferma a schermo.

## Q32 — Dove deve vivere il progetto che si sta modificando?

Contenuto spostato in [`docs/plans/2026-09-12-q32-presa-diretta-cerimonia.md`](plans/2026-09-12-q32-presa-diretta-cerimonia.md) il 2026-09-12. **Decided:** not yet.

## Q36 — `min_role` non esiste sul pannello LVGL

Contenuto spostato in [`docs/plans/2026-09-12-q36-min-role-lvgl.md`](plans/2026-09-12-q36-min-role-lvgl.md) il 2026-09-12. **Decided:** not yet.

---

## Q39 — Il validatore deve aprire la famiglia dei rilievi geometrici?

Contenuto spostato in [`docs/plans/2026-09-12-q39-validatore-rilievi-geometrici.md`](plans/2026-09-12-q39-validatore-rilievi-geometrici.md) il 2026-09-12. **Decided:** not yet.

---

## Q40 — `state_on_color` non fa niente sugli undici simboli importati, e niente lo dice

*Aperta il 2026-09-06. **Misurata su entrambi i motori**, non dedotta.*

La libreria dei simboli contiene due specie di oggetti che la palette presenta allo stesso modo:

- i **simboli disegnati** (29 dei 40 in libreria: pompa, valvola, motore…), costruiti con
  primitive grafiche e **ricolorati** secondo `state_tag`;
- gli **11 simboli importati** da librerie esterne (`reactor`, `heat_exchanger`, `solar_panel`,
  `battery`…), che sono immagini SVG e **conservano i propri colori**.

Su questi ultimi `state_on_color` e `state_off_color` **non producono alcun effetto**. Il pannello
proprietà li offre lo stesso, il validatore non dice niente, e chi lega un `state_tag` a un
`reactor` aspettandosi che diventi verde quando l'impianto parte non vede nessun cambiamento e non
ha modo di capire perché.

**Misurato** disegnando la stessa pagina — un `pump` e un `reactor`, entrambi con
`state_on_color` esplicito — nei due motori:

| | pump (disegnato) | reactor (importato) |
|---|---|---|
| **Browser** | ricolorato | `<image href="/symbols/reactor.svg">`, coi suoi colori |
| **Pannello LVGL** | ricolorato (5211 px del colore chiesto) | disegnato, coi suoi colori (0 px del colore chiesto) |

**Buona notizia**: i due motori si comportano **allo stesso modo**, quindi non è una divergenza
WYSIWYG. È una funzione che non c'è e che l'interfaccia non dichiara.

Il limite tecnico è dichiarato nel codice (`svg_assets.rs`: *«una bitmap non saprebbe cambiare
colore con lo stato senza rasterizzare una variante per colore»*), ma non arriva a chi disegna.

### Misurato il 2026-09-06: **13 simboli su 40 non esistono sul pannello**

Disegnando ogni simbolo della libreria col motore LVGL e guardando l'immagine, tredici rendono il
**riquadro rosso d'errore** — cioè il motore non conosce il loro `symbol_id`:

`valve_motorized`, `valve_pneumatic`, `check_valve`, `valve_3way`, `relief_valve`, `strainer`,
`blower`, `silo`, `conveyor`, `cyclone`, `column`, `furnace`, `chiller`

Sono la serie **valvole e processo**, aggiunta dopo che Q15 era stata decisa: l'opzione B
(«riscrittura a mano dei soli 16 simboli») è stata eseguita sui simboli che esistevano allora, e
questi tredici non sono mai stati portati. Nel browser si vedono giusti; sul pannello sono un
rettangolo rosso, e **chi disegna non ha modo di accorgersene** — il badge «L» della palette dice
che il *tipo* `symbol` è supportato, non quali simboli lo siano.

Da oggi `scripts/check_simboli_lvgl.sh` li tiene in un elenco dichiarato: un simbolo **nuovo** che
non arriva sul pannello fa fallire la guardia, e uno che viene implementato va tolto dall'elenco.
Il gap non cresce più in silenzio, che è il minimo finché non si decide se colmarlo.

**Una cosa da controllare mentre si decide**: i tre posti che contano i simboli davano tre numeri
diversi il 2026-09-06 — `svg_assets.rs` dice «i **17** simboli builtin non passano di qui», il
manuale diceva «**22** built-in», e la libreria dell'editor (`symbols/library.tsx`) ne dichiara
**40**, di cui 11 importati. Il manuale è stato allineato a quest'ultimo, che è la fonte di ciò che
la palette offre; e il **17** del motore LVGL adesso si spiega: sono i simboli disegnati che LVGL
implementa davvero (16 misurati, 29 disegnati sul web meno i 13 qui sopra). La divergenza è reale,
ed è misurata.

**Options**

1. **Dirlo nell'interfaccia**: la palette distingue le due specie, e il pannello proprietà nasconde
   — o marca come inefficaci — i due campi colore quando il simbolo scelto è importato. Costa poco
   e chiude il caso in cui la persona sta guardando lo schermo.
2. **Dirlo nel validatore**: un avviso su ogni `symbol` importato che dichiara `state_tag` o un
   colore di stato. Copre anche i progetti scritti a mano o dall'assistente, ma inaugura una
   famiglia di rilievi «campo dichiarato e inefficace» che oggi non esiste (parente di Q39).
3. **Farlo funzionare**: rasterizzare una variante per colore, o convertire gli 11 importati in
   simboli disegnati come si è fatto per i 17 (Q15 opzione B). È il lavoro vero, e va valutato
   contro quanto quei simboli servano davvero colorati.
4. **Lasciare com'è**, ora che il manuale lo dice.

**Default for PoC**: opzione 4 — il manuale lo dice da oggi. **Decided**: not yet.

---

## Q43 — Traduzione automatica dei contenuti di progetto (Google Translate)

*Aperta il 2026-09-07 su richiesta del maintainer. Nessuna decisione presa.*

**Richiesta.** Tradurre automaticamente da una lingua nota a una desiderata, usando le API di
Google Translator.

### Cosa c'è già, verificato sul codice

La richiesta **non** è «aggiungere il multilingua»: c'è. Quello che manca è riempire da soli una
struttura che esiste.

- `LanguageTable` in `sws-core/src/project.rs:966` ha un campo `default` — **il codice della lingua
  sorgente** — e la mappa token → traduzioni per codice lingua.
- L'autore scrive `{{token}}` nei campi testo degli oggetti; il viewer e l'anteprima dell'editor li
  risolvono nella lingua corrente (`sws-editor/src/i18n/projectI18n.ts`, T-40).
- Si scrive con `PUT /api/project/languages` (Admin).
- Sono **due assi indipendenti**: la lingua dell'interfaccia (`i18n/it.json`, `en.json`,
  react-i18next) e la lingua dei **contenuti di progetto**. Questa richiesta riguarda il secondo;
  confonderli produrrebbe un'interfaccia tradotta a metà.

### Opzioni

1. **Nel runtime, con un endpoint dedicato.** L'editor chiede «traduci da `it` a `de`», il runtime
   chiama Google e riempie `languages`. La chiave sta dove stanno già gli altri segreti.
2. **Nell'editor, col runtime come solo tramite.** Stessa cosa ma il controllo dell'operazione (cosa
   tradurre, cosa no) resta nell'IDE. Il browser non vede mai la chiave.
3. **Fuori linea, uno strumento a riga di comando** che prende un progetto e restituisce il progetto
   tradotto. Nessuna chiave nel prodotto, ma nessuna traduzione dall'IDE.

### Le domande da sciogliere

1. **Dove sta la chiave Google.** Stesso nodo di Q26: i segreti viaggiano col progetto in chiaro
   (decisione del 2026-08-20). Una chiave a consumo dentro un progetto che si esporta e si spedisce
   è un problema diverso da una password di driver.
2. **Chi rilegge.** Un allarme tradotto male su un pannello d'impianto non è una questione di stile.
   Serve un passaggio umano prima che una traduzione automatica raggiunga un dispositivo in
   servizio, e va deciso **dove** sta quel passaggio.
3. **Cosa NON si traduce.** I segnaposto di formato (`%.1f`, `{value}`), i nomi di macchina, le
   sigle e i codici di impianto. Tradurre `%.1f bar` in una lingua che sposta l'unità rompe il
   formato, non la frase.
4. **Riproducibilità.** La stessa stringa tradotta due volte può tornare diversa: serve decidere se
   si ritraduce tutto ogni volta o solo ciò che manca, e se una traduzione corretta a mano deve
   essere protetta dalla successiva passata automatica.
5. **Rete.** È un'operazione di **progettazione**, non di runtime: il dispositivo è spesso senza
   Internet. Va escluso che qualcosa la invochi a impianto acceso.
6. **Google o un'astrazione.** Il maintainer ha nominato Google; vincolarsi a un fornitore è una
   scelta legittima ma va detta, perché il costo di cambiarlo dopo non è zero.

### Default per il PoC

Nessuno: oggi le traduzioni si scrivono a mano nella tabella lingue.

### Decisa

`not yet`

---

## Q44 — Ospitare l'editor come servizio, con aziende, utenti e quote

*Aperta il 2026-09-07 su richiesta del maintainer. Nessuna decisione presa.*

**Richiesta.** Poter ospitare l'editor su un sito web, con una pagina di configurazione
dell'hosting: utenti, il concetto di **azienda** e dei suoi utenti, il **branding** relativo, e un
minimo di parametrizzazione — numero di progetti e spazio per utente — da estendere in seguito.

### Perché è la questione più grande aperta finora

Non aggiunge una funzione: cambia **cosa è** SWS. Oggi è un programma che si installa accanto a un
impianto; questo lo rende un servizio che ospita gli impianti di più clienti sullo stesso server. Le
cose che oggi funzionano perché c'è un solo cliente smettono di funzionare tutte insieme.

### Cosa il modello attuale dà per scontato, verificato sul codice

| Oggi | Perché non regge in multi-azienda |
|---|---|
| `users.yaml` sta **dentro la directory del progetto** (`sws-auth/src/lib.rs:5`) | Gli utenti appartengono a un progetto. Qui devono stare **sopra** i progetti: un utente dell'azienda A ha più progetti |
| Ruoli `Viewer < Operator < Supervisor < Admin`, per progetto | Manca del tutto il livello «di chi è questo progetto» |
| **Modalità senza utenti**: nessun `users.yaml` ⇒ tutto è Admin senza token (`router.rs:663-673`) | Su un host pubblico è fatale. Va resa impossibile, non solo sconsigliata |
| Un runtime ha **un** progetto attivo (`--projects-root`, `.active-project`) | N aziende × M progetti non entrano in «un progetto attivo» |
| Il branding è **per installazione**: `public/branding/active.json` sceglie un marchio per tutta la SPA servita | La richiesta è branding **per azienda**: la stessa SPA deve mostrarsi diversa a clienti diversi |
| Nessuna nozione di quota | Da costruire: dove si contano i progetti, dove si misura lo spazio, e cosa succede al superamento |
| I segreti viaggiano col progetto in chiaro (decisione 2026-08-20) | Su un disco condiviso fra clienti è una decisione da riesaminare, non da ereditare |

### Opzioni

1. **Un piano di controllo separato**, davanti a N runtime (uno per azienda o per progetto): la
   tenancy, le quote e il branding vivono lì; il runtime resta quello che è. Isolamento forte,
   pezzo nuovo da scrivere e da mantenere.
2. **Estendere il runtime a multi-progetto e multi-utente**: un solo processo che serve tutti.
   Meno parti, ma tocca autenticazione, storage e ogni endpoint, e un difetto di isolamento diventa
   un incidente fra clienti.
3. **Ibrido**: un piano di controllo sottile solo per aziende/utenti/quote/branding, con i runtime
   per progetto avviati su richiesta.

### Le domande da sciogliere

1. **Isolamento**: oggi la separazione fra progetti è il filesystem e un processo. Quale garanzia si
   promette a un cliente sul fatto che un altro non veda i suoi dati?
2. **Dove vive lo stato di tenancy.** Non dentro un progetto — sta sopra. Serve un archivio nuovo.
3. **Le quote dove si fanno rispettare.** Contare i progetti è facile; misurare lo spazio mentre uno
   storico cresce da solo è un'altra cosa. E cosa succede quando si supera: si blocca la scrittura?
   si ferma lo storico? Un impianto che smette di registrare perché è finito lo spazio è un guasto.
4. **Backup e ripristino per azienda**, non per progetto come oggi.
5. **La licenza.** Vedi la sezione dedicata qui sotto: è la parte che il maintainer ha portato
   avanti per prima, e la premessa da cui era partita si è rivelata sbagliata.
6. **Il perimetro del «minimo per iniziare».** Il maintainer ha detto numero di progetti e spazio per
   utente, poi si estende. Vale la pena scrivere quali estensioni si prevedono, perché lo schema dei
   dati si progetta una volta sola.

### La licenza — verificato il 2026-09-07

Il maintainer ha chiesto se esistano licenze che permettano di offrire il servizio **senza obbligo
di rilasciare il sorgente**. Quello che segue sono fatti misurati, non un parere legale: prima di
muoversi serve un avvocato.

#### La premessa della domanda non regge

**L'AGPL vincola chi *riceve* il software, non chi lo possiede.** Il titolare dei diritti non può
violare una licenza che è lui a concedere: Soligonet che ospita codice di Soligonet non deve niente
a nessuno. L'obbligo scatterebbe per *altri* che avessero ricevuto il codice sotto AGPL e lo
ospitassero a loro volta.

Quindi, per il solo scopo «ospitare senza pubblicare», **non serve cambiare licenza**.

#### E il codice è già stato distribuito

Il maintainer riteneva di non aver distribuito nulla. Misurato il 2026-09-07:

| | |
|---|---|
| `github.com/soligolab/sws` | **pubblico** dal 2026-05-10 (`visibility: public`, licenza dichiarata AGPL-3.0) |
| `ghcr.io/soligolab/sws-runtime:latest-arm64` | **scaricabile da chiunque** con un token anonimo (HTTP 200) |
| Fork | **0** — stelle 2, watcher 0 |

Chiunque abbia preso una copia conserva i diritti AGPL **su quelle versioni, in modo
irrevocabile**: non si può richiamare indietro. In pratica però l'esposizione è teorica — nessuno
ha forkato in quattro mesi.

Questo **non** impedisce di cambiare licenza alle versioni **future**: chi è titolare unico può
rilasciare la 2.7.0 sotto qualunque licenza voglia. Il passato resta com'è.

#### Titolarità e dipendenze: nessun ostacolo tecnico

- **Un solo autore umano.** 382 commit `Mauro Soligo <mauro@soligo.net>` più 2 `pixsysedp
  <edp@pixsys.net>`, che sono la stessa persona su due macchine. Nessun contributore esterno.
- **Nessuna dipendenza impone AGPL o GPL.** Scansionati **577 crate** Rust e **319 pacchetti** npm:

  | Licenza | Dove | Effetto |
  |---|---|---|
  | MIT / Apache-2.0 / ISC / BSD | la grande maggioranza | nessun vincolo |
  | MPL-2.0 | `async-opcua*` (9 crate), `serialport` | copyleft **per file**: si pubblicano le modifiche *a quei file*, ma si possono collegare a software proprietario. **Non blocca** |
  | `unescaper` — `GPL-3.0/MIT` | 1 crate | doppia: si sceglie MIT |
  | `r-efi` — `MIT OR Apache-2.0 OR LGPL` | 2 crate | si sceglie MIT |
  | npm | 319 pacchetti | **zero copyleft** |

#### Le opzioni, e cosa comprano davvero

| | Cosa | Cosa ottieni | Cosa perdi |
|---|---|---|---|
| 1 | **Lasciare AGPL** | Ospiti lo stesso: sei il titolare | Chi vuole includere SWS in un prodotto proprietario non può, e molti uffici legali industriali vietano l'AGPL in blocco |
| 2 | **Doppia licenza** (AGPL + commerciale) | Il pubblico resta AGPL; vendi la commerciale a chi la vuole | Richiede di restare titolare unico: servirebbe un CLA al primo contributore esterno |
| 3 | **MIT sulle versioni future** | Chiunque può usarlo e includerlo ovunque, senza attriti legali | **Chiunque può anche ospitarlo come servizio concorrente e non deve niente** |
| 4 | **Proprietaria sulle versioni future** | Controllo massimo | Nessuna adozione esterna; e il fork AGPL pubblico resta comunque disponibile |

#### L'esigenza, precisata dal maintainer (2026-09-07)

> «La mia esigenza è offrire il **servizio**, non offrire i sorgenti: gli utenti useranno il mio
> servizio e stop.»

Con questa precisazione la questione licenza **esce dal percorso critico di Q44**: l'esigenza è già
soddisfatta oggi, senza cambiare niente.

- Gli utenti del servizio **non ricevono codice** — è software come servizio, non distribuzione.
- L'unico appiglio dell'AGPL su questo caso è l'uso in rete (§13), e ricade su **chi opera sotto
  licenza**, cioè su un licenziatario. Il titolare dei diritti non è licenziatario di se stesso.

Quindi Q44 si può progettare e costruire **senza aspettare la decisione sulla licenza**. Restano da
decidere solo cose che riguardano altri scopi:

| Se un domani si vuole… | Serve |
|---|---|
| impedire ad **altri** di ospitare SWS come servizio | non MIT — semmai doppia licenza o proprietaria sulle future |
| togliere attrito ai clienti che vogliono **integrare** il codice | MIT o simile |
| solo ospitare, come oggi | **niente** |

#### Orientamento del maintainer (2026-09-07)

**MIT**, motivato dall'essere unico autore. Registrato come orientamento, non come decisione.

Due cose da pesare prima di renderlo definitivo, dette una volta e senza insistere:

- **MIT concede molto più di quanto lo scopo richiedesse.** L'obiettivo era «ospitare senza
  pubblicare», che la titolarità già garantisce (opzione 1). Con MIT, chiunque — un concorrente,
  un cliente, Pixsys — può prendere SWS, ospitarlo come servizio a pagamento e non restituire
  niente. Se un domani Q44 diventa un prodotto, è la licenza che protegge meno.
- **Ma c'è un argomento pratico forte a favore**, in questo settore: molti reparti acquisti e uffici
  legali industriali **vietano l'AGPL** per contratto. Se l'obiettivo è che i clienti possano
  integrare SWS senza una revisione legale, MIT toglie un attrito reale che l'AGPL crea. Vale la
  pena dire a voce alta se è *questa* la ragione, perché allora MIT è la scelta giusta e non un
  eccesso.

#### Cosa resta da chiedere a un avvocato

1. **Esiste un contratto con Pixsys** che renda parte del lavoro commissionato? La nota di progetto
   dice che Pixsys è cliente e non proprietaria, ma è un fatto contrattuale non verificabile dal
   codice.
2. **I contributi generati dall'IA**: i termini di Anthropic assegnano l'output all'utente, ma lo
   stato del diritto d'autore su output di IA non è uniforme fra giurisdizioni. Tende a *ridurre* la
   protezione, non a creare un terzo che rivendica.
3. **Il cambio di licenza va fatto bene**: `LICENSE`, il campo `license` nei quattro manifesti, le
   intestazioni dei file se ce ne sono, e una nota che dica da quale versione vale.

### Rapporto con le altre voci

- **Q26** (server MCP) e il piano della chat IA: entrambi partono dal presupposto «la chat vive solo
  sul PC di sviluppo». Se l'editor diventa ospitato, quel presupposto cade e va rifatto il ragionamento.
- **Q17**, **Q27**: i confini di scrittura sono stati chiusi assumendo un solo cliente.

### Default per il PoC

Nessuno: oggi l'editor si installa, non si ospita. **La licenza non è un prerequisito**: vedi la
precisazione del 2026-09-07 qui sopra.

### Decisa

`not yet`

---

## Q45 — Il container di produzione non riparte dopo un reboot senza un permesso che l'utente finale non ha

Contenuto spostato in [`docs/plans/2026-09-12-q45-linger-permesso-produzione.md`](plans/2026-09-12-q45-linger-permesso-produzione.md) il 2026-09-12. **Decided:** not yet.

---

## Q46 — `/api/fs/browse-dirs` e `/api/fs/mkdir` rispondono senza autenticazione

Contenuto spostato in [`docs/plans/2026-09-12-q46-verifica-projects-root.md`](plans/2026-09-12-q46-verifica-projects-root.md) il 2026-09-12. **Decided:** decisa e realizzata il 2026-09-09, manca la conferma a schermo.

---

## Q49 — TLS senza verifica del certificato, in quattro posti

Contenuto spostato in [`docs/plans/2026-09-12-q49-tls-pinning-lvgl-mqtt.md`](plans/2026-09-12-q49-tls-pinning-lvgl-mqtt.md) il 2026-09-12. **Decided:** decisa e in parte realizzata il 2026-09-09, resta il viewer LVGL e il plugin MQTT.

---

## Q53 — Due immagini aarch64 (SDK Pixsys e generica): tenerle entrambe, o convergere su una?

Contenuto spostato in [`docs/plans/2026-09-12-q53-misura-rimozione-sdk-qemu.md`](plans/2026-09-12-q53-misura-rimozione-sdk-qemu.md) il 2026-09-12. **Decided:** decisa e realizzata il 2026-09-10, resta la misura sul campo prima di togliere SDK/QEMU.

---

## Q54 — Un dispositivo che crea utenti propri: cosa succede al deploy successivo?

*Aperta l'11-09-2026, come conseguenza dichiarata della decisione dello stesso giorno («gli
utenti appartengono al progetto, il deploy li porta»). Il maintainer l'ha nominata lui stesso:
«esiste il caso futuro in cui nel progetto utente sia implementata una vista per
creare/modificare gli utenti, e in quel caso gli utenti del dispositivo potrebbero differire da
quelli del progetto».*

**Context.** Dall'11-09-2026 il deploy sostituisce `users.yaml` sul dispositivo con quello del
progetto, con una casella per saltarlo. Oggi gli account nascono in un solo posto — la tab
Utenti dell'IDE, dentro il progetto — quindi il dispositivo non ha nulla di suo e sostituire non
perde niente. Il giorno in cui esisterà il componente sinottico «gestione utenti», un capo turno
creerà un operatore **sul pannello**: quell'account vive solo lì, e il deploy successivo lo
cancella. La casella «Sostituisci anche gli utenti» copre il caso solo se chi preme il pulsante
**sa** che sul pannello sono nati account — cioè si ricorda di una cosa che non ha fatto lui.

**Options.**

1. **Come oggi: la casella, a mano.** Zero codice in più. Il deploy resta una scelta consapevole,
   ma dipende dalla memoria di chi lo fa; l'errore è silenzioso e irreversibile.
2. **Fusione per username.** Il deploy porta gli utenti del progetto e **tiene** quelli del
   dispositivo che il progetto non nomina. Nessuna perdita accidentale, ma un utente **rimosso**
   dal progetto non sparisce più dal pannello: una revoca non arriva a destinazione, che è il
   caso in cui contare sul deploy serve di più.
3. **Marcatura «utente locale».** `users.yaml` distingue chi è nato dal progetto da chi è nato sul
   dispositivo (un campo, es. `origine: dispositivo`); il deploy sostituisce i primi e non tocca i
   secondi. Copre entrambi i casi — la revoca arriva, l'operatore creato in reparto resta — al
   prezzo di un campo nel formato e della sua migrazione, e della domanda «di chi è la password»
   quando un username esiste da tutt'e due le parti.
4. **Il pannello rifiuta il deploy** finché qualcuno non riconcilia a mano, mostrando le
   differenze. Nessuna perdita, ma un deploy che si blocca su un impianto in servizio è peggio
   del problema.

**Default for PoC.** Opzione 1: la casella esiste, il componente «gestione utenti» no. Finché gli
account nascono solo nel progetto, il caso non si presenta. La scheda serve a non decidere per
inerzia quando quel componente si farà: è **quella** la sessione in cui va scelta la 2 o la 3,
non dopo il primo account perso.

**Decided:** not yet.

---

## Adding new questions

When Claude Code adds a new question, follow the format above:
1. **Context** — why this came up.
2. **Options** — at least 2, briefly described.
3. **Default for PoC** — what we're doing for now.
4. **Decided** — left as `not yet` until the maintainer fills it in.

## Archivio — decise, realizzate e verificate

Le schede qui sotto sono state **spostate intere** in
[`docs/history/OPEN_QUESTIONS-chiuse.md`](history/OPEN_QUESTIONS-chiuse.md) il 2026-09-06, dopo
una verifica sul codice di ciò che ognuna dichiara. I numeri **non si riusano**: una scheda nuova
prende il numero successivo all'ultimo mai assegnato, archivio compreso.

| # | Questione | Decisa |
|---|---|---|
| Q1 | Python embedding strategy | bootstrap |
| Q2 | Sparkplug B implementation | T-08 |
| Q3 | Plugin ABI strategy | bootstrap |
| Q4 | Frontend state management | 2026-05 (ADR 0001) |
| Q5 | i18n scaffolding | bootstrap |
| Q6 | Symbol library packaging | 2026-08-11 |
| Q7 | LICENSE file content | 2026-05-12 |
| Q8 | Isolamento runtime ↔ IDE | 2026-07-26 e 2026-09-02 |
| Q9 | Le `PUT /api/project/*` accettano e scartano in silenzio i campi sconosciuti | 2026-08-21 |
| Q10 | Una sorgente non parsabile viene scartata in silenzio, e il salvataggio successivo la cancella | 2026-08-21 |
| Q11 | Estendere `BrandColors` con `secondary`/`accent`, o tenerli solo nell'artwork? | 2026-08-21 |
| Q12 | I neutri di `theme.ts` restano condivisi fra tutti i brand, o diventano override per-brand? | 2026-08-21 |
| Q14 | Binding Rust↔LVGL e sequenza dei backend di output | 2026-08 (15 seguiti) |
| Q15 | Simboli SVG (`symbol`) su LVGL: nessun renderer SVG disponibile | 2026-08-11 |
| Q17 | `apply_recipe` scrive i tag senza contesto utente | 2026-09-06 |
| Q18 | Colori del testo dai token di tema su pagine con sfondo scelto a mano | 2026-08-25 |
| Q19 | Il backend DRM del viewer LVGL apre i device a mano, mentre PixsysOS li distribuisce con `seatd` | 2026-08-25 |
| Q20 | Il viewer LVGL non si accorge che il progetto è cambiato | 2026-08-25 |
| Q21 | Due superfici Python nel progetto, in due punti lontani dell'interfaccia | 2026-08-25 |
| Q22 | La `sparkline` fa crashare il viewer LVGL quando la pagina ha altri widget | 2026-08-25 |
| Q24 | Il font del viewer LVGL non ha le lettere accentate | 2026-08-27 |
| Q25 | Installare web e LVGL insieme, e far scegliere al sistema quale mostrare | 2026-08-27 |
| Q27 | Il server non fa rispettare il `data_type` dei tag in scrittura | 2026-09-06 |
| Q30 | `patch_project` è un leggi-modifica-scrivi senza lock | 2026-09-03/04 |
| Q33 | `POST /api/system/stop` viene annullato in silenzio dal salvataggio delle Sorgenti | 2026-09-04 |
| Q34 | Il cron degli script globali non capisce `*/5`, e non parte in silenzio | 2026-09-03/04 |
| Q35 | «fuori pagina» implicito nelle coordinate o campo esplicito? | 2026-09-06 |
| Q37 | Cosa c'è attorno alla pagina sul pannello, e se il foglio non ci sta | 2026-09-06 |
| Q38 | `size_mode: ratio` senza dimensioni esplicite: il bordo non arriva al canvas | 2026-09-06 |
| Q41 | La chat IA deve mostrare consumo di token e credito residuo? | 2026-09-06 |
| Q42 | Gli script Python scrivono i tag senza lo scaling inverso | 2026-09-06 |
| Q47 | `/api/script/exec` esegue codice arbitrario e nessuno lo chiama più | 2026-09-09 |
| Q48 | `/api/deploy/remote` scarica un binario che non esiste, e duplica il deploy | 2026-09-09 |
| Q50 | I dispositivi registrati: dal browser al server, e popolati dal discovery mDNS | 2026-09-10 |
| Q51 | «Pacchetto runtime» e il deploy binario sono strumenti di sviluppo: nascosti quando il repo non c'è | 2026-09-09 |
| Q52 | «Installa su dispositivo»: container per primo, campi dal dispositivo connesso, e un discovery che trova **qualunque** macchina in rete | 2026-09-09 |
