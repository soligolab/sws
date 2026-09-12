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

## Q15 — Simboli SVG (`symbol`) su LVGL: nessun renderer SVG disponibile

**Decided (2026-08-25)** — residuo chiuso: **rasterizzazione a runtime** (`resvg` + `tiny-skia`) per i 12 simboli "vendored" e per i simboli custom, insieme a Q16. È l'unica opzione che copre anche gli SVG disegnati dall'utente, cioè il caso che un progettista vero incontra. Primo passo obbligatorio: **misurare** peso del binario e memoria sul pannello prima di cablare qualunque widget. I 16 builtin restano disegnati a mano come deciso l'11 agosto: funzionano, e ricolorarli per stato è più diretto che rasterizzare tre varianti.

**Context**: quinto e ultimo dei "prossimi 5 step" proposti dopo Q14 ("procedi con i prossimi 5
step") — esplicitamente scoping come *analisi*, non implementazione: "una vera domanda
architetturale... non ancora posta in `docs/OPEN_QUESTIONS.md`". A differenza dei quattro widget
precedenti (checkbox/line/trend/alarm_viewer, tutti risolvibili componendo primitive LVGL già
disponibili — `lv_chart`, `lv_btn`, `lv_obj` colorato, ecc.), `symbol` porta contenuto SVG
arbitrario, e **LVGL 8.x (la versione vendorizzata in questo motore, vedi Q14) non ha alcun
renderer SVG integrato** — quel supporto arriva solo in LVGL 9.x, ed è comunque parziale. Questa
non è una lacuna di implementazione ma un vincolo della libreria stessa: non si risolve scrivendo
più codice nello stile già usato per gli altri widget.

**Cosa c'è davvero da rendere** (verificato leggendo `sws-editor/src/canvas/SvgCanvas.tsx` e
`sws-editor/src/symbols/library.tsx`, non assunto dal nome del tipo):
- **17 simboli "builtin"** (pompa, valvola, motore, serbatoio, ventola...): JSX/SVG scritti a
  mano, poche forme geometriche semplici per simbolo (cerchi/path/rettangoli in uno spazio
  100×100), **davvero ricolorati** in base allo stato derivato da `state_tag`/`alarm_tag`
  (off/on/allarme passano colori diversi dentro il rendering).
- **12 simboli "vendored"**: file `.svg` statici serviti da `sws-editor/public/symbols/`,
  complessità variabile (es. `filter.svg` usa un `<pattern>` per il tratteggio), **mai
  ricolorati** — solo un pallino di stato sovrapposto in un angolo.
- **`custom_symbols`**: SVG arbitrario fornito dal progetto via URL esterno (`ProjectInfo.
  custom_symbols`, nessun upload — solo un campo testo con l'URL), quindi contenuto **non
  conosciuto in anticipo**, impossibile da portare a mano caso per caso.
- **`faceplate`** è un problema *diverso e molto più semplice*, da non confondere con `symbol`:
  è un template composito di oggetti già ordinari (rect/text/led...) con sostituzione parametri
  (`FaceplateDef{objects}` in `synoptic.rs`), non contiene SVG proprio — probabilmente
  supportabile quasi gratis ricorrendo nello stesso dispatcher già scritto per gli altri tipi,
  un follow-up separato e nettamente più piccolo di questa domanda (non affrontato qui: fuori
  dallo scope dei "5 passi" originali, che nominavano solo `symbol`). **Implementato il
  2026-08-11** esattamente come previsto qui — vedi Q14 seguito 13. Questa voce (Q15) resta
  aperta solo per `symbol`, non più per `faceplate`.

**Options**:
- **A — Rasterizzazione offline/build-time**: convertire ogni SVG (i 29 built-in/vendored; i
  `custom_symbols` per natura non si possono precompilare) in bitmap `lv_img_dsc_t` a poche
  risoluzioni fisse. `lv_img_set_recolor` di LVGL applica una tinta uniforme (blend) sopra
  l'intera bitmap — approssimerebbe la ricolorazione per stato dei builtin solo se la sorgente
  fosse monocromatica (come un'icona font), perdendo la possibilità di colori diversi per forma
  interna che i builtin oggi hanno. Non copre affatto `custom_symbols` (contenuto ignoto a
  build-time).
- **B — Riscrittura a mano dei soli builtin su primitive LVGL native**: stesso approccio già
  usato per `ellipse` (approssimata con un `lv_obj` arrotondato) e `radio` (approssimato con
  `checkbox`) — fattibile per i 17 builtin (poche forme semplici, sorgente sotto controllo),
  **non estendibile** agli 12 vendored (SVG arbitrario, complessità variabile e sconosciuta in
  anticipo) né ai `custom_symbols` (contenuto del progetto, non del codice). Copertura parziale
  ma onesta: i tipi non copribili resterebbero esplicitamente non supportati, non approssimati
  male.
- **C — Rasterizzazione a runtime con una crate Rust per SVG** (es. `resvg`+`tiny-skia`, maturi
  e mantenuti): unico approccio che copre uniformemente tutti e tre i casi (builtin — se anche
  loro venissero serializzati come vero SVG invece di JSX —, vendored, custom), decodificando e
  disegnando in un buffer RGBA passato a LVGL come immagine grezza. Costo reale: una dipendenza
  nuova e non piccola, una pipeline di decodifica/rasterizzazione con le sue implicazioni di
  memoria/prestazioni su hardware embedded (il target dichiarato di questo motore), e va
  verificato se `resvg` copre davvero il sottoinsieme SVG usato nei file vendored esistenti
  (pattern, eventuali gradienti) prima di contarci.
- **D — Non supportato per ora** (stato di fatto attuale: `symbol` semplicemente assente da
  `SUPPORTED_TYPES`, oggetto silenziosamente saltato). Più onesto di un'approssimazione a metà,
  ma lascia un buco reale nella promessa "stesso YAML, portabile tra i target" per qualunque
  progetto che usi simboli di sistema — probabile per una demo SCADA/industriale tipica (pompe,
  valvole, serbatoi sono contenuto di dominio comune).

**Default for PoC**: **D** resta lo stato di fatto finché il maintainer non sceglie diversamente
— coerente con l'istruzione di non decidere le domande architetturali in sessione. Se/quando si
deciderà di procedere, l'opzione più in linea con lo spirito "MVP dichiarato, non finto" già
seguito per gli altri widget di questo filone sarebbe **B** applicata solo ai 17 builtin (stesso
schema di `ellipse`/`radio`: copertura parziale ma vera, gap espliciti per vendored/custom nel
badge "L" dell'editor e in `docs/OPEN_QUESTIONS.md`), rimandando **C** a quando/se emergerà un
bisogno reale di simboli vendored/custom su un progetto LVGL concreto — ma questa è una
raccomandazione, non una decisione presa qui.

**Decided (2026-08-11)**: **B** — riscrittura a mano dei soli 16 simboli builtin (contati di
nuovo da `library.tsx`: 17 era un errore di conteggio in una nota precedente) su primitive LVGL
native, stesso schema di `ellipse`/`radio`. I 12 simboli "vendored" e i `custom_symbols`
restano esplicitamente non supportati (copertura parziale ma vera, non un'approssimazione a
metà) — nessuna decisione presa su C (rasterizzazione runtime) per quei due casi, resta
un'opzione futura se emergerà un bisogno reale. Implementato: 16/16 builtin renderizzati su
`lv_canvas`, verificato dal vivo — vedi Q14 seguito 14 per il dettaglio tecnico completo.

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

## Q25 — Installare web e LVGL insieme, e far scegliere al sistema quale mostrare

**Aperta** — chiesta dal maintainer il 2026-08-27: «l'installazione su un terminale arm64 abbia
sempre sia il web che lvgl, ma che il sistema usi in automatico l'uno o l'altro in base al fatto che
il browser sia avviato o meno».

### Cosa è vero oggi (misurato sul WP630, non dedotto)

1. **L'installer non sa nulla di LVGL.** `install-container.sh` installa un solo quadlet,
   `sws-runtime.container`. Il viewer LVGL è sempre stato avviato a mano — per questo non torna
   dopo un riavvio.
2. **I due non si escludono: si sovrappongono.** Con Chromium `active` e il container LVGL `Up`,
   la finestra LVGL sta semplicemente sopra al browser. Non c'è un meccanismo di esclusione da
   migliorare: non c'è proprio.
3. **Entrambi sono client di Weston.** LVGL non sostituisce il compositore: è una finestra X11 su
   XWayland (`DISPLAY=:0`). La scelta è fra due finestre, non fra due sistemi grafici.
4. `chromium@main-app.service` è una unit **di sistema** dell'OS Pixsys (`User=user`,
   `WantedBy=desktop.target`, `After=weston.service`). Non è nostra.

### Il prerequisito che va fatto comunque

**Il viewer LVGL non sa partire da solo**: `--page` è obbligatorio e senza default, e sul device è
cablato a mano a `"Grafici e tabelle"`. Cambia progetto e quella unit punta a una pagina che non
esiste più.

Il progetto però **ha già** `home_page_id` (`sws-core/src/project.rs`), e il viewer lo ignora.

Quindi, prima di qualunque unit: `--page` opzionale, con ripiego su `home_page_id` e poi sulla
prima pagina. Senza questo non esiste una unit scrivibile una volta e valida per ogni progetto.

### Le tre domande che "automatico" deve risolvere

**a) Qual è l'interruttore?** Ne esistono due, e rispondono a domande diverse:

| Interruttore | Dice | Il rischio |
|---|---|---|
| **Il browser è avviato** | cosa ha configurato l'integratore su *questo* dispositivo | l'app di configurazione Pixsys può riaccendere il browser via D-Bus, e ci si ritrova con due |
| **Il target del progetto** (`lvgl_framebuffer` vs web) | per cosa è stato *disegnato* il progetto | un progetto LVGL su un pannello configurato per il web mostrerebbe comunque il web |

**b) Quando si valuta?** Solo al boot (deterministico, nessun pezzo in movimento) o anche a caldo
(richiede un sorvegliante, i cui modi di sbagliare sono silenziosi: schermo vuoto o doppio).

**c) Chi decide?** systemd da solo, o un processo nostro.

### Le opzioni

| | Come | Pro | Contro |
|---|---|---|---|
| **A** | Unit *chooser* `oneshot` al boot: `After=weston chromium@main-app`, avvia LVGL solo se Chromium non è attivo | Deterministica, poche righe, nessun processo in più | Decide solo al boot |
| **B** | `Conflicts=` fra le due unit | Elegante sulla carta | Con entrambe `WantedBy=desktop.target` chi vince è indeterminato; e serve un drop-in nella unit dell'OS, quindi `sudo` |
| **C** | Sorvegliante che osserva Chromium e commuta a caldo | Commuta anche a sessione avviata | Un pezzo in movimento in più |
| **D** | L'installer sceglie una volta: abilita l'una o l'altra | Semplicissima, zero ambiguità | Non è "automatica" |

### **Decided (2026-08-27)** — decide il progetto, il browser è la rete di sicurezza

Il maintainer ha scelto una strada diversa dalle quattro qui sopra, e più coerente: **la commutazione
avviene all'upload del progetto, comandata dal progetto stesso**, con **ripiego su LVGL se il
servizio di Chromium non è avviato**.

Due fatti raccolti sul WP630 la rendono realizzabile:

1. **Il flag esiste già end-to-end.** `project.yaml` sul device dice `target: kind: lvgl_framebuffer`;
   `ProjectTarget` è nel modello Rust (`sws-core/src/project.rs`) e nel TypeScript. **Nessuno lo
   legge.** Non c'è un campo da inventare: c'è un campo da usare.
2. **L'utente `user` può fermare e riavviare `chromium@main-app.service` senza `sudo`** — provato,
   con ripristino verificato. Polkit è attivo e lo consente. Senza questo il disegno non stava in
   piedi, perché quella unit è di sistema e non nostra.

**L'ostacolo vero è un altro**: il runtime gira in un container rootless e **non può parlare col
systemd dell'host**. Quindi non commuta lui: scrive *cosa vuole*, e un pezzo lato host agisce.

**Struttura decisa:**

1. Il runtime, quando un progetto viene aperto o sostituito (aggancio già esistente:
   `signal_project_changed`), scrive lo stato desiderato in un file del volume condiviso —
   `/var/sws/config/display-target` nel container, `/data/user/sws/config/display-target` sull'host —
   con valore `web` o `lvgl`, derivato da `target.kind`.
2. Sull'host una unit osserva quel file e applica: `lvgl` → ferma Chromium e avvia il container del
   viewer; `web` → ferma il viewer e avvia Chromium, **e se Chromium non parte ripiega su LVGL**.
3. La stessa unit gira una volta al boot, così lo schermo segue il progetto anche dopo un riavvio —
   che chiude anche la vecchia voce «serve un quadlet per `lvgl-view`?».
4. **Prerequisito, da fare per primo**: `--page` opzionale con ripiego su `home_page_id`. Senza,
   la unit va cablata a una pagina che al cambio progetto non esiste più.

Perché un file e non una chiamata diretta: il runtime non ha (e non deve avere) accesso al systemd
dell'host. Un file su un volume già condiviso non aggiunge privilegi, è ispezionabile a mano quando
qualcosa non torna, e sopravvive al riavvio del runtime.

---

*Le opzioni A-D restano qui sotto perché il ragionamento che le confronta vale ancora, e perché la
scelta fatta ne eredita i vincoli.*

**Raccomandazione al tempo dell'analisi: A**, con una precisazione onesta — A non è «in base al fatto che il browser sia
avviato», è «in base al fatto che il browser sia *abilitato al boot*». Nella pratica coincidono,
perché l'integratore disabilita il browser una volta e riavvia. Se serve la commutazione a caldo
allora è C, ed è un lavoro diverso: meglio saperlo prima.

**Nota che vale per B e per qualunque soluzione che tocchi `chromium@main-app.service`**: si
modifica una unit dell'OS Pixsys, che a un aggiornamento del sistema può tornare com'era.

### Il vincolo che l'analisi non conosceva (2026-08-28)

La prima versione di questa soluzione **ha rotto la via di fuga del pannello**. Sui prodotti Pixsys,
tenendo premuta l'icona STOP per più di 10 s durante l'avvio, il launcher apre Cockpit sulla 9443:
è il modo con cui si sistema un dispositivo mal configurato. Le nostre unit partivano da
`default.target` — cioè in qualunque modalità — e `sws-display-apply.sh` fermava il browser: si
teneva premuto STOP, compariva Cockpit, e un istante dopo la finestra LVGL ci finiva sopra.

**Deciso col maintainer**: in modalità configurazione SWS **non prende lo schermo ma continua a
girare**. La configurazione riguarda il *dispositivo*, non l'*applicazione*: impianto, storico e
allarmi non si fermano perché qualcuno sta sistemando la rete.

Il discriminante è esatto e costa due query in sola lettura: in modalità configurazione il launcher
avvia *solo* `chromium@wp-control.service` e **non raggiunge mai `desktop.target`**. Dettagli e
trappole in `docs/TEST_SETUPS.md`.

Due correzioni che ne discendono, entrambe già applicate:

- il browser si comanda con `SetEnabled` via D-Bus, che è una **politica** letta dal launcher a
  ogni avvio, più uno `stop` per la sessione in corso. Il metodo arriva con **PixsysOS 2.1.0**
  (in lavorazione al 2026-08-28); sui firmware precedenti si ripiega su `systemctl disable --now`,
  marcato `RIPIEGO` nello script perché si trovi e si tolga. Nel ripiego serve `disable` e non
  `stop`: altrimenti il symlink in `desktop.target.wants` resta e al riavvio il browser torna su
  sotto la finestra LVGL — un'intermittenza che si manifesta solo al riavvio;
- lo script **aspetta un esito**, non un numero di secondi: al boot la sessione utente può partire
  prima che `desktop.target` sia salito, e guardare una volta sola scambierebbe un avvio lento per
  una modalità configurazione.

### Rapporto con le altre voci

Assorbe la questione «serve un quadlet per `lvgl-view`?»: il quadlet è un pezzo di questa
soluzione, non un lavoro a sé.

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

## Q30 — `patch_project` è un leggi-modifica-scrivi senza lock

*Aperta il 2026-08-31 (notte), lavorando a T-50. **Misurata in un browser vero**, non dedotta.*

Tutte le scritture su `project.yaml` — tag, sorgenti, allarmi, funzioni, simboli — passano da
`patch_project` (`sws-web/src/router.rs:1963`), che fa:

```
leggi project.yaml → deserializza → applica la modifica → riscrivi
```

Senza nessun lock. Due chiamate in volo insieme leggono **lo stesso file di partenza**, e
l'ultima che scrive cancella la modifica dell'altra. Nessun errore, nessun avviso: il
salvataggio riesce, e una delle due modifiche non c'è più.

### Come è saltata fuori

Provando l'assistente nel browser: una proposta che creava **un tag e una sorgente** insieme.
Dopo Salva, sul disco c'era la sorgente e non il tag. `saveAll()` svuotava le sezioni in
sospeso con `Promise.allSettled`, cioè in parallelo.

Non è un difetto dell'assistente. Bastano **due tab di Configurazione modificate insieme** e
un Salva: è così da sempre, e nessuno l'aveva visto perché di solito si salva una sezione per
volta.

### Cosa è stato fatto adesso, e cosa no

`saveAll()` ora svuota le sezioni **una per volta**, e incatena anche `updateFunctions` +
`updateCustomSymbols` (le pagine restano in parallelo: sono file distinti). Questo mette al
sicuro il percorso che l'editor usa davvero, ed è coperto da un test che verifica l'ordine e
non solo il conteggio delle chiamate.

**Non risolve la corsa lato server.** Restano scoperte: due schede del browser aperte sullo
stesso runtime, un secondo IDE collegato in remoto, uno script che chiama l'API, un deploy
concorrente.

### Le domande

1. **Un lock nel runtime** (un `Mutex` attorno al project dir) basta? È la risposta più
   piccola, ma protegge un processo solo.
2. Oppure **scrittura ottimistica con impronta**: il `PUT` porta l'impronta su cui si è
   basato e il server rifiuta con 409 se nel frattempo è cambiata. Più onesto e già mezzo
   costruito — `calcola_impronta` esiste, e T-50 la usa già per le proposte. Costa un giro in
   più a ogni salvataggio e un messaggio d'errore da scrivere bene.
3. E in entrambi i casi: **cosa deve vedere chi perde la corsa**. Oggi non vede niente, ed è
   il vero problema.

### Rapporto con le altre voci

Stessa famiglia di **Q17** e **Q27**: il server accetta una scrittura che avrebbe gli elementi
per gestire meglio. Qui però non è una questione di permessi o di tipi — è perdita di dati
silenziosa, e va prima delle altre due.

### Fatto il 2026-09-03 — il lock c'è, e quanto pesava il difetto

Implementata la **domanda 1**: `AppState::project_write_lock` serializza ogni
leggi-modifica-scrivi su `project.yaml`, e non solo nei 13 `PUT` che passano da `patch_project` —
anche in `open_project` (la migrazione), `upload_project_zip` (il deploy), `import_project_zip`,
`create_project`, `rename_project`, il restore e la creazione di un backup, e il duplica. Gli
ultimi due sono **lettori**: copiano `project.yaml` file per file, e sotto lo stesso lock non
possono più archiviare un progetto colto a metà scrittura.

Quanto pesava, misurato: il test `cinquanta_salvataggi_concorrenti_non_si_perdono` fa 50 salvataggi
in volo insieme. Col lock ne sopravvivono 50; **togliendo il lock ne sopravvive 1**. Non era un
difetto raro da colpo di fortuna: sotto concorrenza vera si perdeva quasi tutto.

Nella stessa funzione la scrittura è diventata **atomica** (temporaneo + `rename` + `fsync`).
Prima era un `fs::write` diretto: un processo che muore a metà, o un disco pieno, lasciava un
`project.yaml` troncato — e da lì `patch_project` **rifiuta ogni salvataggio successivo** (il ramo
409 «project.yaml non è caricabile»), quindi il progetto si riapriva solo da un backup.

### Cosa resta scoperto — e perché la domanda 2 non si chiude con `calcola_impronta`

1. **La sovrascrittura con dati stantìi sulla stessa sezione.** Due schede caricano entrambe
   l'elenco dei tag; salvano una dopo l'altra; il lock le serializza ma la seconda scrive comunque
   il *suo* elenco e cancella la modifica della prima. **Nessun lock può risolverlo**: i `PUT` sono
   sostituzioni di sezione intera, quindi chi arriva secondo non sta modificando, sta rimpiazzando.
   Serve il controllo ottimistico della domanda 2.
2. **`calcola_impronta` è la granularità sbagliata** per quel controllo. Calcola l'hash di
   `project.yaml` *più tutti* i sinottici, quindi chi salva un tag prenderebbe un 409 perché un
   altro ha spostato un rettangolo su un'altra pagina. Servirebbe un'impronta del **solo**
   `project.yaml`, o un contatore di versione incrementato a ogni scrittura — che il lock ora rende
   facile, perché c'è un punto solo dove incrementarlo.
3. **La domanda 3 resta senza risposta**: chi perde la corsa non vede niente. Col lock nessuno
   perde più quando le sezioni sono diverse, ma nel caso 1 la perdita è ancora silenziosa.
4. **I sinottici, i faceplate e le ricette** hanno un file per entità e restano fuori: la corsa lì
   è fra due che salvano la *stessa* pagina, e il lock del progetto non la riguarda. Da decidere se
   vale un lock per file o lo stesso controllo ottimistico.
5. **`rename_project` non prende `project_switch_lock`.** Sposta la cartella del progetto anche se
   è quello aperto e un `open_project` è in volo. Il lock di scrittura serializza le operazioni sui
   file ma non copre un salvataggio che ha *già* risolto il percorso vecchio. È un difetto
   **diverso** da Q30, trovato leggendo quel codice il 2026-09-03, e non è stato corretto.

### Fatto il 2026-09-04 — la domanda 2, con l'hash del solo `project.yaml`

`GET /api/project` restituisce un `ETag` — l'hash SHA-256 corto dei byte di `project.yaml` — e i
dodici salvataggi di sezione lo rimandano in `If-Match`. Se sul disco è cambiato, il server risponde
**409 senza scrivere** e la SPA offre di ricaricare. Nessun «sovrascrivi comunque»: è il pulsante
che, premuto per abitudine, riporterebbe esattamente il difetto.

**Un hash e non un contatore.** Un contatore vorrebbe un posto dove vivere: in memoria si azzera a
ogni riavvio, e una scheda rimasta aperta si ritroverebbe un token che *combacia per caso* — la
protezione salta proprio quando il runtime è ripartito sotto i piedi di qualcuno. Dentro
`project.yaml` sarebbe un campo che viaggia col progetto nei deploy e negli export, per un dato che
riguarda la sessione di chi modifica e non il progetto.

**Dell'hash del solo `project.yaml`**, e non di `calcola_impronta`: quella include tutti i
sinottici, quindi chi salva un tag prenderebbe un 409 perché un altro ha spostato un rettangolo su
un'altra pagina. Un conflitto che scatta quando non c'è conflitto insegna a ignorare quelli veri.

Tre dettagli che sono vincoli e non stile:

- **Il confronto sta dentro `project_write_lock`.** Fuori, fra il controllo e la scrittura passerebbe
  l'altra scrittura, e il 409 arriverebbe a volte sì e a volte no.
- **La versione nuova torna nella risposta del 204.** Senza, la scheda che ha appena salvato
  terrebbe quella vecchia e il *suo* salvataggio successivo prenderebbe un 409 contro se stessa.
- **`GET /api/project` calcola la versione dal testo con cui costruisce la risposta**, non da una
  seconda lettura: fra le due qualcuno può scrivere, e il client si porterebbe via una versione più
  nuova dei dati che ha in mano — un salvataggio che passa quando doveva essere rifiutato. È il
  difetto che un endpoint `GET /api/project/versione` separato avrebbe avuto per costruzione.

`If-Match` assente = nessun controllo, cioè il comportamento di prima: uno script o un `curl` non si
rompono, e la protezione vale per chi la chiede. Il 409 porta `x-sws-conflitto: versione`, così il
client lo distingue dagli altri 409 di questa API senza riconoscerli dal testo, che è tradotto.

### Il 2026-09-04, poco dopo — anche i sinottici, i faceplate e le ricette

Lo stesso meccanismo, applicato **per file**: `GET /api/synoptics/:nome`,
`/api/faceplates/:id` e `/api/recipes/:id` restituiscono un `ETag` calcolato dai byte di quel file,
e il `PUT` corrispondente lo rimanda in `If-Match`. Due che salvano la stessa pagina: il secondo
prende 409 e il lavoro del primo resta.

**Per file e non per progetto**, ed è la parte che conta: tenere una versione sola avrebbe fatto
rifiutare il salvataggio di una pagina perché ne era stata salvata un'altra — un conflitto
inventato, che insegna a ignorare quelli veri. Lato SPA sono due meccanismi distinti per la stessa
ragione: `project.yaml` è un file solo scritto da dodici endpoint, le pagine sono N file con un
endpoint per ciascuna.

Un file che **non esiste** non ha versione, e crearlo passa: creare non è sovrascrivere. Ma se il
client porta un `If-Match` su un file assente il rifiuto è giusto — quella pagina è stata cancellata
da qualcun altro, e riscriverla senza saperlo la resusciterebbe.

Salvare **contenuto identico** non è un conflitto e non produce una versione nuova: la versione è
dei byte. Emerso provando, e va detto perché sembra un difetto e non lo è.

Le tre scritture sono diventate anche **atomiche** (temporaneo + `fsync` + `rename`), come
`project.yaml`: una pagina troncata da un processo ucciso a metà scrittura non si carica più, e il
progetto si riapre senza quella pagina.

**Q30 è chiusa.** Le tre domande hanno una risposta: il lock (2026-09-03), il controllo ottimistico
su `project.yaml` (2026-09-04) e quello sui file per entità (2026-09-04, stesso giorno).

**Decided**: la domanda 1 il 2026-09-03, la domanda 2 il 2026-09-04. La domanda 3 — cosa vede chi
perde la corsa — ha ora una risposta per `project.yaml` (un 409 che si spiega e un banner che offre
di ricaricare) e nessuna per i sinottici.

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

---

## Q45 — Il container di produzione non riparte dopo un reboot senza un permesso che l'utente finale non ha

Contenuto spostato in [`docs/plans/2026-09-12-q45-linger-permesso-produzione.md`](plans/2026-09-12-q45-linger-permesso-produzione.md) il 2026-09-12. **Decided:** not yet.

---

## Q46 — `/api/fs/browse-dirs` e `/api/fs/mkdir` rispondono senza autenticazione

Contenuto spostato in [`docs/plans/2026-09-12-q46-verifica-projects-root.md`](plans/2026-09-12-q46-verifica-projects-root.md) il 2026-09-12. **Decided:** decisa e realizzata il 2026-09-09, manca la conferma a schermo.

---

## Q47 — `/api/script/exec` esegue codice arbitrario e nessuno lo chiama più

*Aperta il 2026-09-09 dalla revisione pre-2.7.0. Nessuna decisione presa.*

**Context.** La rotta esegue un frammento Python passato nel corpo. Il client
`api.execScript` non era chiamato da nessuna parte (il suo stesso commento diceva che gli
oggetti non portano più codice inline) ed è stato tolto. La rotta server resta, montata due
volte: sul router admin e — sullo stack di sviluppo, non in `--no-admin` — sul viewer a
livello **Operator**. Un endpoint che esegue codice e che nessuna interfaccia usa è
superficie d'attacco pura, e `RestrictedPython` è spesso assente (lo dice il log a ogni
avvio), quindi «codice arbitrario» va letto alla lettera.

**Options.**
1. **Rimuovere** rotta e handler (19 righe). Se un giorno serve una console Python, si
   riprogetta con la sandbox come prerequisito.
2. Tenerla, ma solo Admin, solo sul router admin, e solo se `RestrictedPython` è presente.
3. Lasciare com'è.

**Default for PoC.** Com'è (3). Raccomandazione: (1).

**Decided:** 2026-09-09 dal maintainer — rimuovere, dopo aver verificato che nessuno la
usasse: non l'editor, non gli script di progetto (girano dentro il runtime e non fanno HTTP),
non l'assistente, non il viewer, non gli script del repo. Realizzato lo stesso giorno (ramo
`chore/revisione-pre-2.7.0`): rotta e handler tolti, `check_no_admin.sh` sonda
`/api/build/packages` al suo posto. Restano `/api/script/run/:name` e `/api/script/check`.

---

## Q48 — `/api/deploy/remote` scarica un binario che non esiste, e duplica il deploy

*Aperta il 2026-09-09 dalla revisione pre-2.7.0. Decisa lo stesso giorno.*

**Context.** La WelcomeScreen ha «Installa runtime» → `POST /api/deploy/remote`
(`deploy.rs`), che scarica
`github.com/soligolab/sws/releases/latest/download/sws-runtime-linux-{arch}`, lo copia via
scp e fa `systemctl restart sws-runtime.service` **di sistema**. Verificato il 2026-09-09:
**404 per entrambe le architetture** — le release su GitHub non hanno asset, il progetto
pubblica immagini container. Quindi il pulsante fallisce sempre («download fallito», visto
anche nei log del maintainer), installa un binario nativo con privilegi di sistema — la
postura opposta al container rootless con l'utente limitato — ed è una **seconda
implementazione** di ssh/scp/sshpass accanto a `packaging.rs` (`validate_remote_path`
identica nei due file). Il commento in WelcomeScreen sostiene che «non è un doppione»
perché ConfigView richiede un progetto aperto; l'argomento vale per la **schermata**, non
per l'**endpoint**.

**Options.**
1. Togliere endpoint, `deploy.rs` e il modale della WelcomeScreen; rimandare a
   ConfigView → Runtime per il deploy container.
2. Ripuntare il modale al deploy **container** (`/api/deploy/device-container`), che oggi
   richiede un progetto aperto solo per convenzione del pannello.
3. Pubblicare i binari nelle release e mantenere due percorsi di deploy.

**Default for PoC.** Com'è (rotto). Raccomandazione: (1) subito — è un pulsante che
fallisce sempre — e (2) se la prima installazione da WelcomeScreen serve davvero.

**Decided (2026-09-09, maintainer):** (2), dopo aver analizzato le conseguenze di (1):
togliere il modale avrebbe lasciato la «macchina nuova» senza un modo di installare dall'IDE,
e ConfigView richiede un progetto aperto solo per convenzione del pannello. Realizzata sul
ramo `feat/Q48-installa-dalla-welcome`:

- il modale della WelcomeScreen chiama **`/api/deploy/device-container`** — lo stesso
  endpoint di Configurazione → Runtime — in modalità registry, con `imageRef` vuoto: è il
  dispositivo a decidere `latest-<arch>`. Via i campi architettura e percorso remoto, utente
  predefinito `user` (era `root`), **nessuna password in `localStorage`** (prima:
  `sws.deploy.<host>` in chiaro). Chiave host cambiata → stesso pulsante di ConfigView,
  mai automatico;
- i sei file di `deploy/container/` sono **incorporati nel binario** (`include_str!`), così
  il deploy container funziona anche da un runtime che non ha il checkout del repo — prima
  rispondeva 503. Il sorgente «archivio locale» continua a volere il repo (400 se manca);
- `deploy.rs` e `/api/deploy/remote` sono **rimossi**; `scripts/check_chiave_host.sh` conta
  ora tre handler ssh, tutti in `packaging.rs`.

Lo stesso giorno, su richiesta del maintainer, anche ConfigView ha smesso di salvare
password in `localStorage` (`sws.runtime.targetPass`, campo `pass` di `sws.saved-devices`):
regola generale «nessuna password nel browser», pulizia del profilo all'avvio
(`passwordNelBrowser.ts`) e guardia statica `check_password_browser.sh`.

---

## Q49 — TLS senza verifica del certificato, in quattro posti

Contenuto spostato in [`docs/plans/2026-09-12-q49-tls-pinning-lvgl-mqtt.md`](plans/2026-09-12-q49-tls-pinning-lvgl-mqtt.md) il 2026-09-12. **Decided:** decisa e in parte realizzata il 2026-09-09, resta il viewer LVGL e il plugin MQTT.

---

## Q50 — I dispositivi registrati: dal browser al server, e popolati dal discovery mDNS

*Aperta il 2026-09-09 su proposta del maintainer. Decisa il 2026-09-10.*

**Context.** Configurazione → Dispositivi (T-24) tiene la lista dei pannelli in `localStorage`
(`sws.saved-devices`): del browser, non del progetto né dell'installazione. Su un altro PC, o
dopo aver svuotato il profilo, la lista è vuota. Si compila solo a mano, un modulo per
dispositivo, mentre Configurazione → Runtime → «Cerca runtime» **trova già** i pannelli via mDNS
(`_sws._tcp`, `discover.rs`: hostname stabile, `admin_url`, versione, se è in container) e li
butta via dopo averne usato uno. Il maintainer: «quando fai il discovery vorrei poter aggiungere
il dispositivo alla lista» e «la lista sarebbe da valutare se salvarla in `~/sws_projects`».
Dalla stessa giornata la lista **non porta più la password** (regola «nessuna password nel
browser»): spostarla lato server non riapre quel tema, purché il file non la contenga.

**Options.**
1. **Lista sul server, nella cartella di configurazione** (`<config>/dispositivi.yaml`, accanto a
   `dispositivi_conosciuti.yaml` delle impronte TLS e a `known_projects.json`): `GET/PUT
   /api/devices` solo admin, `{label, url, user}` senza password. È «ciò che questa
   installazione sa del mondo», stessa famiglia delle impronte pinnate: un domani la riga del
   dispositivo può mostrare se il certificato è memorizzato. Migrazione: al primo avvio, se il
   server ha lista vuota e il browser ne ha una, si carica una volta e si toglie dal browser.
2. **Lista sul server, nella cartella dei progetti** (`<projects_root>/dispositivi.yaml`), come
   propone il maintainer: è la cartella dell'utente, sopravvive a un clone nuovo del repo e
   viaggia con i backup dei progetti. Contro: i progetti sono dati che si esportano e si
   deployano, la lista dei pannelli no — un `dispositivi.yaml` in mezzo alle cartelle dei
   progetti è un corpo estraneo che `browse-dirs` e la WelcomeScreen devono imparare a
   ignorare; e sull'IDE di sviluppo (`start_editor.sh`) config e progetti stanno comunque
   entrambi in `.run-editor/`, quindi la differenza pratica oggi è nulla.
3. **Restare nel browser**, ma aggiungere il pulsante dal discovery. Il minimo; non risolve la
   lista che sparisce.

In tutte: nei risultati di «Cerca runtime» un pulsante «+ Dispositivi» per riga (etichetta =
hostname, URL = `admin_url`, utente vuoto), e in Dispositivi un «Cerca runtime» che mostra i
trovati non ancora in lista con lo stesso pulsante. Il discovery è già lì: si tratta di non
buttarne via il risultato.

**Default for PoC.** Com'è (browser, solo a mano). Raccomandazione: **(1)** con il pulsante dal
discovery — la lista è conoscenza dell'installazione, e il posto delle altre conoscenze
dell'installazione è la cartella di configurazione. Se invece pesa di più «viaggia con i miei
progetti», (2) è un cambio di una riga: il percorso.

**Decided (2026-09-10, maintainer):** una variante di (2): «in sws_projects prevederei una
cartella di configurazione dove tenere questo file e i file di setup dell'ambiente». Quindi
**`<cartella progetti>/.ambiente/dispositivi.yaml`** — la cartella dei progetti è quella che
l'utente conosce e salva; `.ambiente` è il suo angolo per ciò che descrive l'ambiente di lavoro e
non è un progetto (questa lista oggi, altro domani). Il punto davanti la tiene fuori dall'elenco
dei progetti e dai nomi ammessi per un progetto, senza toccare `list_projects` né `browse-dirs`.
La password resta come il 2026-09-09: nella riga, in memoria finché la pagina è aperta, mai nel
file. Realizzato sul ramo `feat/Q50-dispositivi-sul-server`:

- **Server** (`dispositivi.rs`): `GET`/`PUT /api/devices`, admin, assenti su `--no-admin`. Il PUT
  sostituisce la lista intera, valida (etichetta, URL `http(s)://host[:porta]`, nessun URL
  doppio), normalizza (spazi, slash finale), scrive in modo atomico (file accanto e `rename`) e
  lo annota nell'audit (`devices.save`). `deny_unknown_fields`: un client che manda `pass` riceve
  422, un file scritto a mano con `pass` non si legge. 6 test.
- **Editor**: la scheda Dispositivi legge dal server; al primo avvio dopo l'aggiornamento, se il
  server è vuoto e il browser ha la vecchia lista, la porta su una volta sola (senza `pass`) e
  toglie la chiave `sws.saved-devices`. Salvataggio ottimista con ripristino e messaggio se il
  server rifiuta. **«Cerca dispositivi in rete»** anche qui (la tabella di Q52 con un «+» per riga,
  «già in lista» per chi c'è), e **«+ Dispositivi»** su ogni runtime trovato da «Cerca runtime»
  nella sezione connessione. `dispositiviRegistrati.ts` con i test delle parti pure.

**Limite dichiarato**: «l'ultimo che salva vince» — due editor sullo stesso runtime che salvano
insieme si sovrascrivono, com'era già con il browser.

---

## Q51 — «Pacchetto runtime» e il deploy binario sono strumenti di sviluppo: nascosti quando il repo non c'è

*Aperta il 2026-09-09 su osservazione del maintainer («è una funzione pensata per un uso di
sviluppo, cosa mia, più che per l'utente finale: valutare se nasconderla»). Decisa lo stesso
giorno.*

**Context.** In Configurazione → Runtime due sezioni parlano al maintainer e non all'utente:
**Pacchetto runtime** (`POST /api/build/package` → `scripts/package.sh`: cargo, pnpm, tarball in
`dist/`) e **Installa su dispositivo → Binario** (deploy nativo con `systemctl` e sudo, già
marcato «solo in sviluppo» nel testo dall'8 settembre, che prende i pacchetti da `dist/`).
Entrambe **richiedono il checkout del repo**: senza, la prima risponde «Build non disponibile» e la
seconda mostra una lista vuota — pulsanti che falliscono sempre, per chi non è lo sviluppatore.
Il resto della scheda (connessione, deploy del progetto, log, variabili live, container dal
registry) è per l'utente e resta com'è. Il server sa già se gira da un checkout: `repo_root`
(`packaging.rs`), reso opzionale da Q48. Oggi però l'editor **non può distinguere** «niente repo»
da «repo con `dist/` vuota»: `GET /api/build/packages` risponde lista vuota in entrambi i casi.

**Options.**
1. **Il repo come segnale.** Una rotta leggera `GET /api/build/stato` → `{ repo: bool }`. Con
   `repo: false` l'editor non disegna «Pacchetto runtime», il selettore Binario/Container sparisce
   (resta il container) e in «Sorgente immagine» sparisce «archivio locale» (vuole il repo, Q48 lo
   dice con un 400). Con `repo: true` tutto come oggi. Niente da impostare né da ricordare: lo
   sviluppatore lancia `start_editor.sh` dalla radice del repo, l'utente ha un editor installato o
   in container senza `scripts/`.
2. **Un'impostazione «modalità sviluppo»** in Configurazione → IDE. Esplicita, ma è un interruttore
   in più da spiegare, e l'utente che lo accende per curiosità trova pulsanti che falliscono.
3. **Lasciare tutto visibile**, con il testo «solo sviluppo» già presente. Zero lavoro; la scheda
   Runtime resta piena di cose che per l'utente non funzionano.

**Default for PoC.** Com'è (3). Raccomandazione: **(1)** — è un fatto del server, non una
preferenza. Lavoro: una rotta, un hook nell'editor, tre condizioni di rendering, un test Rust e
la sonda in `check_no_admin` (`--no-admin` non monta le rotte build: la sonda verifica che la
nuova rotta stia dietro l'admin come le sorelle).

**Decided (2026-09-09, maintainer):** (1), insieme a Q52 sul ramo
`feat/Q51-Q52-installa-guidata`. `GET /api/build/stato` → `{ repo: bool }` (admin, assente su
`--no-admin`); l'editor lo chiede al montaggio della scheda Runtime e finché non sa la risposta
non disegna nulla di sviluppo. Con `false`: niente «Pacchetto runtime», niente selettore
Binario/Container (resta il container), niente «archivio locale» (resta il registry), e i due
elenchi di pacchetti non si chiedono nemmeno. Con `true` tutto come prima, ma il container è
comunque la scelta iniziale e il binario si chiama «solo sviluppo». Sonda in
`check_no_admin.sh`.

---

## Q52 — «Installa su dispositivo»: container per primo, campi dal dispositivo connesso, e un discovery che trova **qualunque** macchina in rete

*Aperta il 2026-09-09 su richiesta del maintainer, precisata e decisa lo stesso giorno.*

**Context.** In Configurazione → Runtime → «Installa su dispositivo» il modulo parte oggi in
modalità **Binario** (`deployMode` predefinito `"binary"`, il percorso nativo «solo sviluppo» di
Q51) e con utente SSH predefinito **`root`** — contro la specifica delle credenziali dell'8
settembre (`user` è l'utente finale, nessun comando di produzione presuppone un accesso
privilegiato; il container è rootless). I campi (variante immagine, riferimento, host SSH, porta,
utente, password, cartella temporanea, cartella dati, installazione pulita) sono vuoti o generici
anche quando l'editor **è già connesso** a un dispositivo; l'unica precompilazione è il pulsante
«Usa» dei risultati di «Cerca runtime», che però cerca **solo runtime SWS** (`_sws._tcp`) — utile
per aggiornare, inutile per la prima installazione su una macchina che SWS non l'ha ancora.

**La precisazione del maintainer, che è la specifica.** «SWS è agnostico e il runtime devo
poterlo installare su un qualsiasi dispositivo che trovo in rete. L'idea è che con mDNS mi dai
una tabella dei dispositivi e se lo riconosco lo seleziono, tu mi chiedi le credenziali e
connettendoti cerchi di capire che dispositivo è e se è pronto a ricevere il container.» Quindi
niente marca, niente elenco di modelli: la macchina la riconosce l'utente dal nome che vede in
rete; SWS la **interroga** dopo, con le credenziali che gli vengono date.

**Il flusso, in tre passi.**

1. **Tabella dei dispositivi in rete**, via mDNS generico e non solo `_sws._tcp`: si enumerano i
   servizi annunciati (`_services._dns-sd._udp`) e si raccolgono gli host che espongono `_ssh._tcp`,
   `_sftp-ssh._tcp`, `_workstation._tcp`, più i runtime SWS già noti. Colonne: nome host, IP,
   servizi visti, «SWS già presente» quando `_sws._tcp` risponde. Nessun filtro per produttore: è
   l'utente che riconosce la sua macchina dal nome. Limite onesto: mDNS mostra solo chi si
   annuncia; una macchina senza Avahi/systemd-resolved resta invisibile e si inserisce a mano
   come oggi (host o IP).
2. **Credenziali**, chieste al momento e **mai memorizzate** (regola del 2026-09-09): utente
   predefinito `user`, porta 22, password nel modulo. Stessa politica ssh del deploy:
   `StrictHostKeyChecking=accept-new`, `sshpass -e`, chiave cambiata → pulsante, mai automatico.
3. **Sondaggio del dispositivo** (`POST /api/device/probe {host, port, user, password}`): una
   sola sessione ssh che legge `uname -m`, `/etc/os-release`, `podman --version`, `id`,
   `/etc/subuid` per l'utente, `loginctl show-user` (linger), `systemctl --user` raggiungibile,
   spazio libero nella cartella dati prevista, e se c'è già un container `sws-runtime`. Risposta:
   una **lista di controlli** verde/rosso con il rimedio accanto («podman non installato»,
   «manca la mappatura subuid: `usermod --add-subuids …` da un amministratore», «linger spento:
   il container non riparte al riavvio», «spazio: 300 MB, ne servono ~1 GB»), l'architettura
   rilevata e quindi la variante immagine proposta (`latest-arm64`, `latest-arm64-generic`,
   `latest-amd64`), e «già installato: versione X» quando c'è. `install-container.sh` fa già molti
   di questi controlli al momento dell'installazione: il sondaggio li **anticipa** e li mostra
   prima di lanciare qualcosa, e la logica si può tenere in un solo posto (uno script
   `sws-probe.sh` incorporato nel binario come i sei file di Q48, eseguito via ssh).

**Cosa si precompila dal dispositivo connesso** (quando l'editor è già collegato a un runtime):
host SSH dall'URL di connessione, utente `user`, variante dall'architettura che il runtime
dichiara; il sondaggio conferma o corregge.

**Options.**
1. **Il flusso intero**: tabella mDNS generica + credenziali + sondaggio + modulo precompilato,
   con container per primo e `root` sparito.
2. **Sondaggio e precompilazione, senza il discovery generico**: si inserisce host o IP a mano,
   poi il resto del flusso è identico. È il flusso (1) senza il passo 1, e il passo 1 si aggiunge
   dopo senza toccare gli altri due.
3. **Solo il default a container e `user`**, il resto com'è.

**Default for PoC.** Com'è. Raccomandazione: **(1)** costruito nell'ordine 3 → 2 → 1: prima il
sondaggio (è quello che dà valore: «è pronto o no, e perché»), poi la precompilazione, infine la
tabella mDNS — che si lega a Q50 (stessa lista, stesso «+ Dispositivi») e sostituisce l'attuale
«Cerca runtime» invece di affiancarlo. Indipendentemente dalla decisione, il predefinito `root`
è un difetto rispetto alla specifica e si può correggere subito.

**Decided (2026-09-09, maintainer):** (1), il flusso intero, un ramo solo con Q51, la tabella nel
modulo Installa («Cerca runtime» della connessione resta com'è). Realizzato:

- **Server.** `POST /api/device/probe` (`sonda.rs`): una sessione ssh, la sonda
  `deploy/container/sonda-dispositivo.sh` (POSIX, incorporata nel binario) su stdin a `sh -s`,
  risposta JSON con dispositivo, controlli (`ok`/`avviso`/`errore` + rimedio), variante immagine
  proposta, SWS già presente, `pronto`. Il giudizio è in Rust (`valuta_sonda`, 17 test), la sonda
  stampa solo fatti. Stessa politica ssh del deploy (`run_ssh_cmd_stdin`: `sshpass -e`,
  `accept-new`, chiave cambiata → `chiave_host_cambiata: true`), timeout 30 s con `kill_on_drop`,
  audit `device.probe` senza password. `GET /api/discover/dispositivi` (`discover.rs`): quattro
  `browse` mDNS concorrenti (`_ssh`, `_sftp-ssh`, `_workstation`, `_sws`), 3 s, una riga per host
  con servizi visti e «SWS presente» dalle TXT. Entrambe admin, assenti su `--no-admin`.
- **Editor.** La sezione «Installa su dispositivo» è un flusso in cinque passi: destinazione
  (a mano, precompilata dall'URL del dispositivo connesso finché il campo non è toccato, o dalla
  tabella «Cerca dispositivi in rete»), credenziali (`user` predefinito, password solo nello stato),
  «Verifica dispositivo» con la lista di controlli e la variante che finisce nel riferimento
  immagine se il campo era vuoto o nostro, immagine, «Installa/Aggiorna» — spento solo quando la
  verifica ha trovato errori. «Dimentica la vecchia chiave» rilancia ciò che si era fermato,
  sondaggio o deploy. `root` sparito.
- **Guardie e prove.** `check_sonda.sh` (statica, la sonda gira con `sh -s` su questo PC),
  `check_no_admin.sh` con le tre rotte, `tests/i18nParita.test.ts` (it/en stesse chiavi),
  `tests/sondaggio.test.ts`. 15 test Rust in `discover.rs`.

**Limiti dichiarati.** mDNS mostra solo chi si annuncia (`_ssh._tcp` lo pubblica Avahi con
`publish-ssh`, o macOS; molti Linux annunciano solo `_workstation`): la tabella è incompleta per
costruzione, e host o IP si scrivono a mano. La variante arm64 (SDK Pixsys) contro arm64-generic
si propone leggendo `os-release` (contiene «pixsys»?): **vista sul campo la sera stessa** su un
TC620 con Pixsys OS 2.1.1 (`PRETTY_NAME` «Pixsys OS 2.1.1» → `latest-arm64`, podman 5.0.2,
storage in `/mnt/data/state/user/containers/storage`), modificabile con un click. La versione di un SWS già installato si legge dal tag dell'immagine e
solo se è una versione (`latest-*` → sconosciuta).

**Seguito, stessa sera (per dare senso alla ricompilazione delle immagini):** `/api/system`
dichiara `arch`, `hostname` e `container` (il rilevamento del motore è passato da `main.rs` a
`sws_web::system`, con i suoi test) e l'editor collegato a un dispositivo propone la variante
immagine dall'architettura senza aspettare il sondaggio, dicendo da dove viene; il modale «Installa
runtime» della WelcomeScreen ha la stessa «Verifica dispositivo» e usa la variante che ne esce;
`install-container.sh` controlla podman ≥ 4.4 (errore, o nota con `--no-autostart`) e le mappature
subuid/subgid **prima** di toccare qualcosa, con gli stessi rimedi della sonda.

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
| Q17 | `apply_recipe` scrive i tag senza contesto utente | 2026-09-06 |
| Q18 | Colori del testo dai token di tema su pagine con sfondo scelto a mano | 2026-08-25 |
| Q19 | Il backend DRM del viewer LVGL apre i device a mano, mentre PixsysOS li distribuisce con `seatd` | 2026-08-25 |
| Q20 | Il viewer LVGL non si accorge che il progetto è cambiato | 2026-08-25 |
| Q21 | Due superfici Python nel progetto, in due punti lontani dell'interfaccia | 2026-08-25 |
| Q22 | La `sparkline` fa crashare il viewer LVGL quando la pagina ha altri widget | 2026-08-25 |
| Q24 | Il font del viewer LVGL non ha le lettere accentate | 2026-08-27 |
| Q27 | Il server non fa rispettare il `data_type` dei tag in scrittura | 2026-09-06 |
| Q42 | Gli script Python scrivono i tag senza lo scaling inverso | 2026-09-06 |
| Q33 | `POST /api/system/stop` viene annullato in silenzio dal salvataggio delle Sorgenti | 2026-09-04 |
| Q34 | Il cron degli script globali non capisce `*/5`, e non parte in silenzio | 2026-09-03/04 |
| Q35 | «fuori pagina» implicito nelle coordinate o campo esplicito? | 2026-09-06 |
| Q37 | Cosa c'è attorno alla pagina sul pannello, e se il foglio non ci sta | 2026-09-06 |
| Q38 | `size_mode: ratio` senza dimensioni esplicite: il bordo non arriva al canvas | 2026-09-06 |
| Q41 | La chat IA deve mostrare consumo di token e credito residuo? | 2026-09-06 |
