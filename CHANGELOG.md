# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dalla release `2.0.0` in poi il progetto adotta [Semantic Versioning](https://semver.org/)
(`MAJOR.MINOR.PATCH`), non più [CalVer](https://calver.org/): il motore di rendering LVGL è un
cambio abbastanza grande da giustificare un major bump esplicito invece che il prossimo numero
di mese in sequenza — vedi nota sotto e `docs/CONTEXT.md`. Le release precedenti (`2026.7.0` e
prima) restano in CalVer `YYYY.M.PATCH`, non rinumerate retroattivamente.

## [Unreleased]

### Fixed

- **Log Remoti (ConfigView)**: il pannello faceva un fetch diretto dal browser a
  `{target}/api/auth/login` + `/api/logs`, che fallisce silenziosamente contro un runtime remoto
  in HTTPS con certificato self-signed (il browser non può essere istruito ad accettarlo) —
  codice pre-refactor mai migrato al relay `/ws/remote/logs` già usato dalla vista "Live tags".
  Riscritto sullo stesso pattern: WebSocket via backend locale, niente credenziali duplicate nel
  browser, niente polling a intervalli (il relay già fa live-tail).
- **Client ID MQTT random non risolto su reload**: `resolve_mqtt_client_ids` (che compone
  `client_id` + `instance_id` persistente quando `random_client_id.enabled` è attivo) veniva
  chiamato solo da `apply_loaded_project` (boot/apertura progetto) e dall'override manuale, ma
  non da `system_start` (`POST /api/system/start`, bottone "Start" dell'editor) né dal reload
  dopo import di un bundle synoptic — questi due path passavano al supervisor il `client_id`
  letterale del progetto, senza suffisso random. Se quell'id nudo collide con un'altra sessione
  viva sullo stesso broker, il broker disconnette una delle due per spec MQTT — sintomo:
  connessione MQTT che funziona qualche minuto poi si ferma. Ora entrambi i path chiamano
  `resolve_mqtt_client_ids` prima del reload, come `apply_loaded_project`.

## [2.0.0] — 2026-08-11

**Cambio di schema di versioning**: da CalVer (`YYYY.M.PATCH`) a Semantic Versioning
(`MAJOR.MINOR.PATCH`), a partire da questa release. Il `2` è il motore di rendering **LVGL**
(dispositivi embedded senza browser, vedi sotto) — un cambiamento abbastanza sostanziale da
meritare un numero di versione che lo segnali esplicitamente, invece di confondersi nella
sequenza mensile. Deciso dal maintainer, non dedotto da questa sessione.

### Added

- **Motore di rendering LVGL** per target embedded (framebuffer/Wayland), come seconda modalità
  di progetto accanto al web: nuovo crate `sws-lvgl-viewer` (client REST/WS verso il runtime
  esistente, nessuna modifica al runtime/protocolli) interpreta le pagine synottico e crea i
  widget LVGL corrispondenti — **16 tipi supportati**: rettangolo, ellisse, linea, testo, bottone,
  navbutton (naviga tra le pagine di un progetto), LED, slider, progress bar, checkbox, radio
  (approssimato con checkbox, LVGL non ne ha uno nativo), gauge (ago + arco su scala 270°, colore
  dell'arco fissato alla creazione — `lv_meter` non espone un setter per il colore di un
  indicatore già creato), state_lamp (stesso modello value→label→color di text_list), table
  (righe statiche, non un datagrid), trend e alarm_viewer (vedi bullet dedicati sotto) — in una
  **finestra SDL2 interattiva** (~60fps), risoluzione
  derivata dalla prima pagina caricata (non più fissa a compile-time). I widget tag-dipendenti si
  aggiornano dal vivo (connessione `/ws/tags` persistente, mutati sul posto senza essere
  ricreati) e un **input device puntatore** collegato rende bottone/checkbox/radio/slider
  realmente cliccabili/trascinabili, con scrittura del tag corrispondente sul backend
  (`PUT /api/tags/:id`) — verificato end-to-end con click/drag sintetici via X11 XTest, non solo
  a compilazione. **Progetti multi-pagina**: un `navbutton` cambia pagina risolvendo il suo
  `target_page` (l'id interno della pagina, non il nome file) contro l'elenco pagine del
  progetto. Wizard di creazione progetto esteso con la scelta del target (Web/LVGL + device
  framebuffer) e palette oggetti dell'editor filtrata di conseguenza per i progetti LVGL.
  Verificato anche il funzionamento su **Wayland nativo** (non solo XWayland). Sbloccati/corretti
  cinque bug (analisi completa in `docs/OPEN_QUESTIONS.md` Q14): due upstream — un bug di
  lifetime in `lvgl::Display::register()` (crate `lvgl` 0.6.2), risolto con uno shim di
  registrazione display in Rust puro; e un bug in `lvgl-sys` 0.6.2 la cui `strncmp`/`strcmp` —
  esportate senza guardia, sostituiscono quelle di libc per l'intero processo — potevano
  corrompere qualunque altra libreria C nello stesso binario (scoperto perché SDL2/D-Bus ci è
  finito dentro), risolto vendorizzando una copia patchata del crate — e tre propri: il colore
  LED (`on_color`/`off_color`) veniva silenziosamente ignorato (`lv_led` non legge lo `Style`
  `bg_color` come gli altri widget); il titolo della finestra SDL2 mostrava caratteri corrotti
  (mojibake sull'em-dash nel titolo WM_NAME); e un crash SIGSEGV riproducibile (più un artefatto
  di corruzione testo) durante la navigazione ripetuta tra pagine col catalogo widget completo,
  bisecato con oltre 10 pagine di prova ad-hoc e risolto passando al pattern standard LVGL per il
  cambio schermo (`lv_disp_load_scr` + `lv_obj_del` invece di `lv_obj_clean` + riuso in-place) —
  il meccanismo esatto non è stato isolato con piena certezza, documentato onestamente come tale.
  Sviluppato su quindici branch di lunga durata in sequenza (`feature/lvgl` → ... →
  `feature/lvgl-pixsys-deploy`), mergiati su `main` con 15 squash-merge sequenziali, uno per fase
  logica (branch non cancellati, decisione di pulizia rimandata). Vedi ADR 0002,
  `docs/plans/2026-08-07-lvgl-engine.md`.
- **Palette oggetti**: per un progetto "web", ogni voce con anche una controparte LVGL mostra un
  piccolo badge "L" sull'icona. Verifica sistematica campo per campo (`sws-web/src/synoptic.rs`
  vs `sws-lvgl-viewer/src/model.rs`): i nomi combaciano per tutti i tipi supportati da LVGL.
- **LVGL — `checkbox`/`radio` onorano `checked_value`/`unchecked_value`**: confronto per stringa
  col valore del tag (default `true`/`false`, come il web — non più un booleano fisso), sia in
  lettura (creazione + aggiornamento a ogni frame) sia in scrittura al click. Verificato con un
  checkbox demo a valori stringa (`"ON"`/`"OFF"`) sull'istanza isolata `.run-12`. Nel processo,
  corretta una nota precedente in `docs/OPEN_QUESTIONS.md` Q14: `stroke_dasharray` appartiene al
  tipo `pipe`, non `line` — la linea LVGL (sempre piena) era già equivalente al web, non era un
  gap da chiudere.
- **LVGL — `trend` (`lv_chart`)**: primo widget LVGL che non si limita a `/ws/tags` (solo il
  valore corrente) — interroga periodicamente lo storico (`GET /api/history/:tag`, stesso
  endpoint REST del web) con un nuovo poller in background per serie, poll ogni 2s. Modalità
  `SCATTER` (non `LINE`) per coordinate X vere proporzionali al tempo invece di un indice
  fittizio; multi-serie (`extra_tags`) con colori da `trend_series_styles`/`line_color` (solo il
  colore è onorato — spessore/tratteggio/riempimento/smoothing restano gap dichiarati); range Y
  fisso o autofit. Verificato end-to-end su `.run-12` (autofit, sincronia con slider/gauge/text
  sullo stesso tag) e multi-serie (due tag con numero di campioni diverso, senza corruzione
  incrociata). Dettagli tecnici (perché `SCATTER`, perché le coordinate sono relative, perché
  `point_cnt` non può essere impostato per-serie) in `docs/OPEN_QUESTIONS.md` Q14, seguito 7.
- **LVGL — `alarm_viewer`** (solo modalità `"list"`; `"banner"`/`"table"` segnalati come non
  supportati invece di renderizzare qualcosa di diverso da quanto configurato): righe a slot fisso
  (dot colorato per severità + età relativa + messaggio troncato + pulsante ACK), riassegnate a
  ogni frame in base a quali allarmi sono attivi — stesso principio delle celle di `table`. Si
  appoggia a `/ws/alarms` (un canale push vero, non un poller come `trend`) tramite un nuovo
  `client::spawn_alarm_subscription`. `POST /api/alarms/:id/ack` sul click, senza header
  `Authorization` (stesso comportamento già in uso per le scritture tag da checkbox/slider).
  Verificato end-to-end su `.run-12`: due allarmi demo sullo stesso tag di slider/gauge/trend,
  comparsi in tempo reale scrivendo il tag oltre soglia, ACK confermato via REST, ordinamento
  più-recente-prima con due allarmi attivi insieme. Dettagli tecnici (protocollo di `/ws/alarms`,
  perché il contesto del pulsante ACK usa un `RefCell` invece del solito `Box::leak` fisso) in
  `docs/OPEN_QUESTIONS.md` Q14, seguito 8.
- **LVGL — `symbol`/`faceplate`: analisi architetturale, nessuna implementazione** (voce nuova
  `docs/OPEN_QUESTIONS.md` Q15). LVGL 8.x non ha un renderer SVG integrato — un vincolo della
  libreria, non risolvibile componendo primitive come per gli altri widget. Quattro opzioni
  presentate (rasterizzazione offline, riscrittura a mano dei soli 17 simboli "builtin",
  rasterizzazione runtime con una crate SVG, non supportato), con raccomandazione ma nessuna
  decisione presa — resta al maintainer. `faceplate` isolato come problema diverso e più piccolo
  (composito di oggetti già ordinari), non affrontato qui. Corretta anche Q6 (Symbol library
  packaging): i simboli non passano mai da `include_str!()` in `sws-web`, e sono 29 in totale
  (17 builtin + 12 vendored), non 22 come scritto in precedenza.
- **LVGL — deploy su Pixsys reali come companion opzionale, non un fork**: `scripts/yocto/build.sh
  --with-lvgl` (default off) cross-compila anche `sws-lvgl-viewer` nella stessa pipeline di
  `sws-runtime`; nuovo `deploy/yocto/sws-lvgl-viewer.service` affianca `sws-kiosk.service` come
  companion opt-in (non auto-abilitato); `Containerfile.aarch64` copia l'intera `bin/` invece del
  solo `sws-runtime` così la stessa immagine può contenere anche il viewer LVGL, `ENTRYPOINT` di
  default invariato. In tutti i casi il comportamento senza il nuovo flag/file resta
  byte-per-byte quello di prima. Verificato su hardware reale (`tc620-a-p3-c6-07aff9.local`):
  confermato che un container rootless accede al socket Wayland dell'host solo con
  `--userns=keep-id` (senza, permission denied per la rimappatura UID di podman rootless) — non
  distruttivo, il `sws-runtime` reale in esecuzione sul device non è stato toccato. Rendering LVGL
  vero non ancora verificato: serve una cross-compilazione con l'SDK Yocto Pixsys, non disponibile
  in questa sessione. Dettagli in `docs/OPEN_QUESTIONS.md` Q14, seguito 9, e
  `docs/DEPLOY_CONTAINER_AARCH64.md` §4.
- **LVGL — `--with-lvgl` esteso anche al percorso container generico aarch64 (senza SDK)**: su
  richiesta esplicita del maintainer di preferire per ora questo percorso invece di quello
  SDK-tuned Pixsys, `scripts/build_container_aarch64_generic.sh --with-lvgl` builda anche
  `sws-lvgl-viewer` dentro il container builder QEMU-emulato esistente, con un nuovo layer
  dedicato (`deploy/container/Containerfile.aarch64-generic-lvgl.builder`: clang/libclang/
  libsdl2-dev, separato dal builder condiviso così il percorso `sws-runtime`-only non si
  appesantisce). Stesso principio non-regressivo delle altre estensioni `--with-lvgl`: default
  invariato. Questo percorso richiede root (verificato 2026-08-01 per il solo `sws-runtime`) e
  `sudo` è negato dalla policy dei permessi di questo progetto a livello di sistema, non solo come
  prompt interattivo — il maintainer ha lanciato lui stesso la build. **Riuscita**: `sws-lvgl-viewer`
  compila sotto emulazione QEMU (bindgen/libclang inclusi) esattamente come `sws-runtime`, ELF
  aarch64 valido da 18 MB, immagine pubblicata su `ghcr.io/soligolab/sws-runtime` con tre tag
  (verificato che contenga davvero entrambi i binari, non solo dal log dello script). Corretto anche
  un bug dello script scoperto da questo stesso run: `podman login`/`push`, girando sotto `sudo`
  insieme al resto, non vedevano il login rootless fatto da utente normale — ora puntano
  esplicitamente all'`auth.json` di `$SUDO_USER` invece di richiedere un secondo login come root.
  `docs/HOWTO.md` cap. 1 aggiornato di conseguenza (percorso generico primario, percorso SDK
  preservato come alternativa in un blocco ripiegabile).
- **LVGL — rendering reale su hardware Pixsys (`tc620-a-p3-c6-07aff9.local`), backend DRM
  diretto + touch**: isolato un bug del driver kernel Rockchip out-of-tree di questo device sul
  percorso di commit KMS **atomico** (confermato con un tool indipendente, `modetest -a` contro
  `modetest` legacy — non il nostro codice), che produceva schermo nero indipendentemente dal
  toolkit usato (SDL2/kmsdrm e il driver `lv_drivers/display/drm.c` vendorizzato sono entrambi
  esclusivamente atomic). Bypassato con un nuovo backend `drm_display.rs`: rendering diretto via
  API DRM **legacy** (`drmModeSetCrtc`), bindgen contro libdrm, dumb buffer via ioctl raw. Nel
  processo isolati anche due bug SDL2 upstream distinti (Wayland: `SDL_CreateRenderer`/
  `SDL_GetWindowSurface` creano un contesto EGL eager indipendentemente dal flag richiesto; X11:
  `SDL_x11framebuffer.c` hardcoda `depth=32` contro il visual reale) — non risolvibili senza
  patchare SDL2 a monte, non tentato: il percorso del progetto per questa classe di device è ora
  il backend DRM diretto. Input touch via nuovo `touch_indev.rs`: legge evdev raw dal symlink
  dinamico già mantenuto da `find-touchscreen.service` (mai un device path hardcoded), eventi
  già calibrati da tslib a monte. Due bug estetici trovati nella prima verifica visiva reale e
  corretti: il gauge non forzava una forma circolare su una box non quadrata, lo slider
  riempiva l'intera altezza dichiarata invece di un track sottile (`lv_obj_set_ext_click_area`
  preserva l'area di tocco originale). **Primo rendering LVGL su hardware fisico in questo
  progetto**, confermato dal maintainer con touch funzionante.
- **Allarmi piazzabili come oggetti canvas**: due nuovi tipi SCADA, `alarm_bell`
  (campanella con dropdown attivi/storico/ack/shelve) e `alarm_banner` (barra con
  blink/ACK/priorità ISA-18.2), piazzabili su qualunque pagina invece che solo come
  chrome fissa globale. Nessuna migrazione automatica — la chrome fissa resta finché
  non viene rimossa manualmente (task successivo, con gate manuale).
- **Componente `DataTable` condiviso** (sort per colonna + filtro, dataset piccoli):
  sostituisce la lista Ricette in Config e aggiunge una terza modalità "Tabella"
  all'oggetto `alarm_viewer`.
- **Trend**: stile per-traccia (colore/spessore/tratteggio/riempimento/smoothing per
  ogni serie), drag-to-zoom sull'area del grafico (widget compatto ed espanso, con
  reset), pulsanti pan ◀/▶ sul widget compatto.
- **Watchdog MQTT (`max_silence_secs`) ora impostabile dall'IDE** (Config → Protocolli
  → sorgente MQTT → Connessione) — esisteva solo lato backend da settimane, l'unico
  modo di attivarlo era modificare `project.yaml` a mano.

### Fixed

- **Cancellare o rinominare una pagina non persisteva davvero**: `deletePage`/
  `renamePage` erano solo in-memory, `saveAll()` faceva solo upsert delle pagine
  correnti, e non esisteva `DELETE /api/synoptics/:name` (a differenza di
  faceplates/recipes). Il file della pagina "cancellata" restava orfano su disco e
  ricompariva a ogni riapertura progetto o riavvio del processo. Aggiunta la route +
  tracciamento dei nomi pagina noti su disco, per cancellare il file giusto a ogni
  salvataggio.
- **Il mirror Rust↔TypeScript di `SynopticObject` (e `SynopticPage`) mancava di
  decine di campi**, silenziosamente scartati da serde a ogni save/reload — non solo
  sul Trend (dove è stato notato), ma su `alarm_viewer`, `sparkline`, `pipe`/
  connettore (waypoints e routing inclusi), `bar_chart`, `pie_chart`, istanze
  `faceplate`, `lang_selector`, e il colore di sfondo dark-mode della pagina. Un
  confronto sistematico ha trovato e chiuso 62+ campi mancanti in un colpo solo.
- **Colori severità allarme incoerenti fra widget**: `alarm_viewer` mostrava un
  giallo diverso da `alarm_bell`/`alarm_banner` per lo stesso livello "Warning" —
  unificati in un'unica costante condivisa.
- **Filtro severità mancante su `alarm_viewer`**: il campo dati e il supporto nel
  renderer esistevano già, ma nessuna UI per impostarlo.

- **"Installa su dispositivo" installa dal registry**, non più solo da un archivio in `dist/`. Un selettore sceglie la sorgente: **Registry** (default) oppure **Archivio locale** per i dispositivi senza rete. Dal registry sul dispositivo arrivano solo l'installer e la unit quadlet — pochi kB invece di 59 MB — e il resto lo scarica lui, riusando i layer che ha già.
  - Nasce da un caso concreto: il 2026-07-31 il WP630 è stato installato dall'IDE scegliendo l'unico archivio presente, `0.1.0-dev` del giorno prima, e si è portato a casa un frontend vecchio. Il menù non sbagliava — elencava fedelmente l'unica cosa che c'era. Il percorso registry esisteva dal 30 luglio ed era documentato come la strada normale, ma dall'IDE non era raggiungibile.
  - Campo **Riferimento immagine** facoltativo per inchiodare una versione; vuoto significa `latest-<arch>`.
  - **L'architettura la deduce il dispositivo.** `install-container.sh` compone il riferimento da `uname -m` (`aarch64`→`arm64`, `x86_64`→`amd64`) invece di avere `latest-arm64` cablato: su un dispositivo x86_64 quel default scaricava un'immagine che non parte. Un'architettura non riconosciuta (es. `armv7l`, userspace a 32 bit su SoC aarch64) fallisce al passo 0, senza toccare il dispositivo. Vale anche da riga di comando, non solo dall'IDE.
  - Tre `disabled` impedivano di arrivare alla funzione proprio nel caso in cui serve: il pannello spariva con `dist/` vuota, il bottone *Container (Podman)* era disabilitato senza archivi e quello di installazione pretendeva un pacchetto selezionato. Rilassati.

- **Spunta "Installazione pulita"**: azzera progetti, utenti, configurazione e storico del dispositivo prima di installare (`--uninstall --purge`). Conservativa per default, con conferma che **nomina la cartella** che verrà cancellata.
  - **L'immagine si procura prima di cancellare**, con la nuova flag `--pull-only`: al contrario, un pull fallito dopo un purge già eseguito lascerebbe il dispositivo senza dati *e* senza runtime, senza modo di rimediare da remoto. Dal percorso offline non serve — l'immagine è appena arrivata via `scp`.
  - Il comando di purge **ripete `--data`**. L'installer fa `rm -rf "$DATA"` prendendo il valore dalle flag: senza ripeterlo avrebbe cancellato il default `/data/user/sws` lasciando intatti i dati veri, cioè avrebbe distrutto i dati sbagliati e mancato quelli giusti. È coperto da un test dedicato.
  - La spunta si azzera dopo l'uso: una seconda installazione fatta di fretta non deve cancellare un dispositivo perché la casella era rimasta accesa.

### Added

- **Client ID MQTT: modalità "Random" + invio manuale al device**, per evitare che lo stesso
  `client_id` letterale collida quando il progetto è aperto sia dall'IDE sia deployato su uno o
  più device verso lo stesso broker (il broker, per specifica MQTT, disconnette la sessione più
  vecchia ogni volta che l'altra si ripresenta — nasce da un incidente reale sul progetto
  Sandokan, vedi sotto in Fixed).
  - **"Random Client ID"** (per sorgente MQTT, in `project.yaml`): ogni istanza — IDE compresa —
    incolla al `client_id` configurato un id casuale generato una sola volta e persistito
    (`config_dir/instance_id`, stesso pattern del certificato TLS), come prefisso o suffisso a
    scelta. `client_id` resta solo l'etichetta leggibile; l'id sul filo cambia per istanza ma
    resta riconoscibile. **Le sorgenti MQTT create da ora in poi nascono con Random attivo di
    default** — quelle esistenti restano invariate (campo opzionale, nessuna migrazione).
  - **Override manuale per-device**: pulsante "Invia Client ID al dispositivo connesso" nel
    pannello sorgente MQTT (visibile solo con Random disattivo e un device connesso), per fissare
    un client_id esatto su un device specifico — es. per farlo combaciare con una ACL del broker.
    Persistito in un file separato sul device (`config_dir/mqtt_client_id_overrides.yaml`),
    **esterno a `project.yaml`**: un redeploy del progetto non lo cancella. Nuovo endpoint
    `PUT /api/mqtt/source/:id/client-id-override` (device) + proxy
    `POST /api/remote/mqtt-client-id` (IDE → device connesso, stesso schema di "Aggiorna utenti
    sul dispositivo"). Rifiuta con 400 se quella sorgente ha Random attivo — le due modalità sono
    alternative, non sovrapponibili.

### Fixed

- **Random Client ID (e ogni altro effetto di apertura progetto) spariva silenziosamente a ogni
  riavvio del processo/container**, perché il boot con `--project` (usato dal device e da
  qualunque riavvio) ricopiava a mano la logica di `open_project` invece di riusarla, e
  ovviamente non replicava i passi aggiunti dopo — in questo caso la risoluzione del client_id
  MQTT. Estratta una funzione condivisa `apply_loaded_project` (`sws-web/src/projects.rs`),
  richiamata sia da `open_project` sia dal boot in `main.rs`: un passo di apertura progetto ora
  si aggiunge in un solo punto, non due. Verificato dal vivo: lo stesso progetto (Random Client
  ID attivo) risolve correttamente il client_id sia aperto dall'IDE sia al boot del processo con
  `--project`, cosa che prima falliva silenziosamente per il secondo caso.

- **Cambiando progetto (chiudi + apri/crea un altro) per un istante restava visibile la
  grafica (e il banner allarmi) del progetto precedente**: lo store dell'IDE non azzerava mai
  `pages`/`project`/`customSymbols`/`faceplates`/`alarms` alla chiusura, e il remount
  dell'editor al nuovo progetto era sincrono mentre i dati nuovi arrivavano solo dopo un
  round-trip di rete — nella finestra fra i due, il canvas mostrava ancora lo stato vecchio.
  Nuova azione `resetProjectState()` nello store, chiamata prima di ogni cambio di
  `noActiveProject` (chiusura e apertura/creazione progetto). Verificato con un test
  automatizzato (Playwright) che campiona il DOM ogni ~60ms durante la transizione: prima del
  fix il canvas/banner del progetto precedente compariva per una finestra osservabile, dopo il
  fix zero occorrenze su 15 campionamenti.

- **Una sessione MQTT poteva restare bloccata per sempre senza errore**, bypassando
  completamente il retry-con-backoff aggiunto martedì: quel fix reagisce solo a un `Err`
  restituito da `eventloop.poll()`, ma se quella singola chiamata resta sospesa (osservato dal
  vivo su un device reale dopo una sequenza di riconnessioni ravvicinate), `run_session` non
  torna né con successo né con errore, quindi il retry non scatta mai. Ora `eventloop.poll()` è
  avvolto in un timeout (proporzionale a `keep_alive_secs`, minimo 30s) sia nel path MQTT plain
  sia in Sparkplug B: se scade, viene trattato come sessione morta e rientra nel retry esistente.
- **Aggiunta una rete di sicurezza generica**: nuovo campo opzionale (disattivo di default)
  `max_silence_secs` su una sorgente MQTT — se nessuna delle sue tag si aggiorna entro quella
  soglia, il watchdog del `SourceSupervisor` la riavvia anche se il task non è mai andato in
  errore. Chiude un gap confermato assente in *tutti* i plugin: nessun meccanismo verificava mai
  "sto ricevendo dati aggiornati?" indipendentemente da un errore esplicito di connessione.

- **Una sorgente MQTT che perde il broker restava morta per sempre**, e l'unico modo per
  farla ripartire era riaprire/ridistribuire il progetto dall'IDE — da cui la falsa impressione
  segnalata dal maintainer che "chiudere l'IDE" fermasse database e grafici sul device. In
  realtà il runtime in container restava vivo e "healthy": era la sorgente `sws-plugin-mqtt`
  (path "plain", non-Sparkplug) a non avere alcun loop di riconnessione — il commento di modulo
  prometteva "reconnect on session error with 5s backoff" ma non era implementato, a differenza
  del modulo gemello Sparkplug B che quel pattern ce l'ha già. Aggiunto lo stesso retry-con-backoff
  di `sparkplug.rs` al path MQTT plain.
  - Aggiunto anche un **watchdog periodico** (ogni 30 s) nel `SourceSupervisor`, generico per
    tutti i tipi di sorgente (Modbus/OPC-UA/S7/EnIP compresi, non solo MQTT): rileva un task
    terminato da solo (bug/panic/errore non gestito) e lo rilancia, invece di aspettare la
    prossima azione utente esplicita (`reload()` lo fa già, ma solo su apertura/chiusura
    progetto o salvataggio config).
  - Trovato indagando dal vivo sul device `tc620-a-p3-c6-07aff9.local` (progetto Sandokan):
    tag ferme da ~10 ore con `quality: Good` e nessuna riga di log nel frattempo, nonostante il
    broker MQTT esterno risultasse irraggiungibile.

- **Il menù delle immagini non si aggiornava mai**: l'elenco di `dist/` si legge al montaggio della tab e le immagini si costruiscono da shell, quindi una appena prodotta non compariva finché non si ricaricava la pagina. Aggiunto un pulsante di ricarica accanto al menù. È la meccanica esatta con cui il 2026-07-31 su un dispositivo è finito un archivio del giorno prima.
- **Gli errori del backend venivano buttati via**: su risposta non-OK il pannello mostrava solo `status`/`statusText`, scartando il corpo che porta il messaggio in italiano (*"riferimento immagine non valido: …"*). Ora lo mostra.

### Changed

- **Il container x86_64 usa la stessa base dell'aarch64 (`ubuntu:24.04`) e si compila dentro un'immagine builder** (richiesta del maintainer: *"fare il container a partire dallo stesso sistema usato per l'immagine arm"*). Chiude il «limite noto: riproducibilità legata alla macchina di build» che il documento del percorso x86_64 si portava dietro dal 2026-07-30.
  - **La base non si sceglie, la impone il binario.** PyO3 gira con `auto-initialize`, quindi il binario linka la `libpython` dell'ambiente che lo compila. Finché si compilava sull'host, quel vincolo puntava a un bersaglio mobile: misurato, il binario prodotto sul dev server di ufficio (Debian 12) chiede `libpython3.11.so.1.0` e `GLIBC_2.34`, quello della macchina di casa (python3.13 da pyenv) chiede `libpython3.13`. **Due immagini diverse dallo stesso commit**, e nessuna delle due compatibile con la base dell'arm64. Il `FROM debian:trixie-slim` che c'era descriveva una sola di quelle macchine.
  - Nuovo `deploy/container/Containerfile.x86_64.builder`: `ubuntu:24.04` + toolchain Rust + `python3-dev`. `build_container_x86_64.sh` ci lancia dentro il `cargo build`, su una `target-container-x86_64/` dedicata — mescolarla con la `target/` dell'host darebbe link incoerenti fra oggetti compilati contro libpython diverse. È per x86_64 quello che l'SDK Yocto Pixsys è per aarch64: un ambiente di compilazione fisso.
  - **La verifica `readelf` diventa automatica.** Era una riga di documentazione che chiedeva di rifarla a mano su ogni postazione; ora lo script confronta la `libpython` richiesta dal binario con quella della base e si ferma spiegando che il container *"partirebbe e morirebbe su `cannot open shared object file`"*. Prima quel difetto emergeva al primo `podman run` sul dispositivo, con un messaggio che non spiega niente.
  - Niente più toolchain Rust richiesta sull'host per questo percorso: bastano `podman` e `pnpm`.
  - **Verificato**: `readelf` sul binario prodotto dà `libpython3.12` + `GLIBC_2.39`, contro `libpython3.11` + `GLIBC_2.34` dello stesso commit compilato sull'host. Immagine avviata e provata — `/health` su entrambe le porte, `index.html` e bundle serviti dall'immagine, SPA admin, 10 template, RestrictedPython disponibile senza warning, `podman ps` → `healthy`, Python 3.12.3 dentro il container.

- **Il tag locale delle immagini container porta l'architettura** (`sws-runtime:<versione>-arm64` / `-amd64`). Senza, le due build si rubavano il nome a vicenda: costruendo aarch64 e poi x86_64 di seguito, `localhost/sws-runtime:2026.7.0` finiva per essere l'immagine **amd64** e un `podman run` su quel tag dava quella costruita per ultima. Capitato davvero, e i tag del registry non lo mostravano perché lì il suffisso c'era già.

## [2026.7.0] — 2026-07-31

Prima release con un numero vero: si esce da `0.1.0-dev`. Il contenuto è il lavoro di luglio, la cui
parte più consistente è il passaggio del container alla distribuzione da registry.

- **Versione applicata a tutto il monorepo**: `sws-runtime/Cargo.toml` (che è la sorgente da cui gli
  script di build la leggono), `sws-editor/package.json`, `sws-kiosk`. Compare in `/health`,
  nell'annuncio mDNS e nei nomi degli artefatti.
- **L'immagine container si pubblica anche su un tag mobile `latest-<arch>`**, oltre a
  `<versione>-<arch>` e `<sha>-<arch>`. È il nuovo default di `install-container.sh --pull`: un
  dispositivo prende l'ultima pubblicata senza che qualcuno debba ricordarsi di aggiornare un numero
  dentro lo script a ogni release — che è esattamente il modo in cui i dispositivi restano indietro
  in silenzio. **Non rende gli aggiornamenti automatici**: il pull resta un comando che qualcuno dà,
  come deciso il 2026-07-30. Per inchiodare una versione si passa il riferimento per esteso.
- **`install-container.sh` non indovina più il nome dell'immagine caricata**: lo legge dall'output di
  `podman load`. Era cablato a `localhost/sws-runtime:0.1.0-dev`, quindi la prima release con un
  numero diverso avrebbe fatto morire l'installazione **offline** su *"immagine assente"* davanti a
  un archivio perfettamente valido — con un messaggio che mandava a cercare il problema dalla parte
  sbagliata. Un `--tag` esplicito continua a vincere.

### Added

- **Bottone "🖥 Viewer ↗" nell'header dell'editor**: apre la pagina operatore del runtime in una scheda nuova del browser, per vedere se risponde senza andare a cercare l'indirizzo. Sta accanto a Deploy perché la domanda *"ha funzionato?"* arriva subito dopo averlo premuto.
  - **Quale runtime**: quello a cui l'IDE è connesso, se c'è — dopo un deploy è l'unico che interessa. Senza connessione ricade sul runtime che sta servendo la SPA. Lo stato della connessione viene chiesto al server al montaggio dell'header, perché `remoteUrl` nello store lo scrive solo `RuntimeConnectionTab`: chi ricarica l'IDE e non passa da Configurazione avrebbe avuto il bottone puntato al runtime sbagliato.
  - **Sonda `/health` prima di aprire** (scelta del maintainer): il caso normale in cui si preme questo bottone è "il dispositivo non risponde più", e aprire comunque darebbe una scheda bianca con un errore del browser. Quando fallisce su `https` il messaggio nomina il certificato self-signed non ancora accettato — è l'unica delle cause possibili che si risolve senza toccare il dispositivo, ed è quella che sorprende.
  - **La porta del viewer è dedotta** come `admin − 1` (scelta del maintainer: zero lavoro sul backend, corretta per ogni installazione esistente — `start_runtime.sh` usa 8443/8444 e 8445/8446, il `CMD` dei Containerfile 8443/8444). È una convenzione e non un dato, quindi l'URL dedotto è **mostrato nel tooltip** invece di essere aperto in silenzio, e il bottone sparisce quando la deduzione non ha senso (URL senza porta esplicita). Nuovo `viewerUrlFromAdmin()` puro in `src/runtimeUrl.ts` con 6 test.

- **"Cerca runtime" distingue i runtime in container.** Cercando i dispositivi sulla rete non c'era modo di sapere quali girassero in container, cioè quale procedura di aggiornamento usare — `install-container.sh` o il deploy del binario nudo. Ora la riga porta una pill `📦 podman` / `📦 docker`.
  - Il runtime annuncia una proprietà mDNS `container` col nome del motore, accanto a `admin_port`/`scheme`/`version`. Il rilevamento è **a runtime**, non cotto nell'immagine: `/run/.containerenv` (podman), `/.dockerenv` (docker), con ripiego sul cgroup per le configurazioni rootless dove il file non c'è. Così funziona anche sull'immagine legacy e su un dispositivo già installato, senza ricostruire niente — e non mente se la stessa immagine viene eseguita da un motore diverso. `SWS_CONTAINER_ENGINE` forza il valore dove il rilevamento non arriva; deliberatamente **non** impostata nei nostri Containerfile.
  - Un runtime nativo non annuncia la proprietà **affatto**, e nemmeno uno più vecchio di questo campo: la pill compare solo quando c'è un'affermazione da mostrare, mai per dedurre "nativo" da un'assenza.

### Fixed

- **L'oggetto slider ignorava l'orientamento verticale** (segnalato dal maintainer). La proprietà si sceglieva nel pannello, veniva salvata e sopravviveva al round-trip — c'è anche nel mirror Rust (`synoptic.rs`) — ma **nessuno la leggeva**: né l'anteprima nell'editor né il controllo a runtime. Era una dimenticanza del solo slider: `radio_group` onora `orientation` e il grafico a barre `bar_orientation`.
  - A runtime il controllo nativo viene **ruotato di −90°** invece di usare `writing-mode: vertical-rl`. Quest'ultimo è lo standard moderno ma richiede Chrome 120+/Firefox 129+/WebKit 17.4+, e sul browser dei pannelli Yocto non sappiamo cosa ci sia: dove non fosse supportato lo slider resterebbe orizzontale, cioè il difetto di partenza ma più difficile da riconoscere. La rotazione funziona su qualunque motore e conserva il comportamento nativo su touch e tastiera. −90° e non +90° perché porta il `min` in basso.
  - Anche l'**anteprima nell'editor** ora è verticale: finché restava orizzontale, cambiare orientamento continuava a "non fare niente" anche col runtime corretto.
  - **Nota d'uso**: l'orientamento non cambia la geometria dell'oggetto. Uno slider lasciato alla dimensione di default della toolbar (200×40) e messo verticale diventa un moncone — misurato, 15×23 px: va reso più alto che largo.

- **Lo slider ignorava anche `read_only`**: la spunta "Sola lettura" esisteva nel pannello proprietà e non faceva niente, quindi un comando dichiarato in sola lettura scriveva comunque il tag. Su un HMI industriale non è un dettaglio cosmetico. Ora l'`<input type="range">` è `disabled`. Trovato leggendo il codice per l'orientamento; `checkbox` — l'unico altro oggetto che offre la spunta — la onorava già.

- **Preset dispositivo WP830/WP630 con la risoluzione sbagliata**: erano dichiarati 1366×768, il pannello è **1920×1080** (segnalato dal maintainer). Il preset serve a dare a una pagina nuova la dimensione giusta del dispositivo: sbagliato, produceva un synoptic disegnato per uno schermo che non esiste, che in modalità *proporzioni* veniva scalato e in modalità *fisso* lasciava una fascia vuota. Corretto in `public/branding/pixsys/brand.json`. **Nota**: il preset agisce solo alla creazione, quindi i progetti già disegnati con la misura vecchia restano a 1366×768 finché non si cambia a mano la dimensione della pagina.

- **`/api/discover` elencava lo stesso runtime tre volte, e una volta su tre offriva `127.0.0.1`.** Due difetti nello stesso punto, il secondo emerso mentre si correggeva il primo.
  - `browse_mdns_blocking` accumulava una voce per ogni evento `ServiceResolved`, e mdns-sd ne consegna uno per risposta ricevuta. Misurato in locale: **3 voci** per un solo runtime prima della correzione, 1 dopo (10 esecuzioni su 10).
  - Deduplicare per nome però non bastava, ed è il motivo per cui la prima stesura era peggiore del problema: `enable_addr_auto()` annuncia **tutti** gli indirizzi dell'host, loopback compreso, `get_addresses_v4()` restituisce un `HashSet`, e le risposte non sono equivalenti — la prima può portare solo `127.0.0.1`. Tenendo la prima si offriva un URL inutilizzabile da un'altra macchina, cioè esattamente il caso d'uso della funzione. Ora la scelta dell'indirizzo è ordinata (ripetibile) e preferisce un IPv4 non-loopback, e una risposta successiva **promuove** la voce se porta un indirizzo raggiungibile.
  - Nuovo `scripts/check_discover.sh`: due runtime (uno dichiarato in container, uno nativo), N giri, controlla numero di voci, valore di `container` e assenza di loopback nell'URL. I giri multipli non sono zelo — il difetto dell'indirizzo era intermittente e con una sola esecuzione passava comunque due volte su tre.

### Changed

- **Riconciliati i due percorsi container, che si erano contraddetti sulla posizione della SPA.** Il lavoro su x86_64 e sull'installazione dall'IDE via SSH è nato la stessa giornata del passaggio al registry, ma sul layout *precedente*: `main` è finito con la SPA fuori dall'immagine (bind mount `www`, `--www` obbligatorio) mentre il branch del registry l'aveva già messa dentro. Vale la decisione presa il 2026-07-30, **SPA nell'immagine**, estesa ora a entrambe le architetture.
  - `Containerfile.x86_64` allineato al gemello aarch64: `COPY www/` come ultimo layer di contenuto, niente più `/var/sws/www` fra le directory da montare.
  - `build_container_x86_64.sh` guadagna `--push`/`--registry` e i controlli preliminari del gemello (albero pulito, `podman login`), pubblica `<versione>-amd64` e `<sha>-amd64`, e non produce più l'archivio SPA separato.
  - **`POST /api/deploy/device-container` non trasferisce più la SPA**: tre file invece di quattro, e il comando remoto non passa `--www` — che l'installer del registry rifiuta con un errore esplicito, quindi lasciarlo avrebbe rotto "Installa su dispositivo" a ogni uso. Via anche `www_tarball` da `ContainerPackage` e dalla richiesta di deploy; un client più vecchio che lo manda ancora non rompe niente, serde ignora i campi in più (vedi Q9 in `OPEN_QUESTIONS.md`, qui il lato utile del comportamento). Nuovo test che verifica l'assenza di `--www` nel comando costruito.
  - Il deploy SSH dall'IDE resta come **percorso offline** — copia un archivio da ~59 MB — accanto a `--pull`, che trasferisce il solo layer cambiato. Non è un ripiego di serie B: un dispositivo in campo che non raggiunge il registry è il caso normale.
  - `docs/DEPLOY_CONTAINER_X86_64.md` e il README aggiornati di conseguenza; la verifica x86_64 del 2026-07-30 è annotata come **precedente** al cambio, quindi da rifare.

- **Il runtime in container si distribuisce da un registry, non più via `scp`.** L'immagine aarch64 è pubblicata su `ghcr.io/soligolab/sws-runtime` come package **pubblico**: il dispositivo la scarica senza credenziali (verificato — `podman login --get-login ghcr.io` risponde *not logged into* e il pull riesce lo stesso). Portare una versione nuova era copiare 59 MB e ricordarsi il secondo artefatto con la SPA; ora è `install-container.sh --pull`, e siccome i layer si deduplicano si trasferisce solo ciò che è cambiato — il binario pesa 14,3 MB compressi, i 50 MB di base e apt il dispositivo li ha già.
  - **La SPA entra nell'immagine**, come ultimo layer di contenuto. Stava fuori per non ritrasferire 59 MB a ogni modifica del frontend: col registry quella ragione cade (il layer della SPA è 0,4 MB) e cade anche il rischio di avere sul dispositivo una SPA di una versione diversa dal binario, che è già costato una caccia al fantasma. Sta **dopo** il binario perché un layer che cambia invalida quelli sotto: invertirli farebbe ritrasferire 14 MB per un ritocco al frontend. Via il bind mount di `www`, e `--www`/`--www-only` ora falliscono spiegando cosa usare invece di essere no-op silenziosi.
  - `build_container.sh --push` pubblica due tag: uno mobile `<versione>-arm64` che i dispositivi seguono, uno immutabile `<sha>-arm64` che dice da quale commit nasce — senza il secondo, fra sei mesi *"cosa c'è sul dispositivo"* non ha risposta. Il suffisso `-arm64` è deliberato: l'immagine non è una manifest list, e un tag nudo farebbe fallire un pull su x86 con un `no matching manifest` incomprensibile. **Rifiuta di pubblicare con l'albero di lavoro sporco** (il tag di provenienza indicherebbe un commit che non contiene ciò che si sta pubblicando) o senza login, controllando entrambi *prima* della cross-compilazione.
  - `install-container.sh --pull [REF]` scarica dal registry; `--image` resta per i dispositivi senza rete, che in campo sono il caso normale. Il pull avviene **prima** di fermare il servizio: se la rete non c'è, il dispositivo resta com'era invece di restare senza runtime.
  - **`podman auto-update` esiste ed è disponibile sul dispositivo, ma resta disattivato**: scelta esplicita del maintainer, su una macchina in servizio un riavvio che nessuno ha chiesto è peggio di un aggiornamento tardivo.
  - Provato sul WP620 con **ogni immagine locale cancellata** per essere certi che scaricasse davvero: installazione completa in 1 min 05 s, progetto e 386 campioni di storico intatti, `healthy` in 13 s, discovery dall'editor ok, ripiego offline `--image` ok.
- **La rete host è il default dell'installer del container**, con `--bridge` per tornare indietro. Sulla rete rootless di podman il multicast mDNS non esce dal container, quindi *"Cerca runtime"* non trovava mai un dispositivo installato senza `--host-network`: chi installa senza flag deve ottenere la configurazione che funziona. Misurato dallo stesso editor a pochi minuti di distanza: con `--bridge` `GET /api/discover` risponde `[]`, col default restituisce il runtime con `admin_url http://192.168.1.84:8444`. `--host-network` resta accettata come no-op.
- **Il job CI che pubblicava l'immagine container è disattivato.** Costruiva da `sws-runtime/docker/Dockerfile` — l'immagine **legacy**, coi quattro difetti noti — e la pubblicava all'indirizzo che il badge del README promette: un'immagine che non parte dov'è scritto che ce n'è una buona. Non si corregge puntandolo a quella giusta, che richiede il binario cross-compilato con l'SDK Yocto Pixsys, assente sui runner GitHub. Gated con `if: false` e non cancellato, perché login/buildx/qemu/trivy sono la struttura da riusare quando la build sarà riproducibile in CI.

- **Pulizia dei branch**: da 8 a 1. `feat/container-aarch64` portato in `main` con squash (`72b6b3c`) — era l'unico con contenuto da mergiare. Gli altri sei erano già assorbiti (le due catene dell'editor, entrate con `2ef99e6`/`3bddb66`) o superati (`archive/office-line-2026-05-21` e `backup/friday-phase-a1`, due linee di sviluppo **non correlate** a `main`: radice diversa, nessun antenato in comune). Mergiarli avrebbe riportato indietro il codice — contenevano la vecchia firma di `router::build`, il vecchio export di `alarm.rs` e la gestione segnali con solo `ctrl_c`. Punte annotate in `STATUS.md`; la linea "office" è conservata dal tag `archive/office-2026-05-21`, ora anche su `origin`.

### Added

- **Il container come via standard anche su x86_64, con installazione dall'IDE via SSH** (branch
  `feat/container-x86_64`). Il percorso "buono" (`deploy/container/`, quello senza i quattro
  difetti dell'immagine legacy) copriva solo aarch64/Yocto; ora ha un gemello per x86_64 e si può
  installare da Configurazione → Runtime senza uscire dall'IDE.
  - `deploy/container/Containerfile` → rinominato `Containerfile.aarch64`; nuovo
    `Containerfile.x86_64` gemello, nessun SDK — binario nativo `cargo build --release`, nessun
    cross-compile. Nuovo `scripts/build_container_x86_64.sh`, ricalca `build_container.sh` passo
    per passo.
  - **La base `debian:bookworm-slim` ipotizzata all'inizio era sbagliata, e si sarebbe scoperto solo
    all'avvio del container**: il binario buildato su questa macchina (un python3 non di sistema)
    dichiara `libpython3.13.so.1.0` + `GLIBC_2.39`, che bookworm-slim non ha. Corretto a
    `debian:trixie-slim` **prima** di distribuire qualunque cosa, verificando con `readelf` come già
    documentato per aarch64 — non assumendo che la stessa base vada bene ovunque. A differenza del
    binario Yocto (SDK fisso), un binario x86_64 nativo lega glibc/Python alla macchina che lo
    builda: chi rifà la build su un'altra macchina deve rifare la stessa verifica, non copiare
    questo risultato — documentato esplicitamente in `docs/DEPLOY_CONTAINER_X86_64.md`.
  - Corretto anche un rimando sbagliato nella doc esistente: il commento nel Containerfile diceva
    che `docs/DEPLOY_PX30.md` era "il flusso legacy per x86" — non è vero, quel documento copre
    target ARM64 generici buildati *da* un laptop x86, non un target x86_64. Non esisteva prima
    nessun percorso documentato per un target x86_64.
  - **Installazione container dall'IDE**: nuovo `POST /api/deploy/device-container`
    (`sws-web/src/packaging.rs`), stesso pattern SSH/SCP già in uso per il binario nudo
    (`deploy_device` — shell-out a `sshpass`/`scp`/`ssh` di sistema, nessuna libreria SSH Rust), ma
    carica **tre** file (immagine, `install-container.sh`, il quadlet — l'installer legge
    quest'ultimo da una posizione relativa a sé stesso, devono stare nella stessa directory remota)
    ed esegue l'installer **senza `sudo`**, perché Podman rootless non ne ha bisogno — differenza
    comunicata anche in UI. Nuovo `GET /api/build/container-packages` elenca le immagini già
    buildate in `dist/`. In `ConfigView.tsx` → tab Runtime → "Installa su dispositivo",
    nuovo selettore **Binario nativo / Container (Podman)**: stessi campi host/porta/utente/
    password/directory remota, riusati identici — solo l'elenco pacchetti e l'endpoint cambiano.
  - Deciso col maintainer: **solo Podman per ora**. Docker avrebbe richiesto un secondo percorso di
    installazione completo (niente quadlet lì, gestione dell'avvio al boot diversa), rimandato a
    quando/se servirà davvero.
  - Verificato senza toccare le istanze di sviluppo già attive sulla stessa macchina (porte
    8443/8444/8460 occupate): `install-container.sh` testato con porte/dati remappati su una copia
    temporanea (mkdir, `podman load`, unpack SPA, avvio, `/health ok dopo 2s`); il deploy via SSH
    testato con self-SSH (chiave autorizzata solo per la durata del test, rimossa subito dopo)
    contro un'istanza runtime usa-e-getta su porta dedicata — mkdir, gli `scp`, invocazione
    di `install-container.sh` tutti riusciti; istanze dev live verificate intatte dopo entrambi i
    test. **Quella verifica precede la riconciliazione qui sotto** ed è stata fatta con la SPA
    fuori dall'immagine: va rifatta.
  - `cargo test -p sws-web` (31 test, 4 nuovi su `parse_image_tarball`/`validate_remote_path`) +
    `pnpm build`/`pnpm test` (20/20) verdi.
  - **Il deploy restava bloccato dopo il primo comando, senza errore**: senza `sshpass` e senza
    chiave SSH preconfigurata, `ssh`/`scp` tentavano un prompt interattivo che il backend —
    nessun terminale — non può mai soddisfare. Aggiunto `-o BatchMode=yes` (solo quando non si
    usa `sshpass`, per non rompere il meccanismo con cui intercetta il prompt) e
    `-o ConnectTimeout=10` in `run_ssh_cmd`, condivisa da `deploy_device` e
    `deploy_device_container`: ora fallisce in frazioni di secondo con un errore chiaro invece di
    restare appeso indefinitamente.
  - **I messaggi di deploy ora arrivano anche al logger principale** (file JSONL + pannello Log),
    non solo allo stream HTTP effimero del modale — `packaging.rs` non aveva nessuna chiamata
    `tracing::`. E **l'output remoto reale è catturato**, non solo il codice di uscita:
    `run_ssh_cmd` ereditava lo stdio invece di catturarlo, quindi un `exit 1` non diceva mai
    perché.
  - **Percorso dati del device selezionabile per modello, brand-aware**: il fallimento reale su
    un device Pixsys era `install-container.sh` che non riusciva a creare `/data/user/sws`
    (permessi) — visibile solo grazie al fix precedente. Nuovo `Brand.dataPathPresets` in
    `sws-editor/src/branding/index.ts` (stesso meccanismo di `devicePresets`, già usato per i
    preset di risoluzione pagina): un menù a tendina in "Installa su dispositivo" precompila il
    percorso in base al modello scelto, filtrato per brand attivo — oggi un modello Pixsys
    (`/data/user/sws`), nessuno per SWS (solo percorso libero). `install-container.sh` non
    cambia, `--data` esisteva già; nuovo `DeviceContainerDeployRequest.data_path` nel backend,
    validato con la stessa `validate_remote_path` di `remote_dir`.
  - Verificato via self-SSH con un percorso dati alternativo: primo deploy container end-to-end
    davvero completo di questa serie (directory dati, caricamento immagine, SPA, mount quadlet,
    avvio, health check tutti riusciti — non solo parziale come nei test precedenti).
    `cargo test -p sws-web` → 33/33 (2 nuovi), `pnpm build`/`pnpm test` 20/20 verdi.

- **Sezione "Gestione database"** nella tab Datastore di Configurazione (chiesto dal maintainer: *"aggiungi una sezione per la gestione dei database del dispositivo come clean, rimozione tabelle non in uso, backup e tutte le funzioni utili"*). Sta nella tab Datastore e non in Runtime perché quando apri la ConfigView **del dispositivo** è lì che compaiono i suoi backend; "Runtime" riguarda la connessione verso un *altro* runtime, un concetto diverso.
  - **Pulisci ora** ed **Esporta CSV** collegano due endpoint che **esistevano già nel backend e nel client, senza che nessun pulsante li chiamasse** (`purge`, `export`). Il purge riusa la retention configurata per il backend — una pulizia manuale con regole diverse da quelle automatiche sarebbe una sorpresa — e rifiuta di partire se non ne è configurata nessuna.
  - **Cerca tag orfani** (nuovo): tag che hanno campioni nel database ma che il runtime non conosce più, tipicamente dopo una rinomina o una rimozione. Il confronto usa i tag che il runtime ha **in memoria** (`TagDb`), non la sola lista dichiarata in `project.tags`: in molti progetti i tag nascono dalle mappature delle sorgenti, e confrontarsi con la lista dichiarata marcherebbe come orfani tag perfettamente in uso. Ogni orfano ha il proprio "Elimina storico", audit-logged.
  - **Recupera spazio** (nuovo): `VACUUM` + checkpoint WAL, con le dimensioni prima e dopo — senza quelle non si distingue un vacuum riuscito da uno che non aveva nulla da liberare.
  - Nuovi `GET /api/datastores/:id/tags`, `POST /api/datastores/:id/delete-tag`, `POST /api/datastores/:id/vacuum`; nuovi metodi `distinct_tags`/`delete_tag`/`vacuum` su `SqliteStore`, con passthrough in `SqliteBackend`, `DatastoreBackend` e `DatastoreRegistry`. Su Postgres/ODBC i tre casi **dichiarano di non essere supportati** invece di restituire una lista vuota, che si leggerebbe come "nessun tag orfano" — un'informazione falsa.
  - Il **backup completo non è duplicato**: la tab Backup include già `.history/`, e la nuova sezione lo dice con un rimando invece di offrire un secondo percorso.
  - **La misura del vacuum era sbagliata e l'ho scoperto solo misurando** (`scripts/check_database_mgmt.sh`, nuovo): riportava il file *cresciuto* di mezzo megabyte dopo un vacuum riuscito. In modalità WAL servono due checkpoint — uno prima di misurare, perché altrimenti si conta il WAL che il vacuum consoliderà, e uno dopo, perché il vacuum riscrive l'intero database nel nuovo WAL. Con l'ordine corretto: 761.856 → 512.000 byte, 244 KB liberati dopo la cancellazione di un tag.
  - Verificato su un runtime vero con 12.000 campioni e quattro tag, due in uso e due orfani: orfani individuati esattamente, cancellazione del solo orfano, storico dei tag in uso intatto, retention applicata (tutti i tag a ≤100 righe).


- **"Aggiorna utenti sul dispositivo"** in Configurazione → Runtime, seconda metà della decisione sugli account: il deploy non li tocca, quindi serve un percorso **dichiarato** per allinearli. Nuovi `POST /api/remote/users` (lato IDE: legge `users.yaml` del progetto e lo spedisce) e `PUT /api/auth/users-file` (lato dispositivo: sostituisce il file e ricarica lo store, audit-logged con l'elenco degli username). Si trasferisce il **file**, non le password: contiene gli hash Argon2, quindi gli account arrivano funzionanti senza che l'IDE o la richiesta vedano mai una password in chiaro.
  - **Due rifiuti deliberati**, perché il danno sarebbe irreversibile e scoperto tardi — nessuno riesce più a entrare nel pannello: una lista **vuota** (bloccata già lato IDE, con messaggio esplicito) e uno YAML non valido o senza la chiave `users` (bloccato lato dispositivo).
  - Un 401/403 dal dispositivo non riporta più il codice grezzo ma dice cosa fare: riconnettersi con le credenziali admin. È il caso normale quando il dispositivo ha account veri.
  - Ricaricare lo store invalida le sessioni aperte: la risposta lo dichiara e la conferma nell'IDE lo dice prima di procedere.
  - Verificato in `scripts/check_deploy_preserve.sh`: dispositivo con account e connessione senza credenziali → rifiutato senza toccare nulla; lista vuota → rifiutata, account del dispositivo intatti; dispositivo senza account → invio consentito e utenti allineati.

### Fixed

- **Un "deploy pulito" sul dispositivo non era pulito: l'installer resuscitava i dati appena cancellati.** `install-container.sh --uninstall --purge` svuota i bind mount; l'installazione successiva, al passo 1, migrava i dati dai volumi nominati del layout pre-2026-07-28 **proprio perché** la cartella di destinazione era vuota — che è per definizione lo stato in cui il purge la lascia. Visto dal vivo: un dispositivo che doveva essere azzerato è tornato in servizio con un progetto `test1` di due giorni prima, aperto come progetto attivo. La migrazione è ora dietro un `--migrate-volumes` esplicito, e quando i volumi esistono ancora l'installer lo segnala senza toccarli. È la stessa forma degli altri tre casi di questa settimana: un automatismo che *deduce* l'intenzione dell'utente da uno stato ambiguo.
- **Un salvataggio poteva azzerare l'intero progetto, e ne cancellava le parti che questa versione non sa leggere.** `patch_project` — la funzione sotto **ogni** `PUT /api/project/*`, 11 chiamate — riscriveva `project.yaml` per intero partendo da `Project::load(...).unwrap_or_else(|_| /* progetto vuoto */)`. Terza comparsa in tre giorni della stessa forma (`saveAll` sulle variabili, il deploy sul database, ora questa): uno stato in memoria più povero del disco che finisce per sovrascriverlo. Qui è la variante peggiore, perché non perde una collezione ma tutto.
  - **Non si scrive più un progetto che non si è riusciti a leggere.** Un `project.yaml` illeggibile veniva accettato dall'auto-apertura al boot (con un avviso nel log) e poi **sostituito da un progetto vuoto chiamato "default"** al primo salvataggio in qualunque tab. Ora la richiesta è rifiutata con `409` e un messaggio che dice che il file su disco è intatto, riporta l'errore di parsing e indica cosa fare. Un file **assente** resta il caso legittimo di un progetto nuovo e viene creato.
  - **Le sorgenti che la struttura tipizzata non sa leggere si conservano** (chiude **Q10**): `deserialize_sources_tolerant` le scarta di proposito per la forward-compat, ma riscrivere senza di loro significava cancellarle. Vengono rimesse in coda alla lista, con una guardia sul nome perché una piccola asimmetria fra serializzazione e deserializzazione, senza quella, farebbe **raddoppiare** una sorgente valida a ogni salvataggio — l'ha colto un test unitario, non un ragionamento.
  - **Le chiavi di primo livello sconosciute si conservano**: un `project.yaml` scritto da una versione più nuova ora si apre su una più vecchia **e sopravvive a un salvataggio**. È la metà di **Q9** che fa danno; resta aperta l'altra, cioè che i campi ignorati non vengono segnalati.
  - **`open_project` non riscrive più `project.yaml` all'apertura.** Iniettava il datastore di default dei progetti legacy scrivendo il file — una seconda strada, fuori da `patch_project`, che si portava via sorgenti e chiavi sconosciute **all'apertura**, senza che nessuno avesse chiesto un salvataggio. Ora l'iniezione è solo in memoria: il runtime funziona identico e il file si aggiorna al primo salvataggio vero. Non l'avevo previsto: l'ha trovato lo script di verifica, che continuava a fallire con il fix su `patch_project` già applicato.
  - **Verificato con controprova** (`scripts/check_project_write_safety.sh`, nuovo, 9 casi su un runtime vero): con il fix 9/9; senza il fix **4/9**, con il progetto illeggibile sovrascritto e le sorgenti e chiavi sconosciute perdute. Il caso del rifiuto è esercitato attraverso l'auto-apertura al **boot**, l'unica strada che rende attivo un progetto non caricabile — l'API `open` lo respinge già con un 500, e senza quel dettaglio il ramo del rifiuto sarebbe rimasto codice non provato. Più 6 test unitari su `merge_preserved`.
- **Il drag di una multi-selezione muoveva solo l'oggetto sotto il cursore.** Il fix era già stato scritto nella sessione di casa del 2026-07-30 (`d37b738`, commit dichiarato "ancora rotto"), e **funzionava**: il bug che il maintainer continuava a vedere era il bundle JS vecchio ancora in memoria nel browser — la prima delle ipotesi che aveva annotato lui stesso nel piano. Leggere il codice non l'aveva trovato perché non c'era niente da trovare.
  - Misurato invece di dedotto, con un confronto prima/dopo (`scripts/check_multiselect_drag.sh` + `sws-editor/scripts/multiselect_drag_measure.mjs`, nuovi): due rettangoli, shift-click su entrambi, drag di 120×60 px, coordinate lette dal synoptic salvato via API e non dal DOM. Senza il fix l'ancora si sposta di `dx=120` e il seguace di `dx=0`; con il fix entrambi di `dx=120 dy=60`.
  - Il test è nato con **due errori miei**, entrambi istruttivi su come si sbaglia una misura in un browser: la conversione delle coordinate usava il primo `<svg>` del documento, che è il logo in alto a sinistra e non il canvas, quindi le clic finivano nel vuoto; poi cercava i rettangoli in tutto il documento e trovava quelli della **miniatura** della pagina nel pannello sinistro, larghi 3×2 px. Ora individua il canvas come l'`<svg>` di area maggiore e cerca solo lì.


- **Il deploy cancellava il database storico del dispositivo** (segnalato dal maintainer: *"il deploy va a ricaricare nel progetto anche l'eventuale database, questo non deve succedere"*). Il meccanismo, verificato nel codice: `remote_deploy` cancellava **ogni** progetto presente sul target (`remote.rs`, commento esplicito: *"wipe every existing project"*), e `delete_project` fa `remove_dir_all` sull'intera cartella — quindi si portava via `.history/`. Non era una sovrascrittura: lo ZIP di export non contiene affatto lo storico. Il database veniva **cancellato** e poi ricreato vuoto dal `CREATE TABLE IF NOT EXISTS` al riavvio, da cui l'impressione che fosse "ricaricato".
  - **Principio adottato**: il deploy sovrascrive solo gli artefatti di *progettazione* (`project.yaml`, `synoptics/`) e non tocca mai lo stato locale del dispositivo — `.history/` (database), `.bak/`, `recipes/`, `.opcua-pki/`, `users.yaml`. Le pagine si riesportano dall'IDE in qualsiasi momento; i mesi di campioni no.
  - `DELETE /api/projects/:name?preserve_state=true` rimuove i soli file di progettazione. Il default resta distruttivo: è il pulsante "Elimina" della WelcomeScreen, dove cancellare tutto è la richiesta esplicita dell'utente.
  - `POST /api/projects/upload?deploy=true` accetta una cartella già esistente, **salta `users.yaml`** dello ZIP e — punto meno ovvio — **non fa `remove_dir_all` in caso di errore**: il rollback distruttivo avrebbe cancellato proprio il database che il fix preserva.
  - `remote_deploy` distingue per **nome**: stesso nome (ridistribuzione dello stesso progetto) → percorso che preserva; nome diverso (sostituzione con un progetto differente) → comportamento distruttivo di prima, invariato. Il nome si legge dal manifest dello ZIP appena costruito, non dalla cartella locale, così è esattamente quello che userà l'upload. Tre test (`remote::tests`) coprono quella lettura, perché se fallisse in silenzio il deploy tornerebbe a cancellare il database.
  - **Nessuna migrazione di schema necessaria**: la tabella `samples` è generica (una riga per campione), quindi un tag nuovo inizia semplicemente a scrivere. La "migrazione per aggiungere valori" chiesta dal maintainer è gratis una volta che si smette di cancellare il DB.
  - **Gli account del dispositivo non vengono più sostituiti dal deploy** (decisione del maintainer). Il log del deploy dice sempre che non li ha toccati e, quando può leggere la lista, elenca le differenze; quando **non** può (dispositivo con utenti e connessione senza credenziali admin) lo dichiara invece di tacere — è il caso in cui il dispositivo ha account veri, quindi quello in cui l'informazione conta di più.
  - **Verificato con due runtime veri** (`scripts/check_deploy_preserve.sh`, nuovo): sul target un progetto omonimo con 500 campioni di storico, un `users.yaml` proprio, ricette e un backup; dopo il deploy → storico 500→500, utenti intatti, ricette e `.bak` intatti, e la pagina nuova arrivata dall'IDE. Prima del fix quel database sarebbe stato azzerato.


- **Le istruzioni rimandavano a `scripts/dev.sh`, che non esiste più** — 26 riferimenti in 11 file, rimasti indietro da quando `dev.sh` è stato diviso in `start_runtime.sh` + `start_editor.sh`. Non era solo storia: `playwright.config.ts` e `e2e/editor.spec.ts` indicavano quello script per preparare l'ambiente di test, `docs/TESTING_GUIDE.md` (8 riferimenti) e `docs/OPCUA_SETUP.md` lo usavano come procedura, e il messaggio d'errore di `packaging.rs` lo suggeriva **all'utente**. Chi le seguiva sbatteva contro un file assente.
  - Aggiornati tutti i riferimenti agli script attuali. Dove la frase era diventata falsa **per lo stesso cambio**, è stata corretta invece di rinominata: non c'è più un dev server Vite su 5173 (la SPA la serve il runtime dalla sua porta), i nuovi script **non** seminano un progetto demo né l'utente `admin`/`admin`, e su un `.run/config` nuovo il runtime parte in HTTP, non HTTPS.
  - `playwright.config.ts`: `baseURL` da `https://localhost:5173` a `http://localhost:8444` (sovrascrivibile con `SWS_E2E_BASE_URL`), e la procedura passa le variabili `SWS_ADMIN_USER`/`SWS_ADMIN_PASSWORD` — senza quelle il runtime parte in no-auth e il login che i test eseguono non ha nulla dietro.
  - Il test "runtime remoto" della guida non usa più `VITE_RUNTIME_URL` con `dev.sh editor` (percorso che passava da Vite): ora `start_editor.sh` + ConfigView → Runtime → **Connetti** sulla porta **admin**, con la nota che la porta viewer non ha le route di lifecycle progetto. `VITE_RUNTIME_URL` resta valida per `pnpm dev`.


- **Sul dispositivo, dopo ogni riavvio, gli allarmi non notificavano nulla e gli script globali non partivano.** L'auto-apertura del progetto al boot (`main.rs`) caricava tag, allarmi, sorgenti e funzioni ma **non** avviava il canale Telegram, il supervisore delle notifiche e il supervisore degli script globali. Tutto tornava a funzionare solo riaprendo il progetto dall'IDE — cosa che su un pannello in servizio non accade. È la spiegazione del sintomo riportato dal maintainer, *"la notifica di test mi arriva ma il messaggio dell'allarme no"*: il test invia da sé, l'allarme dipende da quel supervisore. Colpiva **tutti** i percorsi di avvio automatico (`--project`, marker `.active-project`, progetto unico rilevato).
  - **Verificato sul dispositivo prima di scrivere il fix**: al boot nessuna riga `notification supervisor started`; dopo un `POST /api/projects/pippo/open` la riga compare e l'attivazione dell'allarme produce `telegram message sent to 1 chat(s)`.
  - **Provato sul dispositivo con un bot vero**, dopo il fix e senza aperture manuali: al boot compare `notification supervisor started`, e i quattro casi del Telegram per-allarme si comportano come progettato — chat predefinite → inviato, *non notificare* → silenzio, chat specifiche → inviato, chat specifiche vuote → avviso nel log e nessun invio.
  - La sequenza è ora una funzione condivisa, `projects::start_project_services`, usata da **tutti e tre** i percorsi che aprono un progetto (apertura dall'IDE, `system_start`, boot): era una divergenza silenziosa fra copie, non una riga sbagliata, quindi la correzione è togliere le copie. `router::build` restituisce anche l'`AppState`, perché i supervisori vivono lì e al boot il progetto viene aperto prima che lo stato esista.

- **`install-container.sh` fermava il runtime prima di validare i propri input.** Il passo 4 rimuoveva il container e solo il passo 5 si accorgeva che mancava la unit quadlet: il dispositivo restava senza runtime e senza modo di ripartire da sé. Accaduto dal vivo durante l'installazione di oggi. Ora c'è un passo 0 che valida archivio immagine, archivio SPA e unit prima di qualunque azione distruttiva, e il messaggio d'errore dice esplicitamente che nulla è stato toccato.

### Added

- **La suite end-to-end può girare** (nuovo `scripts/check_e2e.sh`, `sws-editor/e2e/_env.ts`, `sws-editor/e2e/fixtures.ts`). Prima **non era eseguibile**: ogni spec aveva `https://localhost:8444` scritto dentro — HTTPS, che su un `.run/config` nuovo non è attivo — e la procedura di avvio viveva nei commenti del config, quindi nessuno l'aveva mai eseguita. Da lì la deriva silenziosa dei selettori.
  - Indirizzi centralizzati in `_env.ts` (7 costanti hardcoded rimosse) e base comune in `fixtures.ts` che **fissa la lingua della UI**: i test cercano etichette italiane ma la SPA parte in inglese, quindi il pulsante diceva "Log in" e il click su "Accedi" andava in timeout. Un solo file se ne era accorto e lo impostava a mano.
  - `ensureLoggedIn()` per i test UI scritti quando il runtime girava in no-auth: ora valgono in entrambe le configurazioni invece di dipendere da come è avviato l'ambiente.
  - **Vincolo del prodotto scoperto qui**: aprire un progetto sostituisce lo store di autenticazione e **invalida le sessioni**, quindi un token ottenuto prima dell'apertura arriva morto. È la ragione per cui i test API prendevano `401` anche dopo aver aggiunto il token; ora lo chiedono dopo.
  - `screenshots.spec.ts` è fuori dal gate: 10 dei 16 test sono cattura di immagini per la documentazione, non verifiche. Restano su `pnpm test:e2e --project=screenshots`.
  - **Stato onesto: 3-4 test su 6 passano, e quali cambia fra esecuzioni.** I test condividono un solo runtime e ognuno crea e apre i propri progetti, quindi si disturbano a vicenda — `bugcheck` è passato in un giro e fallito nel successivo, `import-tags` il contrario. Prima di leggere un fallimento come una regressione serve isolarli (un runtime per test, o un progetto per test); il limite è scritto in testa allo script. Resta inoltre un fallimento stabile su `lang-table`, che non risolve `{{token}}` in "Hello world" nel viewer: da capire se è il test o la funzione.
  - Derive corrette lungo la strada, due delle quali causate da lavoro di ieri: `/copia sul PC/` trovava due pulsanti da quando esiste "Salva copia sul PC…"; `/^Salva tutto$/` non tollerava l'etichetta dinamica del menu; il conteggio dei rettangoli contava due volte perché il pannello sinistro ha una **miniatura** della pagina (stessa trappola già pagata nel test del drag); il riempimento atteso `#3b82f6` non è più il default della palette; e un `fetch` dentro la pagina non porta il token che la SPA aggiunge da sé.


- **Template demo "Nebulizzatore antizanzare Sandokan"** (`examples/templates/nebulizzatore-sandokan/`): sorgente MQTT/Zigbee2MQTT che legge stato/potenza/corrente/tensione/energia dallo stesso topic con `json_path` multipli, storico SQLite, due allarmi a soglia 1W (accensione/spegnimento pompa) e una pagina con simbolo pompa animato, letture live e tre grafici trend separati (assi indipendenti). Nessuna credenziale nel template — il bot Telegram va configurato dopo l'import.

- **Nuovo preset "Tutto" nel pop-up espanso del trend** (`TrendExpanded.tsx`), oltre a Live/1h/8h/24h/7d: risolve `fromMs` dal campione più vecchio disponibile (via l'endpoint `GET /api/history/:tag/stats` già esistente) per caricare l'intero storico registrato.
- **`scripts/check_viewer_layout.sh`** — controllo automatico che il viewer non produca barre di scorrimento su un pannello 1280×800, con e senza barra superiore, a finestra più piccola e più grande della pagina. Si avvia da solo (runtime temporaneo + progetto da template con pagine a 1280×800) e misura col browser di Playwright invece di affidarsi all'occhio: le tre barre viste sul WP620 avevano tre cause indipendenti e valevano pochi pixel ciascuna.
  - Verificato **prima e dopo** il fix (`1d2b9bb`), ricostruendo la SPA pre-fix: prima → `body margin: 8px` e documento 816 px in 800 (barra verticale in **tutte** e quattro le configurazioni, anche a finestra grande), area pagina con `clientHeight` 730 contro pagina 800 (i 70 px delle fasce mai sottratti) e `clientWidth` 1264 contro 1280, `hide_viewer_chrome` ignorato con `<nav>` sempre montato, `<svg>` a 1280×800 letterale senza `viewBox` (nessun adattamento). Dopo → nessuna barra, `<nav>` che scompare col flag, scale 0,914 con le fasce e 1,0 senza, cap a 1 rispettato a finestra grande.
- **`scripts/check_spa_autoreload.sh`** — controllo che il viewer si ricarichi da solo quando sul dispositivo arriva una SPA nuova. Simula il deploy rinominando il chunk di entry con un hash diverso (lo stesso segnale che Vite produce a ogni build), così serve una sola build invece di due. Verificato: pagina ricaricata dopo ~28-30 s con il bundle nuovo servito. Esiste perché sul WP620 il pannello ha continuato a mostrare la versione vecchia dopo un aggiornamento del frontend, e lì non c'è nessuno che possa premere ricarica.

  - Nel farlo è emerso che `page_layout` **non ha** `width`/`height`: in modalità fisso le dimensioni vengono dal synoptic. Il `PUT /api/project/page-layout` accetta quei campi con 204 e li scarta in silenzio.

### Changed

- **"Invia test" e "Rileva chat" di Telegram passano dal runtime**, non più dal browser, e usano il **token salvato** quando la UI non lo ha in chiaro — cioè sempre, dopo un cambio di tab, perché un segreto non viene mai rimandato al browser. Nuovo `POST /api/notifications/telegram-chats` (`getUpdates` lato server, dedup per chat id); `test-telegram` esisteva già e ora risolve anche il token vuoto oltre al placeholder. Due conseguenze:
  - i pulsanti non si bloccano più con "Inserisci il bot token (in chiaro)", che faceva sembrare perso un token perfettamente salvato;
  - la prova percorre la **stessa catena degli allarmi** (runtime → Telegram) invece di una che non esiste in produzione (browser → Telegram). È la ragione per cui un test poteva risultare verde mentre sul dispositivo non c'era alcuna configurazione.

### Changed

- **Password e token viaggiano in backup, export e deploy** (decisione del maintainer: *"export e deploy non devono mascherare le password e i token, se vengono inseriti nel progetto devono essere salvati e ripristinati… la sicurezza è affidata allo sviluppatore che conserverà i backup in modo sicuro"*). Prima il bundle era incoerente in due modi opposti: dichiarava `secrets_masked: true` ma spogliava **solo** la password MQTT, lasciando in chiaro bot token Telegram, password SMTP/OPC-UA/Postgres-ODBC e token Home Assistant — e siccome il **deploy remoto usa la stessa `build_project_zip`**, il dispositivo riceveva un progetto con il broker MQTT privo di credenziali, quindi incapace di collegarsi.
  - Rimosso lo strip in entrambi i percorsi; `secrets_masked` resta nel manifest per compatibilità di formato ed è sempre `false` (nessuno lo legge).
  - Resta invariata la mascheratura `********` sulle risposte GET: quella tiene i segreti fuori dal browser e viene ricomposta lato server al salvataggio. Il bundle è invece il mezzo di backup e trasferimento — sono due cose diverse, ora scritto nel commento del formato.
  - Corrette due stringhe che dicevano il falso all'utente nel momento della conferma: entrambi i messaggi di import promettevano *"Le password MQTT non sono incluse: dovrai re-immetterle"*.
  - Nuovo test (`sws-web`, 18/18) sul bundle prodotto da `build_project_zip` — quella del deploy — che verifica la presenza dei tre segreti e l'assenza del sentinella. Verificato anche sul runtime vero: export → ZIP → import in un altro progetto, con le tre credenziali ripristinate.
  - Aggiornato il commento del formato bundle, che descriveva `users.yaml` come *"NEVER included"* mentre il codice lo include da tempo.

### Added

- **Telegram per singolo allarme** (chiesto dal maintainer: *"nella tabella ALLARMI posso decidere se il singolo allarme deve generare il messaggio su telegram?"*). Nuova colonna *Telegram* nella tab Allarmi con tre scelte: **Chat predefinite** (quelle di Configurazione → Notifiche), **Chat specifiche** (solo gli id elencati sulla riga) e **Non notificare**.
  - `AlarmDef.telegram_mode` + `telegram_chat_ids` in `sws-core`, entrambi `Option` con `skip_serializing_if`: **assente significa "chat predefinite"**, cioè esattamente quello che gli allarmi facevano prima che l'impostazione esistesse. Leggere l'assenza come "off" avrebbe spento in silenzio le notifiche di impianti già in servizio.
  - La decisione vive in `AlarmDef::telegram_routing()` (6 test in `sws-core`), non sparsa nel supervisore. Fra i test: il giro completo su YAML del valore `off`, che è un **token booleano** in YAML 1.1 — se serializzatore e parser non concordassero, un allarme messo a "non notificare" impedirebbe la riapertura del progetto.
  - "Chat specifiche" **senza nessuna chat** non ricade sulle chat globali: è un'impostazione incompleta di chi stava *restringendo* i destinatari, e la ricaduta manderebbe l'allarme proprio a tutti. Il runtime lo scrive nel log, l'editor lo segnala sulla riga.
  - Il canale Telegram ora trasporta un `TelegramMessage` con destinatari opzionali (`None` = chat configurate). Gli script continuano a spingere `String` sul proprio canale — `sws-pyscript` resta senza tipi di `sws-web` — e i due canali confluiscono nello stesso drainer.
  - `restart_sender` non scarta più la configurazione quando le chat globali sono vuote: un progetto può averne zero e avere solo allarmi con chat proprie, e prima quei messaggi finivano cestinati con `channel not configured`.

### Fixed

- **`pnpm test` era rosso a ogni esecuzione**: vitest raccoglieva anche le spec Playwright di `e2e/`, che fuori dal loro runner non si importano — 5 file falliti stabili accanto ai test veri, cioè una verifica inutilizzabile come gate. `vite.config.ts` ora limita vitest a `tests/**`; le e2e restano su `pnpm test:e2e`.

- **"Salva tutto" cancellava variabili, sorgenti e allarmi** (regressione introdotta oggi, con perdita di dati reale). `saveAll()` spingeva su disco la copia in memoria di `tags`/`sources`/`alarms`: in un momento in cui quella copia è più povera del disco, il salvataggio distrugge il contenuto. Documentato dall'audit log: quattro scritture in 23 ms alle 16:41 del 2026-07-28, fra cui `{"count": 0, "what": "tags"}` su un progetto che su disco aveva 16 variabili — e la scrittura *doppia* dei tag mostra che hanno scritto in due, la tab (per il flush automatico delle bozze) e `saveAll` stesso. Prima di oggi il rischio esisteva ma era latente: quella funzione girava solo dal menu in modalità Editor, non anche in Configurazione e a ogni deploy.
  - **`saveAll()` non scrive più `tags`/`sources`/`alarms`**: appartengono alle tab di Configurazione, che si salvano con il proprio pulsante. Restano `functions` e `custom_symbols`, modificate dall'editor e senza altro percorso di salvataggio.
  - **Il flush automatico delle bozze resta solo dove l'intenzione dell'utente è tracciata davvero**: Notifiche (flag `touched`) e Datastore (flag `dirty` locale). Le tab Variabili, Protocolli, Allarmi e Lingue tornano a salvarsi solo col proprio pulsante — un confronto strutturale bozza-vs-store non esprime un'intenzione, e con un flush automatico diventa una scrittura non richiesta.
  - Verificato sul comportamento reale: progetto da template con 49 variabili, 4 sorgenti e 6 allarmi → intatto col nuovo "Salva tutto", azzerato con il vecchio.

- **Il selettore delle variabili (`▾`) non compariva nella tabella Allarmi** — né altrove — quando il progetto non aveva variabili dichiarate: `TagInput` nascondeva il pulsante con `tags.length > 0`, così una lista vuota sembrava una funzione mancante. Ora il `▾` c'è sempre e, se non c'è nulla da scegliere, il menu spiega dove creare le variabili.

### Changed

- **Il selettore delle variabili elenca anche le variabili dedotte dalle sorgenti**, non solo quelle dichiarate: in molti progetti nascono dalle mappature dei protocolli (topic MQTT, registri Modbus, nodi OPC-UA, metriche Sparkplug…) e la lista risultava vuota proprio nei casi realistici. Nuovo `src/tagCatalog.ts` (`tagCatalog()` + `sourceTagIds()`, 6 test) che unisce le due provenienze mostrando quale sorgente produce ogni id; la funzione locale `collectSourceTagIds()` di ConfigView è stata sostituita da questa. `TagInput` è ora usato anche nei quattro punti che avevano un campo di testo semplice: tag S7/EtherNet-IP, registri Modbus, metriche Sparkplug e trigger `tag_change` degli script globali.

- **Il token Telegram non viene più cancellato da "Salva tutto"** (regressione introdotta oggi). Riprodotto con precisione: se la UI manda `notifications` **senza** la sezione `telegram`, il backend rimuove il token salvato — la guardia esistente copriva solo il caso del placeholder `********`, non quello della sezione assente. Il grilletto era il cablaggio di `pendingSections`: da quando "Salva tutto" svuota le bozze delle tab di Configurazione, una bozza della tab Notifiche disallineata (token mascherato → `tgEnabled` falso) veniva scritta su disco senza che l'utente avesse toccato nulla.
  - **Causa rimossa**: la tab Notifiche si registra come "da salvare" solo se l'utente ha **effettivamente modificato** qualcosa (flag `touched`), non più in base a un confronto strutturale bozza-vs-store — confronto che con un segreto mascherato è per costruzione inaffidabile.
  - **Rete di sicurezza**: il backend logga un warning esplicito quando una nuova configurazione sta per rimuovere un `bot_token` già salvato. La semantica non cambia (disabilitare Telegram deve poterlo rimuovere), ma l'evento non è più invisibile.
  - **UI**: il campo Bot token non mostra più `********` — appare vuoto con `✓ salvato sul server` e il placeholder "già salvato — scrivi qui solo per sostituirlo". Mostrare la stringa mascherata faceva sembrare che il dato fosse andato perso quando invece era al suo posto.
- **`tests/App.test.tsx` era rosso da diverse sessioni** (cercava le etichette "Edit"/"View", rimosse quando i pulsanti di modalità sono passati alle chiavi i18n). Riportato al suo scopo reale — che lo shell monti senza lanciare — con una nota su cosa non copre e perché: il gate `bootstrapping` rende `null` finché le chiamate di rete non rispondono, quindi in jsdom il DOM resta vuoto. La suite frontend è verde per la prima volta (15/15).

- **Tre barre di scorrimento nel viewer su pannello industriale, cause distinte.** Sul WP620 (1280×800) la pagina non entrava nello schermo:
  1. **Scrollbar del documento, presente sempre** — `index.html`/`index-admin.html` non azzeravano il `margin: 8px` di default del `body`: contro una radice `height: 100vh` fanno 816 px in 800. Aggiunto `html, body { height: 100%; margin: 0; overflow: hidden }` + `#root { height: 100% }`. Nessun rischio di regressione: `<main>` era già `overflow: hidden` e tutte le viste scorrono in contenitori propri.
  2. **Scrollbar verticale dell'area pagina** — in modalità *fisso* l'`<svg>` riceveva `height={pageHeight}` letterale mentre il contenitore era già ridotto dei 70 px di chrome (fascia allarmi 33 + nav 37), che nessuno sottraeva.
  3. **Scrollbar orizzontale** — larghezza pagina contro larghezza disponibile al netto dei margini e della scrollbar del punto 1.
  Aggiunto `boxSizing: border-box` a nav e fascia allarmi: i 36/32 px dichiarati erano 37/33 col bordo.

### Added

- **Viewer a schermo pieno** (`hide_viewer_chrome` in `PageLayoutConfig`, checkbox in Configurazione → Impostazioni pagine): nasconde barra di navigazione **e** fascia allarmi, così sul pannello si renderizza solo l'area della pagina. La fascia allarmi passa in modalità **sovrapposta** — sparisce del tutto a riposo (prima occupava 32 px per dire "nessun allarme") e compare sopra il synoptic quando un allarme è attivo, senza rubare spazio. La campanella, che era a `top: 80` hardcoded, ora deriva l'offset dal chrome effettivo. La modale avvisa che senza barra la navigazione passa dagli oggetti "Pulsante pagina" o dalla rotazione automatica.
- **Modalità fisso: la pagina si rimpicciolisce invece di scorrere.** `RuntimeView` misura il contenitore con un `ResizeObserver` e passa un `fitScale` a `SvgCanvas`. Nuova pura `viewerFitScale()` in `pageLayout.ts` con **cap a 1**: si riduce, non si ingrandisce — quando le misure combaciano lo scale è esattamente 1 e i pixel restano 1:1, mentre ingrandire sfocherebbe il disegno. 4 test unitari.
- **Auto-reload quando viene distribuito un frontend nuovo** (`useBuildWatcher`): confronta ogni 30 s i nomi dei bundle referenziati dall'HTML di entry, che Vite rinomina per hash a ogni build. Serve `cache: "no-store"` perché `ServeDir` non manda `Cache-Control` sull'HTML, e l'URL va costruito sull'origine della pagina e non su `getBaseUrl()`. **Viewer**: ricarica da sé, perché un bundle nuovo si carica solo così e sul pannello non c'è nessuno che possa premere un pulsante. **IDE**: banner con "Ricarica", mai automatico — butterebbe via le modifiche non salvate.
- **Fix**: `sws:autoRotate` veniva scritto in localStorage ma **mai riletto** all'avvio, quindi dopo un reboot del pannello la rotazione tornava sempre spenta — ed è l'unico modo di cambiare pagina su un viewer a schermo pieno senza oggetti navbutton.

### Changed

- **Dati del container in `/data/user/sws`, SPA fuori dall'immagine.** Su indicazione del maintainer i dati persistenti passano da volumi nominati podman a **bind mount** su un percorso esplicito dell'host: restano visibili e copiabili senza `podman volume inspect`, e `/data` è la partizione scrivibile sui device Pixsys — stessa collocazione dell'installazione nativa. (`/data/user` e non `/data`: il primo è di proprietà dell'utente, il secondo no.) L'installer **migra** automaticamente i dati dai volumi della versione precedente, altrimenti dopo l'aggiornamento i progetti sembrerebbero spariti.
  - Funziona sotto rootless perché il container gira come root e in rootless l'UID 0 del container è mappato sull'utente dell'host; con podman rootful i permessi andrebbero rivisti.
  - **La SPA esce dall'immagine** e vive in `/data/user/sws/www`: `build_container.sh` produce un secondo artefatto `sws-www-<ver>.tar.gz` (~0,4 MB) e `install-container.sh --www-only` lo aggiorna in meno di un secondo **senza riavviare il container**. Prima una modifica al solo frontend imponeva di ricostruire e ritrasferire 59 MB — ed è già capitato di avere sul dispositivo dati aggiornati e SPA vecchia, con conseguente caccia al fantasma. Conseguenza accettata: l'immagine da sola non serve la SPA, e l'installer si rifiuta di procedere se `www` resta vuota.
  - L'aggiornamento sostituisce il **contenuto** della directory montata, non la directory: un `mv` romperebbe il bind mount (il container ne tiene l'inode) e la SPA darebbe 404 fino al riavvio del container. Verificato sul dispositivo.

### Added

- **Il progetto deployato si ricarica da solo: niente riavvio.** Il runtime già ricaricava tutto a ogni apertura di progetto (`open_project` ferma le sorgenti, svuota TagDb/allarmi/funzioni e riapplica), ma **nessuno lo diceva ai client connessi**: la SPA teneva in memoria il progetto caricato all'avvio, quindi dopo un deploy continuava a mostrare la versione precedente. Nuovo `useProjectWatcher` (`sws-editor/src/ws/projectWatcher.ts`): sorveglia `GET /api/project/fingerprint` (T-24) ogni 3 s. Un solo segnale copre tutti i casi — contenuto modificato, progetto sostituito, progetto chiuso, e runtime che passa da "nessun progetto" a progetto attivo, che è quello che succede a un deploy su un runtime vuoto. Polling e non push perché lato server non esiste un bus di eventi di progetto, e così si intercettano anche i cambi che non passano dalle API (pull GitOps, file modificati sul dispositivo).
  - **Viewer**: ricarica progetto e pagine **restando sulla pagina corrente** se esiste ancora, con un avviso di 4 s "Progetto aggiornato" — su un pannello in campo nessuno può premere un pulsante di conferma, ma l'operatore deve capire perché la schermata è cambiata.
  - **IDE**: **mai** automatico. Banner "Il progetto sul runtime è cambiato" con Ricarica/Ignora, perché un ricarico automatico sovrascriverebbe eventuali modifiche non salvate. I salvataggi dell'autore sono esclusi dall'avviso (finestra di 20 s), altrimenti comparirebbe dopo ogni Ctrl+S.

### Fixed

- **Il deploy salva prima di esportare.** Entrambi i percorsi di deploy (Runtime → Connetti, e tab Device) costruiscono lo ZIP leggendo il progetto **da disco**: con modifiche non salvate spedivano silenziosamente lo stato precedente — il log diceva "🚀 Deploy completato!" e sul dispositivo restava la versione vecchia. Nuovo `flushBeforeDeploy()` condiviso: se ci sono modifiche pendenti chiama `saveAll()`, lo scrive nel log del deploy, e **annulla il deploy** se il salvataggio fallisce invece di pubblicare qualcosa di diverso da ciò che l'autore vede.

- **Gestione container completata: avvio al boot, installer on-device, discovery.**
  - Nuovo `deploy/container/install-container.sh` (gira **sul dispositivo**, senza sudo) + unit **quadlet** `deploy/container/sws-runtime.container`. Un container rootless **non** riparte dopo un reboot nemmeno con `--restart=unless-stopped`: servono `loginctl enable-linger` e un'unit utente, che l'installer configura. Da lì `systemctl --user status|restart sws-runtime` e `journalctl --user -u sws-runtime`. Flag: `--image`, `--host-network`, `--no-autostart`, `--uninstall [--purge]`.
  - **Volume dei log** (`sws-logs:/var/sws/logs`): prima i log vivevano nel layer scrivibile e sparivano alla ricreazione del container.
  - **mDNS**: l'annuncio pubblica ora lo **schema reale** (`http` finché non esiste un certificato) invece di assumere sempre `https`; `discover.rs` lo legge, con default `https` per compatibilità con runtime precedenti. Prima, anche quando la discovery funzionava, l'URL offerto non rispondeva. La causa per cui "Cerca runtime" non vedeva il device era la rete bridge di podman, non il confine di subnet: con `--host-network` la discovery funziona (verificato da un'altra macchina della LAN).
  - **`hostname -I` negli installer** (bug preesistente in `deploy/yocto/install.sh` e `deploy/generic-linux/install.sh`): è un'opzione di net-tools e non esiste dove `hostname` è quello di coreutils, come su Pixsys OS. Con `set -euo pipefail` la sostituzione fallita **abortiva l'installer sul messaggio finale**, a installazione già completata. Sostituita con `ip -4 -o addr`, che funziona ovunque ed elenca tutti gli indirizzi invece di indovinare il primo — utile su questi device, che ne hanno più di uno.

- **`POST /api/remote/connect` verifica di essere puntato alla porta admin.** In no-auth mode l'handler non faceva **nessuna** richiesta al target: salvava l'URL e l'IDE diventava verde anche puntando alla porta viewer o a un host qualsiasi. Il fallimento emergeva solo più tardi, a metà deploy, come `404 Not Found` seguito da `405 Method Not Allowed` — perché le route di lifecycle progetto esistono solo sulla porta admin (architettura dual-port). Ora sonda `GET /api/projects` (pre-auth sulla admin, assente sulla viewer) e su 404 rifiuta con un messaggio che indica la porta corretta. Sondare `/health` non servirebbe: risponde su entrambe le porte.
- **Il runtime esce su SIGTERM.** Era intercettato solo `ctrl_c()` (SIGINT), mentre `podman stop` e `systemctl stop` mandano SIGTERM: ogni arresto gestito aspettava il grace period e finiva in `SIGKILL` (10 s con podman), con il rischio di troncare una scrittura su `project.yaml` o sull'SQLite dell'historian. Nuova `shutdown_signal()` in `sws-runtime/src/main.rs` che attende SIGINT **o** SIGTERM; se l'handler non si installa si degrada al solo SIGINT con un warning invece di andare in panic. Verificato: uscita in ~100 ms invece del SIGKILL.

### Added

- **Runtime in container podman su device aarch64** — nuovo percorso, verificato su hardware reale (Pixsys OS 2.0.0-dev, kernel 6.12, podman 5.0.2 rootless).
  - Nuovo `deploy/container/Containerfile`: **non compila nulla**, avvolge il binario già cross-compilato dall'SDK Pixsys. Base `ubuntu:24.04` — scelta obbligata, non estetica: il binario dichiara `NEEDED libpython3.12.so.1.0` e simboli fino a `GLIBC_2.39`, quindi `debian:bookworm-slim` (glibc 2.36 + Python 3.11, la base dell'immagine legacy) è doppiamente incompatibile.
  - Nuovo `scripts/build_container.sh`: cross-build → `podman build --platform linux/arm64 --format docker` → `podman save` in `dist/`. Contesto di build in staging (~40 MB) invece della radice del repo, e guardia che rifiuta un binario non-aarch64 — senza, l'errore salterebbe fuori solo al `podman run` sul device.
  - `--format docker` è necessario: `HEALTHCHECK` non esiste nella spec OCI e col formato di default podman lo scarta silenziosamente.
  - Rispetto all'immagine legacy (`sws-runtime/docker/Dockerfile`, che resta intatta): flag `--viewer-port`/`--www` nel `CMD` (prima il viewer non andava mai in ascolto), healthcheck su **http** (prima su https, sempre rosso), template inclusi (prima `GET /api/templates` era vuoto), niente `SWS_ADMIN_PASSWORD` obbligatorio, e **RestrictedPython installato** — verificato a runtime: `pyscript: RestrictedPython available — scripts will run sandboxed`.
  - Nuovo `docs/DEPLOY_CONTAINER_AARCH64.md` con esito del test, vincolo kernel ≥ 5.15 (il binario è marcato `for GNU/Linux 5.15.0` e i container condividono il kernel dell'host) e limiti noti.

- **Creazione cartelle dal selettore di destinazione + apertura progetto da uno ZIP sul PC.**
  - **`POST /api/fs/mkdir`** (`{parent, name}` → `201 {path}`), accanto a `browse-dirs`: parte pura estratta in `resolve_new_dir()` (testabile senza `AppState`, riusa `safe_project_name`), `create_dir` e **non** `create_dir_all` così un refuso in `parent` non materializza un albero; `AlreadyExists` → 409, `PermissionDenied` → 403. Nel gruppo **pre-auth** `project_lifecycle` come `browse-dirs` — vedi la nota aggiunta in `docs/OPEN_QUESTIONS.md` sulla superficie `/api/fs/*` da chiudere al passaggio a prodotto.
  - **Pulsante "＋ Nuova cartella"** nel `DirectoryBrowser`, con riga di input inline (Invio crea, Esc annulla) invece di `prompt()` — non traducibile, non stilabile, soppresso in alcune webview kiosk. Dopo la creazione si naviga *dentro* la nuova cartella.
  - **"📂 Apri da file ZIP…"** nella WelcomeScreen: il percorso esisteva già ma era invisibile dietro "Nuovo progetto → Da ZIP". È **non distruttivo** (crea un progetto nuovo via `POST /api/projects/upload`), a differenza della voce omonima nel ☰ che sostituisce il progetto attivo.

- **Percorso progetto a scelta in creazione + elenco progetti recenti automatico + preset dispositivo legati al brand.**
  - **Registro progetti** (`sws-web/src/project_registry.rs`, nuovo): `config_dir/known_projects.json`, mappa `nome → {path, last_opened_ms}`, toccato automaticamente da create/open/upload — copre sia i progetti in `projects_root` sia quelli a percorso esterno (Documenti, backup share...).
  - **`parent_path` opzionale** in `CreateProjectRequest` e `?parent_path=` su `POST /api/projects/upload`: percorso assoluto libero (nessuna whitelist), assente = comportamento invariato.
  - **`GET /api/projects`** ora restituisce l'unione scan+registro ordinata per `last_opened_ms` decrescente, con nuovi campi `path`, `last_opened_ms`, `external`.
  - **`rename`/`duplicate`/`delete`** con trattamento differenziato per le voci esterne: rename non sposta la cartella, duplicate crea una cartella sorella, delete de-registra soltanto (mai cancella file fuori dal controllo dell'editor).
  - **`GET /api/fs/browse-dirs`** (nuovo): mini file-browser server-side per la UI di scelta cartella.
  - **Frontend**: `NewProjectModal` con selettore cartella destinazione + `DirectoryBrowser`; lista progetti con path/badge "esterno"/azione "Rimuovi dall'elenco".
  - **Preset dispositivo per brand**: `Brand.devicePresets` da `brand.json` (`device_presets`); i 5 modelli Pixsys spostati da `pageLayout.ts` hardcoded a `public/branding/pixsys/brand.json`; `getDevicePresets()` = standard + brand attivo, dropdown raggruppato per `<optgroup>`.
- **Controlli di zoom nell'editor + nuova toolbar contestuale.**
  - **"Adatta pagina"**: prima non esisteva alcun modo di tornare a vedere la pagina intera dopo uno zoom — c'erano solo un badge `%` non cliccabile e un glifo `⊡` in un angolo del canvas, e quel `⊡` adattava **agli oggetti**, non alla pagina. Nuova `fitPage()` che usa le dimensioni reali della pagina scontando righelli e margine; in modalità **fluida** (nessuna dimensione dichiarata) il pulsante è disabilitato con tooltip e `Ctrl+Shift+0` ricade sull'adatta-oggetti. Nuova pura `editorFitSize()` in `pageLayout.ts`.
  - **`Ctrl+Shift+0`** cambia semantica: da "adatta agli oggetti" a "adatta alla pagina" (via ref, così segue sempre la pagina corrente).
  - **Slider di zoom** su passi discreti 10/25/50/75/100/125/150/200/300/400%. La percentuale mostrata è il valore *vero* (un `Ctrl+rotella` intermedio resta onesto) e cliccarla riporta al 100%.
  - **Nuova `EditorToolbar`** (solo in modalità Editor, tra header e tab pagine): undo/redo — che finora esistevano **solo da tastiera** —, griglia + snap (spostati dall'header), righelli, gruppo zoom. Estratta anche `PageTabs` da `App.tsx`.
  - Zoom e pan restano in ref locali dentro `SvgCanvas`, esposti alla toolbar con un handle imperativo (`CanvasViewApi`): il pan scrive a frequenza mousemove e nello store farebbe rigirare i selettori di tutta l'app ~60 volte al secondo. `showRulers` invece passa nello store, avendo due punti di ingresso.

- **Copia del progetto sul PC resa trovabile.** Il meccanismo esisteva già (export ZIP → download, import ZIP), ma le voci di menu si chiamavano "Esporta/Importa progetto", che non dice a chi usa un editor *remoto* che il file finisce sul **suo** PC. Rietichettate in **"💾 Salva copia sul PC…"** e **"📂 Sostituisci da copia sul PC…"** (chiavi nuove; restano Admin-only, lo ZIP contiene `users.yaml`). `handleImport` e la posizione dell'`<input type=file>` non sono stati toccati (fix issue #2); aggiornato nello stesso commit il selettore del test Playwright che vi dipende. Eliminato `src/components/ProjectIO.tsx`, duplicato non referenziato degli stessi due flussi.

- **Barra in alto riorganizzata su due livelli.** L'header di app resta ai comandi di progetto (logo · runtime remoto · progetto + stato salvataggio · Editor|Config · acquisizione + Start/Stop · Deploy · 👤 · ☰); gli strumenti di disegno stanno nella toolbar dell'editor; i controlli raramente usati scendono nei menù: **pannello Log** e **Riavvia runtime** nel ☰, **utente + ruolo, lingua interfaccia e tema** nel nuovo menu **👤** (che di proposito non contiene azioni privilegiate). `App.tsx` scende da 1047 a 626 righe estraendo `BrandLogo`, `RuntimeCtrl`, `MainMenu`, `UserMenu` e `headerStyles.ts` (con l'hook `useOutsideClose` prima duplicato). Tradotte le ultime stringhe italiane hardcoded toccate (`ThemeToggle`, `UiLangSelect`, conferma di reboot).

- **Stato "modifiche non salvate" affidabile, `Ctrl+S` e salvataggio disponibile in ogni modalità.**
  - **Indicatori**: pallino ambra cliccabile accanto al nome progetto (`DirtyIndicator`, nell'header di app → visibile anche in Configurazione), `●` anteposto al titolo della scheda del browser, guardia `beforeunload` agganciata solo mentre ci sono modifiche pendenti.
  - **`Ctrl+S` / `Cmd+S`** (prima inesistente): listener globale, con `preventDefault` incondizionato per non far comparire il "Salva pagina" del browser.
  - **`saveAll()` nello store** al posto del bus `saveSerial` → `useEffect` in `EditorShell`: salvare in modalità Configurazione era prima *fisicamente impossibile* (EditorShell smontato). Ora `saveAll()` svuota prima le bozze delle tab registrate, poi salva pagine e sezioni di progetto. La voce "Salva tutto" nel menu ☰ non è più editor-only.
  - **Modello dirty corretto** (prima sbagliato in entrambe le direzioni: lo accendeva solo `pushHistory`, quindi le tab di Configurazione non lo toccavano; undo/redo non lo aggiornavano mai). Ora due sorgenti dietro il selettore derivato `selectIsDirty` — il campo `isDirty` è stato rimosso così non può disallinearsi: (1) **pagine**, contatore `pagesRev` timbrato nelle voci di history e ripristinato da undo/redo/jumpTo, con `savedPagesRev` scritto solo da un salvataggio *completo* (fallimento parziale → resta sporco, il retry ri-PUTta tutto); (2) **resto**, registro `pendingSections` in cui si registrano la `SaveBar` della tab attiva (tags/sorgenti/allarmi/datastore/notifiche/lingue) e il `FunctionEditor`, portando con sé *come* salvarsi.
  - I setter `updateProject*` **non** marcano dirty di proposito: le tab salvano su API e solo dopo aggiornano lo store, quindi la copia in memoria combacia sempre col disco — marcarli renderebbe il progetto sporco per sempre.
  - **Fix**: `renameGroup` mutava le pagine senza `pushHistory`, quindi era invisibile sia a undo sia allo stato "modificato".
  - Nuovo `sws-editor/tests/dirtyState.test.ts` (6 casi) sui comportamenti che prima sbagliavano.

- **Gestione pagine synoptic: dimensionamento progetto-wide, riordino, miniature, home page, audit collegamenti, lock.**
  - **Dimensionamento pagina** (impostazione di progetto, non per-pagina): **Fisso** (1:1 pixel reale, nessuno scaling — pensato per un dispositivo noto, es. pannello HMI, con scrollbar/margine se la finestra reale non combacia); **Solo proporzioni** (rapporto scelto — 16:9/4:3/21:9/1:1/personalizzato — con risoluzione di riferimento standard, scala mantenendo le proporzioni come il comportamento storico); **Fluido** (nessuna dimensione dichiarata, disegno 1:1 nella viewport disponibile). Modello dati `PageSizeMode`/`PageLayoutConfig` su `Project` (`sws-core`), endpoint `PUT /api/project/page-layout`. Passare a "Proporzioni" propaga automaticamente la risoluzione standard a tutte le pagine esistenti.
  - **Blocco rigido ai confini pagina in editor**: drag e resize di un oggetto ora si fermano al bordo pagina (quando Fisso/Proporzioni), invece di poter uscire liberamente come prima.
  - **Preset dispositivo** in Proprietà pagina (modalità Fisso): 5 risoluzioni reali Pixsys WebPanel + 4 standard generiche, precompilano width/height.
  - **Pannello "Impostazioni pagine del progetto"** (icona ⚙ nella sezione Pagine): modalità dimensionamento, rapporto, **pagina iniziale (home)**.
  - **Home page**: il viewer apre la home al mount con fallback automatico alla prima pagina consentita se la home non è nella zona (ABAC) dell'operatore; la rotazione automatica kiosk riparte dalla home a fine ciclo invece che dalla prima pagina assoluta.
  - **Riordino drag & drop** delle pagine nella lista (oltre alle frecce ↑↓ esistenti); **miniature** live per ogni pagina.
  - **Report "Verifica collegamenti"** (icona 🔗): scansiona tutti i `navbutton` di progetto ed elenca link con `target_page` inesistente + pagine "orfane" (nessun link in ingresso e non sono la home), con salto diretto alla pagina/oggetto.
  - **Lock pagina** (🔒/🔓): la pagina bloccata diventa di sola lettura in editor (canvas non modificabile, pannello proprietà disabilitato in blocco via `fieldset[disabled]`) senza impedire duplica/elimina.
  - **Fix collaterale**: `auto_rotate_skip` mancava dal mirror Rust `SynopticPage` (`sws-web/src/synoptic.rs`) e veniva silenziosamente perso ad ogni `GET /api/synoptics/:name` (deserializza→riserializza) — corretto insieme all'aggiunta di `locked`.

- **Pannelli editor (sinistra/destra) ridimensionabili** — bordo trascinabile su entrambi (sinistro 160–480px, destro 220–560px), larghezza persistita in `localStorage`.

- **Isolamento runtime↔IDE (OPEN_QUESTIONS Q8): modalità operator-only + audit log reale.** Prima release che affronta la mancanza di isolamento tra il processo runtime e la superficie IDE/admin, entrambi collassati nello stesso processo nel PoC.
  - **Modalità `--no-admin`** (`sws-runtime/src/main.rs`, `sws-web/src/router.rs`): nuovo flag che non binda affatto la porta admin/IDE (richiede `--viewer-port`), riducendo la superficie d'attacco sul dispositivo di campo a solo viewer operatore + funzioni bound ai bottoni. In questa modalità `/api/script/exec` (esecuzione codice Python arbitrario) viene rimosso dal router del viewer; `/api/script/run/:name` (funzioni nominate, invocate dai bottoni synoptic) resta disponibile.
  - **Audit log append-only, tamper-evident** (`sws-audit` — prima uno stub, ora implementato: `chain.rs` con hash-chain SHA-256 + firma HMAC-SHA256 opzionale via `SWS_AUDIT_KEY`; `AuditLog` scrive JSONL in append serializzato, `verify()` ricalcola l'intera catena e segnala la prima entry alterata). Cablato in `sws-web` su: login/login fallito/logout, scrittura tag, esecuzione script/funzioni, modifiche di configurazione progetto (tag, sorgenti, allarmi, notifiche, script globali). Nuovi endpoint Admin-only `GET /api/audit` (tail) e `GET /api/audit/verify` (esito integrità). Vista read-only in *Configurazione → Sistema* (tabella entry + pulsante "Verifica integrità").

- **Notifiche Telegram — canale allarmi + funzione script `send_telegram(text)`** (`sws-core/src/project.rs`, `sws-web/src/telegram.rs` (nuovo), `notifications.rs`, `router.rs`, `system.rs`, `projects.rs`, `global_scripts.rs`, `sws-pyscript/src/lib.rs`; frontend `config/ConfigView.tsx`, `types/index.ts`, `api/client.ts`, `store/index.ts`). Nuovo `TelegramConfig {bot_token, chat_ids}` in `NotificationConfig`. Un `TelegramSender` (drainer + `reqwest`, con config hot-swappabile) invia messaggi via Bot API: sul canale allarmi ogni allarme `ActiveUnacked`/escalation va anche alle chat globali Telegram (accanto alle email), e la funzione **`send_telegram("testo")`** è iniettata negli script globali (pyscript resta HTTP-free: spinge su un canale `mpsc` drenato da `sws-web`). Il `bot_token` è mascherato nelle GET come la password SMTP. **UI** in *Configurazione → Notifiche*: sezione Telegram con toggle, token, chat ID, istruzioni guidate; **"Invia test"** e **"Rileva chat"** chiamano **direttamente** la Bot API dal browser (funzionano dal solo editor, senza runtime), con auto-retry sul rilevamento chat (assorbe il ritardo di propagazione di `getUpdates`).

- **T-39 — IDE e viewer multilingua (IT/EN)** (`sws-editor/src/i18n/`, `App.tsx`, `config/ConfigView.tsx`, `editor/*`, `runtime-view/*`, `components/*`). Internazionalizzazione completa della chrome via react-i18next: base italiana + inglese (~667 chiavi), lingua iniziale da `localStorage` (`sws.uiLang`) → browser → `it`, fallback `en`. Nuovo componente `UiLangSelect` nell'header dell'IDE e nella nav del viewer. Asse "lingua UI" indipendente dalla lingua dei contenuti di progetto (T-40).

- **T-40 — tabella lingue di progetto + cambio lingua nel viewer** (`sws-core/src/project.rs`, `sws-web/src/router.rs`, `sws-editor/src/i18n/projectI18n.ts`, `config/ConfigView.tsx`, `canvas/SvgCanvas.tsx`, `editor/EditorShell.tsx`, `store/index.ts`). L'autore scrive nei campi testo degli oggetti dei riferimenti `{{token}}`; una tabella `languages` di progetto (Rust `LanguageTable {default, langs, entries:[{key, values}]}`, campo `Project.languages` `#[serde(default)]` — viaggia con export/import ZIP) mappa token → traduzioni per lingua. Nuovo endpoint `PUT /api/project/languages`. Il viewer risolve i token nella lingua corrente (`resolveMsg`/`localizeObjects` a monte di `SvgCanvas`); store `projectLang` persistito (`sws.projectLang`). Nuovo tab **"Lingue"** in ConfigView (griglia editabile + export/import CSV), oggetti canvas `lang_selector` (menù a tendina) e `lang_button` (imposta la lingua), token-picker nel pannello proprietà. I template di esempio sono stati resi conformi: **479** messaggi tokenizzati + tabella `languages` IT/EN in tutti e 9 (con `lang_selector` in Page 1 dei 6 con contenuto).

- **Manuale — capitolo "Multilingua"** (`docs/manual/15_multilingua.md`, riga aggiunta all'indice in `docs/manual/MAIN.md`). Documenta i due assi linguistici: lingua UI IT/EN (selettore in header, `sws.uiLang`) e tabella lingue di progetto (tab Lingue, token `{{chiave}}`, export/import CSV, oggetti `lang_selector`/`lang_button`, `sws.projectLang`), con note tecniche su API e campi tradotti.

- **Lingua di anteprima dell'editor + gestione tabella Lingue** (`sws-editor/src/store/index.ts`, `i18n/projectI18n.ts`, `editor/EditorShell.tsx`, `config/ConfigView.tsx`, `i18n/{it,en}.json`). Nuovo asse `editorPreviewLang` (store Zustand + `localStorage sws.editorPreviewLang`, indipendente da lingua UI e da `projectLang`): il canvas dell'editor risolve ora i `{{token}}` nella lingua scelta invece che sempre nella predefinita (prima [EditorShell.tsx:260](sws-editor/src/editor/EditorShell.tsx#L260) cablava `project.languages.default` e il corpo non si ri-renderizzava al cambio lingua). Nel tab **Configurazione → Lingue** due selettori: **«Lingua progetto»** (la sorgente/predefinita, `table.default`) e **«Lingua Editor (anteprima)»** (guida il canvas, con fallback alla predefinita). La tabella dei messaggi è ora **filtrabile per colonna** (input case-insensitive su chiave + ogni lingua) e **ordinabile** (clic sul titolo colonna: asc → desc → nessuno, ordinamento solo visuale). Le modifiche restano corrette con filtro/ordine attivi perché la vista conserva l'indice reale (`origIdx`) di `table.entries`; rimuovere una lingua o importare un CSV azzera filtri/ordine obsoleti.

- **MQTT — «Estrai da JSON»: genera le mappature dei topic da un payload di esempio** (`sws-editor/src/config/ConfigView.tsx`). Nella card di una sorgente MQTT un pulsante apre una finestra in cui si incolla un payload JSON: il tool lo appiattisce in variabili foglia (dot-path per gli oggetti annidati, es. `update.state`; array e `null` scartati), deduce il tipo (bool/int/float/string) e mostra il valore campione. L'utente seleziona quali variabili usare e con «Genera righe» il tool crea una riga di `TopicMapping` per ciascuna (stesso `topic`, `json_path` = path, `tag` suggerito editabile) e — con il toggle «Crea anche i tag» — i relativi `TagDef` col tipo dedotto (dedup sugli id esistenti). Interamente frontend: il plugin Rust naviga già i `json_path` annidati.

- **MQTT browse — durata scansione configurabile fino a 120 s** (`sws-runtime/crates/sws-web/src/router.rs`, `sws-plugin-mqtt/src/lib.rs`, `sws-editor/src/config/ConfigView.tsx`). Il "Sfoglia broker" ora ascolta di default **30 s** (prima 8) con cap **120 s** (prima 15), utile per topic non-retained che pubblicano di rado (es. dispositivi zigbee2mqtt fermi).

### Fixed

- **Storico perso ad ogni riavvio del processo** (`sws-runtime/crates/sws-runtime/src/main.rs`). Il percorso di boot che riapre automaticamente l'ultimo progetto attivo (marker `.active-project`) faceva tutto quello che fa `POST /api/projects/:name/open` **tranne** ricollegare il historian al SQLite del progetto (`historian.swap_store`, introdotto in `2911d14` ma mai propagato al percorso di avvio). Le nuove scritture continuavano ad arrivare regolarmente, ma `GET /api/history/*` (quindi il widget trend, l'export CSV, le stats) vedeva solo i campioni accumulati in RAM da quel riavvio in poi, mai lo storico già su disco — bug strutturale, non specifico di un progetto.

- **Oggetto "Lingua ▾" (`lang_selector`) non trascinabile in editor** (`sws-editor/src/canvas/SvgCanvas.tsx`). Era l'unico controllo a montare un `<select>` HTML reale (dentro `foreignObject`) anche in modalità editor (solo `disabled`), che intercettava il mousedown prima che il drag potesse partire. Riallineato al pattern già usato da slider/tabelle: preview SVG statico in editor, widget reale solo a runtime.

- **Configurazione → Notifiche: la config non restava al cambio tab** (`sws-editor/src/config/ConfigView.tsx`, `store/index.ts`). `NotificationsTab` salvava sul server ma non aggiornava lo store, quindi tornando nel tab si re-inizializzava da uno stato stantìo (SMTP e Telegram apparivano non configurati). Nuovo setter `updateProjectNotifications` chiamato dopo il salvataggio.

- **Tasto "Salva" incoerente tra le tab di Configurazione** (`sws-editor/src/config/ConfigView.tsx`). Posizioni miste (alto/basso) e colori misti (verde/azzurro), con stili inline. `SaveBar` ridisegnata come barra **verde, in alto a destra, sticky**, con feedback **"✓ Salvato"** di conferma, e applicata in modo uniforme a Tags/Protocolli/Allarmi/Notifiche/Script/Datastore/Lingue; i save master-detail di Faceplate/Ricette ricolorati a verde. Aggiunto il feedback di conferma dove mancava (Datastore).

- **MQTT — payload oltre 10 KB rompevano browse e ricezione live** (`sws-runtime/crates/sws-plugin-mqtt/src/lib.rs`, `.../sparkplug.rs`). Nessuno dei client MQTT impostava `set_max_packet_size`, quindi restavano al default rumqttc di **10 KB**: un messaggio più grande (es. retained da 29 KB) faceva ritornare `Err` a `eventloop.poll()` e rompeva la connessione — la scansione broker finiva con 0 topic e la ricezione live si interrompeva. Aggiunta la costante `MAX_PACKET_SIZE_BYTES = 5 MB` applicata a tutti e tre i client (`connect` live, `browse`, Sparkplug).

- **Palette non aggiungeva oggetti in un progetto vuoto** (`sws-editor/src/store/index.ts`). `addObject` inseriva l'oggetto solo nella pagina `currentPageId`; in un progetto appena creato senza sinottici non c'è pagina corrente, quindi il click sulla palette non produceva nulla. Fix: se non esiste una pagina corrente valida, `addObject` ne crea una al volo (`Page 1`) con dentro l'oggetto.

- **Crash del pannello proprietà alla selezione di un oggetto (regressione T-40)** (`sws-editor/src/editor/EditorShell.tsx`). In `ObjectProps` un selettore Zustand `s.project?.languages?.entries?.map(...)` ritornava un nuovo array a ogni render → snapshot instabile → loop infinito ("Maximum update depth") che smontava l'albero React (pagina vuota) appena si selezionava un oggetto. Fix: selezionare l'array `entries` (riferimento stabile) e derivare le chiavi in `useMemo`.

- **Nuovo progetto vuoto mostrava il contenuto del progetto precedente (regressione T-40)** (`sws-editor/src/App.tsx`). Il mount-effect faceva `return` sui synoptic vuoti senza `setPages([], "")`, lasciando in memoria le pagine del progetto precedente. Fix: azzerare pagine (e faceplates) quando la lista è vuota.

- **Tema chiaro non applicato ai righelli del canvas e al pannello LOG** (`sws-editor/src/canvas/SvgCanvas.tsx`, `sws-editor/src/components/LogPanel.tsx`). Le strisce dei righelli e lo sfondo del pannello LOG usavano colori hardcoded del tema scuro (`#0f172a`, `#334155`, `#64748b`, `#0b1220`) invece delle CSS var `--brand-*`, quindi restavano scure anche col tema chiaro attivo; il testo — già tematizzato — risultava grigio a basso contrasto su quello sfondo scuro. Ora sfondo/bordo/tacche del righello e sfondo del pannello leggono `var(--brand-bg/surface/surface-2/text-muted)`; nel righello i `fill`/`stroke` sono stati spostati da attributi SVG a `style` inline così `var()` risolve in modo affidabile su tutti i browser. Corretto anche il colore del testo evidenziato `<mark>` nella ricerca log (fissato a `#0f172a`: lo sfondo giallo non cambia col tema, quindi il testo dev'essere scuro in entrambi). La superficie del canvas resta invariata: è lo sfondo pagina scelto nel progetto, dato utente, non chrome del tema.

- **Runtime installato non serviva il viewer operatori su :8443** (`deploy/generic-linux/sws-runtime-launch.sh`, `deploy/yocto/sws-runtime-launch.sh`). Entrambi i launch wrapper invocati da systemd non passavano `--viewer-port`/`--admin-port`, quindi un runtime installato partiva in **IDE-only** sulla sola porta admin 8444 e non legava mai il viewer su 8443 — pur avendo service unit e installer che pubblicizzano :8443. Aggiunti `--viewer-port 8443 --admin-port 8444` all'`exec`: un runtime installato serve ora sia il viewer operatori sia l'IDE admin.

- **Import progetto da ZIP non partiva dal menu** (GitHub issue #2, `sws-editor/src/App.tsx`). L'`<input type=file>` dell'import progetto viveva dentro il dropdown del MainMenu (`{open && …}`); il bottone "Importa progetto" fa `fileInputRef.current?.click(); setOpen(false)`, quindi la chiusura del menu smontava l'input mentre il file-dialog nativo era ancora aperto. Alla selezione del file l'`onChange` non scattava più e `handleImport` (con la `PUT /api/project/import`) non veniva mai eseguito: il sintomo segnalato — "variable definition and database are missing" dopo l'import — nasceva perché **l'import non partiva affatto** (il backend era corretto). Fix: l'`<input type=file>` e il toast di stato export/import vivono ora **fuori** dal dropdown, sempre montati. Regression test E2E `sws-editor/e2e/import-tags.spec.ts` (Playwright) che guida la UI reale.

- **Grid paste/cut in sub-celle** (`sws-editor/src/editor/EditorShell.tsx`). Ctrl+V e Ctrl+X gestiscono ora anche `selectedSubCell` (celle ottenute per divisione). Prima il paste/cut funzionava solo sulla cella top-level; le celle suddivise erano ignorate.

- **TagInput: pulsante ▾ esterno funzionante + dropdown con filtro** (`sws-editor/src/components/TagInput.tsx`). Riscrittura completa del componente: rimosso pattern `onBlur+setTimeout` (causava chiusura immediata per race con `autoFocus` sul filtro), sostituito con click-outside (`document.addEventListener("mousedown", ...)`). Aggiunto campo filtro nel dropdown. Rimosso `<datalist>` nativo (eliminata freccia browser interna). Fix applicato a tutti i campi tag del codebase.

- **"Valore live" in Configurazione → Variabili non si aggiornava** (`sws-editor/src/App.tsx`, `sws-editor/src/ws/tagStream.ts`). Doppio fix: (1) `useTagStream()` ora chiamato anche nella IDE SPA (`App.tsx`), non solo nel viewer; (2) `tagStream.ts`: il singleton `ReconnectingWs` ora viene ricreato quando cambia `remoteConnected` (diverso URL `/ws/remote/tags` vs `/ws/tags`) e invia `{"type":"subscribe","tags":["*"]}` all'apertura della connessione (richiesto dal relay remoto).

- **Auto-deploy al salvataggio** (`sws-editor/src/editor/EditorShell.tsx`, `sws-editor/src/App.tsx`, `sws-editor/src/store/index.ts`). Quando connesso a un runtime remoto, ogni salvataggio riuscito lancia automaticamente `POST /api/remote/deploy` in background. Il pulsante "Deploy" nell'header IDE mostra lo stato del sync: "⟳ Sync…" (in corso) / "✓ Synced" (ok, 3 s) / "✗ Sync err" (errore, 3 s). Nuovo campo `remoteDeployStatus: "idle"|"syncing"|"ok"|"error"` nello store Zustand.

### Added

- **Brand Pixsys white-label (T-38)** (`sws-editor/public/branding/pixsys/`, `active.json`). Nuovo brand `pixsys` che sfrutta l'infrastruttura white-label di T-35 e il tema chiaro/scuro di T-36: nessuna modifica al runtime Rust e nessun nuovo codice, solo asset statici + JSON. Colori presi dal logo ufficiale su pixsys.net — **accento `primary` = rosso Pixsys `#D2232A`** (`primaryHover #b01d23`); l'anello blu `#25408F` compare nel mark. `logo.svg` riproduce il mark autentico (asterisco rosso nell'anello ellittico blu) + wordmark "pixsys" reso in rosso così resta leggibile sia sul tema scuro (default) sia su quello chiaro (il logo è un `<img>`, non eredita `currentColor`); `favicon.svg` è il mark su tile bianco arrotondato. `document.title`/alt = "Pixsys — Elevate your process". `active.json` impostato su `pixsys` (brand attivo di default). I 7 token neutri del `brand.json` restano quelli SWS (vengono comunque sovrascritti dal tema; conta l'accento). `pnpm build` verde.

- **Build unico dei pacchetti distribuibili editor + runtime (T-37)** (`scripts/build_deploy.sh`, `deploy/editor/`, `deploy/yocto/install.sh`). Nuovo script che compila SPA e binario **una sola volta per architettura** e produce in `dist/` **quattro** tarball: `sws-runtime-<v>-linux-<arch>` (device, installer systemd) e `sws-editor-<v>-linux-<arch>` (IDE portabile "scompatta ed esegui"), per **host x86_64** e — quando il Pixsys Yocto SDK è presente — **aarch64** (cross-build via `scripts/yocto/build.sh` in sottoprocesso). Editor e runtime sono lo stesso binario `sws-runtime`: differiscono solo per il launcher/installer incluso. Il pacchetto **editor** porta `deploy/editor/run-editor.sh` (IDE-only su :8460, dati portabili in `./data/`, no root/systemd, no-auth come l'editor di sviluppo) + `README.md`. Il pacchetto **runtime aarch64** porta il nuovo `deploy/yocto/install.sh`, che installa sotto `/data/user/sws` (rootfs read-only dei device Pixsys, **non** `/opt`) con service systemd; il runtime x86_64 usa l'installer `deploy/generic-linux/`. Flag: `--host-only`, `--aarch64-only`, `--no-rust`, `--no-spa`, `--out DIR`. `scripts/package.sh` (usato dal backend T-28) resta invariato.

- **Branding / white-label dell'editor (T-35)** (`sws-editor/public/branding/`, `sws-editor/src/branding/index.ts`, entry point, HTML, sweep colori). L'editor e il viewer possono essere distribuiti sotto marchi diversi. Nuova cartella `public/branding/` con `active.json` (il file di configurazione: `{ "brand": "sws" }`) e una sottocartella per brand (`sws`, `acme`, `giorgino-giorgetti`), ognuna con `brand.json` (nome, logo, favicon, 10 token colore), `logo.svg`, `favicon.svg`. A boot (`admin-main.tsx`/`main.tsx`) `loadBranding()` risolve il brand attivo e `applyBranding()` imposta le CSS custom properties `--brand-*` su `:root`, il `document.title` e la favicon; fallback su SWS se i file mancano. Il logo compare in alto a sinistra nell'header IDE e nella nav del viewer. **Re-theme completo**: ~977 colori di chrome negli stili inline convertiti in `var(--brand-*, #fallback)`; i colori-dato degli oggetti canvas (fill/stroke/serie), il rendering dei widget e i colori di stato/allarme restano letterali (non brandizzati). Cambiare brand = editare `public/branding/active.json` e ricaricare, nessuna ricompilazione del frontend: `active.json`/`brand.json` sono fetchati con `cache: "no-store"` e gli script `start_editor.sh`/`start_runtime.sh` risincronizzano `public/branding/ → dist/branding/` a ogni avvio (`dist/` è ciò che l'app serve; Vite copia `public/` solo al build). **Nessuna modifica al runtime Rust** (gli asset sono serviti da `dist/branding/` via `ServeDir`).

- **Runtime mono-progetto: auto-apertura affidabile** (`sws-runtime/src/main.rs`, `sws-web/src/projects.rs`, `scripts/`). Al boot il runtime risolve il progetto da aprire in ordine: `--project` → marker persistente `.active-project` (scritto a ogni open, **non più consumato** come il vecchio `.last-opened`) → `.last-opened` legacy → unico progetto presente sotto `projects-root` (nuova `single_project_dir()`). Rimosso l'hardcoding del progetto `default` dagli script di avvio. Il marker viene ripulito quando il progetto puntato è eliminato. Risolve il caso "il runtime riparte dicendo che non c'è un progetto" pur essendoci un progetto su disco.

- **Versionamento progetto + avviso/aggiornamento** (`sws-core/src/project.rs`, `sws-web/src/system.rs`, `router.rs`, `sws-editor/src/App.tsx`, `client.ts`). Nuovo campo `Project.saved_by` che registra la versione del runtime (`CARGO_PKG_VERSION`) a ogni salvataggio; tutti i writer di `project.yaml` passano per `stamp_and_serialize()`/`save_to()`. `GET /api/system` espone `project_saved_by` + `project_needs_update`; nuovo endpoint `POST /api/project/migrate` (Admin) che ricarica il progetto attivo e lo ri-salva nel formato corrente. L'header IDE mostra un pulsante "⚠ Aggiorna progetto" quando la versione di salvataggio diverge da quella del runtime.

- **Elimina progetto sul runtime remoto** (`sws-web/src/remote.rs`, `router.rs`, `sws-editor/src/config/ConfigView.tsx`, `client.ts`). Nuovo relay `POST /api/remote/project/delete` (Admin): risolve il nome del progetto attivo dal `/api/system` del target, poi `close` + `DELETE`. Bottone rosso "Elimina progetto sul runtime" nel tab Runtime → Connetti.

### Changed

- **Deploy remoto sovrascrive tutto** (`sws-web/src/remote.rs`). `POST /api/remote/deploy` ora, prima dell'upload, elenca ed **elimina tutti** i progetti presenti sul runtime target (coerente col modello mono-progetto), non solo quello in conflitto sullo stesso nome.

- **Script di avvio ricostruiscono il frontend se stantio** (`scripts/start_editor.sh`, `scripts/start_runtime.sh`). Gli script ricompilavano sempre il backend ma servivano un `sws-editor/dist` eventualmente vecchio (causa: dopo un aggiornamento la SPA servita poteva essere quella precedente, es. mostrando il login dopo l'introduzione del no-auth). Ora eseguono `pnpm build` quando `dist/index-admin.html` manca o è più vecchio dei sorgenti in `sws-editor/src/`.

- **Server-side deploy relay** (`sws-web/src/remote.rs`, `router.rs`, `sws-editor/src/config/ConfigView.tsx`). `POST /api/remote/deploy`: il backend locale esporta il progetto attivo in ZIP, lo carica sul runtime remoto e lo attiva — tutto via reqwest `danger_accept_invalid_certs(true)`. Il browser non apre mai connessioni dirette al dispositivo remoto (no "Failed to fetch" per certificati self-signed). Il frontend legge un flusso newline-delimited di log di avanzamento. Supporto conflitto 409: close + delete vecchio progetto + retry upload automatici. Rimossa la vecchia `handleDeploy` da `RuntimeConnectionTab` che faceva fetch diretti dal browser.

- **No-auth mode frontend** (`sws-editor/src/App.tsx`). In assenza di utenti (nessun `users.yaml`), il server risponde 200 a `GET /api/auth/whoami` con un admin sintetico. Il frontend ora chiama `whoami()` al bootstrap e dopo `onProjectOpened` prima di aggiornare lo stato auth: se risponde 200 setta il token sentinella `"no-auth"` (ignorato dal backend), evitando il flash di LoginScreen. Flag `bootstrapping` aggiunto per non mostrare nulla durante il round-trip iniziale.

- **WebSocket remote bridge — IDE↔Runtime real-time relay** (`sws-web/src/remote.rs`, `remote_relay.rs`, `router.rs`, `sws-editor/src/api/client.ts`, `store/index.ts`, `ws/wsUrl.ts`, `config/ConfigView.tsx`). Canale real-time tra l'IDE e il runtime remoto tramite relay server-side: il runtime locale autentica il dispositivo remoto (`POST /api/remote/connect`) e poi fa da proxy ai WebSocket `/ws/{tags,alarms,logs}` tramite `/ws/remote/{sub}` (tokio-tungstenite, pipe bidirezionale). Il browser non apre mai connessioni cross-origin (no CORS, no self-signed cert rejected). Target `wss://` gestiti con `AcceptAnyCert` rustls verifier (PoC/LAN trusted). Frontend: `buildWsUrl()` restituisce `/ws/remote/{sub}` quando `remoteConnected`; `RuntimeConnectionTab` usa `api.remoteConnect()` invece di fetch diretti al device; poll `remoteStatus` ogni 5 s; pannello variabili live (max 50 tag, snapshot+delta a 50 ms).

- **TLS opzionale — HTTP di default, HTTPS su richiesta** (`main.rs`, `sws-web/src/system.rs`, `router.rs`, `ConfigView.tsx`, `client.ts`, `scripts/`). Il runtime parte in HTTP plain se manca `config/tls.crt`; la presenza del certificato all'avvio determina la modalità (accept loop su `Option<TlsAcceptor>`, percorso plain con `serve_connection_with_upgrades` così i WebSocket funzionano anche senza TLS). Niente flag `--no-tls`. Endpoint admin-only: `GET /api/system/tls`, `POST /api/system/tls/generate` (self-signed rcgen), **`PUT /api/system/tls` (carica cert+key PEM, validati con `with_single_cert` prima di scrivere)**, `DELETE /api/system/tls`; ogni cambio riavvia il runtime (`system_reboot`, stesso argv, riapre il progetto). UI in `Configurazione → Stato → Certificato TLS` (Admin): genera self-signed / carica cert+key / disabilita. Script: `--http-port` (companion accettazione cert) ora condizionale alla presenza del cert. Backward-compatible: installazioni con cert esistente restano in HTTPS. ⚠️ in modalità HTTP login e pannello admin viaggiano in chiaro — attivare il TLS per device in campo.

### Removed

- **Pulizia file-istruzioni obsoleti** — rimossi i prompt di task ormai completati (`T-21-prompt.md`, `T-27`…`T-33-prompt.md`), il prompt di bootstrap iniziale (`SWS_Repository_Bootstrap_Prompt.md`, scaffolding già eseguito) e il piano stantio `docs/plans/2026-05-14_universal_binding.md` (feature di binding già consegnata). Verificato che ogni file descriveva lavoro già implementato — nessun task pendente perso (recuperabili da git history). I task ancora aperti sono ora tracciati in un'unica checklist `## Remaining tasks` in `STATUS.md`.

### Added

- **HTTP companion server per accettazione certificato TLS** (`sws-runtime/src/main.rs`, `scripts/`). Nuovo flag `--http-port` sul binario: quando specificato avvia un server plain HTTP (no TLS) con una pagina guida all'accettazione del certificato self-signed. Opzione A: campo URL copiabile con pulsante "Copia" + polling JS che rileva l'accettazione e reindirizza automaticamente all'IDE. Opzione B: route `/cert` serve il file `tls.crt` con MIME `application/x-x509-ca-cert` per download e installazione permanente nel browser. `start_runtime.sh` usa porta 8080, `start_editor.sh` usa porta 8090.

### Changed

- **Porte editor separate dal runtime**: `start_editor.sh` usa admin 8460 + HTTP 8090 (invece di 8444 + 8080), eliminando i conflitti di porta quando editor e runtime girano sulla stessa macchina di sviluppo.
- **`cargo build -j 1`** in `start_runtime.sh` e `start_editor.sh` per evitare OOM killer su macchine con poca RAM (pyo3 + linking Rust sono molto pesanti in parallelo).
- **Split dev.sh → start_runtime.sh + start_editor.sh** (`scripts/`, `sws-runtime/src/main.rs`, `CLAUDE.md`, `docs/CONTEXT.md`, `docs/TEST_SETUPS.md`, `scripts/README.md`). `dev.sh` eliminato. Due script separati con ruoli chiari: `start_runtime.sh` avvia il runtime sul dispositivo (viewer 8443 + IDE/admin 8444, auto-apre progetto `default`); `start_editor.sh` avvia solo la porta IDE 8444 sul PC sviluppatore (nessun viewer, deploy via "Connetti runtime"). Rust: `--viewer-port` reso `Option<u16>` — se omesso il viewer listener non viene avviato (IDE-only mode, accept loop usa `std::future::pending()` per il ramo inattivo). mDNS, kiosk-browser e kiosk-wayland ignorati se `--viewer-port` non è specificato.

### Added

- **T-29…T-33 — 5 nuovi widget canvas** (`SvgCanvas.tsx`, `EditorShell.tsx`, `LeftPanel.tsx`, `types/index.ts`). **T-31 Text List**: widget testo dinamico basato su lookup-table (`text_list_entries`); confronto `==` per gestire valori YAML deserializzati. **T-29 Bar Chart**: SVG puro, verticale/orizzontale, n serie (`bar_series[]`) con min/max per serie, linee soglia warn/alarm trattegiate, gap configurabile. **T-33 Pie/Donut Chart**: SVG con path archi trigonometrici; modalità `pie`/`donut`, raggio interno, percentuali su slice > 5%, testo/tag al centro del donut, legenda opzionale a 2 colonne. **T-32 Sparkline**: mini-trend SVG in `foreignObject`; accumula campioni in stato React locale, finestra mobile configurabile, fill area, mostra ultimo valore; placeholder statico in edit mode. **T-30 Alarm Viewer**: `foreignObject` React; legge `store.alarms` (popolato da WebSocket `/ws/alarms`); filtra per prefisso ID e/o severità; modalità lista (righe colorate per severità, timestamp, ACK Operator+) e banner (CSS `@keyframes marquee`). Tutti i widget: palette LeftPanel (gruppo Display), `handleAddObject` con valori default, pannello proprietà EditorShell. Nessuna modifica backend.

- **T-28 — IDE Package Builder + SSH Device Deployer** (`packaging.rs`, `router.rs`, `ConfigView.tsx`, `client.ts`, `types/index.ts`). Backend: `POST /api/build/package` (Admin) — avvia `scripts/package.sh` in background, streamma stdout+stderr come `text/plain` chunked; mutex globale impedisce build concorrenti; flags `{no_rust, no_spa}`. `GET /api/build/packages` — lista `dist/*.tar.gz` con `size_bytes` e `mtime_ms`, ordinati per data. `POST /api/deploy/device` — SCP tarball + SSH extract + `sudo install.sh` + health-check; usa `sshpass` se disponibile, fallback key-based. `AppState`: `+build_running: Arc<Mutex<bool>>`, `+repo_root: Arc<Option<PathBuf>>` (risolto al boot, `None` su device senza toolchain). Frontend: due sezioni in `RuntimeConnectionTab` — "Pacchetto runtime" con 3 pulsanti (Build completo / Solo UI / Solo Rust), log box streaming 150px, lista tarball selezionabili con dimensione e data; "Installa su dispositivo" (visibile con ≥1 tarball) con form SSH (host, porta, utente, password, cartella tmp), pulsante Deploy, log streaming.

- **T-27 — Generic Linux standalone packaging** (`scripts/package.sh`, `deploy/generic-linux/`). `scripts/package.sh`: build release binario (cargo) + SPA (pnpm) + staging in `dist/sws-<version>-linux-<arch>.tar.gz`; flag `--no-rust` e `--no-spa` per build incrementali. Tarball include: `bin/sws-runtime`, `bin/sws-runtime-launch.sh`, `www/` (SPA assets), `templates/` (esempi), `install.sh`, `sws-runtime.service`. `deploy/generic-linux/install.sh`: installa/aggiorna/disinstalla (`--uninstall`); paths `/opt/sws/` (binario+assets, read-only), `/var/lib/sws/` (dati persistenti), `/etc/sws/runtime.env` (credenziali con chmod 600, solo primo install); fa health-check dopo start; stampa URLs con IP LAN reale. `sws-runtime-launch.sh`: sourca `/etc/sws/runtime.env`, default credenziali, exec binario con path standard. `sws-runtime.service`: unit systemd con `After=network-online.target`, restart on-failure 5s.

- **Pipe / tubazione canvas** (carry-over da sessione precedente, ora committato). Nuovo tipo oggetto `"pipe"` nel canvas: path SVG multi-waypoint con stili `flat` / `tube` / `wire`, livello fill animabile, label al midpoint. `PipePoint { x, y }` in `types/index.ts`. `SvgCanvas.tsx`: rendering pipe (bezier/straight), drag uniforme di tutti i waypoint. `EditorShell.tsx`: `case "pipe"` in `handleAddObject` (3 waypoint di default). `LeftPanel.tsx`: voce "Tubazione ⋯" nel gruppo SCADA della palette.

- **T-26 — Git commit/push dall'IDE** (`git_deploy.rs`, `router.rs`, `ConfigView.tsx`, `client.ts`, `types/index.ts`). Nuovi metodi `GitDeploy`: `commit(message)` (git add -A + git commit -m), `push()` (git push, unisce stdout+stderr perché git push scrive progress su stderr), `unpushed_count()` (git rev-list HEAD ^@{upstream} --count, 0 se errore). `GitStatus.unpushed_commits: u32` calcolato a ogni `GET /api/project/git-status`. Route `POST /api/project/git/commit` (Supervisor+, body `{message}`), `POST /api/project/git/push` (Admin). Frontend: form inline "💾 Commit" con input messaggio + Salva/Annulla; bottone "↑ Push (N)" (visibile se remote_url definito, N = commit non pushati, nascosto se N=0 e no remote); output in `opMsg`. API client: `commitProject(message)`, `pushProject()`.

- **T-25 — Remote log viewer** (`ConfigView.tsx`). In `RuntimeConnectionTab`, quando connesso: sezione "Log remoti" con bottone "Aggiorna" (fetch one-shot) e toggle "● Live" (polling ogni 5 s via setInterval). `fetchRemoteLogs()`: login → `GET /api/logs` con Bearer token. Auto-stop e reset su disconnessione. Log box scrollabile 200 px, color-coded: INFO `#94a3b8`, WARN `#fb923c`, ERROR `#f87171`, DEBUG `#475569`. Timestamp `HH:MM:SS` via `toLocaleTimeString("it-IT")`.

- **T-24 — Project fingerprint SHA256 + Device Dashboard** (`router.rs`, `sws-web/Cargo.toml`, `sws-runtime/Cargo.toml`, `ConfigView.tsx`, `store/index.ts`, `types/index.ts`). `GET /api/project/fingerprint` su entrambe le porte (8443 e 8444): SHA256 deterministico di `project.yaml` + tutti i file in `synoptics/*.yaml` ordinati per nome, eseguito in `spawn_blocking`. Dipendenza `sha2 = "0.10"` aggiunta al workspace. Risposta: `{sha256: string, computed_at_ms: number}`. Nuovo tab "Device" (Admin-only) in ConfigView: lista device persistita in localStorage (`sws.saved-devices`), auto-refresh ogni 30 s, per ogni device: ping `/health` (AbortSignal 3 s) + login + `GET /api/project/fingerprint` (5 s); confronto con fingerprint locale. Tabella: Label | URL | Stato | Firma (✓ in sync / ✗ diff. versione / ? n/d) | Azioni (Connetti, Deploy, ✕). Form "aggiungi device" sotto la tabella. `deployToTarget()` estratto come funzione standalone condivisa tra `RuntimeConnectionTab` e `DevicesTab`. `AppConfigTab` e `ConfigTab` aggiornati per includere `"devices"`.

- **T-23 — mDNS network discovery** (`sws-web/src/discover.rs`, `sws-runtime/src/main.rs`, `ConfigView.tsx`, `client.ts`). Runtime annuncia `_sws._tcp.local.` al boot via mdns-sd (pure Rust, no avahi); proprietà TXT: `admin_port`, `version`. ServiceDaemon tenuto vivo finché il processo gira. Nuovo handler `GET /api/discover` (Supervisor+, porta 8444): browsa mDNS per 2 s in `spawn_blocking`, restituisce `[{name, admin_url, viewer_url, version}]`. Frontend: bottone "Cerca runtime" in `RuntimeConnectionTab` → lista cliccabile dei device trovati → click popola il campo URL target.

- **T-22 — Dev UX: banner TTL sessione + dev.sh multi-istanza** (`App.tsx`, `ConfigView.tsx`, `scripts/dev.sh`, `sws-runtime/src/main.rs`). Banner nel header IDE: compare se `session_ttl_secs > 0` dopo login Admin/Supervisor; bottone "Disattiva" azzera il TTL per la durata dello sviluppo. Pre-deploy warning: se TTL = 0 chiede conferma per riabilitarlo (1 h) prima di deployare. `dev.sh --instance N`: porte VIEWER=8443+(N-1)×2, ADMIN=8444+(N-1)×2, VITE=5173+(N-1), data dir `.run-N/`; `stop_existing()` usa `fuser` per killare solo i processi sulle porte proprie senza toccare le altre istanze. CLI args `--viewer-port`/`--admin-port` sul binario `sws-runtime`.

- **Doc revision** (piano Claude). Tutti i file `docs/` allineati allo stato post T-01…T-21: `CONTEXT.md` (§3 struttura crate, §4 fasi tutte ✅, §5 plugin compiled-in, §6 ABAC in scope, §7 protocolli ✅), `OPEN_QUESTIONS.md` (Q2/Q3/Q4/Q6 decise), `TEST_SETUPS.md` (architettura dual-port 8443/8444, dev.sh flusso tipico), `DEPLOY_PX30.md` (nota legacy container, URL 8444/8443 corretti), `YOCTO_CROSSCOMPILE.md` (health dual-port), `SWS_Project_Specification.md` (box PoC status), `adr/0001-state-management.md` (stato Accepted: Zustand).

- **T-21 (completo, tutti gli 8 subtask) — Split runtime / admin webserver**: porta 8443 (sinottici, accesso anonimo read-only via `optional_auth`) + porta 8444 (admin, tutte le rotte, autenticazione richiesta). Due `TcpListener` nello stesso processo condividono `AppState` e TLS. `--kiosk` flag: porta 8443 si binda a `127.0.0.1` (solo browser locale). `vite.config.ts`: proxy di default su 8444. Tab "Runtime View" rimossa dall'editor (solo "Editor" + "Configurazione" rimangono). `ButtonAction` enum (`login`/`logout`/`navigate`) aggiunto a `SynopticObject`, pannello proprietà "Azione built-in" nel pulsante, `onButtonAction` prop in `SvgCanvas`. Admin SPA: secondo Vite entry point `index-admin.html` → `AdminApp.tsx` (WelcomeScreen + Login + ConfigView; AccessDenied per ruoli Operator/Viewer). Admin router (8444) serve `index-admin.html` come fallback SPA. Deploy remoto: `POST /api/deploy/remote` (admin-only) in `deploy.rs` — scarica binario da GitHub Releases, SCP + restart systemd, streaming log; tab "Deploy binario" in `RemoteRuntimeModal` con arch selector, SSH credentials (save localStorage). `deploy/yocto/sws-kiosk.service` systemd unit per kiosk browser. Branch: `feat/T-21-split-webservers` (non ancora mergiato su main — richiede verifica maintainer).

- **Image widget library browser** (`ImageBrowser.tsx`, `scripts/fetch-image-catalog.sh`, `scripts/gen-catalog.js`, `sws-editor/public/images/`). 221 SVG da 4 librerie open-source: Material Design Icons (Apache 2.0, 68 file), Equinor Engineering Symbols (MIT, 63 file), Tabler Icons (MIT, 48 file), Electrical Symbol Library (CC0, 42 file). Catalogo statico `catalog.json` generato da script Node. Componente `ImageBrowser` a griglia con tab categoria, filtro full-text, preview SVG lazy; usa `createPortal` per sfuggire da stacking context del pannello. Pulsante ⋯ nel pannello proprietà image + anteprima SVG inline sotto il campo URL. Documentazione licenze in `third-party/` con testi completi Apache-2.0/MIT/CC0.

- **Per-project historian isolation** (`projects.rs`, `backups.rs`, `scripts/dev.sh`). Ogni progetto ora registra la storia nel proprio `<project>/.history/historian.db` invece di un SQLite globale condiviso. `create_project` scrive sempre un `datastores: [{id: "default", path: ".history/historian.db"}]` nel progetto vuoto. `open_project` inietta retroattivamente il datastore di default per progetti legacy (`datastores: []`) e aggiorna `project.yaml` su disco. `BACKED_UP` allargato a `.history` e `recipes`: i backup sono ora ripristinabili su qualsiasi host inclusi i dati storici. `SWS_HISTORIAN_DB` commentato in `dev.sh` — il fallback globale non è più necessario.

### Fixed
- **Campi Tag duplicati** nel pannello proprietà editor: il campo generico "Tag" (riga 1719 EditorShell) viene ora nascosto per i tipi gauge/slider/checkbox/radio/led/progress_bar/trend che hanno già il proprio campo Tag nella sezione specifica.

- **TagInput picker** (`TagInput.tsx`): aggiunto pulsante ▾ con dropdown filtrable per selezionare un tag tra quelli definiti in Variabili. Dropdown chiuso con Escape/blur, `onMouseDown preventDefault` sul container per evitare perdita focus dell'input principale.

- **"Forme → Immagine" non faceva nulla**: aggiunto `case "image":` in `handleAddObject` switch di EditorShell; ora apre `ImageBrowser` per scegliere l'immagine prima di piazzare l'oggetto sul canvas.

### Added
- **Save confirmation dialog** (`App.tsx`, `store/index.ts`, `EditorShell.tsx`). `isDirty: boolean` state in Zustand (set `true` on any canvas mutation via `pushHistory`/`pushHistoryUnconditional`, `false` on `setPages` load or successful save). `handleCloseProject` and `handleLogout` now check `isDirty` before executing; if dirty, they open a modal overlay with "Salva e chiudi" (triggers `incSaveSerial` + waits for `isDirty → false` via `useEffect`), "Chiudi senza salvare" (execute immediately), "Annulla". If save fails (`saveStatus === "error"`), the dialog closes without closing the project so the user can see the error.

- **RuntimeCtrl header widget** (`App.tsx`, `system.rs`, `router.rs`, `source_supervisor.rs`, `api/client.ts`). Admin/Supervisor-only UI in the app header: green/red status dot polling `GET /api/system` every 5s (`sources_running`). "Stop" / "Start" toggle calls `POST /api/system/stop` (stops all source plugins + global-script + notification supervisors; web server stays up) or `POST /api/system/start` (reloads project from disk and restarts acquisition). "Reboot" button calls `POST /api/system/reboot` after a native confirm dialog — replaces the process image via Unix `exec()` (~2s WebSocket reconnect gap). Once installed on a device, the runtime never needs CLI access.

- **T-20 — GitOps: deploy versioned da repository Git** (`sws-web/git_deploy.rs`, `sws-web/router.rs`, `sws-web/lib.rs`, `ConfigView.tsx`, `types/index.ts`, `client.ts`). Nuovo modulo `git_deploy.rs`: struct `GitDeploy` con metodi `is_git_repo`, `status` (sha, author, message, commit_date, branch, remote_url, clean), `pull` (git pull --ff-only), `rollback` (git reset --hard HEAD~1), `init_remote`. Tutti i comandi via `std::process::Command` (nessuna dipendenza C libgit2). Tre rotte HTTP: `GET /api/project/git-status` (autenticati, ritorna `GitStatus` o 404 se non git repo), `POST /api/project/deploy` (operator+, git pull + soft-reload), `POST /api/project/rollback` (admin, git reset + soft-reload). `soft_reload_project`: ricarica project.yaml e aggiorna derived_tags/tags/alarms/functions inline senza riavviare sorgenti né cancellare historian. Frontend: `GitOpsPanel` nel tab Sistema — mostra branch, sha, autore, messaggio, badge "clean/modificato", pulsanti "Deploy (git pull)" e "Rollback (HEAD~1)" con confirm dialog. API client: `getGitStatus`, `triggerDeploy`, `triggerRollback`. Il pannello è invisibile se il progetto non è in un git repo (404 silenzioso).

- **T-19 — Mobile / PWA + layout responsive** (`index.html`, `public/manifest.webmanifest`, `public/sw.js`, `public/icon-192.svg`, `App.tsx`, `SvgCanvas.tsx`, `RuntimeView.tsx`). PWA manifest (`manifest.webmanifest`) con nome, icona SVG, display standalone, colori tema. Service worker (`sw.js`): cache-first per asset statici, network-only per `/api` e `/ws`. SW registrato via inline script in index.html. Breakpoint mobile (<768px): `isMobile = matchMedia("(max-width: 767px)")` con listener, forza `effectiveMode = "view"` e rimuove bottoni editor/config dalla toolbar. SvgCanvas: `viewBox` + `preserveAspectRatio="xMidYMid meet"` in runtime mode quando `pageWidth`/`pageHeight` sono definiti → fit-to-viewport automatico su mobile. RuntimeView: touch swipe left/right con threshold 50px per navigazione tra pagine.

- **T-17 — Tag subscription per-pagina** (`ws/tagStream.ts`, `RuntimeView.tsx`). Al cambio pagina in RuntimeView, `sendSubscribe(pageTagIds)` manda al server la lista dei tag referenziati dagli oggetti canvas (tag, value_tag, min_tag, max_tag, pens[].tag). Il server aggiorna il filtro per quella connessione e invia snapshot fresco con i soli tag richiesti; i delta successivi includono solo tag nella subscription. Subscribe con lista vuota = tutti i tag (fallback compatibile). I tag per la subscription vengono estratti dinamicamente dagli oggetti SynopticPage al cambio pagina.

- **T-16 — WebSocket ottimizzato: delta batching** (`router.rs`, `ws/tagStream.ts`). Protocollo WS v2: `{type:"snapshot",tags:[...],seq}` all'avvio e re-subscribe; `{type:"delta",changed:[...],seq}` per aggiornamenti live; `{type:"subscribe",tags:[...]}` dal client. Delta batcher: buffer HashMap 50ms (tokio interval), flush solo se pending non vuoto, filtra per subscription attiva. Seq counter monotono per-connessione per rilevare frame persi (log warning frontend). Write/Ack invariati. `WsTagEntry {id,value,quality,ts}` condivisa da snapshot e delta. Aggiornamenti da 1 frame/tag → 1 frame/50ms per tutti i tag cambiati. Backward compatible con qualsiasi client che implementi il nuovo protocollo.

- **T-14 — Area/page security (ABAC zone-based)** (`sws-web/synoptic.rs`, `sws-auth/src/lib.rs`, `sws-web/router.rs`, `EditorShell.tsx`, `ConfigView.tsx`, `types/index.ts`, `client.ts`). `SynopticPage.zones: Option<Vec<String>>` — zona assegnata a una pagina; se presente, solo utenti con `allowed_zones` compatibili possono vederla. `StoredUser.allowed_zones`, propagato in `UserSummary`, `CreateUser`, `UserPatch`. `SessionInfo.allowed_zones` → `AuthUser.allowed_zones` in ogni request via middleware. Helper `zone_allowed(user_zones, page_zones)`: utente senza zone vede tutto; pagina senza zone visibile a tutti; altrimenti intersezione. `list_synoptics` filtra i nomi letti dal filesystem; `get_synoptic` ritorna 403 se zona non consentita. Frontend: campo "Zone" in Users tab (patch live via PUT), campo "Zone" in PageProps editor (comma-separated → string[]). Backward compatible: users.yaml esistente (nessun campo zones) e synoptic YAML esistenti funzionano senza modifiche.

- **T-13 — Notifiche email SMTP + escalation allarmi** (`sws-core/project.rs`, `sws-web/notifications.rs`, `sws-web/router.rs`, `sws-web/projects.rs`, `ConfigView.tsx`, `types/index.ts`, `client.ts`). `SmtpConfig` (host, port, from, username, password, starttls) e `NotificationConfig` in project.rs. `NotificationSupervisor`: Task A sottoscrive broadcast AlarmDb, invia email a `notify_email` su transizione ActiveUnacked (via lettre 0.11 STARTTLS/relay, sync in spawn_blocking); Task B ogni 60s scansiona snapshot, invia escalation a `escalate_to` dopo `escalate_after_s` con dedup `(alarm_id, activated_at_ms)`. Ciclo di vita: avviato in `open_project` se `project.notifications.smtp` presente, fermato in `close_project`. `PUT /api/project/notifications` con hot-swap supervisor e preservazione password mascherata. SMTP password mascherata in `GET /api/project`. Frontend: `NotificationsTab` (enable toggle, form SMTP host/porta/from/user/pass/starttls), `notify_email` e `escalate_after_s`/`escalate_to` nel form allarmi (tab Allarmi). `SmtpConfig`/`NotificationConfig` aggiunti a types/index.ts e `AlarmDef` esteso con i campi email.

- **T-11 — Recipe Manager (ISA-88 base)** (`sws-web/recipe.rs`, `sws-web/router.rs`, `sws-web/projects.rs`, `client.ts`, `ConfigView.tsx`, `RuntimeView.tsx`). `RecipeDef` (id, name, setpoints: [{tag, value}]) serializzato come YAML in `<project>/recipes/<id>.yaml`. CRUD API: `GET /api/recipes` (lista con setpoints_count), `GET/PUT/DELETE /api/recipes/:id`, `POST /api/recipes/:id/apply` (scrittura atomica via TagWriteBus + log in-memory con applied_by e timestamp). Frontend: `RecipesTab` in ConfigView (pannello lista 220px + editor setpoint con TagInput), `RecipeModal` in RuntimeView (pulsante "⚗ Ricette" nella barra strumenti, lista ricette, pulsante Applica con feedback).

- **T-10 — Alarm multi-condizione + delay + inhibit** (`sws-core/alarm.rs`, `sws-core/project.rs`, `ConfigView.tsx`, `types/index.ts`). `AlarmCondition` estesa con varianti composite `And { conditions }`, `Or { conditions }`, `Not { condition }` con `evaluate()` / `evaluate_clear()` semanticamente corretti (And→any child clears, Or→all children clear, Not→child.evaluate). `on_delay_s` / `off_delay_s`: `AlarmTimer` traccia `condition_true_since_ms` / `condition_false_since_ms`, reset al cambio direzione. `inhibit_tag`: mappa `by_inhibit_tag`, cache `inhibit_values` (aggiornata PRIMA del check), re-evaluation con `last_value` cached al cambio inhibit. 9 unit test verdi (inclusi and/or/not, on_delay, off_delay, inhibit). UI: form allarmi con on_delay/off_delay side-by-side, TagInput inhibit_tag. Backward compatible: YAML esistente funziona senza modifiche.

- **T-04 — Faceplates: componenti parametrici riusabili** (`sws-core/project.rs`, `sws-web/synoptic.rs`, `sws-web/router.rs`, `SvgCanvas.tsx`, `ConfigView.tsx`, `store/index.ts`, `App.tsx`). `FaceplateDef` (id, label, params, objects) salvato in `synoptics/faceplates/` o come built-in embedded (include_str!). CRUD API `/api/faceplates/:id` (GET list, GET single, PUT, DELETE) con fallback automatico ai built-in se non esiste versione progetto. Tre faceplate built-in: `motor_basic` (pompa/motore con LED stato, pulsanti START/STOP), `valve_basic` (valvola con LED aperto/chiuso, pulsanti Open/Close), `tank_level` (serbatoio con barra livello verticale, valore %, LED alarm_high). Rendering in SvgCanvas: edit mode = rect tratteggiato con label; view mode = `<g translate>` con istanze ricorsive SvgObject dopo sostituzione `{param}`. Frontend: `FaceplatesTab` in ConfigView (lista a sinistra, editor JSON objects a destra), `faceplates` state in store, caricamento al project open.

- **T-08 — Sparkplug B su MQTT** (`sws-plugin-mqtt/src/sparkplug.rs`, `sws-core/project.rs`, `ConfigView.tsx`). Estensione `sws-plugin-mqtt` con `mode: sparkplug_b`. Struct prost manuali (`#[derive(prost::Message)]`) senza protoc o build.rs. Decode completo: NBIRTH/NDATA (metriche nodo), DBIRTH/DDATA (metriche device), NDEATH/DDEATH → qualità Bad. SCADA Host STATE birth (bdSeq 0, Online=true) + LWT (Will). NCMD write-back: pubblica NCMD con metrica specificata verso nodo target. Gestione reconnect con backoff 5s. `SparkplugConfig { group_id, host_id, metrics: [metric_name → tag SWS, writable] }` in MqttConfig. Frontend: `SparkplugSection` collassabile in `MqttSourceCard`, sezione topic standard nascosta quando sparkplug attivo. Template `examples/templates/sparkplug-demo/`.

- **T-07 — Plugin EtherNet/IP (CIP/Allen-Bradley)** (`sws-plugin-enip/`, `sws-core/project.rs`, `ConfigView.tsx`). Nuovo crate `sws-plugin-enip` con `rseip = "0.3.1"`. Accesso ai tag ControlLogix per nome simbolico via `EPath::from_symbol()`. Tipi supportati: BOOL, SINT, INT, DINT, LINT, REAL (no LREAL — non esposto da rseip). Write-back per tag configurati come `writable: true`. `EnIpConfig { ip, slot, poll_interval_ms, tags: [EnIpTagMapping] }` in sws-core. `EnIpSourceCard` in ConfigView con tabella tag, tipo selector, nome PLC simbolico. Template `examples/templates/enip-demo/`.

- **T-06 — Plugin S7 / Siemens PLC** (`sws-plugin-s7/`, `sws-core/project.rs`, `source_supervisor.rs`, `ConfigView.tsx`). Nuovo crate `sws-plugin-s7` con comunicazione S7 ISO-on-TCP via crate `s7 = "0.1.9"` (pure Rust, nessuna dipendenza C/snap7). Il client S7 non è `Send`; usa un bridge `std::thread` con canali sincroni, pilotato da un tokio task. Aree supportate: DB, M (Merker), I (input), Q (output). Tipi: BOOL (con bit_offset), BYTE, INT (16-bit signed), WORD (16-bit unsigned), DINT (32-bit signed), REAL (32-bit IEEE float). Write-back configurabile per tag. Frontend: `S7SourceCard` in ConfigView con form campi IP/rack/slot/poll + tabella tag con area selector, DB number, byte offset, tipo, bit offset (per BOOL), write-back checkbox, quick-create variabile. Template `examples/templates/s7-demo/`.

- **T-09 — Script globali + scheduler** (`sws-core/project.rs`, `sws-web/global_scripts.rs`, `router.rs`, `ConfigView.tsx`). Nuovo tipo `GlobalScriptDef` nel project.yaml con 4 trigger: `startup` (una volta all'avvio), `interval` (ogni N secondi), `cron` (espressione 5-field, parser UTC integrato senza deps), `tag_change` (edge rising/falling/any su un tag). Backend: supervisor `GlobalScriptSupervisor` con un tokio task per script; hot-swap su `open_project`/`close_project`; `PUT /api/project/global-scripts` per aggiornamento live. Frontend: nuovo tab "Script" in ConfigView — lista script, form trigger dinamico, editor Python CodeMirror, pulsante Salva con hot-reload immediato. Tutti gli script hanno accesso all'API `tags` (read/write) via pyscript engine.

- **T-05 — Tag Manager: CSV import + export** (`router.rs`, `ConfigView.tsx`, `client.ts`). Backend: `POST /api/project/tags/import-csv` accepts plain-text CSV with header row; merges imported tags into the live project (upsert by ID, unmentioned tags preserved); seeds new tags into TagDb live. Frontend: "Esporta CSV" button downloads all current tags as `tags.csv`; "Importa CSV" button opens a modal with file-picker or paste area, confirmation, and result feedback. Supported CSV columns: `id` (required), `data_type`, `description`, `history`, `expression`.

- **T-03 — Alarm ISA-18.2: 4-state machine + journal** (`sws-core/alarm.rs`, `sws-historian/sqlite.rs`, `AlarmBanner.tsx`, `AlarmHistory.tsx`, `RuntimeView.tsx`). Replaced 2-state `active`+`acknowledged` booleans with ISA-18.2 `isa_state` enum: `Normal → ActiveUnacked → ActiveAcked → Normal` (clean path) and `ActiveUnacked → NormalUnacked → Normal` (normalize-before-ack path). Each alarm activation creates an `AlarmEvent` (alarm_id, message, severity, ts_activated, ts_acked, ts_normalized, duration_s, acked_by); events persisted to SQLite `alarm_events` table via journal callback. New `GET /api/alarms/history` endpoint with optional `alarm_id`/`from_ms`/`to_ms`/`limit` filters. `AlarmBanner` updated with ISA state label and blink animation for `ActiveUnacked`. `AlarmPanel` in RuntimeView gains "Attivi" / "Storico" tabs with paginated `AlarmHistory`.

- **T-01 — Symbol picker at placement time** (`EditorShell.tsx`). Clicking "Simbolo" in the object palette now opens `SymbolPickerModal` — a full gallery with preview of all built-in and vendored symbols — before the object is placed. The symbol ID chosen by the user is used directly; no more forced "pump" default.

- **T-02 — Interactive trend with historical mode** (`TrendCanvas.tsx`, `TrendExpanded.tsx`, `SvgCanvas.tsx`). `TrendCanvas` extended with `fromMs`/`toMs` props for explicit historical range (polling disabled), `hiddenIndices` for per-series visibility, and fixed dependency array + CSV export range in historical mode. New `TrendExpandedModal` component: range presets (Live / 1h / 8h / 24h / 7d), pan ◀ ▶ buttons, per-series toggle buttons, ResizeObserver-based canvas auto-sizing. A small expand button (⤢) appears on each trend widget in RuntimeView and opens the modal on click.

- **Template `homeassistant-pro`: 6 pagine sinottiche** (`examples/templates/homeassistant-pro/synoptics/`). Showcase completo di tutte le funzionalità SCADA di SWS: **Panoramica** (flusso energia FV→batt→casa→rete, tabella clima 5 stanze, LED sicurezza, luci/tapparelle status, presenza persona); **Fotovoltaico** (gauge V+A per stringa, potenza totale, produzione oggi/lifetime, trend correnti stringhe multi-tag, temperature inverter, autoconsumo%); **Batteria & Rete** (gauge SoC, corrente/tensione/potenza batteria, indicatore in-carica/scarica, V+A+Hz+kW rete, acquisto/vendita kW derivati, trend SoC+tensione rete); **Clima** (tabella 5 stanze T+U con barre, gauge temperatura media, comfort index, trend 3 stanze su finestra 2h); **Carichi** (cucina W/V/A/Hz/kWh con gauge, pompa calore W/V/A/kWh, KPI energetici nella top bar, trend potenze multi-carico); **Sicurezza & Ctrl** (LED porte/finestre/perimetro/movimento, pulsanti ON/OFF write-back per 3 luci esterne switch HA, pulsanti SÙ/GIÙ write-back per 4 tapparelle cover HA, presenza persona+sole). Sinottici copiati anche in `.run/projects/ha/synoptics/`.

### Fixed
- **Project isolation: race condition TagDb/Supervisor** (`sws-web/src/projects.rs`). In `open_project` e `close_project`, `db.clear()` veniva chiamato PRIMA di `supervisor.reload(vec![])`. I plugin (es. MQTT) avevano una finestra di 2 secondi durante cui potevano ancora scrivere su un TagDb già svuotato, inquinando il progetto successivo. Fix: invertito l'ordine — `supervisor.reload` ora precede `db.clear`, garantendo che nessun plugin sia in esecuzione quando il db viene ripulito.

- **Project isolation: historian in-memory condiviso** (`sws-historian/src/lib.rs`, `sws-web/src/projects.rs`). Il ring buffer in-memoria `Historian` (`HashMap<TagId, VecDeque<Sample>>`) era un singolo `Arc<Historian>` in `AppState`, mai svuotato tra un progetto e l'altro. I campioni del progetto precedente erano accessibili via `/api/history/:tag` nel nuovo progetto se i tag ID coincidevano. Fix: aggiunto metodo `pub async fn clear(&self)` su `Historian` (svuota i buffer in-memory, non tocca SQLite che è già per-progetto); chiamato in `open_project` e `close_project`.

- **`eval_expression` multi-line block support** (`sws-pyscript/src/lib.rs`). L'approccio precedente `__sws_result__ = {expr}` falliva per blocchi multi-riga: nei tag derivati come `pv.autoconsumo_pct` o `sala.comfort_index` la prima assignment dell'espressione concatenata finiva in `__sws_result__` invece del valore finale. Fix: nuovo `EVAL_HARNESS` che usa il modulo `ast` di Python per parsare il blocco, trovare l'ultimo statement, e sostituirlo con `__sws_result__ = <expr>` (anche dentro i branch `if`/`else`). Supporta blocchi a statement singolo, multi-statement, e blocchi con if/else (necessario per `pv.autoconsumo_pct`). Messaggio di errore "unsupported Python type" ora include il nome del tipo Python.

- **Protocol retry flood eliminato** (`sws-plugin-homeassistant`, `sws-plugin-mqtt`, `sws-plugin-modbus`, `sws-plugin-opcua`, `sws-web/src/source_supervisor.rs`). Tutti i plugin eseguivano un loop esterno di retry ogni 5 s indipendentemente dal tipo di errore (configurazione errata, token mancante, host irraggiungibile). Fix: rimosso il loop esterno da tutti e 4 i plugin — ogni `run()` viene chiamato una sola volta e termina dopo il primo errore. Il riavvio avviene solo come conseguenza di un Save della configurazione: `source_supervisor::reload()` rileva i task terminati via `handle.is_finished()` e li reinvia.

- **`logs/` directory scansionata come progetto** (`sws-web/src/projects.rs`, `sws-runtime/src/main.rs`). Il runtime creava `projects_root/logs/` come directory di default per i log, che veniva poi elencata come progetto candidato da `list_projects`. Doppio fix: (1) `list_projects` salta le directory senza `project.yaml`; (2) la directory di log di default è ora `projects_root/../logs` (cioè `.run/logs`) invece di `.run/projects/logs`.

- **`open_project` partial-state corruption** (`sws-web/src/projects.rs`). L'ordine precedente era: clear state → load project. Se il load falliva, il runtime rimaneva in stato vuoto con `project_dir` non aggiornato. Fix: load PRIMA (early return 500 su errore senza toccare lo stato), clear DOPO solo se il caricamento è andato a buon fine.

- **`create_project` da template: `meta.name` non aggiornato** (`sws-web/src/projects.rs`). I progetti creati da template mantenevano il `meta.name` interno del template (es. `homeassistant-pro`) invece del nome scelto dall'utente. Fix: dopo la copia del template, nuova funzione `patch_project_name()` legge il `project.yaml`, aggiorna `meta.name` e lo riscrive. Corretti anche i progetti già esistenti in `.run/projects/` (test→test, ha→ha).

- **`dev.sh` zombie processes + `set -e` bug** (`scripts/dev.sh`). Aggiunta `stop_existing()` che termina con SIGTERM (poi SIGKILL dopo 3 s) qualsiasi `sws-runtime` o `vite`/`esbuild` ancora in esecuzione da sessioni precedenti, usando pattern REPO_ROOT-scoped. Fix: `[ "$killed" -eq 1 ] && sleep 0.3` con `set -euo pipefail` causava exit immediato quando `killed=0` (exit code 1 dalla condizione falsa). Sostituito con `if...fi`.

### Added / Changed
- **Template `homeassistant-pro`** (`examples/templates/homeassistant-pro/`). Showcase completo per installazioni HA avanzate: 86 tag (inverter Solarman 2 stringhe PV + batteria LiFePO4 + scambio rete, monitoraggio elettrico multi-circuito con V+A+W+Hz, clima 5 stanze Zigbee, 14 sensori sicurezza, 3 luci esterne switch write-back, 4 tapparelle cover write-back, presenza persona, elevazione solare), 9 tag derivati Python (autoconsumo%, saldo energetico, comfort index, in carica bool, acquisto/vendita kW, temperatura media, costo €/h), 13 allarmi con dead-band (batteria critica+bassa, tensione rete sovra/sotto, frequenza alta/bassa, sicurezza, temperatura, umidità, movimento), SQLite historian 365 giorni (20 tag storici). SETUP.md con tabelle entity_id per categoria, istruzioni token/URL, query SQLite di esempio, layout 6 pagine sinottiche suggerite.

- **HA plugin: cover write-back e person state** (`sws-plugin-homeassistant/src/lib.rs`). `parse_ha_state`: aggiunti mapping "home"→Bool(true), "not_home"→Bool(false), "open"→Bool(true), "closed"→Bool(false) (necessari per `person.*` e `cover.*`). `build_service_call`: Bool(false) ora inverte correttamente `open_cover`→`close_cover` e `close_cover`→`open_cover` (solo `turn_on`→`turn_off` era gestito).

- **SQLite datastore hot-swap su `open_project`** (`sws-web/src/router.rs`, `sws-web/src/projects.rs`, `sws-runtime/src/main.rs`). Il campo `registry: Option<Arc<DatastoreRegistry>>` in `AppState` era immutabile dopo l'avvio: aprire un progetto via WelcomeScreen lasciava il datastore in stato "not yet initialised". Soluzione: `registry` ora è di tipo `RegistryCell = Arc<RwLock<Option<Arc<DatastoreRegistry>>>>`. `open_project` inizializza il registry prima di consumare i campi del progetto, chiama `spawn_recorder` e aggiorna la cella; `close_project` la svuota. Tutti e cinque i call site in `router.rs` aggiornati con `.read().await`. Il fallback "not yet initialised" è ora irraggiungibile e rimosso.

- **Template `homeassistant-demo`: SQLite storico** (`examples/templates/homeassistant-demo/project.yaml`). Aggiunta sezione `datastores:` con backend SQLite locale (path `.history/sws-history.db`, retention 90 giorni). Aggiunto `datastore_id: sqlite-locale` agli 8 tag con `history: true`: `sala.temperatura`, `sala.umidita`, `studio.temperatura`, `pv.potenza_kw`, `batteria.percentuale`, `batteria.potenza_kw`, `energia.potenza_w`, `rete.potenza_kw`.

### Fixed
- **Derived tag evaluator feedback loop** (`sws-runtime/src/main.rs`). Il task `derived_tag_task` scriveva su `TagDb` tramite `db.set()`, che emetteva un nuovo broadcast sul canale di cui il task stesso era subscriber, causando un loop geometrico: 3 derivati × 20 tag sorgente → blowup esponenziale → canale da 256 saturato → "lagged by N" in loop continuo → runtime bloccato. Doppio fix: (1) guard che salta la valutazione quando tutti i tag cambiati nel batch sono essi stessi derivati — rompe il feedback loop a prescindere dal numero di tag; (2) batch-drain via `try_recv()` che collassa un burst di N update (es. `populate_tags` con 20 tag) in un singolo round di valutazione Python invece di N round sequenziali. Log `Lagged` abbassato da `warn!` a `debug!`.

- **AlarmCondition missing `bool_true`/`bool_false` variants** (`sws-core/src/alarm.rs`, `sws-core/src/project.rs`, `sws-web/src/router.rs`, `sws-editor/src/types/index.ts`, `sws-editor/src/store/index.ts`, `sws-editor/src/config/ConfigView.tsx`, `sws-editor/src/App.tsx`). Il template `homeassistant-demo` usava `kind: bool_true`/`bool_false` negli allarmi, che l'enum `AlarmCondition` non riconosceva. La deserializzazione falliva in silenzio (`get_project` restituiva 404 invece di loggare e restituire 500), il progetto rimaneva `null` e tutti i tab Variabili/Protocolli/Allarmi mostravano "Caricamento progetto…" indefinitamente. Fix: aggiunti `BoolTrue` e `BoolFalse` come varianti standalone all'enum (equivalenti a `BoolEquals { true }`/`BoolEquals { false }`); `evaluate()` e `evaluate_clear()` aggiornate. `get_project` ora logga l'errore e restituisce 500 con il messaggio. Nuovo campo `projectLoadError` nello store Zustand: `App.tsx` lo imposta sul fallback `catch`; `ConfigView` lo mostra in rosso invece del generico spinner. Frontend: `AlarmCondition` in `types/index.ts` include le nuove varianti; tabella allarmi gestisce correttamente `bool_true`/`bool_false` nel rendering valore. Rimosso il test diagnostico temporaneo da `project.rs`.

### Added / Changed
- **HomeAssistant entity browser** (`sws-web/src/router.rs`, `sws-web/Cargo.toml`, `sws-editor/src/types/index.ts`, `sws-editor/src/api/client.ts`, `sws-editor/src/config/ConfigView.tsx`). Nuovo pulsante 🔍 accanto ai campi "Entity ID HA" e "Attributo" nella tabella entità del `HomeAssistantSourceCard`. Click apre `HaBrowseModal`: il backend chiama `GET /api/states` sull'istanza HA configurata (endpoint `POST /api/sources/ha/browse`, auth Operator+, resolve url+token dal progetto aperto) e restituisce `Vec<HaBrowsedEntity>` con entity_id, stato live, friendly_name e lista attributi. La modal mostra ricerca full-text, filtro per dominio (sensor./light./switch./…) e lista scrollabile. Selezione entity_id → inserimento diretto nel campo; selezione attributo → espande la riga mostrando tutti gli attributi dell'entità e inserisce il nome scelto. Aggiunto `reqwest` come dipendenza diretta di `sws-web` (era transitiva). Fix: `#[derive(serde::Serialize)]` su `HaBrowsedEntity` (forma path, coerente con il resto del file). Fix: `deserialize_sources_tolerant` in `project.rs` — skippa con warning i `kind` non riconosciuti invece di fallire il caricamento dell'intero progetto (forward-compat).

- **Template `homeassistant-demo`** (`examples/templates/homeassistant-demo/`). 3 pagine sinottiche: Panoramica (sensori clima/energia/sicurezza/luci con LED), Controllo (pulsanti ON/OFF per luci e switch, slider per input_number riscaldamento e irrigazione, toggle modalità notturna), Storico (tag derivati con formula Python visibile, tre box live con progress bar, guida allo storico). `project.yaml` con tutti i pattern supportati: sensori numerici, binary_sensor, attributo specifico (climate.current_temperature, sun.elevation), luci/switch write-back, input_number write-back, input_boolean, 3 tag derivati (costo €/h, delta termico, indice comfort), 5 allarmi con dead_band. `template.yaml` + `SETUP.md` con tabella pattern e istruzioni token. YAML sinottici validati.

- **HomeAssistant protocol plugin (piano #16)** (`sws-runtime/Cargo.toml`, nuovo crate `sws-runtime/crates/sws-plugin-homeassistant/`, `sws-core/src/project.rs`, `sws-core/src/lib.rs`, `sws-web/src/source_supervisor.rs`, `sws-web/Cargo.toml`, `sws-editor/src/types/index.ts`, `sws-editor/src/config/ConfigView.tsx`). Aggiunto `tokio-tungstenite = "0.24"` alle workspace deps. Nuovo crate `sws-plugin-homeassistant` con `pub async fn run(cfg, db, bus, cancel)`: fetch iniziale via `reqwest` di `GET /api/states` (popola tutti i tag mappati senza attendere il primo evento); connessione WebSocket a `/api/websocket` con handshake auth HA (`auth_required` → `auth` → `auth_ok`); subscribe a `state_changed` events; aggiornamento TagDb su ogni evento. Write-back: registra i tag scrivibili sul `TagWriteBus`, su ogni `WriteRequest` invia `call_service` via WebSocket (gestione automatica `turn_on`/`turn_off` per bool, `{"value": N}` per numerico). Reconnect con backoff 5 s su qualsiasi errore. Nuovi `HomeAssistantConfig` e `EntityMapping` in `sws-core/src/project.rs` + `SourceDef::HomeAssistant` variant. `SourceSupervisor::start_one/source_id/tags_of` aggiornati. Frontend: `HomeAssistantSource`, `EntityMapping` in `types/index.ts`; `HomeAssistantSourceCard` in `ConfigView.tsx` (url, token/token_env, tabella entità con tag/entity_id/attribute/write_domain/write_service). Bottone "+ Aggiungi HomeAssistant" nel tab Protocolli. `cargo check --workspace` + `pnpm build` verdi.

- **Alarm shelving/manutenzione (piano #3)** (`sws-core/src/alarm.rs`, `sws-web/src/router.rs`, `sws-editor/src/types/index.ts`, `sws-editor/src/api/client.ts`, `sws-editor/src/runtime-view/RuntimeView.tsx`). Nuovo `ShelvedAlarm { alarm_id, reason, until_ms, shelved_by, shelved_at_ms }` su `AlarmDb` (mappa separata, non persistente). `evaluate()` salta gli allarmi soppressi e auto-scade quelli con `until_ms` scaduto. Metodi: `shelve(id, reason, duration_ms, shelved_by)`, `unshelve(id)`, `shelved_snapshot()`. Rotte: `POST /api/alarms/:id/shelve` (con `{ reason, duration_ms, shelved_by }`), `DELETE /api/alarms/:id/shelve`, `GET /api/alarms/shelved` (Operator+). Frontend: `ShelvedAlarm` in types + `api.shelveAlarm/unshelveAlarm/listShelved`. AlarmPanel: pulsante 🔧 apre form inline (motivo + durata ore, 0=indefinito); allarmi soppressi in sezione separata con badge ⏸ e pulsante "Riattiva". Contatore ⏸N nel badge Allarmi.

- **IP allowlist per login (piano #12)** (`sws-web/src/router.rs`, `sws-runtime/src/main.rs`). Variabile `SWS_IP_ALLOWLIST=192.168.1.0/24,10.0.0.0/8` (opzionale). Parsing CIDR senza dipendenze aggiuntive; check IPv4 e IPv6. Il peer IP viene iniettato come request extension da `main.rs` (`req.extensions_mut().insert(peer)`); il login handler lo estrae con `Extension<SocketAddr>` + fallback `X-Forwarded-For`. 403 Forbidden se non autorizzato. Nessun filtro se variabile non impostata.

- **Rotazione automatica pagine kiosk (piano #10)** (`sws-editor/src/types/index.ts`, `sws-editor/src/store/index.ts`, `sws-editor/src/runtime-view/RuntimeView.tsx`, `sws-editor/src/editor/EditorShell.tsx`). Nuovo campo `auto_rotate_skip?: boolean` su `SynopticPage`. Stato `autoRotate` / `autoRotateIntervalS` nel store Zustand con persistenza `localStorage`. `useEffect` in RuntimeView: `setInterval` che avanza alla prossima pagina non-skipped; si azzera al click manuale su tab. Toolbar nella nav bar: pulsante "▶ Ciclo" / "⏹ Stop" + input secondi. Checkbox "Escludi dal ciclo automatico" nel pannello PageProps dell'editor.

- **Tag calcolati/derivati (piano #1)** (`sws-core/src/project.rs`, `sws-pyscript/src/lib.rs`, `sws-web/src/router.rs`, `sws-web/src/projects.rs`, `sws-runtime/src/main.rs`, `sws-editor/src/types/index.ts`, `sws-editor/src/config/ConfigView.tsx`). Nuovo campo `expression: Option<String>` su `TagDef` (YAML + UI). Nuova funzione pubblica `sws_pyscript::eval_expression(expr, snapshot)`: esegue l'espressione Python in `spawn_blocking` con `tags` dict snapshot del TagDb, restituisce `TagValue` o errore. Nuova `DerivedTagsRegistry` (`Arc<RwLock<Vec<(String, String)>>>`) in `AppState` — aggiornata da `update_project_tags`, `open_project`, `close_project` e import. Task `derived_tag_task` in `main.rs`: sottoscrive al broadcast TagDb, ad ogni update legge la lista dei tag derivati, prende snapshot del TagDb, rivaluta tutte le espressioni, aggiorna i tag con `TagQuality::Good` (o logga l'errore e mantiene l'ultimo valore). Frontend: bottone "λ" per ogni tag apre una sub-riga con input expression (monospace violetto); il bottone è colorato quando l'espressione è impostata. Esempio: `tags["motor.v"] * tags["motor.i"]`.

- **Modbus RTU via porta seriale (piano #15)** (`sws-runtime/Cargo.toml`, `sws-plugin-modbus/src/lib.rs`, `sws-core/src/project.rs`, `sws-web/src/source_supervisor.rs`, `sws-editor/src/types/index.ts`, `sws-editor/src/config/ConfigView.tsx`). Nuovo `ModbusRtuConfig` con `device`, `baud_rate`, `parity` (N/E/O), `data_bits`, `stop_bits`, `unit_id`, `poll_interval_ms`, `registers` (stesso `RegisterMapping` del TCP). `SourceDef::ModbusRtu` variant. `run_rtu()` + `session_rtu()` in `sws-plugin-modbus`: apre la porta seriale con `tokio-serial 5.4` (`SerialStream::open_native_async()`), connette via `tokio_modbus::rtu::connect_slave()`, poi stesso loop tick/write della versione TCP. Wired in `SourceSupervisor::start_one/source_id/tags_of`. Frontend: `ModbusRtuSource` type + `emptyModbusRtu()` + `ModbusRtuSourceCard` (select parità, bit dati/stop, baud, tabella registri). Bottone "+ Aggiungi Modbus RTU" nel tab Protocolli.

- **OPC-UA server (piano #6)** (`sws-runtime/Cargo.toml`, `sws-plugin-opcua/src/lib.rs`, `sws-core/src/project.rs`, `sws-web/src/source_supervisor.rs`, `sws-editor/src/types/index.ts`, `sws-editor/src/config/ConfigView.tsx`). Nuovi `OpcUaServerConfig` (port, namespace_uri, nodes) e `OpcUaServerNodeMapping` (tag, optional node_id). `async-opcua` workspace dep guadagna feature `server` (scaricati `async-opcua-server 0.18` + `async-opcua-core-namespace 0.18`). `run_server()` in `sws-plugin-opcua`: `ServerBuilder::new_anonymous()` + `simple_node_manager()` (namespace custom), address space popolata con cartella "SWS" + `VariableBuilder` per ogni mapping (AccessLevel Read+Write), mirror `TagDb` broadcast → `SimpleNodeManager::set_value()` tramite task Tokio, write-back OPC-UA → `TagDb` via callback sync + `unbounded_channel`. Cancellazione pulita via `CancellationToken` → `ServerHandle::cancel()`. Frontend: `OpcUaServerSource` type + `OpcUaServerSourceCard` (port, namespace, tabella nodi). Bottoni "+ Aggiungi OPC-UA client/server" nel tab Protocolli. `cargo check --workspace` + `pnpm build` verdi.

- **Alarm dead-band / hysteresis (piano #2)** (`sws-core/src/alarm.rs`, `sws-editor/src/types/index.ts`, `sws-editor/src/config/ConfigView.tsx`). Nuovo campo `dead_band: Option<f64>` su `AlarmDef` (YAML + UI). Nuovo metodo `AlarmCondition::evaluate_clear(value, dead_band)`: l'allarme Above(T) con dead_band=d rientra solo quando il valore scende sotto `T - d`; Below(T) con dead_band=d rientra solo sopra `T + d`. Previene l'alarm chatter su sensori analogici rumorosi attorno alla soglia (standard ISA-18.2). Nuovo campo "Dead-band" nella tabella allarmi di ConfigView (visibile solo per condizioni Above/Below). Nuovo test `dead_band_prevents_premature_clear`. `cargo test -p sws-core`: 11/11 ok.

- **CSV export storico historian (piano #4)** (`sws-web/src/router.rs`, `sws-editor/src/api/client.ts`, `sws-editor/src/canvas/TrendCanvas.tsx`). Nuovo endpoint `GET /api/history/export?tags=a,b,c&from_ms=&to_ms=` (Authenticated): restituisce file CSV con colonne `ts_ms,ts_iso,tag_id,value,quality`, timestamp ISO 8601 UTC calcolato con `time::OffsetDateTime` (no chrono). Multi-tag unificato e ordinato per timestamp. `api.exportHistoryCsv(tags, fromMs, toMs)` scatena il download via `<a>` programmatico. Bottone "⬇ CSV" sovrapposto al TrendCanvas (visibile quando ci sono dati).

- **Statistiche aggregate storico (piano #5)** (`sws-web/src/router.rs`, `sws-editor/src/api/client.ts`, `sws-editor/src/types/index.ts`). Nuovo endpoint `GET /api/history/:tag/stats?from_ms=&to_ms=` (Authenticated): restituisce `{ tag, count, min, max, avg, stddev, first_ts, last_ts }` calcolato in-process dai campioni del ring buffer. Nuovo tipo `HistoryStats` e metodo `api.getHistoryStats()`. `cargo check --workspace` + `pnpm build` verdi.

- **Grid drag-to-range multi-cell selection (4.8)** (`sws-editor/src/canvas/SvgCanvas.tsx`). Added `onMouseEnter` to each grid cell `<g>` element: when shift is held and the primary mouse button is pressed (`e.buttons === 1`), the cell range is extended live to span from the anchor `selectedCell` to the cell under the pointer. Allows drawing a rectangular selection by shift-clicking the first cell and then dragging, instead of shift-clicking each cell individually. `pnpm build` green.

- **OPC-UA historical reads via HistoryRead service** (`sws-plugin-opcua/src/lib.rs`, `sws-web/src/router.rs`, `sws-core/src/project.rs`, `sws-editor/src/types/index.ts`, `sws-editor/src/api/client.ts`, `sws-editor/src/canvas/TrendCanvas.tsx`, `sws-editor/src/canvas/SvgCanvas.tsx`, `sws-editor/src/editor/EditorShell.tsx`). New `read_history(cfg, node_id, from_ms, to_ms, max_values)` in `sws-plugin-opcua`: one-shot OPC-UA connection (same pattern as browse), calls `session.history_read(HistoryReadAction::ReadRawModifiedDetails(...))`, decodes `HistoryData`, converts OPC-UA 100ns ticks to Unix ms via constant arithmetic (`EPOCH_OFFSET_TICKS = 116_444_736_000_000_000`) without chrono dependency. Returns `Vec<HistoricalSample> { ts_ms, value: f64, quality }`. `GET /api/history/:tag` now accepts `?backfill=true` query param: on first chart load the router calls `opcua_backfill_history()`, which loads the active project, finds any OPC-UA source mapping the requested tag, calls `read_history()`, merges OPC-UA samples into local historian data deduplicating by `ts_ms` and sorting ascending. `TrendCanvas` passes `backfill=true` only on the first poll tick (tracked via `let firstTick = true`) to avoid repeated OPC-UA RTTs on every 2 s poll. New `opcua_backfill?: boolean` field on `SynopticObject`; wired from `SvgCanvas` to `TrendCanvas` as `opcuaBackfill` prop. New "Backfill da storico OPC-UA al caricamento" checkbox in the EditorShell Trend object property panel. `cargo check --workspace` + `pnpm build` green.

- **OPC-UA per-source certificate trust management** (`sws-core/src/project.rs`, `sws-plugin-opcua/src/lib.rs`, `sws-web/src/router.rs`, `sws-editor/src/types/index.ts`, `sws-editor/src/api/client.ts`, `sws-editor/src/config/ConfigView.tsx`). New `trust_all_certs: bool` field on `OpcUaClientConfig` (default `true` — backward-compatible). When `false`, `async-opcua` only accepts server certs explicitly in the per-source trust store. New REST API: `GET /api/sources/:id/opcua/certs` (Supervisor+, lists `.der` files from `{project}/.opcua-pki/{source_id}/trusted/certs/` and `rejected/certs/`), `POST /api/sources/:id/opcua/certs/:filename/trust` (Admin — promotes a rejected cert to trusted), `DELETE /api/sources/:id/opcua/certs/:filename` (Admin — removes from either store). One-shot browse and Euromap-detect endpoints keep `trust_all=true` (ephemeral connections). Frontend: new "SICUREZZA CERTIFICATI" section in the OPC-UA source card — checkbox to toggle `trust_all_certs`, inline trust-store panel (visible when strict mode is enabled) listing trusted/rejected certs with "Trust" and "×" actions. Fix: `datastore_test` handler now returns `Json(msg)` instead of plain text so `res.json()` on the frontend succeeds. Added `tracing::warn!` on datastore test/stats error paths so failures appear in the log panel. `cargo check` + `pnpm build` green.

- **Datastore management — multi-backend tag history persistence** (`sws-runtime/crates/sws-core/src/project.rs`, `sws-historian/src/backend.rs`, `sws-historian/src/sqlite_backend.rs`, `sws-historian/src/postgres_backend.rs`, `sws-historian/src/odbc_backend.rs`, `sws-historian/src/registry.rs`, `sws-web/src/router.rs`, `sws-runtime/src/main.rs`, `sws-editor/src/types/index.ts`, `sws-editor/src/api/client.ts`, `sws-editor/src/config/ConfigView.tsx`, `sws-editor/src/store/index.ts`). Tags now have optional `history / datastore_id / history_deadband / history_min_interval_ms` fields. Projects support a `datastores` array with SQLite-file, PostgreSQL (tokio-postgres, single persistent client with reconnect, best-effort TimescaleDB hypertable), and ODBC (stub — compiled always, no-op until `odbc-api` feature added) backends. `DatastoreRegistry` routes writes per-tag, applies deadband and interval filtering, and spawns a recorder task alongside the existing in-memory historian. REST API: `GET /api/datastores` (list + connected status), `GET /api/datastores/:id/stats` (sample count, oldest/newest, size), `POST /api/datastores/:id/test` (Admin), `POST /api/datastores/:id/purge` (Admin, by age/row-count), `GET /api/datastores/:id/export` (Admin, JSON), `PUT /api/project/datastores` (Admin, saves config to project.yaml). Frontend: new Datastore types + API client methods; new "Datastore" tab in ConfigView (Admin-only) for add/edit/remove backends with inline Test + Stats; Tags tab gains History checkbox + Datastore select columns. `cargo check --workspace` + `pnpm build` green.

- **Proactive session token refresh** (`sws-runtime/crates/sws-auth/src/lib.rs`, `sws-runtime/crates/sws-web/src/router.rs`, `sws-editor/src/api/client.ts`, `sws-editor/src/store/index.ts`, `sws-editor/src/App.tsx`, `sws-editor/src/components/LoginScreen.tsx`). New `touch()` method on `AuthState` slides the session TTL and returns the refreshed `expires_at_ms` (millis since epoch). New `POST /api/auth/refresh` route (self-service — accessible even when `must_change_password=true`) calls `touch()` and returns `{ expires_at_ms }`; returns 401 when the token is already expired. Frontend stores `expiresAtMs` in the Zustand store and in `sws.auth` localStorage (persisted auth now includes `expires_at_ms`). Hydration guard: if the stored `expires_at_ms` is in the past the session is discarded immediately instead of attempting to resume a stale token. `App.tsx` adds a self-rescheduling timer that calls `api.refresh()` 5 minutes before expiry (min 30 s delay to avoid hammering); on success it updates `expiresAtMs` via `setExpiresAtMs`, which retriggers the effect for the next cycle. Idle sessions are kept alive transparently; session-expired events and the ReAuthModal handle the case where the refresh itself fails (network partition, runtime restart). Closes task 8.1.

- **Login lockout with countdown UI** (`sws-runtime/crates/sws-auth/src/lib.rs`, `sws-runtime/crates/sws-web/src/router.rs`, `sws-editor/src/api/client.ts`, `sws-editor/src/components/LoginScreen.tsx`). `LoginFailures` gains a `locked_until` field: when the failure budget (default 5/60 s, configurable via `SWS_LOGIN_RATE_LIMIT` / `SWS_LOGIN_RATE_WINDOW_SECS`) is exhausted the account is locked until the timer expires; each failed attempt while locked extends the timer. `POST /api/auth/login` now returns `Retry-After: <secs>` in the 429 body. Frontend parses the header into a new `RateLimitedError`, shows a live countdown in the login form ("Bloccato (42s)"), and disables the form until the lockout expires. Closes task 8.2.

- **WS auto-reconnect with exponential back-off** (`sws-editor/src/ws/reconnectingWs.ts`, `tagStream.ts`, `alarmStream.ts`, `logStream.ts`). New `ReconnectingWs` class stores caller-registered listeners and re-registers them on every new underlying socket, so message handlers survive reconnects transparently. Back-off: 1 s → 2 s → 4 s … cap at 30 s with ±25 % jitter. All three WS streams migrated from raw WebSocket singleton; `authToken` added to effect deps so the stream is destroyed (not retried) on logout. Closes task 6.4-bis.

- **Vite bundle splitting** (`sws-editor/vite.config.ts`). `manualChunks` splits the 920 KB (280 KB gzip) monolith into four independently cached chunks: `react-vendor` (61 KB gz), `codemirror` (121 KB gz), `i18n` (15 KB gz), `index` app code (81 KB gz). Deploying a new app version only re-downloads the 81 KB app chunk.

- **sws-kiosk white-window fix — Traccia B closed** (`scripts/dev.sh`). Root cause: when Claude Code runs as a snap (`SNAP=/snap/code/240`), the `SNAP_*` environment variables propagate into WebKit's `WebKitNetworkProcess` subprocess, which then resolves `libpthread.so.0` from `/snap/core20/current/lib/` instead of the system path, causing a `GLIBC_PRIVATE` symbol error and a blank kiosk window. Fix: `dev.sh kiosk` now strips all `SNAP_*` variables via `env -u` before exec-ing the kiosk binary. Two additional bugs fixed in the same mode: (1) kiosk binary path was pointing to the workspace `target/` directory but `sws-kiosk` is excluded from the Rust workspace, so the correct path is `crates/sws-kiosk/target/debug/sws-kiosk`; (2) the runtime was started without `--www`, causing `/` → 404 and a blank window regardless of snap — now passes `--www sws-editor/dist` if the directory exists, with a warning otherwise. Verified on home Ubuntu desktop: `WebKitNetworkProcess` reaches ESTABLISHED on port 8443, no `load-failed` in stderr, kiosk window shows SWS. `cargo check --workspace` green.
- **RBAC tightening — Operator + Viewer can no longer reach editor / config / side menus** (`sws-editor/src/auth/permissions.ts` [new], `sws-editor/src/App.tsx`, `sws-editor/src/config/ConfigView.tsx`, `sws-runtime/crates/sws-web/src/router.rs`). Previously every authenticated role could click into edit/config mode in the SPA, and the backend allowed `PUT /api/synoptics/:name` + `POST /api/synoptics/import` to anyone Operator+ — so a curl-armed Operator could still mutate synoptics even with a UI gate. New permission matrix:
  - `Viewer`, `Operator`: runtime view only (read tags + alarms, write tag values from buttons/sliders, ACK alarms).
  - `Supervisor`: full editor + config (minus Users/Backups tabs).
  - `Admin`: as Supervisor plus Users + Backups + project Export/Import.
  - **Frontend**: new `auth/permissions.ts` exports `canEditProject` / `canConfigureProject` (Supervisor+). `App.tsx` derives an `effectiveMode` that pins non-editors to `"view"` regardless of what `appMode` says in the Zustand store (the store default `"edit"` is in-memory and would otherwise flash the editor on every hard reload). The header mode-button list is filtered to `allowedModes`; `GridDropdown`, page-tabs bar, and the main render branches all read `effectiveMode`. `MainMenu` receives `effectiveMode` as its `mode` prop, so the "Salva tutto" item disappears for Operator. `ConfigView` adds a belt-and-braces early-return after its hook block when `!canConfigureProject(authRole)` — defense-in-depth for any future direct mount.
  - **Backend**: new `require_supervisor` middleware mirrors `require_operator` / `require_admin`. `PUT /api/synoptics/:name` and `POST /api/synoptics/import` move out of `operator_routes` into a new `supervisor_routes` group merged into `blocking`. Operators retain everything else they need (tag writes, alarm ACK, script exec, logs read/stream, MQTT/OPC-UA browse, system status). No changes to `sws-auth` — `Role::Supervisor` ordering already supported.
  - Manual smoke against `localhost`: `POST /api/projects/hhh/open` (200) → login operator + supervisor → `PUT /api/synoptics/Page%201%20-%20Panoramica` returns 403 (Operator) and 204 (Supervisor). Cargo tests + `pnpm type-check` + `pnpm build` green. `Role` ordering invariant in `sws-auth/src/lib.rs:715-717` already covers the gate. Redeployed to PX30 (`wp615-a-p2`, 192.168.1.59) — `/health` ok, browser verification by maintainer pending.

- **Yocto cross-compile + deploy for sws-runtime — end-to-end green on PX30** (`scripts/yocto/yocto-linker.sh`, `scripts/yocto/build.sh`, `scripts/yocto/deploy.sh`, `deploy/yocto/sws-runtime.service`, `deploy/yocto/sws-runtime-launch.sh`, `sws-runtime/Cargo.toml`, `docs/YOCTO_CROSSCOMPILE.md`, `CLAUDE.md`). Install path **`/data/user/sws/`** (not `/opt/sws`): Pixsys Yocto devices mount `/` read-only (squashfs/ubifs) and `/data/user` is the writable scratch partition. Deploy verified on `wp615-a-p2` (PX30, 192.168.1.59): systemd unit active, listener on `0.0.0.0:8443`, `/health` → `ok`, `/` → 200 HTML (SPA served), `/api/system` → 401 (auth required, expected). Known non-blocking debts surfaced by this run: unit runs `User=root` (CRA cleanup post-PoC), and `RestrictedPython` is absent on the device — runtime emits a startup warning and runs scripts unsandboxed (fix on the Yocto side: add `python3-restrictedpython` to the image). Imported the test-kit pattern (`/home/ut1/GitPixsys/test-kit`): linker wrapper that calls `aarch64-pixsys-linux-gcc` of the Pixsys Yocto SDK with `--sysroot=...cortexa35-pixsys-linux` and `-mcpu=cortex-a35+crc+crypto -mbranch-protection=standard`, plus a `build.sh` that sources `environment-setup-cortexa35-pixsys-linux`, sets `CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER` + `PYO3_CROSS_LIB_DIR` + `PYO3_CROSS_PYTHON_VERSION=3.12`, auto-exports `PYO3_PYTHON=$(command -v python3)` (Debian has no `/usr/bin/python` alias and pyo3-build-config needs a host interpreter even in cross mode), builds the SPA via `pnpm build` and finally `cargo build --target aarch64-unknown-linux-gnu --release -p sws-runtime`. Sysroot survey confirmed Python 3.12 + headers, sqlite3, openssl3, wayland-client, glibc 2.39 all present — and that GTK4 + WebKitGTK6 are absent, so `sws-kiosk` is deliberately out of scope (browser remoto in LAN is the device-side UI for now). Workspace `[profile.release]` gets `lto = "thin"`, `strip = "symbols"`, `codegen-units = 1`, `opt-level = 3`. Systemd unit + launch wrapper deploy under `/opt/sws/` with first-install-only `runtime.env` to keep per-device password overrides outside redeploys. **Reference build (2026-05-21, S-36, office dev server)**: 3m40s clean release, 18 MB stripped PIE binary; `aarch64-pixsys-linux-readelf -d` lists NEEDED = `libpython3.12.so.1.0`, `libgcc_s.so.1`, `libm.so.6`, `libc.so.6`, `ld-linux-aarch64.so.1` — no OpenSSL (rustls), no `libsqlite3` (rusqlite/bundled), no GTK/WebKit (kiosk excluded). New `docs/YOCTO_CROSSCOMPILE.md` covers prereqs / build / sanity check (`file` + `readelf -d`) / deploy / troubleshooting; linked from `CLAUDE.md`. Device-side end-to-end (`scripts/yocto/deploy.sh pixsys@<host>` → `curl -k https://<host>:8443/health`) still pending — requires explicit maintainer go-ahead on which Yocto box to target.

- **`docs/TEST_SETUPS.md` + diagnostic load-failed logging in sws-kiosk** (`docs/TEST_SETUPS.md`, `STATUS.md`, `CLAUDE.md`, `sws-runtime/crates/sws-kiosk/src/main.rs`). New doc enumerates the three actual test environments — home Ubuntu desktop (the only place with a real GTK display), this headless dev server (browser tests from maintainer's PC over LAN), and the office Yocto devices (PX30/RK3399/RK3588) — and codifies that device addresses change per session, that the maintainer runs `ssh-copy-id`/`ssh-keygen -R` manually, and that the agent must ask before SSH-ing. `STATUS.md` handoff replaced with a layered diagnostic procedure (`/health` → root `200` → Firefox visual check → kiosk) so a "white window" can be attributed correctly instead of blamed on the cert (`--allow-insecure-tls` is already default `true` and wired to `TLSErrorsPolicy::Ignore`). `sws-kiosk` now also connects `load-failed` and `load-failed-with-tls-errors` signals and prints to stderr, so the next white-window event has a concrete error string to work from. Signal signatures verified against `webkit6` 0.6.1 source; workspace `cargo check` green. Kiosk crate build deferred — this dev server lacks `libgtk-4-dev` / `libwebkitgtk-6.0-dev` (tracked task A1).

- **Two new templates + standards refresh of the existing two — startup now opens the WelcomeScreen** (`examples/templates/opcua-demo/`, `examples/templates/grid-playground/`, `examples/templates/demo-items/*`, `examples/templates/casa-locale/*`, `scripts/dev.sh`).
  - New **`opcua-demo`** template (2 pages, 5 tags, 2 alarms): `OpcUaClient` source pointing at `opc.tcp://localhost:4840` with both `ns=1` simulated nodes (Temperature, Pressure) and `ns=2` Euromap-77 canonical nodes (CycleTime, MachineState, MachineReady). Page 1 = gauge × 2 + Trend with `extra_tags` + symbol pump bound to `sim.machine_ready`; Page 2 = NodeId/Tag/Value table with hint banners pointing at the 🔍 Sfoglia server / 🤖 Rileva Euromap buttons. SETUP.md ships next to the project covering simulator recipes (`node-opcua`, Prosys) and the Basic256Sha256 trust handshake gotcha.
  - New **`grid-playground`** template (2 pages, 6 tags, 1 alarm, 3 functions): one `grid` object 4×4 (760×600) with `grid_show_borders: true` whose `grid_cells` array exercises every supported feature — direct `child` of various types (rect, ellipse, text, gauge, led, symbol, button, slider, progress_bar, trend), one merge cell via `colspan: 2`, several cells with `sub` splits, and one cell with **4 levels of `sub` nesting** (cols → rows → cols → rows, leaves are rect/text/ellipse/led). Page 2 is a controls panel that writes `demo.fill_color` / `counter` to demonstrate per-binding `transition_duration_ms` and alarm triggering. No external sources — fully runnable offline.
  - **`demo-items`** + **`casa-locale`** refresh: explicit `width:` / `height:` on every page; navigation headers (nav buttons + title + subtitle) gathered into a `g_nav` (and `g_header` where header is distinct) **group** with `locked: true` so the operator can't drag them around by accident in editor mode; `transition_duration_ms` added to the bound gauge, symbol, and bindable rect/ellipse in `demo-items`. Both templates bumped to `version: 0.2.0`; demo-items `meta.name` corrected from `dev` to `demo-items`; template descriptions updated.
  - **`scripts/dev.sh` no longer seeds a default `dev` project** and no longer passes `--project` to the runtime. Both modes (`runtime`, `both`) now boot with `--projects-root` + `--templates-root` only; the runtime starts with no active project, the WelcomeScreen lists candidates from `$PROJECTS_ROOT` (empty on fresh clone) and the bundled templates from `$TEMPLATES_ROOT`. The legacy heredoc YAML fallback is retained inside a `: <<'LEGACY_FALLBACK_YAML'` block as documentation of the old shape but is no longer executed. Existing `.run/projects/dev/` removed locally.
  - Validation: workspace `cargo check` + `pnpm build` green; per-template smoke (`Project::load` + HTTP `GET /api/synoptics/:name` on every page) → 4/4 projects load (76 tags / 10 alarms / 5 functions cumulative), 13/13 pages return 200 with object counts {17, 8, 48, 21, 91, 47, 26, 59, 66, 15, 30, 5, 17}.

- **BL-005 complete — security policies, Euromap auto-detect, reverse browse** (`sws-plugin-opcua/src/lib.rs`, `sws-web/router.rs`, `sws-web/source_supervisor.rs`, `sws-web/projects.rs`, `sws-runtime/main.rs`, `sws-editor/src/config/ConfigView.tsx`, `sws-editor/src/api/client.ts`, `sws-editor/src/types/index.ts`, `docs/OPCUA_SETUP.md`) — closes the OPC-UA backlog entirely.
  - **BL-005c — Security policies > None**: `parse_security_policy()` maps the YAML string onto `opcua::crypto::SecurityPolicy` (None, Basic128Rsa15, Basic256, Basic256Sha256, Aes128Sha256RsaOaep, Aes256Sha256RsaPss). Unknowns fall back to None with a warning. Every non-None pairs with `MessageSecurityMode::SignAndEncrypt`. New `build_client_builder()` helper centralises `create_sample_keypair(true)` + `trust_server_certs(true)` + `pki_dir(path)`. Cert + key persist under `<project>/.opcua-pki/<source-id>/` so reconnects reuse the identity and each source has distinct credentials. `SourceSupervisor::set_pki_root()` is called from both the WelcomeScreen `open_project` flow and the legacy `--project` auto-open path. ConfigView `security_policy` dropdown enables every option (Basic256Sha256 marked "raccomandato").
  - **BL-005b — Euromap 77 / 83 auto-discovery**: new `detect_euromap()` walks the address space BFS (capped at 500 nodes / 4 levels under ObjectsFolder), matches Variable `browse_name` (case-insensitive) against an 11-entry dictionary covering EM77 IM (MachineState, ActiveErrors, CycleTime, InjectionTime, MeltTemperature, ClampingForce, ProductionActiveParts, ProductionActiveDefectiveParts) and EM83 TCU (TbcActualTemperature, TbcSetTemperature, TbcState). Returns `{ nodes_scanned, truncated, variables: [{spec, canonical_name, suggested_tag_suffix, description, node_id, …}] }`. New `POST /api/sources/opcua/detect-euromap` (Operator+) handler with masked-password sentinel resolution. ConfigView gains a "🤖 Rileva Euromap" button on `OpcUaSourceCard` → opens `OpcUaEuromapModal` (auto-scan on open, pre-selects every non-imported match, "Auto-crea tag SWS suggeriti" toggle that creates `<source-id>.<suffix>` tags in the same save).
  - **Reverse browse**: `browse_one_level()` accepts a `BrowseDir` parameter (`Forward` | `Inverse` | `Both`). `POST /api/sources/opcua/browse` accepts optional `direction` and `security_policy` fields. Forward stays the UI default; inverse/both are useful for inspector tooling.
  - Tests: `parse_security_policy_known_values`, `security_mode_pairs_none_with_none_and_else_signencrypt`, `euromap_dictionary_is_consistent` (no empty fields, no duplicate spec+suffix). `sws-plugin-opcua` 5 → 8; workspace **50 → 53**.
  - `docs/OPCUA_SETUP.md` status banner updated to "BL-005 complete"; new sections on security policies (mode table + cert handshake gotcha — most servers reject the cert on first connect and need an operator-side trust) and Euromap detection; deferred list trimmed to vendor-curated trust list, historical reads, and reverse-connect mode.

- **OPC-UA writes + server browse — BL-005 step 3+4** (`sws-plugin-opcua`, `sws-web/router.rs`, `sws-web/source_supervisor.rs`, `sws-editor/src/api/client.ts`, `sws-editor/src/config/ConfigView.tsx`, `sws-editor/src/types/index.ts`, `docs/OPCUA_SETUP.md`) — closes the operator-facing OPC-UA demo.
  - **Step 4 — Writes via TagWriteBus**: `sws-plugin-opcua::run` now takes `&Arc<TagWriteBus>`. For each configured node the plugin registers an mpsc sender on the bus; a writer task converts TagValue → Variant (Bool→Boolean, Int→Int64, Float→Double, Str→String) and calls `session.write(&[WriteValue { node_id, attribute_id: Value, value }])`. Good results are echoed into `TagDb` immediately so the UI doesn't wait for the next subscription publish. On session exit the writer is aborted and `bus.unregister_many()` releases the routes; reconnects re-register cleanly. `source_supervisor` passes `bus` to the plugin.
  - **Step 3 — Server browse**: new `browse_one_level(cfg, parent_node_id)` helper opens a temporary session, browses Forward + HierarchicalReferences under the requested NodeId (or `ObjectsFolder` when `None`), returns a flat `Vec<BrowsedNode>` { node_id, browse_name, display_name, node_class }, then closes the session. New `POST /api/sources/opcua/browse` (Operator+) handler with the masked-password sentinel resolution pattern shared with MQTT browse. ConfigView `OpcUaSourceCard` gains a "🔍 Sfoglia server" button that opens a lazy-loading tree modal — `Object` folders expand on click, `Variable` rows have a checkbox, already-imported rows are greyed out to prevent double-add. Selection imports with `display_name` pre-filled as description.
  - 2 new unit tests (`tag_value_to_variant_roundtrip_*`) bring `sws-plugin-opcua` to 5 passing; workspace stays green at **50 unit tests**.
  - `docs/OPCUA_SETUP.md` rewritten with "Writes back to the server" + "Browse the server" sections; the deferred list now only mentions security policies > None, Euromap (BL-005b), and reverse browse.

- **OPC-UA client plugin — Phase 4 step 1+2 (BL-005)** (`sws-core/project.rs`, `sws-plugin-opcua`, `sws-web/source_supervisor.rs`, `sws-editor/src/config/ConfigView.tsx`, `sws-editor/src/types/index.ts`, `docs/OPCUA_SETUP.md`) — first slice of the industrial demo.
  - New `SourceDef::OpcUaClient(OpcUaClientConfig)` variant: `id`, `endpoint_url`, `security_policy` (only `None` wired, others stored for forward-compat), `auth` (`Anonymous` | `UsernamePassword` with `password` or `password_env` — env wins so secrets stay out of YAML), `subscription_interval_ms`, `Vec<OpcUaNodeMapping>` ({ tag, node_id, description? }). NodeIds in standard OPC-UA string form (`ns=2;s=Machine.X` or `ns=0;i=2253`).
  - `sws-plugin-opcua` upgraded from placeholder to real `run(cfg, db)`: `ClientBuilder` + `connect_to_endpoint_directly` + `DataChangeCallback`. Synchronous callback ships `(NodeId, DataValue)` over an unbounded mpsc channel; a tokio dispatcher drains it into `TagDb` so the OPC-UA worker never awaits async writes. Value mapping handles bool / all integer widths / float / double / string / LocalizedText. Unsupported variants land with `TagQuality::Uncertain`. On disconnect every mapped tag is flipped `Bad` until the next callback arrives after reconnect (5 s loop). 3 new unit tests for the variant → TagValue mapping.
  - `sws-web::source_supervisor` dispatches the new variant; `async-opcua` workspace dep gains the `client` feature; `futures-util` workspace dep also picked up here.
  - **ConfigView**: new `OpcUaSourceCard` with endpoint URL, security policy picker (only None active in PoC), subscription interval, anonymous / username+password auth toggle (password + password_env), node table with TagInput + quick-create. New "+ Aggiungi OPC-UA" button replacing the "prossimamente" placeholder. LeftPanel SOURCES section gets a green `OPC-UA` pill alongside `MQTT` / `MBUS`.
  - `docs/OPCUA_SETUP.md`: full setup guide — YAML shape, auth options, NodeId formats, value-type / quality mapping, two simulator recipes (`node-opcua`, Prosys Simulation Server), smoke-test recipe, explicit list of what's NOT in step 1+2 (writes back to server, browse, security policies > `None`, Euromap companion-spec discovery — all tracked as follow-ups).

- **Bidirectional `/ws/tags` — operator writes over the socket (task 6.4)** (`sws-web/router.rs`, `sws-editor/src/ws/tagStream.ts`, `sws-editor/src/runtime-view/RuntimeView.tsx`) — the existing send-only WS now also accepts `{"type":"write","tag":...,"value":...,"req_id":?}` frames. Role-gated at Operator+ (mirrors HTTP `PUT /api/tags/:id`), routed through `TagWriteBus` with fallback to direct `TagDb.set()` for virtual tags. Server replies with a `WriteAck` frame on the same socket echoing the optional `req_id`. Backend: handler now splits the socket via `futures-util` Sink/Stream traits and runs three tasks (forwarder serialises every outbound frame through an mpsc queue, broadcast subscriber, inbound dispatcher). Frontend: new `tryTagWriteWs(tag, value)` helper; `RuntimeView.handleWriteTag` prefers WS, falls back to `api.writeTag()` only when the socket isn't open yet (first paint can race the upgrade).

- **Playwright e2e — login → add rect → save → reload (task 9.1)** (`sws-editor/playwright.config.ts`, `sws-editor/e2e/editor.spec.ts`, `scripts/README.md`). `@playwright/test` dev-dep + two specs: the golden path (add a rect, save, reload, confirm rect survived) and a negative login form path. Config keys: chromium project, `baseURL: https://localhost:5173`, `ignoreHTTPSErrors: true`, `trace: retain-on-failure`. **No `webServer` config** — replicating dev.sh's cert / seed / env bootstrap inside Playwright would be more brittle than asking the operator to run dev.sh first. `pnpm test:e2e` + `pnpm test:e2e:ui` scripts. Artefacts (`test-results/`, `playwright-report/`, `.playwright/`) gitignored. `scripts/README.md` documents the run sequence.

- **Automatic project backups + restore (task 7.2)** (`sws-web/backups.rs`, `sws-runtime/main.rs`, `api/client.ts`, `config/ConfigView.tsx`) — point-in-time snapshots of the project files under `<project>/.bak/<UTC-timestamp>/` covering `project.yaml`, `synoptics/`, and `users.yaml`. Two trigger paths:
  - Background loop fired by the runtime when started with `--auto-backup-interval-minutes N` (default 0 = disabled). `--auto-backup-retention K` caps the retained count (default 20); older snapshots are pruned after each tick. First tick is skipped so the process doesn't snapshot on startup before any work happens. Snapshot I/O runs under `spawn_blocking` so it never starves the runtime's tasks. Skipped silently when no project is open.
  - Admin REST: `GET/POST /api/backups`, `DELETE /api/backups/:name`, `POST /api/backups/:name/restore`. Path param sanitised by `safe_backup_name` against `..`/`/`/length.
  - `ConfigView` gains a "Backup" tab (admin-only) with a newest-first table (name, created at, size) and **Backup adesso** / **Aggiorna** / **Ripristina** / **Elimina** buttons. Restore reloads the project + pages so the editor reflects the snapshot state immediately.
  - 4 new unit tests (sws-web 8 → 12): roundtrip, list sort order, prune behaviour, traversal rejection.

- **Aspect-ratio resize, Prometheus counters, live script test panel** (sessione 26 follow-up).
  - **1.5 Shift + corner drag preserves aspect ratio** (`canvas/SvgCanvas.tsx`): when `shiftKey` is held during a corner handle drag (`tl/tr/bl/br`), the resize locks `startObj.width / startObj.height`. Driver axis is whichever moved more (in width-equivalent units, `dySigned * aspect`); the other axis is derived. Mid-edge handles ignore Shift (only one dim is meaningful). Anchor preserved: `l` handles still move `x` inward from the right, `t` handles still move `y` from the bottom. Documented in `ShortcutHelp`.
  - **3.4b Prometheus counters** (`sws-web/router.rs`, `sws-runtime/main.rs`, `sws-web/metrics.rs`):
    - `sws_script_exec_total{endpoint,status}` — bumped from `exec_script` and `run_function`.
    - `sws_alarm_transitions_total{direction,severity}` — bumped in the alarm webhook dispatcher (the single spot every alarm transition flows through), on both `activated` and `recovered` directions.
    - `sws_http_requests_total{path,method,status}` — new `track_http_metrics` middleware extracts the `MatchedPath` template (bounded cardinality, not raw URI) and emits on every response. `/metrics` + `/health` excluded so scrape traffic doesn't dominate.
    - `sws-runtime` crate gains the `metrics` workspace dep.
  - **6.3 Live script test panel** (`runtime-view/RuntimeView.tsx`): new floating 🧪 button bottom-left, visible only when the project defines functions. Opens a small dialog with a function picker, one editable input per declared param (empty falls back to default), Description preview, and a Run button. Reuses the existing `handleScript` dispatcher so output flows to the toast surface and the new `sws_script_exec_total` counter increments. Type coercion mirrors the declared param default's type (`bool`/`number`/`string`). Per-function overrides held in component state — operator can iterate on a single function without retyping.

- **S-27 UX bundle: tree drag&drop + context menu + canvas rulers** (`editor/LeftPanel.tsx`, `canvas/SvgCanvas.tsx`, `store/index.ts`) — three independent UX tasks closed together because they touch overlapping files.
  - **Drag & drop nel tree LeftPanel** (task 1.3): every object row is `draggable`. Drop above/below a sibling reorders within the same group; drop on a group header inserts as last member of that group; drop on the new "⤓ Trascina qui per rimuovere dal gruppo" zone (only visible during a drag) moves the object to the ungrouped tail. Group rows are also draggable for reordering the group list. Blue 2 px indicator bar / inset box telegraphs the landing spot during hover. Store gains `moveObjectAdjacent(objId, targetId, before|after)`, `moveObjectToGroupEnd(objId, groupId|null)`, `moveGroupAdjacent(groupId, targetGroupId|null, place)`. `moveObjectToGroup` now pushes a history entry (was silent).
  - **Context menu** (task 1.4): right-click on an object/group row opens a floating menu pinned to the click position (clamped to the viewport). For objects: Rinomina · Duplica · Sposta in gruppo → (submenu listing every group + "⤓ Senza gruppo") · Raggruppa selezione (only when 2+ objects selected and the right-clicked row is part of the selection) · Elimina. For groups: Rinomina gruppo · Separa gruppo. Auto-closes on click outside or Esc.
  - **Canvas rulers + guide lines** (task 4.2, `canvas/SvgCanvas.tsx`): edit mode now renders 20 px ruler strips along the top and left edges, with adaptive 1/2/5 tick spacing that keeps labels ≥ 50 screen-px apart regardless of zoom. Click-and-drag on a ruler spawns a new guide line on the orthogonal axis. Dragging an existing guide repositions it; releasing with the cursor back over the ruler (line turns red) deletes it. Guides are persisted per-page in `localStorage["sws.canvas.guides.<pageId>"]` — deliberately not in `project.yaml`, since they're an editor convenience, not part of the published synoptic. Object-drag snap pipeline now includes vertical/horizontal guide positions alongside object-edge and page-border candidates (same `8 / zoom` threshold). Corner square `⟂` toggles ruler visibility (state persisted in `sws.canvas.showRulers`); when hidden a small ⟂ icon at the top-left brings them back.

- **Single-page YAML export + import** (`task 7.1+7.3`, `sws-web/router.rs`, `api/client.ts`, `editor/LeftPanel.tsx`) — backup or share an individual synoptic without exporting the whole project ZIP.
  - Backend: `GET /api/synoptics/:name/export` (Viewer+) returns the file as raw YAML with `Content-Disposition: attachment` (Content-Type `application/x-yaml; charset=utf-8`). `POST /api/synoptics/import` (Operator+) accepts raw YAML in the body, allocates a fresh page id (`imported-<unix_ms>`), and resolves filename collisions by appending " (2)", " (3)", … to the page name. Returns `{ id, name, filename }` so the editor can navigate to the import.
  - Frontend: `api.exportSynopticYaml(name)` / `api.importSynopticYaml(yamlText)`. PagesSection rows gain a `⬇` button next to ⧉ for download; PagesSection footer gains a `⬆ YAML` button that opens a file picker. After import the project is reloaded, pages are re-fetched, and the new page becomes current.

- **Real `/metrics` Prometheus endpoint + system status unit tests** (`task 3.4 + 9.2`, `sws-web/metrics.rs`, `sws-web/system.rs`).
  - `sws-web::metrics` installs a process-global `PrometheusHandle` on first call (`OnceLock`-gated, idempotent across tests that rebuild the router). `GET /metrics` now renders Prometheus text exposition v0.0.4 with live gauges sampled per scrape: `sws_uptime_seconds`, `sws_tag_count`, `sws_alarm_active_count`, `sws_alarm_total`, `sws_cpu_usage_pct`, `sws_memory_used_bytes`/`sws_memory_total_bytes`, `sws_disk_used_bytes`/`sws_disk_total_bytes`. No background ticker — cost paid only on actual scrape.
  - `sws-web::system` extracted a pure `compute_system_status(db, alarms, project_dir, started_at)` helper from the handler so unit tests can call it without spinning up the full `AppState` (which needs PyO3 + Python).
  - Tests (sws-web 3 → 8): `compute_system_status_reflects_inputs`, `compute_system_status_no_project_is_none`, `alarm_active_count_includes_only_active`, `install_recorder_is_idempotent`, `render_includes_emitted_gauges`. Workspace `cargo test --workspace` stays green (41 unit tests).

- **Multi-runtime WelcomeScreen** (`ARCH-004`, `sws-web/router.rs`, `api/client.ts`, `ws/wsUrl.ts`, `components/WelcomeScreen.tsx`, `App.tsx`) — same SPA bundle can now connect to any runtime URL (laptop ↔ PX30) without rebuilding.
  - `api/client.ts`: replaced the `const BASE_URL` with a `getBaseUrl()` function that reads `localStorage["sws.runtimeBaseUrl"]` first, then `VITE_RUNTIME_URL`, then falls back to same-origin. Exported `getRuntimeBaseUrl()` and `setRuntimeBaseUrl(url|null)` for the UI.
  - `ws/wsUrl.ts`: uses the same resolution via `getRuntimeBaseUrl()` so WS streams follow the active runtime origin.
  - `WelcomeScreen`: new "📡 Connetti a runtime remoto…" link in the footer opens a `RemoteRuntimeModal` with URL input + `GET /health` test button + Connetti. On Connect: persist the URL in localStorage and `window.location.reload()` (clean reset of auth, project state, WS sockets). The same modal exposes "↺ Torna al locale" when a remote runtime is already set.
  - `App.tsx`: new header pill `📡 host:port` shown whenever the SPA is targeting a non-default runtime; click → confirm + disconnect (clears localStorage + reload).
  - **CORS** (`sws-web/router.rs`): added `CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any)` at the outermost layer. Required for the cross-origin laptop→PX30 case (browser blocks preflight otherwise). Bearer-token auth unaffected — `Allow-Credentials` stays default-false, no cookies. Permissive wildcard is CRA-non-compliant; tighten to an allowlist when the PoC graduates.
  - First-connect gotcha documented in the modal error message: if the remote runtime uses its first-run self-signed cert and the browser has never accepted it, the fetch fails with `TypeError: Failed to fetch` (no informative status). The modal tells the user to open `<URL>/health` in a new tab once to click through the cert warning.

- **Kiosk-mode browser spawn** (`ARCH-003`, `sws-runtime/main.rs`, `docker/entrypoint.sh`, `docs/DEPLOY_PX30.md`) — new CLI arg `--kiosk-browser <shell-cmd>`. After the HTTPS listener is up and `/health` answers OK, the runtime spawns the command (fire-and-forget; child inherits stdio; child death does not stop the runtime). Uses `reqwest` (already in deps) with `danger_accept_invalid_certs(true)` to tolerate the self-signed cert during a 5-second poll (50× 100 ms), then `tokio::process::Command::new("sh").arg("-c").arg(cmd).spawn()`. Stock SWS container does not bundle a browser — operator installs chromium/epiphany/firefox/cage on the host or in a derived image. DEPLOY_PX30 §4c documents the recipe with `chromium --kiosk --no-sandbox --app=URL` as the canonical example.

- **Panel breadcrumb chips are clickable** (`editor/EditorShell.tsx`) — when a grid cell or sub-cell is selected, the canvas covered every pixel of the grid with cells so the user had no canvas-side way to reach the grid's general properties (`grid_rows`, `grid_cols`, position, etc.). `PanelBreadcrumb` now accepts `string | { label, onClick? }` parts: every non-leaf chip with `onClick` becomes a small blue dotted-underline button that clears the matching cell/sub-cell/range state and steps "up" one level. From a cell editor, click the grid label to deselect the cell and see the grid's full `ObjectProps`.

- **Sub-slot auto-select of the parent grid** (`canvas/SvgCanvas.tsx`) — clicking a sub-slot (or its child overlay) was only setting `selectedSubCell`; `selectedObjectId` stayed null and the panel kept showing page properties despite the visual highlight. Both onMouseDown handlers in `renderSubArea` now call `p.onSelect(gridObjId, false)` before `p.onSelectSubCell(...)`. Order matters because `selectObject` clears `selectedSubCell`, so the grid select has to fire first.

- **ObjectProps panel — accordion redesign** (`editor/EditorShell.tsx`) — typical right-side panel was ~900-1100 px tall with ~13 always-expanded sections. New `CollapsibleSection` helper (chevron header + body, state persisted per section via `sws.objprops.<key>` in localStorage) wraps the advanced sections. Always-visible top: Identità (now a compact name + `[type · id]` chip row, ~30 px reclaimed), Posizione, Aspetto + type-specific blocks, Tag. Collapsed by default: Trasformazione, Layer e Visibilità, Indicatore qualità (now always present with a "Imposta un tag…" hint instead of vanishing), Eventi (badge with function count), Binding attivi (badge with count). Dropped redundant `<input type="range">` siblings from rotation/opacity/transition rows (number input + reset button are enough). Typical rect with tag + 1 event: ~480 px collapsed, ~900 px fully expanded.

- **Grid sub-cell recursion** (`types/index.ts`, `canvas/SvgCanvas.tsx`, `store/index.ts`, `editor/EditorShell.tsx`) — `SubCellEntry.sub?: SubGrid` is now allowed, so a slot inside a split cell can be split further (no depth limit). `selectedSubCell` switches from `slot: "a" | "b"` to `path: ("a" | "b")[]`. Two new tree-traversal helpers `updateSubGridAtPath` / `updateSubCellEntryAtPath` produce immutable updates. `splitCell` / `joinSplitCell` / `resizeSubBorder` gain an optional `path` argument. New `updateSubCellAt` action patches sub-cell entry fields. The canvas render goes recursive via a new `renderSubArea` walker; the SvgCanvas-level border-handle emitter walks the tree to emit one 6 px corridor per nested SubGrid. Sub-cell panel branch shows split/join buttons scoped to the entry's path. `resolveSubCellEntry` returns an empty `{}` (not `null`) for valid-but-unmaterialised slots so freshly-split slots are immediately editable. Children inside sub-cells gain a clickable transparent overlay + a teal-dashed selection rect (mirrors regular cell-child UX).

- **Grid object: drag-resize column/row borders + internal snap** (S-23, `canvas/SvgCanvas.tsx`, `store/index.ts`) — when a `grid` object is selected in edit mode, the canvas renders 6 px transparent corridors centred on every interior column/row border. Dragging adjusts the two adjacent track sizes (clamp ≥ 8 px each) while keeping the grid's total span constant. Snap targets are the cumulative positions of the other interior borders of the same grid (threshold `8/zoom px`); cyan snap line reuses the existing `setSnapLines`. Coalesced into one undo entry per drag via the S-22 `openInteraction` bracket.

- **Grid object: shift+click multi-cell selection + merge** (S-23, `canvas/SvgCanvas.tsx`, `store/index.ts`, `editor/EditorShell.tsx`) — store gains `selectedCellRange: { objectId, r1, c1, r2, c2 } | null` (normalised). Shift+click on a second cell of the already-selected grid extends the range; a teal-dashed overlay highlights the union. New `mergeCellRange` action sets `rowspan/colspan` on the top-left origin and drops the other cell entries; validates that pre-existing merges inside the range don't extend beyond it. `unmergeCell` reverts. Panel shows `CellRangeMergeActions` (Unisci celle / Annulla selezione) and `CellStructureActions` (Annulla unione) toolbars when applicable.

- **Grid object: local cell split (1×2 / 2×1)** (S-23, `types/index.ts`, `canvas/SvgCanvas.tsx`, `store/index.ts`, `editor/EditorShell.tsx`) — `GridCell` gains `sub?: SubGrid { orientation: "rows" | "cols", ratio: number, a?: SubCellEntry, b?: SubCellEntry }`. New panel buttons "⬓ Dividi orizzontalmente" / "⬔ Dividi verticalmente" appear on a single unmerged, unsplit cell. `splitCell` action migrates any existing `cell.child` into `sub.a.child`. The renderer detects `cellDef.sub` and draws two sub-slots inside the cell (with their own `bg_color`, `bg_image`, centred child object); a dashed divider line + a 6 px drag corridor on the divider let the user adjust `sub.ratio` (clamped). `joinSplitCell` removes the split and lifts `sub.a.child` (or `sub.b.child`) back to cell level. Selecting a sub-slot opens a dedicated panel for its `bg_color` + `child` (full `ObjectProps`). Recursion into sub-cells intentionally disabled (KISS — the `sub` field naming leaves the door open).

- **Runtime serves the SPA — single-binary deployment** (`ARCH-001`, `sws-web/router.rs`, `sws-runtime/main.rs`, `Cargo.toml`, `compose.yaml`, `docs/DEPLOY_PX30.md`) — new CLI arg `--www <path>`. When set, the runtime mounts `tower_http::ServeDir` as a fallback service so any path not matched by the API/WS routes is served as static. 404s inside ServeDir fall back to `index.html` so the SPA's client-side routing survives a refresh. `tower-http` workspace dep gains the `fs` feature. `compose.yaml` ships commented-out single-container variant; `docs/DEPLOY_PX30.md` documents the alternative deployment shape (no separate Nginx container needed).

- **Configurable runtime URL for the editor** (`ARCH-002`, `vite.config.ts`, `ws/wsUrl.ts`, `ws/tagStream.ts`, `ws/alarmStream.ts`, `ws/logStream.ts`, `scripts/dev.sh`, `scripts/README.md`) — `VITE_RUNTIME_URL=https://px30.local:8443` now influences the Vite proxy target, the `api/client.ts` BASE_URL prefix and the WS URL derivation (with `http→ws` scheme swap). Three previously-duplicated WS URL builders are consolidated into a single `ws/wsUrl.ts` helper. Per-stream overrides (`VITE_RUNTIME_WS_URL`, etc.) remain available for advanced setups.

- **Alarm panel with per-row ACK in RuntimeView** (`6.1`, `runtime-view/RuntimeView.tsx`) — new floating top-right `AlarmPanel` component with a 🔔 toggle button. Badge shows total active count (red border when there are unacked alarms, amber when all acked). Click reveals a dropdown listing every active alarm with severity dot, id, message, and an individual ACK button. A bulk "ACK tutti" button appears when 2+ unacked alarms are present. Live updates via the shared `useAlarmStream` WS singleton.

- **Log export download** (`6.2`, `components/LogPanel.tsx`) — new "⬇ Scarica" button in the LogPanel header writes the currently visible (filtered) events to a `sws-logs-YYYY-MM-DD.jsonl` blob and triggers a browser download. Works in both live mode (date = today) and historical mode (date = the loaded file's date). Disabled when there are no rows to export.

### Changed
- **Drag/resize undo collapses to one entry per gesture** (`4.1`, `store/index.ts`, `canvas/SvgCanvas.tsx`) — added `beginInteraction(label)` / `endInteraction()` store actions that bracket a drag or resize. While an interaction is open, `updateObject` / `updateObjects` skip their per-mutation `pushHistory` call; the bracket captures a single labeled snapshot at the start. Without this, a 200 px drag created 200 redundant undo entries.

- **Copy-paste honours source page** (`4.3`, `store/index.ts`, `editor/EditorShell.tsx`) — `copySelection` now records the source page id alongside the clipboard. `pasteClipboard` reads it: same-page paste keeps the historical `+20 px` offset and preserves `group_id`; cross-page paste lands at the original coordinates and strips `group_id` (groups are per-page, so cross-page references would dangle). `setClipboard(objs, sourcePageId?)` signature extended; all call sites updated. ShortcutHelp annotated "(anche cross-page)".

- **Snap-to-page-border during drag** (`4.4`, `canvas/SvgCanvas.tsx`) — extracted the snap candidate test into `trySnapX` / `trySnapY` helpers. After the object-edge pass, when no nearby object caught the drag, the page's left/center/right (and top/middle/bottom) edges become snap targets at the same threshold. Grid snap remains the last-resort default.

### Fixed
- **alarm.rs unit-test `def()` helper missing `notify_url`** (`sws-core/src/alarm.rs`) — pre-existing test compile failure on origin/main left over from commit `524cc61` (alarm webhook field) — the helper was not updated alongside the public struct, breaking `cargo test -p sws-core`. Added `notify_url: None` and the workspace test suite is green again.

- **Store-based cross-view navigation** (`store/index.ts`, `App.tsx`, `ConfigView.tsx`, `LeftPanel.tsx`) — `appMode` and `configTab` moved from local `useState` to Zustand store. Exported types `AppMode` and `AppConfigTab`. New `navigateToConfig(tab)` action sets both `appMode: "config"` and `configTab` atomically. `SourcesSection` rewritten as a list of clickable source rows with type badge (MQTT/MBUS) and click → `navigateToConfig("protocols")`. ConfigView reads `configTab` from the store as initial state and syncs via `useEffect` when an external navigation occurs.

- **Categorized object palette with icons** (`LeftPanel.tsx`) — the flat `OBJECT_TYPES` array and old `ObjectPalette` component replaced with `PALETTE_GROUPS` (5 accordion categories: Forme, Controlli, Display, SCADA, Layout) and a `PaletteGroupAccordion` component. Each widget type has a colored Unicode icon and label; "Forme" opens by default. Layout unchanged for `EditorShell` (`onAdd` prop untouched).

- **System status tab + backend endpoint** (`sws-runtime`, `ConfigView.tsx`, `api/client.ts`) — `sysinfo = "0.30"` added to workspace. `started_at: std::time::Instant` added to `AppState`. New `sws-web/src/system.rs` with `SystemStatus` struct and `get_system_status` handler. Route `GET /api/system` registered in `operator_routes`. Frontend: `getSystemStatus()` in `api/client.ts`; new tab `"Stato"` in ConfigView with `SystemTab` component — polls every 10 s, shows runtime version, active project, uptime (formatted `Xh Ym`), tag count, sources, active alarms, historian samples, CPU%/RAM/disk progress bars.

- **Visual undo/redo history panel** (`store/index.ts`, `LeftPanel.tsx`) — `HistoryEntry { pages, label }` replaces `SynopticPage[][]` for the `past`/`future` stacks. `HISTORY_LIMIT` raised to 200. `pushHistory(label)` now stores a human-readable action label for each snapshot; all 17+ call sites updated with contextual labels (e.g. `"Aggiungi rect"`, `"Elimina selezione"`, `"Allinea (left)"`). New `jumpToPast(index)` and `jumpToFuture(index)` actions for direct jump to any history step. `undo()` and `redo()` preserve the label when moving entries between stacks. `HistorySection` in LeftPanel replaces `UndoRedoBar`: a scrollable chronological list showing "Stato iniziale", clickable past entries, a "▶ CORRENTE" marker row, and greyed/italic future entries (clickable for redo). Auto-scrolls to the current row on every history change. The ↶/↷ buttons remain at the bottom.

- **User-defined object groups** (`types/index.ts`, `store/index.ts`, `LeftPanel.tsx`, `EditorShell.tsx`, `synoptic.rs`) — `ObjectGroup { id, name }` in types; `group_id?: string` on `SynopticObject`; `groups?: ObjectGroup[]` on `SynopticPage`. Store adds `groupObjects(ids, name?)`, `ungroupObjects(groupId)`, `renameGroup(groupId, name)`, `moveObjectToGroup(objId, groupId|null)`. `ObjectsSection` in LeftPanel rewritten with `buildTree()` that renders a hierarchical tree: collapsible 📁 folder rows (▶/▼ toggle) with member count, click on folder → multi-selects all members in canvas, double-click name → inline rename, ⊔ button to ungroup. A "+ Raggruppa selezionati (N)" button appears above the list whenever 2+ objects are selected. Groups auto-expand when a member is selected. `Ctrl+G` shortcut added (`EditorShell.tsx`) + entry in ShortcutHelp. Rust `synoptic.rs`: `locked` and `group_id` on `SynopticObject`, `groups` on `SynopticPage` — all persisted to YAML.

- **Mouse position display** (`SvgCanvas.tsx`) — in edit mode, the bottom-left corner of the canvas shows `X:NNN Y:NNN` in SVG user-space coordinates, updated live on every `mousemove`.

- **Zoom to fit** (`SvgCanvas.tsx`) — `Ctrl+Shift+0` and the `⊡` button in the top-right corner of the canvas compute the bounding box of all page objects and set zoom + pan to fit them in view with ~40 px of margin. Resets to 100% when the page is empty. (Ctrl+0 continues to reset to 100% without fitting.)

- **Page reorder + duplicate** (`LeftPanel.tsx`, `store/index.ts`) — each page row in the LeftPanel now shows ↑/↓ buttons to move the page up or down in the list (visible only when applicable) and a ⧉ button to duplicate the page. Store: new `reorderPage(id, dir)` and `duplicatePage(id)` actions (both push undo history). The duplicate appears immediately after the original and becomes the active page.

- **Object edge snapping** (`SvgCanvas.tsx`) — when dragging an object, the canvas scans all other objects' bounding boxes (left/center/right on X; top/middle/bottom on Y). If any edge on the dragged object (its own left, center, or right) falls within `8/zoom` px of another object's reference edge, it snaps to that edge. Object-edge snap takes priority over grid snap. Snap guide lines (cyan, 1 px) are shown along the active snap axis and cleared on `mouseup`. Works with all non-line object types.

- **Keyboard shortcut help** (`EditorShell.tsx`) — pressing `?` anywhere (outside an input field) toggles a modal overlay listing all keyboard shortcuts, grouped by category: canvas navigation, selection, editing, z-order. Click outside or ×  to close.

- **Object lock** (`SynopticObject.locked`, `SvgCanvas.tsx`, `EditorShell.tsx`, `LeftPanel.tsx`) — a new `locked?: boolean` field on every `SynopticObject`. When `true` in edit mode the object's `handleMouseDown` returns early — it cannot be clicked, selected, or dragged. A "Bloccato" checkbox (amber accent) appears in the LAYER section of the properties panel. A 🔒 emoji indicator appears in the LeftPanel object list next to the type tag.

- **LeftPanel object filter** (`LeftPanel.tsx`) — a live text filter input above the objects list in the "OGGETTI PAGINA" section. Filters by `name`, `type`, and `id` (case-insensitive substring). The section title always shows the total count. An appropriate empty-state message is shown when the filter matches nothing.

- **Canvas zoom + pan** (`SvgCanvas.tsx`) — full non-destructive zoom/pan for the edit canvas:
  - `Ctrl + scroll wheel`: zoom in/out, centred on the cursor position.
  - `Scroll wheel` (no modifier): vertical pan; `Shift + scroll`: horizontal pan.
  - `Ctrl + 0`: reset to 100% zoom, origin pan.
  - `Middle-click drag` (button 1): free-form pan.
  - All canvas objects live inside `<g transform="translate(panX,panY) scale(zoom)">`. The grid background uses a 100 000 × 100 000 px rect to stay visible while panning.
  - Resize handles and line endpoint handles are scaled by `1/zoom` so they stay pixel-constant on screen.
  - Mouse → SVG user-space via `toSvg(screenX, screenY) = (x − panX) / zoom`; all drag/resize logic updated.
  - A zoom percentage badge is shown in the bottom-right corner when zoom ≠ 100%.
  - The wheel listener is attached via `useEffect` with `{ passive: false }` to allow `preventDefault`.

- **Arrow key nudge** (`EditorShell.tsx`) — in edit mode with a single object selected, the arrow keys move it by 1 px (plain) or by `gridSize` px (`Shift + arrow`). Line objects also update `x2`/`y2` to keep their shape. The handler skips when focus is inside an `<input>` or `<textarea>`.

- **Line endpoint drag handles** (`SvgCanvas.tsx`) — when a line is selected in edit mode, two circles (r=5, white/yellow border) appear at its two endpoints. Dragging p1 updates (x, y); dragging p2 updates (x2, y2). Snap-to-grid applies. `ResizeState.startObj` extended with optional `x2`/`y2` fields; `handleMouseMove` dispatches to the p1/p2 branch before the box-handle branch.

- **Z-order reorder + Ctrl+A select-all** (`EditorShell.tsx`, `store/index.ts`):
  - `ZOrderBar` component in the properties panel (4 buttons: ⬆⬆ primo piano / ↑ avanti / ↓ indietro / ⬇⬇ sfondo). Hidden when only 1 object on the page.
  - Keyboard: `Ctrl+]` → forward, `Ctrl+Shift+]` → front, `Ctrl+[` → backward, `Ctrl+Shift+[` → back.
  - `Ctrl+A` selects all objects on the current page.
  - New store action `reorderObject(id, dir)` with `pushHistory`, splices the object in the `page.objects` array (render order = array order, last = on top).

- **Visual resize handles** (`SvgCanvas.tsx`) — when a single non-line, non-grid, non-rotated object is selected in edit mode, 8 white/yellow squares (8 × 8 px) appear at the bounding-box corners and edge midpoints. Dragging a handle resizes the object in real time via `onMove`: corner handles change both dimensions and position; edge handles change only one dimension. Minimum enforced at 4 px; snap-to-grid applies. Implemented via a new `ResizeState` / `resizeRef` alongside the existing `DragState` — mutually exclusive, no changes in `EditorShell` or the store.

- **Context-sensitive properties panel** (`EditorShell.tsx`) — the right-side panel now shows exactly one level of detail based on what is selected, instead of stacking all levels simultaneously:
  - Grid selected (no cell) → `ObjectProps` for the grid object.
  - Cell selected (no child sub-selected) → `GridCellEditor` for the cell; if a child exists a labelled chip shows its type/name plus ✂ Taglia / ✕ Rimuovi buttons and a hint "clicca nel canvas per modificarne le proprietà".
  - Child sub-selected → `ObjectProps` for the child directly, headed by a `PanelBreadcrumb` showing `griglia › R,C › tipo`.
  - `PanelBreadcrumb`: lightweight inline component (›-separated parts, last part highlighted).
  - `GridCellEditor`: removed the embedded `ObjectProps` and the now-unused `pages` prop.

- **Grid child mouse selection** (`SvgCanvas.tsx`, `store/index.ts`, `EditorShell.tsx`):
  - First click on a grid object selects the cell (yellow dashed highlight, as before).
  - Second click on the embedded child object — when its cell is already selected — sub-selects the child with a teal dashed highlight (`stroke="#0d9488"`).
  - Implemented with a transparent overlay `<rect>` that is only rendered when `isCellSel` is true, so the first click always falls through to the cell hit area.
  - `selectedCell` / `selectedCellChild` migrated from local `useState` in `EditorShell` to the Zustand store. Both fields are cleared in `selectObject`, `clearSelection`, `setCurrentPage`, `undo`, and `redo`. `setSelectedCell` resets `selectedCellChild` whenever the cell identity changes.
  - Keyboard handler (Ctrl+X / Ctrl+V) updated to `useAppStore.getState().selectedCell` (no stale-closure risk, no need for the old `useRef` / `useEffect` pattern).
  - `SvgCanvasProps` and `ObjProps` extended with `selectedCellChild?` / `onSelectCellChild?`; threaded through `SvgObject`.

- **LeftPanel collapsible object tree** (`LeftPanel.tsx`):
  - Each grid object row now shows a `▶/▼` expand toggle (only if the grid has cells with children).
  - Clicking the toggle reveals indented sub-rows, one per cell that has a child object. Each sub-row shows the child's type tag, name, and cell coordinates (R,C).
  - Clicking a sub-row simultaneously selects the parent grid, the cell, and the child (canvas teal highlight + panel `GridCellEditor`).
  - Selecting a child via the canvas auto-expands the grid branch in the tree (a `useEffect` on `selectedCellChild?.objectId` adds the parent id to `expandedGrids`).
  - Selection highlight: teal text `#5eead4` + dark teal background `#0f2922` when the sub-row matches the active `selectedCellChild`.

- **Multi-selection common properties panel** (`EditorShell.tsx`, `store/index.ts`) — when 2+ objects are selected the right panel now shows editable properties instead of only alignment/distribution tools:
  - Same type (e.g. 5 gauges): full `ObjectProps` panel pre-filled with identical values; mixed values show empty + placeholder "(vari)". Any edit applies to all selected objects.
  - Mixed types (e.g. rect + button): `CrossTypeProps` panel with universal sections: POSIZIONE, ASPETTO, TRASFORMAZIONE, VISIBILITÀ, TAG, QUALITÀ, EVENTI.
  - Undo (Ctrl-Z) restores all objects at once via a single `pushHistory` call in the new `updateObjects` store action.

- **Design-reference borders** (`SvgCanvas.tsx`) — in edit mode every object and every grid cell gets a dashed editorial bounding-box overlay (`stroke="#475569"`, `strokeDasharray="4 3"`, `opacity=0.5`, `pointerEvents="none"`). For grid cells the border turns yellow when the cell is selected. These borders are purely editorial — never rendered at runtime.

- **Full child `ObjectProps` in `GridCellEditor`** (`EditorShell.tsx`) — the editing panel for a grid cell child now embeds the complete `<ObjectProps>` component (same as for page-level objects) instead of the previous minimal set. Added `CELL_CHILD_TYPES`, `makeDefaultChild()`, a type dropdown, and an "Aggiungi" button for inserting a new child. The `pages` prop is threaded through `GridCellEditor` for navbutton target selection.

- **Project management from WelcomeScreen** — each project card now shows three icon buttons (✎ rename, ⧉ duplicate, ✕ delete):
  - **Rename**: click ✎ to replace the project name with an inline `<input>`; Enter/Esc/blur confirms or cancels. Backend: `POST /api/projects/:name/rename` (`{ new_name }`) in `sws-web/src/projects.rs`; updates the active project dir pointer if the project was open.
  - **Duplicate**: click ⧉ to reveal a "Nome copia:" row below the card with a text input and ✓/✗ buttons. Backend: `POST /api/projects/:name/duplicate` uses `copy_dir_all` into a new folder; 409 on conflict.
  - **Delete**: click ✕ for `window.confirm`; backend `DELETE /api/projects/:name` returns 409 if the project is currently open. Directory is removed on success.
  - New `axum::routing::delete` import in `router.rs`; all three routes added to the pre-auth `project_lifecycle` layer. New `deleteProject / renameProject / duplicateProject` methods in `api/client.ts`.

- **Quality dot — per-object visibility toggle and custom colours** — `SynopticObject` gains four optional fields:
  - `quality_dot?: boolean` — when `false` the quality-state circle is not rendered (useful for decorative objects or wherever the dot would overlap the widget content). Default: `true` (unchanged behaviour).
  - `quality_dot_good_color?`, `quality_dot_bad_color?`, `quality_dot_uncertain_color?` — override the global defaults (`#22c55e` / `#ef4444` / `#eab308`) per object.
  - `SvgCanvas.tsx`: `qualityColor()` updated to accept optional overrides; `QDot` component extended with three optional colour props; all five render sites (rect/ellipse/text/progress_bar/gauge) now guard with `obj.quality_dot !== false` and pass the colour props.
  - `EditorShell.tsx`: new "INDICATORE QUALITÀ" panel section (shown only when `obj.tag` is set) with a checkbox for visibility and three `<input type="color">` pickers that appear when the checkbox is on. Empty value → placeholder shows global default.
  - `synoptic.rs` (Rust): four new `Option<…>` fields with `skip_serializing_if = "Option::is_none"` for lossless YAML round-trip.

- **Template "Casa Locale" — bug fixes**:
  - DDS661 "Rack Piano Superiore" topic slug corrected from `contatore-rack-piano-superiore` to `contatore-rack-pianosuperiore` (4 topic references in `project.yaml`). The slug was mismatched with the actual device name published by the dds661 tool.
  - Navigation home button ("⌂") moved from `x=340 w=130` to `x=155 w=55` on pages 3, 4, 5 — it was overlapping the centred page title text.

- **Symbol library v2** — visual gallery replaces plain dropdown; 5 new builtin symbols; 7 vendored symbols registered:
  - `SymbolGallery` component: 4-column CSS grid, `maxHeight: 260px` scrollable, each tile shows a 44×38 mini-preview (inline SVG for builtins, `<img>` for vendored/custom), blue border on selection, 8 px label below. Replaces `SymbolSelect` (`<select>`) throughout the ObjectProps panel.
  - New builtin symbols (hand-rolled JSX, 100×100 viewBox): `heat_pump` (hot/cold coil sections + compressor), `temperature_sensor` (stub + circular body + TT tag bubble), `boiler` (steam outlet + vessel + flame), `agitator` (vessel + side motor + shaft + cross impeller; CSS `animation: spin 1s linear infinite` when state=on), `cooling_tower` (trapezoid + fan disk + packing lines + water drops).
  - New vendored entries from existing `public/symbols/` SVGs: `solar_panel`, `battery`, `transmission_tower`, `home_lightning`, `garage`, `window_open`, `roller_shade`.
  - `SYMBOL_LIST = Object.values(SYMBOLS)` exported from `library.tsx` — SymbolGallery imports it instead of maintaining its own list.
  - Total library: 22 symbols (15 builtin + 7 vendored); custom project symbols still appear after library entries.

- **MQTT broker browsing** — "Sfoglia broker" button in each MQTT source card opens a modal that connects ephemerally to the broker, subscribes to `#` for a configurable duration (2–15 s, default 8 s), and lists all observed topics. Each row shows the topic name, a truncated payload preview, and a JSON path dropdown (auto-populated from top-level keys if the payload is valid JSON). Selected topics can be imported as new mapping rows in one click. Backend: new `pub async fn browse()` in `sws-plugin-mqtt` + `POST /api/sources/mqtt/browse` endpoint (Operator+) in `sws-web`. Masked passwords are resolved from the saved project when a `source_id` is provided.
- **Quick-create variable in protocol config** — a "＋" button next to every tag field in MQTT topic mappings and Modbus register mappings opens a `QuickCreateTagModal` (ID, description, type). Created tags are accumulated as `pendingTags` in `ProtocolsTab` and saved (merged with existing tags) on the next "Salva" click. A banner lists pending-tag IDs before save.
- **Responsive layout in Configurazione** — `ConfigView` body no longer caps at `maxWidth: 900`. The entire tab (including protocol cards and topic/register tables) uses the full available width. The "Topic in (subscribe)" column is widened from 26% to 32%; QoS column narrowed to 6% to compensate.

- **Template "Casa Locale"** (`examples/templates/casa-locale/`) — second SWS template: a 5-page home control console for a local MQTT broker. Pages: Panoramica (energy flow + security overview), Impianto Solare (PV gauges + battery SOC + grid exchange), Contatori Energia (3 DDS661 energy meters with gauges and measurement tables), Sicurezza (12 Zigbee door/window sensors + 3 perimeter PIRs + lux), Domotica (4 Shelly roller shutter controllers + heat pump monitoring + ESPHome placeholders). 50+ tags, 4 MQTT sources (Zigbee2MQTT, dds661, Solarman HA bridge, Shelly), 6 alarms. `SETUP.md` includes the HA automation YAML for the Solarman→MQTT bridge. `CREDITS.md` lists all data sources.
- **8 new SVG icons** (`sws-editor/public/symbols/`) — Material Design Icons (Apache 2.0 / Pictogrammers): `solar-panel.svg`, `solar-power-variant.svg`, `battery-charging-high.svg`, `transmission-tower.svg`, `home-lightning-bolt.svg`, `garage-open-variant.svg`, `window-open-variant.svg`, `roller-shade.svg`. All pre-colored for dark-background dashboards. `ATTRIBUTION.md` updated.

- **Page dimensions** — `SynopticPage` gains optional `width` and `height` fields. When set, the editor canvas renders a dashed blue boundary rect at `(0,0,width,height)` in SVG space. The `PageProps` right-panel now exposes two number inputs (Larghezza/Altezza) with empty = fluid. Both fields are persisted in YAML via the Rust `SynopticPage` mirror.

- **Grid layout object** (type `"grid"`, Session 1) — A new object type for designing tabular layouts:
  - Configurable rows/columns (`grid_rows`, `grid_cols`), optional per-column widths and per-row heights.
  - Per-cell properties: `bg_color`, `bg_image` (URL), static `visible`, tag-driven `visible_tag`, `on_press_fn` / `on_release_fn` Python hook bindings, `rowspan` / `colspan` for cell merging.
  - `grid_show_borders` (default true) — when false the grid is invisible at runtime (no borders/background) while children remain visible. Useful as a layout-only container.
  - Two-level hit-testing in the canvas: clicking anywhere on the grid selects it; clicking inside a cell selects both the grid and the cell, revealing a `GridCellEditor` section in the right-side properties panel.
  - `GridCellEditor` panel: bg color, bg image URL, visibility (static + tag), on_press/on_release function pickers, rowspan/colspan.
  - Object palette button: "+ Griglia" in LeftPanel.
  - `store/index.ts`: `updateGridCell(pageId, objectId, cell)` upserts a cell by `{row, col}` in `grid_cells`; `updatePageProps` extended to include `width`/`height`.
  - Rust `synoptic.rs` mirrors all new fields (`grid_rows`, `grid_cols`, `col_widths`, `row_heights`, `grid_cells`, `grid_show_borders`, `grid_border_color`) as `Option<Value>` for round-trip YAML persistence.
  - Session 2: `GridCell.child?: SynopticObject` — an inline object rendered centered in its cell. In edit mode the child is non-interactive (`pointerEvents: none`); in runtime mode it is fully interactive (tag writes, script calls, navigation). Cut/paste workflow: Ctrl+X on a selected cell with a child cuts the child to the clipboard; Ctrl+V when a cell is selected pastes the first clipboard item as the cell child. Both operations also work in reverse (Ctrl+X page object → Ctrl+V into cell, and vice versa). `GridCellEditor` displays child type + a "Rimuovi" button and a paste hint when no child is present. New store action `setClipboard(objs)` to set the clipboard directly without going through a selection.

- **Script output toast** (`RuntimeView`) — when an `on_press_fn` / `on_release_fn` produces stdout, stderr, or fails (including timeout), a card toast appears bottom-right over the canvas. Auto-closes after 5 s (success) or 10 s (error). Manual × dismiss. Stacks up to 4 cards. stdout in white, stderr in amber, errors in red. Silent success (no output) generates no toast.

- **Script preemption** (`sws-pyscript`) — Python infinite loops are now interrupted at runtime:
  - New `KillSwitch` PyO3 class (`is_set()` → `AtomicBool::load`) injected as `__sws_kill_switch__` into every script run.
  - `sys.settrace` installs a per-bytecode-boundary trace function that calls `is_set()`. Cost: one atomic load per Python call/line/return event.
  - A `std::thread::spawn` timer thread flips the switch after `SWS_SCRIPT_TIMEOUT_MS`.
  - On detection, `KeyboardInterrupt` is raised; the inner `except KeyboardInterrupt` clause in the harness turns it into a clean `TimeoutError: script exceeded the configured timeout` error string.
  - `sys.settrace(None)` in a `finally` block ensures the trace is always cleared on exit, leaving the `spawn_blocking` pool thread in a sane state.
  - Limitation: blocking C extensions (`time.sleep`, network I/O in C code) are not preempted by the trace. The existing Tokio-level `timeout` remains as the hard backstop for those cases.

- **`RuntimeUnavailableError`** (`api/client.ts`) — distinguishes "runtime not running" from "wrong password":
  - `request()` now wraps `fetch()` in a try/catch; a network error (`TypeError: Failed to fetch`) or a 502/504 gateway response throws `RuntimeUnavailableError` instead of propagating raw.
  - `LoginScreen` shows "Runtime non raggiungibile. Avvia ./scripts/dev.sh e riprova." instead of "Credenziali non valide." when the runtime is unreachable.
  - `ReAuthModal` shows "Runtime non raggiungibile." for the same case.

- **Re-auth modal** — when the Bearer token expires mid-session a modal overlay "Sessione scaduta" appears over the editor instead of redirecting to the full login screen. The user re-enters only their password (username pre-filled from the store). On success the new token is stored and the editor state is preserved. On dismiss the session is cleared and the normal LoginScreen is shown.
  - `api/client.ts`: fires `sws:session-expired` CustomEvent when a request returns 401 and a token was present.
  - `store/index.ts`: new `reAuthNeeded: boolean` flag and `setReAuthNeeded()` action.
  - `App.tsx`: listens for the event and sets `reAuthNeeded`; renders `<ReAuthModal>` overlay.
  - New `components/ReAuthModal.tsx`.

- **Alarm webhook notifications** — `AlarmDef` gains `notify_url?: string`. When an alarm transitions to ACTIVE and `notify_url` is set, a best-effort HTTP POST is fired within 5 s (reqwest 0.12, rustls-tls). Payload: `{id, message, severity, tag, ts_ms, value}`. Errors are logged as warnings (never fatal). UI: `ConfigView` shows a URL input below the message field in the alarm table row.
  - `reqwest 0.12` added to workspace and `sws-runtime` Cargo.toml (rustls-tls + json features).
  - Alarm webhook dispatcher task spawned in `sws-runtime/main.rs` (subscribes to `AlarmDb.subscribe()` broadcast).

- **Log file v2** — historical log browser in the log panel:
  - `GET /api/logs/files` (Operator+): lists `runtime-YYYY-MM-DD.jsonl` files in `logs_dir` sorted newest-first with `size_bytes`.
  - `GET /api/logs/file?date=YYYY-MM-DD` (Operator+): reads a historical JSONL file and returns `Vec<LogEvent>`.
  - `AppState` gains `logs_dir: Arc<PathBuf>`; passed from `main.rs`.
  - `LogPanel` updated: when log files exist a date dropdown + "Carica" button appear. Loading a file enters "hist mode" (amber header, static source). "← Live" returns to the ring buffer and refreshes the file list. All filters (levels, search, target) apply to historical data.

- **Historian v2** (`sws-historian`):
  - SQLite fallback for `query()`: when `from_ms` precedes the oldest in-memory sample, the missing range is fetched from SQLite (`store.query_range()`) and prepended — trend widget can now scroll back beyond the ring-buffer window.
  - Uniform-stride decimation: when a query returns > 1 000 samples the result is thinned to exactly 1 000 points (first and last always preserved) to keep trend rendering fast for wide time windows.
  - `Historian::prune_older_than_ms(cutoff_ms)`: deletes SQLite rows outside the retention window (no-op when no store is attached). 7 unit tests in `sws-historian`.
  - Runtime prune task in `sws-runtime/main.rs`: spawned after the recorder, runs once at startup then every 24 h. Retention controlled via `SWS_HISTORIAN_RETENTION_DAYS` (default 30).
- **Selection rectangle** (`SvgCanvas.tsx`):
  - Drag on empty canvas background (left-button, edit mode only) draws a blue dashed selection rect overlay.
  - On release, all objects whose bounding boxes intersect the rect are selected (`onSelectMany`). Lines use the AABB of their two endpoints.
  - A `suppressClick` ref prevents the SVG `onClick` from deselecting immediately after a successful rect-selection completes.
  - Wired via `onSelectMany` prop → `store.selectMany()` in `EditorShell.tsx`. Compatible with existing shift-click multi-select flow.

- **Multi-Project IDE — Phase A2 (upload ZIP)**:
  - Backend: `POST /api/projects/upload` (pre-auth). Accetta body `application/zip`, legge `manifest.json` per il nome (sovrascrivibile con `?name=`), estrae il contenuto in `projects_root/<name>/`. Rifiuta path traversal. Rollback su errore. 201 `{"name"}` o 409.
  - Frontend: `api.uploadProjectZip(file, name?)` + terzo tab "Da ZIP" nella `NewProjectModal` (file picker, nome auto-filled, fallback al manifest).

- **Multi-project IDE — Phase A1 frontend complete**:
  - `NoProjectError` in `api/client.ts`: 503 dal runtime (nessun progetto aperto) diventa un errore tipizzato che il mount flow di `App.tsx` gestisce in modo dedicato.
  - Nuovi metodi API in `api/client.ts`: `listProjects()`, `createProject()`, `openProject()`, `closeProject()`, `listTemplates()`. Tutti pre-auth (nessun token richiesto).
  - Nuovi tipi `ProjectListEntry` e `TemplateEntry` in `types/index.ts`.
  - `noActiveProject: boolean` nello store Zustand + `setNoActiveProject()`.
  - `WelcomeScreen` (`components/WelcomeScreen.tsx`): lista dei progetti con ultima modifica, click per aprire, modal "+ Nuovo progetto" con due tab (Vuoto / Da template — la seconda mostra i template da `GET /api/templates`). Dopo `openProject()` il backend invalida tutte le sessioni → l'utente viene mandato alla LoginScreen.
  - `App.tsx` mount flow aggiornato: al boot chiama `GET /api/project` — 503 → WelcomeScreen (clearAuth), 401 → LoginScreen, 200 → app normale. Compatibile con `--project` legacy (il progetto è già aperto al boot, comportamento invariato).
  - `MainMenu` aggiornato: nuovi item "Chiudi progetto" (chiama `/api/projects/close` + redirect a WelcomeScreen) e separatore sopra "Esci".

- **Multi-project IDE — Phase A1 backend complete (frontend ancora vecchio, UI welcome rinviata)**:
  - `sws-runtime` nuovi CLI args: `--projects-root <dir>` (default `/var/sws/projects`), `--templates-root <dir>` (default `/var/sws/templates`). Il flag legacy `--project <path>` ora è opzionale: quando valorizzato fa auto-open di quel progetto al boot (backwards compat per dev.sh e container operator).
  - `AppState.project_dir` da `Arc<PathBuf>` immutabile a `Arc<RwLock<Option<PathBuf>>>` (nuovo type alias `ActiveProjectDir`). Helper `active_dir(state) -> Result<PathBuf, StatusCode>` usato in tutti i handler che leggevano `state.project_dir`: returnano 503 SERVICE_UNAVAILABLE quando nessun progetto è attivo.
  - Nuovi endpoint pre-auth (montati nel layer "open" insieme a `/health` e `/api/auth/login`):
    - `GET /api/projects` → lista cartelle in `projects_root` con `project.yaml` dentro (per la WelcomeScreen).
    - `POST /api/projects` body `{ name, template? }` → crea cartella sotto `projects_root`. Se `template` è valorizzato copia ricorsivamente da `templates_root/<id>/`, altrimenti scrive un `project.yaml` minimo. 409 se esiste già, 400 su nomi invalidi.
    - `POST /api/projects/:name/open` → switch progetto in-process: TagDb.clear + populate, AlarmDb.load, supervisor.reload, functions registry swap, AuthState.swap_store. Tutti i token correnti vengono invalidati (force re-login).
    - `POST /api/projects/close` → libera tutto: TagDb.clear, AlarmDb load([]), supervisor.reload([]), functions clear, AuthState.clear.
    - `GET /api/templates` → lista subfolders di `templates_root` con metadata da `<dir>/template.yaml` (id + label + description).
  - Nuovi moduli `sws-web/src/projects.rs` e `sws-web/src/templates.rs` + helper `copy_dir_all` (skip-list per `template.yaml`) + `safe_project_name` (rifiuta vuoti, `.`, `/`, `\\`, traversal, >64 chars).
  - `sws-auth::AuthState` esteso con `swap_store`, `clear`, `empty` per supportare lo switch project senza ricreare l'Arc.
  - `sws-core::TagDb::clear()` per resettare i tag a sufficienza.
  - `scripts/dev.sh` migrazione automatica `.run/project/` → `.run/projects/dev/` + nuovi flag `--projects-root` / `--templates-root` al runtime. L'auto-open su `dev` resta (backwards compat per il workflow esistente).
  - 33 unit test workspace (3 nuovi: 2 per `safe_project_name`, 1 per `copy_dir_all`).
  - **Frontend ancora invariato**: usa le rotte legacy. La WelcomeScreen + entry "Apri/Chiudi progetto" nel MainMenu arrivano nella prossima sessione (Phase A1 completion). Upload ZIP da PC in Phase A2.

### Changed
- **Multi-project IDE — Phase A1 foundations (prep, niente UI nuova ancora)**:
  - `examples/demo/` → `examples/templates/demo-items/` (git rename). Aggiunto `template.yaml` con `{ id, label, description }` per la futura template gallery.
  - `examples/README.md` riscritto per documentare la nuova convenzione `examples/templates/<id>/`.
  - `scripts/dev.sh` aggiornato per seedare da `examples/templates/demo-items/` (escludendo `template.yaml`). Layout `.run/project/` invariato — la migrazione `.run/projects/dev/` arriva nella prossima sessione insieme alla welcome screen.
  - `sws-core::TagDb` — nuovo metodo `clear()` per svuotare tutti i tag (usato dal project switch su `open`/`close`).
  - `sws-auth::AuthState` — esteso per supportare project switching:
    - `store_path: Option<PathBuf>` → `RwLock<Option<PathBuf>>` per swap in-place.
    - Nuovo `swap_store(new_path, seed)` che retarget il `users.yaml` su un altro progetto, invalida tutte le session correnti (force re-login), e ricarica utenti.
    - Nuovo `clear()` per chiudere lo stato auth quando nessun progetto è attivo.
    - Nuovo `empty()` costruttore per AppState in "no active project" mode.
  - Nessuna API esposta cambiata in questa sessione — l'integrazione con `AppState` / nuovi endpoint `/api/projects/*` / `WelcomeScreen` segue nelle sessioni successive.

### Changed
- Demo `examples/demo/synoptics/{Page 1..Page 4}.yaml` riscritte con id stabili (`page1`/`page2`/`page3`/`page4`) e header di navigazione uniforme: ogni pagina ha due `navbutton` `◀ Precedente` / `Successiva ▶` in cima con `target_page` che realizza nav circolare (1↔2↔3↔4↔1) + un `text` con titolo pagina. Risolve il problema della Page 3 duplicata (`Page 3.yaml` + `Page 3 – Showcase.yaml` con stesso id) e dei navbutton orfani che puntavano a id random non più esistenti. Il widget `p3_navbutton` (showcase del tipo navbutton) ora punta correttamente a `page1`.

### Added
- `sws-editor`: **animazione opzionale dei binding** — nuovo campo per-oggetto `transition_duration_ms` (0..5000 ms, default 0 = disattivata). Quando > 0, le modifiche bindate ai prop CSS-animabili (`fill`, `stroke`, `opacity`, `transform`/rotation) interpolano linearmente con easing `ease-out` invece di fare il "jump" istantaneo. Slider + numeric + reset nella sezione TRASFORMAZIONE di ObjectProps, sezione "DURATA TRANSIZIONE" in `MultiSelectionProps` per applicarla in batch su più oggetti selezionati. Rust mirror `transition_duration_ms: Option<u64>` su `SynopticObject` (serde, `skip_serializing_if`). Limitazioni v1: prop non-CSS-animabili (testo, font_size, src image, x/y come attributi SVG raw, gauge needle angle, progress_bar width) restano discreti; rotation 360°→0° interpola attraverso 180° (no shortest-path).
- `sws-editor`: menu a tendina **"☰ Menu"** nell'header (sempre visibile) — Salva tutto (solo edit, con feedback cromatico: grigio/verde/rosso a seconda dello stato), Esporta progetto, Importa progetto (Admin), Esci. Lo stato del salvataggio (`saveSerial`/`saveStatus`/`saveError`) è spostato nel Zustand store così il pulsante riflette la risposta senza prop drilling.
- `sws-editor`: menu a tendina **"Griglia"** nell'header (solo modalità edit) — selettore dimensione (Off/5/10/20/40 px) e checkbox snap. Sostituisce le impostazioni griglia che erano nel fondo del LeftPanel.
- Demo: **Page 3 "Showcase"** completa con un esemplare di ogni tipo di widget (rect, ellipse, line, text, button, navbutton, led, progress_bar, gauge, slider, checkbox, radio, table, symbol, image) e tag demo.* multipli (`demo.visible`, `demo.on`, `demo.value`, `demo.color`, `demo.font_size`, `demo.min`, `demo.max`) aggiornati in `examples/demo/project.yaml`. Ogni widget ha bindings su almeno rotation, opacity e una proprietà tipo-specifica.

### Fixed
- `sws-editor`: oggetti `symbol` non selezionabili nell'area di lavoro quando aggiunti dal pannello sinistro. Causa: `<g>` SVG non genera un bounding box per pointer events e tutti i figli visivi avevano `pointerEvents: "none"`. Fix: rimosso `onMouseDown` dal `<g>`, aggiunto `<rect fill="transparent">` come hit-area con le stesse dimensioni del bounding box (stesso pattern già usato per il gauge). Ora i simboli sono selezionabili, draggabili e ridimensionabili da qualsiasi punto del bounding box.
- `sws-editor` `BindableInput`: il pulsante 🔗/🔓 non era cliccabile nelle celle strette di layout a 2 colonne (es. X/Y/W/H). Causa: la cella sorella (successiva nel DOM, stesso stacking context statico) copriva l'eventuale overflow del pulsante intercettandone i click. Fix: `position: relative; zIndex: 1` sul button — crea un positioned element con z-index > 0 che sovrasta le celle statiche adiacenti.

### Fixed (previous session)
- `sws-editor`: il bottone "Salva" del LeftPanel salvava SOLO la pagina synoptic corrente, ignorando tag/sources/alarms/funzioni Python/custom_symbols + tutte le altre pagine. Modifiche fatte nel `FunctionEditor` o nelle altre pagine andavano perse silenziosamente se l'utente cliccava "Salva" senza essere passato dalla tab specifica di ConfigView / dal bottone "Salva funzioni". Ora "Salva tutto" persiste in parallelo: ogni `SynopticPage` + (se Admin) `PUT /api/project/{tags,sources,alarms,functions,custom-symbols}` via `Promise.allSettled` con feedback chip "Salvataggio…" / "✓ Salvato" / "❌ Errore — clicca per ritentare" + tooltip con il dettaglio dell'errore.

### Added
- `sws-editor`: cross-cutting `rotation/flip_h/flip_v/opacity` su rect, ellipse, text, image, gauge, led, progress_bar, table, button, navbutton, symbol. Sezione "TRASFORMAZIONE" nell'ObjectProps panel (slider + numeric + reset per rotazione/opacità, checkbox flip). `applyTransform` helper in `SvgCanvas`; selection rect e quality dot restano axis-aligned.
- `sws-editor`: `bindings: Record<string, string>` su `SynopticObject` — mappa generica prop→tag per binding live a runtime. `resolveObject` in `SvgCanvas` sovrascrive i valori statici con il valore live del tag al momento del render.
- `sws-runtime`: campi `opacity` e `bindings` su `SynopticObject` Rust (serde round-trip, skip_serializing_if per compattezza YAML).
- `sws-editor`: componente `BindableInput` — toggle 🔗/🔓 accanto a ogni campo del pannello proprietà. Click sul lucchetto aperto mostra un `TagInput` per associare la proprietà a un tag live; il lucchetto chiuso rimuove il binding. Sezione "BINDING ATTIVI" in fondo al pannello mostra tutti i binding attivi del widget con pulsante × per rimozione rapida.
- Demo: Page 2 welcome (id `mp472aq9q3yzc` — fixa il navbutton orfano in Page 1) + Page 3 "Demo Binding" (oggetti rect/ellipse/text/button/navbutton/led/gauge/progress_bar/image/symbol/table con `bindings.rotation=demo.rotation` e `bindings.opacity=demo.opacity`; 2 slider per pilotarli). 4 nuovi tag: `demo.rotation`, `demo.opacity`, `demo.label`, `demo.fill_color`.
- `sws-editor`: `BindableInput` copertura completa — tutti i campi rimanenti ora hanno il toggle, inclusi x/y/width/height/x2/y2, font_family, soglie gauge e progress_bar (warn_low/warn_high/alarm_low/alarm_high), slider min/max/step, checkbox/radio/LED label, trend (window_s/y_min/y_max/line_color), colori stato symbol, z_index.
- `sws-editor`: sezione "BINDING RAPIDO" in `MultiSelectionProps` — select prop + TagInput + "Applica"/"Rimuovi" per applicare o togliere lo stesso prop→tag binding a tutti gli oggetti multi-selezionati in un click.
- Demo `Page 4` — "Fill Color": 6 pulsanti preset (rosso/verde/blu/arancio/viola/teal) che scrivono un hex string in `demo.fill_color`; rect/ellipse/button/progress_bar con `bindings.fill = demo.fill_color`; nav da Page 3 → Page 4.

### Fixed
- `sws-editor` `BindableInput`: il pulsante 🔗/🔓 non era cliccabile nelle celle strette di layout a 2 colonne (es. X/Y/W/H). Causa: la cella sorella (successiva nel DOM, stesso stacking context statico) copriva l'eventuale overflow del pulsante intercettandone i click. Fix: `position: relative; zIndex: 1` sul button — crea un positioned element con z-index > 0 che sovrasta le celle statiche adiacenti.
- `sws-editor`: rotation + flip per gli oggetti `symbol`. Sezione properties con slider -180°/+180° + numeric input + reset, checkbox flip orizzontale/verticale. Trasform SVG applicata solo al visual del simbolo (selection rect e status badge restano axis-aligned per leggibilità). Persistenza YAML round-trip garantita dai nuovi campi `rotation/flip_h/flip_v` sul `SynopticObject` Rust.
- `sws-editor`: rinomina pagine — doppio click sul nome o icona ✎ apre input inline; Enter conferma, Esc annulla. Conferma sul × delete con messaggio "annullabile con Ctrl-Z" che richiama l'undo già esistente.
- `sws-editor`: navbutton con `target_page` puntante a pagina eliminata → bordo rosso del select + chip warning "⚠ pagina inesistente: <id>" + testo esplicativo. Prima sparivano silenziosamente; ora sono visibili e correggibili.

### Fixed (continued)
- `sws-runtime`: pannello log sempre vuoto da quando è stato introdotto. `EnvFilter::from_default_env()` con `RUST_LOG` non settata torna un filtro vuoto che rifiuta TUTTI gli eventi → niente arrivava al `LogBus`, niente al pannello, niente sul disco (anche il `stdout` capture di `dev.sh` era 0 byte e nessuno lo notava). Fix: fallback a `EnvFilter::new("info")` quando l'env var manca. Override via `RUST_LOG=debug` etc. continua a funzionare.
- `sws-editor`: il pannello log mostrava solo `target` e `message`, scartando i `fields` strutturati (es. la riga "MQTT publish" perdeva `tag`, `topic`, `payload`). Ora i fields appaiono come chip `key=value` inline dopo il messaggio; sono inclusi anche nella ricerca testuale.
- `sws-plugin-mqtt`: aggiunto `debug!` su match in entrata con `tag/topic/value` → con `RUST_LOG=sws_plugin_mqtt=debug,info` (o `RUST_LOG=debug`) si vede ogni payload ricevuto, non solo quelli pubblicati. Topic non mappati restano a livello `trace` per non spammare.

### Added
- `sws-runtime`: persistenza log su file con rotazione giornaliera. Nuovo modulo `log_file` che si sottoscrive a `LogBus` (broadcast) e scrive ogni evento come riga JSONL in `<logs_dir>/runtime-YYYY-MM-DD.jsonl`. La directory default è `<project>/../logs` (sibling del project dir), override via flag CLI `--logs <path>`. Retention configurabile via `SWS_LOG_RETENTION_DAYS` (default 7 giorni); i file più vecchi del cutoff vengono eliminati allo startup. Formato file = identico al wire format di `GET /api/logs` / `WS /ws/logs`, così `cat runtime-*.jsonl | jq .` mostra lo stesso shape che vede il pannello log dell'editor. Errori del writer escono su stderr per evitare feedback loop attraverso il subscriber tracing. Una nuova dipendenza workspace (`time` 0.3, già presente come transitive). 4 unit test (date_from_ts_ms, date_minus_days con leap year + year boundary, prune_old, writer end-to-end via TestDir helper RAII).
- `sws-editor`: widget `image` abilitato in palette — campo URL in properties panel, rendering `<image>` SVG già funzionante
- `sws-editor`: tab "Risorse" in ConfigView — aggiunta/rimozione simboli SVG custom con registrazione obbligatoria licenza (CC0/CC-BY/Apache-2.0/MIT/BSD/Public domain), autore e fonte
- `sws-core`: tipo `CustomSymbol { id, label, url, attribution }` + campo `custom_symbols` in `Project`; incluso in export/import ZIP
- `sws-web`: `PUT /api/project/custom-symbols` (Admin-only) — persiste in `project.yaml`
- `sws-editor`: `SymbolSelect` component con gruppo `<optgroup>` "Simboli progetto" che mostra i simboli custom accanto ai 15 built-in
- `sws-editor`: `SvgCanvas` accetta prop `customSymbols`; simboli con `symbol_id: "custom:<id>"` renderizzati come `<image href>` con badge stato

### Fixed
- `sws-editor`: gauge non selezionabile/draggabile — aggiunto `<rect fill="transparent">` come hit-area nel bounding box del gauge (il `<g>` SVG non riceve eventi se tutti i figli hanno `pointerEvents: none`)


- Monorepo scaffold: `sws-runtime/` (Rust workspace) and `sws-editor/` (Vite + React)
- Community files: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY
- GitHub Actions CI pipeline with DCO check, lint, build, test, SBOM, audit
- GitLab CI mirror pipeline
- Architectural Decision Record 0001: state management choice (pending)
- `sws-core`: in-memory `TagDb` (Arc<RwLock<HashMap>> + tokio broadcast), `TagValue` serializes as native JSON (`#[serde(untagged)]`)
- `sws-core`: YAML project loader (`project.yaml`) with Modbus TCP source mapping
- `sws-plugin-modbus`: Modbus TCP polling driver with reconnect loop, marks tags Bad on disconnect
- `sws-web`: REST API — `GET/PUT /api/tags/:id`, `GET /api/tags`, `GET/PUT /api/synoptics/:name`, `GET /api/synoptics`; WebSocket stream `GET /ws/tags`
- `sws-runtime`: HTTPS server on 0.0.0.0:8443 with self-signed TLS via rcgen, project loading, graceful shutdown
- `sws-editor`: full IDE shell — rect/text/button objects, drag-to-move, property panel, page tab bar, Save button (PUT synoptic), load synoptics on mount, quality indicator dots, tag write via button click in view mode
- `sws-editor`: complete object palette — ellipse, line (with endpoint drag), navbutton (page navigation)
- `sws-editor`: canvas SVG grid with configurable size and snap-to-grid
- `sws-editor`: LeftPanel project tree — pages, object palette, live tag browser with quality dots, protocol source viewer
- `sws-editor`: page properties panel (name, background color) when no object selected
- `sws-editor`: RuntimeView operator page-navigation tab bar
- `sws-web`: `GET /api/project` endpoint exposes full project JSON (meta + tags + sources)
- `sws-web`: SynopticObject extended with x2, y2, stroke, stroke_width, target_page; SynopticPage gains background field
- `sws-web`: `PUT /api/project/tags` and `PUT /api/project/sources` — update respective sections in project.yaml (creates file if absent)
- `sws-editor`: ConfigView with two tabs — Variabili (tag CRUD with live value column) and Protocolli (Modbus TCP CRUD with inline register mapping table)
- `sws-editor`: "Configurazione" mode added to header alongside Editor and Runtime
- `sws-editor`: 7 new synoptic object types — gauge (270° arc, threshold ticks, needle), slider (HTML range in view mode), checkbox (on/off value binding), radio (dynamic option list), LED (glow ring), progress_bar (threshold markers), table (per-row tag/format/label)
- `sws-editor`: LeftPanel palette updated with all new types; EditorShell with per-type defaults and property sections; RadioOptionsEditor and TableRowsEditor inline sub-components
- `sws-editor`: reusable `TagInput` component (text input + `<datalist>`) suggesting project-defined tag IDs; wired into all ObjectProps tag fields, TableRowsEditor rows, and ModbusSourceCard register mappings
- `sws-core`: `TagDef.data_type` field (`bool` / `int` / `float` / `string`, default `float`); `populate_tags()` seeds the matching `TagValue` variant at startup
- `sws-editor`: Variabili tab gains a "Tipo" column with a per-tag type selector (Bool/Int/Float/Stringa)
- `sws-plugin-mqtt`: subscribe loop using `rumqttc::AsyncClient` — exact-topic match, automatic 5 s reconnect, payload decoded as bool/int/float/string heuristically or via optional dot-separated `json_path`
- `sws-core`: `SourceDef::Mqtt` variant with `MqttConfig { id, host, port, client_id, topics }` and `TopicMapping { tag, topic, json_path? }`
- `sws-runtime`: spawns one MQTT task per `mqtt` source on startup, alongside Modbus
- `sws-editor`: `MqttSourceCard` in Protocolli tab (host/port/client_id + topic↔tag mapping table with TagInput dropdown and optional JSON path); LeftPanel SourcesSection renders MQTT topics; "+ Aggiungi MQTT" button activated, "+ MQTT (prossimamente)" placeholder removed
- `sws-core`: `TagWriteBus` — registry routing `(TagId, TagValue)` writes via mpsc to the plugin that owns the tag; `WriteError::{NoWriter, ChannelClosed}`; unit-tested
- `sws-plugin-modbus`: `run()` now also accepts the bus; `session()` selects between the poll ticker and the write receiver; writes apply inverse scale + range clamp, call `write_single_register`, and echo the new value into `TagDb` on success
- `sws-web`: `PUT /api/tags/:id` first tries the bus → `202 Accepted` if a plugin owns the tag, falls back to direct `TagDb` set for virtual tags (`204`), returns `503` if the plugin channel is closed
- `sws-core`: new `alarm` module — `AlarmDef`, `AlarmCondition::{Above, Below, BoolEquals}`, `AlarmSeverity::{Info, Warning, Critical}`, `AlarmState`, `AlarmDb` (storage + tokio broadcast). Unit-tested: fire/clear/ack-reset/bool conditions
- `sws-core`: `Project.alarms: Vec<AlarmDef>` (`#[serde(default)]`, backwards compatible with existing `project.yaml`)
- `sws-runtime`: builds an `AlarmDb`, loads it from `project.alarms`, and spawns an evaluator task that consumes `TagDb` broadcasts and re-evaluates the alarms watching each tag
- `sws-web`: `GET /api/alarms`, `POST /api/alarms/:id/ack`, and `WS /ws/alarms` (snapshot-then-stream, same shape as `/ws/tags`)
- `sws-editor`: `useAlarmStream` hook, alarms in Zustand store, live `AlarmBanner` showing active/unacknowledged counts, severity-coloured tint, most-recent unack message, inline ACK button
- `sws-core`: `TagDef::initial_value()` helper (shared by startup `populate_tags` and hot-reload), `TagDb::remove()` to evict orphan tags
- `sws-web`: tag hot-reload — `PUT /api/project/tags` now diffs the new list against the current `TagDb`: new tags get seeded, removed tags get evicted, existing tags keep their live state. No runtime restart needed for tag CRUD.
- `sws-web`: `PUT /api/project/alarms` with alarm hot-reload — full `AlarmDb::load` after persist. In-flight active alarms reset and are re-evaluated on the next tag update.
- `sws-editor`: ConfigView gains an "Allarmi" tab with CRUD over `AlarmDef` (id, tag with TagInput autocomplete, condition kind, threshold/bool, severity, message) and a live state column (ON / ACK / —). `SaveBar` notice now distinguishes hot-reload tabs ("modifiche applicate immediatamente") from the Protocolli tab (still requires restart for sources).
- `sws-historian`: in-memory `Historian` ring-buffer per tag (5000 samples PoC default) with `record()`, `query(from, to)` and `spawn_recorder()` that subscribes to `TagDb` broadcasts. Unit-tested: range query, ring drop, unknown tag.
- `sws-web`: `GET /api/history/:tag?from=&to=&limit=` returns `Vec<Sample>` (ts_ms + value + quality)
- `sws-runtime`: builds the Historian and starts its recorder alongside the alarm evaluator
- `sws-editor`: new `trend` SynopticObject — line chart in a `<foreignObject>` rendering an HTML canvas. Properties: `tag`, `window_s`, optional `y_min`/`y_max` (autofit when both zero), `line_color`. In edit mode shows a static placeholder; in runtime polls `/api/history` every 2 s and redraws. Added to LeftPanel palette and EditorShell defaults/property panel.
- `scripts/dev.sh`: one-stop local-dev launcher — creates writable `.run/{config,project,logs}` under the repo root, seeds an example `project.yaml` (two tags + one alarm), builds + starts the runtime, and launches the Vite dev server. Modes: `both` (default) / `runtime` / `editor`. Documented in `scripts/README.md`.
- `.gitignore`: ignore `/.run/` (local dev state — TLS cert, project, logs)
- `CLAUDE.md`: points to `scripts/dev.sh` so future sessions know how to bring the stack up

### Changed
- `sws-editor`: `tagStream` and `alarmStream` derive the WebSocket URL from `window.location` instead of hard-coding `wss://localhost:8443`. Same-origin URLs go through the Vite dev proxy (or production nginx), so a browser on a different LAN host no longer tries to talk to its own localhost. `VITE_RUNTIME_WS_URL` / `VITE_ALARMS_WS_URL` env overrides still honoured.
- `scripts/dev.sh`: Vite started with `--host 0.0.0.0` so the editor is reachable from other devices on the LAN. Info banner shows the host's first non-loopback IPv4 as `http://<lan-ip>:5173`. Remote browsers never see the runtime's self-signed cert — all traffic is proxied server-side by Vite (`secure: false`).

### Added (auth skeleton)
- `sws-auth`: real implementation. `hash_password`/`verify_password` (Argon2id with random salt, PHC-formatted hash). `AuthState` with single admin user seeded from constructor + in-memory `HashMap<token, username>` session registry. Unit tests cover hash roundtrip, malformed hash rejection, login/validate/logout flow, empty-password refusal.
- `sws-web`: `AppState.auth: Arc<AuthState>`. New routes: `POST /api/auth/login` (returns `{token, username}` on success, 401 otherwise), `POST /api/auth/logout` (idempotent), `GET /api/auth/whoami`. Tower middleware `require_auth` extracts the session token from either `Authorization: Bearer ...` or `?token=...` (the latter for browser WebSocket upgrades, which can't set custom headers) and refuses with 401 if invalid. Applied to every route under `/api/*` except `/api/auth/login` and to the WS endpoints. `/health` and `/metrics` stay open.
- `sws-runtime`: reads `SWS_ADMIN_USER` (default `admin`) and `SWS_ADMIN_PASSWORD` (required, no default — refuses to start without it) at startup. The clear-text password is hashed once and discarded.
- `sws-editor`: token + username persisted in `localStorage` (`sws.auth`) and hydrated at module load so refreshes survive. `api.client` adds `Authorization: Bearer ...` to every request and surfaces 401s as a typed `AuthError`. New `LoginScreen` component shown whenever `authToken` is null; `App` clears the session on `AuthError`. Header shows current user + "Esci" button.
- WS hooks (`tagStream`, `alarmStream`) build the URL with `?token=<session>` and replace the socket if the token changes (login/logout cycle).
- `scripts/dev.sh`: exports `PYO3_PYTHON=python3` (Debian Bookworm ships `python3` but not `python`, which pyo3-build-config defaults to) and `SWS_ADMIN_USER=admin` / `SWS_ADMIN_PASSWORD=admin` for local dev convenience. Production deployments must override these.
- `Cargo.toml` workspace: `argon2` upgraded to `features = ["std"]` so `OsRng` is available via `password_hash::rand_core::OsRng`. Added `uuid = { version = "1", features = ["v4"] }`.

### Added (text object + object list)
- `SynopticObject` gains an optional `name` field (human-friendly label) plus a full typography block for the `text` type: `text` (static content), `font_size`, `font_family`, `font_weight` (string or number), `font_style` (normal/italic), `text_anchor` (start/middle/end), `color`. Rendered by SvgCanvas via the matching SVG attributes; legacy use of `stroke_width` as fontSize is gone.
- Text rendering precedence: bound `tag` → `format` template (default `{value}`); otherwise the static `text` field; otherwise a "Testo" placeholder.
- EditorShell ObjectProps gains a "Nome" field at the top of every object, plus a dedicated text-styling block (size + alignment, font family, weight + style, colour).
- Zustand store: `duplicateObject(id)` clones an object with a fresh id, +20px offset, name suffix `(copia)`, and selects the copy.
- LeftPanel: new "OGGETTI PAGINA" accordion section listing every object on the current page. Click to select, double-click or ✎ to rename inline, ⧉ to duplicate, × to delete. Type prefix shown for quick scanning.
- Rust `SynopticObject`: matching fields added so trends/text/etc. survive YAML save-then-reload round-trips.

### Added (script sandboxing)
- `sws-pyscript::Engine` rewritten around a Python harness that compiles the user source, redirects `sys.stdout` / `sys.stderr` into in-memory `io.StringIO`, execs in a fresh globals dict with `tags` injected, then hands the captures back to Rust. New return type `ExecOutput { stdout, stderr, sandboxed }`.
- Wall-clock timeout per call (default 5 s, override via `SWS_SCRIPT_TIMEOUT_MS`). `tokio::time::timeout` drops the future on expiry — preemption mid-Python is left as a follow-up (needs `Python::check_signals` + a signal thread).
- RestrictedPython integration with graceful fallback. At engine startup we probe `import RestrictedPython`; if present, the harness compiles via `compile_restricted` with `safe_builtins`, blocking `import`, `exec`, dunder access etc. If absent, a warning is logged and the engine runs `compile()` unrestricted (so dev boxes don't break). Install with `pip install -r requirements.txt`.
- `POST /api/script/exec` response now includes `stdout`, `stderr` and `sandboxed` alongside `ok`/`error`. The editor's `RuntimeView` script dispatcher pipes them to `console.log` / `console.warn` so you can see `print(...)` and tracebacks from the browser devtools.
- `requirements.txt` at the repo root documenting the optional RestrictedPython dep.

### Added (source hot-reload)
- `sws-web::SourceSupervisor` (new module) owns a `HashMap<source_id, RunningSource>` mapping each `SourceDef` to a `JoinHandle` + `CancellationToken` + cached config JSON + owned-tag list. `reload(desired)` diffs the new list against the running set: stops sources whose id disappeared or whose JSON config changed, starts the rest. Stopping a source cancels its task, joins with a 2 s timeout, then releases its tag routes from `TagWriteBus`.
- `sws-plugin-modbus::run(cfg, db, bus, cancel)` and `sws-plugin-mqtt::run(cfg, db, cancel)` now take a `CancellationToken`. Both reconnect loops and inner sessions `select!` on `cancel.cancelled()` so cancellation lands within one network read / one poll cycle.
- `sws-core::TagWriteBus::unregister_many(ids)` to drop routes on plugin stop.
- `sws-web::AppState` gains `supervisor: Arc<SourceSupervisor>`. `PUT /api/project/sources` now persists then calls `supervisor.reload(new)` — no runtime restart for Modbus/MQTT config edits.
- `sws-runtime`: startup spawns plugins via the supervisor instead of bare `tokio::spawn`. Reload re-uses the same path. The plugin crates moved from `sws-runtime` deps to `sws-web` deps (the supervisor lives there now).
- ConfigView ProtocolsTab notice updated: "Le sorgenti vengono ricollegate in tempo reale al salvataggio (niente riavvio del runtime)."
- `tokio-util` added to the workspace dependencies (gives `CancellationToken`).

### Added (historian polish)
- `sws-historian::sqlite::SqliteStore` — bundled-SQLite (rusqlite) append-only log behind the in-memory ring buffer. Schema: `samples(tag TEXT, ts_ms INTEGER, value TEXT, quality TEXT)` with `WITHOUT ROWID` primary key on `(tag, ts_ms)` and an index on `ts_ms`. WAL mode + `synchronous=NORMAL` so writes don't block reads. All I/O via `tokio::task::spawn_blocking`.
- `Historian::with_sqlite(max_per_tag, store)` builds a historian backed by SQLite — restores up to `max_per_tag` most-recent samples per tag into RAM at startup, then write-through on every `record()`. RAM-only mode remains the default when no store is attached.
- `sws-runtime` reads `SWS_HISTORIAN_DB` at startup; if set to a writable path, opens the SQLite store and restores. `scripts/dev.sh` defaults it to `.run/historian.db` so trends survive a runtime restart during demos.
- `rusqlite = "0.32"` with `features = ["bundled"]` added to the workspace (no system SQLite dep — cc compiles the included source).
- `TrendCanvas` rewritten for multi-tag overlay + axes + tooltip:
  - Props: `tags: string[]` (was single `tag`). Each entry gets a colour — first uses the configured `lineColor`, rest pull from a 6-colour palette.
  - Right-edge Y-axis with 5 numeric ticks; bottom-edge X-axis with 4 HH:MM:SS ticks (local time). 4×4 grid divisions.
  - Top-left legend with colour swatches when >1 series.
  - Mouse hover: vertical crosshair, dots on the nearest sample of each series, floating tooltip box with the hover timestamp and per-series values.
  - X domain now bounded by the configured window (instead of the data's own span), so axes don't jump when a tag is briefly empty.
- `SynopticObject.extra_tags?: string[]` (Rust + TS) holds the additional series for the trend object. ObjectProps gains an "ALTRI TAG (OVERLAY)" repeater with TagInput autocomplete + remove × + "+ Aggiungi tag" button.

### Added (MQTT write path + multi-waveform driver)
- `TopicMapping.publish_topic: Option<String>` (Rust + TS). When set, the tag registers on `TagWriteBus`; a write — via `PUT /api/tags/:id`, an object's `on_press` script, a button, anywhere — is forwarded to the topic as a raw string payload (`true` / `42.5` / …). Subscribe and publish topics can be the same channel or different.
- `sws-plugin-mqtt::run(cfg, db, bus, cancel)`: new bus param. The session loop now `select!`s on cancel + write_rx + eventloop.poll, so an outbound write doesn't starve subscribe traffic and a long subscribe doesn't starve writes. `stringify(TagValue)` produces the payload.
- `SourceSupervisor` passes the bus to the MQTT plugin too (was Modbus-only before).
- ConfigView Protocolli tab: new "Topic out (publish, opz.)" column in `MqttSourceCard`, optional per row.
- `scripts/demo-driver.py` — multi-tag, multi-waveform driver. Each `--gen` is a `key=value` list with at least `tag=…`; `wave=` picks among `sin` / `cos` / `tri` / `saw` / `square` (with `duty`) / `random` / `step` (with `step_low` / `step_high` / `step_at`). All generators share one asyncio loop. Re-auths on 401.
- `scripts/dev.sh` pre-seed: added demo tags `cosine`, `triangle`, `ramp`, `noise` so the multi-waveform demo runs against the default project.yaml.

### Added (editor UX — undo/redo, multi-select, clipboard, align)
- Zustand store rewrite around three new concepts:
  - `past[]` / `future[]` snapshot stacks (deep-cloned `pages` snapshots, capped at 50). Every page-mutating action (`addObject`, `updateObject`, `addPage`, `deletePage`, …) pushes a snapshot before mutating, and clears `future`. `undo()` / `redo()` swap snapshots and clear the selection.
  - `selectedObjectIds: string[]` alongside the legacy `selectedObjectId`. New actions: `toggleSelection`, `selectMany`, `clearSelection`, `deleteSelection`, `duplicateSelection`. The properties panel auto-switches into a multi-select view at length > 1.
  - `clipboard: SynopticObject[]` cut/paste buffer with `copySelection` / `pasteClipboard`. Paste offsets +20 px and appends a "(incolla)" suffix to copied names.
- Multi-select on canvas: shift-click an object to toggle it into the selection (regular click still replaces). Drag is suppressed during a shift-click so the position doesn't snap to the cursor.
- Document-level keyboard shortcuts (registered via `useEffect` in EditorShell, ignored while typing in INPUT/TEXTAREA/SELECT):
  - `Ctrl/Cmd-Z` undo, `Ctrl/Cmd-Y` or `Ctrl/Cmd-Shift-Z` redo
  - `Ctrl/Cmd-C` copy, `Ctrl/Cmd-V` paste, `Ctrl/Cmd-D` duplicate
  - `Backspace` / `Delete` delete the selection
- New `MultiSelectionProps` panel (right sidebar when N > 1): alignment toolbar (left / center-x / right, top / middle-y / bottom), distribute (horizontal / vertical, ≥3 objects), plus inline Duplicate and Delete buttons.
- `alignSelection(mode: AlignMode)` action computes per-object deltas from the selection bounding box and applies them in a single history step; line endpoints (`x2`, `y2`) move along with the anchor.
- `LeftPanel` gains an "Annulla / Rifai" bar above the Save button, with buttons that auto-disable when the corresponding stack is empty.

### Added (auth polish: TTL, refresh, rate limit, RBAC roles)
- `sws-auth::Role` enum (`Viewer` < `Operator` < `Supervisor` < `Admin`, derive `Ord`) so middleware can `if user.role < required` cheaply.
- `AuthState::new(accounts, ttl, rate_limit, rate_window)`: multiple accounts seeded at startup, each with its own role. Login returns `LoginOk { token, username, role, expires_at_ms }`. `validate()` checks expiry AND slides the TTL on every hit (rolling refresh).
- Login rate limit per username: `record_failure` accumulates within `rate_window`; after `rate_limit` consecutive failures `login` returns `LoginError::RateLimited` (HTTP 429) until the window expires. Successful login resets the counter.
- `sws-runtime` reads `SWS_ADMIN_PASSWORD` (required), `SWS_SUPERVISOR_PASSWORD`, `SWS_OPERATOR_PASSWORD`, `SWS_VIEWER_PASSWORD` (optional). Tunables: `SWS_SESSION_TTL_SECS` (default 28800 = 8 h), `SWS_LOGIN_RATE_LIMIT` (5), `SWS_LOGIN_RATE_WINDOW_SECS` (60).
- `sws-web` router split into three role tiers, all behind `require_auth`:
  - **read** (Viewer+): `GET /api/tags`, `GET /api/alarms`, `GET /api/history/:tag`, `GET /api/project`, `GET /api/synoptics/*`, both WS streams, `whoami`/`logout`.
  - **operator** (Operator+): `PUT /api/tags/:id`, `POST /api/alarms/:id/ack`, `POST /api/script/exec`, `PUT /api/synoptics/:name`.
  - **admin** (Admin only): `PUT /api/project/{tags,sources,alarms}` (schema edits).
- `AuthUser` extension now carries `{username, role}`. `whoami` echoes the role; `LoginScreen` stores it, `api.client.ts` types it strictly.
- Editor header shows the current role as a small coloured badge (red Admin → blue Operator → grey Viewer); `localStorage` persists username+role so the badge survives reloads.
- `LoginScreen` distinguishes 401 (bad creds) from 429 (rate-limited) and shows different messages.
- `scripts/dev.sh` pre-seeds passwords for all four roles (`admin/supervisor/operator/viewer`) for local testing.

### Added (symbol library starter)
- New `symbol` SynopticObject type that renders one of five built-in SCADA symbols: **pump**, **valve**, **motor**, **tank**, **fan**.
- Library lives in `sws-editor/src/symbols/library.tsx`. Each entry exports a render function `(state, off, on, alarm) → JSX` drawing inside a 100×100 viewBox; the canvas scales to the object's width × height.
- State resolution: `alarm_tag` truthy → `alarm`, else `state_tag` truthy → `on`, else `off`. Per-object colour overrides (`state_off_color`, `state_on_color`, `state_alarm_color`) default to grey / green / red.
- Fan symbol uses a CSS `@keyframes sws-fan-spin` (registered in `index.html`) to rotate the rotor when in the `on` state.
- ObjectProps gains a "Simbolo" select, two TagInputs for state/alarm bindings, and three colour pickers for state overrides.
- LeftPanel palette adds a "+ Simbolo" button.
- Rust `SynopticObject` mirrors the new fields (`symbol_id`, `state_tag`, `alarm_tag`, `state_*_color`) so YAML save/reload preserves them.

### Added (reusable Python functions + expanded symbol library)

Object event handlers used to carry inline Python — same write-pump-on
snippet got copy-pasted into every button. They now reference a
project-level `FunctionDef` that lives in `project.yaml`. The symbol
palette doubles to 14 entries.

Project-level Python functions
- `sws-core::FunctionDef { id, name, description?, code, params: [{name, default?}] }`
  added to `Project.functions: Vec<FunctionDef>` with `#[serde(default)]`.
  Re-exported from `sws-core::lib`. Code body is capped at 64 KB.
- `sws-pyscript::Engine::execute_with_args(code, args)` extends the
  Python harness with a `__sws_args__` dict merged into globals. Names
  inside `args` become plain Python locals; values are coerced to
  bool/int/float/str. `execute(code)` now delegates with an empty dict.
- `sws-web` gains `AppState.functions: Arc<RwLock<HashMap<String, FunctionDef>>>`
  hot-swapped on every `PUT /api/project/functions` (Admin), so a rename
  takes effect for the next call without a restart. Validates param
  names against a Python identifier regex + keyword denylist; rejects
  duplicate function names; honours the 64 KB code cap (413 on overflow).
- `POST /api/script/run/:name` (Operator) accepts `{ args?: {...} }`,
  looks the function body up by name in the registry, then runs it
  through `Engine::execute_with_args`. Returns the same shape as
  `/api/script/exec`. 404 if the name is gone; otherwise 200 with
  stdout/stderr/sandboxed flags.

Object semantics (breaking — accepted, the PoC has few stored handlers)
- `SynopticObject.on_press` / `on_release` renamed to `on_press_fn` /
  `on_release_fn` to avoid silent inline-code → function-name
  reinterpretation. New companion fields `on_press_args` /
  `on_release_args` carry the per-binding parameter overrides.
- `SvgCanvas` dispatcher signature changed: `onScript(fn, args)`
  instead of `onScript(code)`.
- `RuntimeView.handleScript` now calls `api.runFunction(fn, args)`.
  `api.execScript(code)` stays available for ad-hoc tooling.

Editor UX
- Zustand store learns `selectedFunctionId` (mutually exclusive with
  object selection) plus `addFunction` / `duplicateFunction` /
  `updateFunction` / `renameFunction` / `deleteFunction` /
  `selectFunction`. `updateProjectFunctions(list)` replaces the
  whole list (used by the GET /api/project bootstrap).
- New `LeftPanel.FunctionsSection` accordion: lists every function,
  with inline rename (✎ / double-click), duplicate (⧉), and delete
  (×). Click a row to open its `FunctionEditor` in the right panel.
- `EditorShell.FunctionEditor` lets you edit name, description,
  params (name + default), and the Python body in a 220-line monospace
  textarea. "Salva funzioni" button calls `api.updateFunctions(...)`.
- `EditorShell.EventFunctionPicker` replaces the old EVENTI textareas
  on each object: two `<select>` dropdowns populated from
  `project.functions`, followed by an auto-generated form with one
  input per declared parameter, bound to `on_press_args` /
  `on_release_args`. Selecting a different function clears the
  arg overrides.

Symbol library
- Six new builtins (`compressor`, `level_sensor`, `flow_meter`,
  `pressure_indicator`, `breaker`, `mixer`) in
  `sws-editor/src/symbols/library.tsx`, each in 100×100 viewBox with
  the same `(state, off, on, alarm) → JSX` contract as the previous
  five.
- New `SymbolKind = "builtin" | "vendored"` flag. Vendored entries
  carry a `path` under `/symbols/` and are rendered via
  `<image href>` + a coloured 14×14 status badge in the top-right
  corner (so we don't tint the SVG itself — keeps CC-BY derivative-
  work concerns out of the picture).
- `sws-editor/public/symbols/` ships four CC0 1.0 SVGs authored for
  the project (`heat_exchanger`, `separator`, `reactor`, `filter`)
  plus `ATTRIBUTION.md` documenting the licence chain and the
  procedure for adding more (e.g. from Wikimedia Commons P&ID).

### Added (project import/export + seeded demo)

Round-trip a complete SWS project as a single ZIP from the editor —
backups, sharing demos, snapshotting. Plus the dev project ships in the
repo so a fresh clone starts with a working canvas.

Demo seed
- New `examples/demo/{project.yaml, synoptics/Page 1.yaml}` — versioned snapshot of the dev project (5 tags incl. `demo.button` / `demo.led`, MQTT echo on broker.freemqtt.com, alarm, two Python functions, 11+ canvas objects: counter buttons, MQTT LED ON/OFF, slider, gauge, pump symbol).
- `scripts/dev.sh` copies `examples/demo/` into `.run/project/` only when `project.yaml` is missing. Subsequent runs keep maintainer edits. The inline heredoc remains as a last-resort fallback when `examples/demo/` is absent (e.g., shallow checkout).
- `examples/README.md` documents the seed contract and the recommended workflow for refreshing the snapshot from the editor.

Backend (sws-web)
- New `zip = "2"` dep (default features off — no flate2/miniz). Files inside the bundle use `CompressionMethod::Stored` since a project is a handful of small YAML files where compression saves nothing.
- Two new routes in `admin_routes`:
  - `GET /api/project/export` → `export_project_zip` builds a ZIP in memory: `manifest.json` + `project.yaml` (MQTT passwords stripped to `None`) + `synoptics/<safe_filename(name)>.yaml` per page. Response carries `Content-Type: application/zip` and `Content-Disposition: attachment; filename="sws-project-<name>-<utc>.zip"`. `users.yaml` is **never** included.
  - `PUT /api/project/import` → `import_project_zip` parses the ZIP from the raw request body, validates `format_version`, replaces `project.yaml` and synoptics on disk (replace mode — orphans deleted), and hot-reloads in sequence (TagDb diff, AlarmDb.load, supervisor.reload, functions registry swap). Defensive: any leftover `"********"` password sentinel is scrubbed to `None`.
- Self-rolled `unix_to_ymdhm` for the export filename so we don't pull in `chrono` just for `YYYY-MM-DDTHH-MM`.

Frontend (sws-editor)
- `api.exportProjectZip()` returns the raw `Response` so the caller can read `Content-Disposition` before turning the body into a Blob.
- `api.importProjectZip(file: Blob)` PUTs the raw ZIP bytes.
- New `src/components/ProjectIO.tsx`: header buttons "Esporta" / "Importa" + a hidden `<input type="file" accept=".zip">`. Admin-only — renders `null` for other roles. Confirm dialog before import warns about destructive replace + missing MQTT passwords. After import, refreshes project + synoptics from the server so the UI shows the new state.
- App.tsx wires `<ProjectIO />` between the mode tabs and the "Log" button.

### Added (runtime log panel + MQTT echo demo)

Live runtime logs in the editor: every `tracing::{info,warn,error}!` event is
captured into an in-memory ring + broadcast and streamed to a bottom-drawer
panel in the editor.

Backend
- New `sws-core::logbus` module: `LogBus` (1000-entry `VecDeque` + `tokio::sync::broadcast::Sender`), `LogEvent { ts_ms, level, target, message, fields }`, `DEFAULT_LOG_CAPACITY = 1000`. Two unit tests cover ring eviction and live broadcast.
- New `sws-runtime/log_layer.rs`: `LogBusLayer` impl of `tracing_subscriber::Layer` with a `FieldVisitor` that splits the message from structured fields (bool/i64/u64/f64/str/debug). The fmt-to-stdout JSON layer continues to run in parallel — both subscribers see every event.
- `sws-runtime/main.rs` constructs `Arc<LogBus>` before subscriber init, composes `registry().with(env_filter).with(fmt::layer().json()).with(LogBusLayer::new(...))`, and threads the bus into `sws_web::router::build(...)`.
- `sws-web::AppState.logs: Arc<LogBus>`. New routes `GET /api/logs` (snapshot) and `GET /ws/logs` (snapshot-then-tail) sit in `operator_routes` so Viewer is gated out. The WS handler swallows `RecvError::Lagged` silently to avoid "log about logs" feedback loops.

Frontend
- New `LogEvent` + `LogLevel` types in `src/types/index.ts`. `api.client.getLogs()` and a new `src/ws/logStream.ts` (mirrors `alarmStream.ts`) drain `/api/logs` then attach a WS to `/ws/logs?token=…`. The hook is a no-op for Viewer / unauthenticated states so no socket gets opened.
- Zustand store gains `logs: LogEvent[]` (capped at 2000 client-side) plus `setLogs` / `appendLog` / `clearLogs`.
- New `src/components/LogPanel.tsx`: bottom drawer, 240 px high, fixed-flex layout. Header bar with Pausa (freezes a snapshot for inspection), Cancella, free-text search (case-insensitive, regex-escaped `<mark>` highlight of matches), target substring filter, and 5 colour-coded level toggles (TRACE/DEBUG off by default — too chatty for the PoC). List uses monospace cells (timestamp / level / target / message), auto-scrolls to bottom unless the user scrolls up, and falls back to either "nessun log" or "permesso insufficiente" empty states.
- `App.tsx` adds a "Log" toggle button next to the mode tabs (open/closed state persisted in `localStorage` as `sws.logPanel.open`) and renders the panel below `<main>`. `useLogStream()` is mounted at the App level so the snapshot survives mode switches.

Demo project — MQTT round-trip
- `.run/project/project.yaml` gains two bool tags (`demo.button`, `demo.led`) and two new MQTT topic mappings on `sws/demo/echo` (publish on the button tag, subscribe on both). Pressing the button writes `demo.button=true` → rumqttc publishes → broker.freemqtt.com echoes → both tags receive `true` → LED lights up. No external bridge required.
- `.run/project/synoptics/Page 1.yaml` gets a "MQTT Echo" button + a green LED indicator placed next to the existing slider.

### Added (BL-003 — CodeMirror Python editor for FunctionDef bodies)
- `sws-editor` gains `PythonEditor` (`src/components/PythonEditor.tsx`): a CodeMirror 6 wrap with `@codemirror/lang-python`, one-dark theme, line numbers, history/undo, indent-with-tab, bracket matching, and a stable `forwardRef` API exposing `insertAtCursor(text)` + `focus()`. External `value` syncs are dispatched only on diff so the cursor doesn't jump while the user is typing.
- `src/editor/FunctionEditor.tsx` is a brand-new full-screen pane: header (name chip + "● modifiche non salvate" indicator + "Inserisci template…" snippet dropdown + Save + Close), 280 px left aside (name / description / params list), and a flex-1 right column hosting `PythonEditor`. Six built-in snippets: increment, toggle, conditional, reset_many, diagnostic, function skeleton.
- Dirty tracking via `JSON.stringify(fn)` snapshot at last persist; Save is disabled while clean. Errors from the server PUT surface in a red banner.
- `EditorShell` now branches at the top: when `selectedFunctionId` is set, it renders `<LeftPanel/> + <FunctionEditor/>` full-width, hiding the canvas + properties panel until the user clicks Close. The old inline FunctionEditor (~125 lines of textarea + sub-form) was removed.
- Bundle grew to 738 KB / 232 KB gzipped — accepted because the language pack + history extensions live in the same chunk.

### Added (BL-002 — MQTT auth, TLS, last-will, QoS, password masking)
- `MqttConfig` (sws-core) gains `username`, `password`, `password_env`, `keep_alive_secs`, `clean_session`, `qos`, `tls: MqttTlsConfig`, and `last_will: MqttLastWill`. `TopicMapping` gains a per-topic `qos` override. All fields are `#[serde(default, skip_serializing_if = …)]` so existing `project.yaml` files load unchanged.
- New types `MqttTlsConfig { enabled, ca_cert_path, insecure_skip_verify }` and `MqttLastWill { topic, payload, qos, retain }` exported from `sws-core::lib`.
- `sws-plugin-mqtt::run_session` resolves credentials in order `password_env > password > none`, calls `set_keep_alive` / `set_clean_session` / `set_credentials` / `set_last_will` on the `MqttOptions`, and wires `Transport::Tls(TlsConfiguration::Simple { ca, alpn: None, client_auth: None })` when TLS is enabled. **rumqttc 0.24 has no `Native` variant**, so a CA cert path is mandatory when TLS is on; otherwise the session refuses to start with an explanatory anyhow error. Subscribe loop and the publish-from-write path both honour the resolved QoS (per-topic > source-level fallback > AtMostOnce).
- `sws-web` masks MQTT passwords on `GET /api/project`: every `MqttSource.password` is replaced by the literal sentinel `"********"` before serialising. On `PUT /api/project/sources`, the runtime loads the previous project from disk and, for each incoming MQTT source whose password equals the sentinel, copies the old hash back in. Empty string clears the password; any other value overwrites.
- `MqttSourceCard` (ConfigView → Protocolli) reworked with collapsible sections: Autenticazione (username + password input with "lascia ******** per non modificare" hint + `password_env`), Connessione (keep_alive_secs / clean_session / default QoS), TLS (enabled + ca_cert_path + insecure_skip_verify with warning), Last Will (topic / payload / qos / retain). Topic table grows a per-row QoS column.

### Added (BL-001 — persistent multi-user store with admin CRUD)
- `sws-auth` rewritten on top of a persistent `UserStore` backed by `users.yaml` in the project directory. New constructor `AuthState::new_persistent(store_path, seed, ttl, rate_limit, rate_window)` loads the YAML if present, otherwise seeds from the existing env-var path and writes the file. Admin accounts seeded from env start with `must_change_password: false`; manually-created accounts default to `true`.
- New types: `UserSummary { username, role, must_change_password, created_at_ms, updated_at_ms }`, `UserPatch { role?, password?, must_change_password? }`, `CreateUser { username, password, role, must_change_password (default true) }`, `ChangePassword { old_password, new_password }`, `SessionInfo { username, role, must_change_password }`. `LoginOk` extended with `must_change_password`.
- New CRUD methods on `AuthState`: `list_users` / `create_user` / `update_user` / `delete_user` / `change_password`. Last-admin protection: `delete_user` and `update_user` (when demoting) refuse if the target is the only `Admin`. Self-delete is rejected at the router level with `cannot_delete_self`. `change_password` verifies the old hash and clears `must_change_password`. Every mutation persists via `flush_locked`.
- `sws-web` router gains:
  - `GET /api/auth/users`, `POST /api/auth/users`, `PUT /api/auth/users/:username`, `DELETE /api/auth/users/:username` — Admin only.
  - `POST /api/auth/change-password` — any authenticated session; bypasses the blocking middleware.
  - `whoami` now echoes `must_change_password`.
- New `require_password_changed` middleware in front of every non-self-service route: returns HTTP 403 with `{ "error": "password_change_required", "detail": "..." }` whenever the session user still has the flag.
- `AuthState::new_persistent` is now the only constructor `sws-runtime/main.rs` uses (the in-memory `AuthState::new` is retained for unit tests).
- `sws-editor`:
  - `api.client.ts` extended with `changePassword`, `listUsers`, `createUser`, `updateUser`, `deleteUser`, plus a `PasswordChangeRequiredError` typed error that the request helper raises whenever it sees a 403 with the sentinel envelope. `login` / `whoami` response types include `must_change_password`.
  - Zustand store: `mustChangePassword` flag persisted in `localStorage` alongside token+role; `setAuth(token, user, role, mustChangePassword?)` and `setMustChangePassword(flag)`. `clearAuth` resets it.
  - New `ChangePasswordScreen` component (`src/components/ChangePasswordScreen.tsx`): three-field form (old / new / confirm) with client-side checks (length, match, must differ). Renders in place of the App shell while `mustChangePassword === true`.
  - New "Utenti" tab in ConfigView (Admin only): per-row role select, "forza cambio pwd" toggle, inline reset-password field + button, "Elimina" with self-delete guard, plus a "+ Nuovo utente" form (username / password / role / "forza cambio al primo accesso" checkbox).
- Test coverage: 11 unit tests in `sws-auth` (incl. `create_update_delete_user`, `cant_delete_last_admin`, `cant_demote_last_admin`, `change_password_clears_flag`), 22 in the whole workspace.

### Added (PX30 deploy artefacts)
- `compose.yaml` at the repo root orchestrating `sws-runtime` + `sws-editor` containers with sensible defaults: mounts `.run/{config,project,db}` from the host, surfaces all auth/TTL/rate-limit/Python-timeout/historian env knobs, healthchecks both services, requires `SWS_ADMIN_PASSWORD` to be set in the environment.
- `scripts/build-images.sh` — multi-arch (`linux/amd64,linux/arm64`) build via `docker buildx`. `--push` to a registry or default to OCI archives under `.run/oci/` for offline transfer to the SBC. Documents the one-time `tonistiigi/binfmt` + `buildx create` setup.
- `docs/DEPLOY_PX30.md` — end-to-end recipe for getting SWS on a Rockchip PX30 (or any ARM64 SBC): prerequisites, image build, load on the board, seed project.yaml with a Modbus source, login, plus an optional systemd unit. Lists the known PX30-specific gotchas (missing `/usr/bin/python` on Debian Bookworm, clock skew on coldstart, fussy PLC source ports, OOM under heavy debug logging, SD card wear with historian persistence).

### Added (cross-cutting object properties)
- `SynopticObject` gains `z_index`, `visible`, `visible_tag`, `on_press`, `on_release` in both Rust (`sws-web/synoptic.rs`) and TypeScript (`sws-editor/src/types`). Trend fields (`window_s`, `y_min`, `y_max`, `line_color`) added to the Rust struct too — they were dropped on save before.
- `sws-editor/src/canvas/SvgCanvas.tsx`: objects sorted by `z_index` (ties by array order) before SVG render, so layering is declarative. `isObjectVisible()` evaluates `visible_tag` (truthy coercion for bool/number/string) and falls back to the static `visible !== false`. In runtime mode, hidden objects are not rendered; in edit mode they're shown at 35% opacity so the designer can still select them.
- `sws-editor` ObjectProps: every object now gets a "LIVELLO E VISIBILITÀ" section (z-index numeric input plus ▲/▼ buttons, "Visibile" checkbox, "Tag visibilità" with TagInput autocomplete) and an "EVENTI (PYTHON)" section (textareas for `on_press` and `on_release`).
- `sws-pyscript`: PyO3-backed `Engine` — `execute(code)` runs Python on `tokio::task::spawn_blocking`, exposing a `tags` global with `read(id) -> bool|int|float|str|None` and `write(id, value)` that routes via `TagWriteBus` (NoWriter → falls back to direct `TagDb` set, same as the HTTP write path). Errors surface as `Err(String)`.
- `sws-web`: `POST /api/script/exec` with `{code: string}` returning `{ok, error?}`. Engine wired into `AppState` from `sws-runtime/main.rs`.
- `sws-editor`: `api.execScript(code)`, and `RuntimeView` passes an `onScript` callback to `SvgCanvas`. The canvas dispatches `onMouseDown → on_press`, `onMouseUp → on_release` (view mode only — edit mode keeps drag/select behaviour).
- `docs/OPEN_QUESTIONS.md` Q1: partially decided. PyO3 + the API surface are live; **sandboxing remains open** (no RestrictedPython, no timeouts, no stdout capture). Acceptable while auth is missing and projects are maintainer-only.
